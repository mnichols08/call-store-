import test from 'node:test';
import assert from 'node:assert/strict';
import { PART_TYPES, SERVICE_TYPES, readMeasurements, measureKey, describeMeasurements } from '../src/domain/measure.js';
import { freshApp, ann } from './helpers.js';

const getter = (obj) => (name) => obj[name] ?? '';

test('the specialty jobs are listed, and parts are not mixed in with them', () => {
  assert.deepEqual(SERVICE_TYPES().map((s) => s.key), ['hose-assembly', 'paint', 'battery', 'special-order']);
  assert.ok(!SERVICE_TYPES().some((s) => ['bearing', 'seal', 'other'].includes(s.key)));
});

test('choice fields keep only what the form offered', () => {
  const ok = readMeasurements('paint', 'mm', getter({ f_code: ' UA ', f_product: 'base coat', f_amount: 'Quart' }));
  assert.ok(ok.ok);
  assert.deepEqual(ok.values, { code: { text: 'UA' }, product: { text: 'Base coat' }, amount: { text: 'Quart' } });
  const odd = readMeasurements('paint', 'mm', getter({ f_product: '<script>alert(1)</script>', f_amount: 'A tanker' }));
  assert.deepEqual(odd.values, {}, 'unknown choices are dropped, not saved');
  assert.ok(odd.ok, 'and are not an error: staff can still see the rest');
});

test('a hose job takes lengths in either unit and text for the ends', () => {
  const r = readMeasurements('hose-assembly', 'in', getter({ f_job: 'Make a new assembly', f_id: '1/2', f_length: '36', f_endA: 'JIC -8 female swivel', f_pressure: '3000' }));
  assert.ok(r.ok);
  assert.equal(r.values.id.mm, 12.7);
  assert.equal(r.values.length.mm, 914.4);
  assert.equal(describeMeasurements('hose-assembly', 'in', r.values), 'Job Make a new assembly, Hose inside diameter 1/2 in, Finished length 36 in, End A JIC -8 female swivel, Pressure (psi) 3000');
  assert.equal(readMeasurements('hose-assembly', 'mm', getter({ f_length: '-3' })).ok, false);
});

test('jobs are never matched as parts, so they never reach the part finder or its AI', () => {
  for (const [key, spec] of Object.entries(PART_TYPES).filter(([, t]) => t.service)) {
    const full = Object.fromEntries(spec.fields.map((f) => [f.key, f.kind === 'choice' ? { text: f.options[0] } : f.kind === 'text' ? { text: '3' } : { text: '3', n: 3, mm: 3 }]));
    assert.equal(measureKey(key, full), null, key);
  }
  assert.ok(measureKey('bearing', { id: { text: '25', n: 25, mm: 25 }, od: { text: '52', n: 52, mm: 52 }, width: { text: '15', n: 15, mm: 15 } }), 'parts still make a key');
});

test('a customer’s request can say what kind of job it is, and staff see it', async () => {
  const s = freshApp({ ai: { enabled: false } });
  const cust = s.app.customers.create(ann, { kind: 'organization', name: 'Bubba Farms', phones: [{ phone: '5551230000' }] });
  const acct = s.db.prepare("INSERT INTO portal_accounts (customer_id, email, name, role, created_at) VALUES (?, 'pat@farm.com', 'Pat', 'admin', 1)").run(cust.id);
  const account = s.db.prepare('SELECT a.*, c.name AS business FROM portal_accounts a JOIN customers c ON c.id = a.customer_id WHERE a.id = ?').get(Number(acct.lastInsertRowid));
  const r = s.app.portal.createRequest(account, { request: 'New hose for the loader', service: 'hose-assembly', fulfilment: 'pickup' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.service, 'hose-assembly');
  assert.match(s.db.prepare('SELECT notes FROM calls WHERE id = ?').get(r.id).notes, /Kind of job: Hydraulic hose assembly\. Will pick up/);
  const plain = s.app.portal.createRequest(account, { request: 'Water pump', service: 'not-a-job' });
  assert.equal(plain.service, '', 'an unknown job type is ignored');
  assert.doesNotMatch(s.db.prepare('SELECT notes FROM calls WHERE id = ?').get(plain.id).notes, /Kind of job/);
  const saved = s.app.details.saveAsCustomer(r.id, { type: 'hose-assembly', unit: 'in', note: 'Bucket cylinder', get: getter({ f_job: 'Repair or re-crimp one', f_id: '3/8' }) });
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.match(s.app.details.get(ann, r.id).details.text, /Repair or re-crimp one/);
});
