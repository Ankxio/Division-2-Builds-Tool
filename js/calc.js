export const SLOTS = ['mask', 'backpack', 'chest', 'gloves', 'holster', 'kneepads'];
export const MOD_SLOTS = ['mask', 'backpack', 'chest'];
export const TALENT_SLOTS = ['backpack', 'chest'];
export const CORES = ['offense', 'defense', 'utility'];
export const WEAPON_MOD_SLOTS = ['optic', 'muzzle', 'underbarrel', 'magazine'];

// "chc:10;chd:15" -> [['chc', 10], ['chd', 15]]
export function parseEffects(str) {
  const out = [];
  for (const part of String(str || '').split(/[;|]/)) {
    const [k, v] = part.split(':');
    const val = parseFloat(v);
    if (k && k.trim() && !isNaN(val)) out.push([k.trim(), val]);
  }
  return out;
}

// Additive stats plus a list of amplifiers ("amp"), which multiply each other.
class Bag {
  constructor(from) {
    this.stats = from ? { ...from.stats } : {};
    this.amps = from ? [...from.amps] : [];
  }
  add(key, value) {
    if (!key || !value) return;
    if (key === 'amp') this.amps.push(value);
    else this.stats[key] = (this.stats[key] || 0) + value;
  }
  addAll(effects) {
    for (const [k, v] of parseEffects(effects)) this.add(k, v);
  }
  get(key) { return this.stats[key] || 0; }
}

export function buildIndex(db) {
  const by = (rows, key = 'name') => Object.fromEntries(rows.map(r => [r[key], r]));
  const settings = Object.fromEntries(db.settings.map(r => [r.key, r.value]));
  return {
    settings,
    num: (key, fallback = 0) => {
      const v = parseFloat(settings[key]);
      return isNaN(v) ? fallback : v;
    },
    stats: by(db.stats, 'key'),
    brands: by(db.brands),
    gear: by(db.gear),
    weapons: by(db.weapons),
    types: by(db.weapon_types, 'key'),
    weaponTalents: by(db.weapon_talents),
    weaponMods: by(db.weapon_mods),
    gearTalents: by(db.gear_talents),
    specs: by(db.specializations),
    skills: by(db.skills),
  };
}

export function attrMax(db, where, stat) {
  const row = db.attributes.find(a => a.where === where && a.stat === stat);
  return row ? parseFloat(row.max) || 0 : 0;
}

const valueOr = (v, fallback) => (v === undefined || v === null || v === '' || isNaN(v) ? fallback : Number(v));

// Turns a saved gear choice into what that piece is: its brand, how many
// attributes are free to pick, and where its talent comes from.
// Item ids are "b:<brand or gear set>" for a normal piece, "g:<name>" for named and exotic.
export function resolvePiece(db, ix, slot, piece) {
  if (!piece || !piece.item) return null;
  const [kind, name] = [piece.item.slice(0, 1), piece.item.slice(2)];
  const canTalent = TALENT_SLOTS.includes(slot);

  if (kind === 'b') {
    const brand = ix.brands[name];
    if (!brand) return null;
    const isSet = brand.type === 'gearset';
    let talent = null;
    if (canTalent && isSet) talent = db.gear_talents.find(t => t.set === name && t.slot === slot) || null;
    else if (canTalent) talent = ix.gearTalents[piece.talent] || null;
    return {
      name: `${name} ${slot}`, brand: name, quality: isSet ? 'gearset' : 'high-end',
      core: CORES.includes(piece.core) ? piece.core : (brand.core || 'offense'), coreFixed: false,
      fixed: '', free: isSet ? 1 : 2, hasMod: MOD_SLOTS.includes(slot),
      talent, chooseTalent: canTalent && !isSet,
    };
  }

  const row = ix.gear[name];
  if (!row || row.slot !== slot) return null;
  return {
    name, brand: row.brand, quality: row.quality,
    core: row.core === 'all' ? 'all' : (CORES.includes(piece.core) ? piece.core : (row.core || 'offense')),
    coreFixed: row.core === 'all',
    fixed: row.attrs, free: parseInt(row.free_attrs, 10) || 0, hasMod: MOD_SLOTS.includes(slot),
    talent: row.talent ? { name: row.talent, text: row.talent_text, effects: row.talent_effects } : null,
    chooseTalent: false,
  };
}

