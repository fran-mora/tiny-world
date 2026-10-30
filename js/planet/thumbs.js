// Renders small portrait images of species models (once), cached as data URLs.
import * as THREE from 'three';
import { PLANTS, ANIMALS } from '../data/species.js';

const cache = new Map();
let pending = null;

export function thumb(id) { return cache.get(id) || null; }

export function thumbEl(id, fallbackIcon = '') {
  const url = cache.get(id);
  if (url) { const img = new Image(); img.src = url; img.alt = ''; img.draggable = false; return img; }
  const d = document.createElement('div');
  d.innerHTML = fallbackIcon;
  return d.firstChild || d;
}

export function renderThumbs(Models, size = 128) {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    let renderer;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { resolve(cache); return; }
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#cfe6ff', '#3a2f2a', 1.1));
    const dl = new THREE.DirectionalLight('#fff2dc', 2.4); dl.position.set(2, 3, 2.5); scene.add(dl);
    const rim = new THREE.DirectionalLight('#9fd8ff', 1.0); rim.position.set(-2, 1, -2); scene.add(rim);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const mats = { plant: Models.createModelMaterial('plant'), animal: Models.createModelMaterial('animal') };
    const shoot = (id, geo, kind) => {
      const mesh = new THREE.Mesh(geo, mats[kind]);
      scene.add(mesh);
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
      const r = Math.max(s.x, s.y, s.z) * 0.62 + 0.01;
      const dist = r / Math.tan((cam.fov * Math.PI) / 360) * 1.25;
      const dir = kind === 'animal' ? new THREE.Vector3(0.9, 0.55, 1.1) : new THREE.Vector3(0.7, 0.42, 1);
      dir.normalize();
      cam.position.copy(c).addScaledVector(dir, dist);
      cam.lookAt(c);
      renderer.render(scene, cam);
      cache.set(id, renderer.domElement.toDataURL('image/png'));
      scene.remove(mesh);
    };
    try {
      for (const p of PLANTS) {
        if (p.kind === 'ocean') { shoot(p.id, Models.decorGeometry('kelp', 0), 'plant'); continue; }
        if (p.kind === 'cover') { shoot(p.id, Models.decorGeometry(p.id === 'moss' ? 'tuft_moss' : 'tuft_grass', 0), 'plant'); continue; }
        const info = Models.MODEL_INFO[p.id] || {};
        shoot(p.id, Models.plantGeometry(p.id, 0, !!info.flowering), 'plant');
      }
      for (const a of ANIMALS) shoot(a.id, Models.animalGeometry(a.id), 'animal');
    } catch (e) { console.warn('thumb render failed', e); }
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) {}
    resolve(cache);
  });
  return pending;
}
