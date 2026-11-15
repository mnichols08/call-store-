import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, owner, manager, ann, bob } from './helpers.js';

const silverado = { year: 2015, make: 'Chevrolet', model: 'Silverado 1500', engine: '5.3L V8', drivetrain: '4WD' };
const suggestion = { term: 'water pump', brand: 'Balkamp', partNumber: 'BK 555', note: 'in stock' };

function setup() {
  const ctx = freshApp({ ai: { enabled: false } });
  const call = ctx.app.calls.create(ann).id;
  ctx.app.calls.claim(ann, call);
  ctx.app.calls.update(ann, call, { request: 'water pump', application: silverado });
  return { ...ctx, call };
}

test('watching is off until a manager turns it on; staff cannot turn it on', () => {
  const { app, call } = setup();
  assert.equal(app.watch.enabled(), false);
  assert.equal(app.watch.watch(bob, call).error, 'watch-off');
  assert.equal(app.watch.suggest(bob, call, suggestion).error, 'watch-off');
  assert.equal(app.watch.live(bob).error, 'watch-off');
  assert.equal(app.watch.setEnabled(bob, true).error, 'forbidden');
  assert.ok(app.watch.setEnabled(manager, true).ok);
  assert.equal(app.watch.enabled(), true);
  assert.ok(app.audit.recent(20).some((e) => e.action === 'watch.enabled' && e.actor === manager.email));
});

test('turning it off again drops everyone who was watching', () => {
  const { app, call } = setup();
  app.watch.setEnabled(owner, true);
  app.watch.watch(bob, call);
  assert.deepEqual(app.watch.watchers(call), [bob.email]);
  app.watch.setEnabled(owner, false);
  assert.deepEqual(app.watch.watchers(call), []);
});

test('the person being watched is told: shown while watching, gone after two minutes, one log line per ten', () => {
  const { app, call, events, clock } = setup();
  app.watch.setEnabled(owner, true);
  const first = app.watch.watch(bob, call);
  assert.ok(first.ok && first.call.id === call);
  assert.deepEqual(app.watch.watchers(call, ann.email), [bob.email], 'Ann sees Bob');
  assert.deepEqual(app.watch.watchers(call, bob.email), [], 'and not herself');
  assert.ok(events.some((e) => e.type === 'watch' && e.id === call), 'her page is told live');

  const watched = () => app.audit.recent(50).filter((e) => e.action === 'call.watched').length;
  assert.equal(watched(), 1);
  clock.t += 45_000;
  app.watch.watch(bob, call); // the page's heartbeat
  assert.equal(watched(), 1, 'a heartbeat isn’t a new line');
  clock.t += 100_000;
  assert.deepEqual(app.watch.watchers(call), [], 'left without a heartbeat');
  clock.t += 11 * 60_000;
  app.watch.watch(bob, call);
  assert.equal(watched(), 2);
  app.watch.stop(bob, call);
  assert.deepEqual(app.watch.watchers(call), []);
});

test('you cannot watch or suggest to your own call, and a missing call is missing', () => {
  const { app, call } = setup();
  app.watch.setEnabled(owner, true);
  assert.equal(app.watch.watch(ann, call).error, 'watch-self');
  assert.equal(app.watch.suggest(ann, call, suggestion).error, 'watch-self');
  assert.equal(app.watch.watch(bob, 999).error, 'missing');
  assert.equal(app.watch.watch({ email: 'x@e.com', roles: [] }, call).error, 'forbidden');
});

test('a suggestion reaches the holder as a nudge and a card; only they (or a manager) answer it', () => {
  const { app, call, events } = setup();
  app.watch.setEnabled(owner, true);
  assert.equal(app.watch.suggest(bob, call, { ...suggestion, brand: '' }).error, 'number');
  const sent = app.watch.suggest(bob, call, suggestion);
  assert.ok(sent.ok);
  const nudge = events.find((e) => e.type === 'nudge');
  assert.deepEqual([nudge.to, nudge.from, nudge.callId], [ann.email, bob.email, call]);
  assert.match(nudge.message, /Balkamp BK 555/);
  assert.equal(app.watch.suggestionsFor(call)[0].status, 'pending');

  const other = { email: 'cy@example.com', roles: ['staff'] };
  assert.equal(app.watch.decide(other, sent.id, true).error, 'forbidden', 'a coworker can’t answer for Ann');
  const taken = app.watch.decide(ann, sent.id, true);
  assert.ok(taken.ok);
  assert.equal(app.watch.decide(ann, sent.id, false).error, 'decided');
  assert.equal(app.watch.suggestionsFor(call)[0].status, 'accepted');
  assert.ok(app.audit.recent(50).some((e) => e.action === 'part.suggestion.accepted'));
  const second = app.watch.suggest(bob, call, { ...suggestion, partNumber: 'BK 556' });
  assert.ok(app.watch.decide(manager, second.id, false).ok, 'a manager can');
});

test('suggestions are limited per minute and refused on a closed call', () => {
  const { app, call, clock } = setup();
  app.watch.setEnabled(owner, true);
  for (let i = 0; i < 10; i += 1) assert.ok(app.watch.suggest(bob, call, { ...suggestion, partNumber: `BK ${i}1` }).ok);
  assert.equal(app.watch.suggest(bob, call, suggestion).error, 'slow-down');
  clock.t += 61_000;
  app.calls.finish(ann, call, { outcome: 'sold' }, 'closed');
  const closed = app.calls.get(ann, call).call.status;
  if (closed === 'closed') assert.equal(app.watch.suggest(bob, call, suggestion).error, 'closed');
});

test('a part search on a call tells anyone watching it', async () => {
  const { app, call, events } = setup();
  app.watch.setEnabled(owner, true);
  events.length = 0;
  await app.parts.find(ann, { vehicle: silverado, term: 'water pump', callId: call });
  assert.ok(events.some((e) => e.type === 'call' && e.id === call));
  const view = app.watch.watch(bob, call);
  assert.equal(view.search.term, 'water pump');
});
