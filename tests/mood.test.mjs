// Unit tests for the mood engine. Run from the repository root: node --test tests/mood.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(join(import.meta.dirname, '..', 'app', 'backend', 'runtime', 'mood.mjs'));
const { computeMood, energyAt, satietyAt, fillLine, pickMoodQuote, moodService, reportPresence, MODS, CLICKS, formatSpan,
  festivalOf, isMilestone, inQuietHours, awaySummary, TALK_LIMIT, freshest, dailyAllowance, prideFor } = await import(moduleUrl);

const at = (h, m = 0, day = 26) => new Date(2026, 9, day, h, m).getTime();
const MIN = 60e3, HOUR = 60 * MIN;
const tempDir = () => mkdtempSync(join(tmpdir(), 'mood-test-'));
const base = now => ({ now, satiety: 70, lastInteractionAt: now, presence: { known: true, idleSec: 0, locked: false } });

test('energy follows the day curve', () => {
  assert.equal(Math.round(energyAt(new Date(at(10)))), 85);
  assert.equal(Math.round(energyAt(new Date(at(3)))), 15);
  assert.equal(Math.round(energyAt(new Date(at(14)))), 60);
  assert.ok(energyAt(new Date(at(7, 30))) > 40 && energyAt(new Date(at(7, 30))) < 80);
});

test('satiety drops 12 per hour and never below 0', () => {
  assert.equal(satietyAt({ value: 85, at: at(12) }, at(17)), 25);
  assert.equal(satietyAt({ value: 30, at: at(12) }, at(20)), 0);
});

test('labels follow the documented priority', () => {
  assert.equal(computeMood({ ...base(at(3)), presence: { known: true, idleSec: 900 } }).label, '睡着');
  assert.equal(computeMood({ ...base(at(3)) }).label, '困', 'present at 3am is sleepy, not asleep');
  assert.equal(computeMood({ ...base(at(10)), emotions: [{ type: 'annoyed', until: at(10, 2), reason: 'x' }], errorTimes: [at(9, 50), at(9, 55), at(9, 58)] }).label, '傲娇');
  const worried = computeMood({ ...base(at(10)), errorTimes: [at(9, 40), at(9, 50), at(9, 55)] });
  assert.equal(worried.label, '担心');
  assert.match(worried.reason, /失败了 3 次/);
  assert.equal(computeMood({ ...base(at(10)), errorTimes: [at(9, 0), at(9, 50), at(9, 55)] }).label, '元气', 'old errors expire');
  assert.match(computeMood({ ...base(at(10)), ddl: { title: '周报', dueAt: at(11, 30), overdue: false } }).reason, /「周报」还剩 1 小时 30 分钟/);
  assert.equal(computeMood({ ...base(at(10)), ddl: { title: '周报', dueAt: at(15), overdue: false } }).label, '元气', 'far DDL is no worry');
  assert.equal(computeMood({ ...base(at(10)), emotions: [{ type: 'joy', until: at(10, 20), reason: '刚吃完早饭' }] }).label, '开心');
  const hungry = computeMood({ ...base(at(14)), satiety: 20, missedMeal: '午饭' });
  assert.equal(hungry.label, '饿');
  assert.equal(hungry.reason, '午饭时你一直在忙，本鱼没吃上');
  assert.match(computeMood({ ...base(at(1)) }).reason, /凌晨 1 点/);
  assert.equal(computeMood({ ...base(at(16)), lastInteractionAt: at(14) }).label, '寂寞');
  assert.equal(computeMood({ ...base(at(16)), lastInteractionAt: at(14), presence: { known: true, idleSec: 600 } }).label, '元气', 'not lonely when away');
  assert.equal(computeMood({ ...base(at(14)) }).label, '平常');
  assert.equal(computeMood({ ...base(at(14)), override: '饿' }).label, '饿');
});

test('every mood has consistent modifiers and click reactions', () => {
  for (const [label, mods] of Object.entries(MODS)) {
    if (!mods) continue;
    for (const value of Object.values(mods.boost)) assert.ok(value > 0, label);
  }
  for (const click of Object.values(CLICKS)) assert.ok(click.anim && click.lines.length);
});

