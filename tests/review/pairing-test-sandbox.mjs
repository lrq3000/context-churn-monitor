// Historical review bootstrap: confine focused-regression mkdtemp artifacts to the approved review subtree.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname, basename, resolve } from 'node:path';
import assert from 'node:assert/strict';
const temporary = process.env.CONTEXT_MONITOR_TEST_TMP;
assert.equal(temporary?.replaceAll('\\', '/'), 'C:/Users/33632/AppData/Local/Temp/opencode/context-churn-monitor');
const directory = join(temporary, 'pairing-20261108', 'senior-review-regressions');
fs.mkdirSync(directory, { recursive: true });
const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = function(prefix, ...args) {
  if (typeof prefix === 'string' && resolve(dirname(prefix)) === resolve(temporary)) prefix = join(directory, basename(prefix));
  return mkdtempSync(prefix, ...args);
};
syncBuiltinESMExports();
