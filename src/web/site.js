// The shop's public page. Southern Auto Supply has no other website, so this is it: who we are, when
// we're open, where to find us, and a way in to order parts online.
import { esc } from './html.js';
import { layout, logoHtml } from './ui.js';
import { SHOP } from '../domain/shop.js';
import { openingSpec, weekTable } from '../domain/hours.js';

const tel = (shop) => `tel:${shop.phoneLink}`;
const mapsUrl = (a) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.street}, ${a.city}, ${a.state} ${a.zip}`)}`;
const ICON = {
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5.5a3 3 0 010 5.5M18 14c2 .7 3 2.7 3 6',
  car: 'M3 15l2-6h14l2 6v4h-3v-2H6v2H3zM6 15h12M7 12h10',
  engine: 'M4 9h3l1-2h6l1 2h3v7h-3l-1 2H8l-1-2H4zM2 12h2M20 12h2',
  brakes: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 9a3 3 0 100 6 3 3 0 000-6z',
  spring: 'M12 3v3l-4 2 8 3-8 3 8 3-4 2v3',
  bolt: 'M13 2L5 14h6l-1 8 8-12h-6z',
  drop: 'M12 3s6 6 6 10a6 6 0 01-12 0c0-4 6-10 6-10z',
  pipe: 'M3 9h11a5 5 0 015 5v1M3 15h8',
  gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  body: 'M5 17V9l3-4h8l3 4v8M5 13h14M8 17v2M16 17v2',
  hose: 'M4 6h5a4 4 0 010 8H8a3 3 0 000 6h10M4 6V4M18 20h2',
  paint: 'M12 3s6 6 6 10a6 6 0 01-12 0c0-4 6-10 6-10zM9 14a3 3 0 003 3',
  battery: 'M3 8h15v10H3zM18 11h3v4h-3M7 11v4M5 13h4',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
};
const list = (rows) => `<ul class="cards">${rows.map(([h, t]) => `<li><strong>${esc(h)}</strong><span>${esc(t)}</span></li>`).join('')}</ul>`;

