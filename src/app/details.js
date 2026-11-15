// Details a customer can give without a phone call: measurements, photos and a note. Staff fill in
// the same details on a call, and can send the customer a private link to do it themselves.
import { createHash, randomBytes } from 'node:crypto';
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';
import { PART_TYPES, describeMeasurements, measureKey, readMeasurements } from '../domain/measure.js';
import { sniff, stripMetadata } from '../domain/image.js';

export const LIMITS = Object.freeze({ photos: 8, photoBytes: 6 * 1024 * 1024, linkHours: 48, note: 400 });
const hash = (token) => createHash('sha256').update(token).digest('hex');

export function createDetails({ db, audit, now, changed, nudges }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const call = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  const open = (c) => c && !['resolved', 'closed'].includes(c.status);

  function event(callId, actor, type, data) {
    db.prepare('INSERT INTO call_events (call_id, at, actor, type, data) VALUES (?, ?, ?, ?, ?)').run(callId, now(), actor, type, JSON.stringify(data));
    audit.record(actor, `call.${type}`, `call:${callId}`, data);
  }
  const photoRows = (callId) => db.prepare('SELECT id, mime, size, source, added_by, created_at FROM call_photos WHERE call_id = ? ORDER BY id').all(callId);

  function readDetails(callId) {
    const r = db.prepare('SELECT * FROM call_details WHERE call_id = ?').get(callId);
    if (!r) return null;
    const values = JSON.parse(r.data);
    return { type: r.part_type, unit: r.unit, values, note: r.note, filledBy: r.filled_by, updatedAt: r.updated_at, key: measureKey(r.part_type, values), text: describeMeasurements(r.part_type, r.unit, values) };
  }

  function writeDetails(callId, actor, { type, unit, get, note }) {
    const read = readMeasurements(type, unit, get);
    if (read.error) return read;
    if (read.errors.length) return { error: 'measure', fields: read.errors };
    const text = clip(String(note ?? '').trim(), LIMITS.note);
    db.prepare(`INSERT INTO call_details (call_id, part_type, unit, data, note, filled_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (call_id) DO UPDATE SET part_type = excluded.part_type, unit = excluded.unit, data = excluded.data, note = excluded.note, filled_by = excluded.filled_by, updated_at = excluded.updated_at`)
      .run(callId, read.type, read.unit, JSON.stringify(read.values), text, actor, now());
    event(callId, actor, 'details', { type: read.type, complete: Boolean(measureKey(read.type, read.values)) });
    return { ok: true };
  }

  function writePhoto(callId, actor, source, bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return { error: 'photo' };
    if (bytes.length > LIMITS.photoBytes) return { error: 'photo-big' };
    const mime = sniff(bytes);
    if (!mime) return { error: 'photo-type' };
    const clean = stripMetadata(bytes, mime);
    if (!clean) return { error: 'photo-bad' };
    if (db.prepare('SELECT COUNT(*) AS n FROM call_photos WHERE call_id = ?').get(callId).n >= LIMITS.photos) return { error: 'photo-many' };
    const { lastInsertRowid } = db.prepare('INSERT INTO call_photos (call_id, mime, bytes, size, source, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(callId, mime, clean, clean.length, source, actor, now());
    event(callId, actor, 'photo', { source });
    return { ok: true, id: Number(lastInsertRowid) };
  }

  function tellHolder(c, text) {
    const to = c.assignee || c.created_by;
    if (to) nudges.system(to, { callId: c.id, message: text });
  }

  return {
    // ------------------------------------------------------------ staff
    get(who, callId) {
      const no = deny(who, 'call.view');
      if (no) return no;
      if (!call(callId)) return { error: 'missing' };
      const links = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(opened), 0) AS opened FROM call_links WHERE call_id = ? AND revoked = 0 AND expires_at > ?').get(callId, now());
      return { ok: true, details: readDetails(callId), photos: photoRows(callId), links: { active: links.n, opened: links.opened } };
    },
    save(who, callId, input) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      if (!call(callId)) return { error: 'missing' };
      const r = writeDetails(callId, who.email, input);
      if (r.ok) changed({ type: 'call', id: callId });
      return r;
    },
    addPhoto(who, callId, bytes) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      if (!call(callId)) return { error: 'missing' };
      const r = writePhoto(callId, who.email, 'staff', bytes);
      if (r.ok) changed({ type: 'call', id: callId });
      return r;
    },
    photo(who, callId, id) {
      const no = deny(who, 'call.view');
      if (no) return no;
      const p = db.prepare('SELECT mime, bytes FROM call_photos WHERE id = ? AND call_id = ?').get(id, callId);
      return p ? { ok: true, mime: p.mime, bytes: Buffer.from(p.bytes) } : { error: 'missing' };
    },
    removePhoto(who, callId, id) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const { changes } = db.prepare('DELETE FROM call_photos WHERE id = ? AND call_id = ?').run(id, callId);
      if (!changes) return { error: 'missing' };
      event(callId, who.email, 'photo-removed', {});
      changed({ type: 'call', id: callId });
      return { ok: true };
    },

    /** A private link for the customer to send measurements and photos. The token is shown once. */
    createLink(who, callId) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const c = call(callId);
      if (!c) return { error: 'missing' };
      if (!open(c)) return { error: 'closed' };
      if (db.prepare('SELECT COUNT(*) AS n FROM call_links WHERE call_id = ? AND created_at > ?').get(callId, now() - 3_600_000).n >= 5) return { error: 'slow-down' };
      const token = randomBytes(24).toString('base64url');
      const expires = now() + LIMITS.linkHours * 3_600_000;
      db.prepare('INSERT INTO call_links (token_hash, call_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(hash(token), callId, who.email, now(), expires);
      audit.record(who.email, 'call.link-made', `call:${callId}`, {});
      return { ok: true, token, expires };
    },
    revokeLinks(who, callId) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      db.prepare('UPDATE call_links SET revoked = 1 WHERE call_id = ?').run(callId);
      audit.record(who.email, 'call.link-revoked', `call:${callId}`, {});
      return { ok: true };
    },

    // ------------------------------------------------------------ the customer, through a link
    /** What a link opens, or why it doesn't. Says nothing about the call except that it's there. */
    viaLink(token) {
      const l = typeof token === 'string' && token.length >= 20 && token.length <= 80 ? db.prepare('SELECT * FROM call_links WHERE token_hash = ?').get(hash(token)) : null;
      if (!l || l.revoked || l.expires_at <= now()) return { error: 'link' };
      const c = call(l.call_id);
      if (!open(c)) return { error: 'link-closed' };
      return { ok: true, link: l, call: c, details: readDetails(c.id), photos: photoRows(c.id).length, limit: LIMITS.photos };
    },
    markOpened(token) {
      db.prepare('UPDATE call_links SET opened = opened + 1 WHERE token_hash = ?').run(hash(token));
    },
    customerSave(token, input) {
      const v = this.viaLink(token);
      if (v.error) return v;
      const r = writeDetails(v.call.id, 'customer', input);
      if (r.ok) {
        changed({ type: 'call', id: v.call.id });
        tellHolder(v.call, `Customer sent details${PART_TYPES[input.type] ? ` (${PART_TYPES[input.type].label.toLowerCase()})` : ''}`);
      }
      return r;
    },
    customerPhoto(token, bytes) {
      const v = this.viaLink(token);
      if (v.error) return v;
      const r = writePhoto(v.call.id, 'customer', 'customer', bytes);
      if (r.ok) {
        changed({ type: 'call', id: v.call.id });
        // One nudge per burst of photos, not one per picture.
        const recent = db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE call_id = ? AND from_email = 'customer' AND created_at > ? AND message LIKE 'Customer sent a photo%'").get(v.call.id, now() - 120_000).n;
        if (!recent) tellHolder(v.call, 'Customer sent a photo');
      }
      return r;
    },

    /** Photos and links go when a call has been closed for a while. Returns how many photos. */
    purge(days) {
      const cutoff = now() - days * 86_400_000;
      const old = "SELECT id FROM calls WHERE status IN ('resolved', 'closed') AND updated_at < ?";
      const photos = db.prepare(`DELETE FROM call_photos WHERE call_id IN (${old})`).run(cutoff).changes;
      db.prepare('DELETE FROM call_links WHERE expires_at < ?').run(now() - 7 * 86_400_000);
      return photos;
    },
  };
}
