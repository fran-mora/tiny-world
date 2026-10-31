// Tiny World — game controller: boot, main loop, actions, progression, persistence, tutorial.
import { store, addDNA, spendDNA, addBloom, spendBloom } from './state.js';
import { el, icon, fmt, toast, dialog, coach, clearCoach, anyModalOpen, closeTopModal } from './ui.js';
import { audio, haptic } from './audio.js';
import { World } from './planet/world.js';
import { Ecosystem, EVENT_TYPES } from './planet/sim.js';
import { PlanetRenderer } from './planet/render.js';
import { PlanetView, roman } from './planet/view.js';
import { renderThumbs } from './planet/thumbs.js';
import { PLANTS, ANIMALS, PLANT, ANIMAL, ERAS } from './data/species.js';
import { MILESTONES, activeGoals } from './data/milestones.js';
import * as Screens from './screens.js';

const MAX_TICKS_PER_FRAME = 40;
const OFFLINE_TICK_CAP = 2400; // 20 game days

class Game {
  constructor() {
    this.mode = 'boot';
    this.acc = 0;
    this.last = performance.now();
    this.secTimer = 0; this.saveTimer = 0;
    this.frameCount = 0;
  }

  get state() { return store.state; }
  get speed() { return this.state.settings.speed ?? 1; }

