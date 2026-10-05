import { loadData } from './data.js';
import {
  SLOTS, CORES, WEAPON_MOD_SLOTS, buildIndex, compute, resolvePiece, attrMax,
  parseEffects, dps, timeline, timeToKill,
} from './calc.js';

const SAVE_KEY = 'd2builds.saved';
const CHART_SECONDS = 12;
const WEAPON_LABELS = ['Primary', 'Secondary', 'Sidearm'];
const CORE_LABELS = { offense: 'Weapon Damage (red)', defense: 'Armor (blue)', utility: 'Skill Tier (yellow)' };

let db, ix, source, state;

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('en-US');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const compact = n => n >= 1e6 ? `${fmt1(n / 1e6)}M` : n >= 1e3 ? `${fmt1(n / 1e3)}K` : fmt(n);

const blank = () => ({
  spec: '', weapons: [{}, {}, {}], gear: {}, skills: ['', ''], watch: {}, off: {},
  hsc: 30, ooc: false, target: { armor: 1000000, health: 500000 }, active: 0,
});

function normalize(loaded) {
  const s = { ...blank(), ...(loaded && typeof loaded === 'object' ? loaded : {}) };
  s.weapons = [0, 1, 2].map(i => (Array.isArray(s.weapons) && s.weapons[i]) || {});
  s.skills = [0, 1].map(i => (Array.isArray(s.skills) && s.skills[i]) || '');
  for (const k of ['gear', 'watch', 'off', 'target']) if (!s[k] || typeof s[k] !== 'object') s[k] = blank()[k];
  return s;
}

// ---- build <-> link ----

function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}

function stateFromHash() {
  const match = location.hash.match(/b=([\w-]+)/);
  if (!match) return blank();
  try { return normalize(decode(match[1])); }
  catch { toast('That build link could not be read.'); return blank(); }
}

function readSaved() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}

function writeSaved(saved) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); return true; }
  catch { toast('This browser is blocking saved builds. Use the share link instead.'); return false; }
}

// ---- small html helpers ----

const statLabel = key => ix.stats[key]?.label || key;
const statUnit = key => ix.stats[key]?.unit || '';

function effectText(effects) {
  return parseEffects(effects).map(([k, v]) =>
    k === 'amp' ? `+${fmt1(v)}% amplified damage` : `${v > 0 ? '+' : ''}${fmt1(v)}${statUnit(k)} ${statLabel(k)}`,
  ).join(', ');
}

function select(path, options, value, { placeholder = 'None', attrs = '' } = {}) {
  let html = `<select data-path="${esc(path)}" ${attrs}><option value="">${esc(placeholder)}</option>`;
  let group;
  for (const o of options) {
    if (o.group !== group) {
      if (group) html += '</optgroup>';
      if (o.group) html += `<optgroup label="${esc(o.group)}">`;
      group = o.group;
    }
    html += `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`;
  }
  return `${html}${group ? '</optgroup>' : ''}</select>`;
}

const field = (label, control) => `<label class="field"><span>${esc(label)}</span>${control}</label>`;

function attrOptions(where) {
  return db.attributes.filter(a => a.where === where)
    .map(a => ({ value: a.stat, label: `${statLabel(a.stat)} (max ${fmt1(parseFloat(a.max))}${statUnit(a.stat)})`, group: cap(a.category) }));
}

// An attribute picker with the box for its rolled value next to it.
function attrField(label, where, path, stat, value) {
  const max = attrMax(db, where, stat);
  const shown = value === undefined || value === null ? max : value;
  const number = stat
    ? `<input type="number" data-path="${path}v" value="${shown}" min="0" max="${max}" step="any" aria-label="${esc(label)} value">`
    : '';
  return field(label, `<span class="pair">${select(path, attrOptions(where), stat || '', { attrs: `data-clear="${path}v"` })}${number}</span>`);
}

function talentBlock(talent, offKey) {
  if (!talent) return '';
  const counted = talent.effects ? effectText(talent.effects) : '';
  const toggle = counted
    ? `<label class="check"><input type="checkbox" data-off="${esc(offKey)}"${state.off[offKey] ? '' : ' checked'}> Count it: ${esc(counted)}</label>`
    : '';
  return `<div class="talent"><strong>${esc(talent.name)}</strong><p>${esc(talent.text)}</p>${toggle}</div>`;
}

// ---- builder (left side) ----

