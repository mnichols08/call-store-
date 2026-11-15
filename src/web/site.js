// The shop's public page. Southern Auto Supply has no other website, so this is it: who we are, when
// we're open, where to find us, and a way in to order parts online.
import { esc } from './html.js';
import { layout } from './ui.js';
import { SHOP } from '../domain/shop.js';
import { openingSpec, weekTable } from '../domain/hours.js';

const tel = (shop) => `tel:${shop.phoneLink}`;
const mapsUrl = (a) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.street}, ${a.city}, ${a.state} ${a.zip}`)}`;
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
    return `
<section class="hero">
  <p class="eyebrow">${esc(shop.tagline)}</p>
  <h1>${esc(shop.name)}</h1>
  <p class="lede">${esc(shop.intro)}</p>
  <p class="open-now ${state.open ? 'is-open' : 'is-closed'}" role="status"><span class="dot" aria-hidden="true"></span>${esc(state.text)}</p>
  <div class="actions">
    <a class="btn primary" href="${tel(shop)}">Call ${esc(shop.phone)}</a>
    <a class="btn" href="/portal/login">Order parts online</a>
    <a class="btn" href="${esc(mapsUrl(a))}" rel="noopener">Directions</a>
  </div>
</section>

<section class="panel stack" id="why"><h2>Why shop with us</h2>${list(shop.why)}</section>

<section class="panel stack" id="parts"><h2>What we carry</h2><p class="muted">Domestic and foreign, for cars, trucks, and equipment.</p>${list(shop.categories)}</section>

<section class="panel stack" id="specialties"><h2>Specialty services</h2>${list(shop.specialties)}</section>

<section class="panel stack" id="pros"><h2>For professionals and fleets</h2><p>Mechanics, body shops, and fleet managers get ${shop.professionals.map((x) => esc(x.toLowerCase())).join(', ')}. Call us, or ask for an account.</p></section>

<section class="panel stack" id="online"><h2>Order online</h2>
  <p>Customers with a business account can send us a request any time, add photos and measurements, and watch it move from received to ready. We check requests as soon as we open.</p>
  <div class="actions"><a class="btn primary" href="/portal/login">Sign in to order parts</a></div>
  <p class="muted">No account yet? Ask at the counter or call us and we’ll send you a link.</p>
  <h3>Need parts after hours?</h3><p>${esc(shop.afterHours)}</p>
  <p><a class="btn" href="${esc(shop.napaOnline)}" rel="noopener">NAPA Online</a></p></section>

<section class="panel stack" id="hours"><h2>Store hours</h2>
  <table class="grid compact hours"><tbody>${week.map((r) => `<tr${r.today ? ' class="today"' : ''}><th scope="row">${esc(r.day)}</th><td>${esc(r.hours)}</td></tr>`).join('')}</tbody></table>
  ${closures.length ? `<h3>Coming up</h3><ul class="plain">${closures.map((c) => `<li><span>${esc(new Date(`${c.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }))}</span><span>${esc(c.open ? `${c.note ? `${c.note}: ` : ''}special hours` : c.note ? `Closed (${c.note})` : 'Closed')}</span></li>`).join('')}</ul>` : '<p class="muted">Call ahead for holiday hours.</p>'}</section>

<section class="panel stack" id="find"><h2>Find us</h2>
  <address>${esc(a.street)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</address>
  <p>${esc(shop.directions)}</p>
  <p><a href="${tel(shop)}">${esc(shop.phone)}</a> · <a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a></p>
  <h3>Where we serve</h3><ul class="plain">${shop.serviceAreas.map(([s, t]) => `<li><span><strong>${esc(s)}</strong><small>${esc(t)}</small></span></li>`).join('')}</ul></section>

<section class="panel stack" id="story"><h2>Our story</h2><ul class="plain">${shop.history.map(([y, t]) => `<li><span><strong>${esc(y)}</strong> ${esc(t)}</span></li>`).join('')}</ul><p>${esc(shop.historyNote)}</p></section>

${shop.showPartners ? `<section class="panel stack" id="partners"><h2>Shops we work with</h2><h3>Around town</h3>${list(shop.partners.local)}<h3>Around the region</h3>${list(shop.partners.regional)}</section>` : ''}

<footer class="site-foot"><p>${esc(shop.name)} · ${esc(a.street)}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)} · <a href="${tel(shop)}">${esc(shop.phone)}</a></p>
  <p class="muted">© ${new Date(now()).getUTCFullYear()} ${esc(shop.name)} · <a href="/staff/sign-in">Staff sign in</a></p></footer>`;
  }

  /** The home page for someone who isn't signed in. */
  function render(res, zubraPage) {
    const url = base();
    const description = `${shop.name}: ${shop.tagline}. NAPA Auto Parts in ${shop.address.city}, ${shop.address.state}. ${shop.phone}.`;
    const head = `<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(shop.name)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website">${url ? `\n<link rel="canonical" href="${esc(url)}/">` : ''}
<script type="application/ld+json">${jsonLd(shop, url)}</script>`;
    const nav = `<nav aria-label="Main"><a href="#parts">Parts</a><a href="#online">Order online</a><a href="#hours">Hours</a><a href="#find">Find us</a></nav>`;
    const account = `<div class="account"><a class="btn primary" href="${tel(shop)}">Call</a><button type="button" class="icon-btn theme-toggle" aria-label="Switch theme">🌙</button></div>`;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'content-security-policy': res.csp,
      'x-content-type-options': 'nosniff',
    });
    res.end(zubraPage.finish(layout({ title: shop.name, who: null, body: body(), business: shop.name, head, sub: '', navHtml: nav, accountHtml: account, bodyClass: 'site' })));
  }

  const robots = () => `User-agent: *\nDisallow: /staff\nDisallow: /portal\nDisallow: /join/\nDisallow: /hello/\nDisallow: /badge/\nDisallow: /d/\nAllow: /\n${base() ? `Sitemap: ${base()}/sitemap.xml\n` : ''}`;
  const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(base())}/</loc></url></urlset>\n`;

  return { render, robots, sitemap, hasUrl: () => Boolean(base()) };
}
