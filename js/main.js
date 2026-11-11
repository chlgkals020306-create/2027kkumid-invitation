// Orchestrates the experience: state machine ⇄ 3D scene ⇄ gestures ⇄ Page 2.
import { CONFIG } from './config.js';
import { S, StateMachine } from './StateMachine.js';
import { InvitationScene } from './scene/InvitationScene.js';
import { VerticalGesture } from './input/VerticalGesture.js';
import { TiltController } from './input/TiltController.js';
import { Page2 } from './page2/Page2.js';
import { Personalize } from './page2/Personalize.js';
import { Spring, clamp } from './util/motion.js';

const $ = id => document.getElementById(id);
const app = $('app'), page1 = $('page1'), canvas = $('stage');
const sm = new StateMachine(S.LOADING);
const cfg = CONFIG;

sm.on((next, prev) => { app.dataset.state = next; document.dispatchEvent(new CustomEvent('invite:state', { detail: { next, prev } })); });

// ── card progress: finger-driven while dragging, spring-driven otherwise ──
const card = {
  spring: new Spring(0, { stiffness: 95, damping: 17.5 }),
  dragging: false,
  startP: 0,
  span: 300,
  autoPage2: false,
  pendingPage2: 0,
};

let scene = null;
const tilt = new TiltController(cfg.tilt);

const page2 = new Page2({
  root: $('page2'), scroller: $('page2Scroll'), page1, app, cfg,
  onRequestClose: () => closePage2(),
});

// To. / From. names: editable for the sender, fixed for anyone opening a personal link.
const personalize = new Personalize($('page2'));

// iOS start gate: shown the moment the link opens (even while loading). One tap → the
// "Motion & Orientation" prompt appears immediately; then the normal swipe hint returns.
setupStartGate();

// ───────────────────────────── boot ─────────────────────────────
boot();

function setupStartGate() {
  const gate = $('tapGate');
  // iPhone / iPad (iPadOS reports itself as "Macintosh" with touch) — the only platform that needs the prompt.
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (!(cfg.tilt.askPermission && cfg.tilt.startGate && tilt.needsPermission && isIOS)) return;
  gate.hidden = false;
  app.dataset.gate = '1';
  let done = false;
  const open = e => {
    if (done) return;
    done = true;
    e.preventDefault();
    tilt.requestFromGesture();          // synchronous, inside the tap → iOS shows the prompt now
    gate.hidden = true;
    delete app.dataset.gate;
  };
  gate.addEventListener('touchend', open);
  gate.addEventListener('click', open);
}

async function boot() {
  if (!webglAvailable()) return fatal('이 기기에서는 3D 초대장을 표시할 수 없습니다.', true);
  try {
    scene = new InvitationScene(canvas, cfg);
    scene.beforeTick = dt => frame(dt);
    const { stats } = await scene.load(p => { $('loaderFill').style.transform = `scaleX(${(0.1 + p * 0.85).toFixed(3)})`; });
    $('loaderFill').style.transform = 'scaleX(1)';
    window.__invite = { scene, sm, card, stats, page2, tilt, personalize };   // handy for QA in the console
    console.info('[invite] model', stats);
    observeResize();
    tilt.start();
    scene.start();
    requestAnimationFrame(() => { app.dataset.ready = '1'; $('loaderLabel').textContent = ''; });
    sm.go(S.CLOSED);
    bindPage1Input();
  } catch (err) {
    console.error(err);
    const offline = navigator.onLine === false;
    fatal(offline ? '인터넷 연결이 끊어져 초대장을 불러오지 못했습니다.<br/>연결을 확인한 뒤 다시 시도해 주세요.'
                  : '3D 초대장을 불러오지 못했습니다.<br/>다시 시도하거나, 초대장 내용을 바로 확인해 주세요.', !offline,
          String(err?.message || err).slice(0, 160));
  }
}

// Runs inside the scene's render loop, before each frame is drawn.
function frame(dt) {
  const t = tilt.update(dt);
  scene.setTilt(t.x, t.y);
  scene.setParallax(t.px, t.py);
  page1.style.setProperty('--bgx', `${(-t.px * 6).toFixed(2)}px`);
  page1.style.setProperty('--bgy', `${(-t.py * 6).toFixed(2)}px`);

  if (!card.dragging) {
    card.spring.step(dt);
    if (card.spring.settled && sm.is(S.OPENING, S.CLOSING)) settle();
  }
  scene.setProgress(clamp(card.spring.value, 0, 1.03));
}

