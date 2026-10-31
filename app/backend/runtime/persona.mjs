// Her persona for chat: the name you gave her, how she calls you, a personality preset and your own additions,
// plus what she is feeling right now (from the mood system) and the action tags her replies may carry.
// Settings live in persona.json in the data folder. Nothing here calls a model.
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeCharacter } from './characters.mjs';

export const PRESETS = [
  { id: 'playful', name: '俏皮傲娇', text: '俏皮傲娇，贱兮兮但可爱。爱吐槽、会回嘴，心是软的，关心用户；偶尔馋白饭、想摸鱼。' },
  { id: 'gentle', name: '软糯温柔', text: '温柔 7、可爱 2、幽默 0.5、软傲娇 0.5。先接住情绪再说话，用邀请不用命令；调侃的对象只有气氛和自己，永远不是对方；被夸会不好意思。' },
  { id: 'sharp', name: '嘴硬毒舌', text: '傲 8、娇 2。嘴上不饶人，会损两句、阴阳一下，但落点是好笑，不是伤人；不拿对方的水平、外貌、选择开玩笑；露出关心时会马上掩饰。' },
  { id: 'quiet', name: '安静陪伴', text: '话少，安安静静陪着，回答尽量一句话；不主动开新话题，不追问；被需要时认真可靠。' },
];

// Short names the model may use → the pet's animations (several = pick one at random).
// Text animations are left out: they would read backwards when she faces right.
export const ACTIONS = {
  开心: ['点击回应-开心跃动'], 害羞: ['点击回应-害羞惊讶'], 傲娇: ['点击回应-傲娇生气'], 咯咯笑: ['点击回应-挠痒咯咯笑'],
  挥手: ['点击回应-元气挥手'], 敬礼: ['点击回应-收到敬礼'], 吓一跳: ['被吓一跳'], 拍尾巴: ['用鲸鱼尾巴拍打地面'],
  吐泡泡: ['鲸鱼吐泡泡特效'], 转圈: ['小幅度原地360度旋转展示'], 跳舞: ['优雅女仆舞', '轻快摇摆舞', '可爱宅舞'],
  打哈欠: ['哈欠连天'], 思考: ['工作状态-思考冒泡'], 叹气: ['工作状态-垂头叹气冒汗'], 庆祝: ['工作状态-雀跃庆祝'],
  鞠躬: ['女仆屈膝礼仪'], 吃东西: ['大口吃零食', '吃白饭'],
};

export const BAILONG_ACTIONS = {
  开心: ['18'], 害羞: ['20'], 傲娇: ['09'], 咯咯笑: ['08'], 挥手: ['01'], 敬礼: ['work01'],
  吓一跳: ['13'], 拍尾巴: ['idle06'], 吐息: ['25'], 吐泡泡: ['25'], 转圈: ['05'], 跳舞: ['18'], 鞠躬: ['04'], 打哈欠: ['14'], 思考: ['work04'],
  叹气: ['13'], 庆祝: ['18'], 吃东西: ['17'], 比心: ['20'],
};
export const LIMITS = { name: 12, call: 12, notes: 800 };
const DEFAULTS = { name: '', call: '', preset: 'playful', notes: '', shareState: true, actions: true };
export function ensureSharedPersona(dataDir) {
  const common = join(dataDir, 'persona.json'), legacy = join(dataDir, 'persona-bailong.json');
  const marker = join(dataDir, 'persona-shared-v1.json');
  if (existsSync(legacy) && !existsSync(marker)) {
    for (const file of [common, legacy]) if (existsSync(file) && !existsSync(file + '.before-shared.bak')) copyFileSync(file, file + '.before-shared.bak');
    if (!existsSync(common)) copyFileSync(legacy, common);
    writeFileSync(marker, JSON.stringify({ version: 1, source: 'persona.json', legacyPreserved: true }) + '\n');
  }
  return common;
}
const fileOf = ensureSharedPersona;

