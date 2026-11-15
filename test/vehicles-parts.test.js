import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, ann, bob, manager } from './helpers.js';
import { readVin, matchVehicles, drivetrainOf, engineLabel } from '../src/domain/vehicle.js';
import { cleanCandidates, looksLikePartNumber, numberKey, termKey } from '../src/domain/parts.js';
import { buildRequest, createAi } from '../src/infra/ai.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

/** A pretend NHTSA, EPA and Anthropic. Counts what it was asked. */
function world() {
  const seen = [];
  const fetcher = async (url, init = {}) => {
    seen.push({ url: String(url), body: init.body });
    const u = String(url);
    if (u.includes('DecodeVinValuesExtended')) return json({ Results: [{ Make: 'CHEVROLET', Model: 'Silverado 1500', ModelYear: '2015', DisplacementL: '5.3', EngineCylinders: '8', EngineConfiguration: 'V-Shaped', FuelTypePrimary: 'Gasoline', DriveType: '4WD/4-Wheel Drive/4x4', Trim: 'LT', ErrorCode: '0' }] });
    if (u.includes('GetModelsForMakeYear/make/Chevrolet')) return json({ Results: [{ Make_Name: 'CHEVROLET', Model_Name: 'Silverado 1500' }, { Make_Name: 'CHEVROLET', Model_Name: 'Silverado 2500HD' }, { Make_Name: 'CHEVROLET', Model_Name: 'Malibu' }] });
    if (u.includes('GetModelsForMakeYear/make/Ford')) return json({ Results: [{ Make_Name: 'FORD', Model_Name: 'F-150' }] });
    if (u.includes('GetModelsForMakeYear')) return json({ Results: [] });
    if (u.includes('menu/make')) return json({ menuItem: [] });
    if (u.includes('menu/options')) return json({ menuItem: [{ value: '1', text: 'Auto 6-spd, 8 cyl, 5.3 L' }] });
    if (u.includes('/vehicle/1')) return json({ displ: '5.3', cylinders: '8', fuelType1: 'Regular Gasoline', drive: '4-Wheel Drive' });
    throw new Error(`unexpected ${u}`);
  };
  return { fetcher, seen };
}

function fakeAi(candidates, { fail } = {}) {
  const calls = [];
  return {
    calls,
    enabled: true,
    model: 'fake',
    async suggest(request) {
      calls.push(request);
      if (fail) throw Object.assign(new Error('x'), { code: fail });
      return { candidates, note: '', usage: { input: 100, output: 50, searches: 1 } };
    },
  };
}
const silverado = { year: 2015, make: 'Chevrolet', model: 'Silverado 1500', engine: '5.3L V8', drivetrain: '4WD' };
const pump = { brand: 'Balkamp', partNumber: 'BK 123-456', description: 'Water pump', notes: 'fits 5.3L', sourceUrl: '', confidence: 'medium' };

test('VIN reading: length, characters, check digit', () => {
  assert.equal(readVin('123').reason, 'length');
  assert.equal(readVin('1GCVKREC0EZ12345O').reason, 'characters', 'letter O is never in a VIN');
  const good = readVin('1M8GDM9AXKP042788');
  assert.ok(good.ok && good.checkDigit);
  assert.equal(readVin('1m8 gdm9a-xkp042788').vin, '1M8GDM9AXKP042788', 'spaces, dashes and case are tidied');
  assert.equal(readVin('1M8GDM9A1KP042788').checkDigit, false, 'wrong check digit warns, doesn’t refuse');
});

