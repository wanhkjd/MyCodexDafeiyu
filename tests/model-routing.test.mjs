import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelRouter } from '../app/backend/runtime/model-router.mjs';
import { createChatClient, selectChatModel } from '../app/backend/runtime/codex-chat.mjs';
import * as thirdParty from '../app/backend/runtime/third-party-llm.mjs';
import { conversations } from '../app/backend/runtime/pet-conversations.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pet-model-routing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function settings(dir, enabled, profile = { id: 'p1', name: '测试第三方', preset: 'custom', baseUrl: 'https://example.com/v1', model: 'test-model' }) {
  mkdirSync(join(dir, 'dsh-pet'), { recursive: true });
  writeFileSync(thirdParty.configPath(dir), JSON.stringify({ enabled, active: 'p1', profiles: profile ? [profile] : [] }));
}
function fakeProvider(name, calls, extra = {}) {
  return {
    chat: async (...args) => { calls.push({ name, method: 'chat', args }); return { ok: true, text: name }; },
    generate: async (...args) => { calls.push({ name, method: 'generate', args }); return name; },
    see: async (...args) => { calls.push({ name, method: 'see', args }); return name; },
    ...extra,
  };
}
function fakeConnection({ config = {}, models = [{ model: 'catalog-model', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], reply = () => '模型回复', onTurn = () => {} } = {}) {
  const rpcs = [], listeners = new Set();
  let sequence = 0, closed = false;
  const emit = msg => { for (const fn of listeners) fn(msg); };
  return {
    rpcs, listeners, alive: () => !closed, close() { closed = true; emit({ method: 'pet/connectionClosed' }); },
    get closed() { return closed; },
    async rpc(method, params) {
      rpcs.push({ method, params });
      if (method === 'config/read') return { config: typeof config === 'function' ? config() : config };
      if (method === 'model/list') return { data: models };
      if (method === 'thread/start') return { thread: { id: `t${++sequence}` } };
      if (method === 'turn/start') {
        onTurn(params);
        setImmediate(async () => {
          try {
            const text = await reply(params);
            emit({ method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', text } } });
            emit({ method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } } });
          } catch (error) {
            emit({ method: 'error', params: { threadId: params.threadId, willRetry: false, error: { message: error.message } } });
          }
        });
      }
      return {};
    },
  };
}

test('one switch routes chat, background generation and images; changes apply without restart', async t => {
  const dir = fixture(t), calls = [];
  settings(dir, false);
  const api = fakeProvider('third-party', calls, { status: () => thirdParty.status(dir), visionStatus: () => ({ ok: true, name: '独立识图配置', model: 'vision-model' }) });
  const router = createModelRouter(dir, { thirdPartyClient: api, codexClient: fakeProvider('codex', calls) });
  assert.equal(router.status().kind, 'codex');
  assert.equal(router.visionStatus().kind, 'codex', 'saved third-party vision config is ignored while disabled');
  await router.chat('你好', [], dir, {});
  await router.generate({ system: '人设', prompt: '视频素材' });
  await router.see({ image: 'AAAA', prompt: '描述画面' });
  settings(dir, true);
  assert.equal(router.status().kind, 'third-party');
  assert.equal(router.visionStatus().model, 'vision-model');
  await router.chat('你好', [], dir, {});
  await router.generate({ prompt: '日记' });
  await router.see({ image: 'AAAA', prompt: '描述画面' });
  settings(dir, false);
  await router.generate({ prompt: '再次用 Codex' });
  assert.deepEqual(calls.map(c => `${c.name}:${c.method}`), ['codex:chat', 'codex:generate', 'codex:see', 'third-party:chat', 'third-party:generate', 'third-party:see', 'codex:generate']);
  assert.ok(calls.every(c => c.args[c.method === 'chat' ? 2 : 1] === dir));
});

test('enabled but incomplete third-party settings never silently fall back to Codex', async t => {
  const dir = fixture(t), calls = [];
  settings(dir, true, null);
  const router = createModelRouter(dir, { thirdPartyClient: thirdParty, codexClient: fakeProvider('codex', calls) });
  assert.equal(router.status().kind, 'third-party');
  assert.equal(router.status().ready, false);
  assert.equal((await router.chat('你好', [], dir, {})).ok, false);
  await assert.rejects(router.generate({ prompt: '视频' }), /第三方 API 未启用或配置不完整/);
  assert.equal((await thirdParty.command(dir, { action: 'save', config: { enabled: true, profiles: [] } })).ok, false);
  assert.equal(calls.length, 0);
});

test('provider failures do not invoke the other provider', async t => {
  const dir = fixture(t), calls = [];
  settings(dir, true);
  const router = createModelRouter(dir, { thirdPartyClient: fakeProvider('third-party', calls, { status: () => thirdParty.status(dir), generate: async () => { throw new Error('第三方离线'); } }), codexClient: fakeProvider('codex', calls, { generate: async () => { throw new Error('Codex 离线'); } }) });
  await assert.rejects(router.generate({ prompt: '资料' }), /第三方离线/);
  settings(dir, false);
  await assert.rejects(router.generate({ prompt: '资料' }), /Codex 离线/);
  assert.equal(calls.length, 0);
});

test('Codex follows configured gateway model, keeps companion sandbox, and sends actual images', async t => {
  const dir = fixture(t), output = '完整回复'.repeat(1000);
  let imagePath;
  const connection = fakeConnection({
    config: { model: 'gateway-custom-model', model_provider: 'ccswitch', model_reasoning_effort: 'none', mcp_servers: { external: {} } },
    reply: () => output,
    onTurn: params => {
      const image = params.input.find(i => i.type === 'localImage');
      if (image) { imagePath = image.path; assert.deepEqual(readFileSync(imagePath), Buffer.from([1, 2, 3])); }
    },
  });
  const client = createChatClient({ connectToCodex: async () => connection });
  t.after(client.closeChatConnection);
  const chat = await client.chat('你好', [], dir, { persona: '聊天人设' });
  assert.equal(chat.model, 'gateway-custom-model');
  assert.equal(chat.text.length, 1800);
  const longPrompt = '字幕资料'.repeat(2000);
  assert.equal(await client.generate({ system: '只输出 JSON', prompt: longPrompt }, dir), output);
  assert.equal(await client.see({ image: 'AQID', mime: 'image/png', prompt: '描述九宫格', system: '画面规则' }, dir), output);
  assert.ok(imagePath);
  assert.equal(existsSync(imagePath), false, 'temporary picture is removed after completion');
  assert.equal(connection.rpcs.some(r => ['account/read', 'account/rateLimits/read', 'model/list'].includes(r.method)), false, 'a valid configured gateway does not require ChatGPT login or catalog listing');
  const threads = connection.rpcs.filter(r => r.method === 'thread/start');
  assert.deepEqual(threads.map(r => r.params.baseInstructions), ['聊天人设', '只输出 JSON', '画面规则']);
  for (const { params } of threads) {
    assert.equal(params.sandbox, 'read-only');
    assert.equal(params.ephemeral, true);
    assert.equal(params.config['features.shell_tool'], false);
    assert.equal(params.config['features.memories'], false);
    assert.equal(params.config['mcp_servers.external.enabled'], false);
    assert.equal(params.config.model_provider, undefined, 'the provider is inherited, never replaced');
  }
  const turns = connection.rpcs.filter(r => r.method === 'turn/start');
  assert.equal(turns[1].params.input[0].text, longPrompt, 'background prompts have no chat-length cutoff');
  assert.ok(turns.every(r => r.params.effort === 'none'));
});

test('Codex rereads effective model configuration on every request', async t => {
  const dir = fixture(t);
  let model = 'gateway-a';
  const connection = fakeConnection({ config: () => ({ model }) });
  const client = createChatClient({ connectToCodex: async () => connection });
  t.after(client.closeChatConnection);
  assert.equal((await client.chat('一', [], dir)).model, 'gateway-a');
  assert.equal(connection.rpcs.find(r => r.method === 'turn/start').params.effort, undefined, 'unspecified effort follows the configured model default');
  assert.equal(connection.rpcs.find(r => r.method === 'thread/start').params.config.model_reasoning_effort, undefined);
  model = 'gateway-b';
  assert.equal((await client.chat('二', [], dir)).model, 'gateway-b');
});

test('without a configured model, Codex accepts catalog defaults that do not support low', async t => {
  const dir = fixture(t);
  const models = [{ model: 'custom-high-only', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }];
  const connection = fakeConnection({ models });
  const client = createChatClient({ connectToCodex: async () => connection });
  t.after(client.closeChatConnection);
  assert.equal((await client.chat('你好', [], dir)).model, 'custom-high-only');
  assert.equal(connection.rpcs.find(r => r.method === 'turn/start').params.effort, 'high');
  assert.equal(selectChatModel(models, 'gateway-model'), 'gateway-model');
  assert.equal(selectChatModel(models), 'custom-high-only');
  assert.throws(() => selectChatModel([]), /没有可用模型/);
});

test('Codex image errors clean up temporary files and invalid images are rejected', async t => {
  const dir = fixture(t);
  const connection = fakeConnection({ config: { model: 'no-vision-model' }, reply: () => { throw new Error('当前模型不支持图片'); } });
  const client = createChatClient({ connectToCodex: async () => connection });
  t.after(client.closeChatConnection);
  await assert.rejects(client.see({ image: 'AQID', prompt: '描述画面' }, dir), /不支持图片/);
  assert.deepEqual(readdirSync(join(dir, 'chat-sandbox')), []);
  await assert.rejects(client.see({ image: '!invalid!', prompt: '描述画面' }, dir), /图片格式/);
  await assert.rejects(client.see({ prompt: '描述画面' }, dir), /图片不能为空/);
});

test('finishing a chat does not start idle shutdown while Codex is still generating a diary', async t => {
  const dir = fixture(t);
  let finishDiary, started;
  const diaryStarted = new Promise(resolve => { started = resolve; });
  const connection = fakeConnection({ config: { model: 'gateway-model' }, reply: params => {
    if (params.input[0].text === '写日记') { started(); return new Promise(resolve => { finishDiary = resolve; }); }
    return '聊天回复';
  } });
  const client = createChatClient({ connectToCodex: async () => connection, idleMs: 10 });
  t.after(client.closeChatConnection);
  const diary = client.generate({ prompt: '写日记' }, dir);
  await diaryStarted;
  assert.equal((await client.chat('你好', [], dir)).ok, true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(connection.closed, false);
  finishDiary('完整日记');
  assert.equal(await diary, '完整日记');
});

test('Codex conversations receive Bilibili link material without persisting it as history', async t => {
  const dir = fixture(t);
  settings(dir, false);
  let received;
  const service = conversations(dir, async (text, history, dataDir, options) => { received = options; return { ok: true, text: '视频真有趣', model: 'fake-codex' }; });
  const result = await service.command({ action: 'send', text: '看看 BV1aaaaaaaaa' }, { bili: { chatMaterial: async () => '【视频资料】这是一只猫', todayLine: () => '' } });
  assert.equal(result.ok, true);
  assert.match(received.state, /【视频资料】这是一只猫/);
  assert.equal(service.snapshot().provider.kind, 'codex');
  assert.doesNotMatch(readFileSync(join(dir, 'pet-conversations.json'), 'utf8'), /【视频资料】/);
});

test('a failed Codex picture cancels only its turn, not an ongoing diary', async t => {
  const dir = fixture(t);
  let finishDiary, started;
  const diaryStarted = new Promise(resolve => { started = resolve; });
  const connection = fakeConnection({ config: { model: 'gateway-model' }, reply: params => {
    if (params.input[0].text === '写日记') { started(); return new Promise(resolve => { finishDiary = resolve; }); }
    throw new Error('当前模型不支持图片');
  } });
  const rpc = connection.rpc;
  connection.rpc = async (method, params) => {
    const result = await rpc(method, params);
    return method === 'turn/start' ? { turn: { id: `turn-${params.threadId}` } } : result;
  };
  const client = createChatClient({ connectToCodex: async () => connection });
  t.after(client.closeChatConnection);
  const diary = client.generate({ prompt: '写日记' }, dir);
  await diaryStarted;
  await assert.rejects(client.see({ image: 'AQID', prompt: '描述画面' }, dir), /不支持图片/);
  assert.equal(connection.closed, false);
  assert.deepEqual(connection.rpcs.find(r => r.method === 'turn/interrupt').params, { threadId: 't2', turnId: 'turn-t2' });
  finishDiary('完整日记');
  assert.equal(await diary, '完整日记');
  assert.deepEqual(readdirSync(join(dir, 'chat-sandbox')), []);
});

test('legacy Sol/Luna settings cannot force low or a different model over the local configuration', async t => {
  const dir = fixture(t);
  const connection = fakeConnection({ config: { model: 'deepseek-v4.1-flash-1017', model_reasoning_effort: 'high' } });
  const client = createChatClient({ connectToCodex: async () => connection });
  t.after(client.closeChatConnection);
  for (const mode of ['auto', 'sol', 'luna']) {
    assert.equal((await client.chat('你好', [], dir, { mode })).model, 'deepseek-v4.1-flash-1017');
  }
  assert.equal(connection.rpcs.some(r => /account|rateLimits|model\/list/.test(r.method)), false);
  assert.ok(connection.rpcs.filter(r => r.method === 'turn/start').every(r => r.params.effort === 'high'));
});

test('saved legacy mode migrates to local defaults without losing conversations or the memory choice', async t => {
  const dir = fixture(t), id = 'saved-session';
  const message = { role: 'assistant', content: '保存的聊天', model: 'old-model' };
  writeFileSync(join(dir, 'pet-conversations.json'), JSON.stringify({ active: id, mode: 'sol', useMemory: false, profileNotes: '我喜欢小猫', sessions: [{ id, title: '我的聊天', messages: [message] }] }));
  let options;
  const service = conversations(dir, async (_text, _history, _dir, input) => { options = input; return { ok: true, text: '新回复' }; });
  assert.equal(service.snapshot().mode, 'auto');
  assert.equal(service.snapshot().useMemory, false);
  assert.deepEqual(service.snapshot().messages, [message]);
  assert.equal(service.snapshot().memory.notes, '我喜欢小猫');
  await service.command({ action: 'settings', mode: 'luna' });
  assert.equal(service.snapshot().mode, 'auto');
  await service.command({ action: 'send', text: '你好' });
  assert.equal(options.mode, 'auto');
  assert.equal(options.memory, '');
});

test('personal memory is opt-in and user-written notes work without an account', async t => {
  const dir = fixture(t);
  let options;
  const service = conversations(dir, async (_text, _history, _dir, input) => { options = input; return { ok: true, text: '回复' }; });
  assert.equal(service.snapshot().useMemory, false);
  await service.command({ action: 'profile', notes: '请叫我小鱼' });
  await service.command({ action: 'settings', useMemory: true });
  await service.command({ action: 'send', text: '你好' });
  assert.match(options.memory, /请叫我小鱼/);
  assert.equal(service.snapshot().memory.notes, '请叫我小鱼');
});