test('quotes fill placeholders and skip lines that cannot be filled', () => {
  assert.equal(fillLine('还剩 {DDL剩余}', { DDL剩余: '1 小时' }), '还剩 1 小时');
  assert.equal(fillLine('还剩 {DDL剩余}', {}), null);
  const groups = { 担心: ['「{DDL名}」快到了', '别慌'] };
  const picks = new Set();
  for (let i = 0; i < 40; i++) picks.add(pickMoodQuote({ label: '担心', now: at(10), groups, context: {}, fallback: () => 'general', random: Math.random }));
  assert.ok(!picks.has('「undefined」快到了') && picks.has('别慌') && picks.has('general'));
  assert.equal(pickMoodQuote({ label: '平常', now: at(10), groups, fallback: () => 'general' }), 'general');
  assert.equal(formatSpan(90 * MIN), '1 小时 30 分钟');
});

function harness(start, options = {}) {
  let now = start;
  const said = [], published = [], played = [];
  const dir = options.dir || tempDir();
  // seed: a partial mood.json written before the service starts (e.g. already greeted today).
  if (options.seed) writeFileSync(join(dir, 'mood.json'), JSON.stringify(options.seed));
  const service = moodService(dir, { clock: () => now, say: s => said.push(s), publish: v => published.push(v), play: a => played.push(a), override: '', bond: '', ...options });
  return { dir, service, said, published, played, set: t => { now = t; }, get now() { return now; } };
}
const greeted = (day = 26) => ({ moments: { greeted: `2026-10-${String(day).padStart(2, '0')}`, night: '', milestone: 0 } });

test('she eats lunch at the first idle moment in the window', async () => {
  const h = harness(at(11), { seed: greeted() });
  reportPresence({ idleSec: 0 }, at(11, 31));
  h.set(at(11, 31));
  await h.service.tick();
  assert.equal(h.said.length, 1);
  assert.equal(h.said[0].animation, '吃午餐');
  assert.match(h.said[0].text, /午饭/);
  const view = h.service.view();
  assert.equal(view.satiety, 85);
  assert.equal(view.label, '开心');
  await h.service.tick();
  assert.equal(h.said.length, 1, 'eats only once per meal');
});

test('busy through lunch means a missed meal, a grumble once free, and hunger', async () => {
  const h = harness(at(11), { seed: greeted() });
  h.service.activity({ state: 'working' }, at(11, 20));
  for (const t of [at(11, 40), at(12, 30), at(13, 20)]) { h.set(t); reportPresence({ idleSec: 0 }, t); await h.service.tick(); }
  h.service.activity({ state: null }, at(13, 40));
  h.set(at(14, 30)); reportPresence({ idleSec: 0 }, at(14, 30));
  await h.service.tick();
  assert.equal(h.said.length, 0);
  const view = h.service.view();
  assert.equal(view.label, '饿');
  assert.equal(view.reason, '午饭时你一直在忙，本鱼没吃上');
  assert.deepEqual(view.meals.find(m => m.name === '午饭'), { name: '午饭', eaten: false, missed: true, passed: true });
  h.set(at(14, 31)); reportPresence({ idleSec: 0 }, at(14, 31));
  await h.service.tick();
  assert.equal(h.said.length, 1, 'the missed-meal grumble comes once she may speak');
  assert.match(h.said[0].text, /午饭/);
  assert.equal(h.said[0].animation, '偷吃零食被抓住');
});

test('click spam makes her annoyed and feeding makes her happy', () => {
  const h = harness(at(15));
  for (let i = 0; i < 5; i++) h.service.event('click', at(15) + i * 1000);
  h.set(at(15) + 5000);
  assert.equal(h.service.view().label, '傲娇');
  h.set(at(15, 10));
  assert.notEqual(h.service.view().label, '傲娇', 'annoyance fades after 2 minutes');
  const before = h.service.view().satiety;
  h.service.event('feed', at(15, 10));
  assert.equal(h.service.view().satiety, Math.min(100, before + 15));
  assert.equal(h.service.view().label, '开心');
  assert.deepEqual(h.service.event('dance'), { ok: false, message: '未知互动' });
});

