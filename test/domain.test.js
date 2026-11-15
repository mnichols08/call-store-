import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, cleanCallFields, cleanOutcome, STATUSES, summarize } from '../src/domain/call.js';
import { can, PERMISSIONS } from '../src/domain/permissions.js';
import { digitsOf, formatPhone, searchableDigits } from '../src/domain/phone.js';
import { parsePrice } from '../src/app/items.js';
import { createLimiter } from '../src/web/limiter.js';
import { migrate, openDatabase } from '../src/infra/db.js';

test('phones: formatting never stops a match', () => {
  assert.equal(digitsOf('+1 (304) 555-0142'), '3045550142');
  assert.equal(digitsOf('304.555.0142 x12'), '304555014212');
  assert.equal(formatPhone('3045550142'), '(304) 555-0142');
  assert.equal(formatPhone('ask for Dale'), 'ask for Dale');
  assert.equal(searchableDigits('0142'), true);
  assert.equal(searchableDigits('42'), false);
});

test('the call lifecycle: where a call can go', () => {
  assert.equal(canMove('open', 'working'), true);
  assert.equal(canMove('working', 'parked'), true);
  assert.equal(canMove('parked', 'working'), true);
  assert.equal(canMove('closed', 'working'), false);
  assert.equal(canMove('closed', 'open'), true);
  assert.equal(canMove('nonsense', 'open'), false);
  for (const status of STATUSES) assert.equal(canMove(status, status), false, `${status} to itself`);
});

test('call fields: nothing is required, junk is refused, text is trimmed and capped', () => {
  assert.deepEqual(cleanCallFields({}), {});
  assert.equal(cleanCallFields({ quantity: '0' }).error, 'quantity');
  assert.equal(cleanCallFields({ quantity: '2.5' }).error, 'quantity');
  assert.equal(cleanCallFields({ quantity: '' }).quantity, null);
  assert.equal(cleanCallFields({ priority: 'urgent' }).error, 'priority');
  assert.equal(cleanCallFields({ request: `  ${'x'.repeat(5000)}  ` }).request.length, 2000);
  assert.deepEqual(cleanCallFields({ application: { year: ' 2008 ', make: '', bogus: 'x', freeform: 'Case 580' } }).application, { year: '2008', freeform: 'Case 580' });
});

test('outcomes: a known outcome, optional detail, money to cents', () => {
  assert.equal(cleanOutcome({}).error, 'outcome');
  assert.deepEqual(cleanOutcome({ outcome: 'quoted', price: '$1,200.50', final_quantity: '3', brand: 'Gates' }), { outcome: 'quoted', data: { brand: 'Gates', quantity: 3, cents: 120050 } });
  assert.equal(cleanOutcome({ outcome: 'sold', price: 'lots' }).error, 'price');
  assert.equal(cleanOutcome({ outcome: 'sold', final_quantity: '-1' }).error, 'final_quantity');
});

test('the queue title is the most useful thing known so far', () => {
  assert.equal(summarize({ application: {}, request: '', part_numbers: '', caller_name: '' }).title, 'New call');
  assert.equal(summarize({ application: {}, request: '', part_numbers: '', caller_name: 'Dale' }).title, 'Call from Dale');
  assert.equal(summarize({ application: { year: '2008', make: 'Ford' }, request: 'pump', part_numbers: '' }).application, '2008 Ford');
});

test('permissions: owner everything, manager more than staff, nobody nothing', () => {
  const staff = { roles: ['staff'] };
  const manager = { roles: ['manager'] };
  const owner = { roles: ['owner'] };
  for (const permission of PERMISSIONS) {
    assert.equal(can(owner, permission), true);
    assert.equal(can(null, permission), false);
    assert.equal(can({ roles: [] }, permission), false);
    assert.equal(can(manager, permission), true);
  }
  assert.equal(can(staff, 'call.create'), true);
  assert.equal(can(staff, 'item.create'), true);
  for (const manager_only of ['item.edit', 'call.assign', 'report.view', 'audit.view', 'customer.deactivate']) assert.equal(can(staff, manager_only), false, manager_only);
  assert.equal(can(owner, 'anything.at.all'), true);
});

test('prices: money in, cents out', () => {
  assert.equal(parsePrice('12.5'), 1250);
  assert.equal(parsePrice('$1,024'), 102400);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('1.234'), undefined);
  assert.equal(parsePrice('-3'), undefined);
});

test('the sign-in limiter allows a burst, then waits for the window', () => {
  let t = 0;
  const limit = createLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.deepEqual([limit.take('a'), limit.take('a'), limit.take('a'), limit.take('b')], [true, true, false, true]);
  t = 1001;
  assert.equal(limit.take('a'), true);
});

test('migrations run once, in order, and a changed one is refused', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (x INTEGER);');
  writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE b (x INTEGER);');
  const db = openDatabase(':memory:');
  assert.deepEqual(migrate(db, dir), ['001_a.sql', '002_b.sql']);
  assert.deepEqual(migrate(db, dir), []);
  writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (y INTEGER);');
  assert.throws(() => migrate(db, dir), /changed after it was applied/);
  writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (x INTEGER);');
  writeFileSync(join(dir, '003_c.sql'), 'CREATE TABLE c (x INTEGER); SELECT * FROM nope;');
  assert.throws(() => migrate(db, dir));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'c'").get(), undefined, 'a failed migration leaves nothing behind');
});

test('a backup is a real, complete copy, and old ones are pruned', async () => {
  const { mkdtempSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { dailyBackup } = await import('../src/infra/backup.js');
  const db = openDatabase(':memory:');
  migrate(db);
  db.prepare("INSERT INTO items (sku, name, created_by, created_at, updated_at) VALUES ('A', 'Kept', 'x', 1, 1)").run();
  const dir = mkdtempSync(join(tmpdir(), 'bak-'));
  for (const day of ['2026-11-10', '2026-11-11', '2026-11-12']) dailyBackup(db, dir, { now: new Date(`${day}T12:00:00Z`), keep: 2 });
  assert.equal(existsSync(join(dir, 'call-store-2026-11-10.db')), false);
  const copy = new DatabaseSync(join(dir, 'call-store-2026-11-12.db'));
  assert.equal(copy.prepare('SELECT name FROM items').get().name, 'Kept');
  copy.close();
});
