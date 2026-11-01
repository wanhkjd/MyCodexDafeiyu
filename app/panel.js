const el = id => document.getElementById(id);
async function refresh() {
  try {
    const state=await window.pet.status();
    el('activity').textContent=state.ready ? state.work?.task || '暂时没有任务，在这里陪你～' : state.message;
    window.dispatchEvent(new CustomEvent('pet-integrations', { detail: state.integrations }));
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

// Display switches save immediately, independently of size and character selection.
(() => {
  const form = el('display-settings-form'), fields = form.querySelector('fieldset');
  const status = el('display-settings-status');
  const keys = ['alwaysOnTop', 'autoHideFullscreen', 'cursorHidePassThrough', 'edgePeek'];
  let settings, saving = false, revision = 0, closed = false;
  function render(next) {
    settings = { ...next };
    for (const key of keys) el('display-' + key).checked = settings[key];
    fields.disabled = false;
  }
  form.onsubmit = event => event.preventDefault();
  form.onchange = async event => {
    const key = keys.find(key => event.target === el('display-' + key));
    if (!key || saving || !settings) return;
    saving = true; revision++; fields.disabled = true; status.textContent = '正在保存…';
    try {
      const result = await window.pet.action('display-settings-save', { [key]: event.target.checked });
      if (!result?.ok) throw new Error(result?.message || '显示设置保存失败');
      render(result.settings); status.textContent = '已保存';
    } catch (error) {
      render(settings); status.textContent = error.message || '保存失败，请重试';
    } finally { saving = false; }
  };
  async function poll() {
    const requestedRevision = revision;
    try {
      if (!saving) {
        const result = await window.pet.action('display-settings-state');
        if (!result?.ok) throw new Error(result?.message || '读取显示设置失败');
        if (!saving && requestedRevision === revision) render(result.settings);
      }
    } catch (error) { if (!saving) status.textContent = error.message || '读取失败，稍后自动重试'; }
    if (!closed) setTimeout(poll, 5000);
  }
  window.addEventListener('beforeunload', () => { closed = true; });
  void poll();
})();
