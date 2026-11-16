import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { sqliteStore } from '../src/infra/documents-store.js';
import { createStaff } from '../vendor/kit/staff/index.js';
import { ROLES } from '../src/domain/permissions.js';
import { createDoors, safePath } from '../src/web/doors.js';
import { createAi } from '../src/infra/ai.js';

function setup() {
  const db = openDatabase();
  migrate(db);
  const store = sqliteStore(db);
  const staff = createStaff({ store, roles: ROLES, name: 'call-store', secure: false });
  const sent = [];
  const res = () => ({ csp: '', writeHead(status, headers) { sent.push({ status, headers }); }, end(body) { sent.at(-1).body = body ?? ''; } });
  const zubra = { page: () => ({ finish: (html) => html }) };
  const doors = createDoors({ staff, store, config: { business: 'Shop' }, zubra });
  const visit = async (path, fields = null) => {
    const url = new URL(path, 'http://x');
    const handled = await doors.handle({}, res(), url, { posting: Boolean(fields), form: new URLSearchParams(fields ?? {}), nonce: 'n' });
    return handled ? sent.at(-1) : null;
  };
  return { db, staff, doors, visit };
}

async function ownerOf(staff) {
  const made = await staff.accept(await staff.setup(), { email: 'olive@example.com', name: 'Olive', password: 'a-long-password-1' });
  return staff.list().find((p) => p.email === 'olive@example.com') ?? made;
}

test('a coworker makes their own account from a sign-up code; it works once and carries the chosen role', async () => {
  const { staff, doors, visit } = setup();
  const olive = await ownerOf(staff);
  assert.equal((await doors.crewCode({ account: 'nobody', roles: [] }, 'staff')).error, 'forbidden');
  const made = await doors.crewCode(olive, 'staff');
  assert.ok(made.ok);
  const form = await visit(`/crew/${made.code}`);
  assert.equal(form.status, 200);
  assert.match(form.body, /Olive is adding you as counter staff/);

  const weak = await visit(`/crew/${made.code}`, { name: 'Bo', email: 'bo@example.com', password: 'short' });
  assert.equal(weak.status, 422, 'a refused password keeps the code usable');
  const taken = await visit(`/crew/${made.code}`, { name: 'Bo', email: 'olive@example.com', password: 'a-long-password-2' });
  assert.equal(taken.status, 422);

  const done = await visit(`/crew/${made.code}`, { name: 'Bo', email: 'bo@example.com', password: 'a-long-password-2' });
  assert.equal(done.status, 303);
  assert.ok(done.headers['set-cookie'], 'they are signed in');
  const bo = staff.list().find((p) => p.email === 'bo@example.com');
  assert.deepEqual(bo.roles, ['staff']);
  assert.equal((await visit(`/crew/${made.code}`)).status, 410, 'the code is spent');
  assert.equal((await visit('/crew/' + 'x'.repeat(30))).status, 410);
  assert.equal(await visit('/somewhere-else'), null);
});

test('the phone code signs the same person in once and only opens a page on this site', async () => {
  const { staff, visit } = setup();
  const olive = await ownerOf(staff);
  const { token } = await staff.handOff(olive, { minutes: 10 });
  const first = await visit(`/phone/${token}?to=${encodeURIComponent('/orders/scan')}`);
  assert.equal(first.status, 303);
  assert.equal(first.headers.location, '/orders/scan');
  assert.ok(first.headers['set-cookie']);
  assert.equal((await visit(`/phone/${token}`)).status, 410);
  assert.equal(safePath('//evil.example'), '/');
  assert.equal(safePath('https://evil.example'), '/');
  assert.equal(safePath('/staff/people'), '/');
  assert.equal(safePath('/calls/3#wrap'), '/calls/3#wrap');
});

test('the AI self-test says what the service said, and never throws', async () => {
  assert.equal((await createAi({}).check()).error, 'off');
  const answer = (status, body) => async () => new Response(JSON.stringify(body), { status });
  assert.equal((await createAi({ apiKey: 'k', fetcher: answer(200, {}) }).check()).ok, true);
  const refused = await createAi({ apiKey: 'k', fetcher: answer(401, { error: { message: 'invalid x-api-key' } }) }).check();
  assert.deepEqual([refused.error, refused.status, refused.detail], ['auth', 401, 'invalid x-api-key']);
  assert.equal((await createAi({ apiKey: 'k', fetcher: answer(404, { error: { message: 'model: nope' } }) }).check()).error, 'model');
  assert.equal((await createAi({ apiKey: 'k', fetcher: async () => { throw new Error('no network'); } }).check()).error, 'failed');
});
