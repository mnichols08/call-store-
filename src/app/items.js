// Items: the parts and products the counter talks about. Anyone on staff can add one while on a
// call; changing or retiring one is a manager's job.
import { transaction } from '../infra/db.js';
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';

const clean = (value, max) => clip(String(value ?? '').trim(), max);
const like = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** "12.50" or "$1,200" to whole cents; '' for no price; undefined for nonsense. */
export function parsePrice(text) {
  const value = clean(text, 20).replace(/[$,\s]/g, '');
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  return Math.round(Number(value) * 100);
}

export function createItems({ db, audit, now, changed }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });

  function cleanFields(input) {
    const sku = clean(input.sku, 60).toUpperCase();
    const name = clean(input.name, 160);
    if (!sku) return { error: 'sku' };
    if (!name) return { error: 'name' };
    const cents = parsePrice(input.price);
    if (cents === undefined) return { error: 'price' };
    return { sku, name, cents, brand: clean(input.brand, 80), description: clean(input.description, 2000), unit: clean(input.unit, 20) || 'each' };
  }

  const skuTaken = (sku, except = 0) => db.prepare('SELECT id FROM items WHERE sku = ? COLLATE NOCASE AND id != ?').get(sku, except);

  return {
    create(who, input) {
      const no = deny(who, 'item.create');
      if (no) return no;
      const f = cleanFields(input);
      if (f.error) return f;
      if (skuTaken(f.sku)) return { error: 'sku-taken' };
      const at = now();
      const id = transaction(db, () => {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO items (sku, name, brand, description, unit, cents, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(f.sku, f.name, f.brand, f.description, f.unit, f.cents, who.email, at, at);
        audit.record(who.email, 'item.created', `item:${lastInsertRowid}`, { sku: f.sku, name: f.name });
        return Number(lastInsertRowid);
      });
      changed({ type: 'item', id });
      return { ok: true, id };
    },

    update(who, id, input) {
      const no = deny(who, 'item.edit');
      if (no) return no;
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(id)) return { error: 'missing' };
      const f = cleanFields(input);
      if (f.error) return f;
      if (skuTaken(f.sku, id)) return { error: 'sku-taken' };
      transaction(db, () => {
        db.prepare('UPDATE items SET sku = ?, name = ?, brand = ?, description = ?, unit = ?, cents = ?, updated_at = ? WHERE id = ?')
          .run(f.sku, f.name, f.brand, f.description, f.unit, f.cents, now(), id);
        audit.record(who.email, 'item.updated', `item:${id}`, { sku: f.sku });
      });
      changed({ type: 'item', id });
      return { ok: true, id };
    },

    setActive(who, id, active) {
      const no = deny(who, 'item.edit');
      if (no) return no;
      const { changes } = db.prepare('UPDATE items SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, now(), id);
      if (!changes) return { error: 'missing' };
      audit.record(who.email, active ? 'item.activated' : 'item.retired', `item:${id}`);
      return { ok: true };
    },

    get(who, id) {
      const no = deny(who, 'item.view');
      if (no) return no;
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (!item) return { error: 'missing' };
      const calls = db.prepare(`SELECT c.id, c.request, c.status, ci.quantity FROM call_items ci JOIN calls c ON c.id = ci.call_id
        WHERE ci.item_id = ? ORDER BY c.id DESC LIMIT 20`).all(id);
      return { ok: true, item, calls };
    },

    list(who, { q = '', includeRetired = false, limit = 100 } = {}) {
      const no = deny(who, 'item.view');
      if (no) return no;
      const text = clean(q, 80);
      const rows = db.prepare(`SELECT * FROM items WHERE (? = 1 OR active = 1)
        AND (? = '' OR sku LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\')
        ORDER BY name COLLATE NOCASE LIMIT ?`).all(includeRetired ? 1 : 0, text, like(text), like(text), like(text), limit);
      return { ok: true, items: rows };
    },
  };
}
