// Reads the tabs of the community "Division 2 Gear Spreadsheet" into clean game data.
// The sheet is written for people (merged cells, notes in the margins), so every reader
// finds its columns by header text and skips anything it does not recognise.

import { parseCSV } from './csv.js';
import { norm, normName, distance, parseBonus, statKey, toNumber } from './stats.js';
import { numbersOf, resolveText } from './effects.js';

// Tab name -> gid in the sheet.
export const TABS = {
  welcome: '1380412817',
  weapons: '0',
  weapons_named: '1574559653',
  weapon_talents: '89782728',
  gearsets: '1925112187',
  brandsets: '1006013297',
  gear_named: '195186127',
  gear_talents: '1724618107',
  skill_list: '2053261857',
  attribute_info: '412070318',
  weapon_mods: '1283569496',
};

// A tab with fewer usable rows than this is treated as broken and the snapshot is used instead.
export const MINIMUM = { weapons: 150, weaponTalents: 25, brands: 15, gearsets: 10, gear: 40, gearTalents: 25, mods: 40, skills: 20 };

export const WEAPON_TYPES = {
  ar: 'Assault Rifle', lmg: 'LMG', smg: 'SMG', shotgun: 'Shotgun', rifle: 'Rifle', mmr: 'Marksman Rifle', pistol: 'Pistol',
};
export const TYPE_DAMAGE = {
  ar: 'ar_damage', lmg: 'lmg_damage', smg: 'smg_damage', shotgun: 'shotgun_damage',
  rifle: 'rifle_damage', mmr: 'mmr_damage', pistol: 'pistol_damage',
};
export const GEAR_SLOTS = ['mask', 'backpack', 'chest', 'gloves', 'holster', 'kneepads'];
export const MOD_SLOTS = ['optic', 'magazine', 'muzzle', 'underbarrel'];

const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
const lines = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean);
const cell = (row, i) => (i >= 0 && row[i] !== undefined ? row[i] : '');

function weaponType(text) {
  const n = norm(text);
  if (/marksman|mmr/.test(n)) return 'mmr';
  if (/assault|^ar$/.test(n)) return 'ar';
  if (/light machine|lmg/.test(n)) return 'lmg';
  if (/sub ?machine|smg/.test(n)) return 'smg';
  if (/shotgun/.test(n)) return 'shotgun';
  if (/pistol/.test(n)) return 'pistol';
  if (/rifle/.test(n)) return 'rifle';
  return null;
}

function gearSlot(text) {
  const n = norm(text);
  return GEAR_SLOTS.find(s => n.startsWith(s.slice(0, 4))) || (n.startsWith('knee') ? 'kneepads' : null);
}

function coreOf(text) {
  const n = norm(text);
  if (/weapon damage/.test(n)) return 'offense';
  if (/skill tier/.test(n)) return 'utility';
  if (/armor/.test(n)) return 'defense';
  if (/any core/.test(n)) return 'any';
  return null;
}

function modSlot(text) {
  const n = norm(text);
  if (/optic|sight|scope/.test(n)) return 'optic';
  if (/mag|belt|drum|tubular/.test(n)) return 'magazine';
  if (/muzzle/.test(n)) return 'muzzle';
  if (/underbarrel|under barrel|grip|gadget/.test(n)) return 'underbarrel';
  return null;
}

// Finds the header row (the first row containing every word in `need`) and returns
// a lookup from header text to column index.
function header(rows, need) {
  const index = rows.findIndex(r => need.every(w => r.some(c => norm(c) === norm(w) || norm(c).startsWith(norm(w)))));
  if (index < 0) return null;
  const heads = rows[index].map(norm);
  const col = (name, last = false) => {
    const n = norm(name);
    const find = last ? 'findLastIndex' : 'findIndex';
    let i = heads[find](h => h === n);
    if (i < 0) i = heads[find](h => h.startsWith(n));
    return i;
  };
  return { index, col };
}

