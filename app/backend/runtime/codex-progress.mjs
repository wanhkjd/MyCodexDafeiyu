// Read only public Codex messages. Never starts a Codex process, requests a model, or reads quota data.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
const terminal = status => ['completed', 'failed', 'interrupted'].includes(status);
const keyOf = t => `${t.thread_id}:${t.turn_id}`;
const clean = value => typeof value === 'string' ? value.replace(/\u0000/g, '') : '';
const preview = text => clean(text).replace(/\s+/g, ' ').trim().slice(0, 140);
// Desktop retries can project history under an execution ID instead of the chat ID.
// The rollout filename explicitly links these IDs; never guess from title or cwd.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const executionRollout = new RegExp('^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-(' + uuid + ')_(' + uuid + ')\\.jsonl$', 'i');
const normalizePath = value => clean(value).replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/$/, '');
function rolloutIds(file) { return executionRollout.exec(normalizePath(file).split('/').at(-1)); }
function parse(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }
function latestDatabase(home, prefix) {
  const names = readdirSync(home).filter(n => new RegExp(`^${prefix}_\\d+\\.sqlite$`).test(n));
  names.sort((a, b) => Number(b.match(/_(\d+)\./)[1]) - Number(a.match(/_(\d+)\./)[1]));
  if (!names[0]) throw new Error('尚未发现本机 Codex 历史数据库');
  return join(home, names[0]);
}
function publicQuestion(raw) {
  const questions = parse(raw, []);
  if (!Array.isArray(questions)) return '';
  return questions.map(q => [clean(q.question), ...(Array.isArray(q.options) ? q.options.map(o => [clean(o.label), clean(o.description)].filter(Boolean).join('：')) : [])].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}
export class CodexProgressReader {
  constructor({ home = process.env.CODEX_HOME || join(homedir(), '.codex'), dataHome = '', now = Date.now, open = file => new DatabaseSync(file, { readOnly: true }) } = {}) {
    this.home = home; this.dataHome = dataHome; this.open = open; this.now = now; this.activity = new Map(); this.threadOwners = new Map();
  }
  connect() {
    if (this.history && this.metadata) return;
    try {
      this.history = this.open(latestDatabase(this.home, 'thread_history'));
      this.metadata = this.open(latestDatabase(this.home, 'state'));
      for (const db of [this.history, this.metadata]) db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100;');
      const columns = new Set(this.metadata.prepare('PRAGMA table_info(threads)').all().map(c => c.name));
      const extra = ['source', 'thread_source', 'agent_role', 'agent_path', 'rollout_path'].map(c => columns.has(c) ? c : `NULL AS ${c}`);
      this.metaQuery = this.metadata.prepare(`SELECT id,cwd,archived,${extra.join(',')} FROM threads`);
      this.itemsQuery = this.history.prepare(`SELECT item_id,rollout_ordinal,updated_at_ordinal,created_at_ms,completed_at_ms,item_type,
        json_extract(item_json,'$.phase') phase,
        CASE WHEN item_type='agentMessage' AND (json_extract(item_json,'$.phase') IN ('commentary','final_answer') OR json_extract(item_json,'$.phase') IS NULL) THEN json_extract(item_json,'$.text') END text,
        json_extract(item_json,'$.status') status,json_extract(item_json,'$.tool') tool,
        CASE WHEN item_type NOT IN ('reasoning','userMessage') THEN COALESCE(json_extract(item_json,'$.questions'),json_extract(item_json,'$.arguments.questions')) END questions
        FROM thread_items WHERE thread_id=? AND turn_id=? ORDER BY rollout_ordinal`);
    } catch (error) { this.close(); throw error; }
  }
  resolveMetadata(turns) {
    const byId = new Map(this.metaQuery.all().map(meta => [meta.id, meta]));
    const owners = new Map();
    const link = (execution, owner) => {
      // Ambiguous aliases are not permission to read an unrelated conversation.
      owners.set(execution, owners.has(execution) && owners.get(execution) !== owner ? null : owner);
    };
    for (const [execution, owner] of this.threadOwners) if (byId.has(owner)) link(execution, owner);
    for (const meta of byId.values()) {
      const ids = rolloutIds(meta.rollout_path);
      if (ids && ids[1] === meta.id) link(ids[2], meta.id);
    }
    const directories = new Set();
    for (const t of turns) {
      if (byId.has(t.thread_id) || owners.has(t.thread_id) || !Number.isFinite(t.started_at)) continue;
      // A later retry can replace state.rollout_path before the previous result is polled.
      // Inspect names only, on the turn's day (+/-1 for timezone boundaries), not message logs.
      for (const offset of [-86400, 0, 86400]) {
        const date = new Date((t.started_at + offset) * 1000).toISOString().slice(0, 10).split('-');
        const dir = join(this.home, 'sessions', ...date);
        if (directories.has(dir)) continue;
        directories.add(dir);
        let names;
        try { names = readdirSync(dir); } catch { continue; }
        for (const name of names) {
          const ids = rolloutIds(name);
          if (ids && byId.has(ids[1])) link(ids[2], ids[1]);
        }
      }
    }
    const resolved = new Map();
    this.threadOwners.clear();
    for (const t of turns) {
      const owner = owners.get(t.thread_id);
      const meta = byId.get(t.thread_id) || (owner && byId.get(owner));
      if (meta) {
        resolved.set(t.thread_id, meta);
        if (meta.id !== t.thread_id) this.threadOwners.set(t.thread_id, meta.id);
      }
    }
    return resolved;
  }
  read({ since, tracked = [] }) {
    this.connect();
    const turns = this.history.prepare(`SELECT thread_id,turn_id,status,started_at,completed_at,error_json,rollout_ordinal,final_agent_item_id
      FROM thread_turns WHERE status='inProgress' OR completed_at>=?`).all(Math.floor(since / 1000) - 2);
    const keys = new Set(turns.map(keyOf));
    const getTurn = this.history.prepare('SELECT thread_id,turn_id,status,started_at,completed_at,error_json,rollout_ordinal,final_agent_item_id FROM thread_turns WHERE thread_id=? AND turn_id=?');
    const newerTurn = this.history.prepare('SELECT 1 FROM thread_turns WHERE thread_id=? AND rollout_ordinal>? LIMIT 1');
    const trackedKeys = new Set(tracked.map(t => t.key));
    for (const t of tracked) {
      if (keys.has(t.key)) continue;
      const row = getTurn.get(t.threadId, t.turnId);
      if (row) { turns.push(row); keys.add(keyOf(row)); }
    }
    const result = [];
    const excluded = normalizePath(this.dataHome).toLowerCase() + '/chat-sandbox';
    const metadata = this.resolveMetadata(turns);
    const newestByChat = new Map();
    for (const t of turns) {
      const id = metadata.get(t.thread_id)?.id;
      if (id) newestByChat.set(id, Math.max(newestByChat.get(id) || 0, t.started_at || 0));
    }
    for (const t of turns) {
      const meta = metadata.get(t.thread_id);
      if (!meta || (meta.archived && !trackedKeys.has(keyOf(t))) || (meta.thread_source && meta.thread_source !== 'user') || /subagent|automation/i.test(meta.source || '') || meta.agent_role || meta.agent_path) continue;
      const cwd = normalizePath(meta.cwd);
      if (cwd.toLowerCase() === excluded || cwd.toLowerCase().startsWith(excluded + '/')) continue;
      const rows = this.itemsQuery.all(t.thread_id, t.turn_id);
      const activitySignature = JSON.stringify(rows.map(i => [i.item_id, i.updated_at_ordinal, i.completed_at_ms, i.status]));
      const previous = this.activity.get(keyOf(t));
      const observedAt = previous ? (previous.signature === activitySignature ? previous.at : this.now()) :
        Math.max(t.started_at * 1000, ...rows.map(i => Math.max(i.created_at_ms || 0, i.completed_at_ms || 0)));
      this.activity.set(keyOf(t), { signature: activitySignature, at: observedAt });
      const messages = rows.filter(i => i.item_type === 'agentMessage' && clean(i.text).trim()).map(i => ({
        id: i.item_id, kind: i.phase === 'final_answer' || i.item_id === t.final_agent_item_id ? 'result' : 'progress', text: clean(i.text), at: i.created_at_ms || t.started_at * 1000,
      }));
      // Reasoning/tool-output rows are never copied into the report. An outstanding prompt
      // may precede another tool item, so inspect all explicit unresolved prompts.
      const last = [...rows].reverse().find(i => !i.completed_at_ms && !['completed', 'failed', 'interrupted', 'cancelled'].includes(i.status) && (
        ['waitingForApproval', 'pendingApproval', 'waitingForInput'].includes(i.status) ||
        /request_user_input|ask_user|approval/i.test(i.tool || '') || publicQuestion(i.questions))) || null;
      const question = last ? publicQuestion(last.questions) : '';
      const waiting = t.status === 'inProgress' && !!last && (
        ['waitingForApproval', 'pendingApproval', 'waitingForInput'].includes(last.status) ||
        (!last.completed_at_ms && !['completed', 'failed'].includes(last.status) && /request_user_input|ask_user|approval/i.test(last.tool || '')) || !!question);
      const superseded = t.status === 'inProgress' && (!!newerTurn.get(t.thread_id, t.rollout_ordinal) || newestByChat.get(meta.id) > t.started_at);
      const stale = t.status === 'inProgress' && !waiting && this.now() - observedAt >= 600000;
      if ((superseded || stale) && !trackedKeys.has(keyOf(t))) continue;
      const error = parse(t.error_json);
      result.push({ key: keyOf(t), threadId: t.thread_id, turnId: t.turn_id, project: basename(cwd) || 'Codex',
        status: superseded || stale ? 'unknown' : waiting ? 'waiting' : t.status,
        startedAt: (t.started_at || 0) * 1000, endedAt: (t.completed_at || 0) * 1000, messages,
        waiting: waiting ? { id: last.item_id, text: question || 'Codex 正在等待你的确认，请回到 Codex 处理。' } : null,
        error: clean(error?.message || error?.error?.message),
      });
    }
    const retained = new Set(turns.map(keyOf));
    for (const key of this.activity.keys()) if (!retained.has(key)) this.activity.delete(key);
    return result;
  }
  close() {
    this.history?.close(); this.metadata?.close(); this.history = this.metadata = null; this.activity.clear(); this.threadOwners.clear();
  }
}

// Only the latest live state is kept in memory. No history file, list, unread state or model call.
export class CodexProgressMonitor {
  constructor({ home, reader = new CodexProgressReader({ dataHome: home }), now = Date.now } = {}) {
    this.reader = reader; this.now = now; this.startedAt = this.since = now();
    this.live = new Map(); this.notices = []; this.lastProgressAt = -Infinity; this.wasEnabled = false;
  }
  read(enabled = true) {
    const at = this.now();
    if (!enabled) {
      this.close(); this.startedAt = this.since = at;
      return { enabled: false, current: [], notices: [] };
    }
    if (!this.wasEnabled) { this.startedAt = this.since = at; this.wasEnabled = true; }
    try {
      const rows = this.reader.read({ since: this.since, tracked: [...this.live.values()] });
      const present = new Set();
      this.notices = this.notices.filter(n => at - n.at < 15000);
      let progressed = false;
      for (const row of rows) {
        present.add(row.key);
        let entry = this.live.get(row.key);
        // Starting/re-enabling the pet must not replay already finished conversations.
        if (!entry && terminal(row.status) && row.endedAt <= this.startedAt) continue;
        if (!entry) {
          entry = { key: row.key, threadId: row.threadId, turnId: row.turnId, shown: '', signature: '', at };
          this.live.set(row.key, entry);
        }
        const previousStatus = entry.status;
        entry.status = row.status; entry.project = row.project; entry.endedAt = row.endedAt;
        const latest = row.messages.at(-1)?.text || '';
        const result = [...row.messages].reverse().find(m => m.kind === 'result')?.text;
        if (row.status === 'inProgress') {
          this.notices = this.notices.filter(n => n.key !== row.key);
          // Real progress replaces the running fallback immediately; subsequent progress keeps
          // the 10s throttle. Resolving a question must also immediately give way.
          if (latest && (latest !== entry.shown || previousStatus === 'waiting') &&
              (!entry.shown || previousStatus === 'waiting' || at - this.lastProgressAt >= 10000)) {
            entry.shown = latest; entry.text = preview(latest); entry.at = at; progressed = true;
          }
          if (!latest && previousStatus === 'waiting') entry.text = '';
          entry.signature = '';
        } else {
          const fallback = { completed: '本轮已完成，请到 Codex 查看结果。', failed: '任务失败，请到 Codex 查看原因。', interrupted: '任务已中断。', unknown: '暂未检测到新进展，请查看 Codex。' };
          const text = preview(row.status === 'waiting' ? row.waiting?.text || 'Codex 正在等待你确认。' :
            row.status === 'completed' ? result || fallback.completed : row.error || result || fallback[row.status] || '请查看 Codex 当前状态。');
          const signature = row.status + ':' + text;
          if (signature !== entry.signature) {
            entry.signature = signature; entry.text = text; entry.at = at;
            this.notices = this.notices.filter(n => n.key !== row.key);
            this.notices.push({ key: row.key, project: row.project, kind: row.status, text, at });
          }
        }
      }
      if (progressed) this.lastProgressAt = at;
      // Keep only active tasks and a brief deduplication window for late final messages.
      for (const [key, entry] of this.live) {
        if (!present.has(key) || (terminal(entry.status) && at - entry.endedAt > 60000) || (entry.status === 'unknown' && at - entry.at > 60000)) this.live.delete(key);
      }
      this.since = at;
      // An active turn without public text still needs the renderer's running indicator.
      const current = [...this.live.values()].filter(e => ['inProgress', 'waiting'].includes(e.status))
        .map(e => ({ key: e.key, project: e.project, kind: e.status === 'waiting' ? 'waiting' : 'progress', text: e.text || '', at: e.at }));
      return { enabled: true, current, notices: this.notices };
    } catch {
      this.reader.close();
      // Missing/busy/incompatible data is never evidence of completion.
      return { enabled: true, current: [], notices: [], unavailable: true };
    }
  }
  close() { this.reader.close(); this.live.clear(); this.notices = []; this.lastProgressAt = -Infinity; this.wasEnabled = false; }
}
