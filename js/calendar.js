// The seasonal calendar: what is live, what is next and what has ended.
// Everything it shows comes from data/seasons.csv and data/events.csv.

import { parseTable } from './csv.js';

const RESET_HOUR = 8; // the game's daily reset, in UTC
const RECENT_DAYS = 14;
const DAY = 86400000;

let seasons = [], events = [], chosen = '', archiveOpen = false;

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const two = n => String(Math.max(0, n)).padStart(2, '0');

// "2026-09-24" -> the moment of that day's reset. Anything else is "not known".
function moment(text) {
  const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], RESET_HOUR) : null;
}
const day = ms => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function countdown(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `<span class="count-down"><b>${two(Math.floor(minutes / 1440))}</b><i>d</i> <b>${two(Math.floor(minutes / 60) % 24)}</b><i>h</i> <b>${two(minutes % 60)}</b><i>m</i></span>`;
}

// Sorts an event into the section it belongs in right now.
function place(e, now) {
  if (e.from === null) return 'unknown';
  if (e.from > now) return 'upcoming';
  if (e.permanent) return 'archive';
  if (e.to === null) return 'unknown';
  if (e.to > now) return 'active';
  return now - e.to <= RECENT_DAYS * DAY ? 'ended' : 'archive';
}

function card(e, where, now) {
  const dates = `<p class="when"><span>Start</span> ${e.from === null ? 'TBA' : day(e.from)} <span>→ End</span> ${e.permanent ? 'Permanent' : e.to === null ? 'TBA' : day(e.to)}
    ${e.from !== null ? `<em>${two(RESET_HOUR)}:00 UTC</em>` : ''}</p>`;
  let side = '', bar = '';
  if (where === 'upcoming') side = `<p class="state">Upcoming</p>${countdown(e.from - now)}<p class="until">Until ${e.permanent ? 'unlock' : 'start'}</p>`;
  else if (where === 'active') {
    const done = Math.min(100, Math.max(0, (now - e.from) / (e.to - e.from) * 100));
    side = `<p class="state live">Live now</p>${countdown(e.to - now)}<p class="until">Until event end</p>`;
    bar = `<div class="progress" role="img" aria-label="${Math.round(done)}% of the event has passed"><i style="width:${done.toFixed(1)}%"></i></div><p class="pct">${Math.round(done)}%</p>`;
  } else if (where === 'ended') {
    const ago = Math.max(0, Math.floor((now - e.to) / DAY));
    side = `<p class="state">Ended</p><p class="until">${ago === 0 ? 'Ended today' : `Ended ${ago} ${ago === 1 ? 'day' : 'days'} ago`}</p>`;
  } else if (where === 'archive') side = `<p class="state">${e.permanent ? 'Unlocked' : 'Ended'}</p>`;
  else side = `<p class="state">Unconfirmed</p><p class="until">${e.from === null ? 'Dates TBA' : 'End date unclear'}</p>`;
  return `<article class="event ${where}">
    <div><p class="eyebrow">${esc(e.category)}</p><h3>${esc(e.name)}</h3><p class="note">${esc(e.detail)}</p>${dates}
      ${e.note ? `<p class="note warn">${esc(e.note)}</p>` : ''}</div>
    <div class="event-side">${side}</div>${bar}
  </article>`;
}

const block = (title, list, where, now) => (list.length
  ? `<h2 class="section">${title} <em>${two(list.length)}</em></h2><div class="timeline">${list.map(e => card(e, where, now)).join('')}</div>` : '');

function render() {
  const now = Date.now();
  const season = seasons.find(s => s.id === chosen) || seasons[0];
  const mine = events.filter(e => e.season === season.id);
  const groups = { upcoming: [], active: [], ended: [], archive: [], unknown: [] };
  for (const e of mine) groups[place(e, now)].push(e);
  groups.upcoming.sort((a, b) => a.from - b.from);
  groups.active.sort((a, b) => a.to - b.to);
  groups.ended.sort((a, b) => b.to - a.to);
  groups.archive.sort((a, b) => (b.to ?? b.from) - (a.to ?? a.from));
  const next = groups.upcoming[0];

  const years = [...new Set(seasons.map(s => s.year))];
  const select = `<select id="season" aria-label="Season">${years.map(y => `<optgroup label="Year ${esc(y)}">${seasons.filter(s => s.year === y)
    .map(s => `<option value="${esc(s.id)}"${s.id === season.id ? ' selected' : ''}>${esc(s.id)} · ${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const span = season.from === null ? 'Season dates not recorded'
    : `${day(season.from)} → ${season.to === null ? 'season end TBA' : day(season.to)}`;

  $('#calendar').innerHTML = `
    <section class="panel season-head">
      <div class="season-pick"><p class="eyebrow">${esc(season.id)}</p><label class="field"><span>Season</span>${select}</label></div>
      <h2 class="season-name">${esc(season.name)}</h2>
      <p class="note">What is live, what is next and what has ended. ${esc(span)}.</p>
      ${next ? `<div class="next"><div><p class="eyebrow">Next up</p><h3>${esc(next.name)}</h3><p class="note">${day(next.from)} → ${next.permanent ? 'permanent' : next.to === null ? 'TBA' : day(next.to)}</p></div>${countdown(next.from - now)}</div>` : ''}
    </section>
    ${mine.length ? '' : '<section class="panel"><p class="note">No events are recorded for this season yet. Add rows to data/events.csv to fill it in.</p></section>'}
    ${block('Active today', groups.active, 'active', now)}
    ${block('Upcoming events', groups.upcoming, 'upcoming', now)}
    ${block('Recently ended', groups.ended, 'ended', now)}
    ${block('Dates partially documented', groups.unknown, 'unknown', now)}
    ${groups.archive.length ? `<details class="panel"${archiveOpen ? ' open' : ''}><summary><h2>Archive and unlocks</h2><span class="tag">${groups.archive.length} entries</span></summary>
      <div class="timeline">${groups.archive.map(e => card(e, 'archive', now)).join('')}</div></details>` : ''}
    <p class="note">In-game reset is ${two(RESET_HOUR)}:00 UTC; countdowns use that daily boundary. Dates can change: entries with missing or conflicting dates are marked.</p>`;
  $('#today').textContent = day(now);
}

async function start() {
  const get = async name => parseTable(await (await fetch(`data/${name}.csv`, { cache: 'no-store' })).text());
  const [s, e] = await Promise.all([get('seasons'), get('events')]);
  seasons = s.map(r => ({ ...r, from: moment(r.start), to: moment(r.end) }));
  events = e.map(r => ({ ...r, from: moment(r.start), to: moment(r.end), permanent: /^perm/i.test(r.end) }));
  // Open on the season running now: the latest one that has started.
  const now = Date.now();
  const running = seasons.filter(x => x.from !== null && x.from <= now).sort((a, b) => b.from - a.from)[0];
  chosen = (running || seasons[0]).id;
  render();
  setInterval(render, 30000);
}

document.addEventListener('change', e => { if (e.target.id === 'season') { chosen = e.target.value; render(); } });
// The archive stays open or closed across the half-minute redraws.
document.addEventListener('toggle', e => { if (e.target.matches?.('#calendar details')) archiveOpen = e.target.open; }, true);

start().catch(err => {
  console.error(err);
  $('#calendar').innerHTML = `<section class="panel"><h2>The calendar could not be loaded</h2><p class="note">${esc(err.message)}</p></section>`;
});
