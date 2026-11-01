'use strict';

// One broker resolves each contact once, in screen coordinates, for either character.
function bodyBox(state) {
  const r = state.hitRect;
  if (!r || ![state.x, state.y, r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) return null;
  return { left: state.x + r.x, top: state.y + r.y, right: state.x + r.x + r.w, bottom: state.y + r.y + r.h };
}
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function collisionResponse(a, b, contact = null) {
  const ra = bodyBox(a), rb = bodyBox(b);
  if (!ra || !rb || (!contact && !overlaps(ra, rb)) || ![a.vx, a.vy, b.vx, b.vy].every(Number.isFinite)) return null;
  let dx = contact ? contact.nx : (rb.left + rb.right - ra.left - ra.right) / 2, dy = contact ? contact.ny : (rb.top + rb.bottom - ra.top - ra.bottom) / 2;
  let distance = Math.hypot(dx, dy);
  if (distance < 0.001) { dx = a.vx - b.vx; dy = a.vy - b.vy; distance = Math.hypot(dx, dy); }
  if (distance < 0.001) return null;
  const nx = dx / distance, ny = dy / distance;
  const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (relative <= 20) return null; // Ignore separating bodies and idle sub-pixel jitter.
  const options = a.collisionOptions || {};
  const number = (key, fallback, min, max) => Number.isFinite(options[key]) ? Math.max(min, Math.min(max, options[key])) : fallback;
  const e = number('collisionRestitution', 0.82, 0, 1), friction = number('collisionFriction', 0.08, 0, 0.3);
  // Use visible body area, not transparent canvas size (the two skins have different padding).
  const mass = number('collisionMass', 1, 0.5, 2), scale = number('unitScale', 1, 0.25, 8);
  const m1 = Math.max(0.1, a.hitRect.w * a.hitRect.h / (40000 * scale * scale)) * mass;
  const m2 = Math.max(0.1, b.hitRect.w * b.hitRect.h / (40000 * scale * scale)) * mass;
  const impulse = Math.min((1 + e) * relative / (1 / m1 + 1 / m2), number('collisionMaxImpulse', 9000, 1000, 12000) * scale);
  const v1 = { vx: (a.vx - impulse / m1 * nx) * (1 - friction), vy: (a.vy - impulse / m1 * ny) * (1 - friction) };
  const v2 = { vx: (b.vx + impulse / m2 * nx) * (1 - friction), vy: (b.vy + impulse / m2 * ny) * (1 - friction) };
  // Small inverse-mass position correction prevents two bouncing bodies sticking together.
  if (!contact) {
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    const depth = Math.min(Math.abs(nx) > 1e-6 ? ox / Math.abs(nx) : Infinity, Math.abs(ny) > 1e-6 ? oy / Math.abs(ny) : Infinity);
    const separation = Math.min(12 * scale, Math.max(0, depth - 0.5 * scale) * 0.6);
    const share = m2 / (m1 + m2);
    Object.assign(v1, { dx: -nx * separation * share, dy: -ny * separation * share });
    Object.assign(v2, { dx: nx * separation * (1 - share), dy: ny * separation * (1 - share) });
  }
  return { source: v1, target: v2 };
}
// Sweep the visible body, not the transparent canvas. Only short, physically plausible
// motion samples qualify; showing, resizing or teleporting a pet must not hit another one.
function sweptContact(previous, current, other) {
  const a = bodyBox(previous), end = bodyBox(current), b = bodyBox(other);
  if (!a || !end || !b || overlaps(a, b) || !previous.collidable) return null;
  const dt = (current.time - previous.time) / 1000;
  const dx = current.x - previous.x, dy = current.y - previous.y;
  const scale = Number.isFinite(current.collisionOptions?.unitScale) ? current.collisionOptions.unitScale : 1;
  if (dt <= 0 || dt > 0.12 || Math.hypot(dx, dy) > Math.max(Math.hypot(previous.vx, previous.vy), Math.hypot(current.vx, current.vy)) * dt * 1.5 + 2 * scale) return null;
  if (['x', 'y', 'w', 'h'].some(key => previous.hitRect[key] !== current.hitRect[key])) return null;
  let enter = 0, exit = 1, nx = 0, ny = 0;
  for (const [min, max, delta, axis] of [['left', 'right', dx, 'x'], ['top', 'bottom', dy, 'y']]) {
    if (Math.abs(delta) < 1e-9) {
      if (a[max] <= b[min] || a[min] >= b[max]) return null;
      continue;
    }
    const first = (b[min] - a[max]) / delta, last = (b[max] - a[min]) / delta;
    const near = Math.min(first, last), far = Math.max(first, last);
    if (near >= enter) { enter = near; nx = axis === 'x' ? Math.sign(delta) : 0; ny = axis === 'y' ? Math.sign(delta) : 0; }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (enter < 0 || enter > 1 || !nx && !ny) return null;
  return { nx, ny, dx: dx * (enter - 1) - nx * 0.5 * scale, dy: dy * (enter - 1) - ny * 0.5 * scale };
}
function createCollisionBroker({ onHit, isAvailable = () => true, clock = () => performance.now() }) {
  const states = new Map(), contacts = new Set();
  const keyOf = (a, b) => JSON.stringify([a, b].sort());
  function update(id, partial) {
    const previous = states.get(id);
    const current = { ...previous, ...partial, time: clock() };
    states.set(id, current);
    for (const [otherId, other] of states) {
      if (otherId === id) continue;
      const key = keyOf(id, otherId), a = bodyBox(current), b = bodyBox(other);
      if (!a || !b || !current.collidable || !other.collidable || !isAvailable(id) || !isAvailable(otherId)) {
        contacts.delete(key); continue;
      }
      if (contacts.has(key)) {
        if (!overlaps(a, b)) contacts.delete(key);
        continue;
      }
      let hit = collisionResponse(current, other);
      if (!hit && previous) {
        const contact = sweptContact(previous, current, other);
        if (contact) {
          hit = collisionResponse(current, other, contact);
          if (hit) Object.assign(hit.source, { dx: contact.dx, dy: contact.dy });
        }
      }
      if (!hit) continue;
      contacts.add(key);
      for (const [state, response] of [[current, hit.source], [other, hit.target]]) {
        state.vx = response.vx; state.vy = response.vy;
        state.x += response.dx || 0; state.y += response.dy || 0;
      }
      onHit(id, hit.source); onHit(otherId, hit.target);
      break;
    }
  }
  function remove(id) {
    states.delete(id);
    for (const key of contacts) if (JSON.parse(key).includes(id)) contacts.delete(key);
  }
  return { update, remove };
}
module.exports = { bodyBox, collisionResponse, sweptContact, createCollisionBroker };
