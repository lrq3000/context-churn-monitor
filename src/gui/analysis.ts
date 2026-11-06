import type { HostClient } from '@openchamber/sdk';
import { mountButton, type ButtonHandle } from '@openchamber/sdk/ui';
import type { AnalysisJob } from '../analysis/analysis.js';

export type AnalysisRequest = (path: string, input: unknown) => Promise<any>;

/** The requester is frozen with the preview's project/session, so switching views during a provider call cannot complete another job. */
export class AnalysisPanel {
  private job?: AnalysisJob;
  private request?: AnalysisRequest;
  private epoch = 0;
  private running = false;
  private runButton: ButtonHandle;

  constructor(private host: HostClient, private capture: () => AnalysisRequest) {
    document.querySelector('#analysis')!.innerHTML = `<h2>Optional model analysis</h2><p class="muted">Monitoring and exports never use a model. Analysis uses frozen evidence only after consent; the preview states the selected route and its request limits.</p><div class="toolbar"><label>Analysis model<select id="analysis-mode"><option value="">Choose each time…</option><option value="configured">Configured smaller model</option><option value="session">Session model</option><option value="small">OpenChamber Small Model</option></select></label><div id="analysis-prepare"></div></div><div id="analysis-preview" class="muted"></div><details><summary>Frozen evidence sent to the model</summary><pre id="analysis-evidence" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto"></pre></details><label><input id="analysis-consent" type="checkbox"> I authorize one model request</label><div id="analysis-run" class="buttons"></div><pre id="analysis-result" role="status"></pre>`;
    mountButton(document.querySelector('#analysis-prepare')!, { label: 'Prepare analysis', variant: 'outline', size: 'sm', onClick: () => void this.prepare() });
    this.runButton = mountButton(document.querySelector('#analysis-run')!, { label: 'Run analysis', variant: 'outline', size: 'sm', disabled: true, onClick: () => void this.run() });
    this.consent.onchange = () => this.update();
    document.querySelector('#analysis-mode')!.addEventListener('change', () => this.reset());
  }

  private get consent(): HTMLInputElement { return document.querySelector('#analysis-consent')!; }
  private text(id: string, text: string): void { document.querySelector(`#${id}`)!.textContent = text; }
  private update(): void { this.runButton.update({ disabled: this.running || !this.job || this.job.status !== 'prepared' || !this.consent.checked }); }
  reset(): void {
    this.epoch++; this.job = undefined; this.request = undefined; this.consent.checked = false;
    for (const id of ['analysis-preview', 'analysis-result', 'analysis-evidence']) this.text(id, '');
    this.update();
  }

  private async prepare(): Promise<void> {
    this.reset();
    const epoch = this.epoch, request = this.capture();
    try {
      const mode = (document.querySelector('#analysis-mode') as HTMLSelectElement).value;
      if (!mode) throw new Error('Choose a model before preparing evidence');
      const job: AnalysisJob = await request('/analysis/prepare', { mode });
      if (epoch !== this.epoch) return;
      this.job = job; this.request = request;
      this.text('analysis-preview', `Frozen turns ${job.firstTurn}–${job.lastTurn} · revision ${job.revision} · ${job.model.id}. Input allowance ${job.inputBudget} (conservative UTF-8 byte bound including envelope reserve); output cap ${job.outputBudget} tokens.${job.omitted ? ' Some evidence was omitted to fit the allowance.' : ''}${job.model.route === 'openchamber' ? ' Consent permits one host generation invocation. The host selects its Small Model/fallback; exact model, capacity and internal provider retries are unavailable to this extension.' : ''}`);
      this.text('analysis-evidence', job.prompt);
    } catch (error) { if (epoch === this.epoch) this.text('analysis-result', String(error)); }
    this.update();
  }

  private async run(): Promise<void> {
    if (!this.job || !this.request || !this.consent.checked || this.running || this.job.status !== 'prepared') return;
    const job = this.job, request = this.request, epoch = this.epoch;
    this.running = true; job.status = 'consumed'; this.consent.checked = false; this.update();
    this.text('analysis-result', 'One request authorized. Waiting for the result…');
    try {
      const input = { id: job.id, digest: job.digest, consent: true };
      let outcome: AnalysisJob;
      if (job.model.route === 'openchamber') {
        const claimed: AnalysisJob = await request('/analysis/claim', input);
        let result: string | undefined, error: string | undefined;
        try { result = (await this.host.generate({ prompt: claimed.prompt, maxOutputTokens: claimed.outputBudget })).text; }
        catch (failure) { error = String(failure); }
        outcome = await request('/analysis/result', { id: job.id, receipt: claimed.receipt, result, error });
      } else {
        outcome = await request('/analysis/run', input);
        // Poll status, never the provider. A frame closing or a transport failure leaves consumed consent durable and cannot auto-retry generation.
        for (let tries = 0; outcome.status === 'consumed' && tries < 60; tries++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          outcome = await request('/analysis/read', { id: job.id });
        }
      }
      if (epoch === this.epoch) {
        this.job = outcome;
        this.text('analysis-result', outcome.status === 'complete' ? outcome.result! : `Outcome uncertain: ${outcome.error ?? 'the request is still running or its result was not received'}. Prepare a new preview and give fresh consent before another request.`);
      }
    } catch (error) { if (epoch === this.epoch) this.text('analysis-result', `Outcome uncertain: ${String(error)}. No automatic retry; fresh consent is required.`); }
    finally { this.running = false; this.update(); }
  }
}
