// Watching a coworker's call and suggesting parts to them. Off until a manager or owner turns it on.
import { esc, ago, when, money } from '../html.js';
import { say } from '../ui.js';
import { can } from '../../domain/permissions.js';
import { describeVehicle } from '../../domain/vehicle.js';
import { answerCard, putOnCall } from './vehicles.js';

const WATCH_WORDS = { 'watch-off': 'Watching is switched off in this shop.', 'watch-self': 'That’s your own call.', decided: 'That suggestion was already answered.' };
const words = (code) => WATCH_WORDS[code] ?? say(code);

export function watchRoutes(router) {
  // Who is on what, right now.
  router.get('/watch', (ctx) => {
    const { app, people, config, who } = ctx;
    const on = app.watch.enabled();
    const toggle = can(who, 'watch.manage')
      ? `<form method="post" action="/watch/setting" class="row"><input type="hidden" name="enabled" value="${on ? '0' : '1'}"><button class="btn ${on ? '' : 'primary'}">${on ? 'Turn watching off' : 'Turn watching on'}</button></form>`
      : '';
    if (!on) {
      return ctx.send('Live', `<div class="head"><h1>Live</h1></div><section class="panel stack"><p>Watching a coworker’s call and suggesting a part to them is switched off in this shop.</p>
        ${toggle ? `<p>When it’s on, the person being watched always sees who is watching. Anyone with staff access can watch.</p>${toggle}` : '<p class="muted">A manager or owner can turn it on.</p>'}</section>`, { active: 'watch' });
    }
    const live = app.watch.live(who);
    const rows = (live.calls ?? []).filter((c) => c.assignee || c.status === 'open').map((c) => {
      const a = c.application ?? {};
      const car = describeVehicle({ year: a.year, make: a.make, model: a.model });
      const mine = c.assignee === who.email;
      return `<tr><td class="num"><a href="/calls/${c.id}">#${c.id}</a></td><td>${esc(c.request || 'No request yet')}${car ? `<small>${esc(car)}</small>` : ''}</td>
        <td>${c.assignee ? esc(people.name(c.assignee)) : '<span class="muted">Unassigned</span>'}</td>
        <td>${c.watchers.length ? `${c.watchers.map((e) => esc(people.name(e))).join(', ')} watching` : ''}</td>
        <td class="muted">${ago(c.updated_at, ctx.now())}</td><td>${mine ? '<span class="muted">Yours</span>' : `<a class="btn" href="/calls/${c.id}/watch">Watch</a>`}</td></tr>`;
    }).join('');
    return ctx.send('Live', `<div class="head"><h1>Live</h1><div class="row">${toggle}</div></div>
      <p class="muted">Open a call to watch it. They’re told you’re watching, and you can suggest a part number.</p>
      <section class="panel">${rows ? `<table class="grid compact"><thead><tr><th>Call</th><th>Request</th><th>Taken by</th><th></th><th>Last change</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No calls being worked right now.</p>'}</section>`, { active: 'watch', live: true });
  });

  router.post('/watch/setting', (ctx) => {
    const r = ctx.app.watch.setEnabled(ctx.who, ctx.form.get('enabled') === '1');
    return ctx.redirect('/watch', r.error ? { problem: words(r.error) } : { done: ctx.form.get('enabled') === '1' ? 'Watching is on.' : 'Watching is off.' });
  });

  // Read-only view of someone's call.
  router.get('/calls/:id/watch', (ctx) => {
    const id = Number(ctx.params.id);
    const got = ctx.app.watch.watch(ctx.who, id);
    if (got.error === 'missing') return ctx.notFound();
    if (got.error) return ctx.redirect('/watch', { problem: words(got.error) });
    const { call, customer, items, search, suggestions } = got;
    const { people, config } = ctx;
    const a = call.application ?? {};
    const row = (label, value) => (value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '');
    const car = describeVehicle({ year: a.year, make: a.make, model: a.model, engine: a.engine, drivetrain: a.drivetrain });
    const results = search?.results ?? [];
    const mine = suggestions.map((s) => `<li><span><strong>${esc(s.brand)} ${esc(s.part_number)}</strong> <small>${esc(people.name(s.from_email))} · ${esc(s.status)}${s.note ? ` · ${esc(s.note)}` : ''}</small></span></li>`).join('');
    const closed = call.status === 'closed';
    return ctx.send(`Watching call #${call.id}`, `
<div class="head"><div><h1>Watching: ${esc(call.request || `Call #${call.id}`)}</h1><p class="muted">Call #${call.id} · ${esc(call.assignee ? `${people.name(call.assignee)} has it` : `started by ${people.name(call.created_by)}`)} · they can see you’re watching</p></div>
<div class="row"><a class="btn" href="/watch">Back to Live</a><form method="post" action="/calls/${call.id}/watch/stop"><button class="btn">Stop watching</button></form></div></div>
<div id="watch-view" data-call="${call.id}" class="workspace"><div class="main-col">
<section class="panel"><h2>Caller</h2><table class="kv">${customer ? `${row('Customer', customer.name)}${row('Account', customer.account_no)}` : `${row('Name', call.caller_name)}`}</table></section>
<section class="panel"><h2>The request</h2><table class="kv">${row('Needs', call.request)}${row('Part number(s)', call.part_numbers)}${row('Quantity', call.quantity == null ? '' : String(call.quantity))}${row('Vehicle', car)}${row('VIN', a.vin)}${row('Notes', call.notes)}</table></section>
<section class="panel"><h2>Their part search</h2>${search ? `<p class="muted">${esc(search.term || search.number)} · ${ago(search.at, ctx.now())}</p>${results.length ? `<ul class="plain answers">${results.map((r) => answerCard(call.id, r, true)).join('')}</ul>` : '<p class="muted">Nothing found yet.</p>'}` : '<p class="muted">They haven’t searched for a part yet.</p>'}</section>
</div><aside class="side-col">
${closed ? '' : `<section class="panel"><h2>Suggest a part</h2><p class="muted">It goes to ${esc(people.name(call.assignee || call.created_by))} as a suggestion they can accept or dismiss. Look it up yourself first.</p>
<form method="post" action="/calls/${call.id}/suggest" class="stack"><label>Part<input name="term" placeholder="water pump" value="${esc(search?.term ?? '')}"></label>
<div class="two"><label>Brand<input name="brand" placeholder="Balkamp" required></label><label>Part number<input name="part_number" required></label></div>
<label>Why<input name="note" maxlength="300" placeholder="Fits the 5.4L, in stock"></label><button class="btn primary">Send suggestion</button></form></section>`}
<section class="panel"><h2>Items on the call</h2>${items.length ? `<ul class="plain items">${items.map((i) => `<li><span><strong>${esc(i.sku)}</strong> ${esc(i.name)}</span><span>× ${i.quantity}${i.cents != null ? ` · ${money(i.cents)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}</section>
${mine ? `<section class="panel"><h2>Suggestions so far</h2><ul class="plain">${mine}</ul></section>` : ''}
</aside></div>`, { active: 'watch', live: true, script: '<script src="/assets/watch.js" defer></script>' });
  });

  router.post('/calls/:id/watch/stop', (ctx) => {
    ctx.app.watch.stop(ctx.who, Number(ctx.params.id));
    return ctx.redirect('/watch');
  });
  // Keeps "watching" true while the page sits open.
  router.post('/calls/:id/watch/ping', (ctx) => {
    const r = ctx.app.watch.watch(ctx.who, Number(ctx.params.id));
    return ctx.json({ ok: !r.error }, r.error ? 400 : 200);
  });
  router.get('/calls/:id/watchers', (ctx) => ctx.json({ names: ctx.app.watch.enabled() ? ctx.app.watch.watchers(Number(ctx.params.id), ctx.who.email).map((e) => ctx.people.name(e)) : [] }));

  router.post('/calls/:id/suggest', (ctx) => {
    const id = Number(ctx.params.id);
    const f = ctx.form;
    const r = ctx.app.watch.suggest(ctx.who, id, { term: f.get('term') ?? '', brand: f.get('brand') ?? '', partNumber: f.get('part_number') ?? '', note: f.get('note') ?? '' });
    return ctx.redirect(`/calls/${id}/watch`, r.error ? { problem: words(r.error) } : { done: 'Sent. They’ll see it on their call.' });
  });

  // The person with the call takes it (it goes on the call and into the shop's saved answers) or dismisses it.
  router.post('/suggestions/:id/:verdict', (ctx) => {
    const accept = ctx.params.verdict === 'accept';
    if (!accept && ctx.params.verdict !== 'dismiss') return ctx.notFound();
    const r = ctx.app.watch.decide(ctx.who, Number(ctx.params.id), accept);
    if (r.error) return ctx.redirect('/', { problem: words(r.error) });
    const { suggestion: s, call } = r;
    const back = `/calls/${s.call_id}`;
    if (!accept) return ctx.redirect(back, { done: 'Dismissed.' });
    const a = JSON.parse(JSON.stringify(call.application ? JSON.parse(call.application) : {}));
    if (s.term && a.year && a.make && a.model && can(ctx.who, 'parts.teach')) ctx.app.parts.teach(ctx.who, { vehicle: a, term: s.term, brand: s.brand, partNumber: s.part_number, description: s.description });
    const added = can(ctx.who, 'call.edit') ? putOnCall(ctx, s.call_id, s.brand, s.part_number, s.description) : {};
    return ctx.redirect(back, added.problem ? { problem: added.problem } : { done: `${s.brand} ${s.part_number} is on the call.` });
  });
}

/** On the call itself: who is watching, and the suggestions waiting for the person working it. */
export function suggestionsPanel(ctx, got, closed) {
  const { app, people, who } = ctx;
  if (!app.watch.enabled()) return '';
  const call = got.call;
  const watchers = app.watch.watchers(call.id, who.email);
  const list = app.watch.suggestionsFor(call.id);
  const holder = (call.assignee || call.created_by) === who.email || can(who, 'call.assign');
  const bar = `<p id="watchers" class="muted" aria-live="polite" data-call="${call.id}">${watchers.length ? `${watchers.map((e) => esc(people.name(e))).join(', ')} ${watchers.length === 1 ? 'is' : 'are'} watching this call.` : ''}</p>`;
  if (!list.length) return `<section class="panel" id="suggestions"><h2>Watching</h2>${bar}<p class="muted">Coworkers can suggest a part here.</p></section>`;
  return `<section class="panel" id="suggestions"><h2>Suggested to you</h2>${bar}<ul class="plain answers">${list.map((s) => `<li class="answer"><div><strong>${esc(s.brand)} ${esc(s.part_number)}</strong>
    <span class="tag ${s.status === 'pending' ? 'warn' : s.status === 'accepted' ? 'good' : 'bad'}">${s.status === 'pending' ? 'Suggested' : s.status === 'accepted' ? 'Accepted' : 'Dismissed'}</span>
    <small>${esc(people.name(s.from_email))}${s.term ? ` · ${esc(s.term)}` : ''} · ${esc(ago(s.created_at, ctx.now()))}</small>${s.note ? `<div>${esc(s.note)}</div>` : ''}</div>
    ${s.status === 'pending' && holder && !closed ? `<div class="row vote"><form method="post" action="/suggestions/${s.id}/accept"><button>Put on call</button></form><form method="post" action="/suggestions/${s.id}/dismiss"><button>Dismiss</button></form></div>` : ''}</li>`).join('')}</ul></section>`;
}
