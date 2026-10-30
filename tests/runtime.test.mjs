import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
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


test('manager UI has no account-only model modes or reset radar, and quota queries are optional', () => {
  const html = fs.readFileSync(path.join(app, 'panel.html'), 'utf8');
  const main = fs.readFileSync(path.join(app, 'main.cjs'), 'utf8');
  const backend = fs.readFileSync(path.join(app, 'backend/lib/standalone.js'), 'utf8');
  assert.doesNotMatch(html, /id="chat-mode"|当前账号推荐|最低版本|重置小雷达|reset-result/);
  assert.doesNotMatch(main, /dsh-pet-7340\/reset/);
  assert.doesNotMatch(backend, /codex-reset|rest === "reset"/);
  assert.doesNotMatch(fs.readFileSync(path.join(app, 'backend/lib/index.js'), 'utf8'), /codex-reset|rest === "reset"/);
  assert.match(html, /<details[^>]+id="quota-card"[^>]*>/);
  assert.doesNotMatch(html.match(/<details[^>]+id="quota-card"[^>]*>/)[0], /\bopen\b/);
  assert.match(backend, /if \(!manual && sel.provider === "codex"\) return/);
  const config = JSON.parse(fs.readFileSync(path.join(app, 'defaults/dsh-pet/main-config.jsonc'), 'utf8'));
  assert.equal(config.pets[0].balanceEnabled, false);
});


test('desktop pet context menu has no reset query, including legacy balance-enabled pets', () => {
  const source = fs.readFileSync(path.join(app, 'backend/runtime/electron-helper/sprite.js'), 'utf8');
  for (const balanceEnabled of [false, true]) {
    let menu;
    const prototype = vm.runInNewContext(source + '\nPetSprite.prototype', {
      window: { __dshPetDebug: {} },
      S: {
        displayMenuBranch: () => ({ label: '显示位置', children: [] }),
        buildMenuTree: () => [{ label: '动作', children: [] }],
        mountContextMenu: options => { menu = options; return { close() {} }; },
        postAction: () => { throw new Error('Retired reset action must not send a request'); },
      },
    });
    const sprite = Object.assign(Object.create(prototype), {
      pet: { balanceEnabled }, dragState: {}, animations: {},
      stopThrow() {}, stopMove() {}, setInteractive() {}, syncInputBusy() {},
      visibleClampRect: () => null, syncInputRegions() {}, closeMenu() {},
    });
    sprite.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 20 });
    assert.ok(menu, 'the actual pet context menu must be mounted');
    const actions = Array.from(menu.tree, item => item.action);
    assert.ok(!actions.includes('reset'), 'no reset entry, even with preserved old settings');
    assert.doesNotMatch(Array.from(menu.tree, item => item.label).join('\n'), /查询.*Codex.*重置/);
    for (const action of ['chat', 'reminders', 'control', 'open-codex', 'home', 'reload']) assert.ok(actions.includes(action), action);
    assert.equal(actions.includes('show-balance'), balanceEnabled);
    assert.doesNotThrow(() => sprite.onMenuAction({ action: 'reset' }), 'a stale reset leaf cannot reach the removed endpoint');
  }
});
