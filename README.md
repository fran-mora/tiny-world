# Tiny World

A cozy-science mobile game that runs entirely in the browser and works offline.

Start with a barren rock and a dark ocean. Dive into the primordial soup as a single cell, evolve, and bring back **DNA**. Use it to seed the oceans with algae, raise the oxygen, and grow a living planet: moss and grass, flowers and pollinators, grazers, decomposers, forests and predators. Keep the ecosystem in balance through droughts, blights and meteor strikes, and grow the legendary **World Tree**.

**Play:** https://fran-mora.github.io/tiny-world/

## Offline play
Open the link once while online, then add it to your Home Screen (iPhone: Share → Add to Home Screen; Android: menu → Install app). A service worker caches the whole game, and progress is saved on the device.

## How it is built
- Plain ES modules, no build step. Three.js r187 vendored in `vendor/`.
- `js/planet/` — procedural icosphere planet (`world.js`), ecosystem simulation with evolving animals (`sim.js`), renderer (`render.js`), procedural low-poly models (`models.js`), HUD (`view.js`).
- `js/microbe/` — the 2D microbe roguelike (Canvas 2D).
- `js/audio.js` — generative music and synthesized sound effects (WebAudio, no audio files).
- `tools/build_sw.py` — regenerates `sw.js` with the precache list; run it after changing files.
