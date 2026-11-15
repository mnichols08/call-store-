// Start the call desk.
import { config, checkConfig } from './infra/config.js';
import { migrate, openDatabase } from './infra/db.js';
import { createWeb } from './web/server.js';

checkConfig(config);
const db = openDatabase(config.database);
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

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
