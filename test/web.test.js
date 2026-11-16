import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';
import { createLogger } from '../src/infra/log.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0 };
let web;
let base;
let db;
const pushes = [];
let pushFailure = null;

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
  web = await createWeb({ db, config, sendPush: async (subscription, body) => { pushes.push({ subscription, body: JSON.parse(body) }); if (pushFailure) throw pushFailure; } });
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
  const home = await anon('/');
  assert.equal(home.status, 200, 'the front page is the shop’s public page');
  assert.doesNotMatch(home.text, /Open calls|New call/);
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
  assert.equal((await stranger('/calls')).location, '/staff/sign-in');
  assert.doesNotMatch((await stranger('/')).text, /Open calls|Today/);
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


test('a nudge reaches only the person it is for: on Today, until they dismiss it, and by push if they allowed it', async () => {
  const olive = await signedIn();
  const ann = await signedIn(['staff'], 'ann@example.com', 'Ann');
  const bob = await signedIn(['staff'], 'bob@example.com', 'Bob');
  const path = (await olive('/calls', { method: 'POST', form: {} })).location;
  await olive(`${path}/save`, { method: 'POST', json: true, form: { request: 'Alternator for the <b>tractor</b>' } });

  // Ann opens the live stream and Bob does too; only Ann is nudged.
  const listen = async (who) => {
    const abort = new AbortController();
    const response = await fetch(`${base}/events`, { headers: { cookie: who.cookie }, signal: abort.signal });
    let text = '';
    const reading = (async () => { try { for await (const chunk of response.body) text += Buffer.from(chunk).toString(); } catch {} })();
    return { text: () => text, stop: async () => { abort.abort(); await reading; } };
  };
  const annStream = await listen(ann);
  const bobStream = await listen(bob);

  assert.match((await olive(`${path}/nudge`, { method: 'POST', form: { to: 'nobody@example.com', message: 'hi' } })).location, /problem=/);
  assert.match((await olive(`${path}/nudge`, { method: 'POST', form: { to: 'olive@example.com' } })).location, /problem=/, 'not yourself');

  // Ann allows notifications on one browser, then Olive nudges her.
  const sub = { endpoint: 'https://push.example/ann-1', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await ann('/push/subscribe', { method: 'POST', json: true, form: { subscription: JSON.stringify(sub) } })).status, 200);
  assert.equal((await ann('/push/subscribe', { method: 'POST', json: true, form: { subscription: JSON.stringify({ endpoint: 'http://insecure', keys: {} }) } })).status, 400);
  const sent = await olive(`${path}/nudge`, { method: 'POST', form: { to: 'ann@example.com', message: 'Can you take this one? <i>please</i>' } });
  assert.match(sent.location, /done=Nudged/);
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].subscription.endpoint, sub.endpoint);
  assert.equal(pushes[0].body.title, 'Olive nudged you');
  assert.equal(pushes[0].body.url, path);
  assert.match(annStream.text(), /"type":"nudge"/);
  assert.doesNotMatch(bobStream.text(), /nudge/, 'a nudge is private');
  await annStream.stop();
  await bobStream.stop();

  const today = (await ann('/')).text;
  assert.match(today, /A coworker nudged you/);
  assert.match(today, /Can you take this one\? &lt;i&gt;please&lt;\/i&gt;/, 'escaped');
  assert.doesNotMatch((await bob('/')).text, /nudged you/);
  assert.doesNotMatch((await olive('/')).text, /nudged you/);

  // Only the recipient can dismiss it.
  const id = /\/nudges\/(\d+)\/dismiss/.exec(today)[1];
  await bob(`/nudges/${id}/dismiss`, { method: 'POST', form: {} });
  assert.match((await ann('/')).text, /nudged you/);
  await ann(`/nudges/${id}/dismiss`, { method: 'POST', form: {} });
  assert.doesNotMatch((await ann('/')).text, /nudged you/);

  // Asking for help from a person, or assigning to them, nudges them too.
  await olive(`${path}/action`, { method: 'POST', form: { action: 'help', from: 'bob@example.com' } });
  assert.match((await bob('/')).text, /Olive<\/strong> Asked for your help/);

  // A browser that has forgotten the subscription is dropped, not retried forever.
  pushFailure = Object.assign(new Error('gone'), { statusCode: 410 });
  await olive(`${path}/nudge`, { method: 'POST', form: { to: 'ann@example.com' } });
  await new Promise((r) => setTimeout(r, 150));
  pushFailure = null;
  assert.equal(db.prepare('SELECT count(*) AS n FROM push_subscriptions').get().n, 0);
});

