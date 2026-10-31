const el = id => document.getElementById(id);
async function refresh() {
  try {
    const state=await window.pet.status();
    el('activity').textContent=state.ready ? state.work?.task || '暂时没有任务，在这里陪你～' : state.message;
    el('visibility').textContent=state.visible?'隐藏桌宠':'显示桌宠';
    return state;
  } catch { el('activity').textContent='暂时无法连接桌宠'; }
}
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{
  button.disabled=true; el('notice').textContent='';
  try {
    const action=button.dataset.action;
    const result=await window.pet.action(action);
    if(result?.ok===false) throw new Error(result.message || result.text || '操作未成功，请稍后重试');
    el('notice').textContent=action==='settings'?'修改配置后，请退出软件并重新打开。':action==='quotes'?'保存语录文件后，下次说话即生效。':action==='quote'?'听听她说什么～':'';
    await refresh();
  } catch (error) { el('notice').textContent=error.message || '操作暂未成功，请稍后重试。'; }
  finally { button.disabled=false; }
}));
let stopped=false; window.addEventListener('beforeunload',()=>{stopped=true});
async function loop(){await refresh(); if(!stopped) setTimeout(loop,2000)} loop();
