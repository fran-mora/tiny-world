// Sheets & dialogs: Research (species, adaptations, genome), Life (populations, codex, stats),
// Goals, Eras, Menu/settings, How to play, era-up, ending, while-you-were-away.
import { el, icon, fmt, sheet, dialog, confirm, toast, duration } from './ui.js';
import { audio, haptic } from './audio.js';
import { PLANTS, ANIMALS, PLANT, ANIMAL, ERAS, ANIMAL_ADAPTS, PLANT_ADAPTS, adaptCost } from './data/species.js';
import { MILESTONES, activeGoals } from './data/milestones.js';
import { thumbEl } from './planet/thumbs.js';
import { roman, hexA } from './planet/view.js';
import { store } from './state.js';
import { BUILD, BUILD_TIME } from './version.js';

// ------------------------------------------------------------------ research
export function openResearch(game, tab = 'life', focusId = null) {
  let current = tab;
  const segBtns = {};
  const seg = el('div.seg', { style: { marginBottom: '12px' } });
  const tabs = [['life', 'Species'], ['evolve', 'Evolve'], ['genome', 'Genome']];
  for (const [id, label] of tabs) { const b = el('button', { onclick: () => { audio.sfx('tick'); current = id; render(); } }, label); segBtns[id] = b; seg.appendChild(b); }
  const dnaLine = el('div.row', { style: { marginBottom: '10px' } });
  const tradeLine = el('div');
  const content = el('div');
  const sh = sheet({ title: 'Research', body: [seg, dnaLine, tradeLine, content] });
  const render = () => {
    for (const [id, b] of Object.entries(segBtns)) b.classList.toggle('on', id === current);
    dnaLine.replaceChildren(el('span.chip', {}, [icon('dna'), el('span.dna-c.num', {}, fmt(game.state.dna))]), el('span.small.dim.grow', {}, current === 'genome' ? 'Permanent upgrades for your microbe. They carry over to new worlds.' : current === 'evolve' ? 'Adapt your species to thrive in harsher places.' : 'Unlock new life for your planet.'));
    dnaLine.firstChild.querySelector('svg').style.color = 'var(--dna)';
    content.replaceChildren(...(current === 'life' ? lifeTab() : current === 'evolve' ? evolveTab() : genomeTab()));
    const t = game.tradeInfo();
    tradeLine.replaceChildren(t.available ? el('div.card.row', { style: { marginBottom: '12px', padding: '10px 12px' } }, [
      el('div.grow', {}, [el('div', { style: { fontWeight: 800, fontSize: '14px' } }, 'Seed Exchange'), el('div.small.dim', {}, `You have ${fmt(game.state.bloom)} Bloom. The price rises with each trade and cools down over time.`)]),
      el('button.btn.btn-bloom', { class: game.state.bloom >= t.price ? '' : 'disabled', style: { minHeight: '38px', padding: '8px 12px', fontSize: '13px' }, onclick: () => { if (game.tradeBloom()) render(); } }, [icon('bloom', 'sm'), fmt(t.price), ' \u2192 ', icon('dna', 'sm'), String(t.dna)]),
    ]) : '');
  };
  const lifeTab = () => {
    const out = [];
    const st = game.state;
    for (let e = 1; e <= 6; e++) {
      const all = [...PLANTS, ...ANIMALS].filter((s) => s.era === e);
      if (!all.length) continue;
      const locked = e > st.era;
      out.push(el('div.section-title', {}, [`Era ${roman(e)} · ${ERAS[e].name}`, locked ? el('span.tag', { style: { marginLeft: '6px' } }, [icon('lock', 'sm'), ` ${ERAS[e].o2}% O₂`]) : null]));
      const list = el('div.list');
      for (const s of all) {
        const done = !!st.research[s.id];
        const can = !done && !locked && st.dna >= s.dna;
        const kind = PLANT[s.id] ? (s.kind === 'cover' ? 'Ground cover' : s.kind === 'ocean' ? 'Ocean life' : cap(s.layer)) : s.role;
        const btn = done ? el('span.tag.good', {}, [icon('check', 'sm'), 'Done'])
          : locked ? el('span.tag', {}, [icon('lock', 'sm'), roman(e)])
          : el('button.btn.btn-dna', { class: can ? '' : 'disabled', onclick: () => { if (game.research(s.id)) render(); } }, [icon('dna', 'sm'), String(s.dna)]);
        const card = el('div.card.res-card', { class: done ? 'done' : locked ? 'locked' : '' }, [
          el('div.thumb', {}, locked ? icon('lock', 'lg') : thumbEl(s.id, icon(s.icon))),
          el('div.info', {}, [el('div.nm', {}, [s.name, el('span.tag', {}, kind)]), el('div.ds', {}, locked ? `Unlocks at ${ERAS[e].o2}% oxygen.` : s.desc), !locked && ANIMAL[s.id] ? el('div.ds', {}, `Needs ${s.o2Min}% oxygen · released in groups of ${s.group}`) : null]),
          btn,
        ]);
        if (s.id === focusId) { card.style.boxShadow = '0 0 0 2px var(--dna) inset'; setTimeout(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); }
        list.appendChild(card);
      }
      out.push(list);
    }
    return out;
  };
  const evolveTab = () => {
    const st = game.state;
    const species = [...PLANTS, ...ANIMALS].filter((s) => st.research[s.id] && s.kind !== 'ocean' && !s.unique);
    if (!species.length) return [el('div.empty', {}, 'Research some species first, then adapt them here.')];
    const out = [];
    for (const s of species) {
      const isA = !!ANIMAL[s.id];
      const adapts = isA ? ANIMAL_ADAPTS : PLANT_ADAPTS;
      const lv = st.adaptations[s.id] || {};
      const rows = adapts.filter((a) => !(s.kind === 'cover' && a.id === 'prolific')).map((a) => {
        const l = lv[a.id] || 0;
        const max = l >= a.max;
        const cost = adaptCost(a, l, s);
        const pips = el('span.pips', {}, Array.from({ length: a.max }, (_, k) => el('i', { class: k < l ? 'on' : '' })));
        return el('div.adapt-row', {}, [
          el('div.grow', {}, [el('div', { style: { fontWeight: 750, fontSize: '14px' } }, [a.name, pips]), el('div.small.dim', {}, a.desc)]),
          max ? el('span.tag.good', {}, 'Max') : el('button.btn.btn-dna', { class: st.dna >= cost ? '' : 'disabled', style: { minHeight: '34px', padding: '6px 10px', fontSize: '13px' }, onclick: () => { if (game.buyAdapt(s.id, a.id, cost)) render(); } }, [icon('dna', 'sm'), fmt(cost)]),
        ]);
      });
      out.push(el('div.card', { style: { marginBottom: '10px' } }, [
        el('div.row', { style: { marginBottom: '4px' } }, [el('div.thumb', { style: { width: '40px', height: '40px', borderRadius: '11px' } }, thumbEl(s.id, icon(s.icon))), el('h3.grow', {}, s.name)]),
        ...rows,
      ]));
    }
    return out;
  };
  const genomeTab = () => {
    const M = game.Microbe;
    if (!M || !M.GENOME_UPGRADES) return [el('div.empty', {}, 'Genome data unavailable.')];
    const st = game.state;
    const list = el('div.list');
    for (const u of M.GENOME_UPGRADES) {
      const l = st.genome[u.id] || 0;
      const max = l >= u.maxLevel;
      const cost = max ? 0 : u.cost(l);
      let portrait = null;
      try { portrait = fitCanvas(M.portrait('genome', u.id, 112)); } catch (e) {}
      list.appendChild(el('div.card.res-card', {}, [
        el('div.thumb', {}, portrait || icon('dna', 'lg')),
        el('div.info', {}, [
          el('div.nm', {}, [u.name, el('span.pips', {}, Array.from({ length: u.maxLevel }, (_, k) => el('i', { class: k < l ? 'on' : '' })))]),
          el('div.ds', {}, u.desc),
          el('div.ds', { style: { color: 'var(--dna)' } }, l > 0 ? `Now: ${u.effect(l)}${max ? '' : ` → ${u.effect(l + 1)}`}` : `Next: ${u.effect(1)}`),
        ]),
        max ? el('span.tag.good', {}, 'Max') : el('button.btn.btn-dna', { class: st.dna >= cost ? '' : 'disabled', onclick: () => { if (game.buyGenome(u.id, cost)) render(); } }, [icon('dna', 'sm'), fmt(cost)]),
      ]));
    }
    return [list];
  };
  render();
  return sh;
}

