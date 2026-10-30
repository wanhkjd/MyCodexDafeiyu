// Mood engine for the desktop pet: local rules only (no model calls, no network, no diary).
// Inputs: local clock, Codex activity, reminders, user presence and interactions with the pet.
// Outputs: a mood label with a plain-language reason, animation weight modifiers and mood-aware quotes,
// plus restraint: when she may talk, how often, and the few moments worth speaking up for.
// Phase 3: lines take turns, whisper gaps vary, affection grows day by day into tiers that unlock lines,
// and emotions fade by half-life with a short afterglow (plus one memory of yesterday's longest task).
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export const LABELS = ['睡着', '傲娇', '担心', '开心', '饿', '困', '寂寞', '元气', '平常'];
export const EMOJI = { 睡着: '😴', 傲娇: '😤', 担心: '😟', 开心: '😊', 饿: '😋', 困: '😪', 寂寞: '🥺', 元气: '✨', 平常: '🙂' };

// Meal windows in minutes of the local day. She eats at the first moment Codex is not busy.
export const MEALS = [
  { id: 'breakfast', name: '早饭', start: 7 * 60, end: 9 * 60 + 30, anim: '吃早餐' },
  { id: 'lunch', name: '午饭', start: 11 * 60 + 30, end: 13 * 60 + 30, anim: '吃午餐' },
  { id: 'dinner', name: '晚饭', start: 17 * 60 + 30, end: 19 * 60 + 30, anim: '吃晚餐' },
];
export const SATIETY_DROP_PER_HOUR = 12, MEAL_LEVEL = 85, FEED_GAIN = 15;

// Animation weight modifiers per mood, applied on the pet's 100-point weight scale:
// idle/turn/move multiply the top-level weights, cats multiply category weights, boost adds extra actions.
export const MODS = {
  睡着: { idle: 3, turn: 0.5, move: 0, cats: { 玩耍: 0, 小动作: 0.3, 吃什么: 0.3, 时节: 0.3, 文字: 0.3 }, boost: { 原地小憩沉眠: 60 }, sticky: true },
  困: { idle: 2, move: 0.3, cats: { 玩耍: 0.4 }, boost: { 哈欠连天: 8, 打瞌睡被惊醒: 6, 超大伸懒腰: 6 } },
  饿: { cats: { 吃什么: 2.5 }, boost: { 偷吃零食被抓住: 6, 吃白饭: 6, 大口吃零食: 6, '是啊，吃什么': 6 } },
  开心: { move: 1.5, cats: { 玩耍: 2 }, boost: { 优雅女仆舞: 5, 轻快摇摆舞: 5, 可爱宅舞: 5, 鲸鱼吐泡泡特效: 5 } },
  元气: { move: 1.3, cats: { 玩耍: 1.5 }, boost: { 小幅度原地360度旋转展示: 5, 原地跳跃抓碎头顶物品: 5 } },
  寂寞: { turn: 3, cats: { 玩耍: 0.7 }, boost: { 原地敲击桌面互动: 6 } },
  担心: { move: 0.5, cats: { 玩耍: 0.5 }, boost: { 深度思考碎碎念: 6, 轻快记录: 6 } },
  傲娇: { turn: 2, cats: { 玩耍: 0.5 }, boost: { 用鲸鱼尾巴拍打地面: 10 } },
  平常: null,
};

// How she reacts to a click in each mood; chance < 1 keeps the usual reactions in the mix.
export const CLICKS = {
  睡着: { anim: '打瞌睡被惊醒', lines: ['唔…本鱼没睡！', '（揉眼睛）本鱼只是闭目养神……'] },
  困: { anim: '打瞌睡被惊醒', lines: ['唔…本鱼没睡！', '（揉眼睛）本鱼只是闭目养神……'] },
  饿: { anim: '点击回应-傲娇生气', chance: 0.3, lines: ['不给饭就不给戳！', '戳本鱼不如给本鱼盛碗饭～'] },
  寂寞: { anim: '点击回应-开心跃动', lines: ['你终于理本鱼了！', '嘿嘿，本鱼就知道你会回来～'] },
  傲娇: { anim: '点击回应-傲娇生气', lines: ['再戳就要收费了，一下一碗白饭！', '哼！本鱼生气了（其实没有）'] },
};

// Restraint: proactive whispers per day, mood-based pacing, and backing off while being ignored.
export const TALK_LIMIT = 40;
const TALK_FACTOR = { 困: 2, 寂寞: 0.7, 元气: 0.8 };
const IGNORE_AFTER = 3 * MIN, AWAY_SEC = 300, RETURN_AFTER = 10 * 60e3;
// After she says anything, whispers wait 3 minutes; each whisper round lasts 0.5–1.5x the paced interval.
const TALK_GAP = 3 * MIN, JITTER_MIN = 0.5, JITTER_SPAN = 1;

/** here | away | locked | unknown — idle 5 minutes or a locked screen counts as away. */
export function presenceState(p) {
  return !p?.known ? 'unknown' : p.locked ? 'locked' : p.idleSec >= AWAY_SEC ? 'away' : 'here';
}

