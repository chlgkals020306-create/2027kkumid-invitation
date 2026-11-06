// Page 2 — the content layer that rises from below the viewport.
// Owns: sheet transitions, pull-down-to-return (separated from normal scrolling),
// countdown, copy-address, sponsor row. Pure DOM; no knowledge of the 3D scene.

import { tween, ease, clamp, prefersReducedMotion } from '../util/motion.js';

export class Page2 {
  constructor({ root, scroller, page1, app, cfg, onRequestClose }) {
    Object.assign(this, { root, scroller, page1, app, cfg, onRequestClose });
    this.reduced = prefersReducedMotion();
    this.y = 1;                 // sheet position: 1 = parked below, 0 = covering the screen
    this.anim = null;
    this.interactive = false;   // true only in PAGE_02
    this.bindPull();
    this.bindDesktopReturn();
    this.bindCopy();
    this.timerEls = Object.fromEntries([...root.querySelectorAll('.timer__box')].map(el => [el.dataset.k, el]));
    this.openingAt = new Date(cfg.openingAt).getTime();
  }

  // ── layout of both layers for a sheet position y∈[0,1] ──
  apply(y) {
    this.y = y;
    const h = this.root.clientHeight || innerHeight;
    this.root.style.transform = `translate3d(0, ${(y * h).toFixed(2)}px, 0)`;
    const t = 1 - y;  // 0 → 1 as the sheet rises
    this.page1.style.transform = `translate3d(0, ${(-t * 4).toFixed(3)}%, 0) scale(${(1 - t * 0.06).toFixed(4)})`;
    this.page1.style.setProperty('--dim', (t * 0.45).toFixed(3));
  }

  async show() {
    this.app.dataset.page2 = '1';
    this.root.removeAttribute('aria-hidden'); this.root.inert = false;
    this.scroller.scrollTop = 0;
    await this.decodeImages();
    await this.animateTo(0, this.reduced ? 380 : this.cfg.page2.inMs, ease.sheet);
    this.page1.setAttribute('aria-hidden', 'true'); this.page1.inert = true;
    this.startLive();
  }

  async hide() {
    this.interactive = false;
    this.page1.removeAttribute('aria-hidden'); this.page1.inert = false;
    await this.animateTo(1, this.reduced ? 320 : this.cfg.page2.outMs, ease.sheetOut);
    this.stopLive();
    this.root.setAttribute('aria-hidden', 'true'); this.root.inert = true;
    this.app.dataset.page2 = '0';
    this.page1.style.transform = ''; this.page1.style.removeProperty('--dim');
  }

  animateTo(target, ms, easing) {
    this.anim?.cancel();
    const from = this.y;
    const dist = Math.abs(target - from);
    const dur = Math.max(160, ms * Math.sqrt(dist || 0.0001));   // partial pulls finish proportionally faster
    this.anim = tween(dur, k => this.apply(from + (target - from) * k), easing);
    return this.anim.promise;
  }

