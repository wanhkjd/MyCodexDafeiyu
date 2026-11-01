// Route chat to the selected provider; never silently change provider on failure.
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
    chat: (text, history, _dir, options) => client().chat(text, history, dataDir, options),
  };
}
