// Three.js renderer for the planet: terrain, water, atmosphere, sky, clouds, instanced plants,
// animals, ground tufts, particles, selection marker, suitability overlay, and the camera rig.
import * as THREE from 'three';
import { R } from './world.js';
import { PLANTS, ANIMALS, PLANT } from '../data/species.js';
import { COVER_IDS } from './sim.js';
import { clamp, lerp, smoothstep } from '../rng.js';

const C = (hex) => new THREE.Color(hex);
const PAL = {
  oceanDeep: C('#0b1d38'), oceanShallow: C('#2b6474'),
  sand: C('#d6c08a'), sandBarren: C('#a99c84'),
  rockLow: C('#4d4743'), rockMid: C('#675e57'), rockHigh: C('#827970'), peak: C('#a29a91'),
  snow: C('#eef4f8'), soil: C('#5a3e2a'), detritus: C('#3a2a1d'),
  moss: C('#3f7a45'), mossLight: C('#69a35a'),
  grass: C('#79bd4c'), grassLush: C('#4e9c3b'), grassDry: C('#c4b35d'),
  dry: C('#b3966a'), wet: C('#3d5a52'),
  ovGood: C('#5dff9a'), ovMid: C('#ffd25d'), ovBad: C('#ff5468'),
};
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

function hash(i, k = 0) { let h = (i * 374761393 + k * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export class PlanetRenderer {
  constructor(container, world, eco, Models, settings) {
    this.container = container; this.world = world; this.eco = eco; this.M = Models; this.settings = settings;
    this.time = 0;
    this.overlayFn = null;
    this.instPlants = new Map();
    this.instAnimals = new Map();
    this.instDecor = new Map();
    this.lastTuftSync = -10; this.lastPlantSync = -10;
    this.autoRotate = 0;
    this.initRenderer();
    this.initScene();
    this.rig = new CameraRig(this.camera, this.renderer.domElement, this);
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ------------------------------------------------------------ setup
  initRenderer() {
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = Math.min(dpr, this.settings.battery ? 1 : 1.75);
    const r = new THREE.WebGLRenderer({ antialias: this.pixelRatio < 1.5, powerPreference: 'high-performance', alpha: false });
    r.setPixelRatio(this.pixelRatio);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = !!this.settings.shadows && !this.settings.battery;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    r.domElement.style.position = 'absolute'; r.domElement.style.inset = '0';
    r.domElement.style.width = '100%'; r.domElement.style.height = '100%';
    this.container.appendChild(r.domElement);
  }

  setQuality(settings) {
    this.settings = settings;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = Math.min(dpr, settings.battery ? 1 : 1.75);
    this.renderer.setPixelRatio(this.pixelRatio);
    const sh = !!settings.shadows && !settings.battery;
    if (sh !== this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = sh;
      this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
    this.resize();
  }

  initScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color('#02050c');
    this.scene = s;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1200);

    // lights
    this.hemi = new THREE.HemisphereLight('#b7d2ff', '#2a2018', 0.55);
    s.add(this.hemi);
    this.amb = new THREE.AmbientLight('#3a5a9a', 0.22);
    s.add(this.amb);
    const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
    s.add(sun); s.add(sun.target);
    this.sun = sun;

    this.planet = new THREE.Group();
    s.add(this.planet);

    this.buildStars();
    this.buildTerrain();
    this.buildWater();
    this.buildAtmosphere();
    this.buildSunSprite();
    this.buildMarker();
    this.particles = new Particles(this.planet, 900);
    this.clouds = new Clouds(this, this.M);
    this.buildDecorStatic();
  }

  buildStars() {
    const n = 1600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 400 + Math.random() * 300;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const t = Math.random();
      const c = t < 0.15 ? C('#ffd2a8') : t < 0.3 ? C('#a8c8ff') : C('#ffffff');
      col.set([c.r, c.g, c.b], i * 3);
      sz[i] = Math.pow(Math.random(), 3) * 3.2 + 0.7; ph[i] = Math.random() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 } },
      vertexShader: `attribute float size; attribute float phase; varying vec3 vC; varying float vA; uniform float uTime; uniform float uPR;
        void main(){ vC = color; vA = 0.55 + 0.45*sin(uTime*1.3 + phase*3.0); vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = size*uPR; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); float a = smoothstep(0.5,0.0,r); gl_FragColor = vec4(vC*a*vA, 1.0); }`,
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, m);
    this.scene.add(this.stars);
    // soft nebula sprites
    const neb = (color, x, y, z, scale) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const cx = cv.getContext('2d');
      const gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
      sp.position.set(x, y, z); sp.scale.setScalar(scale);
      this.scene.add(sp);
    };
    neb('rgba(90,60,180,0.35)', -300, 120, -380, 520);
    neb('rgba(30,120,170,0.3)', 380, -160, -200, 460);
    neb('rgba(170,60,120,0.18)', 120, 320, 360, 420);
  }

  buildSunSprite() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.12, 'rgba(255,236,190,0.9)'); gr.addColorStop(0.4, 'rgba(255,190,120,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.setScalar(70);
    this.scene.add(this.sunSprite);
  }

  // ---------- terrain ----------
  buildTerrain() {
    const w = this.world, nF = w.nFaces;
    const g = new THREE.BufferGeometry();
    this.tPos = new Float32Array(nF * 9);
    this.tCol = new Float32Array(nF * 9);
    g.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3));
    this.terrainGeo = g;
    this.tileColors = new Float32Array(w.n * 3);
    this.updateTerrainPositions();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.93, metalness: 0 });
    this.terrain = new THREE.Mesh(g, m);
    this.terrain.castShadow = true; this.terrain.receiveShadow = true;
    this.planet.add(this.terrain);
    this.updateTerrainColors();
  }

  updateTerrainPositions() {
    const w = this.world, F = w.faces, P = w.pos;
    const rad = new Float32Array(w.n);
    for (let i = 0; i < w.n; i++) rad[i] = w.radiusAt(i);
    this.tileRadius = rad;
    for (let f = 0; f < w.nFaces; f++) {
      for (let k = 0; k < 3; k++) {
        const v = F[f * 3 + k], r = rad[v];
        this.tPos[f * 9 + k * 3] = P[v * 3] * r; this.tPos[f * 9 + k * 3 + 1] = P[v * 3 + 1] * r; this.tPos[f * 9 + k * 3 + 2] = P[v * 3 + 2] * r;
      }
    }
    this.terrainGeo.attributes.position.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    this.terrainGeo.computeBoundingSphere();
  }

  tileColor(i, out) {
    const w = this.world, eco = this.eco, era = eco.game.state.era;
    const e = w.elev[i];
    if (w.ocean[i]) {
      out.copy(PAL.oceanShallow).lerp(PAL.oceanDeep, Math.min(1, -e * 1.4));
      return out;
    }
    // rock by elevation
    if (e < 0.3) out.copy(PAL.rockLow).lerp(PAL.rockMid, e / 0.3);
    else if (e < 0.65) out.copy(PAL.rockMid).lerp(PAL.rockHigh, (e - 0.3) / 0.35);
    else out.copy(PAL.rockHigh).lerp(PAL.peak, Math.min(1, (e - 0.65) / 0.3));
    if (w.coastDist[i] === 1 && e < 0.09) out.lerp(era >= 2 ? PAL.sand : PAL.sandBarren, 0.85);
    const f = eco.fert[i];
    if (f > 0) out.lerp(PAL.soil, Math.min(0.8, f * 0.9));
    const d = eco.detritus[i];
    if (d > 0.02) out.lerp(PAL.detritus, Math.min(0.5, d * 0.9));
    const m = eco.moist(i), t = eco.temp(i);
    const k = eco.coverSp[i], c = eco.cover[i];
    if (k && c > 0.01) {
      if (k === 1) { tmpC.copy(PAL.moss).lerp(PAL.mossLight, clamp(f * 0.8, 0, 1)); out.lerp(tmpC, Math.min(0.95, c * 1.05)); }
      else {
        if (m < 0.3) tmpC.copy(PAL.grassDry).lerp(PAL.grass, clamp((m - 0.12) / 0.18, 0, 1));
        else tmpC.copy(PAL.grass).lerp(PAL.grassLush, clamp((m - 0.5) / 0.4, 0, 1));
        out.lerp(tmpC, Math.min(0.97, c * 1.1));
      }
    }
    const mm = eco.moistMod[i];
    if (mm > 0.08) out.lerp(PAL.wet, Math.min(0.25, mm * 0.4));
    else if (mm < -0.1) out.lerp(PAL.dry, Math.min(0.55, -mm * 1.1));
    if (t < 0.14) out.lerp(PAL.snow, smoothstep(0.14, 0.04, t) * (1 - c * 0.5));
    return out;
  }

  updateTerrainColors(onlyChanged = false) {
    const w = this.world, eco = this.eco, TC = this.tileColors;
    let tiles;
    if (onlyChanged && eco.changedTiles.size < 600) tiles = [...eco.changedTiles];
    else tiles = null;
    const doTile = (i) => {
      this.tileColor(i, tmpC2);
      if (this.overlayFn && !w.ocean[i]) {
        const s = this.overlayFn(i);
        if (s != null) {
          const oc = s >= 0.55 ? PAL.ovGood : s >= 0.3 ? PAL.ovMid : PAL.ovBad;
          tmpC2.lerp(oc, 0.5);
        }
      }
      TC[i * 3] = tmpC2.r; TC[i * 3 + 1] = tmpC2.g; TC[i * 3 + 2] = tmpC2.b;
    };
    const faces = new Set();
    if (tiles) { for (const i of tiles) { doTile(i); for (const f of w.vertFaces[i]) faces.add(f); } }
    else for (let i = 0; i < w.n; i++) doTile(i);
    const F = w.faces, col = this.tCol;
    const doFace = (f) => {
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      const j = 0.94 + hash(f, 7) * 0.1;
      const r = (TC[a * 3] + TC[b * 3] + TC[c * 3]) / 3 * j, g = (TC[a * 3 + 1] + TC[b * 3 + 1] + TC[c * 3 + 1]) / 3 * j, bl = (TC[a * 3 + 2] + TC[b * 3 + 2] + TC[c * 3 + 2]) / 3 * j;
      for (let k = 0; k < 3; k++) { col[f * 9 + k * 3] = r; col[f * 9 + k * 3 + 1] = g; col[f * 9 + k * 3 + 2] = bl; }
    };
    if (tiles) faces.forEach(doFace); else for (let f = 0; f < w.nFaces; f++) doFace(f);
    eco.changedTiles.clear();
    this.terrainGeo.attributes.color.needsUpdate = true;
  }

  setOverlay(fn) { this.overlayFn = fn; this.updateTerrainColors(false); }

  // ---------- water ----------
  buildWater() {
    const g = new THREE.IcosahedronGeometry(R, 5);
    const m = new THREE.MeshStandardMaterial({ color: '#1a3d74', transparent: true, opacity: 0.84, roughness: 0.22, metalness: 0.05, flatShading: true, emissive: '#06142b' });
    this.waterUniforms = { uTime: { value: 0 } };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.waterUniforms.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float wv = sin(position.x*1.9 + uTime*0.9) * sin(position.z*1.7 + uTime*0.7) + sin(position.y*2.3 - uTime*0.8)*0.6;
        transformed += normal * wv * 0.035;`);
    };
    this.water = new THREE.Mesh(g, m);
    this.water.receiveShadow = true;
    this.water.renderOrder = 2;
    this.planet.add(this.water);
  }

  // ---------- atmosphere ----------
  buildAtmosphere() {
    this.atmoUniforms = { uColor: { value: C('#c98a5a') }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uStrength: { value: 0.6 } };
    const mk = (radius, side, power, mult) => new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms, side, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uColor; uniform vec3 uSun; uniform float uStrength; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 v = normalize(cameraPosition - vW); float f = ${side === THREE.BackSide ? `pow(clamp(0.72 + dot(v, vN), 0.0, 1.0), ${power.toFixed(1)})` : `pow(1.0 - clamp(dot(v, vN), 0.0, 1.0), ${power.toFixed(1)})`};
          float lit = 0.25 + 0.75*smoothstep(-0.35, 0.6, dot(normalize(vW), uSun));
          gl_FragColor = vec4(uColor * f * lit * uStrength * ${mult.toFixed(2)}, 1.0); }`,
    }));
    this.atmoOuter = mk(R * 1.2, THREE.BackSide, 4.0, 1.4);
    this.atmoInner = mk(R * 1.065, THREE.FrontSide, 3.0, 0.9);
    this.planet.add(this.atmoOuter); this.planet.add(this.atmoInner);
  }

  updateAtmosphere() {
    const o2 = this.eco.oxygen, algae = this.eco.algae;
    const t = clamp(o2 / 18, 0, 1);
    this.atmoUniforms.uColor.value.copy(C('#b97a52')).lerp(C('#5fb8ff'), t);
    this.atmoUniforms.uStrength.value = 0.45 + 0.55 * t;
    const wc = C('#142c55').lerp(C('#1f6e8a'), clamp(algae * 1.2, 0, 1)).lerp(C('#1d7f74'), clamp((algae - 0.5) * 1.2, 0, 1) * 0.6);
    this.water.material.color.copy(wc);
  }

  // ---------- marker ----------
  buildMarker() {
    const g = new THREE.RingGeometry(0.34, 0.46, 40);
    g.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.marker.visible = false; this.marker.renderOrder = 5;
    this.planet.add(this.marker);
  }
  setMarker(tile, color = '#ffffff', scale = 1) {
    if (tile == null || tile < 0) { this.marker.visible = false; this.markerTile = null; return; }
    this.markerTile = tile;
    const w = this.world, P = w.pos;
    _y.set(P[tile * 3], P[tile * 3 + 1], P[tile * 3 + 2]);
    const r = Math.max(R + 0.02, this.tileRadius[tile]) + 0.04;
    this.orientTo(_y, 0, r, scale, this.marker);
    this.marker.material.color.set(color);
    this.marker.visible = true;
    this.markerScale = scale;
  }

  orientTo(up, rot, r, scale, obj) {
    _y.copy(up).normalize();
    _x.set(0, 1, 0); if (Math.abs(_y.y) > 0.95) _x.set(1, 0, 0);
    _z.crossVectors(_x, _y).normalize(); _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    obj.position.copy(_y).multiplyScalar(r);
    obj.quaternion.copy(_q);
    obj.rotateY(rot);
    obj.scale.setScalar(scale);
  }

  // ---------- instancing helpers ----------
  getInst(map, key, geoFn, kind, capacity, shadows = true) {
    let e = map.get(key);
    if (e && e.capacity >= capacity) return e;
    const geo = e ? e.mesh.geometry : geoFn();
    const mat = e ? e.mesh.material : this.materialFor(kind);
    const cap = Math.max(capacity, e ? e.capacity * 2 : 32);
    if (e) { this.planet.remove(e.mesh); e.mesh.dispose(); }
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false;
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.planet.add(mesh);
    e = { mesh, capacity: cap };
    map.set(key, e);
    return e;
  }
  materialFor(kind) {
    this._mats ||= {};
    if (!this._mats[kind]) this._mats[kind] = this.M.createModelMaterial(kind === 'tuft' ? 'decor' : kind);
    return this._mats[kind];
  }

  placeMatrix(up, rot, r, scale, out, jitterSeed = -1, jitterAmt = 0) {
    _y.copy(up);
    if (jitterSeed >= 0 && jitterAmt > 0) {
      _x.set(0, 1, 0); if (Math.abs(_y.y) > 0.95) _x.set(1, 0, 0);
      _z.crossVectors(_x, _y).normalize(); _x.crossVectors(_y, _z).normalize();
      _y.addScaledVector(_x, (hash(jitterSeed, 1) - 0.5) * jitterAmt).addScaledVector(_z, (hash(jitterSeed, 2) - 0.5) * jitterAmt);
    }
    _y.normalize();
    _x.set(0, 1, 0); if (Math.abs(_y.y) > 0.95) _x.set(1, 0, 0);
    _z.crossVectors(_x, _y).normalize(); _x.crossVectors(_y, _z).normalize();
    // rotate x,z around y by rot
    const c = Math.cos(rot), s = Math.sin(rot);
    const xx = _x.x * c - _z.x * s, xy = _x.y * c - _z.y * s, xz = _x.z * c - _z.z * s;
    const zx = _x.x * s + _z.x * c, zy = _x.y * s + _z.y * c, zz = _x.z * s + _z.z * c;
    out.set(xx * scale, _y.x * scale, zx * scale, _y.x * r,
      xy * scale, _y.y * scale, zy * scale, _y.y * r,
      xz * scale, _y.z * scale, zz * scale, _y.z * r,
      0, 0, 0, 1);
    return out;
  }

  // ---------- plants ----------
  syncPlants() {
    const eco = this.eco, w = this.world, P = w.pos;
    const groups = new Map();
    for (const p of eco.plants) {
      if (p.dead) continue;
      const sp = PLANTS[p.sp];
      let key, id = sp.id, variant = 0, flowering = false;
      if (p.growth < 0.12) { key = 'sprout'; }
      else {
        const info = this.M.MODEL_INFO[id] || { variants: 1 };
        variant = p.variant % Math.max(1, info.variants);
        flowering = !!(info.flowering && p.flowering);
        key = `${id}|${variant}|${flowering ? 1 : 0}`;
      }
      let arr = groups.get(key); if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(p);
    }
    // hide groups that vanished
    for (const [key, e] of this.instPlants) if (!groups.has(key)) e.mesh.count = 0;
    for (const [key, arr] of groups) {
      let e;
      if (key === 'sprout') e = this.getInst(this.instPlants, key, () => this.M.decorGeometry('sprout', 0), 'plant', arr.length, false);
      else {
        const [id, v, fl] = key.split('|');
        const big = ['pine', 'oak', 'palm', 'worldtree', 'bush', 'cactus'].includes(id);
        e = this.getInst(this.instPlants, key, () => this.M.plantGeometry(id, +v, fl === '1'), 'plant', arr.length, big);
      }
      const mesh = e.mesh;
      let n = 0;
      for (const p of arr) {
        const sp = PLANTS[p.sp];
        _p.set(P[p.tile * 3], P[p.tile * 3 + 1], P[p.tile * 3 + 2]);
        const g = key === 'sprout' ? 0.6 + p.growth * 3 : 0.18 + 0.82 * Math.pow(p.growth, 0.8);
        const big = sp.layer === 'tree';
        const r = Math.max(R + 0.01, this.tileRadius[p.tile]) - 0.02;
        this.placeMatrix(_p, p.rot, r, p.scale * g, _m, sp.unique ? -1 : p.tile, big ? 0.05 : 0.075);
        mesh.setMatrixAt(n, _m);
        // health tint
        const h = clamp(p.health, 0, 1);
        tmpC.setRGB(1, 1, 1).lerp(tmpC2.setRGB(0.72, 0.52, 0.32), (1 - h) * 0.85);
        mesh.setColorAt(n, tmpC);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    eco.dirtyPlants = false;
  }

  // ---------- tufts (ground cover detail) ----------
  syncTufts() {
    const eco = this.eco, w = this.world, P = w.pos;
    const lists = { tuft_moss: [], tuft_grass: [], tuft_dry: [] };
    for (let i = 0; i < w.n; i++) {
      const k = eco.coverSp[i], c = eco.cover[i];
      if (!k || c < 0.28 || w.ocean[i]) continue;
      const type = k === 1 ? 'tuft_moss' : eco.moist(i) < 0.26 ? 'tuft_dry' : 'tuft_grass';
      const count = c > 0.72 ? 3 : c > 0.5 ? 2 : 1;
      for (let j = 0; j < count; j++) lists[type].push([i, j, c]);
    }
    for (const [type, arr] of Object.entries(lists)) {
      const e = this.getInst(this.instDecor, type, () => this.M.decorGeometry(type, 0), 'tuft', arr.length, false);
      const mesh = e.mesh;
      let n = 0;
      for (const [i, j, c] of arr) {
        _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const r = this.tileRadius[i] - 0.01;
        this.placeMatrix(_p, hash(i, j + 3) * 6.28, r, (0.75 + hash(i, j + 9) * 0.6) * (0.5 + c * 0.6), _m, i * 7 + j, 0.075);
        mesh.setMatrixAt(n++, _m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    // kelp grows with algae
    const kelpTiles = [];
    if (eco.algae > 0.2) {
      for (const i of w.oceanTiles) if (w.elev[i] > -0.35 && hash(i, 77) < (eco.algae - 0.2) * 0.9) kelpTiles.push(i);
    }
    const ek = this.getInst(this.instDecor, 'kelp', () => this.M.decorGeometry('kelp', 0), 'plant', kelpTiles.length, false);
    let n = 0;
    for (const i of kelpTiles) {
      _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      this.placeMatrix(_p, hash(i, 5) * 6.28, this.tileRadius[i] - 0.02, 0.8 + hash(i, 6) * 0.7, _m, i, 0.07);
      ek.mesh.setMatrixAt(n++, _m);
    }
    ek.mesh.count = n; ek.mesh.instanceMatrix.needsUpdate = true;
  }

  buildDecorStatic() {
    // scattered rocks on barren land
    const w = this.world, P = w.pos;
    for (let v = 0; v < 3; v++) {
      const tiles = w.landTiles.filter((i) => hash(i, 41) < 0.06 && Math.floor(hash(i, 42) * 3) === v);
      const e = this.getInst(this.instDecor, 'rock' + v, () => this.M.decorGeometry('rock', v), 'decor', tiles.length, true);
      let n = 0;
      for (const i of tiles) {
        _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        this.placeMatrix(_p, hash(i, 43) * 6.28, this.tileRadius[i] - 0.04, 0.6 + hash(i, 44) * 0.9, _m, i, 0.1);
        e.mesh.setMatrixAt(n++, _m);
      }
      e.mesh.count = n; e.mesh.instanceMatrix.needsUpdate = true;
      e.tiles = tiles;
    }
  }

  // ---------- animals ----------
  syncAnimals(alpha) {
    const eco = this.eco;
    const groups = new Map();
    for (const a of eco.animals) { if (a.dead) continue; let arr = groups.get(a.sp); if (!arr) { arr = []; groups.set(a.sp, arr); } arr.push(a); }
    for (const [sp, e] of this.instAnimals) if (!groups.has(sp)) e.mesh.count = 0;
    const t = this.time;
    for (const [spi, arr] of groups) {
      const sp = ANIMALS[spi];
      const e = this.getInst(this.instAnimals, spi, () => this.M.animalGeometry(sp.id), 'animal', arr.length + 8, sp.size > 0.12);
      const mesh = e.mesh;
      let n = 0;
      for (const a of arr) {
        let x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha, z = a.pz + (a.z - a.pz) * alpha;
        const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
        let r = a.pr + (a.r - a.pr) * alpha;
        const alt = a.palt + (a.alt - a.palt) * alpha;
        if (sp.aquatic) r = R - 0.14 - 0.05 * Math.sin(t * 0.8 + a.phase);
        else if (sp.flying) r += alt + 0.15;
        else {
          if (sp.hops && a.moving > 0.05) r += Math.abs(Math.sin(t * 9 + a.phase)) * 0.08;
          else if (a.moving > 0.05) r += Math.abs(Math.sin(t * 7 + a.phase)) * 0.012;
        }
        _y.set(x, y, z);
        _z.set(a.hx, a.hy, a.hz);
        const d = _z.dot(_y); _z.addScaledVector(_y, -d).normalize();
        _x.crossVectors(_y, _z);
        const grow = a.age < sp.mature ? 0.55 + 0.45 * a.age / sp.mature : 1;
        const s = Math.sqrt(a.genes.size) * grow;
        _m.set(_x.x * s, _y.x * s, _z.x * s, x * r,
          _x.y * s, _y.y * s, _z.y * s, y * r,
          _x.z * s, _y.z * s, _z.z * s, z * r,
          0, 0, 0, 1);
        if (sp.flying && sp.id === 'hawk') { _m.multiply(new THREE.Matrix4().makeRotationZ(Math.sin(t * 0.7 + a.phase) * 0.25)); }
        mesh.setMatrixAt(n, _m);
        // starving animals look dull
        const en = clamp(a.energy * 2, 0.4, 1);
        tmpC.setRGB(en, en, en);
        mesh.setColorAt(n, tmpC);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  animalScreenPositions() {
    const out = [];
    const eco = this.eco, cam = this.camera;
    const camDir = cam.position.clone().normalize();
    for (const a of eco.animals) {
      if (a.dead) continue;
      _p.set(a.x, a.y, a.z);
      if (_p.dot(camDir) < 0.2) continue; // back side
      const sp = ANIMALS[a.sp];
      const r = sp.aquatic ? R - 0.12 : a.r + (sp.flying ? a.alt + 0.15 : 0.08);
      _p.multiplyScalar(r).project(cam);
      out.push({ a, x: (_p.x + 1) / 2 * this.width, y: (1 - _p.y) / 2 * this.height });
    }
    return out;
  }

  // ---------- picking ----------
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    // animals first (screen-space)
    let best = null, bd = 30 * 30;
    for (const s of this.animalScreenPositions()) {
      const d = (s.x - sx) ** 2 + (s.y - sy) ** 2;
      if (d < bd) { bd = d; best = s.a; }
    }
    const ndc = new THREE.Vector2(sx / rect.width * 2 - 1, -(sy / rect.height) * 2 + 1);
    this.ray ||= new THREE.Raycaster();
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects([this.terrain, this.water], false);
    let tile = null;
    if (hits.length) {
      const p = hits[0].point.clone().normalize();
      tile = this.world.nearestTile(p.x, p.y, p.z, this.markerTile ?? 0);
    }
    return { tile, animal: best };
  }

  tileScreenPos(tile) {
    const P = this.world.pos;
    _p.set(P[tile * 3], P[tile * 3 + 1], P[tile * 3 + 2]).multiplyScalar(this.tileRadius[tile] + 0.2).project(this.camera);
    return { x: (_p.x + 1) / 2 * this.width, y: (1 - _p.y) / 2 * this.height, visible: _p.z < 1 };
  }
  tileWorld(tile, lift = 0) {
    const P = this.world.pos;
    return new THREE.Vector3(P[tile * 3], P[tile * 3 + 1], P[tile * 3 + 2]).multiplyScalar(Math.max(R, this.tileRadius[tile]) + lift);
  }

  // ---------- effects ----------
  fxPlant(tile, color = '#b8ffcf') { this.particles.burst(this.tileWorld(tile, 0.15), C(color), 18, { speed: 0.8, up: 1.2, life: 0.9, size: 9 }); }
  fxRelease(tile, color = '#ffe9b0') { this.particles.burst(this.tileWorld(tile, 0.2), C(color), 26, { speed: 1.3, up: 1.6, life: 1.1, size: 10 }); }
  fxPuff(pos, color = '#ffffff', n = 8) { this.particles.burst(pos, C(color), n, { speed: 0.5, up: 0.6, life: 0.7, size: 7 }); }
  fxRain(tile) {
    this.clouds.rainCloud(tile);
  }
  fxFertilize(tile) { this.particles.burst(this.tileWorld(tile, 0.2), C('#ffd27a'), 40, { speed: 1.4, up: 1.0, life: 1.4, size: 9 }); }
  fxMeteor(tile) {
    const target = this.tileWorld(tile, 0.1);
    const start = target.clone().normalize().multiplyScalar(R + 14).add(new THREE.Vector3(6, 4, -5));
    this.meteor = { t: 0, start, target, tile };
  }

  // ---------- frame ----------
  render(dt, alpha) {
    this.time += dt;
    const eco = this.eco;
    this.M.modelUniforms.uTime.value = this.time;
    this.waterUniforms.uTime.value = this.time;
    this.stars.material.uniforms.uTime.value = this.time;
    this.stars.material.uniforms.uPR.value = this.pixelRatio;

    // sun orbit (one revolution per game day)
    const dayFrac = (eco.day % 1);
    const ang = dayFrac * Math.PI * 2 + 0.6;
    const sd = new THREE.Vector3(Math.cos(ang), 0.32, Math.sin(ang)).normalize();
    this.sun.position.copy(sd).multiplyScalar(40);
    this.sun.target.position.set(0, 0, 0);
    this.sunSprite.position.copy(sd).multiplyScalar(420);
    this.atmoUniforms.uSun.value.copy(sd);
    const camDir = this.camera.position.clone().normalize();
    const night = clamp(0.5 - camDir.dot(sd) * 0.9, 0, 1);
    this.M.modelUniforms.uNight.value = night;
    this.M.modelUniforms.uWind.value = 0.8 + 0.4 * Math.sin(this.time * 0.13);

    if (eco.terrainChanged) { this.updateTerrainPositions(); eco.terrainChanged = false; this.updateTerrainColors(false); this.syncTufts(); this.buildDecorStatic(); }
    if (eco.dirtyTiles && this.time - (this.lastTileSync || 0) > 0.35) { this.updateTerrainColors(true); eco.dirtyTiles = false; this.lastTileSync = this.time; }
    if (this.time - this.lastTuftSync > 1.5) { this.syncTufts(); this.lastTuftSync = this.time; this.updateAtmosphere(); }
    if (eco.dirtyPlants || this.time - this.lastPlantSync > 0.5) { this.syncPlants(); this.lastPlantSync = this.time; }
    this.syncAnimals(alpha);

    // marker pulse
    if (this.marker.visible) {
      const s = (this.markerScale || 1) * (1 + Math.sin(this.time * 5) * 0.08);
      this.marker.scale.setScalar(s);
      this.marker.material.opacity = 0.65 + Math.sin(this.time * 5) * 0.25;
    }

    // meteor animation
    if (this.meteor) {
      const m = this.meteor; m.t += dt;
      const k = Math.min(1, m.t / 1.1);
      const p = m.start.clone().lerp(m.target, k * k);
      this.particles.burst(p, C('#ffb35c'), 4, { speed: 0.4, up: 0, life: 0.6, size: 14 });
      this.particles.burst(p, C('#ffffff'), 1, { speed: 0.1, up: 0, life: 0.3, size: 20 });
      if (k >= 1) {
        this.particles.burst(m.target, C('#ff9a4a'), 90, { speed: 4, up: 3, life: 1.6, size: 14 });
        this.particles.burst(m.target, C('#fff2c0'), 40, { speed: 2, up: 4, life: 1.0, size: 18 });
        this.rig.shake = 0.6;
        this.meteor = null;
        this.onMeteorHit && this.onMeteorHit(m.tile);
      }
    }

    this.clouds.update(dt);
    this.particles.update(dt);
    this.rig.update(dt);
    if (this.autoRotate) this.rig.yaw += dt * this.autoRotate;
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, r.width); this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    // keep planet comfortably in view on tall phones
    this.camera.fov = this.camera.aspect < 0.7 ? 52 : 38;
    this.camera.updateProjectionMatrix();
    if (this.rig) this.rig.maxDist = Math.max(46, this.fitDist() * 1.15);
  }

  // camera distance at which the whole planet (with atmosphere) fits the narrower screen axis
  fitDist(margin = 1.12) {
    const vf = this.camera.fov * Math.PI / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const f = Math.min(vf, hf);
    return (R * margin) / Math.sin(f / 2);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ---------------------------------------------------------------- camera rig
class CameraRig {
  constructor(camera, dom, owner) {
    this.camera = camera; this.dom = dom; this.owner = owner;
    this.yaw = 0.6; this.pitch = 0.35; this.dist = 34;
    this.tYaw = this.yaw; this.tPitch = this.pitch; this.tDist = this.dist;
    this.vYaw = 0; this.vPitch = 0;
    this.minDist = 13.4; this.maxDist = 46;
    this.shake = 0;
    this.pointers = new Map();
    this.enabled = true;
    this.onTap = null; this.onDoubleTap = null;
    this._down = (e) => this.down(e); this._move = (e) => this.move(e); this._up = (e) => this.up(e); this._wheel = (e) => this.wheel(e);
    dom.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    dom.addEventListener('wheel', this._wheel, { passive: false });
    this.update(0);
  }
  dispose() {
    this.dom.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    this.dom.removeEventListener('wheel', this._wheel);
  }
  down(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.flying = null;
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.tDist }; this.moved = true; }
    else this.moved = false;
    this.vYaw = 0; this.vPitch = 0;
  }
  move(e) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.tDist = clamp(this.pinch.dist * this.pinch.d / Math.max(10, d), this.minDist, this.maxDist);
      return;
    }
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) this.moved = true;
    if (!this.moved) return;
    const k = 0.0052 * (this.dist - R * 0.82) / 22;
    this.tYaw -= dx * k; this.tPitch = clamp(this.tPitch + dy * k, -1.45, 1.45);
    this.vYaw = -dx * k; this.vPitch = dy * k;
  }
  up(e) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!this.moved && this.pointers.size === 0 && performance.now() - p.t < 450) {
      const now = performance.now();
      if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30) {
        this.lastTap = null; this.onDoubleTap && this.onDoubleTap(e.clientX, e.clientY);
      } else {
        this.lastTap = { t: now, x: e.clientX, y: e.clientY };
        this.onTap && this.onTap(e.clientX, e.clientY);
      }
    }
    if (this.pointers.size === 0 && this.moved) this.coast = true;
  }
  wheel(e) {
    e.preventDefault();
    this.tDist = clamp(this.tDist * Math.exp(e.deltaY * 0.0012), this.minDist, this.maxDist);
  }
  flyTo(dir, dist = null) {
    const yaw = Math.atan2(dir.x, dir.z), pitch = Math.asin(clamp(dir.y / dir.length(), -1, 1));
    // shortest yaw path
    let dy = yaw - this.tYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.flying = { yaw: this.tYaw + dy, pitch: clamp(pitch, -1.45, 1.45), dist: dist ?? this.tDist };
  }
  update(dt) {
    if (this.flying) {
      const f = this.flying, k = Math.min(1, dt * 3.2);
      this.tYaw += (f.yaw - this.tYaw) * k; this.tPitch += (f.pitch - this.tPitch) * k; this.tDist += (f.dist - this.tDist) * k;
      if (Math.abs(f.yaw - this.tYaw) < 0.002 && Math.abs(f.dist - this.tDist) < 0.02) this.flying = null;
    } else if (this.coast && this.pointers.size === 0) {
      this.tYaw += this.vYaw; this.tPitch = clamp(this.tPitch + this.vPitch, -1.45, 1.45);
      this.vYaw *= Math.pow(0.04, dt); this.vPitch *= Math.pow(0.04, dt);
      if (Math.abs(this.vYaw) + Math.abs(this.vPitch) < 1e-5) this.coast = false;
    }
    const k = dt === 0 ? 1 : Math.min(1, dt * 12);
    this.yaw += (this.tYaw - this.yaw) * k; this.pitch += (this.tPitch - this.pitch) * k; this.dist += (this.tDist - this.dist) * Math.min(1, dt * 8 || 1);
    const zoomT = clamp((26 - this.dist) / (26 - this.minDist), 0, 1);
    const tilt = smoothstep(0, 1, zoomT) * 0.78;
    const d = new THREE.Vector3(Math.cos(this.pitch) * Math.sin(this.yaw), Math.sin(this.pitch), Math.cos(this.pitch) * Math.cos(this.yaw));
    const target = d.clone().multiplyScalar(R * smoothstep(0, 1, zoomT) * 0.96);
    // camera position tilted "south" for a horizon view when zoomed in
    const right = new THREE.Vector3(0, 1, 0).cross(d).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const camDir = d.clone().applyAxisAngle(right, tilt);
    const pos = camDir.multiplyScalar(this.dist);
    if (this.shake > 0) { pos.x += (Math.random() - 0.5) * this.shake; pos.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 1.2); }
    this.camera.position.copy(pos);
    // keep "up" roughly aligned with world up for stable horizon
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.zoomT = zoomT;
  }
  centerDir() {
    return new THREE.Vector3(Math.cos(this.pitch) * Math.sin(this.yaw), Math.sin(this.pitch), Math.cos(this.pitch) * Math.cos(this.yaw));
  }
}

