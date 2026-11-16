// For the owner: what is switched on, and a way to prove the AI works without reading the logs.
// Also the QR code that carries a signed-in person to their phone.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { esc } from '../html.js';
import { badge } from '../ui.js';
import { qrSvg } from '../../infra/qr.js';
import { safePath } from '../doors.js';

const originOf = (ctx) => (ctx.config.publicUrl || `${ctx.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${ctx.req.headers.host}`).replace(/\/$/, '');
const isOwner = (who) => Boolean(who?.roles?.includes('owner'));
const AI_FIX = {
  off: 'Set ANTHROPIC_API_KEY on the host, then redeploy.',
  auth: 'The key was refused. Copy it again from the Anthropic console (it starts with sk-ant-), with no spaces or quotes, and check the account has credit.',
  model: 'The model name isn’t one this key can use. Remove AI_MODEL to use the default, or set it to a model your account has.',
  rate: 'The service is limiting this key. Wait a minute, and check the account’s spending limit.',
  busy: 'The AI service is having trouble on its side. Try again in a few minutes.',
  timeout: 'No answer in 20 seconds. Try again.',
  failed: 'Read the message from the service above; it usually says what to change.',
};

export function systemRoutes(router) {
  router.get('/system', (ctx) => {
    if (!isOwner(ctx.who)) return ctx.forbidden();
    const { app, config, page } = ctx;
    const yes = (on, good, bad) => (on ? badge(page, 'success', good) : badge(page, 'warning', bad));
    const row = (name, state, note) => `<tr><th scope="row">${name}</th><td>${state}</td><td>${note}</td></tr>`;
    const dir = process.env.BACKUP_DIR ?? (config.database && config.database !== ':memory:' ? join(dirname(config.database), 'backups') : '');
    const backups = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.db')).sort() : [];
    return ctx.send('System check', `<div class="head"><div><h1>System check</h1><p class="muted">What is switched on. Only an owner sees this page. No keys are shown.</p></div></div>
      <section class="panel stack"><div class="scroll-x"><table class="grid compact"><thead><tr><th>Part</th><th>State</th><th>Details</th></tr></thead><tbody>
        ${row('AI part finder and page reader', yes(app.ai.enabled, 'Key is set', 'Off'), app.ai.enabled ? `Model <code>${esc(app.ai.model ?? 'default')}</code>. Press the button to prove it answers.` : 'Set <code>ANTHROPIC_API_KEY</code>.')}
        ${row('Email to customers', yes(app.mailer.live, 'On', 'Off'), app.mailer.live ? `From ${esc(config.mail?.from ?? '')}` : 'Needs <code>MAIL_PROVIDER=resend</code>, <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code>.')}
        ${row('Texts', yes(app.texter.live, 'On', 'Off'), app.texter.live ? `Through ${esc(config.sms?.provider ?? '')}` : 'Optional. Needs <code>SMS_PROVIDER</code> with its key and <code>SMS_SENDER</code>.')}
        ${row('Site address', yes(Boolean(config.publicUrl), 'Set', 'Not set'), config.publicUrl ? esc(config.publicUrl) : 'Set <code>PUBLIC_URL</code> so links in emails and QR codes use the real address.')}
        ${row('Backups', yes(backups.length > 0, `${backups.length} kept`, 'None yet'), backups.length ? `Newest: ${esc(backups.at(-1))}` : 'A copy is made when the app starts and every 24 hours.')}
      </tbody></table></div>
      <form method="post" action="/system/ai-test"><button class="btn primary">Test the AI</button></form></section>`, { active: 'system' });
  });

  router.post('/system/ai-test', async (ctx) => {
    if (!isOwner(ctx.who)) return ctx.forbidden();
    const r = ctx.app.ai.check ? await ctx.app.ai.check() : { error: 'off', status: 0, detail: 'This server is using a stand-in for the AI.' };
    ctx.app.audit.record(ctx.who.email, 'system.ai-test', 'settings', { ok: Boolean(r.ok), status: r.status ?? 0 });
    if (r.ok) return ctx.redirect('/system', { done: 'The AI answered. The part finder and the page reader will work.' });
    return ctx.redirect('/system', { problem: `The AI didn’t answer${r.status ? ` (${r.status})` : ''}: ${r.detail || 'no reason given'}. ${AI_FIX[r.error] ?? AI_FIX.failed}` });
  });

  // Carry on, on your phone: a code that signs this person in there and opens the same page.
  router.get('/phone', async (ctx) => {
    const to = safePath(ctx.url.searchParams.get('to'));
    const made = await ctx.staff.handOff(ctx.who, { minutes: 10 });
    if (made.error) return ctx.redirect(to, { problem: made.error });
    const url = `${originOf(ctx)}/phone/${made.token}${to === '/' ? '' : `?to=${encodeURIComponent(to)}`}`;
    const svg = qrSvg(url, { label: 'Open on your phone' });
    return ctx.send('On your phone', `<div class="head"><h1>Open it on your phone</h1><a class="btn" href="${esc(to)}">Back</a></div>
      <section class="panel stack"><p>Point your phone’s camera at this. It signs you in there and opens the same page. It works once, for ten minutes.</p>
      ${svg ? `<div class="qr">${svg}</div>` : `<p class="flash problem" role="alert">The address is too long for a code. On your phone, go to ${esc(originOf(ctx))} and sign in.</p>`}
      <p class="muted">Don’t let anyone else scan it: it signs them in as you.</p></section>`);
  });
}
