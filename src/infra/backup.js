// A consistent copy of the live database, safe to take while the app is running.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Write a copy to `file` (a new file; it must not exist). Returns the path. */
export function backupTo(db, file) {
  mkdirSync(dirname(file), { recursive: true });
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

/** `call-store-2026-11-15.db` in `dir`, keeping the newest `keep`. */
export function dailyBackup(db, dir, { now = new Date(), keep = 14 } = {}) {
  const file = join(dir, `call-store-${now.toISOString().slice(0, 10)}.db`);
  try {
    rmSync(file);
  } catch {}
  backupTo(db, file);
  const old = readdirSync(dir).filter((name) => /^call-store-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort().slice(0, -keep);
  for (const name of old) rmSync(join(dir, name));
  return file;
}
