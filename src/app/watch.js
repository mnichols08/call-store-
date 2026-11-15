// Watching a coworker's call and suggesting a part to them. A manager or owner switches it on for
// the shop (it is off until then). The person being watched is always told, and each suggestion is
// theirs to accept or dismiss.
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';
import { numberKey } from '../domain/parts.js';

const HERE_MS = 90_000; // seen this recently means still watching
const REWATCH_MS = 10 * 60_000; // one activity-log line per person per call per ten minutes
const RATE = { max: 10, windowMs: 60_000 };

export function createWatch({ db, audit, now, changed, nudges, parts, calls }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const enabled = () => db.prepare("SELECT value FROM settings WHERE key = 'watching'").get()?.value === 'on';
  const off = () => (enabled() ? null : { error: 'watch-off' });
  const row = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  const holder = (c) => c.assignee || c.created_by;

  return {
    enabled,

    setEnabled(who, on) {
      const no = deny(who, 'watch.manage');
      if (no) return no;
      db.prepare("INSERT INTO settings (key, value) VALUES ('watching', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(on ? 'on' : 'off');
      if (!on) db.prepare('DELETE FROM call_watchers').run();
      audit.record(who.email, on ? 'watch.enabled' : 'watch.disabled', 'settings', {});
      return { ok: true };
    },

    /** Calls being worked right now, with who has them and who is watching. */
    live(who) {
      const no = deny(who, 'call.watch') || off();
      if (no) return no;
      const rows = db.prepare("SELECT * FROM calls WHERE status IN ('open', 'working', 'parked') AND (assignee IS NOT NULL OR status = 'open') ORDER BY updated_at DESC LIMIT 60").all();
      const seen = db.prepare('SELECT call_id, email FROM call_watchers WHERE seen_at > ?').all(now() - HERE_MS);
      return { ok: true, calls: rows.map((c) => ({ id: c.id, status: c.status, assignee: c.assignee, request: c.request, application: safeJson(c.application), updated_at: c.updated_at, watchers: seen.filter((w) => w.call_id === c.id).map((w) => w.email) })) };
    },

    /** Open a coworker's call to watch. Leaves a mark the call's owner can see. */
    watch(who, callId) {
      const no = deny(who, 'call.watch') || off();
      if (no) return no;
      const c = row(callId);
      if (!c) return { error: 'missing' };
      if (holder(c) === who.email) return { error: 'watch-self' };
      const t = now();
      const prior = db.prepare('SELECT first_seen, seen_at FROM call_watchers WHERE call_id = ? AND email = ?').get(callId, who.email);
      const fresh = !prior || t - prior.seen_at > HERE_MS;
      db.prepare(`INSERT INTO call_watchers (call_id, email, first_seen, seen_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (call_id, email) DO UPDATE SET seen_at = excluded.seen_at`).run(callId, who.email, t, t);
      if (!prior || t - prior.seen_at > REWATCH_MS) audit.record(who.email, 'call.watched', `call:${callId}`, { of: holder(c) });
      if (fresh) changed({ type: 'watch', id: callId });
      const got = calls.get(who, callId);
      if (got.error) return got;
      return { ok: true, ...got, search: parts.lastForCall(who, callId).search, suggestions: this.suggestionsFor(callId) };
    },

    /** People looking at the call right now, other than `except`. */
    watchers(callId, except = '') {
      return db.prepare('SELECT email FROM call_watchers WHERE call_id = ? AND seen_at > ? AND email != ? ORDER BY first_seen').all(callId, now() - HERE_MS, except).map((r) => r.email);
    },

    stop(who, callId) {
      db.prepare('DELETE FROM call_watchers WHERE call_id = ? AND email = ?').run(callId, who.email);
      changed({ type: 'watch', id: callId });
      return { ok: true };
    },

    suggestionsFor(callId) {
      return db.prepare("SELECT * FROM call_suggestions WHERE call_id = ? ORDER BY (status = 'pending') DESC, id DESC LIMIT 20").all(callId);
    },

    /** Suggest a part number to whoever has the call. */
    suggest(who, callId, { term = '', brand = '', partNumber = '', description = '', note = '' }) {
      const no = deny(who, 'call.suggest') || off();
      if (no) return no;
      const c = row(callId);
      if (!c) return { error: 'missing' };
      if (c.status === 'closed') return { error: 'closed' };
      const to = holder(c);
      if (to === who.email) return { error: 'watch-self' };
      const b = clip(String(brand).trim(), 40);
      const n = clip(String(partNumber).trim(), 40);
      if (!b || !numberKey(n)) return { error: 'number' };
      const t = now();
      if (db.prepare('SELECT COUNT(*) AS n FROM call_suggestions WHERE from_email = ? AND created_at > ?').get(who.email, t - RATE.windowMs).n >= RATE.max) return { error: 'slow-down' };
      const { lastInsertRowid } = db.prepare('INSERT INTO call_suggestions (call_id, from_email, term, brand, part_number, description, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(callId, who.email, clip(String(term).trim(), 100), b, n, clip(String(description).trim(), 200), clip(String(note).trim(), 300), t);
      const id = Number(lastInsertRowid);
      audit.record(who.email, 'part.suggested', `call:${callId}`, { to, part: `${b} ${n}` });
      if (to !== 'portal') nudges.send(who, { to, callId, message: `Suggests ${b} ${n}${note ? `: ${clip(String(note).trim(), 80)}` : ''}` });
      changed({ type: 'call', id: callId });
      return { ok: true, id };
    },

    /** The person with the call (or a manager) takes or dismisses a suggestion. Returns what to do with the part. */
    decide(who, id, accept) {
      const s = db.prepare('SELECT * FROM call_suggestions WHERE id = ?').get(id);
      if (!s) return { error: 'missing' };
      const c = row(s.call_id);
      if (!c || !(holder(c) === who.email || can(who, 'call.assign'))) return { error: 'forbidden' };
      if (s.status !== 'pending') return { error: 'decided' };
      db.prepare('UPDATE call_suggestions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(accept ? 'accepted' : 'dismissed', who.email, now(), id);
      audit.record(who.email, accept ? 'part.suggestion.accepted' : 'part.suggestion.dismissed', `call:${s.call_id}`, { from: s.from_email, part: `${s.brand} ${s.part_number}` });
      changed({ type: 'call', id: s.call_id });
      return { ok: true, suggestion: s, call: c };
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text) ?? {};
  } catch {
    return {};
  }
}
