import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, owner, manager, ann, bob } from './helpers.js';
import { cleanEmail } from '../src/domain/portal.js';
import { qrSvg, qrReadFrame, QR_MAX_BYTES } from '../src/infra/qr.js';
import { PORTAL } from '../src/app/portal.js';

function setup() {
  const sent = [];
  const ctx = freshApp({ ai: { enabled: false }, business: 'Southern Auto', mail: { live: true, send: async (m) => { sent.push(m); return { ok: true }; } } });
  const cust = ctx.app.customers.create(ann, { kind: 'organization', name: 'Bubba Farms', phones: [{ phone: '5551230000' }] });
  const other = ctx.app.customers.create(ann, { kind: 'organization', name: 'Other Co', phones: [{ phone: '5559990000' }] });
  return { ...ctx, sent, cust: cust.id, other: other.id, origin: 'https://parts.example' };
}
const tokenIn = (mail) => /\/(?:join|portal\/verify)\/([A-Za-z0-9_-]+)/.exec(mail.text)[1];

/** Invite by QR, scan, enter a name and email, click the emailed link. */
async function joinAs({ app, sent, origin }, inviteToken, name, email) {
  const before = sent.length;
  assert.ok((await app.portal.startJoin(inviteToken, { name, email, origin })).ok);
  assert.equal(sent.length, before + 1);
  const r = app.portal.redeem(tokenIn(sent.at(-1)));
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

test('email addresses are checked sensibly', () => {
  assert.equal(cleanEmail(' Pat@Farm.COM '), 'pat@farm.com');
  for (const bad of ['', 'pat', 'pat@', '@farm.com', 'pat@farm', 'a b@c.com', 'a@b.com, c@d.com', '<x>@y.com']) assert.equal(cleanEmail(bad), null, bad);
});

test('a QR code is a real, self-contained picture of the address, and it scans back', () => {
  const link = 'https://parts.example/join/abcDEF123_-xyz0123456789abcdefgh';
  const svg = qrSvg(link, { label: 'Join <Bubba & Sons>' });
  assert.match(svg, /^<svg[^>]+viewBox/);
  assert.ok(svg.includes('<path'));
  assert.ok(!/<script|\son\w+=|href=/i.test(svg), 'nothing in it can run or link out');
  assert.ok(!svg.includes('<Bubba'), 'the label is escaped');
  assert.notEqual(qrSvg('a'), qrSvg('b'));
  assert.equal(qrSvg(''), null);
  assert.equal(qrSvg('x'.repeat(QR_MAX_BYTES + 1)), null, 'too long to be a code');
  // Draw the picture into pixels and read it with the decoder, as a phone would.
  const side = Number(/viewBox="0 0 (\d+) /.exec(svg)[1]);
  const scale = 6;
  const width = side * scale;
  const luma = new Uint8Array(width * width).fill(255);
  for (const [, x, y, run] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
    for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < Number(run) * scale; dx += 1) luma[(Number(y) * scale + dy) * width + Number(x) * scale + dx] = 0;
  }
  assert.equal(qrReadFrame({ width, height: width, luma }), link);
});

test('only staff with the right to invite can make an invite, and it is limited', async () => {
  const s = setup();
  assert.equal((await s.app.portal.invite({ email: 'x@e.com', roles: [] }, s.cust)).error, 'forbidden');
  assert.equal((await s.app.portal.invite(ann, 9999)).error, 'customer');
  assert.equal((await s.app.portal.invite(ann, s.cust, { email: 'nope' })).error, 'email');
  const made = await s.app.portal.invite(ann, s.cust);
  assert.ok(made.ok && made.token.length >= 30);
  assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM portal_invites').all()).includes(made.token), 'only a hash is stored');
  assert.equal(s.app.portal.inviteInfo(made.token).business, 'Bubba Farms');
  assert.equal(s.app.portal.inviteInfo('x'.repeat(30)).error, 'invite');
});

test('holding an invite is not enough: an account exists only after the emailed link is used, once', async () => {
  const s = setup();
  const { token } = await s.app.portal.invite(ann, s.cust);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 0);
  assert.ok((await s.app.portal.startJoin(token, { name: 'Pat', email: 'pat@farm.com', origin: s.origin })).ok);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 0, 'nothing yet');
  const mail = s.sent.at(-1);
  assert.equal(mail.to, 'pat@farm.com');
  assert.match(mail.text, /https:\/\/parts\.example\/portal\/verify\//);
  const link = tokenIn(mail);
  assert.equal(s.app.portal.tokenInfo(link).purpose, 'join');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 0, 'looking at the link doesn’t use it');
  const first = s.app.portal.redeem(link);
  assert.ok(first.ok && first.joined);
  assert.equal(first.account.role, 'admin', 'the first person from a business administers it');
  assert.equal(s.app.portal.redeem(link).error, 'token', 'a link works once');
  assert.equal(s.app.portal.session(first.session.token).business, 'Bubba Farms');
  assert.equal(s.app.portal.session('nope-nope-nope-nope-nope'), null, 'a made-up cookie is nobody');
});