test('closest match: slips, partial names, make words and aliases', () => {
  const rows = [{ make: 'Chevrolet', model: 'Silverado 1500' }, { make: 'Chevrolet', model: 'Silverado 2500HD' }, { make: 'Chevrolet', model: 'Malibu' }, { make: 'Ford', model: 'F-150' }, { make: 'GMC', model: 'Sierra 1500' }, { make: 'Dodge', model: 'Ram 1500' }];
  assert.equal(matchVehicles('silverado', rows)[0].model, 'Silverado 1500');
  assert.equal(matchVehicles('silvrado', rows)[0].model, 'Silverado 1500', 'a dropped letter still finds it');
  assert.equal(matchVehicles('silverdao 2500', rows)[0].model, 'Silverado 2500HD');
  assert.equal(matchVehicles('f150', rows)[0].model, 'F-150', 'punctuation is ignored');
  assert.equal(matchVehicles('chevy malibu', rows)[0].model, 'Malibu', 'chevy means Chevrolet');
  assert.equal(matchVehicles('sierra', rows)[0].make, 'GMC');
  assert.deepEqual(matchVehicles('zzzzqq', rows), [], 'nonsense matches nothing');
  assert.deepEqual(matchVehicles('   ', rows), []);
});

test('small rules: drivetrains, engines, part numbers', () => {
  assert.equal(drivetrainOf('4WD/4-Wheel Drive/4x4'), '4WD');
  assert.equal(drivetrainOf('Front-Wheel Drive'), 'FWD');
  assert.equal(drivetrainOf('Rear-Wheel Drive'), 'RWD');
  assert.equal(engineLabel({ displacement: '5.30', cylinders: '8', fuel: 'Gasoline', config: 'V-Shaped' }), '5.3L V8');
  assert.equal(engineLabel({ displacement: '2.5', cylinders: '4', fuel: 'Regular Gasoline' }), '2.5L 4-cyl');
  assert.equal(engineLabel({ displacement: '6.6', cylinders: '8', fuel: 'Diesel', config: 'V-Shaped' }), '6.6L V8 diesel');
  assert.equal(numberKey('bk 123-456'), 'BK123456');
  assert.equal(termKey('Water Pumps'), termKey('water pump'));
  assert.ok(looksLikePartNumber('DOR-12345'));
  assert.ok(!looksLikePartNumber('water pump'));
  assert.ok(!looksLikePartNumber('12'));
});

test('AI candidates are made safe: markup stripped, junk dropped, links must be real', () => {
  const pages = new Set(['https://catalog.example.com/p/1']);
  const out = cleanCandidates([
    { brand: 'Dorman', partNumber: '911-123', description: '<b>Wheel</b> \u0000 lug', sourceUrl: 'https://catalog.example.com/p/1', confidence: 'high' },
    { brand: 'Dorman', partNumber: '911 123', description: 'dup' },
    { brand: 'Gates', partNumber: 'K060', sourceUrl: 'https://invented.example.com/x', confidence: 'high' },
    { brand: '', partNumber: 'ABC123' },
    { brand: 'X', partNumber: 'not a number!!!;' },
    'junk', null,
  ], { pages });
  assert.equal(out.length, 2);
  assert.equal(out[0].description, 'Wheel lug');
  assert.equal(out[0].confidence, 'high');
  assert.equal(out[1].sourceUrl, '', 'a link the search never returned is dropped');
  assert.equal(out[1].confidence, 'medium', 'and without a real source it can’t be high');
});

test('privacy: what is sent to the AI is the vehicle and the part, nothing else', () => {
  const req = buildRequest({ vehicle: { ...silverado, vin: '1GCVKREC0EZ123456', customer: 'Bubba' }, term: 'water pump', phone: '555' }, { brands: ['NAPA'] });
  const text = JSON.stringify(req);
  assert.ok(!text.includes('1GCVKREC0EZ123456') && !text.includes('Bubba') && !text.includes('555'));
  assert.equal(req.vehicle.model, 'Silverado 1500');
});

