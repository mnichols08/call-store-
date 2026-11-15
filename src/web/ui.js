// The look of every page: the layout around a body, and small wrappers over the Zubra UI
// components (text-field, select-field, status-badge, action-button, alert-banner, stat-card,
// empty-state) so a page says what it shows and not how.
import { esc } from './html.js';
import { STATUS_LABEL } from '../domain/call.js';
import { can } from '../domain/permissions.js';

/**
 * Every string that reaches a component is made well-formed first: half a surrogate pair (an emoji
 * cut in two, or sent by hand) makes Zubra's renderer throw, and one stored value would then break
 * every page that shows it. Options (select) are cleaned the same way.
 */
const clean = (value) => (typeof value === 'string' ? value.toWellFormed() : Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) : value);

export const field = (page, props) => page.render('text-field', clean(props));
export const select = (page, props) => page.render('select-field', clean(props));
export const stat = (page, props) => page.render('stat-card', clean(props));
export const badge = (page, variant, text, dot = false) => page.render('status-badge', { variant: clean(variant), dot }, { default: esc(text) });
export const button = (page, text, props = {}) => page.render('action-button', { type: 'submit', ...clean(props) }, { default: esc(text) });
export const alert = (page, variant, heading, text) => page.render('alert-banner', { variant: clean(variant), heading: clean(heading) }, { default: esc(text) });
export const empty = (page, heading, text = '') => page.render('empty-state', { heading: clean(heading) }, { default: esc(text) });

const STATUS_VARIANT = { open: 'neutral', working: 'success', parked: 'warning', resolved: 'primary', closed: 'outline' };

/** The badges that describe a call: its status, who has it, whether it wants help. */
export function callBadges(page, call, people) {
  const parts = [badge(page, STATUS_VARIANT[call.status] ?? 'neutral', STATUS_LABEL[call.status] ?? call.status, true)];
  if (call.priority === 'high') parts.push(badge(page, 'danger', 'High priority'));
  if (call.help === 'anyone') parts.push(badge(page, 'danger', 'Needs help'));
  if (call.help === 'specific') parts.push(badge(page, 'danger', `Help: ${people.name(call.help_from)}`));
  return parts.join(' ');
}

const NAV = [
  ['/', 'Today', 'home', null],
  ['/calls', 'Calls', 'calls', 'call.view'],
  ['/watch', 'Live', 'watch', 'call.watch'],
  ['/customers', 'Customers', 'customers', 'customer.view'],
  ['/items', 'Items', 'items', 'item.view'],
  ['/reports', 'Reports', 'reports', 'report.view'],
  ['/audit', 'Activity', 'audit', 'audit.view'],
];

/**
 * A whole page. `notice` is the signed one-line message from the last form (problem / done), and
 * `live` makes the page reload when a coworker changes what it shows.
 */
export function layout({ title, who, active = '', body, notice = {}, business, live = false, script = '' }) {
  const nav = who
    ? `<nav aria-label="Main">${NAV.filter(([, , , permission]) => !permission || can(who, permission))
        .map(([href, label, key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}
        ${who.roles.includes('owner') ? `<a href="/staff/people"${active === 'people' ? ' aria-current="page"' : ''}>People</a>` : ''}</nav>`
    : '';
  const toggle = '<button type="button" class="icon-btn theme-toggle" aria-label="Switch theme">🌙</button>';
  const account = who
    ? `<div class="account"><form method="post" action="/calls"><button class="new-call" type="submit" title="New call (N)">New call</button></form>
        <a href="/staff/password" class="who" title="Change password"><span>${esc(who.name || who.email)}</span><small>${esc(who.roles.join(', '))}</small></a>
        <form method="post" action="/staff/sign-out"><button class="link" type="submit">Sign out</button></form>${toggle}</div>`
    : `<div class="account">${toggle}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0b132b">
<title>${esc(title)} · ${esc(business)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/assets/zubra-ui-theme.css">
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/theme.js"></script>
</head>
<body${live ? ' data-live' : ''}>
<div id="bg-layer" aria-hidden="true"></div>
<a class="skip" href="#main">Skip to content</a>
<header class="bar"><a class="brand" href="/">${esc(business)}<small>Call desk</small></a>${nav}${account}</header>
<main id="main">
${notice.problem ? `<p class="flash problem" role="alert">${esc(notice.problem)}</p>` : ''}${notice.done ? `<p class="flash done" role="status">${esc(notice.done)}</p>` : ''}
${body}
</main>
<div id="toasts" aria-live="polite"></div>
<span id="net-pill" role="status" hidden><span class="dot"></span>Offline. Changes save when you’re back.</span>
<script src="/assets/background.js" defer></script><script src="/assets/network.js" defer></script>
${who ? '<script src="/assets/shortcuts.js" defer></script><script src="/assets/nudge.js" defer></script>' : ''}<script src="/assets/print.js" defer></script>${live ? '<script src="/assets/live.js" defer></script>' : ''}${script}
</body>
</html>`;
}

