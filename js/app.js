import { CONFIG } from './config.js';
import { loadCustom, loadSnapshot, loadLive, finish } from './data.js';
import { readSheet, GEAR_SLOTS, MOD_SLOTS, WEAPON_TYPES } from './sheet.js';
import { STATS, statLabel, statUnit, statGroup } from './stats.js';
import { weaponArt, gearArt, slotArt, skillArt } from './art.js';
import {
  CORES, compute, weaponAttributes, weaponTalents, canPrototype, limitOf, isEstimate, inCombat, specWeapons,
  dps, timeline, timeToKill,
} from './calc.js';

const SAVE_KEY = 'd2builds.saved.v2';
const CHART_SECONDS = 12;
const WEAPON_SLOTS = ['Primary', 'Secondary', 'Sidearm'];
const CORE_NAME = { offense: 'Weapon damage', defense: 'Armor', utility: 'Skill tier' };
const QUALITY = { 'high-end': 'High-end', named: 'Named', exotic: 'Exotic', gearset: 'Gear set' };
const SHORT = {
  weapon_damage: 'WD', chc: 'CHC', chd: 'CHD', hsd: 'HSD', dta: 'DtA', dth: 'DtH', ooc: 'OoC',
  weapon_handling: 'Handling', reload_speed: 'Reload', armor_regen: 'Armor regen', armor_on_kill: 'AoK',
  explosive_resistance: 'Expl. res.', hazard_protection: 'Hazard prot.', protection_elites: 'PfE',
  incoming_repairs: 'Inc. repairs', skill_damage: 'Skill dmg', skill_haste: 'Haste',
  skill_duration: 'Duration', repair_skills: 'Repair', status_effects: 'Status', rof: 'RoF',
};
const ICON = {
  weapon: '<path d="M2 10h13l1-2h4l1 2h1v3h-5l-1 2h-3l-1-2H8l-1 4H4l1-4H2z"/>',
  sidearm: '<path d="M3 8h16v4h-8l-1 3H8l-1 5H3l2-8H3z"/>',
  mask: '<path d="M12 3c4 0 7 2 7 6v3c0 4-3 8-7 9-4-1-7-5-7-9V9c0-4 3-6 7-6zm-3 7a1.6 1.6 0 100 3.2A1.6 1.6 0 009 10zm6 0a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z" fill-rule="evenodd"/>',
  backpack: '<path d="M9 3h6v2h1a3 3 0 013 3v10a3 3 0 01-3 3H8a3 3 0 01-3-3V8a3 3 0 013-3h1zm-1 9v5h8v-5z" fill-rule="evenodd"/>',
  chest: '<path d="M7 3l2 3h6l2-3 3 2-1 6v10H5V11L4 5z"/>',
  gloves: '<path d="M8 21v-6L5 11V7l2-1 1 3V4l2-1 1 5V3l2 0 1 5V5l2 0 1 9-1 7z"/>',
  holster: '<path d="M6 3h9v6l-2 2v8l-3 2-2-1V11L6 9z"/>',
  kneepads: '<path d="M8 3h8l1 5-1 3 1 3-1 7H8L7 14l1-3-1-3zm2 6v4h4V9z" fill-rule="evenodd"/>',
  skill: '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7zm0 5.5L8 10v4l4 2.5 4-2.5v-4z" fill-rule="evenodd"/>',
};

let db, state, last;
const ui = { edit: null, picking: false, query: '', filter: 'all' };

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (isFinite(n) ? Math.round(n).toLocaleString('en-US') : '∞');
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('en-US');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const compact = n => (n >= 1e6 ? `${fmt1(n / 1e6)}M` : n >= 1e3 ? `${fmt1(n / 1e3)}K` : fmt(n));
const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;
const amount = (stat, value) => `${Math.abs(value) >= 1000 ? fmt(value) : fmt1(value)}${statUnit(stat)}`;
const bonus = (stat, value) => (stat === 'amp' ? `+${fmt1(value)}% amplified damage` : `${value > 0 ? '+' : ''}${amount(stat, value)} ${statLabel(stat)}`);
const chip = (stat, value) => `<span class="tag">${esc(amount(stat, value))} ${esc(SHORT[stat] || statLabel(stat))}</span>`;

const blank = () => ({
  v: 2, spec: '', weapons: [{}, {}, {}], gear: {}, skills: ['', ''], watch: {}, tog: {}, stacks: {},
  hsc: 30, ooc: false, target: { armor: 1000000, health: 500000 }, active: 0, mode: 'sheet', x: {},
});

function normalize(loaded) {
  if (!loaded || typeof loaded !== 'object' || loaded.v !== 2) return blank();
  const s = { ...blank(), ...loaded };
  s.weapons = [0, 1, 2].map(i => (Array.isArray(s.weapons) && s.weapons[i]) || {});
  s.skills = [0, 1].map(i => (Array.isArray(s.skills) && s.skills[i]) || '');
  for (const k of ['gear', 'watch', 'tog', 'stacks', 'target', 'x']) if (!s[k] || typeof s[k] !== 'object') s[k] = blank()[k];
  if (s.mode !== 'combat') s.mode = 'sheet';
  return s;
}

// ---- build <-> link, saved builds ----

function encode(obj) {
  let bin = '';
  for (const b of new TextEncoder().encode(JSON.stringify(obj))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}

function stateFromHash() {
  const match = location.hash.match(/b=([\w-]+)/);
  if (!match) return blank();
  try { return normalize(decode(match[1])); } catch { toast('That build link could not be read.'); return blank(); }
}

const readSaved = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } };
function writeSaved(saved) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); return true; }
  catch { toast('This browser is blocking saved builds. Use the link instead.'); return false; }
}

// ---- small pieces of html ----

function options(list, value, placeholder = 'None') {
  let html = `<option value="">${esc(placeholder)}</option>`, group;
  for (const o of list) {
    if (o.group !== group) {
      if (group) html += '</optgroup>';
      if (o.group) html += `<optgroup label="${esc(o.group)}">`;
      group = o.group;
    }
    html += `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`;
  }
  return html + (group ? '</optgroup>' : '');
}

const numberBox = (path, value, max, label, step = 'any') =>
  `<input class="num" type="number" data-path="${esc(path)}" value="${value}" min="0" max="${max}" step="${step}" aria-label="${esc(label)}">`;

// A saved value never shows above the current limit (the limit drops when Prototype is switched off).
const shown = (value, max) => Math.min(value ?? max, max);
const maxNote = (stat, max, estimate) => `<em>max ${amount(stat, max)}${estimate ? ', estimated' : ''}</em>`;

// Attribute picker with the box for its rolled value.
function attrRow(label, path, list, chosen, value, color, placeholder = 'Choose an attribute', proto = false) {
  const pool = color ? list.filter(a => a.color === color) : list;
  const max = limitOf(pool.find(a => a.stat === chosen), proto);
  const opts = pool.map(a => ({
    value: a.stat, label: `${statLabel(a.stat)} · ${amount(a.stat, limitOf(a, proto))}${isEstimate(a, proto) ? ' (estimated)' : ''}`,
    group: a.color ? `${cap(a.color === 'utility' ? 'skill' : a.color)}` : '',
  }));
  return `<label class="field"><span>${esc(label)}</span><span class="pair">
    <select data-path="${path}.s" data-clear="${path}.v">${options(opts, chosen || '', placeholder)}</select>
    ${chosen ? numberBox(`${path}.v`, shown(value, max), max, `${label} value`) : ''}</span></label>`;
}

// The Prototype switch and the augment that comes with it.
function prototypeBlock(path, saved, eligible, augment) {
  if (!eligible) return '<h3 class="sub">Prototype</h3><p class="note">Exotic items cannot be Prototype.</p>';
  let html = `<h3 class="sub">Prototype</h3>
    <label class="check"><input type="checkbox" data-path="${path}.p"${saved.p ? ' checked' : ''}><span><b>Prototype item</b> Attributes can roll up to 1.5 times the normal maximum.</span></label>`;
  if (!saved.p) return html;
  html += `<p class="note">The attribute boxes below now go up to the Prototype maximum and start there. In the game only one attribute is guaranteed at the new maximum, so lower the others to match your item.</p>
    <div class="grid2">
      <label class="field"><span>Augment</span><select data-path="${path}.g" data-clear="${path}.gv">${options(db.augments.map(a => ({ value: a.name, label: a.name })), saved.g || '', 'No augment')}</select></label>
      ${augment ? `<label class="field"><span>Augment level (1 to 10)</span>${numberBox(`${path}.gl`, augment.level, 10, 'Augment level', 1)}</label>` : ''}
    </div>`;
  if (!augment) return html;
  const counted = augment.stat === 'aug_echo' ? 'Counted in average bullet damage, DPS and time to kill.'
    : augment.stat === 'aug_entropy' ? 'Counted in total health.'
      : 'Listed in the Augments panel. It does not change the damage numbers.';
  const hint = augment.known
    ? `older patch notes say ${amount(augment.stat, augment.table)} at this level`
    : 'the game\'s numbers are not published';
  return `${html}<div class="talent"><h4>${esc(augment.name)} <span>${esc(amount(augment.stat, augment.value))} counted</span></h4>
    <p>${esc(augment.text)}</p>
    <label class="field inline"><span>Value shown in your game <em>${hint}</em></span>${numberBox(`${path}.gv`, saved.gv ?? augment.value, 1000, 'Augment value')}</label>
    <p class="note">${counted}</p></div>`;
}