// Festivals: lunar dates come from the built-in Chinese calendar; leap months never match.
const LUNAR = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' });
export function lunarOf(date) {
  const parts = LUNAR.formatToParts(date);
  const month = parts.find(p => p.type === 'month')?.value ?? '';
  return { month: Number(month.replace(/\D/g, '')), day: Number(parts.find(p => p.type === 'day')?.value), leap: !/^\d+$/.test(month) };
}
const NEW_YEAR_EVE = { name: '除夕', anim: '吃饺子', line: '除夕快乐！今晚要吃饺子守岁哦～' };
const FESTIVALS = [
  { name: '春节', lunar: [1, 1], anim: '收红包', line: '新年快乐！本鱼给你拜年啦，红包拿来～' },
  { name: '元宵节', lunar: [1, 15], anim: '吃汤圆', line: '元宵节快乐！汤圆要趁热吃～' },
  { name: '端午节', lunar: [5, 5], anim: '吃粽子', line: '端午安康！粽子甜的咸的本鱼都想吃～' },
  { name: '七夕', lunar: [7, 7], anim: '穿针乞巧', line: '七夕快乐～本鱼也想要一双巧手。' },
  { name: '中秋节', lunar: [8, 15], anim: '中秋赏月吃月饼', line: '中秋快乐！月亮好圆，月饼好甜～' },
  { name: '重阳节', lunar: [9, 9], anim: '吃重阳糕', line: '重阳节快乐！登高望远，也别忘了歇歇。' },
  { name: '腊八节', lunar: [12, 8], anim: '吃腊八粥', line: '腊八节到啦，喝碗腊八粥暖暖身子～' },
  { name: '元旦', solar: [1, 1], anim: '放烟花', line: '新年快乐！新的一年也请多多投喂本鱼～' },
  { name: '万圣节', solar: [10, 31], anim: '讨糖南瓜灯', line: '万圣节快乐！不给糖就捣蛋～' },
  { name: '圣诞节', solar: [12, 25], anim: '装点圣诞树', line: '圣诞快乐！本鱼把圣诞树装好啦～' },
];
export function festivalOf(date) {
  const lunar = lunarOf(date);
  if (!lunar.leap) {
    if (lunar.month === 12) {
      const next = new Date(date);
      next.setDate(next.getDate() + 1);
      const tomorrow = lunarOf(next);
      if (!tomorrow.leap && tomorrow.month === 1 && tomorrow.day === 1) return NEW_YEAR_EVE;
    }
    const lunarHit = FESTIVALS.find(f => f.lunar && f.lunar[0] === lunar.month && f.lunar[1] === lunar.day);
    if (lunarHit) return lunarHit;
  }
  return FESTIVALS.find(f => f.solar && f.solar[0] === date.getMonth() + 1 && f.solar[1] === date.getDate()) || null;
}

/** Companion milestones: day 7, 30, 100, then every full 365 days. */
export const isMilestone = days => [7, 30, 100].includes(days) || (days >= 365 && days % 365 === 0);

