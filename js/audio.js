// Procedural audio: generative ambient music + synthesized sound effects (WebAudio, no files).

let ctx = null, master = null, sfxBus = null, musicBus = null, reverb = null;
let sfxOn = true, musicOn = true;
let musicMode = null, musicTimer = null, droneNodes = [];
let hidden = false, suspendTimer = null;
const lastPlayed = {};

export const audio = {
  get ready() { return !!ctx; },

  init() {
    if (ctx) { if (ctx.state === 'suspended' && !document.hidden) this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    comp.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.7 : 0; sfxBus.connect(comp);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.32 : 0; musicBus.connect(comp);
    reverb = makeReverb(2.8);
    const rvGain = ctx.createGain(); rvGain.gain.value = 0.55;
    reverb.connect(rvGain); rvGain.connect(comp);
    if (musicMode) { const m = musicMode; musicMode = null; this.music(m); }
  },

  // Going to the background: silence instantly, stop the music sequencer, then suspend.
  // Suspending while sound is still playing makes iOS repeat the last audio buffer as a harsh buzz.
  suspend() {
    if (!ctx) return;
    hidden = true;
    try { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0, ctx.currentTime); } catch (e) {}
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    for (const n of droneNodes.slice(1)) { try { n.stop(); } catch (e) {} }
    droneNodes = [];
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => { if (hidden && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 150);
  },
  resume() {
    if (!ctx) return;
    const wasHidden = hidden;
    hidden = false;
    clearTimeout(suspendTimer);
    const go = () => {
      if (!wasHidden) return;
      try { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0, ctx.currentTime); master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.6); } catch (e) {}
      if (musicMode && !musicTimer) startMusic(musicMode);
    };
    if (ctx.state === 'suspended') ctx.resume().then(go).catch(() => {}); else go();
  },

  setSfx(on) { sfxOn = on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.05); },
  setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.32 : 0, ctx.currentTime, 0.3); },

  // name: string; opts: { pitch, vol, pan }
  sfx(name, opts = {}) {
    if (!ctx || !sfxOn || hidden) return;
    const now = ctx.currentTime;
    // rate-limit spammy sounds
    const minGap = { eat: 0.035, hurt: 0.08, pop: 0.03, tick: 0.03, bubble: 0.05, hit: 0.04, chirp: 0.06 }[name] || 0;
    if (minGap && lastPlayed[name] && now - lastPlayed[name] < minGap) return;
    lastPlayed[name] = now;
    const f = SFX[name];
    if (f) try { f(now, opts); } catch (e) { /* ignore */ }
  },

  // mode: 'planet' | 'microbe' | 'title' | null
  music(mode) {
    if (mode === musicMode) return;
    musicMode = mode;
    if (!ctx) return;
    stopMusic();
    if (mode) startMusic(mode);
  },
};

// ---------- helpers ----------
function makeReverb(seconds) {
  const conv = ctx.createConvolver();
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  conv.buffer = buf;
  return conv;
}

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
}

function out(opts, wet = 0.25) {
  // returns a node to connect a voice into (with pan + reverb send)
  const g = ctx.createGain(); g.gain.value = opts.vol ?? 1;
  let node = g;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan || 0));
    g.connect(p); node = p;
  }
  node.connect(sfxBus);
  if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(reverb); }
  return g;
}

function tone(t, { type = 'sine', f0 = 440, f1 = null, dur = 0.15, a = 0.005, vol = 0.3, dest, q = 0, filt = null }) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o;
  if (filt) { const f = ctx.createBiquadFilter(); f.type = filt.type || 'lowpass'; f.frequency.value = filt.f; f.Q.value = q || 0.7; o.connect(f); n = f; }
  n.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}

