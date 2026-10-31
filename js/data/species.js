// Species definitions for the planet: plants (ground cover + individual plants) and animals.
// Units: time in game days (1 day = 120 sim ticks), tile values 0..1, world radius 10.

// pref ranges are [min, optimum, max]
export const PLANTS = [
  {
    id: 'algae', name: 'Sea Algae', kind: 'ocean', era: 1, dna: 20, cost: 0,
    icon: 'wave', color: '#3fbf8f',
    desc: 'Microscopic green life drifting in the shallows. The first source of oxygen on your world.',
    o2: 1, // handled specially by the sim (ocean-wide)
  },
  {
    id: 'moss', name: 'Star Moss', kind: 'cover', era: 2, dna: 30, cost: 6,
    icon: 'sprout', color: '#5f9e5a',
    desc: 'A pioneer that clings to bare rock and slowly turns it into soil.',
    pref: { temp: [0.0, 0.45, 0.95], moist: [0.12, 0.6, 1.0], fert: 0 },
    growth: 0.55, spread: 0.35, o2: 0.25, bloom: 0.12, fertGain: 0.05, food: 0.5,
  },
  {
    id: 'grass', name: 'Wind Grass', kind: 'cover', era: 3, dna: 50, cost: 10,
    icon: 'sprout', color: '#86c95a',
    desc: 'Fast-spreading meadow grass. The staple food of grazers.',
    pref: { temp: [0.12, 0.6, 0.98], moist: [0.15, 0.5, 0.95], fert: 0.18 },
    growth: 0.9, spread: 0.55, o2: 0.35, bloom: 0.18, fertGain: 0.02, food: 1.0,
  },
  {
    id: 'fern', name: 'Curl Fern', kind: 'plant', layer: 'herb', era: 3, dna: 60, cost: 14,
    icon: 'plant', color: '#3e9e63',
    desc: 'Shade-loving fronds that thrive where it is damp and the soil is rich.',
    pref: { temp: [0.1, 0.55, 0.95], moist: [0.4, 0.8, 1.0], fert: 0.25 },
    grow: 3, life: 30, seed: 0.22, range: 1, o2: 0.6, bloom: 0.5, browse: 0.6, pollinated: false,
  },
  {
    id: 'flower', name: 'Sunpetal', kind: 'plant', layer: 'herb', era: 3, dna: 70, cost: 16,
    icon: 'bloom', color: '#ffb347',
    desc: 'Bright wildflowers that produce lots of Bloom. They spread far faster when pollinated.',
    pref: { temp: [0.2, 0.62, 1.0], moist: [0.2, 0.5, 0.9], fert: 0.2 },
    grow: 2, life: 14, seed: 0.12, range: 2, o2: 0.3, bloom: 2.2, browse: 0.4, pollinated: true, flowers: true,
  },
  {
    id: 'bush', name: 'Gloomberry Bush', kind: 'plant', layer: 'shrub', era: 4, dna: 110, cost: 24,
    icon: 'plant', color: '#5c7fd6',
    desc: 'A sturdy shrub heavy with indigo berries. Grazers love it, and pollinators help it spread.',
    pref: { temp: [0.15, 0.55, 0.95], moist: [0.25, 0.55, 0.95], fert: 0.3 },
    grow: 5, life: 45, seed: 0.12, range: 2, o2: 0.9, bloom: 1.1, browse: 1.0, pollinated: true, flowers: true,
  },
  {
    id: 'mushroom', name: 'Lantern Cap', kind: 'plant', layer: 'fungus', era: 4, dna: 90, cost: 18,
    icon: 'mushroom', color: '#ff8f6b',
    desc: 'A glowing fungus that feeds on decay. It turns dead matter back into fertile soil.',
    pref: { temp: [0.05, 0.5, 0.9], moist: [0.35, 0.75, 1.0], fert: 0.15 },
    grow: 2, life: 10, seed: 0.25, range: 2, o2: 0, bloom: 0.6, browse: 0, decomposer: true,
  },
  {
    id: 'cactus', name: 'Sun Barrel', kind: 'plant', layer: 'shrub', era: 5, dna: 140, cost: 26,
    icon: 'plant', color: '#6dbf73',
    desc: 'A water-hoarding succulent built for scorching, dry ground. Blooms after rain.',
    pref: { temp: [0.5, 0.9, 1.0], moist: [0.0, 0.15, 0.45], fert: 0.05 },
    grow: 6, life: 80, seed: 0.08, range: 2, o2: 0.5, bloom: 1.2, browse: 0.2, pollinated: true, flowers: true,
  },
  {
    id: 'pine', name: 'Frost Pine', kind: 'plant', layer: 'tree', era: 5, dna: 170, cost: 34,
    icon: 'tree', color: '#2f7a5a',
    desc: 'A hardy conifer for cold peaks and high ground. Slow, steady and long-lived.',
    pref: { temp: [0.0, 0.25, 0.6], moist: [0.2, 0.5, 0.9], fert: 0.25 },
    grow: 9, life: 140, seed: 0.06, range: 2, o2: 2.4, bloom: 1.4, browse: 0.2, pollinated: false,
  },
  {
    id: 'oak', name: 'Elder Oak', kind: 'plant', layer: 'tree', era: 5, dna: 200, cost: 40,
    icon: 'tree', color: '#4f9a3a',
    desc: 'A great broadleaf tree. Pumps out oxygen, holds moisture, and shelters life around it.',
    pref: { temp: [0.25, 0.55, 0.85], moist: [0.35, 0.65, 1.0], fert: 0.4 },
    grow: 10, life: 160, seed: 0.06, range: 2, o2: 3.0, bloom: 1.8, browse: 0.3, pollinated: true,
  },
  {
    id: 'palm', name: 'Tide Palm', kind: 'plant', layer: 'tree', era: 5, dna: 180, cost: 36,
    icon: 'tree', color: '#7fbf4a',
    desc: 'A salt-tolerant palm that leans over warm beaches.',
    pref: { temp: [0.55, 0.85, 1.0], moist: [0.35, 0.7, 1.0], fert: 0.15, coast: true },
    grow: 8, life: 110, seed: 0.07, range: 2, o2: 2.0, bloom: 1.5, browse: 0.2, pollinated: false,
  },
  {
    id: 'worldtree', name: 'World Tree', kind: 'plant', layer: 'tree', era: 6, dna: 1500, cost: 400,
    icon: 'star', color: '#a8ffdc', unique: true,
    desc: 'A legendary tree whose roots reach the planet\'s core. When it fully grows, your world is truly alive.',
    pref: { temp: [0.15, 0.55, 0.9], moist: [0.3, 0.6, 1.0], fert: 0.55 },
    grow: 24, life: 99999, seed: 0, range: 0, o2: 8, bloom: 12, browse: 0, pollinated: false,
  },
];

