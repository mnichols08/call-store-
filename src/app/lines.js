// The lines of a call: one typed line per thing the caller wants, read by fixed rules (see
// domain/quickline.js). The vehicle carries from line to line until a new one is typed. Adding,
// fixing or removing a line also keeps the call's vehicle, its title in the queue and its search
// text up to date, so the rest of the app (vehicle lookup, part finder, the queue) sees the same call.
//
// A line can be a part, a vehicle (with or without a VIN) or paint. Part lines wait in a queue for
// part-number suggestions (app/finder.js), and each line is worked down the list: open, found, need
// to order, can't get. A VIN is decoded after the line is saved (`resolveVin`), and the vehicle it
// decodes to carries to the lines after it.
import { transaction } from '../infra/db.js';
import { can } from '../domain/permissions.js';
import { carryVehicle, parseLine, sayLine, sayVehicle } from '../domain/quickline.js';

export const MAX_LINES = 60;
export const LINE_STATUSES = ['open', 'found', 'order', 'cant'];
const VEHICLE_KEYS = ['year', 'make', 'model', 'engine', 'drivetrain'];
const onlyVehicle = (v) => Object.fromEntries(VEHICLE_KEYS.filter((k) => v?.[k]).map((k) => [k, String(v[k])]));

export function createLines({ db, audit, now, changed, vehicles = null, queue = () => {} }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const callRow = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  const inflate = (r) => ({
    id: r.id, seq: r.seq, kind: r.kind, raw: r.raw, part: r.part, qty: r.qty, partNumbers: r.part_numbers, vehicle: JSON.parse(r.vehicle), guessed: JSON.parse(r.guessed), done: Boolean(r.done), by: r.created_by, at: r.created_at,
    paint: r.paint ? JSON.parse(r.paint) : null, vin: r.vin, vinDecoded: Boolean(r.vin_vehicle), status: r.status, suggest: r.suggest_state, suggestions: JSON.parse(r.suggestions),
  });
  /** A part line goes in the queue for suggestions; paint and vehicle lines never do. */
  const wantsSuggestions = (parsed) => parsed.kind !== 'paint' && Boolean(parsed.part || parsed.partNumbers.length) && !parsed.partIncomplete;
  const kindOf = (parsed) => (parsed.kind === 'vehicle' ? 'vehicle' : parsed.kind === 'paint' ? 'paint' : 'part');
  /** The vehicle a line says, with what its VIN decoded to underneath anything typed on it. */
  const lineVehicle = (parsed, row) => (row?.vin_vehicle && parsed.vin === row.vin ? { ...JSON.parse(row.vin_vehicle), ...parsed.vehicle } : parsed.vehicle);
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

  /**
   * Recompute each line's vehicle from the first one on, after one was changed, removed or its VIN
   * decoded. A part line whose vehicle changed, or that was waiting for one, goes back in the queue.
   */
  function rebuild(callId) {
    let vehicle = {};
    const again = [];
    for (const r of rows(callId)) {
      const parsed = parseLine(r.raw);
      vehicle = carryVehicle(vehicle, { ...parsed, vehicle: lineVehicle(parsed, r) });
      const moved = JSON.stringify(vehicle) !== r.vehicle;
      const state = !wantsSuggestions(parsed) ? '' : moved || r.suggest_state === 'vehicle' ? 'queued' : r.suggest_state;
      if (state === 'queued' && r.suggest_state !== 'queued') again.push(r.id);
      db.prepare(`UPDATE call_lines SET vehicle = ?, part = ?, qty = ?, part_numbers = ?, kind = ?, guessed = ?, paint = ?, vin = ?, vin_vehicle = ?, suggest_state = ?${state === 'queued' ? ", suggestions = '[]'" : ''} WHERE id = ?`)
        .run(JSON.stringify(vehicle), parsed.part, parsed.qty, parsed.partNumbers.join(', '), kindOf(parsed), JSON.stringify(parsed.guessed), parsed.paint ? JSON.stringify(parsed.paint) : null, parsed.vin ?? '', parsed.vin && parsed.vin === r.vin ? r.vin_vehicle : null, state, r.id);
    }
    return again;
  }

  /** Keep the call's own fields in step: the vehicle, and the short text that titles it in the queue. */
  function sync(who, callId) {
    const list = rows(callId).map(inflate);
    const parts = list.filter((l) => l.kind === 'part' || l.kind === 'paint');
    const names = parts.map((l) => [l.qty > 1 ? `${l.qty} ×` : '', l.paint ? `Paint ${l.paint.code}`.trim() : l.part || (l.partNumbers ? `Part ${l.partNumbers}` : '')].filter(Boolean).join(' '));
    const text = names.length ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2} more` : ''}` : '';
    const current = JSON.parse(callRow(callId).application);
    const vehicle = list.at(-1)?.vehicle;
    let application = null;
    // The call's vehicle follows the last line, and its VIN the last VIN typed. Fields typed by hand
    // elsewhere on the call (unit number, notes about the equipment) stay.
    const vin = list.filter((l) => l.vin).at(-1)?.vin;
    if (vehicle || vin) {
      const keep = Object.fromEntries(Object.entries(current).filter(([k]) => !(vehicle && VEHICLE_KEYS.includes(k))));
      const next = { ...keep, ...(vehicle ? onlyVehicle(vehicle) : {}), ...(vin ? { vin } : {}) };
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
        const { lastInsertRowid } = db.prepare(`INSERT INTO call_lines (call_id, seq, kind, raw, part, qty, part_numbers, vehicle, guessed, paint, vin, suggest_state, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(callId, seq, kindOf(parsed), parsed.raw, parsed.part, parsed.qty, parsed.partNumbers.join(', '), JSON.stringify(vehicle), JSON.stringify(parsed.guessed), parsed.paint ? JSON.stringify(parsed.paint) : null, parsed.vin ?? '', wantsSuggestions(parsed) ? 'queued' : '', who.email, now());
        sync(who, callId);
        event(callId, who, 'line-added', { text: sayLine(parsed, vehicle) || parsed.raw });
        return Number(lastInsertRowid);
      });
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      if (wantsSuggestions(parsed)) queue();
      // A VIN is decoded after the answer goes back: `resolveVin(who, callId, vin)` with the id given here.
      return { ok: true, id: result, vin: parsed.vin ? result : null, ...summary(callId) };
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
        // A retyped line is asked about again, and works from "open".
        db.prepare("UPDATE call_lines SET raw = ?, suggest_state = 'vehicle', suggestions = '[]', status = 'open', done = 0 WHERE id = ?").run(parsed.raw, lineId);
        rebuild(callId);
        sync(who, callId);
        event(callId, who, 'line-edited', { text: parsed.raw });
      });
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      queue();
      return { ok: true, vin: parsed.vin && parsed.vin !== line.vin ? lineId : null, ...summary(callId) };
    },

    /** Tick a line off (found) or back to open. */
    done(who, callId, lineId, done) {
      return this.status(who, callId, lineId, done ? 'found' : 'open');
    },

    /** Where a line stands: open, found, order (need to order), cant (can't get). */
    status(who, callId, lineId, status) {
      const bad = guard(who, callId);
      if (bad) return bad;
      if (!LINE_STATUSES.includes(status)) return { error: 'status' };
      const line = db.prepare('SELECT status, part FROM call_lines WHERE id = ? AND call_id = ?').get(lineId, callId);
      if (!line) return { error: 'missing' };
      if (line.status === status) return { ok: true, ...summary(callId) };
      db.prepare('UPDATE call_lines SET status = ?, done = ? WHERE id = ?').run(status, status === 'open' ? 0 : 1, lineId);
      event(callId, who, 'line-status', { text: line.part, status });
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      return { ok: true, ...summary(callId) };
    },

    /**
     * Decode the VIN typed on a line, and carry the vehicle it gives to the lines after it. Slow (it asks
     * NHTSA), so it runs after the line is saved. A VIN that can't be read leaves the line as typed and
     * says why.
     */
    async resolveVin(who, callId, lineId) {
      const bad = guard(who, callId);
      if (bad) return bad;
      const line = db.prepare('SELECT * FROM call_lines WHERE id = ? AND call_id = ?').get(lineId, callId);
      if (!line?.vin) return { error: 'missing' };
      if (!vehicles) return { error: 'source' };
      const read = await vehicles.decode(who, line.vin);
      if (read.error) return { ...read, ...summary(callId) };
      const { year, make, model, engine, drivetrain } = read.spec;
      const decoded = Object.fromEntries(Object.entries({ year: year ? String(year) : '', make, model, engine, drivetrain }).filter(([, v]) => v));
      // The line may have changed while NHTSA answered: only fill in the VIN it still has.
      transaction(db, () => {
        db.prepare('UPDATE call_lines SET vin_vehicle = ? WHERE id = ? AND vin = ?').run(JSON.stringify(decoded), lineId, line.vin);
        rebuild(callId);
        sync(who, callId);
        event(callId, who, 'line-vin', { text: sayVehicle(decoded) });
      });
      changed({ type: 'call', id: callId, why: 'lines', by: who.email });
      queue();
      return { ok: true, warnings: read.warnings, ...summary(callId) };
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
      queue();
      return { ok: true, ...summary(callId) };
    },
  };
}
