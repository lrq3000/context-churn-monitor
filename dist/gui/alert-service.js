import { AlertPipeline } from '../alerts/pipeline.js';
/** Global routes intentionally precede project/pairing validation. Share reconciliation across concurrent pollers rather than scanning once per frame. */
export class GlobalAlertService {
    history;
    lastRecovery = 0;
    running;
    recovery = { recovered: 0, limitations: [], omittedLimitations: 0 };
    constructor(history) {
        this.history = history;
    }
    async handle(url, method, input) {
        if (url.pathname === '/notification-settings') {
            if (method === 'GET')
                return this.history.settings();
            if (method === 'POST')
                return this.history.setSettings(input);
            throw new Error('Unsupported global settings method');
        }
        if (url.pathname !== '/notifications')
            return undefined;
        if (method !== 'GET')
            throw new Error('History is read-only');
        if (this.running || url.searchParams.get('refresh') === '1' || Date.now() - this.lastRecovery > 5000) {
            this.running ??= AlertPipeline.reconcile(this.history).then(result => { this.recovery = result; this.lastRecovery = Date.now(); return result; }).finally(() => { this.running = undefined; });
            await this.running;
        }
        return { items: this.history.list(), ...this.recovery };
    }
}