export function compute(db, ix, state) {
  const off = state.off || {};
  const bag = new Bag();
  const cores = { offense: 0, defense: 0, utility: 0 };
  const counts = {};

  const spec = ix.specs[state.spec];
  if (spec) bag.addAll(spec.effects);

  for (const row of db.watch) {
    const levels = parseFloat(row.levels) || 50;
    const level = Math.max(0, Math.min(levels, valueOr(state.watch?.[row.stat], 0)));
    bag.add(row.stat, (parseFloat(row.max) || 0) * level / levels);
  }

  for (const slot of SLOTS) {
    const piece = state.gear?.[slot];
    const r = resolvePiece(db, ix, slot, piece);
    if (!r) continue;
    if (ix.brands[r.brand]) counts[r.brand] = (counts[r.brand] || 0) + 1;
    for (const core of (r.core === 'all' ? CORES : [r.core])) {
      cores[core]++;
      bag.addAll(ix.settings[`core_${core}`]);
    }
    bag.addAll(r.fixed);
    for (let i = 0; i < r.free; i++) {
      const stat = piece[`a${i}`];
      if (stat) bag.add(stat, valueOr(piece[`a${i}v`], attrMax(db, 'gear', stat)));
    }
    if (r.hasMod && piece.mod) bag.add(piece.mod, valueOr(piece.modv, attrMax(db, 'gearmod', piece.mod)));
    if (r.talent && !off[`gt:${slot}`]) bag.addAll(r.talent.effects);
  }

  const sets = Object.entries(counts).map(([name, count]) => {
    const brand = ix.brands[name];
    const bonuses = [];
    for (const n of [1, 2, 3, 4]) {
      const effects = brand[`bonus${n}`];
      const title = brand[`bonus${n}_name`];
      if (!effects && !title) continue;
      const toggle = n === 4 ? `set:${name}` : null;
      const reached = count >= n;
      if (reached && !(toggle && off[toggle])) bag.addAll(effects);
      bonuses.push({ n, effects, title, text: brand[`bonus${n}_text`] || '', reached, toggle });
    }
    return { name, count, type: brand.type, bonuses };
  });

  const s = k => bag.get(k);
  const totals = {
    armor: (ix.num('base_armor') + s('armor')) * (1 + s('armor_pct') / 100),
    health: (ix.num('base_health') + s('health')) * (1 + s('health_pct') / 100),
    chc: Math.min(ix.num('chc_cap', 60), ix.num('base_chc') + s('chc')),
    chd: ix.num('base_chd', 25) + s('chd'),
    skillTier: Math.min(6, s('skill_tier')),
  };

  const weapons = (state.weapons || []).map((w, i) => weaponResult(db, ix, w, bag, off[`wt:${i}`]));
  return { bag, cores, sets, totals, weapons };
}

