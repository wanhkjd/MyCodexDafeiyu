import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const POSITION_SLOTS = Object.freeze(['primary', 'companion']);
const empty = () => ({ point: null, fixed: false, revision: '' });
const fileAt = home => join(home, 'dsh-pet', 'position-settings.json');
export function validatePositionPoint(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point) || Object.keys(point).some(k => !['x', 'y'].includes(k)) ||
      !['x', 'y'].every(k => Number.isSafeInteger(point[k]) && Math.abs(point[k]) <= 100000)) throw new Error('位置必须是 -100000 至 100000 的整数坐标');
  return { x: point.x, y: point.y };
}
function slotOf(slot) { if (!POSITION_SLOTS.includes(slot)) throw new Error('无效的桌宠位置对象'); return slot; }
function read(home) {
  const file = fileAt(home), result = Object.fromEntries(POSITION_SLOTS.map(slot => [slot, empty()]));
  if (!existsSync(file)) return result;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).some(k => !POSITION_SLOTS.includes(k))) throw new Error();
    for (const slot of POSITION_SLOTS) {
      const value = saved[slot];
      if (value === undefined) continue;
      if (!value || typeof value.fixed !== 'boolean' || typeof value.revision !== 'string' || value.revision.length > 100 || (value.point === null && value.fixed)) throw new Error();
      result[slot] = { point: value.point === null ? null : validatePositionPoint(value.point), fixed: value.fixed, revision: value.revision };
    }
    return result;
  } catch { throw new Error('位置配置无法解析，请修复 position-settings.json；未覆盖原配置'); }
}
export function positionSettingsState(home) { return { ok: true, settings: read(home) }; }
export function savePositionSettings(home, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['slot', 'point', 'fixed'].includes(k))) throw new Error('无效的位置设置');
  const slot = slotOf(input.slot);
  if (typeof input.fixed !== 'boolean' || (input.point === null && input.fixed)) throw new Error('无效的固定位置设置');
  const point = input.point === null ? null : validatePositionPoint(input.point);
  const next = read(home), file = fileAt(home), temp = file + '.tmp';
  next[slot] = { point, fixed: input.fixed, revision: randomUUID() };
  mkdirSync(dirname(file), { recursive: true });
  try { writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8'); renameSync(temp, file); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
  return { ok: true, settings: next };
}
export function applyPositionConfig(config, home) {
  const { settings } = positionSettingsState(home);
  for (const conf of Object.values(config)) for (const pet of conf?.pets || []) {
    if (POSITION_SLOTS.includes(pet.characterSlot)) pet.startPosition = structuredClone(settings[pet.characterSlot]);
  }
  return config;
}

// Live snapshots stay in memory, never turn each drag frame into a disk write.
export function createPositionTracker(now = Date.now) {
  const current = new Map();
  return {
    update(input) {
      const slot = slotOf(input?.slot), point = validatePositionPoint(input?.point);
      current.set(slot, { ...point, at: now() });
    },
    snapshot(activeSlots = POSITION_SLOTS) {
      return Object.fromEntries(POSITION_SLOTS.map(slot => {
        const value = current.get(slot);
        return [slot, activeSlots.includes(slot) && value && now() - value.at < 5000 ? { x: value.x, y: value.y } : null];
      }));
    },
  };
}
