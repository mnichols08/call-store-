// The call pages: the shared queue and the workspace where a call is taken and worked.
import { esc, ago, when, money } from '../html.js';
import { badge, button, callBadges, empty, field, say, select } from '../ui.js';
import { OUTCOMES, PRIORITIES, STATUS_LABEL, canMove } from '../../domain/call.js';
import { can } from '../../domain/permissions.js';
import { formatPhone } from '../../domain/phone.js';
import { matchList, partsPanel, vehiclePanels } from './vehicles.js';

const VIEWS = [
  ['active', 'All open'],
  ['mine', 'Mine'],
  ['unassigned', 'Unassigned'],
  ['help', 'Needs help'],
  ['parked', 'Parked'],
  ['done', 'Finished'],
];

const EVENT_WORDS = {
  created: () => 'Call started',
  application: () => 'Application changed',
  'customer-attached': (d) => `Customer attached${d.name ? `: ${d.name}` : ''}`,
  'customer-detached': () => 'Customer removed',
  claimed: () => 'Claimed',
  released: () => 'Handed back to the queue',
  assigned: (d, p) => (d.to ? `Assigned to ${p.name(d.to)}` : 'Unassigned'),
  parked: () => 'Parked',
  resumed: () => 'Resumed',
  status: (d) => `Moved to ${STATUS_LABEL[d.to] ?? d.to}`,
  'help-requested': (d, p) => (d.from ? `Asked ${p.name(d.from)} for help` : 'Asked for help'),
  'help-cleared': () => 'Help no longer needed',
  outcome: (d) => `${STATUS_LABEL[d.to] ?? 'Finished'}: ${OUTCOMES[d.outcome] ?? d.outcome}${d.resolution ? ` — ${d.resolution}` : ''}`,
  reopened: () => 'Reopened',
  'item-added': (d) => `Item ${d.sku} × ${d.quantity}`,
  'item-removed': () => 'Item removed',
};