test('bad invites and bad addresses are refused; the link expires', async () => {
  const s = setup();
  assert.equal((await s.app.portal.startJoin('z'.repeat(30), { name: 'A', email: 'a@b.com', origin: s.origin })).error, 'invite');
  const { token } = await s.app.portal.invite(ann, s.cust);
  assert.equal((await s.app.portal.startJoin(token, { name: 'A', email: 'nope', origin: s.origin })).error, 'email');
  assert.equal((await s.app.portal.startJoin(token, { name: '  ', email: 'a@b.com', origin: s.origin })).error, 'name');
  await s.app.portal.startJoin(token, { name: 'A', email: 'a@b.com', origin: s.origin });
  s.clock.t += (PORTAL.tokenMinutes + 1) * 60_000;
  assert.equal(s.app.portal.redeem(tokenIn(s.sent.at(-1))).error, 'token', 'the emailed link is short-lived');
  s.clock.t += PORTAL.inviteHours * 3_600_000;
  assert.equal(s.app.portal.inviteInfo(token).error, 'invite', 'and the invite expires');
});

test('an invite runs out, and staff can turn a business’s invites off', async () => {
  const s = setup();
  const { token } = await s.app.portal.invite(ann, s.cust);
  for (let i = 0; i < PORTAL.inviteUses; i += 1) await joinAs(s, token, `P${i}`, `p${i}@farm.com`);
  assert.equal(s.app.portal.inviteInfo(token).error, 'invite', 'used up');
  const again = await s.app.portal.invite(ann, s.cust);
  s.app.portal.revokeInvites(ann, s.cust);
  assert.equal(s.app.portal.inviteInfo(again.token).error, 'invite');
});

test('signing in: the same answer for anyone, a link only to real accounts, one use, rate-limited', async () => {
  const s = setup();
  const { token } = await s.app.portal.invite(ann, s.cust);
  await joinAs(s, token, 'Pat', 'pat@farm.com');
  s.sent.length = 0;
  assert.deepEqual(await s.app.portal.requestLogin('stranger@nowhere.com', { origin: s.origin }), { ok: true });
  assert.equal(s.sent.length, 0, 'nothing is sent to a stranger, and the answer doesn’t say so');
  assert.deepEqual(await s.app.portal.requestLogin('PAT@farm.com', { origin: s.origin }), { ok: true });
  assert.equal(s.sent.length, 1);
  const r = s.app.portal.redeem(tokenIn(s.sent[0]));
  assert.ok(r.ok && !r.joined);
  assert.equal(s.app.portal.redeem(tokenIn(s.sent[0])).error, 'token');
  for (let i = 0; i < 8; i += 1) await s.app.portal.requestLogin('pat@farm.com', { origin: s.origin });
  assert.ok(s.sent.length <= PORTAL.perEmailPerHour, 'limited per address');
  s.app.portal.signOut(r.session.token);
  assert.equal(s.app.portal.session(r.session.token), null);
});

test('one email belongs to one business; a removed person cannot get back in without a new invite', async () => {
  const s = setup();
  const a = await s.app.portal.invite(ann, s.cust);
  const b = await s.app.portal.invite(ann, s.other);
  const pat = await joinAs(s, a.token, 'Pat', 'pat@farm.com');
  s.sent.length = 0;
  await s.app.portal.startJoin(b.token, { name: 'Pat', email: 'pat@farm.com', origin: s.origin });
  assert.equal(s.sent.length, 0, 'an address already in use elsewhere gets nothing');
  assert.ok(s.app.portal.removeMember(manager, pat.account.id).ok);
  assert.equal(s.app.portal.session(pat.session.token), null, 'removing someone ends their session');
  assert.deepEqual(await s.app.portal.requestLogin('pat@farm.com', { origin: s.origin }), { ok: true });
  assert.equal(s.sent.length, 0);
  assert.equal(s.app.portal.removeMember(ann, pat.account.id).error, 'forbidden', 'staff can’t remove; managers can');
});

