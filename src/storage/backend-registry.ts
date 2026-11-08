import { isAbsolute, resolve } from 'node:path';
import type { Database } from './store.js';

/** Match existing manual-pairing identities without changing the backend's on-disk descriptor name. */
export function projectKey(directory: string): string {
  const path = resolve(directory);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/** Descriptor paths only: shares the already-open global database, with no listener, process or extra connection. */
export class BackendRegistry {
  static readonly candidateLimit = 8;
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS backend_descriptors (path_key TEXT PRIMARY KEY,directory TEXT NOT NULL,path TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS backend_descriptors_project ON backend_descriptors(directory,path_key);`);
  }
  register(directory: string, descriptorPath: string): void {
    if (!isAbsolute(directory) || !isAbsolute(descriptorPath)) throw new Error('Backend registration requires absolute project and descriptor paths');
    this.db.prepare('INSERT INTO backend_descriptors VALUES(?,?,?) ON CONFLICT(path_key) DO UPDATE SET directory=excluded.directory,path=excluded.path').run(projectKey(descriptorPath), projectKey(directory), resolve(descriptorPath));
  }
  publish(directory: string, descriptorPath: string, write: () => void, restore: () => void): void {
    // Serialize registered publishers, but never hold this lock during an asynchronous health probe.
    this.db.exec('BEGIN IMMEDIATE');
    try { write(); this.register(directory, descriptorPath); this.db.exec('COMMIT'); }
    catch (error) {
      try { restore(); } finally { this.db.exec('ROLLBACK'); }
      throw error;
    }
  }
  paths(directory: string): string[] {
    // One extra row detects overflow without materializing an unbounded project inventory.
    return this.db.prepare('SELECT path FROM backend_descriptors WHERE directory=? ORDER BY path_key LIMIT ?').all(projectKey(directory), BackendRegistry.candidateLimit + 1).map(row => row.path);
  }
}
export type BackendRegistration = Pick<BackendRegistry, 'register'> & Partial<Pick<BackendRegistry, 'publish'>>;
