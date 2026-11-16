// The lines of a call as work: paint lines, VINs that decode, statuses, and the suggestion queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, ann, bob } from './helpers.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
/** NHTSA, answering every VIN as a 2015 Silverado. */
const nhtsa = async (url) => {
  if (String(url).includes('DecodeVinValuesExtended')) return json({ Results: [{ Make: 'CHEVROLET', Model: 'Silverado 1500', ModelYear: '2015', DisplacementL: '5.3', EngineCylinders: '8', EngineConfiguration: 'V-Shaped', FuelTypePrimary: 'Gasoline', DriveType: '4WD/4-Wheel Drive/4x4', ErrorCode: '0' }] });
  throw new Error(`unexpected ${url}`);
};
function fakeAi(candidates) {
  const calls = [];
  return { calls, enabled: true, model: 'fake', async suggest(request) { calls.push(request); return { candidates, note: '', usage: { input: 1, output: 1, searches: 0 } }; } };
}
const pads = { brand: 'NAPA', partNumber: 'SB 7123', description: 'Front brake pads', notes: '', sourceUrl: '', confidence: 'medium' };
const VIN = '1GCVKREC5FZ123456';

test('a paint line is saved as paint, never asked about, and the read-back says it', () => {
  const { app } = freshApp();
  const id = app.calls.create(ann).id;
  const r = app.lines.add(ann, id, '1qt d3 valspar single stage');
  const line = r.lines[0];
  assert.equal(line.kind, 'paint');
  assert.deepEqual(line.paint, { code: 'D3', type: 'Single stage', brand: 'Valspar', amount: 1, unit: 'qt' });
  assert.equal(line.suggest, '', 'paint never goes to the part finder');
  assert.equal(app.calls.get(ann, id).title, 'Paint D3');
  assert.ok(app.calls.get(ann, id).events.some((e) => e.type === 'line-added' && e.data.text === 'Paint D3 · Valspar single stage · 1 qt'));
});

test('a VIN typed as a line decodes to the vehicle, and the call takes the VIN', async () => {
  const { app } = freshApp({ fetcher: nhtsa, ai: fakeAi([pads]) });
  const id = app.calls.create(ann).id;
  const typed = app.lines.add(ann, id, VIN.toLowerCase());
  assert.equal(typed.vin, typed.id, 'the page is told which line to decode');
  assert.equal(typed.application.vin, VIN);
  app.lines.add(ann, id, 'front brake pads');
  const done = await app.lines.resolveVin(ann, id, typed.id);
  assert.equal(done.ok, true);
  assert.deepEqual(done.lines[0].vehicle, { year: '2015', make: 'Chevrolet', model: 'Silverado 1500', engine: '5.3L V8', drivetrain: '4WD' });
  assert.equal(done.lines[1].vehicle.model, 'Silverado 1500', 'the lines after it carry the decoded vehicle');
  assert.equal(done.application.vin, VIN);
  assert.equal(done.application.model, 'Silverado 1500');
  await app.finder.idle();
  const after = app.lines.list(ann, id).lines[1];
  assert.equal(after.suggest, 'ready', 'the part line waited for the vehicle, then was asked about');
  assert.equal(after.suggestions[0].partNumber, 'SB 7123');
});

test('a VIN that the decoder can\'t read leaves the line as typed', async () => {
  const { app } = freshApp({ fetcher: async () => json({ Results: [{ Make: '', ModelYear: '', ErrorCode: '8', ErrorText: '8 - No detailed data available' }] }) });
  const id = app.calls.create(ann).id;
  const typed = app.lines.add(ann, id, VIN);
  const r = await app.lines.resolveVin(ann, id, typed.id);
  assert.equal(r.error, 'vin-unknown');
  assert.equal(r.lines[0].vin, VIN);
  assert.equal(r.lines[0].vinDecoded, false);
});

test('each line is worked down the list: found, need to order, can\'t get, back to open', () => {
  const { app } = freshApp();
  const id = app.calls.create(ann).id;
  const lineId = app.lines.add(ann, id, '2007 cherokee front shocks').id;
  for (const status of ['found', 'order', 'cant', 'open']) {
    const r = app.lines.status(bob, id, lineId, status);
    assert.equal(r.ok, true);
    assert.equal(r.lines[0].status, status);
    assert.equal(r.lines[0].done, status !== 'open');
  }
  assert.equal(app.lines.status(ann, id, lineId, 'lost').error, 'status');
  assert.ok(app.calls.get(ann, id).events.some((e) => e.type === 'line-status' && e.data.status === 'order'));
  assert.equal(app.lines.done(ann, id, lineId, true).lines[0].status, 'found', 'the old tick still works');
});

test('the queue asks about each part line once, and again when it is retyped', async () => {
  const ai = fakeAi([pads]);
  const { app } = freshApp({ ai });
  const id = app.calls.create(ann).id;
  app.lines.add(ann, id, '2012 civic front brake pads');
  app.lines.add(ann, id, 'rear brake pads');
  const waiting = app.lines.add(ann, id, 'alternator');
  await app.finder.idle();
  let lines = app.lines.list(ann, id).lines;
  assert.deepEqual(lines.map((l) => l.suggest), ['ready', 'ready', 'ready']);
  assert.equal(ai.calls.length, 3);
  assert.equal(lines[0].suggestions.length, 1);

  app.lines.edit(ann, id, waiting.id, 'starter');
  await app.finder.idle();
  lines = app.lines.list(ann, id).lines;
  assert.equal(lines[2].suggest, 'ready');
  assert.equal(ai.calls.length, 4, 'only the retyped line was asked again');
  assert.equal(ai.calls.at(-1).term, 'Starter');
});

test('a part with no vehicle waits for one; without an AI key the line says so', async () => {
  const { app } = freshApp({ ai: fakeAi([pads]) });
  const id = app.calls.create(ann).id;
  app.lines.add(ann, id, 'front brake pads');
  await app.finder.idle();
  assert.equal(app.lines.list(ann, id).lines[0].suggest, 'vehicle');
  app.lines.add(ann, id, '2012 civic');
  await app.finder.idle();
  // The pads line was typed before the vehicle, so it is still for no vehicle: it keeps waiting.
  assert.equal(app.lines.list(ann, id).lines[0].suggest, 'vehicle');

  const off = freshApp();
  const call = off.app.calls.create(ann).id;
  off.app.lines.add(ann, call, '2012 civic front brake pads');
  await off.app.finder.idle();
  assert.equal(off.app.lines.list(ann, call).lines[0].suggest, 'off');
});
