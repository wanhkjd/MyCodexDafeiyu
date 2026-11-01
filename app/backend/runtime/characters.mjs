// Character media always comes from the bundled assets, independent of saved download paths.
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const CHARACTER_IDS = ['dafeiyu', 'bailong'];
const CHARACTER_NAMES = { dafeiyu: '大肥鱼', bailong: '白龙' };

// Idle alpha bounds: fish ~268/640 tall, dragon ~616/720 tall. Match visible height, not transparent canvas width.
// Both matched characters are half the previous presentation size; keep fish near its original size.
export const DAFEIYU_VISUAL_SCALE = 1.025;
export const BAILONG_VISUAL_SCALE = 0.5;
export const CHARACTER_ASSET_ROOT = '__character_bailong';
// Resolve from this module, never from cwd, a username, or a persisted installation path.
export const BUNDLED_BAILONG_ROOT = fileURLToPath(new URL('../assets/characters/bailong/', import.meta.url));
export const characterFile = home => join(home, 'dsh-pet', 'character.json');
const GROUPS = {
  idle: ['idle'], additionalIdleAnimations: ['idle2', 'idle03', 'idle04', 'idle05', 'idle06'],
  variants: ['01', '04', '05', '08', '09', '13', '14', '17', '18', '20', '21', '22', '24', '25', '26'],
  dragAnimation: ['drag'], landingAnimation: ['landing'], quotaAnimation: ['quota'],
  workAnimations: ['work01', 'work02', 'work03', 'work04', 'work05'],
  movementAnimations: ['move02', 'move02left', 'move01left', 'move01right', 'move03left', 'move03right'],
};
const within = (root, file) => { const rel = relative(root, file); return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')); };
const finite = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const packCache = new Map();

export function loadBailongPack(root, { fresh = false } = {}) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('内置白龙素材目录必须是绝对路径');
  const base = realpathSync(root);
  const manifestPath = join(base, 'outputs', '白龙桌宠素材', '素材清单.json');
  const realManifest = realpathSync(manifestPath);
  if (!within(base, realManifest) || statSync(realManifest).size > 1024 * 1024) throw new Error('素材清单不在角色目录内，或文件过大');
  const stamp = statSync(realManifest).mtimeMs;
  const cached = packCache.get(base);
  if (!fresh && cached?.stamp === stamp && Date.now() - cached.at < 2000) return cached.pack;
  packCache.delete(base);
  const source = readJson(realManifest);
  const mediaRoot = realpathSync(join(dirname(realManifest), '透明WebM'));
  if (!within(base, mediaRoot)) throw new Error('动画目录不能指向角色文件夹外');
  const clips = {};
  let bytes = 0;
  for (const [group, expected] of Object.entries(GROUPS)) {
    const entries = (Array.isArray(source[group]) ? source[group] : [source[group]]).filter(Boolean);
    if (entries.length !== expected.length) throw new Error('素材分组数量不符：' + group);
    for (const item of entries) {
      if (!expected.includes(item.id) || clips[item.id]) throw new Error('未知或重复动作 ID');
      const file = item.playbackFile ?? item.file;
      if (file !== '透明WebM/' + item.id + '.webm') throw new Error('动作路径不合法：' + item.id);
      const filePath = realpathSync(join(mediaRoot, item.id + '.webm'));
      const info = statSync(filePath);
      if (!within(mediaRoot, filePath) || !info.isFile() || info.size < 1 || info.size > 100 * 1024 * 1024) throw new Error('动画缺失或越界：' + item.id);
      if (!finite(item.durationMs, 100, 120000) || !finite(item.renderScale ?? 1, 0.5, 1.5)) throw new Error('动画时长或缩放不合法：' + item.id);
      const offset = item.renderOffset ?? [0, 0];
      if (!Array.isArray(offset) || offset.length !== 2 || offset.some(n => !finite(n, -0.25, 0.25)) || (item.renderAnchor && item.renderAnchor !== 'bottom-center')) throw new Error('动画锚点或偏移不合法：' + item.id);
      const clip = { id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 60) : item.id, durationMs: item.durationMs, renderScale: item.renderScale ?? 1, renderOffset: offset, renderAnchor: 'bottom-center' };
      if (group === 'movementAnimations') {
        if (!['left', 'right'].includes(item.sourceFacing) || !finite(item.moveStartMs, 0, item.durationMs) || !finite(item.moveStopMs, item.moveStartMs + 1, item.durationMs)) throw new Error('移动时间窗或朝向不合法：' + item.id);
        Object.assign(clip, { sourceFacing: item.sourceFacing, moveStartMs: item.moveStartMs, moveStopMs: item.moveStopMs });
      }
      clips[item.id] = clip;
      bytes += info.size;
      if (bytes > 512 * 1024 * 1024) throw new Error('素材总大小超过 512 MiB');
    }
  }
  const pack = { root: base, mediaRoot, clips, bytes };
  packCache.set(base, { at: Date.now(), stamp, pack });
  return pack;
}

