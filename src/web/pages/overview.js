// Today (the dashboard), reports and the activity log.
import { esc, when } from '../html.js';
import { badge, callBadges, empty, stat } from '../ui.js';
import { OUTCOMES } from '../../domain/call.js';
import { can } from '../../domain/permissions.js';
import { csv, series } from '../../../vendor/kit/reports/index.js';

const DAY = 86_400_000;

export function overviewRoutes(router) {
  router.get('/', (ctx) => {
    const { page, app, who, people } = ctx;
    const n = app.calls.counts(who);
    const mine = app.calls.queue(who, { view: 'mine', limit: 8 }).calls;
    const help = app.calls.queue(who, { view: 'help', limit: 8 }).calls;
    const list = (calls) => `<ul class="plain">${calls.map((c) => `<li><span><a href="/calls/${c.id}">#${c.id} ${esc(c.title)}</a>${c.application ? `<small>${esc(c.application)}</small>` : ''}</span><span>${callBadges(page, c, people)}</span></li>`).join('')}</ul>`;
    return ctx.send('Today', `
<div class="head"><h1>Today</h1></div>
<div class="stats">
${stat(page, { label: 'Open calls', value: String(n.active) })}${stat(page, { label: 'Nobody has yet', value: String(n.unassigned) })}
${stat(page, { label: 'Mine', value: String(n.mine) })}${stat(page, { label: 'Asking for help', value: String(n.help) })}${stat(page, { label: 'Parked', value: String(n.parked) })}</div>
<div class="workspace"><div class="main-col"><section class="panel"><h2>Asking for help</h2>${help.length ? list(help) : '<p class="muted">Nobody needs a hand right now.</p>'}</section></div>
<aside class="side-col"><section class="panel"><h2>Yours</h2>${mine.length ? list(mine) : '<p class="muted">You haven’t taken a call yet. <a href="/calls?view=unassigned">See what’s waiting</a>.</p>'}</section></aside></div>`, { active: 'home', live: true });
  });

  router.get('/reports', (ctx) => {
    if (!can(ctx.who, 'report.view')) return ctx.forbidden();
    const { page, app, config } = ctx;
    const range = rangeOf(ctx, config);
    const rows = days(app, ctx.who, range, config);
    const outcomes = tally(app, ctx.who, range);
    const max = Math.max(1, ...rows.map((r) => r.count));
    return ctx.send('Reports', `
<div class="head"><h1>Reports</h1><a class="btn" href="/reports.csv?days=${range.days}">Download CSV</a></div>
<nav class="tabs" aria-label="Range">${[7, 14, 30, 90].map((d) => `<a href="/reports?days=${d}"${d === range.days ? ' aria-current="true"' : ''}>Last ${d} days</a>`).join('')}</nav>
<div class="workspace"><div class="main-col"><section class="panel"><h2>Calls taken per day</h2>
${rows.length ? `<ol class="bars" aria-label="Calls per day">${rows.map((r) => `<li><span class="day">${esc(r.start.slice(5))}</span><span class="bar" style="--w:${Math.round((r.count / max) * 100)}%"></span><span class="n">${r.count}</span></li>`).join('')}</ol>` : empty(page, 'No calls in this range')}</section></div>
<aside class="side-col"><section class="panel"><h2>What came of them</h2>${outcomes.length ? `<ul class="plain">${outcomes.map(([label, count]) => `<li><span>${esc(label)}</span><span>${count}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing finished in this range.</p>'}</section></aside></div>`, { active: 'reports' });
  });

  router.get('/reports.csv', (ctx) => {
    if (!can(ctx.who, 'report.view')) return ctx.forbidden();
    const range = rangeOf(ctx, ctx.config);
    const rows = days(ctx.app, ctx.who, range, ctx.config);
    ctx.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="calls-per-day.csv"' });
    ctx.res.end(csv(rows, [{ key: 'start', label: 'Day' }, { key: 'count', label: 'Calls' }]));
  });

  router.get('/audit', (ctx) => {
    if (!can(ctx.who, 'audit.view')) return ctx.forbidden();
    const { page, app, people, config } = ctx;
    const events = app.audit.recent(200);
    return ctx.send('Activity', `<div class="head"><h1>Activity</h1></div>
${events.length ? `<table class="grid compact"><thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th></tr></thead><tbody>${events.map((e) => `<tr><td class="muted">${esc(when(e.at, config.zone))}</td><td>${esc(people.name(e.actor))}</td><td>${badge(page, 'outline', e.action)}</td><td>${subjectLink(e.subject)}</td></tr>`).join('')}</tbody></table>` : empty(page, 'Nothing has happened yet')}`, { active: 'audit' });
  });
}

function subjectLink(subject) {
  const [kind, id] = subject.split(':');
  const href = { call: 'calls', customer: 'customers', item: 'items' }[kind];
  return href && /^\d+$/.test(id ?? '') ? `<a href="/${href}/${id}">${esc(kind)} #${esc(id)}</a>` : esc(subject);
}

function rangeOf(ctx, config) {
  const requested = Number(ctx.url.searchParams.get('days'));
  const count = [7, 14, 30, 90].includes(requested) ? requested : 14;
  const to = ctx.now();
  return { days: count, from: to - count * DAY, to };
}

function days(app, who, range, config) {
  const { calls } = app.calls.finished(who, range);
  return series(calls, { at: (c) => c.created_at, by: 'day', zone: config.zone, from: range.from, to: range.to });
}

function tally(app, who, range) {
  const { calls } = app.calls.finished(who, range);
  const counts = new Map();
  for (const c of calls) if (c.outcome) counts.set(OUTCOMES[c.outcome], (counts.get(OUTCOMES[c.outcome]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
