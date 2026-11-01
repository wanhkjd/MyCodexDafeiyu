import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { applyCharacterConfig, saveCharacter, DAFEIYU_VISUAL_SCALE, BAILONG_VISUAL_SCALE } from '../app/backend/runtime/characters.mjs';
import { petSizeState, resizePetConfig } from '../app/backend/runtime/pet-size.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const source = file => readFileSync(new URL('../app/backend/runtime/electron-helper/' + file, import.meta.url), 'utf8');
const animations = { idle: ['待机呼吸休闲'], clicks: [], drag: [] };
const rawConfig = size => ({ main: { pets: [{ id: 'main', name: '大肥鱼', size, position: { corner: 'bottom-right', marginX: 20, marginY: 30 } }], animations }, extra: { pets: [{ id: 'extra', size: 200 }] } });
function withHome(run) {
  const parent = resolve(tmpdir()), home = mkdtempSync(join(parent, 'dafeiyu-size-test-'));
  try { return run(home); }
  finally {
    assert.equal(dirname(resolve(home)), parent); // Never recursively remove outside the test's temp parent.
    assert.ok(home.startsWith(join(parent, 'dafeiyu-size-test-')));
    rmSync(home, { recursive: true, force: true });
  }
}

for (const size of [100, 400, 500]) test(`shared ${size}px survives character switches and repeated aggregation`, () => withHome(home => {
  const raw = rawConfig(size), merged = applyCharacterConfig(structuredClone(raw), home);
  assert.equal(merged.main.pets[0].size, size);
  assert.equal(merged.main.pets[0].renderSize, size * DAFEIYU_VISUAL_SCALE);
  assert.equal(petSizeState(merged).size, size);
  assert.deepEqual(merged.extra, raw.extra);
  applyCharacterConfig(merged, home);
  assert.equal(merged.main.pets[0].renderSize, size * DAFEIYU_VISUAL_SCALE);
  assert.ok(saveCharacter(home, { action: 'select', id: 'bailong', source: 'bundled' }).ok);
  const dragon = applyCharacterConfig(structuredClone(raw), home);
  assert.equal(dragon.main.pets[0].renderSize, size * BAILONG_VISUAL_SCALE);
  assert.equal(dragon.main.pets[0].character.id, 'bailong');
  assert.equal(petSizeState(dragon).size, size);
  assert.ok(saveCharacter(home, { action: 'select', id: 'dafeiyu' }).ok);
  assert.equal(applyCharacterConfig(structuredClone(raw), home).main.pets[0].renderSize, size * DAFEIYU_VISUAL_SCALE);
  assert.equal(raw.main.pets[0].renderSize, undefined);
}));

test('saving a new size only changes the raw setting and preserves unrelated preferences', () => withHome(home => {
  const raw = rawConfig(400).main;
  raw.physics = { gravity: 2000 }; raw.pets.push({ id: 'secondary', size: 123 });
  const resized = resizePetConfig(raw, undefined, { size: 500 });
  assert.equal(resized.pets[0].renderSize, undefined);
  assert.deepEqual(resized.pets[0].position, raw.pets[0].position);
  assert.deepEqual(resized.physics, raw.physics);
  assert.equal(resized.pets[1].size, 123);
  assert.equal(petSizeState(applyCharacterConfig({ main: resized }, home)).size, 500);
  for (const bad of [99, 501, 200.5, '400', NaN]) assert.throws(() => resizePetConfig(raw, undefined, { size: bad }));
}));

function spriteFor(pet, scale) {
  const bounds = [], element = () => ({ style: { setProperty(key, value) { this[key] = value; } }, classList: { toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} });
  class Observer { observe() {} }
  const context = vm.createContext({ performance, AbortController, URLSearchParams, ResizeObserver: Observer, MutationObserver: Observer, document: { createElement: element, body: element() }, window: { addEventListener() {}, petBridge: { setBounds(...args) { bounds.push(args); } } }, params: new URLSearchParams(), VIEW: { x: 0, y: 0, w: 1920, h: 1080 }, CONFIG: { scale }, WINDOW_MARGIN_RATIO: 0.5, rootEl: element(), BASE: '/test', config: {}, cfg: { animations }, toScreen: value => value * scale });
  vm.runInContext(source('shared-core.js') + '\nconst S = PetShared;\n' + source('drag-motion.js') + '\n' + source('edge-peek.js') + '\n' + source('sprite.js') + '\nPetSprite.prototype.position = function() {}; globalThis.Sprite = PetSprite;', context);
  return { sprite: new context.Sprite(pet), bounds };
}
for (const scale of [1, 1.5, 2]) test(`render canvas, hit regions and IPC all use compensated dimensions at DPI ${scale}`, () => withHome(home => {
  const pet = applyCharacterConfig(rawConfig(400), home).main.pets[0], { sprite, bounds } = spriteFor(pet, scale);
  close(sprite.size, 410);
  close(sprite.height, 410 * 9 / 16);
  close(parseFloat(sprite.stage.style.width), 410);
  assert.equal(sprite.el.style['--pet-size'], '400px'); // Do not double text/bubble size.
  close(sprite.hitRect.w, 240 / 640 * 410);
  close(sprite.hitRect.h, 285 / 640 * 410);
  sprite.sendBounds(100, 200);
  close(bounds[0][2], 820 * scale);
  close(bounds[0][3], (sprite.winH + 410) * scale);
  close(bounds[0][6], 410 * scale); // Collision/feeding/control coordinates match the visible pet.
}));

test('uncompensated legacy/extra pets still render at their configured size', () => {
  assert.equal(spriteFor({ id: 'extra', size: 200 }, 1).sprite.size, 200);
});
test('idle visible heights still match within 2% after halving both characters', () => {
  // Measured alpha >=32 at 0.25/1/2/3 seconds in the bundled idle clips.
  const fishHeights = [268, 270, 265, 269], dragonHeights = [616, 615, 617, 617];
  for (let i = 0; i < fishHeights.length; i++) {
    const ratio = (fishHeights[i] / 640 * DAFEIYU_VISUAL_SCALE) / (dragonHeights[i] / 720 * BAILONG_VISUAL_SCALE);
    assert.ok(Math.abs(ratio - 1) < 0.02);
  }
});

test('both host entry points forward derived canvas size for the initial helper window', () => {
  for (const file of ['index.js', 'standalone.js']) {
    const code = readFileSync(new URL('../app/backend/lib/' + file, import.meta.url), 'utf8');
    const relay = code.slice(code.indexOf('const desktopPetList = () => {')).split('let helper;')[0];
    assert.match(relay, /size: Number\(p\.renderSize \?\? p\.size\)/);
  }
});

test('both characters render at half the previous matched size, regardless of saved px', () => withHome(home => {
  for (const size of [100, 400, 500]) {
    assert.ok(saveCharacter(home, { action: 'select', id: 'dafeiyu' }).ok);
    close(applyCharacterConfig(rawConfig(size), home).main.pets[0].renderSize, size * 2.05 / 2);
    assert.ok(saveCharacter(home, { action: 'select', id: 'bailong', source: 'bundled' }).ok);
    close(applyCharacterConfig(rawConfig(size), home).main.pets[0].renderSize, size / 2);
  }
}));
