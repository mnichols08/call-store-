// The customer portal: public pages, before any staff sign-in. Customers join through an invite
// (a QR code or an emailed link), confirm their email, and from then on sign in with a one-time link.
import { esc, ago } from './html.js';
import { layout } from './ui.js';
import { partHelper } from './pages/details.js';
import { qrSvg } from '../infra/qr.js';
import { createLimiter } from './limiter.js';
import { UPDATE_KINDS } from '../domain/portal.js';
import { LIMITS } from '../app/details.js';
import { PORTAL } from '../app/portal.js';
import { relyingParty } from '../app/people.js';
import { SHOP } from '../domain/shop.js';
import { SERVICE_TYPES } from '../domain/measure.js';
import { STATUS_LABEL as DELIVERY_LABEL, deliveryTowns } from '../domain/delivery.js';

const COOKIE = 'cs_portal';
const SAYS = {
  'invite': 'That invite isn’t working. It may have expired. Ask the shop or a coworker for a new one.',
  'email': 'That email address doesn’t look right.',
  'name': 'Please add your name.',
  'slow-down': 'Please wait a little and try again.',
  'empty': 'Please say what you need.',
  'address': 'Tell us where to deliver it, or choose pickup.',
  'link-closed': 'This request is finished, so it can’t take more.',
  'measure': 'A measurement doesn’t look right. Use numbers like 25, 25.4 or 1/2.',
  'missing': 'We couldn’t find that.',
  'forbidden': 'That isn’t allowed.',
  'business': 'Please add your business’s name.',
  'code': 'That code isn’t working any more. Ask for a new one.',
  'token': 'That link isn’t working. It may have been used already or have expired. Ask the shop for a new one.',
  'username': 'Pick a username of 3 to 40 letters, numbers, dots, dashes or underscores.',
  'username-taken': 'That username is taken. Try another.',
  'password': 'Use a password of at least 10 characters.',
  'email-taken': 'That email already has an account. Sign in instead.',
  'sign-in': 'That username and password don’t match.',
  'passkey': 'That passkey didn’t work. Try again, or use a username and password.',
};
const GOOD = { sent: 'Thank you. We’ve got it.', saved: 'Saved.', mailed: 'Done. If that address can be used, a link is on its way.', invited: 'Invite sent.', removed: 'Removed.', note: 'Note added.' };

