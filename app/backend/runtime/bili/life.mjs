// Her Bilibili life, phase 1 (read only; nothing is ever posted): random wake-ups inside your windows, picking
// videos to your taste, reading them (and looking at frames when 看画面 is on), sharing the best one on the
// desktop, and two diaries. With the master switch off she does not touch Bilibili at all.
// Design: B站生活设计稿.md. Rhythm, share gates and silence rules follow dsh-bili-whale (MIT);
// its wake-up prompt for an agent became the code below.
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as feed from './feed.mjs';
import * as watch from './watch.mjs';
import * as brain from './prompts.mjs';

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const SHARE_MIN_SCORE = 13, SHARE_REPEAT_DAYS = 7, SILENT_AFTER = 3, SILENT_STOP = 7;

export const DEFAULTS = Object.freeze({
  enabled: false,
  owner: { mid: '', name: '' },
  night: { windows: [{ start: '20:00', end: '24:00', wakes: 1 }], skipChance: 0.3, videos: 5 },
  likes: ['AI 工具与编程', '猫咪', '鬼畜与整活', '游戏', '科普'],
  dislikes: ['带货', '擦边', '标题党', '纯搬运'],
  frames: false,
  share: { enabled: true, daily: 3 },
});

const pad = n => String(n).padStart(2, '0');
export const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const minutesOf = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const clock = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const short = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}
function writeJson(file, value) {
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  renameSync(file + '.tmp', file);
}

/** Settings with every field valid; problems in windows are reported, other fields fall back quietly. */
export function normalizeSettings(raw, { strict = false } = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const num = (v, d, lo, hi) => { const n = Number(v); return v === '' || v === null || v === undefined || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n)); };
  const words = (list, fallback) => Array.isArray(list) ? [...new Set(list.map(w => String(w ?? '').trim().slice(0, 20)).filter(Boolean))].slice(0, 12) : [...fallback];
  const given = Array.isArray(s.night?.windows) ? s.night.windows : DEFAULTS.night.windows;
  const bad = given.find(w => !TIME.test(w?.start) || !TIME.test(w?.end) || minutesOf(w.end) <= minutesOf(w.start));
  if (strict && bad) throw new Error(`作息时段「${bad?.start ?? '?'}–${bad?.end ?? '?'}」不对：开始要早于结束，最晚到 24:00`);
  if (strict && (!given.length || given.length > 3)) throw new Error('作息时段请设 1–3 段');
  const windows = given.filter(w => w !== bad && TIME.test(w?.start) && TIME.test(w?.end) && minutesOf(w.end) > minutesOf(w.start))
    .slice(0, 3).map(w => ({ start: w.start, end: w.end, wakes: Math.round(num(w.wakes, 1, 0, 4)) }));
  return {
    enabled: s.enabled === true,
    owner: { mid: /^\d{1,20}$/.test(String(s.owner?.mid ?? '')) ? String(s.owner.mid) : '', name: String(s.owner?.name ?? '').trim().slice(0, 30) },
    night: { windows: windows.length ? windows : DEFAULTS.night.windows.map(w => ({ ...w })), skipChance: num(s.night?.skipChance, 0.3, 0, 0.95), videos: Math.round(num(s.night?.videos, 5, 1, 8)) },
    likes: words(s.likes, DEFAULTS.likes), dislikes: words(s.dislikes, DEFAULTS.dislikes),
    frames: s.frames === true,
    share: { enabled: s.share?.enabled !== false, daily: Math.round(num(s.share?.daily, 3, 0, 3)) },
  };
}

/**
 * Today's wake-ups: each window gets its wakes at random minutes (never on the hour by design), at least
 * 20 minutes apart, not in the window's last 10 minutes and not before now; used counts wakes already had.
 */
