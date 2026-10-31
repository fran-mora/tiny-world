// Ecosystem simulation: ground cover, plants, animals (agents with heritable genes), climate,
// oxygen, algae, Bloom production, random events. Deterministic-ish, tick based.
// 1 game day = TICKS_PER_DAY ticks. At 1x speed one tick = 1 real second.
import { PLANTS, ANIMALS, PLANT, ANIMAL, ANIMAL_ADAPTS } from '../data/species.js';
import { RNG, clamp } from '../rng.js';
import { R } from './world.js';

export const TICKS_PER_DAY = 120;
const DT = 1 / TICKS_PER_DAY;
const STAGGER = 12;                 // plants/tiles update every 12 ticks (0.1 day)
const MAX_ANIMALS = 420;
const COVER_IDS = ['moss', 'grass'];   // coverSp 1, 2

export const EVENT_TYPES = {
  drought:   { name: 'Drought', icon: 'sun', bad: true, desc: 'A region is drying out. Plants there will wither.', tip: 'Use Rain on the region to save it.' },
  heatwave:  { name: 'Heatwave', icon: 'thermo', bad: true, desc: 'The whole planet is heating up.', tip: 'Hardy species cope best. Animals in hot regions suffer.' },
  coldsnap:  { name: 'Cold Snap', icon: 'thermo', bad: true, desc: 'A wave of cold sweeps the world.', tip: 'Cold-tolerant species and forests weather it best.' },
  meteor:    { name: 'Meteor Strike', icon: 'meteor', bad: true, desc: 'A meteor has struck! The impact site is scorched but rich in minerals.', tip: 'The crater soil is very fertile. Replant it.' },
  blight:    { name: 'Blight', icon: 'mushroom', bad: true, desc: 'A disease is spreading through one plant species.', tip: 'Diverse planting limits the damage.' },
  plague:    { name: 'Plague', icon: 'bug', bad: true, desc: 'A sickness is spreading through a crowded animal species.', tip: 'Predators keep populations healthy and spread out.' },
  migration: { name: 'Migration', icon: 'paw', bad: false, desc: 'Wild animals have arrived from beyond the horizon!', tip: 'Free animals. Make sure they have food.' },
  bloom:     { name: 'Bloom Season', icon: 'bloom', bad: false, desc: 'Flowers everywhere are bursting with seeds and nectar.', tip: 'Bloom production is boosted.' },
  rains:     { name: 'Rainy Season', icon: 'cloud', bad: false, desc: 'Steady rains soak the land.', tip: 'Great time to plant moisture-loving species.' },
};

let UID = 1;

export class Ecosystem {
  constructor(world, game, data = null) {
    this.world = world;
    this.game = game;               // { state } access for research/adaptations, + callbacks
    const n = world.n;
    this.fert = new Float32Array(n);
    this.cover = new Float32Array(n);
    this.coverSp = new Uint8Array(n);
    this.detritus = new Float32Array(n);
    this.moistMod = new Float32Array(n);
    this.shade = new Float32Array(n);     // canopy influence from trees (moisture retention)
    this.plantAt = new Int32Array(n).fill(-1);
    this.plants = [];
    this.animals = [];
    this.algae = 0;
    this.oxygen = 0.4;
    this.tempOffset = 0;
    this.tick = 0;
    this.events = [];
    this.craters = [];
    this.nextEventDay = 7;
    this.history = { t: [], o2: [], pops: {} };
    this.stats = { pollinations: 0, born: {}, died: {}, eaten: {}, grown: {}, peak: {} };
    this.bloomRate = 0;     // per day
    this.o2Target = 0.4;
    this.rng = new RNG((world.seed ^ 0xbeef) >>> 0);
    this.listeners = {};
    this.dirtyPlants = true;
    this.dirtyTiles = true;
    this.changedTiles = new Set();
    this.firstNotices = {};
    // spatial hash: per-tile linked list of animals
    this.tileHead = new Int32Array(n).fill(-1);
    this.nextInTile = new Int32Array(MAX_ANIMALS + 64).fill(-1);
    this.popCount = {};
    this.geneAvg = {};
    this.speciesBaseline = {};
    if (data) this.load(data);
    this.recount();
  }

