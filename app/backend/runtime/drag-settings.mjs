import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const DRAG_DEFAULTS = Object.freeze({ dragPhysics: true, dropGravity: false, throwStrength: 'standard', lockPosition: false, shiftDrag: false, collisionEnabled: true, petCollision: false, collisionRestitution: 0.82, collisionFriction: 0.08, collisionMass: 1, collisionMaxImpulse: 9000 });
// dsh-pet's four speed caps (px/s). These affect throws, not gravity.
export const THROW_PRESETS = Object.freeze([
  { value: 'gentle', label: '轻柔', speed: 3600 }, { value: 'standard', label: '标准', speed: 4800 },
  { value: 'strong', label: '强力', speed: 7200 }, { value: 'crazy', label: '疯狂', speed: 9000 },
]);
export const COLLISION_RANGES = Object.freeze({
  collisionRestitution: [0, 1], collisionFriction: [0, 0.3], collisionMass: [0.5, 2], collisionMaxImpulse: [1000, 12000],
});
const fileAt = home => join(home, 'dsh-pet', 'drag-settings.json');
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的拖拽配置');
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DRAG_DEFAULTS, key)) throw new Error('未知的拖拽选项');
    if (Object.hasOwn(COLLISION_RANGES, key)) {
      const [min, max] = COLLISION_RANGES[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('碰撞参数超出范围');
      continue;
    }
    if (key === 'throwStrength' ? !THROW_PRESETS.some(p => p.value === value) : typeof value !== 'boolean') throw new Error('拖拽选项的值无效');
  }
  return input;
}
function read(home) {
  const file = fileAt(home);
  if (!existsSync(file)) return {};
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) validate(saved);
    // Ignore the retired option in existing files; the next save removes it.
    const { slingshot: retired, ...current } = saved;
    validate(current);
    return current;
  } catch { throw new Error('拖拽配置无法解析，请修复 drag-settings.json；未覆盖原配置'); }
}
export function dragSettingsState(home) {
  return { ok: true, settings: { ...DRAG_DEFAULTS, ...read(home) }, defaults: DRAG_DEFAULTS, presets: THROW_PRESETS };
}
export function saveDragSettings(home, input) {
  const next = { ...read(home), ...validate(input) }, file = fileAt(home), temp = file + '.tmp';
  mkdirSync(dirname(file), { recursive: true });
  try { writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8'); renameSync(temp, file); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
  return dragSettingsState(home);
}
