// Unit tests for her chat persona, the 「此刻」 block and action tags. Run from the repository root: node --test tests/persona.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = join(import.meta.dirname, '..', 'app', 'backend', 'runtime');
const tempDir = () => mkdtempSync(join(tmpdir(), 'persona-test-'));
// Keep the chat store away from your real Codex memories.
process.env.CODEX_HOME = tempDir();
const load = name => import(pathToFileURL(join(runtime, name)).href);
const { PRESETS, ACTIONS, buildPersona, describeState, withState, takeAction, hideTag, readPersona, savePersona } = await load('persona.mjs');
const { conversations } = await load('pet-conversations.mjs');
const { createChatClient } = await load('codex-chat.mjs');
const { messagesFor } = await load('third-party-llm.mjs');

test('the default persona keeps her voice; your additions come before the fixed rules', () => {
  const plain = buildPersona();
  assert.match(plain, /自称「本鱼」，被叫大肥鱼会可爱地嘴硬/);
  assert.match(plain, /称呼用户为「你」，不默认叫主人/);
  assert.ok(plain.includes(PRESETS[0].text));
  assert.match(plain, /本机 Codex 当前配置的模型驱动/);
  assert.match(plain, /不根据入口推断模型或服务商/);
  assert.doesNotMatch(plain, /你由 GPT 驱动|不谎称是 DeepSeek 模型/);
  assert.match(plain, /输入里的 petState/);
  for (const name of Object.keys(ACTIONS)) assert.ok(plain.includes(name), name);
  assert.doesNotMatch(plain, /补充设定/);
  const named = buildPersona({ name: '小蓝', call: '老板', preset: 'gentle', notes: '可以损我两句', shareState: false, actions: false }, { provider: 'third-party' });
  assert.match(named, /^你叫「小蓝」，是用户给你起的名字/);
  assert.match(named, /「大肥鱼」是大家对你们这一族的昵称，不是你的名字/);
  assert.match(named, /称呼用户为「老板」。/);
  assert.ok(named.includes(PRESETS.find(p => p.id === 'gentle').text));
  assert.ok(named.indexOf('用户的补充设定') < named.indexOf('规则：'), 'the fixed rules come last');
  assert.match(named, /第三方大模型驱动/);
  assert.doesNotMatch(named, /此刻：|动作：/, 'both switched off');
  assert.match(buildPersona({}, { provider: 'third-party' }), /用户消息前附的【此刻】/);
});

test('「此刻」 is written from the mood panel data, in her own words', () => {
  const view = {
    ok: true, enabled: true, label: '饿', reason: '午饭时你一直在忙，本鱼没吃上', energy: 60, satiety: 20, days: 37, tier: '熟悉', codex: 72,
    meals: [{ name: '早饭', eaten: true, missed: false, passed: true }, { name: '午饭', eaten: false, missed: true, passed: true }, { name: '晚饭', eaten: false, missed: false, passed: false }],
  };
  assert.equal(describeState(view, new Date(2026, 9, 26, 14, 20).getTime()), [
    '【此刻】',
    '时间：10 月 26 日（周一）14:20',
    '你的心情：饿了｜你会这样说：「午饭时你一直在忙，本鱼没吃上」',
    '精力 60/100，饱腹 20/100',
    '今天的饭：早饭 ✓、午饭 没吃上、晚饭 还没到',
    '你和用户：认识第 37 天，亲密度「熟悉」',
    'Codex：正在跑任务，已经 1 小时 12 分钟',
  ].join('\n'));
  assert.match(describeState({ ...view, codex: null }), /Codex：空闲/);
  assert.equal(describeState({ ...view, enabled: false }), '', 'nothing when the mood system is off');
  assert.equal(describeState(undefined), '');
  assert.equal(withState('', '在吗'), '在吗');
  assert.match(withState('【此刻】…', '在吗'), /不是用户说的话。用户说：）\n在吗$/);
});

test('action tags are taken out of replies and turned into the pet\'s animations', () => {
  assert.deepEqual(takeAction('[动作:开心]\n今天也辛苦啦'), { text: '今天也辛苦啦', action: '开心', animation: '点击回应-开心跃动' });
  assert.deepEqual(takeAction('[动作：跳舞] 来跳一段', () => 0.99), { text: '来跳一段', action: '跳舞', animation: '可爱宅舞' });
  assert.deepEqual(takeAction('[动作:飞起来]嗯嗯'), { text: '嗯嗯', action: null, animation: null }, 'unknown names are ignored');
  assert.deepEqual(takeAction('好呀[动作:害羞]，谢谢'), { text: '好呀，谢谢', action: '害羞', animation: '点击回应-害羞惊讶' });
  assert.deepEqual(takeAction('就这样'), { text: '就这样', action: null, animation: null });
  assert.equal(takeAction('[动作:开心]').text, '（开心）', 'a reply that is only a tag still says something');
  assert.equal(hideTag('[动作:开'), '', 'a tag still being written stays hidden');
  assert.equal(hideTag('[动作:开心]\n今天'), '今天');
  assert.equal(hideTag('今天也'), '今天也');
});

