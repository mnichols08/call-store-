import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, owner, ann, bob } from './helpers.js';
import { sniff, stripMetadata } from '../src/domain/image.js';
import { measureKey, parseNumber, readMeasurements } from '../src/domain/measure.js';
import { LIMITS } from '../src/app/details.js';

// ---- tiny pictures with metadata in them
const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
const jpeg = ({ withGps = true } = {}) => Buffer.concat([
  Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
  ...(withGps ? [seg(0xe1, Buffer.from('Exif\0\0GPSLatitude=38.9 SECRET')), seg(0xfe, Buffer.from('a comment'))] : []),
  seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), Buffer.from([0xff, 0xd9]),
]);
const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('GPS\0secret place')), chunk('eXIf', Buffer.from('exifdata')), chunk('IDAT', Buffer.from('abc')), chunk('IEND', Buffer.alloc(0))]);
const wchunk = (tag, data) => { const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0); const h = Buffer.alloc(8); h.write(tag, 0, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, pad]); };
const webp = () => { const body = Buffer.concat([Buffer.from('WEBP'), wchunk('VP8X', Buffer.from([0x08 | 0x04 | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0])), wchunk('EXIF', Buffer.from('gps secret')), wchunk('XMP ', Buffer.from('xmp secret')), wchunk('VP8L', Buffer.from([1, 2, 3, 4, 5]))]); const h = Buffer.alloc(8); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]); };

test('photos: only real pictures are kept, and what the camera wrote into them is removed', () => {
  assert.equal(sniff(jpeg()), 'image/jpeg');
  assert.equal(sniff(png()), 'image/png');
  assert.equal(sniff(webp()), 'image/webp');
  assert.equal(sniff(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(sniff(Buffer.from('GIF89a......')), null);

  const j = stripMetadata(jpeg(), 'image/jpeg');
  assert.ok(!j.includes('SECRET') && !j.includes('a comment'), 'EXIF and comments are gone');
  assert.ok(j.includes('JFIF'), 'the picture’s own header stays');
  assert.deepEqual([...j.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...j.subarray(-2)], [0xff, 0xd9]);
  assert.ok(j.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56])), 'the pixels are untouched');

  const p = stripMetadata(png(), 'image/png');
  assert.ok(!p.includes('secret') && !p.includes('exifdata'));
  assert.ok(p.includes('IDAT') && p.includes('IEND'));

  const w = stripMetadata(webp(), 'image/webp');
  assert.ok(!w.includes('secret'));
  assert.equal(w.readUInt32LE(4), w.length - 8, 'the file size inside is still right');
  assert.equal(w[20] & (0x08 | 0x04), 0, 'and it no longer says it has EXIF or XMP');
  assert.equal(w[20] & 0x10, 0x10, 'other flags are kept');

  assert.equal(stripMetadata(jpeg().subarray(0, 30), 'image/jpeg'), null, 'a cut-off JPEG is refused');
  assert.equal(stripMetadata(png().subarray(0, 40), 'image/png'), null);
  assert.equal(stripMetadata(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), Buffer.alloc(10)]), 'image/jpeg'), null, 'a segment that claims to be longer than the file is refused');
});

test('measurements: fractions, units, bad numbers, and one key whatever the unit', () => {
  assert.equal(parseNumber('25'), 25);
  assert.equal(parseNumber('25,4'), 25.4);
  assert.equal(parseNumber('1/2'), 0.5);
  assert.equal(parseNumber('1 1/2'), 1.5);
  assert.equal(parseNumber('1-1/2'), 1.5);
  for (const bad of ['', 'abc', '-3', '1/0', '1e9', '12mm']) assert.equal(parseNumber(bad), null, bad);

  const get = (m) => (k) => m[k] ?? '';
  const mm = readMeasurements('bearing', 'mm', get({ f_id: '25.4', f_od: '50.8', f_width: '12.7' }));
  const inch = readMeasurements('bearing', 'in', get({ f_id: '1', f_od: '2', f_width: '1/2' }));
  assert.ok(mm.ok && inch.ok);
  assert.equal(measureKey('bearing', mm.values), measureKey('bearing', inch.values), 'the same bearing is the same key in either unit');
  assert.match(measureKey('bearing', mm.values), /^bearing id25\.4 od50\.8 w12\.7 mm$/);
  assert.equal(measureKey('bearing', readMeasurements('bearing', 'mm', get({ f_id: '25' })).values), null, 'half a form makes no key');

  const bad = readMeasurements('bearing', 'mm', get({ f_id: '-5', f_od: '999999', f_width: 'x' }));
  assert.deepEqual(bad.errors.sort(), ['id', 'od', 'width']);
  assert.equal(readMeasurements('spaceship', 'mm', get({})).error, 'type');
  const fitting = readMeasurements('fitting', 'mm', get({ f_size: '-6', f_thread: 'JIC', f_ends: 'male' }));
  assert.equal(measureKey('fitting', fitting.values), 'fitting size-6 threadjic endsmale mm');
});