// ------------------------------------------------------------------ life
export function openLife(game, tab = 'pop') {
  let current = tab;
  const seg = el('div.seg', { style: { marginBottom: '12px' } });
  const segBtns = {};
  for (const [id, label] of [['pop', 'Populations'], ['codex', 'Codex'], ['stats', 'Stats']]) { const b = el('button', { onclick: () => { audio.sfx('tick'); current = id; render(); } }, label); segBtns[id] = b; seg.appendChild(b); }
  const content = el('div');
  const sh = sheet({ title: 'Life on your world', body: [seg, content] });
  let hidden = new Set();
  const render = () => {
    for (const [id, b] of Object.entries(segBtns)) b.classList.toggle('on', id === current);
    content.replaceChildren(...(current === 'pop' ? popTab() : current === 'codex' ? codexTab() : statsTab()));
    if (current === 'pop') requestAnimationFrame(drawChart);
  };
  const colors = { ...Object.fromEntries(PLANTS.map((p) => [p.id, p.color])), ...Object.fromEntries(ANIMALS.map((a) => [a.id, a.color])), hopper: '#ffd59a', prowler: '#ff7b4f', moth: '#bfefff', fish: '#4fb6ff', beetle: '#a98bff', grazer: '#c9a777', hawk: '#ffffff' };
  let canvas;
  const popTab = () => {
    const eco = game.eco;
    const h = eco.history;
    canvas = el('canvas');
    const keys = Object.keys(h.pops).filter((k) => ANIMAL[k] || ['flower', 'bush', 'oak', 'pine', 'palm', 'fern', 'cactus', 'mushroom'].includes(k));
    const legend = el('div.legend', {}, [
      el('span', { class: hidden.has('o2') ? 'off' : '', onclick: () => { toggle('o2'); } }, [el('i', { style: { background: 'var(--o2)' } }), 'Oxygen']),
      ...keys.map((k) => el('span', { class: hidden.has(k) ? 'off' : '', onclick: () => toggle(k) }, [el('i', { style: { background: colors[k] || '#fff' } }), (PLANT[k] || ANIMAL[k]).name])),
    ]);
    const counts = { ...eco.plantCounts(), ...eco.popCount };
    const genes = eco.computeGenes();
    const rows = [];
    const ids = [...ANIMALS.map((a) => a.id), ...PLANTS.map((p) => p.id)].filter((id) => game.state.research[id]);
    for (const id of ids) {
      const s = PLANT[id] || ANIMAL[id];
      let n = counts[id] || 0;
      let sub = '';
      if (id === 'algae') { n = Math.round(eco.algae * 100); sub = 'ocean coverage %'; }
      else if (s.kind === 'cover') sub = 'tiles covered';
      else if (ANIMAL[id]) {
        const g = genes[id];
        const parts = [];
        if (g) {
          const p = (v) => Math.round((v - 1) * 100);
          if (Math.abs(p(g.speed)) >= 2) parts.push(`speed ${p(g.speed) > 0 ? '+' : ''}${p(g.speed)}%`);
          if (Math.abs(p(g.size)) >= 2) parts.push(`size ${p(g.size) > 0 ? '+' : ''}${p(g.size)}%`);
          if (Math.abs(p(g.meta)) >= 2) parts.push(`appetite ${p(g.meta) > 0 ? '+' : ''}${p(g.meta)}%`);
          if (g.hardy > 0.04) parts.push(`hardiness +${Math.round(g.hardy * 100)}%`);
          sub = (g.gen ? `Generation ${g.gen}` : 'First generation') + (parts.length ? ' · evolved ' + parts.join(', ') : '');
        } else sub = 'None alive';
        if (game.eco.oxygen < s.o2Min) sub += ' · not enough oxygen!';
      } else sub = 'plants';
      const series = h.pops[id] || [];
      const prev = series.length > 6 ? series[series.length - 7] : series[0] || 0;
      const trend = n > prev * 1.08 + 1 ? ['trend-up', '▲'] : n < prev * 0.92 - 1 ? ['trend-down', '▼'] : ['trend-flat', '•'];
      rows.push(el('div.card.pop-row', {}, [
        el('div.thumb', {}, thumbEl(id, icon(s.icon))),
        el('div.grow', {}, [el('div', { style: { fontWeight: 800 } }, s.name), el('div.small.dim', {}, sub)]),
        el('span', { class: trend[0], style: { fontSize: '12px' } }, trend[1]),
        el('div.n', {}, fmt(n)),
      ]));
    }
    return [
      el('div.chart-wrap', {}, canvas), legend,
      el('div.section-title', {}, 'Species'),
      rows.length ? el('div.list', {}, rows) : el('div.empty', {}, 'No life yet. Dive for DNA and research Sea Algae.'),
    ];
  };
  const toggle = (k) => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); render(); };
  const drawChart = () => {
    if (!canvas || !canvas.isConnected) return;
    const eco = game.eco, h = eco.history;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const c = canvas.getContext('2d'); c.scale(dpr, dpr);
    c.clearRect(0, 0, W, H);
    const n = h.t.length;
    if (n < 2) { c.fillStyle = '#6d81a0'; c.font = '600 13px system-ui'; c.textAlign = 'center'; c.fillText('History will appear as days pass', W / 2, H / 2); return; }
    const pad = { l: 8, r: 8, t: 12, b: 18 };
    const x = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
    c.strokeStyle = 'rgba(160,200,255,.08)'; c.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const yy = pad.t + (H - pad.t - pad.b) * k / 4; c.beginPath(); c.moveTo(pad.l, yy); c.lineTo(W - pad.r, yy); c.stroke(); }
    c.fillStyle = '#6d81a0'; c.font = '600 10px system-ui'; c.textAlign = 'left';
    c.fillText('Day ' + Math.floor(h.t[0] + 1), pad.l, H - 5); c.textAlign = 'right'; c.fillText('Day ' + Math.floor(h.t[n - 1] + 1), W - pad.r, H - 5);
    const line = (arr, color, max, width = 2) => {
      c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.beginPath();
      for (let i = 0; i < n; i++) { const v = arr[i] || 0; const yy = H - pad.b - (v / max) * (H - pad.t - pad.b); i ? c.lineTo(x(i), yy) : c.moveTo(x(i), yy); }
      c.stroke();
    };
    let maxA = 10;
    for (const [k, arr] of Object.entries(h.pops)) if (!hidden.has(k) && (ANIMAL[k] || PLANT[k]?.layer)) for (const v of arr) maxA = Math.max(maxA, v);
    for (const [k, arr] of Object.entries(h.pops)) if (!hidden.has(k) && (ANIMAL[k] || ['flower', 'bush', 'oak', 'pine', 'palm', 'fern', 'cactus', 'mushroom'].includes(k))) line(arr, colors[k] || '#fff', maxA * 1.1, ANIMAL[k] ? 2 : 1.2);
    if (!hidden.has('o2')) { c.setLineDash([4, 3]); line(h.o2, '#6fe3ff', 22, 1.5); c.setLineDash([]); }
  };
  const codexTab = () => {
    const out = [];
    const st = game.state;
    out.push(el('div.section-title', {}, 'Planet species'));
    const g1 = el('div.codex-grid');
    for (const s of [...PLANTS, ...ANIMALS]) {
      const known = !!st.research[s.id];
      g1.appendChild(el('div.codex-item', { class: known ? '' : 'unknown', onclick: () => { audio.sfx('click'); if (known) dialog({ title: s.name, text: s.desc, body: el('div.center', {}, el('div.thumb', { style: { width: '120px', height: '120px', margin: '0 auto' } }, thumbEl(s.id))) }); } }, [el('div.thumb', {}, thumbEl(s.id, icon(s.icon))), known ? s.name : '???']));
    }
    out.push(g1);
    const M = game.Microbe;
    if (M && M.MICROBE_SPECIES) {
      out.push(el('div.section-title', {}, `Microbes · ${Object.keys(st.codex.microbes).length}/${M.MICROBE_SPECIES.length}`));
      const g2 = el('div.codex-grid');
      for (const m of M.MICROBE_SPECIES) {
        const known = !!st.codex.microbes[m.id];
        let p = null; try { p = fitCanvas(M.portrait('microbe', m.id, 112)); } catch (e) {}
        g2.appendChild(el('div.codex-item', { class: known ? '' : 'unknown', onclick: () => { audio.sfx('click'); if (known) dialog({ title: m.name, text: m.desc }); } }, [el('div.thumb', {}, p || icon('microbe')), known ? m.name : '???']));
      }
      out.push(g2);
    }
    if (M && M.MUTATIONS) {
      out.push(el('div.section-title', {}, `Mutations · ${Object.keys(st.codex.mutations).length}/${M.MUTATIONS.length}`));
      const g3 = el('div.codex-grid');
      for (const m of M.MUTATIONS) {
        const known = !!st.codex.mutations[m.id];
        let p = null; try { p = fitCanvas(M.portrait('mutation', m.id, 112)); } catch (e) {}
        g3.appendChild(el('div.codex-item', { class: known ? '' : 'unknown', onclick: () => { audio.sfx('click'); if (known) dialog({ title: m.name, text: m.desc }); } }, [el('div.thumb', {}, p || icon('dna')), known ? m.name : '???']));
      }
      out.push(g3);
    }
    return out;
  };
  const statsTab = () => {
    const st = game.state, T = st.totals, eco = game.eco;
    const stat = (v, k) => el('div.stat', {}, [el('div.v', {}, v), el('div.k', {}, k)]);
    const born = Object.values(eco.stats.born).reduce((a, b) => a + b, 0);
    return [
      el('div.stat-grid', {}, [
        stat(`Day ${Math.floor(eco.day) + 1}`, 'World age'),
        stat(eco.oxygen.toFixed(1) + '%', 'Oxygen'),
        stat(fmt(T.dnaEarned), 'DNA earned'),
        stat(fmt(T.bloomEarned), 'Bloom earned'),
        stat(fmt(T.runs), 'Dives'),
        stat(fmt(T.runWins), 'Dives won'),
        stat(String(T.bestDepth || 0), 'Deepest depth'),
        stat(fmt(T.bossKills), 'Bosses defeated'),
        stat(fmt(born), 'Animals born'),
        stat(fmt(eco.stats.pollinations), 'Pollinations'),
        stat(String(eco.thriving().n), 'Thriving species'),
        stat(duration(T.playTimeSec), 'Time played'),
        stat(String(st.worldNumber), 'World number'),
        stat(fmt(T.extinctions), 'Extinctions'),
      ]),
    ];
  };
  render();
  return sh;
}