export function planDay(settings, now, random = Math.random, used = {}) {
  const midnight = startOfDay(now), nowMin = (now - midnight) / MIN, wakes = [];
  for (const w of settings.night.windows) {
    const label = `${w.start}–${w.end}`;
    const start = Math.max(minutesOf(w.start), nowMin + 1), end = minutesOf(w.end) - 10;
    const count = Math.max(0, w.wakes - (used[label] ?? 0));
    if (end <= start || !count) continue;
    let last = -Infinity;
    for (const m of Array.from({ length: count }, () => start + random() * (end - start)).sort((a, b) => a - b)) {
      if (m - last < 20) continue;
      last = m;
      wakes.push({ at: Math.round(midnight + m * MIN), window: label, skip: random() < settings.night.skipChance, state: 'planned' });
    }
  }
  return wakes.sort((a, b) => a.at - b.at);
}

/** How quiet she has become: days since your last reaction (or her first share), banded 3 / 7 days. */
export function silenceOf({ lastReaction = 0, firstShare = 0 }, now) {
  const ref = lastReaction || firstShare;
  if (!ref) return { band: 'normal', days: 0 };
  const days = Math.floor((now - ref) / DAY);
  return { band: days < SILENT_AFTER ? 'normal' : days < SILENT_STOP ? 'quiet' : 'faint', days };
}

/** The share gates (fixed, from the original): returns {share:true} or {share:false, why}. */
export function shareDecision({ best, settings, sharedToday, band, recent }) {
  if (!settings.share.enabled) return { share: false, why: '分享开关关着' };
  if (!best) return { share: false, why: '这次没有细看的视频' };
  const cap = band === 'faint' ? 0 : band === 'quiet' ? Math.min(1, settings.share.daily) : settings.share.daily;
  if (sharedToday >= cap) return { share: false, why: band === 'faint' ? '用户很久没回应你的分享了，你决定先不分享' : band === 'quiet' ? '用户这几天没怎么回应，你今天最多只分享 1 条' : '今天的分享额度用完了' };
  if (recent.has(best.bvid)) return { share: false, why: `《${best.title}》${SHARE_REPEAT_DAYS} 天内分享过了` };
  if (best.score < SHARE_MIN_SCORE) return { share: false, why: `最高分只有 ${best.score} 分，没到 ${SHARE_MIN_SCORE} 分` };
  if (short(best.reason, 200).length < 8) return { share: false, why: '说不清为什么值得看' };
  return { share: true };
}