function weaponCard(i) {
  const w = state.weapons[i];
  const row = ix.weapons[w.id];
  const options = db.weapons
    .filter(r => (i === 2) === (r.type === 'pistol'))
    .map(r => ({ value: r.name, label: r.quality === 'high-end' ? r.name : `${r.name} (${r.quality})`, group: ix.types[r.type]?.label || r.type }))
    .sort((a, b) => a.group.localeCompare(b.group));
  let body = '';
  if (row) {
    const type = ix.types[row.type] || {};
    const fixedTalents = new Set(db.weapons.map(r => r.talent).filter(Boolean));
    const talents = db.weapon_talents
      .filter(t => !fixedTalents.has(t.name) && (!t.types || t.types.split(/[;|]/).includes(row.type)))
      .map(t => ({ value: t.name, label: t.name }));
    const talent = ix.weaponTalents[row.talent || w.talent];
    body = `
      <p class="meta">${esc(type.label || row.type)} · ${fmt(row.damage)} damage · ${esc(row.rpm)} RPM · ${esc(row.mag)} rounds</p>
      ${attrField('Attribute', 'weapon', `weapons.${i}.attr`, w.attr, w.attrv)}
      ${row.talent ? '' : field('Talent', select(`weapons.${i}.talent`, talents, w.talent || ''))}
      ${talentBlock(talent, `wt:${i}`)}
      <div class="grid2">${WEAPON_MOD_SLOTS.map(slot => field(cap(slot), select(
        `weapons.${i}.mods.${slot}`,
        db.weapon_mods.filter(m => m.slot === slot).map(m => ({ value: m.name, label: `${m.name}: ${effectText(m.effects)}` })),
        w.mods?.[slot] || '',
      ))).join('')}</div>`;
  }
  return `<section class="card${row ? ` q-${esc(row.quality)}` : ''}">
    <h3>${WEAPON_LABELS[i]}</h3>
    ${select(`weapons.${i}.id`, options, w.id || '', { placeholder: 'Choose a weapon', attrs: `data-fresh="weapons.${i}" aria-label="${WEAPON_LABELS[i]} weapon"` })}
    ${body}
  </section>`;
}

function gearCard(slot) {
  const piece = state.gear[slot] || {};
  const r = resolvePiece(db, ix, slot, piece);
  const options = [
    ...db.brands.filter(b => b.type !== 'gearset').map(b => ({ value: `b:${b.name}`, label: b.name, group: 'Brands' })),
    ...db.brands.filter(b => b.type === 'gearset').map(b => ({ value: `b:${b.name}`, label: b.name, group: 'Gear sets' })),
    ...db.gear.filter(g => g.slot === slot && g.quality !== 'exotic').map(g => ({ value: `g:${g.name}`, label: g.name, group: 'Named' })),
    ...db.gear.filter(g => g.slot === slot && g.quality === 'exotic').map(g => ({ value: `g:${g.name}`, label: g.name, group: 'Exotic' })),
  ];
  let body = '';
  if (r) {
    const path = `gear.${slot}`;
    const core = r.coreFixed
      ? '<p class="meta">Cores: weapon damage, armor and skill tier</p>'
      : field('Core', select(`${path}.core`, CORES.map(c => ({ value: c, label: CORE_LABELS[c] })), r.core, { placeholder: 'Choose a core' }));
    let attrs = '';
    for (let i = 0; i < r.free; i++) attrs += attrField(`Attribute ${i + 1}`, 'gear', `${path}.a${i}`, piece[`a${i}`], piece[`a${i}v`]);
    const talents = db.gear_talents.filter(t => !t.set && t.slot === slot).map(t => ({ value: t.name, label: t.name }));
    body = `
      ${core}
      ${r.fixed ? `<p class="meta">Fixed: ${esc(effectText(r.fixed))}</p>` : ''}
      ${attrs}
      ${r.hasMod ? attrField('Gear mod', 'gearmod', `${path}.mod`, piece.mod, piece.modv) : ''}
      ${r.chooseTalent ? field('Talent', select(`${path}.talent`, talents, piece.talent || '')) : ''}
      ${talentBlock(r.talent, `gt:${slot}`)}`;
  }
  return `<section class="card${r ? ` q-${esc(r.quality)}` : ''}">
    <h3>${cap(slot)}</h3>
    ${select(`gear.${slot}.item`, options, piece.item || '', { placeholder: 'Choose gear', attrs: `data-fresh="gear.${slot}" aria-label="${cap(slot)}"` })}
    ${body}
  </section>`;
}

