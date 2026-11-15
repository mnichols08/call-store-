// Customers: look one up, add one, see their history.
import { accessPanel, customerPortalPanel } from './portal.js';
import { esc, when } from '../html.js';
import { badge, button, empty, field, say, select } from '../ui.js';
import { OUTCOMES, STATUS_LABEL } from '../../domain/call.js';
import { can } from '../../domain/permissions.js';

const phoneRows = (page, phones = [], total = 3) =>
  Array.from({ length: Math.max(total, phones.length + 1) }, (_, i) => {
    const p = phones[i] ?? {};
    return `<div class="phone-row">${field(page, { label: i === 0 ? 'Phone' : `Phone ${i + 1}`, name: `phone_${i}`, value: p.phone ?? '', type: 'tel', autocomplete: 'off' })}
      ${field(page, { label: 'Label', name: `label_${i}`, value: p.label ?? '', placeholder: 'cell, shop…' })}${field(page, { label: 'Ext.', name: `ext_${i}`, value: p.ext ?? '' })}</div>`;
  }).join('');

/** The customer form's phone rows back into a list. */
export function phonesFrom(form) {
  const phones = [];
  for (let i = 0; i < 12; i++) if (form.has(`phone_${i}`)) phones.push({ phone: form.get(`phone_${i}`), label: form.get(`label_${i}`), ext: form.get(`ext_${i}`) });
  return phones;
}

const TIER_LABEL = { retail: 'Retail', pro: 'Pro', fleet: 'Fleet' };
export const tierBadge = (page, tier) => (tier === 'pro' || tier === 'fleet' ? badge(page, tier === 'fleet' ? 'warning' : 'primary', TIER_LABEL[tier]) : '');

function customerForm(page, c = {}, action, call = '') {
  return `<form method="post" action="${action}" class="panel stack">
  ${call ? `<input type="hidden" name="call" value="${esc(call)}">` : ''}
  ${select(page, { label: 'Kind', name: 'kind', value: c.kind ?? 'person', options: [{ value: 'person', label: 'Person' }, { value: 'organization', label: 'Business / organization' }] })}
  ${select(page, { label: 'Account type', name: 'tier', value: c.tier ?? 'retail', options: [{ value: 'retail', label: 'Retail (walk-in or regular)' }, { value: 'pro', label: 'Pro (mechanic, body shop, contractor)' }, { value: 'fleet', label: 'Fleet' }] })}
  ${field(page, { label: 'Name', name: 'name', value: c.name ?? '', required: true, autocomplete: 'off' })}
  ${field(page, { label: 'Account number', name: 'account_no', value: c.account_no ?? '' })}
  ${phoneRows(page, c.phones)}
  ${field(page, { label: 'Address / delivery notes', name: 'address', value: c.address ?? '', rows: 2 })}
  ${field(page, { label: 'Notes', name: 'notes', value: c.notes ?? '', rows: 3 })}
  <div class="row">${button(page, c.id ? 'Save changes' : 'Add customer', { variant: 'primary' })}</div></form>`;
}

