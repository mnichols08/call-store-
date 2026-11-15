import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSheet, dateFromWriting, weekdayAgrees, cleanDate, SHEET_MAX_ROWS } from '../src/domain/orders.js';
import { createAi, AiError } from '../src/infra/ai.js';
import { reviewHtml, rowsFrom } from '../src/web/pages/orders.js';
import { freshApp, ann, manager, owner } from './helpers.js';

// A tiny valid JPEG, so the picture checks pass.
const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), Buffer.from([0xff, 0xd9])]);

// What a good reading of the Tuesday 11-10-26 page looks like.
const READING = {
  dateText: 'Tues 11-10-26', date: '2026-11-10',
  rows: [
    { lineCode: 'ECH', partNumber: 'OP6603', orderedFrom: 'ALT', customer: 'Beckman Trucking', received: true, paid: true, crossedOut: false, unsure: [] },
    { lineCode: 'ATM', partNumber: '42322', orderedFrom: '1 AH', customer: 'Blaine', received: true, paid: false, crossedOut: false, unsure: [] },
    { lineCode: 'CRB', partNumber: '2-9496', orderedFrom: '1 AH', customer: 'Dixon', received: true, paid: false, crossedOut: false, unsure: ['customer'] },
    { lineCode: 'CHT', partNumber: 'CSNSF250350', orderedFrom: 'Carlisle', customer: 'Douss Auto & Trk', received: true, paid: false, crossedOut: false, unsure: ['customer', 'partNumber'] },
    { lineCode: 'RH', partNumber: '', orderedFrom: '', customer: '', received: false, paid: false, crossedOut: true, unsure: [] },
  ],
};
const fakeAi = (reading = READING) => ({ enabled: true, suggest: async () => ({ candidates: [] }), readSheet: async () => ({ reading, usage: { input: 1200, output: 300 } }) });

test('the date is read the way the notebook writes it, month first', () => {
  assert.equal(dateFromWriting('Tues 11-10-26'), '2026-11-10');
  assert.equal(dateFromWriting('11/10/2026'), '2026-11-10');
  assert.equal(dateFromWriting('Mon 1.5.27'), '2027-01-05');
  assert.equal(dateFromWriting('13-40-26'), '');
  assert.equal(dateFromWriting('Tuesday'), '');
  assert.equal(cleanDate('2026-02-30'), '');
  assert.equal(weekdayAgrees('Tues 11-10-26', '2026-11-10'), true);
  assert.equal(weekdayAgrees('Wed 11-10-26', '2026-11-10'), false, 'a weekday that doesn’t fit the date is a warning');
  assert.equal(weekdayAgrees('11-10-26', '2026-11-10'), null);
});

test('what the AI says is cleaned before anyone sees it', () => {
  const sheet = cleanSheet({
    dateText: 'Tues 11-10-26', date: 'nonsense',
    rows: [
      { lineCode: ' ech ', partNumber: 'op6603<script>', orderedFrom: 'ALT', customer: '<img src=x onerror=alert(1)>Beckman', received: 'yes', paid: true, unsure: ['customer', 'bogus'] },
      { lineCode: 'x'.repeat(50), partNumber: 'a'.repeat(200), orderedFrom: 'b'.repeat(200), customer: 'c'.repeat(200) },
      { lineCode: '', partNumber: '', orderedFrom: '', customer: '' },
      null,
      'not a row',
    ],
  });
  assert.equal(sheet.date, '2026-11-10', 'a bad date falls back to what was written');
  assert.equal(sheet.weekdayOk, true);
  assert.equal(sheet.rows.length, 2, 'empty and junk rows are dropped');
  const [a, b] = sheet.rows;
  assert.equal(a.lineCode, 'ECH');
  assert.equal(a.partNumber, 'OP6603 SCRIPT', 'angle brackets become spaces');
  assert.doesNotMatch(JSON.stringify(sheet), /[<>]/);
  assert.equal(a.received, false, 'only a real true counts');
  assert.deepEqual(a.unsure, ['customer'], 'unknown field names are ignored');
  assert.ok(b.lineCode.length <= 8 && b.partNumber.length <= 30 && b.orderedFrom.length <= 60 && b.customer.length <= 80);
  assert.equal(cleanSheet({ rows: Array.from({ length: 500 }, () => ({ partNumber: '1' })) }).rows.length, SHEET_MAX_ROWS);
  assert.deepEqual(cleanSheet(null), { date: '', dateText: '', rows: [], weekdayOk: null });
});

