// The order notebook: a list of special orders, and a way to bring in a page by photo.
import { esc } from '../html.js';
import { say } from '../ui.js';
import { can } from '../../domain/permissions.js';
import { createLimiter } from '../limiter.js';
import { SHEET_BYTES } from '../../app/orders.js';

const WORDS = {
  off: 'Reading a photo needs the AI switched on (an Anthropic key on the server).',
  date: 'Give the date of the page.',
  empty: 'There’s nothing to save.',
  'too-many': 'That’s more lines than a page can hold.',
  photo: 'No picture came through. Try again.',
  'photo-big': 'That picture is too big. Take it again from a bit further back.',
  'photo-type': 'That doesn’t look like a photo. Use a JPEG, PNG or WebP.',
  'photo-bad': 'That picture couldn’t be read. Take it again.',
};
const words = (code) => WORDS[code] ?? say(code);
const niceDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const cell = (name, value, unsure, label, extra = '') => `<input name="${name}" value="${esc(value)}" aria-label="${esc(label)}" maxlength="80" autocomplete="off"${unsure ? ' class="unsure" title="The AI wasn’t sure about this. Check it against the page."' : ''}${extra}>`;

/** The review form for a page that was read: every line editable, nothing saved until confirmed. Exported for tests. */
export function reviewHtml(sheet) {
  const warn = [];
  if (!sheet.date) warn.push('The date couldn’t be read. Enter it.');
  if (sheet.weekdayOk === false) warn.push(`The page says “${sheet.dateText}”, but that weekday doesn’t fit the date. Check the year.`);
  const rows = sheet.rows.map((r, i) => {
    const u = (k) => r.unsure.includes(k);
    const options = r.candidates.length
      ? `<select name="cid_${i}" aria-label="Customer match for line ${i + 1}">${r.candidates.length === 1 ? '' : '<option value="">Which customer?</option>'}${r.candidates.map((c) => `<option value="${c.id}">${esc(c.name)}${c.account_no ? ` (${esc(c.account_no)})` : ''}</option>`).join('')}<option value="">No match</option></select>`
      : '<span class="muted">No match</span>';
    return `<tr${r.crossedOut ? ' class="struck"' : ''}><td><input type="checkbox" name="keep_${i}" value="1" aria-label="Keep line ${i + 1}"${r.crossedOut ? '' : ' checked'}></td>
      <td>${cell(`code_${i}`, r.lineCode, u('lineCode'), `Line code, line ${i + 1}`)}</td><td>${cell(`part_${i}`, r.partNumber, u('partNumber'), `Part number, line ${i + 1}`)}</td>
      <td>${cell(`from_${i}`, r.orderedFrom, u('orderedFrom'), `Ordered from, line ${i + 1}`)}</td><td>${cell(`cust_${i}`, r.customer, u('customer'), `Customer, line ${i + 1}`)}${r.crossedOut ? '<small>Crossed out on the page</small>' : ''}</td>
      <td>${options}</td><td><input type="checkbox" name="got_${i}" value="1" aria-label="Received, line ${i + 1}"${r.received ? ' checked' : ''}></td><td><input type="checkbox" name="paid_${i}" value="1" aria-label="Paid, line ${i + 1}"${r.paid ? ' checked' : ''}></td></tr>`;
  }).join('');
  return `<form method="post" action="/orders/save" class="stack" id="review-form"><input type="hidden" name="count" value="${sheet.rows.length}">
    ${warn.map((w) => `<p class="flash problem" role="alert">${esc(w)}</p>`).join('')}
    <label>Date of the page<input type="date" name="date" value="${esc(sheet.date)}" required></label>
    <p class="muted">The AI can misread handwriting. Check every line against the photo; fields it wasn’t sure of are outlined. Nothing is saved until you confirm.</p>
    ${sheet.rows.length ? `<div class="scroll-x"><table class="grid compact orders"><thead><tr><th>Keep</th><th>Line</th><th>Part number</th><th>Ordered from</th><th>Customer</th><th>Match</th><th>Got it</th><th>Paid</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="row"><button class="btn primary">Save these orders</button><a class="btn" href="/orders/scan">Start over</a></div>` : '<p>No lines could be read from that picture. Try again with the whole page in the frame and good light.</p>'}</form>`;
}

