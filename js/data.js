// Loads the game data: first the copy bundled with the site (instant), then the live sheet.

import { CONFIG } from './config.js';
import { parseTable } from './csv.js';
import { TABS, MINIMUM, readSheet, countsOf, addExtras } from './sheet.js';
import { norm, STATS } from './stats.js';

// Which tab each sanity count depends on.
const COUNT_TAB = {
  weapons: 'weapons', weaponTalents: 'weapon_talents', brands: 'brandsets', gearsets: 'gearsets',
  gear: 'gear_named', gearTalents: 'gear_talents', mods: 'weapon_mods', skills: 'skill_list',
};

async function get(url, ms = 15000) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: control.signal });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Our own small tables: things the sheet does not hold in a usable form.
export async function loadCustom() {
  const [settings, specs, fx, targets, augments, weapons, gear] = await Promise.all(
    ['settings', 'specializations', 'talent_effects', 'targets', 'augments', 'extra_weapons', 'extra_gear']
      .map(async t => parseTable(await get(`data/${t}.csv`))),
  );
  // Each augment adds up in its own stat, so several pieces with the same one stack.
  for (const a of augments) {
    a.stat = `aug_${norm(a.name).replace(/ /g, '_')}`;
    STATS[a.stat] = [`${a.name} augment`, a.unit || '%', 'augment'];
  }
  return {
    settings: Object.fromEntries(settings.map(r => [r.key, r.value])),
    specs, targets, augments,
    extras: { weapons, gear },
    fx: new Map(fx.map(r => [norm(r.name), r])),
  };
}

export async function loadSnapshot() {
  const texts = {};
  await Promise.all(Object.keys(TABS).map(async tab => { texts[tab] = await get(`data/snapshot/${tab}.csv`); }));
  return texts;
}

// Reads the live sheet. Tabs that cannot be fetched, or that no longer parse into a sane
// amount of data, fall back to the snapshot so one broken tab never takes the site down.
export async function loadLive(snapshot) {
  if (!CONFIG.sheetId) return null;
  const texts = {}, fallback = new Set();
  await Promise.all(Object.entries(TABS).map(async ([tab, gid]) => {
    try {
      texts[tab] = await get(`https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/export?format=csv&gid=${gid}`, CONFIG.liveTimeoutMs);
    } catch (err) {
      console.warn(`Live tab "${tab}" not loaded, using the snapshot.`, err);
      texts[tab] = snapshot[tab];
      fallback.add(tab);
    }
  }));
  if (fallback.size === Object.keys(TABS).length) return null;

  let db = readSheet(texts);
  const counts = countsOf(db);
  const broken = Object.keys(MINIMUM).filter(k => counts[k] < MINIMUM[k]).map(k => COUNT_TAB[k]);
  if (broken.length) {
    for (const tab of broken) { texts[tab] = snapshot[tab]; fallback.add(tab); }
    console.warn('Live tabs with too little data, using the snapshot for:', broken);
    db = readSheet(texts);
  }
  return { db, fallback: [...fallback] };
}

// Adds our tables and name lookups to parsed sheet data. `base` is the snapshot's data
// when `db` came from the live sheet; it is what talent wording is checked against.
export function finish(db, custom, base = null) {
  const by = (list, key = 'name') => new Map(list.map(x => [x[key], x]));
  addExtras(db, custom.extras);
  db.augments = custom.augments;
  db.settings = custom.settings;
  db.num = (key, fallback = 0) => { const v = parseFloat(custom.settings[key]); return isNaN(v) ? fallback : v; };
  db.specs = custom.specs;
  db.targets = custom.targets;
  db.fx = custom.fx;
  db.sets = [...db.brands, ...db.gearsets];
  db.by = {
    weapon: by(db.weapons), set: by(db.sets), gear: by(db.gear), weaponTalent: by(db.weaponTalents),
    gearTalent: by(db.gearTalents), mod: by(db.weaponMods), skill: by(db.skills), spec: by(db.specs),
    augment: by(db.augments),
  };

  // Every talent description, keyed by where it came from.
  db.texts = new Map();
  const put = (kind, name, text) => { if (text) db.texts.set(`${kind}:${norm(name)}`, text); };
  db.weaponTalents.forEach(t => put('wt', t.name, t.text));
  db.gearTalents.forEach(t => put('gt', t.name, t.text));
  db.weapons.forEach(w => put('w', w.name, w.talent?.text));
  db.gear.forEach(g => put('g', g.name, g.talent?.text));
  db.gearsets.forEach(s => { put('s4', s.name, s.four?.text); put('sc', s.name, s.chest?.text); put('sb', s.name, s.backpack?.text); });
  db.base = base;
  return db;
}
