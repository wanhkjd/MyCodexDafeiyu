'use strict';
(() => {
  const get = id => document.getElementById(id), form = get('drag-settings-form'), fields = form.querySelector('fieldset');
  const status = get('drag-settings-status'), strength = get('drag-throwStrength');
  const numericKeys = ['collisionRestitution', 'collisionFriction', 'collisionMass', 'collisionMaxImpulse'];
  const keys = ['dragPhysics', 'dropGravity', 'throwStrength', 'lockPosition', 'shiftDrag', 'collisionEnabled', 'petCollision', ...numericKeys];
  let state, busy = false, dirty = false, revision = 0, stopped = false;
  const values = () => Object.fromEntries(keys.map(k => [k, k === 'throwStrength' ? strength.value : numericKeys.includes(k) ? get('drag-' + k).valueAsNumber : get('drag-' + k).checked]));
  function render(next) {
    if (!state) status.textContent = '';
    state = next;
    strength.replaceChildren(...next.presets.map(p => new Option(p.label, p.value)));
    for (const k of keys) { if (k === 'throwStrength') strength.value = next.settings[k]; else if (numericKeys.includes(k)) get('drag-' + k).value = next.settings[k]; else get('drag-' + k).checked = next.settings[k]; }
    fields.disabled = false; dirty = false;
  }
  form.oninput = form.onchange = () => { if (!state || busy) return; revision++; dirty = JSON.stringify(values()) !== JSON.stringify(Object.fromEntries(keys.map(k => [k, state.settings[k]]))); status.textContent = dirty ? '未应用' : ''; };
  get('drag-strength-default').onclick = () => { strength.value = state.defaults.throwStrength; form.onchange(); };
  get('drag-collision-default').onclick = () => {
    if (!state || busy) return;
    for (const k of numericKeys) get('drag-' + k).value = state.defaults[k];
    form.onchange();
  };
  form.addEventListener('invalid', event => {
    const details = event.target.closest('details');
    if (details) details.open = true;
  }, true);
  form.onsubmit = async event => {
    event.preventDefault();
    if (!state || busy) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const input = values(); busy = true; revision++; fields.disabled = true; status.textContent = '正在应用…';
    try {
      const result = await window.pet.action('drag-settings-save', input);
      if (!result.ok) throw new Error(result.message || '应用失败');
      render(result); status.textContent = '已应用';
    } catch (error) { fields.disabled = false; status.textContent = error.message || '应用失败，请重试'; }
    finally { busy = false; }
  };
  async function poll() {
    const version = revision;
    try {
      if (!busy && !dirty && !form.contains(document.activeElement)) {
        const result = await window.pet.action('drag-settings-state');
        if (!result.ok) throw new Error(result.message || '读取失败');
        if (!busy && !dirty && revision === version) render(result);
      }
    } catch (error) { if (!busy && !dirty && revision === version) status.textContent = error.message || '读取失败，稍后重试'; }
    if (!stopped) setTimeout(poll, 5000);
  }
  window.addEventListener('beforeunload', () => { stopped = true; });
  void poll();
})();
