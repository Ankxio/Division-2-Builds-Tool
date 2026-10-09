// Weekly Escalation rotation: this week's missions, today's target loot and the vendor caches.
// data/escalation.json is rewritten by the hourly GitHub job (tools/update_escalation.py); the
// page reads it again every few minutes and the reset clock ticks every second.

import { dateLocale } from './i18n.js';
import { gearArt, slotArt, weaponArt } from './art.js';
import { loadCustom, loadSnapshot, finish } from './data.js';
import { readSheet } from './sheet.js';

const RESET_HOUR = 8; // daily reset, UTC
const REFRESH = 5 * 60000;
const SLOTS = [[/mask/i, 'mask'], [/backpack/i, 'backpack'], [/chest/i, 'chest'], [/glove/i, 'gloves'], [/holster/i, 'holster'], [/knee/i, 'kneepads']];
const WEAPONS = [[/assault|\bars?\b/i, 'ar'], [/smg|submachine/i, 'smg'], [/lmg|light machine/i, 'lmg'], [/mmr|marksman/i, 'mmr'],
  [/shotgun/i, 'shotgun'], [/pistol|sidearm/i, 'pistol'], [/rifle/i, 'rifle']];

const CORE = { offense: 'Weapon damage', defense: 'Armor', utility: 'Skill tier' };
const SLOT_NAMES = { mask: 'Mask', backpack: 'Backpack', chest: 'Chest', gloves: 'Gloves', holster: 'Holster', kneepads: 'Kneepads' };

let data = null, last = '', db = null;

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const two = n => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const date = (iso, year = true) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

// The game's day runs from 08:00 UTC to 08:00 UTC.
const gameDay = now => new Date(now - RESET_HOUR * 3600000).toISOString().slice(0, 10);
function nextReset(now) {
  const d = new Date(now);
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RESET_HOUR);
  return reset > now ? reset : reset + 86400000;
}

function cacheArt(cache) {
  const slot = SLOTS.find(([re]) => re.test(cache.item));
  if (slot) return slotArt(slot[1]);
  const type = WEAPONS.find(([re]) => re.test(cache.item));
  return type ? weaponArt({ name: '', type: type[1] }) : '';
}

// The brand or gear set a target loot name stands for, from the same game data the build
// planner uses. Names are compared without punctuation: "Walker, Harris & Co" = "Walker, Harris & Co.".
function lootInfo(name) {
  if (!db) return null;
  const key = v => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = key(name);
  const same = x => key(x.name) === wanted || (wanted.length > 5 && (key(x.name).startsWith(wanted) || wanted.startsWith(key(x.name))));
  return db.gearsets.find(same) || db.brands.find(same) || null;
}

const lines = text => esc(text).replace(/\n/g, '<br>');
const talent = (label, t) => (t ? `<div class="detail-talent"><span class="eyebrow">${label}</span><h4>${esc(t.name || '')}</h4><p class="note">${lines(t.text)}</p></div>` : '');

function details(name) {
  const item = lootInfo(name);
  if (!item) return `<p class="note">No details are on record for ${esc(name)}.</p>`;
  const named = db.gear.filter(g => g.quality === 'named' && g.brand === item.name);
  return `<p class="detail-kind"><span class="tag strong">${item.kind === 'gearset' ? 'Gear set' : 'Brand set'}</span><span class="tag">Core: ${CORE[item.core] || item.core}</span></p>
    <dl class="rows">${item.bonuses.filter(b => b.text).map(b => `<div><dt>${b.pieces} ${b.pieces === 1 ? 'piece' : 'pieces'}</dt><dd>${esc(b.text)}</dd></div>`).join('')}</dl>
    ${item.kind === 'gearset' ? talent('4 pieces', item.four) + talent('Chest talent', item.chest) + talent('Backpack talent', item.backpack) : ''}
    ${named.length ? `<h3 class="detail-title">Named items</h3>${named.map(g => `<div class="detail-talent"><span class="eyebrow">${SLOT_NAMES[g.slot] || g.slot}</span><h4>${esc(g.name)}</h4>
      <p class="note">${g.talent ? `<b>${esc(g.talent.name)}</b><br>${lines(g.talent.text)}` : lines(g.perk || '')}</p></div>`).join('')}` : ''}`;
}

function open(name) {
  const dialog = $('#loot');
  dialog.innerHTML = `<div class="sheet-inner">
    <header class="sheet-head"><div class="loot">${gearArt({ name, slot: 'chest', quality: 'highend' })}<div><p class="eyebrow">Target loot</p><h2>${esc(name)}</h2></div></div>
      <button class="btn icon" data-close aria-label="Close">✕</button></header>
    <div class="sheet-body">${details(name)}</div>
  </div>`;
  if (!dialog.open) dialog.showModal();
}