// "Talent name \n description..." -> { name, text }. Cells that are only a stat
// ("137.0% Headshot Damage") have no name.
function splitTalent(text) {
  const ls = lines(text);
  if (!ls.length) return null;
  const first = ls[0].replace(/[:\s]+$/, '');
  const looksLikeName = !/^[+-]?\d/.test(first) && first.length <= 48 && !/[.!?]$/.test(first);
  if (ls.length > 1 && looksLikeName) return { name: first, text: ls.slice(1).join('\n') };
  const inline = ls[0].match(/^(Autentico)\s+(.*)$/);
  if (inline) return { name: inline[1], text: inline[2] };
  return { name: '', text: ls.join('\n') };
}

// ---- weapons ----

function readWeapons(rows) {
  const h = header(rows, ['RPM', 'Weapon', 'HSD']);
  if (!h) return { weapons: [], classes: {} };
  const c = {
    family: h.col('Variant'), name: h.col('Weapon'), rpm: h.col('RPM'), mag: h.col('Base Mag Size'),
    reload: h.col('Empty Reload'), damage: h.col('Level 40'), range: h.col('Optimal'), slots: h.col('Mod Slots'),
    hsd: h.col('HSD'), cls: h.col('Weapon', true), fixed: h.col('Fixed second'), innate: h.col('Innate HSD'),
  };
  const weapons = [], classes = {};
  let type = null, family = '';
  for (const row of rows.slice(h.index + 1)) {
    if (flat(row[0])) { type = weaponType(row[0]) || type; }
    if (flat(cell(row, c.family))) family = flat(cell(row, c.family));

    // The small table in the margin: weapon class -> fixed attribute.
    const cls = c.cls !== c.name ? weaponType(cell(row, c.cls)) : null;
    if (cls && flat(cell(row, c.fixed)) && !classes[cls]) {
      const bonus = parseBonus(cell(row, c.fixed))[0];
      classes[cls] = bonus ? { stat: bonus[0], max: bonus[1] } : null;
    }

    const full = flat(cell(row, c.name));
    const rpm = toNumber(cell(row, c.rpm)), damage = toNumber(cell(row, c.damage));
    if (!full || !type || isNaN(rpm) || isNaN(damage)) continue;
    const name = flat(full.replace(/\([^)]*\)/g, ' '));
    const base = (full.match(/\(([^)]*)\)/g) || []).map(p => p.slice(1, -1)).find(p => !/^pts$/i.test(p)) || '';
    const slotText = flat(cell(row, c.slots));
    const fixedMods = /n\/?a/i.test(slotText);
    const none = /^0/.test(slotText);
    weapons.push({
      name, base, family, type, pts: /\(pts\)/i.test(full),
      rpm, damage, mag: parseFloat(flat(cell(row, c.mag)).replace(/,/g, '')) || 1,
      reload: toNumber(cell(row, c.reload)) || 0, range: toNumber(cell(row, c.range)) || 0,
      hsd: toNumber(cell(row, c.hsd)) || 0,
      slots: fixedMods ? null : {
        optic: !none && !slotText.includes('&'), magazine: !none && !slotText.includes('$'),
        muzzle: !none && !slotText.includes('!'), underbarrel: !none && !slotText.includes('#'),
      },
      quality: 'high-end', talent: null, fixedMods: [], unique: '',
    });
  }
  return { weapons, classes };
}

function readNamedWeapons(rows) {
  const h = header(rows, ['Variant', 'Name', 'Exotic Mods']);
  if (!h) return [];
  const c = { variant: h.col('Variant'), name: h.col('Name'), talent: h.col('Talent'), mods: h.col('Exotic Mods'), minor: h.col('Minor') };
  const out = [];
  let pending = null;
  for (const row of rows.slice(h.index + 1)) {
    const name = flat(cell(row, c.name)), talent = cell(row, c.talent).trim();
    if (talent) {
      const entry = {
        name, variant: flat(cell(row, c.variant)), talent: splitTalent(talent),
        mods: cell(row, c.mods), exotic: !!(flat(cell(row, c.mods)) || flat(cell(row, c.minor))),
      };
      out.push(entry);
      pending = name ? null : entry;
    } else if (name && pending) {
      pending.name = name;
      pending = null;
    }
  }
  return out.filter(e => e.name);
}

