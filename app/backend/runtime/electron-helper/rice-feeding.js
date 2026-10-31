/** One small food window per pet. Coordinates are native screen units, not renderer CSS pixels. */
'use strict';
const path = require('node:path');

function createRiceFeeding({ BrowserWindow, ipcMain, screen, isOwner, scale = () => 1 }) {
  const targets = new Map();
  const sessions = new Map();
  let sequence = 0;
  const alive = win => !!win && !win.isDestroyed();
  const ownerOf = event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return alive(win) && isOwner(win) ? win : null;
  };
  const notify = (win, channel, data) => {
    if (alive(win) && !win.webContents.isDestroyed()) win.webContents.send(channel, data);
  };
  function usable(owner) {
    return alive(owner) && isOwner(owner) && owner.isVisible() && targets.get(owner.id)?.enabled === true;
  }
  function cancel(owner) {
    const s = sessions.get(owner.id);
    if (!s) return;
    sessions.delete(owner.id);
    clearInterval(s.timer);
    notify(owner, 'pet:rice-state', { active: false, session: s.id, over: false });
    if (alive(s.food)) s.food.destroy();
  }
  function bodyAt(owner, point) {
    if (!usable(owner)) return false;
    const r = targets.get(owner.id).rect;
    const b = owner.getContentBounds();
    // Require the actual visible body, never the transparent window margins.
    return point.x >= b.x + Math.max(0, r.x) && point.x < b.x + Math.min(b.width, r.x + r.width)
      && point.y >= b.y + Math.max(0, r.y) && point.y < b.y + Math.min(b.height, r.y + r.height);
  }
  function status(s, over = false, message = '') {
    if (s.over !== over) {
      s.over = over;
      notify(s.owner, 'pet:rice-state', { active: true, session: s.id, over });
    }
    notify(s.food, 'rice:state', { over, pending: !!s.pending, message });
  }
  function move(s) {
    const p = screen.getCursorScreenPoint();
    const b = s.food.getContentBounds();
    if (Math.hypot(p.x - s.start.x, p.y - s.start.y) >= 4) s.moved = true;
    s.food.setContentBounds({ x: Math.round(p.x - s.offset.x), y: Math.round(p.y - s.offset.y), width: b.width, height: b.height });
    const over = bodyAt(s.owner, p);
    if (s.over !== over) status(s, over);
    return p;
  }
  function randomBounds(owner) {
    const areas = screen.getAllDisplays().map(d => d.workArea).filter(a => a.width >= 40 && a.height >= 40);
    if (!areas.length) return null;
    const area = areas[Math.floor(Math.random() * areas.length)];
    const size = Math.min(Math.max(72, Math.min(220, Math.round(110 * scale()))), area.width, area.height);
    const pick = () => ({ x: area.x + Math.floor(Math.random() * (area.width - size + 1)), y: area.y + Math.floor(Math.random() * (area.height - size + 1)), width: size, height: size });
    // Usually keep the initial food away from the pet; still work on very small screens.
    const b = owner.getContentBounds();
    let next = pick();
    for (let i = 0; i < 24 && next.x < b.x + b.width && next.x + size > b.x && next.y < b.y + b.height && next.y + size > b.y; i++) next = pick();
    return next;
  }
  function spawn(owner) {
    if (!usable(owner)) return;
    const old = sessions.get(owner.id);
    if (old?.pending || old?.dragging) return;
    const bounds = randomBounds(owner);
    if (!bounds) return;
    if (old) {
      old.food.setContentBounds(bounds);
      status(old, false, '拖到桌宠身上松手 · 右击取消');
      return;
    }
    const food = new BrowserWindow({ ...bounds, title: '白饭 · 拖到桌宠身上', frame: false, transparent: true, show: false,
      alwaysOnTop: true, skipTaskbar: true, resizable: false, maximizable: false, minimizable: false, hasShadow: false, focusable: false,
      webPreferences: { preload: path.join(__dirname, 'rice-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const s = { id: ++sequence, owner, food, dragging: false, over: false, pending: null, timer: null };
    sessions.set(owner.id, s);
    notify(owner, 'pet:rice-state', { active: true, session: s.id, over: false });
    food.setAlwaysOnTop(true, 'screen-saver');
    food.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    food.webContents.on('will-navigate', e => e.preventDefault());
    food.webContents.on('render-process-gone', () => cancel(owner));
    food.once('ready-to-show', () => { if (sessions.get(owner.id) === s && usable(owner)) food.showInactive(); else cancel(owner); });
    food.on('closed', () => { if (sessions.get(owner.id) === s) cancel(owner); });
    food.loadFile(path.join(__dirname, 'rice.html')).catch(() => cancel(owner));
    s.timer = setInterval(() => {
      if (!usable(owner) || !alive(food)) { cancel(owner); return; }
      if (s.dragging) move(s);
    }, 16);
    s.timer.unref?.();
  }
  const foodSession = event => [...sessions.values()].find(s => s.food.webContents === event.sender && alive(s.food));
  ipcMain.on('pet:rice-target', (event, data) => {
    const owner = ownerOf(event);
    if (!owner) return;
    const r = data?.rect;
    if (!data?.enabled) { targets.delete(owner.id); cancel(owner); return; }
    if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return;
    targets.set(owner.id, { enabled: true, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
  });
  ipcMain.on('pet:rice-spawn', event => { const owner = ownerOf(event); if (owner) spawn(owner); });
  ipcMain.on('pet:rice-cancel', event => { const owner = ownerOf(event); if (owner) cancel(owner); });
  ipcMain.on('rice:cancel', event => { const s = foodSession(event); if (s && !s.pending) cancel(s.owner); });
  ipcMain.on('rice:begin', (event, grip) => {
    const s = foodSession(event);
    if (!s || s.pending || s.dragging || !usable(s.owner)) return;
    if (!grip || ![grip.x, grip.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return;
    const b = s.food.getContentBounds();
    // Capture the original grip in normalized coordinates: no mixed-DPI screenX and no IPC-latency jump.
    s.offset = { x: grip.x * b.width, y: grip.y * b.height };
    s.start = { x: b.x + s.offset.x, y: b.y + s.offset.y };
    s.moved = false;
    s.dragging = true;
    status(s);
  });
  ipcMain.on('rice:end', (event, drop) => {
    const s = foodSession(event);
    if (!s || !s.dragging || s.pending) return;
    const point = move(s);
    s.dragging = false;
    if (drop !== true || !s.moved || !bodyAt(s.owner, point)) {
      status(s, false, '还没喂到，拖到桌宠身上再松手');
      // A partially off-screen bowl remains reachable after an invalid drop.
      const a = screen.getDisplayNearestPoint(point).workArea;
      const b = s.food.getContentBounds();
      s.food.setContentBounds({ ...b, x: Math.round(Math.max(a.x, Math.min(b.x, a.x + a.width - b.width))), y: Math.round(Math.max(a.y, Math.min(b.y, a.y + a.height - b.height))) });
      return;
    }
    s.pending = ++sequence;
    status(s, true, '正在喂白饭…');
    notify(s.owner, 'pet:rice-drop', { session: s.id, request: s.pending });
  });
  ipcMain.on('pet:rice-result', (event, result) => {
    const owner = ownerOf(event);
    const s = owner && sessions.get(owner.id);
    if (!s || !s.pending || result?.session !== s.id || result?.request !== s.pending) return;
    if (result.ok === true) cancel(owner);
    else { s.pending = null; status(s, false, '没喂成功，白饭留着，可以再拖一次'); }
  });
  function attach(owner) {
    owner.on('hide', () => cancel(owner));
    owner.webContents.on('did-start-loading', () => { cancel(owner); targets.delete(owner.id); });
    owner.webContents.on('render-process-gone', () => { cancel(owner); targets.delete(owner.id); });
    owner.on('closed', () => { cancel(owner); targets.delete(owner.id); });
  }
  function cancelAll() { for (const s of [...sessions.values()]) cancel(s.owner); }
  return { attach, cancelAll };
}
module.exports = { createRiceFeeding };