// ------------------------------------------------------------------ goals
export function openGoals(game) {
  const st = game.state;
  const g = game.goalCtx();
  const act = activeGoals(st, 3);
  const done = MILESTONES.filter((m) => st.milestones[m.id]);
  const rew = (r) => [r.dna ? el('span.tag.dna', {}, [icon('dna', 'sm'), '+' + r.dna]) : null, r.bloom ? el('span.tag.bloom', {}, [icon('bloom', 'sm'), '+' + r.bloom]) : null];
  const body = [
    el('div.section-title', {}, 'Current goals'),
    act.length ? el('div.list', {}, act.map((m) => {
      const p = Math.max(0, Math.min(1, m.check(g)));
      return el('div.card', {}, [
        el('div.row.between', {}, [el('div', { style: { fontWeight: 800 } }, m.title), el('div.row', { style: { gap: '4px' } }, rew(m.reward))]),
        el('div.small.dim', { style: { margin: '4px 0 8px' } }, m.desc),
        el('div.bar', {}, el('i', { style: { width: p * 100 + '%' } })),
      ]);
    })) : el('div.empty', {}, 'All goals for this era are complete. Raise oxygen to reach the next era.'),
    el('div.section-title', {}, `Completed · ${done.length}/${MILESTONES.length}`),
    el('div.list', {}, done.slice().reverse().map((m) => el('div.row', { style: { fontSize: '13px', color: 'var(--text-dim)' } }, [el('span', { style: { color: 'var(--good)', display: 'inline-flex' }, html: icon('check', 'sm') }), m.title]))),
  ];
  return sheet({ title: 'Goals', body });
}