// Checkbox and stack box for one talent or conditional bonus.
function sourceControl(src) {
  if (!src.row) return '<p class="note">Described only. Not counted in the numbers.</p>';
  if (src.broken) return '<p class="note warn">The sheet text no longer matches this talent\'s formula, so it is not counted.</p>';
  if (!src.hasEffect) return '<p class="note">Does not apply to this weapon.</p>';
  if (!src.always && !inCombat(state)) return '<p class="note">Needs a condition, so it is left off the stat sheet. Switch to <b>In combat</b> to count it.</p>';
  const what = src.wildcard ? 'as one piece of every brand and gear set you wear' : src.applied.map(a => bonus(a.stat, a.value)).join(', ');
  const stacks = src.maxStacks
    ? `<label class="stacks">Stacks ${numberBox('', src.stacks, src.maxStacks, `${src.name} stacks`, 1).replace('data-path=""', `data-stack="${esc(src.key)}"`)}<span>/ ${src.maxStacks}</span></label>`
    : '';
  return `<div class="count">
      <label class="check"><input type="checkbox" data-tog="${esc(src.key)}"${src.counted ? ' checked' : ''}><span>Count it <b>${esc(what)}</b></span></label>${stacks}
    </div>
    ${src.assume && !src.wildcard ? `<p class="note">Assumes: ${esc(src.assume)}.</p>` : ''}
    ${src.changed ? '<p class="note warn">The sheet reworded this talent. Using the last verified numbers.</p>' : ''}`;
}

