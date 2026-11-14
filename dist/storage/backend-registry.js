import { isAbsolute, resolve } from 'node:path';
/** Match existing manual-pairing identities without changing the backend's on-disk descriptor name. */
export function projectKey(directory) {
    const path = resolve(directory);
    return process.platform === 'win32' ? path.toLowerCase() : path;
}
/** Descriptor paths only: shares the already-open global database, with no listener, process or extra connection. */
export class BackendRegistry {
    db;
    static candidateLimit = 8;
    constructor(db) {
        this.db = db;
        db.exec(`CREATE TABLE IF NOT EXISTS backend_descriptors (path_key TEXT PRIMARY KEY,directory TEXT NOT NULL,path TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS backend_descriptors_project ON backend_descriptors(directory,path_key);`);
    }
    register(directory, descriptorPath) {
        if (!isAbsolute(directory) || !isAbsolute(descriptorPath))
            throw new Error('Backend registration requires absolute project and descriptor paths');
        this.db.prepare('INSERT INTO backend_descriptors VALUES(?,?,?) ON CONFLICT(path_key) DO UPDATE SET directory=excluded.directory,path=excluded.path').run(projectKey(descriptorPath), projectKey(directory), resolve(descriptorPath));
    }
    publish(directory, descriptorPath, write, restore) {
        // Serialize registered publishers, but never hold this lock during an asynchronous health probe.
        this.db.exec('BEGIN IMMEDIATE');
        try {
            write();
            this.register(directory, descriptorPath);
            this.db.exec('COMMIT');
        }
        catch (error) {
            try {
                restore();
            }
            finally {
                this.db.exec('ROLLBACK');
            }
            throw error;
        }
    }
    paths(directory) {
        // One extra row detects overflow without materializing an unbounded project inventory.
        return this.db.prepare('SELECT path FROM backend_descriptors WHERE directory=? ORDER BY path_key LIMIT ?').all(projectKey(directory), BackendRegistry.candidateLimit + 1).map(row => row.path);
    }
}