function settle() {
  const s = card.spring;
  s.set(s.target);
  if (s.target >= 1) {
    sm.go(S.OPEN);
    if (card.autoPage2) {
      card.autoPage2 = false;
      clearTimeout(card.pendingPage2);
      card.pendingPage2 = setTimeout(() => { if (sm.is(S.OPEN) && !card.dragging) openPage2(); }, cfg.page2.delayAfterOpenMs);
    }
  } else {
    sm.go(S.CLOSED);
  }
}

// ───────────────────────────── Page 1 input ─────────────────────────────
function bindPage1Input() {
  const g = cfg.gesture;
  new VerticalGesture(page1, {
    lockPx: g.lockPx, verticalBias: g.verticalBias,
    canStart: () => sm.is(S.CLOSED, S.OPENING, S.CLOSING, S.OPEN),
    onStart: (a, e) => beginDrag(scene.hitTest(e.clientX, e.clientY)),
    onMove: dy => moveDrag(dy),
    onEnd: ({ dy, velocity }) => endDrag(dy, velocity),
  });

  // iOS motion permission: first touch/click anywhere also asks (fallback if the gate was skipped).
  if (cfg.tilt.askPermission) {
    const ask = () => tilt.requestFromGesture();
    document.addEventListener('touchend', ask, { passive: true, capture: true });
    document.addEventListener('click', ask, { capture: true });
    tilt.onPermission = state => {
      console.info('[tilt] motion permission:', state);
      document.removeEventListener('touchend', ask, { capture: true });
      document.removeEventListener('click', ask, { capture: true });
    };
  }

  // Desktop preview: the mouse wheel / trackpad acts as a vertical swipe.
  let wheel = null;
  page1.addEventListener('wheel', e => {
    e.preventDefault();
    if (!sm.is(S.CLOSED, S.OPENING, S.CLOSING, S.OPEN)) return;
    if (!wheel) { wheel = { dy: 0 }; beginDrag(false); }
    wheel.dy -= e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.6;
    wheel.v = -e.deltaY;
    moveDrag(wheel.dy);
    clearTimeout(wheel.t);
    wheel.t = setTimeout(() => { const w = wheel; wheel = null; endDrag(w.dy, 0); }, 220);
  }, { passive: false });

  // Keyboard / assistive tech: same transitions, same animation.
  addEventListener('keydown', e => {
    if (sm.is(S.PAGE_02, S.PAGE_TRANSITION_IN, S.PAGE_TRANSITION_OUT)) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); keyboardStep(+1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); keyboardStep(-1); }
  });
  $('a11yOpen').addEventListener('click', () => keyboardStep(+1));
  $('a11yBack').addEventListener('click', () => closePage2());
}

function beginDrag(onCard) {
  clearTimeout(card.pendingPage2);
  card.dragging = true;
  card.startP = card.spring.value;
  card.startState = sm.state;
  card.onCard = onCard;
  card.spring.velocity = 0;
  // finger travel for a full opening ≈ the on-screen depth of the cover × 2.1
  const h = page1.clientHeight;
  card.span = clamp(scene.projectedCoverSpan() * 2.1, h * 0.26, h * 0.55);
  tilt.damping = 0.35;             // tilt keeps out of the way while the finger leads
}

function moveDrag(dy) {
  if (!card.dragging) return;
  const raw = card.startP - dy / card.span;
  // hard stop at "closed" (never fold into the base), soft resistance past "open"
  const p = raw > 1 ? 1 + (1 - Math.exp(-(raw - 1) * 4)) * 0.03 : Math.max(0, raw);
  card.spring.value = p; card.spring.target = p;
  if (card.startState === S.OPEN && dy < 0) return;          // pulling an open card further up → Page 2 on release
  if (p > card.startP + 1e-3) sm.go(S.OPENING);
  else if (p < card.startP - 1e-3) sm.go(S.CLOSING);
}

