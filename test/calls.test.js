import test from 'node:test';
import assert from 'node:assert/strict';
import { ann, bob, freshApp, manager } from './helpers.js';

test('a blank call is a valid call, and "6205-2RS" alone is too', () => {
  const { app } = freshApp();
  const blank = app.calls.create(ann);
  assert.equal(blank.ok, true);
  assert.equal(app.calls.get(ann, blank.id).title, 'New call');
  const bearing = app.calls.create(ann, { part_numbers: '6205-2RS' });
  assert.equal(app.calls.get(ann, bearing.id).title, '6205-2RS');
  const walkIn = app.calls.create(ann, { request: 'Need water pump', application: { year: '2008', make: 'Ford', model: 'F-150', engine: '5.4L' } });
  const got = app.calls.get(ann, walkIn.id);
  assert.equal(got.application, '2008 Ford F-150 5.4L');
  assert.equal(got.call.customer_id, null);
});

test('details arrive in any order and the customer can be attached later without a new call', () => {
  const { app } = freshApp();
  const { id } = app.calls.create(ann, { request: 'Hydraulic fitting, 3/4 hose' });
  app.calls.update(ann, id, { application: { freeform: 'Case 580 backhoe, thread unknown' } });
  const customer = app.customers.create(ann, { name: 'Hollow Creek Farms', kind: 'organization', phones: [{ phone: '3045550142' }] });
  assert.equal(app.calls.attachCustomer(ann, id, customer.id).ok, true);
  const got = app.calls.get(ann, id);
  assert.equal(got.customer.name, 'Hollow Creek Farms');
  assert.equal(got.call.request, 'Hydraulic fitting, 3/4 hose');
  assert.deepEqual(got.events.map((e) => e.type), ['created', 'application', 'customer-attached']);
  assert.equal(app.calls.attachCustomer(ann, id, null).ok, true);
  assert.equal(app.calls.get(ann, id).customer, null);
});

test('a bad quantity is refused and a coworker\'s newer save is never overwritten', () => {
  const { app } = freshApp();
  const { id, revision } = app.calls.create(ann, { request: 'brake pads' });
  assert.equal(app.calls.update(ann, id, { quantity: 'many' }).error, 'quantity');
  assert.equal(app.calls.update(ann, id, { quantity: '2' }, { revision }).ok, true);
  const stale = app.calls.update(bob, id, { request: 'rotors' }, { revision });
  assert.equal(stale.error, 'stale');
  assert.equal(app.calls.get(ann, id).call.request, 'brake pads');
});

test('exactly one person claims a call, and the other is told who has it', () => {
  const { app } = freshApp();
  const { id } = app.calls.create(ann, { request: 'alternator' });
  assert.equal(app.calls.claim(ann, id).ok, true);
  const lost = app.calls.claim(bob, id);
  assert.deepEqual([lost.error, lost.by], ['claimed', ann.email]);
  assert.equal(app.calls.get(bob, id).call.status, 'working');
});

test('park, resume, and hand a call back keeps status, owner and help separate', () => {
  const { app } = freshApp();
  const { id } = app.calls.create(ann, { request: 'water pump' });
  app.calls.claim(ann, id);
  assert.equal(app.calls.move(ann, id, 'parked').ok, true);
  let call = app.calls.get(ann, id).call;
  assert.deepEqual([call.status, call.assignee, call.help], ['parked', ann.email, 'normal']);
  app.calls.requestHelp(ann, id, bob.email);
  call = app.calls.get(ann, id).call;
  assert.deepEqual([call.help, call.help_from, call.status], ['specific', bob.email, 'parked']);
  assert.equal(app.calls.move(bob, id, 'working').error, 'claimed');
  assert.equal(app.calls.release(bob, id).error, 'forbidden');
  assert.equal(app.calls.release(ann, id).ok, true);
  assert.equal(app.calls.claim(bob, id).ok, true);
  assert.equal(app.calls.get(bob, id).call.help, 'normal');
});

