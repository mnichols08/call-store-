import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, mapHeader, detectDelimiter } from '../src/domain/csv.js';
import { freshApp, ann, manager, owner } from './helpers.js';

test('the reader copes with tabs, commas, quotes, line breaks and a byte-order mark', () => {
  assert.equal(detectDelimiter('ID\tName\tPhone'), '\t');
  assert.equal(detectDelimiter('ID,Name,Phone'), ',');
  assert.deepEqual(parseCsv('ID\tName\tPhone\r\n1\tBubba Farms\t301-555-0101\r\n'), [['ID', 'Name', 'Phone'], ['1', 'Bubba Farms', '301-555-0101']]);
  assert.deepEqual(parseCsv('﻿a,b\n"x, y","say ""hi"""\n\n,\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b\n"line\nbreak",2'), [['a', 'b'], ['line\nbreak', '2']]);
  assert.deepEqual(parseCsv('a,b\r1,2\r3,4'), [['a', 'b'], ['1', '2'], ['3', '4']], 'old Mac line endings');
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(mapHeader(['ID', 'Name', 'Phone']), { id: 0, name: 1, phone: 2 });
  assert.deepEqual(mapHeader(['Account #', 'Customer Name', 'Telephone', 'Notes']), { id: 0, name: 1, phone: 2, notes: 3 });
  assert.equal(mapHeader(['Foo', 'Bar']), null);
});

const LIST = 'ID\tName\tPhone\nA100\tBubba Farms LLC\t301-555-0101\nA101\tJane Smith\t(304) 555-0142 / 301-555-0188\nA102\tNo Phone Pete\t\n\tWalk-in Wally\t3015550199\n';

test('looking a list over changes nothing and says what would happen', () => {
  const { app, db } = freshApp();
  const plan = app.customers.importPlan(manager, LIST);
  assert.deepEqual(plan.counts, { new: 4, update: 0, same: 0, skip: 0 });
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 0);
  assert.equal(plan.rows[0].kind, 'organization');
  assert.equal(plan.rows[1].kind, 'person');
  assert.deepEqual(plan.rows[1].phones.map((p) => p.phone), ['(304) 555-0142', '(301) 555-0188']);
  assert.equal(plan.rows[3].account_no, null);
});

test('importing creates customers with their account numbers and phones, found by search', () => {
  const { app, db } = freshApp();
  assert.deepEqual(app.customers.importApply(manager, LIST).counts, { new: 4, update: 0, same: 0, skip: 0 });
  const found = app.customers.search(manager, 'A101').customers;
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Jane Smith');
  assert.equal(app.customers.search(manager, '5550188').customers[0].name, 'Jane Smith');
  assert.equal(db.prepare("SELECT count(*) n FROM audit_events WHERE action = 'customer.imported'").get().n, 1);
});

test('importing again changes nothing; a changed name or new phone updates by account number', () => {
  const { app, db } = freshApp();
  app.customers.importApply(manager, LIST);
  assert.deepEqual(app.customers.importPlan(manager, LIST).counts, { new: 0, update: 0, same: 4, skip: 0 });
  const next = 'ID,Name,Phone\nA100,Bubba Farms Inc,301-555-0101\nA101,Jane Smith,301-555-0177\n';
  const plan = app.customers.importPlan(manager, next);
  assert.deepEqual(plan.counts, { new: 0, update: 2, same: 0, skip: 0 });
  assert.match(plan.rows[0].changes[0], /name “Bubba Farms LLC” becomes “Bubba Farms Inc”/);
  app.customers.importApply(manager, next);
  const jane = db.prepare("SELECT id FROM customers WHERE account_no = 'A101'").get().id;
  assert.equal(db.prepare('SELECT count(*) n FROM customer_phones WHERE customer_id = ?').get(jane).n, 3, 'phones are added, never taken away');
  assert.equal(db.prepare("SELECT count(*) n FROM customers").get().n, 4, 'no duplicates');
});

test('a customer already in the system without an account number gets it, not a twin', () => {
  const { app, db } = freshApp();
  app.customers.create(ann, { name: 'Jane Smith', phones: [{ phone: '304-555-0142' }] });
  const plan = app.customers.importPlan(manager, 'ID,Name,Phone\nA101,jane smith,(304) 555-0142\n');
  assert.equal(plan.rows[0].action, 'update');
  assert.match(plan.rows[0].changes.join(), /account number A101/);
  app.customers.importApply(manager, 'ID,Name,Phone\nA101,jane smith,(304) 555-0142\n');
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 1);
  assert.equal(db.prepare('SELECT account_no FROM customers').get().account_no, 'A101');
});

test('bad rows are skipped or trimmed with a reason, not the whole import', () => {
  const { app } = freshApp();
  const text = 'ID,Name,Phone\nA1,Good One,301-555-0101\nA1,Repeat Id,301-555-0102\nA2,,301-555-0103\nA3,Short Phone,12345\n,Twice Tom,301-555-0104\n,Twice Tom,3015550104\n';
  const plan = app.customers.importPlan(manager, text);
  assert.deepEqual(plan.rows.map((r) => r.action), ['new', 'skip', 'skip', 'new', 'new', 'skip']);
  assert.match(plan.rows[1].why, /appears earlier/);
  assert.equal(plan.rows[2].why, 'No name');
  assert.deepEqual(plan.rows[3].warnings.length, 1);
  assert.deepEqual(plan.rows[3].phones, []);
  assert.match(plan.rows[5].why, /Same as line 6/);
});

test('only managers import; empty, headerless and oversized lists are refused', () => {
  const { app, db } = freshApp();
  assert.equal(app.customers.importPlan(ann, LIST).error, 'forbidden');
  assert.equal(app.customers.importApply(ann, LIST).error, 'forbidden');
  assert.equal(app.customers.importPlan(owner, '   ').error, 'empty');
  assert.equal(app.customers.importPlan(manager, 'Foo,Bar\n1,2').error, 'no-header');
  assert.equal(app.customers.importPlan(manager, `ID,Name\n${'1,x\n'.repeat(5001)}`).error, 'too-many');
  assert.equal(app.customers.importPlan(manager, 'a'.repeat(600_001)).error, 'too-big');
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 0);
});

test('a list is applied whole or not at all', () => {
  const { app, db } = freshApp();
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON customer_phones WHEN NEW.digits = '3015550199' BEGIN SELECT RAISE(ABORT, 'boom'); END");
  assert.throws(() => app.customers.importApply(manager, LIST));
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 0);
});

test('hostile cells are kept as plain text and never run', () => {
  const { app, db } = freshApp();
  app.customers.importApply(manager, 'ID,Name,Phone\n=HYPERLINK("x"),<script>alert(1)</script>,3015550101\n');
  const row = db.prepare('SELECT name, account_no FROM customers').get();
  assert.equal(row.name, '<script>alert(1)</script>');
  assert.equal(row.account_no, '=HYPERLINK("x")');
});