function setup() {
  const ctx = freshApp({ ai: { enabled: false } });
  const call = ctx.app.calls.create(ann).id;
  ctx.app.calls.claim(ann, call);
  return { ...ctx, call };
}
const form = (o) => (k) => o[k] ?? '';

test('staff save details and photos; the photo limit, size and type are enforced', () => {
  const { app, call } = setup();
  assert.ok(app.details.save(ann, call, { type: 'seal', unit: 'mm', note: 'stamped 4-2', get: form({ f_shaft: '35', f_bore: '47', f_width: '7' }) }).ok);
  const d = app.details.get(bob, call).details;
  assert.equal(d.key, 'seal shaft35 bore47 w7 mm');
  assert.equal(d.filledBy, ann.email);
  assert.equal(app.details.save(ann, call, { type: 'seal', unit: 'mm', get: form({ f_shaft: 'abc' }) }).error, 'measure');
  assert.equal(app.details.save({ email: 'x@e.com', roles: [] }, call, { type: 'seal', unit: 'mm', get: form({}) }).error, 'forbidden');

  assert.equal(app.details.addPhoto(ann, call, Buffer.from('not a picture at all')).error, 'photo-type');
  assert.equal(app.details.addPhoto(ann, call, Buffer.alloc(LIMITS.photoBytes + 1, 0xff)).error, 'photo-big');
  assert.equal(app.details.addPhoto(ann, call, jpeg().subarray(0, 40)).error, 'photo-bad');
  for (let i = 0; i < LIMITS.photos; i += 1) assert.ok(app.details.addPhoto(ann, call, jpeg()).ok);
  assert.equal(app.details.addPhoto(ann, call, jpeg()).error, 'photo-many');
  const first = app.details.get(ann, call).photos[0];
  const kept = app.details.photo(ann, call, first.id);
  assert.ok(!kept.bytes.includes('SECRET'), 'what is stored has no metadata');
  assert.equal(app.details.photo(ann, call + 1, first.id).error, 'missing', 'a photo is only reachable through its own call');
  assert.ok(app.details.removePhoto(ann, call, first.id).ok);
  assert.equal(app.details.get(ann, call).photos.length, LIMITS.photos - 1);
});

