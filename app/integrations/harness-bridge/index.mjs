// Local metadata bridge. No model calls, message text, titles, paths or command arguments leave Harness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const name = 'codex-dafeiyu-harness-bridge';
export const inject = [];
const terminal = s => s === 'success' || s === 'error';
const toolTask = name => /ask_user_question|request_user_input/.test(name) ? '等你回答问题～'
  : /approval/.test(name) ? '等你确认权限～'
  : /search|browse|fetch|web/.test(name) ? '搜索资料中…'
  : /read|view|list|inspect/.test(name) ? '阅读资料中…'
  : /write|edit|patch/.test(name) ? '编写／修改文件中…'
  : /exec|command|shell|run/.test(name) ? '执行命令中…' : '调用工具中…';
export class HarnessState {
  constructor(clock = Date.now) { this.clock = clock; this.sessions = new Map(); }
  get(id) {
    if (!this.sessions.has(id)) this.sessions.set(id, { id, turn: '', state: null, task: null, updatedAt: this.clock(), endedAt: 0, goalRound: false, closing: null, calls: new Map(), questions: new Set(), approvals: new Set() });
    return this.sessions.get(id);
  }
  set(s, state, task) { s.state = s.questions.size || s.approvals.size ? 'waiting' : state; s.task = s.questions.size ? '等你回答问题～' : s.approvals.size ? '等你确认权限～' : task; s.updatedAt = this.clock(); }
  call(s, data) {
    const n = String(data.name || '').toLowerCase(), id = String(data.callId || data.id || n);
    if (s.calls.has(id)) return;
    let closing = null;
    if (n === 'update_goal') { try { const a = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments; if (['complete','blocked'].includes(a?.action)) closing = a.action; } catch {} }
    s.calls.set(id, { question: /ask_user_question|request_user_input/.test(n), closing });
    if (s.calls.get(id).question) s.questions.add(id);
    this.set(s, 'working', toolTask(n));
  }
  accept(id, event = {}) {
    const s = this.get(String(id || 'unknown')), d = event.data || {}, type = event.type;
    if (d.turn != null) s.turn = String(d.turn).slice(0, 128);
    if (type === 'turn/start') { s.endedAt = 0; s.closing = null; s.calls.clear(); s.questions.clear(); s.approvals.clear(); this.set(s, 'thinking', '正在认真思考…'); }
    else if (type === 'user/message' && ['user','goal'].includes(d.source?.kind)) { s.goalRound = d.source.kind === 'goal'; s.endedAt = 0; this.set(s, 'thinking', '正在理解你的要求…'); }
    else if (type === 'tool/call') this.call(s, d);
    else if (type === 'assistant/message') {
      const content = d.message?.content || d.content;
      if (Array.isArray(content)) { for (const block of content) if (block.type === 'tool-call') this.call(s, block); }
      if (!s.calls.size) this.set(s, 'result', '撰写回复中…');
    } else if (type === 'tool/result') {
      const id = String(d.message?.callId || d.callId || ''), call = s.calls.get(id);
      const failed = d.message?.isError === true || d.isError === true || d.ok === false || d.message?.ok === false;
      if (call?.closing && !failed) s.closing = call.closing;
      s.calls.delete(id); s.questions.delete(id);
      this.set(s, s.calls.size ? 'working' : 'result', s.calls.size ? '执行工具中…' : '整理执行结果中…');
    } else if (type === 'approval/asked') { s.approvals.add(String(d.approvalId || d.rpcId || 'approval')); this.set(s, 'waiting', '等你确认权限～'); }
    else if (type === 'approval/decided') { s.approvals.delete(String(d.approvalId || d.rpcId || 'approval')); this.set(s, 'working', '已收到确认，继续处理…'); }
    else if (type === 'command/run' || type === 'tool-workflow/run-start') this.set(s, 'working', '执行命令中…');
    else if (type === 'command/done' || type === 'tool-workflow/run-end') this.set(s, 'result', '整理执行结果中…');
    else if (type === 'llm/retry' || type === 'agent/request-error') this.set(s, 'thinking', '模型连接异常，正在重试；请查看 Harness');
    else if (type === 'turn/end') {
      s.calls.clear(); s.questions.clear(); s.approvals.clear(); s.endedAt = this.clock();
      const kind = d.reason?.kind;
      if (kind === 'completed') this.set(s, s.goalRound && !s.closing ? 'result' : s.closing === 'blocked' ? 'error' : 'success', s.goalRound && !s.closing ? '本轮结束，目标任务继续中…' : s.closing === 'blocked' ? '目标任务受阻，请查看 Harness' : '本轮完成啦，来看看结果～');
      else if (['error','max-tokens','timeout'].includes(kind)) this.set(s, 'error', '本轮遇到问题，请查看 Harness');
      else if (kind === 'blocked') this.set(s, 'waiting', '任务受阻，等你下一步安排～');
      else this.set(s, null, null); // Aborted/unknown is not a successful completion.
      s.goalRound = false;
    }
  }
  agentStatus(id, status) {
    const s = this.get(String(id));
    if (status === 'running' && !s.state) { s.endedAt = 0; this.set(s, 'thinking', '正在处理任务…'); }
    else if (status !== 'running' && s.state && !terminal(s.state) && s.state !== 'waiting') this.set(s, null, null);
  }
  snapshot() {
    const now = this.clock(), out = [];
    for (const [id, s] of this.sessions) {
      if ((!s.state || terminal(s.state)) && now - s.updatedAt > 15000) { this.sessions.delete(id); continue; }
      if (s.state) out.push({ id: s.id.slice(0,128), turn: s.turn, state: s.state, task: s.task, updatedAt: s.updatedAt, endedAt: s.endedAt });
    }
    return out.slice(-128);
  }
}
export function apply(ctx) {
  const model = new HarnessState(), inst = randomUUID();
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'dsh-pet-bridge');
  const file = path.join(dir, 'codexpet-harness-' + process.pid + '.jsonl');
  let seq = 0, queued = null, disposed = false;
  const flush = () => {
    queued = null; if (disposed) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) { fs.rmSync(file + '.1', { force: true }); fs.renameSync(file, file + '.1'); }
      fs.appendFileSync(file, JSON.stringify({ v: 1, event: 'snapshot', pid: process.pid, inst, seq: ++seq, ts: Date.now(), sessions: model.snapshot() }) + '\n');
    } catch {} // A companion plugin must never prevent Harness from running.
  };
  const schedule = () => { if (!queued) { queued = setTimeout(flush, 50); queued.unref?.(); } };
  const idOf = s => String(s?.header?.id || s?.id || 'unknown');
  const stopEvent = ctx.on('session/event', (session, event) => { try { model.accept(idOf(session), event); schedule(); } catch {} });
  const stopAgent = ctx.on('agent/created', ({agent}) => {
    if (!agent?.ctx?.effect) return;
    const id = String(agent.session?.header?.id || agent.session?.id || agent.id || 'unknown');
    agent.ctx.effect(() => {
      const status = agent.ctx.on('agent/status', ({status}) => { model.agentStatus(id, status); schedule(); });
      const error = agent.ctx.on('agent/request-error', () => { model.accept(id, {type:'agent/request-error'}); schedule(); });
      return () => { status?.(); error?.(); const s = model.sessions.get(id); if (s && !terminal(s.state)) model.sessions.delete(id); schedule(); };
    });
  });
  ctx.effect(() => { flush(); const timer = setInterval(flush, 3000); timer.unref?.(); return () => { disposed = true; clearInterval(timer); clearTimeout(queued); stopEvent?.(); stopAgent?.(); }; });
}