/** What each error code from the application layer says, in words for the person at the counter. */
export const WORDS = {
  forbidden: 'Your role can’t do that.',
  'watch-off': 'Watching is switched off in this shop.',
  'watch-self': 'That’s your own call.',
  decided: 'That suggestion was already answered.',
  'vin-length': 'A VIN is 17 characters. Check what was typed.',
  'vin-characters': 'A VIN uses only letters and numbers, never I, O or Q.',
  'vin-unknown': 'NHTSA couldn’t read that VIN.',
  source: 'The vehicle database (NHTSA) isn’t answering right now. Pick the vehicle by hand instead.',
  vehicle: 'Add the vehicle’s year, make and model first (or a part number to cross-reference).',
  empty: 'Type what you need, or a part number.',
  number: 'Add a brand and a part number.',
  result: 'That isn’t a choice.',
  off: 'The AI lookup isn’t switched on here. Only saved answers are shown.',
  'limit-hour': 'The AI lookup has reached its hourly limit. Saved answers are shown.',
  'limit-day': 'The AI lookup has reached today’s limit. Saved answers are shown.',
  auth: 'The AI lookup isn’t set up correctly. Tell whoever runs the system.',
  rate: 'The AI service is busy. Try again in a minute.',
  timeout: 'The AI lookup took too long.',
  'bad-answer': 'The AI gave an answer that couldn’t be used.',
  missing: 'That doesn’t exist any more.',
  closed: 'That call is closed. Reopen it to change it.',
  quantity: 'Quantity should be a whole number.',
  priority: 'Pick a priority from the list.',
  outcome: 'Pick what came of the call.',
  price: 'Price should look like 12.50.',
  final_quantity: 'Quantity should be a whole number.',
  claimed: 'Someone already has that call.',
  'wrong-status': 'The call isn’t in a state where that can happen.',
  'needs-outcome': 'Finish a call by recording what came of it.',
  stale: 'A coworker changed this call while you were editing.',
  name: 'A name is needed.',
  phone: 'Phone numbers need at least seven digits.',
  'account-taken': 'Another customer already has that account number.',
  sku: 'An item number (SKU) is needed.',
  'sku-taken': 'Another item already has that number.',
  customer: 'That customer couldn’t be found.',
  item: 'That item couldn’t be found.',
  unassigned: 'Nobody has that call.',
  'nudge-who': 'Pick a coworker to nudge.',
  'slow-down': 'That’s a lot of nudges in a minute. Give it a moment.',
  subscription: 'That browser can’t be set up for notifications.',
  status: 'Pick active or inactive.',
};
export const say = (code) => WORDS[code] ?? 'That didn’t work.';

/**
 * A sheet for the printer: plain, white, no navigation. The toolbar above it (Back, Print) doesn't
 * print. `print.js` wires the Print button, and prints at once when the address has ?auto.
 */
export function printLayout({ title, body, business, back }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(business)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/assets/print.css">
</head>
<body>
<div class="toolbar noprint"><a href="${esc(back)}">Back</a><button type="button" data-print>Print</button></div>
<main class="sheet">
<header class="sheet-head"><strong>${esc(business)}</strong><span>${esc(title)}</span></header>
${body}
</main>
<script src="/assets/print.js" defer></script>
</body>
</html>`;
}
