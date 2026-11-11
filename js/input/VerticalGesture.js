// Pointer-based vertical gesture recogniser (touch, pen and mouse share one code path).
// - one active pointer at a time (extra fingers are ignored)
// - small movements are ignored until `lockPx`
// - the axis is locked once: horizontal gestures are released, never acted on
// - reports velocity from the last ~90 ms for flick detection

export class VerticalGesture {
  constructor(el, { lockPx = 9, verticalBias = 1.15, onStart, onMove, onEnd, onTap, canStart } = {}) {
    Object.assign(this, { el, lockPx, verticalBias, onStart, onMove, onEnd, onTap, canStart });
    this.active = null;
    this.samples = [];
    this.handlers = {
      down: e => this.down(e), move: e => this.move(e), up: e => this.up(e, false), cancel: e => this.up(e, true),
    };
    el.addEventListener('pointerdown', this.handlers.down);
    el.addEventListener('pointermove', this.handlers.move);
    el.addEventListener('pointerup', this.handlers.up);
    el.addEventListener('pointercancel', this.handlers.cancel);
    el.addEventListener('lostpointercapture', this.handlers.cancel);
  }

  down(e) {
    if (this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (this.canStart && !this.canStart(e)) return;
    this.active = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, type: e.pointerType, t0: e.timeStamp };
    this.samples = [{ y: e.clientY, t: e.timeStamp }];
    try { this.el.setPointerCapture(e.pointerId); } catch {}
  }

  move(e) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    const dx = e.clientX - a.x0, dy = e.clientY - a.y0;
    if (!a.axis) {
      if (Math.hypot(dx, dy) < this.lockPx) return;
      a.axis = Math.abs(dy) > Math.abs(dx) * this.verticalBias ? 'y' : 'x';
      if (a.axis === 'y') { a.yLock = e.clientY; this.onStart?.(a, e); }
    }
    if (a.axis !== 'y') return;
    e.preventDefault();
    this.samples.push({ y: e.clientY, t: e.timeStamp });
    while (this.samples.length > 2 && e.timeStamp - this.samples[0].t > 200) this.samples.shift();
    this.onMove?.(e.clientY - a.yLock, a, e);
  }

  up(e, cancelled) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    this.active = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch {}
    if (a.axis === 'y') {
      // velocity over the last 140 ms before lift-off (px/ms, negative = upward);
      // a finger that rested before lifting has no samples in the window → 0
      this.samples.push({ y: e.clientY, t: e.timeStamp });
      const win = this.samples.filter(s => e.timeStamp - s.t <= 140);
      let v = 0;
      if (win.length >= 2) {
        const first = win[0], last = win[win.length - 1];
        v = (last.y - first.y) / Math.max(8, last.t - first.t);
      }
      this.onEnd?.({ dy: e.clientY - a.yLock, velocity: v, cancelled }, a, e);
    } else if (!a.axis && !cancelled) {
      this.onTap?.(a, e);
    }
  }

  get dragging() { return !!this.active && this.active.axis === 'y'; }

  dispose() {
    const h = this.handlers, el = this.el;
    el.removeEventListener('pointerdown', h.down); el.removeEventListener('pointermove', h.move);
    el.removeEventListener('pointerup', h.up); el.removeEventListener('pointercancel', h.cancel);
    el.removeEventListener('lostpointercapture', h.cancel);
  }
}
