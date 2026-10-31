// Microbe mode — rendering primitives: cached glow sprites, soft-body cells, species art, portraits.
import { COLORS } from './data.js';

const TAU = Math.PI * 2;
const { sin, cos, max, min, abs, exp, sqrt, PI } = Math;

export const rgbStr = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
const strCache = new Map();
export function cstr(c) {
  const k = (c[0] << 16) | (c[1] << 8) | c[2];
  let s = strCache.get(k);
  if (!s) { s = rgbStr(c); strCache.set(k, s); }
  return s;
}
export const mixRGB = (a, b, t, out = [0, 0, 0]) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// ---------- glow sprites ----------
const glowCache = new Map();
// soft radial glow, colour c; sprite is 64px, the glow reaches the sprite edge.
export function glowSprite(c, hard = 0) {
  const key = c[0] + ',' + c[1] + ',' + c[2] + ',' + hard;
  let s = glowCache.get(key);
  if (s) return s;
  const S = 64; s = mkCanvas(S, S); const g = s.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  if (hard) {
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, rgbStr(c, 0.95));
    gr.addColorStop(0.45, rgbStr(c, 0.35));
    gr.addColorStop(1, rgbStr(c, 0));
  } else {
    gr.addColorStop(0, rgbStr(c, 0.9));
    gr.addColorStop(0.25, rgbStr(c, 0.45));
    gr.addColorStop(0.6, rgbStr(c, 0.12));
    gr.addColorStop(1, rgbStr(c, 0));
  }
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  glowCache.set(key, s);
  return s;
}
export const WHITE = [255, 255, 255];

// ---------- gradients (unit space, cached per context) ----------
const gradCache = new WeakMap();
function grads(ctx) { let m = gradCache.get(ctx); if (!m) { m = new Map(); gradCache.set(ctx, m); } return m; }
export function bodyGrad(ctx, c, alpha = 1) {
  const m = grads(ctx); const key = 'b' + c.join(',') + alpha;
  let g = m.get(key);
  if (!g) {
    g = ctx.createRadialGradient(-0.25, -0.2, 0.05, 0, 0, 1.02);
    g.addColorStop(0, rgbStr(c, 0.22 * alpha));
    g.addColorStop(0.55, rgbStr(c, 0.36 * alpha));
    g.addColorStop(0.86, rgbStr(c, 0.62 * alpha));
    g.addColorStop(1, rgbStr(c, 0.9 * alpha));
    m.set(key, g);
  }
  return g;
}
function nucGrad(ctx, c) {
  const m = grads(ctx); const key = 'n' + c.join(',');
  let g = m.get(key);
  if (!g) {
    g = ctx.createRadialGradient(-0.08, -0.08, 0, 0, 0, 1);
    g.addColorStop(0, rgbStr([min(255, c[0] + 90), min(255, c[1] + 90), min(255, c[2] + 90)], 0.95));
    g.addColorStop(0.7, rgbStr(c, 0.85));
    g.addColorStop(1, rgbStr([c[0] * 0.6, c[1] * 0.6, c[2] * 0.6], 0.9));
    m.set(key, g);
  }
  return g;
}
function glassGrad(ctx, c) {
  const m = grads(ctx); const key = 'g' + c.join(',');
  let g = m.get(key);
  if (!g) {
    g = ctx.createLinearGradient(-1, -1, 1, 1);
    g.addColorStop(0, rgbStr([255, 255, 245], 0.55));
    g.addColorStop(0.35, rgbStr(c, 0.4));
    g.addColorStop(0.7, rgbStr(c, 0.62));
    g.addColorStop(1, rgbStr([c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], 0.8));
    m.set(key, g);
  }
  return g;
}

// ---------- soft-body outline ----------
const PX = new Float32Array(72), PY = new Float32Array(72), PR = new Float32Array(72);
// Builds the blob path in unit space. Returns nothing; PX/PY/PR hold the outline points.
// o: { n, t, seed, amp, stretch, lobes, lobeAmp, dentA, dent, squashY }
export function blobPath(ctx, o) {
  const n = o.n || 22, t = o.t, sd = o.seed || 0, amp = o.amp ?? 0.05;
  const st = o.stretch || 0, lobes = o.lobes || 0, la = o.lobeAmp || 0, dent = o.dent || 0, da = o.dentA || 0;
  const sx = 1 + st, sy = 1 - st * 0.55;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    let r = 1 + amp * (0.55 * sin(3 * th + t * 1.7 + sd) + 0.32 * sin(5 * th - t * 2.3 + sd * 1.7) + 0.18 * sin(8 * th + t * 3.3 + sd * 2.9));
    if (la) { const s = sin(lobes * th + t * 0.7 + sd * 3.1); r += la * (s > 0 ? s * s : s * 0.15); }
    if (dent) { let d = th - da; d = Math.atan2(sin(d), cos(d)); r -= dent * exp(-d * d * 5); }
    PR[i] = r; PX[i] = cos(th) * r * sx; PY[i] = sin(th) * r * sy;
  }
  ctx.beginPath();
  let mx = (PX[n - 1] + PX[0]) / 2, my = (PY[n - 1] + PY[0]) / 2;
  ctx.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.quadraticCurveTo(PX[i], PY[i], (PX[i] + PX[j]) / 2, (PY[i] + PY[j]) / 2);
  }
  ctx.closePath();
  return n;
}
// outline point at angle (approx, from last blob build)
export function blobPoint(n, th, out) {
  let i = ((th / TAU) * n) % n; if (i < 0) i += n;
  const i0 = i | 0, i1 = (i0 + 1) % n, f = i - i0;
  out[0] = PX[i0] + (PX[i1] - PX[i0]) * f; out[1] = PY[i0] + (PY[i1] - PY[i0]) * f;
  return out;
}

function dots(ctx, count, seed, t, rMin, rMax, size, spin = 0.25) {
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const a = seed * 2.39 + i * 2.399 + t * spin * (i % 2 ? 1 : -0.7);
    const d = rMin + (rMax - rMin) * (((i * 0.618 + seed) % 1 + 1) % 1);
    const s = size * (0.7 + 0.5 * (((i * 0.37 + seed * 0.5) % 1 + 1) % 1));
    const x = cos(a) * d, y = sin(a) * d;
    ctx.moveTo(x + s, y); ctx.arc(x, y, s, 0, TAU);
  }
}

