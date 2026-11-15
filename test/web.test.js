import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0 };
let web;
let base;
let db;

/** A tiny browser: keeps its cookies, doesn't follow redirects, always says where posts come from. */
function browser() {
  let cookie = '';
  const request = async (path, { method = 'GET', form, json, origin = base, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin, 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(json ? { accept: 'application/json' } : {}), ...headers },
      body: form ? new URLSearchParams(form) : undefined,
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), text, json: () => JSON.parse(text), headers: response.headers };
  };
  return Object.defineProperty(request, 'cookie', { get: () => cookie });
}

const sessions = new Map();

/** Someone signed in with the roles given: the first account is the owner, the rest are invited by them. */
async function signedIn(roles = ['owner'], email = 'olive@example.com', name = 'Olive') {
  if (sessions.has(email)) return sessions.get(email);
  const me = browser();
  let token;
  if (web.staff.needsOwner()) token = await web.staff.setup();
  else {
    const boss = sessions.get('olive@example.com');
    token = (await web.staff.invite(web.staff.session({ headers: { cookie: boss.cookie } }), { email, name, roles })).token;
  }
  const accepted = await me('/staff/accept', { method: 'POST', form: { token, email, name, password: 'correct horse battery' } });
  assert.equal(accepted.status, 303, accepted.text);
  sessions.set(email, me);
  return me;
}

before(async () => {
  db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config });
  await new Promise((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${web.server.address().port}`;
});
after(() => {
  web.server.closeAllConnections?.();
  web.server.close();
});

test('nobody gets in without signing in, and the sign-in page is open', async () => {
  await signedIn();
  const anon = browser();
  assert.equal((await anon('/')).location, '/staff/sign-in');
  assert.equal((await anon('/calls/1')).location, '/staff/sign-in');
  assert.equal((await anon('/api/customers?q=a', { json: true })).status, 401);
  const page = await anon('/staff/sign-in');
  assert.equal(page.status, 200);
  assert.match(page.text, /Staff sign-in/);
  assert.equal((await anon('/healthz')).status, 200);
});

test('the whole call: start, caller lookup, save as you type, a coworker\'s edit never overwritten, finish', async () => {
  const olive = await signedIn();
  assert.match((await olive('/')).text, /Today/);

  const started = await olive('/calls', { method: 'POST', form: {} });
  assert.equal(started.status, 303);
  const path = started.location;
  const workspace = await olive(path);
  assert.match(workspace.text, /No customer attached/);
  assert.match(workspace.text, /id="call-form"/);

  const saved = await olive(`${path}/save`, { method: 'POST', json: true, form: { revision: '1', request: 'Need water pump', quantity: '1', app_year: '2008', app_make: 'Ford', app_model: 'F-150', app_engine: '5.4L' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json().revision, 2);
  const stale = await olive(`${path}/save`, { method: 'POST', json: true, form: { revision: '1', request: 'something else' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json().error, 'stale');
  assert.match((await olive(path)).text, /Need water pump/);

  await olive('/customers', { method: 'POST', form: { name: 'Hollow Creek Farms', kind: 'organization', phone_0: '304-555-0142', label_0: 'office' } });
  const hits = (await olive('/api/customers?q=555-0142', { json: true })).json();
  assert.equal(hits.customers[0].name, 'Hollow Creek Farms');
  const attached = await olive(`${path}/action`, { method: 'POST', form: { action: 'customer', customer: String(hits.customers[0].id) } });
  assert.equal(attached.status, 303);
  assert.match((await olive(path)).text, /Hollow Creek Farms/);

  assert.match((await olive('/calls')).text, /Need water pump/);
  await olive(`${path}/action`, { method: 'POST', form: { action: 'claim' } });
  const closed = await olive(`${path}/action`, { method: 'POST', form: { action: 'close', outcome: 'sold', price: '312.00' } });
  assert.match(closed.location, /done=Closed/);
  assert.match((await olive(path)).text, /Sold/);
  assert.match((await olive('/calls?view=done')).text, /Need water pump/);
});

test('what people type is escaped everywhere it is shown', async () => {
  const olive = await signedIn();
  const path = (await olive('/calls', { method: 'POST', form: {} })).location;
  await olive(`${path}/save`, { method: 'POST', json: true, form: { request: '<script>alert(1)</script>', notes: '"><img src=x onerror=alert(2)>' } });
  for (const where of [path, '/calls']) {
    const { text } = await olive(where);
    assert.ok(!text.includes('<script>alert(1)'), `${where} shows raw script`);
    assert.ok(!text.includes('<img src=x'), `${where} shows a raw tag`);
  }
});

test('posts from another site are refused, and a message in a link is only shown if the server wrote it', async () => {
  const olive = await signedIn();
  assert.equal((await olive('/calls', { method: 'POST', form: {}, origin: 'https://evil.example' })).status, 403);
  const forged = await olive('/calls?problem=Your+password+expired');
  assert.ok(!forged.text.includes('Your password expired'));
});

test('items can be added mid-call, and roles limit what staff can see and change', async () => {
  const olive = await signedIn();
  const ann = await signedIn(['staff'], 'ann@example.com', 'Ann');
  const path = (await ann('/calls', { method: 'POST', form: {} })).location;
  const callId = path.split('/').pop();
  const added = await ann('/items', { method: 'POST', form: { sku: 'wp-100', name: 'Water pump', price: '45.00', call: callId } });
  assert.match(added.location, new RegExp(`/calls/${callId}`));
  assert.match((await ann(path)).text, /WP-100/);

  assert.equal((await ann('/reports')).status, 403);
  assert.equal((await ann('/audit')).status, 403);
  assert.equal((await ann('/staff/people')).status !== 200, true);
  const item = await ann('/items/1');
  assert.equal(item.status, 200);
  const edit = await ann('/items/1', { method: 'POST', form: { sku: 'WP-100', name: 'Changed' } });
  assert.match(edit.location, /problem=/);

  assert.equal((await olive('/reports')).status, 200);
  assert.match((await olive('/reports.csv')).text, /Day,Calls/);
  assert.match((await olive('/audit')).text, /item\.created/);
  assert.equal((await olive('/staff/people')).status, 200);
});

test('someone is told, not let in, when the sign-in is wrong', async () => {
  await signedIn();
  const stranger = browser();
  const wrong = await stranger('/staff/sign-in', { method: 'POST', form: { email: 'olive@example.com', password: 'not the password' } });
  assert.equal(wrong.status, 303);
  assert.match(wrong.location, /problem=/);
  assert.equal((await stranger('/')).location, '/staff/sign-in');
});

test('a coworker asking you for help is the first thing you see on Today', async () => {
  const olive = await signedIn();
  const ann = await signedIn(['staff'], 'ann@example.com', 'Ann');
  const annWho = web.staff.session({ headers: { cookie: ann.cookie } });
  const made = web.app.calls.create(annWho, { request: 'Hydraulic fitting, thread unknown' });
  web.app.calls.requestHelp(annWho, made.id, 'olive@example.com');
  const today = (await olive('/')).text;
  assert.match(today, /asking you for help/);
  assert.match(today, /Hydraulic fitting/);
  assert.doesNotMatch((await ann('/')).text, /asking you for help/);
});