test('coworkers: any member invites, only an admin removes, and a business only sees its own people', async () => {
  const s = setup();
  const { token } = await s.app.portal.invite(ann, s.cust);
  const pat = await joinAs(s, token, 'Pat', 'pat@farm.com');
  const qr = await s.app.portal.inviteCoworker(pat.account, { origin: s.origin });
  assert.ok(qr.ok);
  const sam = await joinAs(s, qr.token, 'Sam', 'sam@farm.com');
  assert.equal(sam.account.role, 'member');
  assert.equal(sam.account.customer_id, s.cust, 'locked to the same business');
  const byEmail = await s.app.portal.inviteCoworker(sam.account, { email: 'lee@farm.com', origin: s.origin });
  assert.ok(byEmail.emailed);
  assert.equal(s.sent.at(-1).to, 'lee@farm.com');
  assert.match(s.sent.at(-1).text, /Sam invited you/);
  assert.equal(s.app.portal.team(pat.account).members.length, 2);
  assert.equal(s.app.portal.removeCoworker(sam.account, pat.account.id).error, 'forbidden', 'a member can’t remove');
  assert.equal(s.app.portal.removeCoworker(pat.account, pat.account.id).error, 'forbidden', 'nor yourself');
  assert.ok(s.app.portal.removeCoworker(pat.account, sam.account.id).ok);
  const otherInvite = await s.app.portal.invite(ann, s.other);
  const zed = await joinAs(s, otherInvite.token, 'Zed', 'zed@other.com');
  assert.equal(s.app.portal.removeCoworker(zed.account, pat.account.id).error, 'forbidden', 'another business can’t touch them');
});

test('a request becomes a call for staff, and the customer sees only what is theirs', async () => {
  const s = setup();
  const pat = (await joinAs(s, (await s.app.portal.invite(ann, s.cust)).token, 'Pat', 'pat@farm.com')).account;
  const zed = (await joinAs(s, (await s.app.portal.invite(ann, s.other)).token, 'Zed', 'zed@other.com')).account;
  assert.equal(s.app.portal.createRequest(pat, {}).error, 'empty');
  const made = s.app.portal.createRequest(pat, { request: 'water pump for the tractor', partNumbers: 'AW9301', quantity: '2', year: '2015', make: 'John Deere', model: '5075E', fulfilment: 'pickup', needed: 'today' });
  assert.ok(made.ok);
  const call = s.app.calls.get(ann, made.id);
  assert.equal(call.call.customer_id, s.cust);
  assert.equal(call.call.priority, 'high');
  assert.match(call.call.notes, /Will pick up\. Needed today/);
  assert.equal(call.call.assignee, null, 'it waits in the shared queue');
  assert.equal(s.db.prepare('SELECT source FROM calls WHERE id = ?').get(made.id).source, 'portal');

  const view = s.app.portal.request(pat, made.id).request;
  assert.deepEqual([view.kind, view.label, view.open], ['received', 'We got your request', true]);
  assert.equal(view.vehicle, '2015 John Deere 5075E');
  assert.ok(!JSON.stringify(view).includes('Will pick up'), 'internal notes are not shown');
  assert.equal(s.app.portal.request(zed, made.id).error, 'missing', 'another business can’t see it');
  assert.equal(s.app.portal.requests(zed).requests.length, 0);
  assert.equal(s.app.portal.requests(pat).requests.length, 1);
  const phone = s.app.calls.create(ann, { request: 'phone call' }, { customerId: s.cust }).id;
  assert.equal(s.app.portal.request(pat, phone).error, 'missing', 'phone calls aren’t on the portal');
});

