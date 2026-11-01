const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, safeStorage, powerMonitor } = require('electron');
const fs = require('node:fs');
const integrations = require('./integrations-control.cjs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { prepareData, checkPackage, readBackendAddress, backendEnvironment } = require('./runtime-utils.cjs');
const { DISPLAY_DEFAULTS, readDisplaySettings, saveDisplaySettings } = require('./display-settings.cjs');
app.setAppUserModelId('local.codexpet.bluemaid');
const root = __dirname;
const icon = path.join(root, 'assets', 'icon.ico');

if (process.env.CODEX_PET_HELPER === '1') {
  const rendererData = path.join(app.getPath('appData'), 'CodexPet', 'renderer');
  fs.mkdirSync(rendererData, { recursive: true });
  app.setPath('userData', rendererData);
  require('./backend/runtime/electron-helper/main.js');
} else {
  const userRoot = path.join(app.getPath('appData'), 'CodexPet');
  fs.mkdirSync(userRoot, { recursive: true });
  app.setPath('userData', userRoot);
  const data = path.join(userRoot, 'data');
  fs.mkdirSync(data, { recursive: true });
  const locked = app.requestSingleInstanceLock();
  if (!locked) app.quit();
  else if (process.argv.includes('--quit')) app.quit();
  else run();

  function run() {
    let panel, tray, child, quitting = false, visible = true;
    let base, phase = '正在启动桌宠…', backendReady = false;
    const token = randomBytes(32).toString('hex');
    const headers = { Authorization: 'Bearer ' + token };
    const control = path.join(data, 'visibility.json');
    const displayFile = path.join(data, 'dsh-pet', 'display-settings.json');
    let displaySettings = { ...DISPLAY_DEFAULTS };
    try { displaySettings = readDisplaySettings(displayFile); } catch {}
    try { visible = JSON.parse(fs.readFileSync(control, 'utf8')).visible !== false; } catch {}
    const backend = path.join(root, 'backend');
    const log = fs.createWriteStream(path.join(userRoot, 'app.log'), { flags: 'a' });
    let logFailed = false, logClosed = false;
    log.on('error', () => { logFailed = true; });
    function writeLog(chunk) {
      if (logFailed || logClosed || log.destroyed || log.writableEnded) return;
      try { log.write(chunk); } catch { logFailed = true; }
    }
    function closeLog() {
      if (logClosed) return;
      logClosed = true;
      if (!logFailed && !log.destroyed) try { log.end(); } catch { logFailed = true; }
    }
    let pendingLog = '';
    function migrate() {
      checkPackage(root);
      prepareData(root, data);
    }
    function setVisible(value) {
      visible = value;
      const temporary = control + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ visible, displaySettings }));
      fs.renameSync(temporary, control);
      updateTray();
    }
    async function request(route, method = 'GET', body) {
      const started = Date.now();
      while (!backendReady && !quitting && Date.now() - started < 8000) await new Promise(resolve => setTimeout(resolve, 100));
      if (!backendReady || quitting) throw new Error('桌宠后台正在启动或已停止，请稍后重试；持续出现时请退出软件后重新打开。');
      try {
        // Retry reads only: never replay a chat submission that could consume quota twice.
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await fetch(base + route, { method, headers: { ...headers, ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}), signal: AbortSignal.timeout(body ? 115000 : 22000) });
            // 4xx carry the backend's own reason (e.g. reminder validation); hand it to the panel instead of a generic connection error.
            if (response.status >= 400 && response.status < 500) {
              const reply = await response.json().catch(() => null);
              if (reply && typeof reply.message === 'string') return { ...reply, ok: false };
            }
            if (!response.ok) throw new Error('后台响应异常');
            return await response.json();
          } catch (error) { if (method !== 'GET' || attempt > 0) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
        }
      } catch (error) {
        writeLog(`[connection] ${new Date().toISOString()} ${method} ${route.split('?')[0]} ${error.cause?.code || error.name || 'unknown'}\n`);
        throw new Error('暂时连接不上桌宠后台，请稍后重试。若刚发送过消息，请先查看聊天记录，避免重复发送。');
      }
    }
    // Third-party API keys stay out of the data folder: encrypted by the OS (DPAPI on Windows) here,
    // and handed to the backend over its stdin.
    const keyFile = path.join(userRoot, 'llm-keys.bin');
    function readKeys() {
      try {
        const raw = fs.readFileSync(keyFile);
        const keys = JSON.parse(raw[0] === 0x45 ? safeStorage.decryptString(raw.subarray(1)) : raw.subarray(1).toString('utf8'));
        return keys && typeof keys === 'object' ? keys : {};
      } catch { return {}; }
    }
    function writeKeys(keys) {
      // Never fall back to plaintext: without OS encryption, refuse to keep keys on disk.
      if (!safeStorage.isEncryptionAvailable()) {
        if (Object.keys(keys).length) throw new Error('系统加密不可用，API Key 未保存。请检查 Windows 用户凭据后重试。');
        fs.rmSync(keyFile, { force: true });
        return;
      }
      fs.writeFileSync(keyFile + '.tmp', Buffer.concat([Buffer.from('E'), safeStorage.encryptString(JSON.stringify(keys))]));
      fs.renameSync(keyFile + '.tmp', keyFile);
    }
    function pushKeys(keys) {
      if (child?.stdin?.writable) child.stdin.write(JSON.stringify({ type: 'llm-keys', keys }) + '\n');
    }
    // Keyboard/mouse idle time lets the pet's mood tell "you are here" from "you stepped away".
    function pushPresence() {
      if (child?.stdin?.writable) child.stdin.write(JSON.stringify({ type: 'presence', idleSec: powerMonitor.getSystemIdleTime(), state: powerMonitor.getSystemIdleState(300) }) + '\n');
    }
    function withKeyFlags(view) {
      if (!view?.ok || !Array.isArray(view.profiles)) return view;
      const keys = readKeys();
      return { ...view, profiles: view.profiles.map(profile => ({ ...profile, hasKey: Boolean(keys[profile.id]) })) };
    }
    async function llmCommand(body) {
      const input = body && typeof body === 'object' ? body : {};
      // test / models may carry a key typed but not saved yet; otherwise the backend uses the saved one.
      if (input.action !== 'save') return await request('/dsh-pet-7340/llm', 'POST', { action: input.action, profile: input.profile, model: typeof input.model === 'string' ? input.model : '', apiKey: typeof input.apiKey === 'string' ? input.apiKey : '' });
      const saved = await request('/dsh-pet-7340/llm', 'POST', { action: 'save', config: input.config });
      if (!saved?.ok) return saved;
      const keys = readKeys(), ids = new Set(saved.profiles.map(profile => profile.id));
      const cleared = new Set(Array.isArray(input.clearKeys) ? input.clearKeys : []);
      for (const [id, key] of Object.entries(input.keys && typeof input.keys === 'object' ? input.keys : {})) {
        if (typeof key === 'string' && key.trim()) { keys[id] = key.trim().slice(0, 500); cleared.delete(id); }
      }
      for (const id of Object.keys(keys)) if (!ids.has(id) || cleared.has(id)) delete keys[id];
      try { writeKeys(keys); } catch (error) { return { ...withKeyFlags(saved), ok: false, message: error.message }; }
      pushKeys(keys);
      return withKeyFlags(saved);
    }
    function showPanel() {
      if (!panel || panel.isDestroyed()) createPanel();
      if (panel.isMinimized()) panel.restore();
      panel.setAlwaysOnTop(true, 'screen-saver');
      panel.show(); panel.moveTop(); panel.focus();
    }
    function showReminders() {
      showPanel();
      const target=panel;
      const activate=()=>{
        if(target.isDestroyed())return;
        target.setAlwaysOnTop(true, 'screen-saver');target.moveTop();
        target.focus();target.webContents.focus();
        const detail = JSON.stringify({ view: 'reminders' }).replace(/</g, '\u003c');
        target.webContents.executeJavaScript('window.dispatchEvent(new CustomEvent("pet-manager-open",{detail:' + detail + '}))').catch(()=>{});
      };
      const ready=()=>{
        if(target.isDestroyed())return;
        // Only an explicit reminder click activates the manager across the pet/manager processes.
        if(process.platform==='win32') {
          const handle=target.getNativeWindowHandle().readBigUInt64LE().toString();
          execFile(path.join(root,'DesktopBridge.exe'),['--focus-window',handle],{windowsHide:true,timeout:3000},activate);
        }else activate();
      };
      if(target.webContents.isLoading())target.webContents.once('did-finish-load',ready);else ready();
    }
    async function openCodex() {
      void request('/dsh-pet-7340/ack','POST').catch(()=>{});
      await new Promise((resolve, reject) => {
        const helper = spawn(path.join(root,'DesktopBridge.exe'),['--open-codex', process.env.CODEX_PET_APP_PATH || 'OpenAI.Codex_2p2nqsd0c76g0!App'],{windowsHide:true,stdio:'ignore'});
        helper.once('error', () => reject(new Error('无法打开 Codex，请检查客户端安装；自定义安装可设置 CODEX_PET_APP_PATH')));
        helper.once('exit', code => code === 0 ? resolve() : reject(new Error('无法打开 Codex，请先手动打开客户端')));
      });
    }
    function createPanel() {
      panel = new BrowserWindow({ width: 900, height: 680, minWidth: 760, minHeight: 560,
        title: 'Codex-dafeiyu', icon, backgroundColor: '#f6f8ff', autoHideMenuBar: true,
        webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      panel.loadFile(path.join(root, 'panel.html'));
      panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      panel.webContents.on('will-navigate', event => event.preventDefault());
      const window=panel;
      const releaseTopmost=()=>{if(!window.isDestroyed())window.setAlwaysOnTop(false);};
      window.on('blur',releaseTopmost);
      window.on('hide',releaseTopmost);
      window.on('minimize',releaseTopmost);
      panel.on('close', event => { if (!quitting) { event.preventDefault(); panel.hide(); } });
    }
    function updateTray() {
      if (!tray) return;
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开管理窗口', click: showPanel },
        { label: '打开 DeepSeek Harness', click: () => { void integrations.openHarness(data).catch(error => { showPanel(); phase = error.message; }); } },
        { label: '打开 Codex', click: () => { void openCodex().catch(error => { showPanel(); phase = error.message; }); } },
        { label: visible ? '隐藏桌宠' : '显示桌宠', click: () => setVisible(!visible) },
        { type: 'separator' },
        { label: '碎碎念 · 来一句', click: () => { setVisible(true); void request('/dsh-pet-7340/whisper?pet=main', 'POST').catch(() => {}); } },
        { type: 'separator' },
        { label: '编辑语录', click: () => shell.openPath(path.join(data, 'quotes.json')) },
        { label: '退出Codex-dafeiyu', click: quitApp },
      ]));
    }
    async function quitApp() {
      if (quitting) return;
      quitting = true;
      try { if (backendReady) await fetch(base + '/shutdown', { method: 'POST', headers, signal: AbortSignal.timeout(1500) }); } catch {}
      if (child && child.exitCode === null) child.kill();
      tray?.destroy(); closeLog(); app.quit();
    }
    app.on('second-instance', (_event, args) => { if (args.includes('--quit')) void quitApp(); else showPanel(); });
    app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void quitApp(); } });
    app.on('window-all-closed', () => {});
    app.whenReady().then(() => {
      try { migrate(); } catch (error) { dialog.showErrorBox('桌宠暂时无法启动', error.message); quitting = true; closeLog(); app.quit(); return; }
      setVisible(visible);
      tray = new Tray(icon); tray.setToolTip('Codex-dafeiyu'); tray.on('click', showPanel); updateTray();
      ipcMain.handle('pet:status', async () => {
        try {
          const result = await request('/dsh-pet-7340/state');
          return { ready: true, visible, work: result.sections.workStatus.data, integrations: result.sections.integrations?.data };
        } catch { return { ready: false, visible, message: phase }; }
      });
      ipcMain.handle('pet:action', async (_event, action, message) => {
        try {
        if (action === 'display-settings-state') {
          return { ok: true, settings: readDisplaySettings(displayFile) };
        }
        if (action === 'display-settings-save') {
          if (!panel || _event.sender !== panel.webContents || _event.senderFrame !== panel.webContents.mainFrame) return { ok: false, message: '显示配置仅允许从管理面板操作' };
          displaySettings = saveDisplaySettings(displayFile, message);
          setVisible(visible);
          return { ok: true, settings: displaySettings };
        }
        if (action === 'drag-settings-state') return await request('/dsh-pet-7340/drag-settings');
        if (action === 'drag-settings-save') {
          if (!panel || _event.sender !== panel.webContents || _event.senderFrame !== panel.webContents.mainFrame) return { ok: false, message: '拖拽配置仅允许从管理面板操作' };
          return await request('/dsh-pet-7340/drag-settings', 'POST', message);
        }
        if (action === 'position-settings-state' || action === 'position-settings-save') {
          if (!panel || _event.sender !== panel.webContents || _event.senderFrame !== panel.webContents.mainFrame) return { ok: false, message: '位置设置仅允许从管理面板操作' };
          return await request('/dsh-pet-7340/position-settings', action === 'position-settings-save' ? 'POST' : 'GET', message);
        }
        if (action === 'pet-size-state') return await request('/dsh-pet-7340/pet-size');
        if (action === 'pet-size-save') {
          if (!panel || _event.sender !== panel.webContents || _event.senderFrame !== panel.webContents.mainFrame) return { ok: false, message: '大小配置仅允许从管理面板操作' };
          return await request('/dsh-pet-7340/pet-size', 'POST', { size: message?.size });
        }
        if (action === 'characters-state') return await request('/dsh-pet-7340/characters');
        if (['characters-select', 'characters-behavior', 'characters-companion'].includes(action)) {
          if (!panel || _event.sender !== panel.webContents || _event.senderFrame !== panel.webContents.mainFrame) return { ok: false, message: '形象配置仅允许从管理面板操作' };
          if (action === 'characters-behavior') return await request('/dsh-pet-7340/characters', 'POST', { action: 'behavior', behavior: message });
          if (action === 'characters-companion') return await request('/dsh-pet-7340/characters', 'POST', { action: 'companion', id: message?.id });
          if (action === 'characters-select') {
            if (!['dafeiyu', 'bailong'].includes(message?.id)) return { ok: false, message: '无效形象' };
            const chat = await request('/dsh-pet-7340/pet-chat');
            if (chat.pending) return { ok: false, message: '请等待当前聊天回复完成后再切换形象' };
            return await request('/dsh-pet-7340/characters', 'POST', { action: 'select', id: message.id });
          }
        }
        if (action === 'open-codex') { await openCodex(); return {ok:true}; }
        if (action === 'open-harness') { await integrations.openHarness(data); return {ok:true}; }
        if (action === 'integrations-state') return { ok:true, config:integrations.readConfig(data), installed:integrations.installed(data), registeredPath:integrations.registeredHarness() };
        if (action === 'integrations-save') return { ok:true, config:integrations.saveConfig(data,message) };
        if (action === 'harness-install') return integrations.installBridge({root,home:data,userRoot});
        if (action === 'harness-exe') {
          const picked=await dialog.showOpenDialog(panel,{title:'选择 DeepSeek Harness 软件',properties:['openFile'],filters:[{name:'Windows 软件',extensions:['exe']}]});
          if(picked.canceled)return {ok:true,canceled:true};
          return {ok:true,config:integrations.saveConfig(data,{harnessPath:picked.filePaths[0]})};
        }
        if (action === 'harness-profile') {
          const picked=await dialog.showOpenDialog(panel,{title:'选择 Harness Profile（通常为 .dsh/profiles/desktop）',properties:['openDirectory']});
          if(picked.canceled)return {ok:true,canceled:true};
          return {ok:true,config:integrations.saveConfig(data,{profile:picked.filePaths[0]})};
        }
        if (action === 'chat-state') return await request('/dsh-pet-7340/pet-chat');
        if (action === 'reminders-state') return await request('/dsh-pet-7340/reminders');
        if (action === 'reminders-command') return await request('/dsh-pet-7340/reminders','POST',message);
        if (action === 'mood-state') return await request('/dsh-pet-7340/mood');
        if (action === 'mood-command') return await request('/dsh-pet-7340/mood','POST',message);
        if (action === 'chat-command') return await request('/dsh-pet-7340/pet-chat','POST',message);
        if (action === 'llm-state') return withKeyFlags(await request('/dsh-pet-7340/llm'));
        if (action === 'llm-command') return await llmCommand(message);
        if (action === 'chat') return await request('/dsh-pet-7340/chat?pet=main','POST',{text:String(message ?? '').slice(0,2000)});
        if (action === 'toggle') { setVisible(!visible); return { ok: true }; }
        if (action === 'quote') return await request('/dsh-pet-7340/whisper?pet=main', 'POST');
        if (action === 'quotes') return { ok: !(await shell.openPath(path.join(data, 'quotes.json'))) };
        if (action === 'settings') return { ok: !(await shell.openPath(path.join(data, 'dsh-pet', 'main-config.jsonc'))) };
        if (action === 'folder') return { ok: !(await shell.openPath(data)) };
        if (action === 'quit') { void quitApp(); return { ok: true }; }
        throw new Error('未知操作');
        } catch (error) { return { ok: false, message: error.message || '操作暂未完成，请稍后重试。' }; }
      });
      createPanel();
      let lastManagerRequest=Date.now();
      const managerTimer=setInterval(()=>{
        try {
          const marker=JSON.parse(fs.readFileSync(path.join(data,'manager-request.json'),'utf8'));
          if(marker.id>lastManagerRequest && marker.view === 'reminders') {
            lastManagerRequest=marker.id;showReminders();
          }
        }catch{}
      },500);managerTimer.unref();
      const env = { ...backendEnvironment(), DSH_HOME: data, CODEX_PET_HARNESS_HOME: process.env.DSH_HOME || '', DSH_PET_ELECTRON_PATH: process.execPath,
        DSH_PET_ICON: icon, CODEX_PET_DESKTOP_BRIDGE:path.join(root,'DesktopBridge.exe'), CODEX_PET_HELPER: '1', CODEX_PET_CONTROL: control, CODEX_PET_MANAGER_PID: String(process.pid), CODEX_PET_HTTP_TOKEN: token };
      delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(path.join(root, 'node.exe'), [path.join(root, 'backend-entry.mjs')], { env, cwd: backend, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      child.stdin.on('error', () => {});
      pushKeys(readKeys());
      pushPresence();
      setInterval(pushPresence, 30000).unref();
      for (const event of ['lock-screen', 'unlock-screen', 'resume']) powerMonitor.on(event, pushPresence);
      child.stdout.on('data', chunk => {
        writeLog(chunk); pendingLog += chunk.toString();
        const lines = pendingLog.split('\n'); pendingLog = lines.pop();
        for (const line of lines) {
          const address = readBackendAddress(line);
          if (address) { base = address; backendReady = true; phase = '桌宠已启动'; }
        }
      });
      child.stderr.on('data', chunk => writeLog(chunk));
      child.on('error', () => { backendReady = false; phase = '桌宠启动失败，请退出后重试'; });
      child.on('exit', () => { backendReady = false; if (!quitting) phase = '桌宠已停止，请退出软件后重新打开'; });
    });
  }
}
