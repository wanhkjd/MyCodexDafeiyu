import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// The desktop app replaces its hash-named CLI folder during updates. Resolve
// the executable on every refresh rather than pinning the install-time path.
export function resolveCodexExecutable(configuredPath,{env=process.env,platform=process.platform}={}) {
  const isFile=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};
  const explicit = configuredPath || env.CODEX_PET_CODEX_PATH || env.DSH_PET_CODEX_PATH;
  if (explicit) return typeof explicit === 'string' && isFile(explicit) ? explicit : undefined;
  const executable=platform==='win32'?'codex.exe':'codex';
  if(platform==='darwin'){
    // Finder launches with a minimal PATH. Prefer the CLI shipped with the app.
    // An explicit app root also lets tests isolate themselves from real logins.
    const applications=env.GPT_NIANG_CODEX_APP?[env.GPT_NIANG_CODEX_APP]:[
      '/Applications/Codex.app',
      ...(env.HOME?[path.join(env.HOME,'Applications','Codex.app')]:[])
    ];
    for(const app of applications){
      for(const relative of ['Contents/Resources/codex-cli/bin/codex','Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex','Contents/Resources/codex']){
        const file=path.join(app,relative);
        if(isFile(file))return file;
      }
    }
  }

  const localData=env.LOCALAPPDATA??env.LocalAppData;
  if(platform==='win32' && localData){
    const root=path.join(localData,'OpenAI','Codex','bin');
    const candidates=[];
    const add=file=>{try{const stat=fs.statSync(file);if(stat.isFile())candidates.push({file,modified:stat.mtimeMs});}catch{}};
    add(path.join(root,executable));
    try{for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(entry.isDirectory())add(path.join(root,entry.name,executable));}}catch{}
    candidates.sort((a,b)=>b.modified-a.modified||a.file.localeCompare(b.file));
    if(candidates.length)return candidates[0].file;
  }
  for(const directory of (env.PATH??env.Path??'').split(platform==='win32'?';':':')){
    const trimmed=directory.trim().replace(/^"(.*)"$/,'$1');
    if(!trimmed)continue;
    const file=path.join(trimmed,executable);
    if(isFile(file))return file;
    if(platform==='win32'){
      // npm installs a .cmd shim; spawn the native CLI without invoking a shell.
      for(const arch of ['x86_64-pc-windows-msvc','aarch64-pc-windows-msvc']){
        for(const root of [
          path.join(trimmed,'node_modules','@openai','codex','vendor',arch),
          path.join(trimmed,'node_modules','@openai','codex','node_modules','@openai',arch.startsWith('x86_64')?'codex-win32-x64':'codex-win32-arm64','vendor',arch),
        ]){
          const native=path.join(root,'codex','codex.exe');
          if(isFile(native))return native;
        }
      }
    }
  }
  return undefined;
}

export function atomicJson(file,data) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n');fs.renameSync(tmp,file);}
  finally{try{fs.unlinkSync(tmp);}catch{}}
}
