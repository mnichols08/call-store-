import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, owner, manager, ann, bob } from './helpers.js';

const nobody = { email: 'x@example.com', roles: [] };

test('nudges: stored for the recipient, private, limited, and only the recipient can dismiss', () => {
  const { app, events, clock } = freshApp();
  const call = app.calls.create(ann).id;

  assert.equal(app.nudges.send(nobody, { to: bob.email }).error, 'forbidden');
  assert.equal(app.nudges.send(ann, { to: ann.email }).error, 'nudge-who');
  assert.equal(app.nudges.send(ann, { to: '' }).error, 'nudge-who');
  assert.equal(app.nudges.send(ann, { to: bob.email, callId: 999 }).error, 'missing');

  const sent = app.nudges.send(ann, { to: bob.email, callId: call, message: `  ${'x'.repeat(500)}  ` });
  assert.ok(sent.ok);
  const heard = events.find((e) => e.type === 'nudge');
  assert.deepEqual([heard.to, heard.from, heard.callId, heard.message.length], [bob.email, ann.email, call, 200]);

  assert.equal(app.nudges.inbox(bob).nudges.length, 1);
  assert.equal(app.nudges.inbox(ann).nudges.length, 0);
  assert.equal(app.nudges.dismiss(ann, sent.id).error, 'missing', 'not theirs to dismiss');
  assert.ok(app.nudges.dismiss(bob, sent.id).ok);
  assert.equal(app.nudges.inbox(bob).nudges.length, 0);
  assert.equal(app.nudges.dismiss(bob, sent.id).error, 'missing', 'already dismissed');

  assert.ok(app.audit.recent(50).some((e) => e.action === 'nudge.sent' && e.subject === `call:${call}`));

  // Ten a minute, then a pause.
  for (let i = 0; i < 9; i += 1) assert.ok(app.nudges.send(ann, { to: bob.email }).ok);
  assert.equal(app.nudges.send(ann, { to: bob.email }).error, 'slow-down');
  clock.t += 61_000;
  assert.ok(app.nudges.send(ann, { to: bob.email }).ok);
  app.nudges.dismissAll(bob);
  assert.equal(app.nudges.inbox(bob).nudges.length, 0);
});

test('push subscriptions: https only, one per browser, yours to remove', () => {
  const { app } = freshApp();
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal(app.nudges.subscribe(ann, { endpoint: 'http://push.example/1', keys: sub.keys }).error, 'subscription');
  assert.equal(app.nudges.subscribe(ann, { endpoint: sub.endpoint, keys: {} }).error, 'subscription');
  assert.ok(app.nudges.subscribe(ann, sub).ok);
  assert.ok(app.nudges.subscribe(ann, sub).ok, 'same browser twice is still one');
  assert.equal(app.nudges.subscriptionsFor(ann.email).length, 1);
  app.nudges.unsubscribe(bob, sub.endpoint);
  assert.equal(app.nudges.subscriptionsFor(ann.email).length, 1, 'someone else cannot remove it');
  app.nudges.unsubscribe(ann, sub.endpoint);
  assert.equal(app.nudges.subscriptionsFor(ann.email).length, 0);
});

test('timing: wait to pick up, time to finish, per person, and calls nobody picked up', () => {
  const { app, clock, tick } = freshApp();
  const start = clock.t;
  const min = (n) => n * 60_000;

  const a = app.calls.create(ann).id;
  tick(min(2));
  app.calls.claim(bob, a);
  tick(min(10));
  app.calls.finish(bob, a, { outcome: 'sold' }, 'closed');

  const b = app.calls.create(ann).id;
  tick(min(8));
  app.calls.claim(ann, b);
  tick(min(4));
  app.calls.finish(ann, b, { outcome: 'sold' }, 'resolved');

  app.calls.create(ann); // never picked up
  tick(min(30));

  const t = app.stats.timing(manager, { from: start - 1, to: clock.t });
  assert.equal(t.started, 3);
  assert.equal(t.pickedUp, 2);
  assert.equal(t.neverPickedUp, 1);
  assert.equal(t.waitMedian, min(5), 'median of 2 and 8 minutes');
  assert.equal(t.withinTarget, 0.5, 'only the 2-minute wait made a 5-minute promise');
  assert.equal(t.handleMedian, min(7), 'median of 10 and 4');
  assert.equal(t.longestWaitingNow.ms, min(30));
  assert.deepEqual(t.people.map((p) => [p.email, p.finished]).sort(), [[ann.email, 1], [bob.email, 1]]);

  assert.equal(app.stats.timing(ann, { from: start, to: clock.t }).error, 'forbidden');
  assert.ok(app.stats.timing(owner, { from: start, to: clock.t }).ok);
});

test('timing: a manager assigning a call counts as picking it up; unassigning does not', () => {
  const { app, clock, tick } = freshApp();
  const start = clock.t;
  const id = app.calls.create(ann).id;
  tick(60_000);
  app.calls.assign(manager, id, null);
  assert.equal(app.stats.timing(manager, { from: start, to: clock.t }).pickedUp, 0);
  tick(60_000);
  app.calls.assign(manager, id, bob.email);
  const t = app.stats.timing(manager, { from: start, to: clock.t });
  assert.equal(t.pickedUp, 1);
  assert.equal(t.waitMedian, 120_000);
});
