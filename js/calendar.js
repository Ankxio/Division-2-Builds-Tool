// The seasonal calendar: what is live, what is next and what has ended.
// Seasons come from data/seasons.csv. Events come from data/events.csv (written by hand) and
// data/auto_events.csv (written every hour from Ubisoft's announcements). The clocks tick every
// second and the data is read again every few minutes, so the page never needs a reload.

import { dateLocale } from './i18n.js';
import { parseTable } from './csv.js';

const RESET_HOUR = 8; // the game's daily reset, in UTC
const RECENT_DAYS = 14;
const DAY = 86400000;
const ALL = '*'; // the "every season" choice in the season list
const REFRESH = 5 * 60000; // how often the data files are read again

let seasons = [], events = [], news = [], chosen = '', archiveOpen = false;
let updated = null, checked = null, shown = '';

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const two = n => String(Math.max(0, n)).padStart(2, '0');
const percent = n => `${n.toLocaleString(dateLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// "2026-09-24" -> the moment of that day's reset. Anything else is "not known".
function moment(text) {
  const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], RESET_HOUR) : null;
}
const day = ms => new Date(ms).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

// A countdown to a moment. tick() rewrites the inside every second.
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `<b>${two(Math.floor(s / 86400))}</b><i>d</i> <b>${two(Math.floor(s / 3600) % 24)}</b><i>h</i> <b>${two(Math.floor(s / 60) % 60)}</b><i>m</i> <b>${two(s % 60)}</b><i>s</i>`;
}
const countdown = (until, now) => `<span class="count-down" data-until="${until}">${clock(until - now)}</span>`;

function ago(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 2880) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

// Sorts an event into the section it belongs in right now.
function place(e, now) {
  if (e.from === null) return 'unknown';
  if (e.from > now) return 'upcoming';
  if (e.permanent) return 'archive';
  // A start-only event from long ago is over, whatever its end date was.
  if (e.to === null) return now - e.from > 30 * DAY ? 'archive' : 'unknown';
  if (e.to > now) return 'active';
  return now - e.to <= RECENT_DAYS * DAY ? 'ended' : 'archive';
}

function card(e, where, now) {
  const dates = `<p class="when"><span>Start</span> ${e.from === null ? 'TBA' : day(e.from)} <span>→ End</span> ${e.permanent ? 'Permanent' : e.to === null ? 'TBA' : day(e.to)}
    ${e.from !== null ? `<em>${two(RESET_HOUR)}:00 UTC</em>` : ''}</p>`;
  let side = '', bar = '';
  if (where === 'upcoming') side = `<p class="state">Upcoming</p>${countdown(e.from, now)}<p class="until">Until ${e.permanent ? 'unlock' : 'start'}</p>`;
  else if (where === 'active') {
    const done = Math.min(100, Math.max(0, (now - e.from) / (e.to - e.from) * 100));
    side = `<p class="state live">Live now</p>${countdown(e.to, now)}<p class="until">Until event end</p>`;
    bar = `<div class="progress" role="img" aria-label="${Math.round(done)}% of the event has passed" data-from="${e.from}" data-to="${e.to}"><i style="width:${done.toFixed(2)}%"></i></div><p class="pct">${percent(done)}</p>`;
  } else if (where === 'ended') {
    const ago = Math.max(0, Math.floor((now - e.to) / DAY));
    side = `<p class="state">Ended</p><p class="until">${ago === 0 ? 'Ended today' : `Ended ${ago} ${ago === 1 ? 'day' : 'days'} ago`}</p>`;
  } else if (where === 'archive') side = `<p class="state">${e.permanent ? 'Unlocked' : 'Ended'}</p>`;
  else side = `<p class="state">Unconfirmed</p><p class="until">${e.from === null ? 'Dates TBA' : 'End date unclear'}</p>`;
  return `<article class="event ${where}">
    <div><p class="eyebrow">${esc(e.category)}</p><h3>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a>` : esc(e.name)}</h3>${e.detail && !e.auto ? `<p class="note">${esc(e.detail)}</p>` : ''}${dates}
      ${e.note && !e.auto ? `<p class="note warn">${esc(e.note)}</p>` : ''}</div>
    <div class="event-side">${side}</div>${bar}
  </article>`;
}

