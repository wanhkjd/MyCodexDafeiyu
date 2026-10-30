// Bilibili requests for her Bilibili life: WBI signing, cookies, pacing, read budgets, a circuit breaker
// and small caches. Ported from dsh-bili-whale (MIT): tools/lib/bili-api.mjs and tools/lib/traffic.mjs.
// Phase 1 only reads. Requests go straight to Bilibili, not through the system proxy.
// Login cookies come from the manager over stdin (setCredentials) and are never written here.
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// Conservative defaults the original chose for fresh accounts; fixed on purpose (no knobs).
export const RISK = { minGapMs: 1500, readHourly: 600, readDaily: 3000 };
const MIN = 60e3, HOUR = 60 * MIN;
// "Too many requests" codes pause everything; -352 (a check failed for that one request) only fails the request.
const BAN_CODES = new Set([-412, -799, -509]);
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const keyOf = url => String(url).split('/').at(-1).split('.')[0];
const isBili = host => host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv';

let credentials = null;

/** Login cookies from the manager ({sessdata, bili_jct, buvid3?, mid, name}), or null after logging out. */
export function setCredentials(value) {
  const c = value && typeof value === 'object' ? value : null;
  credentials = c && typeof c.sessdata === 'string' && c.sessdata
    ? { sessdata: c.sessdata, bili_jct: String(c.bili_jct ?? ''), buvid3: String(c.buvid3 ?? ''), mid: String(c.mid ?? ''), name: String(c.name ?? '') }
    : null;
}

/** Who she is logged in as ({mid, name}), without any secret; null when logged out. */
export const account = () => credentials ? { mid: credentials.mid, name: credentials.name } : null;

export function signWbi(params, images, now = Date.now()) {
  const raw = keyOf(images?.img_url ?? '') + keyOf(images?.sub_url ?? '');
  if (raw.length !== 64) throw new Error('WBI 签名密钥缺失，请稍后重试');
  const key = MIXIN.map(i => raw[i]).join('').slice(0, 32);
  const values = { ...params, wts: Math.floor(now / 1000) };
  delete values.w_rid;
  const query = Object.keys(values).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${crypto.createHash('md5').update(query + key).digest('hex')}`;
}

const agent = new https.Agent({ keepAlive: true, maxSockets: 2 });

/** One HTTPS GET straight to the host: {status, headers, body}. Never follows redirects. */
export function request(url, { headers = {}, timeoutMs = 20000, maxBytes = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, agent, signal: AbortSignal.timeout(timeoutMs) }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(new Error('响应太大')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  try { writeFileSync(file + '.tmp', JSON.stringify(value)); renameSync(file + '.tmp', file); } catch { /* State is best effort. */ }
}
const pad = n => String(n).padStart(2, '0');
const hourKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}`; };

/**
 * A paced, budgeted Bilibili client keeping its state in dir (traffic.json, cache.json, device.json).
 * json() and text() never throw: failures come back as {code, message} / {ok:false, message}.
 */
