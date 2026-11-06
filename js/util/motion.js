// Small motion helpers: easing, frame-rate independent damping, spring.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: t => 1 - Math.pow(1 - t, 5),
  // cubic-bezier(.22,.9,.24,1) — "sheet" curve used for Page 2
  sheet: bezier(0.22, 0.9, 0.24, 1),
  sheetOut: bezier(0.55, 0, 0.3, 1),
};

/** Exponential damping toward a target, independent of frame rate. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Damped spring (semi-implicit Euler with sub-steps). Interruptible: keeps velocity. */
export class Spring {
  constructor(value = 0, { stiffness = 120, damping = 22 } = {}) {
    this.value = value; this.target = value; this.velocity = 0;
    this.stiffness = stiffness; this.damping = damping;
  }
  set(v) { this.value = v; this.target = v; this.velocity = 0; }
  step(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const f = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += f * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  get settled() { return Math.abs(this.value - this.target) < 6e-4 && Math.abs(this.velocity) < 6e-3; }
}

function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    let t = x;
    for (let i = 0; i < 6; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; t -= e / d; }
    return sy(clamp(t));
  };
}

/** Promise-based tween on rAF. Returns { promise, cancel }. */
export function tween(duration, onUpdate, easing = ease.outCubic) {
  let raf = 0, cancelled = false, start = 0;
  const promise = new Promise(resolve => {
    const tick = now => {
      if (cancelled) return resolve(false);
      if (!start) start = now;
      const t = duration <= 0 ? 1 : clamp((now - start) / duration);
      onUpdate(easing(t), t);
      if (t < 1) raf = requestAnimationFrame(tick); else resolve(true);
    };
    raf = requestAnimationFrame(tick);
  });
  return { promise, cancel() { cancelled = true; cancelAnimationFrame(raf); } };
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