const kv = pairs => `<dl class="kv">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
const corePips = list => list.map(c => `<i class="pip c-${c.type}" title="${CORE_NAME[c.type]}"></i>`).join('');

// ---- board (left) ----

function weaponSlot(i, result) {
  const w = result.weapons[i];
  const head = `<span class="slot-kind">${icon(i === 2 ? 'sidearm' : 'weapon')}${WEAPON_SLOTS[i]}</span>`;
  if (!w) {
    return `<button class="slot empty wide" data-action="edit" data-kind="weapon" data-id="${i}">
    <span class="slot-art">${weaponArt({ name: '', type: i === 2 ? 'pistol' : i === 1 ? 'smg' : 'ar' })}</span>${head}<span class="slot-cta">Choose a weapon</span></button>`;
  }
  const saved = state.weapons[i];
  const d = dps(w, shotOptions());
  const tags = [
    w.proto ? `<span class="tag proto">Prototype${w.augment ? ` · ${esc(w.augment.name)}` : ''}</span>` : '',
    w.talent ? `<span class="tag strong">${esc(w.talent.name)}</span>` : '',
    saved.a ? chip(saved.a, shown(saved.av, weaponAttributes(db, w.row, w.proto).minor(saved.a).max)) : '',
    ...(w.row.slots ? w.mods.map(m => `<span class="tag">${esc(m.text || m.name)}</span>`) : []),
  ].join('');
  return `<button class="slot wide q-${w.row.quality}${state.active === i ? ' active' : ''}" data-action="edit" data-kind="weapon" data-id="${i}">
    <span class="slot-art">${weaponArt(w.row)}</span>
    ${head}
    <span class="slot-name">${esc(w.name)}</span>
    <span class="slot-meta">${esc(WEAPON_TYPES[w.type])} · ${fmt(w.rpm)} RPM · ${fmt(w.mag)} rounds</span>
    <span class="slot-figure"><b>${compact(d.sustained)}</b> DPS</span>
    <span class="tags">${tags}</span>
  </button>`;
}

function gearSlot(slot, result) {
  const r = result.pieces[slot];
  const head = `<span class="slot-kind">${icon(slot)}${cap(slot)}</span>`;
  if (!r) return `<button class="slot empty" data-action="edit" data-kind="gear" data-id="${slot}"><span class="slot-art">${slotArt(slot)}</span>${head}<span class="slot-cta">Choose gear</span></button>`;
  const set = result.sets.find(s => s.name === r.set);
  const tags = [
    r.proto ? `<span class="tag proto">Prototype${r.augment ? ` · ${esc(r.augment.name)}` : ''}</span>` : '',
    r.talent ? `<span class="tag strong">${esc(r.talent.name)}</span>` : '',
    r.setTalent ? `<span class="tag strong">${esc(r.setTalent.name)}</span>` : '',
    ...[...r.attrs, ...r.free, ...r.mods].filter(a => a.stat).map(a => chip(a.stat, a.value)),
  ].join('');
  const pieces = set ? ` · ${set.count} equipped` : '';
  const line = r.quality === 'exotic' ? 'Exotic'
    : r.quality === 'named' ? `Named · ${esc(r.brand)}${pieces}`
      : `${r.quality === 'gearset' ? 'Gear set' : 'Brand'}${pieces}`;
  return `<button class="slot q-${r.quality}" data-action="edit" data-kind="gear" data-id="${slot}">
    <span class="slot-art">${gearArt({ name: r.name, quality: r.quality, slot, brand: r.brand, core: r.coreType })}</span>
    ${head}<span class="pips">${corePips(r.cores)}</span>
    <span class="slot-name">${esc(r.name)}</span>
    <span class="slot-meta">${line}</span>
    <span class="tags">${tags}</span>
  </button>`;
}

function skillSlot(i) {
  const skill = db.by.skill.get(state.skills[i]);
  const head = `<span class="slot-kind">${icon('skill')}Skill ${i + 1}</span>`;
  if (!skill) return `<button class="slot empty" data-action="edit" data-kind="skill" data-id="${i}"><span class="slot-art">${skillArt({ name: '', skill: '' })}</span>${head}<span class="slot-cta">Choose a skill</span></button>`;
  return `<button class="slot q-skill" data-action="edit" data-kind="skill" data-id="${i}"><span class="slot-art">${skillArt(skill)}</span>${head}
    <span class="slot-name">${esc(skill.variant)}</span><span class="slot-meta">${esc(skill.skill)}</span></button>`;
}

function watchPanel() {
  const rows = db.attributes.watch;
  const levels = rows.map(r => state.watch[r.stat] || 0);
  const summary = levels.every(l => l >= 50) ? 'All maxed' : levels.every(l => !l) ? 'Not set' : 'Custom';
  const groups = {};
  for (const r of rows) (groups[r.category] ||= []).push(r);
  const { used, each } = watchUse();
  const points = name => (each === null ? `${used[name] || 0} points` : `${used[name] || 0} of ${each} points`);
  return `<details class="panel watch"${ui.watchOpen ? ' open' : ''}>
    <summary><h2>SHD Watch</h2><span class="tag">${summary}</span></summary>
    <label class="field inline"><span>Your SHD level <em>optional: checks you have the points (one per category every 5 levels)</em></span>${numberBox('shd', state.shd || '', 99999, 'SHD level', 1)}</label>
    <div class="row">
      <button class="btn small" data-action="watchMax">Max everything</button>
      <button class="btn small ghost" data-action="watchClear">Clear</button>
    </div>
    <div class="watch-grid">${Object.entries(groups).map(([name, list]) => `<div><h3>${esc(name)} <em class="${each !== null && used[name] > each ? 'over' : ''}">${points(name)}</em></h3>${list.map(r =>
      `<label class="field inline"><span>${esc(statLabel(r.stat))} <em>+${amount(r.stat, r.max)}</em></span>${numberBox(`watch.${r.stat}`, state.watch[r.stat] || 0, 50, `${statLabel(r.stat)} level`, 1)}</label>`).join('')}</div>`).join('')}</div>
  </details>`;
}

// Bonuses typed in by hand, for what the game grants outside of gear (seasonal modifiers...).
function extrasPanel() {
  const rows = Object.entries(state.x).filter(([, x]) => x);
  const groups = { offense: 'Offense', handling: 'Handling', defense: 'Defense', skill: 'Skills' };
  const stats = Object.keys(STATS).filter(k => groups[statGroup(k)])
    .map(k => ({ value: k, label: `${statLabel(k)}${statUnit(k) === '%' ? ' %' : statUnit(k) ? ` (${statUnit(k)})` : ' (flat)'}`, group: groups[statGroup(k)] }))
    .sort((a, b) => Object.values(groups).indexOf(a.group) - Object.values(groups).indexOf(b.group));
  return `<details class="panel"${ui.extrasOpen || rows.length ? ' open' : ''} data-keep="extrasOpen">
    <summary><h2>Season modifiers and other bonuses</h2><span class="tag">${rows.length ? `${rows.length} added` : 'None'}</span></summary>
    <p class="note">Seasonal modifiers, event buffs and similar bonuses are not part of your gear, so the planner cannot know them. If the game's Stats page shows more than the planner, add the difference here.</p>
    ${rows.map(([i, x]) => `<div class="extra">
      <select data-path="x.${i}.s" aria-label="Bonus stat">${options(stats, x.s || '', 'Choose a stat')}</select>
      ${numberBox(`x.${i}.v`, x.v ?? 0, 100000000, 'Bonus value')}
      <button class="btn small ghost danger" data-action="extraRemove" data-i="${i}" aria-label="Remove bonus">✕</button></div>`).join('')}
    <div class="row"><button class="btn small" data-action="extraAdd">Add a bonus</button></div>
  </details>`;
}

function renderBoard(result) {
  const spec = result.spec;
  const picks = db.num('spec_weapon_picks', 3);
  const classes = Object.entries(WEAPON_TYPES).map(([type, label]) =>
    `<button class="pill${result.specClasses.includes(type) ? ' on' : ''}" data-action="specWeapon" data-type="${type}">${esc(label)}</button>`).join('');
  $('#board').innerHTML = `
    <div class="panel">
      <h2>Specialization</h2>
      <div class="seg wrap">${db.specs.map(s => `<button class="seg-btn${state.spec === s.name ? ' on' : ''}" data-action="spec" data-name="${esc(s.name)}">${esc(s.name)}</button>`).join('')}</div>
      ${spec ? `<p class="note">${esc(spec.text)} Signature weapon: ${esc(spec.weapon)}.</p>
        <p class="note">+${db.num('spec_weapon_bonus', 15)}% weapon damage for ${picks} weapon classes of your choice${Array.isArray(state.sw) ? '' : ' (following your equipped weapons until you pick)'}:</p>
        <div class="filters">${classes}</div>` : ''}
    </div>
    <h2 class="section">Weapons</h2>
    <div class="slots">${[0, 1, 2].map(i => weaponSlot(i, result)).join('')}</div>
    <h2 class="section">Gear</h2>
    <div class="slots">${GEAR_SLOTS.map(s => gearSlot(s, result)).join('')}</div>
    <h2 class="section">Skills</h2>
    <div class="slots">${[0, 1].map(i => skillSlot(i)).join('')}</div>
    ${watchPanel()}
    ${extrasPanel()}`;
}

// ---- stats (right) ----

const shotOptions = () => ({ headshotChance: state.hsc, outOfCover: state.ooc });

// A number that counts up or down to its new value when the build changes.
const live = (key, value, text = fmt(value)) => `<b data-num="${key}" data-value="${isFinite(value) ? value : 0}">${text}</b>`;

// The agent overview: core ring, headline numbers and the switch between the game's stat
// sheet and the in-combat view.
function agentPanel(result) {
  const combat = inCombat(state);
  const w = result.weapons[state.active];
  const d = w ? dps(w, shotOptions()) : null;
  const order = [...Array(result.cores.offense).fill('offense'), ...Array(result.cores.defense).fill('defense'), ...Array(result.cores.utility).fill('utility')];
  const slots = Math.max(6, order.length), arc = 263.9 / slots; // circumference of r=42
  const ring = Array.from({ length: slots }, (_, i) =>
    `<circle class="seg-arc ${order[i] ? `c-${order[i]}` : 'c-none'}" cx="50" cy="50" r="42" stroke-dasharray="${(arc - 4).toFixed(1)} 999" stroke-dashoffset="${(-i * arc).toFixed(1)}" style="--i:${i}"/>`).join('');
  return `<section class="panel agent">
    <div class="agent-top">
      <div class="ring">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-spin" cx="50" cy="50" r="48"/><g transform="rotate(-90 50 50)">${ring}</g><circle class="ring-core" cx="50" cy="50" r="33"/></svg>
        <div class="ring-label"><span>${w ? 'DPS' : 'Gear'}</span>${w ? live('ring', d.sustained, compact(d.sustained)) : `<b>${Object.keys(result.pieces).length}/6</b>`}</div>
      </div>
      <dl class="agent-stats">
        <div><dt>${w ? esc(w.name) : 'No weapon'}</dt><dd>${w ? live('listed', w.listed) : '—'}<em>DMG</em></dd></div>
        <div><dt>Rate of fire</dt><dd>${w ? live('rpm', w.rpm) : '—'}<em>RPM</em></dd></div>
        <div><dt>Magazine</dt><dd>${w ? fmt(w.mag) : '—'}<em>MAG</em></dd></div>
        <div><dt>Armor</dt><dd class="c-defense">${live('armor', result.totals.armor)}</dd></div>
        <div><dt>Health</dt><dd>${live('health', result.totals.health)}</dd></div>
        <div><dt>Skill tier</dt><dd class="c-utility">${result.totals.skillTier}<span class="tier">${Array.from({ length: 6 }, (_, i) => `<i class="${i < result.totals.skillTier ? 'on' : ''}"></i>`).join('')}</span></dd></div>
      </dl>
    </div>
    <div class="seg mode">
      <button class="seg-btn${combat ? '' : ' on'}" data-action="set" data-path="mode" data-value="sheet">Stat sheet</button>
      <button class="seg-btn${combat ? ' on' : ''}" data-action="set" data-path="mode" data-value="combat">In combat</button>
    </div>
    <p class="note">${combat
    ? 'Talents, set bonuses and stacks are counted the way the Talents and bonuses panel is set.'
    : 'Matches the Stats page in your inventory: gear, mods, watch and always-on bonuses only. Talents that need a kill, stacks or a status effect are left out.'}</p>
  </section>`;
}

// Runs the count animation for every live number whose value changed since the last render.
const shownNumbers = new Map();
// Animations follow the visitor's system setting until they choose for themselves with the
// Animations button. index.html sets data-motion before the first paint.
const motionOff = () => document.documentElement.dataset.motion === 'off';
function showMotion() {
  const el = $('#motion-btn');
  if (el) { el.textContent = `Animations: ${motionOff() ? 'off' : 'on'}`; el.setAttribute('aria-pressed', String(!motionOff())); }
}
function animateNumbers() {
  for (const el of document.querySelectorAll('[data-num]')) {
    const key = el.dataset.num, to = Number(el.dataset.value), from = shownNumbers.get(key);
    shownNumbers.set(key, to);
    if (from === undefined || from === to || motionOff()) continue;
    const format = /M|K/.test(el.textContent) ? compact : fmt;
    const start = performance.now();
    el.classList.add('bump');
    const step = now => {
      const t = Math.min(1, (now - start) / 420);
      el.textContent = format(from + (to - from) * (1 - (1 - t) ** 3));
      if (t < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function weaponPanel(result) {
  const tabs = [0, 1, 2].map(i => `<button class="seg-btn${state.active === i ? ' on' : ''}" data-action="tab" data-i="${i}">${
    esc(result.weapons[i]?.name || WEAPON_SLOTS[i])}</button>`).join('');
  const w = result.weapons[state.active];
  if (!w) return `<section class="panel"><div class="seg">${tabs}</div><p class="note">No weapon in this slot. The totals below show your gear on its own.</p></section>`;
  const d = dps(w, shotOptions());
  return `<section class="panel">
    <div class="seg">${tabs}</div>
    <div class="hero">
      <div><span>Sustained DPS</span><strong>${live('sustained', d.sustained)}</strong></div>
      <div><span>Burst DPS</span><strong>${live('burst', d.burst)}</strong></div>
    </div>
    ${kv([
      ['Listed weapon damage', fmt(w.listed)], ['All weapon damage bonus', `${fmt1(w.stats.weapon_damage || 0)}%`],
      ['Body shot', fmt(w.body)], ['Critical hit', fmt(w.crit)],
      ['Headshot', fmt(w.headshot)], ['Critical headshot', fmt(w.headshotCrit)],
      ['Average bullet', fmt(d.bullet)], ['Rate of fire', `${fmt(w.rpm)} RPM`],
      ['Magazine', fmt(w.mag)], ['Reload', `${fmt1(w.reload)}s`],
      ['Crit chance', `${fmt1(w.chc)}%`], ['Crit damage', `${fmt1(w.chd)}%`],
      ['Headshot damage', `${fmt1(w.hsd)}%`], ['Weapon damage', `+${fmt1(w.weaponDamage)}%`],
      ['Total weapon damage', `+${fmt1(w.twd)}%`], ['Amplified', `×${w.amp.toFixed(2)}`],
      ['Damage to armor', `${fmt1(w.dta)}%`], ['Damage to health', `${fmt1(w.dth)}%`],
    ])}
  </section>`;
}

function setsPanel(result) {
  const order = [...Array(result.cores.offense).fill('offense'), ...Array(result.cores.defense).fill('defense'), ...Array(result.cores.utility).fill('utility')];
  const bar = order.length
    ? `<div class="corebar">${order.map(c => `<i class="c-${c}"></i>`).join('')}</div>
       <p class="cores"><span class="c-offense">${result.cores.offense} red</span><span class="c-defense">${result.cores.defense} blue</span><span class="c-utility">${result.cores.utility} yellow</span></p>`
    : '<p class="note">No gear yet.</p>';
  const sets = result.sets.map(set => `<div class="set q-${set.kind === 'gearset' ? 'gearset' : 'high-end'}">
    <h4>${esc(set.name)} <span>${set.count} ${set.count === 1 ? 'piece' : 'pieces'}</span></h4>
    <ul>${set.bonuses.map(b => `<li class="${b.active ? 'on' : ''}"><b>${b.pieces}</b>${esc(b.text)}</li>`).join('')}
    ${set.four ? `<li class="${set.four.active ? 'on' : ''}"><b>4</b>${esc(set.four.name)}</li>` : ''}</ul>
  </div>`).join('');
  return `<section class="panel"><h2>Cores and sets</h2>${bar}${sets}</section>`;
}

function sourcesPanel(result) {
  const all = result.view.sources;
  if (!all.length) return '';
  // On the stat sheet only the always-on ones matter; the rest are one click away.
  const list = inCombat(state) ? all : all.filter(src => src.always);
  const hidden = all.length - list.length;
  return `<section class="panel"><h2>Talents and bonuses</h2>
    ${hidden ? `<p class="note">${hidden} conditional ${hidden === 1 ? 'talent is' : 'talents are'} not counted on the stat sheet.
      <button class="btn small" data-action="set" data-path="mode" data-value="combat">Show in combat</button></p>` : ''}
    ${list.map(src => `<div class="source${src.counted && src.hasEffect ? ' on' : ''}">
      <h4>${esc(src.name)} <span>${esc(src.where)}</span></h4>${sourceControl(src)}</div>`).join('')}
  </section>`;
}

function totalsPanel(result) {
  const s = result.view.stats, t = result.totals;
  const lead = {
    offense: [['Crit chance (capped)', `${fmt1(t.chc)}%`], ['Crit damage (total)', `${fmt1(t.chd)}%`]],
    defense: [['Total armor', fmt(t.armor)], [db.num('base_health') ? 'Total health' : 'Bonus health', fmt(t.health)],
      ['Armor + health', fmt(t.armor + t.health)], ['Same, against elites', fmt((t.armor + t.health) / (1 - Math.min(90, s.protection_elites || 0) / 100))]],
    skill: [['Skill tier', String(t.skillTier)]],
    handling: [], other: [],
  };
  const names = { offense: 'Offense', defense: 'Defense', skill: 'Skills', handling: 'Handling', other: 'Other' };
  // Two stats share a name with their percentage version, so spell out which is which here.
  const relabel = {
    armor: 'Armor from cores', armor_pct: 'Total armor bonus', health: 'Health from attributes', health_pct: 'Health bonus',
    weapon_damage: 'All weapon damage bonus', accuracy: 'Accuracy bonus', stability: 'Stability bonus', reload_speed: 'Reload speed bonus',
  };
  return Object.keys(lead).map(group => {
    const rows = Object.keys(STATS).filter(k => statGroup(k) === group && s[k]).map(k => [relabel[k] || statLabel(k), amount(k, s[k])]);
    if (!rows.length && !lead[group].length) return '';
    return `<details class="panel"${group === 'other' ? '' : ' open'}><summary><h2>${names[group]}</h2></summary>${kv([...lead[group], ...rows])}</details>`;
  }).join('');
}

function chartPanel(result) {
  const W = 640, H = 250, L = 50, R = 12, T = 12, B = 28;
  const series = result.weapons.map((w, i) => w && { i, name: w.name, points: timeline(w, shotOptions(), CHART_SECONDS) }).filter(Boolean);
  if (!series.length) return '';
  const max = Math.max(1, ...series.map(s => s.points[s.points.length - 1][1]));
  const x = t => L + (t / CHART_SECONDS) * (W - L - R);
  const y = v => H - B - (v / max) * (H - T - B);
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = max * k / 4;
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  for (let t = 0; t <= CHART_SECONDS; t += 2) grid += `<text class="tick" x="${x(t)}" y="${H - 8}" text-anchor="middle">${t}s</text>`;
  const lines = series.map(s => `<polyline class="line s${s.i}" points="${s.points.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
  return `<section class="panel"><h2>Damage over ${CHART_SECONDS} seconds</h2>
    <div class="legend">${series.map(s => `<span><i class="s${s.i}"></i>${esc(s.name)}</span>`).join('')}</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Total damage over time for each weapon. Flat stretches are reloads.">${grid}${lines}</svg>
    <p class="note">Flat stretches are reloads. Uses your crit chance and the headshot chance below.</p>
  </section>`;
}

