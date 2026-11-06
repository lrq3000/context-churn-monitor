import { connectHost, type HostClient } from '@openchamber/sdk';
import { applyHostReady, mountButton } from '@openchamber/sdk/ui';
import { escapeHtml, metric, reportStyle, stepRow, coverage, growthMetric } from '../reports/view.js';
import type { State, Config, Step, Turn } from '../core/types.js';
import { AnalysisPanel } from './analysis.js';

/** A status frame carries the exact session identity. The service-fed native status surface carries only a directory and cannot safely choose a conversation. */
class ReportPanel {
  private directory = '';
  private session = '';
  private offset = 0;
  private next: number | null = null;
  private epoch = 0;
  private revision = -1;
  private busy = false;
  private compact = false;
  private timer?: ReturnType<typeof setTimeout>;
  private settings?: Config;
  private snapshot: State | null = null;
  private analysis: AnalysisPanel;

  constructor(private host: HostClient) {
    const style = document.createElement('style'); style.textContent = reportStyle; document.head.append(style);
    document.querySelector('#app')!.innerHTML = `
      <h1>Context Churn Monitor</h1><p class="muted report-only">Context growth and compactions · deterministic monitoring</p>
      <div id="error" role="alert"></div><div id="notice" class="muted" role="status"></div>
      <details id="pairing" class="report-only"><summary>Connect monitoring backend</summary><p class="pair-note muted">Enter the backend descriptor file for this project. Credentials remain in the local service.</p><label>Backend descriptor path<input id="descriptor" placeholder="Absolute path to ….backend.json"></label><div id="pair-button" class="buttons"></div></details>
      <div id="metrics" class="metrics"></div><div id="chart"></div><p id="quality" class="muted"></p>
      <div class="toolbar"><label><span><input id="warnings" type="checkbox" checked> Automatic warnings</span></label><label><span><input id="details-toggle" type="checkbox" checked> Step details</span></label><div id="view-button"></div></div>
      <div id="report" class="report-only">
        <div class="toolbar"><label>Scope<select id="scope"><option value="all">All recorded steps</option><option value="current">Current turn</option><option value="recent">Recent turns</option></select></label><label>Sort steps<select id="sort"><option value="time">Chronological</option><option value="growth">Largest growth first</option></select></label><div id="refresh"></div></div>
        <div class="table-wrap"><table><thead><tr><th>Turn.step</th><th>Activity and evidence</th><th>Context growth</th><th>Compactions after</th></tr></thead><tbody id="rows"></tbody></table></div>
        <div class="buttons"><div id="previous"></div><span id="page-label" class="muted"></span><div id="next"></div></div>
        <div class="buttons"><div id="export-html"></div><div id="export-json"></div></div>
        <p class="muted">Blue shading indicates growth; green counts mark applied checkpoints. “≥” is a partial lower bound, “~” is estimated, and “—” is unavailable. Export includes all recorded steps.</p>
        <details><summary>Monitor settings</summary><div class="toolbar"><label>EMA span (turns)<input id="span" type="number" min="1" value="5"></label><label>Analysis lookback (turns)<input id="lookback" type="number" min="1" value="5"></label><label>Growth threshold (pp)<input id="growth-threshold" type="number" min="0.1" step="0.1" value="40"></label><label>Compaction threshold<input id="compaction-threshold" type="number" min="0.01" step="0.01" value="0.3"></label><div id="save-settings"></div></div></details>
        <section id="analysis" class="report-only"></section>
      </div>`;
    this.analysis = new AnalysisPanel(host, () => {
      const directory = this.directory, session = this.session;
      return (path, input) => this.request(path, 'POST', input, { directory, session });
    });
    this.button('pair-button', 'Pair backend', async () => {
      await this.request('/pair', 'POST', { path: this.input('descriptor').value });
      (document.querySelector('#pairing') as HTMLDetailsElement).open = false;
      this.reset();
    });
    this.button('view-button', 'View steps', () => this.host.openSurface('plugin:context-churn-monitor'));
    this.button('refresh', 'Refresh', () => this.reset());
    this.button('previous', 'Previous', () => { this.offset = Math.max(0, this.offset - 50); this.reset(false); });
    this.button('next', 'Next', () => { if (this.next !== null) { this.offset = this.next; this.reset(false); } });
    for (const format of ['html', 'json']) this.button(`export-${format}`, `Export ${format.toUpperCase()}`, async () => {
      const result = await this.request('/export', 'POST', { format });
      this.text('notice', `Saved ${result.path}`);
    });
    this.button('save-settings', 'Save settings', async () => {
      await this.request('/settings', 'POST', { span: Number(this.input('span').value), lookback: Number(this.input('lookback').value), growthThreshold: Number(this.input('growth-threshold').value), compactionThreshold: Number(this.input('compaction-threshold').value) });
      this.reset();
    });
    this.input('warnings').onchange = () => void this.run(async () => { await this.request('/settings', 'POST', { warnings: this.input('warnings').checked }); this.reset(); });
    this.input('details-toggle').onchange = () => { document.querySelector('#report')!.toggleAttribute('hidden', !this.input('details-toggle').checked); };
    for (const id of ['scope', 'sort']) document.querySelector(`#${id}`)!.addEventListener('change', () => this.reset());
    host.onReady(ctx => {
      applyHostReady(ctx, document.documentElement);
      this.compact = ctx.surface === 'status';
      document.body.classList.toggle('compact', this.compact);
      this.directory = ctx.directory ?? ''; this.session = ctx.session?.id ?? ''; this.reset();
      if (this.compact) {
        void host.setHeight(250);
        void host.setStatusControls([{ kind: 'button', id: 'view-steps', label: 'View steps' }]).catch(() => {});
      }
    });
    host.onDirectory(directory => { if (this.directory !== (directory ?? '')) this.clearContext(); this.directory = directory ?? ''; this.reset(); });
    host.onSession(session => { if (this.session !== (session?.id ?? '')) this.clearContext(); this.session = session?.id ?? ''; this.reset(); });
    host.onStatusControl(control => { if (control.id === 'view-steps') void this.run(() => host.openSurface('plugin:context-churn-monitor')); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.reset(false); });
  }