test('a call prints as a plain sheet, and only to someone signed in', async () => {
  const olive = await signedIn();
  const path = (await olive('/calls', { method: 'POST', form: {} })).location;
  await olive(`${path}/save`, { method: 'POST', json: true, form: { request: 'Hydraulic hose <script>alert(1)</script>', notes: 'Ask for Dale', app_make: 'Case' } });
  const sheet = await olive(`${path}/print`);
  assert.equal(sheet.status, 200);
  assert.match(sheet.text, new RegExp(`Call #${path.split('/').pop()}`));
  assert.match(sheet.text, /Hydraulic hose &lt;script&gt;/);
  assert.match(sheet.text, /Ask for Dale/);
  assert.match(sheet.text, /Printed .* by Olive/);
  assert.doesNotMatch(sheet.text, /<nav/);
  assert.doesNotMatch(sheet.text, /<script>alert/);
  assert.equal((await browser()(`${path}/print`)).location, '/staff/sign-in');
  assert.equal((await olive('/calls/999999/print')).status, 404);
});

test('reports show how fast calls are picked up, to managers and owners only', async () => {
  const olive = await signedIn();
  const ann = await signedIn(['staff'], 'ann@example.com', 'Ann');
  const path = (await olive('/calls', { method: 'POST', form: {} })).location;
  await olive(`${path}/action`, { method: 'POST', form: { action: 'claim' } });
  await olive(`${path}/action`, { method: 'POST', form: { action: 'close', outcome: 'sold' } });
  const page = (await olive('/reports')).text;
  assert.match(page, /How fast/);
  assert.match(page, /Median wait to pick up/);
  assert.match(page, /By person/);
  const csv = await olive('/reports/timing.csv?days=7');
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^Call,Started,Picked up,Finished,Wait \(s\),Handled \(s\),Outcome,Taken by/);
  assert.equal((await ann('/reports')).status, 403);
  assert.equal((await ann('/reports/timing.csv')).status, 403);
});

test('the service worker is public; metrics need the token; request logs carry routes, never ids or queries', async () => {
  const lines = [];
  const second = await createWeb({
    db,
    config: { ...config, metricsToken: 'scrape-token-1234', logRequests: true },
    log: createLogger({ requests: true, out: (l) => lines.push(JSON.parse(l)), err: (l) => lines.push(JSON.parse(l)) }),
  });
  await new Promise((resolve) => second.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${second.server.address().port}`;
  try {
    const worker = await fetch(`${origin}/sw.js`);
    assert.equal(worker.status, 200);
    assert.match(await worker.text(), /showNotification/);
    assert.equal((await fetch(`${origin}/metrics`)).status, 404);
    assert.equal((await fetch(`${origin}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status, 404);
    await fetch(`${origin}/healthz`);
    await fetch(`${origin}/calls/12345?q=secret-term`, { redirect: 'manual' });
    await fetch(`${origin}/some/random/${Date.now()}`, { redirect: 'manual' });
    const metrics = await (await fetch(`${origin}/metrics`, { headers: { authorization: 'Bearer scrape-token-1234' } })).text();
    assert.match(metrics, /callstore_http_request_duration_seconds_count\{method="GET",route="\/healthz",status="2xx"\} 1/);
    assert.match(metrics, /callstore_open_calls \d+/);
    assert.doesNotMatch(metrics, /12345|secret-term|random/);
    const logged = lines.filter((l) => l.msg === 'request');
    assert.ok(logged.some((l) => l.route === '/healthz' && l.status === 200 && typeof l.ms === 'number'));
    assert.doesNotMatch(JSON.stringify(lines), /12345|secret-term/);
  } finally {
    second.server.closeAllConnections?.();
    second.server.close();
  }
});

