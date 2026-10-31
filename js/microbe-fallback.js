// Minimal fallback dive used only if js/microbe/index.js fails to load: a 40-second swim where you
// steer a cell into glowing motes. Same API as the full microbe module.
import { el, icon } from './ui.js';
import { audio } from './audio.js';

export const MICROBE_SPECIES = [];
export const MUTATIONS = [];
export const GENOME_UPGRADES = [
  { id: 'harvest', name: 'DNA Harvest', desc: 'More DNA from every dive.', maxLevel: 5, cost: (l) => [15, 35, 70, 120, 200][l], effect: (l) => `+${l * 10}% DNA` },
];
export function portrait(kind, id, size = 96) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size * 0.4, size * 0.4, 2, size / 2, size / 2, size * 0.4);
  g.addColorStop(0, '#d9c4ff'); g.addColorStop(1, '#6b3fd6');
  x.fillStyle = g; x.beginPath(); x.arc(size / 2, size / 2, size * 0.36, 0, 7); x.fill();
  return c;
}

export function startMicrobeRun({ host, genome = {}, dnaMult = 1, onExit }) {
  const cv = el('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' } });
  const hud = el('div', { style: { position: 'absolute', left: '16px', right: '16px', top: 'calc(var(--sat) + 14px)', display: 'flex', justifyContent: 'space-between', fontWeight: 800 } });
  host.append(cv, hud);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = Math.min(2, devicePixelRatio || 1);
  const resize = () => { W = host.clientWidth; H = host.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize(); addEventListener('resize', resize);
  const p = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 14 };
  let tx = null, ty = null, motes = [], eaten = 0, t = 0, done = false, raf;
  const DUR = 40;
  const spawn = () => motes.push({ x: Math.random() * W, y: Math.random() * H, r: 4 + Math.random() * 4, ph: Math.random() * 6 });
  for (let i = 0; i < 30; i++) spawn();
  const down = (e) => { tx = e.clientX; ty = e.clientY; };
  const up = () => { tx = ty = null; };
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', (e) => { if (tx != null) { tx = e.clientX; ty = e.clientY; } }); addEventListener('pointerup', up);
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (tx != null) { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.vx += dx / d * 600 * dt; p.vy += dy / d * 600 * dt; }
    p.vx *= Math.pow(0.15, dt); p.vy *= Math.pow(0.15, dt); p.x = Math.max(0, Math.min(W, p.x + p.vx * dt)); p.y = Math.max(0, Math.min(H, p.y + p.vy * dt));
    for (let i = motes.length - 1; i >= 0; i--) { const m = motes[i]; if (Math.hypot(m.x - p.x, m.y - p.y) < p.r + m.r) { motes.splice(i, 1); eaten++; p.r = Math.min(40, p.r + 0.3); audio.sfx('eat', { pitch: eaten % 8 }); spawn(); } }
    const g = ctx.createRadialGradient(W / 2, H / 3, 10, W / 2, H / 2, H);
    g.addColorStop(0, '#123a5a'); g.addColorStop(1, '#03091a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const m of motes) { ctx.fillStyle = `rgba(160,255,210,${0.6 + 0.4 * Math.sin(t * 3 + m.ph)})`; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fill(); }
    const pg = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, p.r); pg.addColorStop(0, '#e6d6ff'); pg.addColorStop(1, '#7a48e6');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + Math.sin(t * 6) * 1.2, 0, 7); ctx.fill();
    hud.innerHTML = `<span>${icon('dna')} ${Math.round(eaten * 0.6 * dnaMult)}</span><span>${Math.max(0, Math.ceil(DUR - t))}s</span>`;
    if (t >= DUR && !done) { done = true; finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const finish = () => {
    const dna = Math.round(eaten * 0.6 * dnaMult * (1 + (genome.harvest || 0) * 0.1));
    host.appendChild(el('div.backdrop.center', {}, el('div.dialog.center', {}, [el('h2', {}, 'Surfacing'), el('p.dim', {}, `You gathered ${dna} DNA.`), el('button.btn.btn-primary.btn-block', { onclick: () => onExit({ dna, biomass: eaten, depth: 1, level: 1, victory: false, bossKills: 0, kills: 0, timeSec: DUR, mutations: [], discovered: { microbes: [], mutations: [] }, abandoned: false }) }, 'Return to planet')])));
  };
  return { destroy() { cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('pointerup', up); host.innerHTML = ''; }, pause() {}, resume() {} };
}
