// Small DOM toolkit: hyperscript, icons, toasts, sheets, dialogs, coach marks, formatting.
import { audio, haptic } from './audio.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// el('div.card.row', {onclick}, [children...])
export function el(spec, attrs = {}, children = []) {
  if (Array.isArray(attrs) || typeof attrs === 'string' || attrs instanceof Node) { children = attrs; attrs = {}; }
  const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const tag = (m && m[1]) || 'div';
  const node = document.createElement(tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') node.classList.add(part.slice(1)); else node.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'class') node.className += ' ' + v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}
function append(node, children) {
  if (children == null || children === false) return;
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else if (c instanceof Node) node.appendChild(c);
    else if (typeof c === 'string' && c.trim().startsWith('<svg')) node.insertAdjacentHTML('beforeend', c);
    else node.appendChild(document.createTextNode(String(c)));
  }
}

// ---------- icons (24x24 stroke) ----------
const P = {
  dna: '<path d="M7 3c0 6 10 6 10 12s-10 6-10 6"/><path d="M17 3c0 6-10 6-10 12s10 6 10 6" opacity=".55"/><path d="M8.5 6h7M9.5 9h5M9.5 15h5M8.5 18h7"/>',
  bloom: '<circle cx="12" cy="12" r="2.6"/><path d="M12 9.4C10 6 10.6 3.4 12 3c1.4.4 2 3 0 6.4zM14.6 12c3.4-2 6-1.4 6.4 0-.4 1.4-3 2-6.4 0zM12 14.6c2 3.4 1.4 6 0 6.4-1.4-.4-2-3 0-6.4zM9.4 12C6 14 3.4 13.4 3 12c.4-1.4 3-2 6.4 0z"/>',
  o2: '<circle cx="9" cy="11" r="5.5"/><path d="M16.5 15.5h3l-3 3.5h3"/><circle cx="17" cy="6" r="2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  fast: '<path d="M4 6v12l8-6zM12 6v12l8-6z"/>',
  plant: '<path d="M12 21v-9"/><path d="M12 12C12 7 8 4 4 4c0 4 3 8 8 8zM12 14c0-4 3-7 8-7 0 4-3 7-8 7z"/>',
  paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="11" cy="5.8" r="1.8"/><circle cx="15.5" cy="6.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/><path d="M8.5 17.5c0-3 2.2-5.5 4.3-5.5s4.2 2.5 4.2 5c0 2.2-1.7 2.8-4.2 2.3-2.4.6-4.3.4-4.3-1.8z"/>',
  cloud: '<path d="M7 16a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 8.5 3.8 3.8 0 0 1 17 16z"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M7 15l4-5 3 3 5-7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  microbe: '<circle cx="12" cy="12" r="6"/><circle cx="10" cy="11" r="1.6"/><circle cx="14" cy="14" r=".8"/><path d="M12 6V3M18 12h3M12 18v3M6 12H3M16.2 7.8l2-2M7.8 16.2l-2 2"/>',
  sound: '<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.2 4.2 0 0 1 12 7.2 4.2 4.2 0 0 1 19.5 10C19.5 15.5 12 20 12 20z"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/>',
  drop: '<path d="M12 3.5C9 8 6.5 10.8 6.5 14a5.5 5.5 0 0 0 11 0c0-3.2-2.5-6-5.5-10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  sprout: '<path d="M12 21v-7"/><path d="M12 14c-4 0-6-3-6-6 3 0 6 2 6 6zM12 12c0-4 2.5-6.5 6.5-6.5 0 4-2.5 6.5-6.5 6.5z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  hand: '<path d="M9 11V5a1.5 1.5 0 0 1 3 0v5M12 10V3.5a1.5 1.5 0 0 1 3 0V10M15 10V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 14.5a1.6 1.6 0 0 1 2.6-1.9L9 15"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/>',
  swords: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 14.5L3 21M14.5 9.5L21 3h-3l-6.5 6.5"/>',
  meteor: '<circle cx="8" cy="16" r="4.5"/><path d="M11.5 12.5L20 4M13.5 15l6-6M9 10.5l6-6"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  wave: '<path d="M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1"/><path d="M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1" opacity=".5"/>',
  tree: '<path d="M12 22v-5"/><path d="M12 2l-6 8h3l-4 6h14l-4-6h3z"/>',
  bug: '<ellipse cx="12" cy="14" rx="5" ry="6.5"/><path d="M12 7.5v13M9 4.5l1.5 2M15 4.5l-1.5 2M7 11H3.5M7 15.5H4M17 11h3.5M17 15.5h3"/>',
  fish: '<path d="M3 12c3-5 9-6 13-3l5-3v12l-5-3c-4 3-10 2-13-3z"/><circle cx="8" cy="11" r=".8"/>',
  bird: '<path d="M3 9c3 0 5 1.5 6.5 4L12 9l2.5 4C16 10.5 18 9 21 9c-2 3-4.5 5.5-9 7-4.5-1.5-7-4-9-7z"/>',
  moth: '<path d="M12 8v11"/><path d="M12 10C9 5 4 5 3.5 8.5 3 12 8 13 12 12M12 10c3-5 8-5 8.5-1.5.5 3.5-4.5 4.5-8.5 3.5M12 13c-3 1-6 3-5 5.5 1 2 4-1 5-3.5M12 13c3 1 6 3 5 5.5-1 2-4-1-5-3.5M10.5 5L12 7.5 13.5 5"/>',
  cat: '<path d="M5 20c0-6 2-10 7-10s7 4 7 10M5 4l2 5M19 4l-2 5M7 9c1-1 3-2 5-2s4 1 5 2"/><circle cx="10" cy="13" r=".6"/><circle cx="14" cy="13" r=".6"/>',
  mushroom: '<path d="M3.5 12C3.5 7 7.3 4 12 4s8.5 3 8.5 8z"/><path d="M9.5 12v6.5a2.5 2.5 0 0 0 5 0V12"/><circle cx="9" cy="8" r=".8"/><circle cx="14.5" cy="7.5" r=".8"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.info}</svg>`;
}
export function iconEl(name, cls = '') {
  const t = document.createElement('template'); t.innerHTML = icon(name, cls); return t.content.firstChild;
}

// ---------- formatting ----------
export function fmt(n, digits = 0) {
  if (n == null || isNaN(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  if (digits > 0 && a < 100) return n.toFixed(digits).replace(/\.?0+$/, '');
  return Math.floor(n).toLocaleString('en-US');
}
export const pct = (v, d = 0) => (v * 100).toFixed(d) + '%';
export function duration(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

// ---------- toasts ----------
let toastHost = null;
export function toast(text, { icon: ic = null, kind = '', ms = 2600, sound = null } = {}) {
  if (!toastHost) { toastHost = el('div.toasts'); document.getElementById('app').appendChild(toastHost); }
  if (toastHost.parentNode !== document.getElementById('app')) document.getElementById('app').appendChild(toastHost);
  const t = el('div.toast', { class: kind }, [ic ? icon(ic) : null, el('span', { html: text })]);
  toastHost.appendChild(t);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  if (sound) audio.sfx(sound);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  return t;
}

// ---------- sheets & dialogs ----------
const openStack = [];
export function anyModalOpen() { return openStack.length > 0; }

export function sheet({ title, iconName, body, foot, onClose, cls = '' }) {
  const host = document.getElementById('app');
  const closeBtn = el('button.icon-btn', { 'aria-label': 'Close' }, icon('close'));
  const bodyEl = el('div.sheet-body', {}, body);
  const sh = el('div.sheet', { class: cls }, [
    el('div.grab'),
    el('div.sheet-head', {}, [iconName ? el('div.thumb', { style: { width: '40px', height: '40px', borderRadius: '12px' } }, icon(iconName)) : null, el('h2', {}, title), closeBtn]),
    bodyEl,
    foot ? el('div.sheet-foot', {}, foot) : null,
  ]);
  const bd = el('div.backdrop', {}, sh);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    const i = openStack.indexOf(close); if (i >= 0) openStack.splice(i, 1);
    bd.classList.add('closing');
    setTimeout(() => bd.remove(), 180);
    onClose && onClose();
  };
  closeBtn.addEventListener('click', () => { audio.sfx('click'); close(); });
  bd.addEventListener('pointerdown', (e) => { if (e.target === bd) { audio.sfx('click'); close(); } });
  // swipe down on grab/head to close
  let sy = null;
  sh.querySelector('.sheet-head').addEventListener('pointerdown', (e) => { sy = e.clientY; });
  sh.querySelector('.grab').addEventListener('pointerdown', (e) => { sy = e.clientY; });
  window.addEventListener('pointerup', function up(e) { if (sy != null && e.clientY - sy > 60) close(); sy = null; if (closed) window.removeEventListener('pointerup', up); });
  host.appendChild(bd);
  openStack.push(close);
  return { close, body: bodyEl, el: sh, setBody(nodes) { bodyEl.innerHTML = ''; append(bodyEl, nodes); } };
}

export function dialog({ title, text, body, buttons = [{ label: 'OK', cls: 'btn-primary' }], dismissable = true, onClose }) {
  const host = document.getElementById('app');
  let closed = false;
  const close = (val) => {
    if (closed) return; closed = true;
    const i = openStack.indexOf(close); if (i >= 0) openStack.splice(i, 1);
    bd.classList.add('closing'); setTimeout(() => bd.remove(), 180);
    onClose && onClose(val);
  };
  const btns = buttons.map((b) => el('button.btn', { class: (b.cls || '') + ' btn-block', onclick: () => { audio.sfx('click'); haptic(8); if (b.onClick && b.onClick() === false) return; close(b.value ?? b.label); } }, [b.icon ? icon(b.icon) : null, b.label]));
  const dl = el('div.dialog', {}, [
    title ? el('h2', { style: { marginBottom: '8px' } }, title) : null,
    text ? el('p.dim', { style: { margin: '0 0 16px' }, html: text }) : null,
    body || null,
    el('div.stack-8', { style: { marginTop: '16px' } }, btns),
  ]);
  const bd = el('div.backdrop.center', {}, dl);
  if (dismissable) bd.addEventListener('pointerdown', (e) => { if (e.target === bd) close(null); });
  host.appendChild(bd);
  openStack.push(close);
  return { close, el: dl };
}

export function confirm(title, text, okLabel = 'Confirm', cls = 'btn-primary') {
  return new Promise((res) => {
    dialog({ title, text, buttons: [{ label: okLabel, cls, value: true }, { label: 'Cancel', cls: 'btn-ghost', value: false }], onClose: (v) => res(v === true) });
  });
}

export function closeTopModal() { const c = openStack[openStack.length - 1]; if (c) { c(); return true; } return false; }

// ---------- coach marks ----------
let coachEls = [], coachTimer = null;
export function clearCoach() { coachEls.forEach((e) => e.remove()); coachEls = []; if (coachTimer) { clearInterval(coachTimer); coachTimer = null; } }
export function coach(target, text, { onOk = null, okLabel = null, place = 'auto' } = {}) {
  clearCoach();
  const host = document.getElementById('app');
  const r = target.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  const ring = el('div.ring-pulse', { style: { left: r.left - hr.left - 4 + 'px', top: r.top - hr.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' } });
  const box = el('div.coach', {}, [el('div', { html: text }), okLabel ? el('span.coach-ok', {}, okLabel) : null]);
  host.appendChild(ring); host.appendChild(box);
  const bw = Math.min(260, hr.width - 24);
  box.style.maxWidth = bw + 'px';
  const bh = box.offsetHeight;
  const below = place === 'below' || (place === 'auto' && r.top - hr.top < bh + 30);
  let left = r.left - hr.left + r.width / 2 - box.offsetWidth / 2;
  left = Math.max(12, Math.min(hr.width - box.offsetWidth - 12, left));
  box.style.left = left + 'px';
  if (below) { box.classList.add('up'); box.style.top = r.bottom - hr.top + 14 + 'px'; }
  else { box.classList.add('down'); box.style.top = r.top - hr.top - bh - 14 + 'px'; }
  box.style.setProperty('--ax', (r.left - hr.left + r.width / 2 - left) + 'px');
  if (onOk) box.addEventListener('click', () => { clearCoach(); onOk(); });
  coachEls = [ring, box];
  // keep the ring and bubble glued to the target if the layout shifts (e.g. a new dock button appears)
  coachTimer = setInterval(() => {
    if (!target.isConnected || target.offsetParent === null) { clearCoach(); return; }
    const r2 = target.getBoundingClientRect(), h2 = host.getBoundingClientRect();
    ring.style.left = r2.left - h2.left - 4 + 'px'; ring.style.top = r2.top - h2.top - 4 + 'px';
    ring.style.width = r2.width + 8 + 'px'; ring.style.height = r2.height + 8 + 'px';
    let l2 = r2.left - h2.left + r2.width / 2 - box.offsetWidth / 2;
    l2 = Math.max(12, Math.min(h2.width - box.offsetWidth - 12, l2));
    box.style.left = l2 + 'px';
    box.style.top = (below ? r2.bottom - h2.top + 14 : r2.top - h2.top - box.offsetHeight - 14) + 'px';
    box.style.setProperty('--ax', (r2.left - h2.left + r2.width / 2 - l2) + 'px');
  }, 400);
  return { remove: clearCoach };
}

export function pulse(elm) { if (!elm) return; elm.classList.remove('pulse'); void elm.offsetWidth; elm.classList.add('pulse'); }
