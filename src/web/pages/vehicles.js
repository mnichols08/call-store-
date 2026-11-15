// Vehicle lookup and the parts finder, on a call. Everything works as plain forms; public/vehicle.js
// only makes the pickers quicker. The shop's saved answers always come first.
import { esc, ago } from '../html.js';
import { say } from '../ui.js';
import { describeVehicle } from '../../domain/vehicle.js';
import { can } from '../../domain/permissions.js';

const KEYS = ['year', 'make', 'model', 'engine', 'drivetrain'];
const pick = (f) => Object.fromEntries(KEYS.map((k) => [k, (f.get(k) ?? '').trim()]));

export function vehicleRoutes(router) {
  // ------------------------------------------------------------ pickers (JSON, for the page's script)
  router.get('/api/vehicle/makes', async (ctx) => ctx.json(await ctx.app.vehicles.makes(ctx.who, Number(ctx.url.searchParams.get('year')))));
  router.get('/api/vehicle/models', async (ctx) => ctx.json(await ctx.app.vehicles.models(ctx.who, Number(ctx.url.searchParams.get('year')), ctx.url.searchParams.get('make') ?? '')));
  router.get('/api/vehicle/options', async (ctx) => {
    const q = ctx.url.searchParams;
    return ctx.json(await ctx.app.vehicles.options(ctx.who, Number(q.get('year')), q.get('make') ?? '', q.get('model') ?? ''));
  });

  // Read a VIN and put the vehicle on the call. The VIN is kept on the call, and on the customer if there is one.
  router.post('/calls/:id/vehicle/vin', async (ctx) => {
    const id = Number(ctx.params.id);
    const back = `/calls/${id}#vehicle`;
    const result = await ctx.app.vehicles.decode(ctx.who, ctx.form.get('vin') ?? '');
    if (result.error) return ctx.redirect(back, { problem: say(result.error) });
    const { spec, warnings } = result;
    const applied = applyToCall(ctx, id, spec, { vin: spec.vin });
    if (applied.error) return ctx.redirect(back, { problem: say(applied.error) });
    return ctx.redirect(back, { done: `${describeVehicle(spec)}${spec.trim ? ` (${spec.trim})` : ''}.${warnings.length ? ` ${warnings.join(' ')}` : ''}${saved(ctx, id, spec) ? ' Saved to the customer.' : ''}` });
  });

  // Use a vehicle picked by hand, found by "2015 silverado", or saved on the customer.
  router.post('/calls/:id/vehicle/use', (ctx) => {
    const id = Number(ctx.params.id);
    const back = `/calls/${id}#vehicle`;
    const f = ctx.form;
    let spec = pick(f);
    let vin = '';
    if (f.get('saved')) {
      const v = ctx.app.vehicles.get(ctx.who, Number(f.get('saved')));
      if (v.error) return ctx.redirect(back, { problem: say(v.error) });
      spec = { year: v.vehicle.year ? String(v.vehicle.year) : '', make: v.vehicle.make, model: v.vehicle.model, engine: v.vehicle.engine, drivetrain: v.vehicle.drivetrain };
      vin = v.vehicle.vin;
      ctx.app.vehicles.touch(ctx.who, v.vehicle.id);
    }
    if (!spec.year || !spec.make || !spec.model) return ctx.redirect(back, { problem: say('vehicle') });
    ctx.app.vehicles.remember(ctx.who, spec);
    const applied = applyToCall(ctx, id, spec, vin ? { vin } : {});
    if (applied.error) return ctx.redirect(back, { problem: say(applied.error) });
    const kept = saved(ctx, id, { ...spec, vin: vin || applied.vin });
    return ctx.redirect(back, { done: `${describeVehicle(spec)}.${kept ? ' Saved to the customer.' : ''}` });
  });

  // Look for the closest match to what was typed. Shown as a list on the call page.
  router.post('/calls/:id/vehicle/match', (ctx) => ctx.redirect(`/calls/${Number(ctx.params.id)}?${new URLSearchParams({ vq: ctx.form.get('vq') ?? '', vy: ctx.form.get('vy') ?? '' })}#vehicle`));

  router.post('/customers/:cid/vehicles/:id/remove', (ctx) => {
    const r = ctx.app.vehicles.removeFor(ctx.who, Number(ctx.params.id));
    return ctx.redirect(`/customers/${Number(ctx.params.cid)}`, r.error ? { problem: say(r.error) } : { done: 'Removed.' });
  });

  // ------------------------------------------------------------ parts
  router.post('/calls/:id/parts/find', async (ctx) => {
    const id = Number(ctx.params.id);
    const got = ctx.app.calls.get(ctx.who, id);
    if (got.error) return ctx.notFound();
    const a = got.call.application;
    const f = ctx.form;
    const measure = f.get('measure') === '1' ? ctx.app.details.get(ctx.who, id).details?.key ?? '' : '';
    if (f.get('measure') === '1' && !measure) return ctx.redirect(`/calls/${id}#details`, { problem: 'Fill in all the measurements first.' });
    const result = await ctx.app.parts.find(ctx.who, {
      measure,
      vehicle: { year: a.year, make: a.make, model: a.model, engine: a.engine, drivetrain: a.drivetrain },
      term: f.get('term') ?? '', number: f.get('number') ?? '', fresh: f.get('fresh') === '1', showBad: f.get('showBad') === '1', callId: id,
    });
    return ctx.redirect(`/calls/${id}#parts`, result.error ? { problem: say(result.error) } : result.aiError && !result.results.length ? { problem: say(result.aiError) } : {});
  });

  router.post('/parts/:id/feedback', (ctx) => {
    const callId = Number(ctx.form.get('call')) || null;
    const result = ctx.app.parts.feedback(ctx.who, Number(ctx.params.id), ctx.form.get('result') ?? '', { note: ctx.form.get('note') ?? '', callId });
    const back = callId ? `/calls/${callId}#parts` : '/';
    if (ctx.wantsJson) return ctx.json(result, result.error ? 400 : 200);
    return ctx.redirect(back, result.error ? { problem: say(result.error) } : { done: ctx.form.get('result') === 'worked' ? 'Thanks. The shop will remember that it worked.' : 'Thanks. That’s noted.' });
  });

  router.post('/calls/:id/parts/teach', (ctx) => {
    const id = Number(ctx.params.id);
    const got = ctx.app.calls.get(ctx.who, id);
    if (got.error) return ctx.notFound();
    const a = got.call.application;
    const f = ctx.form;
    const result = ctx.app.parts.teach(ctx.who, { vehicle: a, term: f.get('term'), brand: f.get('brand'), partNumber: f.get('part_number'), description: f.get('description') ?? '' });
    return ctx.redirect(`/calls/${id}#parts`, result.error ? { problem: say(result.error) } : { done: 'Saved. It will come up first next time.' });
  });

  // Put an answer on the call as a line item (creating the catalog item the first time).
  router.post('/calls/:id/parts/add', (ctx) => {
    const id = Number(ctx.params.id);
    const back = `/calls/${id}#parts`;
    const answer = ctx.app.parts.get(ctx.who, Number(ctx.form.get('answer')));
    if (answer.error) return ctx.redirect(back, { problem: say(answer.error) });
    const { brand, part_number: number, description } = answer.raw;
    const added = putOnCall(ctx, id, brand, number, description);
    if (added.problem) return ctx.redirect(back, { problem: added.problem });
    return ctx.redirect(back, { done: `${added.sku} is on the call.` });
  });
}

