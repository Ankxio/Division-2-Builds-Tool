// Pictures for every item. All of it is original line art drawn here: a silhouette per
// weapon class, an illustration per gear slot and skill, and an emblem generated from each
// brand's and gear set's name. Nothing is taken from the game.
//
// Your own pictures win when present: put a file in img/items/ named after the item
// (see README) and run tools/update-images.ps1.

import { normName } from './stats.js';

let custom = new Map();
export function setImages(map) { custom = map || new Map(); }

const svg = (box, body, cls = '') => `<svg class="art ${cls}" viewBox="0 0 ${box}" aria-hidden="true">${body}</svg>`;
const paths = list => list.map(d => `<path d="${d}"/>`).join('');

// ---- weapons: one side-on silhouette per class (120 x 44) ----
const WEAPON = {
  ar: ['M2 17l18-2h6v9h-6L6 29H2z', 'M26 13h34v10H26z', 'M30 10h40v3H30z', 'M34 6h4v4h-4z', 'M36 23h8l-3 13h-7z', 'M44 23h8v2h-8z',
    'M52 23h9l4 17h-9z', 'M60 12h34v10H60z', 'M94 15h20v3H94z', 'M98 8h3v7h-3z', 'M112 14h6v5h-6z'],
  lmg: ['M2 15l20-3v14L8 31H2z', 'M22 12h40v12H22z', 'M30 8h24v4H30z', 'M56 4h16v2H56zM58 6h2v6h-2zM68 6h2v6h-2z', 'M30 24h8l-3 12h-7z',
    'M42 24h18v14H42z', 'M62 14h26v8H62z', 'M88 16h28v3H88z', 'M112 15h6v5h-6z', 'M90 19l-7 21h3l6-21zM92 19l6 21h3l-7-21z'],
  smg: ['M4 14h22v3H7v9h15v2H4z', 'M26 12h44v11H26z', 'M30 9h30v3H30z', 'M34 23h8l-3 13h-7z', 'M50 23h8v18h-8z', 'M70 14h20v6H70z',
    'M90 15h8v4h-8z', 'M72 20h6v11h-6z'],
  shotgun: ['M2 17l28-4v9l-20 9H2z', 'M30 12h26v10H30z', 'M30 22h10l-4 9h-8z', 'M56 12h60v4H56z', 'M56 18h48v4H56z', 'M66 16h22v8H66z', 'M112 9h2v3h-2z'],
  rifle: ['M2 18l24-4h44v8l-30 2-10-2-18 8H2z', 'M40 11h24v3H40z', 'M50 22h10l1 12h-9z', 'M70 15h42v3H70z', 'M70 19h24v3H70z', 'M106 10h3v5h-3z', 'M112 14h6v5h-6z'],
  mmr: ['M2 18l22-3h36v7l-26 2-8-1-14 7H2z', 'M8 13h14v2H8z', 'M30 4h6v8h-6zM36 5h30v6H36zM66 4h7v8h-7z', 'M42 11h3v4h-3zM58 11h3v4h-3z', 'M44 22h10v6H44z',
    'M60 16h54v3H60z', 'M112 15h6v5h-6z', 'M70 19l-7 20h3l6-20zM72 19l6 20h3l-7-20z'],
  pistol: ['M34 10h50l3 3v7H34z', 'M38 20h44l-2 5H58l-3-3H38z', 'M38 20h16l-4 20H34z', 'M56 25h10v4a4 4 0 01-4 4h-6z', 'M36 8h3v2h-3zM80 8h3v2h-3z'],
};

