// The lines of a call: one typed line per thing the caller wants, read by fixed rules (see
// domain/quickline.js). The vehicle carries from line to line until a new one is typed. Adding,
// fixing or removing a line also keeps the call's vehicle, its title in the queue and its search
// text up to date, so the rest of the app (vehicle lookup, part finder, the queue) sees the same call.
import { transaction } from '../infra/db.js';
import { can } from '../domain/permissions.js';
import { carryVehicle, parseLine, sayLine, sayVehicle } from '../domain/quickline.js';

export const MAX_LINES = 60;
const VEHICLE_KEYS = ['year', 'make', 'model', 'engine', 'drivetrain'];
const onlyVehicle = (v) => Object.fromEntries(VEHICLE_KEYS.filter((k) => v?.[k]).map((k) => [k, String(v[k])]));

export function createLines({ db, audit, now, changed }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const callRow = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  const inflate = (r) => ({ id: r.id, seq: r.seq, kind: r.kind, raw: r.raw, part: r.part, qty: r.qty, partNumbers: r.part_numbers, vehicle: JSON.parse(r.vehicle), guessed: JSON.parse(r.guessed), done: Boolean(r.done), by: r.created_by, at: r.created_at });
  const rows = (callId) => db.prepare('SELECT * FROM call_lines WHERE call_id = ? ORDER BY seq, id').all(callId);

  function event(callId, who, type, data) {
    db.prepare('INSERT INTO call_events (call_id, at, actor, type, data) VALUES (?, ?, ?, ?, ?)').run(callId, now(), who.email, type, JSON.stringify(data));
    audit.record(who.email, `call.${type}`, `call:${callId}`, data);
  }

  /** The vehicle the next line is about: the one the last line ended on, or what the call already says. */
  function contextFor(callId, before = Infinity) {
    const last = rows(callId).filter((r) => r.seq < before).at(-1);
    if (last) return JSON.parse(last.vehicle);
    return onlyVehicle(JSON.parse(callRow(callId).application));
  }

  /** Recompute each line's vehicle from the first one on, after one was changed or removed. */
  function rebuild(callId) {
    let vehicle = {};
    for (const r of rows(callId)) {
      const parsed = parseLine(r.raw);
      vehicle = carryVehicle(vehicle, parsed);
      db.prepare('UPDATE call_lines SET vehicle = ?, part = ?, qty = ?, part_numbers = ?, kind = ?, guessed = ? WHERE id = ?')
        .run(JSON.stringify(vehicle), parsed.part, parsed.qty, parsed.partNumbers.join(', '), parsed.kind === 'vehicle' ? 'vehicle' : 'part', JSON.stringify(parsed.guessed), r.id);
    }
  }

  /** Keep the call's own fields in step: the vehicle, and the short text that titles it in the queue. */
  function sync(who, callId) {
    const list = rows(callId).map(inflate);
    const parts = list.filter((l) => l.kind === 'part');
    const names = parts.map((l) => [l.qty > 1 ? `${l.qty} ×` : '', l.part || (l.partNumbers ? `Part ${l.partNumbers}` : '')].filter(Boolean).join(' '));
    const text = names.length ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2} more` : ''}` : '';
    const current = JSON.parse(callRow(callId).application);
    const vehicle = list.at(-1)?.vehicle;
    let application = null;
    // The call's vehicle follows the last line. Fields typed by hand elsewhere on the call (VIN, unit number) stay.
    if (vehicle) {
      const keep = Object.fromEntries(Object.entries(current).filter(([k]) => !VEHICLE_KEYS.includes(k)));
      const next = { ...keep, ...onlyVehicle(vehicle) };
      if (JSON.stringify(next) !== JSON.stringify(current)) application = next;
    }
    db.prepare(`UPDATE calls SET lines_text = ?, ${application ? 'application = ?, ' : ''}revision = revision + 1, updated_at = ? WHERE id = ?`)
      .run(...[text.slice(0, 300), ...(application ? [JSON.stringify(application)] : []), now(), callId]);
    return list;
  }

  function guard(who, callId) {
    const no = deny(who, 'call.edit');
    if (no) return no;
    const c = callRow(callId);
    if (!c) return { error: 'missing' };
    if (c.status === 'closed') return { error: 'closed' };
    return null;
  }

  const summary = (callId) => {
    const c = callRow(callId);
    return { lines: rows(callId).map(inflate), revision: c.revision, application: JSON.parse(c.application) };
  };

  return {
    list(who, callId) {
      const no = deny(who, 'call.view');
      if (no) return no;
      if (!callRow(callId)) return { error: 'missing' };
      return { ok: true, ...summary(callId) };
    },

    /** Type a line. Returns the whole call's lines, so a page can redraw from one answer. */
    add(who, callId, text) {
      const bad = guard(who, callId);
      if (bad) return bad;
      const parsed = parseLine(text);
      if (parsed.kind === 'empty') return { error: 'empty' };
      if (rows(callId).length >= MAX_LINES) return { error: 'too-many' };
      const result = transaction(db, () => {
        const vehicle = carryVehicle(contextFor(callId), parsed);
        const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM call_lines WHERE call_id = ?').get(callId).n) + 1;
        const { lastInsertRowid } = db.prepare(`INSERT INTO call_lines (call_id, seq, kind, raw, part, qty, part_numbers, vehicle, guessed, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(callId, seq, parsed.kind === 'vehicle' ? 'vehicle' : 'part', parsed.raw, parsed.part, parsed.qty, parsed.partNumbers.join(', '), JSON.stringify(vehicle), JSON.stringify(parsed.guessed), who.email, now());
        sync(who, callId);
        event(callId, who, 'line-added', { text: sayLine(parsed, vehicle) || parsed.raw });
        return Number(lastInsertRowid);
      });
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      return { ok: true, id: result, ...summary(callId) };
    },

    /** Retype a line. The lines after it are read again, since the vehicle they carry may have changed. */
    edit(who, callId, lineId, text) {
      const bad = guard(who, callId);
      if (bad) return bad;
      const line = db.prepare('SELECT * FROM call_lines WHERE id = ? AND call_id = ?').get(lineId, callId);
      if (!line) return { error: 'missing' };
      const parsed = parseLine(text);
      if (parsed.kind === 'empty') return { error: 'empty' };
      transaction(db, () => {
        db.prepare('UPDATE call_lines SET raw = ? WHERE id = ?').run(parsed.raw, lineId);
        rebuild(callId);
        sync(who, callId);
        event(callId, who, 'line-edited', { text: parsed.raw });
      });
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      return { ok: true, ...summary(callId) };
    },

    done(who, callId, lineId, done) {
      const bad = guard(who, callId);
      if (bad) return bad;
      const { changes } = db.prepare('UPDATE call_lines SET done = ? WHERE id = ? AND call_id = ?').run(done ? 1 : 0, lineId, callId);
      if (!changes) return { error: 'missing' };
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      return { ok: true, ...summary(callId) };
    },

    remove(who, callId, lineId) {
      const bad = guard(who, callId);
      if (bad) return bad;
      const line = db.prepare('SELECT raw FROM call_lines WHERE id = ? AND call_id = ?').get(lineId, callId);
      if (!line) return { error: 'missing' };
      transaction(db, () => {
        db.prepare('DELETE FROM call_lines WHERE id = ?').run(lineId);
        rebuild(callId);
        sync(who, callId);
        event(callId, who, 'line-removed', { text: line.raw });
      });
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      return { ok: true, ...summary(callId) };
    },
  };
}