test('staff updates reach the customer on the page and by email; they can answer with a note', async () => {
  const s = setup();
  const pat = (await joinAs(s, (await s.app.portal.invite(ann, s.cust)).token, 'Pat', 'pat@farm.com')).account;
  const id = s.app.portal.createRequest(pat, { request: 'belt' }).id;
  s.sent.length = 0;
  assert.equal((await s.app.portal.postUpdate(ann, id, { kind: 'bogus', origin: s.origin })).error, 'kind');
  assert.equal((await s.app.portal.postUpdate(ann, id, { kind: 'need-info', origin: s.origin })).error, 'message', 'asking for more needs words');
  assert.equal((await s.app.portal.postUpdate({ email: 'x@e.com', roles: [] }, id, { kind: 'looking' })).error, 'forbidden');
  assert.equal((await s.app.portal.postUpdate(ann, s.app.calls.create(ann, {}).id, { kind: 'looking' })).error, 'missing', 'only web requests');
  assert.ok((await s.app.portal.postUpdate(ann, id, { kind: 'need-info', message: 'Which engine?', origin: s.origin })).ok);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].to, 'pat@farm.com');
  assert.match(s.sent[0].text, /Which engine\?/);
  assert.match(s.sent[0].text, /\/portal\/requests\/\d+/);
  assert.equal(s.app.portal.request(pat, id).request.label, 'We need a bit more from you');
  assert.ok(s.app.portal.addNote(pat, id, '6.8L diesel').ok);
  assert.equal(s.app.portal.addNote(pat, id, '   ').error, 'empty');
  assert.equal(s.app.portal.updatesFor(id).at(-1).message, '6.8L diesel');
  assert.equal(s.app.portal.request(pat, id).request.kind, 'need-info', 'their note doesn’t change the status');
  await s.app.portal.postUpdate(ann, id, { kind: 'ready', email: false, origin: s.origin });
  assert.equal(s.sent.length, 1, 'staff can choose not to email');
  s.app.portal.setNotify(pat, false);
  await s.app.portal.postUpdate(ann, id, { kind: 'on-the-way', origin: s.origin });
  assert.equal(s.sent.length, 1, 'and someone who turned emails off gets none');
  await s.app.portal.postUpdate(ann, id, { kind: 'done', origin: s.origin });
  assert.equal(s.app.portal.request(pat, id).request.open, false);
});

test('a customer can add measurements and photos to their own request only', async () => {
  const s = setup();
  const pat = (await joinAs(s, (await s.app.portal.invite(ann, s.cust)).token, 'Pat', 'pat@farm.com')).account;
  const zed = (await joinAs(s, (await s.app.portal.invite(ann, s.other)).token, 'Zed', 'zed@other.com')).account;
  const id = s.app.portal.createRequest(pat, { request: 'bearing' }).id;
  assert.ok(s.app.portal.owns(pat, id));
  assert.ok(!s.app.portal.owns(zed, id));
});

test('without a mail service, messages wait in the outbox for a manager', async () => {
  const ctx = freshApp({ ai: { enabled: false }, business: 'Southern Auto' });
  const c = ctx.app.customers.create(ann, { kind: 'organization', name: 'Bubba Farms', phones: [{ phone: '5551230000' }] });
  const inv = await ctx.app.portal.invite(ann, c.id);
  await ctx.app.portal.startJoin(inv.token, { name: 'Pat', email: 'pat@farm.com', origin: 'https://x.example' });
  assert.equal(ctx.app.portal.outbox(ann).error, 'forbidden');
  const box = ctx.app.portal.outbox(manager);
  assert.equal(box.live, false);
  assert.equal(box.messages[0].to_email, 'pat@farm.com');
  void owner; void bob;
});

