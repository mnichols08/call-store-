// Delivery rules: which towns the shop's own delivery area covers, what a delivery record may hold,
// and the stages it goes through. Pure.
import { SHOP } from './shop.js';

const STATE = { Maryland: 'MD', 'West Virginia': 'WV' };
export const STATUSES = Object.freeze(['requested', 'ready', 'out', 'delivered']);
export const STATUS_LABEL = Object.freeze({ requested: 'Asked for', ready: 'Ready to go', out: 'Out for delivery', delivered: 'Delivered' });
/** What a person can do next from each stage. */
export const NEXT = Object.freeze({ requested: ['ready', 'out', 'delivered'], ready: ['out', 'delivered'], out: ['delivered'], delivered: [] });

/** The delivery towns, from the shop's service areas: `{ value: 'Oakland, MD', town: 'Oakland' }`. */
export function deliveryTowns(shop = SHOP) {
  return shop.serviceAreas.flatMap(([state, towns]) => towns.split(',').map((t) => t.trim()).filter(Boolean).map((town) => ({ town, value: `${town}, ${STATE[state] ?? state}` })));
}

const plain = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Is this town inside the usual delivery area? Compared without case or the state suffix. */
export function inArea(town, shop = SHOP) {
  const t = plain(town, 80).toLowerCase().replace(/,\s*(md|wv|maryland|west virginia)\.?$/, '').replace(/^mt\.?\s/, 'mountain ');
  return deliveryTowns(shop).some((x) => x.town.toLowerCase().replace(/^mt\.?\s/, 'mountain ') === t);
}

/**
 * What was typed, made tidy: `{ ok, town, address, note, outside }`, or `{ error: 'address' }` when
 * there's nowhere to take it. `known` is the address on the customer's account, or `true` when the
 * shop knows where they are without one written down: then nothing has to be typed.
 */
export function cleanDelivery(input, shop = SHOP, { known = false } = {}) {
  const town = plain(input?.town, 60);
  const address = plain(input?.address, 200) || (typeof known === 'string' ? plain(known, 200) : '');
  const note = plain(input?.note, 200);
  if (!address && !known) return { error: 'address' };
  return { ok: true, town, address, note, outside: town ? !inArea(town, shop) : !known };
}
