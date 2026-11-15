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

test('watching: off by default, a manager turns it on, the watched person sees it, a suggestion lands on their call', async () => {
  const olive = await signedIn();
  const ann = await signedIn(['staff'], 'ann@example.com');
  const bob = await signedIn(['staff'], 'bob@example.com');
  const annCall = (await ann('/calls', { method: 'POST', form: {} })).location;
  await ann(`${annCall}/action`, { method: 'POST', form: { action: 'claim' } });
  await ann(`${annCall}/vehicle/use`, { method: 'POST', form: { year: '2008', make: 'Ford', model: 'F-150' } });
  await ann(`${annCall}/parts/find`, { method: 'POST', form: { term: 'water pump' } });

  assert.match((await bob('/watch')).text, /switched off/);
  assert.equal((await bob(`${annCall}/watch`)).status, 303, 'refused while off');
  assert.equal((await bob('/watch/setting', { method: 'POST', form: { enabled: '1' } })).status, 303);
  assert.match((await bob('/watch')).text, /switched off/, 'staff can’t switch it on');
  await olive('/watch/setting', { method: 'POST', form: { enabled: '1' } });
  assert.match((await bob('/watch')).text, /Watch<\/a>/);

  const view = await bob(`${annCall}/watch`);
  assert.equal(view.status, 200);
  assert.match(view.text, /Their part search/);
  assert.match(view.text, /BK 777/);
  assert.ok(!/Put on call/.test(view.text), 'watchers can’t act on the call');
  assert.match((await ann(annCall)).text, /bob@example\.com is watching this call/);
  assert.deepEqual((await ann(`${annCall}/watchers`, { json: true })).json().names, ['bob@example.com']);
  assert.equal((await ann(`${annCall}/watch`)).status, 303, 'nobody watches their own call');

  const sent = await follow(bob, await bob(`${annCall}/suggest`, { method: 'POST', form: { term: 'water pump', brand: 'NAPA', part_number: 'NWP 42', note: '<b>in stock</b>' } }));
  assert.match(sent.text, /Sent\./);
  const page = (await ann(annCall)).text;
  assert.match(page, /NAPA NWP 42/);
  assert.ok(!page.includes('<b>in stock</b>'), 'a note is escaped');
  const id = /action="\/suggestions\/(\d+)\/accept"/.exec(page)[1];
  assert.equal((await bob(`/suggestions/${id}/accept`, { method: 'POST', form: {} })).location.includes('problem'), true, 'only the holder answers');
  const taken = await follow(ann, await ann(`/suggestions/${id}/accept`, { method: 'POST', form: {} }));
  assert.match(taken.text, /NAPA NWP 42 is on the call/);
  const again = await follow(ann, await ann(`${annCall}/parts/find`, { method: 'POST', form: { term: 'water pump' } }));
  assert.match(again.text, /NAPA NWP 42/, 'accepting taught the shop');
  assert.match(again.text, /Added by staff|Confirmed by the shop/);
});

// ---------------------------------------------------------------- measurements, photos, the customer link
const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
const photo = () => Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xe1, Buffer.from('Exif\0\0GPS SECRET')), seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34]), Buffer.from([0xff, 0xd9])]);
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { origin: base, ...headers }, body });

test('the customer link: no sign-in, only for its request, measurements and photos arrive for staff, nothing else opens', async () => {
  const olive = await signedIn();
  const call = (await olive('/calls', { method: 'POST', form: {} })).location;
  const id = call.split('/').pop();
  await olive(`${call}/action`, { method: 'POST', form: { action: 'claim' } });
  const cookie = (await olive('/')).cookie;

  const made = await olive(`${call}/details/link`, { method: 'POST', form: {} });
  assert.equal(made.status, 200);
  const url = /value="(http[^"]+\/d\/[A-Za-z0-9_-]+)"/.exec(made.text)[1];
  const path = new URL(url).pathname;
  assert.ok(!web.app.details.get({ email: 'o', roles: ['owner'] }, Number(id)).links.token, 'the token isn’t kept');

  const stranger = await fetch(base + path);
  const page = await stranger.text();
  assert.equal(stranger.status, 200);
  assert.match(page, /Help us get the right part/);
  assert.ok(!/Sign out|href="\/calls|href="\/customers/.test(page), 'a customer sees no staff navigation');
  assert.equal(stranger.headers.get('referrer-policy'), 'no-referrer');
  assert.match(stranger.headers.get('x-robots-tag'), /noindex/);
  assert.match(stranger.headers.get('cache-control'), /no-store/);
  assert.match(await (await fetch(`${base}${path}?type=bearing`)).text(), /Inner diameter/);

  assert.equal((await fetch(base + '/d/' + 'a'.repeat(32))).status, 404, 'a wrong link says nothing');
  assert.equal((await fetch(base + call, { redirect: 'manual' })).status, 303, 'and a link doesn’t open the staff page');

  const sent = await post(`${path}/details`, 'type=bearing&unit=mm&f_id=25&f_od=52&f_width=15&note=from+a+pump', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(sent.status, 303);
  assert.match(sent.headers.get('location'), /saved=1/);
  const wrong = await post(`${path}/details`, 'type=bearing&unit=mm&f_id=abc', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.match(wrong.headers.get('location'), /problem=1/);
  assert.equal((await post(`${path}/details`, 'type=bearing', { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' })).status, 403, 'cross-site posts are refused');

  assert.equal((await post(`${path}/photo`, photo(), { 'content-type': 'image/jpeg' })).status, 200);
  assert.equal((await post(`${path}/photo`, Buffer.from('<script>alert(1)</script>'), { 'content-type': 'image/jpeg' })).status, 400);
  const big = await post(`${path}/photo`, Buffer.alloc(7 * 1024 * 1024, 1), { 'content-type': 'image/jpeg' }).then((r) => r.status, () => 'connection closed');
  assert.ok([413, 'connection closed'].includes(big), 'an oversized upload is refused or cut off');

  const staff = (await olive(call)).text;
  assert.match(staff, /<strong>Bearing<\/strong>: Inner diameter 25 mm/);
  assert.match(staff, /From the customer/);
  const src = /<img src="(\/calls\/\d+\/photos\/\d+)"/.exec(staff)[1];
  const image = await fetch(base + src, { headers: { cookie } });
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.match(image.headers.get('content-security-policy'), /sandbox/);
  assert.ok(!Buffer.from(await image.arrayBuffer()).includes('SECRET'), 'the location text is gone');
  assert.equal((await fetch(base + src, { redirect: 'manual' })).status, 303, 'a photo isn’t public');
  assert.match(staff, /The customer sent a photo|Measurements filled in/);

  const found = await follow(olive, await olive(`${call}/parts/find`, { method: 'POST', form: { measure: '1' } }));
  assert.match(found.text, /BK 777/, 'staff find parts by the customer’s measurements');

  await olive(`${call}/details/link/revoke`, { method: 'POST', form: {} });
  assert.equal((await fetch(base + path)).status, 404, 'turned off');
});

test('a wrong-link guesser is slowed down', async () => {
  let last;
  for (let i = 0; i < 20; i += 1) last = await fetch(`${base}/d/${String(i).padStart(2, '0')}${'b'.repeat(30)}`);
  assert.equal(last.status, 429);
});