  /** Images are decoded before the sheet moves, so it never reveals blank boxes (no white flash). */
  decodeImages() {
    if (this._decoded) return this._decoded;
    const imgs = [...this.root.querySelectorAll('img')].slice(0, 4);
    this._decoded = Promise.race([
      Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))),
      new Promise(r => setTimeout(r, 600)),
    ]);
    return this._decoded;
  }

  // ── pull down at the top of the content → back to Page 1 ──
  bindPull() {
    const sc = this.scroller;
    let s = null;
    sc.addEventListener('touchstart', e => {
      if (!this.interactive || e.touches.length !== 1) { s = null; return; }
      // only a gesture that STARTS with the content already at the very top can close the page
      s = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, atTop: sc.scrollTop <= 0, pulling: false, last: [] };
    }, { passive: true });

    sc.addEventListener('touchmove', e => {
      if (!s || !s.atTop) return;
      const y = e.touches[0].clientY, dy = y - s.y0, dx = e.touches[0].clientX - s.x0;
      if (!s.pulling) {
        if (dy < -4 || Math.abs(dx) > Math.abs(dy)) { s = null; return; }   // normal scroll / horizontal → not ours
        if (dy < 10) return;
        s.pulling = true; s.yStart = y;
      }
      e.preventDefault();               // stop iOS rubber-band while we move the sheet
      const h = this.root.clientHeight;
      const pull = Math.max(0, y - s.yStart);
      this.anim?.cancel();
      this.apply(clamp(pull / h * 0.92, 0, 1));
      s.last.push({ y, t: e.timeStamp }); if (s.last.length > 5) s.last.shift();
    }, { passive: false });

    const end = e => {
      if (!s || !s.pulling) { s = null; return; }
      const l = s.last, v = l.length > 1 ? (l[l.length - 1].y - l[0].y) / Math.max(1, l[l.length - 1].t - l[0].t) : 0;
      const close = this.y > this.cfg.page2.pullCloseFrac || v > 0.6;
      s = null;
      if (close) this.onRequestClose();
      else this.animateTo(0, 420, ease.outCubic);
    };
    sc.addEventListener('touchend', end);
    sc.addEventListener('touchcancel', end);
  }

  bindDesktopReturn() {
    // Wheel: only a burst of upward scrolling that STARTS while the content is already at the top
    // returns (momentum that carries a scroll up to the top never does).
    let acc = 0, last = 0, burstAtTop = false;
    this.scroller.addEventListener('wheel', e => {
      if (!this.interactive) return;
      const now = performance.now();
      if (now - last > 200) { acc = 0; burstAtTop = this.scroller.scrollTop <= 0; }
      last = now;
      if (!burstAtTop || e.deltaY >= 0) { if (e.deltaY > 0) acc = 0; return; }
      e.preventDefault();
      acc += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (acc < -240) { acc = 0; burstAtTop = false; this.onRequestClose(); }
    }, { passive: false });
    addEventListener('keydown', e => { if (this.interactive && e.key === 'Escape' && !e.target.closest?.('input, textarea')) this.onRequestClose(); });
    // Mouse drag on the top grab strip.
    const grab = this.root.querySelector('.page2__grab');
    grab.style.pointerEvents = 'auto'; grab.style.cursor = 'grab'; grab.style.touchAction = 'none';
    let d = null;
    grab.addEventListener('pointerdown', e => { if (!this.interactive) return; d = { y0: e.clientY }; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener('pointermove', e => { if (!d) return; this.anim?.cancel(); this.apply(clamp((e.clientY - d.y0) / this.root.clientHeight, 0, 1)); });
    grab.addEventListener('pointerup', () => { if (!d) return; d = null; if (this.y > this.cfg.page2.pullCloseFrac) this.onRequestClose(); else this.animateTo(0, 380, ease.outCubic); });
  }

  bindCopy() {
    const btn = this.root.querySelector('#copyAddr');
    btn?.addEventListener('click', async () => {
      const text = btn.dataset.addr;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch {
        const ta = Object.assign(document.createElement('textarea'), { value: text });
        ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch {} ta.remove();
      }
      toast(ok ? '주소가 복사되었습니다' : text);
    });
  }

  // ── live parts: countdown + sponsor row (only while Page 2 is on screen) ──
  startLive() {
    this.tickTimer();
    this.timerId = setInterval(() => this.tickTimer(), 1000);
    if (!this.reduced) this.startMarquee();
  }
  stopLive() { clearInterval(this.timerId); this.stopMarquee(); }

  tickTimer() {
    let s = Math.max(0, Math.floor((this.openingAt - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const pad = n => String(n).padStart(2, '0');
    const t = this.timerEls;
    t.d.textContent = pad(d); t.h.textContent = pad(h); t.m.textContent = pad(m); t.s.textContent = pad(s);
  }

  /** Hold, then glide one logo to the left, repeat (continuous loop). */
  startMarquee() {
    const track = this.root.querySelector('#marqueeTrack');
    if (!track || this.marqueeOn) return;
    this.marqueeOn = true;
    const step = () => {
      if (!this.marqueeOn) return;
      const first = track.firstElementChild;
      const w = first.getBoundingClientRect().width + parseFloat(getComputedStyle(first).marginRight) + (parseFloat(getComputedStyle(first).marginLeft) || 0);
      track.style.transition = 'transform 900ms cubic-bezier(.65,0,.35,1)';
      track.style.transform = `translate3d(${-w}px,0,0)`;
      this.marqueeT = setTimeout(() => {
        track.style.transition = 'none';
        track.append(first);
        track.style.transform = 'translate3d(0,0,0)';
        this.marqueeT = setTimeout(step, 1700);
      }, 950);
    };
    this.marqueeT = setTimeout(step, 1600);
  }
  stopMarquee() { this.marqueeOn = false; clearTimeout(this.marqueeT); }
}

let toastT = 0;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('is-on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('is-on'), 1800);
}
