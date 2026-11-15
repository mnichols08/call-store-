import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0, publicUrl: 'https://parts.example' };
let web;
let base;
let db;
const staffUser = { email: 'olive@example.com', roles: ['owner'] };

function browser() {
  let cookie = '';
  return async (path, { method = 'GET', form } = {}) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.startsWith('cs_portal=;') || /Max-Age=0/.test(set) ? '' : set.split(';')[0];
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), text, set };
  };
}
async function staff() {
  const me = browser();
  const token = await web.staff.setup();
  await me('/staff/accept', { method: 'POST', form: { token, email: staffUser.email, name: 'Olive', password: 'correct horse battery' } });
  return me;
}
const lastMail = (to) => db.prepare('SELECT * FROM outbox WHERE to_email = ? ORDER BY id DESC').get(to);
const linkIn = (mail, re) => re.exec(mail.body)[0];
async function join(inviteToken, name, email) {
  const me = browser();
  assert.equal((await me(`/join/${inviteToken}`)).status, 200);
  assert.equal((await me(`/join/${inviteToken}`, { method: 'POST', form: { name, email } })).status, 200);
  const path = new URL(linkIn(lastMail(email), /https:\/\/parts\.example\/portal\/verify\/[\w-]+/)).pathname;
  assert.equal((await me(path)).status, 200, 'the link opens a confirm page');
  const done = await me(path, { method: 'POST', form: {} });
  assert.equal(done.status, 303);
  assert.match(done.set, /cs_portal=[\w-]+; Path=\/; HttpOnly; SameSite=Lax/);
  return { me, path };
}