/** Structured data for search engines: the shop as a local business. Everything in it is escaped for a script tag. */
export function jsonLd(shop, url) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'AutoPartsStore',
    name: shop.name,
    description: shop.tagline,
    telephone: shop.phone,
    email: shop.email,
    foundingDate: '1981',
    ...(url ? { url } : {}),
    address: { '@type': 'PostalAddress', streetAddress: shop.address.street, addressLocality: shop.address.city, addressRegion: shop.address.state, postalCode: shop.address.zip, addressCountry: 'US' },
    openingHoursSpecification: openingSpec(shop.hours),
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function createSite({ config, app, now, shop = SHOP }) {
  const base = () => (config.publicUrl ? config.publicUrl.replace(/\/$/, '') : '');

  function body() {
    const state = app.hours.state();
    const closures = app.hours.upcoming(30);
    const week = weekTable(now(), config.zone, shop.hours);
    const a = shop.address;
    const year = new Date(now()).getUTCFullYear();
    const years = year - 1981;
    const days = Object.keys(shop.hours).length;
    const facts = [
      [`${years}+`, 'Years serving the area'],
      ['NAPA', 'Nationwide warranty'],
      [`${days} days`, 'A week, open'],
      [shop.delivers ? 'We deliver' : 'Special orders', shop.delivers ? 'Parts to your door' : 'Not on the shelf? Ask'],
    ];
    const cards = (rows, icons = []) => `<ul class="tiles">${rows.map(([h, t], i) => `<li>${icons[i] ? `<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[i]}"/></svg></span>` : ''}<h3>${esc(h)}</h3><p>${esc(t)}</p></li>`).join('')}</ul>`;
    return `
<header class="top">
  <div class="wrap bar">
    ${logoHtml(shop.name)}
    <nav aria-label="Main"><a href="#parts">Parts</a><a href="#online">Order online</a><a href="#hours">Hours</a><a href="#find">Find us</a></nav>
    <a class="btn yellow" href="${tel(shop)}">Call<span class="num">&nbsp;${esc(shop.phone)}</span></a>
  </div>
</header>

<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="pill">${esc(shop.tagline)}</p>
      <h1>${esc(shop.name)}</h1>
      <p class="big">The right part, <span>right here.</span></p>
      <p class="lede">${esc(shop.intro)}</p>
      <p class="open-now ${state.open ? 'is-open' : 'is-closed'}" role="status"><span class="dot" aria-hidden="true"></span>${esc(state.text)}</p>
      <div class="actions">
        <a class="btn yellow lg" href="${tel(shop)}">Call ${esc(shop.phone)}</a>
        <a class="btn light lg" href="/portal/login">Order parts online</a>
        <a class="btn ghost lg" href="${esc(mapsUrl(a))}" rel="noopener">Directions</a>
      </div>
    </div>
    <div class="art"><img src="/assets/bg-ram-2500-southern-bg.webp" width="1254" height="1254" alt="Southern Auto Supply, a NAPA Auto Parts store" fetchpriority="high"></div>
  </div>
</section>

<section class="band" aria-label="At a glance"><div class="wrap facts">${facts.map(([v, l]) => `<div><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`).join('')}</div></section>

<section class="sec" id="why"><div class="wrap">
  <header class="head"><p class="kicker">Why us</p><h2>Why shop with us</h2></header>
  ${cards(shop.why, [ICON.clock, ICON.shield, ICON.people, ICON.car])}
</div></section>

<section class="sec alt" id="parts"><div class="wrap">
  <header class="head"><p class="kicker">What we carry</p><h2>Parts for cars, trucks, and equipment</h2><p>Domestic and foreign.</p></header>
  ${cards(shop.categories, [ICON.engine, ICON.brakes, ICON.spring, ICON.bolt, ICON.drop, ICON.pipe, ICON.gear, ICON.body])}
</div></section>

<section class="sec dark" id="specialties"><div class="wrap">
  <header class="head"><p class="kicker">Only here</p><h2>Specialty services</h2></header>
  ${cards(shop.specialties, [ICON.hose, ICON.paint, ICON.battery, ICON.box])}
</div></section>

<section class="sec" id="online"><div class="wrap split">
  <div>
    <header class="head left"><p class="kicker">Order online</p><h2>Send us a request any time</h2></header>
    <ol class="steps">
      <li><b>01</b><div><h3>Tell us what you need</h3><p>Add photos and measurements, or just describe the part.</p></div></li>
      <li><b>02</b><div><h3>We find it</h3><p>We check requests as soon as we open and get back to you.</p></div></li>
      <li><b>03</b><div><h3>${shop.delivers ? 'Pick it up or have it delivered' : 'Pick it up'}</h3><p>Watch it move from received to ready.</p></div></li>
    </ol>
    <div class="actions"><a class="btn blue lg" href="/portal/login">Sign in to order parts</a></div>
    <p class="muted">No account yet? Ask at the counter or call us and we’ll send you a link.</p>
  </div>
  <aside class="card">
    <h3>Need parts after hours?</h3>
    <p>${esc(shop.afterHours)}</p>
    <p><a class="btn outline" href="${esc(shop.napaOnline)}" rel="noopener">NAPA Online</a></p>
  </aside>
</div></section>

<section class="sec pros" id="pros"><div class="wrap split">
  <div><header class="head left"><p class="kicker">Professionals and fleets</p><h2>Built for the people who fix things</h2></header>
    <p>Mechanics, body shops, and fleet managers get ${shop.professionals.map((x) => esc(x.toLowerCase())).join(', ')}. Call us, or ask for an account.</p>
    <div class="actions"><a class="btn yellow lg" href="${tel(shop)}">Call ${esc(shop.phone)}</a></div></div>
  <ul class="checks">${shop.professionals.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
</div></section>

<section class="sec alt" id="hours"><div class="wrap two">
  <div class="card">
    <h2>Store hours</h2>
    <table class="hours"><tbody>${week.map((r) => `<tr${r.today ? ' class="today"' : ''}><th scope="row">${esc(r.day)}</th><td>${esc(r.hours)}</td></tr>`).join('')}</tbody></table>
    ${closures.length ? `<h3>Coming up</h3><ul class="plain">${closures.map((c) => `<li><span>${esc(new Date(`${c.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }))}</span><span>${esc(c.open ? `${c.note ? `${c.note}: ` : ''}special hours` : c.note ? `Closed (${c.note})` : 'Closed')}</span></li>`).join('')}</ul>` : '<p class="muted">Call ahead for holiday hours.</p>'}
  </div>
  <div class="card" id="find">
    <h2>Find us</h2>
    <address>${esc(a.street)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</address>
    <p>${esc(shop.directions)}</p>
    <p><a href="${tel(shop)}">${esc(shop.phone)}</a> · <a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a></p>
    <p><a class="btn blue" href="${esc(mapsUrl(a))}" rel="noopener">Get directions</a></p>
    <h3>${shop.delivers ? 'Where we serve and deliver' : 'Where we serve'}</h3>
    ${shop.delivers ? '<p>We deliver parts around our service area. Ask when you call, or choose delivery when you order online.</p>' : ''}
    <ul class="plain">${shop.serviceAreas.map(([state2, towns]) => `<li><span><strong>${esc(state2)}</strong> ${esc(towns)}</span></li>`).join('')}</ul>
  </div>
</div></section>

<section class="sec" id="story"><div class="wrap">
  <header class="head"><p class="kicker">Our story</p><h2>Since 1981</h2></header>
  <ol class="timeline">${shop.history.map(([y, t]) => `<li><b>${esc(y)}</b><span>${esc(t)}</span></li>`).join('')}</ol>
  <p class="note">${esc(shop.historyNote)}</p>
</div></section>

${shop.showPartners ? `<section class="sec alt" id="partners"><div class="wrap"><header class="head"><h2>Shops we work with</h2></header><h3>Around town</h3>${list(shop.partners.local)}<h3>Around the region</h3>${list(shop.partners.regional)}</div></section>` : ''}

<footer class="foot"><div class="wrap">
  <p><strong>${esc(shop.name)}</strong> · ${esc(a.street)}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)} · <a href="${tel(shop)}">${esc(shop.phone)}</a></p>
  <p class="muted">© ${year} ${esc(shop.name)} · <a href="/staff/sign-in">Staff sign in</a></p>
</div></footer>`;
  }

  /** The home page for someone who isn't signed in. */
  function render(res, zubraPage) {
    const url = base();
    const description = `${shop.name}: ${shop.tagline}. NAPA Auto Parts in ${shop.address.city}, ${shop.address.state}. ${shop.phone}.`;
    const head = `<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(shop.name)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website">${url ? `\n<link rel="canonical" href="${esc(url)}/">` : ''}
<script type="application/ld+json">${jsonLd(shop, url)}</script>`;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'content-security-policy': res.csp,
      'x-content-type-options': 'nosniff',
    });
    res.end(zubraPage.finish(layout({ title: shop.name, who: null, body: body(), business: shop.name, head, sub: '', bodyClass: 'site', bare: true })));
  }

  const robots = () => `User-agent: *\nDisallow: /staff\nDisallow: /portal\nDisallow: /join/\nDisallow: /hello/\nDisallow: /badge/\nDisallow: /d/\nAllow: /\n${base() ? `Sitemap: ${base()}/sitemap.xml\n` : ''}`;
  const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(base())}/</loc></url></urlset>\n`;

  return { render, robots, sitemap, hasUrl: () => Boolean(base()) };
}
