// Items: the catalog of what the counter sells. Anyone adds one mid-call; managers fix and retire.
import { esc, money } from '../html.js';
import { badge, button, empty, field, say } from '../ui.js';
import { can } from '../../domain/permissions.js';

function itemForm(page, item = {}, action, { call = '', readonly = false } = {}) {
  const lock = readonly ? { disabled: true } : {};
  return `<form method="post" action="${action}" class="panel stack">
  ${call ? `<input type="hidden" name="call" value="${esc(call)}">` : ''}
  <div class="two">${field(page, { label: 'Item number (SKU)', name: 'sku', value: item.sku ?? '', required: true, ...lock })}${field(page, { label: 'Brand', name: 'brand', value: item.brand ?? '', ...lock })}</div>
  ${field(page, { label: 'Name', name: 'name', value: item.name ?? '', required: true, ...lock })}
  <div class="two">${field(page, { label: 'Price', name: 'price', value: item.cents == null ? '' : (item.cents / 100).toFixed(2), inputmode: 'decimal', placeholder: '12.50', ...lock })}${field(page, { label: 'Sold by', name: 'unit', value: item.unit ?? 'each', ...lock })}</div>
  ${field(page, { label: 'Description', name: 'description', value: item.description ?? '', rows: 3, ...lock })}
  ${readonly ? '<p class="muted">Managers can change items.</p>' : `<div class="row">${button(page, item.id ? 'Save changes' : 'Add item', { variant: 'primary' })}</div>`}</form>`;
}

const fromForm = (f) => ({ sku: f.get('sku'), name: f.get('name'), brand: f.get('brand'), price: f.get('price'), unit: f.get('unit'), description: f.get('description') });

export function itemRoutes(router) {
  router.get('/items', (ctx) => {
    const { page, app, url } = ctx;
    const q = url.searchParams.get('q') ?? '';
    const retired = url.searchParams.get('retired') === '1';
    const list = app.items.list(ctx.who, { q, includeRetired: retired }).items;
    const rows = list.map((i) => `<tr><td><a href="/items/${i.id}">${esc(i.sku)}</a></td><td>${esc(i.name)}${i.active ? '' : ` ${badge(page, 'warning', 'Retired')}`}</td><td>${esc(i.brand)}</td><td class="num">${money(i.cents)}</td><td>${esc(i.unit)}</td></tr>`).join('');
    return ctx.send('Items', `
<div class="head"><h1>Items</h1><div class="row">
<form method="get" action="/items" class="search" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Item number, name or brand" aria-label="Search items">
<label class="check"><input type="checkbox" name="retired" value="1"${retired ? ' checked' : ''}> Show retired</label><button type="submit">Search</button></form>
${can(ctx.who, 'item.create') ? '<a class="btn primary" href="/items/new">Add item</a>' : ''}</div></div>
${list.length ? `<table class="grid"><thead><tr><th>Item no.</th><th>Name</th><th>Brand</th><th>Price</th><th>Per</th></tr></thead><tbody>${rows}</tbody></table>` : empty(page, q ? 'No such item' : 'No items yet', q ? 'Add it so the next call can find it.' : 'Add the parts you talk about most.')}`, { active: 'items' });
  });

  router.get('/items/new', (ctx) => {
    if (!can(ctx.who, 'item.create')) return ctx.forbidden();
    return ctx.send('Add item', `<div class="head"><h1>Add item</h1></div>${itemForm(ctx.page, {}, '/items', { call: ctx.url.searchParams.get('call') ?? '' })}`, { active: 'items' });
  });

  router.post('/items', (ctx) => {
    const f = ctx.form;
    const made = ctx.app.items.create(ctx.who, fromForm(f));
    const call = Number(f.get('call')) || 0;
    if (made.error) return ctx.redirect(call ? `/items/new?call=${call}` : '/items/new', { problem: say(made.error) });
    if (call) {
      ctx.app.calls.addItem(ctx.who, call, made.id, 1);
      return ctx.redirect(`/calls/${call}`, { done: 'Item added to the catalog and to this call.' });
    }
    return ctx.redirect(`/items/${made.id}`, { done: 'Item added.' });
  });

  router.get('/items/:id', (ctx) => {
    const got = ctx.app.items.get(ctx.who, Number(ctx.params.id));
    if (got.error) return ctx.notFound();
    const { page, who } = ctx;
    const { item, calls } = got;
    return ctx.send(item.name, `
<div class="head"><div><h1>${esc(item.name)}</h1><p class="muted">${esc(item.sku)}${item.active ? '' : ' · retired'}</p></div>
${can(who, 'item.edit') ? `<form method="post" action="/items/${item.id}/active"><input type="hidden" name="active" value="${item.active ? '0' : '1'}">${button(page, item.active ? 'Retire' : 'Bring back', { variant: 'outline' })}</form>` : ''}</div>
<div class="workspace"><div class="main-col">${itemForm(page, item, `/items/${item.id}`, { readonly: !can(who, 'item.edit') })}</div>
<aside class="side-col"><section class="panel"><h2>Recent calls</h2>${calls.length ? `<ul class="plain">${calls.map((c) => `<li><span><a href="/calls/${c.id}">#${c.id}</a> ${esc(c.request || 'No request noted')}</span><span>× ${c.quantity}</span></li>`).join('')}</ul>` : '<p class="muted">Not on a call yet.</p>'}</section></aside></div>`, { active: 'items' });
  });

  router.post('/items/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.items.update(ctx.who, id, fromForm(ctx.form));
    return ctx.redirect(`/items/${id}`, r.error ? { problem: say(r.error) } : { done: 'Saved.' });
  });

  router.post('/items/:id/active', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.items.setActive(ctx.who, id, ctx.form.get('active') === '1');
    return ctx.redirect(`/items/${id}`, r.error ? { problem: say(r.error) } : { done: 'Updated.' });
  });
}
