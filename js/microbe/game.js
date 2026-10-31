// Microbe mode — the action roguelike run: simulation, rendering, HUD, overlays.
import { el, icon, fmt } from '../ui.js';
import { audio, haptic } from '../audio.js';
import { RNG, clamp, lerp } from '../rng.js';
import * as D from './data.js';
import { drawSpecies, drawPlayer, glowSprite, makeCausticTile, makeShaft, portrait, mixRGB, rgbStr, WHITE } from './art.js';
import { injectStyle, releaseStyle } from './style.js';

const TAU = Math.PI * 2;
const { sin, cos, atan2, hypot, min, max, abs, sqrt, exp, floor, random, PI } = Math;
const MAX_ENT = 250, MAX_MOTES = 200;
const HOSTILE = { hunter: 1, amoeba: 1, rotifer: 1, siphonophore: 1, phage: 1 };
const KIND_XP = { drifter: 2.5, grazer: 2.2, diatom: 4.5, hunter: 3, ciliate: 2.6, rotifer: 3, volvox: 1.4, amoeba: 2.6, phage: 0.6, siphonophore: 3 };
const angDiff = (a, b) => { const d = b - a; if (!Number.isFinite(d)) return 0; return ((d + PI) % TAU + TAU) % TAU - PI; };

export function startGame(opts) {
  const g = new MicrobeGame(opts);
  return g;
}

class MicrobeGame {
  constructor(opts) {
    this.o = opts;
    this.host = opts.host;
    this.era = clamp(opts.era | 0 || 1, 1, 6);
    this.genome = opts.genome || {};
    this.codex = opts.codex || { microbes: {}, mutations: {} };
    this.settings = opts.settings || {};
    this.firstRun = !!opts.firstRun;
    this.dnaMult = max(1, opts.dnaMult || 1);
    this.onExit = typeof opts.onExit === 'function' ? opts.onExit : () => {};
    this.battery = !!this.settings.battery;
    this.rng = new RNG((Date.now() ^ 0x5bd1e995) >>> 0);
    this.listeners = []; this.timeouts = [];
    this.exited = false; this.destroyed = false; this.raf = 0;
    this.T = 0; this.time = 0; this.paused = false; this.modal = null;
    this.depth = 1; this.depthTime = 0; this.depthsCleared = 0;
    this.ents = []; this.motes = []; this.parts = []; this.shards = []; this.texts = []; this.hazards = []; this.clouds = [];
    this.boss = null; this.bossSpawned = false; this.bossDefeated = false;
    this.stats = { kills: 0, miniKills: 0, finalKills: 0, biomass: 0, eaten: 0 };
    this.disc = { microbes: [], mutations: [] }; this.seen = {};
    this.mutOrder = [];
    this.shake = 0; this.flash = 0; this.slowmo = 1;
    this.combo = 0; this.comboT = 0;
    this.pendingLevels = 0; this.rerolls = this.genome.splice | 0;
    this.reviveLeft = (this.genome.cystmem | 0) > 0 ? 1 : 0;
    this.trans = null; this.dead = false; this.victory = false; this.abandoned = false;
    this.hints = { moved: 0, shown: {} };
    this.invuln = false;
    this.input = { jx: 0, jy: 0, mag: 0, active: false, ox: 0, oy: 0, cx: 0, cy: 0, id: null };
    this.keys = {};
    this.pal = D.PALETTES[0].bg.slice();
    this.palT = this.makePal(0);
    this.palCur = this.makePal(0);

    const g = this.genome;
    this.p = {
      x: 0, y: 0, vx: 0, vy: 0, r: D.playerRadius(1), ang: -PI / 2, seed: 0.42,
      level: 1, xp: 0, hp: 100, maxHp: 100, muts: {}, iframes: 0, flashT: 0, dent: 0, dentA: 0, stretch: 0,
      cyst: 0, cystUsed: false, dashT: 0, dashCd: 0, novaCd: 0, toxinT: 3, latched: 0, wiggle: 0, lastVA: 0, speedN: 0, wob: 0,
    };
    this.recalc(); this.p.hp = this.p.maxHp;

    injectStyle();
    this.buildDOM();
    this.buildArt();
    this.resize();
    this.on(window, 'resize', () => this.resize());
    this.on(window, 'keydown', (e) => this.onKey(e, true));
    this.on(window, 'keyup', (e) => this.onKey(e, false));
    this.on(window, 'blur', () => { this.keys = {}; this.releaseStick(); });
    this.on(document, 'visibilitychange', () => { if (document.hidden) this.pause(true); });
    const cv = this.canvas;
    this.on(cv, 'pointerdown', (e) => this.onDown(e));
    this.on(window, 'pointermove', (e) => this.onMove(e));
    this.on(window, 'pointerup', (e) => this.onUp(e));
    this.on(window, 'pointercancel', (e) => this.onUp(e));
    this.on(cv, 'contextmenu', (e) => e.preventDefault());
    this.on(this.root, 'touchmove', (e) => { if (!e.target.closest('.mb-results')) e.preventDefault(); }, { passive: false });
    this.on(this.root, 'gesturestart', (e) => e.preventDefault());

    if (this.settings.music !== false) audio.music('microbe');
    this.enterDepth(1, true);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    if ((g.headstart | 0) > 0) { this.headstartLeft = g.headstart | 0; this.later(400, () => this.offerHeadstart()); }
    if (this.firstRun) this.later(700, () => this.hint('move', 'Drag anywhere to swim', 'hand', 6000, true));
  }

  // ---------- utils ----------
  on(t, ev, fn, o) { t.addEventListener(ev, fn, o); this.listeners.push([t, ev, fn, o]); }
  later(ms, fn) { const id = setTimeout(() => { this.timeouts = this.timeouts.filter((x) => x !== id); if (!this.destroyed) fn(); }, ms); this.timeouts.push(id); return id; }
  sfx(n, o) { if (this.settings.sfx !== false) audio.sfx(n, o); }
  buzz(p) { if (this.settings.haptics !== false) haptic(p); }
  makePal(i) { const P = D.PALETTES[i]; const o = {}; for (const k in P) o[k] = P[k].slice(); this.eraTint(o); return o; }
  eraTint(o) {
    const e = this.era - 1;
    const green = [20, 110, 70];
    mixRGB(o.bg, green, min(0.3, e * 0.06), o.bg);
    const dark = e === 0 ? 0.78 : 0.9 + e * 0.04;
    for (const k of ['bg', 'edge']) for (let j = 0; j < 3; j++) o[k][j] = min(255, o[k][j] * dark);
    mixRGB(o.plankton, [150, 255, 170], min(0.4, e * 0.08), o.plankton);
  }
  get engulf() { return 0.85 + 0.07 * (this.p.muts.pseudopod | 0); }
  canEat(e) { return e.kind !== 'colossus' && e.kind !== 'queen' && e.kind !== 'siphonophore' && !(e.kind === 'diatom' && e.armor > 0) && e.r < this.p.r * this.engulf; }

  recalc() {
    const p = this.p, m = p.muts, g = this.genome;
    const oldMax = p.maxHp;
    p.maxHp = Math.round(100 * (1 + 0.15 * (g.hp | 0)) + 25 * (m.membrane | 0));
    if (p.maxHp > oldMax) p.hp += p.maxHp - oldMax;
    p.hp = min(p.hp, p.maxHp);
    p.r = D.playerRadius(p.level);
    this.speedMult = (1 + 0.06 * (g.motor | 0)) * (1 + 0.12 * (m.flagellum | 0));
    this.accel = 5.5 * (1 + 0.25 * (m.cilia | 0));
    this.reach = 1 + 0.15 * (m.cilia | 0);
    this.magnet = (55 + p.r * 2.2) * (1 + 0.4 * (m.biolum | 0)) * (1 + 0.2 * (g.sensory | 0)) * this.reach;
    this.xpMult = (1 + 0.1 * (g.digest | 0)) * (1 + 0.15 * (m.vacuole | 0));
    this.regen = 0.9 * (m.mito | 0);
    this.hazMult = 1 - 0.25 * (m.osmo | 0);
    this.sight = 1 - 0.22 * (m.mimicry | 0);
  }

  // ---------- DOM ----------
  buildDOM() {
    const root = this.root = el('div.mb-root');
    this.canvas = el('canvas.mb-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    root.appendChild(this.canvas);
    const hud = this.hud = el('div.mb-hud');
    this.hpBar = el('i'); this.hpNum = el('span.num', {}, '100');
    this.hpStat = el('div.mb-stat.mb-hp', {}, [icon('heart'), el('div.bar.hp', {}, this.hpBar), this.hpNum]);
    this.xpBar = el('i'); this.lvEl = el('span.mb-lv', {}, 'Lv 1');
    const xpStat = el('div.mb-stat', {}, [this.lvEl, el('div.bar.xp', {}, this.xpBar)]);
    this.dnaNum = el('span', {}, '0');
    this.dnaChip = el('div.chip.mb-dna', {}, [icon('dna'), this.dnaNum]);
    const pauseBtn = el('button.icon-btn.mb-pause.mb-tap', { 'aria-label': 'Pause', onpointerdown: (e) => e.stopPropagation(), onclick: () => { this.sfx('click'); this.pause(true); } }, icon('pause'));
    this.depthLabel = el('div.mb-depth-label', {}, '');
    this.depthBar = el('i'); this.pips = el('div.mb-pips');
    this.depthBox = el('div.mb-depth', {}, [this.depthLabel, el('div.bar', {}, this.depthBar), this.pips]);
    hud.appendChild(el('div.mb-top', {}, [el('div.mb-row', {}, [this.hpStat, xpStat, this.dnaChip, pauseBtn]), this.depthBox]));
    this.abBox = el('div.mb-abilities'); hud.appendChild(this.abBox);
    this.toasts = el('div.mb-toasts'); hud.appendChild(this.toasts);
    this.flashEl = el('div.mb-flash'); this.fadeEl = el('div.mb-fade');
    root.appendChild(hud); root.appendChild(this.flashEl); root.appendChild(this.fadeEl);
    this.host.appendChild(root);
    this.abBtns = {};
    this.hudCache = {};
  }

  buildArt() {
    this.caustic = makeCausticTile(256, 11);
    this.shaft = makeShaft();
    this.tinted = {};
    this.plankton = [];
    const n = this.battery ? 45 : 90;
    for (let i = 0; i < n; i++) this.plankton.push({ x: random(), y: random(), z: 0.15 + random() * 0.75, s: 0.5 + random() * 1.6, ph: random() * TAU });
  }
  tint(img, c) {
    const k = c.join(',') + (img === this.caustic ? 'c' : 's');
    if (this.tinted[k]) return this.tinted[k];
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = rgbStr(c); g.fillRect(0, 0, cv.width, cv.height);
    const keys = Object.keys(this.tinted); if (keys.length > 12) delete this.tinted[keys[0]];
    return (this.tinted[k] = cv);
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    this.W = max(1, r.width); this.H = max(1, r.height);
    this.dpr = this.battery ? 1 : min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.bgGrad = null; this.vig = null; this.redVig = null; this.frozenFrames = 0;
  }

  // ---------- input ----------
  onKey(e, down) {
    if (this.destroyed) return;
    const k = e.key.toLowerCase();
    if (down && (k === 'p' || k === 'escape')) { e.preventDefault(); if (this.modal === 'pause') this.resume(); else if (!this.modal) this.pause(true); return; }
    if (down && k === ' ') { e.preventDefault(); if (!this.modal) { if (this.p.muts.dash) this.useDash(); else if (this.p.muts.nova) this.useNova(); } return; }
    if (down && (k === 'e' || k === 'shift')) { if (!this.modal && this.p.muts.nova) this.useNova(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); this.keys[k] = down; }
  }
  onDown(e) {
    if (this.modal || this.input.id != null) return;
    e.preventDefault();
    const r = this.root.getBoundingClientRect();
    const I = this.input; I.id = e.pointerId; I.active = true;
    I.ox = I.cx = e.clientX - r.left; I.oy = I.cy = e.clientY - r.top; I.mag = 0; I.jx = 0; I.jy = 0;
  }
  onMove(e) {
    const I = this.input; if (e.pointerId !== I.id) return;
    const r = this.root.getBoundingClientRect();
    I.cx = e.clientX - r.left; I.cy = e.clientY - r.top;
    let dx = I.cx - I.ox, dy = I.cy - I.oy; const d = hypot(dx, dy); const R = 62;
    if (d > R * 1.6) { I.ox = I.cx - dx / d * R * 1.6; I.oy = I.cy - dy / d * R * 1.6; dx = I.cx - I.ox; dy = I.cy - I.oy; }
    const dd = hypot(dx, dy);
    I.mag = dd < 5 ? 0 : min(1, (dd - 5) / (R - 5));
    if (dd > 0.01) { I.jx = dx / dd; I.jy = dy / dd; }
  }
  onUp(e) { if (e.pointerId === this.input.id) this.releaseStick(); }
  releaseStick() { const I = this.input; I.id = null; I.active = false; I.mag = 0; }
  moveDir() {
    const k = this.keys; let x = 0, y = 0;
    if (k.a || k.arrowleft) x -= 1; if (k.d || k.arrowright) x += 1; if (k.w || k.arrowup) y -= 1; if (k.s || k.arrowdown) y += 1;
    if (x || y) { const d = hypot(x, y); return [x / d, y / d, 1]; }
    const I = this.input; if (I.active && I.mag > 0) return [I.jx, I.jy, I.mag];
    return [0, 0, 0];
  }

  // ---------- flow ----------
  enterDepth(n, first = false) {
    this.depth = n; this.depthTime = 0;
    this.D = D.DEPTHS[n - 1];
    this.palT = this.makePal(n - 1);
    if (first) this.palCur = this.makePal(n - 1);
    this.ents.length = 0; this.motes.length = 0; this.shards.length = 0; this.hazards.length = 0; this.clouds.length = 0;
    this.boss = null; this.bossSpawned = false; this.bossDefeated = false;
    this.p.cystUsed = false; this.p.latched = 0;
    this.phageT = this.D.phageEvery ? this.D.phageEvery * 0.7 : 0;
    // fill initial world
    for (let i = 0; i < 70 + this.era * 8; i++) this.spawnMote(this.p.x + (random() - 0.5) * 1400, this.p.y + (random() - 0.5) * 1800, 1);
    this.populate(true);
    this.renderPips();
    this.banner(`Depth ${n}`, this.D.name, n === 5 ? 'danger' : '');
    // re-spawn clones near player
    for (let i = 0; i < (this.p.muts.fission | 0); i++) this.spawnClone();
  }
  renderPips() {
    this.pips.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      this.pips.appendChild(el('i', { class: (i < this.depth ? 'on' : '') + (i === this.depth ? ' cur' : '') }));
      if (D.DEPTHS[i - 1].boss) this.pips.appendChild(el('i.boss', { class: i < this.depth || (i === this.depth && this.bossDefeated) ? 'on' : '' }));
    }
  }
  descend() {
    if (this.trans || this.dead || this.victory) return;
    if (this.descendedFrom === this.depth) return; // never descend twice from the same depth
    this.descendedFrom = this.depth;
    this.depthsCleared = max(this.depthsCleared, this.depth);
    if (this.depth >= 5) { this.win(); return; }
    this.sfx('descend'); this.buzz([20, 40, 20]);
    this.trans = { t: 0, dur: 2.4, swapped: false };
    this.p.iframes = 3;
  }
  win() {
    if (this.dead || this.victory) return;
    this.victory = true; this.sfx('victory'); this.buzz([30, 50, 30, 50, 80]);
    this.banner('Victory', 'You reached the Vent of Origins', 'gold');
    this.later(2600, () => this.showResults());
  }
  die() {
    if (this.dead || this.victory) return;
    const p = this.p;
    if (p.muts.cyst && !p.cystUsed) {
      p.cystUsed = true; p.hp = p.maxHp * (0.25 + 0.15 * (p.muts.cyst - 1)); p.cyst = 1.6; p.iframes = 1.8;
      this.sfx('evolve'); this.buzz(60); this.toast('Cyst', 'Survived a lethal hit!', 'cyst', 'mutation');
      this.burst(p.x, p.y, [255, 220, 150], 24, 200); return;
    }
    if (this.reviveLeft > 0) {
      this.reviveLeft--; p.hp = p.maxHp * [0, 0.3, 0.6][min(2, this.genome.cystmem | 0)]; p.iframes = 2.5; p.cyst = 2;
      this.sfx('evolve'); this.buzz([40, 40, 80]); this.toast('Cyst Memory', 'Revived from a dormant cyst', 'cystmem', 'genome');
      this.shockwave(p.x, p.y, p.r * 9, 30, true); return;
    }
    this.dead = true; p.hp = 0; this.slowmo = 0.25;
    this.sfx('death'); this.buzz([60, 40, 120]);
    this.burst(p.x, p.y, [110, 255, 225], 40, 260);
    this.banner('Dissolved', `Depth ${this.depth} · Level ${p.level}`, 'danger');
    this.later(2300, () => this.showResults());
  }

