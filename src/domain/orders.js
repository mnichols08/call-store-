// The order notebook: one page per day, one line per special order. Pure rules for reading what the
// AI says about a photo of a page, so nothing it writes is trusted until it has been cleaned.

import { isRealDate } from './text.js';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FIELDS = ['lineCode', 'partNumber', 'orderedFrom', 'customer'];
export const SHEET_MAX_ROWS = 60;

const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A real calendar date as YYYY-MM-DD, or ''. */
export function cleanDate(value) {
  const t = String(value ?? '').trim();
  return isRealDate(t) ? t : '';
}

/** "11-10-26", "11/10/2026", "Tues 11-10-26" as YYYY-MM-DD (month first, as written in the notebook), or ''. */
export function dateFromWriting(value) {
  const m = /(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})(?!\d)/.exec(String(value ?? ''));
  if (!m) return '';
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return cleanDate(`${year}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`);
}

/** Does the weekday written in the header agree with the date? null if there's no weekday to compare. */
export function weekdayAgrees(writing, date) {
  const day = /^\s*(mon|tue|wed|thu|fri|sat|sun)/i.exec(String(writing ?? ''))?.[1]?.toLowerCase();
  if (!day || !date) return null;
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] === day;
}

/**
 * Make what the AI returned safe and tidy: at most SHEET_MAX_ROWS rows, short plain text, a real date,
 * and a note of which fields it wasn't sure of. Crossed-out lines are marked so the review can skip them.
 */
export function cleanSheet(parsed) {
  const dateText = text(parsed?.dateText, 40);
  const date = cleanDate(parsed?.date) || dateFromWriting(dateText);
  const rows = (Array.isArray(parsed?.rows) ? parsed.rows : []).slice(0, SHEET_MAX_ROWS).map((r) => {
    const unsure = new Set((Array.isArray(r?.unsure) ? r.unsure : []).filter((k) => FIELDS.includes(k)));
    const row = {
      lineCode: text(r?.lineCode, 8).toUpperCase(),
      partNumber: text(r?.partNumber, 30).toUpperCase(),
      orderedFrom: text(r?.orderedFrom, 60),
      customer: text(r?.customer, 80),
      received: r?.received === true,
      paid: r?.paid === true,
      crossedOut: r?.crossedOut === true,
      unsure: [...unsure],
    };
    for (const k of FIELDS) if (!row[k] && !row.crossedOut) unsure.add(k);
    row.unsure = [...unsure];
    return row;
  }).filter((r) => r.lineCode || r.partNumber || r.orderedFrom || r.customer);
  return { date, dateText, rows, weekdayOk: weekdayAgrees(dateText, date) };
}
