import test from 'node:test';
import assert from 'node:assert/strict';
import assertStrict from 'node:assert/strict';
import { checkStore } from '../vendor/kit/store/index.js';
import { sqliteStore } from '../src/infra/documents-store.js';
import { migrate, openDatabase } from '../src/infra/db.js';
import { ann, freshApp, manager } from './helpers.js';

test('customers are found by phone in any format, by its last digits, by name, and by account', () => {
  const { app } = freshApp();
  const org = app.customers.create(ann, { name: 'Hollow Creek Farms', kind: 'organization', account_no: 'A-100', phones: [{ phone: '304-555-0142', label: 'office' }, { phone: '(304) 555-0199' }] });
  assert.equal(org.ok, true);
  app.customers.create(ann, { name: 'Dale Weaver', phones: [{ phone: '+1 304 555 0777' }] });
  const names = (q) => app.customers.search(ann, q).customers.map((c) => c.name);
  assert.deepEqual(names('3045550142'), ['Hollow Creek Farms']);
  assert.deepEqual(names('555-0142'), ['Hollow Creek Farms']);
  assert.deepEqual(names('0777'), ['Dale Weaver']);
  assert.deepEqual(names('hollow'), ['Hollow Creek Farms']);
  assert.deepEqual(names('A-100'), ['Hollow Creek Farms']);
  assert.deepEqual(names('nobody'), []);
  assert.equal(app.customers.get(ann, org.id).customer.phones.length, 2);
});

test('a bare number means that customer: the account number first, then the record, then the rest', () => {
  const { app } = freshApp();
  app.customers.create(ann, { name: 'Phone Has It', phones: [{ phone: '304-555-0965' }] }); // id 1
  app.customers.create(ann, { name: 'Named 965 Supply' }); // id 2
  const acct = app.customers.create(ann, { name: 'Ridge Garage', account_no: '965' }); // id 3
  const found = app.customers.search(ann, '965').customers;
  assert.deepEqual(found.map((c) => c.name), ['Ridge Garage', 'Named 965 Supply'], 'three digits are too few to be a phone');
  assert.equal(found[0].exact, true);
  assert.equal(found[1].exact, undefined);
  assert.equal(app.customers.search(ann, '#965').customers[0].id, acct.id);
  // No account 2, so the record with that id.
  const byId = app.customers.search(ann, '2').customers;
  assert.equal(byId[0].name, 'Named 965 Supply');
  assert.equal(byId[0].exact, true);
  // An account number beats a record id.
  app.customers.create(ann, { name: 'Account Two', account_no: '2' });
  assert.deepEqual(app.customers.search(ann, '2').customers.slice(0, 2).map((c) => c.name), ['Account Two', 'Named 965 Supply']);
  assert.equal(app.customers.search(ann, '5550965').customers[0].exact, undefined, 'a phone number is not a customer number');
});

test('customer checks: a name is needed, account numbers are unique, phones must be real', () => {
  const { app } = freshApp();
  assert.equal(app.customers.create(ann, { name: ' ' }).error, 'name');
  assert.equal(app.customers.create(ann, { name: 'A', phones: [{ phone: '12' }] }).error, 'phone');
  app.customers.create(ann, { name: 'A', account_no: 'X1' });
  assert.equal(app.customers.create(ann, { name: 'B', account_no: 'X1' }).error, 'account-taken');
  assert.equal(app.customers.setStatus(ann, 1, 'inactive').error, 'forbidden');
  assert.equal(app.customers.setStatus(manager, 1, 'inactive').ok, true);
});

test('items: anyone adds, only a manager changes, SKUs are unique ignoring case, prices are money', () => {
  const { app } = freshApp();
  const made = app.items.create(ann, { sku: 'wp-5.4', name: 'Water pump', brand: 'Gates', price: '$1,024.5' });
  assert.equal(made.ok, true);
  assert.equal(app.items.get(ann, made.id).item.cents, 102450);
  assert.equal(app.items.create(ann, { sku: 'WP-5.4', name: 'Dup' }).error, 'sku-taken');
  assert.equal(app.items.create(ann, { sku: 'X', name: 'Bad', price: '12.345' }).error, 'price');
  assert.equal(app.items.create(ann, { sku: 'Y', name: 'No price' }).ok, true);
  assert.equal(app.items.update(ann, made.id, { sku: 'WP', name: 'x' }).error, 'forbidden');
  assert.equal(app.items.update(manager, made.id, { sku: 'WP-5.4', name: 'Water pump 5.4L', brand: 'Gates', price: '99' }).ok, true);
  assert.deepEqual(app.items.list(ann, { q: 'gates' }).items.map((i) => i.name), ['Water pump 5.4L']);
  app.items.setActive(manager, made.id, false);
  assert.deepEqual(app.items.list(ann).items.map((i) => i.sku), ['Y']);
  assert.equal(app.items.list(ann, { includeRetired: true }).items.length, 2);
});

test('a search with % or _ in it is text, not a wildcard', () => {
  const { app } = freshApp();
  app.items.create(ann, { sku: 'A1', name: 'Plain' });
  assert.deepEqual(app.items.list(ann, { q: '%' }).items, []);
});

test('the kit store contract holds for the SQLite store', async () => {
  const db = openDatabase(':memory:');
  migrate(db);
  await checkStore(sqliteStore(db), assertStrict);
  assert.ok(test);
});
