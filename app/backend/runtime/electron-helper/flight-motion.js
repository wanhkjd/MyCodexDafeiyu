/* Pure geometry and media-time motion. One current display, never the empty gaps between displays. */
'use strict';
var FlightMotion = (() => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = p => p * p * (3 - 2 * p);
  function boundsAt({ x, y, width, height, areas }) {
    const valid = (areas || []).filter(a => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.width) && Number.isFinite(a.height) && a.width > 0 && a.height > 0);
    if (!valid.length) return null;
    const cx = x + width / 2, cy = y + height / 2;
    const distance = a => Math.hypot(cx - clamp(cx, a.x, a.x + a.width), cy - clamp(cy, a.y, a.y + a.height));
    const area = valid.reduce((best, a) => distance(a) < distance(best) ? a : best);
    if (area.width < width + 16 || area.height < height + 16) return null;
    return { minX: area.x + 8, maxX: area.x + area.width - width - 8, minY: area.y + 8, maxY: area.y + area.height - height - 8, area };
  }
  function plan(options) {
    const b = boundsAt(options);
    if (!b) return null;
    const rng = options.random || Math.random;
    const unit = () => clamp(Number(rng()) || 0, 0, 1);
    const start = { x: clamp(options.x, b.minX, b.maxX), y: clamp(options.y, b.minY, b.maxY) };
    const direction = options.direction || (unit() < 0.5 ? 'left' : 'right');
    let minX = direction === 'right' ? start.x + 24 : b.minX;
    let maxX = direction === 'left' ? start.x - 24 : b.maxX;
    if (minX > maxX) {
      if (options.direction) return null;
      return plan({ ...options, direction: direction === 'left' ? 'right' : 'left' });
    }
    const target = { x: minX + unit() * (maxX - minX), y: b.minY + unit() * (b.maxY - b.minY) };
    // Require a visible vertical component when there is room, rather than horizontal-only "flight".
    if (Math.abs(target.y - start.y) < 40 && b.maxY - b.minY > 80) target.y = start.y < (b.minY + b.maxY) / 2 ? b.maxY : b.minY;
    const bend = (unit() - 0.5) * (b.maxY - b.minY) * 0.4;
    const control1 = { x: start.x + (target.x - start.x) / 3, y: clamp(start.y + (target.y - start.y) / 3 + bend, b.minY, b.maxY) };
    const control2 = { x: start.x + (target.x - start.x) * 2 / 3, y: clamp(start.y + (target.y - start.y) * 2 / 3 + bend, b.minY, b.maxY) };
    return { start, target, control1, control2, bounds: b, direction };
  }
  function sample(plan, mediaMs, startMs, stopMs) {
    const progress = clamp((mediaMs - startMs) / Math.max(1, stopMs - startMs), 0, 1), p = smooth(progress), q = 1 - p;
    const at = key => q*q*q*plan.start[key] + 3*q*q*p*plan.control1[key] + 3*q*p*p*plan.control2[key] + p*p*p*plan.target[key];
    return { x: at('x'), y: at('y'), progress };
  }
  return { plan, sample, boundsAt };
})();