function nucleus(ctx, c, x, y, r, t, seed) {
  ctx.save(); ctx.translate(x, y); ctx.scale(r, r * 0.92);
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU);
  ctx.fillStyle = nucGrad(ctx, c); ctx.fill();
  ctx.beginPath(); ctx.arc(0.22 + 0.06 * sin(t + seed), -0.1, 0.32, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  ctx.restore();
}

function highlight(ctx, ang) {
  // world-fixed specular highlight (upper-left), drawn in rotated unit space
  const lx = -0.38, ly = -0.42;
  const ca = cos(-ang), sa = sin(-ang);
  const x = lx * ca - ly * sa, y = lx * sa + ly * ca;
  ctx.globalAlpha *= 0.55;
  ctx.drawImage(glowSprite(WHITE), x - 0.45, y - 0.45, 0.9, 0.9);
  ctx.globalAlpha /= 0.55;
}

// ---------- cell feature helpers ----------
function flagellum(ctx, t, len, width, c, phase = 0, freq = 9, startX = -0.95) {
  ctx.beginPath(); ctx.moveTo(startX, 0);
  const segs = 14;
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    const x = startX - u * len;
    const y = sin(u * 5.2 - t * freq + phase) * 0.22 * len * u;
    ctx.lineTo(x, y);
  }
  ctx.strokeStyle = c; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
}
function ciliaFringe(ctx, n, t, len, lw, c, sx = 1, sy = 1, speed = 10) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    const w = sin(th * 6 - t * speed) * 0.35;
    const cx = cos(th) * sx, cy = sin(th) * sy;
    const nx = cos(th + w * 0.6), ny = sin(th + w * 0.6);
    ctx.moveTo(cx * 0.98, cy * 0.98); ctx.lineTo(cx + nx * len, cy + ny * len);
  }
  ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
}
function spikeRing(ctx, n, len, base, t, c, rot = 0, sx = 1, sy = 1) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU + rot;
    const l = len * (0.85 + 0.15 * sin(t * 3 + i * 1.7));
    const x0 = cos(th - base) * sx * 0.95, y0 = sin(th - base) * sy * 0.95;
    const x1 = cos(th + base) * sx * 0.95, y1 = sin(th + base) * sy * 0.95;
    const xt = cos(th) * (sx + l), yt = sin(th) * (sy + l);
    ctx.moveTo(x0, y0); ctx.lineTo(xt, yt); ctx.lineTo(x1, y1);
  }
  ctx.fillStyle = c; ctx.fill();
}

