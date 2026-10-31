(() => {
  const el=id=>document.getElementById(id), controls=['integration-codex','integration-harness','harness-install','harness-exe','harness-auto','harness-profile'];
  let busy=false, stopped=false, config;
  function render(view) {
    config=view.config;el('integration-codex').checked=config.codex;el('integration-harness').checked=config.harness;
    el('harness-installed').textContent=view.installed?'桥接包已安装；是否运行请看上方连接状态。':'桥接包尚未安装。已有旧版 dsh-pet 桥接不会被覆盖。';
    el('harness-path').textContent='启动：'+(config.harnessPath || (view.registeredPath?'自动协议 · '+view.registeredPath:'未检测到启动协议，请选择软件 EXE'));
    el('harness-profile-path').textContent='Profile：'+config.profile;controls.forEach(id=>el(id).disabled=busy);
  }
  async function run(action,body) {
    if(busy)return;busy=true;controls.forEach(id=>el(id).disabled=true);el('integration-result').textContent=action==='harness-install'?'正在安装本地桥接并备份配置…':'正在保存／读取…';
    try {
      const r=await window.pet.action(action,body);if(r?.ok===false)throw new Error(r.message||'操作未完成');
      const view=await window.pet.action('integrations-state');if(view.ok===false)throw new Error(view.message);render(view);
      el('integration-result').textContent=r.canceled?'已取消，设置未变。':r.message||(action==='integrations-save'?'设置已保存，约 2 秒内生效。':'设置已更新。');
    }catch(e){el('integration-result').textContent=e.message;try{render(await window.pet.action('integrations-state'));}catch{}}
    finally{busy=false;if(config)controls.forEach(id=>el(id).disabled=false);}
  }
  for(const key of ['codex','harness'])el('integration-'+key).onchange=()=>run('integrations-save',{[key]:el('integration-'+key).checked});
  for(const action of ['harness-install','harness-exe','harness-profile'])el(action).onclick=()=>run(action);
  el('harness-auto').onclick=()=>run('integrations-save',{harnessPath:''});
  window.addEventListener('pet-integrations',event=>{for(const key of ['codex','harness']){const next=event.detail?.[key]?.message||'后台正在启动，稍后刷新…';if(el('integration-'+key+'-status').textContent!==next)el('integration-'+key+'-status').textContent=next;}});
  window.addEventListener('beforeunload',()=>{stopped=true;});
  async function initial(){try{const view=await window.pet.action('integrations-state');if(view.ok===false)throw new Error(view.message);render(view);}catch(e){el('integration-result').textContent=e.message;if(!stopped)setTimeout(initial,2000);}}
  void initial();
})();
