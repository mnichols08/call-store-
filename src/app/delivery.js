// Deliveries: where a parts order is going and how far along it is.
import { can } from '../domain/permissions.js';
import { STATUSES, NEXT, cleanDelivery } from '../domain/delivery.js';

/** Save (or replace) a call's delivery. Used by staff and by a customer's own web request. */
export function saveDelivery({ db, now }, callId, input, by, { known = false } = {}) {
  const d = cleanDelivery(input, undefined, { known });
  if (d.error) return d;
  const at = now();
  db.prepare(`INSERT INTO call_delivery (call_id, town, address, note, outside, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (call_id) DO UPDATE SET town = excluded.town, address = excluded.address, note = excluded.note, outside = excluded.outside, updated_at = excluded.updated_at`)
    .run(callId, d.town, d.address, d.note, d.outside ? 1 : 0, by, at, at);
  return { ok: true, outside: d.outside };
}

export function createDelivery({ db, audit, now, changed, portal }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const call = (id) => db.prepare('SELECT id, status, source FROM calls WHERE id = ?').get(id);
  const row = (id) => db.prepare('SELECT * FROM call_delivery WHERE call_id = ?').get(id) ?? null;
  // On unless an owner turns it off: a customer on file is delivered to the address the shop knows.
  const knownOn = () => db.prepare("SELECT value FROM settings WHERE key = 'delivery.known'").get()?.value !== 'off';
  /** For a call with a customer attached: their address on file, or `true` when none is written down. False for a cash customer. */
  const knownFor = (callId) => {
    if (!knownOn()) return false;
    const c = db.prepare('SELECT cu.address FROM calls c JOIN customers cu ON cu.id = c.customer_id WHERE c.id = ?').get(callId);
    return c ? c.address.trim() || true : false;
  };

  return {
    knownOn,
    knownFor,

    /** Owner only: whether customers on file are delivered without asking for an address. */
    setKnown(who, on) {
      if (!who?.roles?.includes('owner')) return { error: 'forbidden' };
      db.prepare("INSERT INTO settings (key, value) VALUES ('delivery.known', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(on ? 'on' : 'off');
      audit.record(who.email, on ? 'delivery.known-on' : 'delivery.known-off', 'settings', {});
      return { ok: true };
    },

    get(who, callId) {
      const no = deny(who, 'call.view');
      if (no) return no;
      return { ok: true, delivery: row(callId) };
    },

    set(who, callId, input) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const c = call(callId);
      if (!c) return { error: 'missing' };
      if (row(callId)?.status === 'delivered') return { error: 'delivered' };
      const r = saveDelivery({ db, now }, callId, input, who.email, { known: knownFor(callId) });
      if (r.error) return r;
      db.prepare('UPDATE calls SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now(), callId);
      audit.record(who.email, 'delivery.set', `call:${callId}`, { outside: r.outside });
      changed({ type: 'call', id: callId });
      return r;
    },

    /** Move a delivery along. Going out, or arriving, tells a web customer (and emails them if they want). */
    async status(who, callId, status, { origin = '' } = {}) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      if (!STATUSES.includes(status)) return { error: 'status' };
      const d = row(callId);
      if (!d) return { error: 'missing' };
      if (!NEXT[d.status].includes(status)) return { error: 'status' };
      const at = now();
      db.prepare('UPDATE call_delivery SET status = ?, updated_at = ?, delivered_at = ? WHERE call_id = ?').run(status, at, status === 'delivered' ? at : null, callId);
      db.prepare('UPDATE calls SET revision = revision + 1, updated_at = ? WHERE id = ?').run(at, callId);
      audit.record(who.email, `delivery.${status}`, `call:${callId}`, {});
      changed({ type: 'call', id: callId });
      if (call(callId).source === 'portal' && ['out', 'delivered'].includes(status)) {
        await portal.postUpdate(who, callId, { kind: status === 'out' ? 'on-the-way' : 'done', message: status === 'out' ? 'Out for delivery.' : 'Delivered.', origin });
      }
      return { ok: true };
    },

    remove(who, callId) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const d = row(callId);
      if (!d) return { error: 'missing' };
      if (d.status === 'delivered') return { error: 'delivered' };
      db.prepare('DELETE FROM call_delivery WHERE call_id = ?').run(callId);
      audit.record(who.email, 'delivery.removed', `call:${callId}`, {});
      changed({ type: 'call', id: callId });
      return { ok: true };
    },

    /** What's still to go, by town so a drive can be planned, and what arrived in the last day. */
    list(who) {
      const no = deny(who, 'call.view');
      if (no) return no;
      const rows = db.prepare(`SELECT d.*, c.request, c.part_numbers, c.caller_name, c.caller_phone, c.source, cu.name AS customer_name, cu.address AS customer_address,
          (SELECT phone FROM customer_phones WHERE customer_id = c.customer_id ORDER BY id LIMIT 1) AS customer_phone
        FROM call_delivery d JOIN calls c ON c.id = d.call_id LEFT JOIN customers cu ON cu.id = c.customer_id
        WHERE d.status != 'delivered' OR d.delivered_at > ? ORDER BY d.status = 'delivered', d.outside, d.town COLLATE NOCASE, d.call_id`).all(now() - 86_400_000);
      return { ok: true, active: rows.filter((r) => r.status !== 'delivered'), recent: rows.filter((r) => r.status === 'delivered') };
    },
  };
}