/** Find or create the catalog item for a brand and part number, and put one on the call. */
export function putOnCall(ctx, callId, brand, number, description) {
  const sku = `${brand} ${number}`.toUpperCase();
  let item = (ctx.app.items.list(ctx.who, { q: sku, limit: 5 }).items ?? []).find((i) => i.sku.toLowerCase() === sku.toLowerCase());
  if (!item) {
    const made = ctx.app.items.create(ctx.who, { sku, name: description || `${brand} ${number}`, brand, price: '' });
    if (made.error) return { problem: say(made.error) };
    item = { id: made.id };
  }
  const added = ctx.app.calls.addItem(ctx.who, callId, item.id, 1);
  return added.error ? { problem: say(added.error) } : { sku };
}

function applyToCall(ctx, id, spec, extra) {
  const got = ctx.app.calls.get(ctx.who, id);
  if (got.error) return got;
  const current = got.call.application ?? {};
  const application = { ...current, year: String(spec.year ?? ''), make: spec.make ?? '', model: spec.model ?? '', engine: spec.engine ?? '', drivetrain: spec.drivetrain ?? '', ...extra };
  const result = ctx.app.calls.update(ctx.who, id, { application });
  return result.error ? result : { ok: true, vin: application.vin ?? '' };
}

/** With a customer on the call, keep the vehicle on them (by VIN when there is one). */
function saved(ctx, id, spec) {
  const got = ctx.app.calls.get(ctx.who, id);
  if (got.error || !got.customer || !can(ctx.who, 'vehicle.save')) return false;
  return Boolean(ctx.app.vehicles.saveFor(ctx.who, got.customer.id, spec).ok);
}

