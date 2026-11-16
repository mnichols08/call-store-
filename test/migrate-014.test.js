// 014 rebuilds portal_accounts: every account, and everything that points at one, must survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase, MIGRATIONS } from '../src/infra/db.js';

test('014 keeps accounts, sessions, tokens and updates, and makes email optional', () => {
  const before = mkdtempSync(join(tmpdir(), 'migrations-'));
  for (const name of readdirSync(MIGRATIONS).filter((f) => f < '014')) cpSync(join(MIGRATIONS, name), join(before, name));
  const db = openDatabase(':memory:');
  migrate(db, before);
  db.prepare("INSERT INTO customers (id, name, kind, created_by, created_at, updated_at) VALUES (1, 'Bubba Farms', 'organization', 'x', 1, 1)").run();
  db.prepare("INSERT INTO portal_accounts (id, customer_id, email, name, role, created_at) VALUES (7, 1, 'bo@example.com', 'Bo', 'admin', 1)").run();
  db.prepare("INSERT INTO portal_sessions (token_hash, account_id, created_at, expires_at) VALUES ('h1', 7, 1, 9999999999999)").run();
  db.prepare("INSERT INTO portal_tokens (token_hash, purpose, email, account_id, created_at, expires_at) VALUES ('t1', 'login', 'bo@example.com', 7, 1, 2)").run();

  assert.deepEqual(migrate(db), ['014_people_sign_in.sql']);
  assert.equal(db.prepare('SELECT email FROM portal_accounts WHERE id = 7').get().email, 'bo@example.com');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM portal_sessions WHERE account_id = 7').get().n, 1, 'the session survived');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM portal_tokens WHERE account_id = 7').get().n, 1);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys are back on');
  db.prepare("INSERT INTO portal_accounts (customer_id, name, username, password_hash, created_at) VALUES (1, 'Cy', 'cy', 'scrypt$x', 1)").run();
  assert.throws(() => db.prepare("INSERT INTO portal_accounts (customer_id, name, username, created_at) VALUES (1, 'Di', 'di', 1)").run(), /CHECK/, 'a username needs a password');
  // Removing the account still takes its sessions with it.
  db.prepare('DELETE FROM portal_accounts WHERE id = 7').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM portal_sessions').get().n, 0);
  rmSync(before, { recursive: true, force: true });
});
