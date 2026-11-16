// Invite someone: a person at a customer (any staff), or a new employee (managers: staff; the
// owner: anyone). Either way the link goes by text, by email, or as a QR code on this screen.
import { esc } from '../html.js';
import { say } from '../ui.js';
import { can } from '../../domain/permissions.js';
import { qrSvg } from '../../infra/qr.js';
import { e164 } from '../../infra/sms.js';

const originOf = (ctx) => (ctx.config.publicUrl || `${ctx.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${ctx.req.headers.host}`).replace(/\/$/, '');
const ROLE_WORDS = { staff: 'Counter staff', manager: 'Manager', owner: 'Owner' };
const WORDS = { phone: 'That phone number doesn’t look right. Use a 10-digit US number.', email: 'That email address doesn’t look right.', via: 'Choose text, email or QR code.',
  customer: 'Choose a customer, or add a new one.', 'slow-down': 'Too many invites just now. Try again in a little while.' };
const problem = (r) => WORDS[r.error] ?? say(r.error);

const via = (name = 'via') => `<fieldset class="row"><legend>Send it by</legend>
  <label class="check"><input type="radio" name="${name}" value="text"> Text</label><label class="check"><input type="radio" name="${name}" value="email"> Email</label>
  <label class="check"><input type="radio" name="${name}" value="qr" checked> QR code on my screen</label></fieldset>`;

function qrPage(ctx, title, lede, url, label) {
  const svg = qrSvg(url, { label });
  return ctx.send('Invite', `<div class="head"><h1>${esc(title)}</h1><a class="btn" href="/invite">Done</a></div>
    <section class="panel stack"><p>${esc(lede)}</p>${svg ? `<div class="qr">${svg}</div>` : ''}
    <label>Link<input id="the-link" readonly value="${esc(url)}"></label><div class="row"><button class="btn primary" type="button" data-copy="the-link">Copy link</button></div></section>`, { active: 'invite', script: '<script src="/assets/details.js" defer></script>' });
}