test('the AI client: sends the key and model, reads the JSON answer, keeps only real source links', async () => {
  let sent;
  const fetcher = async (url, init) => {
    sent = { url, init };
    return json({ content: [
      { type: 'web_search_tool_result', content: [{ url: 'https://shop.example.com/a' }] },
      { type: 'text', text: 'Here: {"candidates":[{"brand":"Balkamp","partNumber":"BK 1","description":"d","confidence":"high","sourceUrl":"https://shop.example.com/a"}],"note":"ok"}' },
    ], usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 2 } }, stop_reason: 'end_turn' });
  };
  const ai = createAi({ apiKey: 'sk-test', model: 'claude-haiku-5-5', fetcher });
  const r = await ai.suggest({ vehicle: silverado, term: 'water pump' });
  assert.equal(sent.init.headers['x-api-key'], 'sk-test');
  assert.equal(JSON.parse(sent.init.body).model, 'claude-haiku-5-5');
  assert.equal(r.candidates[0].sourceUrl, 'https://shop.example.com/a');
  assert.equal(r.usage.searches, 2);
  await assert.rejects(createAi({ apiKey: '' }).suggest({}), { code: 'off' });
  const bad = createAi({ apiKey: 'k', fetcher: async () => json({}, 401) });
  await assert.rejects(bad.suggest({ vehicle: silverado, term: 'x' }), { code: 'auth' });
  const garbage = createAi({ apiKey: 'k', fetcher: async () => json({ content: [{ type: 'text', text: 'no json here' }], usage: {} }) });
  await assert.rejects(garbage.suggest({ vehicle: silverado, term: 'x' }), { code: 'bad-answer' });
});

test('VIN decode: reads NHTSA, caches, and never needs the network twice', async () => {
  const w = world();
  const { app } = freshApp({ fetcher: w.fetcher, ai: fakeAi([]) });
  const r = await app.vehicles.decode(ann, '1gcvkrec0ez123456');
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([r.spec.year, r.spec.make, r.spec.model, r.spec.engine, r.spec.drivetrain], [2015, 'Chevrolet', 'Silverado 1500', '5.3L V8', '4WD']);
  await app.vehicles.decode(bob, '1GCVKREC0EZ123456');
  assert.equal(w.seen.filter((s) => s.url.includes('Decode')).length, 1, 'second decode came from the cache');
  assert.equal((await app.vehicles.decode(ann, 'short')).error, 'vin-length');
  assert.equal((await app.vehicles.decode({ email: 'x@e.com', roles: [] }, '1GCVKREC0EZ123456')).error, 'forbidden');
  const audit = JSON.stringify(app.audit.recent(20));
  assert.ok(!audit.includes('1GCVKREC0EZ123456'), 'the full VIN is not in the audit trail');
});

test('VIN decode: when NHTSA is down the person is told, nothing crashes', async () => {
  const { app } = freshApp({ fetcher: async () => { throw new Error('offline'); }, ai: fakeAi([]) });
  assert.equal((await app.vehicles.decode(ann, '1GCVKREC0EZ123456')).error, 'source');
});

test('year + model finds the closest make, and the second search is local', async () => {
  const w = world();
  const { app } = freshApp({ fetcher: w.fetcher, ai: fakeAi([]) });
  const r = await app.vehicles.match(ann, { text: '2015 silvrado' });
  assert.equal(r.year, 2015);
  assert.deepEqual([r.matches[0].make, r.matches[0].model], ['Chevrolet', 'Silverado 1500']);
  const before = w.seen.length;
  const again = await app.vehicles.match(bob, { year: 2015, text: 'f150' });
  assert.equal(again.matches[0].model, 'F-150');
  assert.equal(w.seen.length, before, 'the year is indexed once; no more network');
});

test('engines and drivetrains: the EPA list is learned once, then remembered', async () => {
  const w = world();
  const { app } = freshApp({ fetcher: w.fetcher, ai: fakeAi([]) });
  const o = await app.vehicles.options(ann, 2015, 'Chevrolet', 'Silverado 1500');
  assert.deepEqual(o.engines, ['5.3L V8']);
  assert.deepEqual(o.drivetrains, ['4WD']);
  app.vehicles.remember(ann, { ...silverado, engine: '6.2L V8', drivetrain: 'RWD' });
  const again = await app.vehicles.options(bob, 2015, 'Chevrolet', 'Silverado 1500');
  assert.deepEqual(again.engines.sort(), ['5.3L V8', '6.2L V8']);
});