/** The form's numbered fields back into rows. */
export function rowsFrom(form) {
  const n = Math.min(Number.parseInt(form.get('count'), 10) || 0, 60);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    if (!form.has(`keep_${i}`)) continue;
    rows.push({ lineCode: form.get(`code_${i}`), partNumber: form.get(`part_${i}`), orderedFrom: form.get(`from_${i}`), customer: form.get(`cust_${i}`), customerId: form.get(`cid_${i}`), received: form.has(`got_${i}`), paid: form.has(`paid_${i}`) });
  }
  return rows;
}

export function ordersRoutes(router) {
  let reads = null; // photo reads cost money: a few an hour per person is plenty for a notebook
  router.get('/orders', (ctx) => {
    const { app, who, page } = ctx;
    const q = (ctx.url.searchParams.get('q') ?? '').slice(0, 60);
    const open = ctx.url.searchParams.get('open') === '1';
    const r = app.orders.list(who, { q, open });
    if (r.error) return ctx.forbidden();
    const days = [];
    for (const o of r.orders) {
      if (days.at(-1)?.date !== o.sheet_date) days.push({ date: o.sheet_date, rows: [] });
      days.at(-1).rows.push(o);
    }
    const edit = can(who, 'order.edit');
    const row = (o) => `<tr><td>${esc(o.line_code)}</td><td>${esc(o.part_number)}</td><td>${esc(o.ordered_from)}</td>
      <td>${o.customer_id ? `<a href="/customers/${o.customer_id}">${esc(o.customer_name)}</a>${o.customer_text && o.customer_text !== o.customer_name ? `<small>Written: ${esc(o.customer_text)}</small>` : ''}` : esc(o.customer_text)}</td>
      <td>${edit ? `<form method="post" action="/orders/${o.id}/mark"><input type="hidden" name="field" value="received"><input type="hidden" name="value" value="${o.received ? '0' : '1'}"><button class="${o.received ? 'btn primary' : 'btn'}" aria-pressed="${o.received ? 'true' : 'false'}">${o.received ? 'Got it' : 'Waiting'}</button></form>` : (o.received ? 'Got it' : 'Waiting')}</td>
      <td>${edit ? `<form method="post" action="/orders/${o.id}/mark"><input type="hidden" name="field" value="paid"><input type="hidden" name="value" value="${o.paid ? '0' : '1'}"><button class="${o.paid ? 'btn primary' : 'btn'}" aria-pressed="${o.paid ? 'true' : 'false'}">${o.paid ? 'Paid' : 'Unpaid'}</button></form>` : (o.paid ? 'Paid' : 'Unpaid')}</td>
      <td>${can(who, 'order.scan') ? `<form method="post" action="/orders/${o.id}/remove"><button class="link" aria-label="Remove this order">Remove</button></form>` : ''}</td></tr>`;
    return ctx.send('Orders', `<div class="head"><h1>Special orders</h1><div class="row">${can(who, 'order.scan') ? '<a class="btn primary" href="/orders/scan">Scan a page</a>' : ''}</div></div>
      <form method="get" action="/orders" class="search" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Customer, part number, supplier" aria-label="Search orders"><label class="inline"><input type="checkbox" name="open" value="1"${open ? ' checked' : ''}> Still waiting</label><button type="submit">Search</button></form>
      ${days.length ? days.map((d) => `<section class="panel stack"><h2>${esc(niceDate(d.date))}</h2><div class="scroll-x"><table class="grid compact orders"><thead><tr><th>Line</th><th>Part number</th><th>Ordered from</th><th>Customer</th><th>Status</th><th>Payment</th><th></th></tr></thead><tbody>${d.rows.map(row).join('')}</tbody></table></div></section>`).join('') : `<section class="panel"><p class="muted">${q || open ? 'Nothing matches.' : 'No orders yet. Scan a page of the notebook to bring them in.'}</p></section>`}`, { active: 'orders', live: false });
  });

  router.post('/orders/:id/mark', (ctx) => {
    const field = ctx.form.get('field');
    if (!['received', 'paid'].includes(field)) return ctx.redirect('/orders', { problem: say('type') });
    const r = ctx.app.orders.mark(ctx.who, Number(ctx.params.id), { [field]: ctx.form.get('value') === '1' });
    if (r.error === 'forbidden') return ctx.forbidden();
    return ctx.redirect(`/orders${ctx.form.get('back') ? `?${ctx.form.get('back')}` : ''}`, r.error ? { problem: words(r.error) } : {});
  });
  router.post('/orders/:id/remove', (ctx) => {
    const r = ctx.app.orders.remove(ctx.who, Number(ctx.params.id));
    if (r.error === 'forbidden') return ctx.forbidden();
    return ctx.redirect('/orders', r.error ? { problem: words(r.error) } : { done: 'Removed.' });
  });

  router.get('/orders/scan', (ctx) => {
    if (!can(ctx.who, 'order.scan')) return ctx.forbidden();
    const on = ctx.app.orders.enabled();
    return ctx.send('Scan a page', `<div class="head"><h1>Scan a page</h1><a class="btn" href="/orders">Back</a></div>
      <section class="panel stack">${on ? `<p>Take a photo of a page from the order notebook, flat and in good light, with the whole page in the frame. The AI reads it and you check every line before anything is saved.</p>
        <p class="muted">The photo is sent to the AI service to be read. It isn’t kept here, and the page it shows may include customers’ names.</p>
        <label class="upload">Take or choose a photo<input type="file" id="sheet-file" accept="image/*" capture="environment" data-read="/orders/read"></label>
        <p class="muted" id="sheet-status" role="status"></p><img id="sheet-preview" class="sheet-preview" alt="The page you chose" hidden>
        <p class="phone-hint">On a computer? <a class="btn" href="/phone?to=/orders/scan">Use my phone’s camera</a></p>` : `<p class="flash problem" role="alert">The page reader needs the AI, and the AI isn’t switched on, so there is no camera button yet.</p>
        <p>${ctx.who.roles.includes('owner') ? 'Open <a href="/system">System check</a> to see what is missing and test it.' : 'Ask the owner to open System check.'}</p>`}</section>
      <section id="sheet-review"></section>`, { active: 'orders', script: on ? '<script src="/assets/orders.js" defer></script>' : '' });
  });

  // The picture arrives as the picture itself. The reply is the review form, already escaped, to drop into the page.
  router.post('/orders/read', async (ctx) => {
    if (!can(ctx.who, 'order.scan')) return ctx.json({ error: 'forbidden', message: say('forbidden') }, 403);
    reads ??= createLimiter({ max: 15, windowMs: 3_600_000, now: ctx.now });
    if (!reads.take(ctx.who.email)) return ctx.json({ error: 'slow-down', message: 'That’s a lot of pages in an hour. Try again later.' }, 429);
    const r = await ctx.app.orders.read(ctx.who, ctx.raw);
    if (r.error) return ctx.json({ error: r.error, message: r.message ?? words(r.error) }, r.error === 'forbidden' ? 403 : r.error.startsWith('ai-') ? 502 : 400);
    return ctx.json({ ok: true, html: reviewHtml(r.sheet) });
  });

  router.post('/orders/save', (ctx) => {
    const r = ctx.app.orders.save(ctx.who, { date: ctx.form.get('date'), rows: rowsFrom(ctx.form) });
    if (r.error === 'forbidden') return ctx.forbidden();
    if (r.error) return ctx.redirect('/orders/scan', { problem: words(r.error) });
    return ctx.redirect('/orders', { done: `Saved ${r.saved} order${r.saved === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped (already saved or empty)` : ''}.` });
  });
}
