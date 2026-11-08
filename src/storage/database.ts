import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database } from './store.js';

/** Both supported hosts expose the same synchronous SQLite subset; keep driver selection in one place. */
export async function openDatabase(path: string, readOnly = false): Promise<Database> {
  if (path !== ':memory:' && !readOnly) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const name = typeof (globalThis as any).Bun === 'object' ? 'bun:sqlite' : 'node:sqlite';
  const sqlite = await import(name);
  return (name === 'bun:sqlite' ? new sqlite.Database(path, readOnly ? { readonly: true } : { create: true }) : new sqlite.DatabaseSync(path, { readOnly })) as Database;
}
