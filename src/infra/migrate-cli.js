import { migrate, openDatabase } from './db.js';
import { config } from './config.js';

const db = openDatabase(config.database);
const applied = migrate(db);
console.log(applied.length ? `Applied ${applied.join(', ')}` : 'Database is up to date.');
db.close();
