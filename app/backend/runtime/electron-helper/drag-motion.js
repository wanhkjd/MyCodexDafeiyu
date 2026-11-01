/* Drag math in CSS workspace coordinates; no window or user-data access. */
'use strict';
var DragMotion = (() => {
  const defaults = Object.freeze({ dragPhysics: true, dropGravity: false, throwStrength: 'standard', lockPosition: false, shiftDrag: false, collisionEnabled: true, petCollision: false, collisionRestitution: 0.82, collisionFriction: 0.08, collisionMass: 1, collisionMaxImpulse: 9000 });
  const caps = Object.freeze({ gentle: 3600, standard: 4800, strong: 7200, crazy: 9000 });
  const normalize = value => Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, value?.[key] ?? fallback]));
  const cap = settings => caps[settings?.throwStrength] || caps.standard;
  const canDrag = (settings, shift) => !settings.lockPosition && (!settings.shiftDrag || shift === true);
  function limit(velocity, max) {
    if (!velocity) return null;
    const speed = Math.hypot(velocity.vx, velocity.vy);
    return speed <= max ? velocity : { vx: velocity.vx / speed * max, vy: velocity.vy / speed * max };
  }
  function isStationary(trail, now) {
    if (!trail.length || now - trail[trail.length - 1].t >= 80) return true;
    const recent = trail.filter(point => now - point.t <= 100);
    if (recent.length < 2) return false;
    return recent.slice(1).every((point, i) => {
      const previous = recent[i], dt = (point.t - previous.t) / 1000;
      return dt > 0 && Math.hypot(point.x - previous.x, point.y - previous.y) / dt < 80;
    });
  }
  function collisionPhysics(physics, settings) {
    return { ...physics, restitution: settings.collisionEnabled ? settings.collisionRestitution : 0,
      groundFriction: settings.collisionFriction * (2.5 / 0.08), collisionFriction: settings.collisionFriction,
      collisionMass: settings.collisionMass, collisionMaxImpulse: settings.collisionMaxImpulse, petCollision: false };
  }
  function dropPhysics(physics) {
    // Independent of the physics toggle; zero-gravity user configs still fall in this mode.
    return { ...physics, gravity: Math.max(1, Number(physics.gravity) || 1400), restitution: 0, ceilingBounce: true, petCollision: false };
  }
  return { defaults, caps, normalize, cap, canDrag, limit, isStationary, collisionPhysics, dropPhysics };
})();
