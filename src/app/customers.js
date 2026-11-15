// Customers: people and organisations the store knows. Looked up by phone, name or account number.
import { transaction } from '../infra/db.js';
import { can } from '../domain/permissions.js';
import { digitsOf, formatPhone, searchableDigits } from '../domain/phone.js';

const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const like = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createCustomers({ db, audit, now, changed }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });

  const phonesOf = db.prepare('SELECT id, label, ext, phone FROM customer_phones WHERE customer_id = ? ORDER BY id');
  const contactsOf = db.prepare('SELECT * FROM contacts WHERE customer_id = ? ORDER BY id');
  const openCalls = db.prepare("SELECT count(*) AS n FROM calls WHERE customer_id = ? AND status NOT IN ('resolved', 'closed')");
  const callsOf = db.prepare('SELECT id, request, part_numbers, status, outcome, created_at FROM calls WHERE customer_id = ? ORDER BY id DESC LIMIT 25');

  function cleanPhones(list) {
    const phones = [];
    for (const entry of Array.isArray(list) ? list : []) {
      const phone = formatPhone(clean(entry?.phone, 40));
      if (!phone) continue;
      if (digitsOf(phone).length < 7) return { error: 'phone' };
      phones.push({ phone, digits: digitsOf(phone), label: clean(entry.label, 30), ext: clean(entry.ext, 10) });
    }
    return { phones };
  }

  function cleanFields(input) {
    const name = clean(input.name, 160);
    if (!name) return { error: 'name' };
    const kind = input.kind === 'organization' ? 'organization' : 'person';
    const account_no = clean(input.account_no, 40) || null;
    const parsed = cleanPhones(input.phones);
    if (parsed.error) return parsed;
    return { name, kind, account_no, address: clean(input.address, 400), notes: clean(input.notes, 5000), phones: parsed.phones };
  }

  function writePhones(id, phones) {
    db.prepare('DELETE FROM customer_phones WHERE customer_id = ?').run(id);
    const insert = db.prepare('INSERT INTO customer_phones (customer_id, label, ext, phone, digits) VALUES (?, ?, ?, ?, ?)');
    for (const p of phones) insert.run(id, p.label, p.ext, p.phone, p.digits);
  }

  const taken = (account_no, except = 0) => account_no && db.prepare('SELECT id FROM customers WHERE account_no = ? AND id != ?').get(account_no, except);

  return {
    create(who, input) {
      const no = deny(who, 'customer.create');
      if (no) return no;
      const fields = cleanFields(input);
      if (fields.error) return fields;
      if (taken(fields.account_no)) return { error: 'account-taken' };
      const at = now();
      const id = transaction(db, () => {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO customers (kind, name, account_no, address, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(fields.kind, fields.name, fields.account_no, fields.address, fields.notes, who.email, at, at);
        writePhones(Number(lastInsertRowid), fields.phones);
        audit.record(who.email, 'customer.created', `customer:${lastInsertRowid}`, { name: fields.name });
        return Number(lastInsertRowid);
      });
      changed({ type: 'customer', id });
      return { ok: true, id };
    },

    update(who, id, input) {
      const no = deny(who, 'customer.edit');
      if (no) return no;
      if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) return { error: 'missing' };
      const fields = cleanFields(input);
      if (fields.error) return fields;
      if (taken(fields.account_no, id)) return { error: 'account-taken' };
      transaction(db, () => {
        db.prepare('UPDATE customers SET kind = ?, name = ?, account_no = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?')
          .run(fields.kind, fields.name, fields.account_no, fields.address, fields.notes, now(), id);
        writePhones(id, fields.phones);
        audit.record(who.email, 'customer.updated', `customer:${id}`, { name: fields.name });
      });
      changed({ type: 'customer', id });
      return { ok: true, id };
    },

    setStatus(who, id, status) {
      const no = deny(who, 'customer.deactivate');
      if (no) return no;
      if (!['active', 'inactive'].includes(status)) return { error: 'status' };
      const { changes } = db.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
      if (!changes) return { error: 'missing' };
      audit.record(who.email, `customer.${status === 'active' ? 'activated' : 'deactivated'}`, `customer:${id}`);
      return { ok: true };
    },

    addContact(who, id, input) {
      const no = deny(who, 'customer.edit');
      if (no) return no;
      const name = clean(input.name, 120);
      if (!name) return { error: 'name' };
      if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) return { error: 'missing' };
      transaction(db, () => {
        db.prepare('INSERT INTO contacts (customer_id, name, title, phone, ext, notes) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, name, clean(input.title, 80), formatPhone(clean(input.phone, 40)), clean(input.ext, 10), clean(input.notes, 500));
        audit.record(who.email, 'customer.contact-added', `customer:${id}`, { name });
      });
      return { ok: true };
    },

    get(who, id) {
      const no = deny(who, 'customer.view');
      if (no) return no;
      const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      if (!row) return { error: 'missing' };
      return { ok: true, customer: { ...row, phones: phonesOf.all(id), contacts: contactsOf.all(id), calls: callsOf.all(id) } };
    },

    /**
     * One lookup for what a caller gives: a phone number in any format (or its last digits), a
     * name, or an account number. Each match says how many calls it has open.
     */
    search(who, query, { limit = 8 } = {}) {
      const no = deny(who, 'customer.view');
      if (no) return no;
      const q = clean(query, 80);
      if (!q) return { ok: true, customers: [] };
      const rows = [];
      const seen = new Set();
      const add = (list) => list.forEach((row) => !seen.has(row.id) && seen.add(row.id) && rows.push(row));
      if (searchableDigits(q) && /^[\d\s()+.\-x]+$/i.test(q)) {
        add(db.prepare(`SELECT DISTINCT c.* FROM customers c JOIN customer_phones p ON p.customer_id = c.id
          WHERE p.digits LIKE ? ORDER BY c.name LIMIT ?`).all(`%${digitsOf(q)}%`, limit));
      }
      add(db.prepare(`SELECT * FROM customers WHERE name LIKE ? ESCAPE '\\' OR account_no LIKE ? ESCAPE '\\'
        OR id IN (SELECT customer_id FROM contacts WHERE name LIKE ? ESCAPE '\\')
        ORDER BY (status = 'active') DESC, name LIMIT ?`).all(like(q), like(q), like(q), limit));
      const customers = rows.slice(0, limit).map((row) => ({ ...row, phones: phonesOf.all(row.id), open_calls: openCalls.get(row.id).n }));
      return { ok: true, customers };
    },

    list(who, { q = '', limit = 50, offset = 0 } = {}) {
      const no = deny(who, 'customer.view');
      if (no) return no;
      if (clean(q, 80)) return this.search(who, q, { limit });
      const rows = db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?').all(limit, offset);
      return { ok: true, customers: rows.map((row) => ({ ...row, phones: phonesOf.all(row.id), open_calls: openCalls.get(row.id).n })) };
    },
  };
}
