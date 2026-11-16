// Start the call desk.
import { config, checkConfig } from './infra/config.js';
import { migrate, openDatabase } from './infra/db.js';
import { dirname, join } from 'node:path';
import { createWeb } from './web/server.js';
import { dailyBackup } from './infra/backup.js';

checkConfig(config);
const db = openDatabase(config.database);
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

// A copy of the database every day, on the same disk, newest 14 kept. Set BACKUP_DIR to put them elsewhere, or BACKUP_EVERY_HOURS=0 to turn it off.
const backupDir = process.env.BACKUP_DIR ?? join(dirname(config.database), 'backups');
const backupHours = Number(process.env.BACKUP_EVERY_HOURS ?? 24);
function backUp() {
  try {
    console.log(`Backed up to ${dailyBackup(db, backupDir)}`);
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
  }
}
if (backupHours > 0 && config.database !== ':memory:') {
  backUp();
  setInterval(backUp, backupHours * 3_600_000).unref();
}

const { server, staff } = await createWeb({ db, config });
server.listen(config.port, async () => {
  const origin = process.env.PUBLIC_URL ?? `http://localhost:${config.port}`;
  console.log(`${config.business} call desk on ${origin}`);
  if (staff.needsOwner()) console.log(`Nobody has an account yet. Set up the first owner: ${origin}/staff/accept?token=${await staff.setup()}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
