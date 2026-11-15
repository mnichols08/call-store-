import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, shopState, minutesOf, localParts, weekTable, openingSpec, addDays } from '../src/domain/hours.js';
import { SHOP } from '../src/domain/shop.js';
import { freshApp, ann, manager } from './helpers.js';

const ZONE = 'America/New_York';
const at = (iso) => Date.parse(iso); // an exact moment (UTC), so tests don't depend on this computer's zone
const state = (iso, closures = []) => shopState(at(iso), ZONE, SHOP.hours, closures);

test('times read the way people say them', () => {
  assert.equal(clock(450), '7:30 AM');
  assert.equal(clock(1080), '6 PM');
  assert.equal(clock(540), '9 AM');
  assert.equal(clock(0), '12 AM');
  assert.equal(clock(720), '12 PM');
  assert.equal(minutesOf('07:30'), 450);
  for (const bad of ['', '7', '24:00', '7:60', 'ab:cd', null]) assert.equal(minutesOf(bad), null, String(bad));
});

test('the shop’s hours: weekdays 7:30 to 6, Saturday 7:30 to 5, Sunday 9 to 4', () => {
  // Friday Nov 13 2026, in New York (EST, UTC-5)
  assert.deepEqual([state('2026-11-13T15:00:00Z').open, state('2026-11-13T15:00:00Z').text], [true, 'Open until 6 PM']);
  assert.equal(state('2026-11-13T12:29:00Z').text, 'Closed. Opens today at 7:30 AM', 'a minute before opening');
  assert.equal(state('2026-11-13T12:30:00Z').open, true, 'and at 7:30 exactly');
  assert.equal(state('2026-11-13T22:59:00Z').open, true, 'one minute before 6');
  assert.equal(state('2026-11-13T23:00:00Z').text, 'Closed. Opens tomorrow at 7:30 AM', 'at 6 PM Friday, Saturday is next');
  assert.equal(state('2026-11-14T22:00:00Z').text, 'Closed. Opens tomorrow at 9 AM', 'Saturday 5 PM: Sunday opens at 9');
  assert.equal(state('2026-11-15T21:30:00Z').text, 'Closed. Opens tomorrow at 7:30 AM', 'Sunday after 4 PM');
  assert.equal(state('2026-11-15T15:00:00Z').text, 'Open until 4 PM', 'Sunday 10 AM');
  assert.equal(state('2026-11-16T03:00:00Z').text, 'Closed. Opens today at 7:30 AM'.replace('today', 'tomorrow'), 'late Sunday night');
});

test('the shop’s own clock decides, across daylight saving', () => {
  // Sunday Nov 1 2026 clocks go back at 2 AM. 13:00Z is 8 AM EST (UTC-5) after the change, 9 AM EDT before it.
  assert.equal(localParts(at('2026-11-01T13:00:00Z'), ZONE).minutes, 8 * 60);
  assert.equal(localParts(at('2026-10-31T13:00:00Z'), ZONE).minutes, 9 * 60);
  assert.equal(state('2026-11-01T13:00:00Z').text, 'Closed. Opens today at 9 AM', 'Sunday opens at 9; it is 8');
  assert.equal(state('2026-11-01T14:00:00Z').open, true);
  assert.equal(addDays('2026-11-01', 1).date, '2026-11-02');
  assert.equal(addDays('2026-12-31', 1).date, '2027-01-01');
  assert.equal(addDays('2028-02-28', 1).date, '2028-02-29');
});

test('a closure shuts a day with its reason; special hours replace the usual ones', () => {
  const thanksgiving = [{ date: '2026-11-26', note: 'Thanksgiving' }];
  assert.equal(state('2026-11-26T15:00:00Z', thanksgiving).text, 'Closed today (Thanksgiving). Opens tomorrow at 7:30 AM');
  assert.equal(state('2026-11-25T23:30:00Z', thanksgiving).text, 'Closed. Opens Friday at 7:30 AM', 'Wednesday evening skips the closed day');
  const short = [{ date: '2026-12-24', note: 'Christmas Eve', open: '08:00', close: '13:00' }];
  assert.equal(state('2026-12-24T17:00:00Z', short).text, 'Open until 1 PM');
  assert.equal(state('2026-12-24T19:00:00Z', short).open, false, '2 PM on a day that closes at 1');
  const nonsense = [{ date: '2026-11-13', open: '18:00', close: '07:00' }];
  assert.equal(state('2026-11-13T15:00:00Z', nonsense).open, false, 'special hours that make no sense mean closed, never open all day');
});

test('the week for a table and for search engines', () => {
  const rows = weekTable(at('2026-11-13T15:00:00Z'), ZONE, SHOP.hours);
  assert.deepEqual(rows.map((r) => r.day), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.deepEqual(rows.filter((r) => r.today).map((r) => r.day), ['Friday']);
  assert.equal(rows[5].hours, '7:30 AM to 5 PM');
  assert.equal(weekTable(at('2026-11-13T15:00:00Z'), ZONE, { mon: [450, 1080] })[1].hours, 'Closed');
  const spec = openingSpec(SHOP.hours);
  assert.equal(spec.length, 7);
  assert.deepEqual(spec.find((s) => s.dayOfWeek === 'Sunday'), { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Sunday', opens: '09:00', closes: '16:00' });
});

test('managers add and remove closures; nobody else can; bad input is refused', () => {
  const { app, clock: c } = freshApp({ zone: ZONE });
  c.t = at('2026-11-15T15:00:00Z');
  assert.equal(app.hours.set(ann, { date: '2026-11-26', note: 'Thanksgiving' }).error, 'forbidden');
  assert.equal(app.hours.set(manager, { date: 'nope' }).error, 'date');
  assert.equal(app.hours.set(manager, { date: '2026-02-30' }).error, 'date');
  assert.equal(app.hours.set(manager, { date: '2026-11-01' }).error, 'past');
  assert.equal(app.hours.set(manager, { date: '2026-12-24', open: '08:00' }).error, 'hours');
  assert.equal(app.hours.set(manager, { date: '2026-12-24', open: '13:00', close: '08:00' }).error, 'hours');
  assert.ok(app.hours.set(manager, { date: '2026-11-26', note: '  Thanks\ngiving  ' }).ok);
  assert.ok(app.hours.set(manager, { date: '2026-12-24', note: 'Christmas Eve', open: '08:00', close: '13:00' }).ok);
  assert.ok(app.hours.set(manager, { date: '2026-11-26', note: 'Thanksgiving Day' }).ok, 'setting a day again replaces it');
  assert.deepEqual(app.hours.upcoming().map((x) => [x.date, x.note]), [['2026-11-26', 'Thanksgiving Day'], ['2026-12-24', 'Christmas Eve']]);
  c.t = at('2026-11-26T15:00:00Z');
  assert.match(app.hours.state().text, /^Closed today \(Thanksgiving Day\)/);
  assert.equal(app.hours.remove(ann, '2026-11-26').error, 'forbidden');
  assert.ok(app.hours.remove(manager, '2026-11-26').ok);
  assert.equal(app.hours.state().open, true);
  c.t = at('2026-12-30T15:00:00Z');
  assert.deepEqual(app.hours.upcoming(), [], 'past closures drop off the list');
});
