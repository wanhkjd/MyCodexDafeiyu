import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkPackage, prepareData, readBackendAddress, backendEnvironment } = require('../app/runtime-utils.cjs');
const app = path.resolve(import.meta.dirname, '../app');
test('source tree contains every required non-runtime file', () => {
  assert.doesNotThrow(() => checkPackage(app, { source: true }));
  assert.throws(() => checkPackage(app), /node.exe/);
});
test('first launch seeds isolated defaults; subsequent launches preserve edits', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-defaults-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  prepareData(app, dir);
  assert.ok(fs.existsSync(path.join(dir, 'dsh-pet/main-config.jsonc')));
  const file = path.join(dir, 'quotes.json');
  fs.writeFileSync(file, JSON.stringify(['my quote']));
  prepareData(app, dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), ['my quote']);
});
test('backend address accepts only a valid loopback endpoint', () => {
  assert.equal(readBackendAddress('服务已监听 http://127.0.0.1:32100/'), 'http://127.0.0.1:32100');
  for (const line of ['服务已监听 http://0.0.0.0:32100/', '服务已监听 http://127.0.0.1:0/', '服务已监听 http://127.0.0.1:65536/']) assert.equal(readBackendAddress(line), null);
});
test('backend environment keeps loopback out of proxies without mutating parent', () => {
  const source = { HTTPS_PROXY: 'http://localhost:7890', NO_PROXY: 'example.com', ELECTRON_RUN_AS_NODE: '1' };
  const result = backendEnvironment(source);
  assert.equal(result.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(source.ELECTRON_RUN_AS_NODE, '1');
  assert.match(result.NO_PROXY, /example.com,localhost,127.0.0.1,\[::1\]/);
});
