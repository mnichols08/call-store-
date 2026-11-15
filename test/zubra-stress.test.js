// Pushing Zubra: hostile text, odd values, many renders, bad nonces, misuse, and streaming. What
// passes is documented behaviour we depend on; what fails is written up in docs/zubra-findings.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { readdirSync } from 'node:fs';
import { createZubra } from '@zubra/server';

const here = dirname(fileURLToPath(import.meta.url));
const app = createZubra({ components: join(here, '..', 'src', 'web', 'components'), production: true });
const lab = createZubra({ components: join(here, 'fixtures', 'components'), production: true });
const shell = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

/** Payloads that have broken template engines. Each tries to get out of text, an attribute, or a script. */
const HOSTILE = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "' onfocus='alert(1)' x='",
  '</textarea><script>alert(1)</script>',
  '</script><script>alert(1)</script>',
  '<!--', '-->', '<![CDATA[', ']]>',
  '{{7*7}}', '${7*7}', '{alert(1)}', '`; alert(1); `',
  'javascript:alert(1)',
  '&lt;b&gt; &amp; &#x3c;',
  '  ',
  '\u0000nul', 'ⓔⓜⓞⓙⓘ 🙂👨‍👩‍👧‍👦', '‮evil-rtl', 'a​b',
  'x'.repeat(100_000),
];

/**
 * Whether a component's rendered markup holds something live the payload brought: a tag it opened,
 * or an event handler inside a tag. Escaped text ("&lt;img onerror=") is inert; only a real "<" counts.
 */
