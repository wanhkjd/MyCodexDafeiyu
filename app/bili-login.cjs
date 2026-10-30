// Her Bilibili login, kept in the manager process so cookies never reach the panel, the logs or the data folder:
// QR login against passport.bilibili.com, verified with /nav, stored encrypted by the OS (like API keys) and
// handed to the backend over its stdin. Ported from dsh-bili-whale lib/auth.js (MIT).
const fs = require('node:fs');
const { safeStorage } = require('electron');
const QRCode = require('qrcode/lib/core/qrcode');
const svgTag = require('qrcode/lib/renderer/svg-tag');

const PASSPORT = 'https://passport.bilibili.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TTL = 180000, INTERVAL = 2000;
const TERMINAL = new Set(['success', 'expired', 'cancelled', 'error']);

/**
 * file: the encrypted credentials; push(cred|null) sends them to the backend.
 * Panel-facing results carry status, the QR image and the account name, never a cookie.
 */
function createBiliLogin({ file, push, fetch = globalThis.fetch, now = Date.now }) {
  let session = null, nextStart = 0;

  function read() {
    try {
      const raw = fs.readFileSync(file);
      if (raw[0] !== 0x45) return null;
      const cred = JSON.parse(safeStorage.decryptString(raw.subarray(1)));
      return cred && typeof cred.sessdata === 'string' ? cred : null;
    } catch { return null; }
  }
  function write(cred) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，登录态没有保存。');
    fs.writeFileSync(file + '.tmp', Buffer.concat([Buffer.from('E'), safeStorage.encryptString(JSON.stringify(cred))]));
    fs.renameSync(file + '.tmp', file);
  }
  async function get(url, cookie, signal) {
    const response = await fetch(url, {
      redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      headers: { 'User-Agent': UA, Referer: PASSPORT + '/login', ...(cookie ? { Cookie: cookie } : {}) },
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = await response.json();
    if (body?.code !== 0) throw new Error('code ' + body?.code);
    return { data: body.data, cookies: response.headers.getSetCookie() };
  }
  /** Who the cookies belong to; throws when they are not a valid login. */
  async function verify(cred, signal) {
    const { data } = await get('https://api.bilibili.com/x/web-interface/nav', `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}`, signal)
      .catch(() => ({ data: null }));
    if (data?.isLogin !== true || !/^[1-9]\d{0,19}$/.test(String(data.mid ?? ''))) throw new Error('登录验证没通过，原来的登录态没有替换。');
    return { mid: String(data.mid), name: String(data.uname ?? '').slice(0, 60) };
  }
  const view = s => ({
    ok: s.status !== 'error', id: s.id, status: s.status, expiresAt: s.expiresAt,
    ...(s.status === 'waiting' || s.status === 'scanned' ? { image: s.image } : {}),
    ...(s.account ? { account: s.account } : {}), ...(s.error ? { message: s.error } : {}),
  });

  async function start() {
    if (now() < nextStart) return { ok: false, message: '请稍等两秒再生成二维码。' };
    nextStart = now() + INTERVAL;
    cancel();
    const s = { id: String(now()), status: 'waiting', controller: new AbortController(), expiresAt: now() + TTL, nextPoll: now() + INTERVAL };
    session = s;
    try {
      const { data } = await get(PASSPORT + '/x/passport-login/web/qrcode/generate', '', s.controller.signal);
      const url = new URL(data?.url);
      if (![PASSPORT, 'https://account.bilibili.com'].includes(url.origin) || typeof data?.qrcode_key !== 'string' || !/^[\w-]{1,256}$/.test(data.qrcode_key)) throw new Error('bad qrcode');
      s.key = data.qrcode_key;
      const svg = svgTag.render(QRCode.create(url.href, { errorCorrectionLevel: 'M' }), { margin: 2, width: 220, color: { dark: '#1f2a44', light: '#ffffff' } });
      s.image = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      return view(s);
    } catch {
      s.status = s.controller.signal.aborted ? 'cancelled' : 'error';
      s.error = '二维码生成失败，请检查网络后重试。';
      return view(s);
    }
  }

  async function poll(id) {
    const s = session;
    if (!s || s.id !== id) return { ok: false, status: 'error', message: '这个二维码已失效，请重新生成。' };
    if (TERMINAL.has(s.status)) return view(s);
    if (now() >= s.expiresAt) { s.status = 'expired'; s.controller.abort(); return view(s); }
    if (s.flight) return s.flight;
    if (now() < s.nextPoll) return view(s);
    s.nextPoll = now() + INTERVAL;
    s.flight = (async () => {
      try {
        const url = new URL('/x/passport-login/web/qrcode/poll', PASSPORT);
        url.searchParams.set('qrcode_key', s.key);
        const { data, cookies } = await get(url.href, '', s.controller.signal);
        if (data?.code === 86101) s.status = 'waiting';
        else if (data?.code === 86090) s.status = 'scanned';
        else if (data?.code === 86038) s.status = 'expired';
        else if (data?.code === 0) {
          const values = {};
          for (const line of cookies) {
            const pair = line.split(';', 1)[0], at = pair.indexOf('=');
            const name = pair.slice(0, at).trim();
            if (['SESSDATA', 'bili_jct', 'buvid3'].includes(name)) values[name] = pair.slice(at + 1).trim();
          }
          if (!values.SESSDATA || !values.bili_jct) throw new Error('登录成功了，但没拿到登录凭据，请重新扫码。');
          const cred = { sessdata: values.SESSDATA, bili_jct: values.bili_jct, buvid3: values.buvid3 || '' };
          const account = await verify(cred, s.controller.signal);
          if (session !== s) throw new Error('登录流程已失效，请重新扫码。');
          write({ ...cred, ...account, at: now() });
          push({ ...cred, ...account });
          s.account = account;
          s.status = 'success';
        } else throw new Error('无法识别扫码状态，请重新扫码。');
      } catch (error) {
        if (!TERMINAL.has(s.status)) {
          s.status = s.controller.signal.aborted ? 'cancelled' : 'error';
          s.error = error instanceof Error && /[一-龥]/.test(error.message) ? error.message : '登录没有保存，请重新扫码。';
        }
      } finally { s.flight = null; }
      if (TERMINAL.has(s.status)) { delete s.key; delete s.image; }
      return view(s);
    })();
    return s.flight;
  }

  function cancel(id) {
    const s = session;
    if (!s || (id && s.id !== id)) return { ok: true, status: 'cancelled' };
    if (!TERMINAL.has(s.status)) s.status = 'cancelled';
    s.controller.abort();
    delete s.key; delete s.image;
    return view(s);
  }

  function logout() {
    cancel();
    fs.rmSync(file, { force: true });
    push(null);
    return { ok: true, account: null };
  }

  const account = () => { const cred = read(); return cred ? { mid: String(cred.mid ?? ''), name: String(cred.name ?? '') } : null; };

  return { start, poll, cancel, logout, account, credentials: read };
}

module.exports = { createBiliLogin };
