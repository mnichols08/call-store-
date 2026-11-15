import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0 };
const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), Buffer.from([0xff, 0xd9])]);
const READING = { dateText: 'Tues 11-10-26', date: '2026-11-10', rows: [
  { lineCode: 'ECH', partNumber: 'OP6603', orderedFrom: 'ALT', customer: 'Beckman Trucking', received: true, paid: true, unsure: [] },
  { lineCode: 'ATM', partNumber: '42322', orderedFrom: '1 AH', customer: '<img src=x onerror=alert(1)>', unsure: ['customer'] },
] };
let web; let base; let db; let calls = 0;
const sessions = new Map();

function browser() {
  let cookie = '';
  const request = async (path, { method = 'GET', form, raw, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, ...(raw ? { 'content-type': 'image/jpeg', accept: 'application/json' } : { 'content-type': 'application/x-www-form-urlencoded' }) } : {}), ...headers }, body: raw ?? (form ? new URLSearchParams(form) : undefined) });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), text, json: () => JSON.parse(text) };
  };
  return Object.defineProperty(request, 'cookie', { get: () => cookie });
}
async function signedIn(roles, email, name) {
  if (sessions.has(email)) return sessions.get(email);
  const me = browser();
  const token = web.staff.needsOwner() ? await web.staff.setup() : (await web.staff.invite(web.staff.session({ headers: { cookie: sessions.get('olive@example.com').cookie } }), { email, name, roles })).token;
  await me('/staff/accept', { method: 'POST', form: { token, email, name, password: 'correct horse battery' } });
  sessions.set(email, me);
  return me;
}
before(async () => {
  db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config, ai: { enabled: true, suggest: async () => ({ candidates: [] }), readSheet: async () => { calls += 1; return { reading: READING, usage: { input: 1, output: 1 } }; } } });
  await new Promise((r) => web.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${web.server.address().port}`;
});
after(() => { web.server.closeAllConnections?.(); web.server.close(); });

test('a manager scans a page, checks the lines, saves them, and everyone can see and tick them off', async () => {
  const owner = await signedIn(['owner'], 'olive@example.com', 'Olive');
  const staff = await signedIn(['staff'], 'sam@example.com', 'Sam');
  assert.match((await owner('/orders/scan')).text, /id="sheet-file"/);
  const read = await owner('/orders/read', { method: 'POST', raw: jpeg });
  assert.equal(read.status, 200);
  const { html } = read.json();
  assert.match(html, /name="count" value="2"/);
  assert.doesNotMatch(html, /<img src=x/, 'what the AI read is escaped');
  assert.equal(db.prepare('SELECT count(*) n FROM special_orders').get().n, 0, 'reading saves nothing');
  const form = { count: '2', date: '2026-11-10', code_0: 'ECH', part_0: 'OP6603', from_0: 'ALT', cust_0: 'Beckman Trucking', keep_0: '1', got_0: '1', paid_0: '1', code_1: 'ATM', part_1: '42322', from_1: '1 AH', cust_1: 'Blaine', keep_1: '1' };
  const saved = await owner('/orders/save', { method: 'POST', form });
  assert.equal(saved.status, 303);
  assert.match(decodeURIComponent(saved.location.replace(/\+/g, " ")), /Saved 2 orders/);
  const list = await staff('/orders');
  assert.equal(list.status, 200);
  assert.match(list.text, /OP6603/);
  assert.match(list.text, /Tuesday, November 10, 2026/);
  assert.doesNotMatch(list.text, /Scan a page/, 'staff don’t see the scan button');
  const id = db.prepare("SELECT id FROM special_orders WHERE part_number = '42322'").get().id;
  assert.equal((await staff(`/orders/${id}/mark`, { method: 'POST', form: { field: 'received', value: '1' } })).status, 303);
  assert.equal(db.prepare('SELECT received FROM special_orders WHERE id = ?').get(id).received, 1);
  assert.equal((await staff(`/orders/${id}/mark`, { method: 'POST', form: { field: 'note', value: '1' } })).status, 303, 'unknown fields change nothing');
  assert.equal((await staff(`/orders/${id}/remove`, { method: 'POST' })).status, 403);
  assert.match((await staff('/orders?q=blaine')).text, /42322/);
  assert.doesNotMatch((await staff('/orders?q=beckman')).text, /42322/);
});

test('staff can’t scan or save; a signed-out visitor is sent to sign in', async () => {
  const staff = await signedIn(['staff'], 'sam@example.com', 'Sam');
  const before = calls;
  const read = await staff('/orders/read', { method: 'POST', raw: jpeg });
  assert.equal(read.status, 403);
  assert.equal(calls, before, 'the AI is never asked for someone who may not use it');
  assert.equal((await staff('/orders/scan')).status, 403);
  assert.equal((await staff('/orders/save', { method: 'POST', form: { count: '1', date: '2026-11-10', part_0: 'X', keep_0: '1' } })).status, 403);
  const anon = browser();
  assert.equal((await anon('/orders')).location, '/staff/sign-in');
  assert.equal((await anon('/orders/read', { method: 'POST', raw: jpeg })).status, 401);
});

test('reading photos is limited per person, so a stuck button can’t run up the AI bill', async () => {
  const owner = await signedIn(['owner'], 'olive@example.com', 'Olive');
  let last;
  for (let i = 0; i < 20; i += 1) last = await owner('/orders/read', { method: 'POST', raw: jpeg });
  assert.equal(last.status, 429);
  assert.match(last.json().message, /try again later/i);
});