  async boot() {
    const app = document.getElementById('app');
    this.stage = document.getElementById('stage');
    this.hud = document.getElementById('hud');
    this.fade = el('div.fade-cover'); app.appendChild(this.fade);

    if (!store.load()) store.newGame();
    const st = this.state;
    window.__tw_haptics = st.settings.haptics;
    audio.setSfx(st.settings.sfx); audio.setMusic(st.settings.music);

    // modules (models & microbe are separate files; fall back gracefully)
    const okModels = (M) => M && M.MODEL_INFO && M.modelUniforms && ['plantGeometry', 'animalGeometry', 'decorGeometry', 'createModelMaterial'].every((k) => typeof M[k] === 'function');
    this.Models = await import('./planet/models.js').catch((e) => { console.warn('models.js failed', e); return null; });
    if (!okModels(this.Models)) this.Models = await import('./planet/models-stub.js');
    this.Microbe = await import('./microbe/index.js').catch((e) => { console.warn('microbe module failed', e); return null; });
    if (!this.Microbe || typeof this.Microbe.startMicrobeRun !== 'function') this.Microbe = await import('./microbe-fallback.js');

    this.world = new World(st.seed);
    this.eco = new Ecosystem(this.world, this, st.planet);
    try {
      this.renderer = new PlanetRenderer(this.stage, this.world, this.eco, this.Models, st.settings);
    } catch (e) {
      console.warn('renderer failed with models.js, retrying with fallback models', e);
      this.stage.innerHTML = '';
      this.Models = await import('./planet/models-stub.js');
      this.renderer = new PlanetRenderer(this.stage, this.world, this.eco, this.Models, st.settings);
    }
    this.view = new PlanetView(this, this.hud);
    this.wireEco();
    window.__tw = this;

    this.mode = 'title';
    this.renderer.autoRotate = 0.05;
    this.renderer.rig.tDist = this.renderer.rig.dist = this.renderer.fitDist(1.3);
    this.renderer.rig.enabled = true;
    requestAnimationFrame((t) => this.loop(t));
    setTimeout(() => {
      document.getElementById('boot').classList.add('hide');
      setTimeout(() => document.getElementById('boot')?.remove(), 700);
    }, 250);
    this.showTitle();
    setTimeout(() => renderThumbs(this.Models).then(() => { if (this.view) this.view.update(true); }), 300);

    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.save());
    // iOS suspends audio in the background; resume it on the next touch
    document.addEventListener('pointerdown', () => { if (audio.ready) audio.resume(); }, { passive: true });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.mode === 'planet') { if (!closeTopModal()) this.view.closeTray(); } });
    this.registerSW();
  }

  // ---------------------------------------------------------------- title
  showTitle() {
    const st = this.state;
    const fresh = st.totals.runs === 0 && !Object.keys(st.research).length;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const hint = standalone ? null : el('div.install-hint', { html: isIOS ? 'For offline play on your flight: tap <b>Share</b> → <b>Add to Home Screen</b>.' : 'For offline play: open the browser menu → <b>Install app</b> / <b>Add to Home screen</b>.' });
    if (hint) hint.addEventListener('click', () => Screens.offlineHelp());
    const play = el('button.btn.btn-primary.btn-lg.btn-block', { onclick: () => this.start() }, [icon('play'), fresh ? 'Begin' : 'Continue']);
    this.titleEl = el('div.title-screen', {}, [
      el('div.logo', {}, [el('h1', {}, ['Tiny', el('br'), 'World']), el('div.sub', {}, fresh ? 'Grow a living planet from a single cell' : `World #${st.worldNumber} · Era ${roman(st.era)} · ${ERAS[st.era].name}`)]),
      el('div.title-actions', {}, [play, hint]),
    ]);
    document.getElementById('app').appendChild(this.titleEl);
  }

  start() {
    audio.init();
    audio.music('planet');
    haptic(10);
    this.titleEl.style.transition = 'opacity .5s'; this.titleEl.style.opacity = '0';
    setTimeout(() => this.titleEl.remove(), 500);
    this.renderer.autoRotate = 0;
    this.renderer.rig.tDist = this.renderer.fitDist(1.1);
    this.hud.classList.remove('hidden-soft');
    this.mode = 'planet';
    this.view.update(true);
    const st = this.state;
    if (!st.tutorial.done.intro) this.intro();
    else this.offlineProgress();
  }

  intro() {
    const st = this.state;
    st.tutorial.done.intro = true;
    dialog({
      dismissable: false,
      body: el('div.center', {}, [
        el('div.era-num', { style: { color: ERAS[1].color } }, 'Welcome to'),
        el('div.era-name', {}, 'Tiny World'),
        el('p.dim', { style: { margin: '0 0 8px' } }, 'This is your planet: a barren rock wrapped in a dark ocean. No air to breathe, nothing alive.'),
        el('p.dim', { style: { margin: 0 } }, 'Life has to start small. Dive into the ocean as a single cell, evolve, and bring back DNA to seed your world.'),
      ]),
      buttons: [{ label: 'Let’s begin', cls: 'btn-primary btn-lg', onClick: () => setTimeout(() => this.coachOn('btn-dive', 'Tap <b>DIVE</b> to become a microbe in your ocean.'), 300) }],
    });
  }

  // ---------------------------------------------------------------- loop
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this.last) / 1000; this.last = t;
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.frameCount++;
    const st = this.state;
    if (this.mode === 'planet' || this.mode === 'microbe') {
      st.totals.playTimeSec += dt;
      const sp = this.mode === 'microbe' ? Math.min(this.speed, 3) : this.speed;
      if (sp > 0) {
        this.acc += dt * sp;
        let n = Math.floor(this.acc);
        if (n > MAX_TICKS_PER_FRAME) { n = MAX_TICKS_PER_FRAME; this.acc = n; }
        for (let i = 0; i < n; i++) this.tick();
        this.acc -= n;
      }
    }
    if (this.mode === 'planet' || this.mode === 'title') {
      const skip = st.settings.battery && (this.frameCount & 1);
      if (!skip) this.renderer.render(st.settings.battery ? dt * 2 : dt, this.speed > 0 ? this.acc : 1);
      if (this.mode === 'planet') { this.view.update(); this.view.frame(dt); }
    }
    this.secTimer += dt; this.saveTimer += dt;
    if (this.secTimer > 1) { this.secTimer = 0; if (this.mode === 'planet' || this.mode === 'microbe') this.checkProgress(); }
    if (this.saveTimer > 15 && this.mode !== 'title') { this.saveTimer = 0; this.save(); }
  }

  tick() {
    this.eco.step();
    const bonus = 1 + (this.state.starSeeds || 0) * 0.25;
    addBloom(this.eco.bloomGain * bonus);
  }

  // ---------------------------------------------------------------- eco wiring
  wireEco() {
    const eco = this.eco;
    eco.on('day', () => {
      const st = this.state;
      if (st.era >= 3) {
        const n = eco.thriving().n;
        if (n > 0) addDNA(Math.round(n * (1 + (st.starSeeds || 0) * 0.25)));
      }
      if ((eco.popCount.hopper || 0) > 0 && (eco.popCount.prowler || 0) > 0) st.flags.coexistDays = (st.flags.coexistDays || 0) + 1;
      else st.flags.coexistDays = 0;
    });
    eco.on('event', (e) => {
      const T = EVENT_TYPES[e.type];
      this.state.codex.events[e.type] = true;
      let name = T.name;
      if (e.sp) name += ': ' + (PLANT[e.sp] || ANIMAL[e.sp]).name;
      if (e.type === 'meteor' && e.pending) {
        this.renderer.rig.flyTo(this.renderer.tileWorld(e.tile), 26);
        this.renderer.onMeteorHit = (tile) => { e.pending = false; eco.impact(tile); haptic([40, 30, 60]); audio.sfx('boss'); };
        this.renderer.fxMeteor(e.tile);
      }
      if (e.type === 'migration' && e.tile != null) this.renderer.fxRelease(e.tile);
      audio.sfx('event');
      toast(`<b>${name}</b> · ${T.desc}`, { icon: T.icon, kind: T.bad ? 'bad' : '', ms: 4200 });
      if (!this.state.tutorial.done.event) {
        this.state.tutorial.done.event = true;
        setTimeout(() => { const pill = this.view.events.firstChild; if (pill && this.mode === 'planet') this.coach(pill, `Events shake up your world. ${T.tip} Tap an event to see where it is.`, true); }, 1200);
      }
    });
    eco.on('eventEnd', (e) => { if (EVENT_TYPES[e.type].bad) this.state.totals.eventsSurvived++; });
    eco.on('extinct', (id) => {
      if (this.mode === 'boot') return;
      this.state.totals.extinctions++;
      toast(`The last <b>${ANIMAL[id].name}</b> has died. They are extinct on your world.`, { icon: 'paw', kind: 'bad', ms: 4500 });
    });
    eco.on('birth', (a) => {
      const id = ANIMALS[a.sp].id;
      const f = this.state.flags;
      if (!f['born_' + id]) { f['born_' + id] = true; toast(`The first <b>${ANIMALS[a.sp].name}</b> was born on your world!`, { icon: 'heart', kind: 'milestone' }); audio.sfx('chirp'); }
    });
  }

  eventsEnabled() { return this.mode === 'planet' && this.speed > 0 && !anyModalOpen(); }
  goalCtx() { return this._ctx ||= { state: this.state, eco: this.eco, plantId: (p) => PLANTS[p.sp].id }; }

  checkProgress() {
    const st = this.state, ctx = this.goalCtx();
    ctx.state = st; ctx.eco = this.eco;
    // milestones
    for (const m of activeGoals(st, 3)) {
      if (m.check(ctx) >= 1) this.completeGoal(m);
    }
    // era up
    const next = ERAS[st.era + 1];
    if (next && this.eco.oxygen >= next.o2 && (st.era > 1 || st.research.algae) && this.mode === 'planet' && !anyModalOpen()) {
      st.era++;
      this.save();
      Screens.eraUpDialog(this, st.era).el && this.tutorialHook('era:' + st.era);
    }
    // ending
    if (!st.flags.ended && this.mode === 'planet' && !anyModalOpen()) {
      const wt = this.eco.plants.find((p) => !p.dead && PLANTS[p.sp].unique);
      if (wt && wt.growth >= 1) { st.flags.ended = true; this.save(); setTimeout(() => Screens.endingDialog(this), 800); }
    }
  }

  completeGoal(m) {
    const st = this.state;
    st.milestones[m.id] = Math.floor(this.eco.day);
    const r = m.reward || {};
    if (r.dna) addDNA(r.dna);
    if (r.bloom) addBloom(r.bloom);
    const rew = [r.dna ? `<span class="dna-c">+${r.dna} DNA</span>` : '', r.bloom ? `<span class="bloom-c">+${r.bloom} Bloom</span>` : ''].filter(Boolean).join(' ');
    if (this.mode === 'planet') {
      toast(`<b>Goal complete:</b> ${m.title} ${rew}`, { icon: 'check', kind: 'milestone', ms: 3600 });
      audio.sfx('milestone'); haptic([15, 30, 15]);
      this.view.goal.classList.remove('done'); void this.view.goal.offsetWidth; this.view.goal.classList.add('done');
    } else this.pendingGoals = (this.pendingGoals || []).concat(m);
  }

  // ---------------------------------------------------------------- actions
  affordableResearch() {
    const st = this.state;
    return [...PLANTS, ...ANIMALS].some((s) => !st.research[s.id] && s.era <= st.era && st.dna >= s.dna);
  }

  research(id) {
    const st = this.state, s = PLANT[id] || ANIMAL[id];
    if (!s || st.research[id]) return false;
    if (s.era > st.era) { audio.sfx('error'); toast(`Unlocks in Era ${roman(s.era)}.`, { icon: 'lock' }); return false; }
    if (!spendDNA(s.dna)) { audio.sfx('error'); toast(`Not enough DNA. <b>Dive</b> to earn more.`, { icon: 'dna', kind: 'dna' }); return false; }
    st.research[id] = true;
    if (PLANT[id]) st.codex.plants[id] = true; else st.codex.animals[id] = true;
    if (id === 'algae') this.eco.seedAlgae();
    audio.sfx('research'); haptic([10, 20, 10]);
    toast(`Researched <b>${s.name}</b>${id === 'algae' ? '. It is spreading through your oceans.' : '.'}`, { icon: 'flask', kind: 'milestone' });
    this.save();
    this.view.update(true);
    this.tutorialHook('research:' + id);
    return true;
  }

  buyAdapt(spId, aId, cost) {
    const st = this.state;
    if (!spendDNA(cost)) { audio.sfx('error'); return false; }
    const a = (st.adaptations[spId] ||= {});
    a[aId] = (a[aId] || 0) + 1;
    audio.sfx('evolve'); haptic(12);
    this.save();
    return true;
  }

  buyGenome(id, cost) {
    const st = this.state;
    if (!spendDNA(cost)) { audio.sfx('error'); return false; }
    st.genome[id] = (st.genome[id] || 0) + 1;
    audio.sfx('evolve'); haptic(12);
    this.save();
    return true;
  }

  plantAt(id, tile) {
    const st = this.state, sp = PLANT[id], eco = this.eco;
    const can = eco.canPlant(id, tile);
    if (!can.ok) { audio.sfx('error'); this.renderer.setMarker(tile, '#ff5468'); toast(can.why, { icon: 'info' }); return false; }
    const suit = eco.suitability(id, tile);
    if (suit < 0.18) { audio.sfx('error'); this.renderer.setMarker(tile, '#ff5468'); toast(`Too harsh here for <b>${sp.name}</b>. ${whyHarsh(eco, sp, tile)}`, { icon: 'info', kind: 'bad' }); return false; }
    if (st.bloom < sp.cost) { audio.sfx('error'); toast(`Needs <b class="bloom-c">${sp.cost} Bloom</b>. Plants make Bloom over time.`, { icon: 'bloom' }); return false; }
    spendBloom(sp.cost);
    if (sp.kind === 'cover') eco.plantCover(id, tile);
    else eco.addPlant(id, tile, 0.08, { planted: true });
    this.renderer.setMarker(tile, '#7cf0a3');
    this.renderer.fxPlant(tile);
    audio.sfx('plant'); haptic(10);
    st.totals.plantsGrown++;
    if (suit < 0.4) toast(`Planted, but conditions are poor. It may struggle.`, { icon: 'info', ms: 2200 });
    this.tutorialHook('planted:' + id);
    return true;
  }

  releaseAt(id, tile) {
    const st = this.state, sp = ANIMAL[id], eco = this.eco, w = this.world;
    if (sp.aquatic && !w.ocean[tile]) { audio.sfx('error'); toast(`${sp.name} live in the ocean. Tap the sea.`, { icon: 'fish' }); return false; }
    if (!sp.aquatic && !sp.flying && w.ocean[tile]) { audio.sfx('error'); toast(`${sp.name} need land.`, { icon: 'paw' }); return false; }
    if (eco.oxygen < sp.o2Min) { audio.sfx('error'); toast(`${sp.name} can't breathe yet. They need <b class="o2-c">${sp.o2Min}% oxygen</b>.`, { icon: 'o2', kind: 'bad' }); return false; }
    if ((eco.popCount[id] || 0) >= sp.cap) { audio.sfx('error'); toast(`Your world can't hold more ${sp.name}.`, { icon: 'info' }); return false; }
    if (st.bloom < sp.cost) { audio.sfx('error'); toast(`Needs <b class="bloom-c">${sp.cost} Bloom</b>.`, { icon: 'bloom' }); return false; }
    spendBloom(sp.cost);
    const got = eco.releaseAnimals(id, tile, sp.group);
    if (!got.length) { addBloom(sp.cost); audio.sfx('error'); return false; }
    this.renderer.setMarker(tile, '#ffe9b0');
    this.renderer.fxRelease(tile);
    audio.sfx('chirp'); haptic(12);
    // food warning
    const d = sp.diet;
    if (d.cover && !this.hasFoodNear(tile)) toast(`Careful: there is little food here for ${sp.name}.`, { icon: 'info', ms: 2600 });
    if (d.prey && !d.prey.some((p) => (eco.popCount[p] || 0) > 0)) toast(`${sp.name} need prey to survive: ${d.prey.map((p) => ANIMAL[p].name).join(', ')}.`, { icon: 'info', kind: 'bad', ms: 3200 });
    if (d.nectar && !eco.plants.some((p) => !p.dead && p.flowering)) toast(`${sp.name} need flowering plants for nectar.`, { icon: 'info', ms: 3000 });
    this.tutorialHook('released:' + id);
    return true;
  }

  hasFoodNear(tile) {
    const eco = this.eco; let f = eco.cover[tile];
    for (const j of this.world.nb[tile]) f += eco.cover[j];
    for (const j of this.world.ring2[tile]) f += eco.cover[j] * 0.5;
    return f > 1.2;
  }

  useTool(id, tile, t) {
    if (!spendBloom(t.cost)) { audio.sfx('error'); toast(`Needs ${t.cost} Bloom.`, { icon: 'bloom' }); return false; }
    if (id === 'rain') { this.eco.rain(tile); this.renderer.fxRain(tile); audio.sfx('rain'); }
    else if (id === 'spores') { this.eco.fertilize(tile); this.renderer.fxFertilize(tile); audio.sfx('plant'); }
    haptic(15);
    return true;
  }

  uproot(p) {
    this.eco.removePlant(p, 'uprooted');
    audio.sfx('pop');
  }

  setSpeed(s) {
    this.state.settings.speed = s;
    this.view.update(true);
  }

  applyQuality() { this.renderer.setQuality(this.state.settings); }

  openResearch(tab, focus) { this.view.closeInspect(); clearCoach(); this.tutorialHook('open:research'); return Screens.openResearch(this, tab, focus); }
  openLife(tab) { return Screens.openLife(this, tab); }
  openMenu() { return Screens.openMenu(this); }
  openGoals() { return Screens.openGoals(this); }
  openEraInfo() { return Screens.openEraInfo(this); }

  // ---------------------------------------------------------------- dive
  dive() {
    if (this.mode !== 'planet') return;
    if (!this.Microbe) { toast('Microbe mode failed to load.', { kind: 'bad' }); return; }
    clearCoach();
    this.save();
    this.fade.classList.add('on');
    audio.sfx('descend');
    const rig = this.renderer.rig;
    rig.tDist = Math.max(rig.minDist, rig.tDist - 10);
    setTimeout(() => {
      this.mode = 'microbe';
      this.hud.classList.add('hidden-soft');
      this.renderer.renderer.domElement.style.visibility = 'hidden';
      this.mhost = el('div#microbe-host');
      document.getElementById('app').appendChild(this.mhost);
      const st = this.state;
      audio.music('microbe');
      try {
        this.run = this.Microbe.startMicrobeRun({
          host: this.mhost, era: st.era, genome: { ...st.genome }, codex: { microbes: { ...st.codex.microbes }, mutations: { ...st.codex.mutations } },
          settings: { ...st.settings }, firstRun: st.totals.runs === 0, dnaMult: 1 + (st.era - 1) * 0.1 + (st.starSeeds || 0) * 0.25,
          onExit: (res) => this.endDive(res),
          debug: location.search.includes('debug'),
        });
      } catch (e) {
        console.error(e);
        this.endDive(null);
      }
      setTimeout(() => this.fade.classList.remove('on'), 60);
    }, 450);
  }

  endDive(res) {
    const st = this.state;
    this.fade.classList.add('on');
    setTimeout(() => {
      try { this.run && this.run.destroy(); } catch (e) { console.warn(e); }
      this.run = null;
      this.mhost?.remove(); this.mhost = null;
      if (res) {
        const dna = Math.max(0, Math.round(res.dna || 0));
        addDNA(dna);
        st.totals.runs++;
        if (res.victory) st.totals.runWins++;
        st.totals.bestDepth = Math.max(st.totals.bestDepth || 0, res.depth || 0);
        st.totals.bestLevel = Math.max(st.totals.bestLevel || 0, res.level || 0);
        st.totals.bossKills += res.bossKills || 0;
        for (const id of res.discovered?.microbes || []) st.codex.microbes[id] = true;
        for (const id of res.discovered?.mutations || []) st.codex.mutations[id] = true;
        for (const id of res.mutations || []) st.codex.mutations[id] = true;
        st.runHistory.unshift({ d: Date.now(), dna, depth: res.depth, level: res.level, win: !!res.victory });
        st.runHistory = st.runHistory.slice(0, 20);
      }
      this.mode = 'planet';
      this.renderer.renderer.domElement.style.visibility = '';
      this.hud.classList.remove('hidden-soft');
      audio.music('planet');
      this.renderer.rig.tDist = this.renderer.fitDist(1.1);
      this.save();
      this.view.update(true);
      setTimeout(() => this.fade.classList.remove('on'), 80);
      if (res) setTimeout(() => toast(`Returned with <b class="dna-c">+${fmt(res.dna)} DNA</b>`, { icon: 'dna', kind: 'dna', sound: 'coin' }), 500);
      if (this.pendingGoals?.length) {
        const goals = this.pendingGoals; this.pendingGoals = [];
        goals.forEach((m, i) => setTimeout(() => { toast(`<b>Goal complete:</b> ${m.title}`, { icon: 'check', kind: 'milestone' }); audio.sfx('milestone'); }, 1400 + i * 900));
      }
      this.tutorialHook('dive-end');
    }, 450);
  }

  // ---------------------------------------------------------------- tutorial
  coachOn(id, text, ok = false) {
    const t = document.getElementById(id);
    if (!t || this.mode !== 'planet' || t.offsetParent === null) return;
    this.coach(t, text, ok);
  }
  coach(target, text, ok = false) {
    coach(target, text, { okLabel: ok ? 'TAP TO DISMISS' : null, onOk: ok ? () => {} : null });
    if (!ok) target.addEventListener('click', () => clearCoach(), { once: true });
    else setTimeout(() => clearCoach(), 9000);
  }

  tutorialHook(ev) {
    const st = this.state, done = st.tutorial.done;
    const once = (k, fn) => { if (!done[k]) { done[k] = true; fn(); } };
    if (st.tutorial.skip) return;
    if (ev === 'dive-end' && st.totals.runs >= 1 && !st.research.algae) {
      once('t_research', () => setTimeout(() => this.coachOn('btn-research', st.dna >= 20 ? 'You have enough DNA! Open <b>Research</b> and unlock <b>Sea Algae</b>.' : 'Collect <b>20 DNA</b>, then research <b>Sea Algae</b> here. Dive again!'), 1300));
      if (st.dna < 20) done.t_research = false;
    }
    if (ev === 'research:algae') once('t_algae', () => setTimeout(() => this.coachOn('o2-meter', 'Algae release <b>oxygen</b>. At 2% a new era begins. Speed up time or dive again while you wait!', true), 900));
    if (ev === 'era:2') once('t_era2', () => setTimeout(() => this.coachOn('btn-research', 'Research <b>Star Moss</b>, then plant it on bare rock to start making soil.'), 600));
    if (ev === 'research:moss') once('t_moss', () => setTimeout(() => this.coachOn('btn-plant', 'Tap <b>Plant</b>, pick Star Moss, then tap the land.'), 700));
    if (ev === 'mode:plant') once('t_plant', () => setTimeout(() => toast('Tiles glow <b style="color:var(--good)">green</b> where the species will thrive, <b style="color:var(--warn)">yellow</b> where it may struggle.', { icon: 'plant', ms: 4200 }), 300));
    if (ev === 'planted:moss') once('t_rain', () => setTimeout(() => this.coachOn('tool-rain', '<b>Rain</b> helps plants in dry areas. Plants produce <b class="bloom-c">Bloom</b>, which you spend to plant more.', true), 1500));
    if (ev === 'era:3') once('t_era3', () => setTimeout(() => this.coachOn('btn-research', 'New species are available! Flowers + Glowmoths make a great team.'), 600));
    if (ev === 'era:4') once('t_era4', () => setTimeout(() => this.coachOn('btn-animals', 'Animals can now breathe! Release grazers where there is plenty of grass and moss.'), 600));
    if (ev === 'era:5') once('t_era5', () => setTimeout(() => toast('Predators keep grazers in check. Without them, grazers can strip the land bare and starve.', { icon: 'cat', ms: 5000 }), 600));
    if (ev === 'era:6') once('t_era6', () => setTimeout(() => toast('The <b>World Tree</b> can now be researched. It needs rich, fertile soil.', { icon: 'star', ms: 5000 }), 600));
    if (ev.startsWith('open:') || ev.startsWith('mode:')) clearCoach();
  }

  // ---------------------------------------------------------------- persistence
  save() {
    if (!this.eco || !this.state) return;
    this.state.planet = this.eco.serialize();
    this.state.lastActive = Date.now();
    store.save();
  }

  onVisibility() {
    if (document.hidden) {
      this.save();
      audio.suspend();
      this.hiddenAt = Date.now();
    } else {
      audio.resume();
      if (this.mode === 'planet') this.offlineProgress();
    }
  }

  offlineProgress() {
    const st = this.state;
    const elapsed = (Date.now() - (st.lastActive || Date.now())) / 1000;
    st.lastActive = Date.now();
    if (elapsed < 90 || !st.research.algae) return;
    const ticks = Math.min(OFFLINE_TICK_CAP, Math.floor(elapsed));
    const eco = this.eco;
    const before = { bloom: st.bloom, o2: eco.oxygen, plants: eco.plants.filter((p) => !p.dead).length, born: sum(eco.stats.born), day: eco.day };
    const prevMode = this.mode; this.mode = 'offline';
    for (let i = 0; i < ticks; i++) this.tick();
    this.mode = prevMode;
    const days = Math.round(eco.day - before.day);
    if (days < 1) return;
    const rows = [
      ['Bloom', `+${fmt(st.bloom - before.bloom)}`],
      ['Oxygen', `${before.o2.toFixed(1)}% → ${eco.oxygen.toFixed(1)}%`],
      ['Plants', `${fmt(before.plants)} → ${fmt(eco.plants.filter((p) => !p.dead).length)}`],
    ];
    const born = sum(eco.stats.born) - before.born;
    if (born > 0) rows.push(['Animals born', fmt(born)]);
    Screens.awayDialog({ days, rows });
    this.save();
  }

  newWorld(bonus) {
    const st = this.state;
    const carry = { genome: st.genome, codex: st.codex, settings: st.settings, totals: { ...st.totals }, starSeeds: (st.starSeeds || 0) + (bonus ? 1 : 0), worldNumber: st.worldNumber };
    store.newGame(carry);
    location.reload();
  }

  registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      // check for a newer version whenever the app comes back to the foreground
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch((e) => console.warn('SW failed', e));
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return; // first install: nothing to refresh
      refreshing = true;
      if (this.mode === 'title' || this.mode === 'boot') { this.save(); location.reload(); }
      else toast('A new version of Tiny World is ready. It will load next time you open the game.', { icon: 'refresh', ms: 4000 });
    });
  }
}

function whyHarsh(eco, sp, tile) {
  const p = sp.pref; const t = eco.temp(tile), m = eco.moist(tile), f = eco.fert[tile];
  if (f < p.fert - 0.05) return 'The soil is not fertile enough yet.';
  if (m < p.moist[0]) return 'It is too dry.';
  if (m > p.moist[2]) return 'It is too wet.';
  if (t < p.temp[0]) return 'It is too cold.';
  if (t > p.temp[2]) return 'It is too hot.';
  if (p.coast) return 'It needs to be near the coast.';
  return '';
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.querySelector('.label').textContent = 'Something went wrong: ' + e.message;
});