test('closing needs an outcome, and the history stays in order', () => {
  const { app, tick } = freshApp();
  const { id } = app.calls.create(ann, { request: 'wiper blades' });
  app.calls.claim(ann, id);
  assert.equal(app.calls.move(ann, id, 'closed').error, 'needs-outcome');
  assert.equal(app.calls.finish(ann, id, { outcome: 'bogus' }).error, 'outcome');
  assert.equal(app.calls.finish(ann, id, { outcome: 'sold', price: '$24.50', reference: 'INV-9' }).ok, true);
  const got = app.calls.get(ann, id);
  assert.equal(got.call.status, 'closed');
  assert.equal(got.call.outcome_data.cents, 2450);
  assert.deepEqual(got.events.map((e) => e.type), ['created', 'claimed', 'outcome']);
  assert.equal(app.calls.update(ann, id, { request: 'x' }).error, 'closed');
  tick();
  assert.equal(app.calls.reopen(ann, id).ok, true);
  assert.equal(app.calls.get(ann, id).call.status, 'open');
});

test('the queue filters by view and searches phone, part number and customer', () => {
  const { app } = freshApp();
  const customer = app.customers.create(ann, { name: 'Dale Auto', phones: [{ phone: '(304) 555-0188' }] });
  const a = app.calls.create(ann, { request: 'starter' }, { customerId: customer.id });
  const b = app.calls.create(ann, { part_numbers: 'NAPA 7-4417' });
  app.calls.claim(ann, a.id);
  app.calls.requestHelp(ann, b.id);
  const ids = (view, q) => app.calls.queue(bob, { view, q }).calls.map((c) => c.id);
  assert.deepEqual(ids('active'), [a.id, b.id]);
  assert.deepEqual(ids('mine'), []);
  assert.deepEqual(ids('unassigned'), [b.id]);
  assert.deepEqual(ids('help'), [b.id]);
  assert.deepEqual(ids('active', 'dale'), [a.id]);
  assert.deepEqual(ids('active', '7-4417'), [b.id]);
  assert.deepEqual(app.calls.counts(bob), { ok: true, active: 2, unassigned: 1, mine: 0, help: 1, parked: 0 });
});

test('every change is on the timeline and in the audit trail with the person who made it', () => {
  const { app } = freshApp();
  const { id } = app.calls.create(ann, { request: 'belt' });
  app.calls.claim(ann, id);
  app.calls.assign(manager, id, bob.email);
  const trail = app.audit.about(`call:${id}`).map((e) => [e.action, e.actor]);
  assert.deepEqual(trail, [['call.assigned', manager.email], ['call.claimed', ann.email], ['call.created', ann.email]]);
  assert.equal(app.calls.assign(ann, id, bob.email).error, 'forbidden');
});

test('calls can list the items they are about', () => {
  const { app } = freshApp();
  const item = app.items.create(ann, { sku: 'ab-123', name: 'Oil filter', price: '8.99' });
  const { id } = app.calls.create(ann, { request: 'oil filter' });
  assert.equal(app.calls.addItem(ann, id, item.id, 2).ok, true);
  assert.equal(app.calls.addItem(ann, id, 999).error, 'item');
  assert.deepEqual(app.calls.get(ann, id).items.map((i) => [i.sku, i.quantity]), [['AB-123', 2]]);
  app.calls.removeItem(ann, id, item.id);
  assert.equal(app.calls.get(ann, id).items.length, 0);
});

test('someone with no role can do nothing', () => {
  const { app } = freshApp();
  const nobody = { email: 'x@example.com', roles: [] };
  assert.equal(app.calls.create(nobody).error, 'forbidden');
  assert.equal(app.calls.queue(nobody).error, 'forbidden');
  assert.equal(app.customers.search(nobody, 'a').error, 'forbidden');
});
