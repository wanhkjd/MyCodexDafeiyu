(() => {
  const get = id => document.getElementById(id);
  const controls = ['character-dafeiyu', 'character-bailong', 'character-folder', 'character-import', 'character-bundled', 'skin-large-actions', 'skin-flight'];
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
    get('character-status').textContent = next.message;
    get('skin-large-actions').checked = next.behavior?.largeActions !== false;
    get('skin-flight').checked = next.behavior?.flight !== false;
    get('skin-behavior-note').textContent = next.behavior?.largeActions === false
      ? '大幅动作已禁止（包含飞行）。小幅待机、点击回应和拖拽落地仍然保留。'
      : next.behavior?.flight === false ? '飞行已禁止，其他互动与大幅动作仍可进行。'
      : '允许自主大幅动作；白龙可在当前整个屏幕内飞行。全屏应用不会自动隐藏桌宠。';
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
    get('character-status').textContent = action === 'characters-folder' ? '请选择 BailongPet 文件夹；随后复制并校验约 150 MB 素材…'
      : action === 'characters-import-existing' ? '正在复制并校验素材，完成后不再依赖下载目录…'
      : action === 'characters-behavior' ? '正在保存动作开关…' : '正在切换形象，人格与聊天保持不变…';
    try {
      const result = await window.pet.action(action, body);
      if (!result.ok) throw new Error(result.message || '操作失败');
      if (!result.canceled) {
        state = result;
        if (action !== 'characters-behavior') window.dispatchEvent(new CustomEvent('pet-character-changed'));
      }
      busy = false;
      if (state) render(state);
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
  get('skin-flight').onchange = () => act('characters-behavior', { flight: get('skin-flight').checked });
  window.addEventListener('beforeunload', () => { stopped = true; });
  async function poll() {
    try { if (!busy) await refresh(); } catch (e) { if (!busy) get('character-status').textContent = e.message; }
    if (!stopped) setTimeout(poll, 5000);
  }
  void poll();
})();
