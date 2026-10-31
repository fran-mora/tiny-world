// Planet screen HUD: resources, oxygen/era meter, goals, time controls, events, dock, species tray,
// weather tools, inspect card, tap handling and contextual tutorial hints.
import { el, icon, fmt, toast, coach, clearCoach, anyModalOpen, pulse } from '../ui.js';
import { audio, haptic } from '../audio.js';
import { PLANTS, ANIMALS, PLANT, ANIMAL, ERAS } from '../data/species.js';
import { activeGoals } from '../data/milestones.js';
import { biomeName } from './world.js';
import { COVER_IDS, EVENT_TYPES } from './sim.js';
import { thumbEl } from './thumbs.js';
import { clamp } from '../rng.js';

const TOOLS = {
  rain: { name: 'Rain', icon: 'cloud', cost: 12, cooldown: 12, era: 2, desc: 'Summon a rain cloud. Raises moisture and breaks droughts.' },
  spores: { name: 'Spore Burst', icon: 'sprout', cost: 25, cooldown: 20, era: 3, desc: 'Scatter fungal spores that make the soil fertile.' },
};

export class PlanetView {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.mode = null;          // null | 'plant' | 'animal' | 'rain' | 'spores'
    this.selected = null;      // species id
    this.inspectTarget = null; // { tile } | { animal }
    this.cool = { rain: 0, spores: 0 };
    this.lastHud = 0;
    this.build();
    const rig = game.renderer.rig;
    rig.onTap = (x, y) => this.onTap(x, y);
    rig.onDoubleTap = (x, y) => this.onDoubleTap(x, y);
  }

  get eco() { return this.game.eco; }
  get state() { return this.game.state; }

  // ---------------------------------------------------------------- DOM
  build() {
    const r = this.root;
    r.innerHTML = '';
    // top
    this.chipDna = el('div.chip#chip-dna', {}, [icon('dna'), el('span.num.dna-c', {}, '0')]);
    this.chipBloom = el('div.chip#chip-bloom', {}, [icon('bloom'), el('span.num.bloom-c', {}, '0'), el('span.sub', {}, '')]);
    this.chipDna.querySelector('svg').style.color = 'var(--dna)';
    this.chipBloom.querySelector('svg').style.color = 'var(--bloom)';
    this.chipDna.addEventListener('click', () => this.game.openResearch('genome'));
    this.chipBloom.addEventListener('click', () => toast(`Plants produce <b class="bloom-c">Bloom</b>. Flowers and trees make the most. Currently <b>${fmt(this.eco.bloomRate * 0.5, 1)}</b>/min at 1×.`, { icon: 'bloom' }));
    const menuBtn = el('button.icon-btn#btn-menu', { 'aria-label': 'Menu', onclick: () => { audio.sfx('click'); this.game.openMenu(); } }, icon('menu'));
    // o2 meter
    this.o2Fill = el('i.fill');
    this.o2Track = el('div.o2-track', {}, [this.o2Fill]);
    for (let e = 2; e <= 6; e++) this.o2Track.appendChild(el('i.tick', { style: { left: (ERAS[e].o2 / 21 * 100) + '%' }, 'data-era': e }));
    this.o2Val = el('span.o2-val.o2-c', {}, '0%');
    this.eraTag = el('span.era-tag', {}, 'Era I');
    this.o2 = el('div.o2-meter.panel#o2-meter', { onclick: () => { audio.sfx('click'); this.game.openEraInfo(); } }, [iconSpan('o2', 'var(--o2)'), this.o2Val, this.o2Track, this.eraTag]);
    // goals + time
    this.goalTitle = el('div.gtitle', {}, '');
    this.goalBar = el('i');
    this.goal = el('div.goal-card.panel#goal-card', { onclick: () => { audio.sfx('click'); this.game.openGoals(); } }, [this.goalTitle, el('div.bar', {}, this.goalBar)]);
    this.speedBtns = {};
    const seg = el('div.seg');
    for (const [s, lab] of [[0, icon('pause')], [1, '1×'], [3, '3×'], [10, '10×']]) {
      const b = el('button', { onclick: () => { audio.sfx('tick'); this.game.setSpeed(s); } }, lab);
      this.speedBtns[s] = b; seg.appendChild(b);
    }
    this.dayLbl = el('div.day', {}, 'Day 0');
    this.timeCtl = el('div.time-ctl.panel', {}, [seg, this.dayLbl]);
    this.events = el('div.events');
    const top = el('div.hud-top', {}, [
      el('div.hud-row', {}, [this.chipDna, this.chipBloom, el('div.grow'), menuBtn]),
      this.o2,
      el('div.hud-row', { style: { alignItems: 'stretch' } }, [this.goal, this.timeCtl]),
      this.events,
    ]);
    // side tools
    this.toolBtns = {};
    this.side = el('div.side-tools');
    for (const [id, t] of Object.entries(TOOLS)) {
      const b = el('button.icon-btn', { 'aria-label': t.name, onclick: () => this.toggleTool(id) }, [icon(t.icon), el('span.cost', {}, [String(t.cost)])]);
      b.id = 'tool-' + id;
      this.toolBtns[id] = b; this.side.appendChild(b);
    }
    // dock
    const db = (id, ic, label, fn) => { const b = el('button.dock-btn', { id, onclick: fn }, [icon(ic), el('span.lbl', {}, label)]); return b; };
    this.btnPlant = db('btn-plant', 'plant', 'Plant', () => this.toggleMode('plant'));
    this.btnAnimals = db('btn-animals', 'paw', 'Animals', () => this.toggleMode('animal'));
    this.btnResearch = db('btn-research', 'flask', 'Research', () => { audio.sfx('click'); this.closeTray(); this.game.openResearch(); });
    this.btnLife = db('btn-life', 'chart', 'Life', () => { audio.sfx('click'); this.closeTray(); this.game.openLife(); });
    this.btnDive = el('button.dive-btn#btn-dive', { 'aria-label': 'Dive', onclick: () => { audio.sfx('click'); haptic(15); this.closeTray(); this.game.dive(); } }, [icon('microbe'), el('span.lbl', {}, 'DIVE')]);
    this.dock = el('div.dock', {}, el('div.dock-inner.panel', {}, [this.btnPlant, this.btnAnimals, this.btnDive, this.btnResearch, this.btnLife]));
    this.trayHost = el('div');
    this.inspectHost = el('div');
    r.append(top, this.side, this.trayHost, this.inspectHost, this.dock);
    this.update(true);
  }

  // ---------------------------------------------------------------- update (≈5 Hz)
  update(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHud < 200) return;
    this.lastHud = now;
    const st = this.state, eco = this.eco;
    const dnaTxt = fmt(st.dna);
    if (this.chipDna.lastChild.textContent !== dnaTxt) { this.chipDna.lastChild.textContent = dnaTxt; if (!force) pulse(this.chipDna); }
    this.chipBloom.children[1].textContent = fmt(st.bloom);
    const perMin = eco.bloomRate * 0.5 * Math.max(1, this.game.speed);
    this.chipBloom.children[2].textContent = perMin > 0.05 ? `+${fmt(perMin, 1)}/m` : '';
    // o2
    const o2 = eco.oxygen;
    this.o2Val.textContent = o2.toFixed(o2 < 10 ? 1 : 0) + '%';
    this.o2Fill.style.width = Math.min(100, o2 / 21 * 100) + '%';
    const era = ERAS[st.era];
    this.eraTag.textContent = `Era ${roman(st.era)} · ${era.name}`;
    this.eraTag.style.background = hexA(era.color, 0.18); this.eraTag.style.color = era.color;
    this.o2Track.querySelectorAll('.tick').forEach((t) => t.classList.toggle('next', +t.dataset.era === st.era + 1));
    // goal
    const goals = activeGoals(st, 1);
    if (goals.length) {
      const g = goals[0];
      const p = clamp(g.check(this.game.goalCtx()), 0, 1);
      if (this.goalTitle.dataset.id !== g.id) { this.goalTitle.innerHTML = icon('target') + `<span>${g.title}</span>`; this.goalTitle.dataset.id = g.id; }
      this.goalBar.style.width = (p * 100) + '%';
      this.goal.classList.remove('hidden');
    } else this.goal.classList.add('hidden');
    // time
    for (const [s, b] of Object.entries(this.speedBtns)) b.classList.toggle('on', +s === this.game.speed);
    this.dayLbl.textContent = `Day ${Math.floor(eco.day) + 1}`;
    // events
    this.renderEvents();
    // tools availability
    for (const [id, t] of Object.entries(TOOLS)) {
      const b = this.toolBtns[id];
      const unlocked = st.era >= t.era;
      b.classList.toggle('hidden', !unlocked);
      const cd = this.cool[id] - now / 1000;
      b.classList.toggle('cooling', cd > 0 || st.bloom < t.cost);
      b.classList.toggle('active', this.mode === id);
    }
    // dock badges
    const canResearch = this.game.affordableResearch();
    setBadge(this.btnResearch, canResearch ? 'dot' : null);
    this.btnPlant.classList.toggle('active', this.mode === 'plant');
    this.btnAnimals.classList.toggle('active', this.mode === 'animal');
    this.btnAnimals.classList.toggle('hidden', st.era < 3);
    if (this.tray) this.refreshTrayCosts();
    if (this.inspectTarget) this.refreshInspect();
  }

  renderEvents() {
    const evs = this.eco.events;
    const key = evs.map((e) => e.id + ':' + Math.ceil(e.end - this.eco.day)).join(',');
    if (key === this.evKey) return;
    this.evKey = key;
    this.events.innerHTML = '';
    for (const e of evs) {
      const T = EVENT_TYPES[e.type];
      const left = Math.max(0, e.end - this.eco.day);
      let name = T.name;
      if (e.sp) name += ': ' + (PLANT[e.sp] || ANIMAL[e.sp]).name;
      const pill = el('div.event-pill.panel', { class: T.bad ? 'bad' : 'good', onclick: () => this.focusEvent(e) }, [icon(T.icon, 'sm'), el('span', {}, name), el('span.left', {}, left < 1 ? '<1 day' : `${Math.ceil(left)} days`)]);
      this.events.appendChild(pill);
    }
  }

  focusEvent(e) {
    audio.sfx('click');
    const T = EVENT_TYPES[e.type];
    if (e.tile != null) this.game.renderer.rig.flyTo(this.game.renderer.tileWorld(e.tile), 24);
    toast(`<b>${T.name}.</b> ${T.desc} <span class="dim">${T.tip}</span>`, { icon: T.icon, ms: 4200, kind: T.bad ? 'bad' : '' });
  }

  // ---------------------------------------------------------------- modes & tray
  toggleMode(mode) {
    audio.sfx('click');
    if (this.mode === mode) { this.closeTray(); return; }
    this.closeInspect();
    this.mode = mode;
    if (mode === 'plant' || mode === 'animal') {
      const list = (mode === 'plant' ? PLANTS : ANIMALS).filter((s) => s.kind !== 'ocean');
      const first = list.find((s) => this.state.research[s.id]);
      this.selected = this.selected && list.some((s) => s.id === this.selected && this.state.research[s.id]) ? this.selected : first?.id || null;
      this.openTray(mode, list);
    }
    this.applyOverlay();
    this.update(true);
    this.game.tutorialHook('mode:' + mode);
  }

  toggleTool(id) {
    const t = TOOLS[id];
    const now = performance.now() / 1000;
    if (this.mode === id) { this.closeTray(); return; }
    if (this.cool[id] > now) { audio.sfx('error'); toast(`${t.name} is recharging (${Math.ceil(this.cool[id] - now)}s).`, { icon: 'clock' }); return; }
    if (this.state.bloom < t.cost) { audio.sfx('error'); toast(`${t.name} costs <b class="bloom-c">${t.cost} Bloom</b>.`, { icon: 'bloom' }); return; }
    audio.sfx('click');
    this.closeTray(); this.closeInspect();
    this.mode = id; this.selected = null;
    this.trayHost.innerHTML = '';
    const inner = el('div.tray-inner.panel', {}, el('div.tray-head', {}, [iconSpan(t.icon, 'var(--o2)'), el('span.t', {}, t.name), el('span.hint', {}, 'Tap where it should go'), el('button.icon-btn', { onclick: () => { audio.sfx('click'); this.closeTray(); } }, icon('close'))]));
    inner.style.paddingBottom = '2px';
    this.tray = el('div.tray', {}, inner);
    this.trayHost.appendChild(this.tray);
    this.update(true);
  }

  openTray(mode, list) {
    this.trayHost.innerHTML = '';
    const scroller = el('div.scroll-x');
    this.cards = {};
    for (const s of list) {
      const researched = !!this.state.research[s.id];
      const visible = researched || s.era <= this.state.era + 1;
      if (!visible) continue;
      const card = el('div.sp-card', { class: researched ? '' : 'locked', onclick: () => this.selectSpecies(s.id) }, [
        el('div.thumb', {}, thumbEl(s.id, icon(s.icon))),
        el('div.nm', {}, s.name),
        researched ? el('div.cost', {}, [icon('bloom'), String(s.cost)]) : el('div.cost', { style: { color: 'var(--dna)' } }, [icon('dna'), String(s.dna)]),
        researched ? null : el('div.lockic', {}, icon('lock')),
        el('div.count', {}, ''),
      ]);
      this.cards[s.id] = card;
      scroller.appendChild(card);
    }
    const hint = mode === 'plant' ? 'Green tiles suit it best' : 'Release near food';
    this.trayHint = el('span.hint', {}, hint);
    const inner = el('div.tray-inner.panel', {}, [
      el('div.tray-head', {}, [iconSpan(mode === 'plant' ? 'plant' : 'paw', 'var(--leaf)'), el('span.t', {}, mode === 'plant' ? 'Plant' : 'Animals'), this.trayHint, el('button.icon-btn', { onclick: () => { audio.sfx('click'); this.closeTray(); } }, icon('close'))]),
      scroller,
    ]);
    this.tray = el('div.tray', {}, inner);
    this.trayHost.appendChild(this.tray);
    this.refreshTrayCosts();
    if (this.selected) requestAnimationFrame(() => this.cards[this.selected]?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }

  refreshTrayCosts() {
    if (!this.cards) return;
    const counts = this.mode === 'plant' ? this.eco.plantCounts() : this.eco.popCount;
    for (const [id, card] of Object.entries(this.cards)) {
      const s = PLANT[id] || ANIMAL[id];
      card.classList.toggle('on', id === this.selected);
      const researched = !!this.state.research[id];
      card.classList.toggle('poor', researched && this.state.bloom < s.cost);
      const c = counts[id] || 0;
      card.querySelector('.count').textContent = researched && c ? fmt(c) : '';
    }
  }

  selectSpecies(id) {
    const s = PLANT[id] || ANIMAL[id];
    if (!this.state.research[id]) {
      audio.sfx('click');
      if (s.era > this.state.era) toast(`<b>${s.name}</b> unlocks in Era ${roman(s.era)} (${ERAS[s.era].name}).`, { icon: 'lock' });
      else this.game.openResearch('life', id);
      return;
    }
    audio.sfx('pop');
    this.selected = id;
    this.refreshTrayCosts();
    this.applyOverlay();
    const o2low = ANIMAL[id] && this.eco.oxygen < ANIMAL[id].o2Min;
    this.trayHint.textContent = PLANT[id] ? `${s.cost} Bloom · green tiles suit it` : o2low ? `Needs ${ANIMAL[id].o2Min}% oxygen to breathe!` : `${s.cost} Bloom for ${s.group} · ${s.role}`;
    this.trayHint.style.color = o2low ? 'var(--warn)' : '';
    this.game.tutorialHook('select:' + id);
  }

  applyOverlay() {
    const r = this.game.renderer;
    if (this.mode === 'plant' && this.selected && PLANT[this.selected]?.pref) {
      const id = this.selected;
      r.setOverlay((i) => this.eco.suitability(id, i));
    } else if (r.overlayFn) r.setOverlay(null);
  }

  closeTray() {
    this.mode = null; this.tray = null; this.cards = null;
    this.trayHost.innerHTML = '';
    this.applyOverlay();
    this.game.renderer.setMarker(null);
    this.update(true);
  }

  // ---------------------------------------------------------------- taps
  onTap(x, y) {
    if (anyModalOpen()) return;
    const r = this.game.renderer;
    const hit = r.pick(x, y);
    const mode = this.mode;
    if ((mode === 'plant' || mode === 'animal') && hit.tile != null) {
      if (!this.selected) { toast('Pick a species first.', { icon: 'info' }); return; }
      if (mode === 'plant') this.game.plantAt(this.selected, hit.tile);
      else this.game.releaseAt(this.selected, hit.tile);
      return;
    }
    if ((mode === 'rain' || mode === 'spores') && hit.tile != null) {
      const ok = this.game.useTool(mode, hit.tile, TOOLS[mode]);
      if (ok) { this.cool[mode] = performance.now() / 1000 + TOOLS[mode].cooldown; this.closeTray(); }
      return;
    }
    if (hit.animal) { audio.sfx('click'); this.inspect({ animal: hit.animal }); return; }
    if (hit.tile != null) { audio.sfx('tick'); this.inspect({ tile: hit.tile }); return; }
    this.closeInspect();
  }

  onDoubleTap(x, y) {
    const r = this.game.renderer;
    const hit = r.pick(x, y);
    if (hit.tile == null) return;
    const rig = r.rig;
    rig.flyTo(r.tileWorld(hit.tile), rig.tDist > 20 ? 16 : r.fitDist(1.1));
  }

  // ---------------------------------------------------------------- inspect
  inspect(target) {
    this.inspectTarget = target;
    this.following = null;
    this.inspectHost.innerHTML = '';
    this.inspectEl = el('div.inspect', {}, el('div.inspect-inner.panel'));
    this.inspectHost.appendChild(this.inspectEl);
    this.refreshInspect(true);
  }

  closeInspect() {
    this.inspectTarget = null; this.following = null;
    this.inspectHost.innerHTML = '';
    if (!this.mode) this.game.renderer.setMarker(null);
  }

  refreshInspect(first = false) {
    const t = this.inspectTarget; if (!t || !this.inspectEl) return;
    const eco = this.eco, w = this.game.world;
    const inner = this.inspectEl.firstChild;
    const close = el('button.icon-btn.x', { onclick: () => { audio.sfx('click'); this.closeInspect(); } }, icon('close'));
    if (t.animal) {
      const a = t.animal;
      if (a.dead) { inner.replaceChildren(el('div.grow', {}, [el('h3', {}, `${ANIMALS[a.sp].name}`), el('div.meta', {}, 'This animal has died.')]), close); this.following = null; return; }
      const sp = ANIMALS[a.sp];
      const states = ['Wandering', 'Foraging', 'Fleeing!', 'Resting', 'Searching for food', 'Eating'];
      let st = states[a.state] || 'Wandering';
      if (sp.predator && a.state === 1) st = 'Hunting';
      if (sp.id === 'moth' && a.state === 5) st = 'Pollinating';
      const pct = (v) => Math.round((v - 1) * 100);
      const gtxt = (v, label) => Math.abs(pct(v)) >= 2 ? el('span', {}, [label + ' ', el('b', { class: pct(v) > 0 ? 'trend-up' : 'trend-down' }, (pct(v) > 0 ? '+' : '') + pct(v) + '%')]) : null;
      this.game.renderer.setMarker(a.tile, '#ffffff', 0.7);
      inner.replaceChildren(
        el('div.thumb', {}, thumbEl(sp.id, icon(sp.icon))),
        el('div.grow', {}, [
          el('h3', {}, [sp.name, el('span.tag', {}, sp.role)]),
          el('div.meta', {}, [el('span', {}, [el('b', {}, st)]), el('span', {}, ['Age ', el('b', {}, a.age.toFixed(1) + 'd')]), el('span', {}, ['Gen ', el('b', {}, String(a.gen))]), gtxt(a.genes.speed, 'Speed'), gtxt(a.genes.size, 'Size')]),
          el('div.bars', {}, [el('span', {}, 'Energy'), el('div.bar', {}, el('i', { style: { width: a.energy * 100 + '%', background: a.energy < 0.25 ? 'var(--danger)' : 'var(--leaf)' } }))]),
          el('div.acts', {}, [
            el('button.btn', { onclick: () => { audio.sfx('click'); this.following = this.following ? null : a; this.refreshInspect(); } }, [icon('eye', 'sm'), this.following ? 'Stop following' : 'Follow']),
          ]),
        ]),
        close,
      );
      return;
    }
    const i = t.tile;
    const temp = eco.temp(i), moist = eco.moist(i);
    const pi = eco.plantAt[i];
    const p = pi >= 0 ? eco.plants[pi] : null;
    this.game.renderer.setMarker(i, '#ffffff', p && PLANTS[p.sp].layer === 'tree' ? 1.4 : 1);
    const bars = el('div.bars', {}, [
      el('span', {}, 'Temp'), barEl(temp, tempColor(temp)),
      el('span', {}, 'Moisture'), barEl(moist, '#5fb8ff'),
      w.ocean[i] ? null : el('span', {}, 'Soil'), w.ocean[i] ? null : barEl(eco.fert[i], '#c9925a'),
    ]);
    const meta = [];
    if (!w.ocean[i] && eco.coverSp[i]) meta.push(el('span', {}, [PLANT[COVER_IDS[eco.coverSp[i] - 1]].name + ' ', el('b', {}, Math.round(eco.cover[i] * 100) + '%')]));
    if (eco.detritus[i] > 0.05) meta.push(el('span', {}, ['Decay ', el('b', {}, Math.round(eco.detritus[i] * 100) + '%')]));
    let count = 0; for (let j = eco.tileHead[i]; j >= 0; j = eco.nextInTile[j]) count++;
    if (count) meta.push(el('span', {}, [el('b', {}, String(count)), ' animal' + (count > 1 ? 's' : '')]));
    let title = biomeName(w, i, temp, moist), thumbNode = el('div.thumb', {}, icon('globe', 'lg'));
    const acts = [];
    if (p && !p.dead) {
      const sp = PLANTS[p.sp];
      title = sp.name;
      thumbNode = el('div.thumb', {}, thumbEl(sp.id, icon(sp.icon)));
      meta.unshift(el('span', {}, [biomeName(w, i, temp, moist)]));
      meta.unshift(el('span', {}, ['Growth ', el('b', {}, Math.round(p.growth * 100) + '%')]));
      meta.unshift(el('span', {}, ['Health ', el('b', { class: p.health < 0.35 ? 'danger-c' : '' }, Math.round(p.health * 100) + '%')]));
      if (p.flowering) meta.push(el('span.tag.bloom', {}, 'Flowering'));
      if (p.pollen > 0.1) meta.push(el('span.tag.good', {}, 'Pollinated'));
      const suit = eco.suitability(sp.id, i);
      bars.prepend(el('span', {}, 'Suits it'), barEl(suit, suit > 0.55 ? 'var(--good)' : suit > 0.3 ? 'var(--warn)' : 'var(--danger)'));
      if (!sp.unique) acts.push(el('button.btn.btn-danger', { onclick: () => { this.game.uproot(p); this.refreshInspect(); } }, [icon('trash', 'sm'), 'Uproot']));
    }
    if (!w.ocean[i] && this.state.era >= 2) {
      acts.push(el('button.btn', { onclick: () => { this.closeInspect(); this.toggleMode('plant'); } }, [icon('plant', 'sm'), 'Plant here']));
    }
    inner.replaceChildren(
      thumbNode,
      el('div.grow', {}, [el('h3', {}, [title, el('span.tag', {}, w.latitudeName(i))]), el('div.meta', {}, meta), bars, acts.length ? el('div.acts', {}, acts) : null]),
      close,
    );
  }

  frame(dt) {
    if (this.following && !this.following.dead) {
      const a = this.following;
      const rig = this.game.renderer.rig;
      const d = { x: a.x, y: a.y, z: a.z };
      const yaw = Math.atan2(d.x, d.z), pitch = Math.asin(clamp(d.y, -1, 1));
      let dy = yaw - rig.tYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      rig.tYaw += dy * Math.min(1, dt * 2.5); rig.tPitch += (pitch - rig.tPitch) * Math.min(1, dt * 2.5);
      if (rig.tDist > 18) rig.tDist += (16 - rig.tDist) * Math.min(1, dt * 2);
      this.game.renderer.setMarker(a.tile, '#ffffff', 0.7);
    }
  }
}

function iconSpan(name, color) { const s = el('span', { style: { color, display: 'inline-flex' } }); s.innerHTML = icon(name); return s; }
function barEl(v, color) { return el('div.bar', {}, el('i', { style: { width: clamp(v, 0, 1) * 100 + '%', background: color } })); }
function tempColor(t) { return t < 0.25 ? '#8fd0ff' : t < 0.6 ? '#9be36d' : t < 0.8 ? '#ffc66d' : '#ff7b5c'; }
function setBadge(btn, kind) {
  let b = btn.querySelector('.badge');
  if (!kind) { if (b) b.remove(); return; }
  if (!b) { b = el('span.badge'); btn.appendChild(b); }
  b.className = 'badge ' + (kind === 'dot' ? 'dot' : '');
}
export function roman(n) { return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][n] || String(n); }
export function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export { TOOLS };
