import type { Store } from '../storage/store.js';
import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { escapeHtml, reportStyle, stepRow } from './view.js';
import { Worker } from 'node:worker_threads';

/** CPU work and synchronous SQLite/file IO run outside the host event loop, on a separate read-only WAL snapshot. */
export async function exportReport(store: Store, session: string, directory: string, format: string): Promise<string> {
  if (format !== 'html' && format !== 'json') throw new Error('Export format must be html or json');
  if (store.path === ':memory:') throw new Error('Export requires a persistent monitoring database');
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(`./export-worker.${extension}`, import.meta.url), { workerData: { database: store.path, session, directory, format } });
    let path: string | undefined;
    worker.once('message', value => { path = value; });
    worker.once('error', reject);
    worker.once('exit', code => code === 0 && path ? resolve(path) : reject(new Error(`Export worker exited without a report (${code})`)));
  });
}

/** Worker-owned streaming output uses bounded pages and one stable snapshot, without copying the full history into memory. */
export function writeReport(store: Store, session: string, directory: string, format: string): string {
  if (format !== 'html' && format !== 'json') throw new Error('Export format must be html or json');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `context-report-${randomUUID()}.${format}`);
  const file = openSync(path, 'wx', 0o600);
  try {
    store.readSnapshot(() => {
      const snapshot = store.snapshot(session);
      if (format === 'html') writeSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Steps Diagnostics</title><style>${reportStyle}</style></head><body><main><h1>Steps Diagnostics</h1><p>${escapeHtml(session)} · revision ${snapshot?.revision ?? 0}</p><p>All recorded steps. “≥” is a partial lower bound; “~” is estimated; “—” is unavailable.</p><label>Sort <select id="sort"><option value="time">Chronological</option><option value="growth">Largest growth</option></select></label><div class="table-wrap"><table><thead><tr><th>Turn.step</th><th>Activity and evidence</th><th>Context growth</th><th>Compactions after</th></tr></thead><tbody>`);
      else writeSync(file, `{"session":${JSON.stringify(session)},"snapshot":${JSON.stringify(snapshot)},"steps":[`);
      let cursor: [number, number] = [-1, -1], first = true;
      for (;;) {
        const items = store.stepBatch(session, cursor);
        if (!items.length) break;
        for (const step of items) {
          writeSync(file, format === 'html' ? stepRow(step) : `${first ? '' : ','}${JSON.stringify(step)}`);
          first = false;
        }
        const last = items.at(-1)!;
        cursor = [last.turnNumber, last.number];
      }
      writeSync(file, format === 'html' ? `</tbody></table></div></main><script>const rows=[...document.querySelectorAll('[data-step]')];document.querySelector('#sort').onchange=e=>{const sorted=[...rows];if(e.target.value==='growth')sorted.sort((a,b)=>Number(b.dataset.growth)-Number(a.dataset.growth));document.querySelector('tbody').replaceChildren(...sorted)};</script></body></html>` : ']}');
    });
  } finally { closeSync(file); }
  return path;
}