// ---------------------------------------------------------------- particles
class Particles {
  constructor(parent, cap) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = size * uScale * (30.0 / -mv.z); }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord-0.5); float a = smoothstep(0.5, 0.1, r) * vA; gl_FragColor = vec4(vC * a, a); }`,
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false; this.points.renderOrder = 10;
    parent.add(this.points);
  }
  burst(pos, color, count, { speed = 1, up = 1, life = 1, size = 8 } = {}) {
    const n = pos.clone().normalize();
    for (let k = 0; k < count; k++) {
      if (this.n >= this.cap) return;
      const i = this.n++;
      this.pos[i * 3] = pos.x; this.pos[i * 3 + 1] = pos.y; this.pos[i * 3 + 2] = pos.z;
      const vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2;
      this.vel[i * 3] = vx * speed + n.x * up * Math.random(); this.vel[i * 3 + 1] = vy * speed + n.y * up * Math.random(); this.vel[i * 3 + 2] = vz * speed + n.z * up * Math.random();
      this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
      this.max[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
    }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
          this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j];
        }
        continue;
      }
      const damp = Math.pow(0.15, dt);
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= damp; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      const t = this.life[i] / this.max[i];
      this.alpha[i] = Math.min(1, t * 2.2);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'color', 'size', 'alpha']) this.geo.attributes[a].needsUpdate = true;
  }
}

// ---------------------------------------------------------------- clouds
class Clouds {
  constructor(owner, M) {
    this.owner = owner; this.M = M;
    this.list = [];
    this.meshes = [];
    for (let v = 0; v < 3; v++) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
      const mesh = new THREE.InstancedMesh(M.decorGeometry('cloud', v), mat, 40);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3).fill(1), 3);
      mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false;
      owner.planet.add(mesh);
      this.meshes.push(mesh);
    }
    this.rain = new RainStreaks(owner.planet);
  }
  ensure() {
    const eco = this.owner.eco;
    const want = Math.round(4 + clamp(eco.oxygen / 21, 0, 1) * 18 + eco.algae * 4);
    while (this.list.filter((c) => !c.rain).length < want) {
      const lat = (Math.random() - 0.5) * 2.4;
      this.list.push({ lat, lon: Math.random() * Math.PI * 2, speed: (0.015 + Math.random() * 0.03) * (Math.random() < 0.5 ? 1 : -1), alt: 2.0 + Math.random() * 0.8, v: Math.floor(Math.random() * 3), s: 0.6 + Math.random() * 0.7, rot: Math.random() * 6.28 });
    }
    while (this.list.filter((c) => !c.rain).length > want + 2) this.list.splice(this.list.findIndex((c) => !c.rain), 1);
  }
  rainCloud(tile) {
    const P = this.owner.world.pos;
    const d = new THREE.Vector3(P[tile * 3], P[tile * 3 + 1], P[tile * 3 + 2]);
    const lat = Math.asin(d.y), lon = Math.atan2(d.z, d.x);
    this.list.push({ lat, lon, speed: 0.004, alt: 1.6, v: 0, s: 1.2, rot: Math.random() * 6.28, rain: 4.5, tile });
  }
  update(dt) {
    this.ensure();
    const era = this.owner.eco.game.state.era;
    const base = era <= 1 ? new THREE.Color('#9a8f86') : new THREE.Color('#ffffff');
    const counts = [0, 0, 0];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.lon += c.speed * dt;
      if (c.rain != null) {
        c.rain -= dt;
        if (c.rain > 0) {
          const pos = this.posOf(c);
          this.rain.emit(pos, 6);
        }
        if (c.rain < -6) { this.list.splice(i, 1); continue; }
      }
      const mesh = this.meshes[c.v];
      const k = counts[c.v]++;
      if (k >= 40) continue;
      const pos = this.posOf(c);
      const r = pos.length();
      this.owner.placeMatrix(pos.clone().normalize(), c.rot, r, c.s * (c.rain != null ? 1.1 : 1), _m);
      mesh.setMatrixAt(k, _m);
      if (c.rain != null && c.rain > -3) tmpC.setRGB(0.55, 0.6, 0.7); else tmpC.copy(base);
      mesh.setColorAt(k, tmpC);
    }
    this.meshes.forEach((m, v) => { m.count = Math.min(40, counts[v]); m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
    this.rain.update(dt);
  }
  posOf(c) {
    const cl = Math.cos(c.lat);
    return new THREE.Vector3(cl * Math.cos(c.lon), Math.sin(c.lat), cl * Math.sin(c.lon)).multiplyScalar(R + c.alt);
  }
}

class RainStreaks {
  constructor(parent) {
    this.cap = 500; this.n = 0;
    this.pos = new Float32Array(this.cap * 6); this.life = new Float32Array(this.cap); this.dir = new Float32Array(this.cap * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#a8d4ff', transparent: true, opacity: 0.55, depthWrite: false }));
    this.lines.frustumCulled = false;
    parent.add(this.lines);
  }
  emit(pos, count) {
    const n = pos.clone().normalize();
    for (let k = 0; k < count && this.n < this.cap; k++) {
      const i = this.n++;
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2);
      const p = pos.clone().add(jitter).addScaledVector(n, -0.2);
      this.pos.set([p.x, p.y, p.z, p.x + n.x * 0.25, p.y + n.y * 0.25, p.z + n.z * 0.25], i * 6);
      this.dir.set([-n.x, -n.y, -n.z], i * 3);
      this.life[i] = 0.5 + Math.random() * 0.25;
    }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) { for (let k = 0; k < 6; k++) this.pos[i * 6 + k] = this.pos[j * 6 + k]; for (let k = 0; k < 3; k++) this.dir[i * 3 + k] = this.dir[j * 3 + k]; this.life[i] = this.life[j]; }
        continue;
      }
      const v = 3.2 * dt;
      for (let k = 0; k < 3; k++) { this.pos[i * 6 + k] += this.dir[i * 3 + k] * v; this.pos[i * 6 + 3 + k] += this.dir[i * 3 + k] * v; }
      i++;
    }
    this.geo.setDrawRange(0, this.n * 2);
    this.geo.attributes.position.needsUpdate = true;
  }
}
