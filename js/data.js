import { CONFIG } from './config.js';

// Table name -> a column that must exist. Google returns the first tab when a
// tab name is not found, so the column check stops a wrong tab being used.
const TABLES = {
  settings: 'key',
  stats: 'key',
  attributes: 'where',
  weapon_types: 'damage_stat',
  weapons: 'rpm',
  weapon_talents: 'types',
  weapon_mods: 'slot',
  brands: 'bonus1',
  gear: 'free_attrs',
  gear_talents: 'set',
  specializations: 'effects',
  skills: 'cooldown',
  watch: 'levels',
  targets: 'armor',
};

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
  return rows
    .filter(r => (r[0] || '').trim() !== '')
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

async function fetchRows(url, required) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const rows = parseCSV(await res.text());
  if (!rows.length || !(required in rows[0])) throw new Error(`"${required}" column missing in ${url}`);
  return rows;
}

export async function loadData() {
  const db = {}, fromSheet = [], fromFiles = [];
  await Promise.all(Object.entries(TABLES).map(async ([table, required]) => {
    if (CONFIG.sheetId) {
      const url = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(table)}`;
      try {
        db[table] = await fetchRows(url, required);
        fromSheet.push(table);
        return;
      } catch (err) {
        console.warn(`Sheet tab "${table}" not loaded, using data/${table}.csv`, err);
      }
    }
    db[table] = await fetchRows(`data/${table}.csv`, required);
    fromFiles.push(table);
  }));
  return { db, fromSheet, fromFiles };
}
