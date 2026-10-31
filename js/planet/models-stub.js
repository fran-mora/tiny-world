// Fallback low-poly models (used only if js/planet/models.js is unavailable). Same API as models.js.
import * as THREE from 'three';
import { PLANT, ANIMAL } from '../data/species.js';

export const modelUniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uNight: { value: 0 } };
export const MODEL_INFO = {
  moss: { variants: 1, flowering: false, height: 0.1 }, grass: { variants: 1, flowering: false, height: 0.15 },
  fern: { variants: 1, flowering: false, height: 0.35 }, flower: { variants: 1, flowering: true, height: 0.3 },
  bush: { variants: 1, flowering: true, height: 0.45 }, mushroom: { variants: 1, flowering: false, height: 0.25 },
  cactus: { variants: 1, flowering: true, height: 0.6 }, pine: { variants: 2, flowering: false, height: 1.3 },
  oak: { variants: 2, flowering: false, height: 1.3 }, palm: { variants: 1, flowering: false, height: 1.4 },
  worldtree: { variants: 1, flowering: false, height: 4 }, algae: { variants: 1, flowering: false, height: 0.5 },
};
for (const id of Object.keys(ANIMAL)) MODEL_INFO[id] = { variants: 1, flowering: false, height: 0.2 };

// part: geometry + color + per-vertex extras
function part(g, color, { sway = 0, swayByY = false, flap = 0, wag = 0, glow = 0, jitter = 0.06 } = {}) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3), sw = new Float32Array(n), fl = new Float32Array(n), wg = new Float32Array(n), gl = new Float32Array(n);
  const pos = g.attributes.position;
  let maxY = 0.001; for (let i = 0; i < n; i++) maxY = Math.max(maxY, pos.getY(i));
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (Math.random() - 0.5) * jitter * 2;
    for (let k = 0; k < 3; k++) {
      const v = i + k;
      col[v * 3] = c.r * j; col[v * 3 + 1] = c.g * j; col[v * 3 + 2] = c.b * j;
      sw[v] = swayByY ? Math.max(0, pos.getY(v)) * sway : sway;
      fl[v] = flap ? Math.abs(pos.getX(v)) * flap : 0;
      wg[v] = wag ? Math.max(0, -pos.getZ(v)) * wag : 0;
      gl[v] = glow;
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
    for (const p of parts) { arr.set(p.attributes[nm].array.subarray(0, p.attributes[nm].count * size), o); o += p.attributes[nm].count * size; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, size));
  }
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}
const T = (g, x = 0, y = 0, z = 0) => { g.translate(x, y, z); return g; };
const S = (g, x, y, z) => { g.scale(x, y, z); return g; };

