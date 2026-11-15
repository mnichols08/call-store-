import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';

const config = { production: false, port: 0, business: 'Test Parts', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0 };
let web;
let base;
let db;
const asked = [];
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const ai = {
  enabled: true,
  model: 'fake',
  async suggest(request) {
    asked.push(request);
    return { candidates: [{ brand: 'Balkamp', partNumber: 'BK 777', description: '<img src=x onerror=alert(1)> Water pump', notes: '', sourceUrl: '', confidence: 'medium' }], note: '', usage: { input: 1, output: 1, searches: 0 } };
  },
};
const fetcher = async (url) => {
  const u = String(url);
  if (u.includes('DecodeVinValuesExtended')) return json({ Results: [{ Make: 'FORD', Model: 'F-150', ModelYear: '2008', DisplacementL: '5.4', EngineCylinders: '8', FuelTypePrimary: 'Gasoline', DriveType: '4WD/4-Wheel Drive/4x4', ErrorCode: '0' }] });
  if (u.includes('GetModelsForMakeYear/make/Ford')) return json({ Results: [{ Make_Name: 'FORD', Model_Name: 'F-150' }] });
  if (u.includes('GetModelsForMakeYear')) return json({ Results: [] });
  if (u.includes('menu/')) return json({ menuItem: [] });
  throw new Error(`unexpected ${u}`);
};

function browser() {
  let cookie = '';
  return async (path, { method = 'GET', form, json: wantsJson } = {}) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: base, 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(wantsJson ? { accept: 'application/json' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), text, json: () => JSON.parse(text), cookie };
  };
}
const sessions = new Map();
async function signedIn(roles = ['owner'], email = 'olive@example.com') {
  if (sessions.has(email)) return sessions.get(email);
  const me = browser();
  let token;
  if (web.staff.needsOwner()) token = await web.staff.setup();
  else {
    const boss = sessions.get('olive@example.com');
    const probe = await boss('/');
    token = (await web.staff.invite(web.staff.session({ headers: { cookie: probe.cookie || '' } }), { email, name: email, roles })).token;
  }
  assert.equal((await me('/staff/accept', { method: 'POST', form: { token, email, name: email, password: 'correct horse battery' } })).status, 303);
  sessions.set(email, me);
  return me;
}
const follow = async (me, r) => (r.status === 303 ? me(r.location) : r);

