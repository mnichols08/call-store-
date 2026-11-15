// Nudges and the browser-notification plumbing around them.
import { say } from '../ui.js';

export function nudgeRoutes(router) {
  // Nudge someone about a call.
  router.post('/calls/:id/nudge', (ctx) => {
    const id = Number(ctx.params.id);
    const to = ctx.form.get('to') ?? '';
    const back = `/calls/${id}`;
    if (!ctx.people.list().some((p) => p.email === to)) return ctx.redirect(back, { problem: say('nudge-who') });
    const sent = ctx.app.nudges.send(ctx.who, { to, callId: id, message: ctx.form.get('message') ?? '' });
    return ctx.redirect(back, sent.error ? { problem: say(sent.error) } : { done: `Nudged ${ctx.people.name(to)}.` });
  });

  // Dismiss from the Today panel (a plain form) or from a toast (fetch).
  router.post('/nudges/:id/dismiss', (ctx) => {
    ctx.app.nudges.dismiss(ctx.who, Number(ctx.params.id));
    return ctx.wantsJson ? ctx.json({ ok: true }) : ctx.redirect('/');
  });
  router.post('/nudges/dismiss-all', (ctx) => {
    ctx.app.nudges.dismissAll(ctx.who);
    return ctx.wantsJson ? ctx.json({ ok: true }) : ctx.redirect('/');
  });

  // The browser asks for the public key, then registers itself.
  router.get('/push/key', (ctx) => ctx.json({ key: ctx.push.publicKey }));
  router.post('/push/subscribe', (ctx) => {
    let subscription;
    try {
      subscription = JSON.parse(ctx.form.get('subscription') ?? '');
    } catch {
      return ctx.json({ error: 'subscription' }, 400);
    }
    const result = ctx.app.nudges.subscribe(ctx.who, subscription);
    return ctx.json(result, result.error ? 400 : 200);
  });
  router.post('/push/unsubscribe', (ctx) => ctx.json(ctx.app.nudges.unsubscribe(ctx.who, ctx.form.get('endpoint'))));
}
