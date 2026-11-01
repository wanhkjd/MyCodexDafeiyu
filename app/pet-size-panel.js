(() => {
  const get = id => document.getElementById(id);
  const form = get('pet-size-form'), slider = get('pet-size-slider'), number = get('pet-size-number');
  const apply = get('pet-size-apply'), reset = get('pet-size-default'), status = get('pet-size-status');
  const controls = [slider, number, apply, reset];
  let state, busy = false, dirty = false, stopped = false, revision = 0;
  function disable(value) { controls.forEach(control => { control.disabled = value; }); }
  function preview() {
    dirty = !state || number.value === '' || Number(number.value) !== state.size;
    get('pet-size-current').textContent = number.value === '' ? '请输入大小' : number.value + ' px' + (dirty ? '（未应用）' : '');
    slider.setAttribute('aria-valuetext', slider.value + ' 像素');
  }
  function render(next) {
    state = next;
    for (const field of [slider, number]) { field.min = next.min; field.max = next.max; field.value = next.size; }
    dirty = false;
    disable(false);
    preview();
  }
  slider.oninput = () => { revision++; number.value = slider.value; preview(); status.textContent = '未应用'; };
  number.oninput = () => { revision++; if (number.value !== '') slider.value = number.value; preview(); status.textContent = '未应用'; };
  reset.onclick = () => {
    revision++;
    slider.value = number.value = state.defaultSize;
    preview();
    status.textContent = '已恢复默认，待应用';
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !state || !form.reportValidity()) return;
    const size = Number(number.value);
    busy = true;
    revision++;
    disable(true);
    status.textContent = '正在应用大小…';
    try {
      const result = await window.pet.action('pet-size-save', { size });
      if (!result.ok) throw new Error(result.message || '应用大小失败');
      render(result);
      status.textContent = '已应用 ' + result.size + ' px';
    } catch (error) {
      disable(false);
      status.textContent = error.message || '应用大小失败，请稍后重试。';
    } finally { busy = false; }
  };
  async function poll() {
    const requestedRevision = revision;
    try {
      if (!busy && !dirty && document.activeElement !== slider && document.activeElement !== number) {
        const next = await window.pet.action('pet-size-state');
        if (!next.ok) throw new Error(next.message || '读取大小失败');
        if (!busy && !dirty && requestedRevision === revision) render(next);
      }
    } catch (error) { if (!busy && !dirty) status.textContent = error.message || '读取大小失败，稍后自动重试。'; }
    if (!stopped) setTimeout(poll, 5000);
  }
  window.addEventListener('beforeunload', () => { stopped = true; });
  void poll();
})();
