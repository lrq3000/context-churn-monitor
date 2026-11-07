import type { Store } from '../storage/store.js';
import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { escapeHtml, reportStyle, stepRow } from './view.js';
import { Worker } from 'node:worker_threads';
import { activityOpen, activityClose, activityStyle, measurementNotice, requestHeader } from './activity.js';

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
      if (format === 'html') writeSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Steps Diagnostics</title><style>${reportStyle}${activityStyle}</style></head><body class="standalone"><main><h1>Steps Diagnostics</h1><p>${escapeHtml(session)} · revision ${snapshot?.revision ?? 0}</p><h2>Activity replay</h2><input class="activity-search" id="search" type="search" aria-label="Search activities" placeholder="Find a command, file or activity…"><button id="expand">Expand all</button>${measurementNotice}<div class="timeline">`);
      else writeSync(file, `{"session":${JSON.stringify(session)},"snapshot":${JSON.stringify(snapshot)},"steps":[`);
      if (format === 'html') writeActivities(store, session, file, format);
      if (format === 'html') writeSync(file, `</div><details class="request-accounting"><summary>All request accounting and diagnostic evidence</summary><label>Sort <select id="sort"><option value="time">Chronological</option><option value="growth">Largest growth</option></select></label><div class="table-wrap"><table><thead><tr><th>Turn.request</th><th>Request evidence</th><th>Context growth</th><th>Compactions after</th></tr></thead><tbody>`);
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
      if (format === 'json') { writeSync(file, '],"activities":['); writeActivities(store, session, file, format); writeSync(file, ']}'); }
      else writeSync(file, `</tbody></table></div></details></main><script>const rows=[...document.querySelectorAll('[data-step]')];document.querySelector('#sort').onchange=e=>{const sorted=[...rows];if(e.target.value==='growth')sorted.sort((a,b)=>Number(b.dataset.growth)-Number(a.dataset.growth));document.querySelector('tbody').replaceChildren(...sorted)};const activities=[...document.querySelectorAll('details[data-activity]')];document.querySelector('#search').oninput=e=>{const q=e.target.value.toLowerCase();activities.forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(q));document.querySelectorAll('.request-head').forEach(h=>{let a=h.nextElementSibling,visible=false;while(a&&!a.classList.contains('request-head')){visible||=!a.hidden;a=a.nextElementSibling}h.hidden=!visible})};document.querySelector('#expand').onclick=e=>{const open=activities.some(a=>!a.hidden&&!a.open);activities.filter(a=>!a.hidden).forEach(a=>a.open=open);e.target.textContent=open?'Collapse all':'Expand all'};</script></body></html>`);
    });
  } finally { closeSync(file); }
  return path;
}

/** Stream even a single very large body in bounded slices; no full transcript or body is assembled in JavaScript. */
function writeActivities(store: Store, session: string, file: number, format: string): void {
  let after = 0, first = true, group = '';
  for (;;) {
    const page = store.activities.list(session, { after, limit: 200 });
    if (!page.items.length) break;
    for (const activity of page.items) {
      if (format === 'json') writeSync(file, `${first ? '' : ','}${JSON.stringify(activity).slice(0, -1)},"bodies":{`);
      else {
        const key = `${activity.turnNumber}:${activity.messageId ?? 'between'}`;
        if (key !== group) writeSync(file, requestHeader(activity, activity.messageId ? store.requestSteps(session, activity.messageId) : []));
        group = key;
        writeSync(file, activityOpen(activity));
      }
      let firstChannel = true;
      for (const { channel } of store.activities.channels(session, activity.id)) {
        writeSync(file, format === 'json' ? `${firstChannel ? '' : ','}${JSON.stringify(channel)}:"` : `<section><strong>${escapeHtml(channel)}</strong><pre>`);
        let offset = 0;
        for (;;) {
          const body = store.activities.detail(session, activity.id, channel, offset, 32000);
          writeSync(file, format === 'json' ? JSON.stringify(body.text).slice(1, -1) : escapeHtml(body.text));
          if (body.next === null) break;
          offset = body.next;
        }
        writeSync(file, format === 'json' ? '"' : '</pre></section>');
        firstChannel = false;
      }
      writeSync(file, format === 'json' ? '}}' : activityClose(activity));
      first = false;
    }
    after = page.items.at(-1)!.order!;
  }
}
