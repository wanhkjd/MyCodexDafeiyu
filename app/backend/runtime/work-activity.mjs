// One publisher arbitrates independent Codex, Harness and optional host activity.
import { createRequire } from 'node:module';
import { ActivityReader } from './codex-activity.mjs';
import { HarnessReader, active } from './harness-activity.mjs';
const {readConfig}=createRequire(import.meta.url)('../../integrations-control.cjs');
const idle=()=>({state:null,task:null});
export function chooseWorkActivity(sources) {
  const list=Object.entries(sources).filter(([,s])=>s?.state);
  const busy=list.filter(([,s])=>active(s));
  const chosen=(busy.length?busy:list).sort((a,b)=>Number(b[1].state==='waiting')-Number(a[1].state==='waiting') || (b[1].updatedAt||b[1].endedAt||0)-(a[1].updatedAt||a[1].endedAt||0))[0];
  if(!chosen)return idle();
  const [source,snap]=chosen;
  const suffix=busy.length>1?'（两边都在处理）':busy.length && list.some(([,s])=>s.state==='error')?'（另一路遇到问题，请查看）':busy.length && list.some(([,s])=>s.state==='success')?'（另一路本轮已完成）':'';
  return {state:snap.state,task:source+'：'+(snap.task||'正在处理任务…')+suffix,source};
}
export function startWorkActivityMonitor(publish,{home,onDiagnostics=()=>{},intervalMs=2000,codexReader=new ActivityReader(),harnessReader=new HarnessReader()}={}) {
  let host=idle(),prev='',diagPrev='',lastCodex=idle(),lastCodexKey='',codexAt=0,closed=false,harnessEnabled=true;
  const tick=()=>{
    if(closed)return;
    const config=readConfig(home);let codex=idle(),harness=idle(),h={connected:false,message:'已关闭状态联动'},codexMessage='已关闭状态联动';
    if(config.codex) {
      try { codex=codexReader.read();const key=JSON.stringify(codex);if(key!==lastCodexKey){codexAt=Date.now();lastCodexKey=key;}codexMessage=codex.state?'正在感知任务状态':'空闲／未检测到任务（需本机 Codex 历史数据库）'; }
      catch { codexReader.close();codexMessage='状态暂不可用，请检查 Codex 客户端'; }
    } else {codexReader.close();lastCodexKey='';}
    lastCodex=codex;
    if(config.harness) {
      try { if(!harnessEnabled)harnessReader.close();h=harnessReader.read();harness=h.snapshot; }
      catch { harnessReader.close();h={connected:false,message:'状态暂不可用，请检查 Harness 桥接与本地目录'}; }
    }else harnessReader.close();
    harnessEnabled=config.harness;
    const snapshot=chooseWorkActivity({Codex:{...lastCodex,updatedAt:codexAt},Harness:harness,...(config.harness && host.state?{'Harness 宿主':host}:{})});
    const key=JSON.stringify(snapshot);if(key!==prev){prev=key;publish(snapshot);}
    const diag={codex:{enabled:config.codex,message:codexMessage},harness:{enabled:config.harness,connected:h.connected,message:h.message}};
    const dk=JSON.stringify(diag);if(dk!==diagPrev){diagPrev=dk;onDiagnostics(diag);}
  };
  tick();const timer=setInterval(tick,intervalMs);
  return {updateHost(snap){host={...snap,updatedAt:Date.now()};tick();},stop(){closed=true;clearInterval(timer);codexReader.close();harnessReader.close();}};
}