test('parts: the AI is asked once; the same question afterwards is answered from the shop’s memory', async () => {
  const ai = fakeAi([pump]);
  const { app } = freshApp({ ai });
  const first = await app.parts.find(ann, { vehicle: silverado, term: 'water pump' });
  assert.ok(first.aiAsked && !first.fromMemory);
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].confirmed, false, 'an AI answer is not confirmed');
  assert.equal(ai.calls.length, 1);

  const second = await app.parts.find(bob, { vehicle: silverado, term: 'Water Pumps' });
  assert.ok(second.fromMemory && !second.aiAsked, 'looked inside first');
  assert.equal(ai.calls.length, 1, 'no second AI call');
  assert.equal(second.results[0].partNumber, 'BK 123-456');

  const narrower = await app.parts.find(bob, { vehicle: { ...silverado, engine: '5.3L V8', drivetrain: '' }, term: 'water pump' });
  assert.ok(narrower.fromMemory);
  const other = await app.parts.find(bob, { vehicle: { ...silverado, model: 'Malibu' }, term: 'water pump' });
  assert.ok(other.aiAsked, 'a different vehicle is a different question');
  assert.equal(ai.calls.length, 2);
});

test('feedback teaches the shop: confirmed answers rank first, failed ones are hidden', async () => {
  const ai = fakeAi([pump, { ...pump, brand: 'Dorman', partNumber: '999-1', description: 'Other pump' }]);
  const { app } = freshApp({ ai });
  const r = await app.parts.find(ann, { vehicle: silverado, term: 'water pump' });
  const [a, b] = r.results;
  assert.ok(app.parts.feedback(ann, b.id, 'worked').ok);
  assert.ok(app.parts.feedback(bob, b.id, 'worked').ok);
  assert.ok(app.parts.feedback(ann, a.id, 'wrong-fit').ok);
  assert.ok(app.parts.feedback(bob, a.id, 'failed').ok);
  assert.equal(app.parts.feedback(ann, a.id, 'nonsense').error, 'result');
  assert.equal(app.parts.feedback({ email: 'x@e.com', roles: [] }, a.id, 'worked').error, 'forbidden');

  const again = await app.parts.find(ann, { vehicle: silverado, term: 'water pump' });
  assert.equal(again.results.length, 1, 'the part that failed twice is hidden');
  assert.equal(again.hidden, 1);
  assert.equal(again.results[0].partNumber, '999-1');
  assert.ok(again.results[0].confirmed);
  assert.equal(again.results[0].worked, 2);
  assert.equal(again.results[0].mine, 'worked');
  assert.equal((await app.parts.find(ann, { vehicle: silverado, term: 'water pump', showBad: true })).results.length, 2);

  // Changing your mind replaces your vote; it doesn't add one.
  app.parts.feedback(ann, b.id, 'failed');
  const got = app.parts.get(ann, b.id).answer;
  assert.deepEqual([got.worked, got.failed], [1, 1]);
});

test('a part number alone is cross-referenced, remembered, and found again by either number', async () => {
  const ai = fakeAi([{ brand: 'NAPA', partNumber: 'NPW 9001', description: 'Pump', notes: '', sourceUrl: '', confidence: 'low' }]);
  const { app } = freshApp({ ai });
  const r = await app.parts.find(ann, { number: 'AC Delco 252-845' });
  assert.ok(r.aiAsked && r.results.length === 1);
  assert.equal(ai.calls[0].number, 'AC Delco 252-845');
  assert.equal(ai.calls[0].vehicle.year, 0, 'no vehicle needed');
  const again = await app.parts.find(bob, { number: 'ac-delco 252845' });
  assert.ok(again.fromMemory, 'punctuation and case do not matter');
  assert.equal(ai.calls.length, 1);
  const typed = await app.parts.find(bob, { term: 'NPW9001' });
  assert.ok(typed.fromMemory && typed.number, 'a lone part number typed as the search is treated as a cross-reference');
});