export function createClient({ dir, transport = request, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), risk = RISK } = {}) {
  mkdirSync(dir, { recursive: true });
  const trafficFile = join(dir, 'traffic.json'), cacheFile = join(dir, 'cache.json'), deviceFile = join(dir, 'device.json');
  let queue = Promise.resolve(), last = 0;

  const traffic = () => {
    const t = readJson(trafficFile, {}), hour = hourKey(now()), day = hour.slice(0, 10);
    return {
      hour: t.hour?.key === hour ? t.hour : { key: hour, n: 0 },
      day: t.day?.key === day ? t.day : { key: day, n: 0 },
      ban: t.ban && Number(t.ban.until) > 0 ? t.ban : { until: 0, streak: 0, why: '' },
    };
  };
  const bannedFor = () => Math.max(0, Number(traffic().ban.until) - now());
  function trip(why) {
    const t = traffic(), streak = Number(t.ban.streak || 0) + 1, minutes = Math.min(30, 5 * 2 ** (streak - 1));
    writeJson(trafficFile, { ...t, ban: { until: now() + minutes * MIN, streak, why } });
    return minutes;
  }
  function settle() {
    const t = traffic();
    if (t.ban.streak) writeJson(trafficFile, { ...t, ban: { until: 0, streak: 0, why: '' } });
  }
  /** Count a network read against the hourly and daily budgets; false when one is used up. */
  function spend() {
    const t = traffic();
    if (t.hour.n >= risk.readHourly || t.day.n >= risk.readDaily) return false;
    t.hour.n++; t.day.n++;
    writeJson(trafficFile, t);
    return true;
  }
  // Requests run one at a time, at least minGapMs apart: bursts are what gets accounts flagged.
  function paced(fn) {
    const turn = queue.then(async () => {
      const wait = last + risk.minGapMs - now();
      if (wait > 0) await sleep(wait);
      try { return await fn(); } finally { last = now(); }
    });
    queue = turn.catch(() => {});
    return turn;
  }

  const cacheKey = url => {
    const u = new URL(url);
    const params = [...u.searchParams.entries()].filter(([k]) => k !== 'wts' && k !== 'w_rid').sort(([a], [b]) => a.localeCompare(b));
    const who = crypto.createHash('sha256').update(credentials?.sessdata ?? '').digest('hex').slice(0, 16);
    return `${who}:${u.host}${u.pathname}?${new URLSearchParams(params)}`;
  };
  function cached(key, ttl) {
    const hit = readJson(cacheFile, {})[key];
    return hit && now() - Number(hit.at) < ttl ? hit.data : null;
  }
  function remember(key, data) {
    const store = readJson(cacheFile, {});
    store[key] = { at: now(), data };
    const keys = Object.keys(store);
    if (keys.length > 400) for (const k of keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - 400)) delete store[k];
    writeJson(cacheFile, store);
  }

  function cookie() {
    const device = readJson(deviceFile, {});
    const parts = [];
    const buvid3 = credentials?.buvid3 || device.buvid3;
    if (buvid3) parts.push(`buvid3=${buvid3}`);
    if (device.buvid4) parts.push(`buvid4=${device.buvid4}`);
    if (credentials) parts.push(`SESSDATA=${credentials.sessdata}`, `bili_jct=${credentials.bili_jct}`, `DedeUserID=${credentials.mid}`);
    return parts.join('; ');
  }
  const headersFor = referer => ({ 'User-Agent': UA, Referer: referer || 'https://www.bilibili.com/', Accept: 'application/json, text/plain, */*', ...(cookie() ? { Cookie: cookie() } : {}) });

  /** One network round trip with budget, breaker and pacing: {ok, status, headers, body} or {ok:false, message}. */
  async function fetchRaw(url, { referer, maxBytes, timeoutMs } = {}) {
    const host = new URL(url).hostname;
    const banned = isBili(host) ? bannedFor() : 0;
    if (banned) return { ok: false, banned: true, message: `B 站限流中，约 ${Math.max(1, Math.round(banned / MIN))} 分钟后恢复` };
    return paced(async () => {
      if (isBili(host) && bannedFor()) return { ok: false, banned: true, message: 'B 站限流中，请稍后再试' };
      if (!spend()) return { ok: false, message: `今天的 B 站请求预算已用完（每小时 ${risk.readHourly}、每天 ${risk.readDaily} 次），晚点再看` };
      try {
        const res = await transport(url, { headers: headersFor(referer), maxBytes, timeoutMs });
        if (isBili(host) && (res.status === 412 || res.status === 429)) {
          const minutes = trip(`HTTP ${res.status}`);
          return { ok: false, banned: true, message: `B 站限流（HTTP ${res.status}），先停 ${minutes} 分钟` };
        }
        return { ok: true, status: res.status, headers: res.headers || {}, body: res.body };
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return { ok: false, message: timeout ? 'B 站请求超时' : `网络请求失败（${error?.code || error?.message || '未知原因'}）` };
      }
    });
  }

  let deviceReady = null;
  /** Anonymous device ids (buvid3/4) that search and some lists insist on; fetched once and kept. */
  function ensureDevice() {
    const device = readJson(deviceFile, {});
    if (device.buvid3 || credentials?.buvid3) return Promise.resolve();
    deviceReady ??= (async () => {
      const res = await fetchRaw('https://api.bilibili.com/x/frontend/finger/spi');
      try {
        const data = JSON.parse(res.body.toString('utf8')).data;
        if (data?.b_3) writeJson(deviceFile, { buvid3: data.b_3, buvid4: data.b_4 || '', at: now() });
      } catch { /* Try again next time. */ }
    })().finally(() => { deviceReady = null; });
    return deviceReady;
  }

  async function wbiImages() {
    const nav = await json('https://api.bilibili.com/x/web-interface/nav', { ttl: 10 * MIN, allowCodes: [-101] });
    return nav?.data?.wbi_img ?? null;
  }

  /**
   * GET JSON: options {params, signed, ttl, referer, allowCodes}. signed adds the WBI signature;
   * ttl caches successful (code 0) replies. Platform risk codes trip the breaker.
   */
  async function json(url, { params, signed = false, ttl = 0, referer, allowCodes = [] } = {}) {
    await ensureDevice();
    const u = new URL(url);
    for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
    const key = cacheKey(u.href);
    if (ttl) { const hit = cached(key, ttl); if (hit) return { ...hit, cached: true }; }
    if (signed) {
      const images = await wbiImages();
      if (!images) return { code: -1, message: 'WBI 签名密钥获取失败，请稍后重试' };
      u.search = signWbi(Object.fromEntries(u.searchParams), images, now());
    }
    const res = await fetchRaw(u.href, { referer });
    if (!res.ok) return { code: res.banned ? -412 : -1, message: res.message };
    if (res.status !== 200) return { code: -1, message: `B 站接口返回 HTTP ${res.status}` };
    let data;
    try { data = JSON.parse(res.body.toString('utf8')); } catch { return { code: -1, message: 'B 站返回的内容不是 JSON，可能被风控了' }; }
    const code = Number(data?.code);
    if (BAN_CODES.has(code)) {
      const minutes = trip(`code ${code}`);
      return { ...data, message: `${data.message || 'B 站风控'}（${code}），先停 ${minutes} 分钟` };
    }
    if (code === 0) settle();
    else if (!allowCodes.includes(code)) return { ...data, message: data.message || `B 站接口返回 ${code}` };
    // allowCodes are answers worth keeping too (nav says -101 when logged out but still carries the WBI keys).
    if (ttl) remember(key, data);
    return data;
  }

  /** GET text (subtitles, danmaku XML): {ok, text} or {ok:false, message}. inflate handles bodies sent deflated without a header. */
  async function text(url, { referer, inflate = false, maxBytes } = {}) {
    await ensureDevice();
    const res = await fetchRaw(url, { referer, maxBytes });
    if (!res.ok) return { ok: false, message: res.message };
    if (res.status !== 200) return { ok: false, message: `HTTP ${res.status}` };
    let body = res.body;
    if (inflate && !/^\s*</.test(body.subarray(0, 64).toString('utf8'))) {
      for (const fn of ['inflateRawSync', 'inflateSync', 'gunzipSync', 'brotliDecompressSync']) {
        try { body = zlib[fn](res.body); break; } catch { /* Try the next format. */ }
      }
    }
    return { ok: true, text: body.toString('utf8') };
  }

  /** GET bytes (a cover image): {ok, body} or {ok:false, message}. */
  async function bytes(url, { referer, maxBytes = 2 * 1024 * 1024 } = {}) {
    const res = await fetchRaw(url, { referer, maxBytes });
    if (!res.ok) return { ok: false, message: res.message };
    return res.status === 200 ? { ok: true, body: res.body } : { ok: false, message: `HTTP ${res.status}` };
  }

  /** Where a short link (b23.tv) points, without following it. */
  async function location(url) {
    const res = await fetchRaw(url);
    return res.ok && res.status >= 300 && res.status < 400 ? String(res.headers.location || '') : '';
  }

  /** Count reads made outside this client (the frame grabber streaming a video). */
  const charge = (n = 1) => { for (let i = 0; i < n; i++) if (!spend()) return false; return true; };

  function state() {
    const t = traffic(), banned = bannedFor();
    return {
      account: account(), banned: banned > 0, bannedMinutes: banned ? Math.max(1, Math.round(banned / MIN)) : 0, banWhy: banned ? t.ban.why : '',
      reads: { hour: t.hour.n, day: t.day.n, hourly: risk.readHourly, daily: risk.readDaily },
    };
  }

  return { json, text, bytes, location, charge, state, headersFor };
}