test('text cut in the middle of an emoji, or sent with a stray surrogate half, never breaks a page', async () => {
  const olive = await signedIn();
  const path = (await olive('/calls', { method: 'POST', form: {} })).location;
  // The emoji straddles each field's length limit, so trimming would cut it in two.
  const cut = (max) => 'a'.repeat(max - 1) + '🙂 more';
  const saved = await olive(`${path}/save`, { method: 'POST', json: true, form: { request: cut(2000), notes: cut(5000), caller_name: cut(120), part_numbers: cut(500), app_freeform: cut(1000), app_make: cut(120) } });
  assert.equal(saved.status, 200, saved.text);
  // A lone surrogate half, as a hand-built request can send it.
  const stray = await olive(`${path}/save`, { method: 'POST', json: true, form: { revision: String(saved.json().revision), request: 'before \ud83d after' } });
  assert.equal(stray.status, 200, stray.text);
  for (const where of [path, `${path}/print`, '/calls', '/']) {
    const page = await olive(where);
    assert.equal(page.status, 200, `${where} broke: ${page.text.slice(0, 200)}`);
    assert.ok(page.text.isWellFormed(), `${where} sent a lone surrogate`);
  }
  await olive('/customers', { method: 'POST', form: { name: `${'n'.repeat(119)}🙂`, kind: 'person' } });
  assert.equal((await olive('/customers')).status, 200);
  await olive('/items', { method: 'POST', form: { sku: 'EMO-1', name: `${'n'.repeat(199)}🙂` } });
  assert.equal((await olive('/items')).status, 200);
  assert.equal((await olive('/calls?q=' + encodeURIComponent('x'.repeat(79) + '🙂'))).status, 200);
});

test('quick entry: lines are added over JSON and by plain form post, the page keeps the vehicle, and text is escaped', async () => {
  const olive = await signedIn();
  const path = (await olive('/calls', { method: 'POST', form: {} })).location;
  const first = await olive(`${path}/lines`, { method: 'POST', json: true, form: { text: '90 eclipse front brakes' } });
  assert.equal(first.status, 200);
  assert.equal(first.json().lines[0].vehicle.model, 'Eclipse');
  const second = await olive(`${path}/lines`, { method: 'POST', json: true, form: { text: 'rear brakes' } });
  assert.equal(second.json().lines[1].vehicle.model, 'Eclipse');
  assert.ok(second.json().revision > first.json().revision);

  const plain = await olive(`${path}/lines`, { method: 'POST', form: { text: '<script>alert(1)</script> wheel bearing' } });
  assert.equal(plain.status, 303);
  const page = (await olive(path)).text;
  assert.match(page, /id="quick-entry"/);
  assert.match(page, /\/assets\/islands\/quick-entry\.js/);
  assert.doesNotMatch(page.replace(/data-config="[^"]*"/g, ''), /<script>alert\(1\)/);
  assert.equal((await olive(`${path}/lines`, { method: 'POST', json: true, form: { text: '  ' } })).status, 409);
  assert.equal((await olive(`${path.replace(/\d+$/, '99999')}/lines`, { method: 'POST', json: true, form: { text: 'oil filter' } })).status, 404);
  assert.equal((await olive('/assets/islands/quick-entry.js')).status, 200);

  const id = second.json().lines[0].id;
  const removed = await olive(`${path}/lines`, { method: 'POST', json: true, form: { action: 'remove', line: String(id) } });
  assert.equal(removed.json().lines.length, 2);
  const done = await olive(`${path}/lines`, { method: 'POST', json: true, form: { action: 'done', line: String(removed.json().lines[0].id), done: '1' } });
  assert.equal(done.json().lines[0].done, true);
});
