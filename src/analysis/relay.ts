import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

/** A per-job transport fuse, not a retry policy: consume before forwarding, including when the provider's outcome is unknown. Native generation may retry locally but cannot spend a second provider request. */
export class OneShotRelay {
  private used = false;
  private token = randomBytes(24).toString('hex');
  private server: Server;
  url = '';

  constructor(private upstream: string) {
    const target = new URL(upstream);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('Analysis requires an explicit HTTP(S) provider baseURL without credentials or query');
    this.server = createServer(async (req, res) => {
      const prefix = `/${this.token}/`;
      if (req.method !== 'POST' || !req.url?.startsWith(prefix)) { res.writeHead(403); res.end(); return; }
      if (this.used) { res.writeHead(409, { 'x-should-retry': 'false' }); res.end('Analysis consent already spent'); return; }
      this.used = true;
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 1000000) throw new Error('Analysis request too large'); chunks.push(Buffer.from(chunk)); }
        // Construct a path beneath the configured origin. A redirect is an additional request and is deliberately not followed.
        const suffix = req.url.slice(prefix.length);
        if (!/^(chat\/completions|responses|messages)$/.test(suffix)) throw new Error('Unsupported analysis endpoint');
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value && !['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const response = await fetch(`${this.upstream.replace(/\/$/, '')}/${suffix}`, { method: 'POST', headers, body: Buffer.concat(chunks), redirect: 'error', signal: AbortSignal.timeout(60000) });
        res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'x-should-retry': 'false' });
        if (response.body) for await (const chunk of response.body) { if (!res.write(chunk)) await once(res, 'drain'); }
        res.end();
      } catch {
        // Do not return provider credentials, request contents or URLs in an error. The consumed durable job records uncertainty.
        if (!res.headersSent) res.writeHead(502, { 'x-should-retry': 'false' });
        res.end('Single provider attempt failed; fresh consent required');
      }
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}/${this.token}`;
    return this;
  }
  async close(): Promise<void> { await new Promise<void>(resolve => this.server.close(() => resolve())); }
}