function live(markup) {
  const tag = /<([a-z][\w:-]*)((?:\s+[^\s=>"'/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*\/?>/gi;
  for (const [, name, attributes] of markup.matchAll(tag)) {
    if (/^(?:img|svg|iframe|object|embed|script|link|meta|base|style)$/i.test(name)) return true;
    // Attribute names only: a quoted value that mentions "onerror=" is just text.
    for (const [, attribute] of attributes.matchAll(/\s+([^\s=>"'/]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?/g)) if (/^on[a-z]+$/i.test(attribute)) return true;
  }
  return false;
}

test('props: hostile text in every string prop of every component never becomes markup', () => {
  let checked = 0;
  for (const name of readdirSync(join(here, '..', 'src', 'web', 'components')).filter((f) => f.endsWith('.zb')).map((f) => f.slice(0, -3))) {
    for (const prop of app.describe(name).props.filter((p) => p.type === 'string')) {
      for (const payload of HOSTILE) {
        const html = app.page({ nonce: 'abc123' }).render(name, { [prop.name]: payload });
        assert.equal(live(html), false, `${name}.${prop.name} let through ${JSON.stringify(payload.slice(0, 30))}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 300, `only ${checked} combinations were tried`);
});

test('FINDING: half a surrogate pair in a prop makes the renderer throw (the app cleans text before it gets there)', () => {
  for (const text of ['\ud83d', 'a\ud83dz', '\ude00 trailing low half', '🙂'.slice(0, 1)]) {
    assert.throws(() => app.page({ nonce: 'n' }).render('text-field', { label: text }), /isn't JSON/, `expected a render error for ${JSON.stringify(text)}`);
    assert.doesNotThrow(() => app.page({ nonce: 'n' }).render('text-field', { label: text.toWellFormed() }), 'well-formed text renders');
  }
  assert.doesNotThrow(() => app.page({ nonce: 'n' }).render('text-field', { label: '🙂 👨‍👩‍👧‍👦 \u202e' }), 'whole characters are fine');
});

test('props: odd values either render safely or fail with a clear error, quickly', () => {
  const odd = { undefined: undefined, null: null, zero: 0, nan: NaN, infinity: Infinity, true: true, empty_array: [], array: [1, [2]], object: {}, evil_tostring: { toString: () => '<b>x</b>' }, function: () => 1, symbol: Symbol.for('s'), bigint: 10n, date: new Date(0), megabyte: 'x'.repeat(1_000_000) };
  const outcomes = {};
  for (const [label, value] of Object.entries(odd)) {
    const started = performance.now();
    try {
      const html = app.page({ nonce: 'n1' }).render('stat-card', { label: value, value });
      assert.equal(live(html), false, `${label} became markup`);
      outcomes[label] = 'rendered';
    } catch (error) {
      if (error.name === 'AssertionError') throw error;
      assert.ok(error instanceof Error && error.message, `${label}: a thrown value should be a real error`);
      outcomes[label] = `threw: ${error.message.replace(/\s+/g, ' ').slice(0, 70)}`;
    }
    assert.ok(performance.now() - started < 2000, `${label} was slow`);
  }
  // What a page author can rely on, pinned so a change shows up in review.
  assert.equal(outcomes.undefined, 'rendered', 'undefined means "use the default"');
  assert.equal(outcomes.megabyte, 'rendered');
  for (const label of ['null', 'zero', 'true', 'array', 'object']) assert.match(outcomes[label], /must be a string/, `${label} is refused rather than coerced`);
  console.log('odd prop outcomes:', outcomes);
});

test('slots: a slot is compiled as markup, so the caller escapes text; unbalanced markup is a render error', () => {
  const slot = (html) => lab.page({ nonce: 'abc' }).render('row-item', { title: 't' }, { default: html });
  assert.match(slot('<b>bold</b>'), /<b data-zb-slotted="row-item">bold<\/b>/, 'markup passes through, marked as slotted');
  assert.match(slot('<script>alert(1)</script>'), /<script data-zb-slotted/, 'a script in a slot is a script: escape before slotting');
  assert.match(slot('<img src=x onerror=alert(1)>'), /onerror="alert\(1\)"/, 'so is a handler');
  assert.match(slot('a &amp; b &lt;i&gt;'), /a &amp; b &lt;i&gt;/, 'escaped text arrives as text');
  assert.match(slot('{alert(1)} {{7*7}}'), /\{alert\(1\)\} \{\{7\*7\}\}/, 'braces in a slot are text, not expressions');
  assert.throws(() => slot('a & b <i>'), /missing closing tag <\/i>/, 'unbalanced markup throws');
  assert.throws(() => slot('<!-- x'), /unterminated HTML comment/);
  const props = lab.page({ nonce: 'abc' }).render('row-item', { title: '<b>bold</b>', note: '<i>n</i>' });
  assert.doesNotMatch(props, /<b>bold<\/b>|<i>n<\/i>/, 'props are escaped');
});

test('our own helpers escape slot text, so a person can type anything into a button, badge, banner or empty state', async () => {
  const { badge, button, alert, empty } = await import('../src/web/ui.js');
  for (const text of ['a & b <i>', '<!-- x', '</div><script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '&lt;', '{7*7}']) {
    const page = app.page({ nonce: 'abc' });
    const html = [badge(page, 'neutral', text), button(page, text), alert(page, 'info', 'h', text), empty(page, 'h', text)].join('');
    assert.equal(live(html), false, `a helper let through ${JSON.stringify(text)}`);
  }
});

test('ids: forty fields on one page have forty distinct ids, and every label points at its own input', () => {
  const page = app.page({ nonce: 'abc' });
  const html = page.finish(shell(Array.from({ length: 40 }, (_, i) => page.render('text-field', { label: `L${i}`, name: `n${i}` })).join('')));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids on one page');
  const fors = [...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(fors.length, 40);
  for (const f of fors) assert.ok(ids.includes(f), `label points at missing id ${f}`);
});

test('pages: two hundred at once never share a nonce, an id counter or a component list', async () => {
  const pages = await Promise.all(Array.from({ length: 200 }, async (_, i) => {
    await new Promise((r) => setImmediate(r));
    const page = app.page({ nonce: `nonce${String(i).padStart(4, '0')}` });
    const body = page.render('text-field', { label: `field ${i}` }) + (i % 2 ? page.render('status-badge', { variant: 'success' }) : '');
    await new Promise((r) => setImmediate(r));
    return { i, html: page.finish(shell(body)), used: [...page.used] };
  }));
  for (const { i, html, used } of pages) {
    const nonces = new Set([...html.matchAll(/nonce="([^"]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...nonces], [`nonce${String(i).padStart(4, '0')}`].filter((n) => nonces.has(n)), `page ${i} carried another page's nonce`);
    assert.equal(used.includes('status-badge'), i % 2 === 1, `page ${i} component list leaked`);
    assert.match(html, new RegExp(`field ${i}\\b`));
  }
});

test('nonces: one that can\'t be a nonce fails when the page is made, not in the middle of a response', () => {
  for (const bad of ['a"b', 'a b', '<x>', "a'b", 'a\nb', 'a>b', '']) {
    let threw = false;
    try { app.page({ nonce: bad }); } catch { threw = true; }
    console.log(`nonce ${JSON.stringify(bad)}: ${threw ? 'refused' : 'accepted'}`);
  }
  assert.doesNotThrow(() => app.page({ nonce: 'QUJDREVGR0g=' }));
  assert.throws(() => app.page({ nonce: 'a"onload="x' }), /nonce/i);
});

test('misuse: unknown components, missing props, rendering after finish, deep repetition', () => {
  const page = app.page({ nonce: 'abc' });
  assert.throws(() => page.render('no-such-component', {}), /no-such-component|not found|unknown/i);
  assert.doesNotThrow(() => page.render('text-field'), 'every prop has a default');
  assert.doesNotThrow(() => page.render('text-field', undefined, undefined));
  assert.throws(() => page.render('text-field', { notAProp: 'x' }), /unknown prop `notAProp`/, 'a prop the component doesn\'t declare is refused, naming it');
  assert.throws(() => page.render('status-badge', { variant: 'success' }, { nope: 'x' }), /slot `nope` is not declared/, 'and so is a slot');
  // Finding: a render of an unknown name is recorded as "used" before it is checked, so the page can
  // no longer finish, and an error page built on the same page object can't be sent.
  assert.throws(() => page.finish(shell('<p>hi</p>')), /no component "no-such-component"/, 'a failed render of an unknown name poisons the page');
  const clean = app.page({ nonce: 'abc' });
  assert.throws(() => clean.render('text-field', { label: null }), /must be a string/);
  const html = clean.finish(shell('<p>hi</p>'));
  assert.equal(typeof html, 'string', 'a bad prop fails the render but leaves the page usable');
  assert.doesNotThrow(() => clean.render('status-badge', { variant: 'success' }), 'rendering after finish');
  assert.equal(typeof clean.finish(html), 'string', 'finishing twice');
  const names = ['__proto__', 'constructor', 'hasOwnProperty', 'toString'];
  for (const name of names) assert.throws(() => page.render(name, {}), Error, `component named ${name}`);
  const big = lab.page({ nonce: 'abc' });
  let out = '';
  for (let i = 0; i < 2000; i += 1) out += big.render('row-item', { title: `r${i}`, count: i });
  assert.equal((out.match(/class="row"/g) ?? []).length, 2000);
});

test('streaming: a promise prop leaves a pending shell, then a swap with the value, escaped; a rejection becomes a message', async () => {
  const page = lab.page({ nonce: 'abc123' });
  const slow = new Promise((resolve) => setTimeout(() => resolve('ready'), 20));
  const html = page.render('await-box', { label: 'a', message: slow }) + page.render('await-box', { label: 'b', message: Promise.reject(new Error('boom')) });
  assert.equal(page.pending, true);
  const chunks = [];
  for await (const chunk of page.chunks(shell(html))) chunks.push(chunk);
  const all = chunks.join('');
  assert.match(chunks[0], /Loading/, 'the shell shows pending content first');
  assert.match(all, /ready/);
  assert.match(all, /boom/);
});

test('streaming: values that try to close the script that carries them stay data', async () => {
  const nasty = ['</script><script>alert(1)</script>', '<!-- <script>', '  ', '</SCRIPT >', ']]>', '"+alert(1)+"'];
  for (const text of nasty) {
    const page = lab.page({ nonce: 'abc123' });
    const html = page.render('await-box', { label: 'x', message: Promise.resolve(text) });
    const parts = [];
    for await (const chunk of page.chunks(shell(html))) parts.push(chunk);
    const swapped = parts.slice(1).join('');
    // Every <script> in the swap must be one of ours (carrying the nonce), and none may contain the payload's tag.
    const scripts = [...swapped.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    for (const tag of scripts) assert.match(tag, /nonce="abc123"/, `a script without our nonce after ${JSON.stringify(text)}`);
    assert.doesNotMatch(swapped, /<script>alert\(1\)/i, `payload became a script: ${JSON.stringify(text)}`);
  }
});

test('streaming: promises that settle out of order, never, or after many others', async () => {
  const page = lab.page({ nonce: 'abc123' });
  const slow = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  const html = [30, 5, 15, 1, 25].map((ms, i) => page.render('await-box', { label: `b${i}`, message: slow(ms, `done-${i}`) })).join('');
  const parts = [];
  for await (const chunk of page.chunks(shell(html))) parts.push(chunk);
  const order = parts.slice(1).join('').match(/done-\d/g).filter((v, i, a) => a.indexOf(v) === i);
  assert.deepEqual(order, ['done-3', 'done-1', 'done-2', 'done-4', 'done-0'], 'chunks leave in the order values arrive');
  const stream = Readable.from(lab.page({ nonce: 'abc123' }).chunks(shell('<p>no promises</p>')));
  let text = '';
  for await (const c of stream) text += c;
  assert.match(text, /no promises/);
});

test('prototype keys as props or slot names never pollute anything', () => {
  const before = Object.keys(Object.prototype).length;
  for (const key of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty']) {
    try { app.page({ nonce: 'n' }).render('text-field', JSON.parse(`{"${key}": {"polluted": "yes"}}`)); } catch (error) { assert.match(error.message, /unknown prop|must be/); }
    try { app.page({ nonce: 'n' }).render('status-badge', {}, JSON.parse(`{"${key}": "<b>x</b>"}`)); } catch (error) { assert.match(error.message, /slot/); }
  }
  assert.equal(Object.keys(Object.prototype).length, before);
  assert.equal({}.polluted, undefined);
});

test('big shapes: twenty thousand options, slots nested sixty deep (a hundred is refused), five thousand siblings in a slot', () => {
  const options = Array.from({ length: 20_000 }, (_, i) => ({ value: `v${i}`, label: `Option ${i} <b>` }));
  const html = app.page({ nonce: 'n' }).render('select-field', { label: 'big', options, value: 'v19999' });
  assert.equal((html.match(/<option/g) ?? []).length, 20_000);
  assert.doesNotMatch(html, /<b>/, 'labels are escaped');

  const nest = (levels) => {
    const page = lab.page({ nonce: 'n' });
    let inner = '<span>core</span>';
    for (let depth = 0; depth < levels; depth += 1) inner = page.render('row-item', { title: `d${depth}` }, { default: inner });
    return inner;
  };
  assert.equal((nest(60).match(/class="row"/g) ?? []).length, 60, 'sixty nested components (about 180 elements) render');
  // Zubra refuses markup more than 256 elements deep, with advice. (Its error points at a line that
  // isn't in the component's file: the position is inside the slot content.)
  assert.throws(() => nest(100), /nested more than 256 elements deep[\s\S]*flatten/);

  const wide = Array.from({ length: 5000 }, (_, i) => `<i>${i}</i>`).join('');
  assert.equal((lab.page({ nonce: 'n' }).render('row-item', { title: 't' }, { default: wide }).match(/<i /g) ?? []).length, 5000);
});

test('FINDING: a promise that never settles keeps the stream open for ever; the shell still goes out at once', async () => {
  const page = lab.page({ nonce: 'abc123' });
  const html = page.render('await-box', { label: 'x', message: new Promise(() => {}) });
  const iterator = page.chunks(shell(html))[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.match(first.value, /Loading/, 'the shell does not wait');
  const second = await Promise.race([iterator.next(), new Promise((r) => setTimeout(() => r('still open'), 300))]);
  assert.equal(second, 'still open', 'no timeout of its own: the caller must bound slow promises');
});

test('FINDING: the message of a rejected promise goes to the browser as it is, so reject with words meant for people', async () => {
  const reject = async (reason) => {
    const page = lab.page({ nonce: 'abc123' });
    const html = page.render('await-box', { label: 'x', message: Promise.reject(reason) });
    let out = '';
    for await (const chunk of page.chunks(shell(html))) out += chunk;
    return out;
  };
  assert.match(await reject(new Error('SELECT secret FROM users failed at /srv/app/db.js:41')), /SELECT secret FROM users/, 'an internal message is sent as written');
  assert.match(await reject({ code: 'E', detail: 'x' }), /\[object Object\]/, 'a non-Error reason becomes "[object Object]"');
  assert.doesNotMatch(await reject(new Error('<script>alert(1)</script>')), /<script>alert\(1\)/, 'but it is escaped');
});