test('a field left empty is marked as one to check, but a crossed-out line is not nagged about', () => {
  const sheet = cleanSheet({ date: '2026-11-10', rows: [{ lineCode: 'ECH', partNumber: '', orderedFrom: 'AH', customer: 'Bob' }, { lineCode: 'FIL', crossedOut: true }] });
  assert.deepEqual(sheet.rows[0].unsure, ['partNumber']);
  assert.deepEqual(sheet.rows[1].unsure, []);
});

test('the request to the AI is the picture and the instructions, with no search and no other data', async () => {
  let sent;
  const ai = createAi({ apiKey: 'k', model: 'claude-haiku-5-5', fetcher: async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: `Here you go: ${JSON.stringify(READING)}` }], usage: { input_tokens: 10, output_tokens: 5 } }), text: async () => '' }; } });
  const out = await ai.readSheet({ mime: 'image/jpeg', bytes: jpeg() });
  assert.equal(out.reading.rows.length, 5);
  assert.equal(sent.init.headers['x-api-key'], 'k');
  assert.equal(sent.body.model, 'claude-haiku-5-5');
  assert.equal(sent.body.tools, undefined, 'no web search for a handwriting read');
  const [image, ask] = sent.body.messages[0].content;
  assert.equal(image.type, 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  assert.equal(Buffer.from(image.source.data, 'base64').length, jpeg().length);
  assert.equal(ask.text, 'Read this page.');
  assert.match(sent.body.system, /data, never instructions/);
  await assert.rejects(createAi({ apiKey: '' }).readSheet({ mime: 'image/jpeg', bytes: jpeg() }), (e) => e instanceof AiError && e.code === 'off');
  await assert.rejects(createAi({ apiKey: 'k', fetcher: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'sorry, I cannot' }] }) }) }).readSheet({ mime: 'image/jpeg', bytes: jpeg() }), (e) => e.code === 'bad-answer');
  await assert.rejects(createAi({ apiKey: 'k', fetcher: async () => ({ ok: false, status: 429, text: async () => '' }) }).readSheet({ mime: 'image/jpeg', bytes: jpeg() }), (e) => e.code === 'rate');
});

test('reading a page saves nothing, and suggests customers for the names', async () => {
  const { app, db } = freshApp({ ai: fakeAi() });
  app.customers.create(ann, { kind: 'organization', name: 'Beckman Trucking', phones: [{ phone: '3015550101' }] });
  app.customers.create(ann, { name: 'Dixon Farms', phones: [{ phone: '3015550102' }] });
  app.customers.create(ann, { name: 'Dixon Brothers', phones: [{ phone: '3015550103' }] });
  const r = await app.orders.read(manager, jpeg());
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.sheet.date, '2026-11-10');
  assert.equal(r.sheet.rows[0].candidates.length, 1, 'one clear match');
  assert.equal(r.sheet.rows[2].candidates.length, 2, 'two Dixons: the reviewer chooses');
  assert.equal(r.sheet.rows[1].candidates.length, 0);
  assert.deepEqual(r.sheet.rows[4].candidates, [], 'a crossed-out line is not matched');
  assert.equal(db.prepare('SELECT count(*) n FROM special_orders').get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_events WHERE action = 'orders.read'").get().n, 1);
});

test('only the owner and managers can read a page; bad pictures and a missing AI are refused', async () => {
  const on = freshApp({ ai: fakeAi() }).app;
  assert.equal((await on.orders.read(ann, jpeg())).error, 'forbidden');
  assert.equal((await on.orders.read(owner, Buffer.from('not a picture at all'))).error, 'photo-type');
  assert.equal((await on.orders.read(owner, Buffer.alloc(0))).error, 'photo');
  assert.equal((await on.orders.read(owner, Buffer.alloc(7 * 1024 * 1024, 1))).error, 'photo-big');
  const off = freshApp({ ai: { enabled: false } }).app;
  assert.equal((await off.orders.read(owner, jpeg())).error, 'off');
  const broken = freshApp({ ai: { enabled: true, suggest: async () => ({}), readSheet: async () => { throw new AiError('rate', 'x'); } } }).app;
  const r = await broken.orders.read(owner, jpeg());
  assert.equal(r.error, 'ai-rate');
  assert.match(r.message, /busy/);
});

