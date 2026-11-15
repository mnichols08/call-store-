import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0 };
let web; let base; let db;
const sessions = new Map();

function browser() {
  let cookie = '';
  const request = async (path, { method = 'GET', form } = {}) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: response.status, location: response.headers.get('location'), text: await response.text() };
  };
  return Object.defineProperty(request, 'cookie', { get: () => cookie });
}
async function signedIn(roles, email, name) {
  if (sessions.has(email)) return sessions.get(email);
  const me = browser();
  let token;
  if (web.staff.needsOwner()) token = await web.staff.setup();
  else token = (await web.staff.invite(web.staff.session({ headers: { cookie: sessions.get('olive@example.com').cookie } }), { email, name, roles })).token;
  await me('/staff/accept', { method: 'POST', form: { token, email, name, password: 'correct horse battery' } });
  sessions.set(email, me);
  return me;
}
before(async () => {
  db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config });
  await new Promise((r) => web.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${web.server.address().port}`;
});
after(() => { web.server.closeAllConnections?.(); web.server.close(); });

const csv = 'ID\tName\tPhone\nA100\tBubba Farms LLC\t301-555-0101\nA101\tJane <b>Smith</b>\t304-555-0142\n';

test('a manager looks a list over, then confirms; nothing is saved before that', async () => {
  const owner = await signedIn(['owner'], 'olive@example.com', 'Olive');
  assert.match((await owner('/customers/import')).text, /Choose a file/);
  assert.match((await owner('/customers')).text, /Import list/);
  const preview = await owner('/customers/import/preview', { method: 'POST', form: { csv } });
  assert.equal(preview.status, 200);
  assert.match(preview.text, /<strong>2<\/strong> new/);
  assert.match(preview.text, /Import 2 customers/);
  assert.doesNotMatch(preview.text, /<b>Smith<\/b>/, 'cells are shown as text');
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 0);
  const done = await owner('/customers/import', { method: 'POST', form: { csv } });
  assert.equal(done.status, 303);
  assert.match(done.location, /done=/);
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 2);
  assert.match((await owner('/customers/import/preview', { method: 'POST', form: { csv } })).text, /nothing to import/i);
});

test('staff can’t see or use the import; a list over the usual form size still works for a manager', async () => {
  await signedIn(['owner'], 'olive@example.com', 'Olive');
  const staff = await signedIn(['staff'], 'sam@example.com', 'Sam');
  assert.equal((await staff('/customers/import')).status, 403);
  assert.equal((await staff('/customers/import/preview', { method: 'POST', form: { csv } })).status, 403);
  assert.equal((await staff('/customers/import', { method: 'POST', form: { csv } })).status, 403);
  assert.doesNotMatch((await staff('/customers')).text, /Import list/);
  const owner = sessions.get('olive@example.com');
  const big = `ID,Name,Phone\n${Array.from({ length: 4000 }, (_, i) => `B${i},Customer Number ${i},301-555-${String(1000 + i).padStart(4, '0')}`).join('\n')}`;
  const res = await owner('/customers/import/preview', { method: 'POST', form: { csv: big } });
  assert.equal(res.status, 200);
  assert.match(res.text, /<strong>4000<\/strong> new/);
});

test('a bad list explains itself and keeps what was pasted', async () => {
  const owner = await signedIn(['owner'], 'olive@example.com', 'Olive');
  const res = await owner('/customers/import/preview', { method: 'POST', form: { csv: 'Foo,Bar\n1,2' } });
  assert.equal(res.status, 400);
  assert.match(res.text, /first row needs column names/);
  assert.match(res.text, /Foo,Bar/);
});