function readWeaponTalents(rows) {
  const h = header(rows, ['Perfect Talent', 'Description']);
  if (!h) return [];
  const c = { name: h.col('Perfect Talent') - 1, perfect: h.col('Perfect Talent'), text: h.col('Description'), group: h.col('Multiplier') };
  const byName = new Map();
  let types = weaponSection(cell(rows[h.index], c.name));
  for (const row of rows.slice(h.index + 1)) {
    const name = flat(cell(row, c.name)), text = cell(row, c.text).trim();
    if (!name) continue;
    if (!text) { types = weaponSection(name); continue; }
    const known = byName.get(norm(name));
    if (known) {
      if (types && known.types) known.types = [...new Set([...known.types, ...types])];
      else known.types = null;
      continue;
    }
    const perfect = flat(cell(row, c.perfect));
    byName.set(norm(name), {
      name, perfect: /^-*$/.test(perfect) ? '' : perfect, text, group: flat(cell(row, c.group)),
      types: types ? [...types] : null, // null = every weapon class
    });
  }
  return [...byName.values()];
}

function weaponSection(text) {
  if (/all/i.test(text)) return null;
  const type = weaponType(text);
  return type ? [type] : null;
}

function readWeaponMods(rows) {
  const h = header(rows, ['Slot', 'Mod', 'Bonus']);
  if (!h) return [];
  const c = { type: h.col('Type'), rail: h.col('Slot'), name: h.col('Mod'), bonus: h.col('Bonus'), penalty: h.col('Penalty') };
  const out = [];
  let slot = 'optic', rail = '';
  for (const row of rows.slice(h.index + 1)) {
    if (flat(cell(row, c.type))) slot = modSlot(cell(row, c.type)) || slot;
    if (flat(cell(row, c.rail))) rail = flat(cell(row, c.rail));
    const name = flat(cell(row, c.name));
    if (!name) continue;
    const texts = [...lines(cell(row, c.bonus)), ...lines(cell(row, c.penalty))].filter(l => /\d/.test(l));
    out.push({ name, slot, rail, text: texts.join(', '), effects: texts.flatMap(parseBonus) });
  }
  return out;
}

// ---- gear ----

function readBrands(rows) {
  const h = header(rows, ['Brand', '1pc', '2pc', '3pc']);
  if (!h) return [];
  const start = h.col('Brand');
  const c = { core: h.col('Core'), b1: h.col('1pc'), b2: h.col('2pc'), b3: h.col('3pc') };
  const out = [];
  for (const row of rows.slice(h.index + 1)) {
    // The name sits one column right of the "Brand" header (merged header cell).
    const name = flat(cell(row, start + 1)) || flat(cell(row, start));
    const bonuses = [c.b1, c.b2, c.b3].map(i => flat(cell(row, i)));
    if (!name || !bonuses.some(Boolean)) continue;
    out.push({
      name, kind: 'brand', core: coreOf(cell(row, c.core)) || 'offense',
      bonuses: bonuses.map((text, i) => ({ pieces: i + 1, text, effects: parseBonus(text) })),
    });
  }
  return out;
}