test('persona settings are checked before they are saved', () => {
  const dir = tempDir();
  assert.deepEqual(readPersona(dir), { name: '', call: '', preset: 'playful', notes: '', shareState: true, actions: true });
  assert.equal(savePersona(dir, { name: '小蓝', call: '老板', preset: 'quiet', notes: '  少说两句  ', shareState: false, actions: true }).ok, true);
  assert.deepEqual(readPersona(dir), { name: '小蓝', call: '老板', preset: 'quiet', notes: '少说两句', shareState: false, actions: true });
  assert.match(savePersona(dir, { name: '一二三四五六七八九十一二三', preset: 'quiet' }).message, /12 字/);
  assert.match(savePersona(dir, { preset: 'quiet', notes: 'x'.repeat(801) }).message, /800 字/);
  assert.match(savePersona(dir, { preset: 'angry' }).message, /性格/);
  writeFileSync(join(dir, 'persona.json'), '{broken');
  assert.equal(readPersona(dir).preset, 'playful', 'a damaged file falls back to the defaults');
});

test('sending: persona and 「此刻」 go to the model, the tag comes off before saving, the action comes back', async () => {
  const calls = [];
  let release;
  const generate = async (text, history, dataDir, options) => {
    calls.push(options);
    if (calls.length === 1) {
      options.onDelta('[动作:开');
      await new Promise(resolve => { release = resolve; });
      options.onDelta('心]\n在呢在呢');
    }
    return { ok: true, text: '[动作:开心]\n在呢在呢', model: 'fake' };
  };
  const service = conversations(tempDir(), generate);
  const view = { ok: true, enabled: true, label: '平常', reason: '一切正常，陪你待着', energy: 70, satiety: 60, days: 3, tier: '刚认识', codex: null, meals: [] };
  const sending = service.command({ action: 'send', text: '在吗' }, { state: view });
  assert.equal(service.snapshot().pending.text, '', 'the half-written tag never shows while streaming');
  release();
  const result = await sending;
  assert.deepEqual([result.text, result.action, result.animation], ['在呢在呢', '开心', '点击回应-开心跃动']);
  assert.equal(service.snapshot().messages.at(-1).content, '在呢在呢', 'the history keeps no tags');
  assert.match(calls[0].persona, /自称「本鱼」/);
  assert.match(calls[0].state, /^【此刻】/);
  const saved = await service.command({ action: 'persona', name: '小蓝', call: '', preset: 'sharp', notes: '', shareState: false, actions: false });
  assert.equal(saved.persona.name, '小蓝');
  assert.ok(saved.persona.preview.includes(PRESETS.find(p => p.id === 'sharp').text), 'the panel previews exactly what is sent');
  const second = await service.command({ action: 'send', text: '还在吗' }, { state: view });
  assert.deepEqual([second.text, second.action, second.animation], ['在呢在呢', null, null], 'actions off: no animation, and the tag is still removed');
  assert.match(calls[1].persona, /^你叫「小蓝」/);
  assert.equal(calls[1].state, '', 'state off: nothing about her is sent');
  assert.match((await service.command({ action: 'persona', preset: 'nope' })).message, /性格/);
});

test('Codex chat: the persona is the base instructions and 「此刻」 rides along with this message only', async () => {
  const rpcs = [];
  const fakeCodex = async () => {
    const listeners = new Set();
    const emit = msg => { for (const listener of listeners) listener(msg); };
    return {
      listeners, alive: () => true, close() {},
      async rpc(method, params) {
        rpcs.push({ method, params });
        if (method === 'model/list') return { data: [{ model: 'gpt-test', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] };
        if (method === 'config/read') return { config: {} };
        if (method === 'thread/start') return { thread: { id: 't1' } };
        if (method === 'turn/start') setImmediate(() => {
          emit({ method: 'item/completed', params: { threadId: 't1', item: { type: 'agentMessage', text: '[动作:挥手]\n你好呀' } } });
          emit({ method: 'turn/completed', params: { threadId: 't1', turn: { status: 'completed' } } });
        });
        return {};
      },
    };
  };
  const client = createChatClient({ connectToCodex: fakeCodex, idleMs: 10 });
  const result = await client.chat('在吗', [], tempDir(), { persona: '人设全文', state: '【此刻】\n时间：…' });
  assert.deepEqual([result.ok, result.text], [true, '[动作:挥手]\n你好呀'], 'tags are taken out one level up, by the conversation store');
  assert.equal(rpcs.find(r => r.method === 'thread/start').params.baseInstructions, '人设全文');
  assert.equal(JSON.parse(rpcs.find(r => r.method === 'turn/start').params.input[0].text).petState, '【此刻】\n时间：…');
  await client.chat('再来', [], tempDir(), {});
  assert.equal(rpcs.filter(r => r.method === 'thread/start').at(-1).params.baseInstructions, buildPersona({ shareState: false, actions: false }));
  assert.equal(JSON.parse(rpcs.filter(r => r.method === 'turn/start').at(-1).params.input[0].text).petState, undefined);
  client.closeChatConnection();
});

test('third-party API: 「此刻」 goes in front of your message, the persona stays first', () => {
  const history = [{ role: 'user', content: '一' }, { role: 'assistant', content: '二' }, { role: 'user', content: '三' }, { role: 'assistant', content: '四' }];
  const messages = messagesFor({ persona: '人设', history, rounds: 1, state: '【此刻】x', text: ' 在吗 ' });
  assert.deepEqual(messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(messages[0].content, '人设');
  assert.deepEqual(messages.slice(1, 3).map(m => m.content), ['三', '四']);
  assert.match(messages.at(-1).content, /^【此刻】x\n/);
  assert.match(messages.at(-1).content, /\n在吗$/);
  assert.equal(messagesFor({ persona: '人设', text: '在吗' }).at(-1).content, '在吗');
});
