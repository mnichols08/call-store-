// Staff side of the customer portal: invite a business, see who's in it, answer web requests, read the outbox.
import { esc, ago, when } from '../html.js';
import { say } from '../ui.js';
import { can } from '../../domain/permissions.js';
import { qrSvg } from '../../infra/qr.js';
import { UPDATE_KINDS, STAFF_KINDS } from '../../domain/portal.js';
import { PORTAL } from '../../app/portal.js';

const PORTAL_DAYS = PORTAL.repCodeDays;

const originOf = (ctx) => (ctx.config.publicUrl || `${ctx.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${ctx.req.headers.host}`).replace(/\/$/, '');
/** The QR code in its box, or nothing if the address is too long to be one (the link is shown either way). */
const codeBox = (link, label) => { const svg = qrSvg(link, { label }); return svg ? `<div class="qr">${svg}</div>` : ''; };
const WORDS = {
  'badge': 'That code didn’t work. Codes are good for ten minutes and work once. Ask for a new one.',
  'business': 'Choose a customer, or add a new one.', 'email': 'That email address doesn’t look right.', 'slow-down': 'Too many invites just now. Try again in a little while.', 'message': 'Add a short message for that kind of update.', 'kind': 'Pick an update to send.' };
const problem = (r) => WORDS[r.error] ?? say(r.error);

