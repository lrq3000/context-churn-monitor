// The backend is emitted by tsc. GUI bundles are added when the optional extension sources are present.
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
if (existsSync('src/gui/panel.ts')) await build({ entryPoints: ['src/gui/panel.ts'], outfile: 'openchamber/panel/app.js', bundle: true, format: 'iife', target: 'es2022' });
if (existsSync('src/gui/service.ts')) await build({ entryPoints: ['src/gui/service.ts'], outfile: 'openchamber/service.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