before(async () => {
  db = openDatabase(':memory:');
  migrate(db);
  web = await createWeb({ db, config, fetcher, ai });
  await new Promise((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${web.server.address().port}`;
});
after(() => {
  web.server.closeAllConnections?.();
  web.server.close();
});

test('VIN on a call fills the vehicle, and with a customer attached it is saved to them', async () => {
  const olive = await signedIn();
  const call = (await olive('/calls', { method: 'POST', form: {} })).location;
  const id = call.split('/').pop();
  assert.match((await olive(call)).text, /Vehicle lookup/);

  const bad = await follow(olive, await olive(`${call}/vehicle/vin`, { method: 'POST', form: { vin: 'nope' } }));
  assert.match(bad.text, /17 characters/);

  const customer = await olive('/customers', { method: 'POST', form: { name: 'Bubba Farms', kind: 'organization', phone_0: '5551230000', call: id } });
  assert.equal(customer.location.replace(/[?&](done|problem)=.*/, ''), call);
  const cid = String(web.app.calls.get({ email: 'x', roles: ['owner'] }, Number(id)).customer.id);

  const rawOk = await olive(`${call}/vehicle/vin`, { method: 'POST', form: { vin: '1FTPW14V28KC12345' } });
  assert.match(rawOk.location, /\?done=.*#vehicle$/, 'the message comes before the #section');
  const ok = await follow(olive, rawOk);
  assert.match(ok.text, /2008 Ford F-150 5\.4L V8 4WD/);
  assert.match(ok.text, /Saved to the customer/);
  assert.match(ok.text, /name="app_year" value="2008"|value="2008"/);
  assert.match((await olive(`/customers/${cid}`)).text, /VIN 1FTPW14V28KC12345/);
  const leaks = web.app.audit.recent(40).filter((e) => JSON.stringify(e).includes('1FTPW14V28KC12345')).map((e) => e.action);
  assert.deepEqual(leaks, ['call.application'], 'only the call’s own record holds the VIN; the lookup and save entries carry the end of it');

  // The next call for the same customer offers the vehicle without a VIN lookup.
  const next = (await olive('/calls', { method: 'POST', form: { customer: cid } })).location;
  const page = (await olive(next)).text;
  assert.match(page, /Bubba Farms’s vehicles|Bubba Farms&#39;s vehicles|vehicles<\/h3>/);
  assert.match(page, /name="saved"/);
  void id;
});

test('find by year and model shows the closest make, and "Use" puts it on the call', async () => {
  const olive = await signedIn();
  const call = (await olive('/calls', { method: 'POST', form: {} })).location;
  const posted = await olive(`${call}/vehicle/match`, { method: 'POST', form: { vq: '2008 f150' } });
  assert.match(posted.location, /vq=2008\+f150/);
  const page = (await olive(posted.location)).text;
  assert.match(page, /Ford F-150/);
  const used = await follow(olive, await olive(`${call}/vehicle/use`, { method: 'POST', form: { year: '2008', make: 'Ford', model: 'F-150' } }));
  assert.match(used.text, /On this call: <strong>2008 Ford F-150<\/strong>/);
  assert.equal((await olive(`${call}/vehicle/use`, { method: 'POST', form: { year: '2008' } })).status, 303);
});

test('parts finder: AI once, memory after, feedback buttons, AI text escaped, add to the call', async () => {
  const olive = await signedIn();
  const call = (await olive('/calls', { method: 'POST', form: {} })).location;
  await olive(`${call}/vehicle/use`, { method: 'POST', form: { year: '2008', make: 'Ford', model: 'F-150' } });
  const before = asked.length;
  const first = await follow(olive, await olive(`${call}/parts/find`, { method: 'POST', form: { term: 'water pump' } }));
  assert.equal(asked.length, before + 1);
  assert.match(first.text, /BK 777/);
  assert.match(first.text, /Suggested by AI/);
  assert.ok(!/<img src=x/.test(first.text), 'AI text can’t inject markup');
  assert.ok(!/onerror=alert/.test(first.text.replace(/&lt;[^]*?&gt;/g, '')), 'and no live handler survives');

  const call2 = (await olive('/calls', { method: 'POST', form: {} })).location;
  await olive(`${call2}/vehicle/use`, { method: 'POST', form: { year: '2008', make: 'Ford', model: 'F-150' } });
  const second = await follow(olive, await olive(`${call2}/parts/find`, { method: 'POST', form: { term: 'Water Pumps' } }));
  assert.equal(asked.length, before + 1, 'second call answered from memory');
  assert.match(second.text, /From what the shop already knows/);

  const answerId = /name="answer" value="(\d+)"/.exec(second.text)[1];
  const voted = await follow(olive, await olive(`/parts/${answerId}/feedback`, { method: 'POST', form: { result: 'worked', call: call2.split('/').pop() } }));
  assert.match(voted.text, /Confirmed by the shop/);
  const added = await follow(olive, await olive(`${call2}/parts/add`, { method: 'POST', form: { answer: answerId } }));
  assert.match(added.text, /BALKAMP BK 777/);
  const again = await follow(olive, await olive(`${call2}/parts/add`, { method: 'POST', form: { answer: answerId } }));
  assert.match(again.text, /BALKAMP BK 777/, 'adding twice reuses the catalog item');

  const fresh = await follow(olive, await olive(`${call2}/parts/find`, { method: 'POST', form: { term: 'water pump', fresh: '1' } }));
  assert.equal(asked.length, before + 2);
  assert.ok(fresh.text.includes('BK 777'));
});

test('picker endpoints, permissions and cross-site posts', async () => {
  const olive = await signedIn();
  const makes = await olive('/api/vehicle/makes?year=2008', { json: true });
  assert.ok(makes.json().makes.includes('Ford'));
  const models = await olive('/api/vehicle/models?year=2008&make=Ford', { json: true });
  assert.deepEqual(models.json().models, ['F-150']);

  const anon = browser();
  assert.equal((await anon('/api/vehicle/makes?year=2008', { json: true })).status, 401);
  const call = (await olive('/calls', { method: 'POST', form: {} })).location;
  const evil = await fetch(base + `${call}/vehicle/vin`, { method: 'POST', redirect: 'manual', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded', cookie: (await olive('/')).cookie }, body: 'vin=1FTPW14V28KC12345' });
  assert.equal(evil.status, 403);

  const staff = await signedIn(['staff'], 'sam@example.com');
  const staffCall = (await staff('/calls', { method: 'POST', form: {} })).location;
  assert.match((await staff(staffCall)).text, /Find the part/);
  assert.equal((await staff('/reports')).status, 403, 'AI spend is for managers');
  assert.match((await olive('/reports')).text, /Part finder/);
});