function skillCard(i, result) {
  const options = db.skills.map(s => ({ value: s.name, label: s.name, group: s.category }))
    .sort((a, b) => a.group.localeCompare(b.group));
  const skill = ix.skills[state.skills[i]];
  const haste = result.bag.get('skill_haste');
  const info = skill
    ? `<p class="meta">Cooldown ${fmt1(parseFloat(skill.cooldown) / (1 + haste / 100))}s (base ${esc(skill.cooldown)}s) · Skill tier ${result.totals.skillTier}</p>`
    : '';
  return `<section class="card"><h3>Skill ${i + 1}</h3>
    ${select(`skills.${i}`, options, state.skills[i], { placeholder: 'Choose a skill', attrs: `aria-label="Skill ${i + 1}"` })}${info}</section>`;
}

function watchCard() {
  const groups = {};
  for (const row of db.watch) (groups[row.category] ||= []).push(row);
  const cols = Object.entries(groups).map(([name, rows]) => `<div><h4>${esc(name)}</h4>${rows.map(row =>
    field(`${statLabel(row.stat)} (+${esc(row.max)}${statUnit(row.stat)})`,
      `<input type="number" data-path="watch.${esc(row.stat)}" value="${state.watch[row.stat] ?? 0}" min="0" max="${esc(row.levels)}" step="1">`),
  ).join('')}</div>`).join('');
  return `<section class="card wide"><h3>SHD watch levels</h3>
    <div class="row"><button data-action="watchMax">Set all to max</button><button data-action="watchClear">Set all to 0</button></div>
    <div class="watch">${cols}</div></section>`;
}

function renderBuilder(result) {
  const specs = db.specializations.map(s => ({ value: s.name, label: s.name }));
  const spec = ix.specs[state.spec];
  $('#builder').innerHTML = `
    <section class="card wide"><h3>Specialization</h3>
      ${select('spec', specs, state.spec, { placeholder: 'Choose a specialization', attrs: 'aria-label="Specialization"' })}
      ${spec ? `<p class="meta">${esc(spec.text)} ${esc(effectText(spec.effects))}</p>` : ''}
    </section>
    <h2>Weapons</h2><div class="cards">${[0, 1, 2].map(weaponCard).join('')}</div>
    <h2>Gear</h2><div class="cards">${SLOTS.map(gearCard).join('')}</div>
    <h2>Skills</h2><div class="cards">${[0, 1].map(i => skillCard(i, result)).join('')}</div>
    ${watchCard()}`;
}

// ---- results (right side) ----