function ttkPanel(result) {
  const presets = db.targets.map(t => ({ value: t.name, label: `${t.name} (${compact(+t.armor)} armor, ${compact(+t.health)} health)` }));
  const rows = result.weapons.map(w => {
    const k = w && timeToKill(w, shotOptions(), state.target);
    return k ? `<tr><th>${esc(w.name)}</th><td>${fmt(k.bullets)}</td><td>${fmt1(k.time)}s</td><td>${k.reloads}</td></tr>` : '';
  }).join('');
  return `<section class="panel"><h2>Time to kill</h2>
    <div class="grid2">
      <label class="field"><span>Headshot chance %</span>${numberBox('hsc', state.hsc, 100, 'Headshot chance', 1)}</label>
      <label class="field"><span>Target preset</span><select data-preset>${options(presets, '', 'Custom')}</select></label>
      <label class="field"><span>Target armor</span>${numberBox('target.armor', state.target.armor, 999999999, 'Target armor', 1000)}</label>
      <label class="field"><span>Target health</span>${numberBox('target.health', state.target.health, 999999999, 'Target health', 1000)}</label>
    </div>
    <label class="check"><input type="checkbox" data-path="ooc"${state.ooc ? ' checked' : ''}><span>Target is out of cover</span></label>
    ${rows ? `<table><thead><tr><th>Weapon</th><th>Bullets</th><th>Time</th><th>Reloads</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="note">Add a weapon to see time to kill.</p>'}
  </section>`;
}

// A skill stat at the build's tier, with the matching gear bonus applied where it is clear which one applies.
function skillValue(stat, tier, s) {
  const tidy = t => String(t || '').replace(/[‎‏]/g, '').trim();
  const base = tidy(stat.base), step = tier > 0 ? tidy(stat.tiers[tier - 1]) : '';
  const number = parseFloat(base.replace(/,/g, ''));
  const unit = (base.match(/[a-z%]+$/i) || [''])[0];
  const pct = /^[+-]?[\d.]+%/.test(step) ? parseFloat(step) : 0;
  const name = stat.name.toLowerCase();
  if (isNaN(number) || /pvp/.test(name)) return base;
  const g = k => s[k] || 0;
  let value = null;
  if (name === 'cooldown' || name === 'refill speed') value = number / (1 + ((/haste/i.test(step) ? pct : 0) + g('skill_haste')) / 100);
  else if (/damage/.test(name) && unit !== '%') value = number * (1 + pct / 100) * (1 + g('skill_damage') / 100) * (1 + g('total_skill_damage') / 100);
  else if (name === 'health') value = number * (1 + pct / 100) * (1 + g('skill_health') / 100);
  else if (/repair|\bheal(ing)?\b/.test(name) && unit !== '%') value = number * (1 + pct / 100) * (1 + g('repair_skills') / 100) * (1 + g('total_skill_repair') / 100);
  else if (/^duration/.test(name)) value = number * (1 + pct / 100) * (1 + g('skill_duration') / 100);
  if (value === null) return step && step !== '-' ? `${base} (${step})` : base;
  return `${value >= 1000 ? fmt(value) : fmt1(value)}${unit}`;
}

function skillsPanel(result) {
  const picked = state.skills.map(n => db.by.skill.get(n)).filter(Boolean);
  if (!picked.length) return '';
  const tier = result.totals.skillTier;
  return `<section class="panel"><h2>Skills at tier ${tier}</h2>
    ${picked.map(skill => `<h4>${esc(skill.name)}</h4>${kv(skill.stats.map(st => [st.name, skillValue(st, tier, result.view.stats)])).replace('class="kv"', 'class="kv wide"')}`).join('')}
  </section>`;
}

// ---- player tools ----

// Watch points spent per category, and how many the entered SHD level gives. One point goes
// to each of the five categories in turn, so a category gets a point every five levels.
function watchUse() {
  const used = {};
  for (const r of db.attributes.watch) used[r.category] = (used[r.category] || 0) + (state.watch[r.stat] || 0);
  return { used, each: state.shd > 0 ? Math.min(200, Math.floor(state.shd / 5)) : null };
}

// Things the game would not allow, and things left unfinished.
function checksPanel(result) {
  const items = [];
  const add = (level, text) => items.push({ level, text });
  const weapons = result.weapons.filter(Boolean), pieces = Object.values(result.pieces);
  const exoticWeapons = weapons.filter(w => w.row.quality === 'exotic').length;
  const exoticGear = pieces.filter(p => p.quality === 'exotic').length;
  if (exoticWeapons > 1) add('bad', `${exoticWeapons} exotic weapons equipped. The game allows one.`);
  if (exoticGear > 1) add('bad', `${exoticGear} exotic gear pieces equipped. The game allows one.`);
  const { used, each } = watchUse();
  if (each !== null) for (const [name, n] of Object.entries(used)) if (n > each) add('bad', `${name} watch: ${n} points spent, SHD level ${state.shd} gives ${each}.`);

  const s = result.view.stats;
  const chc = db.num('base_chc') + (s.chc || 0), cap = db.num('chc_cap', 60);
  if (chc > cap + 0.05) add('warn', `${fmt1(chc - cap)}% crit chance is above the ${cap}% cap and does nothing.`);
  const tierCap = db.num('skill_tier_cap', 6);
  if ((s.skill_tier || 0) > tierCap) add('warn', `Skill tier ${fmt1(s.skill_tier)} is above the cap of ${tierCap}.`);

  const emptySlots = 3 - weapons.length + GEAR_SLOTS.length - pieces.length;
  if (emptySlots) add('warn', `${emptySlots} empty ${emptySlots === 1 ? 'slot' : 'slots'}.`);
  let open = 0;
  for (const p of pieces) open += [...p.free, ...p.mods].filter(a => !a.stat).length + (p.chooseTalent && !p.talent ? 1 : 0);
  for (const w of weapons) {
    open += (state.weapons[w.index].a ? 0 : 1) + (w.row.quality === 'high-end' && !w.talent ? 1 : 0);
    if (w.row.slots) open += MOD_SLOTS.filter(m => w.row.slots[m]).length - w.mods.length;
  }
  if (open) add('warn', `${open} attribute, mod or talent ${open === 1 ? 'choice is' : 'choices are'} still empty.`);
  if (!items.length) add('ok', 'No problems found: the loadout is complete and legal.');
  return `<section class="panel"><h2>Loadout check</h2>
    <ul class="checks">${items.map(i => `<li class="${i.level}"><i></i>${esc(i.text)}</li>`).join('')}</ul></section>`;
}

// How much sustained DPS one more roll of each kind would add to the weapon in hand.
function gainsPanel(result) {
  const w = result.weapons[state.active];
  if (!w) return '';
  const opts = shotOptions(), base = dps(w, opts).sustained;
  if (!(base > 0)) return '';
  const cap = db.num('chc_cap', 60), rof = w.stats.rof || 0, reload = w.stats.reload_speed || 0;
  const tries = [
    ['+15% weapon damage (one red core)', { body: w.body * (1 + (w.weaponDamage + 15) / 100) / (1 + w.weaponDamage / 100) }],
    ['+6% crit chance', { chc: Math.min(cap, w.chc + 6) }],
    ['+12% crit damage', { chd: w.chd + 12 }],
    ['+10% headshot damage', { hsd: w.hsd + 10 }],
    ['+5% rate of fire', { rpm: w.rpm * (1 + (rof + 5) / 100) / (1 + rof / 100) }],
    ['+10% reload speed', { reload: w.reload * (1 + reload / 100) / (1 + (reload + 10) / 100) }],
    ['+10% amplified damage', { body: w.body * 1.1 }],
  ].map(([label, change]) => ({ label, gain: (dps({ ...w, ...change }, opts).sustained / base - 1) * 100 }))
    .sort((a, b) => b.gain - a.gain);
  const top = Math.max(0.01, tries[0].gain);
  return `<section class="panel"><h2>What to improve next</h2>
    <p class="note">Sustained DPS gained on ${esc(w.name)} from one more roll of each kind, at ${state.hsc}% headshots.</p>
    <ul class="gains">${tries.map(t => `<li><span>${esc(t.label)}</span><b>+${fmt1(t.gain)}%</b><i style="width:${(t.gain / top * 100).toFixed(1)}%"></i></li>`).join('')}</ul></section>`;
}

// This build next to one of the saved ones.
function comparePanel(result) {
  const saved = readSaved(), names = Object.keys(saved).sort((a, b) => a.localeCompare(b));
  const picker = `<select id="compare" aria-label="Saved build to compare with">${options(names.map(n => ({ value: n, label: n })), ui.compare || '', 'Choose a saved build')}</select>`;
  let body = names.length ? '' : '<p class="note">Save a build first (Saved builds, top of the page) to compare against it.</p>';
  if (saved[ui.compare]) {
    const otherState = normalize(JSON.parse(JSON.stringify(saved[ui.compare])));
    otherState.mode = state.mode;
    const other = compute(db, otherState);
    const pick = (r, st) => { const w = r.weapons[st.active] || r.weapons.find(Boolean); return w ? { w, d: dps(w, { headshotChance: state.hsc, outOfCover: state.ooc }) } : null; };
    const a = pick(result, state), b = pick(other, otherState);
    const rows = [
      ['Sustained DPS', a?.d.sustained, b?.d.sustained], ['Burst DPS', a?.d.burst, b?.d.burst],
      ['Bullet damage', a?.w.body, b?.w.body], ['Armor', result.totals.armor, other.totals.armor],
      ['Health', result.totals.health, other.totals.health], ['Crit chance %', result.totals.chc, other.totals.chc],
      ['Crit damage %', result.totals.chd, other.totals.chd], ['Skill tier', result.totals.skillTier, other.totals.skillTier],
    ].map(([label, x, y]) => {
      const dx = (x || 0) - (y || 0), pct = y ? dx / y * 100 : 0;
      return `<tr><th>${label}</th><td>${x === undefined ? '—' : x >= 1000 ? fmt(x) : fmt1(x)}</td><td>${y === undefined ? '—' : y >= 1000 ? fmt(y) : fmt1(y)}</td>
        <td class="${dx > 0 ? 'up' : dx < 0 ? 'down' : ''}">${dx > 0 ? '+' : ''}${Math.abs(pct) >= 0.05 ? `${fmt1(pct)}%` : '0%'}</td></tr>`;
    }).join('');
    body = `<table class="compare"><thead><tr><th></th><th>This build</th><th>${esc(ui.compare)}</th><th>Difference</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Both builds use the view selected above (${inCombat(state) ? 'in combat' : 'stat sheet'}) and each one's weapon in hand.</p>`;
  }
  return `<section class="panel"><h2>Compare builds</h2>${picker}${body}</section>`;
}