// ---- gear slots (64 x 64) ----
const SLOT = {
  mask: ['M32 8c11 0 18 7 18 17v8c0 10-7 19-18 23-11-4-18-13-18-23v-8c0-10 7-17 18-17z', 'M19 26h10v7h-8z', 'M35 26h10l-2 7h-8z', 'M26 40h12v9l-6 4-6-4z', 'M14 24l-6-3M50 24l6-3'],
  backpack: ['M18 18h28a6 6 0 016 6v26a6 6 0 01-6 6H18a6 6 0 01-6-6V24a6 6 0 016-6z', 'M25 18v-5a3 3 0 013-3h8a3 3 0 013 3v5', 'M20 36h24v14H20z', 'M12 30h40', 'M28 43h8'],
  chest: ['M20 8l6 6h12l6-6 8 6-3 12v28H15V26l-3-12z', 'M22 22h20v12H22z', 'M19 40h8v10h-8zM28 40h8v10h-8zM37 40h8v10h-8z'],
  gloves: ['M22 56V40l-7-9a3.5 3.5 0 015-5l5 5V13a3 3 0 016 0v13h1V9a3 3 0 016 0v17h1V12a3 3 0 016 0v15h1v-9a3 3 0 016 0v22c0 6-3 11-6 16z', 'M22 50h23', 'M31 33h13'],
  holster: ['M6 14h52v8H6z', 'M24 22h16v6H24z', 'M22 28h20l-4 28H28z', 'M34 5h10l-2 9h-8z', 'M24 38h16'],
  kneepads: ['M22 10h20l6 12-3 14 3 14-6 6H22l-6-6 3-14-3-14z', 'M26 22h12l3 10-3 10H26l-3-10z', 'M16 20H8M48 20h8M16 46H8M48 46h8'],
};

// ---- skills, by family (64 x 64) ----
const SKILL = {
  turret: ['M26 20h20v8H26z', 'M46 22h12v4H46z', 'M30 28h8v6h-8z', 'M34 34L22 54h4l10-16 10 16h4L38 34z'],
  drone: ['M24 26h16v10H24z', 'M8 20h16v3H8zM40 20h16v3H40z', 'M14 23h4v6h-4zM46 23h4v6h-4z', 'M18 29h6v3h-6zM40 29h6v3h-6z', 'M28 36h8v6h-8z'],
  hive: ['M32 8l10 6v12l-10 6-10-6V14z', 'M20 30l10 6v12l-10 6-10-6V36z', 'M44 30l10 6v12l-10 6-10-6V36z'],
  chem: ['M6 26h34v10H6z', 'M40 28h16v6H40z', 'M14 36h8l-2 14h-8z', 'M28 36h8v8h-8z'],
  firefly: ['M32 18l6 10-6 22-6-22z', 'M26 26L6 20l4 12 16 2z', 'M38 26l20-6-4 12-16 2z'],
  seeker: ['M32 14a18 18 0 100 36 18 18 0 000-36z', 'M32 24a8 8 0 100 16 8 8 0 000-16z', 'M32 6v8M32 50v8M6 32h8M50 32h8'],
  pulse: ['M32 28a4 4 0 100 8 4 4 0 000-8z', 'M20 20a17 17 0 000 24M44 20a17 17 0 010 24', 'M12 12a28 28 0 000 40M52 12a28 28 0 010 40'],
  shield: ['M32 6l22 8v18c0 13-9 22-22 26C19 54 10 45 10 32V14z', 'M22 22h20v6H22z', 'M32 28v22'],
  decoy: ['M32 10a7 7 0 100 14 7 7 0 000-14z', 'M20 54V38a12 12 0 0124 0v16z', 'M10 54h44'],
  trap: ['M32 8l6 12-6 4-6-4z', 'M10 44l12-6 4 6-4 6z', 'M54 44l-12-6-4 6 4 6z', 'M32 30a4 4 0 100 8 4 4 0 000-8z'],
  sticky: ['M26 22h12a10 10 0 0110 10v8a10 10 0 01-10 10H26a10 10 0 01-10-10v-8a10 10 0 0110-10z', 'M30 12h4v10h-4z', 'M26 36h12'],
  cover: ['M8 40h48v10H8z', 'M14 28h36v12H14z', 'M22 14h20v14H22z'],
  other: ['M32 6l22 13v26L32 58 10 45V19z', 'M32 20l10 6v12l-10 6-10-6V26z'],
};
const SKILL_KEYS = [['turret', 'turret'], ['drone', 'drone'], ['hive', 'hive'], ['chem', 'chem'], ['firefly', 'firefly'], ['seeker', 'seeker'],
  ['pulse', 'pulse'], ['shield', 'shield'], ['decoy', 'decoy'], ['trap', 'trap'], ['sticky', 'sticky'], ['cover', 'cover']];

