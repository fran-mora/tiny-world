// Persistent game state (localStorage) with versioning and safe saves.

const KEY = 'tinyworld.save.v1';
const BACKUP_KEY = 'tinyworld.save.v1.bak';

export function defaultState(seed = (Math.random() * 2 ** 31) >>> 0, worldNumber = 1, carry = null) {
  return {
    version: 1,
    createdAt: Date.now(),
    lastSaved: Date.now(),
    lastActive: Date.now(),
    seed,
    worldNumber,
    dna: 0,
    bloom: 30,
    totals: {
      dnaEarned: 0, bloomEarned: 0, runs: 0, runWins: 0, bestDepth: 0, bestLevel: 0, bossKills: 0,
      plantsGrown: 0, animalsBorn: 0, eventsSurvived: 0, playTimeSec: 0, extinctions: 0,
      ...(carry?.totals || {}),
    },
    genome: carry?.genome || {},          // permanent microbe upgrades { id: level }
    codex: carry?.codex || { microbes: {}, mutations: {}, plants: {}, animals: {}, events: {} },
    research: {},                          // researched species ids { id: true }
    adaptations: {},                       // { speciesId: { adaptId: level } }
    milestones: {},                        // { id: dayCompleted }
    era: 1,
    starSeeds: carry?.starSeeds || 0,      // new-world bonus
    planet: null,                          // serialized ecosystem (see planet/sim.js)
    settings: carry?.settings || { sfx: true, music: true, haptics: true, battery: false, shadows: true, speed: 1 },
    tutorial: { done: {}, ...(carry ? { skip: true } : {}) },
    flags: {},
    runHistory: [],
  };
}

export const store = {
  state: null,
  dirty: false,

  load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) {
      try { this.state = migrate(JSON.parse(raw)); return true; }
      catch (e) {
        console.warn('Save corrupt, trying backup', e);
        try { const b = localStorage.getItem(BACKUP_KEY); if (b) { this.state = migrate(JSON.parse(b)); return true; } } catch (e2) {}
      }
    }
    this.state = null;
    return false;
  },

  hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  },

  newGame(carry = null) {
    const wn = carry ? (carry.worldNumber || 1) + 1 : 1;
    this.state = defaultState(undefined, wn, carry);
    this.save();
    return this.state;
  },

  save() {
    if (!this.state) return;
    this.state.lastSaved = Date.now();
    try {
      const s = JSON.stringify(this.state);
      const prev = localStorage.getItem(KEY);
      if (prev) localStorage.setItem(BACKUP_KEY, prev);
      localStorage.setItem(KEY, s);
      this.dirty = false;
    } catch (e) {
      console.warn('Save failed', e);
    }
  },

  wipe() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(BACKUP_KEY); } catch (e) {}
    this.state = null;
  },

  export() { return btoa(unescape(encodeURIComponent(JSON.stringify(this.state)))); },
  import(str) {
    const s = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
    this.state = migrate(s); this.save();
  },
};

function migrate(s) {
  const d = defaultState(s.seed);
  // shallow-fill missing keys so older saves keep working
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  for (const k of Object.keys(d.totals)) if (s.totals[k] === undefined) s.totals[k] = 0;
  for (const k of Object.keys(d.codex)) if (!s.codex[k]) s.codex[k] = {};
  for (const k of Object.keys(d.settings)) if (s.settings[k] === undefined) s.settings[k] = d.settings[k];
  return s;
}

// Currency helpers
export function addDNA(n) {
  const s = store.state; if (!s || !n) return;
  s.dna += n; if (n > 0) s.totals.dnaEarned += n;
  store.dirty = true;
}
export function spendDNA(n) {
  const s = store.state; if (s.dna < n) return false;
  s.dna -= n; store.dirty = true; return true;
}
export function addBloom(n) {
  const s = store.state; if (!s || !n) return;
  s.bloom += n; if (n > 0) s.totals.bloomEarned += n;
}
export function spendBloom(n) {
  const s = store.state; if (s.bloom < n - 1e-9) return false;
  s.bloom -= n; store.dirty = true; return true;
}
