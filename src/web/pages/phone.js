// Carry a page to a phone. Camera features are shown only on phone-sized touch screens; a desktop
// gets a button for a QR code that signs the same person in on their phone (kit staff hand-off:
// one use, five minutes) and opens the page there.
import { esc } from '../html.js';
import { qrSvg } from '../../infra/qr.js';

/** The pages a hand-off may open. Anything else goes home. */
export const PHONE_PAGES = Object.freeze({ '/orders/scan': 'Scan a page', '/scan': 'Scan a customer' });
const originOf = (ctx) => (ctx.config.publicUrl || `${ctx.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${ctx.req.headers.host}`).replace(/\/$/, '');

/** The desktop-only button. */
export const phoneHandOff = (to, label, { compact = false } = {}) => `<form method="post" action="/phone/code" class="desktop-only${compact ? '' : ' stack'}"><input type="hidden" name="to" value="${esc(to)}">
  ${compact ? '' : '<p class="muted">The camera works from a phone. Scan a code with yours and this page opens there, signed in as you.</p>'}<button class="btn primary">${esc(label)}</button></form>`;

export function phoneRoutes(router) {
  router.post('/phone/code', async (ctx) => {
    const to = PHONE_PAGES[ctx.form.get('to')] ? String(ctx.form.get('to')) : '/';
    const made = await ctx.staff.handOff(ctx.who);
    if (made.error) return ctx.redirect('/', { problem: made.error });
    const url = `${originOf(ctx)}/phone/${made.token}?to=${encodeURIComponent(to)}`;
    const svg = qrSvg(url, { label: PHONE_PAGES[to] ?? 'Open on your phone' });
    ctx.app.audit.record(ctx.who.email, 'staff.phone-code', `page:${to}`, {});
    ctx.res.setHeader('cache-control', 'no-store');
    return ctx.send('Open on your phone', `<div class="head"><h1>Scan this with your phone</h1><a class="btn" href="${esc(to)}">Back</a></div>
      <section class="panel stack"><p>Point your phone’s camera at the code. ${esc(PHONE_PAGES[to] ?? 'The page')} opens there, signed in as you.</p>${svg ? `<div class="qr">${svg}</div>` : ''}
      <details><summary>Can’t scan it?</summary><label>Open this link on your phone<input readonly value="${esc(url)}"></label></details>
      <p class="muted">It works once, for five minutes. Don’t show it to anyone else: it signs them in as you.</p>
      <form method="post" action="/phone/code"><input type="hidden" name="to" value="${esc(to)}"><button class="link">Make a new code</button></form></section>`);
  });
}

/** `/phone/<token>`, before any sign-in: a page with one button (so a link preview can't use it up), then the session. */
export async function handlePhoneLink({ req, res, url, posting, staff, send, redirect }) {
  const m = /^\/phone\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  if (!m) return false;
  const to = PHONE_PAGES[url.searchParams.get('to')] ? url.searchParams.get('to') : '/';
  if (!posting) {
    send(200, 'Open on this phone', `<div class="head"><h1>Open on this phone</h1></div><section class="panel stack"><p>Sign in here and open ${esc(PHONE_PAGES[to] ?? 'the app')}.</p>
      <form method="post" action="/phone/${m[1]}?to=${encodeURIComponent(to)}"><button class="btn primary">Continue</button></form></section>`);
    return true;
  }
  const r = await staff.takeHandOff(m[1]);
  if (r.error) {
    send(400, 'Code not working', `<div class="head"><h1>That code isn’t working</h1></div><section class="panel stack"><p>${esc(r.error)}</p><a class="btn primary" href="/staff/sign-in">Sign in</a></section>`);
    return true;
  }
  res.setHeader('set-cookie', r.cookie);
  redirect(res, to);
  return true;
}
