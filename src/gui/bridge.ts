import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Descriptor } from '../reports/backend.js';

/** Credentials stay in the approved local service, never in the iframe, extension storage, or monitored conversation. */
export class Bridge {
  private pairs: Record<string, Descriptor>;
  constructor(private path: string) { this.pairs = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; }

  async pair(directory: string, path: string): Promise<void> {
    if (!isAbsolute(path) || statSync(path).size > 16384) throw new Error('Choose an absolute backend descriptor path under 16 KiB');
    const d = JSON.parse(readFileSync(path, 'utf8')) as Descriptor;
    const url = new URL(d.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Backend must be an explicit loopback origin');
    if (d.version !== 1 || typeof d.token !== 'string' || d.token.length < 32 || typeof d.instance !== 'string') throw new Error('Invalid backend descriptor');
    if (resolve(directory) !== resolve(d.directory)) throw new Error('Backend directory does not match this project');
    const result = await this.call(d, '/health', 'GET');
    if (result.instance !== d.instance || resolve(result.directory) !== resolve(directory)) throw new Error('Backend identity mismatch');
    this.pairs[directory] = d;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(this.pairs), { mode: 0o600 });
  }

  async request(directory: string, path: string, method: string, data?: unknown): Promise<any> {
    const descriptor = this.pairs[directory];
    if (!descriptor) throw new Error('Pair this project with its backend descriptor first');
    return this.call(descriptor, path, method, data);
  }

  private async call(d: Descriptor, path: string, method: string, data?: unknown): Promise<any> {
    const url = new URL(path, d.url);
    if (!path.startsWith('/') || url.origin !== d.url || !['GET', 'POST'].includes(method)) throw new Error('Invalid backend route');
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${d.token}`, 'X-Context-Monitor-Instance': d.instance, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error', signal: AbortSignal.timeout(18000) });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(result.error ?? 'Backend request failed');
    return result;
  }
}
