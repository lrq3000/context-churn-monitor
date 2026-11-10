import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, readFileSync, writeFileSync, cpSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

/** Read only the installed host modules needed for permission/path checks, without extracting or starting the application. */
class HostArchive {
  private fd: number;
  private header: any;
  private base: number;
  constructor(path: string) {
    this.fd = openSync(path, 'r');
    const size = this.read(4, 4).readUInt32LE();
    assert.ok(size > 8 && size < 32 * 1024 * 1024, 'Bound the ASAR header read');
    const header = this.read(8, size);
    this.header = JSON.parse(header.subarray(8, 8 + header.readUInt32LE(4)).toString('utf8'));
    this.base = 8 + size;
  }
  private read(offset: number, size: number): Buffer {
    const bytes = Buffer.alloc(size);
    assert.equal(readSync(this.fd, bytes, 0, size, offset), size);
    return bytes;
  }
  text(path: string): string {
    const item = path.split('/').reduce((node, part) => node.files[part], this.header);
    assert.ok(item.offset !== undefined && item.size < 1024 * 1024, `Expected a small archived source file: ${path}`);
    return this.read(this.base + Number(item.offset), item.size).toString('utf8');
  }
  close() { closeSync(this.fd); }
}

const archivePath = process.env.CONTEXT_MONITOR_OPENCHAMBER_ASAR;
const packageRoot = process.env.CONTEXT_MONITOR_PACKED_ROOT;

test('installed OpenChamber native resolver and grants deliver the packed backend and skill only while approved and enabled', { skip: !archivePath || !packageRoot }, async () => {
  const artifacts = process.env.CONTEXT_MONITOR_TEST_TMP;
  assert.ok(artifacts, 'Keep native-host fixtures in the explicitly selected artifact directory');
  assert.equal(existsSync(join(packageRoot!, 'node_modules')), false, 'This fixture must not rely on installed package dependencies');
  const scratch = mkdtempSync(join(artifacts, 'native-host-'));
  const source = fileURLToPath(new URL('../../', import.meta.url));
  const native = join(scratch, 'native');
  mkdirSync(native);
  writeFileSync(join(scratch, 'package.json'), '{"type":"module"}\n');
  // These two unmodified host modules depend only on Node and the published SDK. Test dependencies live in a sibling harness, never inside the extracted plugin.
  for (const dependency of ['@openchamber/sdk', 'zod']) cpSync(join(source, 'node_modules', dependency), join(scratch, 'node_modules', dependency), { recursive: true });
  const archive = new HostArchive(archivePath!);
  try {
    assert.equal(JSON.parse(archive.text('package.json')).version, '2.7.0', 'Revalidate this characterization against a deliberately selected host version');
    for (const name of ['agent-context.js', 'opencode-plugin.js']) writeFileSync(join(native, name), archive.text(`node_modules/@openchamber/web/server/lib/guests/${name}`));
  } finally { archive.close(); }
  const { resolveOpenCodePluginFolder, openCodePluginDelivery } = await import(pathToFileURL(join(native, 'opencode-plugin.js')).href);
  const { createGuestAgentContext } = await import(pathToFileURL(join(native, 'agent-context.js')).href);
  const { requestedGuestCapabilities } = await import(pathToFileURL(join(scratch, 'node_modules/@openchamber/sdk/dist/index.js')).href);
  const manifest = JSON.parse(readFileSync(join(packageRoot!, 'package.json'), 'utf8'));
  const contributes = manifest.openchamber.contributes;
  const backend = await fs.realpath(join(packageRoot!, contributes.opencodePlugin));
  assert.equal(await resolveOpenCodePluginFolder(fs, packageRoot, contributes.opencodePlugin), backend);
  const guest = { ...contributes, id: contributes.panel.id, name: contributes.panel.name, packageRoot, enabled: true, capabilityGrants: requestedGuestCapabilities(contributes) };
  const context = createGuestAgentContext({ listGuests: async () => [guest], instructions: { forDirectory: async () => [] } });
  assert.deepEqual(await context.pluginDirectories(), [backend]);
  assert.deepEqual(await context.skillDirectories(), [resolve(packageRoot!, 'skills')]);
  for (const missing of ['opencodePlugin', 'skills']) {
    const all = guest.capabilityGrants;
    guest.capabilityGrants = all.filter((capability: string) => capability !== missing);
    assert.deepEqual(await context.pluginDirectories(), []);
    assert.deepEqual(await context.skillDirectories(), []);
    guest.capabilityGrants = all;
  }
  guest.enabled = false;
  assert.deepEqual(await context.pluginDirectories(), []);
  assert.deepEqual(await context.skillDirectories(), []);
  guest.enabled = true;
  assert.deepEqual(await context.pluginDirectories(), [backend]);
  assert.equal(openCodePluginDelivery({ external: false, origin: null, ownsConfigFile: true }), 'file');
  assert.equal(openCodePluginDelivery({ external: false, origin: null, ownsConfigFile: false }), 'restart');
  assert.equal(openCodePluginDelivery({ external: true, origin: 'http://127.0.0.1:4096', ownsConfigFile: false }), 'none');
  assert.equal(openCodePluginDelivery({ external: true, origin: 'https://remote.example', ownsConfigFile: false }), 'remote');
});

test('published SDK extension checker accepts the extracted root without installing dependencies into it', { skip: !packageRoot }, () => {
  const source = fileURLToPath(new URL('../../', import.meta.url));
  const loader = pathToFileURL(join(source, 'node_modules/tsx/dist/loader.mjs')).href;
  const checker = spawnSync(process.execPath, ['--import', loader, join(source, 'node_modules/@openchamber/sdk/scripts/check-guest.ts'), packageRoot!], { cwd: dirname(packageRoot!), encoding: 'utf8', timeout: 30000 });
  assert.equal(checker.status, 0, checker.stderr || checker.stdout);
});