export const DEFAULT_BEHAVIOR = Object.freeze({ largeActions: true, run: true, flight: true });
const behaviorOf = value => ({ largeActions: value?.largeActions !== false, run: value?.run !== false, flight: value?.flight !== false });
function selection(home) {
  let raw = {};
  try { raw = readJson(characterFile(home)); } catch {}
  return {
    selected: CHARACTER_IDS.includes(raw?.selected) ? raw.selected : 'dafeiyu',
    companion: CHARACTER_IDS.includes(raw?.companion) ? raw.companion : null,
    behavior: behaviorOf(raw?.behavior),
  };
}
function resolvedSelection(home, { fresh = false } = {}) {
  const saved = selection(home);
  let pack;
  const errors = {};
  // Ignore legacy source/root fields; never consult the user's original material library.
  try { pack = loadBailongPack(BUNDLED_BAILONG_ROOT, { fresh }); }
  catch (e) { errors.bailong = '内置白龙素材不可用，暂时显示大肥鱼。请重新解压程序：' + e.message; }
  const resolve = id => id && errors[id] ? 'dafeiyu' : id;
  return { ...saved, source: 'bundled', active: resolve(saved.selected), companionActive: resolve(saved.companion), pack, errors,
    error: [...new Set([errors[saved.selected], errors[saved.companion]].filter(Boolean))].join('\n') };
}
export const activeCharacter = home => resolvedSelection(home).active;
export function characterState(home) {
  const state = resolvedSelection(home);
  return { ok: true, selected: state.selected, active: state.active, companion: state.companion, companionActive: state.companionActive, source: 'bundled', behavior: state.behavior,
    message: state.error, characters: [
      { id: 'dafeiyu', name: '大肥鱼', available: true },
      { id: 'bailong', name: '白龙', available: !!state.pack, assets: state.pack ? Object.keys(state.pack.clips).length : 0 },
    ] };
}
export function saveCharacter(home, body = {}) {
  const previous = selection(home);
  let next;
  try {
    const resolved = resolvedSelection(home, { fresh: true });
    const base = previous;
    if (body?.action === 'select' && CHARACTER_IDS.includes(body.id)) {
      // Accept the former built-in hint from old callers, but never save a material source/path.
      if (body.source !== undefined && (body.source !== 'bundled' || body.id === 'dafeiyu')) throw new Error('仅支持内置素材');
      if (resolved.errors[body.id]) throw new Error(resolved.errors[body.id]);
      next = { ...base, selected: body.id };
    } else if (body?.action === 'companion') {
      if (body.id !== null && !CHARACTER_IDS.includes(body.id)) throw new Error('无效的第二只桌宠形象');
      if (resolved.errors[body.id]) throw new Error(resolved.errors[body.id]);
      next = { ...base, companion: body.id };
    } else if (body?.action === 'behavior') {
      if (!body.behavior || !Object.keys(body.behavior).length || Object.entries(body.behavior).some(([key, value]) => !Object.hasOwn(DEFAULT_BEHAVIOR, key) || typeof value !== 'boolean')) throw new Error('无效的动作开关');
      next = { ...base, behavior: { ...previous.behavior, ...body.behavior } };
    } else return { ok: false, message: '无效的形象操作' };
    const file = characterFile(home);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    renameSync(tmp, file);
    return characterState(home);
  } catch (e) { return { ok: false, message: '形象配置未更改：' + e.message }; }
}

