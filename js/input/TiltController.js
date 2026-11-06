// Device-orientation parallax.
// - works immediately where no permission is needed (Android Chrome)
// - on iOS 13+ asks for permission only from a user gesture (`requestFromGesture`)
// - the neutral pose follows the phone slowly (high-pass), so when the phone stops moving
//   the invitation drifts back to its neutral position
// - output is clamped and spring-smoothed: no jumps, no jitter
// - fallback: mouse position on desktop, nothing (still) on touch devices without sensors

import { clamp, damp } from '../util/motion.js';

const DEG = Math.PI / 180;

export class TiltController {
  constructor({ maxRotDeg = 5, rangeDeg = 18, returnSeconds = 2.2 } = {}) {
    this.maxRot = maxRotDeg * DEG;
    this.range = rangeDeg;
    this.returnRate = 1 / returnSeconds;
    this.raw = null;          // latest {beta, gamma}
    this.base = null;         // slowly adapting neutral pose
    this.out = { x: 0, y: 0, px: 0, py: 0 };   // rotation (rad) + parallax (−1…1)
    this.target = { x: 0, y: 0 };
    this.enabled = false;
    this.mouse = null;
    this.damping = 1;         // reduced while a finger drag is in progress
    this.onOrient = e => this.handle(e);
    this.onMouse = e => {
      if (e.pointerType !== 'mouse') return;
      this.mouse = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
    };
    this.onMouseLeave = () => { this.mouse = null; };
  }

  get needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  start() {
    // Listen right away: browsers that need permission (iOS) simply deliver nothing until it is granted.
    if (typeof DeviceOrientationEvent !== 'undefined') this.listen();
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      addEventListener('pointermove', this.onMouse, { passive: true });
      document.documentElement.addEventListener('pointerleave', this.onMouseLeave);
    }
  }

  /**
   * iOS 13+: must be called synchronously inside a user-gesture handler (touchend / click).
   * Retries on the next gesture if the browser did not accept this one as a user gesture;
   * stops once the user has answered (granted or denied).
   */
  requestFromGesture() {
    if (!this.needsPermission || this.permission === 'granted' || this.permission === 'denied' || this.pending) return;
    this.pending = true;
    let p;
    try { p = DeviceOrientationEvent.requestPermission(); } catch { this.pending = false; return; }
    Promise.resolve(p).then(state => {
      this.permission = state;
      if (state === 'granted') { removeEventListener('deviceorientation', this.onOrient); this.enabled = false; this.listen(); } // re-attach after grant (iOS)
      this.onPermission?.(state);
    })
      .catch(() => { /* not a valid gesture (or blocked by the host page): try again next time */ })
      .finally(() => { this.pending = false; });
  }

  /** True once real sensor data has arrived (the mouse fallback then switches off). */
  get hasSensor() { return !!this.raw; }

  listen() {
    if (this.enabled) return;
    this.enabled = true;
    addEventListener('deviceorientation', this.onOrient, { passive: true });
  }

  handle(e) {
    if (e.beta == null || e.gamma == null) return;
    let beta = e.beta, gamma = e.gamma;
    // map to the current screen orientation so "tilt toward me" always means the same thing
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (angle === 90) [beta, gamma] = [-gamma, beta];
    else if (angle === -90 || angle === 270) [beta, gamma] = [gamma, -beta];
    else if (angle === 180) [beta, gamma] = [-beta, -gamma];
    this.raw = { beta, gamma };
    if (!this.base) this.base = { beta, gamma };
  }

  update(dt) {
    let tx = 0, ty = 0;
    if (this.raw) {
      const b = this.base;
      // the neutral pose follows the phone slowly → returns to neutral when motion stops
      b.beta = damp(b.beta, this.raw.beta, this.returnRate, dt);
      b.gamma = damp(b.gamma, this.raw.gamma, this.returnRate, dt);
      const db = clamp((this.raw.beta - b.beta) / this.range, -1, 1);
      const dg = clamp((this.raw.gamma - b.gamma) / this.range, -1, 1);
      tx = db; ty = dg;
    } else if (this.mouse && !this.hasSensor) {
      tx = this.mouse.y * 0.6; ty = this.mouse.x * 0.6;
    }
    this.target.x = tx * this.damping; this.target.y = ty * this.damping;
    // critically damped follow — removes sensor noise and sudden jumps
    const k = 4.5;
    this.out.px = damp(this.out.px, this.target.y, k, dt);
    this.out.py = damp(this.out.py, -this.target.x, k, dt);
    this.out.x = this.out.py * -this.maxRot * 0.9;   // tilt toward/away → rotate about X
    this.out.y = this.out.px * this.maxRot;          // tilt left/right  → rotate about Y
    return this.out;
  }

  dispose() {
    removeEventListener('deviceorientation', this.onOrient);
    removeEventListener('pointermove', this.onMouse);
    document.documentElement.removeEventListener('pointerleave', this.onMouseLeave);
  }
}
