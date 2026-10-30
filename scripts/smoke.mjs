import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { build } from './build.mjs';
import { run, requireWindows } from './common.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
async function evaluate(url, expression) {
  const socket = new WebSocket(url);
  await Promise.race([once(socket, 'open'), sleep(8000).then(() => { throw new Error('CDP connect timeout'); })]);
  try {
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP evaluate timeout')), 8000);
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
        else resolve(message.result.result.value);
      });
    });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    return await response;
  } finally { socket.close(); }
}
requireWindows();
const { values } = parseArgs({ options: { 'app-dir': { type: 'string' } } });
const out = values['app-dir'] ? path.resolve(values['app-dir']) : await build();
await fs.access(path.join(out, 'Codex-dafeiyu.exe'));
await fs.access(path.join(out, 'resources/app/node.exe'));
// Every persistent store, including Codex memories, is isolated from the real user.
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-pet-smoke-'));
const profile = path.join(data, 'pet');
const port = await availablePort();
const env = { ...process.env, CODEX_HOME: path.join(data, 'codex'), CODEX_PET_TEST_DATA: profile, CODEX_PET_TEST_CDP: String(port) };
for (const key of ['ELECTRON_RUN_AS_NODE', 'CODEX_PET_HELPER', 'CODEX_PET_FRAMES', 'CODEX_PET_RPC_DEBUG', 'CODEX_PET_CODEX_PATH', 'DSH_PET_CODEX_PATH', 'NODE_PATH', 'NODE_OPTIONS']) delete env[key];
// Child processes must not find a developer-installed Node/npm through PATH.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.Path = path.join(process.env.SystemRoot || 'C:/Windows', 'System32') + ';' + (process.env.SystemRoot || 'C:/Windows');
await fs.mkdir(env.CODEX_HOME, { recursive: true });
const exe = path.join(out, 'Codex-dafeiyu.exe');
const child = spawn(exe, [], { cwd: out, env, windowsHide: true, stdio: 'ignore' });
let exited = false, launchError;
child.once('error', error => { launchError = error; });
child.once('exit', () => { exited = true; });
try {
  const deadline = Date.now() + 60000;
  let address, page, frame, lastError;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (exited) throw new Error('Manager exited before readiness');
    try {
      const log = await fs.readFile(path.join(profile, 'profile/app.log'), 'utf8');
      address = log.match(/服务已监听 (http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
      const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2000) })).json();
      page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
      if (address && page) {
        frame = await evaluate(page.webSocketDebuggerUrl, '({ title: document.title, videos: [...document.querySelectorAll("video")].map(v => ({width:v.videoWidth, height:v.videoHeight, ready:v.readyState})) })');
        if (frame.videos.some(v => v.ready >= 2 && v.width > 0)) break;
      }
    } catch (error) { lastError = error.message; }
    await sleep(500);
  }
  assert.ok(address, 'Backend did not become ready: ' + (lastError || ''));
  assert.ok(frame?.videos.some(v => v.ready >= 2 && v.width > 0), 'Pet renderer did not decode animation: ' + (lastError || ''));
  for (const route of ['/health', '/dsh-pet-7340/state']) {
    const res = await fetch(address + route, { signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 403, 'Unauthenticated backend access must be denied');
  }
  assert.ok((await fs.stat(path.join(profile, 'quotes.json'))).size > 0);
  const conf = JSON.parse(await fs.readFile(path.join(profile, 'dsh-pet/main-config.jsonc'), 'utf8'));
  assert.equal(conf.pets[0].id, 'main');
  // Exercise the renderer's own context menu, not just the separate manager/tray UI.
  const menu = await evaluate(page.webSocketDebuggerUrl, `(() => {
    const hit = document.querySelector('.pet-hit');
    if (!hit) throw new Error('Pet hit target not found');
    const rect = hit.getBoundingClientRect();
    hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    const column = document.querySelector('.dsh-pet-menu > .dsh-pet-menu-column');
    const labels = column ? [...column.children].map(item => item.querySelector('span')?.textContent || '') : [];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return labels;
  })()`);
  assert.ok(menu.includes('和本鱼对话'), 'The actual pet context menu did not open');
  assert.ok(menu.includes('控制大肥鱼 · WASD / 扔白饭'), 'Other pet actions must be preserved');
  assert.ok(!menu.some(label => /Codex.*重置/.test(label)), 'Retired reset query remains in the actual pet context menu');
  frame.menu = menu;
  console.log('Smoke passed: backend ready, unauthenticated requests rejected, defaults seeded, pet animation decoded, actual context menu has no reset query.');
  console.log(JSON.stringify(frame));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (!exited && child.pid) {
    // Same isolated profile; never stop a user-owned instance by image name.
    await run(exe, ['--quit'], { cwd: out, env, stdio: 'ignore' }).catch(() => {});
    for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    if (!exited) await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).catch(() => {});
  }
  console.log('Isolated smoke data retained for inspection: ' + data);
}