test('affection grows a little each day, more slowly the closer she is', () => {
  const h = harness(at(15));
  for (let i = 0; i < 10; i++) h.service.event('click', at(15) + i * 20e3);
  assert.equal(h.service.view().affection, 53, 'capped by the day: 6 × (1 − 50/110) ≈ 3.3');
  h.service.event('chat', at(15, 4));
  assert.equal(h.service.view().affection, 53, 'the day\'s allowance is used up');
  h.set(at(15, 0, 27));
  h.service.event('chat', at(15, 0, 27));
  assert.equal(h.service.view().affection, 56, 'a new day brings a new, slightly smaller allowance');
  assert.ok(dailyAllowance(95) < dailyAllowance(50) / 3);
});

test('a long successful task makes her proud; three failures worry her', () => {
  const h = harness(at(15));
  h.service.activity({ state: 'thinking' }, at(15));
  h.service.activity({ state: 'working' }, at(15, 5));
  h.service.activity({ state: 'success' }, at(15, 12));
  h.set(at(15, 13));
  const view = h.service.view();
  assert.equal(view.label, '开心');
  assert.match(view.reason, /12 分钟的任务/);
  for (const m of [20, 25, 30]) { h.service.activity({ state: 'working' }, at(15, m)); h.service.activity({ state: 'error' }, at(15, m + 1)); }
  h.set(at(15, 32));
  assert.equal(h.service.view().label, '担心');
});

test('happiness from a finished task uses the 骄傲 lines, from food the 开心 lines', () => {
  const h = harness(at(15), { random: () => 0 });
  h.service.activity({ state: 'working' }, at(15));
  h.service.activity({ state: 'success' }, at(15, 11));
  h.set(at(15, 12));
  assert.equal(h.service.quote(() => 'general'), '刚才那个跑通了，本鱼在心里放烟花。');
  const fed = harness(at(15), { random: () => 0 });
  fed.service.event('feed', at(15));
  assert.equal(fed.service.quote(() => 'general'), '吃饱啦！今天这顿本鱼给满分～');
});

test('DDL from reminders worries her; daily reminders do not', async () => {
  const snap = { items: [{ title: '喝水', repeat: 'daily', enabled: true, dueAt: at(15, 30) }, { title: '周报', repeat: 'once', enabled: true, dueAt: at(16) }], alerts: [] };
  const h = harness(at(15), { reminders: async () => snap });
  await h.service.tick();
  assert.match(h.service.view().reason, /「周报」还剩 1 小时/);
  snap.items = [snap.items[0]];
  await h.service.tick();
  assert.notEqual(h.service.view().label, '担心');
});

test('publishes only on label changes and can be switched off', async () => {
  const h = harness(at(14));
  await h.service.tick();
  await h.service.tick();
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].label, '平常');
  h.service.command({ action: 'settings', enabled: false });
  assert.deepEqual(h.published.at(-1), { enabled: false });
  assert.equal(h.service.quote(() => 'general'), 'general');
  assert.equal(h.service.mayWhisper(), true, 'switched off: the original whisper timer decides');
});

test('state survives a restart and a corrupt file is set aside', async () => {
  const h = harness(at(15));
  for (let i = 0; i < 3; i++) h.service.event('click', at(15) + i * 1000);
  h.service.stop();
  const saved = JSON.parse(readFileSync(join(h.dir, 'mood.json'), 'utf8'));
  assert.equal(Math.round(saved.affection), 53);
  assert.equal(saved.version, 3);
  const again = harness(at(16), { dir: h.dir });
  assert.equal(again.service.view().affection, 53);
  writeFileSync(join(h.dir, 'mood.json'), '{broken');
  const recovered = harness(at(17), { dir: h.dir });
  assert.equal(recovered.service.view().affection, 50);
  assert.ok(readdirSync(h.dir).some(f => f.startsWith('mood.json.corrupt-')));
});

test('companion days count calendar days since first meeting', () => {
  const h = harness(at(23, 50, 20));
  h.set(at(0, 10, 21));
  assert.equal(h.service.view().days, 2);
});

// ---- Phase 2: restraint and moments ----