// ------------------------------------------------------------------ eras
export function openEraInfo(game) {
  const st = game.state;
  const items = [];
  for (let e = 1; e <= 6; e++) {
    const E = ERAS[e];
    const cur = e === st.era, past = e < st.era;
    const unlocks = [...PLANTS, ...ANIMALS].filter((s) => s.era === e).map((s) => s.name).join(', ');
    items.push(el('div.card', { style: { borderColor: cur ? E.color : '', boxShadow: cur ? `0 0 0 1px ${E.color} inset` : '' } }, [
      el('div.row.between', {}, [el('div', { style: { fontWeight: 850, color: E.color } }, `Era ${roman(e)} · ${E.name}`), el('span.tag', {}, past ? 'Reached' : cur ? 'Now' : `${E.o2}% O₂`)]),
      el('div.small.dim', { style: { marginTop: '4px' } }, E.blurb),
      unlocks ? el('div.small', { style: { marginTop: '6px', color: 'var(--text-dim)' } }, ['Unlocks: ', el('span', { style: { color: 'var(--text)' } }, unlocks)]) : null,
    ]));
  }
  const o2 = game.eco.oxygen;
  return sheet({ title: 'Oxygen & Eras', body: [
    el('p.dim', { style: { margin: '0 0 12px', fontSize: '14px' } }, `Your atmosphere is ${o2.toFixed(1)}% oxygen. Algae and plants release oxygen; animals breathe it. Each new era unlocks more life. Animals need enough oxygen to survive.`),
    el('div.list', {}, items),
  ] });
}

