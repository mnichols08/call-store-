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


test('the counter card is a printable sheet with a QR code to online ordering, for staff only', async () => {
  const owner = await signedIn(['owner'], 'olive@example.com', 'Olive');
  const staff = await signedIn(['staff'], 'sam@example.com', 'Sam');
  const res = await staff('/counter-card');
  assert.equal(res.status, 200);
  assert.match(res.text, /Order parts online/);
  assert.match(res.text, /<svg[^>]+viewBox/, 'the code is drawn right in the page');
  assert.ok(res.text.includes(`${base}/portal/login`), 'the address under the code is the sign-in page');
  assert.match(res.text, /7:30 AM to 6 PM/);
  assert.match(res.text, /No account yet\?/);
  assert.doesNotMatch(res.text, /class="bar"/, 'the print layout has no app navigation');
  assert.equal((await owner('/counter-card')).status, 200);
  assert.equal((await browser()('/counter-card')).location, '/staff/sign-in');
});

test('pro and fleet accounts show up on the customer list, the customer page and the call', async () => {
  const owner = await signedIn(['owner'], 'olive@example.com', 'Olive');
  const made = await owner('/customers', { method: 'POST', form: { kind: 'organization', tier: 'pro', name: 'Hutton Auto', phone_0: '3015550101' } });
  assert.equal(made.status, 303);
  const id = db.prepare("SELECT id FROM customers WHERE name = 'Hutton Auto'").get().id;
  assert.equal(db.prepare('SELECT tier FROM customers WHERE id = ?').get(id).tier, 'pro');
  assert.match((await owner('/customers')).text, /Pro/);
  assert.match((await owner('/customers?tier=pro')).text, /Hutton Auto/);
  assert.doesNotMatch((await owner('/customers?tier=fleet')).text, /Hutton Auto/);
  assert.match((await owner(`/customers/${id}`)).text, /<option value="pro" selected/);
  const call = await owner('/calls', { method: 'POST', form: { customer: String(id) } });
  assert.equal(call.status, 303);
  const page = await owner(call.location.split('?')[0]);
  assert.match(page.text, /Hutton Auto/);
  assert.match(page.text, />\s*Pro\s*</);
});