const on = (y, m, d) => new Date(y, m - 1, d, 12);

test('festivals: lunar dates, New Year\'s Eve and fixed dates', () => {
  const cases = [[on(2026, 2, 16), '除夕'], [on(2026, 2, 17), '春节'], [on(2026, 3, 3), '元宵节'], [on(2026, 6, 19), '端午节'],
    [on(2026, 8, 19), '七夕'], [on(2026, 9, 25), '中秋节'], [on(2026, 10, 18), '重阳节'], [on(2026, 1, 26), '腊八节'],
    [on(2026, 10, 31), '万圣节'], [on(2026, 12, 25), '圣诞节'], [on(2027, 1, 1), '元旦']];
  for (const [date, name] of cases) assert.equal(festivalOf(date)?.name, name, date.toDateString());
  assert.equal(festivalOf(on(2026, 10, 26)), null);
  assert.equal(festivalOf(on(2025, 8, 1)), null, 'leap month day 闰6-8 is no festival');
});

test('milestones, quiet hours and the away summary', () => {
  assert.deepEqual([6, 7, 30, 100, 101, 365, 730, 731].map(isMilestone), [false, true, true, true, false, true, true, false]);
  const quiet = { enabled: true, start: '23:00', end: '08:00' };
  assert.equal(inQuietHours(quiet, new Date(at(23, 30))), true);
  assert.equal(inQuietHours(quiet, new Date(at(7, 59))), true);
  assert.equal(inQuietHours(quiet, new Date(at(8, 0))), false);
  assert.equal(inQuietHours({ ...quiet, enabled: false }, new Date(at(23, 30))), false);
  assert.equal(inQuietHours({ enabled: true, start: '13:00', end: '14:00' }, new Date(at(13, 30))), true);
  assert.equal(awaySummary([{ type: 'success' }, { type: 'success' }, { type: 'error' }, { type: 'meal', name: '晚饭' }]),
    '刚才 2 个任务都跑完了～有个任务没跑成，记得去看看。本鱼自己先吃了晚饭。');
  assert.equal(awaySummary([]), '');
});

test('first greeting of the day, once, after the start-up grace period', async () => {
  const h = harness(at(9));
  reportPresence({ idleSec: 0 }, at(9));
  await h.service.tick();
  assert.equal(h.said.length, 0, 'nothing in the first 20 seconds');
  h.set(at(9, 1)); reportPresence({ idleSec: 0 }, at(9, 1));
  await h.service.tick();
  assert.equal(h.said.length, 1);
  assert.equal(h.said[0].animation, '点击回应-元气挥手');
  assert.match(h.said[0].text, /初次见面|本鱼是蓝色的大肥鱼/, 'very first day says hello for the first time');
  h.set(at(9, 3)); reportPresence({ idleSec: 0 }, at(9, 3));
  await h.service.tick();
  assert.equal(h.said.filter(s => s.animation === '点击回应-元气挥手').length, 1, 'only once a day');
  assert.equal(h.said.at(-1).animation, '吃早餐', 'breakfast waits until after the greeting');
  const next = harness(at(9, 0, 27), { dir: h.dir });
  next.set(at(9, 1, 27)); reportPresence({ idleSec: 0 }, at(9, 1, 27));
  await next.service.tick();
  assert.match(next.said[0].text, /早/, 'next morning uses the morning greeting');
});

test('milestone and festival greetings', async () => {
  const hundred = harness(at(10), { seed: { firstSeen: at(10, 0, 26) - 99 * 24 * HOUR } });
  hundred.set(at(10, 1)); reportPresence({ idleSec: 0 }, at(10, 1));
  await hundred.service.tick();
  assert.match(hundred.said[0].text, /第 100 天/);
  assert.equal(hundred.said[0].animation, '点击回应-开心跃动');
  const midAutumn = new Date(2026, 8, 25, 10).getTime();
  const festive = harness(midAutumn, { seed: { firstSeen: midAutumn - 20 * 24 * HOUR } });
  festive.set(midAutumn + MIN); reportPresence({ idleSec: 0 }, midAutumn + MIN);
  await festive.service.tick();
  assert.match(festive.said[0].text, /中秋快乐/);
  assert.equal(festive.said[0].animation, '中秋赏月吃月饼');
});