// ---------- species art ----------
// All drawn in unit space (cell radius = 1), facing +x. `s` = device px per unit (for LOD / line widths).
// e: entity-like { kind, seed, t (age), ang, flash, stretch, dentA, dent, ... }
export function drawSpecies(ctx, e, T, s, opts = {}) {
  const kind = e.kind;
  const col = COLORS[kind] || COLORS.grazer;
  const t = T + e.seed * 10;
  const lw = (px) => px / s;
  const lod = s < 9;
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'drifter': {
      const bend = sin(t * 3) * 0.08;
      flagellum(ctx, t, 1.4, lw(1.4), cstr(col.mem), 0, 12, -1.1);
      ctx.beginPath();
      ctx.moveTo(-0.75, -0.55 + bend);
      ctx.lineTo(0.75, -0.55 - bend);
      ctx.arc(0.75, -bend, 0.55, -PI / 2, PI / 2);
      ctx.lineTo(-0.75, 0.55 + bend);
      ctx.arc(-0.75, bend, 0.55, PI / 2, PI * 1.5);
      ctx.closePath();
      ctx.save(); ctx.scale(1, 1); ctx.fillStyle = bodyGrad(ctx, col.body); ctx.fill(); ctx.restore();
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(1.5); ctx.stroke();
      if (!lod) { ctx.beginPath(); ctx.arc(-0.2, 0, 0.18, 0, TAU); ctx.arc(0.35, 0.05, 0.12, 0, TAU); ctx.fillStyle = cstr(col.nuc); ctx.fill(); }
      break;
    }
    case 'grazer': case 'clone': {
      blobPath(ctx, { n: lod ? 12 : 20, t, seed: e.seed, amp: 0.06, stretch: e.stretch || 0, dentA: e.dentA, dent: e.dent });
      ctx.fillStyle = bodyGrad(ctx, col.body); ctx.fill();
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(1.6); ctx.stroke();
      if (!lod) {
        dots(ctx, 5, e.seed, t, 0.35, 0.68, 0.08); ctx.fillStyle = rgbStr(col.mem, 0.55); ctx.fill();
        nucleus(ctx, col.nuc, -0.12, 0.05, 0.33, t, e.seed);
      }
      break;
    }
    case 'diatom': {
      const armor = e.armor ?? 2;
      if (armor <= 0) {
        // soft cell exposed + shell fragments
        blobPath(ctx, { n: 18, t, seed: e.seed, amp: 0.09, dentA: e.dentA, dent: e.dent });
        ctx.fillStyle = bodyGrad(ctx, [230, 170, 90]); ctx.fill();
        ctx.strokeStyle = 'rgba(255,230,180,0.9)'; ctx.lineWidth = lw(1.5); ctx.stroke();
        dots(ctx, 6, e.seed, t, 0.25, 0.65, 0.1, 0.4); ctx.fillStyle = 'rgba(160,110,40,0.7)'; ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = e.seed * 3 + i * 2.1 + t * 0.3;
          ctx.moveTo(cos(a) * 1.25, sin(a) * 1.25); ctx.arc(0, 0, 1.25, a, a + 0.55);
        }
        ctx.strokeStyle = 'rgba(255,245,220,0.55)'; ctx.lineWidth = lw(2); ctx.stroke();
        break;
      }
      const sides = 10, rot = t * 0.15;
      ctx.save(); ctx.rotate(rot);
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) { const a = (i / sides) * TAU; const r = 1 - (e.dent || 0) * 0.4 * exp(-((a - (e.dentA || 0)) ** 2)); i ? ctx.lineTo(cos(a) * r, sin(a) * r) : ctx.moveTo(cos(a) * r, sin(a) * r); }
      ctx.closePath();
      ctx.fillStyle = glassGrad(ctx, col.body); ctx.fill();
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(2); ctx.stroke();
      if (!lod) {
        ctx.beginPath();
        for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; ctx.moveTo(cos(a) * 0.38, sin(a) * 0.38); ctx.lineTo(cos(a) * 0.88, sin(a) * 0.88); }
        ctx.moveTo(0.38, 0); ctx.arc(0, 0, 0.38, 0, TAU);
        ctx.moveTo(0.64, 0); ctx.arc(0, 0, 0.64, 0, TAU);
        ctx.strokeStyle = 'rgba(255,250,230,0.38)'; ctx.lineWidth = lw(1); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, TAU); ctx.fillStyle = 'rgba(190,140,50,0.75)'; ctx.fill();
        // cracks
        if (armor < (e.armorMax || 2)) {
          ctx.beginPath();
          const cracks = (e.armorMax || 2) - armor;
          for (let k = 0; k < cracks * 2; k++) {
            let a = e.seed * 7 + k * 2.6, r = 0.15;
            ctx.moveTo(cos(a) * r, sin(a) * r);
            for (let j = 0; j < 4; j++) { r += 0.22; a += (j % 2 ? 0.35 : -0.3); ctx.lineTo(cos(a) * r, sin(a) * r); }
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = lw(1.6); ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }
    case 'hunter': {
      const chase = e.chasing ? 1 : 0;
      const st = 0.18 + (e.stretch || 0);
      spikeRing(ctx, 11, 0.42 + chase * 0.08, 0.13, t, rgbStr([255, 120, 130], 0.95), t * 0.2, 1 + st, 1 - st * 0.55);
      blobPath(ctx, { n: lod ? 12 : 20, t, seed: e.seed, amp: 0.05, stretch: st, dentA: e.dentA, dent: e.dent });
      ctx.fillStyle = bodyGrad(ctx, col.body); ctx.fill();
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(1.8); ctx.stroke();
      if (!lod) {
        dots(ctx, 6, e.seed, t, 0.3, 0.7, 0.07); ctx.fillStyle = 'rgba(255,200,200,0.5)'; ctx.fill();
        nucleus(ctx, col.nuc, -0.25, 0, 0.3, t, e.seed);
        // eyespot
        ctx.beginPath(); ctx.arc(0.55, 0, 0.16, 0, TAU); ctx.fillStyle = chase ? '#ffe28a' : '#ff9a6a'; ctx.fill();
        ctx.beginPath(); ctx.arc(0.6, 0, 0.07, 0, TAU); ctx.fillStyle = '#3a0010'; ctx.fill();
      }
      break;
    }
    case 'phage': {
      ctx.drawImage(phageSprite(opts.queenPhase ? 1 : 0), -2.6, -2.6, 5.2, 5.2);
      break;
    }
    case 'amoeba': case 'colossus': {
      const boss = kind === 'colossus';
      const tele = e.tele || 0;
      blobPath(ctx, { n: boss ? 40 : (lod ? 14 : 26), t: t * (boss ? 0.8 : 1), seed: e.seed, amp: 0.06 + tele * 0.05, stretch: (e.stretch || 0), lobes: boss ? 5 : 3, lobeAmp: boss ? 0.16 + tele * 0.12 : 0.24, dentA: e.dentA, dent: e.dent });
      ctx.fillStyle = bodyGrad(ctx, col.body); ctx.fill();
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(boss ? 3 : 2); ctx.stroke();
      if (boss) { ctx.save(); ctx.scale(0.9, 0.9); ctx.strokeStyle = rgbStr(col.mem, 0.25); ctx.lineWidth = lw(6); ctx.stroke(); ctx.restore(); }
      if (!lod) {
        dots(ctx, boss ? 26 : 12, e.seed, t, 0.25, 0.78, boss ? 0.035 : 0.055, 0.15); ctx.fillStyle = rgbStr(col.mem, 0.5); ctx.fill();
        dots(ctx, boss ? 8 : 3, e.seed + 3, t, 0.3, 0.7, boss ? 0.07 : 0.1, 0.1); ctx.fillStyle = 'rgba(255,240,220,0.18)'; ctx.fill();
        const pv = 0.13 + 0.05 * sin(t * 2.2);
        ctx.beginPath(); ctx.arc(0.35, -0.3, pv, 0, TAU); ctx.fillStyle = 'rgba(255,250,235,0.25)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,250,235,0.5)'; ctx.lineWidth = lw(1); ctx.stroke();
        nucleus(ctx, col.nuc, -0.1, 0.1, boss ? 0.22 : 0.26, t, e.seed);
      }
      break;
    }
    case 'ciliate': {
      const sx = 1.25, sy = 0.62;
      if (!lod) ciliaFringe(ctx, 34, t, 0.16, lw(1), rgbStr(col.mem, 0.7), sx, sy, 16);
      ctx.save(); ctx.scale(sx, sy);
      blobPath(ctx, { n: 18, t, seed: e.seed, amp: 0.035, dentA: e.dentA, dent: e.dent + 0.12, });
      ctx.restore();
      ctx.fillStyle = bodyGrad(ctx, col.body); ctx.fill();
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(1.5); ctx.stroke();
      if (!lod) {
        ctx.beginPath(); ctx.moveTo(0.9, -0.15); ctx.quadraticCurveTo(0.2, 0.05, -0.1, 0.35);
        ctx.strokeStyle = 'rgba(220,255,235,0.6)'; ctx.lineWidth = lw(1.4); ctx.stroke();
        dots(ctx, 6, e.seed, t, 0.15, 0.4, 0.06, 0.6); ctx.fillStyle = 'rgba(220,255,235,0.5)'; ctx.fill();
        ctx.save(); ctx.scale(1.6, 1); nucleus(ctx, col.nuc, -0.12, 0, 0.18, t, e.seed); ctx.restore();
      }
      break;
    }
    case 'rotifer': {
      const spin = t * 9;
      // foot
      ctx.beginPath(); ctx.moveTo(-0.85, 0); ctx.quadraticCurveTo(-1.35, 0.08 * sin(t * 2), -1.65, -0.18); ctx.moveTo(-1.35, 0.03); ctx.lineTo(-1.65, 0.2);
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(2.2); ctx.lineCap = 'round'; ctx.stroke();
      ctx.save(); ctx.scale(1.05, 0.72);
      blobPath(ctx, { n: 18, t, seed: e.seed, amp: 0.04, stretch: 0.15, dentA: e.dentA, dent: e.dent });
      ctx.restore();
      ctx.fillStyle = bodyGrad(ctx, col.body); ctx.fill();
      ctx.strokeStyle = cstr(col.mem); ctx.lineWidth = lw(1.6); ctx.stroke();
      // corona wheels
      for (const sgn of [-1, 1]) {
        const cx = 0.95, cy = sgn * 0.36;
        ctx.beginPath(); ctx.arc(cx, cy, 0.34, 0, TAU);
        ctx.fillStyle = 'rgba(255,235,190,0.28)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = lw(1.2); ctx.stroke();
        if (!lod) {
          ctx.beginPath();
          for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + spin * sgn; ctx.moveTo(cx + cos(a) * 0.34, cy + sin(a) * 0.34); ctx.lineTo(cx + cos(a + 0.4) * 0.5, cy + sin(a + 0.4) * 0.5); }
          ctx.strokeStyle = 'rgba(255,245,210,0.85)'; ctx.lineWidth = lw(1.2); ctx.stroke();
        }
      }
      if (!lod) {
        ctx.beginPath(); ctx.arc(0.3, 0, 0.17, 0, TAU); ctx.fillStyle = 'rgba(150,80,30,0.7)'; ctx.fill();
        dots(ctx, 5, e.seed, t, 0.2, 0.55, 0.07); ctx.fillStyle = 'rgba(255,230,180,0.45)'; ctx.fill();
      }
      break;
    }
    case 'volvox': {
      ctx.save(); ctx.rotate(t * 0.12);
      ctx.beginPath(); ctx.arc(0, 0, 1 - (e.dent || 0) * 0.1, 0, TAU);
      ctx.fillStyle = bodyGrad(ctx, col.body, 0.85); ctx.fill();
      ctx.strokeStyle = rgbStr(col.mem, 0.55); ctx.lineWidth = lw(1.2); ctx.stroke();
      if (!lod) {
        const n = 36; ctx.beginPath();
        for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const x = cos(a) * 0.93, y = sin(a) * 0.93; ctx.moveTo(x + 0.035, y); ctx.arc(x, y, 0.035, 0, TAU); }
        ctx.fillStyle = 'rgba(200,255,190,0.85)'; ctx.fill();
        const kids = e.kids || 5;
        for (let i = 0; i < kids; i++) {
          const a = i * 2.4 + e.seed, d = 0.48 + 0.12 * sin(i * 1.3);
          const x = cos(a) * d, y = sin(a) * d, r = 0.2 + 0.04 * (i % 3);
          ctx.save(); ctx.translate(x, y); ctx.scale(r, r);
          ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU);
          ctx.fillStyle = nucGrad(ctx, [40, 150, 60]); ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
      break;
    }
    case 'queen': {
      drawQueen(ctx, e, t, s, lw);
      break;
    }
    case 'siphonbell': {
      // a single bell (used by portraits and segments)
      ctx.beginPath();
      ctx.moveTo(-0.9, -0.75); ctx.quadraticCurveTo(0.2, -1.2, 1.0, -0.2); ctx.quadraticCurveTo(1.15, 0, 1.0, 0.2);
      ctx.quadraticCurveTo(0.2, 1.2, -0.9, 0.75); ctx.quadraticCurveTo(-0.55, 0, -0.9, -0.75);
      ctx.fillStyle = bodyGrad(ctx, COLORS.siphonophore.body, 0.9); ctx.fill();
      ctx.strokeStyle = cstr(COLORS.siphonophore.mem); ctx.lineWidth = lw(1.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.5, -0.4); ctx.quadraticCurveTo(0.3, -0.5, 0.65, 0); ctx.quadraticCurveTo(0.3, 0.5, -0.5, 0.4);
      ctx.strokeStyle = 'rgba(255,220,250,0.45)'; ctx.lineWidth = lw(1); ctx.stroke();
      break;
    }
  }
  if (!lod && kind !== 'phage' && kind !== 'queen') highlight(ctx, e.ang || 0);
}

