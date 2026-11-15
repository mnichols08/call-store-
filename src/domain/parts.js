// Rules for part numbers and for what the AI hands back. No network and no database here.
import { clip } from './text.js';

/** A part number as a key: upper case, letters and digits only ("6-1234 a" and "61234A" are one). */
export const numberKey = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const STOP = new Set(['a', 'an', 'the', 'for', 'new', 'replacement', 'assembly', 'assy', 'kit']);
/** A description as a key: "Water Pumps" and "water pump" ask the same question. */
export function termKey(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).sort().join(' ');
}

/**
 * Whether what was typed looks like a part number (to cross-reference) rather than a description
 * (to search for): no spaces between its pieces, at least one digit, and 3 or more characters.
 */
export function looksLikePartNumber(text) {
  const t = String(text ?? '').trim();
  if (t.length < 3 || t.length > 40) return false;
  if (!/\d/.test(t)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(t) || /^[A-Za-z]{1,6}[ -]\d[A-Za-z0-9./_-]*$/.test(t);
}

/** Worked and failed votes make a score: a part that fit three times beats one nobody has tried. */
export function scoreAnswer(a) {
  const bonus = { high: 1, medium: 0.5, low: 0 }[a.confidence] ?? 0;
  return a.worked * 3 - a.failed * 4 + (a.source === 'staff' ? 2 : 0) + bonus;
}
/** Confirmed: someone said it worked, and more people said so than said it didn't. */
export const isConfirmed = (a) => a.worked > 0 && a.worked > a.failed;
/** Hidden unless asked for: it failed more than once and failed more than it worked. */
export const isBad = (a) => a.failed >= 2 && a.failed > a.worked;

/**
 * The AI's candidates, made safe. Anything that isn't a plain part number with a brand is dropped;
 * text is trimmed and capped; a source link is kept only if the search really returned that page
 * (`pages`), so a made-up link can't appear; a candidate with no real source is never "high".
 */
export function cleanCandidates(raw, { pages = new Set(), limit = 6 } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const brand = clip(plain(item.brand), 40);
    const number = clip(plain(item.partNumber ?? item.part_number), 40);
    if (!brand || !/^[A-Za-z0-9][A-Za-z0-9 ./_-]{1,38}$/.test(number)) continue;
    const key = `${brand.toLowerCase()}|${numberKey(number)}`;
    if (!numberKey(number) || seen.has(key)) continue;
    seen.add(key);
    const url = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
    const grounded = /^https:\/\/[^\s<>"']{4,300}$/.test(url) && pages.has(url);
    let confidence = ['low', 'medium', 'high'].includes(item.confidence) ? item.confidence : 'low';
    if (!grounded && confidence === 'high') confidence = 'medium';
    out.push({ brand, partNumber: number, description: clip(plain(item.description), 200), notes: clip(plain(item.fitment ?? item.notes), 300), sourceUrl: grounded ? url : '', confidence });
    if (out.length >= limit) break;
  }
  return out;
}

/** Text from outside, as plain words: no markup, no control characters, one line of spaces. */
function plain(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