export function inviteRoutes(router) {
  router.get('/invite', (ctx) => {
    if (!can(ctx.who, 'portal.invite')) return ctx.forbidden();
    const q = String(ctx.url.searchParams.get('q') ?? '').trim();
    const found = q ? ctx.app.customers.search(ctx.who, q, { limit: 8 }).customers ?? [] : [];
    const picks = found.length
      ? `<ul class="plain">${found.map((c) => `<li><label class="check"><input type="radio" name="customer" value="${c.id}" required> ${esc(c.name)}${c.account_no ? ` <small>#${esc(c.account_no)}</small>` : ''}</label></li>`).join('')}</ul>`
      : q ? '<p class="muted">No customer matches. Add them below.</p>' : '';
    const roles = ctx.staff.grantable(ctx.who);
    const employee = roles.length
      ? `<form class="panel stack" method="post" action="/invite/employee"><h2>An employee</h2>
          <p class="muted">They sign in with their email and a password they choose (no passkeys on shop computers).</p>
          <div class="row"><label>Name<input name="name" maxlength="80" required autocomplete="off"></label><label>Email (their sign-in)<input name="email" type="email" maxlength="120" required autocomplete="off"></label></div>
          <label>Cell phone (to text it)<input name="phone" type="tel" maxlength="30" autocomplete="off"></label>
          <label>What they do<select name="role">${roles.map((r) => `<option value="${r}"${r === 'staff' ? ' selected' : ''}>${ROLE_WORDS[r] ?? r}</option>`).join('')}</select></label>
          ${via()}<div class="row"><button class="btn primary">Invite employee</button></div></form>`
      : '';
    return ctx.send('Invite', `<div class="head"><h1>Invite someone</h1></div>
      <section class="panel stack"><h2>Someone at a customer</h2>
        <p class="muted">Pick the customer first. The person joins that customer; they never choose it.</p>
        <form method="get" action="/invite" class="row" role="search"><label>Find the customer<input name="q" value="${esc(q)}" maxlength="80" autocomplete="off" placeholder="Name, account or phone"></label><button class="btn">Find</button></form>
        <form method="post" action="/invite/customer" class="stack">${picks}
          ${found.length ? '' : `<label>Or add a new customer<input name="newName" maxlength="120" autocomplete="off" placeholder="Business or person’s name"${q ? ` value="${esc(q)}"` : ''}></label>`}
          <label>Their name (optional)<input name="name" maxlength="80" autocomplete="off"></label>
          <div class="row"><label>Cell phone<input name="phone" type="tel" maxlength="30" autocomplete="off"></label><label>Email<input name="email" type="email" maxlength="120" autocomplete="off"></label></div>
          ${via()}<div class="row"><button class="btn primary">Invite</button></div></form></section>
      ${employee}`, { active: 'invite' });
  });

  router.post('/invite/customer', async (ctx) => {
    const f = (k) => String(ctx.form.get(k) ?? '').trim();
    let id = Number(f('customer'));
    if (!id && f('newName')) {
      const made = ctx.app.customers.create(ctx.who, { name: f('newName'), kind: 'organization', phones: f('phone') ? [{ phone: f('phone') }] : [] });
      if (made.error) return ctx.redirect('/invite', { problem: problem(made) });
      id = made.id;
    }
    if (!id) return ctx.redirect('/invite', { problem: WORDS.customer });
    const r = await ctx.app.portal.people.invite(ctx.who, id, { name: f('name'), phone: f('phone'), email: f('email'), via: f('via') || 'qr', origin: originOf(ctx) });
    if (r.error) return ctx.redirect('/invite', { problem: problem(r) });
    if (r.via !== 'qr') return ctx.redirect(`/customers/${id}#portal`, { done: r.via === 'text' ? 'Invite texted.' : 'Invite emailed.' });
    const name = ctx.app.customers.get(ctx.who, id).customer?.name ?? '';
    return qrPage(ctx, `Invite someone at ${name}`, 'Have them scan this with their phone’s camera. It works once, for 3 days.', r.url, `Join ${name}`);
  });

  router.post('/invite/employee', async (ctx) => {
    const f = (k) => String(ctx.form.get(k) ?? '').trim();
    const how = f('via') || 'qr';
    if (!['text', 'email', 'qr'].includes(how)) return ctx.redirect('/invite', { problem: WORDS.via });
    const phone = f('phone') ? e164(f('phone')) : '';
    if ((how === 'text' || f('phone')) && !phone) return ctx.redirect('/invite', { problem: WORDS.phone });
    const done = await ctx.staff.invite(ctx.who, { email: f('email'), name: f('name'), roles: [f('role') || 'staff'] });
    if (done.error) return ctx.redirect('/invite', { problem: done.error });
    const url = `${originOf(ctx)}/staff/accept?token=${done.token}`;
    const shop = ctx.config.business;
    ctx.app.audit.record(ctx.who.email, 'staff.invited', `staff:${f('email').toLowerCase()}`, { via: how, role: f('role') || 'staff' });
    if (how === 'text') {
      await ctx.app.texter.send({ to: phone, text: `${shop}: set up your staff sign-in: ${url}` });
      return ctx.redirect('/invite', { done: 'Invite texted.' });
    }
    if (how === 'email') {
      await ctx.app.mailer.send({ to: f('email'), subject: `Your ${shop} staff sign-in`, text: `${f('name') ? `Hi ${f('name')}, ` : ''}use this link to choose your password for ${shop}: ${url}\n\nIt works once.\n\n— ${shop}` });
      return ctx.redirect('/invite', { done: 'Invite emailed.' });
    }
    return qrPage(ctx, `Invite ${f('name') || 'an employee'}`, 'Have them scan this with their phone, or open the link on their computer. It works once.', url, `${shop} staff sign-in`);
  });
}