function drawQueen(ctx, e, t, s, lw) {
  const ph2 = e.phase === 2;
  const tint = ph2 ? [255, 110, 170] : [150, 185, 255];
  const tele = e.tele || 0;
  // tail sheath + legs (behind, opposite of facing)
  ctx.save();
  ctx.beginPath(); ctx.rect(-2.2, -0.16, 1.4, 0.32);
  ctx.fillStyle = rgbStr(tint, 0.35); ctx.fill(); ctx.strokeStyle = rgbStr([230, 240, 255], 0.6); ctx.lineWidth = lw(2); ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const x = -2.05 + i * 0.22; ctx.moveTo(x, -0.16); ctx.lineTo(x, 0.16); }
  ctx.strokeStyle = rgbStr([230, 240, 255], 0.35); ctx.lineWidth = lw(1); ctx.stroke();
  ctx.beginPath(); ctx.rect(-2.45, -0.42, 0.25, 0.84); ctx.fillStyle = rgbStr(tint, 0.5); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const sg = i < 3 ? -1 : 1, k = i % 3;
    const sw = sin(t * 2.5 + i) * 0.12;
    ctx.moveTo(-2.33, sg * 0.4); ctx.lineTo(-2.0 + k * 0.25, sg * (1.0 + sw)); ctx.lineTo(-2.7 + k * 0.15, sg * (1.35 + sw));
  }
  ctx.strokeStyle = rgbStr([220, 230, 255], 0.75); ctx.lineWidth = lw(2.4); ctx.lineCap = 'round'; ctx.stroke();
  ctx.restore();
  // crystalline head: hexagon with triangular facets
  const rot = t * 0.25;
  const scale = 1 + tele * 0.08 + 0.02 * sin(t * 3);
  ctx.save(); ctx.scale(scale, scale);
  for (let i = 0; i < 6; i++) {
    const a0 = rot + (i / 6) * TAU, a1 = rot + ((i + 1) / 6) * TAU;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cos(a0), sin(a0)); ctx.lineTo(cos(a1), sin(a1)); ctx.closePath();
    const lit = 0.5 + 0.5 * cos(a0 + 0.5 - (-2.3));
    const c = mixRGB([40, 50, 120], tint, 0.35 + lit * 0.55);
    if (ph2) mixRGB(c, [255, 60, 120], 0.25, c);
    ctx.fillStyle = rgbStr(c, 0.82); ctx.fill();
  }
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = rot + (i / 6) * TAU; ctx.moveTo(0, 0); ctx.lineTo(cos(a), sin(a)); }
  for (let i = 0; i <= 6; i++) { const a = rot + (i / 6) * TAU; i ? ctx.lineTo(cos(a), sin(a)) : ctx.moveTo(cos(a), sin(a)); }
  ctx.strokeStyle = 'rgba(235,245,255,0.85)'; ctx.lineWidth = lw(2.4); ctx.stroke();
  // inner hexagon
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) { const a = -rot * 1.6 + (i / 6) * TAU + 0.52; const r = 0.5; i ? ctx.lineTo(cos(a) * r, sin(a) * r) : ctx.moveTo(cos(a) * r, sin(a) * r); }
  ctx.strokeStyle = rgbStr([255, 255, 255], 0.35); ctx.lineWidth = lw(1.5); ctx.stroke();
  // core (DNA coil)
  ctx.globalCompositeOperation = 'lighter';
  const g = glowSprite(ph2 ? [255, 90, 150] : [140, 170, 255]);
  const cs = 1.2 + tele * 0.6 + 0.08 * sin(t * 4);
  ctx.drawImage(g, -cs, -cs, cs * 2, cs * 2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) { const u = i / 20 * TAU * 1.5; const r = 0.08 + i * 0.012; i ? ctx.lineTo(cos(u + t) * r, sin(u + t) * r) : ctx.moveTo(cos(u + t) * r, sin(u + t) * r); }
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = lw(1.6); ctx.stroke();
  ctx.restore();
}