// The build as plain text, for pasting into a chat.
function buildText(result) {
  const lines = ['Division 2 build' + (result.spec ? ` (${result.spec.name})` : '')];
  result.weapons.forEach((w, i) => { if (w) lines.push(`${WEAPON_SLOTS[i]}: ${w.name}${w.talent ? ` [${w.talent.name}]` : ''}`); });
  for (const slot of GEAR_SLOTS) {
    const p = result.pieces[slot];
    if (!p) continue;
    const attrs = [...p.attrs, ...p.free, ...p.mods].filter(a => a.stat).map(a => `${amount(a.stat, a.value)} ${SHORT[a.stat] || statLabel(a.stat)}`).join(', ');
    lines.push(`${cap(slot)}: ${p.name}${p.proto ? ' (Prototype)' : ''} · ${CORE_NAME[p.coreType]}${p.talent ? ` [${p.talent.name}]` : ''}${attrs ? ` · ${attrs}` : ''}`);
  }
  const skills = state.skills.filter(Boolean);
  if (skills.length) lines.push(`Skills: ${skills.join(', ')}`);
  const w = result.weapons[state.active];
  const t = result.totals;
  lines.push(`Cores: ${result.cores.offense} red / ${result.cores.defense} blue / ${result.cores.utility} yellow`);
  if (w) lines.push(`${w.name}: ${fmt(dps(w, shotOptions()).sustained)} sustained DPS, ${fmt(w.rpm)} RPM, ${fmt1(w.chc)}% CHC, ${fmt1(w.chd)}% CHD, ${fmt1(w.hsd)}% HSD`);
  lines.push(`Armor ${fmt(t.armor)} · Health ${fmt(t.health)} · Skill tier ${t.skillTier}`);
  lines.push(location.href);
  return lines.join('\n');
}

function renderStats(result) {
  $('#stats').innerHTML = agentPanel(result) + checksPanel(result) + weaponPanel(result) + gainsPanel(result) + setsPanel(result) + sourcesPanel(result)
    + augmentsPanel(result) + chartPanel(result) + ttkPanel(result) + comparePanel(result) + totalsPanel(result) + skillsPanel(result);
}

// ---- editor dialog ----

