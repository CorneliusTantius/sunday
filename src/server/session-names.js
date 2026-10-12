import { randomInt } from 'node:crypto';

export const GREEK_DEITY_NAMES = Object.freeze([
  'Zeus', 'Hera', 'Poseidon', 'Demeter', 'Athena', 'Apollo', 'Artemis',
  'Ares', 'Aphrodite', 'Hephaestus', 'Hermes', 'Hestia', 'Dionysus', 'Hades',
  'Persephone', 'Hecate', 'Helios', 'Selene', 'Eos', 'Iris', 'Nike', 'Nemesis',
  'Tyche', 'Themis', 'Dike', 'Eirene', 'Hebe', 'Eileithyia', 'Asclepius',
  'Hygieia', 'Panacea', 'Hypnos', 'Thanatos', 'Morpheus', 'Phobetor', 'Phantasos',
  'Eros', 'Anteros', 'Himeros', 'Pothos', 'Peitho', 'Harmonia', 'Pan', 'Triton',
  'Amphitrite', 'Proteus', 'Nereus', 'Doris', 'Thetis', 'Galatea', 'Leucothea',
  'Palaemon', 'Aeolus', 'Boreas', 'Zephyrus', 'Notus', 'Eurus', 'Gaia', 'Uranus',
  'Nyx', 'Erebus', 'Aether', 'Hemera', 'Pontus', 'Thalassa', 'Tartarus', 'Cronus',
  'Rhea', 'Oceanus', 'Tethys', 'Hyperion', 'Theia', 'Coeus', 'Phoebe', 'Crius',
  'Iapetus', 'Mnemosyne', 'Prometheus', 'Epimetheus', 'Atlas', 'Leto', 'Asteria',
  'Astraeus', 'Perses', 'Pallas', 'Metis', 'Styx', 'Bia', 'Kratos', 'Zelus',
  'Calliope', 'Clio', 'Erato', 'Euterpe', 'Melpomene', 'Polyhymnia', 'Terpsichore',
  'Thalia', 'Urania', 'Aglaea', 'Euphrosyne',
]);

export function uniqueSessionName(titles) {
  const used = new Set(titles);
  const unused = GREEK_DEITY_NAMES.filter(name => !used.has(name));
  if (unused.length) return unused[randomInt(unused.length)];
  const base = GREEK_DEITY_NAMES[randomInt(GREEK_DEITY_NAMES.length)];
  let suffix = 2;
  while (used.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