export function callRoutes(router) {
  // ---------------------------------------------------------------- the queue
  router.get('/calls', (ctx) => {
    const { page, app, url, people, config } = ctx;
    const view = VIEWS.some(([key]) => key === url.searchParams.get('view')) ? url.searchParams.get('view') : 'active';
    const q = url.searchParams.get('q') ?? '';
    const result = app.calls.queue(ctx.who, { view, q });
    const counts = app.calls.counts(ctx.who);
    const tabs = VIEWS.map(([key, label]) => {
      const n = key === 'active' ? counts.active : key === 'mine' ? counts.mine : key === 'unassigned' ? counts.unassigned : key === 'help' ? counts.help : key === 'parked' ? counts.parked : null;
      return `<a href="/calls?view=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}"${key === view ? ' aria-current="true"' : ''}>${label}${n ? ` <span class="count">${n}</span>` : ''}</a>`;
    }).join('');
    const rows = result.calls.map((c) => `<tr>
      <td class="num"><a href="/calls/${c.id}">#${c.id}</a></td>
      <td><a class="title" href="/calls/${c.id}">${esc(c.title)}</a>${c.application && c.application !== c.title ? `<small>${esc(c.application)}</small>` : ''}</td>
      <td>${esc(c.customer_name ?? (c.caller_name || 'Walk-in / unknown'))}${c.caller_phone ? `<small>${esc(formatPhone(c.caller_phone))}</small>` : ''}</td>
      <td>${c.assignee ? esc(people.name(c.assignee)) : '<span class="muted">Unassigned</span>'}</td>
      <td>${callBadges(page, c, people)}</td>
      <td class="muted" title="${esc(when(c.created_at, config.zone))}">${ago(c.created_at, ctx.now())}</td></tr>`).join('');
    return ctx.send('Calls', `
<div class="head"><h1>Calls</h1>
<div class="row"><button type="button" class="btn" data-print>Print list</button>
<form method="get" action="/calls" class="search" role="search"><input type="hidden" name="view" value="${esc(view)}">
<input type="search" name="q" value="${esc(q)}" placeholder="Search requests, part numbers, callers" aria-label="Search calls"><button type="submit">Search</button></form></div></div>
<nav class="tabs" aria-label="Queue views">${tabs}</nav>
${result.calls.length
      ? `<table class="grid" data-queue><thead><tr><th>#</th><th>Request</th><th>Caller</th><th>Owner</th><th>State</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table>`
      : empty(page, view === 'done' ? 'Nothing finished yet' : 'The queue is clear', q ? 'Nothing matches that search.' : 'New calls show up here as they come in.')}`, { active: 'calls', live: true });
  });

  // ---------------------------------------------------------------- start a call
  router.post('/calls', (ctx) => {
    const customerId = Number(ctx.form?.get('customer')) || null;
    const made = ctx.app.calls.create(ctx.who, {}, { customerId });
    if (made.error) return ctx.redirect('/calls', { problem: say(made.error) });
    return ctx.redirect(`/calls/${made.id}`);
  });

  // ---------------------------------------------------------------- the workspace
  router.get('/calls/:id', async (ctx) => {
    const got = ctx.app.calls.get(ctx.who, Number(ctx.params.id));
    if (got.error) return ctx.notFound();
    return ctx.send(`Call #${got.call.id}`, await workspace(ctx, got), { active: 'calls', live: true, script: '<script src="/assets/call.js" defer></script><script src="/assets/vehicle.js" defer></script>' });
  });

  // The ticket on paper: everything about the call on one sheet.
  router.get('/calls/:id/print', (ctx) => {
    const got = ctx.app.calls.get(ctx.who, Number(ctx.params.id));
    if (got.error) return ctx.notFound();
    return ctx.print(`Call #${got.call.id}`, ticket(ctx, got), `/calls/${got.call.id}`);
  });

  router.post('/calls/:id/save', (ctx) => {
    const id = Number(ctx.params.id);
    const f = ctx.form;
    const input = {};
    for (const key of ['caller_name', 'caller_phone', 'request', 'quantity', 'part_numbers', 'notes', 'priority']) if (f.has(key)) input[key] = f.get(key);
    if (['year', 'make', 'model', 'engine', 'drivetrain', 'vin', 'unit', 'freeform'].some((k) => f.has(`app_${k}`))) {
      input.application = Object.fromEntries(['year', 'make', 'model', 'engine', 'drivetrain', 'vin', 'unit', 'freeform'].map((k) => [k, f.get(`app_${k}`)]));
    }
    const result = ctx.app.calls.update(ctx.who, id, input, { revision: f.get('revision') ?? undefined });
    if (ctx.wantsJson) return ctx.json(result, result.error === 'forbidden' ? 403 : result.error ? 409 : 200);
    return ctx.redirect(`/calls/${id}`, result.error ? { problem: say(result.error) } : { done: 'Saved.' });
  });

  // One endpoint for the buttons: each is a form with an `action` value.
  router.post('/calls/:id/action', (ctx) => {
    const id = Number(ctx.params.id);
    const f = ctx.form;
    const action = f.get('action');
    const who = ctx.who;
    const calls = ctx.app.calls;
    let result;
    let done = 'Done.';
    switch (action) {
      case 'claim': result = calls.claim(who, id); done = 'It’s yours.'; break;
      case 'release': result = calls.release(who, id); done = 'Back in the queue.'; break;
      case 'assign': result = calls.assign(who, id, f.get('to')); done = 'Assigned.'; if (!result.error && f.get('to') && f.get('to') !== who.email) ctx.app.nudges.send(who, { to: f.get('to'), callId: id, message: 'Assigned this call to you.' }); break;
      case 'park': result = calls.move(who, id, 'parked'); done = 'Parked. Pick it up from the queue any time.'; break;
      case 'resume': result = calls.move(who, id, 'working'); done = 'Back to work.'; break;
      case 'help': result = calls.requestHelp(who, id, f.get('from') || ''); done = 'Help requested.'; if (!result.error && f.get('from') && f.get('from') !== who.email) ctx.app.nudges.send(who, { to: f.get('from'), callId: id, message: 'Asked for your help on this call.' }); break;
      case 'help-cleared': result = calls.clearHelp(who, id); break;
      case 'resolve': result = calls.finish(who, id, Object.fromEntries(f), 'resolved'); done = 'Resolved.'; break;
      case 'close': result = calls.finish(who, id, Object.fromEntries(f), 'closed'); done = 'Closed.'; break;
      case 'reopen': result = calls.reopen(who, id); done = 'Reopened.'; break;
      case 'customer': result = calls.attachCustomer(who, id, f.get('customer') ? Number(f.get('customer')) : null); done = f.get('customer') ? 'Customer attached.' : 'Customer removed.'; break;
      case 'add-item': result = calls.addItem(who, id, Number(f.get('item')), f.get('quantity') || 1); done = 'Item added.'; break;
      case 'remove-item': result = calls.removeItem(who, id, Number(f.get('item'))); done = 'Item removed.'; break;
      default: return ctx.redirect(`/calls/${id}`, { problem: 'That button isn’t recognised.' });
    }
    if (result.error === 'claimed') return ctx.redirect(`/calls/${id}`, { problem: `${ctx.people.name(result.by)} already has this one.` });
    return ctx.redirect(`/calls/${id}`, result.error ? { problem: say(result.error) } : { done });
  });
}

