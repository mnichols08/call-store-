// Customers: people and organisations the store knows. Looked up by phone, name or account number.
import { transaction } from '../infra/db.js';
import { can } from '../domain/permissions.js';
import { digitsOf, formatPhone, searchableDigits } from '../domain/phone.js';
import { clip } from '../domain/text.js';
import { mapHeader, parseCsv } from '../domain/csv.js';

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_CHARS = 600_000;
// Names that read as a business, so a new import row starts out as one. It only guesses; the customer page can change it.
const BUSINESS = /\b(llc|inc|corp|corporation|co|company|farms?|enterprises?|construction|excavating|motors|garage|repair|services?|lumber|trucking|sons|supply|auto|body|collision|hardwoods|industries|contracting|logging)\b/i;

export const TIERS = Object.freeze(['retail', 'pro', 'fleet']);
/** "Pro", "Fleet account", "Commercial" and the like, as one of the three tiers; null when it says nothing usable. */
export function tierOf(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  if (/fleet/.test(t)) return 'fleet';
  if (/^(pro|professional|commercial|shop|contractor|wholesale|mechanic|body ?shop)\b/.test(t)) return 'pro';
  if (/^(retail|walk-?in|regular|customer|diy|personal)\b/.test(t)) return 'retail';
  return null;
}
const clean = (value, max) => clip(String(value ?? '').trim(), max);
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
    const tier = TIERS.includes(input.tier) ? input.tier : 'retail';
    const parsed = cleanPhones(input.phones);
    if (parsed.error) return parsed;
    return { name, kind, tier, account_no, address: clean(input.address, 400), notes: clean(input.notes, 5000), phones: parsed.phones };
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
          .prepare('INSERT INTO customers (kind, tier, name, account_no, address, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(fields.kind, fields.tier, fields.name, fields.account_no, fields.address, fields.notes, who.email, at, at);
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
        db.prepare('UPDATE customers SET kind = ?, tier = ?, name = ?, account_no = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?')
          .run(fields.kind, fields.tier, fields.name, fields.account_no, fields.address, fields.notes, now(), id);
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

    /**
     * Read a customer list (ID, Name, Phone, and optionally Address, Notes) and say what importing it
     * would do, changing nothing. Each row is `new`, `update` (same account number, or a customer with
     * the same name and phone that has no account number yet), `same` (nothing to change) or `skip`.
     */
    importPlan(who, text) {
      const no = deny(who, 'customer.import');
      if (no) return no;
      const source = String(text ?? '');
      if (!source.trim()) return { error: 'empty' };
      if (source.length > IMPORT_MAX_CHARS) return { error: 'too-big' };
      const table = parseCsv(source);
      const cols = table.length ? mapHeader(table[0]) : null;
      if (!cols) return { error: 'no-header' };
      const body = table.slice(1);
      if (body.length > IMPORT_MAX_ROWS) return { error: 'too-many' };

      const byAccount = new Map(db.prepare('SELECT id, name, account_no, tier FROM customers WHERE account_no IS NOT NULL').all().map((r) => [r.account_no.toLowerCase(), r]));
      const phoneOwners = new Map();
      for (const r of db.prepare('SELECT customer_id, digits FROM customer_phones').all()) {
        if (!phoneOwners.has(r.digits)) phoneOwners.set(r.digits, new Set());
        phoneOwners.get(r.digits).add(r.customer_id);
      }
      const names = new Map(db.prepare('SELECT id, name, account_no, tier FROM customers').all().map((r) => [r.id, r]));
      const seen = new Set();
      const fresh = new Map(); // new customers without an account number, so one person listed twice is made once
      const rows = body.map((cells, i) => {
        const at = (key) => (key in cols ? clean(cells[cols[key]], key === 'notes' ? 5000 : 400) : '');
        const name = clean(at('name'), 160);
        const account = clean(at('id'), 40);
        const written = at('tier');
        const row = { line: i + 2, name, account_no: account || null, phones: [], address: at('address'), notes: at('notes'), tier: tierOf(written), warnings: [] };
        if (written && !row.tier) row.warnings.push(`Type “${clean(written, 30)}” not recognised, left as retail`);
        if (!name) return { ...row, action: 'skip', why: 'No name' };
        const key = account.toLowerCase();
        if (account && seen.has(key)) return { ...row, action: 'skip', why: `Account ${account} appears earlier in the file` };
        if (account) seen.add(key);
        for (const piece of at('phone').split(/[;/|]|\s+or\s+/i)) {
          const phone = formatPhone(clean(piece, 40));
          if (!phone) continue;
          if (digitsOf(phone).length < 7) { row.warnings.push(`Phone “${clean(piece, 40)}” left out`); continue; }
          if (!row.phones.some((p) => p.digits === digitsOf(phone))) row.phones.push({ phone, digits: digitsOf(phone), label: '', ext: '' });
        }
        // Who is this already?
        let match = account ? byAccount.get(key) : null;
        if (!match) {
          const sharing = row.phones.flatMap((p) => [...(phoneOwners.get(p.digits) ?? [])]);
          const candidate = sharing.map((id) => names.get(id)).find((c) => c && c.name.toLowerCase() === name.toLowerCase() && (!account || !c.account_no));
          if (candidate) match = candidate;
        }
        if (!match) {
          const sig = row.phones.length && !account ? `${name.toLowerCase()}|${row.phones[0].digits}` : '';
          if (sig && fresh.has(sig)) return { ...row, action: 'skip', why: `Same as line ${fresh.get(sig)}` };
          if (sig) fresh.set(sig, row.line);
          return { ...row, action: 'new', tier: row.tier ?? 'retail', kind: BUSINESS.test(name) ? 'organization' : 'person' };
        }
        const have = new Set(phonesOf.all(match.id).map((p) => digitsOf(p.phone)));
        const addPhones = row.phones.filter((p) => !have.has(p.digits));
        const changes = [];
        if (match.name !== name) changes.push(`name “${match.name}” becomes “${name}”`);
        if (account && !match.account_no) changes.push(`account number ${account}`);
        if (row.tier && match.tier !== row.tier) changes.push(`type becomes ${row.tier}`);
        if (addPhones.length) changes.push(`adds ${addPhones.map((p) => p.phone).join(', ')}`);
        if (!changes.length) return { ...row, action: 'same', id: match.id };
        return { ...row, action: 'update', id: match.id, addPhones, changes };
      });
      const count = (action) => rows.filter((r) => r.action === action).length;
      return { ok: true, rows, counts: { new: count('new'), update: count('update'), same: count('same'), skip: count('skip') }, columns: Object.keys(cols) };
    },

    /** Do what the plan says, all or nothing. The plan is made again from the text, never taken from the browser. */
    importApply(who, text) {
      const plan = this.importPlan(who, text);
      if (plan.error) return plan;
      const at = now();
      transaction(db, () => {
        const insert = db.prepare('INSERT INTO customers (kind, tier, name, account_no, address, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const addPhone = db.prepare('INSERT INTO customer_phones (customer_id, label, ext, phone, digits) VALUES (?, ?, ?, ?, ?)');
        for (const r of plan.rows) {
          if (r.action === 'new') {
            const { lastInsertRowid } = insert.run(r.kind, r.tier, r.name, r.account_no, r.address, r.notes, who.email, at, at);
            for (const p of r.phones) addPhone.run(Number(lastInsertRowid), '', '', p.phone, p.digits);
          } else if (r.action === 'update') {
            db.prepare('UPDATE customers SET name = ?, account_no = COALESCE(account_no, ?), tier = COALESCE(?, tier), updated_at = ? WHERE id = ?').run(r.name, r.account_no, r.tier, at, r.id);
            for (const p of r.addPhones) addPhone.run(r.id, '', '', p.phone, p.digits);
          }
        }
        audit.record(who.email, 'customer.imported', 'customers', plan.counts);
      });
      changed({ type: 'customer' });
      return { ok: true, counts: plan.counts };
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

    list(who, { q = '', limit = 50, offset = 0, tier = '' } = {}) {
      const no = deny(who, 'customer.view');
      if (no) return no;
      const only = TIERS.includes(tier) ? tier : '';
      if (clean(q, 80)) {
        const found = this.search(who, q, { limit: only ? 200 : limit });
        return only ? { ...found, customers: found.customers.filter((c) => c.tier === only).slice(0, limit) } : found;
      }
      const rows = db.prepare("SELECT * FROM customers WHERE (? = '' OR tier = ?) ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?").all(only, only, limit, offset);
      return { ok: true, customers: rows.map((row) => ({ ...row, phones: phonesOf.all(row.id), open_calls: openCalls.get(row.id).n })) };
    },
  };
}