// ------------------------------------------------------------------ menu
export function openMenu(game) {
  const st = game.state, s = st.settings;
  const row = (ic, label, sub, control) => el('div.row', { style: { padding: '10px 2px', borderBottom: '1px solid var(--line)' } }, [el('span', { style: { color: 'var(--text-dim)', display: 'inline-flex' }, html: icon(ic) }), el('div.grow', {}, [el('div', { style: { fontWeight: 700 } }, label), sub ? el('div.small.dim', {}, sub) : null]), control]);
  const toggle = (key, after) => {
    const t = el('button.toggle', { class: s[key] ? 'on' : '', onclick: () => { s[key] = !s[key]; t.classList.toggle('on', s[key]); audio.sfx('tick'); after && after(s[key]); store.save(); } });
    return t;
  };
  const body = [
    el('div.section-title', {}, 'Settings'),
    row('sound', 'Sound effects', null, toggle('sfx', (v) => audio.setSfx(v))),
    row('music', 'Music', null, toggle('music', (v) => audio.setMusic(v))),
    row('hand', 'Vibration', 'Haptic feedback on supported phones', toggle('haptics', (v) => { window.__tw_haptics = v; })),
    row('bolt', 'Battery saver', 'Lower resolution and frame rate, no shadows', toggle('battery', () => game.applyQuality())),
    row('sun', 'Shadows', 'Prettier, but uses more battery', toggle('shadows', () => game.applyQuality())),
    el('div.section-title', {}, 'Help'),
    el('div.list', {}, [
      el('button.btn.btn-block', { onclick: () => howToPlay() }, [icon('book'), 'How to play']),
      el('button.btn.btn-block', { onclick: () => offlineHelp() }, [icon('globe'), 'Playing offline']),
      el('button.btn.btn-block', { onclick: () => import('./changelog.js').then((m) => whatsNew(m.CHANGELOG, BUILD)) }, [icon('star'), 'What\u2019s new']),
    ]),
    el('div.section-title', {}, 'Save data'),
    el('div.list', {}, [
      el('button.btn.btn-block', { onclick: () => backup(game) }, [icon('shield'), 'Back up or restore save']),
      el('button.btn.btn-block.btn-danger', { onclick: async () => {
        if (await confirm('Start a new world?', 'Your current planet will be replaced with a brand new one. Genome upgrades, codex and settings are kept.', 'New world', 'btn-danger')) game.newWorld(false);
      } }, [icon('refresh'), 'Start a new world']),
    ]),
    el('div.small.faint.center', { style: { marginTop: '18px' } }, `Tiny World · Build ${BUILD} (${BUILD_TIME}) · World #${st.worldNumber}`),
  ];
  return sheet({ title: 'Menu', body });
}

