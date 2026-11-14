import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { parseManifestJson } from '@openchamber/sdk/schemas';

const source = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

/** OpenChamber never builds a Git installation: materialize the index, not the developer's ignored build outputs. */
class GitInstallation {
  readonly root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'context-monitor-git-install-'));

  constructor() {
    execFileSync('git', ['checkout-index', '--all', `--prefix=${this.root.replaceAll('\\', '/')}/`], { cwd: source, timeout: 30000 });
    assert.equal(existsSync(join(this.root, 'node_modules')), false, 'The Git installation must not inherit development dependencies');
  }

  check(unit: string) {
    const root = join(this.root, unit);
    const parsed = parseManifestJson(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    // Resolve test tooling outside the fixture; none of it is installed into the extension itself.
    const sdk = dirname(dirname(require.resolve('@openchamber/sdk')));
    const checked = spawnSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, join(sdk, 'scripts/check-guest.ts'), root], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    const entry = parsed.manifest.contributes.panel?.entry;
    assert.ok(entry, 'The installation must expose the monitoring panel');
    const html = readFileSync(resolve(root, entry), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)>/g)];
    assert.ok(scripts.length, 'The panel must load its compiled script');
    for (const [, attributes, relative] of scripts) {
      assert.doesNotMatch(attributes, /\btype=["']module["']/i, 'Sandboxed panels need classic scripts, not ES modules');
      const script = readFileSync(resolve(root, dirname(entry), relative), 'utf8');
      assert.ok(script.trim().length, 'The shipped panel bundle must not be empty');
      new Script(script, { filename: relative });
    }
    const service = parsed.manifest.contributes.service?.entry;
    assert.ok(service, 'The installation must ship its local service');
    const syntax = spawnSync(process.execPath, ['--check', resolve(root, service)], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
  }
}

let installation: GitInstallation;
before(() => { installation = new GitInstallation(); });

test('the repository root installs with a prebuilt classic panel and local service', () => {
  installation.check('');
});

test('the legacy UI-only Git subfolder retains a self-contained panel and service', () => {
  installation.check('openchamber');
});

test('the Git installation loads the backend without dependencies and ships its worker, hooks and skill', () => {
  for (const path of ['dist/reports/export-worker.js', 'dist/cli.js', 'hooks/hooks.json', 'skills/context-churn-diagnostics/SKILL.md']) {
    assert.ok(existsSync(join(installation.root, path)), `Missing Git installation resource: ${path}`);
  }
  const entry = pathToFileURL(join(installation.root, 'dist/adapters/opencode/index.js')).href;
  const core = pathToFileURL(join(installation.root, 'dist/core/monitor.js')).href;
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; const plugin = await import(${JSON.stringify(entry)}); const core = await import(${JSON.stringify(core)}); assert.equal(plugin.default.id, 'context-churn-monitor'); assert.equal(typeof plugin.default.setup, 'function'); assert.equal(typeof core.Monitor, 'function');`], { cwd: installation.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});