function readGearsets(rows) {
  const h = header(rows, ['Name', '2pc', '3pc', '4pc']);
  if (!h) return [];
  const c = {
    name: h.col('Name'), core: h.col('Core'), b2: h.col('2pc'), b3: h.col('3pc'), b4: h.col('4pc'),
    chest: h.col('Chest'), backpack: h.col('Backpack'), group: h.col('Talent Multiplier'),
  };
  const out = [];
  let pending = null;
  for (const row of rows.slice(h.index + 1)) {
    const four = cell(row, c.b4).trim();
    if (four) {
      pending = {
        name: '', kind: 'gearset', core: coreOf(cell(row, c.core)) || 'offense',
        bonuses: [c.b2, c.b3].map((i, n) => ({ pieces: n + 2, text: flat(cell(row, i)), effects: parseBonus(cell(row, i)) })),
        four: splitTalent(four), chest: splitTalent(cell(row, c.chest)), backpack: splitTalent(cell(row, c.backpack)),
        group: flat(cell(row, c.group)),
      };
      out.push(pending);
    }
    // The set's name is written on the last row of its block.
    const name = flat(cell(row, c.name)).replace(/\([^)]*\)/g, '').replace(/[\s/]+$/, '');
    if (name && pending && !pending.name) pending.name = flat(name);
  }
  return out.filter(s => s.name);
}

function readGearTalents(rows) {
  const h = header(rows, ['Talent', 'Perfect Talent', 'Description']);
  if (!h) return [];
  const c = { name: h.col('Talent'), perfect: h.col('Perfect Talent'), text: h.col('Description'), group: h.col('Multiplier') };
  const out = [];
  let slot = 'chest';
  for (const row of rows.slice(h.index + 1)) {
    if (flat(row[0])) slot = gearSlot(row[0]) || slot;
    const name = flat(cell(row, c.name)), text = cell(row, c.text).trim();
    if (!name || !text) continue;
    const perfect = flat(cell(row, c.perfect));
    out.push({ name, perfect: /^-*$/.test(perfect) ? '' : perfect, slot, text, group: flat(cell(row, c.group)) });
  }
  return out;
}

// One attribute cell of a named or exotic piece.
function readMinor(text) {
  const t = flat(text);
  if (!t || /^-+$/.test(t)) return null;
  if (/mod slot/i.test(t)) return { kind: 'mod' };
  if (/any basic/i.test(t)) {
    const color = /red/i.test(t) ? 'offense' : /blue/i.test(t) ? 'defense' : /yellow/i.test(t) ? 'utility' : null;
    return { kind: 'any', color };
  }
  if (/skill tier/i.test(t)) return { kind: 'fixed', stat: 'skill_tier', value: 1, text: t };
  const bonus = parseBonus(t)[0];
  if (bonus) return { kind: 'fixed', stat: bonus[0], value: bonus[1], text: t };
  const stat = t.length < 30 ? statKey(t) : null; // a bare name, value comes from the attribute table
  return stat ? { kind: 'fixed', stat, value: null, text: t } : null;
}

function readNamedGear(rows) {
  const h = header(rows, ['Type', 'Brand', 'Name', 'Talent']);
  if (!h) return [];
  const c = {
    brand: h.col('Brand'), name: h.col('Name'), talent: h.col('Talent'), text: h.col('Talent / Named'),
    core: h.col('Core'), m1: h.col('Minor 1'), m2: h.col('Minor 2'), m3: h.col('Minor 3'),
  };
  const out = [];
  let slot = null, exotic = false, pending = null;
  for (const row of rows.slice(h.index + 1)) {
    if (row.some(x => /^exotics?$/i.test(flat(x)))) { exotic = true; continue; }
    if (flat(row[0])) slot = gearSlot(row[0]) || slot;
    const name = flat(cell(row, c.name));
    const core = flat(cell(row, c.core));
    const hasData = core || flat(cell(row, c.text));
    if (hasData && slot) {
      const talentName = flat(lines(cell(row, c.talent)).join(' ').replace(/(\s*\.{3,}\s*)+/g, '… ')).replace(/…$/, '');
      const text = cell(row, c.text).trim();
      const hasTalent = talentName && !/^-+$/.test(talentName);
      const minors = [c.m1, c.m2, c.m3].map(i => readMinor(cell(row, i))).filter(Boolean);
      const entry = {
        name, slot, quality: exotic ? 'exotic' : 'named', brand: exotic ? '' : flat(cell(row, c.brand)),
        core: coreOf(core) || 'offense',
        talent: hasTalent ? { name: talentName, text } : null,
        perk: hasTalent ? '' : flat(text),
        minors,
      };
      out.push(entry);
      pending = name ? null : entry;
    } else if (name && pending) {
      pending.name = name;
      pending = null;
    }
  }
  return out.filter(e => e.name);
}

