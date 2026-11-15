// A small CSV reader for pasted or uploaded customer lists. Handles a byte-order mark, comma, tab,
// semicolon or pipe separators, quoted cells with doubled quotes and line breaks, and CRLF.

/** Pick the separator the first line uses most. */
export function detectDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let most = 0;
  for (const d of ['\t', ',', ';', '|']) {
    const n = first.split(d).length - 1;
    if (n > most) { best = d; most = n; }
  }
  return best;
}

/** Rows of cells. Empty lines are dropped. */
export function parseCsv(input, delimiter = null) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let started = false; // anything seen on this line, so a quoted empty cell still counts
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    if (started && row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
    started = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') { quoted = true; started = true; }
    else if (c === d) { endCell(); started = true; }
    else if (c === '\n') endRow();
    else if (c === '\r') { if (text[i + 1] !== '\n') endRow(); }
    else { cell += c; started = true; }
  }
  if (started || cell !== '') endRow();
  return rows;
}

const HEADERS = {
  id: ['id', 'account', 'account no', 'account number', 'account #', 'acct', 'acct no', 'acct #', 'customer id', 'customer no', 'customer number', 'customer #', 'number', 'no'],
  name: ['name', 'customer', 'customer name', 'company', 'company name', 'business', 'full name'],
  phone: ['phone', 'phones', 'phone number', 'telephone', 'tel', 'mobile', 'cell', 'cell phone', 'contact number'],
  address: ['address', 'street', 'mailing address'],
  tier: ['type', 'tier', 'account type', 'customer type', 'class'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

/** Which column holds what, from the header row: `{ id: 0, name: 1, phone: 2 }` or null if there's no name column. */
export function mapHeader(cells) {
  const found = {};
  cells.forEach((cell, i) => {
    const key = String(cell).toLowerCase().replace(/[^a-z0-9# ]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [field, names] of Object.entries(HEADERS)) if (!(field in found) && names.includes(key)) found[field] = i;
  });
  return 'name' in found ? found : null;
}
