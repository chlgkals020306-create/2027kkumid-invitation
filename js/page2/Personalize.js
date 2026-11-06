// Personalised To. / From. on the invitation card (Figma 200:238 → 204:9 / 204:10).
//
// SENDER  — opens the plain invitation link: the two lines on the card are editable inputs.
//           "초대장 링크 복사하기" creates a personal link (share sheet on phones, clipboard
//           elsewhere) and sends it with the invitation message. An unsent draft survives a
//           reload; once a link has been made, reloading clears To / From for the next person.
// RECIPIENT — opens a personal link: the names are printed on the card as plain text. There
//           are no inputs in the page at all, so nothing can be edited.
//
// The names travel in the link's hash (#i-…, never sent to a server): UTF-8 JSON as hex plus a
// checksum. A hand-edited link fails the check and shows the card without names. (A static
// site has no server, so this prevents casual editing — it is not cryptographic protection.)

import { toast } from './Page2.js';
import { CONFIG } from '../config.js';

const MAX = 12;
const SALT = 'raretaste-36-2026';
const DRAFT_KEY = 'rare-taste-invite-draft';

export class Personalize {
  constructor(root) {
    this.card = root.querySelector('#inviteCard');
    this.share = root.querySelector('#cardShare');
    this.fields = {
      to: this.card.querySelector('[data-name="to"]'),
      from: this.card.querySelector('[data-name="from"]'),
    };
    const token = readToken();
    if (token !== null) this.recipient(decode(token));
    else this.sender();
  }

  // ── recipient: names are text, inputs are removed from the DOM ──
  recipient(data) {
    this.mode = 'recipient';
    document.documentElement.dataset.invite = 'recipient';
    for (const key of ['to', 'from']) {
      const box = this.fields[key];
      box.querySelector('input')?.remove();
      const span = box.querySelector('.card-name__text');
      span.textContent = data ? data[key] : '';
      span.hidden = false;
      fit(span, box);
    }
    this.share.remove();
    if (!data) console.warn('[invite] personal link could not be verified — names hidden');
  }

  // ── sender: editable lines + share button ──
  sender() {
    this.mode = 'sender';
    document.documentElement.dataset.invite = 'sender';
    const draft = loadDraft();
    for (const key of ['to', 'from']) {
      const box = this.fields[key];
      const input = box.querySelector('input');
      box.querySelector('.card-name__text').hidden = true;
      input.maxLength = MAX;
      input.value = draft[key] || '';
      input.addEventListener('input', () => { this.onInput(); fit(input, box); });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); (key === 'to' ? this.fields.from.querySelector('input') : input).focus(); if (key === 'from') input.blur(); }
      });
      fit(input, box);
    }
    this.share.hidden = false;
    this.button = this.share.querySelector('#shareLink');
    this.button.addEventListener('click', () => this.shareLink());
    this.onInput();
    // re-fit once the web font is ready (metrics change)
    document.fonts?.ready.then(() => { for (const k of ['to', 'from']) fit(this.fields[k].querySelector('input'), this.fields[k]); });
  }

  values() {
    const v = k => clean(this.fields[k].querySelector('input')?.value || '');
    return { to: v('to'), from: v('from') };
  }

  onInput() {
    const v = this.values();
    saveDraft(v);
    this.button.disabled = !(v.to || v.from);
  }

  link() {
    const v = this.values();
    const url = new URL(location.href);
    url.search = ''; url.hash = 'i-' + encode(v);
    return url.toString();
  }

  async shareLink() {
    const v = this.values();
    if (!v.to && !v.from) { toast('이름을 먼저 입력해 주세요'); return; }
    const text = shareText(this.link());
    // A link has been made for this person: forget the draft, so reloading the page gives a blank
    // card for the next recipient (the names stay on screen until then).
    clearDraft();
    // Phones (iOS Safari, Android Chrome / Samsung Internet): native share sheet. The message
    // already ends with the link, and it is passed as ONE text — KakaoTalk then sends a single
    // message with the link preview under it (a separate url field makes some apps drop the text
    // or send two messages).
    if (navigator.share && matchMedia('(pointer: coarse)').matches && (!navigator.canShare || navigator.canShare({ text }))) {
      try { await navigator.share({ text }); return; }
      catch (e) { if (e?.name === 'AbortError') return; /* not allowed here → copy instead */ }
    }
    // In-app browsers (KakaoTalk, Instagram…) and computers: copy message + link.
    if (await copyText(text)) toast('초대 문구와 링크가 복사되었어요. 카카오톡에 붙여넣어 보내 주세요');
    else this.showText(text);
  }

  /** Last resort when neither share nor clipboard is allowed: show the text to copy by hand. */
  showText(text) {
    let out = this.share.querySelector('.card-share__link');
    if (!out) {
      out = Object.assign(document.createElement('textarea'), { readOnly: true, className: 'card-share__link', rows: 7 });
      out.setAttribute('aria-label', '초대 문구와 링크');
      this.share.append(out);
    }
    out.value = text; out.focus({ preventScroll: true }); out.select(); out.setSelectionRange?.(0, text.length);
    out.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast('아래 내용을 길게 눌러 복사해 주세요');
  }
}

/** Message from config + a blank line + the personal invitation link. */
export function shareText(url) { return `${CONFIG.share.message}\n\n${url}`; }

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* WebViews without clipboard permission → execCommand below */ }
  // Works in Android WebViews and older iOS: a readonly textarea (no keyboard, 16px → no zoom).
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;';
  document.body.append(ta);
  ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  getSelection()?.removeAllRanges();
  return ok;
}

// ── token: hex(UTF-8 JSON) + 8-hex checksum ──
function encode({ to, from }) {
  const bytes = new TextEncoder().encode(JSON.stringify({ t: to, f: from }));
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex + checksum(bytes);
}

function decode(token) {
  try {
    if (!/^[0-9a-f]+$/.test(token) || token.length < 10 || token.length % 2) return null;
    const hex = token.slice(0, -8), sum = token.slice(-8);
    const bytes = new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
    if (checksum(bytes) !== sum) return null;
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return { to: clean(String(o.t || '')), from: clean(String(o.f || '')) };
  } catch { return null; }
}

function checksum(bytes) {
  let h = 0x811c9dc5;                                  // FNV-1a 32-bit over salt + payload
  for (const b of [...new TextEncoder().encode(SALT), ...bytes]) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function readToken() {
  const h = /^#i-([0-9a-fA-F]+)$/.exec(location.hash);
  if (h) return h[1].toLowerCase();
  const q = new URLSearchParams(location.search).get('i');
  return q ? q.toLowerCase() : null;
}

function clean(s) { return s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX); }

function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; } }
function saveDraft(v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch {} }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }

/** Shrinks the text (down to 60 %) if a long name would run past the end of the line. */
function fit(el, box) {
  if (!el) return;
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  const text = el.value ?? el.textContent;
  if (!text) return;
  const ctx = (fit.c ||= document.createElement('canvas').getContext('2d'));
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontWeight} ${base}px ${cs.fontFamily}`;
  const w = ctx.measureText(text).width, avail = box.clientWidth - 2;
  if (w > avail) el.style.fontSize = `${Math.max(base * 0.6, base * avail / w).toFixed(2)}px`;
}
