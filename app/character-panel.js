(() => {
  const get = id => document.getElementById(id);
  const controls = ['character-companion', 'character-dafeiyu', 'character-bailong', 'skin-large-actions', 'skin-run', 'skin-flight'];
  let busy = false, state, stopped = false;
  function render(next) {
    state = next;
    const fallback = next.selected !== next.active || (next.companion && next.companion !== next.companionActive);
    const nameOf = id => next.characters.find(c => c.id === id)?.name || id;
    const actual = nameOf(next.active) + (next.companionActive ? ' ＋ ' + nameOf(next.companionActive) : '');
    get('character-companion').value = next.companion || 'off';
    for (const option of get('character-companion').options) option.disabled = option.value !== 'off' && !next.characters.find(c => c.id === option.value)?.available;
    get('character-active').textContent = '当前形象：' + actual + (fallback ? '（所选素材缺失，暂时回退）' : '');
    controls.forEach(id => { get(id).disabled = busy; });
    for (const item of next.characters) {
      const button = get('character-' + item.id);
      if (!button) continue;
      button.setAttribute('aria-pressed', String(next.active === item.id));
      button.disabled = busy || !item.available;
    }
    get('character-status').textContent = fallback ? next.message || '所选素材不可用，暂时使用大肥鱼。' : '';
    get('skin-large-actions').checked = next.behavior?.largeActions !== false;
    get('skin-run').checked = next.behavior?.run !== false;
    get('skin-flight').checked = next.behavior?.flight !== false;

  }
  async function refresh() {
    const result = await window.pet.action('characters-state');
    if (!result.ok) throw new Error(result.message || '读取形象失败');
    if (!busy) render(result);
  }
  async function act(action, body) {
    if (busy) return;
    busy = true;
    controls.forEach(id => { get(id).disabled = true; });
    get('character-status').textContent = action === 'characters-behavior' ? '正在保存动作开关…' : '正在切换形象…';
    try {
      const result = await window.pet.action(action, body);
      if (!result.ok) throw new Error(result.message || '操作失败');
      if (!result.canceled) {
        state = result;
        if (action !== 'characters-behavior') window.dispatchEvent(new CustomEvent('pet-character-changed'));
      }
      busy = false;
      if (state) render(state);
      if (!get('character-status').textContent) get('character-status').textContent = result.canceled ? '已取消' : action === 'characters-behavior' ? '已保存' : '形象已切换';
    } catch (error) {
      busy = false;
      if (state) render(state); else controls.forEach(id => { get(id).disabled = false; });
      get('character-status').textContent = error.message;
    }
  }
  get('character-companion').onchange = () => act('characters-companion', { id: get('character-companion').value === 'off' ? null : get('character-companion').value });
  for (const id of ['dafeiyu', 'bailong']) get('character-' + id).onclick = () => {
    if (state?.characters.find(c => c.id === id)?.available) void act('characters-select', { id });
  };
  get('skin-large-actions').onchange = () => act('characters-behavior', { largeActions: get('skin-large-actions').checked });
  get('skin-run').onchange = () => act('characters-behavior', { run: get('skin-run').checked });
  get('skin-flight').onchange = () => act('characters-behavior', { flight: get('skin-flight').checked });
  window.addEventListener('beforeunload', () => { stopped = true; });
  async function poll() {
    try { if (!busy) await refresh(); } catch (e) { if (!busy) get('character-status').textContent = e.message; }
    if (!stopped) setTimeout(poll, 5000);
  }
  void poll();
})();