async function workspace(ctx, got) {
  const { page, who, people, config, url, app } = ctx;
  const { call, customer, items, events, earlier } = got;
  const closed = call.status === 'closed';
  const finished = ['resolved', 'closed'].includes(call.status);
  const mine = call.assignee === who.email;
  const a = call.application;
  const lock = closed ? { disabled: true } : {};
  const frm = (action, label, extra = '', variant = 'outline') =>
    `<form method="post" action="/calls/${call.id}/action"><input type="hidden" name="action" value="${action}">${extra}${button(page, label, { variant, size: 'sm' })}</form>`;

  // Customer lookup results, for when JavaScript hasn't done it already.
  const find = url.searchParams.get('find') ?? '';
  const found = find ? app.customers.search(who, find).customers ?? [] : [];
  const lookup = customer
    ? `<div class="customer-card"><div><strong><a href="/customers/${customer.id}">${esc(customer.name)}</a></strong>
        ${customer.kind === 'organization' ? badge(page, 'outline', 'Business') : ''}${customer.status === 'inactive' ? badge(page, 'warning', 'Inactive') : ''}
        <small>${customer.account_no ? `Account ${esc(customer.account_no)} · ` : ''}${customer.phones.map((p) => esc(p.phone)).join(' · ')}</small></div>
        ${closed ? '' : frm('customer', 'Not them', '<input type="hidden" name="customer" value="">', 'ghost')}</div>
        ${earlier.length ? `<details><summary>${earlier.length} earlier call${earlier.length > 1 ? 's' : ''}</summary><ul class="plain">${earlier.map((e) => `<li><a href="/calls/${e.id}">#${e.id}</a> ${esc(e.request || e.part_numbers || 'No request noted')} ${badge(page, 'outline', OUTCOMES[e.outcome] ?? STATUS_LABEL[e.status])}</li>`).join('')}</ul></details>` : ''}`
    : `<p class="muted anon">No customer attached. That’s fine; carry on, and attach one whenever you know who it is.</p>
        ${closed ? '' : `<form method="get" action="/calls/${call.id}" class="lookup" role="search"><label for="find">Find the caller <span class="muted">(phone, name or account)</span></label>
        <div class="row"><input id="find" name="find" value="${esc(find)}" autocomplete="off" inputmode="search" data-lookup="${call.id}"><button type="submit">Look up</button></div></form>
        <ul class="plain results" id="results" aria-live="polite">${found.map((c) => foundRow(page, call.id, c)).join('')}${find && !found.length ? '<li class="muted">No match. Keep going without one, or <a href="/customers/new?call=' + call.id + '">add them as a customer</a>.</li>' : ''}</ul>`}`;

  const outcomeForm = finished || closed ? '' : `<details class="panel"><summary>Finish this call</summary>
    <form method="post" action="/calls/${call.id}/action" class="stack">
    ${select(page, { label: 'What came of it?', name: 'outcome', placeholder: 'Choose', required: true, options: Object.entries(OUTCOMES).map(([value, label]) => ({ value, label })) })}
    ${field(page, { label: 'Final part number(s)', name: 'final_parts' })}
    <div class="two">${field(page, { label: 'Brand', name: 'brand' })}${field(page, { label: 'Quantity', name: 'final_quantity', inputmode: 'numeric' })}</div>
    <div class="two">${field(page, { label: 'Price quoted', name: 'price', inputmode: 'decimal' })}${field(page, { label: 'Invoice / reference', name: 'reference' })}</div>
    ${field(page, { label: 'Note', name: 'resolution', rows: 2 })}
    <div class="row"><button name="action" value="resolve" class="btn">Resolve</button><button name="action" value="close" class="btn primary">Close with outcome</button></div></form></details>`;

  const staffOptions = people.list().filter((p) => p.email !== who.email).map((p) => `<option value="${esc(p.email)}">${esc(p.name)}</option>`).join('');
  const actions = closed
    ? frm('reopen', 'Reopen', '', 'primary')
    : `<div class="actions">
        ${!call.assignee ? frm('claim', 'Take this call', '', 'primary') : mine ? '' : can(who, 'call.assign') ? frm('claim', 'Take it over', '', 'outline') : ''}
        ${call.assignee && (mine || can(who, 'call.assign')) ? frm('release', 'Hand back') : ''}
        ${call.status === 'parked' ? frm('resume', 'Resume', '', 'primary') : canMove(call.status, 'parked') && !finished ? frm('park', 'Park') : ''}
        ${finished ? frm('reopen', 'Reopen', '', 'primary') : ''}
        ${!finished && call.help === 'normal' ? frm('help', 'Need a hand', '') : ''}
        ${!finished && call.help !== 'normal' ? frm('help-cleared', 'Got it, no help needed') : ''}
      </div>
      ${!finished && call.help === 'normal' && staffOptions ? `<form method="post" action="/calls/${call.id}/action" class="row"><input type="hidden" name="action" value="help"><label class="sr" for="help-from">Ask</label><select id="help-from" name="from">${staffOptions}</select>${button(page, 'Ask them', { variant: 'outline', size: 'sm' })}</form>` : ''}
      ${!finished && staffOptions ? `<form method="post" action="/calls/${call.id}/nudge" class="stack nudge-form"><div class="row"><label class="sr" for="nudge-to">Nudge</label><select id="nudge-to" name="to">${staffOptions}</select><label class="sr" for="nudge-msg">Message</label><input id="nudge-msg" name="message" maxlength="200" placeholder="Optional note"></div>${button(page, 'Nudge them', { variant: 'outline', size: 'sm' })}</form>` : ''}
      ${can(who, 'call.assign') && !finished ? `<form method="post" action="/calls/${call.id}/action" class="row"><input type="hidden" name="action" value="assign"><label class="sr" for="assign-to">Assign to</label><select id="assign-to" name="to"><option value="">Nobody</option>${people.list().map((p) => `<option value="${esc(p.email)}"${p.email === call.assignee ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${button(page, 'Assign', { variant: 'outline', size: 'sm' })}</form>` : ''}`;

  const vp = vehiclePanels(ctx, got, closed);
  const matches = vp.deferMatch ? await matchList(ctx, call.id, vp.deferMatch.vq, vp.deferMatch.vy) : '';
  const vehiclePanel = vp.lookupHtml || vp.savedHtml ? `<section class="panel stack" id="vehicle"><h2>Vehicle lookup</h2>
    ${vp.vehicle ? `<p>On this call: <strong>${esc(vp.vehicle)}</strong></p>` : '<p class="muted">Read the VIN, find it by year and model, or pick it by hand. The fields below fill in.</p>'}
    ${vp.lookupHtml}${matches}${vp.savedHtml}</section>` : '';
  const partsHtml = partsPanel(ctx, got, closed);

  const itemTerm = url.searchParams.get('item') ?? '';
  const itemHits = itemTerm ? app.items.list(who, { q: itemTerm, limit: 6 }).items ?? [] : [];
  const itemPanel = `<section class="panel"><h2>Items</h2>
    ${items.length ? `<ul class="plain items">${items.map((i) => `<li><span><strong>${esc(i.sku)}</strong> ${esc(i.name)}${i.brand ? ` <small>${esc(i.brand)}</small>` : ''}</span><span>× ${i.quantity}${i.cents != null ? ` · ${money(i.cents)}` : ''}</span>
      ${closed ? '' : `<form method="post" action="/calls/${call.id}/action"><input type="hidden" name="action" value="remove-item"><input type="hidden" name="item" value="${i.id}"><button class="link" aria-label="Remove ${esc(i.name)}">Remove</button></form>`}</li>`).join('')}</ul>` : '<p class="muted">No items listed yet.</p>'}
    ${closed ? '' : `<form method="get" action="/calls/${call.id}" class="row" role="search"><label class="sr" for="item-q">Find an item</label><input id="item-q" name="item" value="${esc(itemTerm)}" placeholder="Item number or name"><button type="submit">Find</button></form>
    ${itemHits.length ? `<ul class="plain results">${itemHits.map((i) => `<li><span><strong>${esc(i.sku)}</strong> ${esc(i.name)}${i.cents != null ? ` · ${money(i.cents)}` : ''}</span>
      <form method="post" action="/calls/${call.id}/action" class="row"><input type="hidden" name="action" value="add-item"><input type="hidden" name="item" value="${i.id}"><input class="qty" name="quantity" value="1" inputmode="numeric" aria-label="Quantity"><button>Add</button></form></li>`).join('')}</ul>` : itemTerm ? '<p class="muted">No such item.</p>' : ''}
    <p><a href="/items/new?call=${call.id}">Add a new item to the catalog</a></p>`}</section>`;

  const timeline = `<section class="panel"><h2>Timeline</h2><ol class="timeline">${[...events].reverse().map((e) => `<li><span>${esc((EVENT_WORDS[e.type] ?? (() => e.type))(e.data, people))}</span>
    <small>${esc(people.name(e.actor))} · ${esc(when(e.at, config.zone))}</small></li>`).join('')}</ol></section>`;

  return `
<div class="head"><div><h1>${esc(got.title)}</h1><p class="muted">Call #${call.id} · started ${esc(when(call.created_at, config.zone))} by ${esc(people.name(call.created_by))}${call.assignee ? ` · ${esc(people.name(call.assignee))} has it` : ''}</p></div>
<div class="badges">${callBadges(page, call, people)}${call.outcome ? badge(page, 'primary', OUTCOMES[call.outcome]) : ''}<a class="btn" href="/calls/${call.id}/print" target="_blank" rel="noopener">Print</a></div></div>
<div class="workspace">
<div class="main-col">
  <section class="panel"><h2>Caller</h2>${lookup}</section>
  ${vehiclePanel}
  <form method="post" action="/calls/${call.id}/save" id="call-form" data-call="${call.id}" data-revision="${call.revision}" autocomplete="off">
    <input type="hidden" name="revision" value="${call.revision}">
    <section class="panel stack"><h2>The request</h2>
      ${field(page, { label: 'What do they need?', name: 'request', value: call.request, rows: 3, ...lock })}
      <div class="two">${field(page, { label: 'Part number(s) they gave', name: 'part_numbers', value: call.part_numbers, ...lock })}${field(page, { label: 'Quantity', name: 'quantity', value: call.quantity == null ? '' : String(call.quantity), inputmode: 'numeric', ...lock })}</div>
      ${customer ? '' : `<div class="two">${field(page, { label: 'Caller’s name', name: 'caller_name', value: call.caller_name, autocomplete: 'off', ...lock })}${field(page, { label: 'Callback number', name: 'caller_phone', value: call.caller_phone, type: 'tel', ...lock })}</div>`}
    </section>
    <section class="panel stack"><h2>What it goes on</h2>
      <div class="four">${['year', 'make', 'model', 'engine'].map((k) => field(page, { label: k[0].toUpperCase() + k.slice(1), name: `app_${k}`, value: a[k] ?? '', ...lock })).join('')}</div>
      <div class="four">${[['drivetrain', 'Drivetrain'], ['vin', 'VIN / serial'], ['unit', 'Fleet / unit no.']].map(([k, l]) => field(page, { label: l, name: `app_${k}`, value: a[k] ?? '', ...lock })).join('')}${select(page, { label: 'Priority', name: 'priority', value: call.priority, options: PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })), ...lock })}</div>
      ${field(page, { label: 'Anything else about the equipment', description: 'Casting number, hydraulic specs, dimensions, whatever the caller says.', name: 'app_freeform', value: a.freeform ?? '', rows: 2, ...lock })}
    </section>
    <section class="panel stack"><h2>Notes</h2>${field(page, { label: 'Notes', name: 'notes', value: call.notes, rows: 4, ...lock })}</section>
    ${closed ? '' : `<div class="savebar"><span id="save-state" role="status" aria-live="polite" class="muted">Saves as you type.</span><noscript><button type="submit" class="btn primary">Save</button></noscript><button type="submit" class="btn primary js-only">Save now</button></div>`}
  </form>