export function howToPlay() {
  const p = (t) => el('p', { style: { margin: '0 0 10px', fontSize: '14px', color: 'var(--text-dim)' }, html: t });
  return sheet({ title: 'How to play', body: [
    p('<b style="color:var(--text)">Your goal:</b> turn a lifeless rock into a thriving living world, then grow the legendary <b style="color:var(--leaf)">World Tree</b>.'),
    p('<b style="color:var(--dna)">Dive</b> into the ocean as a microbe. Drag anywhere to swim, eat smaller things, avoid bigger ones, and pick a mutation each time you level up. Every dive earns <b style="color:var(--dna)">DNA</b>.'),
    p('Spend DNA in <b style="color:var(--text)">Research</b> to unlock species. Algae first: they breathe oxygen into the sky.'),
    p('<b style="color:var(--o2)">Oxygen</b> drives the eras. Each era unlocks new plants and animals, and animals need enough oxygen to breathe.'),
    p('Plants produce <b style="color:var(--bloom)">Bloom</b>, which you spend to plant more life and release animals. When planting, tiles turn <b style="color:var(--good)">green</b> where the species will thrive.'),
    p('Keep it balanced: grazers need plants, predators need grazers, pollinators help flowers spread, decomposers make soil. Overgrazing, droughts, blights and meteors will test you.'),
    p('Animals inherit traits and <b style="color:var(--text)">evolve</b> on their own. You can also buy adaptations in Research → Evolve, and permanent microbe upgrades in Research → Genome.'),
    p('Controls: drag to spin the planet, pinch to zoom, double-tap to fly in, tap things to inspect them.'),
  ] });
}

