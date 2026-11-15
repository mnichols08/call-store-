// Nudges: asking a coworker to look at something. A nudge is stored until the person it is for
// dismisses it, and the web layer is told (through `changed`) so it can reach them live, and by
// push if they've allowed that.
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';

export const MAX_MESSAGE = 200;
/** No more than this many nudges from one person per minute: a nudge is for when it matters. */
export const RATE = { max: 10, windowMs: 60_000 };

export function createNudges({ db, audit, now, changed }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });

  return {
    /**
     * `to` is an email the web layer has already checked is a real, active account. A nudge about a
     * call defaults its wording to the call, so "Nudge" alone is enough.
     */
    send(who, { to, callId = null, message = '' }) {
      const no = deny(who, 'nudge.send');
      if (no) return no;
      if (!to || to === who.email) return { error: 'nudge-who' };
      const text = clip(String(message ?? '').trim(), MAX_MESSAGE);
      if (callId != null && !db.prepare('SELECT 1 FROM calls WHERE id = ?').get(callId)) return { error: 'missing' };
      const recent = db.prepare('SELECT count(*) AS n FROM nudges WHERE from_email = ? AND created_at > ?').get(who.email, now() - RATE.windowMs).n;
      if (recent >= RATE.max) return { error: 'slow-down' };
      const { lastInsertRowid } = db.prepare('INSERT INTO nudges (from_email, to_email, call_id, message, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(who.email, to, callId, text, now());
      const id = Number(lastInsertRowid);
      audit.record(who.email, 'nudge.sent', callId ? `call:${callId}` : `nudge:${id}`, { to });
      changed({ type: 'nudge', id, to, from: who.email, callId, message: text });
      return { ok: true, id };
    },

    /** A nudge from the system itself (a customer sent details). No permission to check: the caller is the app. */
    system(to, { callId = null, message = '' }) {
      const text = clip(String(message).trim(), MAX_MESSAGE);
      const { lastInsertRowid } = db.prepare('INSERT INTO nudges (from_email, to_email, call_id, message, created_at) VALUES (?, ?, ?, ?, ?)').run('customer', to, callId, text, now());
      const id = Number(lastInsertRowid);
      changed({ type: 'nudge', id, to, from: 'customer', callId, message: text });
      return { ok: true, id };
    },

    /** Unread nudges for the signed-in person, newest first. */
    inbox(who) {
      const rows = db.prepare('SELECT * FROM nudges WHERE to_email = ? AND seen_at IS NULL ORDER BY id DESC LIMIT 50').all(who.email);
      return { ok: true, nudges: rows };
    },

    /** Only the person a nudge is for can dismiss it. */
    dismiss(who, id) {
      const { changes } = db.prepare('UPDATE nudges SET seen_at = ? WHERE id = ? AND to_email = ? AND seen_at IS NULL').run(now(), id, who.email);
      return changes ? { ok: true } : { error: 'missing' };
    },

    dismissAll(who) {
      db.prepare('UPDATE nudges SET seen_at = ? WHERE to_email = ? AND seen_at IS NULL').run(now(), who.email);
      return { ok: true };
    },

    // Browsers allowed to notify a person. Not permission-gated: it's about your own devices.
    subscribe(who, { endpoint, keys }) {
      if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) return { error: 'subscription' };
      db.prepare(`INSERT INTO push_subscriptions (endpoint, email, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE SET email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth`)
        .run(endpoint, who.email, keys.p256dh, keys.auth, now());
      return { ok: true };
    },
    unsubscribe(who, endpoint) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND email = ?').run(String(endpoint ?? ''), who.email);
      return { ok: true };
    },
    /** For the web layer's sender; also used to drop dead endpoints. */
    subscriptionsFor: (email) => db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE email = ?').all(email),
    forget: (endpoint) => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint),
  };
}
