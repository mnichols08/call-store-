// What the customer portal says, as plain rules: addresses, the steps a request goes through, and
// the words a customer sees for them.

/** A tidy, lower-case email, or null if it can't be one. */
export function cleanEmail(text) {
  const t = String(text ?? '').trim().toLowerCase();
  return t.length <= 120 && /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/.test(t) ? t : null;
}

/** What staff can tell the customer. `kind` is stored; `label` is what the customer reads. */
export const UPDATE_KINDS = Object.freeze({
  received: { label: 'We got your request', staff: false },
  looking: { label: 'We’re looking into it', staff: true },
  'need-info': { label: 'We need a bit more from you', staff: true },
  confirmed: { label: 'Part confirmed', staff: true },
  available: { label: 'In stock', staff: true },
  ordered: { label: 'Ordered for you', staff: true },
  'on-the-way': { label: 'On the way', staff: true },
  ready: { label: 'Ready for pickup', staff: true },
  unavailable: { label: 'We can’t get it', staff: true },
  done: { label: 'All done', staff: true },
  'customer-note': { label: 'You added a note', staff: false },
});
export const STAFF_KINDS = Object.freeze(Object.entries(UPDATE_KINDS).filter(([, v]) => v.staff).map(([k]) => k));

/** Done kinds end a request's "open" life on the customer's dashboard. */
export const FINISHED = new Set(['done', 'unavailable']);

/** The request's current state for the customer: the latest shop update, or "received". */
export function currentKind(updates, callStatus) {
  const latest = [...updates].reverse().find((u) => u.kind !== 'customer-note');
  if (latest) return latest.kind;
  return callStatus === 'closed' || callStatus === 'resolved' ? 'done' : 'received';
}
export const isOpenForCustomer = (kind, callStatus) => !FINISHED.has(kind) && !(callStatus === 'closed' && kind === 'received');