  private input(id: string): HTMLInputElement { return document.querySelector(`#${id}`)!; }
  private clearContext(): void {
    // Clear synchronously, before the next backend response, so a removed/changed session cannot display another conversation's evidence.
    this.snapshot = null; this.settings = undefined; this.next = null;
    this.analysis.reset();
    for (const id of ['rows', 'notice', 'error', 'page-label']) this.text(id, '');
    this.drawMetrics(null, []);
  }
  private text(id: string, value: string): void { document.querySelector(`#${id}`)!.textContent = value; }
  private button(id: string, label: string, action: () => unknown): void {
    mountButton(document.querySelector(`#${id}`)!, { label, variant: 'outline', size: 'sm', onClick: () => void this.run(action) });
  }
  private async run(action: () => unknown): Promise<void> {
    try { await action(); this.text('error', ''); }
    catch (error) { this.text('error', error instanceof Error ? error.message : String(error)); }
  }
  private async request(path: string, method: 'GET' | 'POST' = 'GET', data?: any, query = {}): Promise<any> {
    // The SDK transports HTTP bodies as text in both directions; JSON encoding belongs at this bridge boundary.
    const response = await this.host.serviceRequest({ method, path, query: { directory: this.directory, session: this.session, ...query }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = JSON.parse(response.body);
    if (response.status < 200 || response.status >= 300) throw new Error(result?.error ?? 'Monitoring backend unavailable');
    return result;
  }
  private reset(firstPage = true): void {
    if (firstPage) this.offset = 0;
    this.revision = -1; this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    if (!this.busy) void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (document.hidden) return;
    this.busy = true;
    const epoch = this.epoch;
    try {
      if (!this.directory || !this.session) { this.text('quality', 'Select a monitored conversation to see its metrics.'); return; }
      const result = await this.request('/snapshot');
      if (epoch !== this.epoch) return;
      this.settings = result.settings; this.snapshot = result.state;
      this.drawMetrics(result.state, result.turns);
      this.input('warnings').checked = result.settings.warnings;
      if (document.activeElement?.tagName !== 'INPUT') {
        this.input('span').value = String(result.settings.span); this.input('lookback').value = String(result.settings.lookback);
        this.input('growth-threshold').value = String(result.settings.growthThreshold); this.input('compaction-threshold').value = String(result.settings.compactionThreshold);
      }
      if (!this.compact && this.revision !== (result.state?.revision ?? 0)) {
        const page = await this.request('/steps', 'GET', undefined, { limit: '50', offset: String(this.offset), scope: this.input('scope').value, sort: this.input('sort').value });
        if (epoch !== this.epoch) return;
        const opened = new Set([...document.querySelectorAll('tr[data-step]:has(details[open])')].map(el => el.getAttribute('data-step')));
        document.querySelector('#rows')!.innerHTML = page.items.map((step: Step) => stepRow(step)).join('') || '<tr><td colspan="4">No recorded steps in this scope.</td></tr>';
        for (const row of document.querySelectorAll('tr[data-step]')) if (opened.has(row.getAttribute('data-step'))) row.querySelector('details')!.open = true;
        this.next = page.next;
        this.text('page-label', page.items.length ? `Steps ${this.offset + 1}–${this.offset + page.items.length}` : 'No steps');
        (document.querySelector('#previous button') as HTMLButtonElement).disabled = this.offset === 0;
        (document.querySelector('#next button') as HTMLButtonElement).disabled = page.next === null;
        this.revision = result.state?.revision ?? 0;
      }
      this.text('error', '');
    } catch (error) { this.text('error', error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; this.timer = setTimeout(() => void this.refresh(), epoch === this.epoch ? 2000 : 0); }
  }

  private drawMetrics(state: State | null, turns: Turn[]): void {
    const values = [['Growth EMA', metric(state?.ema.growth, ' pp/turn')], ['Compaction EMA', metric(state?.ema.compactions, '/turn')], ['Current turn growth', state?.turn ? growthMetric(state.turn) : '—'], ['Current turn compactions', state?.turn ? String(state.turn.compactions) : '—']];
    document.querySelector('#metrics')!.innerHTML = values.map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('');
    this.text('quality', state?.turn ? `Turn ${state.turn.number} · ${state.turn.ended === undefined ? 'live' : 'completed'} · ${coverage(state.turn)}${state.turn.gaps.length ? ' — partial coverage; expand step evidence' : ''}` : 'No measurements yet. Historical steps before installation are unavailable.');
    const points = turns.filter(t => t.growth !== null).map(t => t.growth!);
    const max = Math.max(1, ...points);
    const coords = points.map((v, i) => `${points.length === 1 ? 50 : i / (points.length - 1) * 100},${30 - v / max * 27}`).join(' ');
    document.querySelector('#chart')!.innerHTML = `<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="Recent turn growth"><polyline points="${escapeHtml(coords)}" fill="none" stroke="var(--info-text,#3575c9)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
  }
}

new ReportPanel(connectHost());
