// Procedural planet: icosphere tile graph, terrain (elevation), climate (temperature, moisture).
// Tiles are the vertices of a subdivided icosahedron (≈ hex cells). Static per seed.
import { Simplex, RNG, clamp, smoothstep } from '../rng.js';

export const R = 10;          // sea-level radius
export const SUBDIV = 4;      // 2562 tiles, 5120 faces

export class World {
  constructor(seed) {
    this.seed = seed;
    this.buildIcosphere(SUBDIV);
    this.buildNeighbors();
    this.generateTerrain();
  }

  // ---------- geometry ----------
  buildIcosphere(level) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map((v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; });
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let l = 0; l < level; l++) {
      const cache = new Map();
      const mid = (a, b) => {
        const key = a < b ? a * 100000 + b : b * 100000 + a;
        let m = cache.get(key);
        if (m === undefined) {
          const va = verts[a], vb = verts[b];
          const x = va[0] + vb[0], y = va[1] + vb[1], z = va[2] + vb[2];
          const len = Math.hypot(x, y, z);
          m = verts.length; verts.push([x / len, y / len, z / len]); cache.set(key, m);
        }
        return m;
      };
      const nf = [];
      for (const [a, b, c] of faces) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    this.n = verts.length;
    this.pos = new Float32Array(this.n * 3);
    verts.forEach((v, i) => { this.pos[i * 3] = v[0]; this.pos[i * 3 + 1] = v[1]; this.pos[i * 3 + 2] = v[2]; });
    this.faces = new Uint32Array(faces.length * 3);
    faces.forEach((f, i) => { this.faces[i * 3] = f[0]; this.faces[i * 3 + 1] = f[1]; this.faces[i * 3 + 2] = f[2]; });
    this.nFaces = faces.length;
  }

  buildNeighbors() {
    const sets = Array.from({ length: this.n }, () => new Set());
    const F = this.faces;
    for (let f = 0; f < this.nFaces; f++) {
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
    }
    this.nb = sets.map((s) => Int32Array.from(s));
    // second ring (excluding self and ring 1)
    this.ring2 = this.nb.map((r1, i) => {
      const s = new Set();
      for (const j of r1) for (const k of this.nb[j]) if (k !== i && !r1.includes(k)) s.add(k);
      return Int32Array.from(s);
    });
    // faces touching each vertex (for terrain color updates)
    const vf = Array.from({ length: this.n }, () => []);
    for (let f = 0; f < this.nFaces; f++) for (let k = 0; k < 3; k++) vf[F[f * 3 + k]].push(f);
    this.vertFaces = vf.map((a) => Int32Array.from(a));
  }

  // ---------- terrain & climate ----------
  generateTerrain() {
    const rng = new RNG(this.seed);
    const nE = new Simplex(this.seed ^ 0x51ed), nM = new Simplex(this.seed ^ 0xa11ce), nT = new Simplex(this.seed ^ 0x7e3a);
    const n = this.n, P = this.pos;
    const raw = new Float32Array(n);
    const ox = rng.float(-100, 100), oy = rng.float(-100, 100), oz = rng.float(-100, 100);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const cont = nE.fbm(x * 1.15 + ox, y * 1.15 + oy, z * 1.15 + oz, 4, 2.1, 0.5);
      const detail = nE.fbm(x * 3.4 + oz, y * 3.4 + ox, z * 3.4 + oy, 3, 2.2, 0.5);
      const ridge = 1 - Math.abs(nE.noise3(x * 2.3 - oy, y * 2.3 + oz, z * 2.3 - ox));
      raw[i] = cont * 0.85 + detail * 0.28 + Math.pow(ridge, 3) * 0.22;
    }
    // choose sea level so that a target fraction of tiles is land
    const landFrac = rng.float(0.4, 0.48);
    const sorted = Float32Array.from(raw).sort();
    const sea = sorted[Math.floor((1 - landFrac) * n)];
    let maxL = 1e-6, maxO = 1e-6;
    for (let i = 0; i < n; i++) { const d = raw[i] - sea; if (d > maxL) maxL = d; if (-d > maxO) maxO = -d; }
    this.elev = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = raw[i] - sea;
      this.elev[i] = d >= 0 ? Math.pow(d / maxL, 1.15) * 0.98 + 0.02 : -Math.pow(-d / maxO, 0.8);
    }
    this.baseElev = Float32Array.from(this.elev);

    // distance to ocean / land (BFS)
    this.computeCoast();

    // temperature: latitude + altitude + noise
    this.baseTemp = new Float32Array(n);
    this.baseMoist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const lat = Math.abs(y);
      const e = Math.max(0, this.elev[i]);
      let t = 1.02 - Math.pow(lat, 1.35) * 1.05 - e * 0.5 + nT.fbm(x * 2 + 7, y * 2, z * 2, 3) * 0.14;
      this.baseTemp[i] = clamp(t, 0, 1);
      const d = this.coastDist[i];
      let m = 0.42 + nM.fbm(x * 1.8 + 3, y * 1.8, z * 1.8 - 5, 4) * 0.42 + (d <= 1 ? 0.22 : d === 2 ? 0.14 : d === 3 ? 0.06 : -0.04) - e * 0.18;
      // equator wetter, subtropics drier
      m += 0.12 * Math.cos(lat * Math.PI * 1.6) - 0.05;
      this.baseMoist[i] = clamp(m, 0, 1);
    }
  }

  computeCoast() {
    const n = this.n;
    this.ocean = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.ocean[i] = this.elev[i] < 0 ? 1 : 0;
    this.coastDist = new Uint8Array(n).fill(255);
    const q = [];
    for (let i = 0; i < n; i++) if (!this.ocean[i]) { for (const j of this.nb[i]) if (this.ocean[j]) { this.coastDist[i] = 1; q.push(i); break; } }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const j of this.nb[i]) if (!this.ocean[j] && this.coastDist[j] === 255) { this.coastDist[j] = this.coastDist[i] + 1; q.push(j); }
    }
    this.landTiles = [];
    for (let i = 0; i < n; i++) if (!this.ocean[i]) this.landTiles.push(i);
    this.oceanTiles = [];
    for (let i = 0; i < n; i++) if (this.ocean[i]) this.oceanTiles.push(i);
    // shallow ocean = adjacent to land
    this.shallow = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (this.ocean[i]) for (const j of this.nb[i]) if (!this.ocean[j]) { this.shallow[i] = 1; break; }
  }

  // Apply meteor craters (persisted list of {t: tileIndex, s: size})
  applyCraters(craters) {
    this.elev.set(this.baseElev);
    for (const c of craters) this.carveCrater(c.t, c.s, false);
    this.computeCoast();
  }
  carveCrater(tile, size = 1, recompute = true) {
    const cx = this.pos[tile * 3], cy = this.pos[tile * 3 + 1], cz = this.pos[tile * 3 + 2];
    const rad = 0.075 * size; // angular radius (radians)
    for (let i = 0; i < this.n; i++) {
      const d = Math.acos(clamp(cx * this.pos[i * 3] + cy * this.pos[i * 3 + 1] + cz * this.pos[i * 3 + 2], -1, 1));
      if (d > rad * 1.8) continue;
      const u = d / rad;
      if (this.elev[i] < 0) continue;
      const bowl = u < 1 ? -(1 - u * u) * 0.22 : 0;
      const rim = Math.exp(-Math.pow((u - 1.05) / 0.28, 2)) * 0.12;
      this.elev[i] = Math.max(0.01, this.elev[i] + bowl + rim);
    }
    if (recompute) this.computeCoast();
  }

  radiusAt(i) {
    const e = this.elev[i];
    return e >= 0 ? R * (1.006 + 0.085 * e) : R * (1 + 0.055 * e);
  }

  // nearest tile to a unit vector, greedy walk from a start tile
  nearestTile(x, y, z, start = 0) {
    const P = this.pos;
    let cur = start, best = x * P[cur * 3] + y * P[cur * 3 + 1] + z * P[cur * 3 + 2];
    for (let guard = 0; guard < 200; guard++) {
      let moved = false;
      for (const j of this.nb[cur]) {
        const d = x * P[j * 3] + y * P[j * 3 + 1] + z * P[j * 3 + 2];
        if (d > best) { best = d; cur = j; moved = true; }
      }
      if (!moved) break;
    }
    return cur;
  }
  nearestTileBrute(x, y, z) {
    const P = this.pos; let best = -2, bi = 0;
    for (let i = 0; i < this.n; i++) { const d = x * P[i * 3] + y * P[i * 3 + 1] + z * P[i * 3 + 2]; if (d > best) { best = d; bi = i; } }
    return bi;
  }

  // tiles within angular radius (radians) of a tile
  tilesWithin(tile, rad) {
    const out = [];
    const cx = this.pos[tile * 3], cy = this.pos[tile * 3 + 1], cz = this.pos[tile * 3 + 2];
    const c = Math.cos(rad);
    for (let i = 0; i < this.n; i++) if (cx * this.pos[i * 3] + cy * this.pos[i * 3 + 1] + cz * this.pos[i * 3 + 2] >= c) out.push(i);
    return out;
  }

  latitudeName(i) {
    const y = this.pos[i * 3 + 1];
    const a = Math.abs(y);
    if (a > 0.82) return 'Polar';
    if (a > 0.55) return 'Temperate';
    if (a > 0.25) return 'Subtropical';
    return 'Equatorial';
  }
}

// Biome description for a tile given dynamic conditions
export function biomeName(world, i, temp, moist) {
  if (world.ocean[i]) return world.shallow[i] ? 'Shallow sea' : 'Deep ocean';
  const e = world.elev[i];
  if (temp < 0.12) return e > 0.45 ? 'Frozen peak' : 'Tundra';
  if (e > 0.62) return 'Mountain';
  if (world.coastDist[i] === 1 && e < 0.08) return 'Beach';
  if (moist < 0.18) return temp > 0.6 ? 'Desert' : 'Dry steppe';
  if (moist > 0.72) return temp > 0.6 ? 'Rainforest' : 'Wetland';
  if (e > 0.4) return 'Highland';
  return temp > 0.65 ? 'Savanna' : 'Lowland';
}
