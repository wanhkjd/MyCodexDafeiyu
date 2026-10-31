// Read only our versioned bridge snapshots; never tail user/session text or stale completions.
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const states = new Set(['thinking','working','result','waiting','success','error']);
export const active = s => !!s?.state && !['success','error'].includes(s.state);
export function pickSnapshots(list) {
  const running = list.filter(active);
  if (running.length) {
    const chosen = [...running].sort((a,b) => Number(b.state === 'waiting') - Number(a.state === 'waiting') || b.updatedAt - a.updatedAt)[0];
    return { ...chosen, count: running.length, task: chosen.task + (running.length > 1 ? '（'+running.length+' 个任务）' : '') };
  }
  return [...list].filter(s => s.state).sort((a,b) => b.endedAt - a.endedAt)[0] || {state:null,task:null};
}
export function processAlive(pid) { try { process.kill(pid,0); return true; } catch(e) { return e.code === 'EPERM'; } }
export class HarnessReader {
  constructor({dir=join(process.env.APPDATA || join(homedir(),'.config'),'dsh-pet-bridge'),clock=Date.now,isAlive=processAlive} = {}) {
    this.dir=dir;this.clock=clock;this.isAlive=isAlive;this.startedAt=clock();this.files=new Map();
  }
  read() {
    const now=this.clock(), seen=new Set();
    let names=[];
    try { if(existsSync(this.dir)) names=readdirSync(this.dir).filter(n=>/^codexpet-harness-[1-9][0-9]*\.jsonl$/.test(n)).slice(-128); } catch {}
    {
      for(const name of names) {
        seen.add(name);
        try {
          const file=join(this.dir,name), stat=statSync(file);
          if(!stat.isFile())continue;
          let cursor=this.files.get(name);
          const reset=!cursor || cursor.birth!==stat.birthtimeMs || stat.size<cursor.offset;
          if(reset)cursor={birth:stat.birthtimeMs,offset:Math.max(0,stat.size-262144),partial:'',decoder:new TextDecoder(),snapshot:null};
          const skipFirst=reset && cursor.offset>0;
          if(stat.size>cursor.offset) {
            const fd=openSync(file,'r'); let text;
            try { const n=Math.min(262144,stat.size-cursor.offset), buf=Buffer.alloc(n), bytes=readSync(fd,buf,0,n,cursor.offset); text=cursor.decoder.decode(buf.subarray(0,bytes),{stream:true});cursor.offset+=bytes; } finally { closeSync(fd); }
            const parts=(cursor.partial+text).split('\n');cursor.partial=parts.pop().slice(-65536);if(skipFirst)parts.shift();
            for(const line of parts) {
              if(line.length>65536)continue;
              let r;try{r=JSON.parse(line);}catch{continue;}
              if(r.v!==1 || r.event!=='snapshot' || !Number.isSafeInteger(r.pid) || name!=='codexpet-harness-'+r.pid+'.jsonl' || typeof r.inst!=='string' || !/^[a-f0-9-]{36}$/.test(r.inst) || !Number.isSafeInteger(r.seq) || !Number.isFinite(r.ts) || r.ts>now+5000 || now-r.ts>15000 || !Array.isArray(r.sessions))continue;
              if(cursor.snapshot?.inst===r.inst && r.seq<=cursor.snapshot.seq)continue;
              cursor.snapshot={...r,sessions:r.sessions.slice(0,128).filter(s=>s && states.has(s.state) && typeof s.id==='string' && Number.isFinite(s.updatedAt) && s.updatedAt<=now+5000 && Number.isFinite(s.endedAt)).map(s=>({state:s.state,task:typeof s.task==='string'?s.task.slice(0,120):'正在处理任务…',updatedAt:s.updatedAt,endedAt:s.endedAt}))};
            }
          }
          this.files.set(name,cursor);
        }catch { this.files.delete(name); }
      }
    }
    for(const name of this.files.keys())if(!seen.has(name))this.files.delete(name);
    const live=[...this.files.values()].map(c=>c.snapshot).filter(r=>r && now-r.ts<=15000 && r.ts<=now+5000 && this.isAlive(r.pid));
    const sessions=live.flatMap(r=>r.sessions.filter(s=>active(s) || (s.endedAt>this.startedAt && now-s.endedAt<12000)));
    return { snapshot:pickSnapshots(sessions), connected:live.length>0, instances:live.length, message:live.length ? sessions.some(active)?'已连接 · 正在处理任务':'已连接 · 空闲／本轮已结束' : '尚未连接：请安装桥接并重新打开 Harness；或检查软件是否已退出' };
  }
  close(){this.files.clear();this.startedAt=this.clock();}
}
