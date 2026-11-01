// Bundled and imported character packs: declarative media only, never execute downloaded code.
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, realpathSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('请选择 BailongPet 文件夹的绝对路径');
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
export const skinLibrary = home => join(resolve(home), 'skins', 'bailong');
export function isManagedPack(home, root) {
  try { return within(realpathSync(skinLibrary(home)), realpathSync(root)); } catch { return false; }
}

// A new immutable directory per import: validation/copy failure never overwrites the active pack.
// Only the 35 validated media files and a normalized manifest enter the library. No executable/code.
export function importBailongPack(home, root) {
  const source = loadBailongPack(root, { fresh: true });
  if (isManagedPack(home, source.root)) return source;
  const library = skinLibrary(home);
  mkdirSync(library, { recursive: true });
  if (realpathSync(library) !== resolve(library)) throw new Error('素材库不能是重定向到其他位置的链接');
  const id = randomUUID();
  const staging = join(library, '.import-' + id), destination = join(library, 'pack-' + id);
  const folder = join(staging, 'outputs', '白龙桌宠素材'), media = join(folder, '透明WebM');
  mkdirSync(media, { recursive: true });
  const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const manifest = {}, hashes = {};
  try {
    for (const [group, ids] of Object.entries(GROUPS)) {
      const entries = ids.map(id => {
        const from = realpathSync(join(source.mediaRoot, id + '.webm'));
        if (!within(source.mediaRoot, from)) throw new Error('复制时素材路径发生变化：' + id);
        const to = join(media, id + '.webm'), before = digest(from);
        copyFileSync(from, to);
        if (digest(to) !== before || digest(from) !== before) throw new Error('复制校验失败：' + id);
        hashes[id] = before;
        return { ...source.clips[id], file: '透明WebM/' + id + '.webm' };
      });
      manifest[group] = entries.length === 1 ? entries[0] : entries;
    }
    writeFileSync(join(folder, '素材清单.json'), JSON.stringify(manifest, null, 2));
    loadBailongPack(staging, { fresh: true });
    writeFileSync(join(staging, 'import-verification.json'), JSON.stringify({ schema: 1, assets: 35, bytes: source.bytes, hashes }, null, 2));
    renameSync(staging, destination);
    return loadBailongPack(destination, { fresh: true });
  } catch (error) {
    // Keep an incomplete import separate for diagnosis; never activate it or delete user source files.
    throw new Error('导入未完成，原形象保持不变：' + error.message);
  }
}
function selection(home) {
  let raw = {};
  try { raw = readJson(characterFile(home)); } catch {}
  return {
    selected: raw?.selected === 'bailong' ? 'bailong' : 'dafeiyu',
    source: ['bundled', 'imported'].includes(raw?.source) ? raw.source : 'legacy',
    root: typeof raw?.root === 'string' ? raw.root : '', behavior: behaviorOf(raw?.behavior),
  };
}
function resolvedSelection(home, { fresh = false } = {}) {
  const saved = selection(home);
  let bundled, bundledError;
  try { bundled = loadBailongPack(BUNDLED_BAILONG_ROOT, { fresh }); } catch (e) { bundledError = e; }
  let pack, error = '', source = saved.source;
  // Old path-only settings upgrade to the built-in pack without deleting the old library.
  // Explicit new imports keep their precedence, including the existing missing-pack fallback.
  if (source !== 'imported' && bundled) { pack = bundled; source = 'bundled'; }
  else if (source !== 'bundled' && saved.root) {
    source = 'imported';
    try { pack = loadBailongPack(saved.root, { fresh }); }
    catch (e) { error = '白龙素材不可用，暂时显示大肥鱼。请重新导入或使用内置白龙：' + e.message; }
  } else {
    source = 'bundled';
    error = '内置白龙素材不可用，暂时显示大肥鱼。请检查程序文件或重新导入：' + (bundledError?.message || '素材缺失');
  }
  return { ...saved, source, active: saved.selected === 'bailong' && pack ? 'bailong' : 'dafeiyu', pack, error, bundledAvailable: !!bundled };
}
export const activeCharacter = home => resolvedSelection(home).active;
export function characterState(home) {
  const state = resolvedSelection(home), root = state.pack?.root || (state.source === 'imported' ? state.root : '');
  const managed = state.source === 'imported' && !!state.pack && isManagedPack(home, root);
  return { ok: true, selected: state.selected, active: state.active, source: state.source, root, managed, bundledAvailable: state.bundledAvailable, behavior: state.behavior,
    message: state.error || (state.source === 'bundled' ? '白龙使用程序内置素材，随项目和构建一起提供，无需导入或复制到个人资料库。人格、聊天和养成保持共享。'
      : managed ? '白龙已导入本地素材库，不再依赖原下载目录。人格、聊天和养成保持共享。'
      : '当前仍引用旧下载目录，请点击“保存到本地素材库”完成一次迁移。'), characters: [
      { id: 'dafeiyu', name: '大肥鱼', available: true },
      { id: 'bailong', name: '白龙', available: !!state.pack, assets: state.pack ? Object.keys(state.pack.clips).length : 0 },
    ] };
}
export function saveCharacter(home, body = {}) {
  const previous = selection(home);
  let next;
  try {
    const resolved = resolvedSelection(home, { fresh: true });
    const base = { ...previous, source: previous.source === 'legacy' ? resolved.source : previous.source };
    if (body?.action === 'register' || body?.action === 'import-existing') {
      const root = body.action === 'import-existing' ? previous.root || resolved.pack?.root : body.root;
      const bundled = resolved.bundledAvailable && typeof root === 'string' && isAbsolute(root) && realpathSync(root) === realpathSync(BUNDLED_BAILONG_ROOT);
      const pack = bundled ? loadBailongPack(BUNDLED_BAILONG_ROOT, { fresh: true }) : importBailongPack(home, root);
      next = { ...base, source: bundled ? 'bundled' : 'imported', root: pack.root, selected: 'bailong' };
    } else if (body?.action === 'select' && ['dafeiyu', 'bailong'].includes(body.id)) {
      if (body.source !== undefined && (body.source !== 'bundled' || body.id !== 'bailong')) throw new Error('无效的素材来源');
      if (body.source === 'bundled') loadBailongPack(BUNDLED_BAILONG_ROOT, { fresh: true });
      else if (body.id === 'bailong' && !resolved.pack) throw new Error(resolved.error);
      next = { ...base, selected: body.id, ...(body.source === 'bundled' ? { source: 'bundled' } : {}) };
    } else if (body?.action === 'behavior') {
      if (!body.behavior || !Object.keys(body.behavior).length || Object.entries(body.behavior).some(([key, value]) => !Object.hasOwn(DEFAULT_BEHAVIOR, key) || typeof value !== 'boolean')) throw new Error('无效的动作开关');
      next = { ...base, behavior: { ...previous.behavior, ...body.behavior } };
    } else return { ok: false, message: '无效的形象操作' };
    // Only imports persist absolute paths; a built-in selection remains portable across installs.
    if (next.source === 'bundled') next.root = '';
    const file = characterFile(home);
    mkdirSync(dirname(file), { recursive: true });
    if (previous.root && next.source === 'bundled' && existsSync(file) && !existsSync(file + '.before-bundled.bak')) copyFileSync(file, file + '.before-bundled.bak');
    if (['register', 'import-existing'].includes(body.action) && previous.root && !isManagedPack(home, previous.root) && existsSync(file) && !existsSync(file + '.before-managed.bak')) copyFileSync(file, file + '.before-managed.bak');
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
  '被鼠标拖拽悬空反馈': 'drag',
};
export function applyCharacterConfig(merged, home) {
  const state = resolvedSelection(home);
  if (!merged.main) return merged;
  merged.main.behavior = state.behavior;
  // Keep size as the user's shared 100–500 px setting; renderSize is derived and never saved.
  const visualScale = state.active === 'dafeiyu' ? DAFEIYU_VISUAL_SCALE : BAILONG_VISUAL_SCALE;
  merged.main.pets = merged.main.pets.map(p => ({ ...p, behavior: state.behavior, renderSize: p.size * visualScale }));
  if (state.active !== 'bailong') return merged;
  const { clips } = state.pack;
  const main = merged.main;
  const walks = GROUPS.movementAnimations.filter(id => !id.startsWith('move03'));
  const category = (id, name, actions, weight) => ({ id, name, label: name, actions, weight, noMirror: false });
  const character = { id: 'bailong', name: '白龙', assetRoot: CHARACTER_ASSET_ROOT, geometry: { width: 720, height: 720, feetY: 660, hitBox: { x0: 160, y0: 70, x1: 560, y1: 665 } }, clips, aliases: BAILONG_ALIASES, fallback: 'idle', landing: 'landing', mirror: false, flightAnimations: ['move03left', 'move03right'] };
  // A derived config only: original main-config, user positions and business switches stay intact.
  main.character = character;
  main.pets = main.pets.map(p => ({ ...p, character }));
  main.animationWeights = { idle: 70, turn: 0, move: 5 };
  main.animations = {
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
    events: { balance: Array(6).fill('quota'), whisper: ['01', '08', '04'], workStatus: [['work01', 'work04'], 'work02', 'work03', 'work05', '18', '13'] },
  };
  return merged;
}

export function resolveCharacterAsset(home, name) {
  // No arbitrary filesystem endpoint: only IDs in the validated pack, only while it is selected.
  if (!/^[a-zA-Z0-9]+\.webm$/.test(name)) return undefined;
  const state = resolvedSelection(home);
  const id = name.slice(0, -5);
  if (state.active !== 'bailong' || !Object.hasOwn(state.pack.clips, id)) return undefined;
  try {
    const file = realpathSync(join(state.pack.mediaRoot, name));
    return within(state.pack.mediaRoot, file) && statSync(file).isFile() ? file : undefined;
  } catch { return undefined; }
}
