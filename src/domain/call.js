// The call: the unit of work. These rules need no database, no web server and no UI framework.
//
// Workflow status, assignment and help are three separate things: a call can be parked and still
// belong to someone, or be open and asking for help.

export const STATUSES = Object.freeze(['open', 'working', 'parked', 'resolved', 'closed']);
export const STATUS_LABEL = Object.freeze({ open: 'Open', working: 'Working', parked: 'Parked', resolved: 'Resolved', closed: 'Closed' });

// Where each status may go next.
const NEXT = Object.freeze({
  open: ['working', 'parked', 'resolved', 'closed'],
  working: ['parked', 'resolved', 'closed', 'open'],
  parked: ['working', 'open', 'resolved', 'closed'],
  resolved: ['closed', 'working'],
  closed: ['open'],
});

export const canMove = (from, to) => (NEXT[from] ?? []).includes(to);

export const PRIORITIES = Object.freeze(['low', 'normal', 'high']);

export const OUTCOMES = Object.freeze({
  quoted: 'Quoted',
  sold: 'Sold',
  'no-sale': 'No sale',
  unavailable: 'Unavailable',
  declined: 'Customer declined',
  callback: 'Callback required',
  referred: 'Transferred / referred',
  'closed-no-sale': 'Closed without sale',
});

export const HELP = Object.freeze(['normal', 'anyone', 'specific']);

export const APPLICATION_FIELDS = Object.freeze(['year', 'make', 'model', 'engine', 'drivetrain', 'vin', 'unit', 'freeform']);

const clean = (value, max) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

/**
 * The fields of a call, cleaned. Everything is optional: a call with none of them is valid, and
 * "6205-2RS" alone, or only a caller's phone, is a fine call. Returns only the fields given.
 */
export function cleanCallFields(input = {}) {
  const out = {};
  if ('caller_name' in input) out.caller_name = clean(input.caller_name, 120);
  if ('caller_phone' in input) out.caller_phone = clean(input.caller_phone, 40);
  if ('request' in input) out.request = clean(input.request, 2000);
  if ('part_numbers' in input) out.part_numbers = clean(input.part_numbers, 500);
  if ('notes' in input) out.notes = clean(input.notes, 5000);
  if ('quantity' in input) {
    const text = clean(input.quantity, 10);
    const n = Number(text);
    out.quantity = text === '' ? null : Number.isInteger(n) && n > 0 && n <= 100000 ? n : undefined;
    if (out.quantity === undefined) return { error: 'quantity' };
  }
  if ('priority' in input) {
    if (!PRIORITIES.includes(input.priority)) return { error: 'priority' };
    out.priority = input.priority;
  }
  if ('application' in input) {
    const app = {};
    for (const key of APPLICATION_FIELDS) {
      const value = clean(input.application?.[key], key === 'freeform' ? 1000 : 120);
      if (value) app[key] = value;
    }
    out.application = app;
  }
  return out;
}

/** Closing a call records what came of it. */
export function cleanOutcome(input = {}) {
  if (!(input.outcome in OUTCOMES)) return { error: 'outcome' };
  const data = {};
  for (const key of ['final_parts', 'brand', 'reference', 'resolution']) {
    const value = clean(input[key], key === 'resolution' ? 2000 : 200);
    if (value) data[key] = value;
  }
  const qty = clean(input.final_quantity, 10);
  if (qty) {
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) return { error: 'final_quantity' };
    data.quantity = n;
  }
  const price = clean(input.price, 20).replace(/[$,\s]/g, '');
  if (price) {
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) return { error: 'price' };
    data.cents = Math.round(dollars * 100);
  }
  return { outcome: input.outcome, data };
}

/** What a coworker sees at a glance in the queue. */
export function summarize(call) {
  const app = call.application ?? {};
  const vehicle = [app.year, app.make, app.model, app.engine].filter(Boolean).join(' ');
  return {
    title: call.request || call.part_numbers || vehicle || app.freeform || (call.caller_name ? `Call from ${call.caller_name}` : 'New call'),
    application: vehicle || app.freeform || '',
  };
}
