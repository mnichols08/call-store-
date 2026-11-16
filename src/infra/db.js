// The database: one SQLite file through Node's built-in driver. Nothing outside src/infra and
// src/app/*.repo-style modules touches it; the domain never sees a driver.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = join(here, '..', '..', 'migrations');

/** Open (and create) the database. `:memory:` is for tests. */
export function openDatabase(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

/** Run `work` in one transaction: all of it happens or none of it does. */
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Apply every numbered migration in `dir` that hasn't run yet, in order, each in a transaction.
 * A migration that has run is never run again, and one that changed since is an error.
 *
 * A migration that rebuilds a table other tables point at starts with `-- foreign-keys: off`. SQLite
 * can't switch foreign keys off inside a transaction, and with them on, dropping the old table would
 * delete (or refuse) every row that points at it. So, as SQLite's own guide to rebuilding a table
 * says, they are switched off around the transaction, and checked before it commits.
 */
export function migrate(db, dir = MIGRATIONS) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sum TEXT NOT NULL, at INTEGER NOT NULL)');
  const done = new Map(db.prepare('SELECT name, sum FROM schema_migrations').all().map((row) => [row.name, row.sum]));
  const applied = [];
  for (const name of readdirSync(dir).filter((file) => /^\d{3}_.+\.sql$/.test(file)).sort()) {
    const sql = readFileSync(join(dir, name), 'utf8');
    const sum = checksum(sql);
    if (done.has(name)) {
      if (done.get(name) !== sum) throw new Error(`Migration ${name} changed after it was applied. Add a new migration instead.`);
      continue;
    }
    const rebuild = /^-- foreign-keys: off\b/m.test(sql.split('\n', 1)[0]);
    if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(sql);
        if (rebuild) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migration ${name} left ${broken.length} rows pointing at nothing (first: ${broken[0].table}).`);
        }
        db.prepare('INSERT INTO schema_migrations (name, sum, at) VALUES (?, ?, ?)').run(name, sum, Date.now());
      });
    } finally {
      if (rebuild) db.exec('PRAGMA foreign_keys = ON');
    }
    applied.push(name);
  }
  return applied;
}

function checksum(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16);
}