function pickRows() {
  const { kind, id } = ui.edit;
  const q = ui.query.trim().toLowerCase();
  const hit = (...texts) => !q || texts.some(t => String(t || '').toLowerCase().includes(q));
  const row = (value, quality, name, meta, extra, art) => `<button class="row q-${quality}${kind === 'weapon' ? ' wide' : ''}" data-action="pick" data-value="${esc(value)}">
    <span class="row-art">${art}</span><span class="row-name">${esc(name)}</span><span class="row-meta">${esc(meta)}</span>${extra ? `<span class="row-extra">${esc(extra)}</span>` : ''}</button>`;

  if (kind === 'weapon') {
    return db.weapons
      .filter(w => (id === 2) === (w.type === 'pistol'))
      .filter(w => ui.filter === 'all' || w.type === ui.filter || w.quality === ui.filter)
      .filter(w => hit(w.name, w.family, w.base, w.talent?.name, WEAPON_TYPES[w.type]))
      .map(w => row(w.name, w.quality, w.name + (w.pts ? ' (PTS)' : ''),
        `${WEAPON_TYPES[w.type]}${w.base ? ` · ${w.base}` : w.family && w.family !== w.name ? ` · ${w.family}` : ''} · ${compact(w.damage)} dmg · ${fmt(w.rpm)} RPM · ${fmt(w.mag)} mag`,
        w.talent?.name || w.unique, weaponArt(w))).join('');
  }
  if (kind === 'gear') {
    const out = [];
    const want = f => ui.filter === 'all' || ui.filter === f;
    if (want('brand')) for (const b of db.brands) if (hit(b.name, ...b.bonuses.map(x => x.text))) out.push(row(`b:${b.name}`, 'high-end', b.name, b.bonuses.map(x => x.text).join(' · '), `${CORE_NAME[b.core]} core`, gearArt({ name: b.name, quality: 'high-end', slot: id, core: b.core })));
    if (want('gearset')) for (const s of db.gearsets) if (hit(s.name, s.four?.name, ...s.bonuses.map(x => x.text))) out.push(row(`s:${s.name}`, 'gearset', s.name, s.bonuses.map(x => x.text).join(' · '), s.four?.name, gearArt({ name: s.name, quality: 'gearset', slot: id, core: s.core })));
    for (const g of db.gear) {
      if (g.slot !== id || !want(g.quality) || !hit(g.name, g.brand, g.talent?.name, g.perk)) continue;
      out.push(row(`g:${g.name}`, g.quality, g.name, g.quality === 'exotic' ? 'Exotic' : g.brand, g.talent?.name || g.perk, gearArt(g)));
    }
    return out.join('');
  }
  return db.skills.filter(s => hit(s.name, s.skill)).map(s => row(s.name, 'skill', s.variant, s.skill, '', skillArt(s))).join('');
}

function pickerView() {
  const { kind, id } = ui.edit;
  const filters = kind === 'weapon'
    ? [['all', 'All'], ...(id === 2 ? [] : Object.entries(WEAPON_TYPES).filter(([k]) => k !== 'pistol')), ['high-end', 'High-end'], ['named', 'Named'], ['exotic', 'Exotic']]
    : kind === 'gear' ? [['all', 'All'], ['brand', 'Brands'], ['gearset', 'Gear sets'], ['named', 'Named'], ['exotic', 'Exotic']] : [];
  return `<div class="picker">
    <input id="pick-q" class="search" type="search" placeholder="Search by name, brand or talent" value="${esc(ui.query)}" aria-label="Search" autocomplete="off">
    ${filters.length ? `<div class="filters">${filters.map(([k, label]) => `<button class="pill${ui.filter === k ? ' on' : ''}" data-action="filter" data-value="${k}">${esc(label)}</button>`).join('')}</div>` : ''}
    <div id="pick-list" class="list">${pickRows() || '<p class="note">Nothing matches.</p>'}</div>
  </div>`;
}

function talentBlock(talent, src) {
  if (!talent) return '';
  return `<div class="talent"><h4>${esc(talent.name)}</h4><p>${esc(talent.text)}</p>${src ? sourceControl(src) : ''}</div>`;
}

function weaponConfig(i, result) {
  const saved = state.weapons[i], w = result.weapons[i], row = w.row, path = `weapons.${i}`;
  const { core, cls, minor } = weaponAttributes(db, row, w.proto);
  const third = saved.a ? minor(saved.a) : null;
  const words = { damage: 'damage', rpm: 'rate of fire', mag: 'magazine', reload: 'reload' };
  const copied = row.copied?.length ? ` ${cap(row.copied.map(k => words[k]).join(', '))} copied from the standard ${row.base} until the real numbers are known.` : '';
  const src = w.sources.find(s => s.key === `w:${i}`);
  const talents = weaponTalents(db, row).map(t => ({ value: t.name, label: t.name }));
  const mods = slot => db.weaponMods.filter(m => m.slot === slot).map(m => ({ value: m.name, label: `${m.name} · ${m.text || 'no bonus'}`, group: m.rail || 'Optics' }));
  return `<div class="item q-${row.quality}">
      <span class="item-art wide">${weaponArt(row)}</span>
      <div><span class="badge">${QUALITY[row.quality]}</span><h3>${esc(row.name)}</h3>
      <p class="note">${esc(WEAPON_TYPES[row.type])}${row.base ? ` · ${esc(row.base)}` : ''} · ${fmt(row.damage)} damage · ${fmt(row.rpm)} RPM · ${fmt(row.mag)} rounds · ${fmt1(row.reload)}s reload · ${fmt(row.range)}m range</p>
      ${row.unique ? `<p class="note">Unique: ${esc(row.unique)}</p>` : ''}
      ${row.extra ? `<p class="note warn">Not in the community sheet yet. Source: ${esc(row.source)}.${esc(copied)}</p>` : ''}</div>
      <button class="btn small" data-action="change">Change</button>
    </div>
    ${prototypeBlock(path, saved, canPrototype(row), w.augment)}
    <h3 class="sub">Attributes</h3>
    <div class="grid2">
      <label class="field"><span>${esc(statLabel(core.stat))} (core) ${maxNote(core.stat, core.max, core.estimate)}</span>${numberBox(`${path}.cv`, shown(saved.cv, core.max), core.max, 'Core value')}</label>
      ${cls ? `<label class="field"><span>${esc(statLabel(cls.stat))} ${maxNote(cls.stat, cls.max, cls.estimate)}</span>${numberBox(`${path}.kv`, shown(saved.kv, cls.max), cls.max, 'Class attribute value')}</label>` : ''}
    </div>
    <label class="field"><span>Third attribute</span><span class="pair">
      <select data-path="${path}.a" data-clear="${path}.av">${options(db.attributes.weaponMinors.map(a => ({ value: a.stat, label: `${statLabel(a.stat)} · ${amount(a.stat, minor(a.stat).max)}${minor(a.stat).estimate ? ' (estimated)' : ''}` })), saved.a || '', 'Choose an attribute')}</select>
      ${third ? numberBox(`${path}.av`, shown(saved.av, third.max), third.max, 'Attribute value') : ''}</span></label>
    <h3 class="sub">Talent</h3>
    ${row.talent ? '' : `<label class="field"><span>Talent</span><select data-path="${path}.t">${options(talents, saved.t || '', 'No talent')}</select></label>`}
    ${talentBlock(w.talent, src)}
    <h3 class="sub">Mods</h3>
    ${row.slots
    ? (MOD_SLOTS.filter(s => row.slots[s]).map(slot => `<label class="field"><span>${cap(slot)}</span><select data-path="${path}.m.${slot}">${options(mods(slot), saved.m?.[slot] || '', 'Empty')}</select></label>`).join('') || '<p class="note">This weapon has no mod slots.</p>')
    : (row.fixedMods.length ? `<ul class="fixed">${row.fixedMods.map(m => `<li><b>${cap(m.slot)}</b>${esc(m.text)}</li>`).join('')}</ul>` : '<p class="note">No mods.</p>')}
    <h3 class="sub">Expertise</h3>
    <label class="field inline"><span>Grade <em>+${db.num('expertise_weapon', 1)}% weapon damage each</em></span>${numberBox(`${path}.e`, saved.e || 0, db.num('expertise_max', 30), 'Expertise grade', 1)}</label>`;
}