function endDrag(dy, v) {
  if (!card.dragging) return;
  card.dragging = false;
  tilt.damping = 1;
  const g = cfg.gesture, s = card.spring, p = s.value;
  if (window.__invite) window.__invite.lastRelease = { dy: Math.round(dy), v: +v.toFixed(3), p: +p.toFixed(3), span: Math.round(card.span) };

  // Already open and swiped up again → continue to Page 2.
  if (card.startState === S.OPEN && (dy < -g.toPage2Px || v < -g.flick) && p >= 0.99) {
    s.target = 1;
    if (sm.is(S.OPEN)) return openPage2();
  }

  let target;
  if (v < -g.flick) target = 1;
  else if (v > g.flick) target = 0;
  else if (p >= card.startP) target = p > g.openThreshold ? 1 : 0;
  else target = p < g.closeThreshold ? 0 : 1;

  if (target === 1 && p >= 1 - 1e-3 && card.startState === S.OPEN) { s.target = 1; sm.go(S.OPEN); return; }
  if (target === 0 && p <= 1e-3) { s.set(0); sm.go(S.CLOSED); return; }

  s.target = target;
  s.velocity = clamp((-v / card.span) * 1000, -6, 6);        // carry the finger's momentum
  // Page 2 follows only a gesture that actually opened the card (moved up, or flicked up)
  card.autoPage2 = target === 1 && card.startP < 0.98 && (p > card.startP + 0.02 || v < -g.flick);
  sm.go(target === 1 ? S.OPENING : S.CLOSING);
}

function keyboardStep(dir) {
  if (dir > 0) {
    if (sm.is(S.OPEN)) return openPage2();
    if (!sm.is(S.CLOSED, S.CLOSING, S.OPENING)) return;
    card.spring.target = 1; card.autoPage2 = true; sm.go(S.OPENING);
  } else {
    if (!sm.is(S.OPEN, S.OPENING)) return;
    card.spring.target = 0; card.autoPage2 = false; sm.go(S.CLOSING);
  }
}

// ───────────────────────────── Page 2 ─────────────────────────────
// Android back button / iOS edge swipe while Page 2 is up → back to the 3D card (not out of the
// invitation, which would close KakaoTalk's in-app browser). Page 2 owns one history entry.
let p2History = false;
addEventListener('popstate', () => {
  if (p2History && !history.state?.p2) { p2History = false; closePage2(); }
});

async function openPage2() {
  if (!sm.go(S.PAGE_TRANSITION_IN)) return;
  try { if (!history.state?.p2) { history.pushState({ p2: 1 }, '', location.href); p2History = true; } } catch {}
  tilt.damping = 0;
  await page2.show();
  sm.go(S.PAGE_02);
  page2.interactive = true;
  scene.stop();                     // scene stays mounted; rendering pauses under Page 2
}

async function closePage2() {
  if (!sm.go(S.PAGE_TRANSITION_OUT)) return;
  if (p2History) { p2History = false; try { history.back(); } catch {} }   // drop Page 2's entry
  if (glLost) return location.reload();
  scene.start();
  await page2.hide();
  tilt.damping = 1;
  sm.go(S.OPEN);                    // the card is still open, exactly as it was left
}

// ───────────────────────────── lifecycle ─────────────────────────────
// Phones drop the WebGL context under memory pressure (backgrounded tab, other apps). The browser
// restores it later, but GPU resources are gone → reload (deferred while Page 2 is being read).
let glLost = false;
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); glLost = true; console.warn('[invite] WebGL context lost'); });
canvas.addEventListener('webglcontextrestored', () => {
  if (!sm.is(S.PAGE_02, S.PAGE_TRANSITION_IN, S.PAGE_TRANSITION_OUT)) location.reload();
});

function observeResize() {
  const ro = new ResizeObserver(() => scene.resize());
  ro.observe(page1);
  window.visualViewport?.addEventListener('resize', () => scene.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scene.stop();
    else if (!sm.is(S.PAGE_02)) scene.start();
  });
  addEventListener('pagehide', () => { if (!sm.is(S.PAGE_02)) scene.stop(); });
}

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

function fatal(html, offerContent, detail = '') {
  const el = $('fatal');
  el.hidden = false;
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `<div>${html}<br/><button type="button" id="fatalRetry">다시 시도</button>${offerContent ? ' <button type="button" id="fatalGo">초대장 내용 보기</button>' : ''}`
    + (detail ? `<p style="margin-top:14px;font-size:10px;opacity:.55;word-break:break-all">${esc(detail)}</p>` : '') + '</div>';
  $('loader').style.opacity = '0';
  $('fatalRetry')?.addEventListener('click', () => location.reload());
  $('fatalGo')?.addEventListener('click', async () => { el.hidden = true; await page2.show(); page2.interactive = true; });
}
