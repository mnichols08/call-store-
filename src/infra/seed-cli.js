// Put a few customers and items in an empty database so there is something to look at.
//   npm run seed
import { config } from './config.js';
import { migrate, openDatabase } from './db.js';
import { createApp } from '../app/index.js';

const db = openDatabase(config.database);
migrate(db);
const app = createApp({ db });
const system = { email: 'seed@system', name: 'Seed', roles: ['owner'] };

const customers = [
  { name: 'Hollow Creek Farms', kind: 'organization', account_no: 'A-100', phones: [{ phone: '304-555-0142', label: 'office' }, { phone: '304-555-0199', label: 'shop' }], notes: 'Case and John Deere equipment. Pays on account.' },
  { name: 'Dale Weaver', kind: 'person', phones: [{ phone: '304-555-0777', label: 'cell' }], notes: '2008 F-150 5.4L.' },
  { name: 'Mountain State Hauling', kind: 'organization', account_no: 'A-212', phones: [{ phone: '304-555-0350' }] },
];
const items = [
  { sku: 'WP-540', name: 'Water pump, 5.4L Ford', brand: 'Gates', price: '89.99' },
  { sku: '6205-2RS', name: 'Sealed ball bearing 25x52x15', brand: 'SKF', price: '9.49' },
  { sku: 'OF-4967', name: 'Oil filter', brand: 'Wix', price: '7.25' },
  { sku: 'HF-34', name: 'Hydraulic fitting, 3/4 hose', brand: 'Parker', price: '14.00', unit: 'each' },
];
let added = 0;
for (const c of customers) if (app.customers.create(system, c).ok) added++;
for (const i of items) if (app.items.create(system, i).ok) added++;
console.log(added ? `Added ${added} sample records.` : 'Sample records are already there.');
db.close();