const rows = pairs => `<dl class="stats">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

function weaponPanel(result, opts) {
  const tabs = [0, 1, 2].map(i => `<button class="tab${state.active === i ? ' on' : ''}" data-action="tab" data-i="${i}">${
    esc(result.weapons[i]?.name || WEAPON_LABELS[i])}</button>`).join('');
  const w = result.weapons[state.active];
  if (!w) return `<section class="panel"><div class="tabs">${tabs}</div><p class="meta">No weapon selected.</p></section>`;
  const d = dps(w, opts);
  return `<section class="panel"><div class="tabs">${tabs}</div>
    ${rows([
      ['Body shot', fmt(w.body)], ['Critical hit', fmt(w.crit)],
      ['Headshot', fmt(w.headshot)], ['Critical headshot', fmt(w.headshotCrit)],
      ['Average bullet', fmt(d.bullet)], ['DPS while firing', fmt(d.burst)],
      ['DPS with reloads', fmt(d.sustained)], ['Rate of fire', `${fmt(w.rpm)} RPM`],
      ['Magazine', fmt(w.mag)], ['Reload', `${fmt1(w.reload)}s`],
      ['Weapon damage', `+${fmt1(w.weaponDamage)}%`], ['Amplified', `x${w.amp.toFixed(2)}`],
      ['Crit chance', `${fmt1(w.chc)}%`], ['Crit damage', `${fmt1(w.chd)}%`],
      ['Headshot damage', `${fmt1(w.hsd)}%`], ['Damage to armor / health', `${fmt1(w.dta)}% / ${fmt1(w.dth)}%`],
    ])}</section>`;
}

function setsPanel(result) {
  const { offense, defense, utility } = result.cores;
  const sets = result.sets.map(set => `<div class="set"><strong>${esc(set.name)}</strong> <span class="meta">${set.count} ${set.count === 1 ? 'piece' : 'pieces'}</span>
    <ul>${set.bonuses.map(b => {
      const label = [b.title, effectText(b.effects)].filter(Boolean).join(': ');
      const toggle = b.toggle && b.reached && b.effects
        ? `<label class="check"><input type="checkbox" data-off="${esc(b.toggle)}"${state.off[b.toggle] ? '' : ' checked'}> Count it</label>` : '';
      return `<li class="${b.reached ? 'on' : 'off'}">${b.n}: ${esc(label)}${b.text ? `<p>${esc(b.text)}</p>` : ''}${toggle}</li>`;
    }).join('')}</ul></div>`).join('');
  return `<section class="panel"><h3>Cores and set bonuses</h3>
    <p class="cores"><span class="c-off">${offense} red</span><span class="c-def">${defense} blue</span><span class="c-util">${utility} yellow</span></p>
    ${sets || '<p class="meta">No gear selected.</p>'}</section>`;
}

function totalsPanel(result) {
  const headline = {
    offense: [['Crit chance (capped)', `${fmt1(result.totals.chc)}%`], ['Crit damage (total)', `${fmt1(result.totals.chd)}%`]],
    defense: [['Total armor', fmt(result.totals.armor)], ['Total health', fmt(result.totals.health)]],
    utility: [], handling: [],
  };
  return Object.entries(headline).map(([group, lead]) => {
    const list = db.stats.filter(s => s.group === group && result.bag.get(s.key))
      .map(s => [s.label, `${fmt1(result.bag.get(s.key))}${s.unit}`]);
    return `<section class="panel"><h3>${cap(group)}</h3>${rows([...lead, ...list])}${
      lead.length + list.length ? '' : '<p class="meta">Nothing yet.</p>'}</section>`;
  }).join('');
}

function chartPanel(result, opts) {
  const W = 640, H = 260, L = 52, R = 12, T = 12, B = 30;
  const series = result.weapons.map((w, i) => w && { i, name: w.name, points: timeline(w, opts, CHART_SECONDS) }).filter(Boolean);
  const max = Math.max(1, ...series.map(s => s.points[s.points.length - 1][1]));
  const x = t => L + (t / CHART_SECONDS) * (W - L - R);
  const y = v => H - B - (v / max) * (H - T - B);
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = max * k / 4;
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  for (let t = 0; t <= CHART_SECONDS; t += 2) grid += `<text class="tick" x="${x(t)}" y="${H - 10}" text-anchor="middle">${t}s</text>`;
  const lines = series.map(s => `<polyline class="line s${s.i}" points="${s.points.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
  const legend = series.map(s => `<span><i class="s${s.i}"></i>${esc(s.name)}</span>`).join('');
  return `<section class="panel"><h3>Damage over ${CHART_SECONDS} seconds</h3>
    ${series.length ? `<div class="legend">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total damage over time for each weapon. Flat stretches are reloads.">${grid}${lines}</svg>
    <p class="meta">Flat stretches are reloads. Uses your crit chance and the headshot chance below.</p>` : '<p class="meta">Select a weapon to see the chart.</p>'}
  </section>`;
}

function ttkPanel(result, opts) {
  const presets = db.targets.map(t => ({ value: t.name, label: `${t.name} (${compact(+t.armor)} armor, ${compact(+t.health)} health)` }));
  const lines = result.weapons.map(w => {
    if (!w) return '';
    const k = timeToKill(w, opts, state.target);
    return `<tr><th>${esc(w.name)}</th><td>${fmt(k.bullets)}</td><td>${fmt1(k.time)}s</td><td>${k.reloads}</td></tr>`;
  }).join('');
  return `<section class="panel"><h3>Time to kill</h3>
    <div class="grid2">
      ${field('Headshot chance %', `<input type="number" data-path="hsc" value="${state.hsc}" min="0" max="100" step="1">`)}
      ${field('Target preset', select('preset', presets, '', { placeholder: 'Custom', attrs: 'data-preset' }))}
      ${field('Target armor', `<input type="number" data-path="target.armor" value="${state.target.armor}" min="0" step="1000">`)}
      ${field('Target health', `<input type="number" data-path="target.health" value="${state.target.health}" min="0" step="1000">`)}
    </div>
    <label class="check"><input type="checkbox" data-path="ooc"${state.ooc ? ' checked' : ''}> Target is out of cover</label>
    ${lines ? `<table><thead><tr><th>Weapon</th><th>Bullets</th><th>Time</th><th>Reloads</th></tr></thead><tbody>${lines}</tbody></table>`
      : '<p class="meta">Select a weapon to see time to kill.</p>'}
  </section>`;
}

