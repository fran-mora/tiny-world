// Tiny World — Microbe mode public API.
// A 2D action roguelike: you are a single cell in the primordial ocean. Each run earns DNA.
import { MICROBE_SPECIES as SPECIES, MUTATIONS as MUTS, GENOME_UPGRADES as GENOME } from './data.js';
import { portrait as drawPortrait } from './art.js';
import { startGame } from './game.js';

// Codex entries for every enemy / prey / boss: { id, name, desc, firstEra }
export const MICROBE_SPECIES = SPECIES.map(({ id, name, desc, firstEra }) => ({ id, name, desc, firstEra }));

// Mutations offered on level-up: { id, name, desc, maxLevel, rarity, tags }
export const MUTATIONS = MUTS.map(({ id, name, desc, maxLevel, rarity, tags }) => ({ id, name, desc, maxLevel, rarity, tags: tags.slice() }));

// Permanent upgrades bought with DNA: { id, name, desc, maxLevel, cost(level), effect(level) }
export const GENOME_UPGRADES = GENOME.map(({ id, name, desc, maxLevel, cost, effect }) => ({ id, name, desc, maxLevel, cost, effect }));

// kind: 'microbe' | 'mutation' | 'genome' -> HTMLCanvasElement (transparent background, CSS size = size px)
export function portrait(kind, id, size = 96) {
  return drawPortrait(kind, id, size);
}

// opts: { host, era, genome, codex, settings, firstRun, dnaMult, onExit }
// returns { destroy(), pause(), resume() }
export function startMicrobeRun(opts = {}) {
  if (!opts.host) throw new Error('startMicrobeRun: opts.host is required');
  const game = startGame(opts);
  const handle = {
    destroy() { game.destroy(); if (window.__mb && window.__mb.game === game) window.__mb = null; },
    pause() { game.pause(true); },
    resume() { game.resume(); },
  };
  // debug hook only when explicitly requested (dev harness)
  if (opts.debug) window.__mb = game.debug();
  return handle;
}
