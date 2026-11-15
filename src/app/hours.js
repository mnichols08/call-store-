// Opening hours: the week from the shop's profile, plus closures and special hours that managers add.
import { can } from '../domain/permissions.js';
import { SHOP } from '../domain/shop.js';
import { addDays, localParts, minutesOf, shopState } from '../domain/hours.js';
import { clip, isRealDate } from '../domain/text.js';

const KEY = 'closures';

export function createHours({ db, audit, now, changed, zone = 'America/New_York', week = SHOP.hours }) {
  const read = () => {
    try {
      const list = JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY)?.value ?? '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const write = (list) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(list));
  const today = () => localParts(now(), zone).date;

  return {
    week,
    zone,
    /** Is the shop open, and when does it open next (for anyone to see). */
    state: () => shopState(now(), zone, week, read()),
    /** Closures and special hours from today on, soonest first. */
    upcoming(days = 60) {
      const t = today();
      const last = addDays(t, days).date;
      return read().filter((c) => c.date >= t && c.date <= last).sort((a, b) => a.date.localeCompare(b.date));
    },
    /** Close a day (no open and close), or give it special hours (both). */
    set(who, { date, note = '', open = '', close = '' }) {
      if (!can(who, 'hours.manage')) return { error: 'forbidden' };
      if (!isRealDate(date)) return { error: 'date' };
      if (date < today()) return { error: 'past' };
      const special = open || close;
      if (special && (minutesOf(open) == null || minutesOf(close) == null || minutesOf(close) <= minutesOf(open))) return { error: 'hours' };
      const entry = { date, note: clip(String(note).replace(/[\u0000-\u001f]+/g, ' ').trim(), 60), ...(special ? { open, close } : {}) };
      const list = read().filter((c) => c.date !== date && c.date >= today());
      if (list.length >= 100) return { error: 'too-many' };
      write([...list, entry].sort((a, b) => a.date.localeCompare(b.date)));
      audit.record(who.email, 'hours.set', `hours:${date}`, { note: entry.note, special: Boolean(special) });
      changed({ type: 'hours' });
      return { ok: true };
    },
    remove(who, date) {
      if (!can(who, 'hours.manage')) return { error: 'forbidden' };
      write(read().filter((c) => c.date !== date));
      audit.record(who.email, 'hours.removed', `hours:${date}`, {});
      changed({ type: 'hours' });
      return { ok: true };
    },
  };
}
