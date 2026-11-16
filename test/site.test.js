import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createWeb } from '../src/web/server.js';
import { jsonLd } from '../src/web/site.js';
import { SHOP } from '../src/domain/shop.js';

const FRIDAY_NOON = Date.parse('2026-11-13T17:00:00Z'); // 12:00 in New York
const FRIDAY_NIGHT = Date.parse('2026-11-14T02:00:00Z'); // 9 PM Friday

async function boot(t, { time = FRIDAY_NOON, publicUrl = '' } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  const config = { production: false, port: 0, business: 'Southern Auto Supply', zone: 'America/New_York', secret: 'x'.repeat(40), proxies: 0, publicUrl };
  const clock = { t: time };
  const web = await createWeb({ db, config, now: () => clock.t });
  await new Promise((r) => web.server.listen(0, '127.0.0.1', r));
  t.after(() => web.server.close());
  return { base: `http://127.0.0.1:${web.server.address().port}`, web, clock, db };
}
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '');

test('the home page is the shop’s own page for anyone signed out', async (t) => {
  const { base } = await boot(t);
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  const html = await res.text();
  const text = strip(html);
  assert.match(text, /<h1>Southern Auto Supply<\/h1>/);
  assert.match(text, /Open until 6 PM/);
  assert.match(text, /1450 Maryland Highway/);
  assert.match(text, /href="tel:\+13013341200"/);
  assert.match(text, /href="\/portal\/login"/);
  assert.match(text, /href="\/staff\/sign-in"/);
  assert.match(text, /7:30 AM to 6 PM/);
  assert.match(text, /Hydraulic hose/);
  assert.doesNotMatch(text, /Call desk/, 'the internal app name stays off the public page');
  assert.doesNotMatch(text, /Nu Finish|Patriot Motors/, 'other businesses are only named once the owner agrees');
  assert.match(html, /<title>Southern Auto Supply \| NAPA Auto Parts in Mt\. Lake Park, MD<\/title>/);
  assert.match(html, /name="description" content="[^"]{80,160}"/, 'a description of search-result length');
  assert.match(html, /name="robots" content="index, follow/);
  assert.match(html, /<link rel="canonical" href="http[^"]+\/">/);
  assert.match(html, /property="og:image" content="http[^"]+\/assets\/og-image\.jpg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([^]*?)<\/script>/.exec(html)[1]);
  assert.equal(ld['@type'], 'AutoPartsStore');
  assert.ok(ld.makesOffer.length >= 8 && ld.areaServed.length >= 2 && ld.image.length === 1);
  for (const path of ['/assets/og-image.jpg', '/assets/logo.webp', '/assets/icon-512.png', '/favicon.ico']) {
    const asset = await fetch(`${base}${path}`, { redirect: 'manual' });
    assert.ok([200, 301].includes(asset.status), path);
  }
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.name, 'Southern Auto Supply');
  const csp = res.headers.get('content-security-policy');
  assert.doesNotMatch(csp, /wasm-unsafe-eval/);
});

test('it says closed after hours, and shows a closure a manager added', async (t) => {
  const { base, clock, web } = await boot(t, { time: FRIDAY_NIGHT });
  assert.match(strip(await (await fetch(`${base}/`)).text()), /Closed\. Opens tomorrow at 7:30 AM/);
  clock.t = Date.parse('2026-11-14T17:00:00Z');
  const manager = { email: 'm@example.com', name: 'M', roles: ['manager'] };
  assert.ok(web.app.hours.set(manager, { date: '2026-11-26', note: 'Thanksgiving' }).ok);
  assert.match(strip(await (await fetch(`${base}/`)).text()), /Closed \(Thanksgiving\)/);
});

test('structured data is valid JSON, can’t break out of its script tag, and carries the hours', () => {
  const evil = { ...SHOP, name: '</script><script>alert(1)</script>' };
  const raw = jsonLd(evil, 'https://example.com');
  assert.doesNotMatch(raw, /</);
  const data = JSON.parse(raw);
  assert.equal(data['@type'], 'AutoPartsStore');
  assert.equal(data.openingHoursSpecification.length, 7);
  assert.equal(data.address.postalCode, '21550');
  assert.equal(data.url, 'https://example.com');
});

test('robots keeps private areas out; the sitemap needs a public address', async (t) => {
  const plain = await boot(t);
  const robots = await (await fetch(`${plain.base}/robots.txt`)).text();
  for (const p of ['/staff', '/portal', '/join/', '/hello/', '/badge/', '/d/']) assert.match(robots, new RegExp(`Disallow: ${p}`));
  assert.doesNotMatch(robots, /Sitemap/);
  assert.equal((await fetch(`${plain.base}/sitemap.xml`, { redirect: 'manual' })).status, 303, 'no public address, no sitemap');
  const live = await boot(t, { publicUrl: 'https://southernauto.example/' });
  assert.match(await (await fetch(`${live.base}/robots.txt`)).text(), /Sitemap: https:\/\/southernauto\.example\/sitemap\.xml/);
  const map = await (await fetch(`${live.base}/sitemap.xml`)).text();
  assert.match(map, /<loc>https:\/\/southernauto\.example\/<\/loc>/);
  const page = await (await fetch(`${live.base}/`)).text();
  assert.match(page, /rel="canonical" href="https:\/\/southernauto\.example\/"/);
});

test('private pages stay private, and posting to / does nothing public', async (t) => {
  const { base } = await boot(t);
  for (const path of ['/calls', '/customers', '/items', '/hours', '/outbox', '/reports']) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    assert.equal(res.status, 303, path);
    assert.equal(res.headers.get('location'), '/staff/sign-in', path);
  }
  const json = await fetch(`${base}/`, { headers: { accept: 'application/json' }, redirect: 'manual' });
  assert.equal(json.status, 401);
  const post = await fetch(`${base}/`, { method: 'POST', redirect: 'manual' });
  assert.notEqual(post.status, 200);
});
