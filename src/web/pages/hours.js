// Hours and closures: the week is fixed in the shop's profile; managers add holidays and special hours here.
import { esc } from '../html.js';
import { say } from '../ui.js';
import { can } from '../../domain/permissions.js';
import { weekTable } from '../../domain/hours.js';

const WORDS = { date: 'That date doesn’t look right.', past: 'That day has already passed.', hours: 'Give both an opening and a closing time, with closing after opening. Leave both empty to close the day.', 'too-many': 'That’s a lot of closures. Remove old ones first.' };
const words = (r) => WORDS[r.error] ?? say(r.error);

export function hoursRoutes(router) {
  router.get('/hours', (ctx) => {
    if (!can(ctx.who, 'hours.manage')) return ctx.forbidden();
    const { app, config } = ctx;
    const state = app.hours.state();
    const week = weekTable(ctx.now(), config.zone, app.hours.week);
    const closures = app.hours.upcoming(365);
    return ctx.send('Hours', `<div class="head"><h1>Hours</h1><a class="btn" href="/" >Back</a></div>
      <section class="panel stack"><p><strong>${esc(state.text)}</strong></p>
        <p class="muted">The week below is on the public page and decides when customers are told we’re closed. To change it, edit <code>src/domain/shop.js</code>.</p>
        <table class="grid compact hours"><tbody>${week.map((r) => `<tr${r.today ? ' class="today"' : ''}><th scope="row">${esc(r.day)}</th><td>${esc(r.hours)}</td></tr>`).join('')}</tbody></table></section>
      <section class="panel stack"><h2>Closures and special hours</h2>
        <form method="post" action="/hours" class="stack">
          <div class="two hform"><label>Date<input type="date" name="date" required></label><label>What for<input name="note" maxlength="60" placeholder="Thanksgiving"></label></div>
          <div class="two hform"><label>Opens (special hours only)<input type="time" name="open"></label><label>Closes<input type="time" name="close"></label></div>
          <p class="muted">Leave the times empty to close the whole day.</p><div><button class="btn primary">Save</button></div></form>
        ${closures.length ? `<table class="grid compact"><thead><tr><th>Date</th><th>What</th><th></th></tr></thead><tbody>${closures.map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(c.note || '')} ${c.open ? `<small>${esc(c.open)} to ${esc(c.close)}</small>` : '<small>Closed</small>'}</td>
          <td><form method="post" action="/hours/remove"><input type="hidden" name="date" value="${esc(c.date)}"><button class="link">Remove</button></form></td></tr>`).join('')}</tbody></table>` : '<p class="muted">None coming up.</p>'}</section>`, { active: 'hours' });
  });
  router.post('/hours', (ctx) => {
    const r = ctx.app.hours.set(ctx.who, { date: ctx.form.get('date'), note: ctx.form.get('note') ?? '', open: ctx.form.get('open') ?? '', close: ctx.form.get('close') ?? '' });
    return ctx.redirect('/hours', r.error ? { problem: words(r) } : { done: 'Saved.' });
  });
  router.post('/hours/remove', (ctx) => {
    const r = ctx.app.hours.remove(ctx.who, ctx.form.get('date'));
    return ctx.redirect('/hours', r.error ? { problem: words(r) } : { done: 'Removed.' });
  });
}