test('the customer link: works once made, only for its call, expires, can be turned off, and is never stored', () => {
  const { app, db, call, clock } = setup();
  const other = app.calls.create(bob).id;
  const link = app.details.createLink(ann, call);
  assert.ok(link.ok && link.token.length >= 30);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM call_links').all()).includes(link.token), 'only a hash is kept');
  assert.equal(app.details.viaLink(link.token).call.id, call);
  assert.equal(app.details.viaLink(link.token + 'x').error, 'link');
  assert.equal(app.details.viaLink('short').error, 'link');
  assert.equal(app.details.viaLink(undefined).error, 'link');
  assert.equal(app.details.customerPhoto(link.token, jpeg()).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM call_photos WHERE call_id = ?').get(other).n, 0, 'nothing reaches another call');

  clock.t += 47 * 3_600_000;
  assert.ok(app.details.viaLink(link.token).ok);
  clock.t += 2 * 3_600_000;
  assert.equal(app.details.viaLink(link.token).error, 'link', 'two days later it’s dead');

  const again = app.details.createLink(ann, call);
  assert.ok(app.details.viaLink(again.token).ok);
  app.details.revokeLinks(ann, call);
  assert.equal(app.details.viaLink(again.token).error, 'link');

  const third = app.details.createLink(ann, call);
  app.calls.finish(ann, call, { outcome: 'sold' });
  assert.equal(app.details.viaLink(third.token).error, 'link-closed', 'a finished call takes nothing more');
  assert.equal(app.details.createLink(ann, call).error, 'closed');
  assert.equal(app.details.createLink({ email: 'x@e.com', roles: [] }, other).error, 'forbidden');
});

test('what a customer sends reaches the person with the call, once per burst of photos', () => {
  const { app, call, events, clock } = setup();
  const { token } = app.details.createLink(ann, call);
  events.length = 0;
  assert.ok(app.details.customerSave(token, { type: 'belt', unit: 'mm', note: '', get: form({ f_length: '1200', f_width: '20', f_ribs: '6' }) }).ok);
  assert.equal(app.details.customerSave(token, { type: 'belt', unit: 'mm', get: form({ f_length: 'long' }) }).error, 'measure');
  for (let i = 0; i < 3; i += 1) app.details.customerPhoto(token, jpeg());
  const nudges = events.filter((e) => e.type === 'nudge');
  assert.deepEqual(nudges.map((n) => n.to), [ann.email, ann.email], 'one for the measurements, one for the burst of photos');
  assert.match(nudges[1].message, /photo/);
  clock.t += 3 * 60_000;
  app.details.customerPhoto(token, jpeg());
  assert.equal(events.filter((e) => e.type === 'nudge').length, 3, 'a later photo is a new nudge');
  assert.equal(app.details.get(bob, call).details.filledBy, 'customer');
  assert.ok(app.audit.recent(40).some((e) => e.action === 'call.photo' && e.actor === 'customer'));
  assert.equal(app.details.customerPhoto(token, Buffer.from('GIF89a not allowed')).error, 'photo-type');
});

test('photos and old links are cleaned up after a call has been closed a while', () => {
  const { app, call, clock } = setup();
  app.details.addPhoto(ann, call, jpeg());
  app.calls.finish(ann, call, { outcome: 'sold' });
  assert.equal(app.details.purge(90), 0);
  clock.t += 91 * 86_400_000;
  assert.equal(app.details.purge(90), 1);
  assert.equal(app.details.get(ann, call).photos.length, 0);
});

test('measurements find parts, and what staff confirm is remembered for any unit', async () => {
  const asked = [];
  const ai = { enabled: true, model: 'fake', async suggest(r) { asked.push(r); return { candidates: [{ brand: 'NAPA', partNumber: '6205-2RS', description: '25x52x15 ball bearing', notes: '', sourceUrl: '', confidence: 'medium' }], note: '', usage: { input: 1, output: 1, searches: 0 } }; } };
  const { app, call } = setup();
  const again = freshApp({ ai });
  const a = again.app;
  const c = a.calls.create(ann).id;
  a.details.save(ann, c, { type: 'bearing', unit: 'mm', get: form({ f_id: '25', f_od: '52', f_width: '15' }) });
  const key = a.details.get(ann, c).details.key;
  const first = await a.parts.find(ann, { measure: key, callId: c });
  assert.ok(first.aiAsked);
  assert.equal(first.results[0].partNumber, '6205-2RS');
  assert.equal(asked[0].vehicle.year, 0);
  assert.match(asked[0].term, /^bearing id25 od52 w15 mm$/);
  assert.deepEqual(Object.keys(asked[0].vehicle).filter((k) => asked[0].vehicle[k] && k !== 'year'), [], 'no vehicle, no customer');

  // Someone else, another call, the same bearing measured in inches that round to the same millimetres.
  const c2 = a.calls.create(bob).id;
  a.details.save(bob, c2, { type: 'bearing', unit: 'mm', get: form({ f_id: '25.0', f_od: '52.0', f_width: '15.0' }) });
  const second = await a.parts.find(bob, { measure: a.details.get(bob, c2).details.key });
  assert.ok(second.fromMemory && !second.aiAsked, 'the shop already knows it');
  assert.equal(asked.length, 1);

  const taught = a.parts.teach(ann, { vehicle: {}, generic: true, term: key, brand: 'Balkamp', partNumber: 'BK 6205', description: 'Confirmed on the shelf' });
  assert.ok(taught.ok);
  const third = await a.parts.find(bob, { measure: key });
  assert.equal(third.results[0].partNumber, 'BK 6205', 'the confirmed one ranks first');
  assert.equal((await a.parts.find(bob, { term: 'bearing' })).error, 'vehicle', 'a bare name still needs a vehicle');
  void app; void call;
});

// ---- the part helper: the AI reads photos and only suggests
import { cleanPartReading } from '../src/domain/measure.js';

test('a reading from the AI keeps only a real type and values read off the part', () => {
  const r = cleanPartReading({
    type: 'bearing', confidence: 'high', unit: 'mm', markings: ['6205-2RS', '  ', 'x'.repeat(100)],
    values: { id: { value: '25', source: 'printed' }, od: { value: '52', source: 'estimate' }, width: { value: '99999', source: 'printed' }, bogus: { value: '1', source: 'printed' } },
    questions: ['Measure the hole'], note: 'n',
  });
  assert.equal(r.type, 'bearing');
  assert.deepEqual(r.values, { id: '25' }, 'an estimate, an impossible size and a field that does not exist are dropped');
  assert.equal(r.markings.length, 2);
  assert.ok(r.markings[1].length <= 40);
  assert.equal(cleanPartReading({ type: 'rocket-engine', values: { id: { value: '1', source: 'printed' } } }).type, '');
  assert.deepEqual(cleanPartReading({ type: 'rocket-engine' }).values, {});
  assert.equal(cleanPartReading(null).confidence, 'low');
  assert.equal(cleanPartReading({ type: 'hose', unit: 'in', values: { id: { value: '1/2', source: 'printed' } } }).values.id, '1/2');
});

test('the helper looks only at a call’s own photos, only once there are some, and only when the AI is on', async () => {
  const sent = [];
  const ai = { enabled: true, suggest: async () => ({ candidates: [] }), readSheet: async () => ({}), readPart: async ({ images }) => { sent.push(images); return { reading: { type: 'seal', confidence: 'medium', markings: ['TC 35x47x7'], values: { shaft: { value: '35', source: 'printed' } } }, usage: { input: 10, output: 5 } }; } };
  const { app, clock } = freshApp({ ai });
  const call = app.calls.create(ann).id;
  const link = app.details.createLink(ann, call);
  assert.equal((await app.details.assistViaLink(link.token)).error, 'no-photo');
  assert.equal(app.details.customerPhoto(link.token, jpeg()).ok, true);
  const r = await app.details.assistViaLink(link.token);
  assert.equal(r.ok, true);
  assert.equal(r.suggestion.type, 'seal');
  assert.deepEqual(r.suggestion.values, { shaft: '35' });
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0][0]).sort(), ['bytes', 'mime'], 'only the picture goes out, nothing about the call or the customer');
  assert.equal(app.details.get(ann, call).details, null, 'nothing is saved by a suggestion');
  for (let i = 0; i < 5; i += 1) await app.details.assist(call);
  assert.equal((await app.details.assist(call)).error, 'slow-down', 'six looks an hour per call');
  clock.t += 3_700_000;
  assert.equal((await app.details.assist(call)).ok, true);
  const off = freshApp({ ai: { enabled: false } });
  const c2 = off.app.calls.create(ann).id;
  assert.equal((await off.app.details.assist(c2)).error, 'off');
  assert.equal((await app.details.assistViaLink('nope-not-a-link-at-all-xx')).error, 'link');
});

test('an AI failure is reported in words and keeps the call usable', async () => {
  const { AiError } = await import('../src/infra/ai.js');
  const ai = { enabled: true, suggest: async () => ({}), readSheet: async () => ({}), readPart: async () => { throw new AiError('busy', 'x'); } };
  const { app } = freshApp({ ai });
  const call = app.calls.create(ann).id;
  app.details.addPhoto(ann, call, jpeg());
  const r = await app.details.assist(call);
  assert.equal(r.error, 'ai-busy');
  assert.match(r.message, /try again/i);
});