// phage sprite (pre-rendered)
const phageSprites = [];
function phageSprite(v) {
  if (phageSprites[v]) return phageSprites[v];
  const S = 96, c = mkCanvas(S, S), g = c.getContext('2d');
  const col = v ? [255, 120, 180] : COLORS.phage.body;
  g.translate(S / 2, S / 2); const u = S / 5.2; // 1 unit
  g.lineCap = 'round'; g.lineJoin = 'round';
  // glow
  g.drawImage(glowSprite(col), -u * 2.2, -u * 2.2, u * 4.4, u * 4.4);
  // tail & legs (pointing -x)
  g.strokeStyle = rgbStr([240, 225, 255], 0.9); g.lineWidth = u * 0.22;
  g.beginPath(); g.moveTo(-u * 0.7, 0); g.lineTo(-u * 1.7, 0); g.stroke();
  g.lineWidth = u * 0.13;
  g.beginPath();
  for (const sg of [-1, 1]) { g.moveTo(-u * 1.7, 0); g.lineTo(-u * 2.0, sg * u * 0.7); g.lineTo(-u * 2.45, sg * u * 0.95); g.moveTo(-u * 1.7, 0); g.lineTo(-u * 2.25, sg * u * 0.3); }
  g.stroke();
  // head: hexagon
  g.beginPath();
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU + PI / 6; const x = cos(a) * u, y = sin(a) * u; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  const gr = g.createLinearGradient(-u, -u, u, u);
  gr.addColorStop(0, rgbStr([255, 245, 255], 0.95)); gr.addColorStop(0.5, rgbStr(col, 0.9)); gr.addColorStop(1, rgbStr([col[0] * 0.5, col[1] * 0.4, col[2] * 0.6], 0.95));
  g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(255,240,255,0.95)'; g.lineWidth = u * 0.12; g.stroke();
  g.beginPath(); g.moveTo(0, 0);
  for (let i = 0; i < 6; i += 2) { const a = (i / 6) * TAU + PI / 6; g.moveTo(0, 0); g.lineTo(cos(a) * u, sin(a) * u); }
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = u * 0.07; g.stroke();
  phageSprites[v] = c;
  return c;
}

