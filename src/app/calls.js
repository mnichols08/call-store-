// Calls: take one down, add to it in any order, share it, finish it with an outcome.
//
// Every change below checks the permission, checks the call's revision where a person's edit
// could collide with a coworker's, and records a timeline event (and an audit entry) in the same
// transaction as the change.
import { transaction } from '../infra/db.js';
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';
import { canMove, cleanCallFields, cleanOutcome, summarize } from '../domain/call.js';

const like = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createCalls({ db, audit, now, changed }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const row = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  const inflate = (r) => (r ? { ...r, application: JSON.parse(r.application), outcome_data: JSON.parse(r.outcome_data) } : null);

  /** Record on the timeline and in the audit trail. Callers run this inside their transaction. */
  function log(id, who, type, data = {}) {
    db.prepare('INSERT INTO call_events (call_id, at, actor, type, data) VALUES (?, ?, ?, ?, ?)').run(id, now(), who.email, type, JSON.stringify(data));
    audit.record(who.email, `call.${type}`, `call:${id}`, data);
  }

  /** Apply a change to a call, bump its revision, and tell the page's other viewers. */
  function change(id, who, set, type, data) {
    const keys = Object.keys(set);
    const values = keys.map((k) => (typeof set[k] === 'object' && set[k] !== null ? JSON.stringify(set[k]) : set[k]));
    db.prepare(`UPDATE calls SET ${keys.map((k) => `${k} = ?`).join(', ')}${keys.length ? ', ' : ''}revision = revision + 1, updated_at = ? WHERE id = ?`).run(...values, now(), id);
    if (type) log(id, who, type, data);
  }

  const done = (id, extra = {}) => {
    changed({ type: 'call', id });
    return { ok: true, id, revision: row(id).revision, ...extra };
  };

  return {
    /** Start a call. It needs nothing: a blank call is a call. */
    create(who, input = {}, { customerId = null } = {}) {
      const no = deny(who, 'call.create');
      if (no) return no;
      const fields = cleanCallFields(input);
      if (fields.error) return fields;
      if (customerId && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) return { error: 'customer' };
      const at = now();
      const id = transaction(db, () => {
        const { lastInsertRowid } = db.prepare(`INSERT INTO calls (customer_id, caller_name, caller_phone, request, quantity, part_numbers, application, notes, priority,
          created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          customerId, fields.caller_name ?? '', fields.caller_phone ?? '', fields.request ?? '', fields.quantity ?? null, fields.part_numbers ?? '',
          JSON.stringify(fields.application ?? {}), fields.notes ?? '', fields.priority ?? 'normal', who.email, at, at);
        log(Number(lastInsertRowid), who, 'created', customerId ? { customer: customerId } : {});
        return Number(lastInsertRowid);
      });
      return done(id);
    },

    get(who, id) {
      const no = deny(who, 'call.view');
      if (no) return no;
      const call = inflate(row(id));
      if (!call) return { error: 'missing' };
      const customer = call.customer_id ? db.prepare('SELECT id, kind, tier, name, account_no, status FROM customers WHERE id = ?').get(call.customer_id) : null;
      const phones = customer ? db.prepare('SELECT phone, label, ext FROM customer_phones WHERE customer_id = ? ORDER BY id').all(customer.id) : [];
      const items = db.prepare(`SELECT i.id, i.sku, i.name, i.brand, i.cents, i.unit, ci.quantity FROM call_items ci JOIN items i ON i.id = ci.item_id
        WHERE ci.call_id = ? ORDER BY i.name`).all(id);
      const events = db.prepare('SELECT * FROM call_events WHERE call_id = ? ORDER BY id').all(id).map((e) => ({ ...e, data: JSON.parse(e.data) }));
      const earlier = customer
        ? db.prepare("SELECT id, request, part_numbers, status, outcome FROM calls WHERE customer_id = ? AND id != ? ORDER BY id DESC LIMIT 5").all(customer.id, id)
        : [];
      return { ok: true, call, customer: customer && { ...customer, phones }, items, events, earlier, ...summarize(call) };
    },

    /**
     * Save what the person typed. `revision` is the one they started from: if a coworker saved
     * since, nothing is overwritten and the answer says so (`stale`), with the call as it is now.
     */
    update(who, id, input, { revision } = {}) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const current = inflate(row(id));
      if (!current) return { error: 'missing' };
      if (current.status === 'closed') return { error: 'closed' };
      if (revision !== undefined && Number(revision) !== current.revision) return { error: 'stale', revision: current.revision };
      const fields = cleanCallFields(input);
      if (fields.error) return fields;
      return transaction(db, () => {
        const changedApplication = 'application' in fields && JSON.stringify(fields.application) !== JSON.stringify(current.application);
        if (!Object.keys(fields).length) return done(id);
        change(id, who, fields, changedApplication ? 'application' : null, changedApplication ? { application: fields.application } : {});
        return done(id);
      });
    },

    /** Attach (or, with null, detach) the customer. The call stays the same call. */
    attachCustomer(who, id, customerId) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (current.status === 'closed') return { error: 'closed' };
      let customer = null;
      if (customerId !== null) {
        customer = db.prepare('SELECT id, name FROM customers WHERE id = ?').get(customerId);
        if (!customer) return { error: 'customer' };
      }
      return transaction(db, () => {
        change(id, who, { customer_id: customerId }, customerId ? 'customer-attached' : 'customer-detached', customer ? { customer: customer.id, name: customer.name } : {});
        return done(id);
      });
    },

    /** Take a call that nobody has. Exactly one person wins: the rest are told who did. */
    claim(who, id) {
      const no = deny(who, 'call.claim');
      if (no) return no;
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (['resolved', 'closed'].includes(current.status)) return { error: 'wrong-status', status: current.status };
      return transaction(db, () => {
        const { changes } = db.prepare(`UPDATE calls SET assignee = ?, status = 'working', help = 'normal', help_from = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ? AND (assignee IS NULL OR assignee = ?)`).run(who.email, now(), id, who.email);
        if (!changes) return { error: 'claimed', by: row(id).assignee };
        log(id, who, 'claimed');
        return done(id);
      });
    },

    /** Give a call back to the queue. Its owner can; so can a manager. */
    release(who, id) {
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (!(current.assignee === who.email ? can(who, 'call.release') : can(who, 'call.assign'))) return { error: 'forbidden' };
      if (!current.assignee) return { error: 'unassigned' };
      return transaction(db, () => {
        change(id, who, { assignee: null, status: current.status === 'working' ? 'open' : current.status }, 'released', { from: current.assignee });
        return done(id);
      });
    },

    /** A manager hands a call to someone. */
    assign(who, id, to) {
      const no = deny(who, 'call.assign');
      if (no) return no;
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (['resolved', 'closed'].includes(current.status)) return { error: 'wrong-status', status: current.status };
      return transaction(db, () => {
        change(id, who, { assignee: to || null, help: 'normal', help_from: null }, 'assigned', { to: to || null, from: current.assignee });
        return done(id);
      });
    },

    /** Park it, resume it, resolve it: any move the lifecycle allows. */
    move(who, id, to) {
      const no = deny(who, 'call.move');
      if (no) return no;
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (['closed', 'resolved'].includes(to)) return { error: 'needs-outcome' };
      if (!canMove(current.status, to)) return { error: 'wrong-status', status: current.status };
      if (to === 'working' && current.assignee && current.assignee !== who.email && !can(who, 'call.assign')) return { error: 'claimed', by: current.assignee };
      return transaction(db, () => {
        const set = { status: to };
        if (to === 'working' && !current.assignee) set.assignee = who.email;
        change(id, who, set, to === 'parked' ? 'parked' : to === 'working' ? 'resumed' : 'status', { from: current.status, to });
        return done(id);
      });
    },

    /** Ask for a hand: from anyone, or from one person. */
    requestHelp(who, id, from = '') {
      const no = deny(who, 'call.help');
      if (no) return no;
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (['resolved', 'closed'].includes(current.status)) return { error: 'wrong-status', status: current.status };
      return transaction(db, () => {
        change(id, who, { help: from ? 'specific' : 'anyone', help_from: from || null }, 'help-requested', from ? { from } : {});
        return done(id);
      });
    },

    clearHelp(who, id) {
      const no = deny(who, 'call.help');
      if (no) return no;
      if (!row(id)) return { error: 'missing' };
      return transaction(db, () => {
        change(id, who, { help: 'normal', help_from: null }, 'help-cleared');
        return done(id);
      });
    },

    /** Finish a call with what came of it. `to` is 'resolved' or 'closed'. */
    finish(who, id, input, to = 'closed') {
      const no = deny(who, 'call.close');
      if (no) return no;
      if (!['resolved', 'closed'].includes(to)) return { error: 'wrong-status' };
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (!canMove(current.status, to)) return { error: 'wrong-status', status: current.status };
      const result = cleanOutcome(input);
      if (result.error) return result;
      return transaction(db, () => {
        change(id, who, { status: to, outcome: result.outcome, outcome_data: result.data, help: 'normal', help_from: null, closed_at: now() }, 'outcome', { outcome: result.outcome, to, ...result.data });
        return done(id);
      });
    },

    reopen(who, id) {
      const no = deny(who, 'call.reopen');
      if (no) return no;
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (!['resolved', 'closed'].includes(current.status)) return { error: 'wrong-status', status: current.status };
      return transaction(db, () => {
        change(id, who, { status: 'open', closed_at: null }, 'reopened', { from: current.status });
        return done(id);
      });
    },

    addItem(who, id, itemId, quantity = 1) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return { error: 'quantity' };
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (current.status === 'closed') return { error: 'closed' };
      const item = db.prepare('SELECT id, sku FROM items WHERE id = ?').get(itemId);
      if (!item) return { error: 'item' };
      return transaction(db, () => {
        db.prepare(`INSERT INTO call_items (call_id, item_id, quantity) VALUES (?, ?, ?)
          ON CONFLICT (call_id, item_id) DO UPDATE SET quantity = excluded.quantity`).run(id, itemId, qty);
        change(id, who, {}, 'item-added', { item: item.id, sku: item.sku, quantity: qty });
        return done(id);
      });
    },

    removeItem(who, id, itemId) {
      const no = deny(who, 'call.edit');
      if (no) return no;
      const current = row(id);
      if (!current) return { error: 'missing' };
      if (current.status === 'closed') return { error: 'closed' };
      return transaction(db, () => {
        const { changes } = db.prepare('DELETE FROM call_items WHERE call_id = ? AND item_id = ?').run(id, itemId);
        if (changes) change(id, who, {}, 'item-removed', { item: itemId });
        return done(id);
      });
    },

    /**
     * The shared queue. Views: `active` (not finished), `mine`, `unassigned`, `help`, `parked`, `done`.
     * `q` searches the request, part numbers, caller, customer name and phone digits.
     */
    queue(who, { view = 'active', q = '', limit = 100 } = {}) {
      const no = deny(who, 'call.view');
      if (no) return no;
      const where = {
        active: "c.status NOT IN ('resolved', 'closed')",
        mine: "c.assignee = :me AND c.status NOT IN ('resolved', 'closed')",
        unassigned: "c.assignee IS NULL AND c.status NOT IN ('resolved', 'closed')",
        help: "c.help != 'normal' AND c.status NOT IN ('resolved', 'closed')",
        parked: "c.status = 'parked'",
        done: "c.status IN ('resolved', 'closed')",
      }[view] ?? "c.status NOT IN ('resolved', 'closed')";
      const text = clip(String(q ?? '').trim(), 80);
      const params = { me: who.email, q: like(text), none: text === '' ? 1 : 0, limit };
      const rows = db.prepare(`SELECT c.*, cu.name AS customer_name FROM calls c LEFT JOIN customers cu ON cu.id = c.customer_id
        WHERE ${where} AND :me IS NOT NULL AND (:none = 1 OR c.request LIKE :q ESCAPE '\\' OR c.part_numbers LIKE :q ESCAPE '\\' OR c.caller_name LIKE :q ESCAPE '\\'
          OR c.caller_phone LIKE :q ESCAPE '\\' OR cu.name LIKE :q ESCAPE '\\' OR c.notes LIKE :q ESCAPE '\\')
        ORDER BY CASE c.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, ${view === 'done' ? 'c.closed_at DESC' : 'c.created_at ASC'} LIMIT :limit`).all(params);
      return { ok: true, calls: rows.map((r) => ({ ...inflate(r), ...summarize(inflate(r)) })) };
    },

    /** Numbers for the dashboard. */
    counts(who) {
      const no = deny(who, 'call.view');
      if (no) return no;
      const one = (sql, ...args) => db.prepare(sql).get(...args).n;
      return {
        ok: true,
        active: one("SELECT count(*) AS n FROM calls WHERE status NOT IN ('resolved', 'closed')"),
        unassigned: one("SELECT count(*) AS n FROM calls WHERE assignee IS NULL AND status NOT IN ('resolved', 'closed')"),
        mine: one("SELECT count(*) AS n FROM calls WHERE assignee = ? AND status NOT IN ('resolved', 'closed')", who.email),
        help: one("SELECT count(*) AS n FROM calls WHERE help != 'normal' AND status NOT IN ('resolved', 'closed')"),
        parked: one("SELECT count(*) AS n FROM calls WHERE status = 'parked'"),
      };
    },

    /** Finished calls in a range, for reports. */
    finished(who, { from, to }) {
      const no = deny(who, 'report.view');
      if (no) return no;
      const rows = db.prepare('SELECT id, created_at, closed_at, outcome, outcome_data, assignee FROM calls WHERE created_at BETWEEN ? AND ?').all(from, to);
      return { ok: true, calls: rows.map((r) => ({ ...r, outcome_data: JSON.parse(r.outcome_data) })) };
    },
  };
}
