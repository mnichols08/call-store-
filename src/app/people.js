// One person joining a customer, and how they sign in after.
//
// A rep makes a one-time link for one person (texted, emailed, or shown as a QR on the rep's
// phone). The person opens it, gives their name, and sets up a passkey or a username and password.
// The emailed sign-in link stays as a backup for anyone with an email on file.
import { createHash, randomBytes } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { hashPassword, checkPassword } from '../../vendor/kit/staff/index.js';
import { can } from '../domain/permissions.js';
import { cleanEmail } from '../domain/portal.js';
import { e164 } from '../infra/sms.js';

const MIN = 60_000;
const HOUR = 3_600_000;
export const PEOPLE = Object.freeze({ inviteHours: 72, challengeMinutes: 5, invitesPerRepPerHour: 30, failedSignInsPer15Min: 8 });
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,39}$/i;
const hash = (token) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(24).toString('base64url');
const fine = (token) => typeof token === 'string' && token.length >= 20 && token.length <= 80;

/**
 * `session(accountId)` makes a portal session (the portal's own). `relying` is where passkeys live:
 * `{ rpID, origin, rpName }`, from the public address.
 */
export function createPeople({ db, audit, now, mailer, texter, session, business = 'the shop', cost }) {
  const customerName = (id) => db.prepare('SELECT name FROM customers WHERE id = ?').get(id)?.name ?? '';
  const inviteRow = (token) => {
    if (!fine(token)) return null;
    const i = db.prepare('SELECT * FROM portal_person_invites WHERE token_hash = ?').get(hash(token));
    return i && !i.used_at && i.expires_at > now() ? i : null;
  };
  const failures = new Map(); // username -> [times]
  const tooManyFailures = (key) => (failures.get(key) ?? []).filter((t) => t > now() - 15 * MIN).length >= PEOPLE.failedSignInsPer15Min;
  const failed = (key) => failures.set(key, [...(failures.get(key) ?? []).filter((t) => t > now() - 15 * MIN), now()]);
  const decoy = hashPassword(newToken(), cost);

  function challenge(purpose, value, data = {}) {
    const handle = newToken();
    db.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').run(now());
    db.prepare('INSERT INTO webauthn_challenges (handle_hash, challenge, purpose, data, expires_at) VALUES (?, ?, ?, ?, ?)').run(hash(handle), value, purpose, JSON.stringify(data), now() + PEOPLE.challengeMinutes * MIN);
    return handle;
  }
  /** A challenge is used once, whatever happens next. */
  function takeChallenge(handle, purpose) {
    if (!fine(handle)) return null;
    const row = db.prepare('SELECT * FROM webauthn_challenges WHERE handle_hash = ? AND purpose = ?').get(hash(handle), purpose);
    if (!row) return null;
    db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(row.id);
    return row.expires_at > now() ? { challenge: row.challenge, data: JSON.parse(row.data) } : null;
  }

  function createAccount(i, name, extra = {}) {
    const first = db.prepare("SELECT COUNT(*) AS n FROM portal_accounts WHERE customer_id = ? AND status = 'active'").get(i.customer_id).n === 0;
    const email = cleanEmail(i.email) || null;
    if (email && db.prepare('SELECT 1 FROM portal_accounts WHERE email = ?').get(email)) return { error: 'email-taken' };
    const id = Number(db.prepare('INSERT INTO portal_accounts (customer_id, email, name, role, created_at, phone, username, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(i.customer_id, email, name, first ? 'admin' : 'member', now(), i.phone, extra.username ?? null, extra.passwordHash ?? null).lastInsertRowid);
    db.prepare('UPDATE portal_person_invites SET used_at = ?, account_id = ? WHERE id = ?').run(now(), id, i.id);
    audit.record(`portal:${extra.username ?? email ?? id}`, 'portal.joined', `customer:${i.customer_id}`, { role: first ? 'admin' : 'member', via: extra.username ? 'password' : 'passkey' });
    return { ok: true, accountId: id };
  }
  const cleanName = (name) => String(name ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 80);

  return {
    /**
     * A rep invites one person at a customer. `via` is text, email or qr; text and email send the
     * link, qr just returns it (the rep shows it on their screen).
     */
    async invite(who, customerId, { name = '', phone = '', email = '', via = 'qr', origin = '' } = {}) {
      if (!can(who, 'portal.invite')) return { error: 'forbidden' };
      if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) return { error: 'customer' };
      if (!['text', 'email', 'qr'].includes(via)) return { error: 'via' };
      if (db.prepare('SELECT COUNT(*) AS n FROM portal_person_invites WHERE created_by = ? AND created_at > ?').get(who.email, now() - HOUR).n >= PEOPLE.invitesPerRepPerHour) return { error: 'slow-down' };
      const to = { phone: phone ? e164(phone) : '', email: email ? cleanEmail(email) : '' };
      if (phone && !to.phone) return { error: 'phone' };
      if (email && !to.email) return { error: 'email' };
      if (via === 'text' && !to.phone) return { error: 'phone' };
      if (via === 'email' && !to.email) return { error: 'email' };
      const token = newToken();
      const t = now();
      db.prepare('INSERT INTO portal_person_invites (token_hash, customer_id, name, phone, email, sent_by, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(hash(token), customerId, cleanName(name), to.phone ?? '', to.email ?? '', via, who.email, t, t + PEOPLE.inviteHours * HOUR);
      const url = `${String(origin).replace(/\/$/, '')}/welcome/${token}`;
      const shop = customerName(customerId);
      if (via === 'text') await texter.send({ to: to.phone, text: `${business}: set up your account for ${shop}: ${url} (works once, for 3 days)` });
      if (via === 'email') await mailer.send({ to: to.email, subject: `Your account for ${shop} at ${business}`, text: `${name ? `Hi ${cleanName(name)}, ` : ''}${business} set up an account for you to order for ${shop}.\n\nUse this link to finish: ${url}\n\nIt works once, for 3 days.\n\n— ${business}` });
      audit.record(who.email, 'portal.person-invited', `customer:${customerId}`, { via });
      return { ok: true, token, url, via, expires: t + PEOPLE.inviteHours * HOUR };
    },

    /** What the welcome page shows, or why the link doesn't work. */
    info(token) {
      const i = inviteRow(token);
      return i ? { ok: true, business: customerName(i.customer_id), name: i.name, hasEmail: Boolean(i.email) } : { error: 'token' };
    },

    /** Finish with a username and password. */
    async joinWithPassword(token, { name, username, password }) {
      if (!inviteRow(token)) return { error: 'token' };
      const who = cleanName(name);
      if (!who) return { error: 'name' };
      username = String(username ?? '').trim();
      if (!USERNAME.test(username)) return { error: 'username' };
      if (typeof password !== 'string' || password.length < 10 || password.length > 200) return { error: 'password' };
      if (db.prepare('SELECT 1 FROM portal_accounts WHERE username = ?').get(username)) return { error: 'username-taken' };
      const passwordHash = await hashPassword(password, cost);
      // Again after hashing, before the write: two tabs finishing at once make one account.
      const i = inviteRow(token);
      if (!i) return { error: 'token' };
      if (db.prepare('SELECT 1 FROM portal_accounts WHERE username = ?').get(username)) return { error: 'username-taken' };
      const made = createAccount(i, who, { username, passwordHash });
      return made.error ? made : { ok: true, session: session(made.accountId) };
    },

    /** Step one of finishing with a passkey: the options the browser needs. */
    async passkeyOptions(token, { name }, relying) {
      const i = inviteRow(token);
      if (!i) return { error: 'token' };
      const who = cleanName(name);
      if (!who) return { error: 'name' };
      const options = await generateRegistrationOptions({
        rpName: relying.rpName ?? business, rpID: relying.rpID, userName: who, userDisplayName: who,
        attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } });
      return { ok: true, options, handle: challenge('register', options.challenge, { invite: i.id, name: who, user: options.user.id }) };
    },
    /** Step two: check what the browser made, then make the account and keep the public key. */
    async joinWithPasskey(token, handle, response, relying) {
      const c = takeChallenge(handle, 'register');
      const i = inviteRow(token);
      if (!c || !i || c.data.invite !== i.id) return { error: 'token' };
      let verified;
      try {
        verified = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: relying.origin, expectedRPID: relying.rpID, requireUserVerification: false });
      } catch { return { error: 'passkey' }; }
      if (!verified.verified || !verified.registrationInfo) return { error: 'passkey' };
      const { credential } = verified.registrationInfo;
      if (db.prepare('SELECT 1 FROM portal_passkeys WHERE credential_id = ?').get(credential.id)) return { error: 'passkey' };
      if (!inviteRow(token)) return { error: 'token' };
      const made = createAccount(i, c.data.name);
      if (made.error) return made;
      db.prepare('INSERT INTO portal_passkeys (account_id, credential_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(made.accountId, credential.id, Buffer.from(credential.publicKey), credential.counter ?? 0, JSON.stringify(credential.transports ?? []), now());
      return { ok: true, session: session(made.accountId) };
    },

    /** Sign in with a username and password. The same answer for a wrong name or a wrong password. */
    async signIn(username, password) {
      const key = String(username ?? '').trim().toLowerCase();
      if (!key || tooManyFailures(key)) return { error: 'sign-in' };
      const a = db.prepare("SELECT * FROM portal_accounts WHERE username = ? AND status = 'active'").get(key);
      const ok = await checkPassword(String(password ?? ''), a?.password_hash ?? (await decoy));
      if (!a || !ok) { failed(key); return { error: 'sign-in' }; }
      return { ok: true, session: session(a.id) };
    },
    /** A passkey sign-in, step one: a challenge (any passkey for this site may answer it). */
    async signInOptions(relying) {
      const options = await generateAuthenticationOptions({ rpID: relying.rpID, userVerification: 'preferred' });
      return { options, handle: challenge('sign-in', options.challenge) };
    },
    async signInWithPasskey(handle, response, relying) {
      const c = takeChallenge(handle, 'sign-in');
      if (!c || typeof response?.id !== 'string') return { error: 'sign-in' };
      const key = db.prepare('SELECT * FROM portal_passkeys WHERE credential_id = ?').get(response.id);
      const a = key ? db.prepare("SELECT * FROM portal_accounts WHERE id = ? AND status = 'active'").get(key.account_id) : null;
      if (!a) return { error: 'sign-in' };
      let verified;
      try {
        verified = await verifyAuthenticationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: relying.origin, expectedRPID: relying.rpID, requireUserVerification: false,
          credential: { id: key.credential_id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) } });
      } catch { return { error: 'sign-in' }; }
      if (!verified.verified) return { error: 'sign-in' };
      db.prepare('UPDATE portal_passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(verified.authenticationInfo.newCounter, now(), key.id);
      return { ok: true, session: session(a.id) };
    },
  };
}

/** Where passkeys belong: the host of the public address (or of the request, in development). */
export function relyingParty(origin, rpName) {
  const u = new URL(origin);
  return { rpID: u.hostname, origin: u.origin, rpName };
}
