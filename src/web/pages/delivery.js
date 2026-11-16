// Delivery on the staff side: a panel on each call, the list of what's going out, and a driver's sheet.
import { esc, when } from '../html.js';
import { badge, say } from '../ui.js';
import { can } from '../../domain/permissions.js';
import { STATUS_LABEL, NEXT, deliveryTowns } from '../../domain/delivery.js';
import { formatPhone } from '../../domain/phone.js';

const WORDS = { address: 'Say where it’s going.', delivered: 'That delivery is already done.', status: 'That can’t happen from here.' };
const words = (code) => WORDS[code] ?? say(code);
const VARIANT = { requested: 'warning', ready: 'primary', out: 'success', delivered: 'outline' };
const NEXT_LABEL = { ready: 'Ready to go', out: 'Out for delivery', delivered: 'Delivered' };
const originOf = (ctx) => (ctx.config.publicUrl || `${ctx.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${ctx.req.headers.host}`).replace(/\/$/, '');

/** The town picker: the shop's delivery towns, then "somewhere else". */
export const townSelect = (name, value = '') => {
  const towns = deliveryTowns();
  const known = towns.some((t) => t.value === value);
  return `<select name="${name}" aria-label="Town"><option value="">Choose a town…</option>${towns.map((t) => `<option value="${esc(t.value)}"${t.value === value ? ' selected' : ''}>${esc(t.value)}</option>`).join('')}<option value="Somewhere else"${value && !known ? ' selected' : ''}>Somewhere else (we’ll check)</option></select>`;
};

export function deliveryPanel(ctx, got, closed) {
  const { call } = got;
  const { who, app, config } = ctx;
  const d = app.delivery.get(who, call.id).delivery;
  const editable = can(who, 'call.edit') && !closed && d?.status !== 'delivered';
  const form = (label) => `<form method="post" action="/calls/${call.id}/delivery" class="stack"><label>Town ${townSelect('town', d?.town ?? '')}</label>
    <label>Address<textarea name="address" rows="2" maxlength="200" required>${esc(d?.address ?? '')}</textarea></label>
    <label>Notes (where to leave it, who to ask for)<input name="note" maxlength="200" value="${esc(d?.note ?? '')}"></label><button class="btn primary">${label}</button></form>`;
  if (!d) return can(who, 'call.edit') && !closed ? `<section class="panel stack" id="delivery"><h2>Delivery</h2><details><summary>Needs delivering</summary>${form('Add delivery')}</details></section>` : '';
  const steps = editable ? NEXT[d.status].map((s) => `<form method="post" action="/calls/${call.id}/delivery/status"><input type="hidden" name="status" value="${s}"><button class="btn${s === NEXT[d.status][0] ? ' primary' : ''}">${esc(NEXT_LABEL[s])}</button></form>`).join('') : '';
  return `<section class="panel stack" id="delivery"><h2>Delivery ${badge(ctx.page, VARIANT[d.status], STATUS_LABEL[d.status])}</h2>
    <p><strong>${esc(d.address)}</strong>${d.town ? `<br>${esc(d.town)}` : ''}${d.note ? `<br><small>${esc(d.note)}</small>` : ''}</p>
    ${d.outside ? '<p class="flash problem" role="alert">That’s outside the usual delivery area. Check with the customer before promising it.</p>' : ''}
    ${steps ? `<div class="row">${steps}</div>` : ''}
    ${editable ? `<details><summary>Change the address</summary>${form('Save')}</details><form method="post" action="/calls/${call.id}/delivery/remove"><button class="link">Not a delivery after all</button></form>` : `<p class="muted">${d.delivered_at ? `Delivered ${esc(when(d.delivered_at, config.zone))}.` : ''}</p>`}</section>`;
}

