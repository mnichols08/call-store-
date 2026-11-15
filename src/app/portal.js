// The customer portal. A customer account belongs to one business (a customer record). Accounts
// exist only through an invite, and every sign-in is a one-time link sent to the person's email, so
// holding an invite (or a QR code of one) is never enough by itself.
import { createHash, randomBytes } from 'node:crypto';
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';
import { UPDATE_KINDS, STAFF_KINDS, cleanEmail, currentKind, isOpenForCustomer } from '../domain/portal.js';

const SYSTEM = Object.freeze({ email: 'portal', roles: ['staff'] });
const MIN = 60_000;
const HOUR = 3_600_000;
export const PORTAL = Object.freeze({ tokenMinutes: 30, sessionDays: 30, inviteHours: 48, inviteUses: 10, perEmailPerHour: 5, requestsPerDay: 20 });
const hash = (token) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(24).toString('base64url');

export function createPortal({ db, audit, now, changed, details, calls, mailer, business = 'the shop' }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const customerName = (id) => db.prepare('SELECT name FROM customers WHERE id = ?').get(id)?.name ?? '';
  const account = (id) => db.prepare('SELECT * FROM portal_accounts WHERE id = ?').get(id);
  const link = (origin, path) => `${String(origin).replace(/\/$/, '')}${path}`;
  const mail = (to, subject, lines) => mailer.send({ to, subject, text: `${lines.join('\n\n')}\n\n— ${business}` });

  function makeInvite(createdBy, customerId) {
    const token = newToken();
    const t = now();
    db.prepare('INSERT INTO portal_invites (token_hash, customer_id, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)').run(hash(token), customerId, createdBy, t, t + PORTAL.inviteHours * HOUR, PORTAL.inviteUses);
    return { token, expires: t + PORTAL.inviteHours * HOUR };
  }
  function inviteRow(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 80) return null;
    const i = db.prepare('SELECT * FROM portal_invites WHERE token_hash = ?').get(hash(token));
    return i && !i.revoked && i.expires_at > now() && i.uses < i.max_uses ? i : null;
  }
  function makeToken({ purpose, email, name = '', accountId = null, inviteId = null }) {
    const token = newToken();
    const t = now();
    db.prepare('INSERT INTO portal_tokens (token_hash, purpose, email, name, account_id, invite_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(hash(token), purpose, email, name, accountId, inviteId, t, t + PORTAL.tokenMinutes * MIN);
    return token;
  }
  const tooManyFor = (email) => db.prepare('SELECT COUNT(*) AS n FROM portal_tokens WHERE email = ? AND created_at > ?').get(email, now() - HOUR).n >= PORTAL.perEmailPerHour;

  function newSession(accountId) {
    const token = newToken();
    const t = now();
    db.prepare('INSERT INTO portal_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hash(token), accountId, t, t + PORTAL.sessionDays * 86_400_000);
    db.prepare('UPDATE portal_accounts SET last_login_at = ? WHERE id = ?').run(t, accountId);
    return { token, maxAge: PORTAL.sessionDays * 86400 };
  }

  const kindOf = (callId, status) => currentKind(db.prepare('SELECT * FROM portal_updates WHERE call_id = ? ORDER BY id').all(callId), status);

  return {
    // ================================================================ staff side
    /** An invite for a business: a QR code and a join link, optionally emailed. */
    async invite(who, customerId, { email = '', origin = '' } = {}) {
      const no = deny(who, 'portal.invite');
      if (no) return no;
      if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) return { error: 'customer' };
      if (db.prepare('SELECT COUNT(*) AS n FROM portal_invites WHERE created_by = ? AND created_at > ?').get(who.email, now() - HOUR).n >= 20) return { error: 'slow-down' };
      const made = makeInvite(who.email, customerId);
      audit.record(who.email, 'portal.invited', `customer:${customerId}`, { by: email ? 'email' : 'qr' });
      const to = email ? cleanEmail(email) : null;
      if (email && !to) return { error: 'email' };
      if (to) await mail(to, `Join ${customerName(customerId)} on ${business}`, [`${business} has set up online requests for ${customerName(customerId)}.`, `Use this link to join: ${link(origin, `/join/${made.token}`)}`, `It works for ${PORTAL.inviteHours} hours.`]);
      return { ok: true, ...made, emailed: Boolean(to) };
    },
    revokeInvites(who, customerId) {
      const no = deny(who, 'portal.invite');
      if (no) return no;
      db.prepare('UPDATE portal_invites SET revoked = 1 WHERE customer_id = ?').run(customerId);
      audit.record(who.email, 'portal.invites-revoked', `customer:${customerId}`, {});
      return { ok: true };
    },
    members(who, customerId) {
      const no = deny(who, 'customer.view');
      if (no) return no;
      return { ok: true, members: db.prepare("SELECT id, email, name, role, created_at, last_login_at FROM portal_accounts WHERE customer_id = ? AND status = 'active' ORDER BY id").all(customerId), invites: db.prepare('SELECT COUNT(*) AS n FROM portal_invites WHERE customer_id = ? AND revoked = 0 AND expires_at > ? AND uses < max_uses').get(customerId, now()).n };
    },
    removeMember(who, accountId) {
      const no = deny(who, 'portal.manage');
      if (no) return no;
      const a = account(accountId);
      if (!a) return { error: 'missing' };
      db.prepare("UPDATE portal_accounts SET status = 'removed' WHERE id = ?").run(accountId);
      db.prepare('DELETE FROM portal_sessions WHERE account_id = ?').run(accountId);
      audit.record(who.email, 'portal.member-removed', `customer:${a.customer_id}`, { email: a.email });
      return { ok: true };
    },
    outbox(who) {
      const no = deny(who, 'portal.manage');
      if (no) return no;
      return { ok: true, live: mailer.live, messages: db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all() };
    },
    /** What staff say to the customer about a web request. Visible to the customer; emailed to whoever sent it. */
    async postUpdate(who, callId, { kind, message = '', email = true, origin = '' }) {
      const no = deny(who, 'portal.update');
      if (no) return no;
      if (!STAFF_KINDS.includes(kind)) return { error: 'kind' };
      const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
      if (!c || c.source !== 'portal') return { error: 'missing' };
      const text = clip(String(message).trim(), 300);
      if (['need-info', 'unavailable'].includes(kind) && !text) return { error: 'message' };
      db.prepare('INSERT INTO portal_updates (call_id, at, kind, message, staff_email) VALUES (?, ?, ?, ?, ?)').run(callId, now(), kind, text, who.email);
      audit.record(who.email, 'portal.update', `call:${callId}`, { kind });
      changed({ type: 'call', id: callId });
      const a = c.portal_account ? account(c.portal_account) : null;
      if (email && a?.status === 'active' && a.notify) {
        await mail(a.email, `Your request #${callId}: ${UPDATE_KINDS[kind].label}`, [`${UPDATE_KINDS[kind].label}.${text ? `\n${text}` : ''}`, `See it here: ${link(origin, `/portal/requests/${callId}`)}`]);
      }
      return { ok: true };
    },
    updatesFor(callId) {
      return db.prepare('SELECT u.*, a.name AS account_name FROM portal_updates u LEFT JOIN portal_accounts a ON a.id = u.account_id WHERE call_id = ? ORDER BY u.id').all(callId);
    },

    // ================================================================ joining and signing in
    /** Look at an invite without using it (so a page can say whose it is). */
    inviteInfo(token) {
      const i = inviteRow(token);
      return i ? { ok: true, business: customerName(i.customer_id) } : { error: 'invite' };
    },
    /** A person with an invite gives their name and email; a link to finish joining goes to that email. */
    async startJoin(token, { name, email, origin }) {
      const i = inviteRow(token);
      if (!i) return { error: 'invite' };
      const to = cleanEmail(email);
      const who = clip(String(name ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim(), 80);
      if (!to) return { error: 'email' };
      if (!who) return { error: 'name' };
      if (tooManyFor(to)) return { error: 'slow-down' };
      const existing = db.prepare("SELECT * FROM portal_accounts WHERE email = ? AND status = 'active'").get(to);
      if (existing) {
        // Already has an account: send a sign-in link (to them only), say nothing different.
        if (existing.customer_id === i.customer_id) await mail(to, `Sign in to ${business}`, [`Use this link to sign in: ${link(origin, `/portal/verify/${makeToken({ purpose: 'login', email: to, accountId: existing.id })}`)}`, `It works once, for ${PORTAL.tokenMinutes} minutes.`]);
        return { ok: true };
      }
      const t = makeToken({ purpose: 'join', email: to, name: who, inviteId: i.id });
      await mail(to, `Finish joining ${customerName(i.customer_id)}`, [`Hi ${who}, use this link to finish joining ${customerName(i.customer_id)} on ${business}: ${link(origin, `/portal/verify/${t}`)}`, `It works once, for ${PORTAL.tokenMinutes} minutes. If you didn’t ask for this, you can ignore it.`]);
      return { ok: true };
    },
    /** "Send me a sign-in link." The answer is the same whether or not there is an account. */
    async requestLogin(email, { origin }) {
      const to = cleanEmail(email);
      if (!to) return { error: 'email' };
      if (tooManyFor(to)) return { ok: true };
      const a = db.prepare("SELECT * FROM portal_accounts WHERE email = ? AND status = 'active'").get(to);
      if (a) await mail(to, `Sign in to ${business}`, [`Use this link to sign in: ${link(origin, `/portal/verify/${makeToken({ purpose: 'login', email: to, accountId: a.id })}`)}`, `It works once, for ${PORTAL.tokenMinutes} minutes. If you didn’t ask for this, you can ignore it.`]);
      return { ok: true };
    },
    /** Whether a link would work (it is only used when the person presses the button). */
    tokenInfo(token) {
      const row = typeof token === 'string' && token.length >= 20 && token.length <= 80 ? db.prepare('SELECT * FROM portal_tokens WHERE token_hash = ?').get(hash(token)) : null;
      return row && !row.used_at && row.expires_at > now() ? { ok: true, purpose: row.purpose, name: row.name } : { error: 'token' };
    },
    /** Use a link: creates the account when joining, and a session either way. */
    redeem(token) {
      const row = typeof token === 'string' && token.length >= 20 && token.length <= 80 ? db.prepare('SELECT * FROM portal_tokens WHERE token_hash = ?').get(hash(token)) : null;
      if (!row) return { error: 'token' };
      const used = db.prepare('UPDATE portal_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?').run(now(), row.id, now());
      if (!used.changes) return { error: 'token' };
      let a;
      if (row.purpose === 'login') {
        a = account(row.account_id);
        if (!a || a.status !== 'active') return { error: 'token' };
      } else {
        const i = db.prepare('SELECT * FROM portal_invites WHERE id = ?').get(row.invite_id);
        if (!i || i.revoked || i.uses >= i.max_uses) return { error: 'invite' };
        const taken = db.prepare("SELECT * FROM portal_accounts WHERE email = ? AND status = 'active'").get(row.email);
        if (taken) return { error: 'token' };
        const first = db.prepare("SELECT COUNT(*) AS n FROM portal_accounts WHERE customer_id = ? AND status = 'active'").get(i.customer_id).n === 0;
        const old = db.prepare("SELECT id FROM portal_accounts WHERE email = ? AND status = 'removed'").get(row.email);
        if (old) db.prepare("UPDATE portal_accounts SET status = 'active', customer_id = ?, name = ?, role = ?, created_at = ? WHERE id = ?").run(i.customer_id, row.name, first ? 'admin' : 'member', now(), old.id);
        const id = old?.id ?? Number(db.prepare('INSERT INTO portal_accounts (customer_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)').run(i.customer_id, row.email, row.name, first ? 'admin' : 'member', now()).lastInsertRowid);
        db.prepare('UPDATE portal_invites SET uses = uses + 1 WHERE id = ?').run(i.id);
        a = account(id);
        audit.record(`portal:${a.email}`, 'portal.joined', `customer:${a.customer_id}`, { role: a.role });
      }
      return { ok: true, account: a, session: newSession(a.id), joined: row.purpose === 'join' };
    },
    session(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 80) return null;
      const s = db.prepare('SELECT * FROM portal_sessions WHERE token_hash = ?').get(hash(token));
      if (!s || s.expires_at <= now()) return null;
      const a = account(s.account_id);
      return a && a.status === 'active' ? { ...a, business: customerName(a.customer_id) } : null;
    },
    signOut(token) {
      if (typeof token === 'string') db.prepare('DELETE FROM portal_sessions WHERE token_hash = ?').run(hash(token));
    },

    // ================================================================ a signed-in customer
    team(acct) {
      return { members: db.prepare("SELECT id, email, name, role, last_login_at FROM portal_accounts WHERE customer_id = ? AND status = 'active' ORDER BY id").all(acct.customer_id) };
    },
    /** Any member can invite a coworker: a QR code, or an email. */
    async inviteCoworker(acct, { email = '', origin = '' } = {}) {
      if (db.prepare('SELECT COUNT(*) AS n FROM portal_invites WHERE created_by = ? AND created_at > ?').get(`account:${acct.id}`, now() - HOUR).n >= 10) return { error: 'slow-down' };
      const to = email ? cleanEmail(email) : null;
      if (email && !to) return { error: 'email' };
      const made = makeInvite(`account:${acct.id}`, acct.customer_id);
      audit.record(`portal:${acct.email}`, 'portal.invited', `customer:${acct.customer_id}`, { by: to ? 'email' : 'qr' });
      if (to) await mail(to, `${acct.name} invited you to ${acct.business} on ${business}`, [`${acct.name} invited you to send parts requests to ${business} for ${acct.business}.`, `Use this link to join: ${link(origin, `/join/${made.token}`)}`, `It works for ${PORTAL.inviteHours} hours.`]);
      return { ok: true, ...made, emailed: Boolean(to) };
    },
    removeCoworker(acct, accountId) {
      const target = account(accountId);
      if (acct.role !== 'admin' || !target || target.customer_id !== acct.customer_id || target.id === acct.id) return { error: 'forbidden' };
      db.prepare("UPDATE portal_accounts SET status = 'removed' WHERE id = ?").run(target.id);
      db.prepare('DELETE FROM portal_sessions WHERE account_id = ?').run(target.id);
      audit.record(`portal:${acct.email}`, 'portal.member-removed', `customer:${acct.customer_id}`, { email: target.email });
      return { ok: true };
    },
    setNotify(acct, on) {
      db.prepare('UPDATE portal_accounts SET notify = ? WHERE id = ?').run(on ? 1 : 0, acct.id);
      return { ok: true };
    },

    requests(acct) {
      const rows = db.prepare("SELECT * FROM calls WHERE customer_id = ? AND source = 'portal' ORDER BY id DESC LIMIT 100").all(acct.customer_id);
      return { requests: rows.map((c) => {
        const kind = kindOf(c.id, c.status);
        return { id: c.id, request: c.request, partNumbers: c.part_numbers, createdAt: c.created_at, updatedAt: c.updated_at, kind, label: UPDATE_KINDS[kind].label, open: isOpenForCustomer(kind, c.status), by: db.prepare('SELECT name FROM portal_accounts WHERE id = ?').get(c.portal_account)?.name ?? '' };
      }) };
    },
    /** One request as its owner may see it: never notes, helpers or outcomes. */
    request(acct, id) {
      const c = db.prepare("SELECT * FROM calls WHERE id = ? AND customer_id = ? AND source = 'portal'").get(id, acct.customer_id);
      if (!c) return { error: 'missing' };
      const updates = db.prepare('SELECT u.at, u.kind, u.message, a.name AS who FROM portal_updates u LEFT JOIN portal_accounts a ON a.id = u.account_id WHERE call_id = ? ORDER BY u.id').all(id);
      const kind = currentKind(updates, c.status);
      const app = JSON.parse(c.application || '{}');
      const view = details.publicView(id);
      return { ok: true, request: { id, request: c.request, partNumbers: c.part_numbers, quantity: c.quantity, vehicle: [app.year, app.make, app.model, app.engine, app.drivetrain].filter(Boolean).join(' '), vin: app.vin ?? '', createdAt: c.created_at, kind, label: UPDATE_KINDS[kind].label, open: isOpenForCustomer(kind, c.status), closed: ['resolved', 'closed'].includes(c.status), updates, details: view.details, photos: view.photos } };
    },
    createRequest(acct, input) {
      const text = clip(String(input.request ?? '').trim(), 500);
      const parts = clip(String(input.partNumbers ?? '').trim(), 200);
      if (!text && !parts) return { error: 'empty' };
      if (db.prepare("SELECT COUNT(*) AS n FROM calls WHERE source = 'portal' AND portal_account = ? AND created_at > ?").get(acct.id, now() - 24 * HOUR).n >= PORTAL.requestsPerDay) return { error: 'slow-down' };
      const wants = { pickup: 'Will pick up', deliver: 'Wants it delivered' }[input.fulfilment];
      const needed = { today: 'Needed today', week: 'Needed this week' }[input.needed];
      const note = [wants, needed].filter(Boolean).join('. ');
      const quantity = Number.parseInt(input.quantity, 10);
      const r = calls.create(SYSTEM, {
        caller_name: acct.name, request: text, part_numbers: parts, quantity: quantity > 0 && quantity < 10_000 ? quantity : null,
        notes: note ? `${note}.` : '', priority: input.needed === 'today' ? 'high' : 'normal',
        application: { year: clip(String(input.year ?? '').trim(), 4), make: clip(String(input.make ?? '').trim(), 60), model: clip(String(input.model ?? '').trim(), 80), engine: clip(String(input.engine ?? '').trim(), 80), vin: clip(String(input.vin ?? '').trim().toUpperCase(), 20) },
      }, { customerId: acct.customer_id });
      if (r.error) return r;
      db.prepare("UPDATE calls SET source = 'portal', portal_account = ?, created_by = 'portal' WHERE id = ?").run(acct.id, r.id);
      db.prepare("INSERT INTO portal_updates (call_id, at, kind, message, account_id) VALUES (?, ?, 'received', '', ?)").run(r.id, now(), acct.id);
      audit.record(`portal:${acct.email}`, 'portal.request', `call:${r.id}`, {});
      changed({ type: 'call', id: r.id });
      return { ok: true, id: r.id };
    },
    addNote(acct, id, text) {
      const c = db.prepare("SELECT * FROM calls WHERE id = ? AND customer_id = ? AND source = 'portal'").get(id, acct.customer_id);
      if (!c) return { error: 'missing' };
      if (['resolved', 'closed'].includes(c.status)) return { error: 'link-closed' };
      const t = clip(String(text ?? '').trim(), 400);
      if (!t) return { error: 'empty' };
      if (db.prepare('SELECT COUNT(*) AS n FROM portal_updates WHERE call_id = ? AND account_id = ? AND at > ?').get(id, acct.id, now() - HOUR).n >= 10) return { error: 'slow-down' };
      db.prepare("INSERT INTO portal_updates (call_id, at, kind, message, account_id) VALUES (?, ?, 'customer-note', ?, ?)").run(id, now(), t, acct.id);
      db.prepare('UPDATE calls SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now(), id);
      changed({ type: 'call', id });
      return { ok: true };
    },
    /** Details and photos a signed-in customer adds to their own request. */
    owns(acct, id) {
      return Boolean(db.prepare("SELECT 1 FROM calls WHERE id = ? AND customer_id = ? AND source = 'portal'").get(id, acct.customer_id));
    },
  };
}