</div>
<aside class="side-col">
  <section class="panel"><h2>Work it</h2>${actions}</section>
  ${outcomeForm}
  ${partsHtml}
  ${itemPanel}
  ${timeline}
</aside>
</div>`;
}

function foundRow(page, callId, c) {
  return `<li><span><strong>${esc(c.name)}</strong> ${c.kind === 'organization' ? badge(page, 'outline', 'Business') : ''}${c.open_calls ? badge(page, 'warning', `${c.open_calls} open`) : ''}
    <small>${c.account_no ? `Account ${esc(c.account_no)} · ` : ''}${c.phones.map((p) => esc(p.phone)).join(' · ')}</small></span>
    <form method="post" action="/calls/${callId}/action"><input type="hidden" name="action" value="customer"><input type="hidden" name="customer" value="${c.id}">${button(page, 'This is them', { size: 'sm' })}</form></li>`;
}

const OUTCOME_LABELS = { final_parts: 'Part number(s)', brand: 'Brand', quantity: 'Quantity', cents: 'Price quoted', reference: 'Invoice / reference', resolution: 'Note' };

/** The printable ticket. Every value a person typed goes through esc(). */
function ticket(ctx, got) {
  const { who, people, config } = ctx;
  const { call, customer, items, events } = got;
  const a = call.application;
  const row = (label, value) => (value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '');
  const equipment = [['Year', a.year], ['Make', a.make], ['Model', a.model], ['Engine', a.engine], ['Drivetrain', a.drivetrain], ['VIN / serial', a.vin], ['Fleet / unit', a.unit]].map(([l, v]) => row(l, v)).join('');
  const outcome = call.outcome
    ? `<section><h2>Outcome</h2><table class="kv">${row('Result', OUTCOMES[call.outcome])}${Object.entries(call.outcome_data ?? {}).map(([k, v]) => row(OUTCOME_LABELS[k] ?? k, k === 'cents' && typeof v === 'number' ? money(v) : String(v))).join('')}</table></section>`
    : '';
  return `
