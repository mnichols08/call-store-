import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';
import { qrReadFrame } from '../src/infra/qr.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0, publicUrl: 'https://parts.example' };
let web;
let base;
let db;
const staffUser = { email: 'olive@example.com', roles: ['owner'] };

function browser() {
  let cookie = '';
  return async (path, { method = 'GET', form, json = false } = {}) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(json ? { accept: 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.startsWith('cs_portal=;') || /Max-Age=0/.test(set) ? '' : set.split(';')[0];
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), text, set, headers: response.headers };
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

/** Read the address out of a QR code on a page, the way a phone would. */
function scanCode(html) {
  const svg = /<svg[^>]*viewBox="0 0 (\d+) [^]*?<\/svg>/.exec(html);
  assert.ok(svg, 'a QR code is on the page');
  const side = Number(svg[1]);
  const scale = 6;
  const width = side * scale;
  const luma = new Uint8Array(width * width).fill(255);
  for (const [, x, y, run] of svg[0].matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
    for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < Number(run) * scale; dx += 1) luma[(Number(y) * scale + dy) * width + Number(x) * scale + dx] = 0;
  }
  return qrReadFrame({ width, height: width, luma });
}

test('a customer shows a code, staff scan it once, and can start a call for them', async () => {
  const pat = await join((await web.app.portal.invite(staffUser, bubba)).token, 'Pat Scan', 'patscan@farm.com');
  const shown = await pat.me('/portal/code');
  assert.equal(shown.status, 200);
  const address = scanCode(shown.text);
  assert.match(address, /^https:\/\/parts\.example\/badge\/[\w-]{20,}$/, 'the code holds an address on our site');
  // A phone camera that opens it learns nothing and uses nothing up.
  const path = new URL(address).pathname;
  const peek = await browser()(path);
  assert.equal(peek.status, 200);
  assert.match(peek.text, /for the counter/);
  const read = await olive('/scan/badge', { method: 'POST', form: { code: address }, json: true });
  assert.equal(read.status, 200);
  assert.deepEqual(JSON.parse(read.text), { ok: true, customerId: bubba, name: 'Pat Scan', business: 'Bubba Farms' });
  const twice = await olive('/scan/badge', { method: 'POST', form: { code: address }, json: true });
  assert.equal(twice.status, 400);
  assert.match(JSON.parse(twice.text).message, /ten minutes and work once/);
  // Without scripts the same lookup is a page with the next step on it.
  const second = scanCode((await pat.me('/portal/code')).text);
  const page = await olive('/scan/badge', { method: 'POST', form: { code: second.replace('https://parts.example', '') } });
  assert.equal(page.status, 200);
  assert.match(page.text, /Start a call for them/);
  assert.match(page.text, new RegExp(`name="customer" value="${bubba}"`));
  // A customer can't use the scanner, and typing rubbish does nothing.
  assert.equal((await pat.me('/scan/badge', { method: 'POST', form: { code: address }, json: true })).status, 401);
  assert.equal((await olive('/scan/badge', { method: 'POST', form: { code: 'x' }, json: true })).status, 400);
});

