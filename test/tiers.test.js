import test from 'node:test';
import assert from 'node:assert/strict';
import { tierOf } from '../src/app/customers.js';
import { freshApp, ann, manager } from './helpers.js';

test('account types read from the words people use', () => {
  for (const [text, want] of [['Pro', 'pro'], ['professional', 'pro'], ['Commercial', 'pro'], ['Body shop', 'pro'], ['Fleet account', 'fleet'], ['FLEET', 'fleet'], ['Retail', 'retail'], ['walk-in', 'retail'], ['', null], ['VIP', null], [null, null]]) assert.equal(tierOf(text), want, String(text));
});

test('a customer is retail until someone says otherwise, and the type can be changed and filtered on', () => {
  const { app } = freshApp();
  const a = app.customers.create(ann, { name: 'Pat Walker', phones: [{ phone: '3015550101' }] });
  const b = app.customers.create(ann, { kind: 'organization', name: 'Hutton Auto', tier: 'pro', phones: [{ phone: '3015550102' }] });
  const c = app.customers.create(ann, { kind: 'organization', name: 'County Roads', tier: 'fleet', phones: [{ phone: '3015550103' }] });
  const d = app.customers.create(ann, { name: 'Odd', tier: 'platinum', phones: [] });
  assert.equal(app.customers.get(ann, a.id).customer.tier, 'retail');
  assert.equal(app.customers.get(ann, b.id).customer.tier, 'pro');
  assert.equal(app.customers.get(ann, d.id).customer.tier, 'retail', 'an unknown type is just retail');
  assert.deepEqual(app.customers.list(ann, { tier: 'pro' }).customers.map((x) => x.name), ['Hutton Auto']);
  assert.deepEqual(app.customers.list(ann, { tier: 'fleet' }).customers.map((x) => x.name), ['County Roads']);
  assert.equal(app.customers.list(ann, { tier: 'bogus' }).customers.length, 4, 'an unknown filter is no filter');
  assert.deepEqual(app.customers.list(ann, { q: 'o', tier: 'fleet' }).customers.map((x) => x.name), ['County Roads']);
  assert.ok(app.customers.update(ann, a.id, { name: 'Pat Walker', tier: 'pro', phones: [] }).ok);
  assert.equal(app.customers.get(ann, a.id).customer.tier, 'pro');
  assert.equal(c.ok, true);
});

test('importing can set the type, warns about a type it doesn’t know, and leaves it alone when there is none', () => {
  const { app } = freshApp();
  const text = 'ID,Name,Phone,Type\nA1,Hutton Auto,301-555-0101,Pro\nA2,County Roads,301-555-0102,Fleet account\nA3,Pat,301-555-0103,VIP\nA4,Sam,301-555-0104,\n';
  const plan = app.customers.importPlan(manager, text);
  assert.deepEqual(plan.rows.map((r) => r.tier), ['pro', 'fleet', null, null].map((t, i) => (i > 1 ? 'retail' : t)));
  assert.match(plan.rows[2].warnings[0], /not recognised/);
  app.customers.importApply(manager, text);
  assert.deepEqual(app.customers.list(manager, { tier: 'pro' }).customers.map((x) => x.name), ['Hutton Auto']);
  const next = app.customers.importPlan(manager, 'ID,Name,Phone,Type\nA3,Pat,301-555-0103,pro\nA1,Hutton Auto,301-555-0101,\n');
  assert.deepEqual(next.rows.map((r) => r.action), ['update', 'same']);
  assert.match(next.rows[0].changes[0], /type becomes pro/);
  app.customers.importApply(manager, 'ID,Name,Phone,Type\nA3,Pat,301-555-0103,pro\nA1,Hutton Auto,301-555-0101,\n');
  assert.equal(app.customers.list(manager, { tier: 'pro' }).customers.length, 2);
  const noType = 'ID,Name,Phone\nA1,Hutton Auto,301-555-0101\n';
  assert.equal(app.customers.importPlan(manager, noType).rows[0].action, 'same', 'no Type column means no change to type');
});
