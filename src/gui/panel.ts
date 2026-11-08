import { connectHost, type HostClient } from '@openchamber/sdk';
import { applyHostReady, mountButton } from '@openchamber/sdk/ui';
import { escapeHtml, metric, reportStyle, coverage, growthMetric } from '../reports/view.js';
import { activityStyle, measurementNotice, replayRows } from '../reports/activity.js';
import type { Activity, BodyPage } from '../core/activity.js';
import type { State, Config, Step, Turn } from '../core/types.js';
import { AnalysisPanel } from './analysis.js';
import { AlertsPanel } from './alerts.js';

/** A status frame carries the exact session identity. The service-fed native status surface carries only a directory and cannot safely choose a conversation. */
class ReportPanel {
  private directory = '';
  private session = '';
  private offset = 0;
  private next: number | null = null;
  private epoch = 0;
  private context = 0;
  private action = 0;
  private revision = -1;
  private busy = false;
  private compact = false;
  private timer?: ReturnType<typeof setTimeout>;
  private settings?: Config;
  private snapshot: State | null = null;
  private analysis: AnalysisPanel;
  private alerts: AlertsPanel;

  constructor(private host: HostClient) {
    const style = document.createElement('style'); style.textContent = reportStyle + activityStyle; document.head.append(style);
    document.querySelector('#app')!.innerHTML = `
      <h1>Context Churn Monitor</h1><p class="muted report-only">Context growth and compactions · deterministic monitoring</p>
      <div id="error" role="alert"></div><div id="action-error" role="alert"></div><div id="notice" class="muted" role="status"></div>
      <details id="pairing" class="report-only"><summary>Connection settings (advanced)</summary><p class="pair-note muted">Connects automatically to this project's registered backend. Use a manual descriptor only to override the connection or select between multiple backends. Credentials remain in the local service.</p><label>Manual backend descriptor path<input id="descriptor" placeholder="Absolute path to ….backend.json"></label><div id="pair-button" class="buttons"></div></details>
      <div id="metrics" class="metrics"></div><div id="chart"></div><p id="quality" class="muted"></p>
      <div class="toolbar"><label><span><input id="warnings" type="checkbox" checked> Automatic warnings</span></label><label><span><input id="details-toggle" type="checkbox" checked> Step details</span></label><div id="view-button"></div></div>
      <section id="global-alerts" class="report-only"></section>
      <div id="report" class="report-only">
        <div class="replay-heading"><div><h2>Activity replay</h2><p class="muted">The conversation’s activity, in the order it happened.</p></div></div>
        <div class="toolbar"><label>Scope<select id="scope"><option value="all">All recorded activities</option><option value="current">Current turn</option><option value="recent">Recent turns</option></select></label><div id="refresh"></div></div>
        <div class="activity-toolbar"><input id="activity-search" type="search" aria-label="Search activities" placeholder="Find a command, file or activity…"><select id="activity-filter" aria-label="Activity type"><option value="all">All activities</option><option value="tools">Tools</option><option value="thinking">Thinking</option><option value="compaction">Compactions</option><option value="text">Responses</option><option value="user">User input</option><option value="system">Conversation updates</option><option value="retry">Retries</option></select><button id="expand-activities" type="button">Expand all</button></div>
        <div class="timeline" id="rows" aria-label="Chronological activity replay"></div>
        <div class="buttons"><div id="previous"></div><span id="page-label" class="muted"></span><div id="next"></div></div>
        <div class="buttons"><div id="export-html"></div><div id="export-json"></div></div>
        ${measurementNotice}
        <details><summary>Monitor settings — current session</summary><div class="toolbar"><label>EMA span (turns)<input id="span" type="number" min="1" value="5"></label><label>Analysis lookback (turns)<input id="lookback" type="number" min="1" value="5"></label><div id="save-settings"></div></div></details>
        <section id="analysis" class="report-only"></section>
      </div>`;
    this.alerts = new AlertsPanel(document.querySelector('#global-alerts')!, host, (path, method, input) => this.request(path, method, input));
    this.analysis = new AnalysisPanel(host, () => {
      const directory = this.directory, session = this.session;
      return (path, input) => this.request(path, 'POST', input, { directory, session });
    });
    this.button('pair-button', 'Pair backend', async current => {
      await this.request('/pair', 'POST', { path: this.input('descriptor').value });
      if (!current()) return;
      (document.querySelector('#pairing') as HTMLDetailsElement).open = false;
      this.reset();
    });
    this.button('view-button', 'View steps', () => this.host.openSurface('plugin:context-churn-monitor'));
    this.button('refresh', 'Refresh', () => this.reset(), false);
    this.button('previous', 'Previous', () => { this.offset = Math.max(0, this.offset - 50); this.reset(false); }, false);
    this.button('next', 'Next', () => { if (this.next !== null) { this.offset = this.next; this.reset(false); } }, false);
    for (const format of ['html', 'json']) this.button(`export-${format}`, `Export ${format.toUpperCase()}`, async current => {
      const result = await this.request('/export', 'POST', { format });
      if (current()) this.text('notice', `Saved ${result.path}`);
    });
    this.button('save-settings', 'Save settings', async current => {
      await this.request('/settings', 'POST', { span: Number(this.input('span').value), lookback: Number(this.input('lookback').value) });
      if (current()) this.reset();
    });
    this.input('warnings').onchange = () => void this.run(async current => { await this.request('/settings', 'POST', { warnings: this.input('warnings').checked }); if (current()) this.reset(); });
    this.input('details-toggle').onchange = () => { document.querySelector('#report')!.toggleAttribute('hidden', !this.input('details-toggle').checked); };
    for (const id of ['scope', 'activity-filter']) document.querySelector(`#${id}`)!.addEventListener('change', () => this.reset());
    this.input('activity-search').addEventListener('input', () => this.reset());
    document.querySelector('#expand-activities')!.addEventListener('click', () => {
      const rows = [...document.querySelectorAll<HTMLDetailsElement>('details[data-activity]')];
      const expand = rows.some(row => !row.open);
      rows.forEach(row => { row.open = expand; });
      this.text('expand-activities', expand ? 'Collapse all' : 'Expand all');
    });
    host.onReady(ctx => {
      applyHostReady(ctx, document.documentElement);
      this.compact = ctx.surface === 'status';
      document.body.classList.toggle('compact', this.compact);
      if (this.directory !== (ctx.directory ?? '') || this.session !== (ctx.session?.id ?? '')) this.clearContext();
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
    this.context++;
    this.snapshot = null; this.settings = undefined; this.next = null;
    this.analysis.reset();
    for (const id of ['rows', 'notice', 'error', 'action-error', 'page-label']) this.text(id, '');
    this.drawMetrics(null, []);
  }
  private text(id: string, value: string): void { document.querySelector(`#${id}`)!.textContent = value; }
  private button(id: string, label: string, action: (current: () => boolean) => unknown, feedback = true): void {
    mountButton(document.querySelector(`#${id}`)!, { label, variant: 'outline', size: 'sm', onClick: () => void this.run(action, feedback) });
  }
  private async run(action: (current: () => boolean) => unknown, feedback = true): Promise<void> {
    const context = this.context, generation = feedback ? ++this.action : this.action;
    const current = () => context === this.context && generation === this.action;
    try { await action(current); if (feedback && current()) this.text('action-error', ''); }
    catch (error) { if (current()) this.text('action-error', error instanceof Error ? error.message : String(error)); }
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
      if (!this.compact) await this.alerts.refresh();
      if (epoch !== this.epoch) return;
      if (!this.directory || !this.session) { this.text('quality', 'Select a monitored conversation to see its metrics.'); return; }
      const result = await this.request('/snapshot');
      if (epoch !== this.epoch) return;
      this.settings = result.settings; this.snapshot = result.state;
      this.drawMetrics(result.state, result.turns);
      this.input('warnings').checked = result.settings.warnings;
      if (document.activeElement?.tagName !== 'INPUT') {
        this.input('span').value = String(result.settings.span); this.input('lookback').value = String(result.settings.lookback);
      }
      if (!this.compact && this.revision !== (result.state?.revision ?? 0)) {
        const page = await this.request('/activities', 'GET', undefined, { limit: '50', offset: String(this.offset), scope: this.input('scope').value, kind: this.input('activity-filter').value, q: this.input('activity-search').value });
        if (epoch !== this.epoch) return;
        this.drawActivities(page.items, page.requests);
        this.next = page.next;
        this.text('page-label', page.items.length ? `Activities ${this.offset + 1}–${this.offset + page.items.length}` : 'No activities');
        (document.querySelector('#previous button') as HTMLButtonElement).disabled = this.offset === 0;
        (document.querySelector('#next button') as HTMLButtonElement).disabled = page.next === null;
        this.revision = result.state?.revision ?? 0;
      }
      this.text('error', '');
    } catch (error) { if (epoch === this.epoch) this.text('error', error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; this.timer = setTimeout(() => void this.refresh(), epoch === this.epoch ? 2000 : 0); }
  }

  private drawActivities(items: Activity[], requests: Record<string, Step[]>): void {
    const container = document.querySelector('#rows')!, scroll = container.scrollTop;
    const old = new Map([...container.querySelectorAll<HTMLDetailsElement>('details[data-activity]')].map(row => [row.dataset.activity!, { open: row.open, technical: row.querySelector<HTMLDetailsElement>('.technical')?.open, status: row.dataset.status, body: row.querySelector<HTMLElement>('.activity-body')! }]));
    container.innerHTML = replayRows(items, requests) || '<p class="muted">No recorded activities match this scope and filter.</p>';
    for (const row of container.querySelectorAll<HTMLDetailsElement>('details[data-activity]')) {
      const previous = old.get(row.dataset.activity!);
      if (previous && previous.status === row.dataset.status && ['completed', 'failed'].includes(previous.status!)) row.querySelector('.activity-body')!.replaceWith(previous.body);
      if (previous?.technical) row.querySelector<HTMLDetailsElement>('.technical')!.open = true;
      row.addEventListener('toggle', () => { if (row.open) void this.loadActivity(row); });
      if (previous?.open) row.open = true;
    }
    container.scrollTop = scroll;
  }

  /** Large bodies are fetched only for an expanded activity. Every response remains bound to the originating view and DOM node. */
  private async loadActivity(row: HTMLDetailsElement): Promise<void> {
    const target = row.querySelector<HTMLElement>('.activity-body')!;
    if (target.dataset.loaded || target.dataset.loading) return;
    target.dataset.loading = 'true';
    // Completed bodies survive refresh by moving their DOM node. Their handlers belong to the session, not the discarded polling epoch.
    const context = this.context, id = row.dataset.activity!, query = { directory: this.directory, session: this.session, id };
    const valid = () => context === this.context && target.isConnected;
    try {
      const details = await this.request('/activity', 'GET', undefined, query);
      if (!valid()) return;
      target.replaceChildren();
      for (const channel of details.channels as { channel: string; total: number }[]) {
        if (!channel.total) continue;
        const section = document.createElement(channel.channel === 'metadata' ? 'details' : 'section');
        const title = document.createElement(channel.channel === 'metadata' ? 'summary' : 'strong'); title.textContent = channel.channel[0].toUpperCase() + channel.channel.slice(1);
        const pre = document.createElement('pre'), more = document.createElement('button'); more.type = 'button'; more.textContent = 'Load more';
        section.append(title, pre, more); target.append(section);
        let offset = 0;
        const load = async () => {
          more.disabled = true;
          try {
            const page: BodyPage = await this.request('/activity', 'GET', undefined, { ...query, channel: channel.channel, offset: String(offset), limit: '16000' });
            if (!valid()) return;
            pre.textContent += page.text;
            more.hidden = page.next === null;
            offset = page.next ?? page.total;
            more.textContent = `Load more (${offset.toLocaleString()} / ${page.total.toLocaleString()} characters)`;
          } catch (error) { if (valid()) more.textContent = `Retry loading: ${String(error)}`; }
          finally { more.disabled = false; }
        };
        more.addEventListener('click', () => void load());
        await load();
        if (!valid()) return;
      }
      if (!target.children.length) target.textContent = 'No visible text was supplied by the host.';
      target.dataset.loaded = 'true';
    } catch (error) { if (valid()) target.textContent = String(error); }
    finally { delete target.dataset.loading; }
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