/** Diary entries (## headings), newest first: [{title, body}]. */
export function entriesOf(markdown, limit = 5) {
  return String(markdown ?? '').split(/\n(?=## )/).filter(part => part.startsWith('## '))
    .map(part => ({ title: part.slice(3, part.indexOf('\n') < 0 ? undefined : part.indexOf('\n')).trim(), body: part.slice(part.indexOf('\n') + 1).trim() }))
    .reverse().slice(0, limit);
}

/**
 * The service. Dependencies are passed in so tests can fake Bilibili and the model:
 * client (bili/api.mjs), llm {generate, see, status, visionStatus}, grab(video, timeoutMs) for frames,
 * mood() (the mood service or null), say({text, animation}) when the mood system is off,
 * persona() → {identity, actions}, takeAction(text) → {text, animation}.
 */
export function lifeService({ dataDir, client, llm, grab, mood = () => null, say = () => {}, persona, takeAction, now: clockNow = Date.now, random = Math.random }) {
  const dir = join(dataDir, 'bili');
  mkdirSync(join(dir, 'covers'), { recursive: true });
  const file = name => join(dir, name);
  const files = { settings: file('settings.json'), plan: file('plan.json'), shares: file('shares.json'), seen: file('seen.json'), feedback: file('feedback.json'), log: file('log.jsonl'), letter: file('给你的信.md'), private: file('私人日记.md') };
  let running = false, progress = '', timer = null, lastWake = readJson(file('last-wake.json'), null);

  const settings = () => normalizeSettings(readJson(files.settings, {}));
  const freshStats = () => ({ wakes: 0, watched: 0, shared: [] });
  const readPlan = () => {
    const p = readJson(files.plan, {});
    return { day: String(p.day ?? ''), wakes: Array.isArray(p.wakes) ? p.wakes : [], stats: p.stats && typeof p.stats === 'object' ? { ...freshStats(), ...p.stats } : freshStats() };
  };
  const shares = () => readJson(files.shares, { items: [] }).items ?? [];
  const feedbackData = () => { const f = readJson(files.feedback, {}); return { last: Number(f.last) || 0, events: Array.isArray(f.events) ? f.events : [] }; };
  function log(kind, note = '', extra = {}) {
    try {
      appendFileSync(files.log, JSON.stringify({ at: new Date(clockNow()).toISOString(), kind, note, ...extra }) + '\n');
      if (statSync(files.log).size > 1024 * 1024) {
        const lines = readFileSync(files.log, 'utf8').trim().split('\n');
        writeFileSync(files.log, lines.slice(-1000).join('\n') + '\n');
      }
    } catch { /* The log is for you to read; never let it stop her. */ }
  }
  const step = text => { progress = text; };
  const silence = (now = clockNow()) => {
    const items = shares();
    return silenceOf({ lastReaction: feedbackData().last, firstShare: items.length ? Math.min(...items.map(s => s.at)) : 0 }, now);
  };

  function replan(s = settings(), now = clockNow()) {
    const old = readPlan(), today = dayKey(now);
    const kept = old.day === today ? old.wakes.filter(w => w.state !== 'planned') : [];
    const used = {};
    for (const w of kept) used[w.window] = (used[w.window] ?? 0) + 1;
    writeJson(files.plan, { day: today, wakes: [...kept, ...planDay(s, now, random, used)].sort((a, b) => a.at - b.at), stats: old.day === today ? old.stats : freshStats() });
  }
  function updatePlan(fn) {
    const plan = readPlan();
    fn(plan);
    writeJson(files.plan, plan);
  }

  /** Read one video, logging failures as notes instead of stopping the wake. */
  async function read(bvid, mode, notes) {
    const s = settings();
    try { return await watch.material(client, bvid, { mode, redact: [s.owner.name, s.owner.mid] }); } catch (error) { notes.push(error.message); return null; }
  }
  async function sightOf(video, notes, timeoutMs) {
    try {
      const grid = await grab(video, timeoutMs);
      return await brain.look(llm.see, { image: grid.jpeg, title: video.title });
    } catch (error) { notes.push(`《${short(video.title, 20)}》的画面没看成：${error.message}`); return ''; }
  }
  async function saveCover(video) {
    if (!video.cover) return '';
    const r = await client.bytes(video.cover + '@320w_200h_1c.jpg', { referer: 'https://www.bilibili.com/' });
    if (!r.ok) return '';
    writeFileSync(join(dir, 'covers', video.bvid + '.jpg'), r.body);
    return video.bvid + '.jpg';
  }
  function speak({ text, animation }) {
    if (!text) return;
    const m = mood();
    if (m?.view().enabled) m.utter({ text, animation });
    else say({ text, animation });
  }
  function moodLine() {
    const v = mood()?.view();
    return v?.ok && v.enabled ? `你此刻的心情：${v.label}（${v.reason}）` : '';
  }

  /** One wake-up. manual: you pressed 「现在叫醒她」 (never a skip day). Returns the summary kept as lastWake. */
  async function wake({ manual = false, skip = false } = {}) {
    if (running) return { ok: false, message: '她正在 B 站上，等这一轮看完' };
    running = true;
    const startedAt = clockNow(), s = settings(), notes = [], summary = { at: startedAt, manual, skip: false, ok: false, watched: [], shared: null, notes };
    // Today's record must exist before anything is counted (a wake right after midnight comes before the first tick).
    if (readPlan().day !== dayKey(startedAt)) replan(s, startedAt);
    try {
      step('醒来了，先看看自己的状态…');
      if (llm.status().kind !== 'third-party') throw new Error('先在「聊天用的大模型」里启用第三方 API，她才能看懂视频');
      const api = client.state();
      if (api.banned) throw new Error(`B 站限流中，约 ${api.bannedMinutes} 分钟后恢复，这次没看成`);
      const who = persona(), identity = who.identity;
      const letters = entriesOf(readFileSync(files.letter, { encoding: 'utf8', flag: 'a+' }), 1);
      const privates = entriesOf(readFileSync(files.private, { encoding: 'utf8', flag: 'a+' }), 1);
      const calibration = brain.calibrationOf(privates[0]?.body);
      const quiet = silence(startedAt);
      const fb = feedbackData(), since = Number(readJson(file('last-diary.json'), {}).at) || 0;
      const reactions = fb.events.filter(e => e.at > since).slice(-8);
      const plan = readPlan();
      const ordinal = (plan.day === dayKey(startedAt) ? plan.stats.wakes : 0) + 1;
      const facts = [
        `时间：${new Date(startedAt).toLocaleString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}，今天第 ${ordinal} 次醒来（${manual ? '用户刚刚叫醒了你' : '你按自己的作息醒来'}）`,
        moodLine(),
      ];
      let shared = null, deepResults = [], screened = [];

      if (skip && !manual) {
        summary.skip = true;
        facts.push('这次你不想刷 B 站（随机开摆，这是你的权利）。结合你此刻的心情写写为什么不想看，不要编造看了什么。');
      } else {
        step('在挑今天看什么…');
        const account = client.state().account;
        const { pool, notes: sourceNotes } = await feed.gather(client, { likes: s.likes, loggedIn: !!account });
        notes.push(...sourceNotes);
        const seenMap = readJson(files.seen, {});
        const seen = new Set(Object.keys(seenMap));
        for (const sh of shares()) seen.add(sh.bvid);
        const titlesOf = kind => fb.events.filter(e => e.kind === kind).map(e => `${e.title ?? ''} ${e.reason ?? ''}`);
        const picks = feed.pick(pool, { likes: s.likes, dislikes: s.dislikes, seen, selfName: account?.name ?? '', liked: titlesOf('like'), disliked: titlesOf('dislike'), ownerName: s.owner.name, n: s.night.videos });
        if (!picks.length) throw new Error(pool.length ? '没刷到想看的新视频' : '一条视频都没拿到：' + (notes.join('；') || 'B 站没有返回内容'));
        const quick = [];
        for (const [i, c] of picks.entries()) {
          step(`在粗看第 ${i + 1}/${picks.length} 条：《${short(c.title, 24)}》`);
          const m = await read(c.bv, 'screen', notes);
          if (m) quick.push({ bvid: c.bv, title: m.video.title, text: m.text, m });
        }
        if (!quick.length) throw new Error('挑好的视频一条都没读出来：' + notes.slice(-2).join('；'));
        step('在给看过的视频打分…');
        const scores = await brain.screen(llm.generate, { identity, items: quick, likes: s.likes, dislikes: s.dislikes, calibration });
        screened = quick.map(q => ({ ...q, ...(scores.find(x => x.bvid === q.bvid) ?? { score: 0, take: '' }) })).sort((a, b) => b.score - a.score);
        const now = clockNow();
        for (const q of screened) seenMap[q.bvid] = { at: now, title: q.title, score: q.score };
        for (const [bv, v] of Object.entries(seenMap)) if (now - Number(v.at) > 60 * DAY) delete seenMap[bv];
        writeJson(files.seen, seenMap);
        updatePlan(p => { if (p.day === dayKey(now)) p.stats.watched += screened.length; });
        // The best two (three when the third is close behind) get a careful read.
        const chosen = screened.filter((q, i) => i < 2 || (i === 2 && q.score >= screened[1].score - 1 && q.score >= 8)).slice(0, 3);
        for (const [i, q] of chosen.entries()) {
          step(`在细看第 ${i + 1}/${chosen.length} 条：《${short(q.title, 24)}》`);
          const m = await read(q.bvid, 'deep', notes);
          if (!m) continue;
          let sight = '';
          if (s.frames) { step(`在看《${short(q.title, 24)}》的画面…`); sight = await sightOf(m.video, notes, 90000); }
          try {
            const r = await brain.deep(llm.generate, { identity, material: m.text, sight, likes: s.likes, dislikes: s.dislikes, calibration });
            deepResults.push({ ...r, bvid: q.bvid, title: m.video.title, up: m.video.up, video: m.video, looked: !!sight });
          } catch (error) { notes.push(`《${short(q.title, 20)}》没想明白：${error.message}`); }
        }
        deepResults.sort((a, b) => b.score - a.score);
        const best = deepResults[0];
        if (best && best.score >= SHARE_MIN_SCORE) mood()?.delight(Math.min(60, 25 + (best.score - SHARE_MIN_SCORE) * 5), `在 B 站看到了《${short(best.title, 20)}》`);
        const items = shares(), today = dayKey(clockNow());
        const recent = new Set(items.filter(x => clockNow() - x.at < SHARE_REPEAT_DAYS * DAY).map(x => x.bvid));
        const decision = shareDecision({ best, settings: s, sharedToday: items.filter(x => dayKey(x.at) === today).length, band: quiet.band, recent });
        if (decision.share) {
          const cover = await saveCover(best.video).catch(() => '');
          shared = { id: `${best.bvid}-${clockNow()}`, at: clockNow(), bvid: best.bvid, title: best.title, up: best.up, score: best.score, reason: best.reason, highlight: best.highlight, line: best.share, cover, reaction: '', opened: false };
          writeJson(files.shares, { items: [...items, shared].slice(-100) });
          updatePlan(p => { if (p.day === dayKey(clockNow())) p.stats.shared.push({ bvid: shared.bvid, title: shared.title }); });
          log('share', `分享了《${shared.title}》（${shared.score} 分）`, { bvid: shared.bvid });
        }
        facts.push(
          `粗看了 ${screened.length} 条：\n` + screened.map(q => `- 《${q.title}》${q.score} 分：${q.take}`).join('\n'),
          deepResults.length ? `细看了 ${deepResults.length} 条：\n` + deepResults.map(r => `- 《${r.title}》${r.score} 分${r.looked ? '（也看了画面）' : ''}：${r.thoughts}；最想讲的一刻：${r.highlight}`).join('\n') : '细看的视频都没读成。',
          shared ? `分享：你把《${shared.title}》分享给了用户，理由：${shared.reason}` : `这次没有分享：${decision.why}`,
        );
      }
      const said = reactions.map(e => `${{ like: '👍', dislike: '👎', open: '点开看了', chat: '在聊天里提到了' }[e.kind] ?? e.kind}《${short(e.title, 30)}》`);
      facts.push(said.length ? `用户最近对你分享的反应：${said.join('、')}` : quiet.days >= SILENT_AFTER ? `用户已经 ${quiet.days} 天没有回应你的分享了。${quiet.band === 'faint' ? '今天不分享；写写你现在的心情，不要汇报。' : '安静一点。'}` : '');
      step('在写日记…');
      const written = await brain.diaries(llm.generate, {
        identity, facts: facts.filter(Boolean).join('\n'),
        recentLetter: short(letters[0]?.body, 300), recentPrivate: short(privates[0]?.body, 300),
      });
      const stamp = `## ${dayKey(startedAt)} ${clock(startedAt)}${manual ? '（被叫醒）' : ''}`;
      const table = deepResults.length || screened.length
        ? '\n\n| BV | 标题 | 本鱼的一句话 | 分 |\n|---|---|---|---|\n' + (screened.length ? screened : deepResults).map(q => `| ${q.bvid} | ${short(q.title, 30).replace(/\|/g, '/')} | ${short((deepResults.find(r => r.bvid === q.bvid)?.highlight) || q.take, 40).replace(/\|/g, '/')} | ${q.score} |`).join('\n')
        : '';
      appendFileSync(files.letter, `${existsSync(files.letter) && statSync(files.letter).size ? '\n' : '# 给你的信\n\n'}${stamp}\n${written.letter}${table}\n`);
      appendFileSync(files.private, `${existsSync(files.private) && statSync(files.private).size ? '\n' : '# 私人日记\n\n'}${stamp}\n${written.private}\n`);
      writeJson(file('last-diary.json'), { at: clockNow() });
      log('diary', `写了两本日记${summary.skip ? '（今天不想看）' : ''}`);

      // One line on the desktop per wake: the share, or the diary's line.
      const first = shared && !shares().some(x => x.id !== shared.id);
      if (shared) {
        const taken = who.actions ? takeAction(shared.line) : { text: takeAction(shared.line).text, animation: null };
        speak({ text: (taken.text || `我在 B 站看到《${short(shared.title, 20)}》，想给你看～`) + (first ? '（管理窗口「她的 B 站」里能点开）' : ''), animation: taken.animation });
      } else speak({ text: written.line, animation: null });

      summary.ok = true;
      summary.watched = (screened.length ? screened : []).map(q => ({ bvid: q.bvid, title: q.title, score: q.score }));
      summary.shared = shared ? { bvid: shared.bvid, title: shared.title } : null;
      log(summary.skip ? 'skip' : 'wake', summary.skip ? '今天不想看' : `看了 ${screened.length} 条${shared ? '，分享 1 条' : ''}`, { manual, notes: notes.slice(0, 6) });
    } catch (error) {
      summary.message = error instanceof Error ? error.message : String(error);
      log('error', summary.message, { manual });
    } finally {
      updatePlan(p => { if (p.day === dayKey(startedAt)) p.stats.wakes += 1; });
      summary.seconds = Math.round((clockNow() - startedAt) / 1000);
      lastWake = summary;
      try { writeJson(file('last-wake.json'), summary); } catch { /* Shown from memory until next start. */ }
      running = false;
      step('');
    }
    return summary;
  }

  /** Called every minute: plan the day, then run a wake-up that is due (or mark it missed). */
  async function tick() {
    const s = settings(), now = clockNow();
    if (!s.enabled || running) return;
    if (readPlan().day !== dayKey(now)) replan(s, now);
    const plan = readPlan();
    const due = plan.wakes.find(w => w.state === 'planned' && w.at <= now);
    if (!due) return;
    const end = startOfDay(due.at) + minutesOf(due.window.split('–')[1]) * MIN;
    if (now > end || now - due.at > 3 * HOUR) {
      updatePlan(p => { const w = p.wakes.find(x => x.at === due.at); if (w) w.state = 'missed'; });
      log('missed', `${clock(due.at)} 那次没醒成（软件当时没开）`);
      return;
    }
    updatePlan(p => { const w = p.wakes.find(x => x.at === due.at); if (w) w.state = 'running'; });
    const result = await wake({ skip: due.skip });
    updatePlan(p => { const w = p.wakes.find(x => x.at === due.at); if (w) w.state = result.skip ? 'skipped' : result.ok ? 'done' : 'failed'; });
  }

  function react(id, kind) {
    if (!['like', 'dislike', 'open'].includes(kind)) return { ok: false, message: '未知操作' };
    const items = shares(), item = items.find(x => x.id === id);
    if (!item) return { ok: false, message: '找不到这条分享' };
    if (kind === 'open') item.opened = true;
    else item.reaction = item.reaction === kind ? '' : kind;
    writeJson(files.shares, { items });
    const fb = feedbackData(), now = clockNow();
    writeJson(files.feedback, { last: now, events: [...fb.events, { at: now, kind, bvid: item.bvid, title: item.title, reason: item.reason }].slice(-200) });
    mood()?.event(kind === 'like' ? 'chat' : 'menu');
    return { ok: true };
  }

  function coverOf(name) {
    try { return name ? 'data:image/jpeg;base64,' + readFileSync(join(dir, 'covers', name)).toString('base64') : ''; } catch { return ''; }
  }

  function view() {
    const s = settings(), plan = readPlan(), now = clockNow(), api = client.state(), today = dayKey(now);
    const llmStatus = llm.status(), vision = llm.visionStatus();
    return {
      ok: true, enabled: s.enabled, settings: s, account: api.account,
      api: { banned: api.banned, bannedMinutes: api.bannedMinutes, reads: api.reads },
      llm: { ready: llmStatus.kind === 'third-party', name: llmStatus.name || '', model: llmStatus.model || '' }, vision,
      running, progress,
      plan: plan.day === today ? plan.wakes.map(w => ({ at: w.at, time: clock(w.at), window: w.window, state: w.state, skip: w.state === 'skipped' })) : [],
      today: plan.day === today ? plan.stats : freshStats(),
      silence: silence(now), lastWake,
      shares: shares().slice(-10).reverse().map(x => ({ ...x, cover: coverOf(x.cover) })),
      letter: entriesOf(existsSync(files.letter) ? readFileSync(files.letter, 'utf8') : '', 5),
      private: entriesOf(existsSync(files.private) ? readFileSync(files.private, 'utf8') : '', 5),
    };
  }

  function command(body) {
    const input = body && typeof body === 'object' ? body : {};
    try {
      if (input.action === 'settings') {
        const current = settings();
        const next = normalizeSettings({ ...current, ...input.settings, enabled: current.enabled }, { strict: true });
        writeJson(files.settings, next);
        if (next.enabled) replan(next);
        return view();
      }
      if (input.action === 'enable') {
        const next = { ...settings(), enabled: input.enabled === true };
        writeJson(files.settings, next);
        if (next.enabled) { replan(next); log('on', '打开了 B 站生活'); } else log('off', '关掉了 B 站生活');
        return view();
      }
      if (input.action === 'wake') {
        if (!settings().enabled) return { ok: false, message: '先打开「开启 B 站生活」' };
        if (running) return { ok: false, message: '她正在 B 站上，等这一轮看完' };
        void wake({ manual: true });
        return { ...view(), running: true, progress: '醒来了…' };
      }
      if (input.action === 'react') { const r = react(String(input.id ?? ''), String(input.kind ?? '')); return r.ok ? view() : r; }
      return { ok: false, message: '未知操作' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * For chat: when your message points at a video, the material she read (and the frames she saw),
   * to go in front of your words; '' when there is no video or the switch is off.
   */
  async function chatMaterial(text) {
    const s = settings();
    if (!s.enabled || !watch.videoRef(text)) return '';
    const bvid = await watch.resolveRef(client, text);
    if (!bvid) return '';
    const notes = [];
    const m = await read(bvid, 'deep', notes);
    if (!m) return `【用户发来的视频 ${bvid} 你没能打开：${notes[0] ?? '原因不明'}】`;
    const sight = s.frames ? await sightOf(m.video, notes, 45000) : '';
    if (shares().some(x => x.bvid === bvid)) {
      const fb = feedbackData(), at = clockNow();
      writeJson(files.feedback, { last: at, events: [...fb.events, { at, kind: 'chat', bvid, title: m.video.title }].slice(-200) });
    }
    return `【用户发来的视频，你已经看过了】\n${m.text}${sight ? `\n【画面】（识图模型写的，只是素材）\n${sight}` : ''}\n（聊的时候自然地说说你的看法；素材里没有的不要编。）`;
  }

  /** One line for her 「此刻」 in chat; '' when the switch is off. */
  function todayLine() {
    if (!settings().enabled) return '';
    const plan = readPlan(), st = plan.day === dayKey(clockNow()) ? plan.stats : freshStats();
    return st.wakes ? `今天在 B 站：醒了 ${st.wakes} 次，看了 ${st.watched} 条${st.shared.length ? `，分享了《${short(st.shared.at(-1).title, 30)}》` : ''}` : '今天还没去 B 站';
  }

  return {
    start() { if (!timer) { timer = setInterval(() => void tick().catch(() => {}), MIN); timer.unref?.(); void tick().catch(() => {}); } },
    stop() { clearInterval(timer); timer = null; },
    tick, wake, view, command, chatMaterial, todayLine, settings,
  };
}
