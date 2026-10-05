// Parses CSV text into rows of cells. Cells keep their line breaks.
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else if (c !== '\r') cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Rows as objects keyed by the (lower-cased) header row. Used for our own small tables.
export function parseTable(text) {
  const rows = parseCSV(text);
  const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
  return rows
    .filter(r => (r[0] || '').trim() !== '')
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}
