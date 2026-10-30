// 「看画面」 frame grabbing. The backend starts the app's own Electron with CODEX_PET_FRAMES=<job file>;
// main.cjs hands over to this file. A hidden window gets the frames and tiles them into one grid, then exits.
//   mode 'page': open the video page like any visitor and read frames from Bilibili's own player. The page
//                gets no preload and cannot open windows or leave bilibili.com; sound is muted.
//   mode 'mp4':  decode a low-res MP4 stream the backend fetched with her login (local page, no site code).
// It shows nothing, touches no other window and keeps only its own scratch profile.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const job = JSON.parse(fs.readFileSync(process.env.CODEX_PET_FRAMES, 'utf8'));
app.setPath('userData', job.profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let done = false;
function finish(result) {
  if (done) return;
  done = true;
  try { fs.writeFileSync(job.result, JSON.stringify(result)); } catch { /* The backend reports a missing result. */ }
  app.exit(0);
}
function deliver(result) {
  if (result?.ok && typeof result.jpeg === 'string') fs.writeFileSync(job.out, Buffer.from(result.jpeg, 'base64'));
  finish({ ok: !!result?.ok, message: result?.message || '', width: result?.width, height: result?.height, taken: result?.taken });
}
setTimeout(() => finish({ ok: false, message: '截帧超时' }), job.timeoutMs || 90000);
app.on('window-all-closed', () => {});

// Runs inside the page: find the player's <video>, pause it, seek to each moment and draw the grid.
const pageScript = (times, tile, cols) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let video = null;
  for (let i = 0; i < 150 && !video; i++) { video = document.querySelector('.bpx-player-video-wrap video') || document.querySelector('video'); if (!video) await sleep(200); }
  if (!video) throw new Error('页面上没找到视频播放器');
  video.muted = true;
  for (let i = 0; i < 150 && video.readyState < 1; i++) await sleep(200);
  if (video.readyState < 1) throw new Error('视频没有加载出来');
  video.pause();
  const times = ${JSON.stringify(times)}, w = ${tile}, cols = ${cols};
  const h = Math.round(w * (video.videoHeight / video.videoWidth || 9 / 16)), rows = Math.ceil(times.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = w * cols; canvas.height = h * rows;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const stamp = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const taken = [];
  for (const [i, t] of times.entries()) {
    const at = Math.max(0, Math.min(t, (video.duration || t + 1) - 0.5));
    const seeked = new Promise(resolve => { video.addEventListener('seeked', resolve, { once: true }); setTimeout(resolve, 15000); });
    video.currentTime = at;
    await seeked;
    video.pause();
    for (let k = 0; k < 40 && video.readyState < 2; k++) await sleep(150);
    await sleep(80);
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    ctx.drawImage(video, x, y, w, h);
    const label = stamp(at), size = Math.max(14, Math.round(h / 11)), pad = Math.round(size / 3);
    ctx.font = 'bold ' + size + 'px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(x + pad, y + h - size - pad * 3, ctx.measureText(label).width + pad * 2, size + pad * 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + pad * 2, y + h - pad * 2.2);
    taken.push(Math.round(at));
  }
  return { ok: true, jpeg: canvas.toDataURL('image/jpeg', 0.82).split(',')[1], width: canvas.width, height: canvas.height, taken };
})()`;

app.whenReady().then(async () => {
  if (job.mode === 'page') {
    const ses = session.fromPartition('persist:bili-page');
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const win = new BrowserWindow({
      show: false, width: 1280, height: 800,
      webPreferences: { partition: 'persist:bili-page', contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.webContents.setAudioMuted(true);
    win.webContents.setUserAgent(job.userAgent);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!/^https:\/\/([\w-]+\.)*bilibili\.com\//.test(url)) event.preventDefault(); });
    win.webContents.on('render-process-gone', () => finish({ ok: false, message: '视频页意外关闭' }));
    try {
      await win.loadURL(job.page).catch(() => {});
      const result = await win.webContents.executeJavaScript(pageScript(job.times, job.tile, job.cols), true);
      // Keep the cookies (a returning visitor) but not the page and video cache, so the profile stays small.
      await ses.clearCache().catch(() => {});
      deliver(result);
    } catch (error) {
      finish({ ok: false, message: String(error?.message || error).replace(/^Error:\s*/, '').slice(0, 160) });
    }
    return;
  }
  // mode 'mp4': the CDN wants the video page as Referer.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*/*', 'http://*/*'] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Referer: job.referer, 'User-Agent': job.userAgent } });
  });
  ipcMain.handle('grabber:job', () => ({ urls: job.urls, times: job.times, tile: job.tile, cols: job.cols }));
  ipcMain.on('grabber:done', (_event, result) => deliver(result));
  const win = new BrowserWindow({
    show: false, width: 960, height: 540,
    // Only this local page and the video load here; cross-origin checks are off so the frames can be read back.
    webPreferences: { preload: path.join(__dirname, 'grabber-preload.cjs'), contextIsolation: true, sandbox: true, webSecurity: false, backgroundThrottling: false },
  });
  win.webContents.on('render-process-gone', () => finish({ ok: false, message: '解码进程意外退出' }));
  win.loadFile(path.join(__dirname, 'grabber.html'));
});
