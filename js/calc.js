// All the maths. Works on the data from sheet.js/data.js and a build (the "state").

import { GEAR_SLOTS, MOD_SLOTS, TYPE_DAMAGE } from './sheet.js';
import { norm } from './stats.js';
import { numbersOf, resolveText, evaluate, termValue } from './effects.js';

export const CORES = ['offense', 'defense', 'utility'];
const HAS_MOD = ['mask', 'backpack', 'chest'];
const HAS_TALENT = ['backpack', 'chest'];
const EFFICIENCY = ['skill_damage', 'skill_haste', 'skill_duration', 'skill_health', 'repair_skills', 'status_effects'];
const HANDLING = ['accuracy', 'stability', 'reload_speed', 'swap_speed'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const or = (v, fallback) => (v === undefined || v === null || v === '' || isNaN(v) ? fallback : Number(v));

// Additive stats, amplifiers (which multiply each other) and class-only bonuses.
class Bag {
  constructor(from) {
    this.stats = from ? { ...from.stats } : {};
    this.amps = from ? [...from.amps] : [];
    this.typed = from ? [...from.typed] : [];
  }
  add(stat, value, types = null) {
    if (!stat || !value) return;
    if (types) this.typed.push({ stat, value, types });
    else if (stat === 'amp') this.amps.push(value);
    else this.stats[stat] = (this.stats[stat] || 0) + value;
  }
  addAll(pairs) { for (const [stat, value] of pairs || []) this.add(stat, value); }
  // Folds in the class-only bonuses that match this weapon class.
  forType(type) {
    const bag = new Bag(this);
    bag.typed = [];
    for (const t of this.typed) if (type && t.types.includes(type)) bag.add(t.stat, t.value);
    return bag;
  }
  // Totals with skill efficiency and weapon handling spread to the stats they feed.
  totals() {
    const s = { ...this.stats };
    for (const k of EFFICIENCY) s[k] = (s[k] || 0) + (s.skill_efficiency || 0);
    for (const k of HANDLING) s[k] = (s[k] || 0) + (s.weapon_handling || 0);
    return s;
  }
}

// ---- gear ----

export const attrMax = (list, stat) => list.find(a => a.stat === stat)?.max ?? 0;

// Prototype items roll higher: the normal maximum becomes the minimum and the new maximum is
// up to 1.5 times higher. The sheet lists the real prototype maximum for some attributes;
// for the rest, 1.5 times the normal maximum is used and marked as an estimate.
const round2 = v => Math.round(v * 100) / 100;
export const limitOf = (entry, proto) => (!entry ? 0 : !proto ? entry.max : entry.proto ?? round2(entry.max * 1.5));
export const isEstimate = (entry, proto) => !!entry && proto && entry.proto == null;

// The augment on a Prototype item. Values come from data/augments.csv; where the game's
// numbers are not published the value the player typed in is used.
export function augmentOf(db, item) {
  const row = item?.p && db.by.augment.get(item.g);
  if (!row) return null;
  const level = clamp(Math.round(or(item.gl, 10)), 1, 10);
  const first = parseFloat(row.level1), step = parseFloat(row.per_level);
  const known = !isNaN(first);
  const value = known ? round2(first + (isNaN(step) ? 0 : step) * (level - 1)) : Math.max(0, or(item.gv, 0));
  return { name: row.name, text: row.text, unit: row.unit || '%', stat: row.stat, level, value, known };
}

// What a saved gear choice is: its cores, attributes, mod slots and talent.
// Item ids: "b:<brand>", "s:<gear set>", "g:<named or exotic piece>".
export function resolveGear(db, slot, piece) {
  if (!piece?.item) return null;
  const kind = piece.item[0], name = piece.item.slice(2);
  const A = db.attributes;
  let r;
  if (kind === 'g') {
    const g = db.by.gear.get(name);
    if (!g || g.slot !== slot) return null;
    const free = g.minors.filter(m => m.kind === 'any');
    r = {
      name: g.name, quality: g.quality, set: db.by.set.has(g.brand) ? g.brand : '', brand: g.brand,
      defaultCore: CORES.includes(g.core) ? g.core : 'offense',
      fixed: g.minors.filter(m => m.kind === 'fixed'), freeColors: free.map(m => m.color),
      modCount: Math.max(g.minors.filter(m => m.kind === 'mod').length, HAS_MOD.includes(slot) ? 1 : 0),
      perk: g.perk, talent: g.talent, chooseTalent: false, setTalent: null,
    };
  } else {
    const set = db.by.set.get(name);
    if (!set || (kind === 's') !== (set.kind === 'gearset')) return null;
    const isSet = set.kind === 'gearset';
    r = {
      name: set.name, quality: isSet ? 'gearset' : 'high-end', set: set.name, brand: set.name,
      defaultCore: set.core, fixed: [], freeColors: isSet ? [null] : [null, null],
      modCount: HAS_MOD.includes(slot) ? 1 : 0, perk: '',
      talent: null, chooseTalent: !isSet && HAS_TALENT.includes(slot),
      setTalent: isSet && HAS_TALENT.includes(slot) ? set[slot] : null,
    };
    if (r.chooseTalent && piece.t) {
      const std = db.by.gearTalent.get(piece.t);
      if (std && std.slot === slot) r.talent = { name: std.name, text: resolveText(std.text), standard: std.name, perfect: false, own: false };
    }
  }

  // Exotics cannot be Prototype.
  r.canProto = r.quality !== 'exotic';
  r.proto = r.canProto && !!piece.p;
  r.augment = r.proto ? augmentOf(db, piece) : null;
  r.extra = kind === 'g' && !!db.by.gear.get(name).extra;
  r.source = kind === 'g' ? db.by.gear.get(name).source || '' : '';

  const grade = clamp(or(piece.e, 0), 0, db.num('expertise_max', 30));
  const armorBoost = 1 + grade * db.num('expertise_armor', 1) / 100;
  const coreType = CORES.includes(piece.c) ? piece.c : r.defaultCore;
  const core = A.cores[coreType] || { stat: 'weapon_damage', max: 15 };
  r.coreType = coreType;
  r.coreMax = limitOf(core, r.proto);
  r.coreEstimate = isEstimate(core, r.proto);
  r.cores = [{ type: coreType, stat: core.stat, value: clamp(or(piece.cv, r.coreMax), 0, r.coreMax) * (core.stat === 'armor' ? armorBoost : 1) }];
  r.attrs = [];
  for (const f of r.fixed) {
    // Extra cores on pieces like Memento are listed with the attributes.
    const extra = f.stat === 'armor' ? 'defense' : f.stat === 'skill_tier' ? 'utility' : null;
    if (extra) r.cores.push({ type: extra, stat: f.stat, value: f.value * (f.stat === 'armor' ? armorBoost : 1), fixed: true });
    else r.attrs.push({ stat: f.stat, value: f.value, fixed: true });
  }
  r.free = r.freeColors.map((color, i) => {
    const stat = piece.a?.[i]?.s || '';
    const entry = A.gearMinors.find(a => a.stat === stat);
    const max = limitOf(entry, r.proto);
    return { stat, max, estimate: isEstimate(entry, r.proto), value: stat ? clamp(or(piece.a[i].v, max), 0, max) : 0, color };
  });
  r.mods = Array.from({ length: r.modCount }, (_, i) => {
    const stat = piece.m?.[i]?.s || '';
    const max = attrMax(A.gearMods, stat);
    return { stat, max, value: stat ? clamp(or(piece.m[i].v, max), 0, max) : 0 };
  });
  r.grade = grade;
  return r;
}

// ---- talents and other conditional bonuses ("sources") ----

const stripPerfect = name => String(name || '').replace(/^pee?rfect(ly|ion)?\s+/i, '').replace(/\s+perfect(ion)?$/i, '');

// Uses the live text for numbers unless its wording differs from the snapshot's.
function trusted(db, kind, name, text) {
  const old = db.base?.texts.get(`${kind}:${norm(name)}`);
  if (old === undefined || !text || numbersOf(old).shape === numbersOf(text).shape) return { text, changed: false };
  return { text: old, changed: true };
}

// spec: { name, text, standard, perfect, item, kind ('w'|'g'), stdKind ('wt'|'gt'), set: {name, chest, backpack} }
function makeSource(db, key, where, spec) {
  const std = spec.standard ? db.by[spec.stdKind === 'wt' ? 'weaponTalent' : 'gearTalent'].get(spec.standard) : null;
  const row = db.fx.get(norm(spec.item)) || db.fx.get(norm(std?.name)) || db.fx.get(norm(spec.name)) || db.fx.get(norm(stripPerfect(spec.name)));
  let nums, changed = false, chest = null, backpack = null;
  if (std) {
    const a = trusted(db, spec.stdKind, std.name, std.text);
    nums = numbersOf(a.text, spec.perfect).nums;
    changed = a.changed;
    // A named item's own wording wins when it lines up with the standard talent's.
    if (spec.item && spec.text) {
      const own = numbersOf(trusted(db, spec.kind, spec.item, spec.text).text).nums;
      if (own.length === nums.length) nums = own;
    }
  } else if (spec.set) {
    const a = trusted(db, 's4', spec.set.name, spec.text);
    nums = numbersOf(a.text).nums;
    changed = a.changed;
    if (spec.set.chest) chest = numbersOf(trusted(db, 'sc', spec.set.name, spec.set.chest).text).nums;
    if (spec.set.backpack) backpack = numbersOf(trusted(db, 'sb', spec.set.name, spec.set.backpack).text).nums;
  } else {
    const a = trusted(db, spec.kind || 'x', spec.item || spec.name, spec.text);
    nums = numbersOf(a.text).nums;
    changed = a.changed;
  }
  return {
    key, where, name: spec.name, text: spec.text, row, nums, chest, backpack, changed,
    assume: row?.assume || '', defaultOff: row?.default === 'off',
  };
}

export const isCounted = (state, src) => state.tog?.[src.key] ?? !src.defaultOff;

// Adds every counted source to the bag and returns what each one contributed, for display.
function applySources(bag, sources, vars, state, type) {
  return sources.map(src => {
    const terms = src.row ? evaluate(src.row.effects, { nums: src.nums, chest: src.chest, backpack: src.backpack, vars }) : [];
    const usable = (terms || []).filter(t => t.stat !== 'wildcard' && (!t.types || (type && t.types.includes(type))));
    const maxStacks = Math.max(0, ...usable.map(t => t.stacks ?? 0));
    const stacks = clamp(or(state.stacks?.[src.key], maxStacks), 0, maxStacks);
    const counted = isCounted(state, src);
    const applied = usable.map(t => ({ stat: t.stat, value: termValue(t, stacks), always: t.stacks === null }));
    if (counted) for (const a of applied) bag.add(a.stat, a.value);
    const wildcard = (terms || []).some(t => t.stat === 'wildcard');
    return { ...src, broken: terms === null, hasEffect: usable.length > 0 || wildcard, wildcard, applied, maxStacks, stacks, counted };
  });
}

// ---- the build ----

export function compute(db, state) {
  const A = db.attributes;
  const bag = new Bag();
  const cores = { offense: 0, defense: 0, utility: 0 };
  const counts = {};
  const sources = [];
  const pieces = {};

  const spec = db.by.spec.get(state.spec);
  for (const t of (spec && evaluate(spec.effects)) || []) bag.add(t.stat, t.per, t.types);

  for (const w of A.watch) bag.add(w.stat, w.max * clamp(or(state.watch?.[w.stat], 0), 0, 50) / 50);

  for (const slot of GEAR_SLOTS) {
    const r = resolveGear(db, slot, state.gear?.[slot]);
    if (!r) continue;
    pieces[slot] = r;
    if (r.set) counts[r.set] = (counts[r.set] || 0) + 1;
    for (const c of r.cores) { cores[c.type]++; bag.add(c.stat, c.value); }
    for (const a of [...r.attrs, ...r.free, ...r.mods]) bag.add(a.stat, a.value);
    if (r.augment) bag.add(r.augment.stat, r.augment.value);
    if (r.talent) {
      sources.push(makeSource(db, `g:${slot}`, `${r.name} · ${slot}`, {
        name: r.talent.name, text: r.talent.text, standard: r.talent.standard, perfect: r.talent.perfect,
        stdKind: 'gt', kind: 'g', item: r.quality === 'high-end' ? '' : r.name,
      }));
    }
  }

  // Pieces like the NinjaBike backpack count as one piece of every set worn.
  const wild = sources.some(s => s.row && /wildcard/.test(s.row.effects) && isCounted(state, s));
  if (wild) for (const name of Object.keys(counts)) counts[name]++;

  const sets = Object.entries(counts).map(([name, count]) => {
    const set = db.by.set.get(name);
    const bonuses = set.bonuses.filter(b => b.text).map(b => {
      const active = count >= b.pieces;
      if (active) bag.addAll(b.effects);
      return { pieces: b.pieces, text: b.text, active };
    });
    let four = null;
    if (set.kind === 'gearset' && set.four) {
      const active = count >= 4;
      const worn = slot => (pieces[slot]?.set === name && pieces[slot].quality === 'gearset' ? set[slot] : null);
      four = { name: set.four.name, text: set.four.text, active, chest: worn('chest'), backpack: worn('backpack') };
      if (active) {
        sources.push(makeSource(db, `s:${name}`, `${name} · 4 pieces`, {
          name: set.four.name, text: set.four.text,
          set: { name, chest: four.chest?.text, backpack: four.backpack?.text },
        }));
        // Chest and backpack talents that add something of their own.
        for (const slot of HAS_TALENT) {
          const t = worn(slot);
          if (t && db.fx.has(norm(t.name))) {
            sources.push(makeSource(db, `s:${name}:${slot}`, `${name} · ${slot}`, { name: t.name, text: t.text, kind: slot === 'chest' ? 'sc' : 'sb', item: '' }));
          }
        }
      }
    }
    return { name, count, kind: set.kind, bonuses, four };
  });

  const weapons = [0, 1, 2].map(i => weaponResult(db, state, i, bag, sources));

  // The stat sheet follows the weapon in hand; with no weapon it shows gear only.
  const active = weapons[state.active] || null;
  let view = active;
  if (!view) {
    const bare = bag.forType(null);
    const applied = applySources(bare, sources, { mag: 0, tier: tierOf(db, bare) }, state, null);
    view = { bag: bare, stats: bare.totals(), sources: applied };
  }
  const s = view.stats;
  const armor = (db.num('base_armor') + (s.armor || 0)) * (1 + (s.armor_pct || 0) / 100);
  const totals = {
    armor,
    // The Entropy augment turns a share of total armor into health.
    health: (db.num('base_health') + (s.health || 0)) * (1 + (s.health_pct || 0) / 100) + armor * (s.aug_entropy || 0) / 100,
    chc: Math.min(db.num('chc_cap', 60), db.num('base_chc') + (s.chc || 0)),
    chd: db.num('base_chd', 25) + (s.chd || 0),
    // Prototype cores can give half tiers; only whole tiers change a skill.
    skillTier: Math.floor(Math.min(db.num('skill_tier_cap', 6), s.skill_tier || 0) + 1e-9),
  };
  const augments = db.augments.filter(a => s[a.stat]).map(a => ({ name: a.name, text: a.text, unit: a.unit || '%', total: s[a.stat] }));
  return { cores, sets, pieces, weapons, view, totals, spec, augments };
}

const tierOf = (db, bag) => Math.floor(Math.min(db.num('skill_tier_cap', 6), bag.stats.skill_tier || 0) + 1e-9);

// The attributes a weapon rolls: its class damage core, its class attribute and one free
// attribute. `proto` raises the limits to the Prototype ones.
export function weaponAttributes(db, row, proto = false) {
  const A = db.attributes;
  const coreEntry = { max: A.weaponCore, proto: A.weaponCoreProto };
  let clsEntry = A.classes[row.type] ? { ...A.classes[row.type] } : null;
  const unique = row.uniqueEffects?.[0];
  if (unique) {
    // A named weapon's own value replaces the standard one, so the sheet's prototype value no longer applies.
    if (row.uniqueKind === 'core') { coreEntry.max = unique[1]; coreEntry.proto = null; }
    else if (row.uniqueKind === 'class') clsEntry = { stat: unique[0], max: unique[1], proto: null };
    else if (clsEntry && unique[0] === clsEntry.stat) { clsEntry.max = unique[1]; clsEntry.proto = null; }
  }
  const view = (entry, stat) => ({ stat, max: limitOf(entry, proto), estimate: isEstimate(entry, proto) });
  return {
    core: view(coreEntry, TYPE_DAMAGE[row.type]),
    cls: clsEntry ? view(clsEntry, clsEntry.stat) : null,
    minor: stat => { const e = A.weaponMinors.find(a => a.stat === stat); return view(e, stat); },
  };
}

export const canPrototype = row => row.quality !== 'exotic';

export function weaponTalents(db, row) {
  return db.weaponTalents.filter(t => !t.types || t.types.includes(row.type));
}

function weaponResult(db, state, index, gearBag, gearSources) {
  const w = state.weapons?.[index];
  const row = w && db.by.weapon.get(w.id);
  if (!row) return null;
  const A = db.attributes;
  const bag = gearBag.forType(row.type);

  const proto = canPrototype(row) && !!w.p;
  const { core, cls, minor } = weaponAttributes(db, row, proto);
  bag.add(core.stat, clamp(or(w.cv, core.max), 0, core.max));
  if (cls) bag.add(cls.stat, clamp(or(w.kv, cls.max), 0, cls.max));
  if (w.a) { const { max } = minor(w.a); bag.add(w.a, clamp(or(w.av, max), 0, max)); }
  const augment = proto ? augmentOf(db, w) : null;
  if (augment) bag.add(augment.stat, augment.value);
  const grade = clamp(or(w.e, 0), 0, db.num('expertise_max', 30));
  bag.add('weapon_damage', grade * db.num('expertise_weapon', 1));

  const mods = [];
  if (row.slots) {
    for (const slot of MOD_SLOTS) {
      const mod = row.slots[slot] && db.by.mod.get(w.m?.[slot]);
      if (mod && mod.slot === slot) { bag.addAll(mod.effects); mods.push(mod); }
    }
  } else for (const mod of row.fixedMods) bag.addAll(mod.effects);

  const sources = [...gearSources];
  let talent = null;
  if (row.talent) {
    talent = { name: row.talent.name, text: row.talent.text, standard: row.talent.standard, perfect: row.talent.perfect, item: row.name };
  } else if (w.t && row.quality === 'high-end') {
    const std = db.by.weaponTalent.get(w.t);
    if (std && (!std.types || std.types.includes(row.type))) talent = { name: std.name, text: resolveText(std.text), standard: std.name, perfect: false, item: '' };
  }
  if (talent) sources.push(makeSource(db, `w:${index}`, `${row.name} · talent`, { ...talent, stdKind: 'wt', kind: 'w' }));

  // Talents that scale with magazine size or skill tier see the values before talents.
  const before = bag.totals();
  const vars = {
    mag: Math.max(1, Math.round(row.mag * (1 + (before.mag_size || 0) / 100) + (before.mag_flat || 0))),
    tier: tierOf(db, bag),
    status: before.status_effects || 0,
  };
  const applied = applySources(bag, sources, vars, state, row.type);

  const s = bag.totals();
  const g = k => s[k] || 0;
  const baked = bakedIn(db, row, applied.find(a => a.key === `w:${index}`));
  const weaponDamage = g('weapon_damage') + g(TYPE_DAMAGE[row.type]);
  const amp = bag.amps.reduce((m, a) => m * (1 + a / 100), 1);
  const chc = Math.min(db.num('chc_cap', 60), db.num('base_chc') + g('chc'));
  const chd = db.num('base_chd', 25) + g('chd');
  const hsd = row.hsd + g('hsd');
  const body = row.damage * (1 + weaponDamage / 100) * (1 + g('twd') / 100) * amp;
  const noReload = g('noreload') > 0;
  return {
    index, row, name: row.name, type: row.type, bag, stats: s, sources: applied, mods, talent, proto, augment,
    weaponDamage, twd: g('twd'), amp, chc, chd, hsd, body, echo: g('aug_echo'),
    crit: body * (1 + chd / 100), headshot: body * (1 + hsd / 100), headshotCrit: body * (1 + (chd + hsd) / 100),
    rpm: row.rpm * (1 + (g('rof') - baked.rof) / 100),
    mag: noReload ? Infinity : Math.max(1, Math.round(row.mag * (1 + (g('mag_size') - baked.mag) / 100) + g('mag_flat'))),
    reload: noReload ? 0 : row.reload / (1 + Math.max(-80, g('reload_speed') - baked.reload) / 100),
    dta: g('dta'), dth: g('dth'), ooc: g('ooc'),
  };
}

// The sheet lists named and exotic weapons with their always-on bonuses already inside
// the rate of fire, magazine and reload columns (Pestilence's +10% rate of fire mod, Baker's
// Dozen's bigger magazine...). This finds those so they are not counted a second time: a bonus
// is treated as included when it explains the gap to the standard version of the weapon.
function bakedIn(db, row, talent) {
  const baked = { rof: 0, mag: 0, reload: 0 };
  if (row.quality === 'high-end') return baked;
  const own = { rof: 0, mag: 0, reload: 0 };
  const note = (stat, value) => {
    if (stat === 'rof') own.rof += value;
    else if (stat === 'mag_size') own.mag += value;
    else if (stat === 'reload_speed' || stat === 'weapon_handling') own.reload += value;
  };
  for (const mod of row.fixedMods) for (const [stat, value] of mod.effects) note(stat, value);
  if (talent?.counted) for (const a of talent.applied) if (a.always) note(a.stat, a.value);

  // Items from our own extra tables say outright which bonuses their numbers contain.
  if (row.baked) {
    for (const k of ['rof', 'mag', 'reload']) if (row.baked.includes(k)) baked[k] = own[k];
    return baked;
  }

  const standard = db.weapons.filter(w => w !== row && w.quality === 'high-end' && (w.name === row.base || w.family === row.family));
  const explains = (gap, bonus) => bonus && standard.some(w => Math.abs(gap(w) - bonus) <= 2);
  if (explains(w => (row.rpm / w.rpm - 1) * 100, own.rof)) baked.rof = own.rof;
  if (explains(w => (row.mag / w.mag - 1) * 100, own.mag)) baked.mag = own.mag;
  if (explains(w => (w.reload / row.reload - 1) * 100, own.reload)) baked.reload = own.reload;
  return baked;
}

// ---- damage over time ----

// Average damage of one bullet. Crit and headshot bonuses add together in this game.
export function averageBullet(w, { headshotChance = 0, outOfCover = false } = {}) {
  const avg = w.body * (1 + (w.chc / 100) * (w.chd / 100) + (headshotChance / 100) * (w.hsd / 100));
  // The Echo augment gives each bullet a chance to deal its damage a second time.
  return avg * (outOfCover ? 1 + w.ooc / 100 : 1) * (1 + (w.echo || 0) / 100);
}

export function dps(w, opts) {
  const bullet = averageBullet(w, opts);
  const burst = bullet * w.rpm / 60;
  const sustained = isFinite(w.mag) ? bullet * w.mag / (w.mag / (w.rpm / 60) + w.reload) : burst;
  return { bullet, burst, sustained };
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
    if (t > seconds) break;
    t += Math.max(0, w.reload - gap); // the reload replaces the wait for the next shot
  }
  points.push([seconds, total]);
  return points;
}

export function timeToKill(w, opts, target) {
  const bullet = averageBullet(w, opts);
  if (!(bullet > 0)) return null;
  const perArmor = bullet * (1 + w.dta / 100);
  const perHealth = bullet * (1 + w.dth / 100);
  let armor = Math.max(0, target.armor || 0), health = Math.max(0, target.health || 0);
  if (armor + health <= 0) return null;
  const gap = 60 / w.rpm;
  let bullets = 0, time = 0, inMag = w.mag, reloads = 0;
  while ((armor > 0 || health > 0) && bullets < 200000) {
    if (bullets > 0) {
      if (inMag === 0) { time += w.reload; inMag = w.mag; reloads++; }
      else time += gap;
    }
    bullets++; inMag--;
    if (armor > 0) {
      armor -= perArmor;
      // Damage left over after the armor breaks carries into health.
      if (armor < 0) { health -= (-armor / perArmor) * perHealth; armor = 0; }
    } else health -= perHealth;
  }
  return { bullets, time, reloads };
}