const block = (title, list, where, now) => (list.length
  ? `<h2 class="section">${title} <em>${two(list.length)}</em></h2><div class="timeline">${list.map(e => card(e, where, now)).join('')}</div>` : '');

// Which section every event sits in. When this changes, the page is drawn again.
const layout = now => events.map(e => place(e, now)).join();

function render() {
  const now = Date.now();
  const every = chosen === ALL;
  const season = seasons.find(s => s.id === chosen) || seasons[0];
  const over = every || (season.to !== null && season.to <= now);
  const mine = every ? events.filter(e => seasons.some(s => s.id === e.season)) : events.filter(e => e.season === season.id);
  const groups = { upcoming: [], active: [], ended: [], archive: [], unknown: [] };
  for (const e of mine) groups[place(e, now)].push(e);
  groups.upcoming.sort((a, b) => a.from - b.from);
  groups.active.sort((a, b) => a.to - b.to);
  groups.ended.sort((a, b) => b.to - a.to);
  groups.archive.sort((a, b) => b.from - a.from);
  const next = groups.upcoming[0];

  const years = [...new Set(seasons.map(s => s.year))];
  const select = `<select id="season" aria-label="Season"><option value="${ALL}"${every ? ' selected' : ''}>All seasons · every event</option>
    ${years.map(y => `<optgroup label="Year ${esc(y)}">${seasons.filter(s => s.year === y)
    .map(s => `<option value="${esc(s.id)}"${!every && s.id === season.id ? ' selected' : ''}>${esc(s.id)} · ${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const span = every ? `${mine.length} events on record since ${day(Math.min(...seasons.filter(s => s.from !== null).map(s => s.from)))}`
    : season.from === null ? 'Season dates not recorded'
    : `${day(season.from)} → ${season.to === null ? 'season end TBA' : day(season.to)}`;

  // Past events: one list for a single season, one list per season when every season is shown.
  const past = !groups.archive.length ? ''
    : every ? seasons.map(s => block(`${esc(s.id)} · ${esc(s.name)}`, groups.archive.filter(e => e.season === s.id), 'archive', now)).join('')
    : over ? block('Past events', groups.archive, 'archive', now)
    : `<details class="panel"${archiveOpen ? ' open' : ''}><summary><h2>Past events and unlocks</h2><span class="tag">${groups.archive.length} entries</span></summary>
      <div class="timeline">${groups.archive.map(e => card(e, 'archive', now)).join('')}</div></details>`;

  $('#calendar').innerHTML = `
    <section class="panel season-head">
      <div class="season-pick"><p class="eyebrow">${every ? 'Year 5 to today' : esc(season.id)}</p><label class="field"><span>Season</span>${select}</label></div>
      <h2 class="season-name">${every ? 'Every event' : esc(season.name)}</h2>
      <p class="note">What is live, what is next and what has ended. ${esc(span)}.</p>
      ${next ? `<div class="next"><div><p class="eyebrow">Next up</p><h3>${esc(next.name)}</h3><p class="note">${day(next.from)} → ${next.permanent ? 'permanent' : next.to === null ? 'TBA' : day(next.to)}</p></div>${countdown(next.from, now)}</div>` : ''}
      <p class="live-line"><span class="chip live"><i></i><b id="clock"></b></span> <span class="note" id="fresh"></span></p>
    </section>
    ${mine.length ? '' : '<section class="panel"><p class="note">No dated events were announced for this season.</p></section>'}
    ${block('Active today', groups.active, 'active', now)}
    ${block('Upcoming events', groups.upcoming, 'upcoming', now)}
    ${block('Recently ended', groups.ended, 'ended', now)}
    ${block('Dates partially documented', groups.unknown, 'unknown', now)}
    ${past}
    ${news.length ? `<h2 class="section">Latest from Ubisoft <em>${two(Math.min(8, news.length))}</em></h2>
      <div class="news">${news.slice(0, 8).map(n => `<a class="news-item" href="${esc(n.url)}" target="_blank" rel="noopener">
        <span class="eyebrow">${esc(day(moment(n.date) ?? now))}</span><b>${esc(n.title)}</b><span class="note">${esc(n.summary)}…</span></a>`).join('')}</div>` : ''}
    <p class="note">In-game reset is ${two(RESET_HOUR)}:00 UTC; countdowns use that daily boundary. Dates can change: entries with missing or conflicting dates are marked.</p>`;
  $('#today').textContent = day(now);
  shown = layout(now);
  tick();
}

// Runs every second: moves the clocks and the progress bars, and redraws the page the moment
// an event starts or ends.
function tick() {
  const now = Date.now();
  if (shown && layout(now) !== shown) return render();
  for (const el of document.querySelectorAll('.count-down[data-until]')) el.innerHTML = clock(el.dataset.until - now);
  for (const el of document.querySelectorAll('.progress[data-from]')) {
    const done = Math.min(100, Math.max(0, (now - el.dataset.from) / (el.dataset.to - el.dataset.from) * 100));
    el.firstElementChild.style.width = `${done.toFixed(2)}%`;
    if (el.nextElementSibling) el.nextElementSibling.textContent = percent(done);
  }
  const time = $('#clock'), fresh = $('#fresh');
  if (time) time.textContent = `${new Date(now).toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC`;
  if (fresh) {
    fresh.textContent = [updated ? `Calendar data updated ${ago(now - updated)}` : '', checked ? `checked ${ago(now - checked)}` : '']
      .filter(Boolean).join(' · ');
  }
}

// Reads the data files. Returns true when anything in them changed.
async function load() {
  let newest = 0;
  const text = async (name, optional) => {
    const response = await fetch(`data/${name}`, { cache: 'no-store' });
    if (!response.ok) { if (optional) return ''; throw new Error(`data/${name} could not be read`); }
    newest = Math.max(newest, Date.parse(response.headers.get('last-modified')) || 0);
    return response.text();
  };
  // auto_events.csv and news.json are written every hour by the GitHub job; the page still
  // works without them.
  const files = await Promise.all([text('seasons.csv'), text('events.csv'), text('auto_events.csv', true).catch(() => ''), text('news.json', true).catch(() => '')]);
  checked = Date.now();
  if (newest) updated = newest;
  const print = files.join('\u0000');
  if (print === load.last) return false;
  load.last = print;
  const [s, e, auto] = files.slice(0, 3).map(parseTable);
  try { news = JSON.parse(files[3] || '{}').items || []; } catch { news = []; }
  seasons = s.map(r => ({ ...r, from: moment(r.start), to: moment(r.end) }));
  // A season with no end date ends when the next one starts.
  for (const x of seasons) {
    const later = seasons.filter(y => y.from !== null && x.from !== null && y.from > x.from).map(y => y.from);
    if (x.to === null && later.length) x.to = Math.min(...later);
  }
  // A row written by hand wins over an automatic one about the same thing in the same season.
  const key = n => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
  const extra = auto.filter(r => !e.some(m => m.season === r.season && (key(m.name).includes(key(r.name)) || key(r.name).includes(key(m.name)))))
    .map(r => ({ ...r, auto: true }));
  events = [...e, ...extra].map(r => ({ ...r, from: moment(r.start), to: moment(r.end), permanent: /^perm/i.test(r.end) }));
  return true;
}

async function start() {
  await load();
  // Open on the season running now: the latest one that has started.
  const now = Date.now();
  const running = seasons.filter(x => x.from !== null && x.from <= now).sort((a, b) => b.from - a.from)[0];
  chosen = (running || seasons[0]).id;
  render();
  setInterval(tick, 1000);
  // New events appear by themselves: the files are read again every few minutes and whenever
  // the visitor comes back to the tab.
  const refresh = () => load().then(changed => { if (changed && !document.activeElement?.matches('#season')) render(); }).catch(() => {});
  setInterval(refresh, REFRESH);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - checked > 60000) refresh(); });
}

document.addEventListener('change', e => { if (e.target.id === 'season') { chosen = e.target.value; render(); } });
// The archive stays open or closed across the half-minute redraws.
document.addEventListener('toggle', e => { if (e.target.matches?.('#calendar details')) archiveOpen = e.target.open; }, true);

start().catch(err => {
  console.error(err);
  $('#calendar').innerHTML = `<section class="panel"><h2>The calendar could not be loaded</h2><p class="note">${esc(err.message)}</p></section>`;
});