// ---------- the player cell ----------
// p: { r, ang, seed, muts:{id:lv}, flash, stretch, dent, dentA, cyst, inv, alpha, glowPulse }
export function drawPlayer(ctx, p, T, s) {
  const t = T;
  const m = p.muts;
  const col = COLORS.player;
  const lw = (px) => px / s;
  const body = p.bodyCol || col.body;
  const mem = p.memCol || col.mem;
  ctx.lineJoin = 'round';
  const st = p.stretch || 0;
  // flagellum(s)
  if (m.flagellum) {
    const L = 1.1 + 0.28 * m.flagellum;
    const fr = 9 + (p.speedN || 0) * 9;
    flagellum(ctx, t, L, lw(4.5), rgbStr(mem, 0.35), 0, fr, -0.92 - st * 0.5);
    flagellum(ctx, t, L, lw(2), rgbStr(mem, 0.95), 0, fr, -0.92 - st * 0.5);
    if (m.flagellum >= 3) {
      ctx.save(); ctx.rotate(0.35); flagellum(ctx, t + 0.4, L * 0.75, lw(1.6), rgbStr(mem, 0.8), 1.5, fr, -0.92); ctx.restore();
      ctx.save(); ctx.rotate(-0.35); flagellum(ctx, t + 0.8, L * 0.75, lw(1.6), rgbStr(mem, 0.8), 3, fr, -0.92); ctx.restore();
    }
  }
  if (m.spikes) spikeRing(ctx, 8 + m.spikes * 2, 0.22 + 0.07 * m.spikes, 0.12, t, rgbStr([230, 255, 250], 0.92), t * 0.1, 1 + st, 1 - st * 0.55);
  if (m.cilia) ciliaFringe(ctx, 24 + 6 * m.cilia, t, 0.12 + 0.03 * m.cilia, lw(1.3), rgbStr(mem, 0.75), 1 + st, 1 - st * 0.55, 14);
  // body
  const n = blobPath(ctx, { n: 30, t, seed: p.seed, amp: 0.045 + (p.wob || 0), stretch: st, lobes: m.pseudopod ? 3 : 0, lobeAmp: m.pseudopod ? 0.07 + 0.05 * m.pseudopod : 0, dentA: p.dentA, dent: p.dent });
  ctx.fillStyle = bodyGrad(ctx, body); ctx.fill();
  const memW = 1.8 + (m.membrane || 0) * 0.8;
  ctx.strokeStyle = cstr(mem); ctx.lineWidth = lw(memW); ctx.stroke();
  if (m.membrane) { ctx.save(); ctx.scale(0.88, 0.88); ctx.strokeStyle = rgbStr(mem, 0.3); ctx.lineWidth = lw(1.2 + m.membrane * 0.4); ctx.stroke(); ctx.restore(); }
  // vacuole
  if (m.vacuole) {
    const vr = 0.2 + 0.035 * m.vacuole + 0.02 * sin(t * 1.5);
    ctx.beginPath(); ctx.arc(0.3, 0.28, vr, 0, TAU);
    ctx.fillStyle = 'rgba(220,250,255,0.18)'; ctx.fill(); ctx.strokeStyle = 'rgba(230,255,255,0.55)'; ctx.lineWidth = lw(1.2); ctx.stroke();
  }
  // chloroplasts
  if (m.chloro) {
    const k = 3 + m.chloro * 2;
    for (let i = 0; i < k; i++) {
      const a = i * 2.399 + t * 0.25, d = 0.5 + 0.12 * sin(i * 1.7);
      ctx.save(); ctx.translate(cos(a) * d, sin(a) * d); ctx.rotate(a + 1.2);
      ctx.beginPath(); ctx.ellipse(0, 0, 0.13, 0.07, 0, 0, TAU);
      ctx.fillStyle = 'rgba(90,230,110,0.9)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-0.08, 0); ctx.lineTo(0.08, 0); ctx.strokeStyle = 'rgba(200,255,190,0.7)'; ctx.lineWidth = lw(0.8); ctx.stroke();
      ctx.restore();
    }
  }
  // mitochondria
  if (m.mito) {
    for (let i = 0; i < 1 + m.mito; i++) {
      const a = 1 + i * 2.1 - t * 0.2, d = 0.55;
      ctx.save(); ctx.translate(cos(a) * d, sin(a) * d); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(0, 0, 0.15, 0.075, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,150,90,0.9)'; ctx.fill();
      ctx.beginPath(); for (let j = -1; j <= 1; j++) { ctx.moveTo(j * 0.06, -0.05); ctx.lineTo(j * 0.06 + 0.02, 0.05); }
      ctx.strokeStyle = 'rgba(255,230,190,0.8)'; ctx.lineWidth = lw(0.8); ctx.stroke();
      ctx.restore();
    }
  }
  // toxin vesicles
  if (m.toxin || m.nova) {
    const k = 2 + (m.toxin || 0) + (m.nova || 0);
    dots(ctx, k, p.seed + 5, t, 0.3, 0.68, 0.075, 0.5);
    ctx.fillStyle = 'rgba(200,120,255,0.95)'; ctx.fill();
  }
  if (m.lysosome) { dots(ctx, 2 + m.lysosome * 2, p.seed + 9, t, 0.25, 0.6, 0.05, -0.4); ctx.fillStyle = 'rgba(255,110,120,0.9)'; ctx.fill(); }
  // generic organelles
  dots(ctx, 4, p.seed, t, 0.4, 0.66, 0.055); ctx.fillStyle = rgbStr(mem, 0.55); ctx.fill();
  nucleus(ctx, col.nuc, -0.15, -0.05, 0.3, t, p.seed);
  // bioluminescent spots
  if (m.biolum) {
    ctx.globalCompositeOperation = 'lighter';
    const g = glowSprite([150, 255, 230], 1);
    for (let i = 0; i < 3 + m.biolum; i++) {
      const a = i * 1.9 + p.seed, d = 0.72;
      const pulse = 0.5 + 0.5 * sin(t * 3 + i * 1.3);
      const sz = 0.22 + 0.1 * pulse;
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
      ctx.drawImage(g, cos(a) * d - sz, sin(a) * d - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  highlight(ctx, p.ang || 0);
  // cyst shell
  if (p.cyst > 0) {
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * TAU + t; const r = 1.18; i ? ctx.lineTo(cos(a) * r, sin(a) * r) : ctx.moveTo(cos(a) * r, sin(a) * r); }
    ctx.fillStyle = 'rgba(255,220,150,0.25)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,170,0.95)'; ctx.lineWidth = lw(3); ctx.stroke();
  }
  return n;
}

// ---------- background textures ----------
// Tileable Voronoi-edge caustic texture.
export function makeCausticTile(size = 256, seed = 7) {
  const c = mkCanvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const N = 14, pts = [];
  for (let i = 0; i < N; i++) pts.push([r() * size, r() * size]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let d1 = 1e9, d2 = 1e9;
    for (const p of pts) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const dx = x - (p[0] + ox * size), dy = y - (p[1] + oy * size);
      const dd = dx * dx + dy * dy;
      if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
    }
    const e = sqrt(d2) - sqrt(d1);
    const v = max(0, 1 - e / 9);
    const a = v * v * v;
    const i = (y * size + x) * 4;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Soft light shaft (vertical strip).
export function makeShaft() {
  const W = 64, H = 256, c = mkCanvas(W, H), g = c.getContext('2d');
  const gx = g.createLinearGradient(0, 0, W, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gx; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const gy = g.createLinearGradient(0, 0, 0, H);
  gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.3, 'rgba(0,0,0,1)'); gy.addColorStop(0.75, 'rgba(0,0,0,0.6)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gy; g.fillRect(0, 0, W, H);
  return c;
}

// ---------- portraits ----------
function portraitCanvas(size) {
  const k = 2, c = mkCanvas(size * k, size * k);
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const g = c.getContext('2d'); g.scale(k, k);
  return [c, g];
}

const FAKE_T = 1.3;
export function microbePortrait(id, size) {
  const [c, g] = portraitCanvas(size);
  const col = (COLORS[id] || COLORS.grazer);
  g.translate(size / 2, size / 2);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.55;
  g.drawImage(glowSprite(col.glow), -size * 0.5, -size * 0.5, size, size);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const e = { kind: id, seed: 0.37, ang: -0.5, armor: 2, armorMax: 2, kids: 5, phase: 1 };
  let R = size * 0.3, rot = -0.5;
  if (id === 'drifter') { R = size * 0.2; rot = -0.6; }
  if (id === 'phage') { R = size * 0.17; rot = -0.8; }
  if (id === 'ciliate') { R = size * 0.27; }
  if (id === 'rotifer') { R = size * 0.22; g.translate(size * 0.06, 0); }
  if (id === 'queen') { R = size * 0.21; rot = 0.6; g.translate(size * 0.12, -size * 0.06); }
  if (id === 'colossus' || id === 'volvox') R = size * 0.34;
  if (id === 'siphonophore') { drawSiphPortrait(g, size); return c; }
  g.rotate(rot); g.scale(R, R);
  e.ang = rot;
  const sd = R * 2;
  drawSpecies(g, e, FAKE_T, sd);
  if (id === 'colossus') {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; const sp = glowSprite([255, 240, 140], 1); g.drawImage(sp, cos(a) * 0.98 - 0.2, sin(a) * 0.98 - 0.2, 0.4, 0.4); }
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}
function drawSiphPortrait(g, size) {
  const R = size * 0.12;
  for (let i = 3; i >= 0; i--) {
    const x = -size * 0.27 + i * size * 0.18, y = -size * 0.2 + i * size * 0.06 + sin(i) * 3;
    // tentacle
    g.beginPath(); g.moveTo(x - R * 0.6, y + R * 0.3);
    for (let k = 1; k <= 10; k++) g.lineTo(x - R * 0.6 - k * 1.4 + sin(k * 0.9 + i) * 3, y + R * 0.3 + k * size * 0.05);
    g.strokeStyle = 'rgba(255,170,230,0.6)'; g.lineWidth = 1.2; g.stroke();
    g.save(); g.translate(x, y); g.rotate(0.3); g.scale(R, R);
    drawSpecies(g, { kind: 'siphonbell', seed: i, ang: 0 }, 1, R * 2);
    g.restore();
  }
}

// draws a "mini player" with a single mutation emphasised
export function mutationPortrait(id, size) {
  const [c, g] = portraitCanvas(size);
  g.translate(size / 2, size / 2);
  const R = size * 0.27;
  const glowC = { toxin: [190, 110, 255], nova: [200, 120, 255], chloro: [120, 255, 140], mito: [255, 160, 90], spikes: [220, 255, 250], lysosome: [255, 110, 130], biolum: [130, 255, 230], cyst: [255, 220, 150], mimicry: [140, 200, 255] }[id] || [110, 255, 225];
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5;
  g.drawImage(glowSprite(glowC), -size * 0.5, -size * 0.5, size, size);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const muts = {}; muts[id] = 3;
  const p = { r: 1, ang: -0.4, seed: 0.5, muts, cyst: id === 'cyst' ? 1 : 0 };
  const lw = 1 / R;
  g.save();
  if (id === 'flagellum') g.translate(size * 0.12, 0);
  if (id === 'mito') { muts.mito = 4; }
  if (id === 'membrane') muts.membrane = 5;
  if (id === 'mimicry') g.globalAlpha = 0.55;
  if (id === 'fission') {
    g.save(); g.translate(size * 0.15, size * 0.12); g.rotate(-0.4); g.scale(R * 0.62, R * 0.62); drawPlayer(g, { ...p, muts: {}, seed: 1.7 }, FAKE_T + 1, R); g.restore();
    g.translate(-size * 0.08, -size * 0.06);
  }
  if (id === 'dash') {
    g.beginPath();
    for (let i = 0; i < 4; i++) { const y = (i - 1.5) * R * 0.45; g.moveTo(-R * 1.2, y); g.lineTo(-R * (2.0 + (i % 2) * 0.4), y); }
    g.strokeStyle = 'rgba(200,255,245,0.75)'; g.lineWidth = 2.5; g.lineCap = 'round'; g.stroke();
    g.translate(size * 0.08, 0);
  }
  if (id === 'nova' || id === 'toxin') {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < (id === 'nova' ? 3 : 0); i++) {
      g.beginPath(); g.arc(0, 0, R * (1.3 + i * 0.32), 0, TAU); g.strokeStyle = `rgba(210,140,255,${0.7 - i * 0.2})`; g.lineWidth = 3 - i * 0.7; g.stroke();
    }
    if (id === 'toxin') for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.5; const d = R * 1.2; g.drawImage(glowSprite([150, 230, 90]), cos(a) * d - R * 0.6, sin(a) * d - R * 0.6, R * 1.2, R * 1.2); }
    g.globalCompositeOperation = 'source-over';
  }
  if (id === 'osmo') {
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.3; g.moveTo(cos(a) * R * 1.25, sin(a) * R * 1.25); g.lineTo(cos(a) * R * 1.6, sin(a) * R * 1.6); g.moveTo(cos(a + 0.12) * R * 1.48, sin(a + 0.12) * R * 1.48); g.lineTo(cos(a) * R * 1.6, sin(a) * R * 1.6); g.lineTo(cos(a - 0.12) * R * 1.48, sin(a - 0.12) * R * 1.48); }
    g.strokeStyle = 'rgba(140,220,255,0.9)'; g.lineWidth = 2; g.lineCap = 'round'; g.stroke();
  }
  if (id === 'biolum') {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) { const a = i * 1.05; const d = R * (1.45 + (i % 2) * 0.25); const sp = glowSprite([255, 230, 140], 1); g.drawImage(sp, cos(a) * d - 5, sin(a) * d - 5, 10, 10); }
    g.globalCompositeOperation = 'source-over';
  }
  g.rotate(-0.4); g.scale(R, R);
  drawPlayer(g, p, FAKE_T, R * 2);
  if (id === 'symbionts') {
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + 0.4;
      g.save(); g.translate(cos(a) * 1.55, sin(a) * 1.55); g.scale(0.22, 0.22);
      drawSpecies(g, { kind: 'drifter', seed: i, ang: 0 }, FAKE_T, R * 0.4);
      g.restore();
    }
  }
  if (id === 'pseudopod') {
    g.beginPath(); g.arc(1.25, 0.05, 0.28, 0, TAU); g.fillStyle = 'rgba(255,220,120,0.9)'; g.fill();
  }
  if (id === 'mimicry') {
    g.setLineDash([0.18, 0.14]); g.beginPath(); g.arc(0, 0, 1.25, 0, TAU); g.strokeStyle = 'rgba(200,230,255,0.9)'; g.lineWidth = lw * 2; g.stroke(); g.setLineDash([]);
  }
  g.restore();
  if (id === 'chloro') {
    g.save(); g.translate(-size * 0.3, -size * 0.3);
    g.globalCompositeOperation = 'lighter'; g.drawImage(glowSprite([255, 240, 160], 1), -10, -10, 20, 20); g.globalCompositeOperation = 'source-over';
    g.restore();
  }
  return c;
}

