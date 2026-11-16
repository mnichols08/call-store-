import test from 'node:test';
import assert from 'node:assert/strict';
import { readPicture, AVATAR_MAX_BYTES } from '../src/app/avatars.js';
import { freshApp, ann } from './helpers.js';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const url = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;

test('a picture is kept only when it really is a small JPEG, PNG or WebP', () => {
  assert.equal(readPicture(url('image/jpeg', jpeg)).mime, 'image/jpeg');
  assert.equal(readPicture(url('image/png', jpeg)).mime, 'image/jpeg', 'the type comes from the bytes, not the label');
  assert.equal(readPicture(url('image/jpeg', Buffer.from('<script>alert(1)</script> padding'))).error, 'picture');
  assert.equal(readPicture('data:image/svg+xml;base64,PHN2Zz4=').error, 'picture');
  assert.equal(readPicture('').error, 'picture');
  assert.equal(readPicture(url('image/jpeg', Buffer.concat([jpeg, Buffer.alloc(AVATAR_MAX_BYTES)]))).error, 'picture-size');
});

test('someone sets their picture, sees it change, and can go back to initials', () => {
  const { app } = freshApp();
  assert.equal(app.avatars.version('staff:a1'), 0);
  assert.equal(app.avatars.set('nobody', url('image/jpeg', jpeg)).error, 'forbidden');
  assert.equal(app.avatars.set('staff:a1', 'nonsense').error, 'picture');
  assert.equal(app.avatars.set('staff:a1', url('image/jpeg', jpeg)).ok, true);
  assert.ok(app.avatars.version('staff:a1') > 0);
  assert.deepEqual(Buffer.from(app.avatars.get('staff:a1').bytes), jpeg);
  assert.equal(app.avatars.get('portal:1'), null, 'a customer and a coworker never share one');
  app.avatars.remove('staff:a1');
  assert.equal(app.avatars.version('staff:a1'), 0);
});

test('a customer changes their own name, email and phone; nobody else’s email can be taken', () => {
  const { app, db } = freshApp();
  const cust = app.customers.create(ann, { kind: 'organization', name: 'Bubba Farms' }).id;
  const add = (name, email) => Number(db.prepare("INSERT INTO portal_accounts (customer_id, email, name, role, status, notify, created_at) VALUES (?, ?, ?, 'member', 'active', 1, 1)").run(cust, email, name).lastInsertRowid);
  const pat = add('Pat', 'pat@example.com');
  add('Sam', 'sam@example.com');
  assert.equal(app.portal.updateAccount({ id: pat }, { name: ' ' }).error, 'name');
  assert.equal(app.portal.updateAccount({ id: pat }, { name: 'Pat', email: 'nope' }).error, 'email');
  assert.equal(app.portal.updateAccount({ id: pat }, { name: 'Pat', email: 'SAM@example.com' }).error, 'email-taken');
  assert.equal(app.portal.updateAccount({ id: pat }, { name: 'Pat', phone: '12' }).error, 'phone');
  assert.equal(app.portal.updateAccount({ id: 9999 }, { name: 'X' }).error, 'forbidden');
  assert.equal(app.portal.updateAccount({ id: pat }, { name: 'Pat Walker', email: '', phone: '301-555-0144' }).ok, true);
  const row = db.prepare('SELECT name, email, phone FROM portal_accounts WHERE id = ?').get(pat);
  assert.deepEqual({ ...row }, { name: 'Pat Walker', email: null, phone: '301-555-0144' }, 'email is optional');
});
