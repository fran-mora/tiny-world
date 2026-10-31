// Tiny World — procedural low-poly model library.
//
// Every plant, animal and decor piece is generated here from code (no assets), deterministic per
// (id, variant, flowering) and cached. All geometries are non-indexed, flat-shaded friendly and
// carry exactly: position, normal, color, aSway, aFlap, aWag, aGlow (see README block at the end).
//
// Conventions: plants grow up +Y from the origin; animals face +Z with feet at y=0 (fish and fliers
// are centred on y=0); world units, planet radius 10.

import * as THREE from 'three';
import { RNG, Simplex, hashString } from '../rng.js';
import { PLANT, ANIMAL } from '../data/species.js';

// ---------------------------------------------------------------------------------------------
// small math / colour helpers
// ---------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.507..° — phyllotaxis divergence angle
const UP = new THREE.Vector3(0, 1, 0);
const XAX = new THREE.Vector3(1, 0, 0);
const ZAX = new THREE.Vector3(0, 0, 1);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const seedOf = (id, v) => hashString(`tiny-world-model:${id}:${v}`);

// sRGB hex → linear working-space colour (THREE.ColorManagement converts on parse)
const col = (hex) => new THREE.Color(hex);
const cmix = (a, b, t) => a.clone().lerp(b, clamp01(t));
const cmul = (a, k) => a.clone().multiplyScalar(k);
const toColor = (c) => (c && c.isColor ? c : new THREE.Color(c ?? 0xff00ff));
const WHITE = col('#ffffff');

const rangeF = (rng, r) => rng.float(r[0], r[1]);

// ---------------------------------------------------------------------------------------------
// matrices
// ---------------------------------------------------------------------------------------------
/** Basis matrix: local +Z → fwd, local +Y ≈ upHint, positioned at o. s: number or [sx,sy,sz]. */
function frameM(o, fwd, upHint = UP, s = 1) {
  const z = fwd.clone().normalize();
  const x = new THREE.Vector3().crossVectors(upHint, z);
  if (x.lengthSq() < 1e-10) x.crossVectors(Math.abs(z.y) < 0.9 ? UP : XAX, z);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s, sz = Array.isArray(s) ? s[2] : s;
  const m = new THREE.Matrix4().makeBasis(x.multiplyScalar(sx), y.multiplyScalar(sy), z.multiplyScalar(sz));
  m.setPosition(o);
  return m;
}
/** Local +Y → dir, spun by `spin` about it. */
function alignY(o, dir, spin = 0, s = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin));
  const sc = Array.isArray(s) ? v3(...s) : v3(s, s, s);
  return new THREE.Matrix4().compose(o, q, sc);
}
/** Translate / euler rotate (XYZ) / scale. */
function trs(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const sc = Array.isArray(s) ? v3(...s) : v3(s, s, s);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ'));
  return new THREE.Matrix4().compose(v3(...p), q, sc);
}
const yawM = (a, o = v3(), s = 1) => trs([o.x, o.y, o.z], [0, a, 0], s);
// lathe/tube axis +Y → +Z (for animal bodies built as lathes)
const Y2Z = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const mm = (...ms) => ms.reduce((a, b) => a.clone().multiply(b));

// ---------------------------------------------------------------------------------------------
// Builder: accumulates de-indexed triangles with per-face colour jitter + animation weights
// ---------------------------------------------------------------------------------------------
const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3(), _cen = new THREE.Vector3();
const _ln = new THREE.Vector3(), _lc = new THREE.Vector3();

function val(spec, p, t) {
  if (spec === undefined || spec === null) return 0;
  return typeof spec === 'function' ? spec(p, t) : spec;
}

class Builder {
  constructor(seed, o = {}) {
    this.rng = new RNG((seed >>> 0) || 1);
    this.P = []; this.C = []; this.S0 = []; this.SA = []; this.F = []; this.W = []; this.G = [];
    this.jit = o.jit ?? 0.045;
    this.swayPow = o.swayPow ?? 1;
  }

