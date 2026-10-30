import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachedQuota, authScope } from '../app/backend/runtime/quota-cache.mjs';
import { parseReminder, toEpoch, localTime, reminderService } from '../app/backend/runtime/reminders.mjs';
const fresh = { ok: true, queryOk: true, accountKey: 'test-account-a', planLabel: 'test-plan', windows: [{ label: 'weekly', used: 20, remaining: 80, resetsAt: null }] };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-quota-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'quota.json'), cli: 'test-cli', getScope: () => 'test-login-a', now: 100000 };
}
test('quota cache keeps validated snapshot and reuses it only for same login', async t => {
  const args = fixture(t);
  const first = await cachedQuota({ ...args, readUsage: async () => fresh });
  assert.equal(first.stale, false);
  const cached = await cachedQuota({ ...args, readUsage: async () => { throw new Error('offline'); } });
  assert.equal(cached.stale, true);
  assert.equal(cached.data.windows[0].remaining, 80);
  const other = await cachedQuota({ ...args, getScope: () => 'different-login', readUsage: async () => ({ ok: false }) });
  assert.equal(other.ok, false);
});
test('logout removes credential-scoped quota cache', async t => {
  const args = fixture(t);
  await cachedQuota({ ...args, readUsage: async () => fresh });
  const result = await cachedQuota({ ...args, getScope: () => null, readUsage: async () => ({ ok: false }) });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(args.file), false);
});
test('login changed during quota request never publishes the earlier account result', async t => {
  const args = fixture(t);
  let scope = 'a';
  const result = await cachedQuota({ ...args, getScope: () => scope, readUsage: async () => { scope = 'b'; return fresh; } });
  assert.equal(result.ok, false);
  assert.match(result.message, /登录状态已变化/);
  assert.equal(fs.existsSync(args.file), false);
});
test('account mismatch invalidates cache even when credential fingerprint is unchanged', async t => {
  const args = fixture(t);
  await cachedQuota({ ...args, readUsage: async () => fresh });
  const result = await cachedQuota({ ...args, readUsage: async (_cli, { onAccount }) => { onAccount('other-account'); return { ok: false }; } });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(args.file), false);
});
test('credential fingerprint is one-way and never returned as raw authentication text', t => {
  const { dir } = fixture(t);
  assert.equal(authScope(dir), null);
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ testCredential: 'not-a-real-credential' }));
  assert.match(authScope(dir), /^[a-f0-9]{64}$/);
});
test('reminder parses relative dates in explicitly selected timezone', () => {
  const zone = 'Asia/Shanghai';
  const now = toEpoch('2026-10-30T10:00', zone);
  const parsed = parseReminder('明天下午三点提醒我交报告', { now, zone });
  assert.equal(parsed.dueLocal, '2026-10-31T15:00');
  assert.equal(parsed.repeat, 'once');
  assert.equal(parsed.needsConfirmation, true);
  assert.deepEqual(parsed.questions, []);
  assert.equal(localTime(toEpoch(parsed.dueLocal, zone), zone), parsed.dueLocal);
});
test('reminder does not silently accept impossible dates or DST gap', () => {
  assert.throws(() => toEpoch('2026-02-30T10:00', 'Asia/Shanghai'));
  assert.throws(() => toEpoch('2026-03-08T02:30', 'America/New_York'));
  assert.throws(() => toEpoch('2026-10-30T25:00', 'Asia/Shanghai'));
});
test('ambiguous reminder asks for missing date and time', () => {
  const result = parseReminder('提醒我交报告', { now: toEpoch('2026-10-30T10:00', 'Asia/Shanghai'), zone: 'Asia/Shanghai' });
  assert.ok(result.questions.length >= 2);
  assert.equal(result.needsConfirmation, true);
});
test('corrupt reminders are preserved rather than silently overwritten', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'reminders.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => reminderService(dir), /提醒数据无法读取/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
