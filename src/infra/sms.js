// Sending texts. With a provider set up it sends (Brevo, or Twilio); without one the text is kept in
// the outbox, where a manager can read it and send it by hand, so nothing is silently dropped. Like
// the mailer, the provider is chosen by settings and the rest of the app only calls `send`.
//
//   SMS_PROVIDER=brevo   BREVO_API_KEY, SMS_SENDER (up to 11 letters, or a number)
//   SMS_PROVIDER=twilio  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SMS_SENDER (a Twilio number, +1…)

/** A US number as +1XXXXXXXXXX, or '' if it isn't one. Ten digits, or eleven starting with 1. */
export function e164(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length === 10 && !/^[01]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && !/^[01]/.test(digits.slice(1))) return `+${digits}`;
  return '';
}

export function createTexter({ db, now = Date.now, provider = '', apiKey = '', sender = '', account = '', fetcher = globalThis.fetch, log } = {}) {
  const live = (provider === 'brevo' && apiKey && sender) || (provider === 'twilio' && account && apiKey && sender);
  const keep = (to, text) => db.prepare("INSERT INTO outbox (channel, to_email, subject, body, created_at) VALUES ('text', ?, ?, ?, ?)").run(to, 'Text message', text, now());

  async function deliver(to, text) {
    if (provider === 'brevo') {
      return fetcher('https://api.brevo.com/v3/transactionalSMS/send', {
        method: 'POST',
        headers: { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json' },
        // No stop code in the text, so Brevo sends it as transactional, not marketing.
        body: JSON.stringify({ sender, recipient: to.replace(/^\+/, ''), content: text, type: 'transactional', tag: 'sign-in' }),
        signal: AbortSignal.timeout(15_000),
      });
    }
    return fetcher(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${account}:${apiKey}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: sender, Body: text }),
      signal: AbortSignal.timeout(15_000),
    });
  }

  return {
    live: Boolean(live),
    /** Text `text` to a US phone number. `{ ok }`, `{ ok, queued }` (kept in the outbox) or `{ error: 'phone' }`. */
    async send({ to, text }) {
      const number = e164(to);
      if (!number) return { error: 'phone' };
      if (!live) {
        keep(number, text);
        return { ok: true, queued: true };
      }
      try {
        const response = await deliver(number, text);
        if (!response.ok) {
          log?.warn('text refused', { provider, status: response.status, detail: (await response.text().catch(() => '')).slice(0, 200) });
          keep(number, text);
          return { ok: false, queued: true };
        }
        return { ok: true };
      } catch (error) {
        log?.warn('text failed', { provider, message: error.message });
        keep(number, text);
        return { ok: false, queued: true };
      }
    },
  };
}