test('only the scan page may run WebAssembly, and its reader files are served', async () => {
  const scan = await olive('/scan');
  assert.equal(scan.status, 200);
  assert.match(scan.headers.get('content-security-policy'), /'wasm-unsafe-eval'/);
  assert.match(scan.text, /src="\/assets\/scan\.js"/);
  assert.ok(!/wasm-unsafe-eval/.test((await olive('/customers')).headers.get('content-security-policy')));
  assert.ok(!/wasm-unsafe-eval/.test((await browser()('/portal/login')).headers.get('content-security-policy')));
  const wasm = await fetch(`${base}/assets/vendor/symbology.wasm`);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)], [0, 0x61, 0x73, 0x6d]);
  assert.match((await fetch(`${base}/assets/vendor/qr.js`)).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/assets/vendor/package.json`)).status, 404, 'only the two files');
  assert.equal((await fetch(`${base}/assets/vendor/../app.css`)).status === 200 ? 'served' : 'x', 'served', 'normal assets are untouched');
});

test('a rep’s QR: a customer scans it, asks for access, and staff approve', async () => {
  const mine = await olive('/rep-code', { method: 'POST', form: {} });
  assert.equal(mine.status, 200);
  const address = scanCode(mine.text);
  assert.match(address, /^https:\/\/parts\.example\/hello\/[\w-]{20,}$/);
  const path = new URL(address).pathname;
  const visitor = browser();
  const form = await visitor(path);
  assert.equal(form.status, 200);
  assert.match(form.text, /Olive at Test Parts sent you here/);
  const sent = await visitor(path, { method: 'POST', form: { name: 'Dana', business: 'Dana Diesel', email: 'dana@diesel.com', phone: '555-111-2222' } });
  assert.equal(sent.status, 200);
  assert.match(sent.text, /Olive will look at this/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE to_email = 'dana@diesel.com'").get().n, 0, 'nothing goes to her until staff approve');

  const customers = await olive('/customers');
  assert.match(customers.text, /Waiting for approval \(1\)/);
  assert.match(customers.text, /Dana/);
  assert.match(customers.text, /Add “Dana Diesel” as a new customer/);
  const id = db.prepare("SELECT id FROM access_requests WHERE email = 'dana@diesel.com'").get().id;
  const done = await olive(`/access/${id}/decide`, { method: 'POST', form: { action: 'approve', customer: '' } });
  assert.equal(done.status, 303);
  assert.match(lastMail('dana@diesel.com').body, /https:\/\/parts\.example\/join\//);
  assert.match((await olive('/customers')).text, /Dana Diesel/);
  const again = await olive(`/access/${id}/decide`, { method: 'POST', form: { action: 'approve', customer: '' } });
  assert.equal(again.status, 303);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE to_email = 'dana@diesel.com'").get().n, 1, 'a second decision sends nothing more');

  // An old code stops working when a new one is made; a made-up one never did.
  await olive('/rep-code', { method: 'POST', form: {} });
  assert.equal((await visitor(path)).status, 404);
  assert.equal((await visitor('/hello/' + 'q'.repeat(30))).status, 404);
  assert.equal((await visitor(path, { method: 'POST', form: { name: 'A', business: 'B', email: 'a@b.com' } })).status, 404);
});

test('delivery: the form asks for it, a missing address is refused, and staff plan the run from the list', async () => {
  const made = await olive(`/customers/${bubba}/portal/invite`, { method: 'POST', form: {} });
  const invite = /\/join\/([\w-]{20,})/.exec(made.text)[1];
  const dee = await join(invite, 'Dee', 'dee@farm.com');
  const form = await dee.me('/portal/requests/new');
  assert.match(form.text, /name="deliveryAddress"/);
  assert.match(form.text, /<option value="Oakland, MD">/);
  const bad = await dee.me('/portal/requests', { method: 'POST', form: { request: 'Hose', fulfilment: 'deliver', deliveryTown: 'Oakland, MD', deliveryAddress: '  ' } });
  assert.equal(bad.status, 303);
  assert.match(bad.location, /problem=address/);
  assert.equal(db.prepare("SELECT count(*) n FROM calls WHERE request = 'Hose'").get().n, 0, 'nothing was created');
  const sent = await dee.me('/portal/requests', { method: 'POST', form: { request: 'Hose', fulfilment: 'deliver', deliveryTown: 'Terra Alta, WV', deliveryAddress: '5 Mill Rd', deliveryNote: 'Leave at the shop door' } });
  assert.equal(sent.status, 303);
  const id = /\/portal\/requests\/(\d+)/.exec(sent.location)[1];
  assert.match((await dee.me(`/portal/requests/${id}`)).text, /5 Mill Rd/);

  const list = await olive('/deliveries');
  assert.equal(list.status, 200);
  assert.match(list.text, /Terra Alta, WV/);
  assert.match(list.text, /Driver sheet/);
  const sheet = await olive('/deliveries/print');
  assert.match(sheet.text, /5 Mill Rd/);
  assert.match(sheet.text, /Leave at the shop door/);
  assert.match((await olive(`/calls/${id}`)).text, /id="delivery"/);
  assert.equal((await olive(`/calls/${id}/delivery/status`, { method: 'POST', form: { status: 'out' } })).status, 303);
  assert.match((await dee.me(`/portal/requests/${id}`)).text, /Out for delivery/);
  assert.match((await dee.me(`/portal/requests/${id}`)).text, /On the way/, 'and it shows in the updates');
  assert.equal((await browser()('/deliveries')).location, '/staff/sign-in');
});