function noiseHit(t, { dur = 0.2, vol = 0.3, f = 1200, f1 = null, type = 'bandpass', q = 1, dest }) {
  const s = noise();
  const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
  if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(flt); flt.connect(g); g.connect(dest);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- sound effects ----------
const SFX = {
  eat(t, o) {
    const p = o.pitch || 0; // combo index
    const n = 72 + PENTA[Math.min(PENTA.length - 1, p % PENTA.length)];
    tone(t, { type: 'sine', f0: midi(n), f1: midi(n + 5), dur: 0.12, vol: 0.18, dest: out(o, 0.3) });
  },
  bubble(t, o) {
    const f = 300 + Math.random() * 500;
    tone(t, { type: 'sine', f0: f, f1: f * 2.4, dur: 0.09, vol: 0.12, dest: out(o, 0.4) });
  },
  gulp(t, o) {
    const d = out(o, 0.3);
    tone(t, { type: 'triangle', f0: 220, f1: 90, dur: 0.22, vol: 0.35, dest: d });
    tone(t + 0.03, { type: 'sine', f0: 600, f1: 1200, dur: 0.1, vol: 0.12, dest: d });
  },
  hurt(t, o) {
    const d = out(o, 0.1);
    tone(t, { type: 'sawtooth', f0: 180, f1: 60, dur: 0.18, vol: 0.22, dest: d, filt: { f: 900 } });
    noiseHit(t, { dur: 0.12, vol: 0.18, f: 600, dest: d });
  },
  hit(t, o) {
    noiseHit(t, { dur: 0.08, vol: 0.2, f: 2400, q: 2, dest: out(o, 0.15) });
  },
  dash(t, o) {
    noiseHit(t, { dur: 0.28, vol: 0.28, f: 500, f1: 3500, q: 1.5, dest: out(o, 0.2) });
  },
  toxin(t, o) {
    const d = out(o, 0.4);
    noiseHit(t, { dur: 0.5, vol: 0.18, f: 300, f1: 120, type: 'lowpass', dest: d });
    tone(t, { type: 'sine', f0: 140, f1: 70, dur: 0.4, vol: 0.2, dest: d });
  },
  levelup(t, o) {
    const d = out(o, 0.45);
    [0, 4, 7, 12, 16].forEach((s, i) => tone(t + i * 0.06, { type: 'triangle', f0: midi(72 + s), dur: 0.35, vol: 0.16, dest: d }));
  },
  evolve(t, o) {
    const d = out(o, 0.5);
    [0, 7, 12, 19, 24].forEach((s, i) => tone(t + i * 0.05, { type: 'sine', f0: midi(67 + s), dur: 0.6, vol: 0.14, dest: d }));
    noiseHit(t, { dur: 0.6, vol: 0.06, f: 4000, f1: 9000, type: 'highpass', dest: d });
  },
  descend(t, o) {
    const d = out(o, 0.6);
    tone(t, { type: 'sine', f0: 500, f1: 80, dur: 1.2, vol: 0.2, dest: d });
    noiseHit(t, { dur: 1.2, vol: 0.12, f: 1500, f1: 200, type: 'lowpass', dest: d });
  },
  boss(t, o) {
    const d = out(o, 0.5);
    tone(t, { type: 'sawtooth', f0: 70, f1: 45, dur: 1.4, vol: 0.3, dest: d, filt: { f: 400 } });
    tone(t, { type: 'sawtooth', f0: 104, f1: 67, dur: 1.4, vol: 0.18, dest: d, filt: { f: 500 } });
  },
  death(t, o) {
    const d = out(o, 0.5);
    [12, 7, 3, 0, -5].forEach((s, i) => tone(t + i * 0.12, { type: 'triangle', f0: midi(64 + s), dur: 0.4, vol: 0.16, dest: d }));
  },
  victory(t, o) {
    const d = out(o, 0.6);
    const seq = [0, 4, 7, 12, 7, 12, 16, 19, 24];
    seq.forEach((s, i) => tone(t + i * 0.09, { type: 'triangle', f0: midi(67 + s), dur: 0.5, vol: 0.14, dest: d }));
  },
  click(t, o) {
    tone(t, { type: 'sine', f0: 1200, f1: 900, dur: 0.05, vol: 0.08, dest: out(o, 0.05) });
  },
  tick(t, o) {
    tone(t, { type: 'square', f0: 2000, dur: 0.02, vol: 0.03, dest: out(o, 0), filt: { f: 3000 } });
  },
  pop(t, o) {
    const f = 500 + (o.pitch || 0) * 60;
    tone(t, { type: 'sine', f0: f, f1: f * 1.8, dur: 0.08, vol: 0.18, dest: out(o, 0.25) });
  },
  plant(t, o) {
    const d = out(o, 0.4);
    tone(t, { type: 'sine', f0: 330, f1: 660, dur: 0.18, vol: 0.18, dest: d });
    tone(t + 0.08, { type: 'triangle', f0: midi(79), dur: 0.3, vol: 0.08, dest: d });
  },
  chirp(t, o) {
    const d = out(o, 0.3);
    const f = 1800 + Math.random() * 1200;
    tone(t, { type: 'sine', f0: f, f1: f * 1.4, dur: 0.07, vol: 0.08, dest: d });
    tone(t + 0.09, { type: 'sine', f0: f * 1.1, f1: f * 1.6, dur: 0.07, vol: 0.07, dest: d });
  },
  rain(t, o) {
    noiseHit(t, { dur: 1.6, vol: 0.12, f: 3000, q: 0.5, type: 'highpass', dest: out(o, 0.5) });
  },
  milestone(t, o) {
    const d = out(o, 0.6);
    [[60, 64, 67, 71], [65, 69, 72, 76]].forEach((ch, i) => ch.forEach((n) => tone(t + i * 0.22, { type: 'sine', f0: midi(n + 12), dur: 0.9, vol: 0.08, dest: d })));
  },
  event(t, o) {
    const d = out(o, 0.7);
    tone(t, { type: 'sine', f0: 110, f1: 104, dur: 2.2, vol: 0.25, dest: d });
    tone(t, { type: 'sine', f0: 277, f1: 270, dur: 1.6, vol: 0.08, dest: d });
    tone(t, { type: 'sine', f0: 415, f1: 410, dur: 1.2, vol: 0.05, dest: d });
  },
  research(t, o) {
    const d = out(o, 0.5);
    [0, 5, 9, 12, 17].forEach((s, i) => tone(t + i * 0.07, { type: 'sine', f0: midi(65 + s), dur: 0.5, vol: 0.12, dest: d }));
  },
  error(t, o) {
    tone(t, { type: 'square', f0: 200, f1: 160, dur: 0.15, vol: 0.06, dest: out(o, 0), filt: { f: 1200 } });
  },
  coin(t, o) {
    const d = out(o, 0.3);
    tone(t, { type: 'triangle', f0: midi(84), dur: 0.08, vol: 0.1, dest: d });
    tone(t + 0.07, { type: 'triangle', f0: midi(91), dur: 0.2, vol: 0.1, dest: d });
  },
};

// ---------- generative music ----------
const MODES = {
  title:   { root: 50, scale: [0, 2, 4, 7, 9], chords: [[0, 7, 16], [5, 12, 21], [-3, 7, 12], [2, 9, 14]], bpm: 54, bells: 0.5, drone: 'soft' },
  planet:  { root: 53, scale: [0, 2, 4, 6, 7, 9, 11], chords: [[0, 7, 16, 23], [-5, 7, 14], [2, 9, 18], [-3, 4, 12, 19]], bpm: 60, bells: 0.45, drone: 'soft' },
  microbe: { root: 45, scale: [0, 3, 5, 7, 10], chords: [[0, 7, 15], [-2, 5, 14], [-4, 3, 12], [-5, 2, 10]], bpm: 72, bells: 0.6, drone: 'deep' },
};

function startMusic(mode) {
  const M = MODES[mode]; if (!M) return;
  const beat = 60 / M.bpm;
  let step = 0;
  let next = ctx.currentTime + 0.1;
  // drone
  const dg = ctx.createGain(); dg.gain.value = 0; dg.connect(musicBus);
  const dsend = ctx.createGain(); dsend.gain.value = 0.6; dg.connect(dsend); dsend.connect(reverb);
  const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = M.drone === 'deep' ? 260 : 420; df.connect(dg);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(df.frequency); lfo.start();
  const oscs = [0, 7, 12].map((s, i) => {
    const o = ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'sine';
    o.frequency.value = midi(M.root - 12 + s); o.detune.value = (i - 1) * 6; o.connect(df); o.start(); return o;
  });
  dg.gain.setTargetAtTime(0.22, ctx.currentTime, 2.5);
  droneNodes = [dg, lfo, ...oscs];

  const schedule = () => {
    if (hidden) return;
    if (next < ctx.currentTime - 0.2) next = ctx.currentTime + 0.05; // timers were throttled: skip, don't burst
    while (next < ctx.currentTime + 0.6) {
      const bar = Math.floor(step / 8) % M.chords.length;
      const chord = M.chords[bar];
      if (step % 8 === 0) {
        // pad chord
        chord.forEach((s) => pad(next, midi(M.root + s), beat * 8.5, 0.05));
      }
      // bells
      if (Math.random() < M.bells * (step % 2 === 0 ? 0.6 : 0.3)) {
        const deg = M.scale[Math.floor(Math.random() * M.scale.length)];
        const oct = Math.random() < 0.5 ? 24 : 12;
        bell(next + (Math.random() < 0.3 ? beat * 0.5 : 0), midi(M.root + oct + deg), mode === 'microbe' ? 0.035 : 0.045);
      }
      if (mode === 'microbe' && step % 4 === 2 && Math.random() < 0.5) {
        const o = { vol: 0.5 };
        const f = 200 + Math.random() * 400;
        const g = ctx.createGain(); g.gain.value = 0.05; g.connect(musicBus);
        tone(next, { type: 'sine', f0: f, f1: f * 2.2, dur: 0.08, vol: 0.4, dest: g });
      }
      step++;
      next += beat / 2;
    }
  };
  schedule();
  musicTimer = setInterval(schedule, 200);
}

function pad(t, f, dur, vol) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 900;
  flt.connect(g);
  g.connect(musicBus);
  const s = ctx.createGain(); s.gain.value = 0.8; g.connect(s); s.connect(reverb);
  for (const det of [-7, 7]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    o.connect(flt); o.start(t); o.stop(t + dur + 0.1);
  }
}

function bell(t, f, vol) {
  const g = ctx.createGain(); g.connect(musicBus);
  const s = ctx.createGain(); s.gain.value = 1.2; g.connect(s); s.connect(reverb);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g);
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.76;
  const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(g);
  o.start(t); o.stop(t + 2.3); o2.start(t); o2.stop(t + 2.3);
}

function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  const t = ctx.currentTime;
  const [dg, ...rest] = droneNodes;
  if (dg) {
    dg.gain.setTargetAtTime(0, t, 0.6);
    setTimeout(() => { rest.forEach((n) => { try { n.stop(); } catch (e) {} }); try { dg.disconnect(); } catch (e) {} }, 3000);
  }
  droneNodes = [];
}

export function haptic(pattern = 10) {
  try { if (window.__tw_haptics !== false && navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}
