import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { sqliteStore } from '../src/infra/documents-store.js';
import { createStaff } from '../vendor/kit/staff/index.js';
import { ROLES } from '../src/domain/permissions.js';
import { recoverOwner } from '../src/infra/recover-cli.js';

const tokenOf = (link) => new URL(link).searchParams.get('token');

test('a locked-out owner gets a one-time link that sets a new password, and nothing is deleted', async () => {
  const db = openDatabase();
  migrate(db);
  const staff = createStaff({ store: sqliteStore(db), roles: ROLES, name: 'call-store', secure: false });

  const first = await recoverOwner({ db, origin: 'https://shop.test' });
  assert.equal(first.setup, true, 'with nobody yet, it is the setup link');
  const made = await staff.accept(tokenOf(first.link), { email: 'olive@example.com', name: 'Olive', password: 'first-password-1' });
  assert.ok(!made.error, made.error);

  const again = await recoverOwner({ db, origin: 'https://shop.test' });
  assert.equal(again.email, 'olive@example.com');
  assert.match(again.link, /^https:\/\/shop\.test\/staff\/accept\?token=/);
  const reset = await staff.accept(tokenOf(again.link), { password: 'second-password-2' });
  assert.ok(!reset.error, reset.error);
  assert.ok(!(await staff.signIn('olive@example.com', 'second-password-2')).error);
  assert.ok((await staff.signIn('olive@example.com', 'first-password-1')).error);
  assert.ok((await staff.accept(tokenOf(again.link), { password: 'third-password-3' })).error, 'the link works once');

  assert.equal((await recoverOwner({ db, email: 'nobody@example.com' })).error, 'missing');
  assert.equal((await recoverOwner({ db, email: 'OLIVE@example.com' })).ok, true);
  db.close();
});
