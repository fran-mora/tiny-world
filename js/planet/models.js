// Tiny World — procedural low-poly models built from code (no assets).
// API: MODEL_INFO, plantGeometry(id, variant, flowering), animalGeometry(id), decorGeometry(id, variant),
//      modelUniforms, createModelMaterial(kind). Every geometry carries position, normal, color,
//      aSway, aFlap, aWag, aGlow. Plants grow up +Y from the origin; animals face +Z, feet at y=0.
import * as THREE from 'three';
import { RNG } from '../rng.js';
import { ANIMAL } from '../data/species.js';

export const modelUniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uNight: { value: 0 } };

export const MODEL_INFO = {
  moss: { variants: 1, flowering: false, height: 0.08 }, grass: { variants: 1, flowering: false, height: 0.15 },
  algae: { variants: 1, flowering: false, height: 0.5 },
  fern: { variants: 2, flowering: false, height: 0.35 }, flower: { variants: 3, flowering: true, height: 0.3 },
  bush: { variants: 2, flowering: true, height: 0.45 }, mushroom: { variants: 2, flowering: false, height: 0.25 },
  cactus: { variants: 2, flowering: true, height: 0.6 }, pine: { variants: 3, flowering: false, height: 1.3 },
  oak: { variants: 3, flowering: false, height: 1.3 }, palm: { variants: 2, flowering: false, height: 1.4 },
  worldtree: { variants: 1, flowering: false, height: 4 },
};
for (const id of Object.keys(ANIMAL)) MODEL_INFO[id] = { variants: 1, flowering: false, height: ANIMAL[id].size };
for (const id of ['rock', 'cloud', 'kelp', 'tuft_grass', 'tuft_moss', 'tuft_dry', 'sprout']) MODEL_INFO[id] = { variants: id === 'rock' || id === 'cloud' ? 3 : 1, flowering: false, height: 0.1 };

// ------------------------------------------------------------------ builder
// A Part is a non-indexed BufferGeometry with all attributes filled.
let RND = new RNG(1);
function part(geom, color, o = {}) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  if (o.m) g.applyMatrix4(o.m);
  const n = g.attributes.position.count;
  const base = new THREE.Color(color);
  const top = o.top ? new THREE.Color(o.top) : null;
  const pos = g.attributes.position;
  const col = new Float32Array(n * 3), sw = new Float32Array(n), fl = new Float32Array(n), wg = new Float32Array(n), gl = new Float32Array(n);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const tc = new THREE.Color();
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (RND.next() - 0.5) * (o.jitter ?? 0.12);
    for (let k = 0; k < 3; k++) {
      const v = i + k, y = pos.getY(v), x = pos.getX(v), z = pos.getZ(v);
      tc.copy(base);
      if (top) tc.lerp(top, maxY > minY ? (y - minY) / (maxY - minY) : 0);
      col[v * 3] = tc.r * j; col[v * 3 + 1] = tc.g * j; col[v * 3 + 2] = tc.b * j;
      sw[v] = o.sway ? Math.max(0, Math.min(1, y / (o.sh || 1))) * o.sway : 0;
      fl[v] = o.flap ? Math.abs(x) * o.flap : 0;
      wg[v] = o.wag ? Math.max(0, -(z - (o.wagFrom || 0))) * o.wag : 0;
      gl[v] = o.glow || 0;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  g.setAttribute('aFlap', new THREE.BufferAttribute(fl, 1));
  g.setAttribute('aWag', new THREE.BufferAttribute(wg, 1));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return g;
}
function merge(parts) {
  const names = ['position', 'color', 'aSway', 'aFlap', 'aWag', 'aGlow'];
  let total = 0; for (const p of parts) total += p.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const nm of names) {
    const size = parts[0].attributes[nm].itemSize;
    const arr = new Float32Array(total * size); let o = 0;
    for (const p of parts) { const a = p.attributes[nm]; arr.set(a.array.subarray(0, a.count * size), o); o += a.count * size; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, size));
  }
  out.computeVertexNormals();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
