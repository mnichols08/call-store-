import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryTowns, inArea, cleanDelivery, NEXT } from '../src/domain/delivery.js';
import { freshApp, ann, manager, owner } from './helpers.js';

test('the delivery towns come from the shop’s service areas', () => {
  const towns = deliveryTowns();
  assert.ok(towns.some((t) => t.value === 'Oakland, MD'));
  assert.ok(towns.some((t) => t.value === 'Terra Alta, WV'));
  assert.equal(towns.length, 7 + 7);
  assert.equal(inArea('oakland'), true);
  assert.equal(inArea('Oakland, MD'), true);
  assert.equal(inArea('Mt. Lake Park'), true, 'Mt. and Mountain are the same place');
  assert.equal(inArea('Baltimore'), false);
  assert.equal(inArea(''), false);
});

test('a delivery needs an address; a town outside the area is flagged, never refused', () => {
  assert.equal(cleanDelivery({ town: 'Oakland, MD' }).error, 'address');
  assert.equal(cleanDelivery({ town: 'Oakland, MD', address: '   ' }).error, 'address');
  assert.deepEqual(cleanDelivery({ town: 'Oakland, MD', address: ' 12 Main St ', note: 'Back door' }), { ok: true, town: 'Oakland, MD', address: '12 Main St', note: 'Back door', outside: false });
  assert.equal(cleanDelivery({ town: 'Frederick, MD', address: '1 A St' }).outside, true);
  assert.equal(cleanDelivery({ address: '1 A St' }).outside, true, 'no town given: someone should check');
  assert.doesNotMatch(JSON.stringify(cleanDelivery({ address: '<b>1</b> A St', note: '<script>' })), /[<>]/);
  assert.deepEqual(NEXT.delivered, []);
});

function setup() {
  const posted = [];
  const ctx = freshApp({ ai: { enabled: false }, mail: { live: true, send: async (m) => { posted.push(m); return { ok: true }; } } });
  const cust = ctx.app.customers.create(ann, { kind: 'organization', name: 'Bubba Farms', phones: [{ phone: '3015550101' }] });
  const call = ctx.app.calls.create(ann, { caller_name: 'Bubba', request: 'Hydraulic hose' }, { customerId: cust.id });
  return { ...ctx, posted, cust: cust.id, call: call.id };
}

test('staff add a delivery to a call, move it along, and can’t change it once delivered', async () => {
  const s = setup();
  const { app, call } = s;
  assert.equal(app.delivery.set(ann, 9999, { address: 'x' }).error, 'missing');
  const cash = app.calls.create(ann, { caller_name: 'Walk-in', request: 'Wiper blades' }).id;
  assert.equal(app.delivery.set(ann, cash, { town: 'Oakland, MD' }).error, 'address', 'a cash customer has to say where');
  const made = app.delivery.set(ann, call, { town: 'Oakland, MD', address: '12 Main St', note: 'Ask for Bubba' });
  assert.ok(made.ok);
  assert.equal(made.outside, false);
  assert.equal(app.delivery.get(ann, call).delivery.status, 'requested');
  assert.equal((await app.delivery.status(ann, call, 'delivered', {})).ok, true, 'a hand delivery can skip ahead');
  assert.equal(app.delivery.get(ann, call).delivery.status, 'delivered');
  assert.equal((await app.delivery.status(ann, call, 'out', {})).error, 'status', 'it can’t go back');
  assert.equal(app.delivery.set(ann, call, { address: 'elsewhere' }).error, 'delivered');
  assert.equal(app.delivery.remove(ann, call).error, 'delivered');
});

test('the list is by town, with a town outside the area last, and drops what arrived more than a day ago', async () => {
  const s = setup();
  const { app } = s;
  const make = (town, address) => { const c = app.calls.create(ann, { caller_name: town, request: 'part' }).id; app.delivery.set(ann, c, { town, address }); return c; };
  make('Terra Alta, WV', '1 A St');
  make('Oakland, MD', '2 B St');
  make('Frederick, MD', '3 C St');
  const done = make('Accident, MD', '4 D St');
  await app.delivery.status(ann, done, 'delivered', {});
  const { active, recent } = app.delivery.list(ann);
  assert.deepEqual(active.map((d) => d.town), ['Oakland, MD', 'Terra Alta, WV', 'Frederick, MD']);
  assert.deepEqual(recent.map((d) => d.town), ['Accident, MD']);
  s.tick(2 * 86_400_000);
  assert.equal(app.delivery.list(ann).recent.length, 0);
  assert.equal(app.delivery.list({ email: 'x@e.com', roles: [] }).error, 'forbidden');
  assert.equal(app.delivery.remove(ann, active[0].call_id).ok, true, 'it was only a mistake');
  assert.equal(app.delivery.list(ann).active.length, 2);
});