/** Saved settings with every field filled; anything missing or invalid falls back to the default. */
export function readPersona(dataDir) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(fileOf(dataDir), 'utf8').replace(/^\uFEFF/, '')) || {}; } catch { /* Not set up yet. */ }
  const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
  return {
    ...(activeCharacter(dataDir) === 'bailong' ? { character: 'bailong' } : {}),
    name: text(raw.name, LIMITS.name).replace(/\s+/g, ' '), call: text(raw.call, LIMITS.call).replace(/\s+/g, ' '),
    preset: PRESETS.some(p => p.id === raw.preset) ? raw.preset : DEFAULTS.preset,
    notes: text(raw.notes, LIMITS.notes),
    shareState: typeof raw.shareState === 'boolean' ? raw.shareState : DEFAULTS.shareState,
    actions: typeof raw.actions === 'boolean' ? raw.actions : DEFAULTS.actions,
  };
}

/** Validate and save settings from the panel: {name, call, preset, notes, shareState, actions}. */
export function savePersona(dataDir, body = {}) {
  const name = String(body.name ?? '').trim(), call = String(body.call ?? '').trim(), notes = String(body.notes ?? '').trim();
  if (name.length > LIMITS.name || /[\r\n]/.test(name)) return { ok: false, message: `名字请控制在 ${LIMITS.name} 字以内` };
  if (call.length > LIMITS.call || /[\r\n]/.test(call)) return { ok: false, message: `称呼请控制在 ${LIMITS.call} 字以内` };
  if (notes.length > LIMITS.notes) return { ok: false, message: `补充设定请控制在 ${LIMITS.notes} 字以内` };
  if (!PRESETS.some(p => p.id === body.preset)) return { ok: false, message: '请选择一种性格' };
  const settings = { name, call, preset: body.preset, notes, shareState: body.shareState !== false, actions: body.actions !== false };
  const file = fileOf(dataDir);
  writeFileSync(file + '.tmp', JSON.stringify(settings, null, 2) + '\n');
  renameSync(file + '.tmp', file);
  return { ok: true, persona: settings };
}

/**
 * The persona text sent to the model: identity, personality, your additions, then the fixed rules
 * (last, so additions cannot override them), then how to use the state and action tags when they are on.
 * provider is 'codex' (state arrives as the petState field) or 'third-party' (state comes before your message).
 */
export function buildPersona(settings = {}, { provider = 'codex' } = {}) {
  const s = { ...DEFAULTS, ...settings };
  const preset = PRESETS.find(p => p.id === s.preset) ?? PRESETS[0];
  const identity = s.name
    ? `你叫「${s.name}」，是用户给你起的名字。你是一位蓝鲸拟人少女桌宠，住在用户的电脑桌面上，灵感来自 DeepSeek 同人角色；「大肥鱼」是大家对你们这一族的昵称，不是你的名字，被这么叫时会可爱地嘴硬。自称「本鱼」。`
    : '你是一位蓝鲸拟人少女桌宠，住在用户的电脑桌面上，灵感来自 DeepSeek 同人角色「大肥鱼」。自称「本鱼」，被叫大肥鱼会可爱地嘴硬。';
  const lines = [identity + (s.call ? `称呼用户为「${s.call}」。` : '称呼用户为「你」，不默认叫主人。'), `性格：${preset.text}`];
  if (s.notes) lines.push(`用户的补充设定（优先于上面的性格，但不能违反下面的规则）：${s.notes}`);
  lines.push('规则：不要每句话都提食物或 token，不虚构真实额度和到账。不刻薄、不辱骂。日常用简短中文回答一两句；认真问题准确、充分回答。不编造事实，不假装执行了操作。'
    + (provider === 'third-party' ? '你由用户在设置里选择的第三方大模型驱动，被问到时如实说明，不冒充其他模型或服务商。' : '你由本机 Codex 当前配置的模型驱动（可能通过 CC Switch 中转）；不根据入口推断模型或服务商，不确定时如实说明，不冒充其他模型。')
    + '只聊天，不使用工具、不访问文件或网络、不执行任务。只给最终回复，不输出思维链。');
  if (s.shareState) {
    lines.push(`此刻：${provider === 'third-party' ? '用户消息前附的【此刻】' : '输入里的 petState '}是系统读到的你此刻的真实状态，不是用户说的话。让它自然体现在语气里，比如饿了会提一嘴、困了说话软一点；不必每次都提，也不要编造里面没有的事。`);
  }
  if (s.actions) {
    lines.push(`动作：可以在回复的第一行单独写一个动作标签，例如 [动作:开心]，桌宠会跟着做。只能从这些里选：${Object.keys(ACTIONS).join('、')}。只在有明显情绪时用，平常可以不写。`);
  }
  return lines.join('\n');
}