/** The "Online account" panel on a customer's page. */
export function customerPortalPanel(ctx, customer) {
  const { who } = ctx;
  if (!can(who, 'portal.invite') && !can(who, 'customer.view')) return '';
  const { members = [], invites = 0 } = ctx.app.portal.members(who, customer.id);
  const list = members.length
    ? `<ul class="plain">${members.map((m) => `<li><span><strong>${esc(m.name)}</strong>${m.role === 'admin' ? ' · admin' : ''}<small>${esc(m.email)}${m.last_login_at ? ` · signed in ${esc(ago(m.last_login_at, ctx.now()))}` : ''}</small></span>
      ${can(who, 'portal.manage') ? `<form method="post" action="/portal-members/${m.id}/remove" data-confirm="Remove ${esc(m.name)}?"><button class="link" aria-label="Remove ${esc(m.name)}">Remove</button></form>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">Nobody has joined yet.</p>';
  const invite = can(who, 'portal.invite')
    ? `<form method="post" action="/customers/${customer.id}/portal/invite" class="stack"><label>Email an invite (optional)<input name="email" type="email" maxlength="120" placeholder="pat@farm.com"></label>
        <div class="row"><button class="btn primary">Make an invite</button></div><p class="muted">Leave the email empty to get a QR code to show on your phone.</p></form>
        ${invites ? `<form method="post" action="/customers/${customer.id}/portal/revoke"><button class="link">Turn off ${invites} open invite${invites === 1 ? '' : 's'}</button></form>` : ''}`
    : '';
  return `<section class="panel stack" id="portal"><h2>Online account</h2>${list}${invite}</section>`;
}

/** What a web request shows staff: the timeline the customer sees, and a way to update them. */
export function callPortalPanel(ctx, got, closed) {
  const { call } = got;
  if (call.source !== 'portal') return '';
  const { who, config } = ctx;
  const updates = ctx.app.portal.updatesFor(call.id);
  const timeline = updates.length
    ? `<ol class="timeline">${[...updates].reverse().map((u) => `<li><span><strong>${esc(UPDATE_KINDS[u.kind]?.label ?? u.kind)}</strong>${u.message ? ` — ${esc(u.message)}` : ''}</span><small>${esc(u.staff_email ? ctx.people.name(u.staff_email) : u.account_name || 'Customer')} · ${esc(when(u.at, config.zone))}</small></li>`).join('')}</ol>`
    : '';
  const form = can(who, 'portal.update') && !closed
    ? `<form method="post" action="/calls/${call.id}/portal/update" class="stack"><div class="row"><label>Tell the customer<select name="kind">${STAFF_KINDS.map((k) => `<option value="${k}">${esc(UPDATE_KINDS[k].label)}</option>`).join('')}</select></label></div>
        <label>Message (they’ll read this)<input name="message" maxlength="300" autocomplete="off"></label>
        <label class="check"><input type="checkbox" name="email" value="1" checked> Email them</label><button class="btn primary">Send update</button></form>`
    : '';
  return `<section class="panel stack" id="customer-portal"><h2>Customer portal</h2><p class="muted">This came in online. What you send here shows on their page.</p>${form}${timeline}</section>`;
}

/** Pull the badge out of what a scan or a paste gave us: the bare code, or the address it is part of. */
export function badgeFrom(text) {
  const t = String(text ?? '').trim().split(/[?#]/)[0].replace(/\/$/, '');
  const m = /(?:^|\/badge\/)([A-Za-z0-9_-]{20,80})$/.exec(t);
  return m ? m[1] : '';
}

/** Access requests from customers who scanned a rep's code, waiting for a decision. */
export function accessPanel(ctx) {
  if (!can(ctx.who, 'portal.invite')) return '';
  const { requests = [] } = ctx.app.portal.accessRequests(ctx.who);
  const mine = `<form method="post" action="/rep-code"><button class="btn">My QR for customers</button></form>`;
  if (!requests.length) return `<section class="panel stack" id="access"><h2>Online access</h2><p class="muted">Show your QR to a customer and they can ask for an account here.</p>${mine}</section>`;
  const card = (r) => `<form method="post" action="/access/${r.id}/decide" class="stack panel inner">
    <p><strong>${esc(r.name)}</strong> from <strong>${esc(r.business)}</strong><small class="muted"> · ${esc(r.email)}${r.phone ? ` · ${esc(r.phone)}` : ''} · scanned ${esc(ctx.people.name(r.rep_email))}’s code ${esc(ago(r.created_at, ctx.now()))}</small></p>
    <fieldset><legend>Which customer is this?</legend>
      ${r.matches.map((c) => `<label class="check"><input type="radio" name="customer" value="${c.id}"> ${esc(c.name)}${c.account_no ? ` <small class="muted">#${esc(c.account_no)}</small>` : ''}</label>`).join('')}
      <label class="check"><input type="radio" name="customer" value="" ${r.matches.length ? '' : 'checked'}> Add “${esc(r.business)}” as a new customer</label></fieldset>
    <div class="row"><button class="btn primary" name="action" value="approve">Approve and email a link</button><button class="btn" name="action" value="decline">Decline</button></div></form>`;
  return `<section class="panel stack" id="access"><h2>Waiting for approval (${requests.length})</h2>${requests.map(card).join('')}${mine}</section>`;
}

export function portalRoutes(router) {
  router.get('/scan', (ctx) => {
    if (!can(ctx.who, 'customer.view')) return ctx.forbidden();
    return ctx.send('Scan', `<div class="head"><h1>Scan a customer</h1></div>
      <section class="panel stack" id="scanner">
        <p>Ask them to open <strong>My code</strong> on their phone, then point the camera at it. It works once, for ten minutes.</p>
        <video id="scan-video" playsinline muted hidden></video>
        <p id="scan-status" class="muted" role="status"></p>
        <div class="row"><button type="button" id="scan-start" class="btn primary" hidden>Use the camera</button>
          <label class="btn" id="scan-photo-label" hidden>Take a photo of it<input type="file" id="scan-photo" accept="image/*" capture="environment" hidden></label></div>
        <div id="scan-result" aria-live="polite"></div>
        <form method="post" action="/scan/badge" class="stack"><label>Or type or paste the code<input name="code" autocomplete="off" required placeholder="The link under the code, or the code itself"></label><button class="btn">Look up</button></form>
      </section><script type="module" src="/assets/scan.js"></script>`, { active: 'scan' });
  });
  router.post('/scan/badge', (ctx) => {
    const r = ctx.app.portal.readBadge(ctx.who, badgeFrom(ctx.form.get('code')));
    if (ctx.wantsJson) return ctx.json(r.error ? { error: r.error, message: problem(r) } : { ok: true, customerId: r.customer.id, name: r.name, business: r.customer.name }, r.error ? (r.error === 'forbidden' ? 403 : 400) : 200);
    if (r.error) return ctx.redirect('/scan', { problem: problem(r) });
    return ctx.send('Customer', `<div class="head"><h1>${esc(r.name)}</h1></div><section class="panel stack"><p>${esc(r.customer.name)} · ${esc(r.email)}</p>
      <div class="row"><form method="post" action="/calls"><input type="hidden" name="customer" value="${r.customer.id}"><button class="btn primary">Start a call for them</button></form><a class="btn" href="/customers/${r.customer.id}">Open customer</a><a class="btn" href="/scan">Scan another</a></div></section>`, { active: 'scan' });
  });
  router.post('/rep-code', (ctx) => {
    const r = ctx.app.portal.repCode(ctx.who);
    if (r.error) return ctx.redirect('/customers', { problem: problem(r) });
    const link = `${originOf(ctx)}/hello/${r.token}`;
    const svg = qrSvg(link, { label: `Order parts from ${ctx.config.business}` });
    return ctx.send('My QR', `<div class="head"><h1>My QR for customers</h1><a class="btn" href="/customers#access">Back</a></div>
      <section class="panel stack"><p>A customer who scans this tells us who they are, and you approve them on the Customers page. It works for ${PORTAL_DAYS} days, or until you make a new one.</p>${svg ? `<div class="qr">${svg}</div>` : ''}
      <label>Link<input id="the-link" readonly value="${esc(link)}"></label><div class="row"><button class="btn primary" type="button" data-copy="the-link">Copy link</button></div></section>`, { script: '<script src="/assets/details.js" defer></script>' });
  });
  router.post('/access/:id/decide', async (ctx) => {
    const r = await ctx.app.portal.decideAccess(ctx.who, Number(ctx.params.id), { action: ctx.form.get('action') ?? '', customerId: ctx.form.get('customer') ?? '', origin: originOf(ctx) });
    return ctx.redirect(r.ok && r.customerId ? `/customers/${r.customerId}#portal` : '/customers#access', r.error ? { problem: problem(r) } : { done: ctx.form.get('action') === 'decline' ? 'Declined.' : 'Approved. A link is on its way to them.' });
  });

  router.post('/customers/:id/portal/invite', async (ctx) => {
    const id = Number(ctx.params.id);
    const email = String(ctx.form.get('email') ?? '').trim();
    const r = await ctx.app.portal.invite(ctx.who, id, { email, origin: originOf(ctx) });
    if (r.error) return ctx.redirect(`/customers/${id}#portal`, { problem: problem(r) });
    if (r.emailed) return ctx.redirect(`/customers/${id}#portal`, { done: 'Invite sent.' });
    const link = `${originOf(ctx)}/join/${r.token}`;
    const name = ctx.app.customers.get(ctx.who, id).customer?.name ?? '';
    return ctx.send('Invite', `<div class="head"><h1>Invite ${esc(name)}</h1><a class="btn" href="/customers/${id}#portal">Back</a></div>
      <section class="panel stack"><p>Have them scan this with their phone. It works for 48 hours, for ten people at most.</p>${codeBox(link, `Join ${name}`)}
      <label>Link<input id="the-link" readonly value="${esc(link)}"></label><div class="row"><button class="btn primary" type="button" data-copy="the-link">Copy link</button></div></section>`, { script: '<script src="/assets/details.js" defer></script>' });
  });
  router.post('/customers/:id/portal/revoke', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.portal.revokeInvites(ctx.who, id);
    return ctx.redirect(`/customers/${id}#portal`, r.error ? { problem: problem(r) } : { done: 'Invites turned off.' });
  });
  router.post('/portal-members/:id/remove', (ctx) => {
    const r = ctx.app.portal.removeMember(ctx.who, Number(ctx.params.id));
    return ctx.redirect(ctx.req.headers.referer ? new URL(ctx.req.headers.referer, 'http://x').pathname : '/customers', r.error ? { problem: problem(r) } : { done: 'Removed.' });
  });
  router.post('/calls/:id/portal/update', async (ctx) => {
    const id = Number(ctx.params.id);
    const f = ctx.form;
    const r = await ctx.app.portal.postUpdate(ctx.who, id, { kind: f.get('kind') ?? '', message: f.get('message') ?? '', email: f.get('email') === '1', origin: originOf(ctx) });
    return ctx.redirect(`/calls/${id}#customer-portal`, r.error ? { problem: problem(r) } : { done: 'Sent.' });
  });
  router.get('/outbox', (ctx) => {
    const r = ctx.app.portal.outbox(ctx.who);
    if (r.error) return ctx.forbidden();
    return ctx.send('Outbox', `<div class="head"><h1>Outbox</h1></div>
      <section class="panel stack"><p>${r.live ? 'Email is on. Messages that failed to send are kept here.' : 'Email isn’t set up, so messages to customers are kept here instead of being sent. Set <code>MAIL_PROVIDER</code>, <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code> to send them.'}</p></section>
      <section class="panel">${r.messages.length ? `<table class="grid compact"><thead><tr><th>When</th><th>To</th><th>Subject</th></tr></thead><tbody>${r.messages.map((m) => `<tr><td class="muted">${esc(when(m.created_at, ctx.config.zone))}</td><td>${esc(m.to_email)}</td><td><details><summary>${esc(m.subject)}</summary><pre class="wrap">${esc(m.body)}</pre></details></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Empty.</p>'}</section>`, { active: 'outbox' });
  });
}