// Old business events keep their names. Resolve them at the character boundary, not in each service.
export const BAILONG_ALIASES = {
  '点击回应-开心跃动': '18', '点击回应-害羞惊讶': '20', '点击回应-傲娇生气': '09', '点击回应-挠痒咯咯笑': '08',
  '点击回应-元气挥手': '01', '点击回应-收到敬礼': 'work01', '被吓一跳': '13', '用鲸鱼尾巴拍打地面': 'idle06',
  '鲸鱼吐泡泡特效': '25', '小幅度原地360度旋转展示': '05', '优雅女仆舞': '20', '轻快摇摆舞': '18', '可爱宅舞': '18',
  '哈欠连天': '14', '大口吃零食': '17', '吃白饭': '17', '工作状态-思考冒泡': 'work04', '工作状态-忙碌点按': 'work02',
  '工作状态-清点归档': 'work03', '工作状态-原地踱步张望': 'work05', '工作状态-雀跃庆祝': '18', '工作状态-垂头叹气冒汗': '13',
  '被鼠标拖拽悬空反馈': 'drag', '女仆屈膝礼仪': '04',
};
export function applyCharacterConfig(merged, home) {
  const state = resolvedSelection(home);
  if (!merged.main) return merged;
  merged.main.behavior = state.behavior;
  const clips = state.pack?.clips || {};
  const main = merged.main;
  const walks = GROUPS.movementAnimations.filter(id => !id.startsWith('move03') && clips[id]);
  const category = (id, name, actions, weight) => ({ id, name, label: name, actions, weight, noMirror: false });
  const character = { id: 'bailong', name: '白龙', assetRoot: CHARACTER_ASSET_ROOT, geometry: { width: 720, height: 720, feetY: 660, hitBox: { x0: 160, y0: 70, x1: 560, y1: 665 } }, clips, aliases: BAILONG_ALIASES, fallback: 'idle', landing: 'landing', mirror: false, flightAnimations: ['move03left', 'move03right'] };
  // A derived config only: original main-config, user positions and business switches stay intact.
  const dragonWeights = { idle: 70, turn: 0, move: 5 };
  const dragonAnimations = {
    labels: Object.fromEntries(Object.values(clips).map(clip => [clip.id, clip.name])),
    idle: [...GROUPS.idle, ...GROUPS.additionalIdleAnimations], turn: [], drag: ['drag'], clicks: ['01', '08', '20', '09'],
    moves: { default: { minDist: 100, maxDist: 220, margin: 20, leadSec: 0, tailSec: 0 }, actions: walks.map(id => ({ name: id, params: { leadSec: clips[id].moveStartMs / 1000, tailSec: (clips[id].durationMs - clips[id].moveStopMs) / 1000 } })) },
    categories: [category('INTERACTION', '白龙互动', GROUPS.variants, 25), category('WORK', '工作展示', GROUPS.workAnimations, 0), category('FLIGHT', '整屏自由飞行', ['move03left', 'move03right'], 0), category('SPECIAL', '拖拽与落地', ['drag', 'landing'], 0)],
    // Menu groups are separate from event/random pools: list each clip once, without quota actions.
    menuGroups: [
      { label: '待机', actions: [...GROUPS.idle, ...GROUPS.additionalIdleAnimations] },
      { label: '白龙互动', actions: [...GROUPS.variants] },
      { label: '移动与飞行', actions: [...GROUPS.movementAnimations] },
      { label: '工作展示', actions: [...GROUPS.workAnimations] },
      { label: '拖拽与落地', actions: ['drag', 'landing'] },
    ],
    events: { whisper: ['01', '08', '04'], workStatus: [['work01', 'work04'], 'work02', 'work03', 'work05', '18', '13'] },
  };
  const basePets = main.pets.filter(p => !p.companion);
  const instances = basePets.map(p => ({ pet: p, active: state.active, slot: 'primary' }));
  if (state.companionActive && basePets.length) {
    const first = basePets[0], ids = new Set(Object.values(merged).flatMap(conf => conf?.pets || []).filter(p => !p.companion).map(p => p.id));
    let id = 'codex-companion';
    while (ids.has(id)) id += '-2';
    const corner = first.position?.corner || 'bottom-right';
    instances.push({ active: state.companionActive, slot: 'companion', pet: {
      ...first, id, name: CHARACTER_NAMES[state.companionActive], companion: true, sharedSayId: first.id,
      position: { ...first.position, corner: corner.endsWith('right') ? corner.replace('right', 'left') : corner.replace('left', 'right') },
    } });
  }
  // Per-instance media keeps mixed pairs independent; persona, chat and preferences stay shared.
  main.pets = instances.map(({ pet, active, slot }) => ({ ...pet, characterSlot: slot, behavior: state.behavior,
    renderSize: pet.size * (active === 'bailong' ? BAILONG_VISUAL_SCALE : DAFEIYU_VISUAL_SCALE),
    character: active === 'bailong' ? character : undefined,
    animations: active === 'bailong' ? dragonAnimations : main.animations,
    animationWeights: active === 'bailong' ? dragonWeights : main.animationWeights,
  }));
  return merged;
}

export function resolveCharacterAsset(home, name, assetRoot = CHARACTER_ASSET_ROOT) {
  // No arbitrary filesystem endpoint: only IDs in the validated pack, only while it is selected.
  if (!/^[a-zA-Z0-9]+\.webm$/.test(name)) return undefined;
  const state = resolvedSelection(home);
  const id = name.slice(0, -5);
  const characterId = assetRoot === CHARACTER_ASSET_ROOT ? 'bailong' : null;
  const pack = state.pack;
  if (!characterId || !pack || (state.active !== characterId && state.companionActive !== characterId) || !Object.hasOwn(pack.clips, id)) return undefined;
  try {
    const file = realpathSync(join(pack.mediaRoot, name));
    return within(pack.mediaRoot, file) && statSync(file).isFile() ? file : undefined;
  } catch { return undefined; }
}