function gearConfig(slot, result) {
  const saved = state.gear[slot], r = result.pieces[slot], path = `gear.${slot}`;
  const A = db.attributes;
  const src = result.view.sources.find(s => s.key === `g:${slot}`);
  const set = result.sets.find(s => s.name === r.set);
  const talents = db.gearTalents.filter(t => t.slot === slot).map(t => ({ value: t.name, label: t.name }));
  const core = r.cores[0];
  return `<div class="item q-${r.quality}">
      <span class="item-art">${gearArt({ name: r.name, quality: r.quality, slot, brand: r.brand, core: r.coreType })}</span>
      <div><span class="badge">${QUALITY[r.quality]}</span><h3>${esc(r.name)}</h3>
      <p class="note">${cap(slot)}${r.brand && r.quality !== 'gearset' && r.quality !== 'high-end' ? ` · ${esc(r.brand)}` : ''}${set ? ` · ${set.count} ${set.count === 1 ? 'piece' : 'pieces'} equipped` : ''}</p>
      ${r.perk ? `<p class="note">Named perk: ${esc(r.perk)}</p>` : ''}
      ${r.extra ? `<p class="note warn">Not in the community sheet yet. Source: ${esc(r.source)}.</p>` : ''}</div>
      <button class="btn small" data-action="change">Change</button>
    </div>
    ${prototypeBlock(path, saved, r.canProto, r.augment)}
    <h3 class="sub">Core</h3>
    <div class="seg">${CORES.map(c => `<button class="seg-btn c-${c}${r.coreType === c ? ' on' : ''}" data-action="set" data-path="${path}.c" data-value="${c}" data-clear="${path}.cv"><i class="pip c-${c}"></i>${CORE_NAME[c]}</button>`).join('')}</div>
    <label class="field inline"><span>${esc(statLabel(core.stat))} ${maxNote(core.stat, r.coreMax, r.coreEstimate)}</span>${numberBox(`${path}.cv`, shown(saved.cv, r.coreMax), r.coreMax, 'Core value')}</label>
    ${r.cores.slice(1).map(c => `<p class="note"><i class="pip c-${c.type}"></i> Extra core: ${esc(bonus(c.stat, c.value))}</p>`).join('')}
    <h3 class="sub">Attributes</h3>
    ${r.attrs.map(a => (r.proto
    ? `<label class="field inline"><span>${esc(statLabel(a.stat))} <em>named attribute, max ${amount(a.stat, a.max)} estimated</em></span>${numberBox(`${path}.f.${a.index}`, a.value, a.max, `${statLabel(a.stat)} value`)}</label>`
    : `<p class="fixed-line">${esc(bonus(a.stat, a.value))} <span>fixed</span></p>`)).join('')}
    ${r.free.map((a, i) => attrRow(`Attribute ${i + 1}`, `${path}.a.${i}`, A.gearMinors, a.stat, saved.a?.[i]?.v, a.color, 'Choose an attribute', r.proto)).join('')}
    ${!r.attrs.length && !r.free.length ? '<p class="note">No attributes on this piece.</p>' : ''}
    ${r.mods.length ? `<h3 class="sub">Gear mod${r.mods.length > 1 ? 's' : ''}</h3>${r.mods.map((m, i) => attrRow(`Mod slot ${i + 1}`, `${path}.m.${i}`, A.gearMods, m.stat, saved.m?.[i]?.v, null, 'Empty')).join('')}` : ''}
    ${r.chooseTalent || r.talent || r.setTalent ? '<h3 class="sub">Talent</h3>' : ''}
    ${r.chooseTalent ? `<label class="field"><span>Talent</span><select data-path="${path}.t">${options(talents, saved.t || '', 'No talent')}</select></label>` : ''}
    ${talentBlock(r.talent, src)}
    ${r.setTalent ? `<div class="talent"><h4>${esc(r.setTalent.name)}</h4><p>${esc(r.setTalent.text)}</p><p class="note">Works with the 4-piece bonus of ${esc(r.name)}.</p></div>` : ''}
    <h3 class="sub">Expertise</h3>
    <label class="field inline"><span>Grade <em>+${db.num('expertise_armor', 1)}% on an armor core each</em></span>${numberBox(`${path}.e`, saved.e || 0, db.num('expertise_max', 30), 'Expertise grade', 1)}</label>`;
}

function augmentsPanel(result) {
  if (!result.augments.length) return '';
  return `<section class="panel"><h2>Augments</h2>
    ${result.augments.map(a => `<div class="source on"><h4>${esc(a.name)} <span>${fmt1(a.total)}${esc(a.unit)} in total</span></h4><p class="note">${esc(a.text)}</p></div>`).join('')}
  </section>`;
}

function skillConfig(i) {
  const skill = db.by.skill.get(state.skills[i]);
  return `<div class="item q-skill"><span class="item-art">${skillArt(skill)}</span><div><span class="badge">Skill</span><h3>${esc(skill.name)}</h3></div><button class="btn small" data-action="change">Change</button></div>
    <h3 class="sub">Per skill tier</h3>
    <div class="scroll"><table class="tiers"><thead><tr><th>Stat</th><th>Base</th>${[1, 2, 3, 4, 5, 6].map(t => `<th>T${t}</th>`).join('')}</tr></thead>
    <tbody>${skill.stats.map(s => `<tr><th>${esc(s.name)}</th><td>${esc(s.base)}</td>${s.tiers.map(t => `<td>${esc(t.replace(/[‎‏]/g, ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function hasItem({ kind, id }, result) {
  if (kind === 'weapon') return !!result.weapons[id];
  if (kind === 'gear') return !!result.pieces[id];
  return !!db.by.skill.get(state.skills[id]);
}

function renderEditor(result) {
  const dialog = $('#editor');
  if (!ui.edit) return;
  const { kind, id } = ui.edit;
  const filled = hasItem(ui.edit, result);
  const picking = ui.picking || !filled;
  const title = kind === 'weapon' ? `${WEAPON_SLOTS[id]} weapon` : kind === 'gear' ? cap(id) : `Skill ${id + 1}`;
  const body = picking ? pickerView() : kind === 'weapon' ? weaponConfig(id, result) : kind === 'gear' ? gearConfig(id, result) : skillConfig(id);
  const scroll = dialog.querySelector('.sheet-body')?.scrollTop || 0;
  const focused = document.activeElement?.dataset?.path;
  // Only a change of view slides in; editing a value must not replay it.
  const view = `${kind}:${id}:${picking}`;
  const swap = ui.view !== view;
  ui.view = view;
  dialog.innerHTML = `<div class="sheet-inner">
    <header class="sheet-head"><div><p class="eyebrow">${picking ? 'Choose' : 'Configure'}</p><h2>${esc(title)}</h2></div>
      <button class="btn icon" data-action="close" aria-label="Close">✕</button></header>
    <div class="sheet-body${swap ? ' swap' : ''}">${body}</div>
    <footer class="sheet-foot">
      ${filled ? '<button class="btn ghost danger" data-action="remove">Remove</button>' : '<span></span>'}
      ${picking && filled ? '<button class="btn" data-action="back">Back</button>' : '<button class="btn primary" data-action="close">Done</button>'}
    </footer></div>`;
  if (!picking) dialog.querySelector('.sheet-body').scrollTop = scroll;
  if (focused) dialog.querySelector(`[data-path="${CSS.escape(focused)}"]`)?.focus();
}

function openEditor(kind, id) {
  ui.edit = { kind, id: kind === 'gear' ? id : Number(id) };
  ui.picking = false; ui.query = ''; ui.filter = 'all';
  renderEditor(last);
  const dialog = $('#editor');
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('#pick-q')?.focus();
}

function renderBuilds() {
  const saved = readSaved();
  const names = Object.keys(saved).sort((a, b) => a.localeCompare(b));
  $('#builds').innerHTML = `<div class="sheet-inner">
    <header class="sheet-head"><div><p class="eyebrow">This browser</p><h2>Saved builds</h2></div><button class="btn icon" data-action="closeBuilds" aria-label="Close">✕</button></header>
    <div class="sheet-body">
      <div class="pair save"><input id="save-name" class="search" type="text" placeholder="Name this build" aria-label="Build name" maxlength="60"><button class="btn primary" data-action="save">Save current</button></div>
      <div class="list">${names.map(n => `<div class="row static"><span class="row-name">${esc(n)}</span>
        <span class="row-actions"><button class="btn small" data-action="load" data-name="${esc(n)}">Load</button><button class="btn small ghost danger" data-action="delete" data-name="${esc(n)}">Delete</button></span></div>`).join('') || '<p class="note">Nothing saved yet. Saved builds stay in this browser; use Copy link to share one.</p>'}</div>
    </div></div>`;
}

// ---- render loop ----

function render() {
  const focused = document.activeElement?.closest('#board, #stats') ? document.activeElement.dataset?.path : null;
  ui.watchOpen = $('#board details.watch')?.open ?? ui.watchOpen;
  ui.extrasOpen = $('#board details[data-keep="extrasOpen"]')?.open ?? ui.extrasOpen;
  last = compute(db, state);
  // Spinning decorations keep their place across redraws by starting "in the past".
  document.documentElement.style.setProperty('--t', (performance.now() / 1000).toFixed(2));
  renderBoard(last);
  renderStats(last);
  if (ui.edit) renderEditor(last);
  animateNumbers();
  if (focused) document.querySelector(`#board [data-path="${CSS.escape(focused)}"], #stats [data-path="${CSS.escape(focused)}"]`)?.focus();
}

function update() {
  render();
  const empty = JSON.stringify(state) === JSON.stringify(blank());
  history.replaceState(null, '', empty ? location.pathname + location.search : `#b=${encode(state)}`);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  for (const k of keys) obj = (obj[k] && typeof obj[k] === 'object') ? obj[k] : (obj[k] = {});
  if (value === undefined) delete obj[lastKey]; else obj[lastKey] = value;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3500);
}

function setChip(mode, detail) {
  const el = $('#data-chip');
  const meta = db?.meta || {};
  const patch = [meta.patch, meta.updated && `sheet updated ${meta.updated}`].filter(Boolean).join(' · ');
  el.className = `chip ${mode}`;
  el.innerHTML = `<i></i><b>${mode === 'live' ? 'Live data' : mode === 'checking' ? 'Syncing' : 'Offline copy'}</b>${patch ? `<span>${esc(patch)}</span>` : ''}`;
  el.title = detail || '';
}

// ---- events ----

const actions = {
  edit: el => openEditor(el.dataset.kind, el.dataset.id),
  close: () => $('#editor').close(),
  back: () => { ui.picking = false; renderEditor(last); },
  change: () => { ui.picking = true; ui.query = ''; ui.filter = 'all'; renderEditor(last); $('#pick-q')?.focus(); },
  filter: el => { ui.filter = el.dataset.value; renderEditor(last); },
  pick: el => {
    const { kind, id } = ui.edit;
    if (kind === 'weapon') { state.weapons[id] = { id: el.dataset.value }; state.active = id; }
    else if (kind === 'gear') state.gear[id] = { item: el.dataset.value };
    else state.skills[id] = el.dataset.value;
    // A new item starts with its own talent settings.
    const key = kind === 'weapon' ? `w:${id}` : `g:${id}`;
    delete state.tog[key];
    delete state.stacks[key];
    ui.picking = false;
    update();
    $('#editor .sheet-body').scrollTop = 0;
  },
  remove: () => {
    const { kind, id } = ui.edit;
    if (kind === 'weapon') state.weapons[id] = {};
    else if (kind === 'gear') delete state.gear[id];
    else state.skills[id] = '';
    $('#editor').close();
    update();
  },
  set: el => {
    setPath(state, el.dataset.path, el.dataset.value);
    if (el.dataset.clear) setPath(state, el.dataset.clear, undefined);
    update();
  },
  spec: el => { state.spec = state.spec === el.dataset.name ? '' : el.dataset.name; update(); },
  specWeapon: el => {
    const limit = db.num('spec_weapon_picks', 3);
    const picked = specWeapons(db, state);
    const type = el.dataset.type;
    if (picked.includes(type)) state.sw = picked.filter(t => t !== type);
    else if (picked.length < limit) state.sw = [...picked, type];
    else return toast(`A specialization boosts ${limit} weapon classes. Remove one first.`);
    update();
  },
  extraAdd: () => {
    const used = Object.keys(state.x).map(Number);
    state.x[used.length ? Math.max(...used) + 1 : 0] = { s: '', v: 0 };
    ui.extrasOpen = true;
    update();
  },
  extraRemove: el => { delete state.x[el.dataset.i]; update(); },
  tab: el => { state.active = Number(el.dataset.i); update(); },
  watchMax: () => { for (const r of db.attributes.watch) state.watch[r.stat] = 50; update(); },
  watchClear: () => { state.watch = {}; update(); },
  reset: () => { state = blank(); update(); toast('Started a new build.'); },
  motion: () => {
    const next = motionOff() ? 'on' : 'off';
    document.documentElement.dataset.motion = next;
    try { localStorage.setItem('d2.motion', next); } catch { /* storage blocked: the choice lasts until the page closes */ }
    showMotion();
    if (next === 'on') {
      // Replay the reveal so the change is visible straight away.
      document.body.classList.add('booting');
      render();
      setTimeout(() => document.body.classList.remove('booting'), 1500);
    }
    toast(next === 'on' ? 'Animations on.' : 'Animations off.');
  },
  share: async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Build link copied.'); }
    catch { toast('Copy the address from the address bar to share this build.'); }
  },
  builds: () => { renderBuilds(); $('#builds').showModal(); },
  copyText: async () => {
    try { await navigator.clipboard.writeText(buildText(last)); toast('Build copied as text.'); }
    catch { toast('Copying was blocked by the browser.'); }
  },
  closeBuilds: () => $('#builds').close(),
  save: () => {
    const name = $('#save-name').value.trim();
    if (!name) return toast('Type a name for the build first.');
    if (writeSaved({ ...readSaved(), [name]: state })) { renderBuilds(); render(); toast(`Saved "${name}".`); }
  },
  load: el => {
    const build = readSaved()[el.dataset.name];
    if (!build) return;
    state = normalize(JSON.parse(JSON.stringify(build)));
    $('#builds').close();
    update();
    toast(`Loaded "${el.dataset.name}".`);
  },
  delete: el => {
    const saved = readSaved();
    delete saved[el.dataset.name];
    if (writeSaved(saved)) { renderBuilds(); render(); }
  },
};

