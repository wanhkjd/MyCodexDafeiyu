'use strict';
(() => {
  const get = id => document.getElementById(id), form = get('position-settings-form'), fields = form.querySelector('fieldset');
  const slot = get('position-slot'), x = get('position-x'), y = get('position-y'), fixed = get('position-fixed'), status = get('position-settings-status');
  let state, busy = false, dirty = false, stopped = false, revision = 0, reset = false;
  const input = () => ({ slot: slot.value, point: reset ? null : { x: x.valueAsNumber, y: y.valueAsNumber }, fixed: reset ? false : fixed.checked });
  function render(next) {
    state = next;
    slot.querySelector('[value="companion"]').disabled = !next.companionEnabled;
    if (!next.companionEnabled && slot.value === 'companion') slot.value = 'primary';
    const saved = next.settings[slot.value], point = saved.point || next.current[slot.value];
    x.value = point?.x ?? ''; y.value = point?.y ?? ''; fixed.checked = saved.fixed;
    get('position-global-lock').hidden = !next.globalLocked;
    fields.disabled = false; dirty = false; reset = false;
    get('position-current').disabled = !next.current[slot.value];
    status.textContent = saved.point ? '已保存初始位置' : '使用默认角落';
  }
  form.oninput = event => {
    if (!state || busy || event.target === slot) return;
    revision++; dirty = true; reset = false; status.textContent = '未应用';
  };
  slot.onchange = () => { if (state && !busy) { revision++; render(state); } };
  async function save() {
    if (!state || busy || (!reset && !form.reportValidity())) return;
    const value = input(); busy = true; revision++; fields.disabled = true; status.textContent = '正在保存…';
    try {
      const result = await window.pet.action('position-settings-save', value);
      if (!result.ok) throw new Error(result.message || '保存失败');
      render(result); status.textContent = value.point ? '已保存，启动位置已应用' : '已恢复默认角落';
    } catch (error) { fields.disabled = false; status.textContent = error.message || '保存失败，请重试'; }
    finally { busy = false; }
  }
  form.onsubmit = event => { event.preventDefault(); void save(); };
  get('position-default').onclick = () => { if (!busy && state) { reset = true; void save(); } };
  get('position-current').onclick = async () => {
    if (!state || busy) return;
    busy = true; revision++; fields.disabled = true; status.textContent = '正在读取位置…';
    try {
      const result = await window.pet.action('position-settings-state');
      if (!result.ok) throw new Error(result.message || '读取失败');
      const point = result.current[slot.value];
      if (!point) throw new Error('桌宠未显示或尚未就绪，请稍后重试');
      state = result; x.value = point.x; y.value = point.y;
      reset = false; dirty = true; status.textContent = '已填入当前位置，待保存';
    } catch (error) { status.textContent = error.message || '读取失败'; }
    finally { fields.disabled = false; busy = false; }
  };
  async function poll() {
    const version = revision;
    try {
      if (!busy && !dirty && !form.contains(document.activeElement)) {
        const result = await window.pet.action('position-settings-state');
        if (!result.ok) throw new Error(result.message || '读取失败');
        if (!busy && !dirty && version === revision) render(result);
      }
    } catch (error) { if (!busy && !dirty && version === revision) status.textContent = error.message || '读取失败，稍后重试'; }
    if (!stopped) setTimeout(poll, 3000);
  }
  window.addEventListener('beforeunload', () => { stopped = true; });
  void poll();
})();
