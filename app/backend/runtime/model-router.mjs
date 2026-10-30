// One switch for chat, Bilibili judgments/diaries and frames. Never silently change provider on failure.
import * as thirdParty from './third-party-llm.mjs';
import * as codex from './codex-chat.mjs';

export function createModelRouter(dataDir, { thirdPartyClient = thirdParty, codexClient = codex } = {}) {
  const status = () => {
    const selected = thirdPartyClient.status(dataDir);
    if (selected.kind === 'third-party') return { ...selected, ready: selected.ready !== false };
    // Availability is checked by app-server on demand, not by quota/account mode (API gateways are valid).
    return { kind: 'codex', ready: true, name: '本机 Codex', model: '', message: '跟随本机 Codex 配置（含 CC Switch 中转），请求时检查可用性' };
  };
  const client = () => status().kind === 'third-party' ? thirdPartyClient : codexClient;
  return {
    status,
    visionStatus: () => status().kind === 'third-party' ? thirdPartyClient.visionStatus(dataDir)
      : { ok: true, name: '本机 Codex', model: '当前配置的模型', sameAsChat: true, kind: 'codex', message: '跟随本机 Codex；画面识别取决于当前模型是否支持图片' },
    chat: (text, history, _dir, options) => client().chat(text, history, dataDir, options),
    generate: options => client().generate(options, dataDir),
    see: options => client().see(options, dataDir),
  };
}
