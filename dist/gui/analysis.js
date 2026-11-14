import { mountButton } from '@openchamber/sdk/ui';
/** The requester is frozen with the preview's project/session, so switching views during a provider call cannot complete another job. */
export class AnalysisPanel {
    host;
    capture;
    job;
    request;
    epoch = 0;
    running = false;
    runButton;
    constructor(host, capture) {
        this.host = host;
        this.capture = capture;
        document.querySelector('#analysis').innerHTML = `<h2>Analyze this activity</h2><div class="toolbar"><label>Analysis model<select id="analysis-mode"><option value="small" selected>OpenChamber Small Model</option><option value="configured">Configured smaller model</option><option value="session">Session model</option></select></label><div id="analysis-prepare"></div></div><div id="analysis-preview" class="muted">Prepare a preview of the frozen evidence and request limits.</div><details><summary>Frozen evidence sent to the model</summary><pre id="analysis-evidence" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto"></pre></details><div id="analysis-run" class="buttons"></div><p class="muted">Clicking Run authorizes this prepared analysis. Monitoring, exports and preparation do not invoke a model.</p><pre id="analysis-result" role="status"></pre>`;
        mountButton(document.querySelector('#analysis-prepare'), { label: 'Prepare analysis', variant: 'outline', size: 'sm', onClick: () => void this.prepare() });
        this.runButton = mountButton(document.querySelector('#analysis-run'), { label: 'Run analysis (1 model invocation)', variant: 'outline', size: 'sm', disabled: true, onClick: () => void this.run() });
        document.querySelector('#analysis-mode').addEventListener('change', () => this.reset());
    }
    text(id, text) { document.querySelector(`#${id}`).textContent = text; }
    update() { this.runButton.update({ disabled: this.running || !this.job || this.job.status !== 'prepared' }); }
    reset() {
        this.epoch++;
        this.job = undefined;
        this.request = undefined;
        for (const id of ['analysis-preview', 'analysis-result', 'analysis-evidence'])
            this.text(id, '');
        this.update();
    }
    async prepare() {
        this.reset();
        const epoch = this.epoch, request = this.capture();
        try {
            const mode = document.querySelector('#analysis-mode').value;
            if (!mode)
                throw new Error('Choose a model before preparing evidence');
            const job = await request('/analysis/prepare', { mode });
            if (epoch !== this.epoch)
                return;
            this.job = job;
            this.request = request;
            this.text('analysis-preview', `Frozen turns ${job.firstTurn}–${job.lastTurn} · revision ${job.revision} · ${job.model.id}. Input allowance ${job.inputBudget} (conservative UTF-8 byte bound including envelope reserve); output cap ${job.outputBudget} tokens.${job.omitted ? ' Some evidence was omitted to fit the allowance.' : ''}${job.model.route === 'openchamber' ? ' Consent permits one host generation invocation. The host selects its Small Model/fallback; exact model, capacity and internal provider retries are unavailable to this extension.' : ''}`);
            this.text('analysis-evidence', job.prompt);
        }
        catch (error) {
            if (epoch === this.epoch)
                this.text('analysis-result', String(error));
        }
        this.update();
    }
    async run() {
        if (!this.job || !this.request || this.running || this.job.status !== 'prepared')
            return;
        const job = this.job, request = this.request, epoch = this.epoch;
        this.running = true;
        job.status = 'consumed';
        this.update();
        this.text('analysis-result', 'One analysis invocation authorized. Waiting for the result…');
        try {
            const input = { id: job.id, digest: job.digest, consent: true };
            let outcome;
            if (job.model.route === 'openchamber') {
                const claimed = await request('/analysis/claim', input);
                let result, error;
                try {
                    result = (await this.host.generate({ prompt: claimed.prompt, maxOutputTokens: claimed.outputBudget })).text;
                }
                catch (failure) {
                    error = String(failure);
                }
                outcome = await request('/analysis/result', { id: job.id, receipt: claimed.receipt, result, error });
            }
            else {
                outcome = await request('/analysis/run', input);
                // Poll status, never the provider. A frame closing or a transport failure leaves consumed consent durable and cannot auto-retry generation.
                for (let tries = 0; outcome.status === 'consumed' && tries < 60; tries++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    outcome = await request('/analysis/read', { id: job.id });
                }
            }
            if (epoch === this.epoch) {
                this.job = outcome;
                this.text('analysis-result', outcome.status === 'complete' ? outcome.result : `Outcome uncertain: ${outcome.error ?? 'the request is still running or its result was not received'}. Prepare a new preview and give fresh consent before another request.`);
            }
        }
        catch (error) {
            if (epoch === this.epoch)
                this.text('analysis-result', `Outcome uncertain: ${String(error)}. No automatic retry; fresh consent is required.`);
        }
        finally {
            this.running = false;
            this.update();
        }
    }
}