// ---- attributes, watch, skills ----

function readAttributes(rows) {
  const h = header(rows, ['Slot', 'Group', 'Attribute', 'Max']);
  const out = { weaponCore: 15, classes: {}, weaponMinors: [], cores: {}, gearMinors: [], gearMods: [], watch: [] };
  if (!h) return out;
  const c = { slot: h.col('Slot'), group: h.col('Group'), attr: h.col('Attribute'), max: h.col('Max'), proto: h.col('Prototype Max') };
  let slot = '', group = '';
  for (const row of rows.slice(h.index + 1)) {
    if (flat(cell(row, c.slot))) { slot = norm(cell(row, c.slot)); group = ''; }
    if (flat(cell(row, c.group))) group = norm(cell(row, c.group));
    const attr = flat(cell(row, c.attr));
    // The watch section keeps its value one column to the left of "Max".
    const maxText = flat(cell(row, c.max)) || flat(cell(row, c.max - 1));
    const max = toNumber(maxText);
    if (!attr || isNaN(max)) continue;
    const pct = maxText.includes('%');
    const color = /offens/.test(group) ? 'offense' : /defens/.test(group) ? 'defense' : /skill|utility/.test(group) ? 'utility' : 'offense';
    // The maximum on a Prototype item, where the sheet knows it (null = not listed).
    const protoValue = toNumber(cell(row, c.proto));
    const proto = isNaN(protoValue) || protoValue < max ? null : protoValue;

    if (slot === 'weapon') {
      if (attr.includes(':')) {
        const [who, what] = attr.split(':');
        const type = weaponType(who);
        if (/all weapons/i.test(who)) { out.weaponCore = max; out.weaponCoreProto = proto; }
        else if (type) out.classes[type] = { stat: statKey(what, pct), max, proto };
      } else if (/minor/.test(group)) out.weaponMinors.push({ stat: statKey(attr, pct), max, proto });
    } else if (slot === 'gear') {
      if (/core/.test(group)) out.cores[coreOf(attr) || 'offense'] = { stat: statKey(attr, pct), max, proto };
      else out.gearMinors.push({ stat: statKey(attr, pct), max, color, proto });
    } else if (slot.startsWith('gear mod')) {
      out.gearMods.push({ stat: statKey(attr, pct), max, color });
    } else if (/watch/.test(slot)) {
      const category = /offens/.test(group) ? 'Offensive' : /defens/.test(group) ? 'Defensive' : /skill/.test(group) ? 'Skill' : 'Handling';
      out.watch.push({ stat: statKey(attr, pct), max, category });
    }
  }
  return out;
}

function readSkills(rows) {
  const h = header(rows, ['Skill', 'Variant', 'Stat']);
  if (!h) return [];
  const c = { skill: h.col('Skill'), variant: h.col('Variant'), stat: h.col('Stat'), base: h.col('Base Stats') };
  const out = [];
  let skill = '', current = null;
  for (const row of rows.slice(h.index + 1)) {
    const stat = flat(cell(row, c.stat));
    if (!stat || stat.startsWith('▶') || /quick links/i.test(stat)) continue;
    if (flat(cell(row, c.skill))) skill = flat(cell(row, c.skill));
    const variant = flat(cell(row, c.variant));
    if (variant) { current = { skill, variant, name: `${variant} ${skill}`, stats: [] }; out.push(current); }
    if (!current || !skill) continue;
    const tiers = [1, 2, 3, 4, 5, 6].map(t => flat(cell(row, c.base + t)));
    current.stats.push({ name: stat, base: flat(cell(row, c.base)), tiers, overcharge: flat(cell(row, c.base + 7)) });
  }
  return out;
}