// matrix helper: position, euler rotation, scale (number or [x,y,z])
const M = (p = [0, 0, 0], r = [0, 0, 0], s = 1) => {
  const m = new THREE.Matrix4();
  const sc = Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s);
  m.compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, 'YXZ')), sc);
  return m;
};
const cyl = (rt, rb, h, seg = 6) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1); g.translate(0, h / 2, 0); return g; };
const cone = (r, h, seg = 6) => { const g = new THREE.ConeGeometry(r, h, seg, 1); g.translate(0, h / 2, 0); return g; };
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const sph = (r, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);
const dome = (r, w = 8) => new THREE.SphereGeometry(r, w, 3, 0, Math.PI * 2, 0, Math.PI / 2);
// a flat leaf blade (diamond) along +Y, width along X
function blade(len, wid, bend = 0) {
  const g = new THREE.BufferGeometry();
  const v = [0, 0, 0, wid / 2, len * 0.4, bend * 0.4, 0, len, bend, -wid / 2, len * 0.4, bend * 0.4];
  const idx = [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx);
  return g;
}

const cache = new Map();
const cached = (k, fn) => { if (cache.has(k)) return cache.get(k); const g = fn(); cache.set(k, g); return g; };

// ------------------------------------------------------------------ plants
export function plantGeometry(id, variant = 0, flowering = false) {
  return cached(`p|${id}|${variant}|${flowering ? 1 : 0}`, () => {
    RND = new RNG(1000 + variant * 97 + id.length * 13 + (flowering ? 7 : 0));
    const P = [];
    const r = (a, b) => RND.float(a, b);
    const GA = Math.PI * (3 - Math.sqrt(5));
    if (id === 'pine') {
      const h = 1.3 * (0.9 + variant * 0.08);
      P.push(part(cyl(0.035, 0.07, h * 0.45, 6), '#5d4030', { top: '#6e4c38' }));
      const layers = 4 + variant;
      for (let i = 0; i < layers; i++) {
        const t = i / layers, rad = 0.36 * (1 - t * 0.75), y = h * (0.22 + t * 0.66);
        P.push(part(cone(rad, h * 0.34, 7), i % 2 ? '#2a6a4c' : '#2f7a56', { m: M([0, y, 0], [r(-0.05, 0.05), i * 0.6, r(-0.05, 0.05)]), top: '#3f9468', sway: 0.45, sh: h }));
      }
    } else if (id === 'oak' || id === 'worldtree') {
      const W = id === 'worldtree';
      const s = W ? 2.9 : 1 + variant * 0.06;
      const bark = W ? '#6b5a7a' : '#5e432f';
      // trunk + branches
      P.push(part(cyl(0.07 * s, 0.12 * s, 0.62 * s, 7), bark, { top: W ? '#7d6a90' : '#6b4d36' }));
      for (let b = 0; b < (W ? 5 : 3); b++) {
        const a = b * 2.2 + variant, tilt = 0.7 + r(-0.15, 0.15);
        P.push(part(cyl(0.025 * s, 0.045 * s, 0.4 * s, 5), bark, { m: M([0, 0.5 * s, 0], [tilt * Math.cos(a), 0, tilt * Math.sin(a)]), sway: 0.15, sh: 1.3 * s }));
      }
      if (W) for (let k = 0; k < 6; k++) { const a = k * 1.05; P.push(part(cyl(0.02 * s, 0.06 * s, 0.35 * s, 5), bark, { m: M([Math.cos(a) * 0.05 * s, 0.05, Math.sin(a) * 0.05 * s], [1.25 * Math.cos(a), 0, 1.25 * Math.sin(a)]) })); }
      // canopy lobes
      const lobes = W ? 14 : 7 + variant;
      for (let k = 0; k < lobes; k++) {
        const a = k * GA * 2.1, rr = (k === 0 ? 0 : 0.18 + RND.next() * 0.22) * s, y = (0.82 + RND.next() * 0.32) * s;
        const rad = (0.2 + RND.next() * 0.14) * s * (k === 0 ? 1.35 : 1);
        const c = W ? (k % 3 === 0 ? '#5fe8c0' : k % 3 === 1 ? '#86f5d6' : '#3fcfa8') : (k % 3 === 0 ? '#4c9a3c' : k % 3 === 1 ? '#5aad46' : '#3f8a36');
        P.push(part(ico(rad, 0), c, { m: M([Math.cos(a) * rr, y, Math.sin(a) * rr], [r(0, 3), r(0, 3), 0], [1, 0.82, 1]), top: W ? '#b8ffe8' : '#6cc254', sway: 0.35, sh: 1.4 * s, glow: W ? 0.25 : 0 }));
      }
      if (W) for (let k = 0; k < 16; k++) { const a = k * GA * 3, rr = (0.25 + RND.next() * 0.3) * s; P.push(part(ico(0.035 * s, 0), '#fff2a8', { m: M([Math.cos(a) * rr, (0.75 + RND.next() * 0.45) * s, Math.sin(a) * rr]), glow: 1, sway: 0.35, sh: 1.4 * s })); }
    } else if (id === 'palm') {
      const h = 1.35 + variant * 0.1, segs = 7, lean = 0.22 + variant * 0.1;
      let x = 0, y = 0;
      for (let i = 0; i < segs; i++) {
        const t = i / segs, len = h / segs, ang = lean * t;
        P.push(part(cyl(0.04 - t * 0.012, 0.05 - t * 0.012, len * 1.05, 6), i % 2 ? '#8a6a48' : '#7a5c3e', { m: M([x, y, 0], [0, 0, -ang]), sway: 0.3, sh: h }));
        x += Math.sin(ang) * len; y += Math.cos(ang) * len;
      }
      for (let f = 0; f < 8; f++) {
        const a = f * (Math.PI * 2 / 8) + r(-0.1, 0.1);
        for (let k = 0; k < 4; k++) {
          const g = blade(0.2, 0.09, 0);
          const droop = 0.9 + k * 0.38;
          P.push(part(g, k % 2 ? '#6fb043' : '#82c24c', { m: M([x + Math.cos(a) * k * 0.13, y + 0.03 - k * k * 0.018, Math.sin(a) * k * 0.13], [0, -a + Math.PI / 2, droop]), sway: 0.6, sh: h, jitter: 0.08 }));
        }
      }
      for (let c = 0; c < 3; c++) P.push(part(ico(0.035, 0), '#6b4a26', { m: M([x + Math.cos(c * 2.1) * 0.05, y - 0.05, Math.sin(c * 2.1) * 0.05]) }));
    } else if (id === 'cactus') {
      const h = 0.5 + variant * 0.08;
      P.push(part(cyl(0.11, 0.12, h, 9), '#4f9f5a', { top: '#6dc475' }));
      P.push(part(dome(0.11, 9), '#6dc475', { m: M([0, h, 0]) }));
      const arms = variant ? 2 : 1;
      for (let a = 0; a < arms; a++) {
        const sx = a ? -1 : 1, ay = h * (0.4 + a * 0.15);
        P.push(part(cyl(0.05, 0.05, 0.14, 7), '#58a862', { m: M([sx * 0.08, ay, 0], [0, 0, -sx * Math.PI / 2]) }));
        P.push(part(cyl(0.05, 0.05, 0.16, 7), '#5fb469', { m: M([sx * 0.2, ay, 0]) }));
        P.push(part(dome(0.05, 7), '#6dc475', { m: M([sx * 0.2, ay + 0.16, 0]) }));
      }
      for (let i = 0; i < 14; i++) { const a = i * GA * 4, yy = 0.06 + (i / 14) * h; P.push(part(ico(0.008, 0), '#f3f0d8', { m: M([Math.cos(a) * 0.115, yy, Math.sin(a) * 0.115]) })); }
      if (flowering) for (let i = 0; i < 5; i++) { const a = i * 1.26; P.push(part(blade(0.06, 0.05, 0.02), '#ff6fa8', { m: M([0, h + 0.09, 0], [0, a, 0.7]), top: '#ffc0d8' })); }
    } else if (id === 'bush') {
      const lobes = 5 + variant;
      for (let k = 0; k < lobes; k++) {
        const a = k * GA * 2, rr = k === 0 ? 0 : 0.13 + RND.next() * 0.06;
        P.push(part(ico(0.15 + RND.next() * 0.06, 0), k % 2 ? '#365f8a' : '#3b6f4a', { m: M([Math.cos(a) * rr, 0.16 + RND.next() * 0.14, Math.sin(a) * rr], [r(0, 3), r(0, 3), 0], [1, 0.85, 1]), top: '#4e8a5c', sway: 0.3, sh: 0.45 }));
      }
      if (flowering) for (let i = 0; i < 16; i++) { const a = i * GA * 3, rr = 0.15 + (i % 3) * 0.05; P.push(part(ico(0.028, 0), '#5c7fd6', { m: M([Math.cos(a) * rr, 0.14 + (i % 4) * 0.07, Math.sin(a) * rr]), top: '#9db4ff', glow: 0.25, sway: 0.3, sh: 0.45 })); }
    } else if (id === 'flower') {
      const petalCols = [['#ffb347', '#ffe08a'], ['#ff6f91', '#ffc2d1'], ['#b28dff', '#e3d4ff']][variant % 3];
      const h = 0.24 + variant * 0.03;
      P.push(part(cyl(0.008, 0.012, h, 4), '#4f9a3a', { sway: 0.8, sh: h }));
      for (let l = 0; l < 2; l++) P.push(part(blade(0.11, 0.05, 0.03), '#5aab46', { m: M([0, h * 0.25 + l * 0.05, 0], [0, l * Math.PI + 0.4, 0.9]), sway: 0.6, sh: h }));
      if (flowering) {
        const np = 7;
        for (let i = 0; i < np; i++) P.push(part(blade(0.075, 0.05, 0.0), petalCols[0], { m: M([0, h, 0], [0, i * (Math.PI * 2 / np), 1.25]), top: petalCols[1], sway: 0.8, sh: h, jitter: 0.06 }));
        P.push(part(ico(0.025, 0), '#ffde59', { m: M([0, h + 0.01, 0]), sway: 0.8, sh: h, glow: 0.15 }));
      } else {
        P.push(part(ico(0.03, 0), '#7fbf4a', { m: M([0, h + 0.015, 0], [0, 0, 0], [1, 1.5, 1]), top: petalCols[0], sway: 0.8, sh: h }));
      }
    } else if (id === 'fern') {
      const n = 7 + variant * 2;
      for (let i = 0; i < n; i++) {
        const a = i * GA, tilt = 0.55 + (i % 3) * 0.18, len = 0.28 + (i % 4) * 0.03;
        // frond: chain of leaflets along an arching rachis
        for (let k = 0; k < 5; k++) {
          const t = k / 5;
          const fx = Math.sin(tilt + t * 0.8) * len * t, fy = Math.cos(tilt + t * 0.8) * len * t + 0.02;
          P.push(part(blade(0.09 * (1 - t * 0.5), 0.045 * (1 - t * 0.4), 0.01), k % 2 ? '#2f8a52' : '#3e9e63', { m: M([Math.cos(a) * fx, fy, Math.sin(a) * fx], [0, -a + Math.PI / 2, tilt + t * 0.9 + 0.3]), sway: 0.7, sh: 0.35, top: '#5cbf7d' }));
        }
      }
      P.push(part(ico(0.025, 0), '#4fae6e', { m: M([0, 0.05, 0]) }));
    } else if (id === 'mushroom') {
      const caps = [[0, 0, 1], [0.085, 0.03, 0.72], [-0.07, -0.05, 0.6], ...(variant ? [[0.02, -0.09, 0.5]] : [])];
      for (const [x, z, s] of caps) {
        P.push(part(cyl(0.018 * s, 0.026 * s, 0.16 * s, 6), '#efe2c6', { m: M([x, 0, z]) }));
        P.push(part(dome(0.075 * s, 8), '#ff8f6b', { m: M([x, 0.15 * s, z], [0, 0, 0], [1, 0.75, 1]), top: '#ffc49b', glow: 0.75 }));
        for (let k = 0; k < 4; k++) { const a = k * 1.7 + x * 10; P.push(part(ico(0.011 * s, 0), '#fff6e0', { m: M([x + Math.cos(a) * 0.04 * s, 0.19 * s, z + Math.sin(a) * 0.04 * s]), glow: 0.9 })); }
      }
    } else {
      P.push(part(cone(0.1, 0.3, 5), '#5a5', { sway: 0.5, sh: 0.3 }));
    }
    return merge(P);
  });
}

