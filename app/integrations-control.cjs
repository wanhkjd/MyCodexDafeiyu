// Companion-only configuration and a reversible local, zero-dependency Harness bundle install.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { activateWindow } = require('./windows-activation.cjs');
const PACKAGE = '@codex-dafeiyu/harness-bridge';
const defaults = () => ({ codex: true, harness: true, harnessPath: '', profile: path.join(os.homedir(), '.dsh', 'profiles', 'desktop') });
function readConfig(home) {
  let c = {}; try { c = JSON.parse(fs.readFileSync(path.join(home,'integrations.json'),'utf8')); } catch {}
  const d = defaults(); return { codex: c.codex !== false, harness: c.harness !== false, harnessPath: typeof c.harnessPath === 'string' ? c.harnessPath : '', profile: typeof c.profile === 'string' && path.isAbsolute(c.profile) ? c.profile : d.profile };
}
function atomic(file, data) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file+'.tmp',data); fs.renameSync(file+'.tmp',file); }
function saveConfig(home, input = {}) {
  const current = readConfig(home);
  for (const key of ['codex','harness']) if (typeof input[key] === 'boolean') current[key] = input[key];
  if (typeof input.harnessPath === 'string') {
    if (input.harnessPath && (!path.isAbsolute(input.harnessPath) || !/\.exe$/i.test(input.harnessPath) || !fs.statSync(input.harnessPath).isFile())) throw new Error('请选择存在的 Harness EXE 文件');
    current.harnessPath = input.harnessPath;
  }
  if (typeof input.profile === 'string') { if (!path.isAbsolute(input.profile)) throw new Error('Profile 必须为绝对路径'); current.profile = path.resolve(input.profile); }
  atomic(path.join(home,'integrations.json'),JSON.stringify(current,null,2)+'\n'); return current;
}
function registeredHarness() {
  if (process.platform !== 'win32') return '';
  try { const out = execFileSync('reg.exe',['query','HKCU\\Software\\Classes\\dsh\\shell\\open\\command','/ve'],{encoding:'utf8',windowsHide:true,timeout:2000}); return out.match(/REG_SZ\s+"([^"]+\.exe)"/i)?.[1] || ''; } catch { return ''; }
}
function harnessLaunchEnvironment(home, source = process.env) {
  const env = { ...source };
  // The pet backend uses DSH_HOME for its own data. Never pass that home to Harness.
  const savedHome = source.CODEX_PET_HARNESS_HOME;
  const nativeHome = savedHome !== undefined ? savedHome :
    source.DSH_HOME && (!home || path.resolve(source.DSH_HOME).toLowerCase() !== path.resolve(home).toLowerCase()) ? source.DSH_HOME : '';
  for (const key of Object.keys(env)) {
    if (/^(?:DSH_PET_|CODEX_PET_|ELECTRON_)/i.test(key) || /^(?:DSH_HOME|NODE_OPTIONS|NODE_PATH)$/i.test(key)) delete env[key];
  }
  if (nativeHome) env.DSH_HOME = nativeHome;
  return env;
}
let harnessOpening;
async function openHarness(home) {
  // Repeated clicks share the same launch instead of spawning more helper processes.
  if (harnessOpening) return harnessOpening;
  harnessOpening = launchHarness(home);
  try { return await harnessOpening; } finally { harnessOpening = undefined; }
}
async function launchHarness(home) {
  const config = readConfig(home), registered = registeredHarness();
  const executable = config.harnessPath || registered;
  if (!executable) throw new Error('未找到本机 Harness，请在联动设置中选择软件 EXE');
  if (!path.isAbsolute(executable) || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Error('Harness 软件路径不存在，请重新选择软件 EXE');
  const env = harnessLaunchEnvironment(home);
  // The native single-instance handler owns the profile and may recreate a closed window.
  // Do not hide the GUI process; only the separate activation helper stays hidden.
  const useProtocol = registered && path.resolve(executable).toLowerCase() === path.resolve(registered).toLowerCase();
  await new Promise((resolve,reject) => {
    const child=spawn(executable,useProtocol ? ['dsh://open'] : [],{
      cwd:path.dirname(executable),env,detached:true,windowsHide:false,stdio:'ignore'
    });
    child.once('error',()=>reject(new Error('无法启动本机 Harness，请重新选择软件路径')));
    child.once('spawn',()=>{child.unref();resolve();});
  });
  // Process creation is not success: wait for the actual app window to be visible and foreground.
  return activateWindow(executable, env);
}
function installed(home) {
  try { const c=readConfig(home), p=JSON.parse(fs.readFileSync(path.join(c.profile,'package.json'),'utf8')); const entry=path.join(c.profile,'node_modules',...PACKAGE.split('/')); return p.dsh?.profile?.bundles?.includes(PACKAGE) && fs.existsSync(path.join(entry,'index.mjs')); } catch { return false; }
}
function installBridge({ root, home, userRoot }) {
  const config = readConfig(home), profile = config.profile;
  const manifest = path.join(profile,'package.json'), raw = fs.readFileSync(manifest,'utf8');
  const p = JSON.parse(raw);
  if (!Array.isArray(p.dsh?.profile?.bundles) || (p.dependencies && (typeof p.dependencies !== 'object' || Array.isArray(p.dependencies)))) throw new Error('所选目录不是有效的 Harness Profile，未修改任何设置');
  const dest = path.join(userRoot,'harness-bridge'), entry = path.join(profile,'node_modules',...PACKAGE.split('/'));
  const spec = 'link:' + dest.replaceAll('\\','/');
  let existed = false;
  try { fs.lstatSync(entry); existed=true; if (fs.realpathSync(entry).toLowerCase() !== path.resolve(dest).toLowerCase()) throw new Error('此插件路径被其他安装占用，未覆盖'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  if (fs.existsSync(path.join(dest,'package.json')) && JSON.parse(fs.readFileSync(path.join(dest,'package.json'),'utf8')).name !== PACKAGE) throw new Error('桥接目录存在其他包，未覆盖');
  const lock = path.join(profile,'pnpm-lock.yaml'); let oldLock=null, newLock=null;
  if (fs.existsSync(lock)) {
    oldLock=fs.readFileSync(lock,'utf8');
    if (!/^lockfileVersion: ['"]?9\.0['"]?\s*$/m.test(oldLock) || !/  \.:\r?\n    dependencies:\r?\n/.test(oldLock)) throw new Error('不支持此锁文件格式，未修改 Profile；请使用 Harness 插件管理器安装桥接包');
    const key="      '"+PACKAGE+"':";
    newLock=oldLock.replace(/(  \.:\r?\n    dependencies:\r?\n)((?: {6,}[^\n]*(?:\n|$)|\r?\n)*)/, (_all, header, dependencies) => {
      const cleaned=dependencies.replace(/      ['"]?@codex-dafeiyu\/harness-bridge['"]?:\r?\n        specifier:[^\n]*\n        version:[^\n]*(?:\n|$)/g,'');
      return header+key+'\n        specifier: '+JSON.stringify(spec)+'\n        version: '+JSON.stringify(spec)+'\n'+cleaned;
    });
  }
  const backup = path.join(userRoot,'harness-bridge-backups',Date.now()+'-'+Math.random().toString(16).slice(2,8));
  fs.mkdirSync(backup,{recursive:true}); fs.writeFileSync(path.join(backup,'package.json'),raw);
  if(oldLock!==null)fs.writeFileSync(path.join(backup,'pnpm-lock.yaml'),oldLock);
  const files = ['package.json', 'index.mjs', 'cordis.patch.yml'];
  const previous = new Map(files.map(file => [file, fs.existsSync(path.join(dest, file)) ? fs.readFileSync(path.join(dest, file)) : null]));
  for (const [file, data] of previous) if (data !== null) {
    fs.mkdirSync(path.join(backup, 'bridge'), {recursive:true});
    fs.writeFileSync(path.join(backup, 'bridge', file), data);
  }
  fs.writeFileSync(path.join(backup,'restore-info.json'),JSON.stringify({profile,package:PACKAGE,bridgePath:dest,modulePath:entry,createdLink:!existed},null,2));
  try {
    fs.mkdirSync(dest,{recursive:true});
    for(const file of files) fs.copyFileSync(path.join(root,'integrations','harness-bridge',file),path.join(dest,file));
    fs.mkdirSync(path.dirname(entry),{recursive:true}); if(!existed)fs.symlinkSync(dest,entry,process.platform==='win32'?'junction':'dir');
    p.dependencies={...p.dependencies,[PACKAGE]:spec}; if(!p.dsh.profile.bundles.includes(PACKAGE))p.dsh.profile.bundles.push(PACKAGE);
    if(newLock!==null)atomic(lock,newLock);
    atomic(manifest,JSON.stringify(p,null,2)+'\n');
   } catch(e) {
    // Restore an earlier bridge too: a failed update must not silently change the installed code.
    const rollbackErrors = [];
    const restore = fn => { try { fn(); } catch(error) { rollbackErrors.push(error.message); } };
    restore(() => atomic(manifest,raw));
    if(oldLock!==null)restore(() => atomic(lock,oldLock));
    if(!existed && fs.existsSync(entry))restore(() => fs.unlinkSync(entry));
    for(const [file, data] of previous) restore(() => {
      if(data === null) fs.rmSync(path.join(dest,file), {force:true});
      else fs.writeFileSync(path.join(dest,file),data);
    });
    if(rollbackErrors.length) throw new Error('安装失败，部分回滚未成功。请使用备份恢复：'+backup+'；'+rollbackErrors.join('；'));
    throw e;
  }
  return { ok:true, backup, message:'桥接已安装。请完全退出并重新打开 Harness 后生效；没有更改聊天模型或已有插件。备份：'+backup };
}
module.exports = { readConfig, saveConfig, registeredHarness, harnessLaunchEnvironment, openHarness, installed, installBridge };