const stop = (d, ctx) => `<tr><td class="num"><a href="/calls/${d.call_id}">#${d.call_id}</a></td>
  <td><strong>${esc(d.customer_name || d.caller_name || 'Unknown')}</strong><small>${esc(formatPhone(d.customer_phone || d.caller_phone || ''))}</small></td>
  <td>${esc(d.request || d.part_numbers || '')}</td>
  <td>${esc(d.address)}<small>${esc(d.town)}${d.outside ? ' · outside the usual area' : ''}${d.note ? ` · ${esc(d.note)}` : ''}</small></td>
  <td>${badge(ctx.page, VARIANT[d.status], STATUS_LABEL[d.status])}</td></tr>`;

export function deliveryRoutes(router) {
  router.post('/calls/:id/delivery', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.delivery.set(ctx.who, id, { town: ctx.form.get('town'), address: ctx.form.get('address'), note: ctx.form.get('note') });
    if (r.error === 'forbidden') return ctx.forbidden();
    return ctx.redirect(`/calls/${id}#delivery`, r.error ? { problem: words(r.error) } : { done: r.outside ? 'Saved. That town is outside the usual delivery area, so check it with the customer.' : 'Saved.' });
  });
  router.post('/calls/:id/delivery/status', async (ctx) => {
    const id = Number(ctx.params.id);
    const r = await ctx.app.delivery.status(ctx.who, id, ctx.form.get('status') ?? '', { origin: originOf(ctx) });
    if (r.error === 'forbidden') return ctx.forbidden();
    return ctx.redirect(`/calls/${id}#delivery`, r.error ? { problem: words(r.error) } : { done: 'Updated.' });
  });
  router.post('/calls/:id/delivery/remove', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.delivery.remove(ctx.who, id);
    if (r.error === 'forbidden') return ctx.forbidden();
    return ctx.redirect(`/calls/${id}`, r.error ? { problem: words(r.error) } : { done: 'Delivery removed.' });
  });

  router.get('/deliveries', (ctx) => {
    const r = ctx.app.delivery.list(ctx.who);
    if (r.error) return ctx.forbidden();
    const table = (rows) => `<div class="scroll-x"><table class="grid compact"><thead><tr><th>Call</th><th>Customer</th><th>What</th><th>Where</th><th>Status</th></tr></thead><tbody>${rows.map((d) => stop(d, ctx)).join('')}</tbody></table></div>`;
    return ctx.send('Deliveries', `<div class="head"><h1>Deliveries</h1><div class="row">${r.active.length ? '<a class="btn" href="/deliveries/print" target="_blank" rel="noopener">Driver sheet</a>' : ''}</div></div>
      <section class="panel stack"><h2>To go out</h2>${r.active.length ? table(r.active) : '<p class="muted">Nothing waiting to be delivered. Add a delivery from a call.</p>'}</section>
      ${r.recent.length ? `<section class="panel stack"><h2>Delivered in the last day</h2>${table(r.recent)}</section>` : ''}`, { active: 'deliveries' });
  });

  // The sheet that rides in the truck: stops grouped by town, with a line to tick each one off.
  router.get('/deliveries/print', (ctx) => {
    const r = ctx.app.delivery.list(ctx.who);
    if (r.error) return ctx.forbidden();
    const towns = [];
    for (const d of r.active) {
      const key = d.town || 'No town given';
      if (towns.at(-1)?.key !== key) towns.push({ key, rows: [] });
      towns.at(-1).rows.push(d);
    }
    const body = towns.length ? towns.map((t) => `<section><h2>${esc(t.key)}</h2><table class="lines"><thead><tr><th></th><th>Call</th><th>Customer</th><th>Where</th><th>What</th></tr></thead><tbody>${t.rows.map((d) => `<tr><td>☐</td><td>#${d.call_id}</td><td>${esc(d.customer_name || d.caller_name || '')}<br>${esc(formatPhone(d.customer_phone || d.caller_phone || ''))}</td><td>${esc(d.address)}${d.note ? `<br>${esc(d.note)}` : ''}${d.outside ? '<br><strong>Outside usual area</strong>' : ''}</td><td>${esc(d.request || d.part_numbers || '')}</td></tr>`).join('')}</tbody></table></section>`).join('') : '<p>Nothing to deliver.</p>';
    return ctx.print('Deliveries', body, '/deliveries');
  });
}