test('away: quiet while you are gone, then one welcome back with what happened', async () => {
  const h = harness(at(15), { seed: greeted() });
  reportPresence({ idleSec: 400 }, at(15, 5)); h.set(at(15, 5));
  await h.service.tick();
  assert.equal(h.service.mayWhisper(), false, 'no whispers while you are away');
  h.service.activity({ state: 'working' }, at(15, 6));
  reportPresence({ idleSec: 700 }, at(15, 10)); h.set(at(15, 10));
  h.service.activity({ state: 'success' }, at(15, 10));
  reportPresence({ idleSec: 3 }, at(15, 25)); h.set(at(15, 25));
  await h.service.tick();
  assert.equal(h.said.length, 1);
  assert.equal(h.said[0].text, '你回来啦！刚才那个任务跑完了～');
  assert.equal(h.said[0].animation, '点击回应-元气挥手');
});

test('whisper gating: daily limit, spacing, quiet hours and settings validation', () => {
  const h = harness(at(15), { seed: greeted() });
  assert.equal(h.service.mayWhisper(), true);
  h.service.whispered();
  assert.equal(h.service.mayWhisper(), false, 'at least 3 minutes between things she says');
  h.set(at(15, 3));
  assert.equal(h.service.mayWhisper(), true);
  for (let i = 1; i < TALK_LIMIT; i++) h.service.whispered();
  h.set(at(15, 10));
  assert.equal(h.service.mayWhisper(), false, `no more than ${TALK_LIMIT} a day`);
  assert.equal(h.service.view().talk.today, TALK_LIMIT);
  h.set(at(15, 0, 27));
  assert.equal(h.service.mayWhisper(), true, 'the count resets the next day');
  const view = h.service.command({ action: 'settings', quiet: { enabled: true, start: '14:00', end: '16:00' } });
  assert.equal(view.quiet.active, true);
  assert.equal(h.service.mayWhisper(), false, 'quiet hours');
  assert.match(h.service.command({ action: 'settings', quiet: { enabled: true, start: '25:00', end: '08:00' } }).message, /00:00/);
});

test('being ignored slows whispers down; any interaction resets the pace', async () => {
  const h = harness(at(15), { seed: greeted() });
  assert.equal(h.service.whisperPeriod(600), 600);
  h.service.whispered();
  h.set(at(15, 4)); await h.service.tick();
  assert.equal(h.service.whisperPeriod(600), 900);
  for (const m of [10, 20, 30, 40, 50]) { h.set(at(15, m)); h.service.whispered(); h.set(at(15, m + 4)); await h.service.tick(); }
  assert.equal(h.service.whisperPeriod(600), 1800, 'never slower than 3x');
  h.service.event('click');
  assert.equal(h.service.whisperPeriod(600), 600);
  const sleepy = harness(at(15), { seed: greeted(), override: '困' });
  assert.equal(sleepy.service.whisperPeriod(600), 1200, 'sleepy talks half as often');
  // Whispers closer together than the 3-minute window still count as being ignored.
  const chatty = harness(at(16), { seed: greeted() });
  for (const m of [0, 1, 2, 3]) { chatty.set(at(16, m)); chatty.service.whispered(); await chatty.service.tick(); }
  assert.equal(chatty.service.whisperPeriod(60), 90);
});

test('bedtime nudge: once a night when you are still running tasks after 0:30', async () => {
  const h = harness(at(0, 40), { seed: greeted() });
  h.service.activity({ state: 'working' }, at(0, 40));
  h.set(at(0, 41)); reportPresence({ idleSec: 0 }, at(0, 41));
  await h.service.tick();
  assert.equal(h.said.length, 1);
  assert.equal(h.said[0].animation, '哈欠连天');
  h.set(at(1, 30)); reportPresence({ idleSec: 0 }, at(1, 30));
  await h.service.tick();
  assert.equal(h.said.length, 1, 'once per night');
});

