// Special orders from the counter notebook. A photo of a page is read by the AI, a person checks and
// fixes every line, and only then is anything saved. The photo is never kept.
import { transaction } from '../infra/db.js';
import { AiError, aiWords } from '../infra/ai.js';
import { can } from '../domain/permissions.js';
import { sniff, stripMetadata } from '../domain/image.js';
import { cleanDate, cleanSheet, SHEET_MAX_ROWS } from '../domain/orders.js';

export const SHEET_BYTES = 6 * 1024 * 1024;
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function createOrders({ db, audit, now, changed, ai, customers, log }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });

  /** Customers this written name could be: one clear match is chosen for the reviewer, several are offered. */
  function matches(who, name) {
    const text = clean(name, 80);
    if (text.length < 2) return [];
    const found = customers.search(who, text, { limit: 4 }).customers ?? [];
    return found.map((c) => ({ id: c.id, name: c.name, account_no: c.account_no }));
  }

  return {
    enabled: () => Boolean(ai.enabled && ai.readSheet),

    /** Read a photo. Nothing is saved. Returns the cleaned page and who each name might be. */
    async read(who, bytes) {
      const no = deny(who, 'order.scan');
      if (no) return no;
      if (!this.enabled()) return { error: 'off' };
      if (!Buffer.isBuffer(bytes) || !bytes.length) return { error: 'photo' };
      if (bytes.length > SHEET_BYTES) return { error: 'photo-big' };
      const mime = sniff(bytes);
      if (!mime) return { error: 'photo-type' };
      const image = stripMetadata(bytes, mime);
      if (!image) return { error: 'photo-bad' };
      let result;
      try {
        result = await ai.readSheet({ mime, bytes: image });
      } catch (error) {
        if (error instanceof AiError) return { error: `ai-${error.code}`, message: aiWords(error.code) };
        log?.warn('sheet read failed', { message: error?.message });
        return { error: 'ai-failed', message: aiWords('failed') };
      }
      const sheet = cleanSheet(result.reading);
      sheet.rows = sheet.rows.map((r) => ({ ...r, candidates: r.crossedOut ? [] : matches(who, r.customer) }));
      audit.record(who.email, 'orders.read', 'orders', { rows: sheet.rows.length, input: result.usage?.input ?? 0, output: result.usage?.output ?? 0 });
      return { ok: true, sheet };
    },

    /** Save the lines a person checked. A line already saved for the same day (same code, part and name) is skipped. */
    save(who, { date, rows }) {
      const no = deny(who, 'order.scan');
      if (no) return no;
      const day = cleanDate(date);
      if (!day) return { error: 'date' };
      if (!Array.isArray(rows) || !rows.length) return { error: 'empty' };
      if (rows.length > SHEET_MAX_ROWS) return { error: 'too-many' };
      const at = now();
      let saved = 0;
      let skipped = 0;
      transaction(db, () => {
        const exists = db.prepare('SELECT 1 FROM special_orders WHERE sheet_date = ? AND line_code = ? AND part_number = ? AND customer_text = ? COLLATE NOCASE');
        const insert = db.prepare('INSERT INTO special_orders (sheet_date, line_code, part_number, ordered_from, customer_text, customer_id, received, paid, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const r of rows) {
          const row = { code: clean(r.lineCode, 8).toUpperCase(), part: clean(r.partNumber, 30).toUpperCase(), from: clean(r.orderedFrom, 60), customer: clean(r.customer, 80) };
          if (!row.part && !row.customer) { skipped += 1; continue; }
          if (exists.get(day, row.code, row.part, row.customer)) { skipped += 1; continue; }
          const cid = Number(r.customerId);
          const known = Number.isInteger(cid) && cid > 0 && db.prepare('SELECT 1 FROM customers WHERE id = ?').get(cid) ? cid : null;
          insert.run(day, row.code, row.part, row.from, row.customer, known, r.received ? 1 : 0, r.paid ? 1 : 0, who.email, at, at);
          saved += 1;
        }
        audit.record(who.email, 'orders.saved', 'orders', { date: day, saved, skipped });
      });
      if (saved) changed({ type: 'orders' });
      return { ok: true, saved, skipped };
    },

    /** Orders newest page first; optionally only open ones (not received yet) or ones matching text. */
    list(who, { q = '', open = false, limit = 200 } = {}) {
      const no = deny(who, 'order.view');
      if (no) return no;
      const text = clean(q, 60).replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = db.prepare(`SELECT o.*, c.name AS customer_name FROM special_orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE (? = 0 OR o.received = 0)
          AND (? = '' OR o.part_number LIKE ? ESCAPE '\\' OR o.customer_text LIKE ? ESCAPE '\\' OR o.ordered_from LIKE ? ESCAPE '\\' OR o.line_code LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')
        ORDER BY o.sheet_date DESC, o.id LIMIT ?`).all(open ? 1 : 0, text, `%${text}%`, `%${text}%`, `%${text}%`, `%${text}%`, `%${text}%`, limit);
      return { ok: true, orders: rows };
    },

    mark(who, id, { received, paid }) {
      const no = deny(who, 'order.edit');
      if (no) return no;
      const row = db.prepare('SELECT * FROM special_orders WHERE id = ?').get(id);
      if (!row) return { error: 'missing' };
      db.prepare('UPDATE special_orders SET received = ?, paid = ?, updated_at = ? WHERE id = ?').run(received === undefined ? row.received : received ? 1 : 0, paid === undefined ? row.paid : paid ? 1 : 0, now(), id);
      audit.record(who.email, 'order.marked', `order:${id}`, { received, paid });
      changed({ type: 'orders' });
      return { ok: true };
    },

    remove(who, id) {
      const no = deny(who, 'order.scan');
      if (no) return no;
      const { changes } = db.prepare('DELETE FROM special_orders WHERE id = ?').run(id);
      if (!changes) return { error: 'missing' };
      audit.record(who.email, 'order.removed', `order:${id}`, {});
      changed({ type: 'orders' });
      return { ok: true };
    },
  };
}