function renderSaved() {
  const names = Object.keys(readSaved()).sort();
  $('#saved').innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    : '<option value="">No saved builds</option>';
}

function render() {
  const focused = document.activeElement?.dataset?.path;
  const result = compute(db, ix, state);
  const opts = { headshotChance: state.hsc, outOfCover: state.ooc };
  renderBuilder(result);
  $('#results').innerHTML = weaponPanel(result, opts) + setsPanel(result) + chartPanel(result, opts) + ttkPanel(result, opts) + totalsPanel(result);
  if (focused) document.querySelector(`[data-path="${CSS.escape(focused)}"]`)?.focus();
}

function update() {
  render();
  const empty = JSON.stringify(state) === JSON.stringify(blank());
  history.replaceState(null, '', empty ? location.pathname + location.search : `#b=${encode(state)}`);
}

// ---- events ----

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  for (const k of keys) obj = (obj[k] && typeof obj[k] === 'object') ? obj[k] : (obj[k] = {});
  if (value === undefined) delete obj[last]; else obj[last] = value;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3500);
}

const actions = {
  tab: el => { state.active = Number(el.dataset.i); update(); },
  watchMax: () => { for (const r of db.watch) state.watch[r.stat] = parseFloat(r.levels) || 50; update(); },
  watchClear: () => { state.watch = {}; update(); },
  reset: () => { state = blank(); update(); },
  share: async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Build link copied.'); }
    catch { toast('Copy the address from the address bar to share this build.'); }
  },
  save: () => {
    const name = $('#save-name').value.trim();
    if (!name) return toast('Type a name for the build first.');
    if (writeSaved({ ...readSaved(), [name]: state })) { renderSaved(); $('#saved').value = name; toast(`Saved "${name}".`); }
  },
  load: () => {
    const build = readSaved()[$('#saved').value];
    if (build) { state = normalize(JSON.parse(JSON.stringify(build))); update(); }
  },
  remove: () => {
    const name = $('#saved').value;
    const saved = readSaved();
    if (!name || !(name in saved)) return;
    delete saved[name];
    if (writeSaved(saved)) { renderSaved(); toast(`Deleted "${name}".`); }
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && db) actions[el.dataset.action]?.(el);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (!db) return;
  if (el.dataset.off) {
    if (el.checked) delete state.off[el.dataset.off]; else state.off[el.dataset.off] = true;
    return update();
  }
  if ('preset' in el.dataset) {
    const t = db.targets.find(r => r.name === el.value);
    if (t) { state.target = { armor: +t.armor || 0, health: +t.health || 0 }; update(); }
    return;
  }
  const path = el.dataset.path;
  if (!path) return;
  let value = el.value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'number') {
    value = el.value === '' ? undefined : Number(el.value);
    if (value !== undefined && el.min !== '') value = Math.max(Number(el.min), value);
    if (value !== undefined && el.max !== '') value = Math.min(Number(el.max), value);
  }
  if (el.dataset.fresh) setPath(state, el.dataset.fresh, value ? { [path.split('.').pop()]: value } : {});
  else setPath(state, path, value);
  if (el.dataset.clear) setPath(state, el.dataset.clear, undefined);
  update();
});

window.addEventListener('hashchange', () => { if (db) { state = stateFromHash(); render(); } });

loadData().then(loaded => {
  db = loaded.db;
  ix = buildIndex(db);
  source = loaded.fromSheet.length
    ? (loaded.fromFiles.length ? `Google Sheet, except ${loaded.fromFiles.join(', ')}` : 'Google Sheet')
    : 'built-in files';
  $('#data-info').textContent = `Game data: ${ix.settings.game_version || 'unknown version'} · loaded from ${source}`;
  state = stateFromHash();
  renderSaved();
  render();
}).catch(err => {
  console.error(err);
  $('#builder').innerHTML = `<section class="card wide"><h3>The game data could not be loaded</h3><p class="meta">${esc(err.message)}</p>
    <p class="meta">If you opened index.html by double-clicking it, run it through a web server instead (see README).</p></section>`;
});