function history(x) {
  const seen = x.last_seen_days === null || x.last_seen_days === undefined ? 'First time' : x.last_seen_days === 1 ? 'Yesterday' : `${x.last_seen_days} days ago`;
  return `<div class="seen"><div><span class="eyebrow">Appearances</span><b>${x.appearances} ${x.appearances === 1 ? 'time' : 'times'}</b></div>
    <div><span class="eyebrow">Last seen</span><b class="when-seen">${seen}</b></div></div>`;
}

function render() {
  const now = Date.now();
  const stale = data.date !== gameDay(now);
  const updated = data.updated ? new Date(data.updated).toLocaleString(dateLocale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—';
  $('#escalation').innerHTML = `
    <section class="panel season-head">
      <p class="eyebrow">Escalation</p>
      <h2 class="season-name">Weekly rotation · Target loot</h2>
      <p class="note">This week's Escalation missions, the loot each one targets today, and the Requisition vendor's daily caches.</p>
      <div class="info-bar">
        <div><span class="note">Loot date</span><b>${date(data.date)}</b></div>
        <div><span class="note">Rotation week</span><b>${date(data.week[0], false)} – ${date(data.week[1])}</b></div>
        <div><span class="note">Last updated</span><b>${esc(updated)} UTC</b></div>
        <div class="reset"><span class="note">Next reset · ${two(RESET_HOUR)}:00 UTC</span><b id="reset"></b></div>
      </div>
      ${stale ? `<p class="note warn">Today's target loot has not been recorded yet. Showing ${date(data.date)}; the missions stay the same all week.</p>` : ''}
    </section>
    <h2 class="section">Escalation missions <em>${two(data.missions.length)}</em></h2>
    <div class="rotation">${data.missions.map(m => `<article class="rotation-row">
      <div><span class="eyebrow">${esc(m.faction || 'Mission')}</span><h3>${esc(m.mission)}</h3></div>
      <button class="loot" data-loot="${esc(m.loot)}" title="Show what ${esc(m.loot)} gives">${gearArt({ name: m.loot, slot: 'chest', quality: 'highend' })}<span><span class="eyebrow">Target loot</span><h3>${esc(m.loot)}</h3></span></button>
      ${history(m)}
    </article>`).join('')}</div>
    ${data.caches.length ? `<h2 class="section">Escalation Requisition vendor <em>Daily caches</em></h2>
    <div class="caches">${data.caches.map(c => `<article class="rotation-row">
      <div class="loot">${cacheArt(c)}<div><span class="eyebrow">${esc(c.type)}</span><h3>${esc(c.item)}</h3></div></div>
      ${history(c)}
    </article>`).join('')}</div>` : ''}
    <p class="note">Missions change every Tuesday and target loot every day at ${two(RESET_HOUR)}:00 UTC. Appearances are counted since ${date(data.tracked_since)}. Select a target loot to see its bonuses. Confirm in game before spending tokens.</p>`;
  tick();
}

function tick() {
  if (!data) return;
  const now = Date.now(), left = Math.floor((nextReset(now) - now) / 1000), el = $('#reset');
  if (el) el.textContent = `${two(left / 3600)}:${two(left / 60 % 60)}:${two(left % 60)}`;
  // At the reset the "not recorded yet" line has to appear without a reload.
  if ((data.date !== gameDay(now)) !== !!document.querySelector('#escalation .note.warn')) render();
}

async function load() {
  const response = await fetch('data/escalation.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('The rotation could not be read.');
  const text = await response.text();
  if (text === last) return;
  last = text;
  data = JSON.parse(text);
  render();
}

document.addEventListener('click', e => {
  const loot = e.target.closest('[data-loot]');
  if (loot) open(loot.dataset.loot);
  // Close on the button, or on a click outside the box (the dialog element itself is the backdrop).
  if (e.target.closest('[data-close]') || e.target.id === 'loot') $('#loot').close();
});

// The game data only feeds the pop-up, so the page does not wait for it.
Promise.all([loadCustom(), loadSnapshot()]).then(([custom, snapshot]) => { db = finish(readSheet(snapshot), custom); }).catch(console.error);

load().then(() => {
  setInterval(tick, 1000);
  const again = () => load().catch(() => {});
  setInterval(again, REFRESH);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) again(); });
}).catch(err => {
  $('#escalation').innerHTML = `<section class="panel"><h2>The rotation could not be loaded</h2><p class="note">${esc(err.message)}</p></section>`;
});