test('a web request for delivery needs an address and tells the customer when it goes out and arrives', async () => {
  const s = setup();
  const { app, db, posted } = s;
  const acct = Number(db.prepare("INSERT INTO portal_accounts (customer_id, email, name, role, notify, created_at) VALUES (?, 'pat@farm.com', 'Pat', 'admin', 1, 1)").run(s.cust).lastInsertRowid);
  const account = db.prepare('SELECT * FROM portal_accounts WHERE id = ?').get(acct);
  assert.equal(app.portal.createRequest(account, { request: 'Hose', fulfilment: 'deliver' }).error, 'address');
  assert.equal(app.portal.createRequest(account, { request: 'Hose', fulfilment: 'deliver', deliveryAddress: '   ' }).error, 'address');
  const pickup = app.portal.createRequest(account, { request: 'Hose', fulfilment: 'pickup', deliveryAddress: 'ignored' });
  assert.equal(app.delivery.get(ann, pickup.id).delivery, null, 'pickup makes no delivery');
  const r = app.portal.createRequest(account, { request: 'Hose', fulfilment: 'deliver', deliveryTown: 'Frederick, MD', deliveryAddress: '9 Far Rd', deliveryNote: 'Gate code 1234' });
  assert.ok(r.ok, JSON.stringify(r));
  const view = app.portal.request(account, r.id).request;
  assert.equal(view.delivery.outside, 1);
  assert.equal(view.delivery.status, 'requested');
  assert.ok((await app.delivery.status(manager, r.id, 'out', { origin: 'https://parts.example' })).ok);
  assert.equal(app.portal.request(account, r.id).request.label, 'On the way');
  assert.match(posted.at(-1).text, /On the way/);
  await app.delivery.status(manager, r.id, 'delivered', { origin: 'https://parts.example' });
  assert.equal(app.portal.request(account, r.id).request.label, 'All done');
  assert.equal(db.prepare('SELECT count(*) n FROM call_delivery').get().n, 1);
});

test('a phone call is delivered without any web updates', async () => {
  const s = setup();
  s.app.delivery.set(ann, s.call, { town: 'Oakland, MD', address: '1 A St' });
  assert.ok((await s.app.delivery.status(ann, s.call, 'out', {})).ok);
  assert.equal(s.db.prepare('SELECT count(*) n FROM portal_updates WHERE call_id = ?').get(s.call).n, 0);
  assert.equal((await s.app.delivery.status(ann, s.call, 'bogus', {})).error, 'status');
});

test('a customer on file is delivered to the address the shop knows; a cash customer is asked', () => {
  const { app, call, cust } = setup();
  assert.equal(cleanDelivery({}, undefined, { known: true }).ok, true);
  assert.equal(cleanDelivery({}, undefined, { known: '9 Farm Ln' }).address, '9 Farm Ln');
  assert.equal(cleanDelivery({ address: 'The barn' }, undefined, { known: '9 Farm Ln' }).address, 'The barn', 'what was typed wins');

  // On file with no address written down: nothing has to be typed, and it isn't flagged.
  const bare = app.delivery.set(ann, call, {});
  assert.equal(bare.ok, true);
  assert.equal(bare.outside, false);
  assert.equal(app.delivery.get(ann, call).delivery.address, '');

  // On file with an address: it is filled in.
  app.customers.update(ann, cust, { name: 'Bubba Farms', kind: 'organization', address: '9 Farm Ln, Oakland' });
  assert.equal(app.delivery.set(ann, call, { town: 'Oakland, MD' }).ok, true);
  assert.equal(app.delivery.get(ann, call).delivery.address, '9 Farm Ln, Oakland');
  assert.equal(app.delivery.list(ann).active[0].customer_address, '9 Farm Ln, Oakland');

  // Only an owner can turn it off; then everyone is asked.
  assert.equal(app.delivery.setKnown(manager, false).error, 'forbidden');
  assert.equal(app.delivery.setKnown(owner, false).ok, true);
  assert.equal(app.delivery.knownFor(call), false);
  assert.equal(app.delivery.set(ann, call, {}).error, 'address');
  assert.equal(app.delivery.setKnown(owner, true).ok, true);
  assert.equal(app.delivery.set(ann, call, {}).ok, true);
});
