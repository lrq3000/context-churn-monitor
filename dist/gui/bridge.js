import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { BackendRegistry, projectKey } from '../storage/backend-registry.js';
import { DescriptorFiles } from '../reports/descriptor.js';
/** Credentials stay in the approved local service, never in the iframe, extension storage, or monitored conversation. */
export class Bridge {
    path;
    registry;
    pairs = Object.create(null);
    constructor(path, registry) {
        this.path = path;
        this.registry = registry;
        const saved = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
        for (const [directory, pairing] of Object.entries(saved)) {
            const key = this.projectKey(directory);
            // Prefer an explicitly selected path when old slash/case aliases collapse to one project.
            if (!this.pairs[key]?.descriptorPath || pairing.descriptorPath)
                this.pairs[key] = pairing;
        }
    }
    async pair(directory, path) {
        const d = this.readDescriptor(directory, path);
        await this.verify(d, directory);
        this.pairs[this.projectKey(directory)] = { ...d, descriptorPath: path };
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        writeFileSync(this.path, JSON.stringify(this.pairs), { mode: 0o600 });
    }
    projectKey(directory) {
        return projectKey(directory);
    }
    readDescriptor(directory, path) {
        if (typeof path !== 'string' || !isAbsolute(path))
            throw new Error('Choose an absolute backend descriptor path');
        let value;
        try {
            const bytes = DescriptorFiles.bytes(path);
            if (!bytes)
                throw new Error('Descriptor is unavailable');
            value = JSON.parse(bytes.toString('utf8'));
        }
        catch {
            throw new Error('Backend descriptor is unavailable, malformed or exceeds 16 KiB. Start the backend and check the selected descriptor path.');
        }
        return this.validate(value, directory);
    }
    validate(value, directory) {
        return DescriptorFiles.validate(value, directory);
    }
    async verify(d, directory) {
        const result = await this.call(d, '/health', 'GET', undefined, 2500);
        if (!result || result.instance !== d.instance || typeof result.directory !== 'string' || this.projectKey(result.directory) !== this.projectKey(directory))
            throw new Error('Backend identity mismatch');
    }
    async request(directory, path, method, data) {
        const pairing = this.pairs[this.projectKey(directory)];
        if (!pairing) {
            if (!this.registry)
                throw new Error('Pair this project with its backend descriptor first');
            return this.call(await this.discover(directory), path, method, data);
        }
        let descriptor;
        try {
            // Reread only the approved path. Never fall back to stale credentials or scan other listeners.
            descriptor = pairing.descriptorPath !== undefined ? this.readDescriptor(directory, pairing.descriptorPath) : this.validate(pairing, directory);
            await this.verify(descriptor, directory);
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : 'Backend validation failed';
            throw new Error(pairing.descriptorPath !== undefined ? detail : `${detail} Legacy pairing: pair this project again with its current backend descriptor.`, { cause: error });
        }
        return this.call(descriptor, path, method, data);
    }
    async discover(directory) {
        const paths = this.registry.paths(directory);
        if (paths.length > BackendRegistry.candidateLimit)
            throw new Error('Too many registered backends for this project. Select a manual backend descriptor.');
        // Bound both lookup and concurrent validation. Never search ports, project trees or another project's credentials.
        const candidates = await Promise.all(paths.map(async (path) => {
            try {
                const descriptor = this.readDescriptor(directory, path);
                await this.verify(descriptor, directory);
                return descriptor;
            }
            catch {
                return undefined;
            }
        }));
        const healthy = candidates.filter((descriptor) => descriptor !== undefined);
        if (healthy.length > 1)
            throw new Error('Multiple healthy backends are registered for this project. Select a manual backend descriptor.');
        if (!healthy.length)
            throw new Error('No healthy registered backend is available for this project. Start or reload its Context Churn Monitor backend, or select a manual descriptor.');
        return healthy[0];
    }
    async call(d, path, method, data, timeout = 18000) {
        const url = new URL(path, d.url);
        if (!path.startsWith('/') || url.origin !== d.url || !['GET', 'POST'].includes(method))
            throw new Error('Invalid backend route');
        const body = data === undefined ? undefined : JSON.stringify(data);
        let response, result;
        try {
            response = await fetch(url, { method, headers: { Authorization: `Bearer ${d.token}`, 'X-Context-Monitor-Instance': d.instance, 'Content-Type': 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(timeout) });
            result = await response.json();
        }
        catch (error) {
            // The listener may have restarted after health validation. A later poll can recover; a POST cannot be replayed safely.
            throw new Error(method === 'POST' ? 'Backend connection lost; outcome unknown. Request was not retried. Check the result before preparing a new action.' : 'Backend unavailable. Start the backend; monitoring will reconnect through the selected descriptor on its next poll.', { cause: error });
        }
        if (!response.ok)
            throw new Error(result.error ?? 'Backend request failed');
        return result;
    }
}