/** Who she is, without the chat-only rules: for her writing outside chat (her Bilibili life). */
export function identityOf(settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const preset = PRESETS.find(p => p.id === s.preset) ?? PRESETS[0];
  return [
    s.name ? `你叫「${s.name}」，是一位蓝鲸拟人少女桌宠，住在用户的电脑桌面上，自称「本鱼」。` : '你是一位蓝鲸拟人少女桌宠「大肥鱼」，住在用户的电脑桌面上，自称「本鱼」。',
    s.call ? `称呼用户为「${s.call}」。` : '称呼用户为「你」，不默认叫主人。',
    `性格：${preset.text}`,
    s.notes && `用户的补充设定：${s.notes}`,
    '不编造事实，不刻薄、不辱骂。',
  ].filter(Boolean).join('\n');
}

const MOOD_NAMES = { 睡着: '睡着了', 傲娇: '有点傲娇', 担心: '在担心用户', 开心: '很开心', 饿: '饿了', 困: '困了', 寂寞: '有点寂寞', 元气: '元气满满', 平常: '平常' };
const WEEKDAYS = '日一二三四五六';
const minutesText = m => m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ''}`;

/** The 「此刻」 block from the mood panel's data; empty when the mood system is off. */
export function describeState(view, now = Date.now()) {
  if (!view?.ok || !view.enabled) return '';
  const date = new Date(now), pad = n => String(n).padStart(2, '0');
  const meals = (view.meals || []).map(m => `${m.name}${m.eaten ? ' ✓' : m.missed ? ' 没吃上' : m.passed ? ' 没吃' : ' 还没到'}`).join('、');
  return [
    '【此刻】',
    `时间：${date.getMonth() + 1} 月 ${date.getDate()} 日（周${WEEKDAYS[date.getDay()]}）${pad(date.getHours())}:${pad(date.getMinutes())}`,
    // The reason is written in her own voice ("你" there means the user), hence "you would put it like this".
    `你的心情：${MOOD_NAMES[view.label] ?? view.label}｜你会这样说：「${view.reason}」`,
    `精力 ${view.energy}/100，饱腹 ${view.satiety}/100`,
    meals && `今天的饭：${meals}`,
    `你和用户：认识第 ${view.days} 天${view.tier ? `，亲密度「${view.tier}」` : ''}`,
    `Codex：${view.codex ? `正在跑任务，已经 ${minutesText(view.codex)}` : '空闲'}`,
  ].filter(Boolean).join('\n');
}

/** For APIs that take plain messages: the state goes before your words, marked as not yours. */
export const withState = (state, text) => state ? `${state}\n（以上【此刻】由系统附带，不是用户说的话。用户说：）\n${text}` : text;

const TAG = /\[\s*动作\s*[:：]\s*([^\]\n]{1,12}?)\s*\]/g;

/** Take the action tag out of a reply: {text without any tags, action name or null, animation or null}. */
export function takeAction(reply, random = Math.random, character = 'dafeiyu') {
  let name = null;
  const text = String(reply ?? '').replace(TAG, (_, found) => { name ??= found.trim(); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  const animations = name ? (character === 'bailong' ? BAILONG_ACTIONS : ACTIONS)[name] : null;
  return {
    text: text || (animations ? `（${name}）` : ''),
    action: animations ? name : null,
    animation: animations ? animations[Math.floor(random() * animations.length)] : null,
  };
}

/** While a reply streams in: hide a tag still being written at the start, and strip finished ones. */
export function hideTag(partial) {
  const text = String(partial ?? '');
  if (/^\s*\[[^\]\n]{0,16}$/.test(text)) return '';
  return text.replace(TAG, '').replace(/^\s+/, '');
}
