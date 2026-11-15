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
/** The vehicle matches; `result` is a promise, so the page doesn't wait for it. */
export const matchList = (page, { callId, result }) => page.render('match-list', { callId: String(callId), result });
/** The part finder's answers; `data` is an object, or a promise of one (the AI is still looking). */
export const answerList = (page, { callId, closed, data }) => page.render('answer-list', { callId: String(callId), closed: Boolean(closed), data: typeof data?.then === 'function' ? data.then(clean) : clean(data) });
export const stat = (page, props) => page.render('stat-card', clean(props));
export const badge = (page, variant, text, dot = false) => page.render('status-badge', { variant: clean(variant), dot }, { default: esc(text) });
export const button = (page, text, props = {}) => page.render('action-button', { type: 'submit', ...clean(props) }, { default: esc(text) });
export const alert = (page, variant, heading, text) => page.render('alert-banner', { variant: clean(variant), heading: clean(heading) }, { default: esc(text) });
export const empty = (page, heading, text = '') => page.render('empty-state', { heading: clean(heading) }, { default: esc(text) });

const STATUS_VARIANT = { open: 'neutral', working: 'success', parked: 'warning', resolved: 'primary', closed: 'outline' };

/** The badges that describe a call: its status, who has it, whether it wants help. */
export function callBadges(page, call, people) {
  const parts = [badge(page, STATUS_VARIANT[call.status] ?? 'neutral', STATUS_LABEL[call.status] ?? call.status, true)];
  if (call.source === 'portal') parts.push(badge(page, 'outline', 'Web'));
  if (call.priority === 'high') parts.push(badge(page, 'danger', 'High priority'));
  if (call.help === 'anyone') parts.push(badge(page, 'danger', 'Needs help'));
  if (call.help === 'specific') parts.push(badge(page, 'danger', `Help: ${people.name(call.help_from)}`));
  return parts.join(' ');
}