const cache = new Map();
export function plantGeometry(id, variant = 0, flowering = false) {
  const k = `${id}|${variant}|${flowering}`; if (cache.has(k)) return cache.get(k);
  const P = [];
  const col = PLANT[id]?.color || '#5a5';
  const trunk = '#6b4a32';
  if (id === 'pine') {
    P.push(part(T(new THREE.CylinderGeometry(0.03, 0.05, 0.4, 5), 0, 0.2, 0), trunk));
    const layers = variant ? 4 : 3;
    for (let i = 0; i < layers; i++) { const r = 0.32 - i * 0.07, y = 0.35 + i * 0.25; P.push(part(T(new THREE.ConeGeometry(r, 0.45, 7), 0, y, 0), i % 2 ? '#2f7a5a' : '#2a6b4f', { sway: 0.15, swayByY: true })); }
  } else if (id === 'oak' || id === 'worldtree') {
    const s = id === 'worldtree' ? 3 : 1;
    P.push(part(T(new THREE.CylinderGeometry(0.05 * s, 0.09 * s, 0.6 * s, 6), 0, 0.3 * s, 0), id === 'worldtree' ? '#7a5a8a' : trunk));
    const blobs = [[0, 0.85, 0, 0.42], [0.28, 0.72, 0.1, 0.3], [-0.25, 0.75, -0.08, 0.32], [0.05, 0.75, -0.3, 0.28], [-0.05, 1.05, 0.15, 0.28]];
    blobs.forEach(([x, y, z, r], i) => P.push(part(T(new THREE.IcosahedronGeometry(r * s, 0), x * s, y * s, z * s), id === 'worldtree' ? (i % 2 ? '#7cf5c8' : '#a8ffdc') : (i % 2 ? '#4f9a3a' : '#5aab44'), { sway: 0.12, swayByY: true, glow: id === 'worldtree' ? 0.6 : 0 })));
  } else if (id === 'palm') {
    for (let i = 0; i < 5; i++) P.push(part(T(new THREE.CylinderGeometry(0.04, 0.05, 0.26, 5), i * 0.03, 0.13 + i * 0.25, 0), i % 2 ? '#8a6a4a' : '#7a5a3a'));
    for (let i = 0; i < 6; i++) { const g = S(new THREE.ConeGeometry(0.07, 0.6, 4), 1, 1, 0.35); g.rotateZ(Math.PI / 2 + 0.4); g.translate(0.3, 0, 0); g.rotateY(i * Math.PI / 3); g.translate(0.15, 1.25, 0); P.push(part(g, '#7fbf4a', { sway: 0.3, swayByY: true })); }
  } else if (id === 'cactus') {
    P.push(part(T(new THREE.CylinderGeometry(0.12, 0.13, 0.5, 8), 0, 0.25, 0), '#6dbf73'));
    P.push(part(T(new THREE.SphereGeometry(0.12, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.5, 0), '#6dbf73'));
    if (flowering) P.push(part(T(new THREE.IcosahedronGeometry(0.06, 0), 0, 0.63, 0), '#ff6fa8'));
  } else if (id === 'bush') {
    [[0, 0.2, 0, 0.22], [0.15, 0.15, 0.05, 0.16], [-0.14, 0.16, -0.04, 0.17], [0.02, 0.32, 0.03, 0.15]].forEach(([x, y, z, r]) => P.push(part(T(new THREE.IcosahedronGeometry(r, 0), x, y, z), '#3f7a45', { sway: 0.2, swayByY: true })));
    if (flowering) for (let i = 0; i < 8; i++) { const a = i * 2.4; P.push(part(T(new THREE.IcosahedronGeometry(0.035, 0), Math.cos(a) * 0.2, 0.18 + (i % 3) * 0.08, Math.sin(a) * 0.2), '#5c7fd6', { glow: 0.2 })); }
  } else if (id === 'flower') {
    P.push(part(T(new THREE.CylinderGeometry(0.012, 0.015, 0.25, 4), 0, 0.125, 0), '#4f9a3a', { sway: 0.5, swayByY: true }));
    if (flowering) for (let i = 0; i < 6; i++) { const g = S(new THREE.SphereGeometry(0.05, 5, 3), 1, 0.3, 0.6); g.translate(0.05, 0, 0); g.rotateY(i * Math.PI / 3); g.translate(0, 0.27, 0); P.push(part(g, '#ffb347', { sway: 0.5, swayByY: true })); }
    P.push(part(T(new THREE.IcosahedronGeometry(flowering ? 0.035 : 0.05, 0), 0, 0.27, 0), flowering ? '#ff7a2a' : '#7fbf4a', { sway: 0.5, swayByY: true }));
  } else if (id === 'fern') {
    for (let i = 0; i < 6; i++) { const g = S(new THREE.ConeGeometry(0.06, 0.38, 3), 1, 1, 0.3); g.rotateX(0.7); g.translate(0, 0.16, 0.1); g.rotateY(i * Math.PI / 3); P.push(part(g, i % 2 ? '#3e9e63' : '#2f8a52', { sway: 0.5, swayByY: true })); }
  } else if (id === 'mushroom') {
    [[0, 0, 1], [0.08, 0.03, 0.7], [-0.07, -0.05, 0.6]].forEach(([x, z, s]) => {
      P.push(part(T(new THREE.CylinderGeometry(0.02 * s, 0.025 * s, 0.16 * s, 5), x, 0.08 * s, z), '#f0e2c8'));
      P.push(part(T(new THREE.SphereGeometry(0.07 * s, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), x, 0.15 * s, z), '#ff8f6b', { glow: 0.8 }));
    });
  } else {
    P.push(part(T(new THREE.ConeGeometry(0.1, 0.3, 5), 0, 0.15, 0), col, { sway: 0.4, swayByY: true }));
  }
  const g = merge(P); cache.set(k, g); return g;
}

export function animalGeometry(id) {
  if (cache.has(id)) return cache.get(id);
  const P = [];
  const c = ANIMAL[id]?.color || '#fff';
  if (id === 'moth') {
    P.push(part(S(new THREE.SphereGeometry(0.025, 6, 4), 1, 1, 2), '#e8f8ff', { glow: 0.9 }));
    for (const sx of [-1, 1]) { const g = S(new THREE.CircleGeometry(0.06, 6), 1, 1, 1); g.rotateX(-Math.PI / 2); g.translate(sx * 0.06, 0, 0); P.push(part(g, '#c7f0ff', { flap: 12, glow: 0.5 })); }
  } else if (id === 'hawk') {
    P.push(part(S(new THREE.SphereGeometry(0.05, 6, 4), 1, 0.9, 2.2), '#e8e2d0'));
    for (const sx of [-1, 1]) { const g = S(new THREE.ConeGeometry(0.06, 0.26, 3), 1, 1, 0.25); g.rotateZ(sx * Math.PI / 2); g.translate(sx * 0.13, 0, 0); P.push(part(g, '#bfb7a0', { flap: 4 })); }
  } else if (id === 'fish') {
    P.push(part(S(new THREE.SphereGeometry(0.04, 6, 4), 0.7, 1, 2.2), '#7fd3ff', { glow: 0.3, wag: 3 }));
    const t = S(new THREE.ConeGeometry(0.04, 0.07, 3), 1, 1, 0.3); t.rotateX(Math.PI / 2); t.translate(0, 0, -0.1); P.push(part(t, '#4fb6ff', { wag: 6 }));
  } else {
    const s = (ANIMAL[id]?.size || 0.15) / 0.17;
    P.push(part(T(S(new THREE.SphereGeometry(0.07 * s, 7, 5), 1, 0.85, 1.25), 0, 0.07 * s, 0), c));
    P.push(part(T(new THREE.SphereGeometry(0.045 * s, 6, 4), 0, 0.11 * s, 0.08 * s), c));
    if (id === 'hopper') for (const sx of [-1, 1]) P.push(part(T(S(new THREE.SphereGeometry(0.018, 4, 3), 1, 3, 1), sx * 0.025, 0.18, 0.07), '#f8e6c8'));
    if (id === 'prowler') P.push(part(T(S(new THREE.ConeGeometry(0.02 * s, 0.14 * s, 4), 1, 1, 1), 0, 0.09 * s, -0.12 * s).rotateX(0), '#c9643a', { wag: 3 }));
    if (id === 'grazer') P.push(part(T(new THREE.IcosahedronGeometry(0.05 * s, 0), 0, 0.14 * s, -0.02), '#5f9e5a'));
  }
  const g = merge(P); cache.set(id, g); return g;
}

export function decorGeometry(id, variant = 0) {
  const k = 'd' + id + variant; if (cache.has(k)) return cache.get(k);
  let P = [];
  if (id === 'rock') P.push(part(S(new THREE.DodecahedronGeometry(0.14, 0), 1, 0.6 + variant * 0.15, 1), ['#6f675f', '#7d746a', '#5f5852'][variant % 3]));
  else if (id === 'cloud') { [[0, 0, 0, 0.6], [0.55, -0.1, 0.1, 0.45], [-0.5, -0.1, -0.05, 0.42], [0.1, 0.25, 0.05, 0.4]].forEach(([x, y, z, r]) => P.push(part(T(new THREE.IcosahedronGeometry(r * (1 + variant * 0.12), 0), x, y, z), '#ffffff', { jitter: 0.03 }))); }
  else if (id === 'kelp') P.push(part(T(S(new THREE.ConeGeometry(0.05, 0.5, 4), 1, 1, 0.4), 0, 0.25, 0), '#2f8f5f', { sway: 0.8, swayByY: true }));
  else if (id === 'sprout') { for (const sx of [-1, 1]) { const g = S(new THREE.SphereGeometry(0.03, 4, 3), 1, 0.4, 0.6); g.translate(sx * 0.03, 0.07, 0); P.push(part(g, '#8fe07a', { sway: 0.5 })); } P.push(part(T(new THREE.CylinderGeometry(0.006, 0.008, 0.07, 4), 0, 0.035, 0), '#6fbf5a')); }
  else {
    const color = id === 'tuft_moss' ? '#4a8a4c' : id === 'tuft_dry' ? '#c4b35d' : '#86c95a';
    const n = id === 'tuft_moss' ? 1 : 5;
    if (id === 'tuft_moss') P.push(part(S(new THREE.IcosahedronGeometry(0.07, 0), 1.3, 0.4, 1.3), color));
    else for (let i = 0; i < n; i++) { const g = new THREE.ConeGeometry(0.018, 0.14 + (i % 2) * 0.05, 3); g.translate(0, 0.07, 0); g.rotateZ((i - 2) * 0.18); g.translate((i - 2) * 0.02, 0, (i % 2) * 0.02); P.push(part(g, color, { sway: 1.2, swayByY: true })); }
  }
  const g = merge(P); cache.set(k, g); return g;
}

export function createModelMaterial(kind = 'plant') {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = modelUniforms.uTime; sh.uniforms.uWind = modelUniforms.uWind; sh.uniforms.uNight = modelUniforms.uNight;
    sh.vertexShader = `attribute float aSway; attribute float aFlap; attribute float aWag; attribute float aGlow; uniform float uTime; uniform float uWind; varying float vGlow;\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = 0.0;
      #ifdef USE_INSTANCING
        ph = dot(instanceMatrix[3].xyz, vec3(1.7, 2.3, 3.1));
      #endif
      vGlow = aGlow;
      transformed.x += aSway * aSway * sin(uTime * 1.6 + ph) * 0.06 * uWind;
      transformed.z += aSway * aSway * cos(uTime * 1.3 + ph) * 0.04 * uWind;
      transformed.y += aFlap * sin(uTime * 18.0 + ph) * 0.02;
      transformed.x += aWag * sin(uTime * 8.0 + ph) * 0.01;`);
    sh.fragmentShader = `uniform float uNight; varying float vGlow;\n` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * vGlow * (0.35 + 0.9 * uNight);`);
  };
  return m;
}
