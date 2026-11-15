// npm run backup [directory]   (default: backups/ next to the database)
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { dailyBackup } from './backup.js';

const db = openDatabase(config.database);
const dir = process.argv[2] ?? process.env.BACKUP_DIR ?? join(dirname(config.database), 'backups');
console.log(`Backed up to ${dailyBackup(db, dir)}`);
db.close();
