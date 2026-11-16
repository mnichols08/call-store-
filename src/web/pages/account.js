// Your own account: name, email, a phone number, and the picture next to your name.
import { esc } from '../html.js';
import { avatarEditor } from '../ui.js';

const tidy = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const PICTURE = { picture: 'That didn’t look like a photo. Choose a JPEG or PNG.', 'picture-size': 'That photo is too big. Try another one.' };

export function accountRoutes(router) {
  router.get('/account', (ctx) => {
    const { who, store } = ctx;
    const mine = store.get('accounts', who.account) ?? {};
    const src = who.avatar ? `/avatar/staff/${who.account}?v=${who.avatar}` : '';
    return ctx.send('Your account', `<div class="head"><div><h1>Your account</h1><p class="muted">${esc(who.roles.join(', '))}</p></div></div>
      <div class="workspace"><div class="main-col">
      <form method="post" action="/account" class="panel stack hform"><h2>Your details</h2>
        <label>Name<input name="name" maxlength="80" required autocomplete="name" value="${esc(who.name)}"></label>
        <label>Email <span class="hint">You sign in with this. Your calls are filed under it, so it can’t be changed here.</span><input type="email" value="${esc(who.email)}" readonly aria-readonly="true"></label>
        <label>Cell phone <span class="hint">Optional. So coworkers can reach you.</span><input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${esc(mine.phone ?? '')}"></label>
        <div><button class="btn primary">Save</button></div></form>
      <section class="panel stack"><h2>Password</h2><p><a class="btn" href="/staff/password">Change your password</a></p></section>
      </div><aside class="side-col">${avatarEditor({ who, src, action: '/account/avatar', removeAction: '/account/avatar/remove' })}</aside></div>`, { script: '<script src="/assets/account.js" defer></script>' });
  });

  router.post('/account', async (ctx) => {
    const { who, store, form } = ctx;
    const name = tidy(form.get('name'), 80);
    const phone = tidy(form.get('phone'), 30);
    if (!name) return ctx.redirect('/account', { problem: 'Give your name.' });
    if (phone && phone.replace(/\D/g, '').length < 7) return ctx.redirect('/account', { problem: 'That phone number doesn’t look right.' });
    await store.write('accounts', who.account, { name, phone });
    ctx.app.audit.record(who.email, 'staff.account-updated', `staff:${who.email}`, {});
    return ctx.redirect('/account', { done: 'Saved.' });
  });

  router.post('/account/avatar', (ctx) => {
    const r = ctx.app.avatars.set(`staff:${ctx.who.account}`, ctx.form.get('picture'));
    return ctx.redirect('/account', r.error ? { problem: PICTURE[r.error] ?? PICTURE.picture } : { done: 'That’s your picture now.' });
  });
  router.post('/account/avatar/remove', (ctx) => {
    ctx.app.avatars.remove(`staff:${ctx.who.account}`);
    return ctx.redirect('/account', { done: 'Back to your initials.' });
  });

  // Any signed-in coworker may see a coworker's picture.
  router.get('/avatar/staff/:account', (ctx) => {
    const pic = /^[A-Za-z0-9]{1,80}$/.test(ctx.params.account) ? ctx.app.avatars.get(`staff:${ctx.params.account}`) : null;
    if (!pic) { ctx.res.writeHead(404, { 'content-type': 'text/plain' }); return ctx.res.end('No picture'); }
    ctx.res.writeHead(200, { 'content-type': pic.mime, 'content-length': pic.bytes.length, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    return ctx.res.end(pic.bytes);
  });
}
