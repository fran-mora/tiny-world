// Microbe mode — injected microbe-specific CSS (all classes prefixed mb-). Uses the shared design tokens.
const CSS = `
.mb-root { position: absolute; inset: 0; overflow: hidden; background: #03101a; touch-action: none; font-family: var(--font); color: var(--text); }
.mb-root canvas.mb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
.mb-hud { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
.mb-hud > * { pointer-events: none; }
.mb-hud .mb-tap { pointer-events: auto; }
.mb-top { position: absolute; left: calc(10px + var(--sal)); right: calc(10px + var(--sar)); top: calc(8px + var(--sat)); display: flex; flex-direction: column; gap: 6px; }
.mb-row { display: flex; align-items: center; gap: 8px; }
.mb-stat { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 10px 0 8px; border-radius: 999px;
  background: rgba(6, 18, 34, .62); border: 1px solid var(--line); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.mb-stat .bar { flex: 1; height: 9px; }
.mb-stat .bar > i { transition: width .18s ease-out; }
.mb-stat .num { font-weight: 800; font-size: 13px; min-width: 26px; text-align: right; }
.mb-stat svg.ic { width: 17px; height: 17px; }
.mb-hp svg.ic { color: #ff8a9a; fill: rgba(255, 110, 130, .35); }
.mb-hp.low { animation: mbLow .7s ease-in-out infinite; }
@keyframes mbLow { 50% { border-color: rgba(255, 107, 125, .8); box-shadow: 0 0 14px rgba(255, 80, 100, .45); } }
.mb-lv { font-weight: 900; font-size: 12px; letter-spacing: .02em; color: #04261a; background: linear-gradient(180deg, #8cf5d0, #3fcfa0);
  border-radius: 999px; padding: 2px 7px; min-width: 38px; text-align: center; font-variant-numeric: tabular-nums; }
.mb-dna { flex: none; height: 34px; color: var(--dna); }
.mb-dna svg.ic { color: var(--dna); }
.mb-pause { pointer-events: auto; width: 40px; height: 40px; border-radius: 13px; flex: none; }
.mb-depth { align-self: center; display: flex; flex-direction: column; align-items: center; gap: 4px; width: min(78%, 300px); margin-top: 1px; }
.mb-depth-label { font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--text-dim);
  text-shadow: 0 1px 6px rgba(0,0,0,.6); white-space: nowrap; }
.mb-depth-label b { color: var(--text); }
.mb-depth .bar { width: 100%; height: 5px; background: rgba(255,255,255,.1); }
.mb-depth .bar > i { background: linear-gradient(90deg, rgba(111,227,255,.6), #bff4ff); transition: width .4s linear; }
.mb-depth.boss .bar { height: 9px; border: 1px solid rgba(255,107,125,.4); }
.mb-depth.boss .bar > i { background: linear-gradient(90deg, #ff5d7a, #ffb36b); transition: width .15s ease-out; }
.mb-depth.boss .mb-depth-label { color: #ffb0ba; }
.mb-pips { display: flex; gap: 4px; }
.mb-pips i { width: 14px; height: 4px; border-radius: 9px; background: rgba(255,255,255,.16); }
.mb-pips i.on { background: #bff4ff; box-shadow: 0 0 6px rgba(150,240,255,.6); }
.mb-pips i.cur { background: #fff; }
.mb-pips i.boss { width: 6px; background: rgba(255,107,125,.45); }
.mb-pips i.boss.on { background: #ff7d90; }

/* abilities */
.mb-abilities { position: absolute; right: calc(16px + var(--sar)); bottom: calc(22px + var(--sab)); display: flex; flex-direction: column-reverse; align-items: center; gap: 14px; }
.mb-ab { pointer-events: auto; position: relative; width: 78px; height: 78px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  background: rgba(8, 22, 40, .55); display: grid; place-items: center; touch-action: none; transition: transform .08s ease; }
.mb-ab.small { width: 64px; height: 64px; }
.mb-ab:active { transform: scale(.92); }
.mb-ab .mb-ring { position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(var(--ring-c, #8cf5d0) calc(var(--p, 1) * 360deg), rgba(255,255,255,.1) 0);
  -webkit-mask: radial-gradient(circle, transparent 62%, #000 63%); mask: radial-gradient(circle, transparent 62%, #000 63%); }
.mb-ab canvas { width: 70%; height: 70%; position: relative; pointer-events: none; }
.mb-ab.cool canvas { opacity: .45; filter: saturate(.4); }
.mb-ab.ready { box-shadow: 0 0 22px rgba(140, 245, 208, .45); }
.mb-ab.ready.nova { box-shadow: 0 0 22px rgba(199, 156, 255, .55); }
.mb-ab.flash { animation: mbAbFlash .4s ease; }
@keyframes mbAbFlash { 0% { transform: scale(1); } 40% { transform: scale(1.14); } 100% { transform: scale(1); } }
.mb-ab .mb-key { position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 800; color: var(--text-dim);
  background: rgba(6,18,34,.8); border-radius: 6px; padding: 0 5px; letter-spacing: .05em; }

/* toasts / banners */
.mb-toasts { position: absolute; left: 0; right: 0; top: calc(var(--sat) + 116px); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 8; pointer-events: none; }
.mb-toasts .toast { padding: 7px 14px 7px 8px; font-size: 13.5px; }
.mb-toasts .toast canvas { width: 40px; height: 40px; flex: none; }
.mb-toasts .toast .mb-tt { display: flex; flex-direction: column; line-height: 1.2; }
.mb-toasts .toast .mb-tt small { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--text-dim); }
.mb-toasts .toast.dna small { color: var(--dna); }
.mb-banner { position: absolute; left: 0; right: 0; top: 34%; text-align: center; z-index: 7; pointer-events: none; animation: mbBanner 2.8s ease forwards; }
.mb-banner h1 { font-size: 30px; font-weight: 900; letter-spacing: -.01em; text-shadow: 0 2px 20px rgba(0,0,0,.6), 0 0 30px rgba(140,240,255,.35); }
.mb-banner .mb-kicker { font-size: 12px; font-weight: 800; letter-spacing: .24em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 4px; }
.mb-banner.danger h1 { color: #ffb0ba; text-shadow: 0 2px 20px rgba(0,0,0,.6), 0 0 30px rgba(255,90,110,.55); }
.mb-banner.gold h1 { color: #ffe7a8; text-shadow: 0 2px 20px rgba(0,0,0,.6), 0 0 30px rgba(255,207,110,.6); }
@keyframes mbBanner { 0% { opacity: 0; transform: translateY(12px) scale(.96); } 12% { opacity: 1; transform: none; } 78% { opacity: 1; } 100% { opacity: 0; transform: translateY(-8px); } }

/* hints */
.mb-hint { position: absolute; left: 50%; bottom: calc(150px + var(--sab)); transform: translateX(-50%); z-index: 9; max-width: min(300px, calc(100% - 40px));
  padding: 11px 15px; border-radius: 16px; background: #f4fbff; color: #0b1a30; font-weight: 700; font-size: 14.5px; text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,.45); animation: pop .3s cubic-bezier(.2,.9,.3,1.25); display: flex; align-items: center; gap: 10px; pointer-events: none; }
.mb-hint svg.ic { color: #1d8a6a; flex: none; }
.mb-hint.out { animation: fadeOut .3s ease forwards; }
.mb-hint.warn svg.ic { color: #d6304a; }
.mb-hand { position: absolute; left: 50%; top: 58%; width: 54px; height: 54px; margin: -27px; z-index: 9; pointer-events: none; color: #fff; opacity: .85;
  animation: mbHand 2.2s ease-in-out infinite; filter: drop-shadow(0 4px 10px rgba(0,0,0,.5)); }
.mb-hand svg.ic { width: 54px; height: 54px; stroke-width: 1.6; }
@keyframes mbHand { 0% { transform: translate(0,0); } 35% { transform: translate(46px,-60px); } 70% { transform: translate(-40px,-30px); } 100% { transform: translate(0,0); } }

/* overlay screens */
.mb-overlay { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 35%, rgba(10, 40, 60, .55), rgba(2, 6, 14, .82)); animation: fadeIn .25s ease;
  padding: calc(16px + var(--sat)) 16px calc(16px + var(--sab)); }
.mb-overlay.closing { animation: fadeOut .2s ease forwards; pointer-events: none; }
.mb-lvl-head { text-align: center; margin-bottom: 14px; }
.mb-lvl-head .mb-kicker { font-size: 12px; font-weight: 800; letter-spacing: .24em; text-transform: uppercase; color: var(--leaf); }
.mb-lvl-head h1 { font-size: 30px; font-weight: 900; text-shadow: 0 0 24px rgba(124,240,163,.45); }
.mb-lvl-head p { margin: 6px auto 0; max-width: 320px; }
.mb-cards { width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 10px; }
.mb-card { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 10px; border-radius: 18px; cursor: pointer; text-align: left;
  background: linear-gradient(180deg, rgba(24, 44, 78, .96), rgba(12, 24, 46, .96)); border: 1.5px solid var(--rc, var(--line-hi));
  box-shadow: 0 8px 24px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.03) inset, 0 0 26px -8px var(--rc); color: var(--text); font-family: inherit; width: 100%;
  animation: mbCardIn .42s cubic-bezier(.2,.9,.3,1.15) backwards; transition: transform .1s ease, opacity .2s; }
.mb-card:active { transform: scale(.97); }
.mb-card.locked { pointer-events: none; }
.mb-card.chosen { transform: scale(1.03); border-color: #fff; }
.mb-card.gone { opacity: 0; transform: scale(.95); }
@keyframes mbCardIn { from { opacity: 0; transform: translateY(26px) scale(.94); } to { opacity: 1; transform: none; } }
.mb-card .mb-port { width: 72px; height: 72px; flex: none; border-radius: 16px; display: grid; place-items: center;
  background: radial-gradient(circle at 50% 40%, rgba(255,255,255,.08), rgba(0,0,0,.25)); }
.mb-card .mb-port canvas { width: 72px; height: 72px; }
.mb-card .mb-cbody { flex: 1; min-width: 0; }
.mb-card .mb-cname { font-size: 17px; font-weight: 850; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mb-card .mb-cdesc { font-size: 13px; color: var(--text-dim); margin-top: 3px; line-height: 1.3; }
.mb-card .mb-ceff { font-size: 13px; font-weight: 750; margin-top: 5px; color: var(--rc); }
.mb-card .mb-clv { display: flex; gap: 3px; margin-top: 6px; }
.mb-card .mb-clv i { width: 12px; height: 4px; border-radius: 4px; background: rgba(255,255,255,.15); }
.mb-card .mb-clv i.on { background: var(--rc); opacity: .6; }
.mb-card .mb-clv i.new { background: var(--rc); box-shadow: 0 0 6px var(--rc); animation: mbPip 1s ease-in-out infinite; }
@keyframes mbPip { 50% { opacity: .4; } }
.mb-card .tag { text-transform: uppercase; letter-spacing: .08em; font-size: 10px; }
.mb-card .mb-new { position: absolute; top: -8px; right: 12px; font-size: 10px; font-weight: 900; letter-spacing: .1em; padding: 2px 8px; border-radius: 99px; background: var(--bloom); color: #3a1d00; }
.mb-lvl-foot { margin-top: 14px; display: flex; gap: 10px; justify-content: center; width: 100%; max-width: 440px; }

/* pause */
.mb-pause-panel { width: calc(100% - 24px); max-width: 400px; }
.mb-pause-panel h2 { font-size: 26px; text-align: center; }
.mb-statgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0; }
.mb-statgrid > div { background: rgba(255,255,255,.05); border: 1px solid var(--line); border-radius: 14px; padding: 8px 6px; text-align: center; }
.mb-statgrid b { display: block; font-size: 18px; font-weight: 850; font-variant-numeric: tabular-nums; }
.mb-statgrid span { font-size: 10.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--text-faint); }
.mb-mutlist { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 4px 0 6px; }
.mb-mut { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px 2px 2px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid var(--line); font-size: 12px; font-weight: 700; }
.mb-mut canvas { width: 26px; height: 26px; }
.mb-mut sup { font-size: 10px; color: var(--text-dim); font-weight: 800; }

/* results */
.mb-results { width: 100%; max-width: 420px; max-height: 100%; overflow-y: auto; scrollbar-width: none; display: flex; flex-direction: column; align-items: stretch; touch-action: pan-y; }
.mb-results::-webkit-scrollbar { display: none; }
.mb-res-head { text-align: center; margin: 4px 0 6px; }
.mb-res-head .mb-kicker { font-size: 12px; font-weight: 800; letter-spacing: .24em; text-transform: uppercase; color: var(--text-dim); }
.mb-res-head h1 { font-size: 32px; font-weight: 900; margin-top: 2px; }
.mb-res-head.win h1 { color: #ffe7a8; text-shadow: 0 0 30px rgba(255,207,110,.5); }
.mb-res-head.lose h1 { color: #ffc4cc; text-shadow: 0 0 26px rgba(255,107,125,.35); }
.mb-res-head p { margin: 4px 0 0; }
.mb-dnabox { padding: 14px 16px 12px; margin-top: 4px; }
.mb-dnarow { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 14px; opacity: .25; transition: opacity .25s; }
.mb-dnarow.on { opacity: 1; }
.mb-dnarow span:first-child { color: var(--text-dim); }
.mb-dnarow b { font-variant-numeric: tabular-nums; color: var(--dna); }
.mb-dnatotal { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 10px; }
.mb-dnatotal .mb-big { font-size: 34px; font-weight: 900; color: var(--dna); display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums;
  text-shadow: 0 0 20px rgba(199,156,255,.45); }
.mb-dnatotal .mb-big svg.ic { width: 30px; height: 30px; }
.mb-dnatotal .mb-big.pop { animation: chipPulse .45s ease; }
.mb-res-foot { margin-top: 14px; padding-bottom: 4px; }
.mb-sec { font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--text-faint); text-align: center; margin: 14px 0 6px; }
.mb-disc { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.mb-disc > div { display: flex; flex-direction: column; align-items: center; width: 64px; font-size: 10.5px; font-weight: 700; color: var(--text-dim); text-align: center; }
.mb-disc canvas { width: 52px; height: 52px; }

.mb-flash { position: absolute; inset: 0; z-index: 6; pointer-events: none; background: #fff; opacity: 0; }
.mb-fade { position: absolute; inset: 0; z-index: 6; pointer-events: none; background: #01040a; opacity: 0; }
`;

let injected = null, refs = 0;
export function injectStyle() {
  refs++;
  if (injected && injected.isConnected) return;
  injected = document.createElement('style');
  injected.id = 'mb-style';
  injected.textContent = CSS;
  document.head.appendChild(injected);
}
export function releaseStyle() {
  refs = Math.max(0, refs - 1);
  if (!refs && injected) { injected.remove(); injected = null; }
}