  // ---------- spawning ----------
  spawnMote(x, y, v = 1, fade = 0) {
    if (this.motes.length >= MAX_MOTES) return null;
    const m = { x, y, vx: (random() - 0.5) * 10, vy: (random() - 0.5) * 10, v, ph: random() * TAU, s: 0.8 + random() * 0.5 * min(3, v), a: fade ? 0 : 1, life: 0 };
    this.motes.push(m); return m;
  }
  Es() { return 0.5 * D.expectedRadius(this.depth) + 0.5 * this.p.r; }
  spawn(kind, x, y, o = {}) {
    if (this.ents.length >= MAX_ENT && !o.force) return null;
    const E = o.E || this.Es(), R = this.rng, dp = this.depth;
    const sz = { drifter: [0.3, 0.42], grazer: [0.62, 1.3], diatom: [0.6, 1.0], hunter: [0.85, 1.6], amoeba: [2.0, 2.8], siphonophore: [0.6, 0.75], ciliate: [0.45, 0.62], rotifer: [0.9, 1.35], volvox: [1.5, 1.9], phage: [0.22, 0.28] }[kind] || [1, 1];
    const r = o.r || E * R.float(sz[0], sz[1]);
    const spd = { drifter: 55, grazer: 42, diatom: 14, hunter: 92 + 7 * dp, amoeba: 30, siphonophore: 26, ciliate: 85, rotifer: 70, volvox: 12, phage: 155 }[kind] || 40;
    const e = {
      kind, x, y, vx: 0, vy: 0, r, ang: R.float(0, TAU), seed: R.float(0, 10), t: 0, alive: true,
      spd: spd * Math.pow(r / 15, kind === 'phage' ? 0 : 0.25), hp: 0, maxHp: 0, flash: 0, dent: 0, dentA: 0, stretch: 0,
      wander: R.float(0, TAU), timer: R.float(0, 2), chasing: false, hitCd: 0, latched: false, la: 0, armor: 0, armorMax: 0, kids: 5, edibleCache: false, spawnFade: 0,
    };
    e.hp = e.maxHp = 6 + r * r * 0.08 * (1 + 0.25 * (dp - 1));
    if (kind === 'diatom') { e.armor = e.armorMax = 2 + (dp >= 3 ? 1 : 0); }
    if (kind === 'siphonophore') { e.segs = []; for (let i = 0; i < 4; i++) e.segs.push({ x: x - i * r * 1.8, y }); e.hp = e.maxHp = 40 + 25 * dp; }
    if (kind === 'phage') { e.hp = e.maxHp = 3; }
    if (kind === 'volvox') { e.hp = e.maxHp = 9999; e.kids = 5 + R.int(0, 2); }
    Object.assign(e, o.props || {});
    this.ents.push(e);
    return e;
  }
  spawnClone() {
    const p = this.p;
    const c = this.spawn('clone', p.x + 30, p.y + 30, { r: p.r * 0.55, force: true });
    if (c) { c.spd = 150; c.ally = true; c.hp = c.maxHp = 9999; }
  }
  viewR() { return hypot(this.W, this.H) / 2 / this.zoomV; }
  ringPos(minF = 1.1, maxF = 1.5) {
    const vr = this.viewR(), a = random() * TAU, d = vr * (minF + random() * (maxF - minF));
    return [this.p.x + cos(a) * d, this.p.y + sin(a) * d];
  }
  intensity() {
    let k = 0.55 + 0.45 * min(1, this.depthTime / (this.D.dur * 0.8));
    return k;
  }
  populate(initial = false) {
    const counts = {};
    for (const e of this.ents) counts[e.kind] = (counts[e.kind] || 0) + 1;
    const pop = this.D.pop, k = this.intensity();
    const eraBoost = 1 + 0.1 * (this.era - 1);
    for (const kind in pop) {
      const sp = D.SPECIES_BY_ID[kind];
      if (sp && sp.firstEra > this.era) continue;
      let target = pop[kind] * (HOSTILE[kind] ? k : eraBoost);
      if (this.firstRun && this.depth === 1 && (kind === 'hunter') && this.depthTime < 28) target = 0;
      if (this.depth === 1 && kind === 'hunter') target *= min(1, this.depthTime / 25 + 0.3);
      if (this.boss && HOSTILE[kind]) target *= 0.4;
      target = Math.round(target);
      let have = counts[kind] || 0;
      let guard = 0;
      while (have < target && guard++ < (initial ? 40 : 2)) {
        const [x, y] = initial && !HOSTILE[kind] ? [this.p.x + (random() - 0.5) * 1600, this.p.y + (random() - 0.5) * 1600] : this.ringPos();
        if (initial && hypot(x - this.p.x, y - this.p.y) < 220) continue;
        if (!this.spawn(kind, x, y)) break;
        have++;
      }
    }
    // hazards
    const hz = this.D.hazards || {};
    const hc = {};
    for (const h of this.hazards) hc[h.type] = (hc[h.type] || 0) + 1;
    for (const type in hz) {
      let hg = 0;
      while ((hc[type] || 0) < hz[type] && hg++ < 40) {
        const [x, y] = initial ? [this.p.x + (random() - 0.5) * 2400, this.p.y + (random() - 0.5) * 2400] : this.ringPos(1.3, 2.0);
        if (initial && hypot(x - this.p.x, y - this.p.y) < 350) continue;
        const E = D.expectedRadius(this.depth);
        const h = { type, x, y, r: type === 'uv' ? 90 + random() * 60 : type === 'vent' ? E * 5 : type === 'toxic' ? E * 6 + random() * 60 : 260, t: random() * 10, a: random() * TAU, moteT: 0 };
        if (type === 'current') { h.dx = cos(h.a); h.dy = sin(h.a); }
        this.hazards.push(h); hc[type] = (hc[type] || 0) + 1;
      }
    }
  }

