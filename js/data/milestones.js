// Goals that guide the player through the eras. check(g) returns progress 0..1.
// g = { state, eco }

const o2 = (n) => (g) => Math.min(1, g.eco.oxygen / n);
const count = (fn, n) => (g) => Math.min(1, fn(g) / n);

export const MILESTONES = [
  { id: 'dive1', era: 1, title: 'Dive into the primordial soup', desc: 'Become a microbe in your ocean and collect DNA.', check: (g) => Math.min(1, g.state.totals.runs), reward: { dna: 10 }, target: 'btn-dive' },
  { id: 'algae', era: 1, title: 'Research Sea Algae', desc: 'Spend DNA in Research to seed the oceans with life.', check: (g) => (g.state.research.algae ? 1 : 0), reward: { dna: 5 }, target: 'btn-research' },
  { id: 'o2_2', era: 1, title: 'Reach 2% oxygen', desc: 'Algae breathe oxygen into the sky. Keep diving while it rises.', check: o2(2), reward: { dna: 10, bloom: 10 }, target: 'o2-meter' },
  { id: 'moss', era: 2, title: 'Plant Star Moss', desc: 'Research moss, then plant it on bare rock.', check: (g) => ((g.eco.stats.grown.moss || 0) > 0 ? 1 : 0), reward: { bloom: 20 }, target: 'btn-plant' },
  { id: 'soil', era: 2, title: 'Build fertile soil on 25 tiles', desc: 'Moss slowly turns rock into soil.', check: count((g) => { let n = 0; for (let i = 0; i < g.eco.fert.length; i++) if (g.eco.fert[i] > 0.25) n++; return n; }, 25), reward: { dna: 15 } },
  { id: 'depth2', era: 2, title: 'Reach depth 2 in a dive', desc: 'Survive deeper in the primordial soup.', check: (g) => Math.min(1, g.state.totals.bestDepth / 2), reward: { dna: 10 } },
  { id: 'o2_5', era: 2, title: 'Reach 5% oxygen', desc: 'More green, more air.', check: o2(5), reward: { dna: 15, bloom: 20 }, target: 'o2-meter' },
  { id: 'grass', era: 3, title: 'Cover 60 tiles in grass', desc: 'Wind Grass needs some soil to take root.', check: count((g) => { let n = 0; for (let i = 0; i < g.eco.coverSp.length; i++) if (g.eco.coverSp[i] === 2 && g.eco.cover[i] > 0.3) n++; return n; }, 60), reward: { dna: 20 } },
  { id: 'flowers', era: 3, title: 'Grow 10 Sunpetals', desc: 'Flowers produce lots of Bloom.', check: count((g) => g.eco.plantCounts().flower || 0, 10), reward: { bloom: 40 } },
  { id: 'moths', era: 3, title: 'Release Glowmoths', desc: 'Pollinators help flowers and bushes spread.', check: (g) => ((g.eco.stats.grown.moth || 0) > 0 ? 1 : 0), reward: { dna: 15 }, target: 'btn-animals' },
  { id: 'depth3', era: 3, title: 'Reach depth 3 in a dive', desc: 'Something huge lurks at the end of depth 3.', check: (g) => Math.min(1, g.state.totals.bestDepth / 3), reward: { dna: 20 } },
  { id: 'pollinate', era: 3, title: 'Pollinate 60 flowers', desc: 'Let your moths do their work.', check: count((g) => g.eco.stats.pollinations, 60), reward: { dna: 20, bloom: 30 } },
  { id: 'o2_9', era: 3, title: 'Reach 9% oxygen', desc: 'Enough air for animals.', check: o2(9), reward: { dna: 25 }, target: 'o2-meter' },
  { id: 'hoppers', era: 4, title: 'Grow 30 Puffhops', desc: 'Grazers need plenty of grass and moss.', check: count((g) => g.eco.popCount.hopper || 0, 30), reward: { dna: 30 } },
  { id: 'beetles', era: 4, title: 'Release Loam Beetles', desc: 'Decomposers turn dead matter into rich soil.', check: (g) => ((g.eco.stats.grown.beetle || 0) > 0 ? 1 : 0), reward: { dna: 15 } },
  { id: 'fish', era: 4, title: 'Release Glimmerfish', desc: 'Fill the shallows with life.', check: (g) => ((g.eco.stats.grown.fish || 0) > 0 ? 1 : 0), reward: { dna: 15 } },
  { id: 'boss1', era: 4, title: 'Defeat the Colossal Amoeba', desc: 'It waits at the end of depth 3.', check: (g) => Math.min(1, g.state.totals.bossKills), reward: { dna: 40 } },
  { id: 'o2_13', era: 4, title: 'Reach 13% oxygen', desc: 'Forests and predators can follow.', check: o2(13), reward: { dna: 30, bloom: 40 }, target: 'o2-meter' },
  { id: 'forest', era: 5, title: 'Grow 15 mature trees', desc: 'Pines for the cold, oaks for the lowlands, palms for warm coasts.', check: count((g) => g.eco.plants.filter((p) => !p.dead && p.growth >= 0.95 && ['pine', 'oak', 'palm'].includes(g.plantId(p))).length, 15), reward: { dna: 40 } },
  { id: 'predator', era: 5, title: 'Release Prowlers', desc: 'Predators keep grazers from stripping the land bare.', check: (g) => ((g.eco.stats.grown.prowler || 0) > 0 ? 1 : 0), reward: { dna: 25 } },
  { id: 'balance', era: 5, title: 'Keep Puffhops and Prowlers alive together for 5 days', desc: 'The hardest trick in nature: balance.', check: (g) => Math.min(1, (g.state.flags.coexistDays || 0) / 5), reward: { dna: 60 } },
  { id: 'win', era: 5, title: 'Win a dive', desc: 'Defeat the Phage Queen at depth 5.', check: (g) => Math.min(1, g.state.totals.runWins), reward: { dna: 60 } },
  { id: 'o2_17', era: 5, title: 'Reach 17% oxygen', desc: 'Almost a living world.', check: o2(17), reward: { dna: 50 }, target: 'o2-meter' },
  { id: 'diversity', era: 6, title: 'Have 12 thriving species', desc: 'Plants with 8+ individuals, animals with 6+.', check: count((g) => g.eco.thriving().n, 12), reward: { dna: 80 } },
  { id: 'o2_21', era: 6, title: 'Reach 21% oxygen', desc: 'Earth-like air.', check: o2(21), reward: { dna: 80 } },
  { id: 'worldtree', era: 6, title: 'Plant the World Tree', desc: 'Research it, then plant it on rich, fertile ground.', check: (g) => ((g.eco.stats.grown.worldtree || 0) > 0 ? 1 : 0), reward: { bloom: 100 } },
  { id: 'alive', era: 6, title: 'Grow the World Tree to full size', desc: 'Keep the world healthy while it grows.', check: (g) => { const p = g.eco.plants.find((p) => !p.dead && g.plantId(p) === 'worldtree'); return p ? p.growth : 0; }, reward: { dna: 200 } },
];

// The currently active goals (first few incomplete ones available in this era)
export function activeGoals(state, max = 3) {
  const out = [];
  for (const m of MILESTONES) {
    if (state.milestones[m.id]) continue;
    if (m.era > state.era) continue;
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}
