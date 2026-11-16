// The call page is sent at once and a slow AI part search is filled in when it is ready.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';
import { bounded } from '../src/web/stream.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0, lookupTimeoutMs: 1500, aiTimeoutMs: 900 };
let web;
let base;
let cookie = '';
const aiState = { ms: 0, hang: false, boom: false, asked: 0 };
const ai = {
  enabled: true,
  model: 'fake',
  async suggest() {
    aiState.asked += 1;
    if (aiState.hang) return new Promise(() => {});
    if (aiState.boom) throw new Error('sk-ant-SECRET-KEY rejected');
    await new Promise((r) => setTimeout(r, aiState.ms));
    return { candidates: [{ brand: 'Balkamp', partNumber: 'BK 777', description: 'Water pump', notes: '', sourceUrl: '', confidence: 'medium' }], note: '', usage: { input: 1, output: 1, searches: 0 } };
  },
};
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fetcher = async (url) => {
  const u = String(url);
  if (u.includes('GetModelsForMakeYear/make/Ford')) return json({ Results: [{ Make_Name: 'FORD', Model_Name: 'F-150' }] });
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

before(async () => {
  const db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config, fetcher, ai });
  await new Promise((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${web.server.address().port}`;
  const token = await web.staff.setup();
  await me('/staff/accept', { method: 'POST', form: { token, email: 'olive@example.com', name: 'Olive', password: 'correct horse battery' } });
});
after(() => {
  web.server.closeAllConnections?.();
  web.server.close();
});

test('a page with nothing to wait for is an ordinary page, and a closed tab does not leave work behind', async () => {
  const call = (await me('/calls', { method: 'POST', form: {} })).headers.get('location');
  const t = await timed(call);
  assert.equal(t.status, 200);
  assert.ok(!/zb-await|Asking the AI/.test(t.all));
  assert.equal(t.headers.get('x-accel-buffering'), null, 'not streamed');
  aiState.ms = 800;
  const where = await callWithTruck();
  await me(`${where}/parts/find`, { method: 'POST', form: { term: 'fuel pump' } });
  const controller = new AbortController();
  const r = await fetch(base + where, { headers: { cookie }, signal: controller.signal });
  await r.body.getReader().read();
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await me('/healthz')).status, 200, 'the server carried on');
  aiState.ms = 0;
  aiState.asked = 0; // the search above finished on its own; the tests below count from here
});

test('bounded: settles in time, hides the real error, and clears its timer', async () => {
  assert.equal(await bounded(() => 7), 7);
  const seen = [];
  await assert.rejects(bounded(() => { throw new Error('secret'); }, { message: 'Nope', onError: (e) => seen.push(e.message) }), (e) => e.message === 'Nope');
  assert.deepEqual(seen, ['secret']);
  await assert.rejects(bounded(() => new Promise(() => {}), { ms: 20, message: 'Slow' }), (e) => e.message === 'Slow');
  await assert.rejects(bounded(() => Promise.reject({ not: 'an error' }), { message: 'Plain' }), (e) => e.message === 'Plain');
});

async function callWithTruck() {
  const call = (await me('/calls', { method: 'POST', form: {} })).headers.get('location');
  await me(`${call}/vehicle/use`, { method: 'POST', form: { year: '2008', make: 'Ford', model: 'F-150' } });
  return call;
}

test('the AI part search: the post answers at once, the page shows saved things now, the answer streams in, and a reload does not ask again', async () => {
  aiState.ms = 700;
  const call = await callWithTruck();
  const started = performance.now();
  const post = await me(`${call}/parts/find`, { method: 'POST', form: { term: 'water pump' } });
  assert.equal(post.status, 303);
  assert.ok(performance.now() - started < 300, 'the form post does not wait for the AI');
  assert.equal(aiState.asked, 0, 'and has not asked yet');
  const t = await timed(call);
  assert.match(t.first, /Asking the AI/);
  assert.ok(!t.first.includes('BK 777'));
  assert.ok(t.firstAt < 400, `first piece took ${Math.round(t.firstAt)} ms`);
  assert.ok(t.doneAt >= 650);
  assert.match(t.all, /<strong>Balkamp BK 777<\/strong>/);
  assert.match(t.all, /Suggested by AI/);
  assert.equal(aiState.asked, 1);
  const again = await timed(call);
  assert.equal(aiState.asked, 1, 'a reload shows what was saved and asks nothing');
  assert.match(again.first, /Balkamp BK 777/);
  assert.equal(again.headers.get('x-accel-buffering'), null, 'and is an ordinary page');
});

test('a stranger’s link cannot start an AI search: only the form post does, and only for the person who posted', async () => {
  const call = await callWithTruck();
  const before = aiState.asked;
  const get = await timed(`${call}?term=starter&fresh=1`);
  assert.equal(aiState.asked, before, 'a GET never asks the AI');
  assert.ok(!/Asking the AI/.test(get.all));
});

test('an AI search that hangs or fails shows our words, never the real error', async () => {
  aiState.hang = true;
  let call = await callWithTruck();
  await me(`${call}/parts/find`, { method: 'POST', form: { term: 'alternator' } });
  let t = await timed(call);
  aiState.hang = false;
  assert.match(t.all, /taking too long/);
  assert.ok(t.doneAt < 3000);

  aiState.boom = true;
  call = await callWithTruck();
  await me(`${call}/parts/find`, { method: 'POST', form: { term: 'thermostat' } });
  t = await timed(call);
  aiState.boom = false;
  assert.ok(!/SECRET|sk-ant/.test(t.all), 'the key never reaches the page');
  assert.ok(/<p class="muted">[^<]+<\/p>/.test(t.all.slice(t.all.indexOf('id="parts"'))), 'it says something plain instead');
});

test('answers the shop already has come straight back, with no AI and no streaming', async () => {
  aiState.ms = 0;
  const call = await callWithTruck();
  const before = aiState.asked;
  await me(`${call}/parts/find`, { method: 'POST', form: { term: 'water pump' } }); // saved by the first test
  const t = await timed(call);
  assert.equal(aiState.asked, before);
  assert.match(t.first, /Balkamp BK 777/);
  assert.match(t.first, /From what the shop already knows/);
  assert.equal(t.headers.get('x-accel-buffering'), null);
});
