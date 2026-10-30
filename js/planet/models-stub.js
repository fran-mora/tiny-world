// Fallback models used only if js/planet/models.js fails to load. Simple primitives with the same API.
import * as THREE from 'three';
import { PLANT, ANIMAL } from '../data/species.js';

export const modelUniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uNight: { value: 0 } };
const H = { fern: 0.35, flower: 0.3, bush: 0.45, mushroom: 0.25, cactus: 0.6, pine: 1.3, oak: 1.3, palm: 1.4, worldtree: 4, moss: 0.1, grass: 0.15 };
export const MODEL_INFO = {};
for (const id of Object.keys(PLANT)) MODEL_INFO[id] = { variants: 1, flowering: false, height: H[id] || 0.3 };
for (const id of Object.keys(ANIMAL)) MODEL_INFO[id] = { variants: 1, flowering: false, height: 0.2 };

function finish(g, color) {
  g = g.toNonIndexed();
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const a of ['aSway', 'aFlap', 'aWag', 'aGlow']) g.setAttribute(a, new THREE.BufferAttribute(new Float32Array(n), 1));
  g.computeVertexNormals();
  return g;
}
const cache = new Map();
export function plantGeometry(id, variant = 0, flowering = false) {
  const k = id + variant + flowering; if (cache.has(k)) return cache.get(k);
  const h = MODEL_INFO[id]?.height || 0.3;
  const g = new THREE.ConeGeometry(h * 0.35, h, 6); g.translate(0, h / 2, 0);
  const r = finish(g, PLANT[id]?.color || '#5a5'); cache.set(k, r); return r;
}
export function animalGeometry(id) {
  if (cache.has(id)) return cache.get(id);
  const s = ANIMAL[id]?.size || 0.15;
  const g = new THREE.SphereGeometry(s * 0.5, 8, 6); g.scale(0.8, 0.7, 1.2); g.translate(0, s * 0.35, 0);
  const r = finish(g, ANIMAL[id]?.color || '#fff'); cache.set(id, r); return r;
}
export function decorGeometry(id, variant = 0) {
  const k = 'd' + id + variant; if (cache.has(k)) return cache.get(k);
  let g, color = '#888';
  if (id === 'rock') { g = new THREE.DodecahedronGeometry(0.15, 0); color = '#776f68'; }
  else if (id === 'cloud') { g = new THREE.IcosahedronGeometry(0.8, 1); g.scale(1.6, 0.6, 1); color = '#ffffff'; }
  else if (id === 'kelp') { g = new THREE.ConeGeometry(0.05, 0.5, 4); g.translate(0, 0.25, 0); color = '#2f8f5f'; }
  else if (id === 'sprout') { g = new THREE.ConeGeometry(0.04, 0.12, 4); g.translate(0, 0.06, 0); color = '#7fdf7f'; }
  else { g = new THREE.ConeGeometry(0.05, 0.12, 4); g.translate(0, 0.06, 0); color = id === 'tuft_moss' ? '#3f7a45' : id === 'tuft_dry' ? '#c4b35d' : '#79bd4c'; }
  const r = finish(g, color); cache.set(k, r); return r;
}
export function createModelMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
}