let olive;
let bubba;
let other;
before(async () => {
  db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config, fetcher: async () => { throw new Error('no network'); }, ai: { enabled: false } });
  await new Promise((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${web.server.address().port}`;
  olive = await staff();
  bubba = web.app.customers.create(staffUser, { kind: 'organization', name: 'Bubba Farms', phones: [{ phone: '5551230000' }] }).id;
  other = web.app.customers.create(staffUser, { kind: 'organization', name: 'Other Co', phones: [{ phone: '5559990000' }] }).id;
});
after(() => {
  web.server.closeAllConnections?.();
  web.server.close();
});

test('join by QR, confirm by email, request, hear back: the whole trip', async () => {
  // A rep makes a QR code on the customer's page.
  const page = await olive(`/customers/${bubba}`);
  assert.match(page.text, /Online account/);
  const made = await olive(`/customers/${bubba}/portal/invite`, { method: 'POST', form: {} });
  assert.equal(made.status, 200);
  assert.match(made.text, /<svg/);
  const invite = /\/join\/([\w-]{20,})/.exec(made.text)[1];

  const pat = await join(invite, 'Pat', 'pat@farm.com');
  assert.equal((await pat.me(pat.path, { method: 'POST', form: {} })).status, 400, 'the link works once');
  assert.match((await pat.me('/portal')).text, /Bubba Farms/);
  assert.match(lastMail('pat@farm.com').body, /^Hi Pat/);

  const sent = await pat.me('/portal/requests', { method: 'POST', form: { request: 'Water pump for a 5075E', partNumbers: 'AW9301', quantity: '1', needed: 'today', fulfilment: 'pickup' } });
  assert.equal(sent.status, 303);
  const id = /\/portal\/requests\/(\d+)/.exec(sent.location)[1];
  assert.match((await pat.me(`/portal/requests/${id}`)).text, /We got your request/);

  // Staff see it as a web request and answer it.
  const call = await olive(`/calls/${id}`);
  assert.match(call.text, /Customer portal/);
  assert.match(call.text, /Web/);
  const upd = await olive(`/calls/${id}/portal/update`, { method: 'POST', form: { kind: 'need-info', message: 'Which engine?', email: '1' } });
  assert.equal(upd.status, 303);
  const view = (await pat.me(`/portal/requests/${id}`)).text;
  assert.match(view, /We need a bit more from you/);
  assert.match(view, /Which engine\?/);
  assert.ok(!view.includes('Will pick up'), 'internal notes stay internal');
  assert.match(lastMail('pat@farm.com').body, /Which engine\?/);
  assert.match(lastMail('pat@farm.com').body, /^See it here: https:\/\/parts\.example\/portal\/requests\/\d+/m);

  assert.equal((await pat.me(`/portal/requests/${id}/note`, { method: 'POST', form: { text: '6.8 diesel' } })).status, 303);
  assert.equal((await pat.me(`/portal/requests/${id}/details`, { method: 'POST', form: { type: 'belt', unit: 'mm', f_length: '1200' } })).status, 303);
  assert.match((await olive(`/calls/${id}`)).text, /6\.8 diesel/);
});

test('a coworker joins the same business from a QR the customer shows; businesses never see each other', async () => {
  const pat = await join((await web.app.portal.invite(staffUser, bubba)).token, 'Pat2', 'pat2@farm.com');
  const team = await pat.me('/portal/team');
  const shown = await pat.me('/portal/team/invite', { method: 'POST', form: {} });
  assert.match(shown.text, /<svg/);
  const sam = await join(/\/join\/([\w-]{20,})/.exec(shown.text)[1], 'Sam', 'sam@farm.com');
  assert.match(team.text, /Your team/);
  assert.match((await sam.me('/portal')).text, /Bubba Farms/);
  assert.match((await sam.me('/portal')).text, /Water pump/, 'a coworker sees the business’s open requests');

  const zed = await join((await web.app.portal.invite(staffUser, other)).token, 'Zed', 'zed@other.com');
  const mine = (await zed.me('/portal')).text;
  assert.ok(!mine.includes('Water pump'));
  assert.equal((await zed.me('/portal/requests/1')).status, 404);
  assert.equal((await zed.me('/portal/requests/1/note', { method: 'POST', form: { text: 'hi' } })).status, 404);
  assert.equal((await zed.me('/portal/requests/1/photos/1')).status, 404);
});

test('signed-out visitors get nothing, links are one-use, and posts must come from the site', async () => {
  const nobody = browser();
  for (const path of ['/portal', '/portal/requests/1', '/portal/team', '/portal/requests/new']) {
    const r = await nobody(path);
    assert.equal(r.status, 303, path);
    assert.equal(r.location, '/portal/login');
  }
  assert.equal((await nobody('/join/' + 'q'.repeat(30))).status, 404);
  assert.equal((await nobody('/portal/verify/' + 'q'.repeat(30))).status, 404);
  const cross = await fetch(`${base}/portal/login`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=pat@farm.com' });
  assert.equal(cross.status, 403);
  const before = db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n;
  const ask = await nobody('/portal/login', { method: 'POST', form: { email: 'nobody@nowhere.com' } });
  assert.equal(ask.status, 200);
  const real = await nobody('/portal/login', { method: 'POST', form: { email: 'pat@farm.com' } });
  assert.equal(real.status, 200);
  const same = (t) => t.replace(/\s+/g, ' ').replace(/nonce="[^"]+"/g, '');
  assert.equal(same(real.text), same(ask.text), 'same page either way');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, before + 1, 'only the real address got mail');
  assert.ok(!(await nobody('/portal/login')).text.includes('pat@farm.com'));
});

test('signing out ends the session; staff pages are closed to customers', async () => {
  const pat = await join((await web.app.portal.invite(staffUser, bubba)).token, 'Pat3', 'pat3@farm.com');
  assert.equal((await pat.me('/portal')).status, 200);
  assert.equal((await pat.me('/calls')).status, 303, 'a customer cookie is not a staff session');
  assert.equal((await pat.me('/portal/sign-out', { method: 'POST', form: {} })).status, 303);
  assert.equal((await pat.me('/portal')).status, 303);
});

test('the outbox is for managers, and staff can remove a member', async () => {
  const box = await olive('/outbox');
  assert.equal(box.status, 200);
  assert.match(box.text, /pat@farm\.com/);
  assert.match(box.text, /isn’t set up/);
  const nobody = browser();
  assert.equal((await nobody('/outbox')).status, 303);
  const id = db.prepare("SELECT id FROM portal_accounts WHERE email = 'sam@farm.com'").get().id;
  assert.equal((await olive(`/portal-members/${id}/remove`, { method: 'POST', form: {} })).status, 303);
  assert.equal(db.prepare('SELECT status FROM portal_accounts WHERE id = ?').get(id).status, 'removed');
});