  get day() { return this.tick / TICKS_PER_DAY; }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach((f) => f(data)); }

  // ------------------------------------------------------------------ climate
  temp(i) { return clamp(this.world.baseTemp[i] + this.tempOffset + this.regionTemp(i), 0, 1); }
  moist(i) { return clamp(this.world.baseMoist[i] + this.moistMod[i] + this.shade[i] * 0.12 + this.globalMoist(), 0, 1); }
  regionTemp() { return 0; }
  globalMoist() {
    let m = 0;
    for (const e of this.events) if (e.type === 'rains') m += 0.15;
    return m;
  }

  adaptLevel(sp, id) { const a = this.game.state.adaptations[sp]; return (a && a[id]) || 0; }

  suitability(spId, i) {
    const w = this.world;
    if (w.ocean[i]) return 0;
    const sp = PLANT[spId]; if (!sp || !sp.pref) return 0;
    const pr = sp.pref;
    const hardy = this.adaptLevel(spId, 'hardy') * 0.06;
    const roots = this.adaptLevel(spId, 'roots') * 0.08;
    const t = this.temp(i), m = this.moist(i), f = this.fert[i];
    const ts = rangeScore(t, pr.temp[0] - hardy, pr.temp[1], pr.temp[2] + hardy);
    const ms = rangeScore(m, pr.moist[0] - roots, pr.moist[1], pr.moist[2] + roots * 0.5);
    let fs = 1;
    if (f < pr.fert) fs = Math.max(0, 1 - (pr.fert - f) * 3.2);
    let s = ts * ms * fs;
    if (pr.coast) s *= w.coastDist[i] <= 2 ? 1 : w.coastDist[i] === 3 ? 0.55 : 0.2;
    if (w.elev[i] > 0.82 && sp.layer !== 'tree' && spId !== 'moss') s *= 0.6;
    return clamp(s, 0, 1);
  }

  // ------------------------------------------------------------------ actions
  canPlant(spId, i) {
    const w = this.world, sp = PLANT[spId];
    if (!sp || w.ocean[i]) return { ok: false, why: 'That is ocean.' };
    if (sp.kind === 'cover') {
      if (this.coverSp[i] === COVER_IDS.indexOf(spId) + 1 && this.cover[i] > 0.6) return { ok: false, why: 'Already lush here.' };
      return { ok: true };
    }
    if (this.plantAt[i] >= 0) return { ok: false, why: 'Something already grows here.' };
    if (sp.unique && this.plants.some((p) => p.sp === sp.index && !p.dead)) return { ok: false, why: 'Only one World Tree can exist.' };
    return { ok: true };
  }

  plantCover(spId, i, amount = 0.45) {
    const k = COVER_IDS.indexOf(spId) + 1;
    const tiles = [i, ...this.world.nb[i]];
    for (const t of tiles) {
      if (this.world.ocean[t]) continue;
      if (this.coverSp[t] !== k) { this.coverSp[t] = k; this.cover[t] = Math.max(0.05, this.cover[t] * 0.4); }
      this.cover[t] = Math.min(1, this.cover[t] + (t === i ? amount : amount * 0.5));
      this.changedTiles.add(t);
    }
    this.dirtyTiles = true;
    this.markGrown(spId, 1);
  }

  addPlant(spId, tile, growth = 0.06, opts = {}) {
    const sp = PLANT[spId];
    if (this.plantAt[tile] >= 0) return null;
    const p = {
      uid: UID++, sp: sp.index, tile, age: 0, growth, health: 1, pollen: 0,
      variant: this.rng.int(0, 2), rot: this.rng.float(0, Math.PI * 2), scale: this.rng.float(0.82, 1.18),
      phase: this.rng.float(0, 1), life: (sp.life || 30) * this.rng.float(0.8, 1.2), flowering: false, dead: false,
      planted: !!opts.planted,
    };
    this.plants.push(p);
    this.plantAt[tile] = this.plants.length - 1;
    this.dirtyPlants = true;
    if (opts.planted) this.markGrown(spId, 1);
    this.emit('plantAdded', p);
    return p;
  }

  removePlant(p, cause = 'old') {
    if (p.dead) return;
    p.dead = true;
    const sp = PLANTS[p.sp];
    if (this.plantAt[p.tile] >= 0 && this.plants[this.plantAt[p.tile]] === p) this.plantAt[p.tile] = -1;
    const mass = sp.layer === 'tree' ? 0.5 : sp.layer === 'shrub' ? 0.3 : 0.15;
    this.detritus[p.tile] = Math.min(1, this.detritus[p.tile] + mass * Math.max(0.2, p.growth));
    this.changedTiles.add(p.tile);
    this.stats.died[sp.id] = (this.stats.died[sp.id] || 0) + 1;
    this.dirtyPlants = true;
    this.emit('plantRemoved', { p, cause });
  }

  compactPlants() {
    if (!this.plants.some((p) => p.dead)) return;
    this.plants = this.plants.filter((p) => !p.dead);
    this.plantAt.fill(-1);
    this.plants.forEach((p, i) => { this.plantAt[p.tile] = i; });
    this.dirtyPlants = true;
  }

  spawnAnimal(spId, x, y, z, opts = {}) {
    if (this.animals.length >= MAX_ANIMALS) return null;
    const sp = ANIMAL[spId];
    const w = this.world;
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    const tile = w.nearestTile(x, y, z, opts.tile ?? 0);
    // random tangent heading
    let hx = this.rng.float(-1, 1), hy = this.rng.float(-1, 1), hz = this.rng.float(-1, 1);
    const d = hx * x + hy * y + hz * z; hx -= d * x; hy -= d * y; hz -= d * z;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const genes = opts.genes || { speed: 1, size: 1, meta: 1, hardy: 0 };
    const a = {
      uid: UID++, sp: sp.index, x, y, z, px: x, py: y, pz: z, hx: hx / hl, hy: hy / hl, hz: hz / hl,
      tile, r: w.radiusAt(tile), pr: w.radiusAt(tile),
      energy: opts.energy ?? 0.7, age: opts.age ?? sp.mature * 1.05, cooldown: opts.cooldown ?? 0.5,
      state: 0, target: -1, targetUid: 0, timer: 0, rest: 0, genes, gen: opts.gen || 0,
      alt: sp.flying ? this.rng.float(0.3, 0.7) * (spId === 'hawk' ? 4 : 1) : 0, palt: 0,
      phase: this.rng.float(0, 6.28), moving: 0, lastPlant: -1, dead: false, chase: 0,
    };
    a.palt = a.alt;
    this.animals.push(a);
    this.stats.born[spId] = (this.stats.born[spId] || 0) + 1;
    this.popCount[spId] = (this.popCount[spId] || 0) + 1;
    return a;
  }

  releaseAnimals(spId, tile, count) {
    const w = this.world, sp = ANIMAL[spId];
    const out = [];
    let tiles = [tile, ...w.nb[tile], ...w.ring2[tile]];
    tiles = tiles.filter((t) => (sp.aquatic ? w.ocean[t] : sp.flying ? true : !w.ocean[t]));
    if (!tiles.length) return out;
    for (let k = 0; k < count; k++) {
      const t = tiles[k % tiles.length];
      const j = 0.05;
      const a = this.spawnAnimal(spId, w.pos[t * 3] + this.rng.float(-j, j), w.pos[t * 3 + 1] + this.rng.float(-j, j), w.pos[t * 3 + 2] + this.rng.float(-j, j), { tile: t, energy: 0.85, cooldown: 1.2 });
      if (a) out.push(a);
    }
    if (!this.speciesBaseline[spId]) this.speciesBaseline[spId] = { speed: 1, size: 1, meta: 1, hardy: 0, day: this.day };
    this.markGrown(spId, count);
    return out;
  }

  rain(tile, strength = 0.55) {
    const tiles = this.world.tilesWithin(tile, 0.28);
    for (const t of tiles) {
      this.moistMod[t] = Math.min(0.6, Math.max(this.moistMod[t], 0) + strength);
      this.changedTiles.add(t);
    }
    // break droughts in the area
    for (const e of this.events) if (e.type === 'drought' && e.tile != null) {
      const w = this.world;
      const d = w.pos[tile * 3] * w.pos[e.tile * 3] + w.pos[tile * 3 + 1] * w.pos[e.tile * 3 + 1] + w.pos[tile * 3 + 2] * w.pos[e.tile * 3 + 2];
      if (d > Math.cos(0.45)) { e.hp = (e.hp ?? 2) - 1; if (e.hp <= 0) e.end = this.day; }
    }
    this.dirtyTiles = true;
    return tiles;
  }

  fertilize(tile, strength = 0.3) {
    const tiles = this.world.tilesWithin(tile, 0.22);
    for (const t of tiles) if (!this.world.ocean[t]) { this.fert[t] = Math.min(1, this.fert[t] + strength); this.changedTiles.add(t); }
    this.dirtyTiles = true;
    return tiles;
  }

  seedAlgae() { if (this.algae < 0.05) this.algae = 0.05; }

  markGrown(spId, n) {
    this.stats.grown[spId] = (this.stats.grown[spId] || 0) + n;
  }

  // ------------------------------------------------------------------ step
  step() {
    this.tick++;
    const t = this.tick;
    this.stepAnimals();
    const slot = t % STAGGER;
    this.stepPlants(slot);
    this.stepTiles(slot);
    this.stepGlobal();
    if (slot === 0) this.stepEvents();
    if (t % 60 === 0) this.record();
    if (t % 240 === 0) this.compactPlants();
    if (t % TICKS_PER_DAY === 0) this.emit('day', this.day);
  }

  // ---------- plants ----------
  stepPlants(slot) {
    const dt = DT * STAGGER;
    const list = this.plants;
    const bloomBoost = this.events.some((e) => e.type === 'bloom');
    for (let k = slot; k < list.length; k += STAGGER) {
      const p = list[k]; if (p.dead) continue;
      const sp = PLANTS[p.sp];
      const suit = this.suitability(sp.id, p.tile);
      p.age += dt;
      p.suit = suit;
      if (p.growth < 1) {
        let g = dt / sp.grow * (0.25 + 0.75 * suit) * (0.5 + 0.5 * p.health);
        // the World Tree only grows well on a thriving, diverse world
        if (sp.unique) g *= Math.max(0.12, Math.min(1, (this.thrivingN || 0) / 12));
        const was = p.growth;
        p.growth = Math.min(1, p.growth + g);
        if (was < 1 && p.growth >= 1) this.emit('plantMature', p);
      }
      // health drifts toward suitability
      let target = Math.min(1, suit * 1.6);
      for (const e of this.events) {
        if (e.type === 'blight' && e.sp === sp.id && (e.tiles == null || e.tilesSet.has(p.tile))) target -= 0.9;
      }
      if (sp.decomposer) {
        const food = this.detritus[p.tile] + this.fert[p.tile] * 0.4;
        target = Math.min(target, food > 0.12 ? 1 : 0.15);
        const take = Math.min(this.detritus[p.tile], dt * 0.25);
        this.detritus[p.tile] -= take; this.fert[p.tile] = Math.min(1, this.fert[p.tile] + take * 0.9 + dt * 0.01);
        for (const j of this.world.nb[p.tile]) {
          const t2 = Math.min(this.detritus[j], dt * 0.08);
          this.detritus[j] -= t2; this.fert[j] = Math.min(1, this.fert[j] + t2 * 0.8);
        }
        this.changedTiles.add(p.tile);
      }
      p.health += (target - p.health) * Math.min(1, dt * 0.9);
      p.health = clamp(p.health, 0, 1);
      if (p.health < 0.04 || (p.growth < 0.04 && p.health < 0.3)) { this.removePlant(p, 'withered'); continue; }
      if (p.age > p.life) { this.removePlant(p, 'old'); continue; }
      // flowering
      if (sp.flowers && p.growth >= 0.95) {
        if (sp.id === 'cactus') p.flowering = this.moistMod[p.tile] > 0.08 || bloomBoost || ((p.age * 0.35 + p.phase) % 1) < 0.3;
        else p.flowering = ((p.age * 0.5 + p.phase) % 1) < 0.65 || bloomBoost;
      } else p.flowering = false;
      p.pollen = Math.max(0, p.pollen - dt * 0.35);
      // trees retain moisture around them
      if (sp.layer === 'tree' && p.growth > 0.5) {
        this.shade[p.tile] = Math.min(1, this.shade[p.tile] + dt * 0.5);
        for (const j of this.world.nb[p.tile]) this.shade[j] = Math.min(1, this.shade[j] + dt * 0.25);
      }
      // reproduction
      if (p.growth >= 1 && p.health > 0.45 && sp.seed > 0) {
        let chance = sp.seed * (1 + this.adaptLevel(sp.id, 'prolific') * 0.3) * (0.4 + 0.6 * suit);
        if (sp.pollinated) chance *= 0.3 + 0.7 * Math.min(1, p.pollen * 1.5) + (this.hasPollinators() ? 0 : 0.15);
        if (bloomBoost && sp.flowers) chance *= 2.5;
        if (this.rng.next() < chance * dt * 10) this.trySeed(p, sp);
      }
    }
  }

  hasPollinators() { return (this.popCount.moth || 0) > 0; }

  trySeed(p, sp) {
    const w = this.world;
    const ring = sp.range >= 2 && this.rng.next() < 0.5 ? w.ring2[p.tile] : w.nb[p.tile];
    const t = ring[Math.floor(this.rng.next() * ring.length)];
    if (w.ocean[t] || this.plantAt[t] >= 0) return;
    const s = this.suitability(sp.id, t);
    if (s < 0.3) return;
    // crowding: limit dense clusters of the same species
    let same = 0;
    for (const j of w.nb[t]) { const q = this.plantAt[j]; if (q >= 0 && this.plants[q].sp === p.sp && !this.plants[q].dead) same++; }
    if (same >= 4) return;
    const np = this.addPlant(sp.id, t, 0.04);
    if (np) this.markGrown(sp.id, 1);
  }

  // ---------- ground cover & soil ----------
  stepTiles(slot) {
    const dt = DT * STAGGER;
    const w = this.world, n = w.n;
    for (let i = slot; i < n; i += STAGGER) {
      // decay of temporary moisture & shade
      if (this.moistMod[i] !== 0) {
        const before = this.moistMod[i];
        this.moistMod[i] *= Math.exp(-dt * 0.22);
        if (Math.abs(this.moistMod[i]) < 0.01) this.moistMod[i] = 0;
        if (Math.abs(before - this.moistMod[i]) > 0.002) this.changedTiles.add(i);
      }
      this.shade[i] *= Math.exp(-dt * 0.15);
      if (w.ocean[i]) continue;
      // detritus slowly enriches soil even without decomposers
      if (this.detritus[i] > 0) {
        const d = Math.min(this.detritus[i], dt * 0.03);
        this.detritus[i] -= d; this.fert[i] = Math.min(1, this.fert[i] + d * 0.5);
      }
      const k = this.coverSp[i];
      if (!k) continue;
      const spId = COVER_IDS[k - 1], sp = PLANT[spId];
      const suit = this.suitability(spId, i);
      const c0 = this.cover[i];
      let c = c0;
      c += sp.growth * dt * (suit - 0.2) * (suit > 0.2 ? (1 - c) * 1.2 : 1.6);
      // droughts hurt cover
      c = clamp(c, 0, 1);
      this.fert[i] = Math.min(1, this.fert[i] + sp.fertGain * dt * c * (k === 1 ? 1.4 : 1));
      if (c < 0.02) { this.coverSp[i] = 0; c = 0; }
      this.cover[i] = c;
      if (Math.abs(c - c0) > 0.004) this.changedTiles.add(i);
      // spread
      if (c > 0.3 && this.rng.next() < sp.spread * dt * c * 6) {
        const nb = w.nb[i]; const j = nb[Math.floor(this.rng.next() * nb.length)];
        if (!w.ocean[j]) {
          const kj = this.coverSp[j];
          const sj = this.suitability(spId, j);
          if (sj > 0.28) {
            if (kj === 0) { this.coverSp[j] = k; this.cover[j] = 0.08; this.changedTiles.add(j); }
            else if (kj !== k) {
              // competition: grass beats moss on fertile ground, moss holds poor ground
              const other = COVER_IDS[kj - 1];
              const so = this.suitability(other, j);
              if (sj > so + 0.08 && this.rng.next() < 0.5) { this.coverSp[j] = k; this.cover[j] = Math.max(0.08, this.cover[j] * 0.5); this.changedTiles.add(j); }
            }
          }
        }
      }
    }
    if (this.changedTiles.size) this.dirtyTiles = true;
  }

  // ---------- global: oxygen, algae, bloom ----------
  stepGlobal() {
    const dt = DT;
    const st = this.game.state;
    if (st.research.algae) {
      const fishEat = (this.popCount.fish || 0) * 0.0004;
      this.algae += dt * (0.42 * this.algae * (1 - this.algae) - fishEat * this.algae);
      this.algae = clamp(this.algae, 0.01, 1);
    }
    if (this.tick % 6 === 0) {
      // recompute plant contribution (cheap enough every 6 ticks)
      let plantO2 = 0, bloom = 0;
      const bloomBoost = this.events.some((e) => e.type === 'bloom') ? 1.5 : 1;
      for (let i = 0; i < this.world.n; i++) {
        const k = this.coverSp[i]; if (!k) continue;
        const sp = PLANT[COVER_IDS[k - 1]];
        plantO2 += this.cover[i] * sp.o2; bloom += this.cover[i] * sp.bloom;
      }
      for (const p of this.plants) {
        if (p.dead) continue;
        const sp = PLANTS[p.sp];
        const g = p.growth * (0.4 + 0.6 * p.health);
        plantO2 += g * sp.o2;
        bloom += g * sp.bloom * (p.flowering ? 1.6 * bloomBoost : 1);
      }
      let animalLoad = 0;
      for (const a of this.animals) animalLoad += ANIMALS[a.sp].size;
      this.plantO2 = plantO2;
      this.o2Target = 0.4 + 6.6 * (st.research.algae ? this.algae : 0) + 19 * (1 - Math.exp(-plantO2 / 700)) - animalLoad * 0.012;
      this.bloomRate = bloom * 0.5 + (st.research.algae ? this.algae * 2 : 0);
    }
    this.oxygen += (this.o2Target - this.oxygen) * Math.min(1, dt * 0.15);
    this.oxygen = Math.max(0.1, this.oxygen);
    this.bloomGain = this.bloomRate * dt;   // read by game loop
  }

  // ---------- animals ----------
  rebuildSpatial() {
    this.tileHead.fill(-1);
    if (this.nextInTile.length < this.animals.length) this.nextInTile = new Int32Array(this.animals.length + 64);
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (a.dead) continue;
      this.nextInTile[i] = this.tileHead[a.tile];
      this.tileHead[a.tile] = i;
    }
  }

  stepAnimals() {
    const w = this.world;
    const list = this.animals;
    if (!list.length) return;
    this.rebuildSpatial();
    const o2 = this.oxygen;
    let anyDead = false;
    const plagueSp = this.events.filter((e) => e.type === 'plague').map((e) => e.sp);
    for (let idx = 0; idx < list.length; idx++) {
      const a = list[idx];
      if (a.dead) { anyDead = true; continue; }
      const sp = ANIMALS[a.sp];
      a.px = a.x; a.py = a.y; a.pz = a.z; a.pr = a.r; a.palt = a.alt;
      a.age += DT;
      if (a.cooldown > 0) a.cooldown -= DT;
      // metabolism
      const eff = 1 - this.adaptLevel(sp.id, 'efficient') * 0.12;
      const g = a.genes;
      let meta = sp.metabolism * eff * g.meta * (0.7 + 0.3 * g.speed * g.speed) * (0.75 + 0.25 * g.size) * (1 + g.hardy * 0.6);
      const t = this.temp(a.tile);
      const tol = 0.06 * this.adaptLevel(sp.id, 'hardy') + g.hardy * 0.25;
      const tmin = sp.temp[0] - tol, tmax = sp.temp[1] + tol;
      if (t < tmin) meta *= 1 + (tmin - t) * 9;
      else if (t > tmax) meta *= 1 + (t - tmax) * 9;
      if (o2 < sp.o2Min) meta *= 1 + (sp.o2Min - o2) * 0.6;
      if (plagueSp.includes(sp.id)) meta *= 2.2;
      if (a.state === 3) meta *= 0.4; // resting
      a.energy -= meta * DT;
      if (a.energy <= 0) { this.killAnimal(a, o2 < sp.o2Min ? 'suffocated' : (t < tmin || t > tmax) ? 'exposure' : 'starved'); anyDead = true; continue; }
      if (a.age > sp.life * (0.85 + 0.3 * ((a.uid * 0.618) % 1))) { this.killAnimal(a, 'old'); anyDead = true; continue; }

      this.think(a, sp, idx);
      if (a.dead) { anyDead = true; continue; }
      this.move(a, sp);
      // breed
      if (a.cooldown <= 0 && a.age > sp.mature && a.energy > sp.breedEnergy - this.adaptLevel(sp.id, 'fertile') * 0.06) this.tryBreed(a, sp);
    }
    if (anyDead) this.animals = this.animals.filter((a) => !a.dead);
  }

  think(a, sp, idx) {
    const w = this.world;
    const keen = this.adaptLevel(sp.id, 'keen');
    a.timer--;
    // resting
    if (a.state === 3) { if (a.timer <= 0) a.state = 0; a.moving = 0; return; }

    // threat detection for prey species
    if (!sp.predator) {
      const threat = this.findThreat(a, sp, keen);
      if (threat) {
        a.state = 2; a.timer = 6;
        // heading away from threat
        this.steerAway(a, threat.x, threat.y, threat.z, 0.6);
        a.moving = 1.45;
        return;
      }
    }
    if (a.state === 2 && a.timer > 0) { a.moving = 1.3; return; }

    const hungry = a.energy < 0.72;
    if (hungry) {
      if (this.feed(a, sp, keen)) return;
    }
    // idle / wander
    if (a.state !== 0 || a.timer <= 0) {
      a.state = 0;
      a.timer = 8 + Math.floor(this.rng.next() * 20);
      if (!sp.flying && !sp.aquatic && this.rng.next() < 0.25 && !hungry) { a.state = 3; a.timer = 10 + Math.floor(this.rng.next() * 25); a.moving = 0; return; }
      this.turn(a, this.rng.float(-1.2, 1.2));
    }
    this.turn(a, this.rng.float(-0.15, 0.15));
    a.moving = sp.id === 'hawk' ? 0.8 : 0.55;
  }

  findThreat(a, sp, keen) {
    // predators that hunt this species, within sense range
    const r2 = sp.sense + keen >= 2;
    let best = null, bd = -1;
    const check = (tile) => {
      for (let j = this.tileHead[tile]; j >= 0; j = this.nextInTile[j]) {
        const b = this.animals[j];
        if (b.dead || b === a) continue;
        const bs = ANIMALS[b.sp];
        if (!bs.predator || !bs.diet.prey.includes(sp.id)) continue;
        const d = a.x * b.x + a.y * b.y + a.z * b.z;
        if (d > bd) { bd = d; best = b; }
      }
    };
    check(a.tile);
    for (const t of this.world.nb[a.tile]) check(t);
    if (r2) for (const t of this.world.ring2[a.tile]) check(t);
    return best;
  }

  feed(a, sp, keen) {
    const w = this.world, d = sp.diet;
    const bite = 0.03 * a.genes.size;
    // ----- predators
    if (d.prey) {
      if (a.cooldown > 0.6 && a.energy > 0.35) return false; // digesting
      let prey = null;
      if (a.targetUid) { prey = this.animals.find((b) => b.uid === a.targetUid && !b.dead); if (!prey) a.targetUid = 0; }
      if (!prey) {
        const range = 0.16 + 0.06 * (sp.sense + keen) + (sp.flying ? 0.12 : 0);
        const cr = Math.cos(range);
        let bd = cr;
        for (const b of this.animals) {
          if (b.dead) continue;
          const bs = ANIMALS[b.sp];
          if (!d.prey.includes(bs.id)) continue;
          const dot = a.x * b.x + a.y * b.y + a.z * b.z;
          if (dot > bd) { bd = dot; prey = b; }
        }
        if (prey) { a.targetUid = prey.uid; a.chase = 0; }
      }
      if (prey) {
        a.chase++;
        if (a.chase > 50) { a.targetUid = 0; a.state = 3; a.timer = 25; return true; } // gave up
        const dot = a.x * prey.x + a.y * prey.y + a.z * prey.z;
        const dist = Math.acos(clamp(dot, -1, 1)) * R;
        if (dist < 0.22 + ANIMALS[prey.sp].size) {
          // catch (prey may escape based on speed genes)
          const escape = 0.18 * (prey.genes.speed - a.genes.speed) + (prey.state === 2 ? 0.08 : 0);
          if (this.rng.next() > escape) {
            this.killAnimal(prey, 'eaten', a);
            a.energy = Math.min(1, a.energy + 0.25 + ANIMALS[prey.sp].size * 1.1);
            a.targetUid = 0; a.state = 3; a.timer = 20; a.cooldown = Math.max(a.cooldown, 0.25);
            this.emit('hunt', { a, prey });
            return true;
          }
        }
        this.steerTo(a, prey.x, prey.y, prey.z, 0.45);
        a.moving = 1.35; a.state = 1;
        if (sp.flying) a.alt += (0.15 - a.alt) * 0.25; // dive
        return true;
      }
      if (sp.flying) a.alt += ((sp.id === 'hawk' ? 2.2 : 0.5) - a.alt) * 0.05;
      return false;
    }
    // ----- fish (algae)
    if (d.algae) {
      if (this.algae > 0.03) { a.energy = Math.min(1, a.energy + this.algae * 0.025); this.algae = Math.max(0.01, this.algae - 0.000006); }
      return false;
    }
    // ----- herbivores & co: scan current tile and neighbours for the best food
    let bestT = -1, bestScore = 0, bestKind = 0;
    const consider = (t) => {
      if (!sp.flying && w.ocean[t]) return;
      let s = 0, kind = 0;
      if (d.cover && this.coverSp[t] && this.cover[t] > 0.16) { const v = this.cover[t] * d.cover * PLANT[COVER_IDS[this.coverSp[t] - 1]].food; if (v > s) { s = v; kind = 1; } }
      const pi = this.plantAt[t];
      if (pi >= 0) {
        const p = this.plants[pi];
        if (!p.dead) {
          const ps = PLANTS[p.sp];
          if (d.browse && ps.browse > 0 && p.growth > 0.35) { const v = ps.browse * d.browse * p.growth * (1 - this.adaptLevel(ps.id, 'thorns') * 0.3); if (v > s) { s = v; kind = 2; } }
          if (d.nectar && p.flowering && t !== a.lastPlant) { const v = 1.2 * d.nectar * (1 - p.pollen * 0.5); if (v > s) { s = v; kind = 3; } }
          if (d.fungus && ps.decomposer && p.growth > 0.3) { const v = d.fungus; if (v > s) { s = v; kind = 4; } }
        }
      }
      if (d.detritus && this.detritus[t] > 0.04) { const v = this.detritus[t] * 2 * d.detritus; if (v > s) { s = v; kind = 5; } }
      // crowding penalty
      if (s > 0) {
        let crowd = 0;
        for (let j = this.tileHead[t]; j >= 0; j = this.nextInTile[j]) { const b = this.animals[j]; if (b !== a && b.sp === a.sp) crowd++; }
        s /= 1 + crowd * 0.35;
      }
      if (t === a.tile) s *= 1.25;
      if (s > bestScore) { bestScore = s; bestT = t; bestKind = kind; }
    };
    consider(a.tile);
    for (const t of w.nb[a.tile]) consider(t);
    if (sp.sense + keen >= 2 && bestScore < 0.25) for (const t of w.ring2[a.tile]) consider(t);
    if (bestT < 0) {
      // nothing nearby: roam purposefully
      if (a.state !== 4 || a.timer <= 0) { a.state = 4; a.timer = 30; this.turn(a, this.rng.float(-0.8, 0.8)); }
      a.moving = 0.85;
      return true;
    }
    if (bestT === a.tile) {
      // eat
      a.moving = sp.flying ? 0.15 : 0;
      a.state = 5;
      if (bestKind === 1) {
        // grazing never strips the roots: cover can't be eaten below a small floor, so it regrows
        const take = Math.max(0, Math.min(this.cover[bestT] - 0.07, bite));
        this.cover[bestT] -= take; this.changedTiles.add(bestT); this.dirtyTiles = true;
        a.energy = Math.min(1, a.energy + take * 2.6 * PLANT[COVER_IDS[this.coverSp[bestT] - 1]].food);
      } else if (bestKind === 2) {
        const p = this.plants[this.plantAt[bestT]]; const ps = PLANTS[p.sp];
        const dmg = 0.05 * a.genes.size * (1 - this.adaptLevel(ps.id, 'thorns') * 0.3);
        p.health -= dmg * 0.6; p.growth = Math.max(0.3, p.growth - dmg * 0.25);
        a.energy = Math.min(1, a.energy + dmg * 2.2 * ps.browse);
      } else if (bestKind === 3) {
        const p = this.plants[this.plantAt[bestT]];
        p.pollen = Math.min(1, p.pollen + 0.6);
        a.energy = Math.min(1, a.energy + 0.2);
        a.lastPlant = bestT; this.stats.pollinations++;
        this.emit('pollinate', { a, p });
      } else if (bestKind === 4) {
        const p = this.plants[this.plantAt[bestT]];
        p.health -= 0.04; a.energy = Math.min(1, a.energy + 0.06);
        this.fert[bestT] = Math.min(1, this.fert[bestT] + 0.01);
      } else if (bestKind === 5) {
        const take = Math.min(this.detritus[bestT], 0.03);
        this.detritus[bestT] -= take; this.fert[bestT] = Math.min(1, this.fert[bestT] + take * 0.9);
        a.energy = Math.min(1, a.energy + take * 3); this.changedTiles.add(bestT);
      }
      return true;
    }
    // move toward food tile
    const T = bestT * 3;
    this.steerTo(a, w.pos[T], w.pos[T + 1], w.pos[T + 2], 0.5);
    a.moving = 0.9; a.state = 1;
    return true;
  }

  tryBreed(a, sp) {
    const pop = this.popCount[sp.id] || 0;
    if (pop >= sp.cap || this.animals.length >= MAX_ANIMALS - 4) return;
    // need a mature mate nearby
    let mate = null;
    const check = (t) => {
      for (let j = this.tileHead[t]; j >= 0 && !mate; j = this.nextInTile[j]) {
        const b = this.animals[j];
        if (b !== a && !b.dead && b.sp === a.sp && b.age > sp.mature && b.energy > 0.5) mate = b;
      }
    };
    check(a.tile);
    for (const t of this.world.nb[a.tile]) { if (mate) break; check(t); }
    if (!mate) for (const t of this.world.ring2[a.tile]) { if (mate) break; check(t); }
    if (!mate) return;
    const fertile = this.adaptLevel(sp.id, 'fertile');
    let n = this.rng.int(sp.litter[0], sp.litter[1]);
    if (fertile && this.rng.next() < fertile * 0.25) n++;
    // density dependence
    const room = 1 - pop / sp.cap;
    if (this.rng.next() > 0.35 + room) return;
    for (let k = 0; k < n; k++) {
      const genes = {};
      for (const key of ['speed', 'size', 'meta']) {
        const base = (a.genes[key] + mate.genes[key]) / 2;
        genes[key] = clamp(base * (1 + this.rng.gauss(0, 0.045)), 0.6, 1.6);
      }
      genes.hardy = clamp((a.genes.hardy + mate.genes.hardy) / 2 + this.rng.gauss(0, 0.03), 0, 0.6);
      const child = this.spawnAnimal(sp.id, a.x + this.rng.float(-0.01, 0.01), a.y + this.rng.float(-0.01, 0.01), a.z + this.rng.float(-0.01, 0.01), {
        tile: a.tile, energy: 0.55, age: 0, cooldown: sp.mature, genes, gen: Math.max(a.gen, mate.gen) + 1,
      });
      if (!child) break;
      this.emit('birth', child);
    }
    a.energy -= 0.11 * n + 0.04; mate.energy -= 0.06;
    a.cooldown = sp.flying || sp.aquatic ? 0.9 : 1.3; mate.cooldown = Math.max(mate.cooldown, 0.6);
  }

  killAnimal(a, cause, killer = null) {
    if (a.dead) return;
    a.dead = true;
    const sp = ANIMALS[a.sp];
    this.popCount[sp.id] = Math.max(0, (this.popCount[sp.id] || 0) - 1);
    if (!sp.aquatic && !this.world.ocean[a.tile]) {
      this.detritus[a.tile] = Math.min(1, this.detritus[a.tile] + sp.size * (cause === 'eaten' ? 0.4 : 1.2));
      this.changedTiles.add(a.tile);
    }
    this.stats.died[sp.id] = (this.stats.died[sp.id] || 0) + 1;
    const ck = sp.id + ':' + cause; (this.stats.causes ||= {})[ck] = (this.stats.causes[ck] || 0) + 1;
    if (cause === 'eaten') this.stats.eaten[sp.id] = (this.stats.eaten[sp.id] || 0) + 1;
    this.emit('death', { a, cause, killer });
    if (this.popCount[sp.id] === 0) this.emit('extinct', sp.id);
  }

  // movement on the sphere
  move(a, sp) {
    const w = this.world;
    if (a.moving <= 0.01) { a.alt += ((sp.flying ? (sp.id === 'hawk' ? 2.2 : 0.4) : 0) - a.alt) * (sp.flying ? 0.05 : 0); return; }
    const swift = 1 + this.adaptLevel(sp.id, 'swift') * 0.12;
    const step = sp.speed * a.moving * a.genes.speed * swift * 0.015; // radians per tick (~0.15 world units)
    const ca = Math.cos(step), sa = Math.sin(step);
    let nx = a.x * ca + a.hx * sa, ny = a.y * ca + a.hy * sa, nz = a.z * ca + a.hz * sa;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const nt = w.nearestTile(nx, ny, nz, a.tile);
    const blocked = sp.aquatic ? !w.ocean[nt] : (sp.flying && sp.predator) ? false : !!w.ocean[nt];
    if (blocked) {
      // turn around
      this.turn(a, Math.PI * (0.6 + this.rng.next() * 0.8));
      a.timer = 0;
      return;
    }
    // new heading = derivative of great circle
    let hx = a.hx * ca - a.x * sa, hy = a.hy * ca - a.y * sa, hz = a.hz * ca - a.z * sa;
    a.x = nx; a.y = ny; a.z = nz;
    const d = hx * nx + hy * ny + hz * nz; hx -= d * nx; hy -= d * ny; hz -= d * nz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    a.hx = hx / hl; a.hy = hy / hl; a.hz = hz / hl;
    a.tile = nt;
    // smooth surface height from tile + neighbours
    a.r = this.surfaceR(nx, ny, nz, nt);
    if (sp.flying) {
      const base = sp.id === 'hawk' ? 2.2 : 0.45;
      a.alt += (base + Math.sin(this.tick * 0.08 + a.phase) * (sp.id === 'hawk' ? 0.3 : 0.15) - a.alt) * 0.08;
    }
  }

  surfaceR(x, y, z, t) {
    const w = this.world, P = w.pos;
    let sw = 0, sr = 0;
    const add = (i) => {
      const d = x * P[i * 3] + y * P[i * 3 + 1] + z * P[i * 3 + 2];
      const wgt = Math.pow(Math.max(0, d - 0.995) * 200 + 0.0001, 2);
      sw += wgt; sr += wgt * Math.max(R * 1.002, w.radiusAt(i));
    };
    add(t); for (const j of w.nb[t]) add(j);
    return sr / sw;
  }

  turn(a, ang) {
    // rotate heading around the local normal (position)
    const c = Math.cos(ang), s = Math.sin(ang);
    // b = n × h
    const bx = a.y * a.hz - a.z * a.hy, by = a.z * a.hx - a.x * a.hz, bz = a.x * a.hy - a.y * a.hx;
    a.hx = a.hx * c + bx * s; a.hy = a.hy * c + by * s; a.hz = a.hz * c + bz * s;
  }
  steerTo(a, tx, ty, tz, rate) {
    // tangent direction to target
    const d = tx * a.x + ty * a.y + tz * a.z;
    let vx = tx - d * a.x, vy = ty - d * a.y, vz = tz - d * a.z;
    const l = Math.hypot(vx, vy, vz); if (l < 1e-6) return;
    vx /= l; vy /= l; vz /= l;
    a.hx += (vx - a.hx) * rate; a.hy += (vy - a.hy) * rate; a.hz += (vz - a.hz) * rate;
    const k = a.hx * a.x + a.hy * a.y + a.hz * a.z;
    a.hx -= k * a.x; a.hy -= k * a.y; a.hz -= k * a.z;
    const hl = Math.hypot(a.hx, a.hy, a.hz) || 1; a.hx /= hl; a.hy /= hl; a.hz /= hl;
  }
  steerAway(a, tx, ty, tz, rate) { this.steerTo(a, 2 * a.x - tx, 2 * a.y - ty, 2 * a.z - tz, rate); }

  // ------------------------------------------------------------------ events
  stepEvents() {
    const day = this.day;
    // expire & apply ongoing effects
    for (const e of this.events) {
      if (e.type === 'drought' && e.tiles) for (const t of e.tiles) { if (this.moistMod[t] > -0.45) { this.moistMod[t] = Math.max(-0.5, this.moistMod[t] - 0.06); this.changedTiles.add(t); } }
    }
    const ended = this.events.filter((e) => day >= e.end);
    if (ended.length) {
      this.events = this.events.filter((e) => day < e.end);
      for (const e of ended) {
        if (e.type === 'heatwave' || e.type === 'coldsnap') this.tempOffset -= e.delta;
        this.emit('eventEnd', e);
      }
      this.dirtyTiles = true;
    }
    if (!this.game.eventsEnabled()) return;
    const era = this.game.state.era;
    if (era < 3 || day < this.nextEventDay) return;
    if (this.events.length >= 2) { this.nextEventDay = day + 1; return; }
    this.triggerEvent();
  }

  triggerEvent(forceType = null) {
    const era = this.game.state.era, day = this.day, w = this.world;
    const plantCounts = {};
    for (const p of this.plants) if (!p.dead && !PLANTS[p.sp].unique) plantCounts[PLANTS[p.sp].id] = (plantCounts[PLANTS[p.sp].id] || 0) + 1;
    const topPlant = Object.entries(plantCounts).sort((a, b) => b[1] - a[1])[0];
    const topAnimal = Object.entries(this.popCount).filter(([k, v]) => v > 0).sort((a, b) => b[1] / ANIMAL[b[0]].cap - a[1] / ANIMAL[a[0]].cap)[0];
    const options = [
      { type: 'drought', w: 3 },
      { type: 'rains', w: 2 },
      { type: 'bloom', w: plantCounts.flower ? 2 : 0 },
      { type: 'heatwave', w: era >= 4 ? 1.5 : 0 },
      { type: 'coldsnap', w: era >= 4 ? 1.5 : 0 },
      { type: 'blight', w: topPlant && topPlant[1] > 12 ? 2 : 0 },
      { type: 'plague', w: topAnimal && topAnimal[1] > ANIMAL[topAnimal[0]].cap * 0.6 ? 2.5 : 0 },
      { type: 'migration', w: era >= 4 ? 1.5 : 0 },
      { type: 'meteor', w: era >= 4 ? 1.2 : 0 },
    ];
    const pick = forceType ? options.find((o) => o.type === forceType) : this.rng.weighted(options, (o) => o.w);
    if (!pick) return null;
    const type = pick.type;
    const e = { id: UID++, type, start: day, end: day + 3 + this.rng.float(0, 2) };
    const landTile = () => w.landTiles[Math.floor(this.rng.next() * w.landTiles.length)];
    if (type === 'drought') {
      // pick a vegetated land region
      let best = landTile(), bs = -1;
      for (let k = 0; k < 20; k++) { const t = landTile(); let s = this.cover[t] + (this.plantAt[t] >= 0 ? 1 : 0); for (const j of w.nb[t]) s += this.cover[j]; if (s > bs) { bs = s; best = t; } }
      e.tile = best; e.tiles = w.tilesWithin(best, 0.42); e.hp = 2;
    } else if (type === 'heatwave') { e.delta = 0.13; this.tempOffset += e.delta; }
    else if (type === 'coldsnap') { e.delta = -0.15; this.tempOffset += e.delta; }
    else if (type === 'blight') {
      e.sp = topPlant ? topPlant[0] : 'grass';
      e.end = day + 3.5;
      // blight strength reduced by diversity
      const div = Object.keys(plantCounts).length;
      if (div >= 5) e.end = day + 2;
      e.tiles = null;
    } else if (type === 'plague') { e.sp = topAnimal[0]; e.end = day + 2.5; }
    else if (type === 'migration') {
      const st = this.game.state;
      const opts = ANIMALS.filter((a) => st.research[a.id] && this.oxygen >= a.o2Min * 0.9);
      const sp = opts.length ? this.rng.pick(opts) : null;
      if (!sp) return null;
      e.sp = sp.id; e.end = day + 0.5;
      let t = sp.aquatic ? w.oceanTiles[Math.floor(this.rng.next() * w.oceanTiles.length)] : landTile();
      // prefer a tile with food for land animals
      if (!sp.aquatic) for (let k = 0; k < 25; k++) { const c = landTile(); if (this.cover[c] > 0.4 || this.plantAt[c] >= 0) { t = c; break; } }
      e.tile = t;
      this.releaseAnimals(sp.id, t, sp.group + 2);
    } else if (type === 'meteor') {
      let t = landTile();
      // avoid world tree
      const wt = this.plants.find((p) => !p.dead && PLANTS[p.sp].unique);
      for (let k = 0; k < 10 && wt; k++) { const d = w.pos[t * 3] * w.pos[wt.tile * 3] + w.pos[t * 3 + 1] * w.pos[wt.tile * 3 + 1] + w.pos[t * 3 + 2] * w.pos[wt.tile * 3 + 2]; if (d < 0.9) break; t = landTile(); }
      e.tile = t; e.end = day + 1.2;
      e.pending = true; // the game plays the meteor animation, then calls impact()
    }
    this.events.push(e);
    this.nextEventDay = day + (era >= 6 ? 4.5 : era >= 5 ? 5.5 : 6.5) + this.rng.float(0, 3);
    this.emit('event', e);
    return e;
  }

  impact(tile) {
    const w = this.world;
    const size = 1;
    this.craters.push({ t: tile, s: size });
    w.carveCrater(tile, size);
    const tiles = w.tilesWithin(tile, 0.12);
    const set = new Set(tiles);
    for (const t of tiles) {
      this.cover[t] = 0; this.coverSp[t] = 0;
      this.fert[t] = Math.min(1, this.fert[t] + 0.45);
      this.detritus[t] = Math.min(1, this.detritus[t] + 0.2);
      const pi = this.plantAt[t]; if (pi >= 0) this.removePlant(this.plants[pi], 'meteor');
      this.changedTiles.add(t);
    }
    for (const a of this.animals) if (!a.dead && set.has(a.tile) && !ANIMALS[a.sp].flying) this.killAnimal(a, 'meteor');
    // animals in ocean tiles just get scared
    this.dirtyTiles = true; this.terrainChanged = true;
  }

  // ------------------------------------------------------------------ stats
  recount() {
    this.popCount = {};
    for (const a of this.animals) if (!a.dead) { const id = ANIMALS[a.sp].id; this.popCount[id] = (this.popCount[id] || 0) + 1; }
  }

  plantCounts() {
    const c = {};
    for (const p of this.plants) if (!p.dead) { const id = PLANTS[p.sp].id; c[id] = (c[id] || 0) + 1; }
    let moss = 0, grass = 0;
    for (let i = 0; i < this.world.n; i++) { if (this.coverSp[i] === 1 && this.cover[i] > 0.1) moss++; else if (this.coverSp[i] === 2 && this.cover[i] > 0.1) grass++; }
    if (moss) c.moss = moss; if (grass) c.grass = grass;
    return c;
  }

  computeGenes() {
    const sums = {};
    for (const a of this.animals) {
      if (a.dead) continue;
      const id = ANIMALS[a.sp].id;
      const s = (sums[id] ||= { n: 0, speed: 0, size: 0, meta: 0, hardy: 0, gen: 0 });
      s.n++; s.speed += a.genes.speed; s.size += a.genes.size; s.meta += a.genes.meta; s.hardy += a.genes.hardy; s.gen = Math.max(s.gen, a.gen);
    }
    const out = {};
    for (const [id, s] of Object.entries(sums)) out[id] = { n: s.n, speed: s.speed / s.n, size: s.size / s.n, meta: s.meta / s.n, hardy: s.hardy / s.n, gen: s.gen };
    this.geneAvg = out;
    return out;
  }

  record() {
    this.thrivingN = this.thriving().n;
    const h = this.history;
    h.t.push(+this.day.toFixed(2));
    h.o2.push(+this.oxygen.toFixed(2));
    const pc = this.plantCounts();
    const all = { ...pc, ...this.popCount };
    const keys = new Set([...Object.keys(h.pops), ...Object.keys(all)]);
    for (const k of keys) {
      const arr = (h.pops[k] ||= new Array(h.t.length - 1).fill(0));
      arr.push(all[k] || 0);
      this.stats.peak[k] = Math.max(this.stats.peak[k] || 0, all[k] || 0);
    }
    const MAX = 240;
    if (h.t.length > MAX) {
      h.t.splice(0, h.t.length - MAX); h.o2.splice(0, h.o2.length - MAX);
      for (const k of Object.keys(h.pops)) h.pops[k].splice(0, h.pops[k].length - MAX);
    }
  }

  // number of species with a healthy population
  thriving() {
    const pc = this.plantCounts();
    let n = 0; const list = [];
    for (const [id, c] of Object.entries(pc)) if (c >= (id === 'worldtree' ? 1 : 8)) { n++; list.push(id); }
    for (const [id, c] of Object.entries(this.popCount)) if (c >= 6) { n++; list.push(id); }
    if (this.game.state.research.algae && this.algae > 0.3) { n++; list.push('algae'); }
    return { n, list };
  }

  // ------------------------------------------------------------------ persistence
  serialize() {
    const q = (arr, s = 255) => b64(Uint8Array.from(arr, (v) => Math.round(clamp(v, 0, 1) * s)));
    return {
      v: 1, tick: this.tick, algae: this.algae, oxygen: this.oxygen, tempOffset: this.tempOffset,
      fert: q(this.fert), cover: q(this.cover), coverSp: b64(this.coverSp), detritus: q(this.detritus),
      moistMod: b64(Uint8Array.from(this.moistMod, (v) => Math.round((clamp(v, -1, 1) + 1) * 127.5))),
      shade: q(this.shade),
      plants: this.plants.filter((p) => !p.dead).map((p) => [p.sp, p.tile, +p.age.toFixed(3), +p.growth.toFixed(3), +p.health.toFixed(3), p.variant, +p.rot.toFixed(2), +p.scale.toFixed(2), +p.phase.toFixed(2), +p.life.toFixed(1), +p.pollen.toFixed(2)]),
      animals: this.animals.filter((a) => !a.dead).map((a) => [a.sp, +a.x.toFixed(4), +a.y.toFixed(4), +a.z.toFixed(4), a.tile, +a.energy.toFixed(3), +a.age.toFixed(3), +a.cooldown.toFixed(2), +a.genes.speed.toFixed(3), +a.genes.size.toFixed(3), +a.genes.meta.toFixed(3), +a.genes.hardy.toFixed(3), a.gen]),
      events: this.events.map((e) => ({ ...e, tiles: undefined, tilesSet: undefined })),
      craters: this.craters, nextEventDay: this.nextEventDay, history: this.history, stats: this.stats,
      baseline: this.speciesBaseline, notices: this.firstNotices,
    };
  }

  load(d) {
    const w = this.world;
    const uq = (s, arr, sc = 255) => { const u = unb64(s); for (let i = 0; i < arr.length && i < u.length; i++) arr[i] = u[i] / sc; };
    this.tick = d.tick || 0; this.algae = d.algae || 0; this.oxygen = d.oxygen ?? 0.4; this.tempOffset = d.tempOffset || 0;
    this.craters = d.craters || [];
    if (this.craters.length) w.applyCraters(this.craters);
    if (d.fert) uq(d.fert, this.fert);
    if (d.cover) uq(d.cover, this.cover);
    if (d.coverSp) { const u = unb64(d.coverSp); this.coverSp.set(u.subarray(0, this.coverSp.length)); }
    if (d.detritus) uq(d.detritus, this.detritus);
    if (d.shade) uq(d.shade, this.shade);
    if (d.moistMod) { const u = unb64(d.moistMod); for (let i = 0; i < this.moistMod.length; i++) this.moistMod[i] = u[i] / 127.5 - 1; }
    this.plants = []; this.plantAt.fill(-1);
    for (const r of d.plants || []) {
      const [sp, tile, age, growth, health, variant, rot, scale, phase, life, pollen] = r;
      if (!PLANTS[sp] || this.plantAt[tile] >= 0) continue;
      this.plants.push({ uid: UID++, sp, tile, age, growth, health, variant, rot, scale, phase, life, pollen: pollen || 0, flowering: false, dead: false });
      this.plantAt[tile] = this.plants.length - 1;
    }
    this.animals = [];
    for (const r of d.animals || []) {
      const [sp, x, y, z, tile, energy, age, cooldown, gs, gz, gm, gh, gen] = r;
      if (!ANIMALS[sp]) continue;
      const a = this.spawnAnimal(ANIMALS[sp].id, x, y, z, { tile, energy, age, cooldown, genes: { speed: gs, size: gz, meta: gm, hardy: gh }, gen });
      if (a) this.stats.born[ANIMALS[sp].id]--; // don't double count
    }
    this.events = (d.events || []).map((e) => {
      if (e.type === 'drought' && e.tile != null) e.tiles = w.tilesWithin(e.tile, 0.42);
      return e;
    });
    for (const e of this.events) if (e.type === 'meteor' && e.pending) { e.pending = false; this.impact(e.tile); }
    this.nextEventDay = d.nextEventDay ?? 7;
    if (d.history) this.history = d.history;
    if (d.stats) this.stats = { ...this.stats, ...d.stats };
    this.speciesBaseline = d.baseline || {};
    this.firstNotices = d.notices || {};
    this.recount();
    this.dirtyTiles = true; this.dirtyPlants = true;
  }
}

function rangeScore(v, mn, opt, mx) {
  if (v < mn) return Math.max(0, 0.5 - (mn - v) * 5);
  if (v > mx) return Math.max(0, 0.5 - (v - mx) * 5);
  if (v <= opt) return 0.5 + 0.5 * (opt - mn > 1e-6 ? (v - mn) / (opt - mn) : 1);
  return 0.5 + 0.5 * (mx - opt > 1e-6 ? (mx - v) / (mx - opt) : 1);
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export { COVER_IDS, rangeScore };
