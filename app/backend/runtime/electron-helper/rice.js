'use strict';
const rice = document.getElementById('rice');
let pointer = null;
rice.addEventListener('pointerdown', e => {
  if (e.button !== 0 || rice.disabled || pointer !== null) return;
  e.preventDefault();
  pointer = e.pointerId;
  rice.setPointerCapture(pointer);
  rice.classList.add('dragging');
  window.riceBridge.begin({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
});
function end(e, drop) {
  if (e.pointerId !== pointer) return;
  const id = pointer;
  pointer = null;
  if (rice.hasPointerCapture(id)) rice.releasePointerCapture(id);
  rice.classList.remove('dragging');
  window.riceBridge.end(drop);
}
rice.addEventListener('pointerup', e => end(e, true));
rice.addEventListener('pointercancel', e => end(e, false));
rice.addEventListener('lostpointercapture', e => end(e, false));
rice.addEventListener('contextmenu', e => { e.preventDefault(); window.riceBridge.cancel(); });
window.riceBridge.onState(state => {
  rice.disabled = state.pending === true;
  rice.classList.toggle('over', state.over === true);
  rice.title = state.message || (state.over ? '松手喂白饭' : '拖到桌宠身上松手 · 右击取消');
});
