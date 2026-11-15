// Pushes Zubra's server rendering: big pages, many at once, heavy streaming, and a leak check.
// Run with `npm run stress`. Numbers are for this machine; what matters is the shape (does time
// grow in a straight line? does memory come back?).
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';

const here = dirname(fileURLToPath(import.meta.url));
const app = createZubra({ components: join(here, '..', 'src', 'web', 'components'), production: true });
const lab = createZubra({ components: join(here, '..', 'test', 'fixtures', 'components'), production: true });
const shell = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const ms = (n) => `${n.toFixed(0)} ms`;
const gc = () => globalThis.gc?.();
const time = async (fn) => { const t = performance.now(); const out = await fn(); return [performance.now() - t, out]; };
const rows = [];
const report = (name, detail) => { rows.push([name, detail]); console.log(`${name.padEnd(46)} ${detail}`); };

// 1. One page with many component renders: does time grow in a straight line?
for (const n of [100, 1000, 5000, 20000]) {
  const [t, size] = await time(() => {
    const page = lab.page({ nonce: 'abc123' });
    let body = '';
    for (let i = 0; i < n; i += 1) body += page.render('row-item', { title: `Row ${i}`, count: i, note: i % 3 ? '' : 'a note' });
    return page.finish(shell(`<ul>${body}</ul>`)).length;
  });
  report(`row-item × ${n}`, `${ms(t)}  (${(t / n * 1000).toFixed(0)} µs each, ${mb(size)} of HTML)`);
}

// 2. Form-heavy: text fields (each with id() and validation wiring).
for (const n of [200, 2000]) {
  const [t] = await time(() => {
    const page = app.page({ nonce: 'abc123' });
    let body = '';
    for (let i = 0; i < n; i += 1) body += page.render('text-field', { label: `Field ${i}`, name: `f${i}`, value: `v${i}` });
    return page.finish(shell(body)).length;
  });
  report(`text-field × ${n}`, `${ms(t)}  (${(t / n * 1000).toFixed(0)} µs each)`);
}

// 3. A big slot: one component with a very large slotted body.
for (const kb of [10, 100, 1000]) {
  const html = `<p>${'x'.repeat(kb * 1024)}</p>`;
  const [t] = await time(() => lab.page({ nonce: 'abc123' }).render('row-item', { title: 't' }, { default: html }).length);
  report(`slot of ${kb} KB`, ms(t));
}

// 4. Many pages at once (event loop is shared, so this is throughput, not parallelism).
for (const n of [100, 1000]) {
  const [t] = await time(async () => {
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      await new Promise((r) => setImmediate(r));
      const page = app.page({ nonce: `n${i}` });
      return page.finish(shell(page.render('text-field', { label: 'a' }) + page.render('stat-card', { label: 'b', value: String(i) }) + page.render('status-badge', { variant: 'success' }, { default: 'ok' })));
    }));
  });
  report(`${n} whole pages (3 components each)`, `${ms(t)}  (${(n / (t / 1000)).toFixed(0)} pages/s)`);
}

// 5. Streaming: many pending regions resolving in random order.
for (const n of [50, 500]) {
  const [t, out] = await time(async () => {
    const page = lab.page({ nonce: 'abc123' });
    const body = Array.from({ length: n }, (_, i) => page.render('await-box', { label: `b${i}`, message: new Promise((r) => setTimeout(() => r(`done-${i}`), Math.random() * 50)) })).join('');
    let bytes = 0;
    let chunks = 0;
    for await (const chunk of page.chunks(shell(body))) { bytes += chunk.length; chunks += 1; }
    return { bytes, chunks };
  });
  report(`stream ${n} promises`, `${ms(t)}  (${out.chunks} chunks, ${mb(out.bytes)})`);
}

// 6. Leak check: render many pages, collect, see whether the heap returns.
gc();
const before = process.memoryUsage().heapUsed;
for (let round = 0; round < 20; round += 1) {
  for (let i = 0; i < 500; i += 1) {
    const page = app.page({ nonce: `n${i}` });
    page.finish(shell(page.render('text-field', { label: `l${round}-${i}`, value: 'x'.repeat(200) }) + page.render('stat-card', { label: 'b', value: String(i) })));
  }
}
gc();
const after = process.memoryUsage().heapUsed;
report('10,000 pages, heap before → after', `${mb(before)} → ${mb(after)}${globalThis.gc ? '' : '  (run with --expose-gc for a fair reading)'}`);

// 7. Compile cost: first render of each component versus the next.
const fresh = createZubra({ components: join(here, '..', 'src', 'web', 'components'), production: true });
const [first] = await time(() => fresh.page({ nonce: 'n' }).render('text-field', { label: 'a' }));
const [second] = await time(() => fresh.page({ nonce: 'n' }).render('text-field', { label: 'b' }));
report('first render vs second (text-field)', `${ms(first)} vs ${second.toFixed(2)} ms`);