// ------------------------------------------------------------------ animals (face +Z, feet at y=0)
export function animalGeometry(id) {
  return cached(`a|${id}`, () => {
    RND = new RNG(500 + id.length * 31);
    const P = [];
    const legs = (pairs, x, zs, h, color, r = 0.012) => { for (const z of zs) for (const sx of [-1, 1]) P.push(part(cyl(r * 0.8, r, h, 4), color, { m: M([sx * x, 0, z]) })); };
    if (id === 'hopper') {
      P.push(part(sph(0.075, 8, 6), '#f3d7b0', { m: M([0, 0.075, -0.01], [0, 0, 0], [1, 0.9, 1.15]), top: '#fff0dc' }));
      P.push(part(sph(0.048, 7, 5), '#f6dcb8', { m: M([0, 0.12, 0.07]), top: '#fff4e4' }));
      for (const sx of [-1, 1]) P.push(part(sph(0.016, 5, 4), '#f6dcb8', { m: M([sx * 0.022, 0.19, 0.055], [-0.35, 0, sx * 0.25], [1, 3.6, 0.7]), top: '#ffc6c6' }));
      P.push(part(ico(0.026, 0), '#ffffff', { m: M([0, 0.085, -0.095]) }));
      for (const sx of [-1, 1]) P.push(part(ico(0.008, 0), '#2a1d14', { m: M([sx * 0.026, 0.13, 0.108]) }));
      P.push(part(ico(0.007, 0), '#e88a8a', { m: M([0, 0.118, 0.118]) }));
      for (const sx of [-1, 1]) P.push(part(sph(0.022, 5, 3), '#e9c79e', { m: M([sx * 0.04, 0.012, 0.03], [0, 0, 0], [0.8, 0.5, 1.4]) }));
    } else if (id === 'beetle') {
      P.push(part(dome(0.055, 8), '#6b4fc4', { m: M([0, 0.018, -0.005], [0, 0, 0], [1, 0.8, 1.3]), top: '#a98bff', glow: 0.08 }));
      P.push(part(sph(0.025, 6, 4), '#2a2238', { m: M([0, 0.03, 0.07]) }));
      P.push(part(new THREE.BoxGeometry(0.003, 0.03, 0.11), '#3a2f58', { m: M([0, 0.06, -0.005]) }));
      for (const z of [-0.035, 0, 0.035]) for (const sx of [-1, 1]) P.push(part(cyl(0.004, 0.004, 0.06, 3), '#2a2238', { m: M([sx * 0.04, 0.03, z], [0, 0, sx * 2.1]) }));
      for (const sx of [-1, 1]) P.push(part(cyl(0.002, 0.003, 0.05, 3), '#2a2238', { m: M([sx * 0.012, 0.035, 0.085], [0.9, 0, sx * 0.4]) }));
    } else if (id === 'moth') {
      P.push(part(sph(0.018, 6, 4), '#eaf9ff', { m: M([0, 0, 0], [0, 0, 0], [1, 1, 2.6]), glow: 1 }));
      for (const sx of [-1, 1]) {
        const fw = new THREE.CircleGeometry(0.065, 7); fw.rotateX(-Math.PI / 2);
        P.push(part(fw, '#bfeaff', { m: M([sx * 0.065, 0.005, 0.015], [0, sx * 0.3, 0], [1, 1, 0.7]), flap: 14, glow: 0.55, top: '#ffffff' }));
        const hw = new THREE.CircleGeometry(0.04, 6); hw.rotateX(-Math.PI / 2);
        P.push(part(hw, '#9fd8ff', { m: M([sx * 0.04, 0.004, -0.03], [0, -sx * 0.4, 0], [1, 1, 0.8]), flap: 14, glow: 0.45 }));
        P.push(part(cyl(0.0015, 0.002, 0.045, 3), '#eaf9ff', { m: M([sx * 0.006, 0.006, 0.045], [1.1, 0, sx * 0.35]) }));
      }
    } else if (id === 'fish') {
      P.push(part(sph(0.035, 8, 5), '#5fb8f0', { m: M([0, 0, 0], [0, 0, 0], [0.7, 1, 2.5]), top: '#bfeaff', wag: 4, glow: 0.2 }));
      const tail = blade(0.07, 0.07, 0); tail.rotateX(-Math.PI / 2); tail.rotateZ(Math.PI / 2);
      P.push(part(tail, '#7fd3ff', { m: M([0, 0, -0.075], [0, 0, 0]), wag: 8, glow: 0.3 }));
      const fin = blade(0.04, 0.05, 0); fin.rotateY(Math.PI / 2);
      P.push(part(fin, '#9fe0ff', { m: M([0, 0.025, -0.01], [-0.5, 0, 0]), wag: 4 }));
      for (const sx of [-1, 1]) P.push(part(ico(0.006, 0), '#0b1d38', { m: M([sx * 0.02, 0.008, 0.06]) }));
    } else if (id === 'grazer') {
      legs(2, 0.07, [-0.11, 0.11], 0.12, '#8a7356', 0.024);
      P.push(part(sph(0.13, 9, 6), '#b7a07a', { m: M([0, 0.2, 0], [0, 0, 0], [0.85, 0.7, 1.35]), top: '#cdb895' }));
      P.push(part(sph(0.07, 7, 5), '#a98f69', { m: M([0, 0.24, 0.2], [0.2, 0, 0], [0.9, 0.9, 1.1]) }));
      P.push(part(dome(0.11, 9), '#4f8f45', { m: M([0, 0.27, -0.01], [0, 0, 0], [0.8, 0.5, 1.2]), top: '#6db35a' }));
      for (let k = 0; k < 5; k++) { const a = k * 1.3; P.push(part(cone(0.02, 0.07, 4), k % 2 ? '#ffb347' : '#7fbf4a', { m: M([Math.cos(a) * 0.05, 0.31, Math.sin(a) * 0.08 - 0.01]), sway: 0.6, sh: 0.4 })); }
      for (const sx of [-1, 1]) P.push(part(cone(0.012, 0.05, 4), '#e8dcc0', { m: M([sx * 0.035, 0.28, 0.22], [0, 0, sx * -0.5]) }));
      for (const sx of [-1, 1]) P.push(part(ico(0.01, 0), '#1f1610', { m: M([sx * 0.04, 0.25, 0.26]) }));
    } else if (id === 'prowler') {
      legs(2, 0.045, [-0.1, 0.09], 0.11, '#b85a32', 0.016);
      P.push(part(sph(0.075, 8, 5), '#e07a4f', { m: M([0, 0.14, 0], [0, 0, 0], [0.8, 0.75, 2.0]), top: '#f2a074' }));
      P.push(part(sph(0.055, 7, 5), '#e8875a', { m: M([0, 0.17, 0.16], [0, 0, 0], [0.95, 0.85, 1.2]) }));
      P.push(part(cone(0.02, 0.05, 4), '#f3c8a8', { m: M([0, 0.155, 0.21], [Math.PI / 2, 0, 0]) }));
      for (const sx of [-1, 1]) P.push(part(cone(0.02, 0.05, 4), '#c9643a', { m: M([sx * 0.03, 0.2, 0.15], [0, 0, sx * -0.3]) }));
      for (const sx of [-1, 1]) P.push(part(ico(0.008, 0), '#2a1a0a', { m: M([sx * 0.026, 0.18, 0.205]), glow: 0.3 }));
      for (let k = 0; k < 4; k++) P.push(part(cyl(0.012 - k * 0.002, 0.014 - k * 0.002, 0.07, 5), k === 3 ? '#3a2418' : '#c9643a', { m: M([0, 0.15 + k * 0.012, -0.14 - k * 0.06], [-1.25, 0, 0]), wag: 2.2, wagFrom: -0.12 }));
      for (const z of [-0.06, 0.03]) P.push(part(new THREE.BoxGeometry(0.11, 0.01, 0.025), '#9a4322', { m: M([0, 0.2, z]) }));
    } else if (id === 'hawk') {
      P.push(part(sph(0.045, 7, 5), '#e8e2d0', { m: M([0, 0, 0], [0, 0, 0], [0.9, 0.8, 2.2]), top: '#ffffff' }));
      P.push(part(sph(0.03, 6, 4), '#f4efe0', { m: M([0, 0.02, 0.09]) }));
      P.push(part(cone(0.012, 0.035, 4), '#ffc93c', { m: M([0, 0.015, 0.12], [Math.PI / 2, 0, 0]) }));
      for (const sx of [-1, 1]) {
        const w = new THREE.BufferGeometry();
        w.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.05, sx * 0.28, 0.0, -0.02, sx * 0.24, 0, -0.08, 0, 0, -0.06], 3));
        w.setIndex(sx > 0 ? [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2] : [0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3]);
        P.push(part(w, '#bfb39a', { flap: 5, top: '#e8e2d0' }));
        P.push(part(ico(0.007, 0), '#1a1208', { m: M([sx * 0.016, 0.03, 0.105]) }));
      }
      const tl = new THREE.BufferGeometry();
      tl.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.07, 0.05, 0, -0.16, -0.05, 0, -0.16], 3)); tl.setIndex([0, 1, 2, 0, 2, 1]);
      P.push(part(tl, '#a89a80'));
    } else {
      P.push(part(sph(0.07, 7, 5), '#ffffff', { m: M([0, 0.07, 0]) }));
    }
    return merge(P);
  });
}