test('a customer’s badge is scanned by staff, once, within minutes, and tells staff who it is', async () => {
  const s = setup();
  const pat = (await joinAs(s, (await s.app.portal.invite(ann, s.cust)).token, 'Pat', 'pat@farm.com')).account;
  const { token } = s.app.portal.badge(pat);
  assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM portal_badges').all()).includes(token), 'only a hash is kept');
  assert.equal(s.app.portal.readBadge({ email: 'x@e.com', roles: [] }, token).error, 'forbidden', 'customers can’t scan');
  assert.equal(s.app.portal.readBadge(ann, 'nope').error, 'badge');
  const read = s.app.portal.readBadge(ann, token);
  assert.deepEqual([read.name, read.email, read.customer.name], ['Pat', 'pat@farm.com', 'Bubba Farms']);
  assert.equal(s.app.portal.readBadge(bob, token).error, 'badge', 'a second scan, or a photo of it, is worth nothing');
  const late = s.app.portal.badge(pat).token;
  s.clock.t += (PORTAL.badgeMinutes + 1) * 60_000;
  assert.equal(s.app.portal.readBadge(ann, late).error, 'badge', 'it expires');
  const gone = s.app.portal.badge(pat).token;
  s.app.portal.removeMember(manager, pat.id);
  assert.equal(s.app.portal.readBadge(ann, gone).error, 'badge', 'and a removed person’s badge stops working');
  assert.ok(s.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'portal.badge-scanned'").get().n >= 1);
});

test('badges are limited per person', async () => {
  const s = setup();
  const pat = (await joinAs(s, (await s.app.portal.invite(ann, s.cust)).token, 'Pat', 'pat@farm.com')).account;
  let last;
  for (let i = 0; i < 25; i += 1) last = s.app.portal.badge(pat);
  assert.equal(last.error, 'slow-down');
});

test('an employee’s own code lets a customer ask for access; staff approve and a join link goes out', async () => {
  const s = setup();
  assert.equal(s.app.portal.repCode({ email: 'x@e.com', roles: [] }).error, 'forbidden');
  const first = s.app.portal.repCode(ann);
  assert.equal(s.app.portal.repInfo(first.token).rep, ann.email);
  const second = s.app.portal.repCode(ann);
  assert.equal(s.app.portal.repInfo(first.token).error, 'code', 'a new code turns the old one off');
  assert.equal(s.app.portal.askAccess('z'.repeat(30), { name: 'Pat', business: 'Bubba Farms', email: 'pat@farm.com' }).error, 'code');
  assert.equal(s.app.portal.askAccess(second.token, { name: 'Pat', business: 'Bubba Farms', email: 'nope' }).error, 'email');
  assert.equal(s.app.portal.askAccess(second.token, { name: '', business: 'B', email: 'a@b.com' }).error, 'name');
  assert.equal(s.app.portal.askAccess(second.token, { name: 'A', business: ' ', email: 'a@b.com' }).error, 'business');
  assert.ok(s.app.portal.askAccess(second.token, { name: 'Pat Farmer', business: 'Bubba Farms LLC', email: 'Pat@Farm.com', phone: '555-777-8888' }).ok);
  assert.ok(s.app.portal.askAccess(second.token, { name: 'Pat Farmer', business: 'Bubba Farms LLC', email: 'pat@farm.com' }).ok, 'asking twice is the same answer');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM access_requests').get().n, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 0, 'nothing exists until staff say so');
  assert.equal(s.sent.length, 0, 'and nothing is emailed');
  assert.match(s.db.prepare("SELECT message FROM nudges WHERE to_email = ?").get(ann.email).message, /Pat Farmer from Bubba Farms LLC/);

  assert.equal((await s.app.portal.accessRequests({ email: 'x@e.com', roles: [] })).error, 'forbidden');
  const [req] = s.app.portal.accessRequests(ann).requests;
  assert.equal(req.matches[0].name, 'Bubba Farms', 'staff are shown the customer it probably is');
  assert.equal((await s.app.portal.decideAccess(ann, req.id, { action: 'approve', customerId: 9999, origin: s.origin })).error, 'customer');
  const done = await s.app.portal.decideAccess(ann, req.id, { action: 'approve', customerId: s.cust, origin: s.origin });
  assert.equal(done.customerId, s.cust);
  assert.equal(s.sent.at(-1).to, 'pat@farm.com');
  assert.match(s.sent.at(-1).text, /\/join\//);
  assert.equal((await s.app.portal.decideAccess(ann, req.id, { action: 'approve', origin: s.origin })).error, 'missing', 'decided once');
  const joined = s.app.portal.redeem(tokenIn(s.sent.at(-1)));
  assert.equal(joined.error, 'token', 'the join link needs the name step first: it is an invite, not a sign-in');
});

test('approving can add a new business, and declining ends it; limits stop a flood', async () => {
  const s = setup();
  const { token } = s.app.portal.repCode(ann);
  s.app.portal.askAccess(token, { name: 'Lee', business: 'Lee Towing', email: 'lee@tow.com', phone: '5553334444' });
  s.app.portal.askAccess(token, { name: 'Moe', business: 'Moe Motors', email: 'moe@motors.com' });
  const [lee, moe] = s.app.portal.accessRequests(manager).requests;
  const made = await s.app.portal.decideAccess(manager, lee.id, { action: 'approve', origin: s.origin });
  assert.ok(made.ok && made.customerId);
  assert.equal(s.app.customers.get(manager, made.customerId).customer.name, 'Lee Towing');
  assert.ok((await s.app.portal.decideAccess(manager, moe.id, { action: 'decline' })).ok);
  assert.equal(s.app.portal.accessRequests(manager).requests.length, 0);
  assert.equal(s.sent.filter((m) => m.to === 'moe@motors.com').length, 0, 'a declined request hears nothing');
  for (let i = 0; i < 12; i += 1) s.app.portal.askAccess(token, { name: `P${i}`, business: `B${i}`, email: `p${i}@x.com` });
  assert.equal(s.app.portal.askAccess(token, { name: 'Z', business: 'Z', email: 'z@x.com' }).error, 'slow-down');
  s.app.portal.repCode(ann);
  s.clock.t += 2 * 3_600_000;
  const again = s.app.portal.repCode(ann);
  for (let i = 0; i < 4; i += 1) s.app.portal.askAccess(again.token, { name: 'Many', business: 'Many Co', email: 'many@x.com' });
  assert.ok(s.db.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE email = 'many@x.com'").get().n <= 1, 'one pending per address');
});