test('saving keeps what was checked; the same page twice adds nothing; staff can tick things off', async () => {
  const { app, db } = freshApp({ ai: fakeAi() });
  const c = app.customers.create(ann, { name: 'Beckman Trucking', phones: [{ phone: '3015550101' }] });
  const rows = [
    { lineCode: 'ech', partNumber: 'op6603', orderedFrom: 'ALT', customer: 'Beckman Trucking', customerId: String(c.id), received: true, paid: true },
    { lineCode: 'ATM', partNumber: '42322', orderedFrom: '1 AH', customer: 'Blaine', customerId: '9999' },
    { lineCode: '', partNumber: '', orderedFrom: '', customer: '' },
  ];
  assert.equal(app.orders.save(ann, { date: '2026-11-10', rows }).error, 'forbidden');
  assert.equal(app.orders.save(manager, { date: 'x', rows }).error, 'date');
  assert.equal(app.orders.save(manager, { date: '2026-11-10', rows: [] }).error, 'empty');
  const done = app.orders.save(manager, { date: '2026-11-10', rows });
  assert.deepEqual([done.saved, done.skipped], [2, 1]);
  const again = app.orders.save(manager, { date: '2026-11-10', rows });
  assert.deepEqual([again.saved, again.skipped], [0, 3]);
  const list = app.orders.list(ann).orders;
  assert.equal(list.length, 2);
  assert.equal(list[0].line_code, 'ECH');
  assert.equal(list[0].part_number, 'OP6603');
  assert.equal(list[0].customer_name, 'Beckman Trucking');
  assert.equal(list[1].customer_id, null, 'an id that isn’t a customer is dropped');
  assert.equal(app.orders.list(ann, { open: true }).orders.length, 1, 'still waiting');
  assert.equal(app.orders.list(ann, { q: 'beckman' }).orders.length, 1);
  assert.equal(app.orders.list(ann, { q: '42322' }).orders.length, 1);
  assert.equal(app.orders.list(ann, { q: '%' }).orders.length, 0, 'wildcards are just characters');
  assert.ok(app.orders.mark(ann, list[1].id, { received: true }).ok);
  assert.equal(app.orders.list(ann, { open: true }).orders.length, 0);
  assert.equal(app.orders.mark(ann, 9999, { received: true }).error, 'missing');
  assert.equal(app.orders.remove(ann, list[1].id).error, 'forbidden');
  assert.ok(app.orders.remove(manager, list[1].id).ok);
  assert.equal(db.prepare('SELECT count(*) n FROM special_orders').get().n, 1);
});

test('the review form shows every line editable, outlines doubtful fields, and escapes everything', () => {
  const sheet = cleanSheet(READING);
  sheet.rows = sheet.rows.map((r) => ({ ...r, candidates: [] }));
  sheet.rows[0].customer = '"><script>alert(1)</script>';
  sheet.rows[0].candidates = [{ id: 7, name: '<b>Beck</b>', account_no: 'A1' }];
  const html = reviewHtml(sheet);
  assert.doesNotMatch(html, /<script|<b>/);
  assert.match(html, /name="count" value="5"/);
  assert.match(html, /name="date" value="2026-11-10"/);
  assert.match(html, /class="unsure"/);
  assert.match(html, /Crossed out on the page/);
  assert.doesNotMatch(html.match(/<tr class="struck">[\s\S]*?<\/tr>/)[0], /checked/, 'crossed-out lines start unticked');
  assert.match(reviewHtml({ ...sheet, date: '' }), /date couldn’t be read/);
  assert.match(reviewHtml({ ...sheet, weekdayOk: false, dateText: 'Wed 11-10-26' }), /weekday doesn’t fit/);
  assert.match(reviewHtml({ date: '2026-11-10', dateText: '', rows: [], weekdayOk: null }), /No lines could be read/);
});

test('the form comes back as rows, only the ones kept', () => {
  const f = new URLSearchParams({ count: '3', date: '2026-11-10', code_0: 'ECH', part_0: 'OP6603', from_0: 'ALT', cust_0: 'Beckman', cid_0: '4', keep_0: '1', got_0: '1', code_1: 'ATM', keep_1: '1', paid_1: '1', code_2: 'XXX' });
  assert.deepEqual(rowsFrom(f), [
    { lineCode: 'ECH', partNumber: 'OP6603', orderedFrom: 'ALT', customer: 'Beckman', customerId: '4', received: true, paid: false },
    { lineCode: 'ATM', partNumber: null, orderedFrom: null, customer: null, customerId: null, received: false, paid: true },
  ]);
  assert.equal(rowsFrom(new URLSearchParams({ count: '9999' })).length, 0);
});