function readMeta(rows) {
  const i = rows.findIndex(r => /^changelog$/i.test(flat(r[0])));
  const row = i >= 0 ? rows[i + 1] : null;
  return row ? { updated: flat(row[3]), patch: flat(row[4]), note: flat(row[0]) } : {};
}

// ---- putting it together ----

const matchName = (list, name, key = 'name') => {
  const n = normName(name);
  if (!n) return null;
  return list.find(x => normName(x[key]) === n)
    || list.find(x => { const m = normName(x[key]); return m.length > 3 && (m.startsWith(n) || n.startsWith(m)); })
    || (n.length >= 6 ? list.find(x => distance(normName(x[key]), n) <= 2) : null)
    || null;
};

const stripPerfect = name => flat(String(name || '').replace(/^pee?rfect(ly|ion)?\s+/i, '').replace(/\s+perfect(ion)?$/i, ''));

// Finds the standard talent a "Perfect X" on a named item refers to.
function findTalent(talents, name) {
  const n = norm(name);
  return talents.find(t => norm(t.perfect) === n)
    || talents.find(t => norm(t.name) === n)
    || talents.find(t => norm(t.name) === norm(stripPerfect(name)))
    || talents.find(t => t.perfect && distance(norm(t.perfect), n) <= 2)
    || talents.find(t => distance(norm(t.name), norm(stripPerfect(name))) <= 2)
    || null;
}

// Parses every tab. `texts` maps tab name -> CSV text.
export function readSheet(texts) {
  const rows = Object.fromEntries(Object.keys(TABS).map(t => [t, parseCSV(texts[t] || '')]));
  const { weapons, classes } = readWeapons(rows.weapons);
  const attributes = readAttributes(rows.attribute_info);
  for (const [type, value] of Object.entries(classes)) if (!(type in attributes.classes) && value) attributes.classes[type] = value;

  const weaponTalents = readWeaponTalents(rows.weapon_talents);
  const gearTalents = readGearTalents(rows.gear_talents);

  // Named and exotic weapons take their stats from the Weapons tab and their talent from here.
  for (const entry of readNamedWeapons(rows.weapons_named)) {
    const weapon = matchName(weapons, entry.name);
    if (!weapon) continue;
    weapon.quality = entry.exotic ? 'exotic' : 'named';
    const talent = entry.talent;
    if (talent && talent.name && !/^(core|secondary) attribute$/i.test(talent.name)) {
      const standard = entry.exotic ? null : findTalent(weaponTalents, talent.name);
      weapon.talent = { name: talent.name, text: talent.text, standard: standard?.name || '', perfect: !!standard };
    } else if (talent) {
      weapon.unique = flat(talent.text);
      weapon.uniqueKind = /^core/i.test(talent.name) ? 'core' : /^secondary/i.test(talent.name) ? 'class' : '';
      weapon.uniqueEffects = parseBonus(talent.text.split('\n')[0].split('&')[0]);
    }
    for (const line of lines(entry.mods)) {
      const [, where, what] = line.match(/^([^:]+):\s*(.+)$/) || [];
      if (!where) continue;
      if (/main attribute/i.test(where)) { weapon.uniqueKind = 'class'; weapon.uniqueEffects = parseBonus(what); weapon.unique = flat(what); continue; }
      const slot = modSlot(where);
      if (slot) weapon.fixedMods.push({ slot, text: flat(what), effects: /\d/.test(what) ? parseBonus(what) : [] });
    }
    if (entry.exotic) weapon.slots = null;
  }

  const brands = readBrands(rows.brandsets);
  const gearsets = readGearsets(rows.gearsets);
  const gear = readNamedGear(rows.gear_named);
  for (const piece of gear) {
    if (piece.brand) piece.brand = matchName(brands, piece.brand.split('\n')[0])?.name || piece.brand;
    if (piece.talent) {
      const standard = piece.quality === 'named' ? findTalent(gearTalents, piece.talent.name) : null;
      piece.talent.standard = standard?.name || '';
      piece.talent.perfect = !!standard;
    }
    for (const minor of piece.minors) {
      if (minor.kind === 'fixed' && minor.value === null) {
        minor.value = attributes.gearMinors.find(a => a.stat === minor.stat)?.max ?? 0;
      }
    }
  }

  return {
    meta: readMeta(rows.welcome),
    weapons, weaponTalents, weaponMods: readWeaponMods(rows.weapon_mods),
    brands, gearsets, gear, gearTalents, attributes, skills: readSkills(rows.skill_list),
  };
}

