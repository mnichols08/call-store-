// Inviting one person at a customer (text, email or QR) and signing in without an email link.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0, publicUrl: 'https://parts.example' };
let web, base, db, owner, farm;

function browser() {
  let cookie = '';
  return async (path, { method = 'GET', form } = {}) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0];
    return { status: response.status, location: response.headers.get('location'), text: await response.text(), set };
  };
}
const lastOut = () => db.prepare('SELECT * FROM outbox ORDER BY id DESC').get();
const tokenIn = (text, path) => new RegExp(`${path}([\\w-]{20,80})`).exec(text)?.[1];

before(async () => {
  db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config, fetcher: async () => { throw new Error('no network'); }, ai: { enabled: false } });
  await new Promise((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${web.server.address().port}`;
  owner = browser();
  const token = await web.staff.setup();
  await owner('/staff/accept', { method: 'POST', form: { token, email: 'olive@example.com', name: 'Olive', password: 'correct horse battery' } });
  farm = web.app.customers.create({ email: 'olive@example.com', roles: ['owner'] }, { kind: 'organization', name: 'Bubba Farms', phones: [{ phone: '5551230000' }] }).id;
});
after(() => { web.server.closeAllConnections?.(); web.server.close(); });

test('a texted invite: the person picks a name and a username, then signs in with it', async () => {
  const sent = await owner(`/customers/${farm}/portal/person`, { method: 'POST', form: { name: 'Cy', phone: '(304) 555-0100', via: 'text' } });
  assert.equal(sent.status, 303);
  const text = lastOut();
  assert.equal(text.channel, 'text');
  assert.equal(text.to_email, '+13045550100');
  const token = tokenIn(text.body, 'https://parts.example/welcome/');
  assert.ok(token);

  const cy = browser();
  const page = await cy(`/welcome/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Order for Bubba Farms/);
  assert.match(page.text, /value="Cy"/, 'the name the rep typed is filled in');
  assert.doesNotMatch(page.text, /name="customer"/, 'they never pick their customer');

  const weak = await cy(`/welcome/${token}`, { method: 'POST', form: { name: 'Cy', username: 'cy.farm', password: 'short' } });
  assert.match(weak.location, /problem=password/);
  const done = await cy(`/welcome/${token}`, { method: 'POST', form: { name: 'Cy Young', username: 'cy.farm', password: 'tractor-season-1' } });
  assert.equal(done.status, 303);
  assert.match(done.set, /cs_portal=/);
  assert.equal((await cy('/portal')).status, 200);
  const acct = db.prepare("SELECT * FROM portal_accounts WHERE username = 'cy.farm'").get();
  assert.equal(acct.customer_id, farm);
  assert.equal(acct.email, null);
  assert.equal(acct.role, 'admin', 'the first person in is the admin');

  assert.equal((await browser()(`/welcome/${token}`)).status, 404, 'the link works once');

  const again = browser();
  assert.match((await again('/portal/login/password', { method: 'POST', form: { username: 'cy.farm', password: 'wrong-password' } })).location, /problem=sign-in/);
  const back = await again('/portal/login/password', { method: 'POST', form: { username: 'CY.FARM', password: 'tractor-season-1' } });
  assert.equal(back.location, '/portal');
  assert.match((await again('/portal')).text, /Cy Young/);
});

test('a QR invite shows a code; an emailed one keeps the address for backup links', async () => {
  const qr = await owner(`/customers/${farm}/portal/person`, { method: 'POST', form: { via: 'qr' } });
  assert.equal(qr.status, 200);
  assert.match(qr.text, /<svg/);
  assert.ok(tokenIn(qr.text, '/welcome/'));

  await owner(`/customers/${farm}/portal/person`, { method: 'POST', form: { email: 'di@farm.example', via: 'email' } });
  const mail = lastOut();
  assert.equal(mail.to_email, 'di@farm.example');
  const token = tokenIn(mail.body, 'https://parts.example/welcome/');
  const di = browser();
  assert.match((await di(`/welcome/${token}`)).text, /sign-in link by email/);
  await di(`/welcome/${token}`, { method: 'POST', form: { name: 'Di', username: 'di.farm', password: 'combine-harvest' } });
  assert.equal(db.prepare("SELECT email, role FROM portal_accounts WHERE username = 'di.farm'").get().email, 'di@farm.example');
  assert.equal((await owner(`/customers/${farm}/portal/person`, { method: 'POST', form: { via: 'text' } })).location.includes('problem'), true, 'texting needs a phone');
});

