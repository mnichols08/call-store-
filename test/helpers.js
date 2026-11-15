import { migrate, openDatabase } from '../src/infra/db.js';
import { createApp } from '../src/app/index.js';

export const owner = { email: 'owner@example.com', name: 'Olive', roles: ['owner'] };
export const manager = { email: 'manager@example.com', name: 'Max', roles: ['manager'] };
export const ann = { email: 'ann@example.com', name: 'Ann', roles: ['staff'] };
export const bob = { email: 'bob@example.com', name: 'Bob', roles: ['staff'] };

/** A fresh in-memory database with the real migrations and a clock that moves only when told. */
export function freshApp() {
  const db = openDatabase(':memory:');
  migrate(db);
  const clock = { t: 1_700_000_000_000 };
  const events = [];
  const app = createApp({ db, now: () => clock.t, changed: (e) => events.push(e) });
  return { db, app, clock, events, tick: (ms = 1000) => (clock.t += ms) };
}
