// Camera pages hand off to a phone: a desktop gets a code; the phone gets a session and the page.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0, publicUrl: 'https://parts.example' };
let web, base, desk;
function browser() {
  let cookie = '';
  return async (path, { method = 'GET', form } = {}) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: response.status, location: response.headers.get('location'), text: await response.text() };
  };
}
before(async () => {
  const db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config, fetcher: async () => { throw new Error('no network'); }, ai: { enabled: false } });
  await new Promise((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${web.server.address().port}`;
  desk = browser();
  await desk('/staff/accept', { method: 'POST', form: { token: await web.staff.setup(), email: 'olive@example.com', name: 'Olive', password: 'correct horse battery' } });
});
after(() => { web.server.closeAllConnections?.(); web.server.close(); });

test('camera controls are marked phone-only; desktops get the phone button', async () => {
  const scan = (await desk('/scan')).text;
  assert.match(scan, /class="row phone-only"><button type="button" id="scan-start"/);
  assert.match(scan, /class="desktop-only stack"><input type="hidden" name="to" value="\/scan">/);
  const orders = (await desk('/orders')).text;
  assert.match(orders, /btn primary phone-only" href="\/orders\/scan"/);
  assert.match(orders, /value="\/orders\/scan"/);
});

test('the code signs the phone in once and opens the page', async () => {
  const code = await desk('/phone/code', { method: 'POST', form: { to: '/orders/scan' } });
  assert.equal(code.status, 200);
  assert.match(code.text, /<svg/);
  const path = /https:\/\/parts\.example(\/phone\/[\w-]{43}\?to=%2Forders%2Fscan)/.exec(code.text)[1];
  const phone = browser();
  assert.equal((await phone(path)).status, 200, 'opening it only asks to continue');
  const went = await phone(path, { method: 'POST', form: {} });
  assert.equal(went.status, 303);
  assert.equal(went.location, '/orders/scan');
  assert.equal((await phone('/orders/scan')).status, 200);
  assert.equal((await browser()(path, { method: 'POST', form: {} })).status, 400, 'it works once');
});

test('a hand-off only opens the camera pages', async () => {
  const code = await desk('/phone/code', { method: 'POST', form: { to: 'https://evil.example/' } });
  const path = /(\/phone\/[\w-]{43}\?to=[^"&]+)/.exec(code.text)[1];
  assert.equal((await browser()(path, { method: 'POST', form: {} })).location, '/');
  assert.equal((await browser()('/phone/code', { method: 'POST', form: { to: '/scan' } })).location, '/staff/sign-in', 'signed out, no code');
});
