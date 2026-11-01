(() => {
  const get = id => document.getElementById(id);
  const controls = ['character-dafeiyu', 'character-bailong', 'character-folder', 'character-import', 'character-bundled', 'skin-large-actions', 'skin-run', 'skin-flight'];
  let busy = false, state, stopped = false;
  function render(next) {
    state = next;
    const actual = next.active === 'bailong' ? '白龙' : '大肥鱼';
    get('character-active').textContent = '当前形象：' + actual + (next.selected !== next.active ? '（白龙素材失效，暂时回退）' : '');
    for (const item of next.characters) {
      const button = get('character-' + item.id);
      button.setAttribute('aria-pressed', String(next.active === item.id));
      button.disabled = busy;
    }
    controls.forEach(id => { get(id).disabled = busy; });
    get('character-import').hidden = next.source === 'bundled' || !next.root || next.managed;
    get('character-bundled').hidden = !next.bundledAvailable || next.source === 'bundled';
    get('character-path').textContent = next.root ? (next.source === 'bundled' ? '内置素材：' : '导入素材：') + next.root : '白龙素材不可用，请恢复程序素材或重新导入。';
    get('character-status').textContent = next.selected !== next.active ? '白龙素材失效，已切回大肥鱼。' : '';
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
    get('character-status').textContent = action === 'characters-folder' ? '请选择素材文件夹…'
      : action === 'characters-import-existing' ? '正在导入素材…'
      : action === 'characters-behavior' ? '正在保存动作开关…' : '正在切换形象…';
    try {
      const result = await window.pet.action(action, body);
      if (!result.ok) throw new Error(result.message || '操作失败');
      if (!result.canceled) {
        state = result;
        if (action !== 'characters-behavior') window.dispatchEvent(new CustomEvent('pet-character-changed'));
      }
      busy = false;
      if (state) render(state);
      if (!get('character-status').textContent) get('character-status').textContent = result.canceled ? '已取消' : action === 'characters-behavior' ? '已保存' : action === 'characters-import-existing' || action === 'characters-folder' ? '素材已导入' : '形象已切换';
    } catch (error) {
      busy = false;
      if (state) render(state); else controls.forEach(id => { get(id).disabled = false; });
      get('character-status').textContent = error.message;
    }
  }
  get('character-dafeiyu').onclick = () => act('characters-select', { id: 'dafeiyu' });
  get('character-bailong').onclick = () => state?.characters.find(c => c.id === 'bailong')?.available
    ? act('characters-select', { id: 'bailong' }) : act('characters-folder');
  get('character-folder').onclick = () => act('characters-folder');
  get('character-bundled').onclick = () => act('characters-select', { id: 'bailong', source: 'bundled' });
  get('character-import').onclick = () => act('characters-import-existing');
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