test('passkeys: the options come back, and a made-up answer is refused', async () => {
  await owner(`/customers/${farm}/portal/person`, { method: 'POST', form: { via: 'qr' } });
  const qr = await owner(`/customers/${farm}/portal/person`, { method: 'POST', form: { via: 'qr' } });
  const token = tokenIn(qr.text, '/welcome/');
  const ed = browser();
  const start = JSON.parse((await ed(`/welcome/${token}/passkey-options`, { method: 'POST', form: { name: 'Ed' } })).text);
  assert.equal(start.options.rp.id, 'parts.example');
  assert.ok(start.handle);
  const fake = await ed(`/welcome/${token}/passkey`, { method: 'POST', form: { handle: start.handle, response: JSON.stringify({ id: 'x', rawId: 'x', type: 'public-key', response: {} }) } });
  assert.equal(fake.status, 400);
  const reused = await ed(`/welcome/${token}/passkey`, { method: 'POST', form: { handle: start.handle, response: '{}' } });
  assert.equal(JSON.parse(reused.text).error, 'token', 'a challenge works once');
  assert.equal((await ed(`/welcome/${token}`)).status, 200, 'a failed passkey doesn’t use up the link');
  const signIn = JSON.parse((await ed('/portal/passkey-options', { method: 'POST', form: {} })).text);
  assert.ok(signIn.options.challenge);
  assert.equal((await ed('/portal/passkey', { method: 'POST', form: { handle: signIn.handle, response: JSON.stringify({ id: 'nobody' }) } })).status, 400);
});

test('managers invite counter staff only; staff invite customers only', async () => {
  const made = await owner('/invite/employee', { method: 'POST', form: { name: 'Max', email: 'max@example.com', role: 'manager', via: 'qr' } });
  assert.equal(made.status, 200);
  const accept = /\/staff\/accept\?token=([\w-]+)/.exec(made.text)[1];
  const max = browser();
  await max('/staff/accept', { method: 'POST', form: { token: accept, email: 'max@example.com', name: 'Max', password: 'correct horse battery' } });
  const page = await max('/invite');
  assert.match(page.text, /An employee/);
  assert.match(page.text, /<option value="staff"/);
  assert.doesNotMatch(page.text, /<option value="(manager|owner)"/);
  const refused = await max('/invite/employee', { method: 'POST', form: { name: 'Bo', email: 'bo@example.com', role: 'owner', via: 'qr' } });
  assert.match(decodeURIComponent(refused.location.replace(/\+/g, ' ')), /can’t give someone that role/);
  const texted = await max('/invite/employee', { method: 'POST', form: { name: 'Ann', email: 'ann@example.com', phone: '304 555 0111', role: 'staff', via: 'text' } });
  assert.equal(texted.status, 303);
  assert.match(lastOut().body, /\/staff\/accept\?token=/);

  const ann = browser();
  await ann('/staff/accept', { method: 'POST', form: { token: /token=([\w-]+)/.exec(lastOut().body)[1], email: 'ann@example.com', name: 'Ann', password: 'correct horse battery' } });
  const annPage = await ann('/invite');
  assert.equal(annPage.status, 200);
  assert.doesNotMatch(annPage.text, /An employee/);
  assert.match((await ann('/invite?q=Bubba')).text, /Bubba Farms/);
  assert.notEqual((await ann('/invite/employee', { method: 'POST', form: { name: 'Z', email: 'z@example.com', role: 'staff' } })).location, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE to_email = 'z@example.com'").get().n, 0);
});

test('a new customer can be added on the invite page', async () => {
  const r = await owner('/invite/customer', { method: 'POST', form: { newName: 'Hollow Creek Garage', phone: '304 555 0177', via: 'text' } });
  assert.equal(r.status, 303);
  const c = db.prepare("SELECT id FROM customers WHERE name = 'Hollow Creek Garage'").get();
  assert.ok(c);
  assert.equal(db.prepare('SELECT customer_id FROM portal_person_invites ORDER BY id DESC').get().customer_id, c.id);
});