export function offlineHelp() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const p = (t) => el('p', { style: { margin: '0 0 10px', fontSize: '14px', color: 'var(--text-dim)' }, html: t });
  return sheet({ title: 'Playing offline', body: [
    p(standalone ? '<b style="color:var(--good)">You are running the installed app.</b> Everything is stored on this device, so it works with no connection.' : 'Tiny World works fully offline once it has been opened online one time.'),
    p('<b style="color:var(--text)">iPhone / iPad (Safari):</b> tap the Share button, then <b style="color:var(--text)">Add to Home Screen</b>. Open it from the Home Screen icon once while online.'),
    p('<b style="color:var(--text)">Android (Chrome):</b> tap the ⋮ menu, then <b style="color:var(--text)">Install app</b> or <b style="color:var(--text)">Add to Home screen</b>.'),
    p('Your progress is saved automatically on this device. Use Menu → Back up to copy your save if you switch browsers.'),
    p(`Offline cache: <b style="color:var(--text)" id="sw-status">${navigator.serviceWorker?.controller ? 'ready ✓' : 'not ready yet. Reload once while online.'}</b>`),
  ] });
}

function backup(game) {
  const ta = el('textarea', { style: { width: '100%', height: '120px', borderRadius: '12px', background: 'rgba(0,0,0,.3)', color: 'var(--text)', border: '1px solid var(--line)', padding: '10px', fontSize: '11px', fontFamily: 'monospace' } });
  game.save();
  ta.value = store.export();
  dialog({
    title: 'Back up save',
    text: 'Copy this code somewhere safe. Paste a code here and tap Restore to load it.',
    body: ta,
    buttons: [
      { label: 'Copy', cls: 'btn-primary', onClick: () => { ta.select(); try { navigator.clipboard.writeText(ta.value); toast('Copied save code', { icon: 'check' }); } catch (e) { document.execCommand('copy'); } return false; } },
      { label: 'Restore from code', cls: 'btn-danger', onClick: () => { try { store.import(ta.value); location.reload(); } catch (e) { toast('That code did not work.', { icon: 'info', kind: 'bad' }); } return false; } },
      { label: 'Close', cls: 'btn-ghost' },
    ],
  });
}

