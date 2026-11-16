// What a customer sees through a private link: no sign-in, no staff screens, nothing about the shop's
// other work. They can give measurements, send photos and add a note, for one request, for two days.
import { esc } from './html.js';
import { layout } from './ui.js';
import { partHelper } from './pages/details.js';
import { createLimiter } from './limiter.js';

const sentOnce = (text) => `<p class="flash done" role="status">${esc(text)}</p>`;

export function createCustomerPages({ app, config, zubra, now }) {
  const any = createLimiter({ max: 60, windowMs: 60_000, now });
  const uploads = createLimiter({ max: 15, windowMs: 60_000, now });
  const bad = createLimiter({ max: 15, windowMs: 5 * 60_000, now }); // wrong links, per address

  function page(res, nonce, status, title, body, script = '') {
    const p = zubra.page({ nonce });
    const html = p.finish(layout({ title, who: null, body, business: config.business, script, customer: true }));
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': res.csp, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' });
    res.end(html);
  }
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };

  return {
    handle(req, res, url, { token, action, posting, form, raw, nonce, ip }) {
      if (!any.take(ip)) return json(res, 429, { error: 'slow-down' });
      const v = app.details.viaLink(token);
      if (v.error) {
        if (!bad.take(ip)) return json(res, 429, { error: 'slow-down' });
        return page(res, nonce, 404, 'Link not working', `<div class="head"><h1>This link isn’t working</h1></div><section class="panel"><p>It may have expired or been replaced. Please call ${esc(config.business)} and we’ll sort it out.</p></section>`);
      }
      if (posting && action === 'photo') {
        if (!uploads.take(ip)) return json(res, 429, { error: 'slow-down' });
        const r = app.details.customerPhoto(token, raw);
        return json(res, r.error ? 400 : 200, r);
      }
      if (posting && action === 'assist') {
        if (!uploads.take(ip)) return json(res, 429, { error: 'slow-down' });
        return app.details.assistViaLink(token).then((r) => json(res, r.error ? (r.error === 'slow-down' ? 429 : 400) : 200, r));
      }
      if (posting && action === 'details') {
        const r = app.details.customerSave(token, { type: form.get('type') ?? '', unit: form.get('unit') ?? 'mm', note: form.get('note') ?? '', get: (k) => form.get(k) ?? '' });
        if (req.headers.accept?.includes('application/json')) return json(res, r.ok ? 200 : 400, r.ok ? { ok: true } : { error: r.error, fields: r.fields ?? [] });
        const back = `/d/${token}`;
        res.writeHead(303, { location: r.ok ? `${back}?saved=1` : `${back}?type=${encodeURIComponent(form.get('type') ?? '')}&problem=1`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        return res.end();
      }
      if (posting) return json(res, 404, { error: 'missing' });

      app.details.markOpened(token);
      const q = url.searchParams;
      const d = v.details;
      const type = q.get('type') || d?.type || '';
      const saved = d && d.type === type ? d : null;
      const body = `<div class="head"><h1>Help us get the right part</h1></div>
        <section class="panel stack"><p>${esc(config.business)} is working on your request. A few measurements and photos can save us a phone call. Anything you can send helps, and you can come back to this page for 2 days.</p>
        ${q.get('saved') ? sentOnce('Thank you. We’ve got it.') : ''}${q.get('problem') ? '<p class="flash problem" role="alert">A measurement doesn’t look right. Use numbers like 25, 25.4 or 1/2.</p>' : ''}</section>
        ${partHelper({ base: `/d/${token}`, assist: app.details.assistEnabled(), count: v.photos, type, unit: saved?.unit, values: saved?.values, note: saved?.note ?? '', saved: Boolean(q.get('saved')) })}`;
      return page(res, nonce, 200, 'Send details', body, '<script src="/assets/details.js" defer></script>');
    },
  };
}