// ---- emblems: a badge built from a name ----
const SHAPES = [
  'M32 4L56 18V46L32 60 8 46V18Z',
  'M32 4L56 12V32C56 46 44 56 32 60 20 56 8 46 8 32V12Z',
  'M32 3L61 32 32 61 3 32Z',
  'M14 6H50L58 14V50L50 58H14L6 50V14Z',
  'M32 5a27 27 0 100 54 27 27 0 000-54Z',
];

function hash(text) {
  let h = 5381;
  for (const ch of text) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
  return h;
}

function monogram(name) {
  const words = String(name).replace(/\b(s\.?a\.?|s\.?r\.?o\.?|s\.?p\.?a\.?|gmbh|ab|ltd|co\.?|sp\.? ?z ?o\.?o\.?)\b/gi, ' ')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0];
  const second = words.length > 1 ? [...words[1]][0] : [...words[0]][1] || '';
  return (first + second).toUpperCase();
}

function emblem(name, core) {
  const h = hash(normName(name));
  const shape = SHAPES[h % SHAPES.length];
  const ticks = 3 + (h >> 4) % 4;
  const rays = Array.from({ length: ticks }, (_, i) => {
    const a = ((h >> 8) % 60 + i * (360 / ticks)) * Math.PI / 180;
    return `M${(32 + Math.cos(a) * 20).toFixed(1)} ${(32 + Math.sin(a) * 20).toFixed(1)}L${(32 + Math.cos(a) * 24).toFixed(1)} ${(32 + Math.sin(a) * 24).toFixed(1)}`;
  }).join('');
  return svg('64 64', `<path class="plate" d="${shape}"/><path class="trim" d="${shape}" transform="translate(6.4 6.4) scale(.8)"/>
    <path class="ticks" d="${rays}"/><text x="32" y="33" text-anchor="middle" dominant-baseline="central">${monogram(name)}</text>
    ${core ? `<path class="core c-${core}" d="M32 51l4 4-4 4-4-4z"/>` : ''}`, 'emblem');
}

const own = (name, extra = '') => {
  const slug = normName(name);
  const url = (extra && custom.get(`${slug}-${extra}`)) || custom.get(slug);
  return url ? `<img class="art photo" src="${url}" alt="" loading="lazy" decoding="async">` : '';
};

export function weaponArt(weapon) {
  return own(weapon.name) || svg('120 44', paths(WEAPON[weapon.type] || WEAPON.ar), 'gun');
}

// piece: { name, quality, slot, brand, core }
export function gearArt(piece) {
  const mine = own(piece.name, piece.slot);
  if (mine) return mine;
  if (piece.quality === 'exotic') return svg('64 64', paths(SLOT[piece.slot] || SKILL.other), 'glyph');
  return emblem(piece.quality === 'named' ? piece.brand || piece.name : piece.name, piece.core);
}

export const slotArt = slot => svg('64 64', paths(SLOT[slot] || SKILL.other), 'glyph');

export function skillArt(skill) {
  const mine = own(skill.name);
  if (mine) return mine;
  const family = String(skill.skill || '').toLowerCase();
  const key = SKILL_KEYS.find(([word]) => family.includes(word));
  return svg('64 64', paths(SKILL[key ? key[1] : 'other']), 'glyph');
}