<section><h1>Call #${call.id}</h1>
<table class="kv">${row('Status', STATUS_LABEL[call.status] ?? call.status)}${row('Started', `${when(call.created_at, config.zone)} by ${people.name(call.created_by)}`)}${row('Taken by', call.assignee ? people.name(call.assignee) : '')}${row('Priority', call.priority === 'normal' ? '' : call.priority)}</table></section>
<section><h2>Caller</h2><table class="kv">
${customer ? `${row('Customer', customer.name)}${row('Account', customer.account_no)}${row('Phone', customer.phones.map((p) => p.phone).join(', '))}` : `${row('Name', call.caller_name)}${row('Callback', call.caller_phone ? formatPhone(call.caller_phone) : '')}${call.caller_name || call.caller_phone ? '' : '<tr><td colspan="2">No caller details recorded.</td></tr>'}`}
</table></section>
<section><h2>Request</h2><table class="kv">${row('Needs', call.request)}${row('Part number(s)', call.part_numbers)}${row('Quantity', call.quantity == null ? '' : String(call.quantity))}</table></section>
${equipment || a.freeform ? `<section><h2>Goes on</h2><table class="kv">${equipment}${row('Other', a.freeform)}</table></section>` : ''}
${items.length ? `<section><h2>Items</h2><table class="lines"><thead><tr><th>Item no.</th><th>Description</th><th>Brand</th><th>Qty</th><th>Price</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.sku)}</td><td>${esc(i.name)}</td><td>${esc(i.brand ?? '')}</td><td>${i.quantity}</td><td>${i.cents != null ? esc(money(i.cents)) : ''}</td></tr>`).join('')}</tbody></table></section>` : ''}
${call.notes ? `<section><h2>Notes</h2><p class="notes">${esc(call.notes)}</p></section>` : ''}
${outcome}
<section><h2>Timeline</h2><table class="lines"><tbody>${events.map((e) => `<tr><td>${esc(when(e.at, config.zone))}</td><td>${esc(people.name(e.actor))}</td><td>${esc((EVENT_WORDS[e.type] ?? (() => e.type))(e.data, people))}</td></tr>`).join('')}</tbody></table></section>
<footer class="sheet-foot">Printed ${esc(when(ctx.now(), config.zone))} by ${esc(who.name || who.email)}</footer>`;
}
