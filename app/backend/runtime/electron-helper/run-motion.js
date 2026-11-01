/* Horizontal free running within one display. Shares flight's display selection, never crosses screen gaps. */
'use strict';
var RunMotion = (() => {
  const ANIMATION = '控制-奔跑';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function plan(options) {
    const bounds = FlightMotion.boundsAt(options);
    if (!bounds) return null;
    const random = options.random || Math.random;
    const unit = () => clamp(Number(random()) || 0, 0, 1);
    const start = { x: clamp(options.x, bounds.minX, bounds.maxX), y: clamp(options.y, bounds.minY, bounds.maxY) };
    let direction = unit() < 0.5 ? 'left' : 'right';
    const room = facing => facing === 'right' ? bounds.maxX - start.x : start.x - bounds.minX;
    const minDistance = Math.max(24, options.width * 0.35);
    if (room(direction) < minDistance) direction = direction === 'left' ? 'right' : 'left';
    if (room(direction) < minDistance) return null;
    const distance = Math.min(room(direction), options.width * (1.25 + unit() * 1.25));
    return { start, target: { x: start.x + (direction === 'right' ? distance : -distance), y: start.y }, direction, bounds, durationMs: 6000 + unit() * 4000 };
  }
  function sample(plan, elapsedMs) {
    const progress = clamp(elapsedMs / plan.durationMs, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    return { x: plan.start.x + (plan.target.x - plan.start.x) * eased, y: plan.start.y, progress };
  }
  function mediaDelta(previous, current, duration) {
    if (![previous, current, duration].every(Number.isFinite) || duration <= 0) return 0;
    return Math.max(0, current >= previous ? current - previous : duration - previous + current);
  }
  return { ANIMATION, plan, sample, mediaDelta };
})();
