import { openSync, fstatSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import type { Descriptor } from './backend.js';
import { projectKey, type BackendRegistration } from '../storage/backend-registry.js';

/** Shared bounded descriptor IO/validation for GUI reads and collision-safe backend publication. */
export class DescriptorFiles {
  static bytes(path: string): Buffer | undefined {
    let fd: number;
    try { fd = openSync(path, 'r'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    try {
      if (!fstatSync(fd).isFile()) throw new Error('Not a descriptor file');
      const buffer = Buffer.alloc(16385);
      let size = 0, count: number;
      while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
      if (size > 16384) throw new Error('Backend descriptor exceeds 16 KiB');
      return buffer.subarray(0, size);
    } finally { closeSync(fd); }
  }
  static validate(value: unknown, directory: string): Descriptor {
    const d = value as Descriptor | null;
    if (!d || d.version !== 1 || typeof d.url !== 'string' || typeof d.token !== 'string' || d.token.length < 32 || typeof d.instance !== 'string' || !d.instance || typeof d.directory !== 'string' || !isAbsolute(d.directory)) throw new Error('Invalid backend descriptor');
    const url = new URL(d.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Backend must be an explicit loopback origin');
    if (projectKey(directory) !== projectKey(d.directory)) throw new Error('Backend directory does not match this project');
    return { version: 1, url: url.origin, token: d.token, instance: d.instance, directory: d.directory };
  }
  static async publish(directory: string, selectedPath: string, descriptor: Descriptor, registry?: BackendRegistration): Promise<void> {
    // Keep the original cwd-relative data-root semantics, without changing project hashes or descriptor names.
    const path = resolve(selectedPath), previous = this.bytes(path);
    if (previous) await this.checkRetired(this.validate(JSON.parse(previous.toString('utf8')), directory));
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const next = Buffer.from(JSON.stringify(descriptor));
    const write = () => {
      const current = this.bytes(path);
      if (previous ? !current?.equals(previous) : current !== undefined) throw new Error('Backend descriptor ownership changed during publication; retry initialization with a separate data directory if another backend is active.');
      writeFileSync(path, next, { mode: 0o600 });
    };
    const restore = () => {
      // Do not overwrite an external writer. Restore the exact previous bytes only while our complete publication still owns the file.
      if (previous && this.bytes(path)?.equals(next)) writeFileSync(path, previous, { mode: 0o600 });
    };
    if (registry?.publish) registry.publish(directory, path, write, restore);
    else {
      try { write(); registry?.register(directory, path); }
      catch (error) { restore(); throw error; }
    }
  }
  private static async checkRetired(previous: Descriptor): Promise<void> {
    let health: { status: number; instance?: string; directory?: string };
    try {
      health = await this.health(previous);
    } catch (error) {
      const codes = [(error as any)?.code, (error as any)?.cause?.code];
      if (codes.some(code => code === 'ECONNREFUSED' || code === 'ConnectionRefused')) return;
      throw new Error('Cannot establish that the existing backend descriptor is retired; publication was not changed.', { cause: error });
    }
    if (health.status === 401 || health.status === 409) return;
    // A reused port can return an unrelated JSON error (for example HTTP 503). Only a matching instance/directory proves ownership; malformed or stalled replies still fail closed.
    if (health.instance === previous.instance && typeof health.directory === 'string' && projectKey(health.directory) === projectKey(previous.directory)) throw new Error('Backend descriptor is already owned by an active backend. Use a separate data directory for another host instance.');
  }
  private static health(previous: Descriptor): Promise<{ status: number; instance?: string; directory?: string }> {
    return new Promise((resolve, reject) => {
      let completed = false;
      const finish = (error?: Error, value?: { status: number; instance?: string; directory?: string }) => {
        if (completed) return;
        completed = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value!);
      };
      // A fresh socket avoids a retired fetch-pool connection racing restart/old-port reuse. There is no retry, redirect or persistent agent.
      const request = httpRequest(previous.url + '/health', { agent: false, headers: { Authorization: `Bearer ${previous.token}`, 'X-Context-Monitor-Instance': previous.instance } }, response => {
        const status = response.statusCode ?? 0;
        response.once('error', error => finish(error));
        if (status === 401 || status === 409) { finish(undefined, { status }); response.destroy(); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', part => {
          const chunk = Buffer.from(part); size += chunk.length;
          if (size > 16384) request.destroy(new Error('Backend ownership response exceeds 16 KiB'));
          else chunks.push(chunk);
        });
        response.once('end', () => {
          try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); finish(undefined, { status, instance: value?.instance, directory: value?.directory }); }
          catch (error) { finish(error as Error); }
        });
      });
      const timer = setTimeout(() => request.destroy(new Error('Backend ownership check timed out')), 2500);
      request.once('error', error => finish(error)); request.end();
    });
  }
}