  /**
   * Add an indexed part {v,t,i}.
   * o.m: Matrix4 (local→model); o.warp(p,t): pre-matrix deform; o.post(p,t): post-matrix deform
   * o.color: Color|hex|fn(centroid, faceNormal, t, rng) (per face); o.colorLocal: evaluate in local space
   * o.vcolor: fn(p, t, faceNormal) per vertex (smooth gradients)
   * o.sway: number|fn(p,t) explicit sway (else default = y / height, computed at the end)
   * o.swayAdd: k → + k * t^swayAddPow ; o.swayBias: constant added
   * o.flap / o.wag / o.glow: number|fn(p,t) per vertex; o.glowFace: fn(centroid, n, t) per face
   * o.jit: colour jitter amount for this part
   */
  add(part, o = {}) {
    const src = part.v, T = part.t, I = part.i, n = src.length / 3;
    const X = new Float32Array(n * 3), Lx = o.colorLocal ? new Float32Array(n * 3) : null;
    for (let k = 0; k < n; k++) {
      _p.set(src[3 * k], src[3 * k + 1], src[3 * k + 2]);
      const t = T[k] || 0;
      if (o.warp) o.warp(_p, t);
      if (Lx) { Lx[3 * k] = _p.x; Lx[3 * k + 1] = _p.y; Lx[3 * k + 2] = _p.z; }
      if (o.m) _p.applyMatrix4(o.m);
      if (o.post) o.post(_p, t);
      X[3 * k] = _p.x; X[3 * k + 1] = _p.y; X[3 * k + 2] = _p.z;
    }
    const s0 = new Float32Array(n), sa = new Float32Array(n), fl = new Float32Array(n), wg = new Float32Array(n), gl = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      _p.fromArray(X, 3 * k);
      const t = T[k] || 0;
      s0[k] = o.sway === undefined ? -1 : val(o.sway, _p, t);
      sa[k] = (o.swayAdd || 0) * Math.pow(t, o.swayAddPow || 1) + (o.swayBias || 0);
      fl[k] = val(o.flap, _p, t); wg[k] = val(o.wag, _p, t); gl[k] = val(o.glow, _p, t);
    }
    const jit = o.jit ?? this.jit, rng = this.rng;
    const ids = [0, 0, 0];
    for (let q = 0; q < I.length; q += 3) {
      ids[0] = I[q]; ids[1] = I[q + 1]; ids[2] = I[q + 2];
      _a.fromArray(X, 3 * ids[0]); _b.fromArray(X, 3 * ids[1]); _c.fromArray(X, 3 * ids[2]);
      _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _n.crossVectors(_e1, _e2);
      const len = _n.length();
      if (len < 1e-11) continue; // degenerate
      _n.multiplyScalar(1 / len);
      _cen.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);
      const tAvg = ((T[ids[0]] || 0) + (T[ids[1]] || 0) + (T[ids[2]] || 0)) / 3;
      let cenC = _cen, nC = _n;
      if (Lx) {
        _a.fromArray(Lx, 3 * ids[0]); _b.fromArray(Lx, 3 * ids[1]); _c.fromArray(Lx, 3 * ids[2]);
        _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _ln.crossVectors(_e1, _e2).normalize();
        _lc.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);
        cenC = _lc; nC = _ln;
      }
      let fc = null;
      if (!o.vcolor) fc = toColor(typeof o.color === 'function' ? o.color(cenC, nC, tAvg, rng) : o.color);
      const gF = o.glowFace ? o.glowFace(cenC, nC, tAvg) : -1;
      const br = 1 + jit * (2 * rng.next() - 1);
      const jr = br * (1 + jit * 0.4 * (2 * rng.next() - 1));
      const jg = br * (1 + jit * 0.4 * (2 * rng.next() - 1));
      const jb = br * (1 + jit * 0.4 * (2 * rng.next() - 1));
      for (let j = 0; j < 3; j++) {
        const k = ids[j];
        this.P.push(X[3 * k], X[3 * k + 1], X[3 * k + 2]);
        let c = fc;
        if (o.vcolor) { _p.fromArray(X, 3 * k); c = toColor(o.vcolor(_p, T[k] || 0, _n)); }
        this.C.push(clamp01(c.r * jr), clamp01(c.g * jg), clamp01(c.b * jb));
        this.S0.push(s0[k]); this.SA.push(sa[k]); this.F.push(fl[k]); this.W.push(wg[k]);
        this.G.push(gF >= 0 ? gF : gl[k]);
      }
    }
    return this;
  }

  /**
   * o.fit: {axis:'y'|'x'|'z'|'xz', size} uniform rescale; o.align: 'base' (minY→0) | 'center' (bbox y centre→0)
   * o.centerXZ: centre bbox on x/z; o.defaultSway: false → no implicit y-based sway; o.sink: y offset
   */
  geometry(o = {}) {
    const n = this.P.length / 3;
    const P = new Float32Array(this.P);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) {
      const x = P[3 * k + a]; if (x < mn[a]) mn[a] = x; if (x > mx[a]) mx[a] = x;
    }
    let s = 1;
    if (o.fit) {
      const ax = o.fit.axis || 'y';
      const ext = ax === 'y' ? (o.align ? mx[1] - mn[1] : mx[1])
        : ax === 'x' ? mx[0] - mn[0] : ax === 'z' ? mx[2] - mn[2]
          : Math.max(mx[0] - mn[0], mx[2] - mn[2]);
      s = o.fit.size / Math.max(1e-6, ext);
    }
    let tx = 0, ty = 0, tz = 0;
    if (o.align === 'base') ty = -mn[1] * s;
    else if (o.align === 'center') ty = -0.5 * (mn[1] + mx[1]) * s;
    if (o.centerXZ) { tx = -0.5 * (mn[0] + mx[0]) * s; tz = -0.5 * (mn[2] + mx[2]) * s; }
    ty += o.sink || 0;
    for (let k = 0; k < n; k++) { P[3 * k] = P[3 * k] * s + tx; P[3 * k + 1] = P[3 * k + 1] * s + ty; P[3 * k + 2] = P[3 * k + 2] * s + tz; }
    // sway: default is height fraction of the (unscaled) model
    const H = Math.max(1e-6, mx[1]);
    const S = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let sv = this.S0[k];
      if (sv < 0) sv = o.defaultSway === false ? 0 : Math.pow(clamp01(this.P[3 * k + 1] / H), this.swayPow);
      S[k] = clamp(sv + this.SA[k], 0, 1.3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.C), 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(S, 1));
    g.setAttribute('aFlap', new THREE.BufferAttribute(new Float32Array(this.F.map((x) => clamp01(x))), 1));
    g.setAttribute('aWag', new THREE.BufferAttribute(new Float32Array(this.W.map((x) => clamp01(x))), 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(this.G.map((x) => clamp01(x))), 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    // pad for shader displacement (sway / wag offsets are a few cm at most)
    g.boundingSphere.radius += 0.05;
    g.userData.tris = n / 3;
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// primitive parts (indexed, local space). Each returns {v: number[], t: number[], i: number[]}
// ---------------------------------------------------------------------------------------------
function bridge(A, B, I) {
  const na = A.length, nb = B.length;
  if (na === 1 && nb === 1) return;
  if (na === 1) { for (let s = 0; s < nb; s++) I.push(A[0], B[s], B[(s + 1) % nb]); return; }
  if (nb === 1) { for (let s = 0; s < na; s++) I.push(A[s], B[0], A[(s + 1) % na]); return; }
  for (let s = 0; s < na; s++) {
    const a0 = A[s], a1 = A[(s + 1) % na], b0 = B[s], b1 = B[(s + 1) % na];
    I.push(a0, b0, a1, a1, b0, b1);
  }
}

/** Surface of revolution about +Y. profile: [[r, y], ...] bottom→top; r=0 makes a pole. */
function lathe(profile, seg, o = {}) {
  const v = [], t = [], i = [], rings = [];
  const N = profile.length, ph = o.phase || 0;
  for (let k = 0; k < N; k++) {
    const r = profile[k][0], y = profile[k][1];
    const tt = N > 1 ? k / (N - 1) : 0;
    if (r <= 1e-7) { rings.push([v.length / 3]); v.push(0, y, 0); t.push(tt); continue; }
    const ring = [];
    for (let s = 0; s < seg; s++) {
      const a = ph + (o.twist || 0) * k + ((s + ((o.stagger && k % 2) ? 0.5 : 0)) / seg) * TAU;
      const f = o.rMod ? o.rMod(s, k, a) : 1;
      const dy = o.yMod ? o.yMod(s, k, a) : 0;
      ring.push(v.length / 3);
      v.push(Math.cos(a) * r * f, y + dy, Math.sin(a) * r * f);
      t.push(tt);
    }
    rings.push(ring);
  }
  for (let k = 0; k < N - 1; k++) bridge(rings[k], rings[k + 1], i);
  if (o.capBottom && rings[0].length > 1) {
    const c = v.length / 3, R = rings[0]; v.push(0, profile[0][1] + (o.capBottomY || 0), 0); t.push(0);
    for (let s = 0; s < R.length; s++) i.push(c, R[s], R[(s + 1) % R.length]);
  }
  if (o.capTop && rings[N - 1].length > 1) {
    const c = v.length / 3, R = rings[N - 1]; v.push(0, profile[N - 1][1] + (o.capTopY || 0), 0); t.push(1);
    for (let s = 0; s < R.length; s++) i.push(R[s], c, R[(s + 1) % R.length]);
  }
  return { v, t, i };
}

/** Generalised tube along a polyline (parallel-transport frames). radius 0 → pole. */
function tube(pts, radii, seg, o = {}) {
  const N = pts.length, v = [], t = [], i = [], rings = [];
  const T = [];
  for (let k = 0; k < N; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(N - 1, k + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  const L = [0];
  for (let k = 1; k < N; k++) L.push(L[k - 1] + pts[k].distanceTo(pts[k - 1]));
  const total = L[N - 1] || 1;
  const nrm = o.normal0 ? o.normal0.clone() : (Math.abs(T[0].y) < 0.95 ? UP.clone() : XAX.clone());
  const bin = new THREE.Vector3();
  for (let k = 0; k < N; k++) {
    nrm.addScaledVector(T[k], -nrm.dot(T[k]));
    if (nrm.lengthSq() < 1e-10) nrm.copy(Math.abs(T[k].y) < 0.95 ? UP : XAX).addScaledVector(T[k], -T[k].dot(Math.abs(T[k].y) < 0.95 ? UP : XAX));
    nrm.normalize();
    bin.crossVectors(nrm, T[k]);
    const r = radii[k], tt = L[k] / total, p = pts[k];
    if (r <= 1e-7) { rings.push([v.length / 3]); v.push(p.x, p.y, p.z); t.push(tt); continue; }
    const ring = [];
    for (let s = 0; s < seg; s++) {
      const a = (o.phase || 0) + (o.twist || 0) * k + (s / seg) * TAU;
      const f = o.rMod ? o.rMod(s, k, a, tt) : 1;
      const ca = Math.cos(a) * r * f, sa = Math.sin(a) * r * f;
      ring.push(v.length / 3);
      v.push(p.x + nrm.x * ca + bin.x * sa, p.y + nrm.y * ca + bin.y * sa, p.z + nrm.z * ca + bin.z * sa);
      t.push(tt);
    }
    rings.push(ring);
  }
  for (let k = 0; k < N - 1; k++) bridge(rings[k], rings[k + 1], i);
  if (o.capStart && rings[0].length > 1) {
    const c = v.length / 3, R = rings[0], p = pts[0]; v.push(p.x, p.y, p.z); t.push(0);
    for (let s = 0; s < R.length; s++) i.push(c, R[s], R[(s + 1) % R.length]);
  }
  if (o.capEnd && rings[N - 1].length > 1) {
    const c = v.length / 3, R = rings[N - 1], p = pts[N - 1]; v.push(p.x, p.y, p.z); t.push(1);
    for (let s = 0; s < R.length; s++) i.push(R[s], c, R[(s + 1) % R.length]);
  }
  return { v, t, i };
}

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_V = [-1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, 0, 0, -1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, ICO_T, 0, -1, ICO_T, 0, 1, -ICO_T, 0, -1, -ICO_T, 0, 1];
const ICO_F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
/** Indexed unit icosphere (20·4^detail tris). o.disp(x,y,z) → radial scale. */
function ico(detail = 1, o = {}) {
  let v = ICO_V.slice(), f = ICO_F.slice();
  for (let k = 0; k < v.length; k += 3) { const l = Math.hypot(v[k], v[k + 1], v[k + 2]); v[k] /= l; v[k + 1] /= l; v[k + 2] /= l; }
  for (let d = 0; d < detail; d++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let r = cache.get(key);
      if (r === undefined) {
        let x = (v[3 * a] + v[3 * b]) / 2, y = (v[3 * a + 1] + v[3 * b + 1]) / 2, z = (v[3 * a + 2] + v[3 * b + 2]) / 2;
        const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
        r = v.length / 3; v.push(x, y, z); cache.set(key, r);
      }
      return r;
    };
    for (let k = 0; k < f.length; k += 3) {
      const a = f[k], b = f[k + 1], c = f[k + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    f = nf;
  }
  const t = [];
  for (let k = 0; k < v.length; k += 3) {
    if (o.disp) { const s = o.disp(v[k], v[k + 1], v[k + 2]); v[k] *= s; v[k + 1] *= s; v[k + 2] *= s; }
    t.push((v[k + 1] + 1) / 2);
  }
  return { v, t, i: f };
}

/**
 * Leaf / petal / blade along local +Z, blade normal +Y, width on X.
 * o.lift: initial elevation (rad), o.droop: elevation lost along the length, o.curl: lateral bend,
 * o.fold: V-fold angle (edges raised), o.twist, o.shape: fn(s)→width factor or per-station array.
 */
function leaf(len, wid, n, o = {}) {
  const shape = o.shape || ((s) => Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.85));
  const e0 = o.lift ?? 0, droop = o.droop ?? 0, curl = o.curl ?? 0, fold = o.fold ?? 0.3, tw = o.twist ?? 0;
  const dp = o.droopPow ?? 1.4;
  const v = [], t = [], I = [], M = [], Lf = [], Rt = [];
  const p = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const step = len / n;
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    if (k > 0) {
      const sm = (k - 0.5) / n, e = e0 - droop * Math.pow(sm, dp), az = curl * sm;
      p.x += Math.cos(e) * Math.sin(az) * step; p.y += Math.sin(e) * step; p.z += Math.cos(e) * Math.cos(az) * step;
    }
    const e = e0 - droop * Math.pow(s, dp), az = curl * s;
    dir.set(Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az));
    side.set(dir.z, 0, -dir.x); if (side.lengthSq() < 1e-8) side.set(1, 0, 0); side.normalize();
    up.crossVectors(dir, side).normalize();
    if (tw) { const a = tw * s, c = Math.cos(a), sn = Math.sin(a); const sx = side.clone(); side.multiplyScalar(c).addScaledVector(up, sn); up.multiplyScalar(c).addScaledVector(sx, -sn); }
    const w = wid * (Array.isArray(shape) ? shape[k] : shape(s));
    const mi = v.length / 3; v.push(p.x, p.y, p.z); t.push(s); M.push(mi);
    if (w > 1e-6) {
      const lift = Math.tan(fold) * w;
      Lf.push(v.length / 3); v.push(p.x - side.x * w + up.x * lift, p.y - side.y * w + up.y * lift, p.z - side.z * w + up.z * lift); t.push(s);
      Rt.push(v.length / 3); v.push(p.x + side.x * w + up.x * lift, p.y + side.y * w + up.y * lift, p.z + side.z * w + up.z * lift); t.push(s);
    } else { Lf.push(mi); Rt.push(mi); }
  }
  for (let k = 0; k < n; k++) {
    const m0 = M[k], m1 = M[k + 1], l0 = Lf[k], l1 = Lf[k + 1], r0 = Rt[k], r1 = Rt[k + 1];
    if (l0 !== m0) I.push(m0, l0, l1);
    if (l1 !== m1) I.push(m0, l1, m1);
    if (r0 !== m0) I.push(m0, r1, r0);
    if (r1 !== m1) I.push(m0, m1, r1);
  }
  return { v, t, i: I };
}

/** Two-triangle folded leaflet along +Z (base at origin). */
function diamond(len, wid, o = {}) {
  const wp = o.wp ?? 0.4, lift = o.lift ?? wid * 0.25, tipY = o.tipY ?? 0;
  return { v: [0, 0, 0, -wid, lift, len * wp, wid, lift, len * wp, 0, tipY, len], t: [0, wp, wp, 1], i: [0, 1, 3, 0, 3, 2] };
}

/** Flat strip along a polyline; side: Vector3 or per-point array. */
function ribbon(pts, widths, side) {
  const v = [], t = [], i = [], N = pts.length;
  const L = [0];
  for (let k = 1; k < N; k++) L.push(L[k - 1] + pts[k].distanceTo(pts[k - 1]));
  const tot = L[N - 1] || 1;
  for (let k = 0; k < N; k++) {
    const s = Array.isArray(side) ? side[k] : side, w = widths[k] / 2, p = pts[k];
    v.push(p.x - s.x * w, p.y - s.y * w, p.z - s.z * w, p.x + s.x * w, p.y + s.y * w, p.z + s.z * w);
    t.push(L[k] / tot, L[k] / tot);
  }
  for (let k = 0; k < N - 1; k++) { const a = 2 * k; i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  return { v, t, i };
}

/** Double cone (2n tris). */
function bipyr(n, r, hTop, hBot, phase = 0) {
  const v = [0, hTop, 0, 0, -hBot, 0], t = [1, 0], i = [];
  for (let s = 0; s < n; s++) { const a = phase + (s / n) * TAU; v.push(Math.cos(a) * r, 0, Math.sin(a) * r); t.push(0.5); }
  for (let s = 0; s < n; s++) { const a = 2 + s, b = 2 + ((s + 1) % n); i.push(a, 0, b, a, b, 1); }
  return { v, t, i };
}
/** Open cone / pyramid (n tris). */
function cone(n, r, h, phase = 0) {
  const v = [0, h, 0], t = [1], i = [];
  for (let s = 0; s < n; s++) { const a = phase + (s / n) * TAU; v.push(Math.cos(a) * r, 0, Math.sin(a) * r); t.push(0); }
  for (let s = 0; s < n; s++) i.push(1 + s, 0, 1 + ((s + 1) % n));
  return { v, t, i };
}
/** Generic part from explicit vertices/triangles. */
function poly(verts, tris, ts) {
  const v = []; for (const p of verts) v.push(p[0], p[1], p[2]);
  return { v, t: ts || verts.map(() => 0), i: tris.flat() };
}
/** Fan polygon around an interior vertex: outline closed loop. */
function fanPoly(center, outline, closed = true) {
  const verts = [center, ...outline], tris = [];
  const n = outline.length;
  for (let k = 0; k < (closed ? n : n - 1); k++) tris.push([0, 1 + k, 1 + ((k + 1) % n)]);
  return poly(verts, tris);
}

// noise helper: shared simplex (deterministic)
const NOISE = new Simplex(9137);
const nz = (x, y, z) => NOISE.noise3(x, y, z);

// ---------------------------------------------------------------------------------------------
// shared material + shader patch
// ---------------------------------------------------------------------------------------------
export const modelUniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uNight: { value: 0 } };

const KIND_DEFAULTS = {
  plant: { swayAmp: 0.03, swaySpeed: 1.7, flutter: 0.0035, flapAmp: 0, flapSpeed: 0, glide: 0, flapBias: 0, wagAmp: 0, wagSpeed: 0, wagWave: 0, glowGain: 1, glowPulse: 0.12 },
  animal: { swayAmp: 0.006, swaySpeed: 6.0, flutter: 0.0, flapAmp: 0.8, flapSpeed: 16, glide: 0, flapBias: 0.15, wagAmp: 0.018, wagSpeed: 8, wagWave: 12, glowGain: 1, glowPulse: 0.1 },
  decor: { swayAmp: 0.025, swaySpeed: 2.0, flutter: 0.003, flapAmp: 0, flapSpeed: 0, glide: 0, flapBias: 0, wagAmp: 0, wagSpeed: 0, wagWave: 0, glowGain: 1, glowPulse: 0.1 },
};

const VERT_PARS = /* glsl */`
attribute float aSway;
attribute float aFlap;
attribute float aWag;
attribute float aGlow;
uniform float uTime;
uniform float uWind;
uniform vec4 uTwSway;  // amp, speed, flutter, -
uniform vec4 uTwFlap;  // amp(rad), speed, glide mix, bias
uniform vec4 uTwWag;   // amp, speed, wave number, -
varying vec2 vTwGlow;  // glow weight, phase
float twHash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
`;

function vertMain(byId) {
  return /* glsl */`
{
  #ifdef USE_INSTANCING
    vec3 twO = instanceMatrix[ 3 ].xyz;
  #else
    vec3 twO = vec3( 0.0 );
  #endif
  vec3 twW = ( modelMatrix * vec4( twO, 1.0 ) ).xyz;
  ${byId ? `
  #ifdef USE_INSTANCING
    float twPh = twHash13( vec3( float( gl_InstanceID ) * 0.7548, 3.17, 11.31 ) ) * 6.2831853;
  #else
    float twPh = twHash13( twW * 3.17 + 0.5 ) * 6.2831853;
  #endif` : `
  float twPh = twHash13( twW * 3.17 + 0.5 ) * 6.2831853;`}
  // --- wind sway (local X/Z, quadratic in aSway so bases stay planted)
  float twS = aSway * aSway;
  float twGust = 0.7 + 0.3 * sin( uTime * 0.53 + dot( twW, vec3( 0.31, 0.23, 0.27 ) ) );
  float twT = uTime * uTwSway.y + twPh;
  vec2 twD = vec2( sin( twT ), 0.55 * sin( twT * 0.77 + 1.3 ) );
  transformed.xz += twD * ( twS * uTwSway.x * uWind * twGust );
  transformed.xz += vec2( 0.8, 0.6 ) * ( aSway * uTwSway.z * uWind ) * sin( uTime * 6.3 + twPh + dot( position, vec3( 23.0, 17.0, 19.0 ) ) );
  // --- wing flap: rotate about the body (Z) axis, hinge at x = y = 0
  float twEnv = mix( 1.0, mix( 0.12, 1.0, smoothstep( -0.2, 0.7, sin( uTime * 0.45 + twPh * 1.7 ) ) ), uTwFlap.z );
  float twA = uTwFlap.x * ( sin( uTime * uTwFlap.y + twPh ) + uTwFlap.w ) * twEnv * clamp( aFlap * 3.0, 0.0, 1.0 );
  float twSide = transformed.x < 0.0 ? -1.0 : 1.0;
  float twC = cos( twA ), twSn = sin( twA );
  float twAx = abs( transformed.x ), twY = transformed.y;
  transformed.x = twSide * ( twAx * twC - twY * twSn );
  transformed.y = twAx * twSn + twY * twC;
  // --- lateral wag (fish bodies, tails): travelling wave toward the tail
  transformed.x += aWag * uTwWag.x * sin( uTime * uTwWag.y + twPh - position.z * uTwWag.z );
  vTwGlow = vec2( aGlow, twPh );
}
`;
}

const FRAG_PARS = /* glsl */`
uniform float uNight;
uniform float uTime;
uniform vec4 uTwGlow; // gain, pulse, -, -
varying vec2 vTwGlow;
`;
const FRAG_MAIN = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  totalEmissiveRadiance += vColor.rgb * vTwGlow.x * ( 0.35 + 0.9 * uNight ) * uTwGlow.x * ( 1.0 + uTwGlow.y * sin( uTime * 1.7 + vTwGlow.y ) );
#endif
`;

/**
 * MeshStandardMaterial (vertexColors, flatShading, DoubleSide) with wind sway, wing flap, tail wag
 * and glow injected. kind: 'plant' | 'animal' | 'decor'. opts override the kind defaults:
 * {swayAmp, swaySpeed, flutter, flapAmp, flapSpeed, glide, flapBias, wagAmp, wagSpeed, wagWave, glowGain, glowPulse}
 * (MODEL_INFO[id].anim holds recommended per-species overrides). All instances share one program per kind.
 */
export function createModelMaterial(kind = 'plant', opts = {}) {
  const k = KIND_DEFAULTS[kind] ? kind : 'plant';
  const p = { ...KIND_DEFAULTS[k], ...opts };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
  });
  const local = {
    uTwSway: { value: new THREE.Vector4(p.swayAmp, p.swaySpeed, p.flutter, 0) },
    uTwFlap: { value: new THREE.Vector4(p.flapAmp, p.flapSpeed, p.glide, p.flapBias) },
    uTwWag: { value: new THREE.Vector4(p.wagAmp, p.wagSpeed, p.wagWave, 0) },
    uTwGlow: { value: new THREE.Vector4(p.glowGain, p.glowPulse, 0, 0) },
  };
  const byId = k === 'animal';
  mat.name = `tiny-world-${k}`;
  mat.userData.tinyWorld = { kind: k, params: p, uniforms: local };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, modelUniforms, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertMain(byId));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_MAIN);
  };
  mat.customProgramCacheKey = () => `tiny-world-model-v1-${byId ? 'id' : 'pos'}`;
  return mat;
}

/** Convenience: material with the species' recommended animation params (MODEL_INFO[id].anim). */
export function createSpeciesMaterial(id) {
  const info = MODEL_INFO[id];
  return createModelMaterial(info ? info.kind : 'plant', info?.anim || {});
}

// @@MODELS@@