// genome upgrade icons: DNA helix motif + symbol
export function genomePortrait(id, size) {
  const [c, g] = portraitCanvas(size);
  g.translate(size / 2, size / 2);
  const R = size * 0.38;
  const dnaC = [199, 156, 255];
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5;
  g.drawImage(glowSprite(dnaC), -size * 0.5, -size * 0.5, size, size);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  // background helix ring
  g.save(); g.rotate(-0.6);
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let i = 0; i <= 40; i++) { const u = i / 40; const x = (u - 0.5) * R * 2.1; const y = sin(u * TAU * 1.5 + k * PI) * R * 0.35; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = k ? 'rgba(125,79,224,0.55)' : 'rgba(199,156,255,0.55)'; g.lineWidth = size * 0.035; g.lineCap = 'round'; g.stroke();
  }
  g.beginPath();
  for (let i = 1; i < 12; i++) { const u = i / 12; const x = (u - 0.5) * R * 2.1; const y = sin(u * TAU * 1.5) * R * 0.35; g.moveTo(x, y); g.lineTo(x, -y); }
  g.strokeStyle = 'rgba(220,200,255,0.3)'; g.lineWidth = size * 0.018; g.stroke();
  g.restore();
  // symbol in front
  const r = size * 0.22;
  const sym = (fn) => { g.save(); fn(); g.restore(); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  const cell = (rr, col = [110, 255, 225], muts = {}) => { g.save(); g.scale(rr, rr); drawPlayer(g, { r: 1, ang: 0, seed: 0.3, muts }, FAKE_T, rr * 2); g.restore(); };
  switch (id) {
    case 'hp': sym(() => { cell(r, undefined, { membrane: 4 }); g.fillStyle = '#ff7d90'; heart(g, r * 0.55, r * 0.5, r * 0.5); }); break;
    case 'motor': sym(() => { g.translate(r * 0.4, 0); cell(r * 0.9, undefined, { flagellum: 4 }); }); break;
    case 'digest': sym(() => { cell(r, undefined, { vacuole: 5 }); }); break;
    case 'splice': sym(() => {
      g.strokeStyle = '#fff'; g.lineWidth = size * 0.05;
      g.beginPath(); g.arc(-r * 0.45, r * 0.55, r * 0.28, 0, TAU); g.arc(r * 0.45, r * 0.55, r * 0.28, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.3, r * 0.3); g.lineTo(r * 0.55, -r * 0.9); g.moveTo(r * 0.3, r * 0.3); g.lineTo(-r * 0.55, -r * 0.9); g.stroke();
    }); break;
    case 'wide': sym(() => {
      for (let i = 0; i < 4; i++) {
        g.save(); g.rotate((i - 1.5) * 0.28); g.translate(0, -r * 0.2);
        g.beginPath(); g.roundRect(-r * 0.32, -r * 0.95, r * 0.64, r * 0.95, r * 0.12);
        g.fillStyle = ['#7cf0a3', '#6fc8ff', '#c79cff', '#ffcf6e'][i]; g.globalAlpha = 0.9; g.fill();
        g.globalAlpha = 1; g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5; g.stroke();
        g.restore();
      }
    }); break;
    case 'headstart': sym(() => {
      cell(r * 0.8, undefined, { cilia: 2 });
      g.beginPath(); g.moveTo(r * 0.9, -r * 0.5); g.lineTo(r * 1.5, 0); g.lineTo(r * 0.9, r * 0.5);
      g.strokeStyle = '#ffcf6e'; g.lineWidth = size * 0.06; g.stroke();
    }); break;
    case 'cystmem': sym(() => {
      g.save(); g.scale(r, r); drawPlayer(g, { r: 1, ang: 0, seed: 0.3, muts: {}, cyst: 1 }, FAKE_T, r * 2); g.restore();
      g.beginPath(); g.arc(0, 0, r * 1.45, -2.4, 1.6); g.strokeStyle = '#ffcf6e'; g.lineWidth = size * 0.04; g.stroke();
      g.beginPath(); g.moveTo(cos(1.6) * r * 1.45 + 5, sin(1.6) * r * 1.45 - 3); g.lineTo(cos(1.6) * r * 1.45, sin(1.6) * r * 1.45); g.lineTo(cos(1.6) * r * 1.45 + 6, sin(1.6) * r * 1.45 + 4); g.stroke();
    }); break;
    case 'harvest': sym(() => {
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) { const a = i * 0.9; const d = r * (0.3 + i * 0.13); g.drawImage(glowSprite(dnaC, 1), cos(a) * d - 7, sin(a) * d - 7, 14, 14); }
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = '#fff'; g.lineWidth = size * 0.05;
      g.beginPath(); g.moveTo(-r * 0.5, -r * 0.9); g.bezierCurveTo(r * 0.9, -r * 0.3, -r * 0.9, r * 0.3, r * 0.5, r * 0.9); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.moveTo(r * 0.5, -r * 0.9); g.bezierCurveTo(-r * 0.9, -r * 0.3, r * 0.9, r * 0.3, -r * 0.5, r * 0.9); g.stroke();
    }); break;
    case 'sensory': sym(() => {
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, r * (0.75 + i * 0.35), -0.9, 0.9); g.strokeStyle = `rgba(150,255,230,${0.9 - i * 0.25})`; g.lineWidth = size * 0.035; g.stroke(); }
      cell(r * 0.55, undefined, { biolum: 2 });
    }); break;
  }
  return c;
}
function heart(g, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s / 24, s / 24); g.translate(-12, -12);
  g.beginPath(); g.moveTo(12, 20); g.bezierCurveTo(12, 20, 4.5, 15.5, 4.5, 10); g.bezierCurveTo(4.5, 5, 10.5, 4.5, 12, 7.2); g.bezierCurveTo(13.5, 4.5, 19.5, 5, 19.5, 10); g.bezierCurveTo(19.5, 15.5, 12, 20, 12, 20);
  g.fill(); g.restore();
}

export function portrait(kind, id, size = 96) {
  try {
    if (kind === 'microbe') return microbePortrait(id, size);
    if (kind === 'mutation') return mutationPortrait(id, size);
    if (kind === 'genome') return genomePortrait(id, size);
  } catch (e) { console.warn('portrait failed', kind, id, e); }
  const [c] = portraitCanvas(size);
  return c;
}