function weaponResult(db, ix, w, globalBag, talentOff) {
  const row = w && ix.weapons[w.id];
  if (!row) return null;
  const type = ix.types[row.type] || {};
  const bag = new Bag(globalBag);

  bag.add(type.damage_stat, ix.num('weapon_core', 15));
  bag.add(type.class_stat, parseFloat(type.class_value) || 0);
  bag.addAll(row.effects);
  if (w.attr) bag.add(w.attr, valueOr(w.attrv, attrMax(db, 'weapon', w.attr)));
  for (const slot of WEAPON_MOD_SLOTS) {
    const mod = ix.weaponMods[w.mods?.[slot]];
    if (mod) bag.addAll(mod.effects);
  }
  const talent = ix.weaponTalents[row.talent || w.talent] || null;
  if (talent && !talentOff) bag.addAll(talent.effects);

  const s = k => bag.get(k);
  const weaponDamage = s('weapon_damage') + s(type.damage_stat);
  const amp = bag.amps.reduce((m, a) => m * (1 + a / 100), 1);
  const chc = Math.min(ix.num('chc_cap', 60), ix.num('base_chc') + s('chc'));
  const chd = ix.num('base_chd', 25) + s('chd');
  const hsd = (parseFloat(type.hsd) || 0) + s('hsd');
  const body = (parseFloat(row.damage) || 0) * (1 + weaponDamage / 100) * amp;
  const rpm = (parseFloat(row.rpm) || 1) * (1 + s('rof') / 100);
  const mag = Math.max(1, Math.round((parseFloat(row.mag) || 1) * (1 + s('mag_size') / 100) + s('mag_flat')));
  const reload = (parseFloat(row.reload) || 0) / (1 + Math.max(-90, s('reload_speed') + s('weapon_handling')) / 100);

  return {
    name: row.name, row, type, talent, weaponDamage, amp, amps: bag.amps, chc, chd, hsd,
    body, crit: body * (1 + chd / 100), headshot: body * (1 + hsd / 100),
    headshotCrit: body * (1 + (chd + hsd) / 100),
    rpm, mag, reload,
    dta: s('dta'), dth: s('dth'), ooc: s('ooc'),
    accuracy: s('accuracy') + s('weapon_handling'), stability: s('stability') + s('weapon_handling'),
  };
}

// Average damage of one bullet. Crit and headshot bonuses add together in this game.
export function averageBullet(w, { headshotChance = 0, outOfCover = false } = {}) {
  const avg = w.body * (1 + (w.chc / 100) * (w.chd / 100) + (headshotChance / 100) * (w.hsd / 100));
  return avg * (outOfCover ? 1 + w.ooc / 100 : 1);
}

export function dps(w, opts) {
  const bullet = averageBullet(w, opts);
  const emptyTime = w.mag / (w.rpm / 60);
  return {
    bullet,
    burst: bullet * w.rpm / 60,
    sustained: bullet * w.mag / (emptyTime + w.reload),
  };
}

// Points of [seconds, total damage] for the chart, with flat stretches while reloading.
export function timeline(w, opts, seconds) {
  const bullet = averageBullet(w, opts);
  const gap = 60 / w.rpm;
  const points = [[0, 0]];
  let t = 0, total = 0;
  while (t <= seconds) {
    for (let i = 0; i < w.mag && t <= seconds; i++) {
      points.push([t, total]);
      total += bullet;
      points.push([t, total]);
      t += gap;
    }
    t += w.reload - gap;
  }
  points.push([seconds, total]);
  return points;
}

export function timeToKill(w, opts, target) {
  const bullet = averageBullet(w, opts);
  if (bullet <= 0) return null;
  const perArmor = bullet * (1 + w.dta / 100);
  const perHealth = bullet * (1 + w.dth / 100);
  let armor = Math.max(0, target.armor || 0), health = Math.max(0, target.health || 0);
  const gap = 60 / w.rpm;
  let bullets = 0, time = 0, inMag = w.mag;
  while (health > 0 && bullets < 100000) {
    if (bullets > 0) {
      if (inMag === 0) { time += w.reload; inMag = w.mag; }
      else time += gap;
    }
    bullets++; inMag--;
    if (armor > 0) {
      armor -= perArmor;
      // Damage left over after the armor breaks carries into health.
      if (armor < 0) { health -= (-armor / perArmor) * perHealth; armor = 0; }
    } else health -= perHealth;
  }
  return { bullets, time, reloads: Math.floor((bullets - 1) / w.mag) };
}