// The sidebar: [section, [[href, label, key, permission, icon], ...]]. A section with nothing the
// person may open is left out.
const NAV = [
  ['Work', [
    ['/', 'Today', 'home', null, 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
    ['/calls', 'Calls', 'calls', 'call.view', 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z'],
    ['/watch', 'Live', 'watch', 'call.watch', 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    ['/deliveries', 'Deliveries', 'deliveries', 'call.view', 'M1 6h13v10H1zM14 9h4l3 3v4h-7zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
    ['/orders', 'Orders', 'orders', 'order.view', 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8'],
  ]],
  ['Customers and parts', [
    ['/customers', 'Customers', 'customers', 'customer.view', 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0'],
    ['/scan', 'Scan', 'scan', 'customer.view', 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 12h10'],
    ['/items', 'Items', 'items', 'item.view', 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v9'],
  ]],
  ['Manage', [
    ['/reports', 'Reports', 'reports', 'report.view', 'M4 20V10M10 20V4M16 20v-8M22 20H2'],
    ['/audit', 'Activity', 'audit', 'audit.view', 'M3 12h4l3-8 4 16 3-8h4'],
    ['/outbox', 'Outbox', 'outbox', 'portal.manage', 'M3 5h18v14H3zM3 6l9 7 9-7'],
    ['/hours', 'Hours', 'hours', 'hours.manage', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2'],
    ['/staff/people', 'People', 'people', 'owner', 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 20a7 7 0 0 0-4-6'],
  ]],
];
const icon = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const sidebar = (who, active) => NAV.map(([section, links]) => {
  const shown = links.filter(([, , , permission]) => !permission || (permission === 'owner' ? who.roles.includes('owner') : can(who, permission)));
  return shown.length
    ? `<div class="side-group"><p class="side-title">${esc(section)}</p>${shown.map(([href, label, key, , d]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${icon(d)}<span>${esc(label)}</span></a>`).join('')}</div>`
    : '';
}).join('');
const initials = (who) => esc(String(who.name || who.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''));

/**
 * A whole page. `notice` is the signed one-line message from the last form (problem / done), and
 * `live` makes the page reload when a coworker changes what it shows.
 */
export function layout({ title, who, active = '', body, notice = {}, business, live = false, script = '', navHtml = null, accountHtml = null, home = '/', head = '', sub = 'Call desk', bodyClass = '' }) {
  const shell = Boolean(who) && navHtml === null && accountHtml === null;
  const toggle = '<button type="button" class="icon-btn theme-toggle" aria-label="Switch theme">🌙</button>';
  const nav = shell ? '' : (navHtml ?? '');
  const account = accountHtml ?? `<div class="account">${toggle}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0b132b">
<title>${title === business ? esc(title) : `${esc(title)} · ${esc(business)}`}</title>
<link rel="icon" href="data:,">
${head}
<link rel="stylesheet" href="/assets/zubra-ui-theme.css">
<link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/system.css">
<script src="/assets/theme.js"></script>
</head>
<body${live ? ' data-live' : ''} class="${shell ? 'app ' : ''}${esc(bodyClass)}">
${shell ? '' : '<div id="bg-layer" aria-hidden="true"></div>'}
<a class="skip" href="#main">Skip to content</a>
${shell ? `<div class="shell">
<aside class="side" id="side" aria-label="Main">
<a class="side-brand" href="${home}"><span class="mark" aria-hidden="true">${esc(business[0] ?? 'S')}</span><span>${esc(business)}<small>${esc(sub)}</small></span></a>
<form method="post" action="/calls" class="side-new"><button class="new-call" type="submit" title="New call (N)">${icon('M12 5v14M5 12h14')}New call</button></form>
<nav>${sidebar(who, active)}</nav>
<div class="side-foot"><a href="/staff/password" class="me" title="Change password"><span class="avatar" aria-hidden="true">${initials(who)}</span><span class="who"><span>${esc(who.name || who.email)}</span><small>${esc(who.roles.join(', '))}</small></span></a>
<div class="row"><form method="post" action="/staff/sign-out"><button class="link" type="submit">Sign out</button></form>${toggle}</div></div>
</aside>
<div class="scrim" data-shell-close></div>
<div class="main-col"><header class="topbar"><button type="button" class="icon-btn menu-btn" aria-controls="side" aria-expanded="false" aria-label="Menu">${icon('M4 6h16M4 12h16M4 18h16')}</button><span class="crumb">${esc(title)}</span></header>
<main id="main">` : `<header class="bar"><a class="brand" href="${home}">${esc(business)}${sub ? `<small>${esc(sub)}</small>` : ''}</a>${nav}${account}</header>
<main id="main">`}
${notice.problem ? `<p class="flash problem" role="alert">${esc(notice.problem)}</p>` : ''}${notice.done ? `<p class="flash done" role="status">${esc(notice.done)}</p>` : ''}
${body}
</main>${shell ? '</div></div>' : ''}
<div id="toasts" aria-live="polite"></div>
<span id="net-pill" role="status" hidden><span class="dot"></span>Offline. Changes save when you’re back.</span>
${shell ? '<script src="/assets/shell.js" defer></script>' : '<script src="/assets/background.js" defer></script>'}<script src="/assets/network.js" defer></script>
${who ? '<script src="/assets/shortcuts.js" defer></script><script src="/assets/nudge.js" defer></script>' : ''}<script src="/assets/print.js" defer></script>${live ? '<script src="/assets/live.js" defer></script>' : ''}${script}
</body>
</html>`;
}

/** What each error code from the application layer says, in words for the person at the counter. */
export const WORDS = {
  empty: 'Paste the list or choose a file first.',
  'too-big': 'That list is too big to import in one go. Split it into smaller files.',
  'too-many': 'That list has too many rows for one import. Split it into files of 5,000 or fewer.',
  'no-header': 'The first row needs column names. Include at least a Name column (ID and Phone too, if you have them).',
  forbidden: 'Your role can’t do that.',
  type: 'Pick what kind of part it is.',
  measure: 'A measurement doesn’t look right. Use numbers like 25, 25.4 or 1/2.',
  closed: 'That call is already finished.',
  link: 'That link isn’t working.',
  'photo-many': 'That’s the most photos a call can hold.',
  'photo-big': 'That photo is too large.',
  'photo-type': 'Only JPEG, PNG or WebP photos can be added.',
  'photo-bad': 'That photo couldn’t be read.',
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