// ------------------------------------------------------------------ big moments
export function eraUpDialog(game, era) {
  const E = ERAS[era];
  const unlocks = [...PLANTS, ...ANIMALS].filter((s) => s.era === era);
  audio.sfx('milestone'); haptic([20, 40, 20]);
  return dialog({
    dismissable: false,
    body: el('div.center', {}, [
      el('div.era-num', { style: { color: E.color } }, `Era ${roman(era)}`),
      el('div.era-name', {}, E.name),
      el('p.dim', { style: { margin: 0 } }, E.blurb),
      unlocks.length ? el('div.unlock-list', {}, unlocks.map((s) => el('div.u', {}, [el('div.thumb', {}, thumbEl(s.id, icon(s.icon))), s.name]))) : null,
      unlocks.length ? el('div.small.faint', { style: { marginTop: '8px' } }, 'Now available in Research') : null,
    ]),
    buttons: [{ label: 'Onward', cls: 'btn-primary btn-lg' }],
  });
}

export function endingDialog(game) {
  const st = game.state, eco = game.eco;
  audio.sfx('victory'); haptic([30, 60, 30, 60, 30]);
  const stat = (v, k) => el('div.stat', {}, [el('div.v', {}, v), el('div.k', {}, k)]);
  return dialog({
    dismissable: false,
    body: el('div', {}, [
      el('div.era-num.center', { style: { color: 'var(--leaf)' } }, `World #${st.worldNumber}`),
      el('div.ending-title', {}, 'Your world is alive'),
      el('p.dim.center', { style: { margin: '0 0 14px' } }, 'From a dark rock and a single cell to a breathing, balanced biosphere. The World Tree has reached the sky.'),
      el('div.stat-grid', {}, [stat(`Day ${Math.floor(eco.day) + 1}`, 'World age'), stat(eco.oxygen.toFixed(1) + '%', 'Oxygen'), stat(String(eco.thriving().n), 'Thriving species'), stat(fmt(st.totals.runs), 'Dives')]),
      el('p.small.dim.center', { style: { margin: '14px 0 0' } }, 'Seed a new world to start again on a new planet, keeping your genome and earning a permanent +25% DNA and Bloom bonus. Or stay and keep tending this one.'),
    ]),
    buttons: [
      { label: 'Seed a new world', cls: 'btn-primary btn-lg', icon: 'star', onClick: () => { game.newWorld(true); } },
      { label: 'Keep playing here', cls: 'btn-ghost' },
    ],
  });
}

export function awayDialog(summary) {
  const rows = [];
  for (const [k, v] of summary.rows) rows.push(el('span.dim', {}, k), el('b', {}, v));
  return dialog({
    title: 'While you were away',
    text: `${summary.days} day${summary.days === 1 ? '' : 's'} passed on your world.`,
    body: el('div.away-list', {}, rows),
    buttons: [{ label: 'Continue', cls: 'btn-primary' }],
  });
}

// portraits come with a fixed CSS size; make them fill their thumbnail box
function fitCanvas(c) { if (c && c.style) { c.style.width = '100%'; c.style.height = '100%'; } return c; }

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export function whatsNew(log, current) {
  audio.sfx('click');
  const body = log.map((e) => el('div.card', { style: { marginBottom: '10px', borderColor: e.build === current ? 'var(--leaf)' : '' } }, [
    el('div.row.between', {}, [el('div', { style: { fontWeight: 850 } }, e.title), el('span.tag', { class: e.build === current ? 'good' : '' }, e.build === current ? `Build ${e.build} \u00b7 you have this` : `Build ${e.build}`)]),
    el('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', color: 'var(--text-dim)', fontSize: '13.5px' } }, e.notes.map((n) => el('li', { style: { marginTop: '3px' } }, n))),
  ]));
  return sheet({ title: 'What\u2019s new', body });
}