function greetingGroup(hour) {
  if (hour >= 5 && hour < 11) return '早安';
  if (hour >= 11 && hour < 14) return '午安';
  if (hour >= 14 && hour < 18) return '下午好';
  if (hour >= 18 && hour < 23) return '晚上好';
  return '夜猫子';
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
/** Quiet hours may wrap past midnight (23:00–08:00). */
export function inQuietHours(quiet, date) {
  if (!quiet?.enabled) return false;
  const m = date.getHours() * 60 + date.getMinutes(), start = minutesOf(quiet.start), end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** What happened while you were away, in one sentence (empty when nothing worth mentioning). */
export function awaySummary(events) {
  const done = events.filter(e => e.type === 'success').length, failed = events.filter(e => e.type === 'error').length;
  const meals = events.filter(e => e.type === 'meal').map(e => e.name);
  const parts = [];
  if (done) parts.push(done === 1 ? '刚才那个任务跑完了～' : `刚才 ${done} 个任务都跑完了～`);
  if (failed) parts.push(failed === 1 ? '有个任务没跑成，记得去看看。' : `有 ${failed} 个任务没跑成，记得去看看。`);
  if (meals.length) parts.push(`本鱼自己先吃了${meals.join('和')}。`);
  return parts.join('');
}

const AFFECTION_GAIN = { click: 2, chat: 5, feed: 3, menu: 1 };
const AFFECTION_CAP = { click: 6, chat: 10, feed: 9, menu: 3 }; // per 10 minutes
const EVENTS = ['click', 'drag', 'throw', 'menu', 'feed', 'chat'];

// Affection grows by day: at most 6 × (1 − affection/110) points a day, so the closer she is, the slower it rises.
// A day you were at the computer but never touched her costs 1 point (never below 30); days off cost nothing.
// Tiers only add warmth: from 熟悉 on, friendly click reactions; from 亲近 and 很亲, extra lines.
export const BOND_TIERS = [{ name: '很亲', min: 95 }, { name: '亲近', min: 80 }, { name: '熟悉', min: 60 }, { name: '刚认识', min: 0 }];
export const bondTier = value => BOND_TIERS.find(t => value >= t.min).name;
export const dailyAllowance = start => 6 * (1 - start / 110);
const BOND_FLOOR = 30;
/** Group "平常" also draws from "平常·亲近" at 80 and "平常·很亲" at 95. */
const tierSuffixes = value => [value >= 80 && '·亲近', value >= 95 && '·很亲'].filter(Boolean);
const TIER_CLICK_LABELS = ['平常', '元气', '开心'];

// Emotions are intensities (0–100) that fade by half-life and stack when triggered again.
// At 25 or more they set the mood; joy and pride between 8 and 25 leave an afterglow.
export const EMOTIONS = { joy: { half: 30 * MIN }, proud: { half: 10 * MIN }, annoyed: { half: 2 * MIN } };
const FEEL = 25, GLOW = 8;
const GLOW_GROUPS = { joy: '余温·开心', proud: '余温·骄傲' };
export const levelAt = (e, type, now) => e ? e.level * 0.5 ** (Math.max(0, now - e.at) / EMOTIONS[type].half) : 0;
/** Pride grows with the task: 50 for 10 minutes, 10 more per extra 10 minutes, at most 100. */
export const prideFor = ms => Math.min(100, 50 + 10 * Math.floor(Math.max(0, ms - 10 * MIN) / (10 * MIN)));

// Energy follows the clock; the curve is continuous so the mood never jumps.
const ENERGY_CURVE = [[0, 30], [2, 15], [5.5, 15], [6, 40], [9, 80], [10, 85], [12, 85], [13, 60], [15, 60], [15.5, 80],
  [18, 80], [18.5, 70], [22, 70], [22.5, 45], [23.5, 40], [24, 30]];
export function energyAt(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  for (let i = 1; i < ENERGY_CURVE.length; i++) {
    const [h1, e1] = ENERGY_CURVE[i];
    if (h <= h1) {
      const [h0, e0] = ENERGY_CURVE[i - 1];
      return e0 + (e1 - e0) * (h - h0) / (h1 - h0);
    }
  }
  return ENERGY_CURVE[0][1];
}

export function satietyAt(satiety, now) {
  return clamp(satiety.value - SATIETY_DROP_PER_HOUR * Math.max(0, now - satiety.at) / HOUR);
}

export function formatSpan(ms) {
  const minutes = Math.max(1, Math.round(ms / MIN));
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

function sleepyReason(hour) {
  if (hour >= 22) return '已经很晚了，本鱼眼皮在打架';
  return hour === 0 ? '已经半夜 12 点多了' : `已经凌晨 ${hour} 点了`;
}

/**
 * Pure mood decision. presence.known=false means "no presence data": treated as present, never away.
 * Labels are checked in priority order; the first match wins and carries its reason.
 */
export function computeMood(input) {
  const now = input.now, date = new Date(now), hour = date.getHours();
  const energy = clamp(energyAt(date) + (input.energyBoost || 0));
  const satiety = clamp(input.satiety ?? 60);
  const presence = input.presence || { known: false };
  const away = presence.known && (presence.locked || presence.idleSec >= 600);
  const present = !presence.known || (!presence.locked && presence.idleSec < 300);
  const active = type => (input.emotions || []).filter(e => e.type === type && e.until > now).sort((a, b) => b.until - a.until)[0];
  const errors = (input.errorTimes || []).filter(t => now - t < 30 * MIN);
  const ddl = input.ddl;
  const quietFor = now - (input.lastInteractionAt ?? now);
  const result = (label, reason) => ({ label, reason, energy: Math.round(energy), satiety: Math.round(satiety) });

  if (LABELS.includes(input.override)) return result(input.override, '调试：由 CODEX_PET_MOOD 指定');
  if (hour >= 2 && hour < 6 && away) return result('睡着', '夜深了，你也不在，本鱼先睡会儿');
  const annoyed = active('annoyed');
  if (annoyed) return result('傲娇', annoyed.reason);
  if (errors.length >= 3) return result('担心', `最近 30 分钟 Codex 失败了 ${errors.length} 次`);
  if (ddl?.overdue) return result('担心', `「${ddl.title}」已经过了截止时间`);
  if (ddl && ddl.dueAt - now <= 2 * HOUR) return result('担心', `「${ddl.title}」还剩 ${formatSpan(ddl.dueAt - now)}`);
  const happy = active('proud') || active('joy');
  if (happy) return { ...result('开心', happy.reason), cause: happy.type };
  if (satiety < 25) {
    const reason = input.missedMeal ? `${input.missedMeal}时你一直在忙，本鱼没吃上`
      : input.lastMeal ? `上一顿是${input.lastMeal.name}，已经过去 ${formatSpan(now - input.lastMeal.at)}` : '好久没吃东西了';
    return result('饿', reason);
  }
  if (energy < 35) return result('困', sleepyReason(hour));
  if (present && quietFor >= 90 * MIN) return result('寂寞', `你已经 ${formatSpan(quietFor)} 没理本鱼了`);
  if (energy >= 75 && satiety >= 60) return result('元气', '精神饱满，肚子也饱饱的');
  return result('平常', '一切正常，陪你待着');
}

/** Fill {占位符}; returns null when a placeholder has no value so the line is skipped. */
export function fillLine(line, context) {
  let missing = false;
  const text = line.replace(/\{([^{}]+)\}/g, (_, key) => {
    const value = context[key];
    if (value === undefined || value === null || value === '') { missing = true; return ''; }
    return String(value);
  });
  return missing ? null : text;
}

/**
 * Lines take turns: pick at random from the older half by when each was last said.
 * Lines never said count as oldest; ties go in random order, so newly unlocked lines are not stuck behind the rest.
 */
export function freshest(items, said = {}, random = Math.random) {
  const sorted = items.map((item, i) => ({ item, i, at: said[item.template] ?? 0, key: random() }))
    .sort((a, b) => a.at - b.at || a.key - b.key || a.i - b.i);
  const pool = sorted.slice(0, Math.ceil(sorted.length / 2));
  return pool[Math.floor(random() * pool.length)].item;
}

/**
 * Pick a whisper: usually from the mood's group (group defaults to the label; plus extra groups such as unlocked tiers
 * or an afterglow, and the late-night group at night), otherwise from the general lines, or fallback() when there are none.
 * Lines whose placeholders cannot be filled are skipped; onPick(template) reports the chosen line so it can take its turn.
 */
export function pickMoodQuote({ label, group = label, extra = [], now, groups, context = {}, fallback, general = [], previous = '', said = {}, random = Math.random, onPick = () => {} }) {
  const hour = new Date(now).getHours();
  const names = [group, ...extra];
  if (hour < 5 && label !== '睡着') names.push('深夜');
  const lines = names.flatMap(name => Array.isArray(groups?.[name]) ? groups[name] : [])
    .map(template => ({ template, text: fillLine(template, context) })).filter(line => line.text && line.text !== previous);
  const pool = lines.length && (label === '睡着' || random() < 0.6) ? lines
    : general.filter(text => text !== previous).map(text => ({ template: text, text }));
  if (!pool.length) return fallback();
  const line = freshest(pool, said, random);
  onPick(line.template);
  return line.text;
}

function readGroups(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const groups = {};
    for (const [name, lines] of Object.entries(raw)) {
      if (!Array.isArray(lines)) continue;
      const valid = lines.filter(line => typeof line === 'string' && line.trim() && line.length <= 120);
      if (valid.length) groups[name] = valid;
    }
    return groups;
  } catch { return {}; }
}

// Presence comes from the manager process (system idle time) over stdin; stale data counts as unknown.
// Services subscribe so a return from the computer is noticed right away instead of at the next tick.
let presence = { known: false, idleSec: 0, locked: false, at: 0 };
const presenceListeners = new Set();
export function reportPresence(message, at = Date.now()) {
  const idleSec = Number(message?.idleSec);
  presence = { known: true, idleSec: Number.isFinite(idleSec) && idleSec >= 0 ? idleSec : 0, locked: message?.state === 'locked', at };
  for (const listener of presenceListeners) listener();
}
function presenceAt(now) {
  return presence.known && now - presence.at < 2 * MIN ? presence : { known: false, idleSec: 0, locked: false };
}

const defaultQuotesFile = new URL('../../defaults/mood-quotes.json', import.meta.url);

/**
 * Stateful service: persists mood.json in dataDir, takes events, publishes the pet-facing state.
 * publish(view) feeds the pet's state section; say({text, animation}) makes her speak;
 * play(animation) plays an animation without a bubble (meals during quiet hours or while you are away).
 * bond (CODEX_PET_BOND) forces the affection value for checking tiers; it is never saved.
 */
export function moodService(dataDir, { publish = () => {}, say = () => {}, play = () => {}, reminders, clock = Date.now, random = Math.random, override = process.env.CODEX_PET_MOOD, bond = process.env.CODEX_PET_BOND } = {}) {
  const file = join(dataDir, 'mood.json'), quotesFile = join(dataDir, 'mood-quotes.json');
  const startedAt = clock();
  const forcedBond = bond === undefined || bond === '' || !Number.isFinite(Number(bond)) ? null : clamp(Number(bond));
  // For people who had the pet before the mood system, the data folder's first files tell when she arrived.
  const arrivedAt = now => Math.min(now, ...['quotes.json', join('dsh-pet', 'main-config.jsonc')].map(name => {
    try { const born = statSync(join(dataDir, name)).birthtimeMs; return born > 0 ? born : now; } catch { return now; }
  }));
  const fresh = now => ({
    version: 3, enabled: true, firstSeen: arrivedAt(now), affection: 50, satiety: { value: 60, at: now },
    meals: { date: dayKey(new Date(now)), eaten: [], missed: [], seen: [] }, lastMeal: null, lastInteractionAt: now,
    talk: { date: dayKey(new Date(now)), count: 0 },
    moments: { greeted: '', night: '', milestone: 0 },
    quiet: { enabled: false, start: '23:00', end: '08:00' },
    // said: line → when she last said it; bond: today's affection bookkeeping; highlight: today's longest finished task.
    said: {}, bond: { day: dayKey(new Date(now)), start: 50, gained: 0, seen: false, touched: false }, emotions: {}, highlight: null,
  });
  let db = load(), dirty = false, timer = null, flushTimer = null;
  let errorTimes = [], clickTimes = [], throwTimes = [], wokenAt = -Infinity, jitters = new Map();
  let gained = {}, busy = false, busySince = null, prevState = null, ddl = null, published = '', previousQuote = '';
  let ignored = 0, watchSince = null, lastSayAt = -Infinity, awaySince = null, awayEvents = [], queue = [];

  function load() {
    const now = clock();
    if (!existsSync(file)) return fresh(now);
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8').trim());
      const base = fresh(now);
      const moments = raw.moments && typeof raw.moments === 'object' ? raw.moments : {};
      const quiet = raw.quiet;
      const affection = Number.isFinite(raw.affection) ? clamp(raw.affection) : base.affection;
      const bond = raw.bond, said = raw.said && typeof raw.said === 'object' && !Array.isArray(raw.said) ? raw.said : {};
      return {
        ...base,
        enabled: raw.enabled !== false,
        firstSeen: Math.min(Number.isFinite(raw.firstSeen) ? raw.firstSeen : now, base.firstSeen),
        affection,
        satiety: Number.isFinite(raw.satiety?.value) && Number.isFinite(raw.satiety?.at) ? raw.satiety : base.satiety,
        meals: typeof raw.meals?.date === 'string' && ['eaten', 'missed', 'seen'].every(k => Array.isArray(raw.meals[k])) ? raw.meals : base.meals,
        lastMeal: raw.lastMeal && typeof raw.lastMeal.name === 'string' && Number.isFinite(raw.lastMeal.at) ? raw.lastMeal : null,
        lastInteractionAt: Number.isFinite(raw.lastInteractionAt) ? raw.lastInteractionAt : base.lastInteractionAt,
        talk: typeof raw.talk?.date === 'string' && Number.isFinite(raw.talk?.count) ? raw.talk : base.talk,
        moments: {
          greeted: typeof moments.greeted === 'string' ? moments.greeted : '',
          night: typeof moments.night === 'string' ? moments.night : '',
          milestone: Number.isFinite(moments.milestone) ? moments.milestone : 0,
        },
        quiet: quiet && typeof quiet.enabled === 'boolean' && TIME.test(quiet.start) && TIME.test(quiet.end) ? quiet : base.quiet,
        said: Object.fromEntries(Object.entries(said).filter(([, at]) => Number.isFinite(at))),
        // Files from before phase 3 start today's bookkeeping from the saved affection.
        bond: typeof bond?.day === 'string' && Number.isFinite(bond.start) && Number.isFinite(bond.gained)
          ? { day: bond.day, start: bond.start, gained: bond.gained, seen: bond.seen === true, touched: bond.touched === true }
          : { ...base.bond, start: affection },
        emotions: Object.fromEntries(Object.keys(EMOTIONS).map(type => [type, raw.emotions?.[type]])
          .filter(([, e]) => e && Number.isFinite(e.level) && Number.isFinite(e.at) && typeof e.reason === 'string')),
        highlight: typeof raw.highlight?.day === 'string' && Number.isFinite(raw.highlight?.taskMs) ? raw.highlight : null,
      };
    } catch {
      // Keep the damaged file for inspection and start over rather than staying broken.
      try { renameSync(file, `${file}.corrupt-${now}.bak`); } catch {}
      return fresh(now);
    }
  }
  function save() {
    if (!dirty) return;
    try { writeFileSync(file + '.tmp', JSON.stringify(db, null, 2)); renameSync(file + '.tmp', file); dirty = false; } catch {}
  }
  const groups = () => ({ ...readGroups(defaultQuotesFile), ...readGroups(quotesFile) });
  const bondNow = () => forcedBond ?? db.affection;
  /** A group plus the tier groups unlocked at the current affection. */
  const withTiers = group => [group, ...tierSuffixes(bondNow()).map(suffix => group + suffix)];
  /** A line for a moment, taking turns ({text, template}); null when no line can be filled. */
  function line(group, context = {}) {
    const all = groups();
    const items = withTiers(group).flatMap(name => all[name] || [])
      .map(template => ({ template, text: fillLine(template, context) })).filter(item => item.text);
    return items.length ? freshest(items, db.said, random) : null;
  }
  /** A moment that says the picked line; its template is marked as said once it is spoken. */
  const withLine = (picked, moment) => ({ ...moment, text: picked?.text, templates: picked ? [picked.template] : [] });
  /** The general quotes (quotes.json) in the data folder; empty when unreadable. */
  function readGeneral() {
    try {
      const raw = JSON.parse(readFileSync(join(dataDir, 'quotes.json'), 'utf8').replace(/^\uFEFF/, ''));
      return Array.isArray(raw) ? raw.filter(q => typeof q === 'string' && q.trim() && q.length <= 120) : [];
    } catch { return []; }
  }
  const daysAt = now => Math.floor((startOfDay(now) - startOfDay(db.firstSeen)) / DAY) + 1;
  const presenceNow = now => presenceState(presenceAt(now));
  const isAway = now => ['away', 'locked'].includes(presenceNow(now));
  const canSpeak = now => db.enabled && !inQuietHours(db.quiet, new Date(now));
  /** Add to an emotion; what is left of it keeps fading by its half-life. */
  function feel(type, amount, reason, now) {
    db.emotions[type] = { level: Math.min(100, levelAt(db.emotions[type], type, now) + amount), at: now, reason };
    dirty = true;
  }
  const annoy = (reason, now) => feel('annoyed', levelAt(db.emotions.annoyed, 'annoyed', now) >= FEEL ? 10 : 50, reason, now);
  /** Emotions strong enough to set the mood, in computeMood's {type, until, reason} form. */
  const felt = now => Object.entries(db.emotions).filter(([type, e]) => levelAt(e, type, now) >= FEEL)
    .map(([type, e]) => ({ type, until: e.at + EMOTIONS[type].half * Math.log2(e.level / FEEL), reason: e.reason }));
  /** Joy or pride that has faded below the mood threshold but still lingers. */
  function afterglow(now) {
    const glows = ['proud', 'joy'].map(type => ({ type, level: levelAt(db.emotions[type], type, now), reason: db.emotions[type]?.reason }))
      .filter(g => g.level >= GLOW && g.level < FEEL);
    return glows.sort((a, b) => b.level - a.level)[0] || null;
  }
  function rollDay(now) {
    const key = dayKey(new Date(now));
    if (db.meals.date !== key) { db.meals = { date: key, eaten: [], missed: [], seen: [] }; dirty = true; }
    if (db.talk.date !== key) { db.talk = { date: key, count: 0 }; dirty = true; }
    if (db.bond.day !== key) {
      // A day you were here but never touched her costs a point; days she did not see you cost nothing.
      if (db.bond.seen && !db.bond.touched) db.affection = Math.max(Math.min(db.affection, BOND_FLOOR), db.affection - 1);
      db.bond = { day: key, start: db.affection, gained: 0, seen: false, touched: false };
      const forgotten = now - 14 * DAY;
      for (const [template, at] of Object.entries(db.said)) if (at < forgotten) delete db.said[template];
      dirty = true;
    }
  }
  function missedMeal() {
    const id = db.meals.missed.at(-1);
    return id && !MEALS.slice(MEALS.findIndex(m => m.id === id) + 1).some(m => db.meals.eaten.includes(m.id))
      ? MEALS.find(m => m.id === id)?.name : '';
  }
  function evaluate(now = clock()) {
    const mood = computeMood({
      now, override,
      energyBoost: 10 * Math.max(0, 1 - (now - wokenAt) / (20 * MIN)),
      satiety: satietyAt(db.satiety, now),
      lastMeal: db.lastMeal, missedMeal: missedMeal(),
      presence: presenceAt(now),
      lastInteractionAt: Math.max(db.lastInteractionAt, startedAt),
      emotions: felt(now), errorTimes, ddl,
    });
    const glow = ['平常', '元气'].includes(mood.label) ? afterglow(now) : null;
    if (!glow) return mood;
    const lingering = `还留着刚才的好心情（${glow.reason}）`;
    return { ...mood, glow: glow.type, reason: mood.label === '平常' ? lingering : `${mood.reason}，${lingering}` };
  }
  /** Joy's afterglow makes her a little more playful. */
  function modsFor(label, glow) {
    const mods = MODS[label] ?? null;
    if (glow !== 'joy') return mods;
    return { ...mods, cats: { ...mods?.cats, 玩耍: (mods?.cats?.玩耍 ?? 1) * 1.2 } };
  }
  /** Mood reactions first; otherwise, from 熟悉 on, a friendly reaction now and then when she is calm or happy. */
  function clickFor(label) {
    if (CLICKS[label]) return CLICKS[label];
    const value = bondNow();
    if (value < 60 || !TIER_CLICK_LABELS.includes(label)) return null;
    const all = groups();
    const lines = ['戳·熟悉', ...tierSuffixes(value).map(suffix => '戳' + suffix)].flatMap(name => all[name] || []).filter(l => !l.includes('{'));
    return lines.length ? { anim: '点击回应-开心跃动', chance: 0.25, lines } : null;
  }
  function publishNow(now = clock()) {
    const mood = db.enabled ? evaluate(now) : null;
    const key = mood ? `${mood.label}|${bondTier(bondNow())}|${mood.glow || ''}` : 'off';
    if (key === published) return mood;
    published = key;
    publish(mood ? { enabled: true, label: mood.label, mods: modsFor(mood.label, mood.glow), click: clickFor(mood.label) } : { enabled: false });
    return mood;
  }

  // Moments are queued and spoken one at a time, only when she may speak and you are at the computer.
  // A line takes its turn (is marked as said) only once it is actually spoken.
  function speak(said, now) {
    say({ text: said.text, animation: said.animation });
    for (const template of said.templates || []) if (template) { db.said[template] = now; dirty = true; }
    lastSayAt = now;
  }
  function queueMoment(moment, now) {
    if (!moment.text) return;
    const item = { allowBusy: false, notBefore: now, expires: now + 2 * HOUR, ...moment };
    queue.push(item);
    if (item.notBefore > now) {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => flush(), item.notBefore - now + 50);
      flushTimer.unref?.();
    }
  }
  function flush(now = clock()) {
    queue = queue.filter(m => m.expires > now);
    if (!canSpeak(now) || isAway(now) || now - lastSayAt < 15e3) return false;
    const index = queue.findIndex(m => m.notBefore <= now && (m.allowBusy || !busy));
    if (index < 0) return false;
    const [moment] = queue.splice(index, 1);
    speak({ text: moment.text, animation: moment.animation, templates: moment.templates }, now);
    return true;
  }
  function greet(now, extra = '') {
    const date = new Date(now), days = daysAt(now), festival = festivalOf(date);
    const first = days === 1 && !db.moments.greeted;
    const main = festival ? { text: festival.line } : line(first ? '初次见面' : greetingGroup(date.getHours()));
    const milestone = isMilestone(days) && db.moments.milestone < days ? line('纪念日', { 陪伴天数: days }) : null;
    db.moments.greeted = dayKey(date);
    if (milestone) db.moments.milestone = days;
    dirty = true;
    const animation = festival?.anim || (milestone ? '点击回应-开心跃动' : '点击回应-元气挥手');
    const parts = [main, milestone].filter(Boolean);
    queueMoment({ text: [...parts.map(p => p.text), extra].filter(Boolean).join(' '), templates: parts.map(p => p.template), animation, allowBusy: true }, now);
    recallYesterday(now);
  }
  // Overnight afterglow: yesterday's longest finished task comes up once after the day's first greeting, then is forgotten.
  // A greeting before 5 a.m. is still "last night", so it lets the memory go without a word.
  function recallYesterday(now) {
    const memory = db.highlight;
    if (!memory || memory.day === dayKey(new Date(now))) return;
    db.highlight = null;
    dirty = true;
    if (memory.day !== dayKey(new Date(startOfDay(now) - 12 * HOUR)) || new Date(now).getHours() < 5) return;
    const picked = line('昨天的好事', { 昨天的任务时长: formatSpan(memory.taskMs) });
    queueMoment(withLine(picked, { allowBusy: true, notBefore: now + 20e3, expires: now + 30 * MIN }), now);
  }
  function checkPresence(now) {
    const p = presenceAt(now), state = presenceState(p);
    if (state === 'away' || state === 'locked') {
      if (awaySince === null) awaySince = now - p.idleSec * 1000;
      return;
    }
    if (state !== 'here' || awaySince === null) return;
    const gone = now - awaySince, summary = awaySummary(awayEvents);
    awaySince = null;
    awayEvents = [];
    if (gone < RETURN_AFTER || !canSpeak(now)) return;
    if (db.moments.greeted !== dayKey(new Date(now))) { greet(now, summary); return; }
    const back = summary ? { text: '你回来啦！' + summary } : line('回来', { 离开时长: formatSpan(gone) });
    queueMoment(withLine(back, { animation: '点击回应-元气挥手', allowBusy: true }), now);
  }
  function maybeGreet(now) {
    if (canSpeak(now) && db.moments.greeted !== dayKey(new Date(now)) && ['here', 'unknown'].includes(presenceNow(now))) greet(now);
  }
  function maybeNudge(now) {
    const date = new Date(now), minute = date.getHours() * 60 + date.getMinutes(), key = dayKey(date);
    if (!canSpeak(now) || !busy || minute < 30 || minute >= 5 * 60 || presenceNow(now) !== 'here' || db.moments.night === key) return;
    db.moments.night = key;
    dirty = true;
    queueMoment(withLine(line('深夜劝睡'), { animation: '哈欠连天', allowBusy: true }), now);
  }
  function eat(meal, now) {
    db.meals.eaten.push(meal.id);
    db.lastMeal = { id: meal.id, name: meal.name, at: now };
    db.satiety = { value: Math.max(satietyAt(db.satiety, now), MEAL_LEVEL), at: now };
    dirty = true;
    feel('joy', 50, `刚吃完${meal.name}`, now);
    if (isAway(now)) awayEvents.push({ type: 'meal', name: meal.name });
    if (canSpeak(now) && !isAway(now)) {
      const said = withLine(line('开饭', { 这一顿: meal.name }), { animation: meal.anim });
      speak({ ...said, text: said.text || '开饭啦～' }, now);
    } else play(meal.anim);
  }
  function checkMeals(now) {
    const date = new Date(now), minute = date.getHours() * 60 + date.getMinutes();
    for (const meal of MEALS) {
      const eaten = db.meals.eaten.includes(meal.id);
      if (minute >= meal.start && minute < meal.end) {
        if (!db.meals.seen.includes(meal.id)) { db.meals.seen.push(meal.id); dirty = true; }
        if (!eaten && !busy && now - lastSayAt >= 15e3) eat(meal, now);
      } else if (minute >= meal.end && !eaten && db.meals.seen.includes(meal.id) && !db.meals.missed.includes(meal.id)) {
        db.meals.missed.push(meal.id);
        dirty = true;
        queueMoment(withLine(line('错过饭点', { 这一顿: meal.name }), { animation: '偷吃零食被抓住' }), now);
      }
    }
  }
  async function refreshDdl(now) {
    if (!reminders) return;
    try {
      const snap = await reminders();
      const items = (snap?.items || []).filter(i => i.enabled && i.repeat !== 'daily');
      const overdue = (snap?.alerts || []).map(a => a.item).find(i => i && i.enabled && i.repeat === 'once' && i.dueAt <= now);
      const next = items.filter(i => i.dueAt > now).sort((a, b) => a.dueAt - b.dueAt)[0];
      ddl = overdue ? { title: overdue.title, dueAt: overdue.dueAt, overdue: true } : next ? { title: next.title, dueAt: next.dueAt, overdue: false } : null;
    } catch { /* Reminders are optional input. */ }
  }
  async function tick() {
    const now = clock();
    rollDay(now);
    if (presenceNow(now) === 'here' && !db.bond.seen) { db.bond.seen = true; dirty = true; }
    // A whisper nobody reacted to within 3 minutes slows the next ones down (any interaction clears watchSince).
    if (watchSince !== null && now - watchSince >= IGNORE_AFTER) {
      ignored = Math.min(4, ignored + 1);
      watchSince = null;
    }
    await refreshDdl(now);
    if (db.enabled) {
      checkPresence(now);
      // Nothing is said right after start: the pet window ignores what was said before its first poll.
      if (now - startedAt >= 20e3) {
        maybeGreet(now);
        maybeNudge(now);
        flush(now);
        checkMeals(now);
      }
    }
    publishNow(now);
    save();
  }
  const onPresence = () => { const now = clock(); if (!db.enabled) return; checkPresence(now); flush(now); };

  return {
    start() {
      if (timer) return;
      presenceListeners.add(onPresence);
      void tick();
      timer = setInterval(() => void tick(), 30e3);
      timer.unref?.();
    },
    stop() {
      presenceListeners.delete(onPresence);
      if (timer) clearInterval(timer);
      clearTimeout(flushTimer);
      timer = null;
      save();
    },
    tick,
    flush,
    /** Interaction reported by the pet window, the control game or chat. */
    event(type, now = clock()) {
      if (!EVENTS.includes(type)) return { ok: false, message: '未知互动' };
      rollDay(now);
      const before = db.enabled ? evaluate(now).label : '';
      db.lastInteractionAt = now;
      db.bond.seen = db.bond.touched = true;
      dirty = true;
      ignored = 0;
      watchSince = null;
      // Each kind of interaction is capped per 10 minutes; what counts is also capped by the day's allowance.
      const gain = AFFECTION_GAIN[type] || 0;
      if (gain) {
        const window = gained[type] && now - gained[type].since < 10 * MIN ? gained[type] : { since: now, total: 0 };
        const raw = Math.min(gain, AFFECTION_CAP[type] - window.total);
        if (raw > 0) {
          window.total += raw;
          const add = Math.min(raw, dailyAllowance(db.bond.start) - db.bond.gained);
          if (add > 0) { db.affection = clamp(db.affection + add); db.bond.gained += add; }
        }
        gained[type] = window;
      }
      if (type === 'click') {
        clickTimes = [...clickTimes.filter(t => now - t < 10e3), now];
        if (clickTimes.length >= 5) annoy('被连戳了好几下', now);
        if (before === '困' || before === '睡着') wokenAt = now;
      }
      if (type === 'throw') {
        throwTimes = [...throwTimes.filter(t => now - t < MIN), now];
        if (throwTimes.length >= 3) annoy('被扔来扔去', now);
      }
      if (type === 'feed') {
        db.satiety = { value: Math.min(100, satietyAt(db.satiety, now) + FEED_GAIN), at: now };
        feel('joy', 50, '刚被你投喂', now);
      }
      publishNow(now);
      return { ok: true };
    },
    /** Codex activity snapshot ({state}) from the local activity monitor. */
    activity(snapshot, now = clock()) {
      const state = snapshot?.state ?? null;
      busy = state !== null && state !== 'success' && state !== 'error';
      if (state === prevState) return;
      prevState = state;
      if (busy && busySince === null) busySince = now;
      const away = isAway(now);
      // Results that arrive while you are away are kept for the "welcome back" line.
      if (away && (state === 'success' || state === 'error')) awayEvents.push({ type: state });
      if (state === 'success' && busySince !== null && now - busySince >= 10 * MIN) {
        const ran = now - busySince, day = dayKey(new Date(now));
        feel('proud', prideFor(ran), `刚陪你跑完一个 ${formatSpan(ran)}的任务`, now);
        // Today's longest finished task is remembered for tomorrow's greeting.
        if (db.highlight?.day !== day || ran > db.highlight.taskMs) db.highlight = { day, taskMs: ran };
        // Wait for the work-status celebration to finish before speaking up.
        if (!away) queueMoment(withLine(line('收工'), { animation: '点击回应-收到敬礼', allowBusy: true, notBefore: now + 15e3, expires: now + 10 * MIN }), now);
      }
      if (state === 'error') {
        errorTimes = [...errorTimes.filter(t => now - t < 30 * MIN), now];
        if (errorTimes.length === 3 && !away) queueMoment(withLine(line('安慰'), { animation: '工作状态-垂头叹气冒汗', allowBusy: true, notBefore: now + 15e3, expires: now + 10 * MIN }), now);
      }
      if (!busy) busySince = null;
      publishNow(now);
    },
    /** Whether an automatic whisper may be said now (asleep, away, quiet hours and the daily limit say no). */
    mayWhisper(now = clock()) {
      if (!db.enabled) return true;
      rollDay(now);
      return evaluate(now).label !== '睡着' && !isAway(now) && !inQuietHours(db.quiet, new Date(now))
        && db.talk.count < TALK_LIMIT && now - lastSayAt >= TALK_GAP;
    },
    /**
     * Seconds until the next automatic whisper: mood pace times the ignored back-off (up to 3x).
     * Given the round's start, a 0.5–1.5x factor drawn once per round keeps her off the clock.
     */
    whisperPeriod(baseSec, now = clock(), roundStart) {
      if (!db.enabled) return baseSec;
      const sec = baseSec * (TALK_FACTOR[evaluate(now).label] ?? 1) * Math.min(3, 1 + 0.5 * ignored);
      if (roundStart === undefined) return sec;
      if (!jitters.has(roundStart)) {
        jitters.set(roundStart, JITTER_MIN + JITTER_SPAN * random());
        for (const old of [...jitters.keys()].slice(0, -8)) jitters.delete(old);
      }
      return sec * jitters.get(roundStart);
    },
    /** An automatic whisper was said: count it and watch whether you react (from the first unanswered one). */
    whispered(now = clock()) {
      if (!db.enabled) return;
      rollDay(now);
      db.talk.count++;
      dirty = true;
      if (watchSince === null) watchSince = now;
      lastSayAt = now;
    },
    /** Whisper text for the current mood; fallback() returns a general quote. */
    quote(fallback, now = clock()) {
      if (!db.enabled) return fallback();
      const mood = evaluate(now);
      const quiet = now - Math.max(db.lastInteractionAt, startedAt);
      const context = {
        上一顿: db.lastMeal?.name,
        未理时长: quiet >= 10 * MIN ? formatSpan(quiet) : '',
        DDL名: ddl?.title, DDL剩余: ddl && !ddl.overdue ? formatSpan(ddl.dueAt - now) : '',
        陪伴天数: daysAt(now),
      };
      // Happiness from a finished task gets its own lines; meals and feeding use the 开心 group.
      // Unlocked tiers and an afterglow add their groups; the general quotes take turns too.
      const group = mood.cause === 'proud' ? '骄傲' : mood.label;
      const extra = [...withTiers(group).slice(1), ...(mood.glow ? [GLOW_GROUPS[mood.glow]] : [])];
      previousQuote = pickMoodQuote({
        label: mood.label, group, extra, now, groups: groups(), context, fallback, general: readGeneral(),
        previous: previousQuote, said: db.said, random, onPick: template => { db.said[template] = now; dirty = true; },
      });
      return previousQuote;
    },
    view(now = clock()) {
      const mood = evaluate(now);
      const date = new Date(now), minute = date.getHours() * 60 + date.getMinutes();
      return {
        ok: true, enabled: db.enabled, label: mood.label, emoji: EMOJI[mood.label], reason: mood.reason,
        energy: mood.energy, satiety: mood.satiety, affection: Math.round(bondNow()), tier: bondTier(bondNow()),
        glow: mood.glow === 'joy' ? '开心' : mood.glow === 'proud' ? '骄傲' : '',
        presence: presenceNow(now),
        days: daysAt(now),
        meals: MEALS.map(m => ({ name: m.name, eaten: db.meals.eaten.includes(m.id), missed: db.meals.missed.includes(m.id), passed: minute >= m.end })),
        talk: { today: db.talk.date === dayKey(date) ? db.talk.count : 0, limit: TALK_LIMIT, ignored },
        quiet: { ...db.quiet, active: inQuietHours(db.quiet, date) },
        festival: festivalOf(date)?.name || '',
        // Minutes the current Codex task has been running (null when idle), for her 「此刻」 in chat.
        codex: busy && busySince !== null ? Math.max(1, Math.round((now - busySince) / MIN)) : null,
      };
    },
    /** A chat reply counts as speech: whispers wait their 3 minutes after it too. */
    spoke(now = clock()) {
      lastSayAt = now;
    },
    /** A line from her life elsewhere (Bilibili): queued like other moments, said when she may speak and you are here. */
    utter({ text, animation, within = 6 * HOUR } = {}, now = clock()) {
      queueMoment({ text, animation, allowBusy: true, expires: now + within, templates: [] }, now);
      flush(now);
    },
    /** Joy from her life elsewhere (a video she loved); it fades by its half-life like any other joy. */
    delight(amount, reason, now = clock()) {
      if (!db.enabled) return;
      feel('joy', amount, reason, now);
      publishNow(now);
    },
    command(body, now = clock()) {
      if (body?.action !== 'settings') return { ok: false, message: '未知操作' };
      if (body.quiet !== undefined) {
        const q = body.quiet;
        if (!q || typeof q.enabled !== 'boolean' || !TIME.test(q.start) || !TIME.test(q.end)) return { ok: false, message: '安静时段请填写 00:00～23:59 之间的时间' };
        db.quiet = { enabled: q.enabled, start: q.start, end: q.end };
      }
      if (typeof body.enabled === 'boolean') db.enabled = body.enabled;
      dirty = true;
      save();
      publishNow(now);
      return this.view(now);
    },
  };
}