test('wrap-up after a long task and comfort after three failures, after the status animation', () => {
  const h = harness(at(15), { seed: greeted() });
  h.service.activity({ state: 'working' }, at(15));
  h.service.activity({ state: 'success' }, at(15, 12));
  h.set(at(15, 12) + 5000);
  assert.equal(h.service.flush(), false, 'waits for the celebration to finish');
  h.set(at(15, 12) + 20e3);
  assert.equal(h.service.flush(), true);
  assert.equal(h.said[0].animation, '点击回应-收到敬礼');
  for (const m of [20, 25, 30]) { h.service.activity({ state: 'working' }, at(15, m)); h.service.activity({ state: 'error' }, at(15, m + 1)); }
  h.set(at(15, 31) + 20e3);
  assert.equal(h.service.flush(), true);
  assert.equal(h.said[1].animation, '工作状态-垂头叹气冒汗');
});

test('meals in quiet hours play without a word', async () => {
  const h = harness(at(11), { seed: { ...greeted(), quiet: { enabled: true, start: '11:00', end: '14:00' } } });
  h.set(at(11, 31)); reportPresence({ idleSec: 0 }, at(11, 31));
  await h.service.tick();
  assert.deepEqual(h.played, ['吃午餐']);
  assert.equal(h.said.length, 0);
});

// ---- Phase 3: lines take turns, varied timing, affection tiers, emotions with an afterglow ----

/** A data folder with its own line groups (they override the packaged ones) and, optionally, general quotes. */
function dirWith(groups, general) {
  const dir = tempDir();
  writeFileSync(join(dir, 'mood-quotes.json'), JSON.stringify(groups));
  if (general) writeFileSync(join(dir, 'quotes.json'), JSON.stringify(general));
  return dir;
}

test('lines take turns: one comes back only after half of its group, even across a restart', () => {
  const items = ['a', 'b', 'c', 'd'].map(t => ({ template: t, text: t }));
  assert.equal(freshest(items, { a: 4, b: 3 }, () => 0).template, 'c', 'never-said lines first');
  assert.equal(freshest(items, { a: 4, b: 3 }, () => 0.99).template, 'd');
  assert.equal(freshest(items, { a: 1, b: 2, c: 3, d: 4 }, () => 0.99).template, 'b', 'only the older half');
  const draws = [0.9, 0.8, 0.7, 0.1, 0];
  assert.equal(freshest(items, {}, () => draws.shift()).template, 'd', 'never-said lines tie in random order, not list order');
  const group = ['一', '二', '三', '四'], general = ['甲', '乙', '丙', '丁'];
  const dir = dirWith({ 平常: group }, general);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const h = harness(at(14), { dir, random });
  const said = [];
  for (let i = 0; i < 40; i++) { h.set(at(14) + i * MIN); said.push(h.service.quote(() => 'fallback')); }
  for (const pool of [group, general]) {
    const picks = said.filter(q => pool.includes(q));
    assert.ok(picks.length > 8, 'both pools are used');
    for (let i = 2; i < picks.length; i++) assert.ok(!picks.slice(i - 2, i).includes(picks[i]), `${picks[i]} came back too soon`);
  }
  h.service.stop();
  const again = harness(at(15), { dir, random });
  const lastTwo = said.filter(q => group.includes(q)).slice(-2);
  let next;
  do next = again.service.quote(() => 'fallback'); while (!group.includes(next));
  assert.ok(!lastTwo.includes(next), 'remembered after a restart');
});

test('a moment line takes its turn only once it is actually spoken', async () => {
  const h = harness(at(9));
  h.set(at(9, 1)); reportPresence({ idleSec: 0 }, at(9, 1));
  await h.service.tick();
  h.service.activity({ state: 'working' }, at(9, 2));
  h.service.activity({ state: 'success' }, at(9, 20));
  h.set(at(9, 40));
  h.service.flush();
  h.service.stop();
  const said = Object.keys(JSON.parse(readFileSync(join(h.dir, 'mood.json'), 'utf8')).said);
  assert.ok(said.some(t => /初次见面|本鱼是蓝色的大肥鱼/.test(t)), 'the spoken greeting is marked');
  assert.ok(!said.some(t => /收工|跑完|搞定|成了/.test(t)), 'the wrap-up expired unspoken, so it keeps its turn');
});