// diet: cover (eats ground cover), browse (eats plants with browse>0), nectar (flowering plants),
// detritus, algae (ocean), prey: [species ids]
export const ANIMALS = [
  {
    id: 'moth', name: 'Glowmoth', era: 3, dna: 80, cost: 18, group: 2,
    icon: 'moth', color: '#c7f0ff', role: 'Pollinator',
    desc: 'A softly glowing moth that sips nectar and spreads pollen from flower to flower.',
    flying: true, diet: { nectar: 1 }, speed: 1.2, sense: 2, size: 0.12,
    life: 10, mature: 1.5, litter: [1, 2], breedEnergy: 0.75, metabolism: 0.45,
    temp: [0.15, 0.95], o2Min: 5, cap: 90,
  },
  {
    id: 'fish', name: 'Glimmerfish', era: 4, dna: 90, cost: 16, group: 4,
    icon: 'fish', color: '#7fd3ff', role: 'Grazer · ocean',
    desc: 'Schools of shimmering fish that graze on algae in the shallows.',
    aquatic: true, diet: { algae: 1 }, speed: 1.1, sense: 2, size: 0.16,
    life: 14, mature: 2.5, litter: [1, 3], breedEnergy: 0.7, metabolism: 0.45,
    temp: [0.05, 1.0], o2Min: 6, cap: 60,
  },
  {
    id: 'hopper', name: 'Puffhop', era: 4, dna: 100, cost: 20, group: 3,
    icon: 'paw', color: '#f3d7b0', role: 'Grazer',
    desc: 'A round, fluffy grazer that nibbles grass and moss and breeds quickly.',
    diet: { cover: 1, browse: 0.3 }, speed: 0.9, sense: 2, size: 0.17,
    life: 12, mature: 2.5, litter: [1, 2], breedEnergy: 0.72, metabolism: 0.45,
    temp: [0.08, 0.9], o2Min: 9, cap: 110, hops: true,
  },
  {
    id: 'beetle', name: 'Loam Beetle', era: 4, dna: 85, cost: 14, group: 3,
    icon: 'bug', color: '#8a6bd6', role: 'Decomposer',
    desc: 'Trundles about eating dead matter and fungi, leaving richer soil behind.',
    diet: { detritus: 1, fungus: 0.8 }, speed: 0.55, sense: 1, size: 0.11,
    life: 16, mature: 3, litter: [1, 2], breedEnergy: 0.7, metabolism: 0.35,
    temp: [0.1, 0.95], o2Min: 8, cap: 70, fertilizer: true,
  },
  {
    id: 'grazer', name: 'Mossback', era: 5, dna: 160, cost: 32, group: 2,
    icon: 'paw', color: '#b7a07a', role: 'Large grazer',
    desc: 'A gentle, lumbering herbivore with a garden growing on its back. Eats shrubs and ferns too.',
    diet: { cover: 0.8, browse: 1 }, speed: 0.6, sense: 2, size: 0.32,
    life: 24, mature: 5, litter: [1, 1], breedEnergy: 0.8, metabolism: 0.4,
    temp: [0.05, 0.85], o2Min: 12, cap: 40,
  },
  {
    id: 'prowler', name: 'Prowler', era: 5, dna: 220, cost: 40, group: 2,
    icon: 'cat', color: '#e07a4f', role: 'Predator',
    desc: 'A sleek hunter that keeps grazer numbers in check. Too many, and they starve.',
    diet: { prey: ['hopper', 'grazer', 'beetle'] }, speed: 1.35, sense: 3, size: 0.26,
    life: 22, mature: 4, litter: [1, 2], breedEnergy: 0.82, metabolism: 0.6,
    temp: [0.05, 0.9], o2Min: 14, cap: 30, predator: true,
  },
  {
    id: 'hawk', name: 'Skyhawk', era: 6, dna: 300, cost: 50, group: 2,
    icon: 'bird', color: '#e8e2d0', role: 'Aerial predator',
    desc: 'Circles high above, diving on fish, moths and hoppers.',
    flying: true, diet: { prey: ['fish', 'moth', 'hopper'] }, speed: 1.7, sense: 3, size: 0.25,
    life: 26, mature: 5, litter: [1, 2], breedEnergy: 0.85, metabolism: 0.55,
    temp: [0.0, 1.0], o2Min: 17, cap: 20, predator: true,
  },
];