// ------------------------------------------------------------------ decor
export function decorGeometry(id, variant = 0) {
  return cached(`d|${id}|${variant}`, () => {
    RND = new RNG(900 + variant * 17 + id.length);
    const P = [];
    if (id === 'rock') {
      const c = ['#6f675f', '#7d746a', '#5f5852'][variant % 3];
      P.push(part(new THREE.DodecahedronGeometry(0.14, 0), c, { m: M([0, 0.03, 0], [RND.float(0, 3), RND.float(0, 3), 0], [1.1, 0.6 + variant * 0.12, 0.9]), top: '#9a9188' }));
      if (variant !== 1) P.push(part(new THREE.DodecahedronGeometry(0.07, 0), c, { m: M([0.13, 0.01, 0.05], [1, 2, 0], [1, 0.7, 1]) }));
    } else if (id === 'cloud') {
      const n = 5 + variant;
      for (let k = 0; k < n; k++) {
        const x = (k / (n - 1) - 0.5) * 1.5, rad = 0.36 + Math.sin((k / (n - 1)) * Math.PI) * 0.3 + RND.float(-0.05, 0.05);
        P.push(part(ico(rad, 1), '#e8f0f8', { m: M([x, rad * 0.35, RND.float(-0.2, 0.2)], [0, 0, 0], [1, 0.8, 0.9]), top: '#ffffff', jitter: 0.04 }));
      }
    } else if (id === 'kelp') {
      for (let k = 0; k < 3; k++) { const a = k * 2.1; P.push(part(blade(0.42 + k * 0.08, 0.06, 0.05), k % 2 ? '#2f8f5f' : '#3fa86e', { m: M([Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04], [0, a, 0]), sway: 1, sh: 0.5, top: '#6fd08f' })); }
    } else if (id === 'sprout') {
      P.push(part(cyl(0.006, 0.008, 0.07, 4), '#6fbf5a'));
      for (const sx of [-1, 1]) P.push(part(blade(0.05, 0.035, 0), '#8fe07a', { m: M([0, 0.065, 0], [0, 0, sx * 1.0]), sway: 0.6, sh: 0.1 }));
    } else if (id === 'tuft_moss') {
      for (let k = 0; k < 3; k++) { const a = k * 2.2; P.push(part(dome(0.06 - k * 0.012, 6), k % 2 ? '#5f9e5a' : '#3f7a45', { m: M([Math.cos(a) * 0.05, -0.005, Math.sin(a) * 0.05], [0, 0, 0], [1, 0.55, 1]), top: '#7fbf6a' })); }
    } else {
      const dry = id === 'tuft_dry';
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = k * 2.4, lean = 0.15 + (k % 3) * 0.12, len = 0.11 + (k % 4) * 0.025;
        P.push(part(blade(len, 0.022, 0.02), dry ? '#a8954a' : '#4f9a3a', { m: M([Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02], [0, a, lean]), top: dry ? '#e0cf7a' : '#9ad864', sway: 0.75, sh: 0.15 }));
      }
    }
    return merge(P);
  });
}

// ------------------------------------------------------------------ material
export function createModelMaterial(kind = 'plant') {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = modelUniforms.uTime; sh.uniforms.uWind = modelUniforms.uWind; sh.uniforms.uNight = modelUniforms.uNight;
    sh.vertexShader = 'attribute float aSway; attribute float aFlap; attribute float aWag; attribute float aGlow; uniform float uTime; uniform float uWind; varying float vGlow;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = 0.0;
      #ifdef USE_INSTANCING
        ph = dot(instanceMatrix[3].xyz, vec3(1.7, 2.3, 3.1));
      #endif
      vGlow = aGlow;
      float sw = aSway * aSway;
      transformed.x += sw * sin(uTime * 1.7 + ph) * 0.07 * uWind;
      transformed.z += sw * cos(uTime * 1.3 + ph * 1.3) * 0.05 * uWind;
      transformed.y += aFlap * sin(uTime * 16.0 + ph) * 0.022;
      transformed.x += aWag * sin(uTime * 9.0 + ph) * 0.035;`);
    sh.fragmentShader = 'uniform float uNight; varying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * vGlow * (0.35 + 0.9 * uNight);`);
  };
  return m;
}