test('fresh asks the AI again and keeps what is known; staff can teach; both come first', async () => {
  const ai = fakeAi([pump]);
  const { app } = freshApp({ ai });
  const taught = app.parts.teach(ann, { vehicle: silverado, term: 'water pump', brand: 'NAPA', partNumber: 'NWP 100', description: 'Counter-verified' });
  assert.ok(taught.ok);
  const memory = await app.parts.find(bob, { vehicle: silverado, term: 'water pump' });
  assert.ok(memory.fromMemory);
  assert.equal(ai.calls.length, 0, 'taught answer meant no AI call at all');
  assert.ok(memory.results[0].confirmed && memory.results[0].source === 'staff');
  const fresh = await app.parts.find(bob, { vehicle: silverado, term: 'water pump', fresh: true });
  assert.equal(ai.calls.length, 1);
  assert.deepEqual(fresh.results.map((r) => r.brand), ['NAPA', 'Balkamp'], 'the confirmed answer still ranks first');
  assert.equal(app.parts.teach(ann, { vehicle: silverado, term: 'x', brand: '', partNumber: '' }).error, 'number');
});

test('without a key, or at the limit, or when the AI fails, saved answers still work and the reason is plain', async () => {
  const off = freshApp({ ai: { suggest: undefined } });
  const none = await off.app.parts.find(ann, { vehicle: silverado, term: 'water pump' });
  assert.equal(none.aiError, 'off');
  assert.deepEqual(none.results, []);

  const ai = fakeAi([pump]);
  const { app, clock } = freshApp({ ai, limits: { hourly: 2, daily: 3 } });
  for (const t of ['water pump', 'oil filter']) assert.ok((await app.parts.find(ann, { vehicle: silverado, term: t })).aiAsked);
  const limited = await app.parts.find(ann, { vehicle: silverado, term: 'brake pad' });
  assert.equal(limited.aiError, 'limit-hour');
  assert.equal(ai.calls.length, 2);
  assert.equal((await app.parts.find(ann, { vehicle: silverado, term: 'water pump' })).fromMemory, true, 'saved answers never count against the limit');
  clock.t += 2 * 3_600_000;
  assert.ok((await app.parts.find(ann, { vehicle: silverado, term: 'brake pad' })).aiAsked);
  assert.equal((await app.parts.find(ann, { vehicle: silverado, term: 'belt' })).aiError, 'limit-day');

  const broken = freshApp({ ai: fakeAi([], { fail: 'rate' }) });
  const failed = await broken.app.parts.find(ann, { vehicle: silverado, term: 'water pump' });
  assert.equal(failed.aiError, 'rate');
  assert.equal(broken.db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE ok = 0').get().n, 1);
});

test('asking needs a vehicle for a part by name; usage is for managers', async () => {
  const { app } = freshApp({ ai: fakeAi([pump]) });
  assert.equal((await app.parts.find(ann, { term: 'water pump' })).error, 'vehicle');
  assert.equal((await app.parts.find(ann, {})).error, 'empty');
  await app.parts.find(ann, { vehicle: silverado, term: 'water pump' });
  assert.equal(app.parts.usage(ann).error, 'forbidden');
  const u = app.parts.usage(manager);
  assert.equal(u.day.calls, 1);
  assert.equal(u.day.searches, 1);
});

test('customers keep their vehicles: one per VIN, newest used first', () => {
  const { app } = freshApp({ ai: fakeAi([]) });
  const c = app.customers.create(ann, { kind: 'person', name: 'Bubba', phones: ['5551234567'] });
  const spec = { vin: '1GCVKREC0EZ123456', ...silverado };
  const a = app.vehicles.saveFor(ann, c.id, spec);
  const b = app.vehicles.saveFor(bob, c.id, spec);
  assert.equal(b.existing, true);
  assert.equal(b.id, a.id);
  app.vehicles.saveFor(ann, c.id, { year: 2001, make: 'Ford', model: 'Ranger' });
  assert.equal(app.vehicles.forCustomer(ann, c.id).vehicles.length, 2);
  assert.equal(app.vehicles.saveFor(ann, c.id, { year: 2001 }).error, 'vehicle');
  assert.equal(app.vehicles.saveFor(ann, 999, spec).error, 'customer');
  assert.ok(app.vehicles.removeFor(ann, a.id).ok);
  assert.equal(app.vehicles.forCustomer(ann, c.id).vehicles.length, 1);
});
