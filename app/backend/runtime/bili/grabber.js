'use strict';
// Seek to each requested second, draw the frame into a grid cell with its timestamp, then hand back one JPEG.
const wait = (el, ok, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('等待视频超时')); }, ms);
  const onOk = () => { off(); resolve(); };
  const onFail = () => { off(); reject(new Error(el.error?.message || '视频解码失败')); };
  function off() { clearTimeout(timer); el.removeEventListener(ok, onOk); el.removeEventListener('error', onFail); }
  el.addEventListener(ok, onOk);
  el.addEventListener('error', onFail);
});
const stamp = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

(async () => {
  const job = await window.grabber.job();
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  let opened = false, reason = '';
  for (const url of job.urls) {
    video.src = url;
    try { await wait(video, 'loadedmetadata', 30000); opened = true; break; } catch (error) { reason = error.message; }
  }
  if (!opened) throw new Error(reason || '视频打不开');
  const w = job.tile, h = Math.round(w * (video.videoHeight / video.videoWidth || 9 / 16));
  const cols = job.cols, rows = Math.ceil(job.times.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = w * cols;
  canvas.height = h * rows;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const taken = [];
  for (const [i, t] of job.times.entries()) {
    const at = Math.max(0, Math.min(t, (video.duration || t + 1) - 0.5));
    video.currentTime = at;
    try { await wait(video, 'seeked', 20000); } catch { continue; }
    // Give the decoder a beat to present the frame it just seeked to.
    await new Promise(resolve => setTimeout(resolve, 60));
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    ctx.drawImage(video, x, y, w, h);
    const label = stamp(at), size = Math.max(14, Math.round(h / 11)), pad = Math.round(size / 3);
    ctx.font = `bold ${size}px sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(x + pad, y + h - size - pad * 3, ctx.measureText(label).width + pad * 2, size + pad * 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + pad * 2, y + h - pad * 2.2);
    taken.push(Math.round(at));
  }
  if (!taken.length) throw new Error('一帧也没截到');
  const jpeg = canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
  window.grabber.done({ ok: true, jpeg, width: canvas.width, height: canvas.height, taken });
})().catch(error => window.grabber.done({ ok: false, message: String(error?.message || error) }));
