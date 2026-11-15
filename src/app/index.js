// The application layer: what the store can do, each action checking who is asking and writing
// its audit entry in the same transaction. The web layer calls these and nothing else.
import { createAudit } from './audit.js';
import { createCalls } from './calls.js';
import { createCustomers } from './customers.js';
import { createItems } from './items.js';
import { createNudges } from './nudges.js';
import { createStats } from './stats.js';

/**
 * `changed(event)` is told after something committed, so the web layer can tell open pages.
 * `now` is a clock a test can set.
 */
export function createApp({ db, now = Date.now, changed = () => {} }) {
  const audit = createAudit(db, now);
  const shared = { db, audit, now, changed };
  return { audit, customers: createCustomers(shared), items: createItems(shared), calls: createCalls(shared), nudges: createNudges(shared), stats: createStats(shared) };
}
