import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requestedGuestCapabilities } from '@openchamber/sdk';
import { parseManifestJson } from '@openchamber/sdk/schemas';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
let files: Set<string>;

/** Exercise npm's actual inclusion rules: a source checkout's .gitignore must not remove the built entrypoints from the public archive. */
before(() => {
  const build = spawnSync(process.execPath, [npmCli, 'run', 'build', '--silent'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const pack = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  files = new Set(JSON.parse(pack.stdout)[0].files.map((file: { path: string }) => file.path));
});

test('npm publication identifies the public package, author and Apache license', () => {
  assert.notEqual(manifest.private, true, 'npm must not refuse publication as a private development package');
  assert.equal(manifest.name, 'context-churn-monitor');
  assert.ok(manifest.description?.length);
  assert.deepEqual(manifest.author, { name: 'Stephen Karl Larroque', email: 'LRQ3000@gmail.com' });
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.version, '0.4.1');
  assert.equal(manifest.repository?.url, 'git+https://github.com/lrq3000/context-churn-monitor.git');
  assert.equal(manifest.repository?.directory, undefined, 'standalone repository installs from its root');
  assert.equal(manifest.homepage, 'https://github.com/lrq3000/context-churn-monitor#readme');
  assert.equal(manifest.bugs?.url, 'https://github.com/lrq3000/context-churn-monitor/issues');
  assert.equal(manifest.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.equal(manifest.publishConfig?.access, 'public');
});

test('npm archive contains loadable backend, hook, worker, skill and OpenChamber installation resources', () => {
  for (const path of [
    ...Object.values(manifest.exports).map(path => String(path).replace(/^\.\//, '')),
    'dist/cli.js', 'dist/reports/export-worker.js',
    'plugin.json', 'hooks/hooks.json', 'config.schema.json',
    'skills/context-churn-diagnostics/SKILL.md',
    'openchamber/package.json', 'openchamber/panel/index.html',
    'openchamber/panel/app.js', 'openchamber/service.cjs',
    'AUTHOR.txt', 'LICENSE.txt', 'README.md', 'HISTORY.md',
  ]) assert.ok(files.has(path), `Missing installed resource: ${path}`);
});

test('published Codex installation instructions link to a public marketplace guide', () => {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  const codex = readme.split('### Codex')[1]?.split('### OpenChamber')[0] ?? '';
  assert.match(codex, /https:\/\/developers\.openai\.com\/plugins\/build\/plugins/);
  assert.doesNotMatch(codex, /github\.com\/lrq3000\/lrq3000_agent_skills\/blob\/main\/INSTALL\.md/);
});

test('npm archive excludes development sources, dependencies and private runtime data', () => {
  assert.ok(Array.isArray(manifest.files), 'publication needs an explicit allowlist');
  for (const path of files) {
    assert.doesNotMatch(path, /^(?:src|tests|scripts|node_modules|test-results)\//, path);
    assert.doesNotMatch(path, /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|.*\.backend\.json|gui-pairings\.json)$|\.(?:sqlite(?:-wal|-shm)?|db|log|tgz|tsbuildinfo)$/, path);
  }
});

test('separate OpenChamber installation retains attribution and the release version matches every manifest', () => {
  for (const name of ['AUTHOR.txt', 'LICENSE.txt']) {
    assert.ok(files.has(`openchamber/${name}`), `Separate UI installation would lose ${name}`);
    assert.ok(readFileSync(resolve(root, 'openchamber', name), 'utf8').trimEnd().startsWith(readFileSync(resolve(root, name), 'utf8').trimEnd()), `Separate UI installation must retain the original ${name}`);
  }
  const portable = JSON.parse(readFileSync(resolve(root, 'plugin.json'), 'utf8'));
  const ui = JSON.parse(readFileSync(resolve(root, 'openchamber/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  for (const version of [manifest.metadata.version, portable.version, ui.version, ui.metadata.version, lock.version, lock.packages[''].version]) assert.equal(version, manifest.version);
  assert.equal(lock.packages[''].license, 'Apache-2.0');
});

test('separate OpenChamber installation preserves the MIT notice for its bundled SDK code', () => {
  const license = readFileSync(resolve(root, 'openchamber/LICENSE.txt'), 'utf8');
  const sdkLicense = readFileSync(resolve(root, 'node_modules/@openchamber/sdk/LICENSE'), 'utf8').trim();
  assert.ok(license.includes(sdkLicense), 'Bundled SDK redistribution must include its full copyright and MIT permission notice');
});

test('the npm root is a native OpenChamber extension contributing its backend and optional diagnostic skill', () => {
  assert.ok(manifest.openchamber, 'Install the npm root once instead of registering the UI and backend separately');
  const parsed = parseManifestJson(JSON.stringify(manifest));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.version, manifest.version);
  const contributes = parsed.manifest.contributes;
  assert.equal(contributes.opencodePlugin, 'dist/adapters/opencode');
  assert.equal(contributes.skills, 'skills');
  assert.equal(parsed.manifest.engines?.openchamber, '>=2.7.0');
  for (const path of [contributes.panel.entry, contributes.statusSection.entry, contributes.service.entry, `${contributes.opencodePlugin}/index.js`, `${contributes.skills}/context-churn-diagnostics/SKILL.md`]) assert.ok(files.has(path), `Missing native extension resource: ${path}`);
  const capabilities = requestedGuestCapabilities(contributes);
  for (const capability of ['service', 'model', 'sessions', 'skills', 'opencodePlugin']) assert.ok(capabilities.includes(capability), `Host approval must cover ${capability}`);
});

test('published OpenCode entrypoints load from an extracted archive without node_modules or OpenChamber', () => {
  // Copy only what npm actually distributes into a temporary package with no ancestor node_modules. A hidden SDK runtime import must fail here rather than on a user's machine.
  const standalone = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'context-monitor-standalone-'));
  for (const path of files) {
    const target = resolve(standalone, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolve(root, path), target);
  }
  const entry = pathToFileURL(resolve(standalone, manifest.exports['.'])).href;
  const core = pathToFileURL(resolve(standalone, manifest.exports['./core'])).href;
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; const plugin = await import(${JSON.stringify(entry)}); const core = await import(${JSON.stringify(core)}); assert.equal(plugin.default.id, 'context-churn-monitor'); assert.equal(typeof plugin.default.setup, 'function'); assert.equal(typeof core.Monitor, 'function');`], { cwd: standalone, encoding: 'utf8', timeout: 30000 });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});
