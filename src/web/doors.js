// Two ways in for someone who isn't signed in yet, both from a QR code a signed-in person shows:
//   /phone/<token>  carries a signed-in person to their own phone (the kit's hand-off)
//   /crew/<code>    lets a new coworker make their own account: they type their name, email and
//                   password, so the person inviting them types nothing
// A crew code is made by someone allowed to invite, carries the role they chose, works once and
// lasts an hour. Only its hash is stored.
import { createHash, randomBytes } from 'node:crypto';
import { esc } from './html.js';
import { layout } from './ui.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const CREW_MS = 60 * 60_000;
const ROLE_WORDS = { staff: 'counter staff', manager: 'a manager', owner: 'an owner' };
/** Only a path on this site: never another host, never the sign-in pages. */
export const safePath = (to) => (/^\/(?!\/)[A-Za-z0-9/_\-?=&#.]*$/.test(String(to ?? '')) && !String(to).startsWith('/staff') ? String(to) : '/');

export function createDoors({ staff, store, config, zubra, audit, now = Date.now }) {
  const crewFor = (code) => {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(code)) return null;
    const key = sha(code);
    const found = store.get('crew-codes', key);
    return found && !found.used && found.until > now() ? { key, ...found } : null;
  };

  function page(res, nonce, status, title, body, cookie = null) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': res.csp, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', ...(cookie ? { 'set-cookie': cookie } : {}) });
    res.end(zubra.page({ nonce }).finish(layout({ title, who: null, body, business: config.business, customer: true, navHtml: '', accountHtml: '' })));
  }
  const go = (res, where, cookie = null) => { res.writeHead(303, { location: where, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...(cookie ? { 'set-cookie': cookie } : {}) }); res.end(); };
  const gone = (res, nonce, what) => page(res, nonce, 410, 'That code has expired', `<div class="head"><h1>That code has expired</h1></div><section class="panel stack"><p>${esc(what)}</p></section>`);

  const crewForm = (code, found, problem = '', kept = {}) => `<div class="head"><h1>Join ${esc(config.business)}</h1></div>
    ${problem ? `<p class="flash problem" role="alert">${esc(problem)}</p>` : ''}
    <form class="panel stack" method="post" action="/crew/${code}"><p>${esc(found.byName)} is adding you as ${ROLE_WORDS[found.role] ?? 'staff'}. Choose how you’ll sign in.</p>
      <label>Your name<input name="name" maxlength="80" required autocomplete="name" value="${esc(kept.name ?? '')}"></label>
      <label>Your email (you sign in with it)<input name="email" type="email" maxlength="120" required autocomplete="username" value="${esc(kept.email ?? '')}"></label>
      <label>Choose a password <span class="hint">At least 10 characters.</span><input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
      <button class="btn primary">Make my account</button></form>`;

  return {
    /** A one-time code for a new coworker, from someone allowed to give that role. */
    async crewCode(who, role = 'staff') {
      if (!who?.account || !store.get('accounts', who.account) || !staff.grantable(who).includes(role)) return { error: 'forbidden' };
      const code = randomBytes(24).toString('base64url');
      await store.write('crew-codes', sha(code), { by: who.account, byName: who.name, role, until: now() + CREW_MS, used: false, at: now() });
      return { ok: true, code, role, minutes: CREW_MS / 60_000 };
    },

    /** Handles /phone/<token> and /crew/<code>. True when the request was one of them. */
    async handle(req, res, url, { posting, form, nonce }) {
      const phone = /^\/phone\/([A-Za-z0-9_-]{20,120})$/.exec(url.pathname);
      if (phone && !posting) {
        const done = await staff.takeHandOff(phone[1]);
        if (done.error) return gone(res, nonce, 'Codes for your phone work once, for ten minutes. Make a new one on the computer.'), true;
        return go(res, safePath(url.searchParams.get('to')), done.cookie), true;
      }
      const crew = /^\/crew\/([A-Za-z0-9_-]{20,80})$/.exec(url.pathname);
      if (!crew) return false;
      const code = crew[1];
      const found = crewFor(code);
      if (!found) return gone(res, nonce, 'Sign-up codes work once, for an hour. Ask whoever showed it to you for a new one.'), true;
      if (!posting) return page(res, nonce, 200, 'Join', crewForm(code, found)), true;
      const kept = { name: String(form.get('name') ?? '').trim(), email: String(form.get('email') ?? '').trim() };
      // The inviter's own permission is checked again now: it may have changed in the last hour.
      if (!store.get('accounts', found.by)) return gone(res, nonce, 'Whoever made this code no longer has an account. Ask someone else for a new one.'), true;
      const invite = await staff.invite({ account: found.by }, { email: kept.email, name: kept.name, roles: [found.role] });
      if (invite.error) return page(res, nonce, 422, 'Join', crewForm(code, found, invite.error, kept)), true;
      const made = await staff.accept(invite.token, { name: kept.name, password: form.get('password') });
      if (made.error) return page(res, nonce, 422, 'Join', crewForm(code, found, made.error, kept)), true;
      await store.write('crew-codes', found.key, { used: true, usedAt: now(), email: kept.email.toLowerCase() });
      audit?.record(kept.email.toLowerCase(), 'staff.joined', `staff:${kept.email.toLowerCase()}`, { role: found.role, by: found.byName });
      return go(res, '/', made.cookie), true;
    },
  };
}