  // ---------- main loop ----------
  loop(now) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) dt = 0; dt = min(dt, 1 / 20);
    const t0 = performance.now();
    const frozen = this.paused || !!this.modal;
    if (!frozen) { this.update(dt * this.slowmo); this.frozenFrames = 0; }
    if (!frozen || (this.frozenFrames = (this.frozenFrames || 0) + 1) <= 3) this.render(dt);
    this.frameMs = performance.now() - t0;
  }

  update(dt) {
    this.T += dt;
    const p = this.p;
    if (!this.dead && !this.victory && !this.trans) { this.time += dt; this.depthTime += dt; }
    if (this.dead) this.slowmo = min(1, this.slowmo + dt * 0.3);
    // transition
    if (this.trans) {
      const tr = this.trans; tr.t += dt / this.slowmo;
      const k = tr.t / tr.dur;
      this.fadeEl.style.opacity = String(k < 0.5 ? k * 2 : max(0, 2 - k * 2));
      if (k >= 0.5 && !tr.swapped) { tr.swapped = true; this.enterDepth(this.depth + 1); }
      if (k >= 1) { this.trans = null; this.fadeEl.style.opacity = '0'; }
    }
    // palette lerp
    const pc = this.palCur, pt = this.palT, pk = 1 - exp(-dt * 1.5);
    for (const k in pc) mixRGB(pc[k], pt[k], pk, pc[k]);

    this.updatePlayer(dt);
    this.updateMotes(dt);
    this.updateEnts(dt);
    this.updateHazards(dt);
    this.updateShards(dt);
    this.updateParts(dt);
    if (this.boss) this.updateBoss(dt);

    // depth progression
    if (!this.dead && !this.victory && !this.trans) {
      if (this.depthTime >= this.D.dur) {
        if (this.D.boss) { if (!this.bossSpawned) this.spawnBoss(); } // boss death schedules the descent / victory
        else this.descend();
      }
      // phage swarms
      if (this.D.phageEvery) { this.phageT -= dt; if (this.phageT <= 0) { this.phageT = this.D.phageEvery * (0.8 + random() * 0.5); this.phageSwarm(4 + this.depth); } }
      this.popT = (this.popT || 0) - dt; if (this.popT <= 0) { this.popT = 0.25; this.populate(); }
    }
    this.comboT -= dt; if (this.comboT <= 0) this.combo = 0;
    this.shake = max(0, this.shake - dt * 30);
    this.flash = max(0, this.flash - dt * 3);
    this.updateHints(dt);
    if (this.pendingLevels > 0 && !this.modal && !this.dead && !this.trans) this.offerLevel();
  }

  updatePlayer(dt) {
    const p = this.p, m = p.muts;
    p.iframes = max(0, p.iframes - dt); p.flashT = max(0, p.flashT - dt); p.cyst = max(0, p.cyst - dt);
    p.dashCd = max(0, p.dashCd - dt); p.novaCd = max(0, p.novaCd - dt);
    p.dent *= exp(-dt * 6);
    if (this.dead) { p.vx *= 0.9; p.vy *= 0.9; return; }
    const [dx, dy, mag] = this.moveDir();
    if (mag > 0) this.hints.moved += dt;
    const latchSlow = 1 - min(0.45, p.latched * 0.07);
    const top = D.baseSpeed(p.r) * this.speedMult * latchSlow;
    if (p.dashT > 0) {
      p.dashT -= dt;
    } else if (mag > 0) {
      const tx = dx * top * mag, ty = dy * top * mag;
      const a = 1 - exp(-dt * this.accel);
      p.vx += (tx - p.vx) * a; p.vy += (ty - p.vy) * a;
    } else {
      const d = exp(-dt * 1.6); p.vx *= d; p.vy *= d;
    }
    // currents
    for (const h of this.hazards) if (h.type === 'current') {
      const ddx = p.x - h.x, ddy = p.y - h.y, d2 = ddx * ddx + ddy * ddy;
      if (d2 < h.r * h.r) { const f = (1 - sqrt(d2) / h.r) * 95 * this.hazMult; p.vx += h.dx * f * dt; p.vy += h.dy * f * dt; }
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    const sp = hypot(p.vx, p.vy);
    p.speedN = min(1.5, sp / max(1, top));
    if (sp > 8) { const ta = atan2(p.vy, p.vx); const da = angDiff(p.ang, ta); p.ang = ta - da + da * min(1, dt * 8); p.wiggle += abs(da) * min(1, sp / top) * 1.2; }
    p.wiggle *= exp(-dt * 1.2);
    p.stretch = lerp(p.stretch, min(0.16, p.speedN * 0.1) + (p.dashT > 0 ? 0.12 : 0), 1 - exp(-dt * 6));
    p.wob = lerp(p.wob, p.flashT > 0 ? 0.08 : 0, 1 - exp(-dt * 8));
    // regen & sustain
    if (this.regen) this.heal(this.regen * dt);
    if (m.chloro) this.heal(m.chloro * 0.6 * this.D.sun * dt);
    // toxin gland
    if (m.toxin) {
      p.toxinT -= dt;
      if (p.toxinT <= 0) { p.toxinT = 5 - 0.7 * (m.toxin - 1); this.clouds.push({ x: p.x, y: p.y, r: p.r * 3.6, life: 2.6, max: 2.6, dps: 8 + 6 * m.toxin }); this.sfx('toxin', { vol: 0.6 }); }
    }
    // phage shake-off by wiggle
    if (p.latched > 0 && p.wiggle > 5) { p.wiggle -= 2.5; this.detachPhages(1); }
    this.updateAbilitiesUI();
  }
  heal(n) { const p = this.p; if (p.hp < p.maxHp) p.hp = min(p.maxHp, p.hp + n); }
  hurt(n, src = null, opts = {}) {
    const p = this.p;
    if (this.dead || this.victory || this.invuln || this.trans) return false;
    if (!opts.dot && (p.iframes > 0 || p.cyst > 0)) return false;
    if (opts.dot && p.cyst > 0) return false;
    p.hp -= n;
    if (!opts.dot) {
      p.iframes = opts.iframes ?? 0.55; p.flashT = 0.25; this.shake = min(14, this.shake + 6 + n * 0.3); this.flash = 0.25;
      this.sfx('hurt'); this.buzz(25);
      if (src) { const a = atan2(p.y - src.y, p.x - src.x); p.vx += cos(a) * 260; p.vy += sin(a) * 260; p.dentA = a + PI - p.ang; p.dent = 0.25; }
      this.burst(p.x, p.y, [255, 120, 140], 8, 140);
      if (p.muts.spikes && src && src.hp !== undefined && !src.ally) this.damage(src, 12 * p.muts.spikes, p);
    }
    if (p.hp <= 0) this.die();
    return true;
  }

  updateMotes(dt) {
    const p = this.p, mr = this.magnet, mr2 = mr * mr, eatR = p.r * this.reach;
    const vr = this.viewR() * 2.3, vr2 = vr * vr;
    const ms = this.motes;
    let w = 0;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      m.life += dt; if (m.a < 1) m.a = min(1, m.a + dt * 2);
      const dx = p.x - m.x, dy = p.y - m.y, d2 = dx * dx + dy * dy;
      if (d2 > vr2) continue; // despawn
      if (!this.dead && d2 < mr2) {
        const d = sqrt(d2) + 0.001, f = (1 - d / mr) * 900 + 120;
        m.vx += dx / d * f * dt; m.vy += dy / d * f * dt;
        m.vx *= exp(-dt * 3); m.vy *= exp(-dt * 3);
      } else { m.vx *= exp(-dt * 0.8); m.vy *= exp(-dt * 0.8); m.vx += sin(this.T * 0.7 + m.ph) * 4 * dt; m.vy += cos(this.T * 0.6 + m.ph * 1.3) * 4 * dt; }
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (!this.dead && d2 < eatR * eatR && m.life > 0.15) { this.eatMote(m); continue; }
      ms[w++] = m;
    }
    ms.length = w;
    // spawn
    const target = (52 + 12 * (this.era - 1)) * (1 + (this.depth - 1) * 0.06);
    let guard = 0;
    while (ms.length < target && guard++ < 4) { const [x, y] = this.ringPos(0.95, 1.6); this.spawnMote(x, y, 1, 1); }
    if (random() < dt * 1.2 && ms.length < MAX_MOTES - 10) {
      // occasional in-view mote cluster
      const a = random() * TAU, d = this.viewR() * (0.4 + random() * 0.5);
      for (let i = 0; i < 3; i++) this.spawnMote(p.x + cos(a) * d + (random() - 0.5) * 40, p.y + sin(a) * d + (random() - 0.5) * 40, 1, 1);
    }
  }
  df() { return 1 + 0.38 * (this.depth - 1); }
  eatMote(m) {
    const v = m.v * this.df() * (1 + 0.05 * (this.era - 1));
    this.gainXP(v, false);
    this.combo++; this.comboT = 0.9;
    this.sfx('eat', { pitch: min(10, this.combo - 1), vol: 0.7 });
    this.sparkle(m.x, m.y, this.palCur.mote, 3);
  }
  gainXP(v, meal) {
    const p = this.p;
    const bonus = 1 + min(0.5, this.combo * 0.04);
    const x = v * this.xpMult * bonus;
    if (!(x > 0) || !Number.isFinite(x)) return;
    p.xp += x; this.stats.biomass += x;
    if (meal && p.muts.lysosome) this.heal(p.maxHp * 0.02 * p.muts.lysosome);
    let need = D.xpToNext(p.level), guard = 0;
    while (p.xp >= need && guard++ < 60) {
      p.xp -= need; p.level++; this.pendingLevels++;
      need = D.xpToNext(p.level);
    }
    if (p.xp >= need) p.xp = need * 0.99; // absurd grants: carry no more than one level
    this.pendingLevels = min(this.pendingLevels, 30);
    if (this.pendingLevels) this.recalc();
  }

  phageSwarm(n) {
    const [x, y] = this.ringPos(1.05, 1.2);
    this.sfx('bubble');
    for (let i = 0; i < n; i++) this.spawn('phage', x + (random() - 0.5) * 60, y + (random() - 0.5) * 60, { force: true });
    if (this.firstRun && !this.hints.shown.phage) this.later(1200, () => this.hint('phage', 'Phages latch on! Wiggle fast or dash to shake them off', 'microbe', 4500));
  }
  detachPhages(n) {
    const p = this.p;
    for (const e of this.ents) {
      if (n <= 0) break;
      if (e.kind === 'phage' && e.latched) {
        e.latched = false; p.latched--; n--;
        const a = e.la + p.ang; e.vx = cos(a) * 320; e.vy = sin(a) * 320; e.stun = 1.2; e.hp -= 1;
        this.sparkle(e.x, e.y, [200, 150, 255], 4);
        if (e.hp <= 0) this.kill(e, false);
      }
    }
    p.latched = max(0, p.latched);
    this.sfx('pop');
  }

  updateEnts(dt) {
    const p = this.p, ents = this.ents, T = this.T;
    const vr = this.viewR(), far2 = (vr * 2.6) ** 2;
    const sightBase = 300 * this.sight;
    let wi = 0;
    const halfW = this.W / 2 / this.zoomV, halfH = this.H / 2 / this.zoomV;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive) continue;
      e.t += dt; e.flash = max(0, e.flash - dt * 4); e.dent *= exp(-dt * 5); e.hitCd = max(0, e.hitCd - dt); e.timer -= dt;
      if (e.stun) e.stun = max(0, e.stun - dt);
      const dx = p.x - e.x, dy = p.y - e.y, d2 = dx * dx + dy * dy, d = sqrt(d2) + 0.0001;
      if (d2 > far2 && !e.boss && !e.ally) { e.alive = false; if (e.latched) p.latched--; continue; }
      // discovery
      if (!this.seen[e.kind] && abs(dx) < halfW + e.r && abs(dy) < halfH + e.r && D.SPECIES_BY_ID[e.kind]) this.discover(e.kind);
      const edible = this.canEat(e); e.edibleCache = edible;
      const bigger = !edible && e.r > p.r * 0.95;
      let tx = 0, ty = 0, sp = e.spd, steer = 2.2;
      const wander = () => { e.wander += (random() - 0.5) * dt * 2.4; tx = cos(e.wander); ty = sin(e.wander); };
      const flee = (k = 1) => { tx = -dx / d; ty = -dy / d; sp *= k; };
      const chase = (k = 1) => { tx = dx / d; ty = dy / d; sp *= k; };
      switch (e.kind) {
        case 'drifter': if (d < 150 + p.r * 2 && !this.dead) flee(2.0); else { wander(); sp *= 0.5; } break;
        case 'ciliate': if (d < 200 + p.r * 2 && edible) flee(2.0); else { wander(); if (e.timer < 0) { e.timer = 1 + random() * 2; e.wander += (random() - 0.5) * 2; } } break;
        case 'grazer': {
          if (bigger && e.r > p.r * 1.12 && d < sightBase * 0.8) { chase(0.8); e.chasing = true; }
          else if (edible && d < 170) { flee(1.45); e.chasing = false; }
          else {
            e.chasing = false;
            if (!e.tm || e.timer < 0 || !this.motes.includes(e.tm)) { e.timer = 1.5 + random() * 2; e.tm = this.nearestMote(e.x, e.y, 260); }
            if (e.tm) { const mx = e.tm.x - e.x, my = e.tm.y - e.y, md = hypot(mx, my) + 0.01; tx = mx / md; ty = my / md; sp *= 0.8; if (md < e.r) { this.removeMote(e.tm); e.tm = null; } }
            else { wander(); sp *= 0.5; }
          }
          break;
        }
        case 'diatom': wander(); sp *= 0.6; break;
        case 'hunter': {
          const sight = sightBase * (1 + 0.1 * this.depth);
          if (!this.dead && bigger && d < (e.chasing ? sight * 1.5 : sight)) { chase(1); e.chasing = true; steer = 2.6; }
          else if (edible && d < 220) { flee(1.15); e.chasing = false; }
          else { e.chasing = false; wander(); sp *= 0.45; }
          if (this.firstRun && e.chasing && !this.hints.shown.hunter) this.hint('hunter', 'Red spiky cells hunt you — stay away until you’re bigger', 'shield', 5000, false, 'warn');
          break;
        }
        case 'amoeba': if (!this.dead && bigger && d < sightBase * 1.1) chase(1); else { wander(); sp *= 0.6; } steer = 0.8; break;
        case 'rotifer': {
          if (!this.dead && bigger && d < sightBase) { chase(1); e.chasing = true; }
          else if (edible && d < 200) { flee(1.3); e.chasing = false; } else { wander(); sp *= 0.5; e.chasing = false; }
          // crown vortex sucks motes
          const ca = e.ang, cx = e.x + cos(ca) * e.r, cy = e.y + sin(ca) * e.r;
          for (const m of this.motes) { const mx = cx - m.x, my = cy - m.y, md2 = mx * mx + my * my; if (md2 < 14400) { const md = sqrt(md2) + 0.01; m.vx += mx / md * 260 * dt; m.vy += my / md * 260 * dt; if (md < e.r * 0.6) m.life = -99; } }
          break;
        }
        case 'siphonophore': if (!this.dead && d < sightBase * 0.9) chase(0.9); else { wander(); sp *= 0.7; } steer = 0.6; break;
        case 'volvox': wander(); sp *= 0.6; break;
        case 'phage': {
          if (e.latched) {
            const a = e.la + p.ang, rr = p.r * 0.95 + e.r * 0.6;
            e.x = p.x + cos(a) * rr; e.y = p.y + sin(a) * rr; e.ang = a + PI;
            this.hurt(2.4 * dt, null, { dot: true });
            if (!e.fx || e.fx < T) { e.fx = T + 0.5; this.sparkle(e.x, e.y, [255, 120, 160], 1); }
            ents[wi++] = e; continue;
          }
          if (e.stun > 0) { tx = 0; ty = 0; sp = 0; }
          else if (!this.dead && d < 520) { chase(1); steer = 3.5; }
          else { wander(); sp *= 0.6; }
          break;
        }
        case 'clone': {
          // allied: gather motes and small prey near player
          const pd = d;
          if (pd > 260) { tx = dx / d; ty = dy / d; sp = 220; }
          else {
            if (!e.tm || e.timer < 0 || !this.motes.includes(e.tm)) { e.timer = 0.8; e.tm = this.nearestMote(e.x, e.y, 240); }
            if (e.tm) { const mx = e.tm.x - e.x, my = e.tm.y - e.y, md = hypot(mx, my) + 0.01; tx = mx / md; ty = my / md; if (md < e.r * 1.2) { this.removeMote(e.tm); e.tm = null; this.gainXP(0.6 * this.df(), false); this.sparkle(e.x, e.y, this.palCur.mote, 2); } }
            else { tx = dx / d; ty = dy / d; sp = pd > 90 ? 120 : 10; }
          }
          e.r = p.r * 0.55;
          break;
        }
      }
      if (e.stun > 0 && e.kind !== 'phage') { sp *= 0.2; }
      // steering
      const a = 1 - exp(-dt * steer);
      e.vx += (tx * sp - e.vx) * a; e.vy += (ty * sp - e.vy) * a;
      e.x += e.vx * dt; e.y += e.vy * dt;
      const s = hypot(e.vx, e.vy);
      if (s > 3) e.ang += angDiff(e.ang, atan2(e.vy, e.vx)) * min(1, dt * 5);
      e.stretch = min(0.15, s / 600);
      if (e.segs) this.updateSegs(e);
      // interaction with player
      if (!this.dead && !e.ally) this.interact(e, d, dx, dy, dt, edible);
      // ally clone eating small prey
      if (e.kind === 'clone') this.cloneEat(e);
      if (e.alive) ents[wi++] = e;
    }
    ents.length = wi;
    // offensive auras: clouds, symbionts
    this.updateAuras(dt);
  }
  nearestMote(x, y, R) {
    let best = null, bd = R * R;
    for (const m of this.motes) { const dx = m.x - x, dy = m.y - y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = m; } }
    return best;
  }
  removeMote(m) { const i = this.motes.indexOf(m); if (i >= 0) { this.motes[i] = this.motes[this.motes.length - 1]; this.motes.pop(); } }
  updateSegs(e) {
    let px = e.x, py = e.y; const sp = e.r * 1.7;
    for (const s of e.segs) {
      const dx = s.x - px, dy = s.y - py, d = hypot(dx, dy) + 0.001;
      s.x = px + dx / d * sp; s.y = py + dy / d * sp; px = s.x; py = s.y;
    }
  }
  cloneEat(c) {
    for (const e of this.ents) {
      if (e === c || !e.alive || e.ally || e.boss) continue;
      if (e.r < c.r * 0.8 && e.kind !== 'phage' && !(e.kind === 'diatom' && e.armor > 0)) {
        const dx = e.x - c.x, dy = e.y - c.y;
        if (dx * dx + dy * dy < (c.r + e.r * 0.3) ** 2) { this.eat(e, 0.5); }
      }
    }
  }

  interact(e, d, dx, dy, dt, edible) {
    const p = this.p;
    if (e.kind === 'phage') {
      if (d < p.r + e.r * 0.8) {
        if (p.muts.spikes || p.dashT > 0) { this.kill(e, false); this.sparkle(e.x, e.y, [220, 180, 255], 5); this.sfx('hit'); return; }
        if (p.iframes > 0 && p.cyst > 0) return;
        e.latched = true; e.la = atan2(e.y - p.y, e.x - p.x) - p.ang; p.latched++;
        this.sfx('hit'); this.buzz(8);
      }
      return;
    }
    if (e.kind === 'siphonophore') { this.siphHit(e, dt); return; }
    const touch = p.r + e.r;
    if (d > touch) return;
    if (edible) {
      if (d < p.r + e.r * 0.25 || (d < touch && e.r < p.r * 0.5)) this.eat(e, 1);
      return;
    }
    // non-edible contact: push apart
    const nx = -dx / d, ny = -dy / d, overlap = touch - d;
    const massP = p.r * p.r, massE = e.r * e.r, tot = massP + massE;
    const relV = (p.vx - e.vx) * nx + (p.vy - e.vy) * ny;
    if (e.kind !== 'amoeba') {
      p.x -= nx * overlap * (massE / tot); p.y -= ny * overlap * (massE / tot);
      e.x += nx * overlap * (massP / tot); e.y += ny * overlap * (massP / tot);
    }
    if (e.kind === 'diatom') {
      if ((relV > 70 || p.dashT > 0) && e.hitCd <= 0) {
        e.hitCd = 0.35; e.armor -= p.dashT > 0 ? 2 : 1; e.flash = 1; e.dent = 0.3; e.dentA = atan2(-ny, -nx) - e.ang;
        this.sfx('hit', { pitch: 2 }); this.buzz(12); this.shake = min(10, this.shake + 3);
        this.burst(e.x - nx * e.r, e.y - ny * e.r, [255, 245, 215], 8, 160);
        if (e.armor <= 0) { e.armor = 0; this.sfx('pop'); this.texts.push({ x: e.x, y: e.y - e.r, s: 'Cracked!', life: 1, c: '#ffe7a8' }); }
        if (this.firstRun && !this.hints.shown.diatom) this.hint('diatom', 'Keep ramming the glass shell to crack it open', 'target', 3500);
      }
      p.vx -= nx * 160; p.vy -= ny * 160; e.vx += nx * 80; e.vy += ny * 80;
      return;
    }
    if (e.kind === 'volvox') {
      if (relV > 30 || p.dashT > 0) this.splitVolvox(e, nx, ny);
      p.vx -= nx * 90; p.vy -= ny * 90;
      return;
    }
    if (e.kind === 'grazer' && !(e.r > p.r * 1.12)) { p.vx -= nx * 60; p.vy -= ny * 60; return; }
    // hostile contact
    if (p.dashT > 0) { this.damage(e, 25 + 10 * (p.muts.dash | 0), p); e.vx += nx * 300; e.vy += ny * 300; e.stun = 0.8; return; }
    if (p.muts.spikes) this.damage(e, 10 * p.muts.spikes * dt * 2, p, true);
    if (e.kind === 'amoeba') {
      this.hurt((16 + 3 * this.depth) * dt * this.hazMult, null, { dot: true });
      if (!e.fx || e.fx < this.T) { e.fx = this.T + 0.25; p.flashT = 0.2; this.shake = min(6, this.shake + 1.5); this.sfx('hurt', { vol: 0.5 }); this.sparkle(p.x, p.y, [255, 150, 90], 3); }
      p.vx *= exp(-dt * 3); p.vy *= exp(-dt * 3);
      return;
    }
    const dmg = e.kind === 'hunter' ? 9 + 3.5 * this.depth : e.kind === 'rotifer' ? 8 + 3 * this.depth : 5 + 2 * this.depth;
    if (this.hurt(dmg, e)) { e.vx += nx * 140; e.vy += ny * 140; e.stun = 0.4; }
  }
  siphHit(e, dt) {
    const p = this.p;
    // bells
    const pts = [e, ...e.segs];
    let hit = false;
    for (let i = 0; i < pts.length && !hit; i++) {
      const s = pts[i];
      if (hypot(p.x - s.x, p.y - s.y) < p.r + e.r * 0.9) hit = true;
      // tentacle samples
      for (let k = 1; k <= 3 && !hit; k++) {
        const ta = e.ang + PI + sin(this.T * 1.5 + i + k) * 0.5;
        const tx = s.x + cos(ta) * e.r * 1.5 * k + cos(ta + PI / 2) * sin(this.T * 2 + k + i) * e.r * 0.5;
        const ty = s.y + sin(ta) * e.r * 1.5 * k + sin(ta + PI / 2) * sin(this.T * 2 + k + i) * e.r * 0.5;
        if (hypot(p.x - tx, p.y - ty) < p.r + 5) hit = true;
      }
    }
    if (hit) {
      if (p.muts.spikes) this.damage(e, 10 * p.muts.spikes * dt * 2, p, true);
      if (p.dashT > 0) { this.damage(e, 30, p); return; }
      this.hurt((14 + 2 * this.depth) * dt * 2.2 * this.hazMult, null, { dot: true });
      if (!e.fx || e.fx < this.T) { e.fx = this.T + 0.3; p.flashT = 0.2; this.sfx('toxin', { vol: 0.35 }); this.sparkle(p.x, p.y, [255, 120, 220], 3); this.shake = min(6, this.shake + 1.5); }
    }
  }
  splitVolvox(e, nx, ny) {
    if (!e.alive) return;
    e.alive = false;
    this.sfx('gulp', { vol: 0.7 }); this.buzz(15); this.burst(e.x, e.y, [140, 255, 150], 18, 200);
    const n = e.kids, kr = min(e.r * 0.36, this.p.r * 0.6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + random() * 0.4;
      const k = this.spawn('volvox', e.x + cos(a) * e.r * 0.5, e.y + sin(a) * e.r * 0.5, { r: kr, force: true, props: { kids: 2, hp: 20, maxHp: 20 } });
      if (k) { k.vx = cos(a) * 160 + nx * 60; k.vy = sin(a) * 160 + ny * 60; k.isKid = true; }
    }
  }
  eat(e, mult = 1) {
    if (!e.alive) return;
    e.alive = false; if (e.latched) { this.p.latched--; }
    const v = (KIND_XP[e.kind] || 2) * (e.r / 6) * this.df() * (e.kind === 'diatom' ? 1.3 : 1) * mult;
    this.gainXP(v, true);
    this.stats.eaten++; this.stats.kills++;
    this.combo++; this.comboT = 1.0;
    this.sfx('gulp', { vol: 0.8 }); this.sfx('eat', { pitch: min(10, this.combo + 1) });
    this.buzz(10);
    const col = (this.colorOf(e));
    this.burst(e.x, e.y, col, 10, 120);
    if (v >= 4) this.texts.push({ x: e.x, y: e.y - e.r, s: '+' + Math.round(v * this.xpMult), life: 1, c: '#bff4ff' });
    this.p.dent = 0.12; this.p.dentA = atan2(e.y - this.p.y, e.x - this.p.x) - this.p.ang;
    if (this.firstRun && !this.hints.shown.eat2 && this.stats.eaten === 1) this.hint('eat2', 'Smaller cells are food too — engulf them!', 'microbe', 3000);
  }
  colorOf(e) { const C = { drifter: [255, 220, 120], grazer: [110, 190, 255], diatom: [255, 220, 150], hunter: [255, 80, 100], amoeba: [255, 160, 90], ciliate: [140, 255, 190], rotifer: [255, 190, 110], volvox: [120, 240, 130], phage: [200, 150, 255], siphonophore: [255, 120, 220] }; return C[e.kind] || [200, 255, 240]; }
  damage(e, n, src, quiet = false) {
    if (!e.alive || e.ally) return;
    if (e.kind === 'volvox' && !e.isKid) { this.splitVolvox(e, 0, 0); return; }
    if (e.boss) { this.bossDamage(n, quiet); return; }
    e.hp -= n; e.flash = 1;
    if (!quiet) { this.sfx('hit'); e.dent = 0.25; if (src) e.dentA = atan2(src.y - e.y, src.x - e.x) - e.ang; }
    if (e.hp <= 0) this.kill(e, true);
  }
  kill(e, drops) {
    if (!e.alive) return;
    e.alive = false; if (e.latched) this.p.latched--;
    this.stats.kills++;
    this.burst(e.x, e.y, this.colorOf(e), 12, 160);
    if (drops) {
      const v = (KIND_XP[e.kind] || 2) * (e.r / 6) * 0.8;
      const n = clamp(Math.round(v / 1.5), 1, 8);
      for (let i = 0; i < n; i++) { const m = this.spawnMote(e.x + (random() - 0.5) * e.r, e.y + (random() - 0.5) * e.r, v / n); if (m) { const a = random() * TAU; m.vx = cos(a) * 90; m.vy = sin(a) * 90; } }
      this.sfx('pop', { pitch: 3 });
    }
  }
  updateAuras(dt) {
    const p = this.p, m = p.muts;
    // clouds
    for (const c of this.clouds) {
      c.life -= dt;
      for (const e of this.ents) {
        if (!e.alive || e.ally) continue;
        const dx = e.x - c.x, dy = e.y - c.y;
        if (dx * dx + dy * dy < (c.r + e.r) ** 2) { if (e.kind === 'phage') this.kill(e, false); else this.damage(e, c.dps * dt, null, true); }
      }
      if (this.boss && hypot(this.boss.x - c.x, this.boss.y - c.y) < c.r + this.boss.r) this.bossDamage(c.dps * dt * 0.6, true);
    }
    this.clouds = this.clouds.filter((c) => c.life > 0);
    // symbionts
    const ns = m.symbionts | 0;
    if (ns) {
      this.symb = this.symb || [];
      const R = p.r * 2.1;
      for (let i = 0; i < ns; i++) {
        const a = this.T * 2.2 + (i / ns) * TAU;
        const sx = p.x + cos(a) * R, sy = p.y + sin(a) * R;
        this.symb[i] = [sx, sy];
        for (const e of this.ents) {
          if (!e.alive || e.ally) continue;
          const dx = e.x - sx, dy = e.y - sy;
          if (dx * dx + dy * dy < (e.r + 7) ** 2) { if (e.kind === 'phage') { if (e.latched) { e.latched = false; p.latched--; } this.kill(e, false); } else this.damage(e, 22 * dt, null, true); }
        }
        if (this.boss) { const b = this.boss; if (hypot(b.x - sx, b.y - sy) < b.r + 7) this.bossDamage(12 * dt, true); }
        for (const s of this.shards) if (s.life > 0 && hypot(s.x - sx, s.y - sy) < 12) { s.life = 0; this.sparkle(s.x, s.y, [200, 220, 255], 4); }
      }
    }
  }

  updateHazards(dt) {
    const p = this.p, vr = this.viewR() * 3;
    let w = 0;
    for (const h of this.hazards) {
      h.t += dt;
      if (hypot(h.x - p.x, h.y - p.y) > vr + h.r) continue;
      const dx = p.x - h.x, dy = p.y - h.y, d = hypot(dx, dy);
      if (!this.dead) {
        if (h.type === 'uv') {
          const sx = h.x + (p.y - h.y) * 0.25; // slanted shaft
          if (abs(p.x - sx) < h.r * 0.5) {
            if (p.muts.chloro) { this.heal(3 * p.muts.chloro * dt); if (random() < dt * 6) this.sparkle(p.x + (random() - 0.5) * p.r * 2, p.y + (random() - 0.5) * p.r * 2, [140, 255, 150], 1); }
            else {
              this.hurt(5 * this.hazMult * dt, null, { dot: true }); p.uvT = (p.uvT || 0) + dt;
              if (this.firstRun && !this.hints.shown.uv && p.uvT > 0.6) this.hint('uv', 'UV light burns! Chloroplasts would turn it into food', 'sun', 3500, false, 'warn');
            }
          }
        } else if (h.type === 'toxic') {
          if (d < h.r * 0.8) { this.hurt(7 * this.hazMult * dt, null, { dot: true }); if (random() < dt * 4) this.sparkle(p.x, p.y, [160, 230, 90], 1); }
        } else if (h.type === 'vent') {
          if (d < h.r * 0.42 + p.r) { this.hurt(26 * this.hazMult * dt, null, { dot: true }); if (random() < dt * 8) { this.sparkle(p.x, p.y, [255, 120, 70], 1); p.flashT = 0.1; } }
        }
      }
      if (h.type === 'vent') {
        h.moteT -= dt;
        if (h.moteT <= 0) { h.moteT = 0.35; const a = random() * TAU, rr = h.r * (0.6 + random() * 0.5); this.spawnMote(h.x + cos(a) * rr, h.y + sin(a) * rr, 2.2, 1); }
      }
      this.hazards[w++] = h;
    }
    this.hazards.length = w;
  }

  // ---------- abilities ----------
  useDash() {
    const p = this.p; if (!p.muts.dash || p.dashCd > 0 || this.dead || this.modal) return;
    const [dx, dy, mag] = this.moveDir();
    const a = mag > 0 ? atan2(dy, dx) : p.ang;
    const v = D.baseSpeed(p.r) * this.speedMult * 3.4;
    p.vx = cos(a) * v; p.vy = sin(a) * v; p.ang = a;
    p.dashT = 0.28; p.iframes = max(p.iframes, 0.45); p.dashCd = 6 - 0.8 * (p.muts.dash - 1);
    this.detachPhages(99);
    this.sfx('dash'); this.buzz(20);
    for (let i = 0; i < 14; i++) this.part(p.x, p.y, -cos(a) * 200 + (random() - 0.5) * 120, -sin(a) * 200 + (random() - 0.5) * 120, 0.5, [190, 255, 240], 2 + random() * 3);
    this.abFlash('dash');
  }
  useNova() {
    const p = this.p; if (!p.muts.nova || p.novaCd > 0 || this.dead || this.modal) return;
    p.novaCd = 15 - 2 * (p.muts.nova - 1);
    this.shockwave(p.x, p.y, p.r * 7.5, 35 + 20 * p.muts.nova, false);
    this.sfx('toxin'); this.sfx('boss', { vol: 0.35 }); this.buzz([20, 30, 40]);
    this.abFlash('nova');
  }
  shockwave(x, y, R, dmg, knockOnly) {
    this.rings = this.rings || [];
    this.rings.push({ x, y, r: 0, R, life: 0.6, c: knockOnly ? [255, 230, 160] : [200, 130, 255] });
    this.shake = min(16, this.shake + 10); this.flash = 0.35;
    for (const e of this.ents) {
      if (!e.alive || e.ally) continue;
      const dx = e.x - x, dy = e.y - y, d = hypot(dx, dy) + 0.01;
      if (d < R + e.r) {
        if (e.latched) { e.latched = false; this.p.latched--; }
        e.vx += dx / d * 420; e.vy += dy / d * 420; e.stun = 1;
        if (!knockOnly) { if (e.kind === 'phage') this.kill(e, false); else this.damage(e, dmg, { x, y }); }
      }
    }
    this.p.latched = max(0, this.p.latched);
    for (const s of this.shards) if (hypot(s.x - x, s.y - y) < R) s.life = 0;
    if (!knockOnly && this.boss && hypot(this.boss.x - x, this.boss.y - y) < R + this.boss.r) this.bossDamage(dmg * 0.8);
  }
  buildAbilities() {
    const want = [];
    if (this.p.muts.dash) want.push('dash');
    if (this.p.muts.nova) want.push('nova');
    for (const id of want) {
      if (this.abBtns[id]) continue;
      const ring = el('div.mb-ring');
      const b = el('button.mb-ab.mb-tap', { class: (want.length > 1 && id === 'nova' ? 'small ' : '') + id, 'aria-label': D.MUT_BY_ID[id].name }, [ring, portrait('mutation', id, 56)]);
      if (id === 'nova') b.style.setProperty('--ring-c', '#c79cff');
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); id === 'dash' ? this.useDash() : this.useNova(); });
      this.abBox.appendChild(b);
      this.abBtns[id] = { b, ring, last: -1 };
    }
    if (this.abBtns.nova && this.abBtns.dash) this.abBtns.nova.b.classList.add('small');
    if (this.firstRun && !this.hints.shown.ability) this.later(300, () => this.hint('ability', 'Tap the new button (or Space) to use your ability', 'bolt', 3500));
  }
  abFlash(id) { const a = this.abBtns[id]; if (!a) return; a.b.classList.remove('flash'); void a.b.offsetWidth; a.b.classList.add('flash'); }
  updateAbilitiesUI() {
    const p = this.p;
    for (const id in this.abBtns) {
      const a = this.abBtns[id];
      const cd = id === 'dash' ? p.dashCd : p.novaCd, max_ = id === 'dash' ? 6 - 0.8 * (p.muts.dash - 1) : 15 - 2 * (p.muts.nova - 1);
      const k = cd <= 0 ? 1 : 1 - cd / max_;
      const q = Math.round(k * 50) / 50;
      if (q !== a.last) { a.last = q; a.ring.style.setProperty('--p', q); a.b.classList.toggle('ready', k >= 1); a.b.classList.toggle('cool', k < 1); }
    }
  }

  // ---------- bosses ----------
  spawnBoss() {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    const kind = this.D.boss, p = this.p;
    const a = random() * TAU, dist = this.viewR() * 0.95;
    const isQ = kind === 'queen';
    const b = this.spawn(kind, p.x + cos(a) * dist, p.y + sin(a) * dist, { force: true, r: isQ ? 120 + p.r * 1.2 : 120 + p.r * 1.5 });
    b.boss = true; b.hp = b.maxHp = isQ ? 1300 + 60 * this.era : 520 + 30 * this.era; b.spd = isQ ? 55 : 42;
    b.spots = []; const ns = isQ ? 3 : 4;
    for (let i = 0; i < ns; i++) b.spots.push({ a: (i / ns) * TAU + (isQ ? PI / 6 : 0.3), cd: 0, pulse: random() * TAU });
    b.atk = 2.5; b.state = 'idle'; b.st = 0; b.phase = 1; b.minT = 5; b.rot = 0; b.tele = 0;
    this.boss = b;
    // clear some hostiles for fairness
    for (const e of this.ents) if (e !== b && HOSTILE[e.kind] && e.kind !== 'phage' && hypot(e.x - p.x, e.y - p.y) < 600) e.alive = false;
    this.ents = this.ents.filter((e) => e.alive);
    this.sfx('boss'); this.buzz([80, 60, 120]);
    this.banner(isQ ? 'Phage Queen' : 'Colossal Amoeba', isQ ? 'The crystal virus awakens' : 'Something enormous stirs', 'danger');
    this.shake = 12;
    this.depthBox.classList.add('boss');
    if (this.firstRun || !this.hints.shown.boss) this.later(1800, () => this.hint('boss', 'Bite the glowing weak spots — avoid the body!', 'target', 4500));
  }
  updateBoss(dt) {
    const b = this.boss, p = this.p;
    if (!b.alive) return;
    const isQ = b.kind === 'queen';
    const dx = p.x - b.x, dy = p.y - b.y, d = hypot(dx, dy) + 0.01;
    b.rot += dt * (isQ ? 0.5 : 0.25) * (b.phase === 2 ? 1.6 : 1);
    b.tele = max(0, b.tele - dt * 2);
    for (const s of b.spots) { s.cd = max(0, s.cd - dt); s.pulse += dt * 4; }
    b.vx *= exp(-dt * 1.5); b.vy *= exp(-dt * 1.5);
    if (!isQ) {
      // slow hunt
      const sp = b.spd * (b.hp < b.maxHp * 0.5 ? 1.25 : 1);
      if (!this.dead) { b.vx += (dx / d * sp - b.vx) * min(1, dt * 0.8); b.vy += (dy / d * sp - b.vy) * min(1, dt * 0.8); }
      b.minT -= dt;
      if (b.minT <= 0) {
        b.minT = 7; b.tele = 1;
        this.sfx('gulp', { vol: 0.6 });
        for (let i = 0; i < 3; i++) {
          const a = random() * TAU, x = b.x + cos(a) * b.r, y = b.y + sin(a) * b.r;
          const kind = i < 2 ? 'grazer' : 'hunter';
          const m = this.spawn(kind, x, y, { force: true, r: kind === 'hunter' ? p.r * 1.05 : p.r * 0.7 });
          if (m) { m.vx = cos(a) * 160; m.vy = sin(a) * 160; }
        }
      }
    } else {
      b.st -= dt;
      const ph2 = b.phase === 2;
      if (b.state === 'idle') {
        const want = 280;
        const k = d > want ? 1 : -0.6;
        if (!this.dead) { b.vx += (dx / d * b.spd * k - b.vx) * min(1, dt); b.vy += (dy / d * b.spd * k - b.vy) * min(1, dt); }
        b.atk -= dt;
        if (b.atk <= 0 && !this.dead) {
          const r = random();
          b.state = r < 0.4 ? 'burstT' : r < 0.72 ? 'chargeT' : 'swarm';
          b.st = b.state === 'burstT' ? 0.9 : b.state === 'chargeT' ? 1.0 : 0.6;
          b.ca = atan2(dy, dx);
          if (b.state === 'swarm') this.sfx('bubble');
        }
      } else if (b.state === 'burstT') {
        b.tele = 1; b.vx *= 0.9; b.vy *= 0.9;
        if (b.st <= 0) {
          const n = ph2 ? 18 : 12, off = random() * TAU;
          for (let ring = 0; ring < (ph2 ? 2 : 1); ring++)
            for (let i = 0; i < n; i++) { const a = off + (i / n) * TAU + ring * PI / n; const s = 210 - ring * 50; this.shards.push({ x: b.x + cos(a) * b.r, y: b.y + sin(a) * b.r, vx: cos(a) * s, vy: sin(a) * s, life: 4, a }); }
          this.sfx('toxin'); this.shake = min(12, this.shake + 6);
          b.state = 'idle'; b.atk = ph2 ? 2.2 : 3.2;
        }
      } else if (b.state === 'chargeT') {
        b.tele = 1; b.ca = b.ca + angDiff(b.ca, atan2(dy, dx)) * min(1, dt * 3);
        b.vx *= 0.85; b.vy *= 0.85;
        if (b.st <= 0) { b.state = 'charge'; b.st = 0.85; const s = ph2 ? 620 : 520; b.vx = cos(b.ca) * s; b.vy = sin(b.ca) * s; this.sfx('dash'); this.sfx('boss', { vol: 0.3 }); }
      } else if (b.state === 'charge') {
        if (random() < 0.5) this.part(b.x, b.y, -b.vx * 0.2 + (random() - 0.5) * 80, -b.vy * 0.2 + (random() - 0.5) * 80, 0.6, ph2 ? [255, 110, 170] : [150, 180, 255], 4);
        if (b.st <= 0) { b.state = 'idle'; b.atk = ph2 ? 2 : 3; }
        b.vx /= exp(-dt * 1.5); b.vy /= exp(-dt * 1.5); // keep speed
      } else if (b.state === 'swarm') {
        if (b.st <= 0) {
          const n = ph2 ? 9 : 6;
          for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const e = this.spawn('phage', b.x + cos(a) * b.r, b.y + sin(a) * b.r, { force: true }); if (e) { e.vx = cos(a) * 220; e.vy = sin(a) * 220; } }
          b.state = 'idle'; b.atk = ph2 ? 2.4 : 3.4;
        }
      }
      if (!ph2 && b.hp < b.maxHp * 0.5) {
        b.phase = 2; b.state = 'idle'; b.atk = 1.2;
        this.banner('Phase 2', 'The Queen shatters into a fury', 'danger');
        this.sfx('boss'); this.shake = 16; this.flash = 0.5; this.buzz([60, 40, 60]);
        this.burst(b.x, b.y, [255, 110, 170], 40, 320);
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (!isQ) b.ang = atan2(b.vy, b.vx); else b.ang = b.state === 'chargeT' || b.state === 'charge' ? b.ca : atan2(dy, dx);
    // player interaction
    if (this.dead) return;
    let bit = false;
    for (const s of b.spots) {
      const a = s.a + b.rot, wx = b.x + cos(a) * b.r * 0.97, wy = b.y + sin(a) * b.r * 0.97, wr = 12 + b.r * 0.08;
      s.wx = wx; s.wy = wy; s.wr = wr;
      if (s.cd <= 0 && hypot(p.x - wx, p.y - wy) < p.r + wr) {
        s.cd = isQ ? 2.0 : 2.6; bit = true;
        const dmg = (28 + p.r * 1.3) * (1 + 0.3 * (p.muts.lysosome | 0)) * (p.dashT > 0 ? 1.5 : 1);
        this.bossDamage(dmg);
        this.burst(wx, wy, [255, 240, 140], 16, 220);
        this.sfx('gulp'); this.sfx('hit'); this.buzz(30); this.shake = min(14, this.shake + 7);
        const na = atan2(p.y - b.y, p.x - b.x);
        p.vx = cos(na) * 380; p.vy = sin(na) * 380; p.iframes = max(p.iframes, 0.5);
        b.vx -= cos(na) * 120; b.vy -= sin(na) * 120; b.tele = 1; b.dent = 0.25; b.dentA = na - b.ang;
        this.texts.push({ x: wx, y: wy - 10, s: '-' + Math.round(dmg), life: 1, c: '#ffe28a' });
      }
    }
    const bodyR = isQ ? b.r * 0.92 : b.r * 0.95;
    if (!bit && d < bodyR + p.r * 0.85) {
      const na = atan2(p.y - b.y, p.x - b.x);
      const pen = bodyR + p.r * 0.85 - d;
      p.x += cos(na) * pen; p.y += sin(na) * pen;
      if (p.dashT > 0) this.bossDamage(15);
      if (p.muts.spikes) this.bossDamage(6 * p.muts.spikes * dt, true);
      if (this.hurt((isQ ? 16 : 14) + 2 * this.depth, b, { iframes: 0.8 })) { p.vx = cos(na) * 420; p.vy = sin(na) * 420; }
    }
  }
  bossDamage(n, quiet = false) {
    const b = this.boss; if (!b || !b.alive) return;
    b.hp -= n; b.flash = quiet ? max(b.flash, 0.3) : 1;
    if (b.hp <= 0) this.bossDie();
  }
  bossDie() {
    const b = this.boss; if (!b.alive) return;
    b.alive = false; b.hp = 0;
    const isQ = b.kind === 'queen';
    if (isQ) this.stats.finalKills++; else this.stats.miniKills++;
    this.stats.kills++;
    this.bossDefeated = true; this.depthBox.classList.remove('boss');
    this.sfx('evolve'); this.sfx('victory'); this.buzz([50, 50, 100]);
    this.shake = 20; this.flash = 0.8; this.slowmo = 0.3;
    this.later(900, () => { if (!this.dead) this.slowmo = 1; });
    for (let i = 0; i < 4; i++) this.burst(b.x + (random() - 0.5) * b.r, b.y + (random() - 0.5) * b.r, isQ ? [160, 190, 255] : [255, 150, 90], 30, 340);
    for (let i = 0; i < 40; i++) { const a = random() * TAU, rr = random() * b.r; const m = this.spawnMote(b.x + cos(a) * rr, b.y + sin(a) * rr, 3, 0); if (m) { m.vx = cos(a) * 200; m.vy = sin(a) * 200; } }
    for (const e of this.ents) if (e.kind === 'phage') this.kill(e, false);
    this.shards.length = 0;
    this.boss = null;
    this.renderPips();
    if (isQ) { this.depthsCleared = 5; this.later(1500, () => this.win()); }
    else { this.banner('Colossus Defeated', '+15 DNA · the way down opens', 'gold'); this.later(3500, () => { if (!this.dead) this.descend(); }); }
  }
  updateShards(dt) {
    const p = this.p;
    let w = 0;
    for (const s of this.shards) {
      s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.life <= 0) continue;
      if (!this.dead && hypot(p.x - s.x, p.y - s.y) < p.r + 6) {
        if (p.muts.spikes && random() < 0.25 * p.muts.spikes) { this.sparkle(s.x, s.y, [220, 255, 250], 4); continue; }
        if (this.hurt(9 + 2 * this.depth, s)) { this.sparkle(s.x, s.y, [200, 220, 255], 6); continue; }
      }
      this.shards[w++] = s;
    }
    this.shards.length = w;
  }

  // ---------- particles ----------
  part(x, y, vx, vy, life, c, s) {
    const max_ = this.battery ? 160 : 400;
    if (this.parts.length >= max_) return;
    this.parts.push({ x, y, vx, vy, life, max: life, c, s });
  }
  burst(x, y, c, n, sp) { n = this.battery ? n >> 1 : n; for (let i = 0; i < n; i++) { const a = random() * TAU, v = sp * (0.3 + random() * 0.7); this.part(x, y, cos(a) * v, sin(a) * v, 0.4 + random() * 0.5, c, 2 + random() * 4); } }
  sparkle(x, y, c, n) { for (let i = 0; i < n; i++) { const a = random() * TAU, v = 30 + random() * 60; this.part(x, y, cos(a) * v, sin(a) * v, 0.3 + random() * 0.3, c, 1.5 + random() * 2.5); } }
  updateParts(dt) {
    let w = 0; const ps = this.parts, dk = exp(-dt * 3);
    for (const q of ps) { q.life -= dt; if (q.life <= 0) continue; q.vx *= dk; q.vy *= dk; q.x += q.vx * dt; q.y += q.vy * dt; ps[w++] = q; }
    ps.length = w;
    let wt = 0; for (const t of this.texts) { t.life -= dt * 0.9; t.y -= dt * 30; if (t.life > 0) this.texts[wt++] = t; } this.texts.length = wt;
    if (this.rings) { for (const r of this.rings) { r.life -= dt; r.r = r.R * (1 - r.life / 0.6); } this.rings = this.rings.filter((r) => r.life > 0); }
  }

  // ---------- discovery & toasts ----------
  discover(kind) {
    if (this.dead || this.victory || this.modal === 'results') return;
    this.seen[kind] = true;
    if (this.codex.microbes && this.codex.microbes[kind]) return;
    if (this.disc.microbes.includes(kind)) return;
    this.disc.microbes.push(kind);
    const sp = D.SPECIES_BY_ID[kind];
    this.toast('New species discovered!', `${sp.name} <span class="dna-c">+2 DNA</span>`, kind, 'microbe', 'dna');
    this.sfx('coin');
  }
  toast(kicker, text, pid, pkind, cls = '') {
    const t = el('div.toast', { class: cls }, [pid ? portrait(pkind, pid, 40) : null, el('div.mb-tt', {}, [el('small', {}, kicker), el('span', { html: text })])]);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    this.later(2600, () => { t.classList.add('out'); this.later(320, () => t.remove()); });
  }
  banner(title, sub, cls = '') {
    if (this.bannerEl) this.bannerEl.remove();
    const b = this.bannerEl = el('div.mb-banner', { class: cls }, [el('div.mb-kicker', {}, sub ? title : ''), el('h1', {}, sub || title)]);
    if (sub) { b.firstChild.textContent = title; b.lastChild.textContent = sub; }
    this.hud.appendChild(b);
    this.later(2900, () => b.remove());
  }
  hint(id, text, ic, ms = 4000, hand = false, cls = '') {
    if (!this.firstRun && id !== 'boss') return;
    if (this.hints.shown[id]) return;
    this.hints.shown[id] = true;
    if (this.hintEl) this.hintEl.remove();
    if (this.handEl) { this.handEl.remove(); this.handEl = null; }
    const h = this.hintEl = el('div.mb-hint', { class: cls }, [icon(ic), el('span', {}, text)]);
    this.hud.appendChild(h);
    if (hand) { this.handEl = el('div.mb-hand', {}, icon('hand')); this.hud.appendChild(this.handEl); }
    const hid = this.hintEl;
    this.later(ms, () => { if (this.hintEl === hid) this.clearHint(); });
  }
  clearHint() {
    const h = this.hintEl; this.hintEl = null;
    if (h) { h.classList.add('out'); this.later(300, () => h.remove()); }
    if (this.handEl) { this.handEl.remove(); this.handEl = null; }
  }
  updateHints() {
    if (!this.firstRun) return;
    if (this.hints.shown.move && !this.hints.shown.eat && this.hints.moved > 1.2) { this.clearHint(); this.hint('eat', 'Eat glowing motes to grow', 'star', 4500); }
  }

  // ---------- overlays ----------
  pickOffers(n) {
    const p = this.p, R = this.rng;
    const pool = D.MUTATIONS.filter((m) => (p.muts[m.id] | 0) < m.maxLevel);
    const out = [];
    while (out.length < n && pool.length) {
      const m = R.weighted(pool, (x) => D.RARITY[x.rarity].weight * (p.muts[x.id] ? 1.25 : 1) * (x.active && this.depth === 1 && p.level < 3 ? 0.5 : 1));
      out.push(m); pool.splice(pool.indexOf(m), 1);
    }
    return out;
  }
  offerLevel(headstart = false) {
    const p = this.p;
    if (!headstart) { this.pendingLevels--; }
    this.modal = 'level'; this.releaseStick(); this.keys = {};
    if (!headstart) { this.sfx('levelup'); this.buzz([15, 30, 15]); this.flash = 0.3; this.burst(p.x, p.y, [140, 255, 220], 20, 200); }
    const n = this.genome.wide ? 4 : 3;
    const ov = el('div.mb-overlay');
    const firstExplain = this.firstRun && !this.hints.shown.lvl && !headstart;
    if (firstExplain) this.hints.shown.lvl = true;
    const head = el('div.mb-lvl-head', {}, [
      el('div.mb-kicker', {}, headstart ? 'Head Start' : `Level ${p.level}`),
      el('h1', {}, headstart ? 'Choose a gene' : 'Evolve!'),
      firstExplain ? el('p.dim.small', {}, 'You grew big enough to mutate. Pick one — it changes how your cell looks and plays, and stacks if you pick it again.') : null,
    ]);
    const cardsBox = el('div.mb-cards');
    const foot = el('div.mb-lvl-foot');
    const render = () => {
      cardsBox.innerHTML = '';
      const offers = this.pickOffers(n);
      offers.forEach((m, i) => {
        const lv = p.muts[m.id] | 0;
        const rc = D.RARITY[m.rarity];
        const pips = el('div.mb-clv', {}, Array.from({ length: m.maxLevel }, (_, k) => el('i', { class: k < lv ? 'on' : k === lv ? 'new' : '' })));
        const isNew = !(this.codex.mutations && this.codex.mutations[m.id]) && !this.disc.mutations.includes(m.id);
        const card = el('button.mb-card', { style: { '--rc': rc.color, animationDelay: i * 0.07 + 's' } }, [
          isNew ? el('span.mb-new', {}, 'NEW') : null,
          el('div.mb-port', {}, portrait('mutation', m.id, 72)),
          el('div.mb-cbody', {}, [
            el('div.mb-cname', {}, [m.name, el('span.tag', { style: { color: rc.color, background: rc.color + '22' } }, rc.label)]),
            el('div.mb-cdesc', {}, m.desc),
            el('div.mb-ceff', {}, lv ? `${m.lv(lv)} → ${m.lv(lv + 1)}` : m.lv(1)),
            pips,
          ]),
        ]);
        card.style.setProperty('--rc', rc.color);
        card.addEventListener('click', () => {
          if (ov.dataset.done) return; ov.dataset.done = '1';
          this.sfx('evolve'); this.buzz(20);
          [...cardsBox.children].forEach((c) => c.classList.add(c === card ? 'chosen' : 'gone'));
          this.applyMutation(m.id);
          this.later(260, () => { ov.classList.add('closing'); this.later(200, () => { ov.remove(); this.modal = null; this.levelOv = null; if (this.pausedFromLevel) { this.pausedFromLevel = false; this.paused = false; this.pause(true); } else if (headstart && --this.headstartLeft > 0) this.offerHeadstart(); }); });
        });
        cardsBox.appendChild(card);
      });
      foot.innerHTML = '';
      if (this.rerolls > 0) foot.appendChild(el('button.btn.btn-ghost', { onclick: () => { if (ov.dataset.done) return; this.rerolls--; this.sfx('click'); render(); } }, [icon('refresh'), `Reroll (${this.rerolls})`]));
    };
    render();
    ov.append(head, cardsBox, foot);
    this.root.appendChild(ov);
    this.levelOv = ov;
  }
  offerHeadstart() { if (this.destroyed || this.dead) return; if (this.modal) { this.later(500, () => this.offerHeadstart()); return; } this.offerLevel(true); }
  applyMutation(id) {
    const p = this.p;
    p.muts[id] = (p.muts[id] | 0) + 1;
    if (!this.mutOrder.includes(id)) this.mutOrder.push(id);
    if (!(this.codex.mutations && this.codex.mutations[id]) && !this.disc.mutations.includes(id)) this.disc.mutations.push(id);
    this.recalc();
    if (id === 'membrane') this.heal(25);
    if (id === 'fission') this.spawnClone();
    if (id === 'dash' || id === 'nova') this.buildAbilities();
    this.burst(p.x, p.y, [140, 255, 220], 16, 160);
  }

  pause(show = true) {
    if (this.destroyed || this.dead || this.victory || this.modal === 'results') return;
    if (this.modal === 'pause') return;
    if (this.modal === 'level') { this.paused = true; this.pausedFromLevel = true; return; }
    this.paused = true; this.modal = 'pause'; this.releaseStick(); this.keys = {};
    if (!show) return;
    const ov = this.pauseOv = el('div.mb-overlay');
    const p = this.p;
    const muts = el('div.mb-mutlist', {}, this.mutOrder.map((id) => el('span.mb-mut', {}, [portrait('mutation', id, 26), D.MUT_BY_ID[id].name, el('sup', {}, '' + p.muts[id])])));
    const body = el('div.mb-pause-body');
    const main = () => {
      body.innerHTML = '';
      body.append(
        el('h2', {}, 'Paused'),
        el('p.dim.small.center', { style: { margin: '4px 0 0' } }, `Depth ${this.depth} · ${this.D.name}`),
        el('div.mb-statgrid', {}, [
          el('div', {}, [el('b', {}, 'Lv ' + p.level), el('span', {}, 'Level')]),
          el('div', {}, [el('b', {}, fmt(this.stats.biomass)), el('span', {}, 'Biomass')]),
          el('div', {}, [el('b', {}, this.fmtTime(this.time)), el('span', {}, 'Time')]),
        ]),
        this.mutOrder.length ? muts : el('p.faint.small.center', {}, 'No mutations yet'),
        el('div.stack-8', { style: { marginTop: '16px' } }, [
          el('button.btn.btn-primary.btn-lg.btn-block', { onclick: () => { this.sfx('click'); this.resume(); } }, [icon('play'), 'Resume']),
          el('button.btn.btn-ghost.btn-block', { onclick: () => { this.sfx('click'); confirmView(); } }, 'Abandon run'),
        ]),
      );
    };
    const confirmView = () => {
      const dna = this.calcDNA().total;
      body.innerHTML = '';
      body.append(
        el('h2', {}, 'Abandon run?'),
        el('p.dim.center', { style: { margin: '8px 0 16px' }, html: `You keep the <b class="dna-c">${dna} DNA</b> earned so far.` }),
        el('div.stack-8', {}, [
          el('button.btn.btn-danger.btn-block', { onclick: () => { this.sfx('click'); this.abandon(); } }, 'Abandon'),
          el('button.btn.btn-ghost.btn-block', { onclick: () => { this.sfx('click'); main(); } }, 'Keep swimming'),
        ]),
      );
    };
    main();
    ov.appendChild(el('div.dialog.mb-pause-panel', {}, body));
    this.root.appendChild(ov);
  }
  resume() {
    if (this.destroyed) return;
    if (this.modal === 'pause') { this.modal = null; if (this.pauseOv) { const o = this.pauseOv; o.classList.add('closing'); this.later(200, () => o.remove()); this.pauseOv = null; } }
    if (this.modal === 'results') return;
    this.paused = false; this.pausedFromLevel = false;
    this.last = performance.now();
  }
  abandon() {
    this.abandoned = true;
    if (this.pauseOv) { this.pauseOv.remove(); this.pauseOv = null; }
    this.modal = null; this.paused = false;
    this.showResults();
  }
  fmtTime(s) { s = floor(s); return floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  calcDNA() {
    return D.computeDNA({
      biomass: this.stats.biomass, depthsCleared: this.victory ? 5 : this.depthsCleared, miniKills: this.stats.miniKills, finalKills: this.stats.finalKills,
      discMicrobes: this.disc.microbes.length, discMutations: this.disc.mutations.length, victory: this.victory, dnaMult: this.dnaMult, harvest: this.genome.harvest | 0,
    });
  }
  result() {
    const dn = this.calcDNA();
    return {
      dna: dn.total, biomass: Math.round(this.stats.biomass), depth: this.depth, level: this.p.level, victory: this.victory,
      bossKills: this.stats.miniKills + this.stats.finalKills, kills: this.stats.kills, timeSec: Math.round(this.time),
      mutations: this.mutOrder.slice(), discovered: { microbes: this.disc.microbes.slice(), mutations: this.disc.mutations.slice() }, abandoned: this.abandoned,
      breakdown: dn,
    };
  }
  showResults() {
    if (this.modal === 'results' || this.destroyed) return;
    if (this.levelOv) { this.levelOv.remove(); this.levelOv = null; }
    if (this.pauseOv) { this.pauseOv.remove(); this.pauseOv = null; }
    this.modal = 'results'; this.clearHint();
    this.root.classList.add('mb-ended');
    const res = this.resultData = this.result();
    const dn = res.breakdown, p = this.p;
    const win = res.victory;
    const ov = el('div.mb-overlay.mb-res-ov');
    const rows = [
      ['Biomass', dn.biomass, `${fmt(res.biomass)} biomass`],
      ['Depth bonus', dn.depth, `${win ? 5 : this.depthsCleared} depth${this.depthsCleared === 1 ? '' : 's'} cleared`],
      ['Bosses', dn.bosses, `${res.bossKills} defeated`],
      ['Discoveries', dn.discoveries, `${res.discovered.microbes.length} species, ${res.discovered.mutations.length} genes`],
    ];
    if (dn.victory) rows.push(['Victory', dn.victory, 'Vent of Origins']);
    const rowEls = rows.map(([k, v, sub]) => el('div.mb-dnarow', {}, [el('span', {}, [k, el('span.faint.tiny', { style: { marginLeft: '6px' } }, sub)]), el('b', {}, '+' + v)]));
    if (dn.mult > 1.001) rowEls.push(el('div.mb-dnarow', {}, [el('span', {}, 'Multiplier'), el('b', {}, '×' + dn.mult.toFixed(2))]));
    const big = el('div.mb-big', {}, [icon('dna'), el('span', {}, '0')]);
    const btn = el('button.btn.btn-primary.btn-lg.btn-block', { onclick: () => { this.sfx('click'); this.exit(); } }, [icon('globe'), 'Return to planet']);
    const discEls = res.discovered.microbes.length ? [el('div.mb-sec', {}, 'New species'), el('div.mb-disc', {}, res.discovered.microbes.map((id) => el('div', {}, [portrait('microbe', id, 52), D.SPECIES_BY_ID[id].name])))] : [];
    const panel = el('div.mb-results', {}, [
      el('div.mb-res-head', { class: win ? 'win' : 'lose' }, [
        el('div.mb-kicker', {}, win ? 'Victory' : res.abandoned ? 'Run abandoned' : 'Your cell dissolved'),
        el('h1', {}, win ? 'Vent of Origins' : res.abandoned ? 'Back to the surface' : `Depth ${res.depth}`),
        el('p.dim.small', {}, win ? 'You reached the source of all life.' : `Reached ${D.DEPTHS[res.depth - 1].name}`),
      ]),
      el('div.mb-statgrid', {}, [
        el('div', {}, [el('b', {}, this.fmtTime(res.timeSec)), el('span', {}, 'Time')]),
        el('div', {}, [el('b', {}, res.depth + '/5'), el('span', {}, 'Depth')]),
        el('div', {}, [el('b', {}, '' + res.level), el('span', {}, 'Level')]),
        el('div', {}, [el('b', {}, fmt(res.biomass)), el('span', {}, 'Biomass')]),
        el('div', {}, [el('b', {}, '' + res.kills), el('span', {}, 'Kills')]),
        el('div', {}, [el('b', {}, '' + res.bossKills), el('span', {}, 'Bosses')]),
      ]),
      el('div.panel.mb-dnabox', {}, [...rowEls, el('div.mb-dnatotal', {}, [el('span.dim', { style: { fontWeight: 800 } }, 'DNA earned'), big])]),
      this.mutOrder.length ? el('div.mb-sec', {}, 'Mutations') : null,
      this.mutOrder.length ? el('div.mb-mutlist', {}, this.mutOrder.map((id) => el('span.mb-mut', {}, [portrait('mutation', id, 26), D.MUT_BY_ID[id].name, el('sup', {}, '' + p.muts[id])]))) : null,
      ...discEls,
      el('div.mb-res-foot', {}, btn),
    ]);
    ov.appendChild(panel);
    this.root.appendChild(ov);
    // count-up
    let i = 0; const total = dn.total, num = big.lastChild;
    const step = () => {
      if (this.destroyed) return;
      if (i < rowEls.length) { rowEls[i].classList.add('on'); this.sfx('coin', { vol: 0.6 }); i++; this.later(260, step); return; }
      const t0 = performance.now(), dur = 900;
      const tick = () => {
        if (this.destroyed) return;
        const k = min(1, (performance.now() - t0) / dur);
        num.textContent = String(Math.round(total * (1 - Math.pow(1 - k, 3))));
        if (k < 1) this.later(30, tick); else { big.classList.add('pop'); this.sfx(win ? 'victory' : 'coin'); }
      };
      tick();
    };
    this.later(350, step);
  }
  exit() {
    if (this.exited) return;
    this.exited = true;
    const r = this.resultData || this.result();
    const out = { ...r }; delete out.breakdown;
    try { this.onExit(out); } catch (e) { console.error(e); }
  }

  // ---------- HUD ----------
  updateHUD() {
    const p = this.p, c = this.hudCache;
    const hp = max(0, Math.ceil(p.hp));
    if (c.hp !== hp || c.mhp !== p.maxHp) { c.hp = hp; c.mhp = p.maxHp; this.hpBar.style.width = (100 * hp / p.maxHp) + '%'; this.hpNum.textContent = hp; this.hpStat.classList.toggle('low', hp < p.maxHp * 0.3); }
    const xpk = Math.round(100 * p.xp / D.xpToNext(p.level));
    if (c.xp !== xpk) { c.xp = xpk; this.xpBar.style.width = xpk + '%'; }
    if (c.lv !== p.level) { c.lv = p.level; this.lvEl.textContent = 'Lv ' + p.level; }
    const dna = this.calcDNA().total;
    if (c.dna !== dna) { if (c.dna !== undefined) { this.dnaChip.classList.remove('pulse'); void this.dnaChip.offsetWidth; this.dnaChip.classList.add('pulse'); } c.dna = dna; this.dnaNum.textContent = dna; }
    let label, k;
    if (this.boss && this.boss.alive) { label = `<b>${this.boss.kind === 'queen' ? 'Phage Queen' : 'Colossal Amoeba'}</b>`; k = this.boss.hp / this.boss.maxHp; }
    else { label = `Depth <b>${this.depth}</b> · ${this.D.name}`; k = min(1, this.depthTime / this.D.dur); }
    if (c.label !== label) { c.label = label; this.depthLabel.innerHTML = label; }
    const kk = Math.round(k * 200) / 2;
    if (c.k !== kk) { c.k = kk; this.depthBar.style.width = kk + '%'; }
  }

  // ---------- render ----------
  render(dt) {
    const ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr, p = this.p, T = this.T;
    // camera
    const tz = clamp(min(W, H) * 0.06 / p.r, 0.32, 1.45) * (this.boss ? 0.8 : 1);
    this.zoomV = this.zoomV ? lerp(this.zoomV, tz, 1 - exp(-dt * 1.5)) : tz;
    const z = this.zoomV;
    this.camX = this.camX === undefined ? p.x : lerp(this.camX, p.x + p.vx * 0.15, 1 - exp(-dt * 5));
    this.camY = this.camY === undefined ? p.y : lerp(this.camY, p.y + p.vy * 0.15, 1 - exp(-dt * 5));
    let cx = this.camX, cy = this.camY;
    if (this.shake > 0) { cx += (random() - 0.5) * this.shake / z; cy += (random() - 0.5) * this.shake / z; }
    const pal = this.palCur;
    // background
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const bk = pal.bg.join(',');
    if (!this.bgGrad || this.bgKey !== bk) {
      this.bgKey = bk;
      const g = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.5, hypot(W, H) * 0.65);
      g.addColorStop(0, rgbStr(pal.bg)); g.addColorStop(1, rgbStr(pal.edge));
      this.bgGrad = g;
    }
    ctx.fillStyle = this.bgGrad; ctx.fillRect(0, 0, W, H);
    // caustics (two parallax layers)
    ctx.globalCompositeOperation = 'lighter';
    const sun = this.D.sun;
    const cAlpha = 0.05 + 0.1 * sun;
    const tile = this.tint(this.caustic, pal.caustic.map((v) => Math.round(v / 16) * 16));
    for (let L = 0; L < 2; L++) {
      const sc = (L ? 1.7 : 1.15) * (0.7 + 0.3 * z), ts = 256 * sc;
      const ox = (-(cx * z) * (L ? 0.35 : 0.2) + T * (L ? 9 : -6)) % ts, oy = (-(cy * z) * (L ? 0.35 : 0.2) + T * (L ? 5 : 7)) % ts;
      ctx.globalAlpha = cAlpha * (L ? 0.7 : 1);
      for (let x = (ox > 0 ? ox - ts : ox); x < W; x += ts) for (let y = (oy > 0 ? oy - ts : oy); y < H; y += ts) ctx.drawImage(tile, x, y, ts, ts);
    }
    // light shafts
    if (sun > 0.05) {
      const sh = this.tint(this.shaft, pal.shaft.map((v) => Math.round(v / 16) * 16));
      for (let i = 0; i < 4; i++) {
        const x = ((i * 0.31 + 0.1) * W + sin(T * 0.13 + i * 2) * 40 - cx * z * 0.08) % (W * 1.3);
        ctx.globalAlpha = sun * (0.07 + 0.04 * sin(T * 0.4 + i));
        ctx.save(); ctx.translate(x < -W * 0.15 ? x + W * 1.3 : x, -20); ctx.rotate(0.22); ctx.drawImage(sh, -60 - i * 15, 0, 120 + i * 30, H * 1.2); ctx.restore();
      }
    }
    // plankton (screen space parallax)
    const pg = glowSprite(pal.plankton);
    for (const q of this.plankton) {
      const px = ((q.x * (W + 80) - cx * z * q.z + T * 4 * q.z) % (W + 80) + (W + 80)) % (W + 80) - 40;
      const py = ((q.y * (H + 80) - cy * z * q.z + sin(T * 0.5 + q.ph) * 6) % (H + 80) + (H + 80)) % (H + 80) - 40;
      const s = q.s * (2 + 6 * q.z);
      ctx.globalAlpha = 0.18 + 0.3 * q.z;
      ctx.drawImage(pg, px - s, py - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    // world transform
    const wx = (x) => (x - cx) * z + W / 2, wy = (y) => (y - cy) * z + H / 2;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cx * z), dpr * (H / 2 - cy * z));
    const vx0 = cx - W / 2 / z - 60, vx1 = cx + W / 2 / z + 60, vy0 = cy - H / 2 / z - 60, vy1 = cy + H / 2 / z + 60;
    const inView = (x, y, r) => x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;
    this.drawHazards(ctx, inView, z);
    // toxin clouds & rings
    ctx.globalCompositeOperation = 'lighter';
    const tg = glowSprite([150, 230, 90]);
    for (const c of this.clouds) { const k = c.life / c.max; ctx.globalAlpha = 0.45 * min(1, k * 2); const rr = c.r * (1.2 + (1 - k) * 0.4); ctx.drawImage(tg, c.x - rr, c.y - rr, rr * 2, rr * 2); ctx.globalAlpha *= 0.6; ctx.drawImage(tg, c.x - rr * 0.6 + sin(T * 3) * 6, c.y - rr * 0.6, rr * 1.2, rr * 1.2); }
    // motes
    const mg = glowSprite(pal.mote, 1);
    for (const m of this.motes) {
      if (!inView(m.x, m.y, 20)) continue;
      const s = (5 + 2.2 * sin(T * 3 + m.ph)) * m.s;
      ctx.globalAlpha = m.a * 0.9;
      ctx.drawImage(mg, m.x - s, m.y - s, s * 2, s * 2);
    }
    // entity glows
    ctx.globalAlpha = 1;
    for (const e of this.ents) {
      if (!inView(e.x, e.y, e.r * 2)) continue;
      const col = e.edibleCache ? [120, 255, 200] : (HOSTILE[e.kind] || e.boss) ? [255, 90, 100] : this.colorOf(e);
      const gs = e.r * (e.boss ? 2.2 : 2.6);
      ctx.globalAlpha = e.boss ? 0.35 : e.kind === 'phage' ? 0 : 0.2 + 0.25 * e.flash;
      if (ctx.globalAlpha > 0) ctx.drawImage(glowSprite(col), e.x - gs, e.y - gs, gs * 2, gs * 2);
    }
    ctx.globalAlpha = 0.4 + 0.3 * (p.muts.biolum ? 1 : 0);
    const pgs = p.r * (3 + (p.muts.biolum | 0) * 0.5);
    ctx.drawImage(glowSprite([110, 255, 225]), p.x - pgs, p.y - pgs, pgs * 2, pgs * 2);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // entities
    const sc = dpr * z;
    for (const e of this.ents) {
      if (!inView(e.x, e.y, e.r * (e.segs ? 9 : 2.5))) continue;
      if (e.kind === 'siphonophore') { this.drawSiph(ctx, e, sc); continue; }
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.boss && e.kind === 'colossus' ? 0 : e.ang);
      ctx.scale(e.r, e.r);
      if (e.spawnFade < 1) { e.spawnFade = min(1, e.spawnFade + dt * 3); ctx.globalAlpha = e.spawnFade; }
      drawSpecies(ctx, e, T, e.r * sc, { queenPhase: false });
      if (e.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = e.flash * 0.6; ctx.drawImage(glowSprite(WHITE), -1.2, -1.2, 2.4, 2.4); ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
      ctx.globalAlpha = 1;
      if (e.edibleCache && e.r > p.r * 0.45 && hypot(e.x - p.x, e.y - p.y) < 260) {
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 4 / z + sin(T * 5) * 1.5 / z, 0, TAU);
        ctx.strokeStyle = 'rgba(140,255,200,0.4)'; ctx.lineWidth = 1.5 / z; ctx.stroke();
      }
    }
    if (this.boss && this.boss.alive) this.drawBossSpots(ctx, z);
    // shards
    for (const s of this.shards) {
      if (!inView(s.x, s.y, 10)) continue;
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a + T * 6);
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, 5); ctx.lineTo(-5, -5); ctx.closePath();
      ctx.fillStyle = this.boss && this.boss.phase === 2 ? 'rgba(255,170,210,0.95)' : 'rgba(200,215,255,0.95)'; ctx.fill();
      ctx.restore();
    }
    // player
    if (!this.dead || this.slowmo < 0.6) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.scale(p.r, p.r);
      if (p.iframes > 0 && p.cyst <= 0 && !this.trans && floor(T * 20) % 2 === 0) ctx.globalAlpha = 0.55;
      if (p.muts.mimicry) ctx.globalAlpha *= 1 - 0.12 * p.muts.mimicry;
      if (this.dead) ctx.globalAlpha = max(0, 1 - (this.slowmo - 0.25) * 3);
      drawPlayer(ctx, p, T, p.r * sc);
      if (p.flashT > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.flashT * 2.5; ctx.drawImage(glowSprite([255, 80, 100]), -1.3, -1.3, 2.6, 2.6); ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // symbionts
    if (p.muts.symbionts && this.symb) {
      for (let i = 0; i < p.muts.symbionts; i++) {
        const s = this.symb[i]; if (!s) continue;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6;
        ctx.drawImage(glowSprite([255, 230, 140]), s[0] - 14, s[1] - 14, 28, 28);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.save(); ctx.translate(s[0], s[1]); ctx.rotate(T * 2.2 + (i / p.muts.symbionts) * TAU + PI / 2); ctx.scale(6, 6);
        drawSpecies(ctx, { kind: 'drifter', seed: i, t: 0, ang: 0 }, T, 6 * sc);
        ctx.restore();
      }
    }
    // particles
    ctx.globalCompositeOperation = 'lighter';
    for (const q of this.parts) {
      if (!inView(q.x, q.y, 10)) continue;
      const k = q.life / q.max, s = q.s * (0.5 + k * 0.7);
      ctx.globalAlpha = k;
      ctx.drawImage(glowSprite(q.c, 1), q.x - s, q.y - s, s * 2, s * 2);
    }
    if (this.rings) for (const r of this.rings) {
      ctx.globalAlpha = r.life / 0.6; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.strokeStyle = rgbStr(r.c); ctx.lineWidth = 6 / z + r.life * 20; ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // screen space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // floating text
    if (!this.fontFam) this.fontFam = getComputedStyle(this.root).fontFamily || 'system-ui, sans-serif';
    ctx.font = '800 14px ' + this.fontFam;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = min(1, t.life * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillText(t.s, wx(t.x) + 1, wy(t.y) + 1);
      ctx.fillStyle = t.c; ctx.fillText(t.s, wx(t.x), wy(t.y));
    }
    if (this.combo >= 4 && !this.dead) {
      ctx.globalAlpha = min(1, this.comboT * 2);
      ctx.font = '900 ' + (13 + min(10, this.combo) * 0.8) + 'px ' + this.fontFam;
      ctx.fillStyle = '#ffe7a8'; ctx.fillText('×' + this.combo, wx(p.x), wy(p.y - p.r) - 14);
    }
    ctx.globalAlpha = 1;
    this.drawIndicators(ctx, wx, wy, z);
    // vignette
    if (!this.vig) {
      const g = ctx.createRadialGradient(W / 2, H / 2, min(W, H) * 0.35, W / 2, H / 2, hypot(W, H) * 0.6);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,4,10,0.6)');
      this.vig = g;
    }
    ctx.fillStyle = this.vig; ctx.fillRect(0, 0, W, H);
    // low hp red vignette
    const hpk = p.hp / p.maxHp;
    if (hpk < 0.35 && !this.dead) {
      ctx.globalAlpha = (0.35 - hpk) * 2 * (0.6 + 0.4 * sin(T * 6));
      if (!this.redVig) { const g = ctx.createRadialGradient(W / 2, H / 2, min(W, H) * 0.3, W / 2, H / 2, hypot(W, H) * 0.6); g.addColorStop(0, 'rgba(255,0,40,0)'); g.addColorStop(1, 'rgba(255,30,60,0.55)'); this.redVig = g; }
      ctx.fillStyle = this.redVig; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    // joystick
    const I = this.input;
    if (I.active && !this.modal) {
      ctx.beginPath(); ctx.arc(I.ox, I.oy, 62, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
      const kx = I.ox + I.jx * I.mag * 57, ky = I.oy + I.jy * I.mag * 57;
      ctx.beginPath(); ctx.arc(kx, ky, 22, 0, TAU); ctx.fillStyle = 'rgba(220,255,250,0.22)'; ctx.fill();
      ctx.strokeStyle = 'rgba(220,255,250,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    this.flashEl.style.opacity = String(this.flash * 0.35);
    this.updateHUD();
  }
  drawHazards(ctx, inView, z) {
    const T = this.T;
    for (const h of this.hazards) {
      if (h.type === 'uv') {
        if (!inView(h.x, h.y, 1400)) continue;
        ctx.globalCompositeOperation = 'lighter';
        ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(-0.245);
        const sh = this.tint(this.shaft, [200, 170, 255]);
        ctx.globalAlpha = 0.28 + 0.06 * sin(T * 2 + h.t);
        ctx.drawImage(sh, -h.r * 0.75, -1400, h.r * 1.5, 2800);
        ctx.globalAlpha = 0.18; ctx.drawImage(sh, -h.r * 0.35, -1400, h.r * 0.7, 2800);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      } else if (h.type === 'toxic') {
        if (!inView(h.x, h.y, h.r * 1.3)) continue;
        ctx.globalCompositeOperation = 'lighter';
        const g = glowSprite([130, 210, 70]);
        for (let i = 0; i < 5; i++) {
          const a = i * 1.26 + h.t * 0.15, d = h.r * 0.35 * (i ? 1 : 0), rr = h.r * (i ? 0.75 : 1.15);
          ctx.globalAlpha = 0.16 + 0.04 * sin(T + i);
          ctx.drawImage(g, h.x + cos(a) * d - rr, h.y + sin(a) * d - rr, rr * 2, rr * 2);
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        // bubbles of toxin
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * 0.8 + h.t * 0.3, d = h.r * (0.2 + 0.5 * ((i * 0.37) % 1)); const x = h.x + cos(a) * d, y = h.y + sin(a) * d - ((h.t * 12 + i * 20) % 40); ctx.moveTo(x + 3, y); ctx.arc(x, y, 3, 0, TAU); }
        ctx.strokeStyle = 'rgba(190,255,120,0.35)'; ctx.lineWidth = 1.2 / z; ctx.stroke();
      } else if (h.type === 'vent') {
        if (!inView(h.x, h.y, h.r * 1.5)) continue;
        const core = h.r * 0.42;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 + 0.15 * sin(T * 3 + h.t);
        ctx.drawImage(glowSprite([255, 90, 50]), h.x - h.r * 1.4, h.y - h.r * 1.4, h.r * 2.8, h.r * 2.8);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        // rocky chimney
        ctx.beginPath();
        for (let i = 0; i <= 14; i++) { const a = (i / 14) * TAU; const r = core * (0.85 + 0.15 * sin(i * 2.7 + h.x)); i ? ctx.lineTo(h.x + cos(a) * r, h.y + sin(a) * r) : ctx.moveTo(h.x + cos(a) * r, h.y + sin(a) * r); }
        ctx.fillStyle = 'rgba(30,10,14,0.9)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,120,80,0.6)'; ctx.lineWidth = 3 / z; ctx.stroke();
        ctx.beginPath(); ctx.arc(h.x, h.y, core * 0.45, 0, TAU);
        ctx.fillStyle = `rgba(255,${120 + 40 * sin(T * 4) | 0},60,0.9)`; ctx.fill();
        // rising heat bubbles
        ctx.globalCompositeOperation = 'lighter';
        const bg = glowSprite([255, 140, 80], 1);
        for (let i = 0; i < 8; i++) { const ph = ((T * 0.5 + i / 8) % 1); const x = h.x + sin(i * 3.1 + T) * core * 0.5, y = h.y - ph * h.r * 1.2; ctx.globalAlpha = 1 - ph; const s = 6 + i % 3 * 3; ctx.drawImage(bg, x - s, y - s, s * 2, s * 2); }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      } else if (h.type === 'current') {
        if (!inView(h.x, h.y, h.r)) continue;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
          const u = ((T * 0.35 + i * 0.137) % 1), off = ((i * 0.618) % 1 - 0.5) * h.r * 1.4;
          const px = -h.dy, py = h.dx;
          const along = (u - 0.5) * h.r * 1.6;
          const x = h.x + h.dx * along + px * off, y = h.y + h.dy * along + py * off;
          ctx.moveTo(x, y); ctx.lineTo(x + h.dx * 40, y + h.dy * 40);
        }
        ctx.strokeStyle = rgbStr(this.palCur.accent, 0.22); ctx.lineWidth = 2 / z; ctx.lineCap = 'round'; ctx.stroke();
      }
    }
  }
  drawSiph(ctx, e, sc) {
    const T = this.T, pts = [e, ...e.segs];
    ctx.lineCap = 'round';
    // tentacles
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const s = pts[i];
      const ta = e.ang + PI;
      ctx.moveTo(s.x, s.y);
      for (let k = 1; k <= 6; k++) {
        const u = k / 2;
        const x = s.x + cos(ta + sin(T * 1.5 + i + u) * 0.5 / u) * e.r * 1.5 * u + cos(ta + PI / 2) * sin(T * 2 + u + i) * e.r * 0.5;
        const y = s.y + sin(ta + sin(T * 1.5 + i + u) * 0.5 / u) * e.r * 1.5 * u + sin(ta + PI / 2) * sin(T * 2 + u + i) * e.r * 0.5;
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = 'rgba(255,150,230,0.45)'; ctx.lineWidth = 1.6 / this.zoomV; ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < pts.length; i++) { const s = pts[i]; ctx.globalAlpha = 0.25; ctx.drawImage(glowSprite([255, 110, 220]), s.x - e.r * 2, s.y - e.r * 2, e.r * 4, e.r * 4); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    for (let i = pts.length - 1; i >= 0; i--) {
      const s = pts[i]; const nx = i ? pts[i - 1].x - s.x : cos(e.ang), ny = i ? pts[i - 1].y - s.y : sin(e.ang);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(atan2(ny, nx)); const pulse = 1 + 0.08 * sin(T * 4 - i); ctx.scale(e.r * pulse, e.r);
      drawSpecies(ctx, { kind: 'siphonbell', seed: i, ang: 0 }, T, e.r * sc);
      if (e.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = e.flash * 0.6; ctx.drawImage(glowSprite(WHITE), -1.2, -1.2, 2.4, 2.4); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
      ctx.restore();
    }
  }
  drawBossSpots(ctx, z) {
    const b = this.boss, T = this.T;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of b.spots) {
      if (s.wx === undefined) continue;
      const ready = s.cd <= 0;
      const pulse = 0.75 + 0.25 * sin(s.pulse);
      const rr = s.wr * (ready ? 1.9 * pulse : 1.1);
      ctx.globalAlpha = ready ? 0.95 : 0.3;
      ctx.drawImage(glowSprite([255, 236, 120], 1), s.wx - rr, s.wy - rr, rr * 2, rr * 2);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    for (const s of b.spots) {
      if (s.wx === undefined || s.cd > 0) continue;
      ctx.beginPath(); ctx.arc(s.wx, s.wy, s.wr * (1 + 0.15 * sin(s.pulse)), 0, TAU);
      ctx.strokeStyle = 'rgba(255,250,210,0.9)'; ctx.lineWidth = 2 / z; ctx.stroke();
    }
    // telegraphs
    if (b.kind === 'queen' && b.state === 'chargeT') {
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + cos(b.ca) * 900, b.y + sin(b.ca) * 900);
      ctx.strokeStyle = `rgba(255,90,110,${0.25 + 0.25 * sin(T * 20)})`; ctx.lineWidth = b.r * 0.9; ctx.lineCap = 'round'; ctx.stroke();
    }
    if (b.kind === 'queen' && b.state === 'burstT') {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1.2 + (0.9 - b.st) * 0.5), 0, TAU);
      ctx.strokeStyle = `rgba(255,200,220,${0.5 + 0.3 * sin(T * 25)})`; ctx.lineWidth = 4 / z; ctx.stroke();
    }
  }
  drawIndicators(ctx, wx, wy, z) {
    const W = this.W, H = this.H, p = this.p, top = 96, pad = 22;
    let n = 0;
    for (const e of this.ents) {
      if (n > 6) break;
      const threat = e.boss || ((e.kind === 'hunter' || e.kind === 'amoeba' || e.kind === 'rotifer' || e.kind === 'siphonophore') && !e.edibleCache && e.r > p.r * 0.95);
      if (!threat) continue;
      const sx = wx(e.x), sy = wy(e.y), rr = e.r * z;
      if (sx > -rr && sx < W + rr && sy > -rr && sy < H + rr) continue;
      const d = hypot(e.x - p.x, e.y - p.y);
      if (d > (e.boss ? 3000 : 900)) continue;
      const a = atan2(sy - H / 2, sx - W / 2);
      const ix = clamp(W / 2 + cos(a) * W, pad, W - pad), iy = clamp(H / 2 + sin(a) * H, top, H - pad - 10);
      const al = e.boss ? 1 : clamp(1.2 - d / 900, 0.25, 0.9);
      ctx.save(); ctx.translate(ix, iy); ctx.rotate(a); ctx.globalAlpha = al;
      const s = e.boss ? 13 : 9;
      ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.6, s * 0.75); ctx.lineTo(-s * 0.3, 0); ctx.lineTo(-s * 0.6, -s * 0.75); ctx.closePath();
      ctx.fillStyle = e.boss ? '#ffb36b' : '#ff6b7d'; ctx.fill();
      ctx.restore(); n++;
    }
    ctx.globalAlpha = 1;
  }

  // ---------- public / debug ----------
  pauseExternal() { this.pause(true); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf); this.raf = 0;
    for (const [t, ev, fn, o] of this.listeners) t.removeEventListener(ev, fn, o);
    this.listeners = [];
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts = [];
    this.root.remove();
    releaseStyle();
  }
  debug() {
    const g = this;
    return {
      game: g,
      get state() { return { depth: g.depth, depthTime: g.depthTime, level: g.p.level, hp: g.p.hp, maxHp: g.p.maxHp, xp: g.p.xp, ents: g.ents.length, motes: g.motes.length, parts: g.parts.length, modal: g.modal, paused: g.paused, boss: g.boss ? { kind: g.boss.kind, hp: g.boss.hp, maxHp: g.boss.maxHp, phase: g.boss.phase } : null, dead: g.dead, victory: g.victory, frameMs: g.frameMs, muts: { ...g.p.muts }, dna: g.calcDNA().total, listeners: g.listeners.length, timeouts: g.timeouts.length }; },
      grantXP(n) { g.gainXP(Number(n) / (g.xpMult || 1), false); },
      levelUp(n = 1) { for (let i = 0; i < n; i++) { g.p.level++; g.pendingLevels++; } g.recalc(); },
      setLevel(L) { g.p.level = L; g.recalc(); },
      mutate(id, lv = 1) { for (let i = 0; i < lv; i++) g.applyMutation(id); },
      pickCard(i = 0) { const c = g.root.querySelectorAll('.mb-card')[i]; if (c) c.click(); return !!c; },
      jumpDepth(d) { g.trans = null; g.fadeEl.style.opacity = '0'; g.depthsCleared = d - 1; g.enterDepth(d); },
      endDepth() { g.depthTime = g.D.dur; },
      spawnBoss() { g.depthTime = g.D.dur; g.spawnBoss(); },
      hurtBoss(n) { g.bossDamage(n); },
      setInvuln(b = true) { g.invuln = b; },
      kill() { g.invuln = false; g.reviveLeft = 0; g.p.cystUsed = true; g.p.iframes = 0; g.p.cyst = 0; g.p.hp = 0.0001; g.hurt(1, null, { dot: true }); },
      spawnMany(n, kind = 'grazer') { for (let i = 0; i < n; i++) { const a = random() * TAU, d = 100 + random() * 500; g.spawn(kind, g.p.x + cos(a) * d, g.p.y + sin(a) * d, { force: true }); } },
      spawn(kind, dx = 120, dy = 0, r) { return g.spawn(kind, g.p.x + dx, g.p.y + dy, { force: true, r }); },
      showResults() { g.showResults(); },
      exit() { g.exit(); },
    };
  }
}
