import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Descriptor } from '../reports/backend.js';

type Pairing = Descriptor & { descriptorPath?: string };

/** Credentials stay in the approved local service, never in the iframe, extension storage, or monitored conversation. */
export class Bridge {
  private pairs: Record<string, Pairing> = Object.create(null);
  constructor(private path: string) {
    const saved: Record<string, Pairing> = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    for (const [directory, pairing] of Object.entries(saved)) {
      const key = this.projectKey(directory);
      // Prefer an explicitly selected path when old slash/case aliases collapse to one project.
      if (!this.pairs[key]?.descriptorPath || pairing.descriptorPath) this.pairs[key] = pairing;
    }
  }

  async pair(directory: string, path: string): Promise<void> {
    const d = this.readDescriptor(directory, path);
    await this.verify(d, directory);
    this.pairs[this.projectKey(directory)] = { ...d, descriptorPath: path };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(this.pairs), { mode: 0o600 });
  }

  private projectKey(directory: string): string {
    const path = resolve(directory);
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }

  private readDescriptor(directory: string, path: string): Descriptor {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Choose an absolute backend descriptor path');
    let value: unknown;
    try {
      const fd = openSync(path, 'r');
      try {
        if (!fstatSync(fd).isFile()) throw new Error('Not a file');
        // Bound the actual read, not just an earlier stat: the backend can replace this file during restart.
        const buffer = Buffer.alloc(16385);
        let size = 0, count: number;
        while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
        if (size > 16384) throw new Error('Too large');
        value = JSON.parse(buffer.subarray(0, size).toString('utf8'));
      } finally { closeSync(fd); }
    } catch { throw new Error('Backend descriptor is unavailable, malformed or exceeds 16 KiB. Start the backend and check the selected descriptor path.'); }
    return this.validate(value, directory);
  }

  private validate(value: unknown, directory: string): Descriptor {
    const d = value as Descriptor | null;
    if (!d || d.version !== 1 || typeof d.url !== 'string' || typeof d.token !== 'string' || d.token.length < 32 || typeof d.instance !== 'string' || !d.instance || typeof d.directory !== 'string' || !isAbsolute(d.directory)) throw new Error('Invalid backend descriptor');
    const url = new URL(d.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Backend must be an explicit loopback origin');
    if (this.projectKey(directory) !== this.projectKey(d.directory)) throw new Error('Backend directory does not match this project');
    return { version: 1, url: url.origin, token: d.token, instance: d.instance, directory: d.directory };
  }

  private async verify(d: Descriptor, directory: string): Promise<void> {
    const result = await this.call(d, '/health', 'GET', undefined, 2500);
    if (!result || result.instance !== d.instance || typeof result.directory !== 'string' || this.projectKey(result.directory) !== this.projectKey(directory)) throw new Error('Backend identity mismatch');
  }

  async request(directory: string, path: string, method: string, data?: unknown): Promise<any> {
    const pairing = this.pairs[this.projectKey(directory)];
    if (!pairing) throw new Error('Pair this project with its backend descriptor first');
    let descriptor: Descriptor;
    try {
      // Reread only the approved path. Never fall back to stale credentials or scan other listeners.
      descriptor = pairing.descriptorPath !== undefined ? this.readDescriptor(directory, pairing.descriptorPath) : this.validate(pairing, directory);
      await this.verify(descriptor, directory);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Backend validation failed';
      throw new Error(pairing.descriptorPath !== undefined ? detail : `${detail} Legacy pairing: pair this project again with its current backend descriptor.`, { cause: error });
    }
    return this.call(descriptor, path, method, data);
  }

  private async call(d: Descriptor, path: string, method: string, data?: unknown, timeout = 18000): Promise<any> {
    const url = new URL(path, d.url);
    if (!path.startsWith('/') || url.origin !== d.url || !['GET', 'POST'].includes(method)) throw new Error('Invalid backend route');
    const body = data === undefined ? undefined : JSON.stringify(data);
    let response: Response, result: any;
    try {
      response = await fetch(url, { method, headers: { Authorization: `Bearer ${d.token}`, 'X-Context-Monitor-Instance': d.instance, 'Content-Type': 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      result = await response.json();
    } catch (error) {
      // The listener may have restarted after health validation. A later poll can recover; a POST cannot be replayed safely.
      throw new Error(method === 'POST' ? 'Backend connection lost; outcome unknown. Request was not retried. Check the result before preparing a new action.' : 'Backend unavailable. Start the backend; monitoring will reconnect through the selected descriptor on its next poll.', { cause: error });
    }
    if (!response.ok) throw new Error(result.error ?? 'Backend request failed');
    return result;
  }
}
