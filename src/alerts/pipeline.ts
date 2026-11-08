import { existsSync } from 'node:fs';
import { AlertHistory, alertSource, type ThresholdEvent } from '../storage/alerts.js';
import { Store } from '../storage/store.js';

export class AlertPipeline {
  constructor(private history: AlertHistory, private source: Store, directory: string, private send?: (event: ThresholdEvent) => Promise<Partial<Pick<ThresholdEvent, 'title' | 'delivery'>>>) {
    history.registerSource(alertSource(source.path, directory));
  }
  /** Only fresh runtime processing calls this. Recovery itself never invokes the sender. */
  async publishPending(): Promise<void> {
    const ready = this.send ? this.source.unclaimedAlerts() : [];
    const pending = this.source.pendingAlerts();
    this.history.insert(pending); this.source.acknowledgeAlerts(pending.map(event => event.id));
    if (!this.send) return;
    for (const event of ready) {
      if (event.delivery !== 'recorded' || !this.source.claimAlertDelivery(event.id)) continue;
      // A previous send yields to other writers. Check current membership by primary key, not a pre-send snapshot of the list.
      if (!this.history.contains(event.id)) { this.source.updateAlert(event.id, { delivery: 'unavailable' }); this.source.acknowledgeAlerts([event.id]); continue; }
      this.history.update(event.id, { delivery: 'attempted' });
      let detail: Partial<Pick<ThresholdEvent, 'title' | 'delivery'>>;
      try { detail = await this.send(event); } catch { detail = { delivery: 'unconfirmed' }; }
      this.source.updateAlert(event.id, detail); this.history.update(event.id, detail); this.source.acknowledgeAlerts([event.id]);
    }
  }
  async reconcile(): Promise<{ recovered: number; limitations: string[]; omittedLimitations: number }> { return AlertPipeline.reconcile(this.history); }
  static async reconcile(history: AlertHistory): Promise<{ recovered: number; limitations: string[]; omittedLimitations: number }> {
    let after = '', recovered = 0, omittedLimitations = 0;
    const limitations: string[] = [];
    for (;;) {
      const sources = history.sources(after);
      if (!sources.length) break;
      for (const source of sources) {
        let store: Store | undefined;
        try {
          if (!existsSync(source.path)) throw new Error('Recorded backend store is unavailable');
          store = await Store.open(source.path);
          const pending = store.pendingAlerts();
          history.insert(pending); store.acknowledgeAlerts(pending.map(event => event.id)); recovered += pending.length;
        } catch {
          if (limitations.length < 20) limitations.push(`History recovery unavailable for ${source.directory.slice(0, 200)}.`); else omittedLimitations++;
        } finally { store?.close(); }
      }
      after = sources.at(-1)!.id;
    }
    return { recovered, limitations, omittedLimitations };
  }
}
