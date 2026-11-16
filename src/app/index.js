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
import { createDetails } from './details.js';
import { createLines } from './lines.js';
import { createPortal } from './portal.js';
import { createHours } from './hours.js';
import { createOrders } from './orders.js';
import { createDelivery } from './delivery.js';
import { createMailer } from '../infra/mail.js';
import { createVehicleSources } from '../infra/vehicle-sources.js';
import { createAi } from '../infra/ai.js';
import { createTexter } from '../infra/sms.js';

/**
 * `changed(event)` is told after something committed, so the web layer can tell open pages.
 * `now` is a clock a test can set.
 */
export function createApp({ db, now = Date.now, changed = () => {}, fetcher = globalThis.fetch, ai: aiOptions = {}, mail: mailOptions = {}, sms: smsOptions = {}, business, zone, limits, log }) {
  const audit = createAudit(db, now);
  const shared = { db, audit, now, changed };
  const sources = createVehicleSources({ db, fetcher, now });
  const ai = aiOptions.suggest ? aiOptions : createAi({ ...aiOptions, fetcher, log });
  const nudges = createNudges(shared);
  const parts = createParts({ ...shared, ai, limits, log });
  const calls = createCalls(shared);
  const lines = createLines(shared);
  const details = createDetails({ ...shared, nudges, ai, log });
  const mailer = mailOptions.send ? mailOptions : createMailer({ db, now, fetcher, log, ...mailOptions });
  const texter = smsOptions.send ? smsOptions : createTexter({ db, now, fetcher, log, ...smsOptions });
  const customers = createCustomers(shared);
  const portal = createPortal({ ...shared, details, calls, mailer, business, nudges, customers });
  const hours = createHours({ ...shared, zone });
  const orders = createOrders({ ...shared, ai, customers, log });
  const delivery = createDelivery({ ...shared, portal });
  return { audit, lines, details, portal, mailer, texter, hours, orders, delivery, watch: createWatch({ ...shared, nudges, parts, calls }), vehicles: createVehicles({ ...shared, sources, log }), parts, customers, items: createItems(shared), calls, nudges, stats: createStats(shared) };
}
