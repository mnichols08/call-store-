// Measurements, photos and the private customer link, on a call. Works without JavaScript except
// picture upload, which needs it to shrink the photo first.
import { esc, ago } from '../html.js';
import { say } from '../ui.js';
import { can } from '../../domain/permissions.js';
import { PART_TYPES } from '../../domain/measure.js';
import { LIMITS } from '../../app/details.js';

/** The part-type chips and the fields for one type. Shared by staff and the customer page. */
export function measureForm({ action, type, unit, values = {}, note = '', baseUrl, submit = 'Save', extra = '' }) {
  const chips = Object.entries(PART_TYPES).map(([key, t]) => `<a class="chip${key === type ? ' on' : ''}" href="${baseUrl}${baseUrl.includes('?') ? '&' : '?'}type=${key}"${key === type ? ' aria-current="true"' : ''}>${esc(t.label)}</a>`).join('');
  const spec = PART_TYPES[type];
  if (!spec) return `<p class="muted">What is it?</p><div class="chips">${chips}</div>`;
  const u = unit === 'in' ? 'in' : 'mm';
  const fields = spec.fields.map((f) => (f.kind === 'choice'
    ? `<label>${esc(f.label)}<select name="f_${f.key}"><option value="">Choose…</option>${f.options.map((o) => `<option${values[f.key]?.text === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`
    : `<label>${esc(f.label)}<input name="f_${f.key}" value="${esc(values[f.key]?.text ?? '')}" ${f.kind === 'text' ? '' : 'inputmode="decimal"'} maxlength="40" autocomplete="off"></label>`)).join('');
  return `<div class="chips">${chips}</div><p class="muted">${esc(spec.help)}</p>
    <form method="post" action="${action}" class="stack"><input type="hidden" name="type" value="${type}">
    ${spec.fields.some((f) => f.kind === 'length') ? `<fieldset class="units"><legend>Measured in</legend><label><input type="radio" name="unit" value="mm"${u === 'mm' ? ' checked' : ''}> millimetres</label><label><input type="radio" name="unit" value="in"${u === 'in' ? ' checked' : ''}> inches</label></fieldset>` : '<input type="hidden" name="unit" value="mm">'}
    <div class="two">${fields}</div>
    <label>Anything else (numbers stamped on it, where it goes)<textarea name="note" rows="2" maxlength="${LIMITS.note}">${esc(note)}</textarea></label>${extra}<button class="btn primary">${esc(submit)}</button></form>`;
}

/**
 * The customer's part helper (a small Svelte island). The plain form and upload box inside are what a
 * browser without JavaScript sees; the island replaces them. `photos` is `[{ id, src }]` the customer can already see.
 */
export function partHelper({ base, assist, photos = [], count = photos.length, type = '', unit = 'mm', values = {}, note = '', saved = false, problem = false }) {
  const flat = Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, v?.text ?? '']));
  const config = { base, assist: Boolean(assist), limit: LIMITS.photos, count, photos, initial: { type, unit, values: flat, note }, saved };
  const upload = count < LIMITS.photos
    ? `<label class="upload">Add a photo<input type="file" accept="image/*" capture="environment" data-upload="${base}/photo" data-after="reload" multiple></label><p class="muted" data-upload-status role="status"></p>`
    : '<p class="muted">That’s the most photos we can take.</p>';
  return `<link rel="stylesheet" href="/assets/islands/part-helper.css">
<div id="part-helper" data-config="${esc(JSON.stringify(config))}">
<section class="panel stack"><h2>What is it?</h2>${measureForm({ action: `${base}/details`, type, unit, values, note, baseUrl: base, submit: 'Send measurements' })}</section>
<section class="panel stack"><h2>Photos</h2><p class="muted">The part itself, any numbers stamped on it, and the old part next to a ruler. Please keep people and license plates out of the picture.</p>${photoGrid(photos, { src: (p) => p.src })}${upload}<p class="muted">${count} of ${LIMITS.photos} photos sent.</p></section>
</div>
<script src="/assets/islands/part-helper.js" type="module"></script>`;
}

export const photoGrid = (photos, { src, removeAction = null }) => (photos.length ? `<ul class="photos">${photos.map((p, i) => `<li><a href="${src(p)}" target="_blank" rel="noopener"><img src="${src(p)}" alt="Photo ${i + 1}${p.source === 'customer' ? ' from the customer' : ''}" loading="lazy"></a>
  ${removeAction ? `<form method="post" action="${removeAction(p)}"><button class="link" aria-label="Remove photo ${i + 1}">Remove</button></form>` : ''}</li>`).join('')}</ul>` : '');

export function detailsRoutes(router) {
  router.post('/calls/:id/details', (ctx) => {
    const id = Number(ctx.params.id);
    const f = ctx.form;
    const r = ctx.app.details.save(ctx.who, id, { type: f.get('type') ?? '', unit: f.get('unit') ?? 'mm', note: f.get('note') ?? '', get: (k) => f.get(k) ?? '' });
    return ctx.redirect(`/calls/${id}${r.ok ? `?dtype=${encodeURIComponent(f.get('type') ?? '')}` : ''}#details`, r.error ? { problem: r.error === 'measure' ? 'A measurement doesn’t look right. Use numbers like 25, 25.4 or 1/2.' : say(r.error) } : { done: 'Saved.' });
  });

  // Picture upload: the body is the image itself (the page shrinks it first), so it isn't a form.
  router.post('/calls/:id/photos', (ctx) => {
    const r = ctx.app.details.addPhoto(ctx.who, Number(ctx.params.id), ctx.raw);
    return ctx.json(r, r.error ? (r.error === 'forbidden' ? 403 : 400) : 200);
  });
  router.get('/calls/:id/photos/:pid', (ctx) => {
    const r = ctx.app.details.photo(ctx.who, Number(ctx.params.id), Number(ctx.params.pid));
    if (r.error) return ctx.notFound();
    ctx.res.writeHead(200, { 'content-type': r.mime, 'content-length': r.bytes.length, 'cache-control': 'private, max-age=3600', 'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' });
    return ctx.res.end(r.bytes);
  });
  router.post('/calls/:id/photos/:pid/remove', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.details.removePhoto(ctx.who, id, Number(ctx.params.pid));
    return ctx.redirect(`/calls/${id}#details`, r.error ? { problem: say(r.error) } : { done: 'Photo removed.' });
  });

  // Make a link. The address is shown on this page once; only a hash of it is kept.
  router.post('/calls/:id/details/link', (ctx) => {
    const id = Number(ctx.params.id);
    const r = ctx.app.details.createLink(ctx.who, id);
    if (r.error) return ctx.redirect(`/calls/${id}#details`, { problem: say(r.error) });
    const origin = ctx.config.publicUrl || `${ctx.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${ctx.req.headers.host}`;
    const link = `${origin.replace(/\/$/, '')}/d/${r.token}`;
    return ctx.send('Link for the customer', `<div class="head"><h1>Link for the customer</h1><a class="btn" href="/calls/${id}#details">Back to the call</a></div>
      <section class="panel stack"><p>Send this to the customer. It opens a page where they can give measurements and send photos. It works for ${LIMITS.linkHours} hours, only for this request.</p>
      <label>Link<input id="the-link" readonly value="${esc(link)}" size="60"></label><div class="row"><button class="btn primary" type="button" data-copy="the-link">Copy link</button><a class="btn" href="sms:?&body=${encodeURIComponent(`Please send us details here: ${link}`)}">Text it</a></div>
      <p class="muted">This is the only time the link is shown. Make another if you need to.</p></section>`, { active: 'calls', script: '<script src="/assets/details.js" defer></script>' });
  });
  router.post('/calls/:id/details/link/revoke', (ctx) => {
    const id = Number(ctx.params.id);
    ctx.app.details.revokeLinks(ctx.who, id);
    return ctx.redirect(`/calls/${id}#details`, { done: 'The link no longer works.' });
  });

  // Staff confirm which part those measurements are, and the shop remembers.
  router.post('/calls/:id/details/teach', (ctx) => {
    const id = Number(ctx.params.id);
    const d = ctx.app.details.get(ctx.who, id);
    if (d.error || !d.details?.key) return ctx.redirect(`/calls/${id}#details`, { problem: 'Fill in all the measurements first.' });
    const r = ctx.app.parts.teach(ctx.who, { vehicle: {}, generic: true, term: d.details.key, brand: ctx.form.get('brand') ?? '', partNumber: ctx.form.get('part_number') ?? '', description: ctx.form.get('description') || `${PART_TYPES[d.details.type].label}, ${d.details.text}` });
    return ctx.redirect(`/calls/${id}#details`, r.error ? { problem: say(r.error) } : { done: 'Saved. Anyone with these measurements will see it first.' });
  });
}

