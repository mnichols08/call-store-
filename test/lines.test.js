import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, ann, bob } from './helpers.js';
import { MAX_LINES } from '../src/app/lines.js';

const texts = (r) => r.lines.map((l) => `${l.part || '(vehicle)'}|${[l.vehicle.year, l.vehicle.make, l.vehicle.model, l.vehicle.engine].filter(Boolean).join(' ')}`);

test('lines build up under one vehicle until a new one is typed', () => {
  const { app } = freshApp();
  const id = app.calls.create(ann).id;
  assert.equal(app.lines.add(ann, id, '90 eclipse front brakes').ok, true);
  app.lines.add(ann, id, 'rear brakes');
  app.lines.add(ann, id, 'wheel bearing x2');
  const r = app.lines.add(ann, id, '07 cherokee 4.0');
  assert.equal(r.lines.at(-1).kind, 'vehicle');
  app.lines.add(ann, id, 'front shocks');
  const last = app.lines.add(ann, id, 'sway bar links');
  assert.deepEqual(texts(last), [
    'Front brakes|1990 Mitsubishi Eclipse', 'Rear brakes|1990 Mitsubishi Eclipse', 'Wheel bearing|1990 Mitsubishi Eclipse',
    '(vehicle)|2007 Jeep Cherokee 4.0L', 'Front shocks|2007 Jeep Cherokee 4.0L', 'Sway bar links|2007 Jeep Cherokee 4.0L',
  ]);
  assert.equal(last.lines[2].qty, 2);
});

test('the call itself follows: its vehicle, its title in the queue, and search', () => {
  const { app, events } = freshApp();
  const id = app.calls.create(ann).id;
  const first = app.lines.add(ann, id, 'front struts for 2000 tacoma');
  assert.deepEqual(first.application, { year: '2000', make: 'Toyota', model: 'Tacoma' });
  app.lines.add(ann, id, 'rear shocks');
  app.lines.add(ann, id, 'oil filter');
  const got = app.calls.get(ann, id);
  assert.equal(got.title, 'Front struts, Rear shocks +1 more');
  assert.equal(got.application, '2000 Toyota Tacoma');
  assert.equal(app.calls.queue(ann, { q: 'oil filter' }).calls.length, 0, 'the title shows the first two; search covers the summary');
  assert.equal(app.calls.queue(ann, { q: 'rear shocks' }).calls.length, 1);
  assert.ok(events.some((e) => e.type === 'call' && e.id === id && e.why === 'lines' && e.by === ann.email));
  assert.ok(got.events.some((e) => e.type === 'line-added'));
  assert.ok(got.call.revision > 1, 'the revision moved, so a form open on the page must take the new one');
  assert.equal(first.revision < app.lines.list(ann, id).revision, true);
});

test('a title typed by hand is never overwritten, and a VIN or unit number stays when the vehicle changes', () => {
  const { app } = freshApp();
  const id = app.calls.create(ann, { request: 'Need it by noon', application: { vin: '1HGCM82633A004352', unit: 'Truck 4' } }).id;
  app.lines.add(ann, id, '2008 f150 5.4 water pump');
  const got = app.calls.get(ann, id);
  assert.equal(got.title, 'Need it by noon');
  assert.equal(got.call.application.vin, '1HGCM82633A004352');
  assert.equal(got.call.application.unit, 'Truck 4');
  assert.equal(got.call.application.model, 'F-150');
});

test('the first line starts from the vehicle the call already has', () => {
  const { app } = freshApp();
  const id = app.calls.create(ann, { application: { year: '2015', make: 'Honda', model: 'Civic' } }).id;
  const r = app.lines.add(ann, id, 'front brake pads');
  assert.equal(r.lines[0].vehicle.model, 'Civic');
});

test('fixing or removing a line reads the ones after it again', () => {
  const { app } = freshApp();
  const id = app.calls.create(ann).id;
  const a = app.lines.add(ann, id, '90 eclipse front brakes');
  app.lines.add(ann, id, 'rear brakes');
  const fixed = app.lines.edit(ann, id, a.id, '95 eclipse front brakes');
  assert.deepEqual(texts(fixed), ['Front brakes|1995 Mitsubishi Eclipse', 'Rear brakes|1995 Mitsubishi Eclipse']);
  const gone = app.lines.remove(ann, id, a.id);
  assert.deepEqual(texts(gone), ['Rear brakes|'], 'with the vehicle line gone, the rest has no vehicle');
  assert.equal(app.calls.get(ann, id).call.application.model, undefined);
  assert.equal(app.lines.done(ann, id, gone.lines[0].id, true).lines[0].done, true);
  assert.equal(app.lines.done(ann, id, gone.lines[0].id, false).lines[0].done, false);
});

test('empty lines, missing things, closed calls, and the line limit', () => {
  const { app } = freshApp();
  const id = app.calls.create(ann).id;
  assert.equal(app.lines.add(ann, id, '   ').error, 'empty');
  assert.equal(app.lines.add(ann, id, 'for the').error, 'empty');
  assert.equal(app.lines.add(ann, 9999, 'oil filter').error, 'missing');
  assert.equal(app.lines.edit(ann, id, 9999, 'oil filter').error, 'missing');
  assert.equal(app.lines.remove(ann, id, 9999).error, 'missing');
  for (let i = 0; i < MAX_LINES; i += 1) assert.equal(app.lines.add(ann, id, `oil filter ${i}`).ok, true);
  assert.equal(app.lines.add(ann, id, 'one more').error, 'too-many');
  const other = app.calls.create(bob).id;
  app.calls.claim(bob, other);
  app.calls.finish(bob, other, { outcome: 'sold' }, 'closed');
  assert.equal(app.lines.add(bob, other, 'oil filter').error, 'closed');
  assert.equal(app.lines.add({ email: 'x@example.com', roles: [] }, id, 'oil filter').error, 'forbidden');
  assert.equal(app.lines.list({ email: 'x@example.com', roles: [] }, id).error, 'forbidden');
});