// -------------------------------------------------------------------------------- the panel
const VOTES = [['worked', 'It worked'], ['failed', 'Didn’t work'], ['wrong-fit', 'Wrong fit']];

export function answerCard(callId, a, closed) {
  const mark = a.confirmed ? `<span class="tag good">Confirmed by the shop · ${a.worked} ${a.worked === 1 ? 'person' : 'people'}</span>`
    : a.source === 'staff' ? '<span class="tag good">Added by staff</span>'
    : '<span class="tag warn">Suggested by AI · not checked yet</span>';
  const against = a.failed ? `<span class="tag bad">${a.failed} said it didn’t fit</span>` : '';
  return `<li class="answer"><div><strong>${esc(a.brand)} ${esc(a.partNumber)}</strong> ${mark} ${against}
    ${a.description ? `<div>${esc(a.description)}</div>` : ''}${a.notes ? `<small>${esc(a.notes)}</small>` : ''}
    ${a.sourceUrl ? `<small><a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">Where it was found</a></small>` : ''}</div>
    ${closed ? '' : `<div class="row vote">
      <form method="post" action="/calls/${callId}/parts/add"><input type="hidden" name="answer" value="${a.id}"><button>Put on call</button></form>
      ${VOTES.map(([v, label]) => `<form method="post" action="/parts/${a.id}/feedback"><input type="hidden" name="call" value="${callId}"><input type="hidden" name="result" value="${v}"><button class="${a.mine === v ? 'chosen' : ''}" aria-pressed="${a.mine === v}">${label}</button></form>`).join('')}</div>`}</li>`;
}

/** The vehicle and parts panels on the call page. Returns HTML. */
export function vehiclePanels(ctx, got, closed) {
  const { call, customer } = got;
  const callId = call.id;
  const a = call.application ?? {};
  const q = ctx.url.searchParams;
  const vq = q.get('vq') ?? '';
  const vy = q.get('vy') ?? '';
  const canLook = can(ctx.who, 'vehicle.lookup');
  const matches = vq && canLook ? null : null;
  let matchHtml = '';
  const saved = customer && canLook ? ctx.app.vehicles.forCustomer(ctx.who, customer.id).vehicles ?? [] : [];

  const hidden = (spec) => KEYS.map((k) => `<input type="hidden" name="${k}" value="${esc(spec[k] ?? '')}">`).join('');
  const savedHtml = saved.length ? `<h3>${esc(customer.name)}’s vehicles</h3><ul class="plain">${saved.map((v) => `<li><span>${esc(describeVehicle({ ...v, year: v.year ?? '' }))}${v.vin ? ` <small>VIN …${esc(v.vin.slice(-6))}</small>` : ''}</span>
    ${closed ? '' : `<form method="post" action="/calls/${callId}/vehicle/use"><input type="hidden" name="saved" value="${v.id}"><button>Use</button></form>`}</li>`).join('')}</ul>` : '';

  const vehicle = describeVehicle({ year: a.year, make: a.make, model: a.model, engine: a.engine, drivetrain: a.drivetrain });
  const lookupHtml = closed || !canLook ? '' : `
    <form method="post" action="/calls/${callId}/vehicle/vin" class="row" autocomplete="off"><label class="sr" for="vin-in">VIN</label><input id="vin-in" name="vin" placeholder="VIN (17 characters)" maxlength="30" spellcheck="false" autocapitalize="characters"><button>Look up VIN</button></form>
    <form method="post" action="/calls/${callId}/vehicle/match" class="row"><label class="sr" for="vq">Year and model</label><input id="vq" name="vq" value="${esc(vq)}" placeholder="Year and model, e.g. 2015 silverado"><label class="sr" for="vy">Year</label><input id="vy" name="vy" class="qty" value="${esc(vy)}" inputmode="numeric" placeholder="Year"><button>Find closest</button></form>
    <details class="picker" data-vehicle-picker data-call="${callId}"><summary>Pick year, make, model</summary>
      <form method="post" action="/calls/${callId}/vehicle/use" class="stack">
        <div class="four"><label>Year<input name="year" list="dl-year" inputmode="numeric" value="${esc(a.year ?? '')}" autocomplete="off"></label><label>Make<input name="make" list="dl-make" value="${esc(a.make ?? '')}" autocomplete="off"></label>
        <label>Model<input name="model" list="dl-model" value="${esc(a.model ?? '')}" autocomplete="off"></label><label>Engine<input name="engine" list="dl-engine" value="${esc(a.engine ?? '')}" autocomplete="off"></label></div>
        <div class="two"><label>Drivetrain<input name="drivetrain" list="dl-drive" value="${esc(a.drivetrain ?? '')}" autocomplete="off"></label><span></span></div>
        <datalist id="dl-year"></datalist><datalist id="dl-make"></datalist><datalist id="dl-model"></datalist><datalist id="dl-engine"></datalist><datalist id="dl-drive"></datalist>
        <button>Use this vehicle</button></form></details>`;

  return { lookupHtml, savedHtml, vehicle, vq, vy, hidden, matchHtml, deferMatch: vq && canLook ? { vq, vy } : null };
}

/**
 * The "closest match" list, as data for the match-list component. Slow the first time a year is
 * searched (that year's index is built from NHTSA), which is why the page streams it.
 */
export async function matchData(ctx, vq, vy) {
  const r = await ctx.app.vehicles.match(ctx.who, { year: Number(vy) || null, text: vq });
  if (r.error) return { note: say(r.error), matches: [] };
  if (!r.matches.length) return { note: `No close match${r.year ? ` for ${r.year}` : ''}. Try fewer words, or pick by hand.`, matches: [] };
  const footnote = [r.partial ? 'Some makes couldn’t be checked right now, so this list may be missing a few.' : '', r.year ? '' : 'Add a year for a sharper match.'].filter(Boolean).join(' ');
  return { note: '', footnote, matches: r.matches.map((m, i) => ({ key: `${i}`, make: String(m.make), model: String(m.model), year: String(m.year || r.year || ''), exact: m.score >= 95 })) };
}

export function partsPanel(ctx, got, closed) {
  const callId = got.call.id;
  const a = got.call.application ?? {};
  const last = ctx.app.parts.lastForCall(ctx.who, callId).search;
  const hasVehicle = a.year && a.make && a.model;
  const canFind = can(ctx.who, 'parts.find');
  if (!canFind) return '';
  const results = last?.results ?? [];
  const form = closed ? '' : `<form method="post" action="/calls/${callId}/parts/find" class="row"><label class="sr" for="pt">Part, or part number to cross-reference</label>
    <input id="pt" name="term" value="${esc(last?.term || last?.number || got.call.part_numbers.split(/[,\n;]/)[0]?.trim() || '')}" placeholder="Part (water pump) or a part number" required><button>Find</button></form>
    ${hasVehicle ? '' : '<p class="muted">Part numbers work without a vehicle. For a part by name, add the vehicle first.</p>'}`;
  const teach = closed || !can(ctx.who, 'parts.teach') ? '' : `<details><summary>Add a number you know is right</summary><form method="post" action="/calls/${callId}/parts/teach" class="stack">
    <div class="two"><label>Part<input name="term" placeholder="water pump" required></label><label>Brand<input name="brand" placeholder="Balkamp" required></label></div>
    <div class="two"><label>Part number<input name="part_number" required></label><label>Description<input name="description"></label></div>
    <p class="muted">It’s saved for ${esc(describeVehicle(a) || 'this vehicle')} and shown first next time.</p><button>Save</button></form></details>`;
  let body = '';
  if (last) {
    const origin = last.fromMemory ? '<p class="muted">From what the shop already knows. No AI used.</p>' : last.aiAsked ? '<p class="muted">Asked the AI, and saved what it said. Check it before you quote it.</p>' : '';
    const problem = last.aiError && !last.aiAsked ? `<p class="muted">${esc(say(last.aiError))}</p>` : '';
    body = `${results.length ? `<ul class="plain answers">${results.map((r) => answerCard(callId, r, closed)).join('')}</ul>` : '<p class="muted">Nothing found.</p>'}${origin}${problem}
      ${closed || !last.canAskAi || last.aiAsked ? '' : `<form method="post" action="/calls/${callId}/parts/find"><input type="hidden" name="term" value="${esc(last.term || last.number)}"><input type="hidden" name="fresh" value="1"><button class="link">Ask the AI again</button></form>`}
      <small class="muted">${ago(last.at, ctx.now())}</small>`;
  }
  return `<section class="panel" id="parts"><h2>Find the part</h2>${form}${body}${teach}</section>`;
}