// Adaptations: DNA-bought, per-species upgrades
export const ANIMAL_ADAPTS = [
  { id: 'swift', name: 'Swift', desc: '+12% speed per level', max: 3, base: 40 },
  { id: 'hardy', name: 'Hardy', desc: 'Wider temperature tolerance', max: 3, base: 35 },
  { id: 'fertile', name: 'Fertile', desc: 'Breeds more readily', max: 3, base: 45 },
  { id: 'efficient', name: 'Efficient', desc: '-12% energy use per level', max: 3, base: 40 },
  { id: 'keen', name: 'Keen Senses', desc: 'Finds food (and danger) from farther away', max: 2, base: 30 },
];
export const PLANT_ADAPTS = [
  { id: 'roots', name: 'Deep Roots', desc: 'Tolerates drier ground', max: 3, base: 35 },
  { id: 'hardy', name: 'Hardy', desc: 'Wider temperature tolerance', max: 3, base: 35 },
  { id: 'prolific', name: 'Prolific', desc: 'Spreads seeds more often', max: 3, base: 45 },
  { id: 'thorns', name: 'Bitter Leaves', desc: 'Grazers eat less of it', max: 2, base: 30 },
];
export const adaptCost = (a, lvl, sp) => Math.round(a.base * (1 + (sp.era - 2) * 0.35) * Math.pow(1.8, lvl));

export const PLANT = Object.fromEntries(PLANTS.map((p, i) => [p.id, { ...p, index: i }]));
export const ANIMAL = Object.fromEntries(ANIMALS.map((a, i) => [a.id, { ...a, index: i }]));
export const SPECIES = { ...PLANT, ...ANIMAL };
export const isPlant = (id) => !!PLANT[id];

export const ERAS = [
  null,
  { n: 1, name: 'Primordial Soup', o2: 0, color: '#8f7cff', blurb: 'A barren rock and a dark ocean. Life must begin small.' },
  { n: 2, name: 'First Green', o2: 2, color: '#5fd3a6', blurb: 'Algae breathe oxygen into the sky. Moss can take hold on bare rock.' },
  { n: 3, name: 'Meadows', o2: 5, color: '#9be36d', blurb: 'Soil is forming. Grass, ferns, flowers and pollinators can thrive.' },
  { n: 4, name: 'Grazers', o2: 9, color: '#ffd36e', blurb: 'The air can support animals. Grazers, decomposers and fish arrive.' },
  { n: 5, name: 'The Wilds', o2: 13, color: '#ff9f6e', blurb: 'Forests rise and predators hunt. Keep everything in balance.' },
  { n: 6, name: 'Living World', o2: 17, color: '#7ff0ff', blurb: 'A thriving biosphere. Grow the World Tree to complete your world.' },
];
