// The application layer: what the store can do, each action checking who is asking and writing
// its audit entry in the same transaction. The web layer calls these and nothing else.
import { createAudit } from './audit.js';
import { createCalls } from './calls.js';
import { createCustomers } from './customers.js';
import { createItems } from './items.js';
import { createNudges } from './nudges.js';
import { createStats } from './stats.js';
import { createVehicles } from './vehicles.js';
import { createParts } from './parts.js';
import { createWatch } from './watch.js';
import { createVehicleSources } from '../infra/vehicle-sources.js';
import { createAi } from '../infra/ai.js';

/**
 * `changed(event)` is told after something committed, so the web layer can tell open pages.
 * `now` is a clock a test can set.
 */
export function createApp({ db, now = Date.now, changed = () => {}, fetcher = globalThis.fetch, ai: aiOptions = {}, limits, log }) {
  const audit = createAudit(db, now);
  const shared = { db, audit, now, changed };
  const sources = createVehicleSources({ db, fetcher, now });
  const ai = aiOptions.suggest ? aiOptions : createAi({ ...aiOptions, fetcher, log });
  const nudges = createNudges(shared);
  const parts = createParts({ ...shared, ai, limits, log });
  const calls = createCalls(shared);
  return { audit, watch: createWatch({ ...shared, nudges, parts, calls }), vehicles: createVehicles({ ...shared, sources, log }), parts, customers: createCustomers(shared), items: createItems(shared), calls, nudges, stats: createStats(shared) };
}