test('whisper rounds vary between 0.5x and 1.5x and keep their factor for the round', () => {
  const draws = [0, 0.999];
  const h = harness(at(15), { seed: greeted(), random: () => draws.shift() ?? 0.5 });
  assert.equal(h.service.whisperPeriod(600), 600, 'without a round: the plain paced interval');
  assert.equal(h.service.whisperPeriod(600, at(15), 1000), 300);
  assert.equal(h.service.whisperPeriod(600, at(15, 5), 1000), 300, 'same round, same factor');
  assert.ok(Math.abs(h.service.whisperPeriod(600, at(15, 5), 2000) - 899.4) < 0.01, 'a new round draws again');
  const sleepy = harness(at(15), { seed: greeted(), override: '困', random: () => 0.5 });
  assert.equal(sleepy.service.whisperPeriod(600, at(15), 1), 1200, 'mood pace still applies');
});

test('she waits 3 minutes after saying anything before whispering', async () => {
  const h = harness(at(15));
  h.set(at(15, 1)); reportPresence({ idleSec: 0 }, at(15, 1));
  await h.service.tick();
  assert.equal(h.said.length, 1, 'the day\'s greeting');
  h.set(at(15, 3)); reportPresence({ idleSec: 0 }, at(15, 3));
  assert.equal(h.service.mayWhisper(), false);
  h.set(at(15, 4)); reportPresence({ idleSec: 0 }, at(15, 4));
  assert.equal(h.service.mayWhisper(), true);
});

test('a day you were here but never touched her costs a point; days off cost nothing', async () => {
  const h = harness(at(10), { seed: { affection: 70 } });
  reportPresence({ idleSec: 0 }, at(10)); await h.service.tick();
  h.set(at(10, 0, 27)); reportPresence({ idleSec: 0 }, at(10, 0, 27)); await h.service.tick();
  assert.equal(h.service.view().affection, 69);
  h.service.event('click', at(10, 1, 27));
  assert.equal(h.service.view().affection, 71);
  h.set(at(10, 0, 30)); await h.service.tick();
  assert.equal(h.service.view().affection, 71, 'the 28th and 29th, when she never saw you, cost nothing');
  const low = harness(at(10), { seed: { affection: 30 } });
  reportPresence({ idleSec: 0 }, at(10)); await low.service.tick();
  low.set(at(10, 0, 27)); await low.service.tick();
  assert.equal(low.service.view().affection, 30, 'never below 30');
});

test('affection tiers unlock lines and friendly click reactions', async () => {
  const groups = { 平常: ['普通'], '平常·亲近': ['亲近'], '平常·很亲': ['很亲'], '戳·熟悉': ['熟悉戳'], '戳·亲近': ['亲近戳'] };
  const lines = h => { const seen = new Set(); for (let i = 0; i < 6; i++) seen.add(h.service.quote(() => 'general')); return seen; };
  const stranger = harness(at(14), { dir: dirWith(groups), random: () => 0.5 });
  assert.equal(stranger.service.view().tier, '刚认识');
  assert.deepEqual([...lines(stranger)].sort(), ['general', '普通'].sort());
  await stranger.service.tick();
  assert.equal(stranger.published.at(-1).click, null);
  const close = harness(at(14), { dir: dirWith(groups), random: () => 0.5, bond: '85' });
  assert.deepEqual([close.service.view().tier, close.service.view().affection], ['亲近', 85]);
  const heard = lines(close);
  assert.ok(heard.has('普通') && heard.has('亲近') && !heard.has('很亲'));
  await close.service.tick();
  assert.deepEqual(close.published.at(-1).click, { anim: '点击回应-开心跃动', chance: 0.25, lines: ['熟悉戳', '亲近戳'] });
});

