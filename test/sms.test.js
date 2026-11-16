import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/infra/db.js';
import { createTexter, e164 } from '../src/infra/sms.js';

const fresh = () => {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
};
const outbox = (db) => db.prepare('SELECT channel, to_email, body FROM outbox').all().map((row) => ({ ...row }));

test('US numbers in any format, and nothing else', () => {
  assert.equal(e164('(301) 555-0142'), '+13015550142');
  assert.equal(e164('1-301-555-0142'), '+13015550142');
  assert.equal(e164('555-0142'), '');
  assert.equal(e164('011 44 20 7946 0958'), '');
  assert.equal(e164('(101) 555-0142'), '', 'area codes never start with 0 or 1');
});

test('without a provider, a text waits in the outbox', async () => {
  const db = fresh();
  const texter = createTexter({ db });
  assert.equal(texter.live, false);
  assert.deepEqual(await texter.send({ to: '301 555 0142', text: 'Join here: https://x/j/abc' }), { ok: true, queued: true });
  assert.deepEqual(outbox(db), [{ channel: 'text', to_email: '+13015550142', body: 'Join here: https://x/j/abc' }]);
  assert.deepEqual(await texter.send({ to: 'nope', text: 'x' }), { error: 'phone' });
});

test('Brevo and Twilio get the request their APIs expect; a refusal keeps the text', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url: String(url), init });
    return { ok: !String(url).includes('twilio') || seen.length < 3, status: 200, text: async () => '' };
  };
  const db = fresh();
  const brevo = createTexter({ db, provider: 'brevo', apiKey: 'xkeysib', sender: 'SouthernAuto', fetcher });
  assert.equal(brevo.live, true);
  assert.deepEqual(await brevo.send({ to: '3015550142', text: 'Hi' }), { ok: true });
  assert.equal(seen[0].url, 'https://api.brevo.com/v3/transactionalSMS/send');
  assert.equal(seen[0].init.headers['api-key'], 'xkeysib');
  assert.deepEqual(JSON.parse(seen[0].init.body), { sender: 'SouthernAuto', recipient: '13015550142', content: 'Hi', type: 'transactional', tag: 'sign-in' });

  const twilio = createTexter({ db, provider: 'twilio', account: 'AC1', apiKey: 'tok', sender: '+13015550100', fetcher });
  assert.deepEqual(await twilio.send({ to: '3015550142', text: 'Hi' }), { ok: true });
  assert.equal(seen[1].url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
  assert.equal(seen[1].init.body.get('To'), '+13015550142');
  assert.equal(seen[1].init.headers.authorization, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);
  assert.deepEqual(await twilio.send({ to: '3015550142', text: 'Again' }), { ok: false, queued: true });
  assert.equal(outbox(db).length, 1);
});
