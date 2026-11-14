import { mountButton } from '@openchamber/sdk/ui';
import { escapeHtml } from '../reports/view.js';
const fields = [
    { key: 'liveGrowth', label: 'Current-turn growth threshold (pp)', min: 0.1, step: 0.1 },
    { key: 'liveCompactions', label: 'Current-turn compaction threshold', min: 1, step: 1 },
    { key: 'growthThreshold', label: 'Growth average threshold (pp/turn)', min: 0.1, step: 0.1 },
    { key: 'compactionThreshold', label: 'Compaction average threshold (per turn)', min: 0.01, step: 0.01 },
    { key: 'minContextWindow', label: 'Minimum model context window (tokens)', min: 0, step: 1000 },
];
const delivery = { recorded: 'Recorded', attempted: 'Delivery attempted', 'host-accepted': 'Host accepted', unconfirmed: 'Delivery unconfirmed', unavailable: 'Notification unavailable' };
/** Global state is independent of the current conversation. Polling cannot erase action errors, overwrite a draft or silently select a different history entry. */
export class AlertsPanel {
    container;
    host;
    request;
    items = [];
    selected = '';
    busy = false;
    queued = false;
    epoch = 0;
    action = 0;
    edits = 0;
    dirty = false;
    loaded = false;
    constructor(container, host, request) {
        this.container = container;
        this.host = host;
        this.request = request;
        container.innerHTML = `<style>
      .global-alert-box{margin:16px 0;padding:12px;background:var(--surface-muted,#f3f4f6);border-radius:6px;min-width:0}
      .global-alert-box h2{margin:0 0 6px}.alert-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}.alert-config-grid label{display:grid;gap:4px;font-size:.8rem}
      .alert-list{max-height:320px;overflow:auto;overscroll-behavior:contain}.alert-entry{padding:9px 4px;border-top:1px solid var(--border,#ddd);overflow-wrap:anywhere}.alert-entry label{display:flex;align-items:start;gap:8px;cursor:pointer}.alert-entry input{flex:none;margin-top:3px}.alert-entry .alert-copy{min-width:0;flex:1}.alert-entry strong,.alert-entry small{display:block}.alert-entry details{font-size:.76rem;margin:5px 0 0 24px}.alert-entry time{font-variant-numeric:tabular-nums}.alert-error{color:var(--error-text,#a43a3a);overflow-wrap:anywhere}
      </style><div class="global-alert-box"><details id="alert-settings"><summary>Notification settings — all projects</summary>
      <p class="muted">Existing growth and compaction alerts only. Averages and cooldowns include eligible turns, not small-model churn. Ordinary monitoring remains unchanged.</p>
      <div class="alert-config-grid">${fields.map(field => `<label>${field.label}<input data-alert-setting="${field.key}" type="number" min="${field.min}" step="${field.step}" disabled></label>`).join('')}</div>
      <p class="muted">The minimum is inclusive; 0 disables the window filter. Unknown or mixed small-model turns do not qualify while filtering is enabled. Changing the minimum resets alert-specific averages/recovery, not monitoring history.</p><div id="save-global-alert-settings"></div></details>
      <h2 style="margin-top:14px">Notification history — all projects</h2><p class="muted">Latest 100 eligible threshold events, retained across restarts. Host acceptance does not prove a notification was displayed or read.</p>
      <div id="alerts-load-error" class="alert-error" role="alert"></div><div id="alerts-error" class="alert-error" role="alert"></div><p id="alerts-feedback" class="muted" role="status"></p><p id="alerts-recovery" class="muted"></p>
      <div id="alert-list" class="alert-list" role="radiogroup" aria-label="Notification history"></div>
      <div class="buttons"><div id="go-alert-session"></div><div id="refresh-alerts"></div><small id="alert-count"></small></div></div>`;
        for (const input of container.querySelectorAll('[data-alert-setting]'))
            input.addEventListener('input', () => { this.dirty = true; this.edits++; });
        this.button('save-global-alert-settings', 'Save global alert settings', () => void this.save());
        this.container.querySelector('#save-global-alert-settings button').disabled = true;
        this.button('go-alert-session', 'Go to the session', () => void this.go());
        this.button('refresh-alerts', 'Refresh notifications', () => void this.refresh(true));
        this.goButton.disabled = true;
        container.querySelector('#alert-list').addEventListener('change', event => {
            const input = event.target;
            if (input.name !== 'alert-selection')
                return;
            this.selected = input.value;
            this.goButton.disabled = !this.items.some(item => item.id === this.selected);
        });
    }
    text(id, text) { this.container.querySelector(`#${id}`).textContent = text; }
    get goButton() { return this.container.querySelector('#go-alert-session button'); }
    button(id, label, onClick) { mountButton(this.container.querySelector(`#${id}`), { label, variant: 'outline', size: 'sm', onClick }); }
    values(settings) {
        for (const field of fields)
            this.container.querySelector(`[data-alert-setting="${field.key}"]`).value = String(settings[field.key]);
    }
    async refresh(force = false) {
        if (this.busy) {
            this.queued ||= force;
            return;
        }
        this.busy = true;
        const epoch = ++this.epoch;
        try {
            const [settings, history] = await Promise.all([this.request('/notification-settings'), this.request(`/notifications${force ? '?refresh=1' : ''}`)]);
            if (epoch !== this.epoch)
                return;
            if (!this.dirty || !this.loaded)
                this.values(settings);
            this.loaded = true;
            // Initial values must exist before accepting edits; a delayed first response must not erase a draft.
            for (const input of this.container.querySelectorAll('[data-alert-setting]'))
                input.disabled = false;
            this.container.querySelector('#save-global-alert-settings button').disabled = false;
            this.items = history.items.slice(0, 100);
            if (!this.items.some(item => item.id === this.selected))
                this.selected = '';
            this.draw();
            const limitations = history.limitations ?? [];
            this.text('alerts-recovery', [...limitations, history.omittedLimitations ? `${history.omittedLimitations} further recovery limitations.` : ''].filter(Boolean).join(' '));
            this.text('alerts-load-error', '');
        }
        catch (error) {
            if (epoch === this.epoch)
                this.text('alerts-load-error', String(error));
        }
        finally {
            this.busy = false;
            if (this.queued) {
                this.queued = false;
                void this.refresh(true);
            }
        }
    }
    draw() {
        this.container.querySelector('#alert-list').innerHTML = this.items.map(item => {
            const title = item.title || item.sessionId, project = item.directory.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || item.directory;
            const name = item.metric === 'growth' ? 'Growth' : 'Compactions';
            const units = item.metric === 'growth' ? item.kind === 'live' ? ' pp' : ' pp/turn' : item.kind === 'ema' ? '/turn' : '';
            return `<div class="alert-entry" data-alert="${escapeHtml(item.id)}"><label><input type="radio" name="alert-selection" value="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(title)}"${item.id === this.selected ? ' checked' : ''}><span class="alert-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(project)} · <time>${escapeHtml(new Date(item.at).toLocaleString())}</time></small><span>${name} (${item.kind === 'live' ? 'current turn' : 'average'}): ${item.value.toFixed(2)}${units} ≥ ${item.threshold.toFixed(2)}${units}</span><small>${delivery[item.delivery] ?? 'Unknown delivery'}</small></span></label><details><summary>Model and event details</summary>${escapeHtml(item.model || 'Unknown model')} · window ${item.capacity?.toLocaleString() ?? 'unknown'} tokens<br>${escapeHtml(item.directory)}<br>Session: ${escapeHtml(item.sessionId)}</details></div>`;
        }).join('') || '<p class="muted">No eligible threshold events recorded yet.</p>';
        this.goButton.disabled = !this.selected;
        this.text('alert-count', `${this.items.length} / 100 events`);
    }
    async save() {
        if (!this.loaded)
            return;
        const action = ++this.action, edits = this.edits;
        this.epoch++; // Ignore reads that began before this save.
        const input = Object.fromEntries(fields.map(field => [field.key, Number(this.container.querySelector(`[data-alert-setting="${field.key}"]`).value)]));
        try {
            const settings = await this.request('/notification-settings', 'POST', input);
            if (action !== this.action)
                return;
            if (edits === this.edits) {
                this.dirty = false;
                this.values(settings);
            }
            this.text('alerts-error', '');
            this.text('alerts-feedback', 'Saved global alert settings. Applies to subsequent monitoring updates across projects.');
            void this.refresh(true);
        }
        catch (error) {
            if (action === this.action)
                this.text('alerts-error', String(error));
        }
    }
    async go() {
        const item = this.items.find(item => item.id === this.selected);
        if (!item)
            return;
        const action = ++this.action, selected = item.id;
        try {
            await this.host.openSession(item.sessionId);
            if (action === this.action && selected === this.selected)
                this.text('alerts-error', '');
        }
        catch (error) {
            if (action === this.action)
                this.text('alerts-error', `Cannot open session ${item.sessionId}: ${String(error)}`);
        }
    }
}
