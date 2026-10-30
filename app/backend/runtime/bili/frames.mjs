// 「看画面」: have the app's own Electron grab a 3×3 grid of frames in a hidden window (bili/grabber.cjs)
// and return it as a JPEG for the vision model. First it opens the video page like any visitor and reads
// Bilibili's own player; if that fails and she is logged in, it decodes the MP4 stream got with her login.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UA } from './api.mjs';

/** Evenly spread moments, skipping the first and last 6% (intros and end cards), in whole seconds. */
export function frameTimes(duration, count = 9) {
  const d = Math.max(1, Number(duration) || 0);
  const start = Math.min(d * 0.06, 20), end = d - Math.min(d * 0.06, 20);
  if (end - start < count) return [...new Set(Array.from({ length: count }, (_, i) => Math.floor(d * (i + 0.5) / count)))];
  return Array.from({ length: count }, (_, i) => Math.round(start + (end - start) * (i + 0.5) / count));
}

/** One run of the grabber process for a job; resolves with its result object or throws. */
async function runGrabber({ job, dir, electronPath, timeoutMs, spawnImpl }) {
  mkdirSync(dir, { recursive: true });
  const id = `${job.bvid}-${Date.now()}`;
  const jobFile = join(dir, id + '.job.json'), resultFile = join(dir, id + '.result.json'), out = join(dir, job.bvid + '.jpg');
  writeFileSync(jobFile, JSON.stringify({ ...job, out, result: resultFile, profile: join(dir, 'profile'), timeoutMs: timeoutMs - 5000 }));
  try {
    const env = { ...process.env, CODEX_PET_FRAMES: jobFile };
    delete env.CODEX_PET_HELPER;
    delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = spawnImpl(electronPath, [], { env, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('看画面超时')); }, timeoutMs);
      child.once('error', error => { clearTimeout(timer); reject(new Error('截帧程序启动失败：' + error.message)); });
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    let result;
    try { result = JSON.parse(readFileSync(resultFile, 'utf8')); } catch { throw new Error('截帧程序没有给出结果'); }
    if (!result.ok) throw new Error(result.message || '截帧失败');
    return { jpeg: readFileSync(out).toString('base64'), times: result.taken, width: result.width, height: result.height, file: out };
  } finally {
    rmSync(jobFile, { force: true });
    rmSync(resultFile, { force: true });
    prune(dir);
  }
}

/**
 * Grab one grid for a video ({bvid, cid, duration}): {jpeg (base64), times, width, height, file, via}.
 * Throws with a readable reason when both ways fail.
 */
export async function grabGrid({ client, video, dir, electronPath = process.env.DSH_PET_ELECTRON_PATH, timeoutMs = 90000, tile = 640, spawnImpl = spawn }) {
  if (!electronPath) throw new Error('找不到桌宠自带的 Electron，没法看画面');
  const { bvid, cid, duration } = video;
  const referer = `https://www.bilibili.com/video/${bvid}/`;
  const base = { bvid, times: frameTimes(duration), tile, cols: 3, userAgent: UA, referer };
  let pageError;
  try {
    // A page view also loads a few stream ranges: count it like the direct route does.
    if (!client.charge(3)) throw new Error('今天的 B 站请求预算不够看画面了');
    return { ...await runGrabber({ job: { ...base, mode: 'page', page: referer }, dir, electronPath, timeoutMs, spawnImpl }), via: 'page' };
  } catch (error) { pageError = error; }
  if (!client.state().account) throw pageError;
  const play = await client.json('https://api.bilibili.com/x/player/wbi/playurl', {
    params: { bvid, cid, qn: 64, fnval: 1, fourk: 0, platform: 'html5', high_quality: 1 }, signed: true, referer,
  });
  if (play.code !== 0) throw new Error(`${pageError.message}；视频流也拿不到：${play.message || play.code}`);
  const durl = play.data?.durl?.[0];
  const urls = [durl?.url, ...(durl?.backup_url ?? [])].filter(u => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 3);
  if (!urls.length) throw new Error(`${pageError.message}；这个视频没有可用的 MP4 流`);
  return { ...await runGrabber({ job: { ...base, mode: 'mp4', urls }, dir, electronPath, timeoutMs, spawnImpl }), via: 'mp4' };
}

/** Keep only the 20 newest grids. */
function prune(dir) {
  try {
    const grids = readdirSync(dir).filter(name => name.endsWith('.jpg')).map(name => ({ name, at: statSync(join(dir, name)).mtimeMs }));
    for (const old of grids.sort((a, b) => b.at - a.at).slice(20)) rmSync(join(dir, old.name), { force: true });
  } catch { /* Housekeeping only. */ }
}