// Adds items from our own extra tables (data/extra_weapons.csv, data/extra_gear.csv): things
// the sheet does not list yet. Once the sheet has an item of the same name, the sheet wins.
export function addExtras(db, extras) {
  const known = (list, name) => list.some(x => normName(x.name) === normName(name));
  const text = t => String(t || '').replace(/\\n/g, '\n');

  for (const x of extras.weapons || []) {
    const type = weaponType(x.type);
    if (!type || known(db.weapons, x.name)) continue;
    const from = x.copy ? matchName(db.weapons, x.copy) : null;
    const given = k => !isNaN(toNumber(x[k]));
    const value = k => (given(k) ? toNumber(x[k]) : from ? from[k] : 0);
    const exotic = norm(x.quality) === 'exotic';
    const mods = String(x.mods || '').split('|').map(line => {
      const [, where, what] = line.trim().match(/^([^:]+):\s*(.+)$/) || [];
      const slot = where && modSlot(where);
      return slot ? { slot, text: flat(what), effects: /\d/.test(what) ? parseBonus(what) : [] } : null;
    }).filter(Boolean);
    db.weapons.push({
      name: x.name, base: from ? from.name : '', family: x.family || from?.family || x.name, type, pts: false,
      rpm: value('rpm'), damage: value('damage'), mag: value('mag') || 1, reload: value('reload'),
      range: value('range'), hsd: value('hsd'),
      slots: exotic ? null : (from?.slots || { optic: true, magazine: true, muzzle: true, underbarrel: true }),
      quality: exotic ? 'exotic' : 'named',
      talent: x.talent ? { name: x.talent, text: text(x.talent_text), standard: '', perfect: false } : null,
      fixedMods: exotic ? mods : [], unique: '',
      // Which of its own mod bonuses the numbers above already contain.
      baked: String(x.includes || '').split(/[;|, ]+/).filter(Boolean),
      extra: true, source: x.source || '',
      copied: from ? ['damage', 'rpm', 'mag', 'reload'].filter(k => !given(k)) : [],
    });
  }

  for (const x of extras.gear || []) {
    const slot = gearSlot(x.slot);
    if (!slot || known(db.gear, x.name)) continue;
    const exotic = norm(x.quality) === 'exotic';
    db.gear.push({
      name: x.name, slot, quality: exotic ? 'exotic' : 'named',
      brand: exotic ? '' : (matchName(db.brands, x.brand)?.name || x.brand || ''),
      core: coreOf(x.core) || 'offense',
      talent: x.talent ? { name: x.talent, text: text(x.talent_text), standard: '', perfect: false } : null,
      perk: x.perk || '',
      minors: String(x.minors || '').split('|').map(readMinor).filter(Boolean),
      extra: true, source: x.source || '',
    });
  }
  return db;
}

export function countsOf(db) {
  return {
    weapons: db.weapons.length, weaponTalents: db.weaponTalents.length, brands: db.brands.length,
    gearsets: db.gearsets.length, gear: db.gear.length, gearTalents: db.gearTalents.length,
    mods: db.weaponMods.length, skills: db.skills.length,
  };
}

export { numbersOf, resolveText };