export function customerRoutes(router) {
  router.get('/customers', (ctx) => {
    const { page, app, url } = ctx;
    const q = url.searchParams.get('q') ?? '';
    const tier = url.searchParams.get('tier') ?? '';
    const list = app.customers.list(ctx.who, { q, tier }).customers;
    const rows = list.map((c) => `<tr><td><a href="/customers/${c.id}">${esc(c.name)}</a>${c.kind === 'organization' ? ` ${badge(page, 'outline', 'Business')}` : ''} ${tierBadge(page, c.tier)}${c.status === 'inactive' ? ` ${badge(page, 'warning', 'Inactive')}` : ''}</td>
      <td>${esc(c.account_no ?? '')}</td><td>${c.phones.map((p) => esc(p.phone)).join('<br>')}</td><td>${c.open_calls || ''}</td></tr>`).join('');
    return ctx.send('Customers', `
<div class="head"><h1>Customers</h1><div class="row">
<form method="get" action="/customers" class="search" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Phone, name or account" aria-label="Search customers"><select name="tier" aria-label="Account type"><option value="">All types</option><option value="pro"${tier === 'pro' ? ' selected' : ''}>Pro</option><option value="fleet"${tier === 'fleet' ? ' selected' : ''}>Fleet</option><option value="retail"${tier === 'retail' ? ' selected' : ''}>Retail</option></select><button type="submit">Search</button></form>
${can(ctx.who, 'portal.invite') ? '<a class="btn" href="/counter-card">Counter card</a>' : ''}${can(ctx.who, 'customer.import') ? '<a class="btn" href="/customers/import">Import list</a>' : ''}${can(ctx.who, 'customer.create') ? '<a class="btn primary" href="/customers/new">Add customer</a>' : ''}</div></div>
${accessPanel(ctx)}
${list.length ? `<table class="grid"><thead><tr><th>Name</th><th>Account</th><th>Phones</th><th>Open calls</th></tr></thead><tbody>${rows}</tbody></table>` : empty(page, q ? 'No one matches' : 'No customers yet', q ? 'Try the last four digits of the phone number.' : 'Callers don’t have to be customers. Add the regulars here.')}`, { active: 'customers' });
  });

  router.get('/customers/new', (ctx) => {
    if (!can(ctx.who, 'customer.create')) return ctx.forbidden();
    return ctx.send('Add customer', `<div class="head"><h1>Add customer</h1></div>${customerForm(ctx.page, {}, '/customers', ctx.url.searchParams.get('call') ?? '')}`, { active: 'customers' });
  });


  // Bring in a customer list from a spreadsheet (CSV): look it over first, then confirm.
  const importForm = (text = '') => `<form method="post" action="/customers/import/preview" class="panel stack">
    <p>Columns: <strong>ID</strong> (the account number), <strong>Name</strong> and <strong>Phone</strong>. Address, Notes and Type (retail, pro or fleet) work too. Separate cells with commas or tabs, so a copy from a spreadsheet works as it is. Nothing changes until you confirm.</p>
    <label>Choose a file<input type="file" id="import-file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label>
    <label>Or paste it here<textarea name="csv" id="import-text" rows="10" spellcheck="false" placeholder="ID&#9;Name&#9;Phone">${esc(text)}</textarea></label>
    <div class="row"><button class="btn primary">Look it over</button><a class="btn" href="/customers">Cancel</a></div></form>`;
  const importScript = () => `<script src="/assets/import.js" defer></script>`;
  router.get('/customers/import', (ctx) => {
    if (!can(ctx.who, 'customer.import')) return ctx.forbidden();
    return ctx.send('Import customers', `<div class="head"><h1>Import customers</h1></div>${importForm()}`, { active: 'customers', script: importScript(ctx) });
  });
  router.post('/customers/import/preview', (ctx) => {
    if (!can(ctx.who, 'customer.import')) return ctx.forbidden();
    const text = ctx.form.get('csv') ?? '';
    const plan = ctx.app.customers.importPlan(ctx.who, text);
    if (plan.error) return ctx.send('Import customers', `<div class="head"><h1>Import customers</h1></div><p class="flash problem" role="alert">${esc(say(plan.error))}</p>${importForm(text)}`, { active: 'customers', script: importScript(ctx) }, 400);
    const { counts, rows } = plan;
    const LABEL = { new: 'New', update: 'Update', same: 'No change', skip: 'Skipped' };
    const VARIANT = { new: 'success', update: 'primary', same: 'outline', skip: 'warning' };
    const shown = rows.filter((r) => r.action !== 'same').slice(0, 300);
    const detail = (r) => esc(r.action === 'skip' ? r.why : r.action === 'update' ? r.changes.join('; ') : [r.kind === 'organization' ? 'Business' : '', ...r.phones.map((p) => p.phone)].filter(Boolean).join(' · ')) + (r.warnings.length ? `<small>${esc(r.warnings.join('; '))}</small>` : '');
    const todo = counts.new + counts.update;
    return ctx.send('Import customers', `<div class="head"><h1>Look it over</h1></div>
      <section class="panel stack"><p><strong>${counts.new}</strong> new · <strong>${counts.update}</strong> updated · <strong>${counts.same}</strong> already up to date · <strong>${counts.skip}</strong> skipped</p>
        <p class="muted">Updates only change the name, add an account number that’s missing, and add phones that aren’t there yet. Nothing is deleted, and notes and history stay as they are. New names that look like a business are added as one; you can change that on the customer’s page.</p>
        ${todo ? `<form method="post" action="/customers/import" class="row"><input type="hidden" name="csv" value="${esc(text)}"><button class="btn primary">Import ${todo} customer${todo === 1 ? '' : 's'}</button><a class="btn" href="/customers/import">Start over</a></form>` : '<p>There’s nothing to import. <a href="/customers/import">Start over</a>.</p>'}</section>
      ${shown.length ? `<section class="panel"><table class="grid compact"><thead><tr><th>Line</th><th></th><th>Name</th><th>Account</th><th>What happens</th></tr></thead><tbody>${shown.map((r) => `<tr><td class="num">${r.line}</td><td>${badge(ctx.page, VARIANT[r.action], LABEL[r.action])}</td><td>${esc(r.name || '—')}</td><td>${esc(r.account_no ?? '')}</td><td>${detail(r)}</td></tr>`).join('')}</tbody></table>${rows.filter((r) => r.action !== 'same').length > shown.length ? `<p class="muted">Showing the first ${shown.length} lines that need attention.</p>` : ''}</section>` : ''}`, { active: 'customers' });
  });
  router.post('/customers/import', (ctx) => {
    const r = ctx.app.customers.importApply(ctx.who, ctx.form.get('csv') ?? '');
    if (r.error === 'forbidden') return ctx.forbidden();
    if (r.error) return ctx.redirect('/customers/import', { problem: say(r.error) });
    return ctx.redirect('/customers', { done: `Imported: ${r.counts.new} new, ${r.counts.update} updated.` });
  });

  router.post('/customers', (ctx) => {
    const f = ctx.form;
    const made = ctx.app.customers.create(ctx.who, { kind: f.get('kind'), tier: f.get('tier'), name: f.get('name'), account_no: f.get('account_no'), address: f.get('address'), notes: f.get('notes'), phones: phonesFrom(f) });
    if (made.error) return ctx.redirect(f.get('call') ? `/customers/new?call=${encodeURIComponent(f.get('call'))}` : '/customers/new', { problem: say(made.error) });
    const call = Number(f.get('call'));
    if (call) {
      ctx.app.calls.attachCustomer(ctx.who, call, made.id);
      return ctx.redirect(`/calls/${call}`, { done: 'Customer added and attached.' });
    }
    return ctx.redirect(`/customers/${made.id}`, { done: 'Customer added.' });
  });

  router.get('/customers/:id', (ctx) => {
    const got = ctx.app.customers.get(ctx.who, Number(ctx.params.id));
    if (got.error) return ctx.notFound();
    const { page, who, people, config } = ctx;
    const c = got.customer;
    const calls = c.calls.map((x) => `<tr><td><a href="/calls/${x.id}">#${x.id}</a></td><td>${esc(x.request || x.part_numbers || 'No request noted')}</td>
      <td>${badge(page, 'outline', OUTCOMES[x.outcome] ?? STATUS_LABEL[x.status])}</td><td class="muted">${esc(when(x.created_at, config.zone))}</td></tr>`).join('');
    const vs = ctx.app.vehicles.forCustomer(who, c.id).vehicles ?? [];
    const vehiclesPanel = `<section class="panel"><h2>Vehicles</h2>${vs.length ? `<ul class="plain">${vs.map((v) => `<li><span>${esc([v.year, v.make, v.model, v.engine, v.drivetrain].filter(Boolean).join(' '))}${v.vin ? `<small>VIN ${esc(v.vin)}</small>` : ''}</span>
      ${can(who, 'vehicle.save') ? `<form method="post" action="/customers/${c.id}/vehicles/${v.id}/remove"><button class="link" aria-label="Remove this vehicle">Remove</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="muted">None saved. A VIN looked up on one of their calls is kept here.</p>'}</section>`;
    return ctx.send(c.name, `
<div class="head"><div><h1>${esc(c.name)}</h1><p class="muted">${c.kind === 'organization' ? 'Business' : 'Person'}${c.account_no ? ` · Account ${esc(c.account_no)}` : ''} · added by ${esc(people.name(c.created_by))}</p></div>
<div class="row">${can(who, 'call.create') ? `<form method="post" action="/calls"><input type="hidden" name="customer" value="${c.id}">${button(page, 'Start a call for them', { variant: 'primary' })}</form>` : ''}
${can(who, 'customer.deactivate') ? `<form method="post" action="/customers/${c.id}/status"><input type="hidden" name="status" value="${c.status === 'active' ? 'inactive' : 'active'}">${button(page, c.status === 'active' ? 'Mark inactive' : 'Mark active', { variant: 'outline' })}</form>` : ''}</div></div>
<div class="workspace"><div class="main-col">
${can(who, 'customer.edit') ? customerForm(page, c, `/customers/${c.id}`) : `<section class="panel"><p>${c.phones.map((p) => esc(p.phone)).join(' · ')}</p><p>${esc(c.notes)}</p></section>`}
</div><aside class="side-col">
<section class="panel"><h2>Contacts</h2>${c.contacts.length ? `<ul class="plain">${c.contacts.map((k) => `<li><span><strong>${esc(k.name)}</strong> ${esc(k.title)}<small>${esc(k.phone)}${k.ext ? ` x${esc(k.ext)}` : ''}</small></span></li>`).join('')}</ul>` : '<p class="muted">Nobody listed.</p>'}
${can(who, 'customer.edit') ? `<form method="post" action="/customers/${c.id}/contacts" class="stack">${field(page, { label: 'Name', name: 'name', required: true })}${field(page, { label: 'Title', name: 'title' })}<div class="two">${field(page, { label: 'Phone', name: 'phone', type: 'tel' })}${field(page, { label: 'Ext.', name: 'ext' })}</div>${button(page, 'Add contact', { variant: 'outline', size: 'sm' })}</form>` : ''}</section>
${vehiclesPanel}
${customerPortalPanel(ctx, c)}
<section class="panel"><h2>Call history</h2>${calls ? `<table class="grid compact"><tbody>${calls}</tbody></table>` : '<p class="muted">No calls yet.</p>'}</section>
</aside></div>`, { active: 'customers' });
  });

  router.post('/customers/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const f = ctx.form;
    const r = ctx.app.customers.update(ctx.who, id, { kind: f.get('kind'), tier: f.get('tier'), name: f.get('name'), account_no: f.get('account_no'), address: f.get('address'), notes: f.get('notes'), phones: phonesFrom(f) });
    return ctx.redirect(`/customers/${id}`, r.error ? { problem: say(r.error) } : { done: 'Saved.' });
  });

  router.post('/customers/:id/contacts', (ctx) => {
    const id = Number(ctx.params.id);
    const f = ctx.form;
    const r = ctx.app.customers.addContact(ctx.who, id, { name: f.get('name'), title: f.get('title'), phone: f.get('phone'), ext: f.get('ext') });
    return ctx.redirect(`/customers/${id}`, r.error ? { problem: say(r.error) } : { done: 'Contact added.' });
  });

  router.post('/customers/:id/status', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.customers.setStatus(ctx.who, id, ctx.form.get('status'));
    return ctx.redirect(`/customers/${id}`, r.error ? { problem: say(r.error) } : { done: 'Updated.' });
  });

  // The lookup the call workspace runs as you type.
  router.get('/api/customers', (ctx) => {
    const r = ctx.app.customers.search(ctx.who, ctx.url.searchParams.get('q') ?? '');
    return ctx.json(r.error ? r : { ok: true, customers: r.customers.map((c) => ({ id: c.id, name: c.name, kind: c.kind, account_no: c.account_no, open_calls: c.open_calls, phones: c.phones.map((p) => p.phone) })) }, r.error ? 403 : 200);
  });
}
