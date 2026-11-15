// Sending email. With a Resend key it sends; without one the message is kept in the outbox, where
// a manager can read it, so nothing a customer was told is lost and nothing is silently dropped.
export function createMailer({ db, now = Date.now, provider = '', apiKey = '', from = '', fetcher = globalThis.fetch, log } = {}) {
  const live = provider === 'resend' && apiKey && from;
  return {
    live: Boolean(live),
    async send({ to, subject, text }) {
      if (!live) {
        db.prepare('INSERT INTO outbox (to_email, subject, body, created_at) VALUES (?, ?, ?, ?)').run(to, subject, text, now());
        return { ok: true, queued: true };
      }
      try {
        const response = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          log?.warn('mail refused', { status: response.status, detail: (await response.text().catch(() => '')).slice(0, 200) });
          db.prepare('INSERT INTO outbox (to_email, subject, body, created_at) VALUES (?, ?, ?, ?)').run(to, subject, text, now());
          return { ok: false, queued: true };
        }
        return { ok: true };
      } catch (error) {
        log?.warn('mail failed', { message: error.message });
        db.prepare('INSERT INTO outbox (to_email, subject, body, created_at) VALUES (?, ?, ?, ?)').run(to, subject, text, now());
        return { ok: false, queued: true };
      }
    },
  };
}
