// The call page is sent at once and the vehicle matches are filled in when they are ready.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';
import { bounded } from '../src/web/stream.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0, lookupTimeoutMs: 1500 };
let web;
let base;
let cookie = '';
const delays = { ms: 0, hang: false };
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fetcher = async (url) => {
  const u = String(url);
  if (u.includes('GetModelsForMakeYear/make/Ford')) {
    if (delays.hang) return new Promise(() => {});
    await new Promise((r) => setTimeout(r, delays.ms));
    return json({ Results: [{ Make_Name: 'FORD', Model_Name: 'F-150' }] });
  }
  if (u.includes('GetModelsForMakeYear')) return json({ Results: [] });
  return json({ menuItem: [] });
};
const me = async (path, { method = 'GET', form } = {}) => {
  const r = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return r;
};
/** Fetch a page and note when the first piece and the last arrived. */
async function timed(path) {
  const started = performance.now();
  const r = await me(path);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  const firstAt = performance.now() - started;
  let all = first;
  for (let c = await reader.read(); !c.done; c = await reader.read()) all += decoder.decode(c.value);
  return { first, all, firstAt, doneAt: performance.now() - started, status: r.status, headers: r.headers };
}
async function newCall(year) {
  const call = (await me('/calls', { method: 'POST', form: {} })).headers.get('location');
  const m = await me(`${call}/vehicle/match`, { method: 'POST', form: { vq: `${year} f150` } });
  return m.headers.get('location');
}

before(async () => {
  const db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config, fetcher, ai: { enabled: false } });
  await new Promise((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${web.server.address().port}`;
  const token = await web.staff.setup();
  await me('/staff/accept', { method: 'POST', form: { token, email: 'olive@example.com', name: 'Olive', password: 'correct horse battery' } });
});
after(() => {
  web.server.closeAllConnections?.();
  web.server.close();
});

test('the page arrives before a slow vehicle lookup finishes, and the matches fill in after', async () => {
  delays.ms = 700;
  const where = await newCall(2011);
  const t = await timed(where);
  assert.equal(t.status, 200);
  assert.match(t.first, /Finding the closest match/, 'the first piece already holds the whole page, with a placeholder');
  assert.match(t.first, /<\/html>|<\/body>/, 'and is a complete document');
  assert.ok(!t.first.includes('F-150'), 'the answer is not in it');
  assert.ok(t.firstAt < 400, `first piece took ${Math.round(t.firstAt)} ms`);
  assert.ok(t.doneAt >= 650, `the rest waited for the lookup (${Math.round(t.doneAt)} ms)`);
  assert.match(t.all, /<strong>Ford F-150<\/strong>/);
  assert.equal(t.headers.get('x-accel-buffering'), 'no');
  assert.match(t.headers.get('content-security-policy'), /nonce-/);
  const nonce = /nonce-([^';]+)/.exec(t.headers.get('content-security-policy'))[1];
  for (const script of t.all.match(/<script(?![^>]*src=)[^>]*>/g)) assert.ok(script.includes(`nonce="${nonce}"`), `inline script without the page's nonce: ${script}`);
});

test('a lookup that never finishes stops waiting, and the page still completes', async () => {
  delays.hang = true;
  const where = await newCall(2012);
  const t = await timed(where);
  delays.hang = false;
  assert.equal(t.status, 200);
  assert.ok(t.doneAt < 4000, `finished in ${Math.round(t.doneAt)} ms`);
  assert.match(t.all, /vehicle lookup is slow right now/);
});

test('a failing lookup shows our words, never the real error', async () => {
  const real = web.app.vehicles.match;
  web.app.vehicles.match = async () => { throw new Error('SQLITE_CORRUPT: /var/data/secret.db'); };
  try {
    const where = await newCall(2013);
    const t = await timed(where);
    assert.match(t.all, /vehicle lookup is slow right now/);
    assert.ok(!/SQLITE_CORRUPT|secret\.db/.test(t.all));
  } finally {
    web.app.vehicles.match = real;
  }
});

test('a page with nothing to wait for is an ordinary page, and a closed tab does not leave work behind', async () => {
  const call = (await me('/calls', { method: 'POST', form: {} })).headers.get('location');
  const t = await timed(call);
  assert.equal(t.status, 200);
  assert.ok(!/zb-await|Finding the closest/.test(t.all));
  assert.equal(t.headers.get('x-accel-buffering'), null, 'not streamed');
  delays.ms = 800;
  const where = await newCall(2014);
  const controller = new AbortController();
  const r = await fetch(base + where, { headers: { cookie }, signal: controller.signal });
  await r.body.getReader().read();
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await me('/healthz')).status, 200, 'the server carried on');
});

test('bounded: settles in time, hides the real error, and clears its timer', async () => {
  assert.equal(await bounded(() => 7), 7);
  const seen = [];
  await assert.rejects(bounded(() => { throw new Error('secret'); }, { message: 'Nope', onError: (e) => seen.push(e.message) }), (e) => e.message === 'Nope');
  assert.deepEqual(seen, ['secret']);
  await assert.rejects(bounded(() => new Promise(() => {}), { ms: 20, message: 'Slow' }), (e) => e.message === 'Slow');
  await assert.rejects(bounded(() => Promise.reject({ not: 'an error' }), { message: 'Plain' }), (e) => e.message === 'Plain');
});
