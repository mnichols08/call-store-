// Today (the dashboard), reports and the activity log.
import { ago, duration, esc, when } from '../html.js';
import { badge, button, callBadges, empty, stat } from '../ui.js';
import { OUTCOMES } from '../../domain/call.js';
import { STATUS_LABEL as DELIVERY_LABEL } from '../../domain/delivery.js';
import { deliverySteps } from './delivery.js';
import { can } from '../../domain/permissions.js';
import { csv, series } from '../../../vendor/kit/reports/index.js';

const DAY = 86_400_000;

export function overviewRoutes(router) {
  router.get('/', (ctx) => {
    const { page, app, who, people } = ctx;
    const n = app.calls.counts(who);
    const mine = app.calls.queue(who, { view: 'mine', limit: 8 }).calls;
    const allHelp = app.calls.queue(who, { view: 'help', limit: 20 }).calls;
    const askedOfMe = allHelp.filter((c) => c.help === 'specific' && c.help_from === who.email);
    const help = allHelp.filter((c) => !askedOfMe.includes(c)).slice(0, 8);
    const list = (calls) => `<ul class="plain">${calls.map((c) => `<li><span><a href="/calls/${c.id}">#${c.id} ${esc(c.title)}</a>${c.application ? `<small>${esc(c.application)}</small>` : ''}</span><span>${callBadges(page, c, people)}</span></li>`).join('')}</ul>`;
    const nudges = app.nudges.inbox(who).nudges;
    const nudgePanel = nudges.length ? `<section class="panel asked" aria-label="Nudges"><h2>${nudges.length === 1 ? 'A coworker nudged you' : 'Coworkers nudged you'}</h2><ul class="plain">${nudges.map((n) => `<li><span><strong>${esc(people.name(n.from_email))}</strong> ${esc(n.message || (n.call_id ? 'wants you to look at this call.' : 'wants a word.'))}${n.call_id ? ` <a href="/calls/${n.call_id}">Call #${n.call_id}</a>` : ''}<small>${esc(ago(n.created_at, ctx.now()))}</small></span>
      <form method="post" action="/nudges/${n.id}/dismiss">${button(page, 'Got it', { variant: 'outline', size: 'sm' })}</form></li>`).join('')}</ul></section>` : '';
    // For managers and owners: what is waiting longest, and what each person has open.
    let waiting = '';
    let team = '';
    if (can(who, 'report.view')) {
      const open = app.calls.queue(who, { view: 'active', limit: 200 }).calls;
      const unassigned = open.filter((c) => !c.assignee).slice(0, 6);
      waiting = `<section class="panel"><h2>Waiting for someone</h2>${unassigned.length
        ? `<ul class="plain">${unassigned.map((c) => `<li><span><a href="/calls/${c.id}">#${c.id} ${esc(c.title)}</a><small>${esc(c.application || '')}</small></span><span class="wait${ctx.now() - c.created_at > (ctx.config.pickupTargetMinutes ?? 5) * 60_000 ? ' late' : ''}">${esc(ago(c.created_at, ctx.now()))}</span></li>`).join('')}</ul>`
        : '<p class="muted">Every open call has someone on it.</p>'}</section>`;
      const by = new Map();
      for (const c of open) if (c.assignee) by.set(c.assignee, (by.get(c.assignee) ?? 0) + 1);
      team = `<section class="panel"><h2>Who has what</h2>${by.size
        ? `<ul class="plain">${[...by].sort((a, b) => b[1] - a[1]).map(([email, n]) => `<li><span>${esc(people.name(email))}</span><span><strong>${n}</strong> open</span></li>`).join('')}</ul>`
        : '<p class="muted">Nobody has a call right now.</p>'}</section>`;
    }
    const day = new Intl.DateTimeFormat('en-US', { timeZone: ctx.config.zone, weekday: 'long', month: 'long', day: 'numeric' }).format(ctx.now());
    // What still has to get to a customer. It stays here until someone marks it delivered.
    const going = app.delivery.list(who).active ?? [];
    const deliveries = going.length ? `<section class="panel"><h2>To deliver <a class="muted" href="/deliveries">See all</a></h2><ul class="plain">${going.slice(0, 8).map((d) => `<li><span><a href="/calls/${d.call_id}">#${d.call_id} ${esc(d.customer_name || d.caller_name || 'Cash customer')}</a><small>${esc(DELIVERY_LABEL[d.status])} · ${esc(d.address || d.customer_address || 'Usual address')}${d.town ? `, ${esc(d.town)}` : ''}</small></span><span class="row steps">${deliverySteps(d.call_id, d, 'list')}</span></li>`).join('')}</ul></section>` : '';
    return ctx.send('Today', `
<div class="head"><div><h1>Today</h1><p class="muted">${esc(day)}</p></div></div>
${nudgePanel}
<section class="panel" id="push-panel" hidden><h2>Notifications on this device</h2><p class="muted" id="push-state">Get a nudge even when this tab is closed.</p><button type="button" id="push-toggle" class="btn">Turn on</button></section>
${askedOfMe.length ? `<section class="panel asked" aria-label="Asked of you"><h2>${askedOfMe.length === 1 ? 'A coworker is asking you for help' : 'Coworkers are asking you for help'}</h2>${list(askedOfMe)}</section>` : ''}
<div class="stats">
${stat(page, { label: 'Open calls', value: String(n.active) })}${stat(page, { label: 'Nobody has yet', value: String(n.unassigned) })}
${stat(page, { label: 'Mine', value: String(n.mine) })}${stat(page, { label: 'Asking for help', value: String(n.help) })}${stat(page, { label: 'Parked', value: String(n.parked) })}</div>
<div class="workspace"><div class="main-col">${deliveries}${waiting}<section class="panel"><h2>Asking for help</h2>${help.length ? list(help) : '<p class="muted">Nobody needs a hand right now.</p>'}</section></div>
<aside class="side-col">${team}<section class="panel"><h2>Yours</h2>${mine.length ? list(mine) : '<p class="muted">You haven’t taken a call yet. <a href="/calls?view=unassigned">See what’s waiting</a>.</p>'}</section></aside></div>`, { active: 'home', live: true });
  });

  router.get('/reports', (ctx) => {
    if (!can(ctx.who, 'report.view')) return ctx.forbidden();
    const { page, app, config } = ctx;
    const range = rangeOf(ctx, config);
    const rows = days(app, ctx.who, range, config);
    const outcomes = tally(app, ctx.who, range);
    const max = Math.max(1, ...rows.map((r) => r.count));
    const t = app.stats.timing(ctx.who, range, { targetMs: (config.pickupTargetMinutes ?? 5) * 60_000 });
    const pct = t.withinTarget == null ? '—' : `${Math.round(t.withinTarget * 100)}%`;
    const timing = `<h2 class="section">How fast</h2>
<div class="stats">
${stat(page, { label: 'Median wait to pick up', value: duration(t.waitMedian) })}${stat(page, { label: '90% picked up within', value: duration(t.waitP90) })}
${stat(page, { label: `Picked up in ${config.pickupTargetMinutes ?? 5} min`, value: pct })}${stat(page, { label: 'Median time to finish', value: duration(t.handleMedian) })}
${stat(page, { label: 'Longest waiting now', value: t.longestWaitingNow ? duration(t.longestWaitingNow.ms) : 'None' })}</div>
${t.people.length ? `<section class="panel"><h2>By person</h2><table class="grid compact"><thead><tr><th>Who</th><th>Finished</th><th>Median time to finish</th></tr></thead><tbody>${t.people.map((p) => `<tr><td>${esc(ctx.people.name(p.email))}</td><td>${p.finished}</td><td>${duration(p.handleMedian)}</td></tr>`).join('')}</tbody></table></section>` : ''}
${t.neverPickedUp ? `<p class="panel muted">${t.neverPickedUp} call${t.neverPickedUp === 1 ? ' was' : 's were'} never picked up by anyone in this range.</p>` : ''}`;
    const u = app.parts.usage(ctx.who);
    const partsUse = u.ok ? `<h2 class="section">Part finder</h2>
<div class="stats">${stat(page, { label: 'Lookups answered from saved answers (30 days)', value: u.searches.n ? `${Math.round((u.searches.memory / u.searches.n) * 100)}%` : '—' })}${stat(page, { label: 'AI lookups today', value: `${u.day.calls} of ${u.limits.daily}` })}
${stat(page, { label: 'Answers the shop has confirmed', value: String(u.answers.confirmed) })}${stat(page, { label: 'Answers staff taught it', value: String(u.answers.taught) })}</div>
<p class="muted">${u.enabled ? `AI lookups use ${esc(u.model)}. This month: ${u.month.calls} lookups, ${u.month.searches} web searches, ${u.month.input + u.month.output} tokens, ${u.month.failed} failed.` : 'AI lookups are off (no key set). Only saved answers are shown.'}</p>` : '';
    return ctx.send('Reports', `
<div class="head"><h1>Reports</h1><div class="row"><button type="button" class="btn" data-print>Print</button><a class="btn" href="/reports.csv?days=${range.days}">Calls per day (CSV)</a><a class="btn" href="/reports/timing.csv?days=${range.days}">Timing (CSV)</a></div></div>
<div id="reports" data-config="${esc(JSON.stringify(reportData(ctx, range)))}">
<nav class="tabs" aria-label="Range">${[7, 14, 30, 90].map((d) => `<a href="/reports?days=${d}"${d === range.days ? ' aria-current="true"' : ''}>Last ${d} days</a>`).join('')}</nav>
<div class="workspace"><div class="main-col"><section class="panel"><h2>Calls taken per day</h2>
${rows.length ? `<ol class="bars" aria-label="Calls per day">${rows.map((r) => `<li><span class="day">${esc(r.start.slice(5))}</span><span class="bar" style="--w:${Math.round((r.count / max) * 100)}%"></span><span class="n">${r.count}</span></li>`).join('')}</ol>` : empty(page, 'No calls in this range')}</section></div>
<aside class="side-col"><section class="panel"><h2>What came of them</h2>${outcomes.length ? `<ul class="plain">${outcomes.map(([label, count]) => `<li><span>${esc(label)}</span><span>${count}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing finished in this range.</p>'}</section></aside></div>
${timing}
</div>
<link rel="stylesheet" href="/assets/islands/reports.css">
${partsUse}
<script src="/assets/islands/reports.js" type="module"></script>`, { active: 'reports' });
  });

  // The same numbers as JSON, for the page's range switcher.
  router.get('/reports.json', (ctx) => {
    if (!can(ctx.who, 'report.view')) return ctx.json({ error: 'forbidden' }, 403);
    return ctx.json({ ok: true, ...reportData(ctx, rangeOf(ctx, ctx.config)) });
  });

  router.get('/reports.csv', (ctx) => {
    if (!can(ctx.who, 'report.view')) return ctx.forbidden();
    const range = rangeOf(ctx, ctx.config);
    const rows = days(ctx.app, ctx.who, range, ctx.config);
    ctx.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="calls-per-day.csv"' });
    ctx.res.end(csv(rows, [{ key: 'start', label: 'Day' }, { key: 'count', label: 'Calls' }]));
  });

  router.get('/reports/timing.csv', (ctx) => {
    if (!can(ctx.who, 'report.view')) return ctx.forbidden();
    const range = rangeOf(ctx, ctx.config);
    const t = ctx.app.stats.timing(ctx.who, range);
    const iso = (ms) => (ms == null ? '' : new Date(ms).toISOString());
    const seconds = (ms) => (ms == null ? '' : Math.round(ms / 1000));
    const rows = t.calls.map((c) => ({ call: c.id, started: iso(c.created_at), picked_up: iso(c.picked_up_at), finished: iso(c.closed_at), wait_seconds: seconds(c.wait_ms), handle_seconds: seconds(c.handle_ms), outcome: OUTCOMES[c.outcome] ?? '', taken_by: c.assignee ?? c.picked_up_by ?? '' }));
    ctx.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="call-timing.csv"' });
    ctx.res.end(csv(rows, [{ key: 'call', label: 'Call' }, { key: 'started', label: 'Started' }, { key: 'picked_up', label: 'Picked up' }, { key: 'finished', label: 'Finished' }, { key: 'wait_seconds', label: 'Wait (s)' }, { key: 'handle_seconds', label: 'Handled (s)' }, { key: 'outcome', label: 'Outcome' }, { key: 'taken_by', label: 'Taken by' }]));
  });

  router.get('/audit', (ctx) => {
    if (!can(ctx.who, 'audit.view')) return ctx.forbidden();
    const { page, app, people, config } = ctx;
    const events = app.audit.recent(200);
    return ctx.send('Activity', `<div class="head"><h1>Activity</h1></div>
${events.length ? `<table class="grid compact"><thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th></tr></thead><tbody>${events.map((e) => `<tr><td class="muted">${esc(when(e.at, config.zone))}</td><td>${esc(people.name(e.actor))}</td><td><span title="${esc(e.action)}">${badge(page, 'outline', actionWords(e.action))}</span></td><td>${subjectLink(e.subject)}</td></tr>`).join('')}</tbody></table>` : empty(page, 'Nothing has happened yet')}`, { active: 'audit' });
  });
}

const ACTION_WORDS = { 'call.created': 'Call started', 'call.claimed': 'Call taken', 'call.outcome': 'Call finished', 'delivery.ready': 'Delivery ready', 'delivery.out': 'Out for delivery', 'delivery.delivered': 'Delivered', 'call.help-requested': 'Asked for help', 'call.link-made': 'Link made', 'portal.request': 'Portal request', 'portal.joined': 'Joined the portal', 'portal.invited': 'Portal invite', 'portal.badge-scanned': 'Badge scanned', 'delivery.set': 'Delivery set', 'hours.set': 'Hours changed', 'orders.saved': 'Orders saved', 'orders.read': 'Orders read', 'item.created': 'Item added', 'customer.imported': 'Customers imported' };
const actionWords = (a) => ACTION_WORDS[a] ?? a.replace(/[.\-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function subjectLink(subject) {
  const [kind, id] = subject.split(':');
  const href = { call: 'calls', customer: 'customers', item: 'items' }[kind];
  return href && /^\d+$/.test(id ?? '') ? `<a href="/${href}/${id}">${esc(kind)} #${esc(id)}</a>` : esc(subject);
}

/** Everything the reports page draws for a range, and the same-length range just before it for comparison. */
function reportData(ctx, range) {
  const { app, who, config, people } = ctx;
  const target = (config.pickupTargetMinutes ?? 5) * 60_000;
  const one = (r) => {
    const t = app.stats.timing(who, r, { targetMs: target });
    return {
      rows: days(app, who, r, config).map((d) => ({ day: d.start, count: d.count })),
      outcomes: tally(app, who, r),
      timing: { waitMedian: t.waitMedian, waitP90: t.waitP90, withinTarget: t.withinTarget, handleMedian: t.handleMedian, longestWaiting: t.longestWaitingNow?.ms ?? null, neverPickedUp: t.neverPickedUp },
      people: t.people.map((p) => ({ name: people.name(p.email), finished: p.finished, handleMedian: p.handleMedian })),
    };
  };
  return { days: range.days, targetMinutes: config.pickupTargetMinutes ?? 5, now: one(range), before: one({ days: range.days, from: range.from - range.days * DAY, to: range.from - 1 }) };
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