export function detailsPanel(ctx, got, closed) {
  if (!can(ctx.who, 'call.view')) return '';
  const id = got.call.id;
  const d = ctx.app.details.get(ctx.who, id);
  if (d.error) return '';
  const type = ctx.url.searchParams.get('dtype') || d.details?.type || '';
  const saved = d.details && d.details.type === type ? d.details : null;
  const editable = !closed && can(ctx.who, 'call.edit');
  const summary = d.details ? `<p><strong>${esc(PART_TYPES[d.details.type]?.label ?? '')}</strong>${d.details.text ? `: ${esc(d.details.text)}` : ''}${d.details.note ? `<br><small>${esc(d.details.note)}</small>` : ''}<br><small class="muted">${d.details.filledBy === 'customer' ? 'From the customer' : 'Entered by staff'} · ${esc(ago(d.details.updatedAt, ctx.now()))}</small></p>` : '<p class="muted">Measurements and photos that save a round of questions. The customer can send them too.</p>';
  const find = d.details?.key && can(ctx.who, 'parts.find') && !closed ? `<form method="post" action="/calls/${id}/parts/find"><input type="hidden" name="measure" value="1"><button class="btn">Find by these measurements</button></form>
    ${can(ctx.who, 'parts.teach') ? `<details><summary>Add the part number these measurements are</summary><form method="post" action="/calls/${id}/details/teach" class="stack"><div class="two"><label>Brand<input name="brand" required></label><label>Part number<input name="part_number" required></label></div><button>Save</button></form></details>` : ''}` : '';
  const photos = photoGrid(d.photos, { src: (p) => `/calls/${id}/photos/${p.id}`, removeAction: editable ? (p) => `/calls/${id}/photos/${p.id}/remove` : null });
  const upload = editable && d.photos.length < LIMITS.photos ? `<label class="upload">Add a photo<input type="file" accept="image/*" capture="environment" data-upload="/calls/${id}/photos" multiple></label><p class="muted" data-upload-status role="status"></p>` : '';
  const link = editable ? `<form method="post" action="/calls/${id}/details/link"><button class="btn">Make a link for the customer</button></form>${d.links.active ? `<p class="muted">${d.links.active} active ${d.links.active === 1 ? 'link' : 'links'}${d.links.opened ? ', opened' : ', not opened yet'}.</p><form method="post" action="/calls/${id}/details/link/revoke"><button class="link">Turn the links off</button></form>` : ''}` : '';
  return `<section class="panel stack" id="details"><h2>Details and photos</h2>${summary}${editable ? `<details${type ? ' open' : ''}><summary>${d.details ? 'Change' : 'Enter'} measurements</summary>${measureForm({ action: `/calls/${id}/details`, type, unit: saved?.unit ?? d.details?.unit, values: saved?.values, note: saved?.note ?? '', baseUrl: `/calls/${id}` })}</details>` : ''}${find}${photos}${upload}${link}</section>`;
}