export function createPortalPages({ app, config, zubra, now, repName = (e) => e }) {
  const any = createLimiter({ max: 120, windowMs: 60_000, now });
  const sends = createLimiter({ max: 10, windowMs: 10 * 60_000, now }); // anything that sends an email, per address
  const uploads = createLimiter({ max: 20, windowMs: 60_000, now });
  const bad = createLimiter({ max: 20, windowMs: 5 * 60_000, now });
  const nav = '<nav aria-label="Main"><a href="/portal">Requests</a><a href="/portal/requests/new">New request</a><a href="/portal/team">Team</a><a href="/portal/code">My code</a></nav>';

  /** Emailed links must point at our own address, never at whatever Host header arrived. */
  function origin(req) {
    if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
    return config.production ? '' : `http://${req.headers.host}`;
  }
  const cookieOf = (req) => /(?:^|;\s*)cs_portal=([A-Za-z0-9_-]{20,80})/.exec(req.headers.cookie ?? '')?.[1] ?? '';
  const setCookie = (session) => `${COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session.maxAge}${config.production ? '; Secure' : ''}`;
  const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.production ? '; Secure' : ''}`;

  function headers(res, extra = {}) {
    return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': res.csp, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', ...extra };
  }
  function page(res, nonce, status, title, body, { acct = null, script = '', cookie = null } = {}) {
    const p = zubra.page({ nonce });
    const bar = acct
      ? { navHtml: nav, accountHtml: `<div class="account"><span class="who"><span>${esc(acct.name)}</span><small>${esc(acct.business)}</small></span><form method="post" action="/portal/sign-out"><button class="link" type="submit">Sign out</button></form><button type="button" class="icon-btn theme-toggle" aria-label="Switch theme">🌙</button></div>`, home: '/portal' }
      : { navHtml: '', accountHtml: '<div class="account"><button type="button" class="icon-btn theme-toggle" aria-label="Switch theme">🌙</button></div>', home: '/portal' };
    res.writeHead(status, headers(res, cookie ? { 'set-cookie': cookie } : {}));
    res.end(p.finish(layout({ title, who: null, body, business: config.business, script, customer: true, ...bar })));
  }
  const go = (res, where, cookie = null) => { res.writeHead(303, { location: where, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...(cookie ? { 'set-cookie': cookie } : {}) }); res.end(); };
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const flash = (q) => {
    const good = GOOD[q.get('ok')];
    const problem = SAYS[q.get('problem')];
    return `${good ? `<p class="flash done" role="status">${esc(good)}</p>` : ''}${problem ? `<p class="flash problem" role="alert">${esc(problem)}</p>` : ''}`;
  };
  const fail = (res, where, r) => go(res, `${where}${where.includes('?') ? '&' : '?'}problem=${encodeURIComponent(SAYS[r.error] ? r.error : 'forbidden')}`);
  const stamp = (t) => new Date(t).toLocaleString('en-US', { timeZone: config.zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const noOrigin = (res, nonce) => page(res, nonce, 503, 'Not set up', '<div class="head"><h1>Not set up yet</h1></div><section class="panel"><p>Online requests aren’t ready. Please call us.</p></section>');

  const chip = (kind, label) => `<span class="chip status-${esc(kind)}">${esc(label)}</span>`;

  function dashboard(acct, q) {
    const { requests } = app.portal.requests(acct);
    const open = requests.filter((r) => r.open);
    const done = requests.filter((r) => !r.open);
    const row = (r) => `<li><a href="/portal/requests/${r.id}"><strong>${esc(r.request || r.partNumbers || 'Request')}</strong><span class="muted"> · ${esc(r.by)} · ${esc(ago(r.updatedAt, now()))}</span></a> ${chip(r.kind, r.label)}</li>`;
    return `<div class="head"><h1>${esc(acct.business)}</h1><a class="btn primary" href="/portal/requests/new">New request</a></div>${flash(q)}
      ${hoursNote()}<section class="panel stack"><h2>Open requests</h2>${open.length ? `<ul class="list">${open.map(row).join('')}</ul>` : '<p class="muted">Nothing open. Send us a request and we’ll get back to you here.</p>'}</section>
      ${done.length ? `<section class="panel stack"><h2>Finished</h2><ul class="list">${done.slice(0, 20).map(row).join('')}</ul></section>` : ''}`;
  }

  /** When we're closed, say when a request will be seen (nothing is lost; it waits in the queue). */
  function hoursNote() {
    const state = app.hours.state();
    if (state.open) return '';
    return `<p class="flash" role="status">${esc(state.text.replace(/^Closed(?: today \([^)]*\))?\.\s*Opens/, 'We’re closed. We’ll see this when we open').replace(/\.$/, ''))}. For something urgent, call ${esc(SHOP.phone)}.</p>`;
  }

  function newRequest(acct, q) {
    return `<div class="head"><h1>New request</h1><a class="btn" href="/portal">Back</a></div>${flash(q)}${hoursNote()}
      <form class="panel stack" method="post" action="/portal/requests">
        <label>What kind of job is it?<select name="service"><option value="">Parts</option>${SERVICE_TYPES().map((x) => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('')}</select></label>
        <label>What do you need?<textarea name="request" rows="3" maxlength="500" required placeholder="Water pump for a 2015 John Deere 5075E"></textarea></label>
        <label>Part numbers, if you have them<input name="partNumbers" maxlength="200" autocomplete="off"></label>
        <div class="two"><label>Quantity<input name="quantity" inputmode="numeric" maxlength="4" value="1"></label>
        <label>When<select name="needed"><option value="">No rush</option><option value="week">This week</option><option value="today">Today</option></select></label></div>
        <fieldset class="units"><legend>Getting it</legend><label><input type="radio" name="fulfilment" value="pickup" checked> I’ll pick it up</label><label><input type="radio" name="fulfilment" value="deliver"> Deliver it</label></fieldset>
        <details><summary>If you want it delivered</summary><p class="muted">We deliver around ${esc(deliveryTowns().slice(0, 4).map((t) => t.town).join(', '))} and the rest of our area. Somewhere else? Enter it and we’ll check.</p>
          <label>Town<select name="deliveryTown"><option value="">Choose a town…</option>${deliveryTowns().map((t) => `<option value="${esc(t.value)}">${esc(t.value)}</option>`).join('')}<option value="Somewhere else">Somewhere else</option></select></label>
          <label>Address<textarea name="deliveryAddress" rows="2" maxlength="200"></textarea></label>
          <label>Where to leave it, or who to ask for<input name="deliveryNote" maxlength="200"></label></details>
        <details><summary>Vehicle or machine</summary><div class="two">
          <label>Year<input name="year" inputmode="numeric" maxlength="4"></label><label>Make<input name="make" maxlength="60"></label>
          <label>Model<input name="model" maxlength="80"></label><label>Engine<input name="engine" maxlength="80"></label></div>
          <label>VIN<input name="vin" maxlength="20" autocomplete="off"></label></details>
        <p class="muted">After you send it you can add the details and photos.</p><button class="btn primary">Send request</button></form>`;
  }

  function requestPage(acct, r, q) {
    const id = r.id;
    const type = q.get('type') || r.details?.type || '';
    const saved = r.details && r.details.type === type ? r.details : null;
    const base = `/portal/requests/${id}`;
    const timeline = r.updates.map((u) => `<li><strong>${esc(UPDATE_KINDS[u.kind]?.label ?? u.kind)}</strong> <span class="muted">${esc(stamp(u.at))}${u.who ? ` · ${esc(u.who)}` : ''}</span>${u.message ? `<br>${esc(u.message)}` : ''}</li>`).reverse().join('');
    return `<div class="head"><h1>${esc(r.request || r.partNumbers || 'Request')}</h1><a class="btn" href="/portal">Back</a></div>${flash(q)}
      <section class="panel stack"><p>${chip(r.kind, r.label)}</p>${r.partNumbers ? `<p>Part numbers: ${esc(r.partNumbers)}</p>` : ''}${r.vehicle ? `<p>${esc(r.vehicle)}</p>` : ''}</section>
      ${r.delivery ? `<section class="panel stack"><h2>Delivery</h2><p>${chip(r.delivery.status === 'delivered' ? 'done' : r.delivery.status === 'out' ? 'on-the-way' : 'looking', DELIVERY_LABEL[r.delivery.status])}</p><p>${esc(r.delivery.address)}${r.delivery.town ? `<br>${esc(r.delivery.town)}` : ''}</p>${r.delivery.outside && r.delivery.status === 'requested' ? '<p class="muted">That’s outside our usual delivery area, so we’ll call to confirm.</p>' : ''}</section>` : ''}
      <section class="panel stack"><h2>Updates</h2><ul class="list">${timeline}</ul></section>
      ${r.closed ? '' : `<section class="panel stack"><h2>Add a note</h2><form method="post" action="${base}/note" class="stack"><label>Message<textarea name="text" rows="2" maxlength="400" required></textarea></label><button class="btn">Send note</button></form></section>`}
      ${partHelper({ base, assist: app.details.assistEnabled(), photos: r.photos.map((p) => ({ id: p.id, src: `${base}/photos/${p.id}` })), type, unit: saved?.unit, values: saved?.values, note: saved?.note ?? '', saved: q.get('ok') === 'saved' })}`;
  }

  function teamPage(acct, q, req, made = null) {
    const { members } = app.portal.team(acct);
    const base = origin(req);
    const share = made ? `${base}/join/${made.token}` : '';
    return `<div class="head"><h1>Your team</h1><a class="btn" href="/portal">Back</a></div>${flash(q)}
      <section class="panel stack"><h2>People at ${esc(acct.business)}</h2><ul class="list">${members.map((m) => `<li><strong>${esc(m.name)}</strong> <span class="muted">${esc(m.email ?? (m.username ? `@${m.username}` : 'no email'))}${m.role === 'admin' ? ' · admin' : ''}</span>
        ${acct.role === 'admin' && m.id !== acct.id ? `<form method="post" action="/portal/team/${m.id}/remove" class="inline"><button class="link">Remove</button></form>` : ''}</li>`).join('')}</ul></section>
      <section class="panel stack"><h2>Invite a coworker</h2><p class="muted">They’ll see this business’s requests and updates. Each invite works for ${48} hours.</p>
        <form method="post" action="/portal/team/invite" class="row"><label>Email<input name="email" type="email" maxlength="120" required></label><button class="btn primary">Email an invite</button></form>
        <form method="post" action="/portal/team/invite"><button class="btn">Show a QR code</button></form>
        ${made ? `${qrSvg(share, { label: `Join ${acct.business}` }) ? `<div class="qr">${qrSvg(share, { label: `Join ${acct.business}` })}</div>` : ''}<label>Link<input readonly value="${esc(share)}"></label>` : ''}</section>`;
  }

  function sentPage(res, nonce, title, text) {
    return page(res, nonce, 200, title, `<div class="head"><h1>${esc(title)}</h1></div><section class="panel stack"><p>${esc(text)}</p></section>`);
  }
  const confirmPage = (res, nonce, token, info) => page(res, nonce, 200, 'Confirm', `<div class="head"><h1>${info.purpose === 'join' ? `Welcome, ${esc(info.name)}` : 'Sign in'}</h1></div>
    <section class="panel stack"><p>${info.purpose === 'join' ? 'Press the button to finish joining.' : 'Press the button to sign in.'}</p><form method="post" action="/portal/verify/${token}"><button class="btn primary">${info.purpose === 'join' ? 'Finish joining' : 'Sign in'}</button></form></section>`);

  return {
    /** Returns true when the request belonged to the portal. */
    async handle(req, res, url, { posting, form, raw, nonce, ip }) {
      const p = url.pathname.replace(/\/$/, '') || '/';
      const m = /^\/join\/([A-Za-z0-9_-]{20,80})$/.exec(p);
      const verify = /^\/portal\/verify\/([A-Za-z0-9_-]{20,80})$/.exec(p);
      const rq = /^\/portal\/requests\/(\d+)(?:\/(note|details|photo|assist|photos\/(\d+)))?$/.exec(p);
      const removal = /^\/portal\/team\/(\d+)\/remove$/.exec(p);
      const hello = /^\/hello\/([A-Za-z0-9_-]{20,80})$/.exec(p);
      const badge = /^\/badge\/([A-Za-z0-9_-]{20,80})$/.exec(p);
      const welcome = /^\/welcome\/([A-Za-z0-9_-]{20,80})(?:\/(passkey-options|passkey))?$/.exec(p);
      const known = welcome || hello || badge || ['/portal/login/password', '/portal/passkey-options', '/portal/passkey'].includes(p) || p === '/portal/code' || m || verify || rq || removal || ['/portal', '/portal/login', '/portal/sign-out', '/portal/requests', '/portal/requests/new', '/portal/team', '/portal/team/invite'].includes(p);
      if (!known) return false;
      if (!any.take(ip)) { json(res, 429, { error: 'slow-down' }); return true; }
      const q = url.searchParams;
      const here = origin(req);

      // ---- before signing in
      const relying = () => relyingParty(here, config.business);
      const response = () => { try { return JSON.parse(String(form.get('response') ?? '')); } catch { return null; } };
      if (welcome) {
        const [, token, step] = welcome;
        const info = app.portal.people.info(token);
        if (info.error) {
          if (!bad.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
          if (step) return json(res, 400, { error: 'token', message: SAYS.token }), true;
          page(res, nonce, 404, 'Link not working', `<div class="head"><h1>This link isn’t working</h1></div><section class="panel"><p>${esc(SAYS.token)}</p></section>`);
          return true;
        }
        if (posting && !here) return noOrigin(res, nonce), true;
        if (posting && step === 'passkey-options') {
          const r = await app.portal.people.passkeyOptions(token, { name: form.get('name') }, relying());
          return json(res, r.error ? 400 : 200, r.error ? { error: r.error, message: SAYS[r.error] } : { options: r.options, handle: r.handle }), true;
        }
        if (posting && step === 'passkey') {
          const r = await app.portal.people.joinWithPasskey(token, String(form.get('handle') ?? ''), response(), relying());
          if (r.error) return json(res, 400, { error: r.error, message: SAYS[r.error] }), true;
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': setCookie(r.session) });
          res.end(JSON.stringify({ ok: true, go: '/portal?ok=sent' }));
          return true;
        }
        if (posting && !step) {
          if (!bad.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
          const r = await app.portal.people.joinWithPassword(token, { name: form.get('name'), username: form.get('username'), password: form.get('password') });
          if (r.error) return fail(res, `/welcome/${token}`, r), true;
          return go(res, '/portal?ok=sent', setCookie(r.session)), true;
        }
        if (step) return false;
        page(res, nonce, 200, 'Set up your account', `<div class="head"><h1>Order for ${esc(info.business)}</h1></div>${flash(q)}
          <section class="panel stack"><p>${esc(config.business)} set up an account for you. Pick how you’ll sign in. This link works once.</p>
          <label>Your name<input form="pw" id="welcome-name" name="name" maxlength="80" required autocomplete="name" value="${esc(info.name)}"></label></section>
          <section class="panel stack" data-passkey-join="/welcome/${token}" hidden><h2>Use a passkey</h2><p class="muted">Sign in with your fingerprint, face or phone lock. Nothing to remember.</p>
          <button type="button" class="btn primary" data-passkey-start>Set up a passkey</button><p class="flash problem" role="alert" data-passkey-problem hidden></p></section>
          <form id="pw" class="panel stack" method="post" action="/welcome/${token}"><h2>Or a username and password</h2>
          <label>Username<input name="username" maxlength="40" minlength="3" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
          <label>Password<input name="password" type="password" minlength="10" maxlength="200" required autocomplete="new-password"></label>
          <button class="btn">Finish with a password</button>${info.hasEmail ? '<p class="muted">You can also get a sign-in link by email any time.</p>' : ''}</form>`,
          { script: '<script src="/assets/webauthn.js" defer></script><script src="/assets/passkey.js" defer></script>' });
        return true;
      }
      if (p === '/portal/login/password' && posting) {
        const r = await app.portal.people.signIn(form.get('username'), form.get('password'));
        if (r.error) { bad.take(ip); return fail(res, '/portal/login', r), true; }
        return go(res, '/portal', setCookie(r.session)), true;
      }
      if (p === '/portal/passkey-options' && posting) {
        if (!here) return json(res, 503, { error: 'setup' }), true;
        const r = await app.portal.people.signInOptions(relying());
        return json(res, 200, r), true;
      }
      if (p === '/portal/passkey' && posting) {
        if (!here) return json(res, 503, { error: 'setup' }), true;
        const r = await app.portal.people.signInWithPasskey(String(form.get('handle') ?? ''), response(), relying());
        if (r.error) { bad.take(ip); return json(res, 400, { error: r.error, message: 'That passkey isn’t set up here. Use your username and password, or an email link.' }), true; }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': setCookie(r.session) });
        res.end(JSON.stringify({ ok: true, go: '/portal' }));
        return true;
      }
      if (badge) {
        // What a phone's camera shows if it scans a customer's badge: harmless, and it uses nothing up.
        page(res, nonce, 200, 'Customer code', '<div class="head"><h1>This code is for the counter</h1></div><section class="panel"><p>Show it to the person helping you, and they’ll scan it with the shop’s scanner.</p></section>');
        return true;
      }
      if (hello) {
        const token = hello[1];
        const info = app.portal.repInfo(token);
        if (info.error) {
          if (!bad.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
          page(res, nonce, 404, 'Code not working', `<div class="head"><h1>This code isn’t working</h1></div><section class="panel"><p>${esc(SAYS.code)}</p></section>`);
          return true;
        }
        if (posting) {
          if (!sends.take(ip)) { json(res, 429, { error: 'slow-down' }); return true; }
          const r = app.portal.askAccess(token, { name: form.get('name') ?? '', business: form.get('business') ?? '', email: form.get('email') ?? '', phone: form.get('phone') ?? '' });
          if (r.error) return fail(res, `/hello/${token}`, r), true;
          return sentPage(res, nonce, 'Thank you', `${repName(info.rep)} will look at this and email you a link to finish. You don’t need to do anything else.`), true;
        }
        page(res, nonce, 200, 'Get set up', `<div class="head"><h1>Order parts online</h1></div>${flash(q)}
          <form class="panel stack" method="post" action="/hello/${token}"><p>${esc(repName(info.rep))} at ${esc(config.business)} sent you here. Tell us who you are and we’ll set up your business’s account.</p>
          <label>Your name<input name="name" maxlength="80" required autocomplete="name"></label><label>Business<input name="business" maxlength="120" required autocomplete="organization"></label>
          <label>Email<input name="email" type="email" maxlength="120" required autocomplete="email"></label><label>Phone (optional)<input name="phone" type="tel" maxlength="30" autocomplete="tel"></label><button class="btn primary">Ask for access</button></form>`);
        return true;
      }
      if (m) {
        const token = m[1];
        const info = app.portal.inviteInfo(token);
        if (info.error) {
          if (!bad.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
          page(res, nonce, 404, 'Invite not working', `<div class="head"><h1>This invite isn’t working</h1></div><section class="panel"><p>${esc(SAYS.invite)}</p></section>`);
          return true;
        }
        if (posting) {
          if (!here) return noOrigin(res, nonce), true;
          const email = String(form.get('email') ?? '');
          if (!sends.take(`${ip}`)) { json(res, 429, { error: 'slow-down' }); return true; }
          const r = await app.portal.startJoin(token, { name: form.get('name') ?? '', email, origin: here });
          if (r.error) return fail(res, `/join/${token}`, r), true;
          return sentPage(res, nonce, 'Check your email', 'If that address can be used, we’ve sent a link to finish joining. It works once, for 30 minutes.'), true;
        }
        page(res, nonce, 200, 'Join', `<div class="head"><h1>Join ${esc(info.business)}</h1></div>${flash(q)}
          <form class="panel stack" method="post" action="/join/${token}"><p>${esc(config.business)} can answer your parts requests online. We’ll email you a link to finish.</p>
          <label>Your name<input name="name" maxlength="80" required autocomplete="name"></label><label>Email<input name="email" type="email" maxlength="120" required autocomplete="email"></label><button class="btn primary">Send me the link</button></form>`);
        return true;
      }
      if (p === '/portal/login') {
        if (posting) {
          if (!here) return noOrigin(res, nonce), true;
          if (!sends.take(`${ip}`)) { json(res, 429, { error: 'slow-down' }); return true; }
          const r = await app.portal.requestLogin(form.get('email') ?? '', { origin: here });
          if (r.error) return fail(res, '/portal/login', r), true;
          return sentPage(res, nonce, 'Check your email', 'If that address has an account, a sign-in link is on its way. It works once, for 30 minutes.'), true;
        }
        page(res, nonce, 200, 'Sign in', `<div class="head"><h1>Sign in</h1></div>${flash(q)}
          <section class="panel stack" data-passkey-login hidden><button type="button" class="btn primary" data-passkey-start>Sign in with a passkey</button><p class="flash problem" role="alert" data-passkey-problem hidden></p></section>
          <form class="panel stack" method="post" action="/portal/login/password"><h2>Username and password</h2><label>Username<input name="username" maxlength="40" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
          <label>Password<input name="password" type="password" maxlength="200" required autocomplete="current-password"></label><button class="btn">Sign in</button></form>
          <form class="panel stack" method="post" action="/portal/login"><h2>Or get a link by email</h2><label>Email<input name="email" type="email" maxlength="120" required autocomplete="email"></label><button class="btn">Email me a link</button>
          <p class="muted">New here? Ask ${esc(config.business)} or a coworker for an invite.</p></form>`, { script: '<script src="/assets/webauthn.js" defer></script><script src="/assets/passkey.js" defer></script>' });
        return true;
      }
      if (verify) {
        const token = verify[1];
        if (!posting) {
          // A mail scanner opening the link must not use it up, so the link only asks to be confirmed.
          const info = app.portal.tokenInfo(token);
          if (info.error) {
            if (!bad.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
            page(res, nonce, 404, 'Link not working', '<div class="head"><h1>This link isn’t working</h1></div><section class="panel stack"><p>It may have been used already or have expired.</p><a class="btn primary" href="/portal/login">Get a new link</a></section>');
          } else confirmPage(res, nonce, token, info);
          return true;
        }
        const r = app.portal.redeem(token);
        if (r.error) {
          if (!bad.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
          page(res, nonce, 400, 'Link not working', '<div class="head"><h1>This link isn’t working</h1></div><section class="panel stack"><p>It may have been used already or have expired.</p><a class="btn primary" href="/portal/login">Get a new link</a></section>');
          return true;
        }
        go(res, `/portal${r.joined ? '?ok=sent' : ''}`, setCookie(r.session));
        return true;
      }

      // ---- signed in
      const acct = app.portal.session(cookieOf(req));
      if (!acct) {
        if (p.startsWith('/portal/requests/') && /\/photo$/.test(p)) { json(res, 401, { error: 'signed-out' }); return true; }
        go(res, '/portal/login');
        return true;
      }
      if (p === '/portal/code' && !posting) {
        const made = app.portal.badge(acct);
        if (made.error) return page(res, nonce, 429, 'Slow down', `<div class="head"><h1>Please wait</h1></div><section class="panel"><p>${esc(SAYS['slow-down'])}</p></section>`, { acct }), true;
        if (!here) return noOrigin(res, nonce), true;
        const svg = qrSvg(`${here}/badge/${made.token}`, { label: `${acct.name}, ${acct.business}` });
        page(res, nonce, 200, 'My code', `<div class="head"><h1>Show this at the counter</h1><a class="btn" href="/portal">Back</a></div>
          <section class="panel stack"><p>${esc(acct.name)} · ${esc(acct.business)}</p>${svg ? `<div class="qr">${svg}</div>` : ''}
          <p class="muted">It works once, for ${PORTAL.badgeMinutes} minutes. If it stops working, <a href="/portal/code">get a new one</a>.</p></section>`, { acct });
        return true;
      }
      if (p === '/portal/sign-out' && posting) {
        app.portal.signOut(cookieOf(req));
        go(res, '/portal/login', clearCookie());
        return true;
      }
      if (p === '/portal' && !posting) return page(res, nonce, 200, 'Requests', dashboard(acct, q), { acct }), true;
      if (p === '/portal/requests/new' && !posting) return page(res, nonce, 200, 'New request', newRequest(acct, q), { acct }), true;
      if (p === '/portal/requests' && posting) {
        const f = (k) => form.get(k) ?? '';
        const r = app.portal.createRequest(acct, { request: f('request'), partNumbers: f('partNumbers'), quantity: f('quantity'), needed: f('needed'), fulfilment: f('fulfilment'), deliveryTown: f('deliveryTown'), deliveryAddress: f('deliveryAddress'), deliveryNote: f('deliveryNote'), service: f('service'), year: f('year'), make: f('make'), model: f('model'), engine: f('engine'), vin: f('vin') });
        if (r.error) return fail(res, '/portal/requests/new', r), true;
        go(res, `/portal/requests/${r.id}?ok=sent${r.service ? `&type=${r.service}` : ''}`);
        return true;
      }
      if (p === '/portal/team' && !posting) return page(res, nonce, 200, 'Team', teamPage(acct, q, req), { acct }), true;
      if (p === '/portal/team/invite' && posting) {
        if (!here) return noOrigin(res, nonce), true;
        const email = String(form.get('email') ?? '');
        if (email && !sends.take(ip)) { json(res, 429, { error: 'slow-down' }); return true; }
        const r = await app.portal.inviteCoworker(acct, { email, origin: here });
        if (r.error) return fail(res, '/portal/team', r), true;
        if (r.emailed) go(res, '/portal/team?ok=invited');
        else page(res, nonce, 200, 'Team', teamPage(acct, q, req, r), { acct });
        return true;
      }
      if (removal && posting) {
        const r = app.portal.removeCoworker(acct, Number(removal[1]));
        if (r.error) return fail(res, '/portal/team', r), true;
        go(res, '/portal/team?ok=removed');
        return true;
      }
      if (rq) {
        const id = Number(rq[1]);
        const action = rq[2]?.startsWith('photos/') ? 'photoFile' : rq[2];
        const base = `/portal/requests/${id}`;
        const view = app.portal.request(acct, id);
        if (view.error) {
          if (action === 'photo' || action === 'photoFile') json(res, 404, { error: 'missing' });
          else page(res, nonce, 404, 'Not found', '<div class="head"><h1>Not found</h1></div><section class="panel"><p>We couldn’t find that request. <a href="/portal">Back to your requests</a>.</p></section>', { acct });
          return true;
        }
        if (!posting && !action) return page(res, nonce, 200, 'Request', requestPage(acct, view.request, q), { acct, script: '<script src="/assets/details.js" defer></script>' }), true;
        if (!posting && action === 'photoFile') {
          const ph = app.details.photoBytes(id, Number(rq[3]));
          if (ph.error) return json(res, 404, { error: 'missing' }), true;
          res.writeHead(200, { 'content-type': ph.mime, 'content-length': ph.bytes.length, 'cache-control': 'private, max-age=3600', 'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' });
          res.end(ph.bytes);
          return true;
        }
        if (posting && action === 'photo') {
          if (!uploads.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
          const r = app.details.photoAsCustomer(id, raw);
          json(res, r.error ? 400 : 200, r);
          return true;
        }
        if (posting && action === 'assist') {
          if (!uploads.take(ip)) return json(res, 429, { error: 'slow-down' }), true;
          const r = await app.details.assist(id);
          json(res, r.error ? (r.error === 'slow-down' ? 429 : 400) : 200, r);
          return true;
        }
        if (posting && action === 'details') {
          const r = app.details.saveAsCustomer(id, { type: form.get('type') ?? '', unit: form.get('unit') ?? 'mm', note: form.get('note') ?? '', get: (k) => form.get(k) ?? '' });
          if (req.headers.accept?.includes('application/json')) return json(res, r.ok ? 200 : 400, r.ok ? { ok: true } : { error: r.error, fields: r.fields ?? [] }), true;
          go(res, r.ok ? `${base}?ok=saved&type=${encodeURIComponent(form.get('type') ?? '')}` : `${base}?type=${encodeURIComponent(form.get('type') ?? '')}&problem=${SAYS[r.error] ? r.error : 'measure'}`);
          return true;
        }
        if (posting && action === 'note') {
          const r = app.portal.addNote(acct, id, form.get('text') ?? '');
          if (r.error) return fail(res, base, r), true;
          go(res, `${base}?ok=note`);
          return true;
        }
      }
      json(res, 404, { error: 'missing' });
      return true;
    },
  };
}