document.addEventListener('click', e => {
  if (!db) return;
  if (e.target.matches('dialog')) return e.target.close(); // click on the backdrop
  const el = e.target.closest('[data-action]');
  if (el) actions[el.dataset.action]?.(el);
});

document.addEventListener('input', e => {
  if (e.target.id !== 'pick-q') return;
  ui.query = e.target.value;
  $('#pick-list').innerHTML = pickRows() || '<p class="note">Nothing matches.</p>';
});

document.addEventListener('change', e => {
  const el = e.target;
  if (!db || el.id === 'pick-q' || el.id === 'save-name') return;
  if (el.id === 'compare') { ui.compare = el.value; return render(); }
  const number = () => {
    if (el.value === '') return undefined;
    let v = Number(el.value);
    if (el.min !== '') v = Math.max(Number(el.min), v);
    if (el.max !== '') v = Math.min(Number(el.max), v);
    return v;
  };
  if (el.dataset.tog) state.tog[el.dataset.tog] = el.checked;
  else if (el.dataset.stack) { const v = number(); if (v === undefined) delete state.stacks[el.dataset.stack]; else state.stacks[el.dataset.stack] = v; }
  else if ('preset' in el.dataset) {
    const t = db.targets.find(r => r.name === el.value);
    if (!t) return;
    state.target = { armor: +t.armor || 0, health: +t.health || 0 };
  } else if (el.dataset.path) {
    const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? number() : (el.value || undefined);
    setPath(state, el.dataset.path, value);
    if (el.dataset.clear) setPath(state, el.dataset.clear, undefined);
  } else return;
  update();
});

$('#editor').addEventListener('close', () => { ui.edit = null; ui.view = null; });
window.addEventListener('hashchange', () => { if (db) { state = stateFromHash(); render(); } });

// The start-up screen: shown once per browser tab, never to people who asked for less motion.
function endBoot(startedAt) {
  const boot = $('#boot');
  if (!boot) return;
  let seen = motionOff();
  try { seen = seen || sessionStorage.getItem('d2.boot') === '1'; sessionStorage.setItem('d2.boot', '1'); } catch { /* storage blocked */ }
  if (seen) return boot.remove();
  document.body.classList.add('booting');
  setTimeout(() => {
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 450);
    setTimeout(() => document.body.classList.remove('booting'), 1500);
  }, Math.max(0, 950 - (performance.now() - startedAt)));
}

async function start() {
  const startedAt = performance.now();
  $('#sheet-link').href = CONFIG.sheetUrl;
  const [custom, snapshot] = await Promise.all([loadCustom(), loadSnapshot()]);
  const offline = finish(readSheet(snapshot), custom);
  db = offline;
  state = stateFromHash();
  render();
  endBoot(startedAt);
  showMotion();
  // Animations are off only because the system asks for less motion: say so once, since the
  // page would otherwise just look still.
  let chosen = null;
  try { chosen = localStorage.getItem('d2.motion'); } catch { /* storage blocked */ }
  if (motionOff() && !chosen) toast('Animations are off because your system has animation effects turned off. Use the Animations button to switch them on.');
  setChip(CONFIG.sheetId ? 'checking' : 'offline', 'Showing the copy bundled with the site.');

  const live = await loadLive(snapshot).catch(err => { console.warn('Live sheet not loaded.', err); return null; });
  if (live) {
    db = finish(live.db, custom, offline);
    render();
    setChip('live', live.fallback.length
      ? `Read from the community sheet. These tabs came from the bundled copy: ${live.fallback.join(', ')}.`
      : 'Read from the community sheet just now.');
  } else if (CONFIG.sheetId) {
    setChip('offline', 'The community sheet could not be reached. Showing the copy bundled with the site.');
  }
}

start().catch(err => {
  console.error(err);
  $('#boot')?.remove();
  $('#board').innerHTML = `<div class="panel"><h2>The game data could not be loaded</h2><p class="note">${esc(err.message)}</p>
    <p class="note">If you opened index.html by double-clicking it, run it through a web server instead (see README).</p></div>`;
  $('#data-chip').textContent = 'No data';
});