test('emotions stack, fade by half-life, leave an afterglow and survive a restart', () => {
  const two = harness(at(15));
  two.service.event('feed', at(15)); two.service.event('feed', at(15));
  two.set(at(15, 59));
  assert.equal(two.service.view().label, '开心', 'two bowls: about an hour of joy');
  two.set(at(16, 1));
  const glow = two.service.view();
  assert.notEqual(glow.label, '开心');
  assert.equal(glow.glow, '开心');
  assert.match(glow.reason, /还留着刚才的好心情（刚被你投喂）/);
  two.set(at(17));
  assert.equal(two.service.view().glow, '', 'the afterglow fades too');
  const one = harness(at(15));
  one.service.event('feed', at(15));
  one.set(at(15, 29));
  assert.equal(one.service.view().label, '开心');
  one.set(at(15, 31));
  assert.notEqual(one.service.view().label, '开心', 'one bowl: half an hour, as before');
  const before = harness(at(15));
  before.service.event('feed', at(15));
  before.service.stop();
  assert.equal(harness(at(15, 10), { dir: before.dir }).service.view().label, '开心', 'a restart picks up where the joy was');
  assert.deepEqual([12, 25, 65, 200].map(m => prideFor(m * MIN)), [50, 60, 100, 100]);
  const proud = harness(at(14));
  proud.service.activity({ state: 'working' }, at(14));
  proud.service.activity({ state: 'success' }, at(15, 5));
  proud.set(at(15, 24));
  assert.equal(proud.service.view().label, '开心', 'an hour-long task: about 20 minutes of pride');
  proud.set(at(15, 26));
  assert.equal(proud.service.view().glow, '骄傲');
  const poked = harness(at(15));
  for (let i = 0; i < 8; i++) poked.service.event('click', at(15) + i * 1000);
  poked.set(at(15, 3));
  assert.equal(poked.service.view().label, '傲娇', 'every extra poke makes the sulk last longer');
  poked.set(at(15, 4));
  assert.notEqual(poked.service.view().label, '傲娇');
});

test('yesterday\'s longest task comes up once after the next morning\'s greeting', async () => {
  const h = harness(at(14), { seed: greeted() });
  h.service.activity({ state: 'working' }, at(14));
  h.service.activity({ state: 'success' }, at(14, 30));
  h.service.activity({ state: 'working' }, at(15));
  h.service.activity({ state: 'success' }, at(16, 20));
  h.service.stop();
  const next = harness(at(10, 0, 27), { dir: h.dir });
  next.set(at(10, 1, 27)); reportPresence({ idleSec: 0 }, at(10, 1, 27));
  await next.service.tick();
  next.set(at(10, 1, 27) + 30e3); reportPresence({ idleSec: 0 }, next.now);
  await next.service.tick();
  assert.equal(next.said.length, 2);
  assert.match(next.said[0].text, /早/);
  assert.match(next.said[1].text, /1 小时 20 分钟/);
  next.service.stop();
  assert.equal(JSON.parse(readFileSync(join(h.dir, 'mood.json'), 'utf8')).highlight, null, 'said once, then forgotten');
  // Greeted after midnight it is still "last night": the memory goes without a word.
  const owl = harness(at(14), { seed: greeted() });
  owl.service.activity({ state: 'working' }, at(14));
  owl.service.activity({ state: 'success' }, at(14, 30));
  owl.service.stop();
  const night = harness(at(0, 30, 27), { dir: owl.dir });
  night.set(at(0, 31, 27)); reportPresence({ idleSec: 0 }, at(0, 31, 27));
  await night.service.tick();
  night.set(at(0, 32, 27)); reportPresence({ idleSec: 0 }, at(0, 32, 27));
  await night.service.tick();
  assert.equal(night.said.length, 1);
});

// ---- Phase 4: chat knows her state ----

test('a chat reply counts as speech, and the view says how long Codex has been running', () => {
  const h = harness(at(15), { seed: greeted() });
  h.service.activity({ state: 'working' }, at(15));
  h.set(at(15, 12));
  assert.equal(h.service.view().codex, 12);
  h.service.activity({ state: 'success' }, at(15, 12));
  assert.equal(h.service.view().codex, null);
  h.service.spoke(at(15, 13));
  h.set(at(15, 14));
  assert.equal(h.service.mayWhisper(), false, 'within 3 minutes of her reply');
  h.set(at(15, 16));
  assert.equal(h.service.mayWhisper(), true);
});
