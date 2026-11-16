// The measurements that identify a part, by kind of part. Pure rules: what to ask for, reading
// what was typed, and turning it into a key the shop can remember an answer under.

const LENGTH = 'length';
const CHOICE = 'choice';
/** The jobs a customer can ask for besides a part, by key. */
export const SERVICE_TYPES = () => Object.entries(PART_TYPES).filter(([, t]) => t.service).map(([key, t]) => ({ key, label: t.label }));
export const PART_TYPES = Object.freeze({
  bearing: { label: 'Bearing', help: 'Measure the hole, the outside, and the thickness. Numbers stamped on it (like 6205) help too.', fields: [
    { key: 'id', short: 'id', label: 'Inner diameter (the hole)', kind: LENGTH }, { key: 'od', short: 'od', label: 'Outer diameter', kind: LENGTH }, { key: 'width', short: 'w', label: 'Width (thickness)', kind: LENGTH }] },
  seal: { label: 'Seal', help: 'Shaft diameter is what it rides on; bore is the hole it sits in.', fields: [
    { key: 'shaft', short: 'shaft', label: 'Shaft diameter (inside)', kind: LENGTH }, { key: 'bore', short: 'bore', label: 'Bore diameter (outside)', kind: LENGTH }, { key: 'width', short: 'w', label: 'Width (thickness)', kind: LENGTH }] },
  belt: { label: 'Belt', help: 'Length is easiest to read off the old belt’s printed number. Count the ribs on a serpentine belt.', fields: [
    { key: 'length', short: 'len', label: 'Length (outside)', kind: LENGTH }, { key: 'width', short: 'w', label: 'Width (top)', kind: LENGTH }, { key: 'ribs', short: 'ribs', label: 'Ribs (serpentine belts)', kind: 'count' }] },
  hose: { label: 'Hose', help: 'Measure the inside diameter of the hose, and its length along the curve.', fields: [
    { key: 'id', short: 'id', label: 'Inside diameter', kind: LENGTH }, { key: 'length', short: 'len', label: 'Length', kind: LENGTH }] },
  fitting: { label: 'Hydraulic fitting', help: 'Thread size and type are on the fitting or the old hose. If you can’t tell, send a photo.', fields: [
    { key: 'size', short: 'size', label: 'Size (like 3/8 or -6)', kind: 'text' }, { key: 'thread', short: 'thread', label: 'Thread (like JIC, NPT, ORFS)', kind: 'text' }, { key: 'ends', short: 'ends', label: 'Ends (male, female, swivel)', kind: 'text' }] },
  wiper: { label: 'Wiper blade', help: 'Length is stamped on the old blade or in the manual.', fields: [{ key: 'length', short: 'len', label: 'Length', kind: LENGTH }] },
  filter: { label: 'Filter', help: 'The thread size and the outside measurements. The number printed on the old one is best.', fields: [
    { key: 'od', short: 'od', label: 'Outer diameter', kind: LENGTH }, { key: 'height', short: 'h', label: 'Height', kind: LENGTH }, { key: 'thread', short: 'thread', label: 'Thread size (like 3/4-16)', kind: 'text' }] },
  // Jobs the shop does or arranges, not parts matched by size. The details still travel with the request,
  // but nothing here is looked up in the part finder, so it never spends an AI search.
  'hose-assembly': { service: true, label: 'Hydraulic hose assembly', help: 'Bring the old hose if you can and we can copy it. Photos of both ends help a lot.', fields: [
    { key: 'job', short: 'job', name: 'Job', label: 'What do you need', kind: CHOICE, options: ['Make a new assembly', 'Repair or re-crimp one', 'Not sure'] },
    { key: 'id', short: 'id', label: 'Hose inside diameter', kind: LENGTH }, { key: 'length', short: 'len', label: 'Finished length (end to end)', kind: LENGTH },
    { key: 'endA', short: 'a', name: 'End A', label: 'End A (size, thread, shape)', kind: 'text' }, { key: 'endB', short: 'b', name: 'End B', label: 'End B (size, thread, shape)', kind: 'text' },
    { key: 'pressure', short: 'psi', name: 'Pressure (psi)', label: 'Working pressure (psi), if known', kind: 'text' }, { key: 'use', short: 'use', name: 'On', label: 'What it’s on', kind: 'text' }] },
  paint: { service: true, label: 'Paint mixing', help: 'The paint code is on a sticker, usually in the driver’s door jamb. If you can’t find it, bring in the gas door or a small painted piece and we can match it.', fields: [
    { key: 'code', short: 'code', name: 'Paint code', label: 'Paint code', kind: 'text' }, { key: 'color', short: 'color', name: 'Color', label: 'Color name', kind: 'text' },
    { key: 'product', short: 'product', name: 'Product', label: 'Product', kind: CHOICE, options: ['Base coat', 'Single stage', 'Clear coat', 'Primer', 'Not sure'] },
    { key: 'amount', short: 'amount', name: 'Amount', label: 'How much', kind: CHOICE, options: ['Spray can', 'Half pint', 'Pint', 'Quart', 'Gallon', 'Not sure'] }] },
  battery: { service: true, label: 'Battery', help: 'The group size is printed on the label of the old battery. Bring it in and we’ll test it before you buy a new one.', fields: [
    { key: 'group', short: 'group', name: 'Group size', label: 'Group size (like 24F or 78)', kind: 'text' }, { key: 'cca', short: 'cca', name: 'CCA', label: 'Cold cranking amps (CCA), if known', kind: 'text' },
    { key: 'terminals', short: 'term', label: 'Terminals', kind: CHOICE, options: ['Top post', 'Side post', 'Not sure'] },
    { key: 'use', short: 'use', name: 'Going in', label: 'Going in', kind: CHOICE, options: ['Car or truck', 'Tractor or equipment', 'Boat or RV', 'Lawn and garden', 'Other'] },
    { key: 'test', short: 'test', name: 'Test old one', label: 'Test my old one first?', kind: CHOICE, options: ['Yes, test it', 'No, just a new one'] }] },
  'special-order': { service: true, label: 'Special order', help: 'Not on the shelf? Tell us what you can and we’ll find out what we can get and how long it takes.', fields: [
    { key: 'size', short: 'size', label: 'Size or specs', kind: 'text' }, { key: 'brand', short: 'brand', name: 'Brand', label: 'Brand, if you have one in mind', kind: 'text' }, { key: 'number', short: 'no', name: 'Part number', label: 'Part number, if known', kind: 'text' }] },
  other: { label: 'Something else', help: 'Tell us what it is in the note, and send photos.', fields: [] },
});

const MM_PER_INCH = 25.4;
const clean = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "25", "25.4", "1/2", "1 1/2", "1-1/2" → a number (or null). */
export function parseNumber(text) {
  const t = clean(text).replace(/,/g, '.').replace(/(\d)-(\d+\/)/, '$1 $2');
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  return /^\d*\.?\d+$/.test(t) ? Number(t) : null;
}
const round = (n, places = 1) => Number(n.toFixed(places));
/** Whether what was typed for a measuring field can be right: '' (nothing typed), 'number' (it can't), or null (fine). The form and the server use the same rule. */
export function fieldProblem(f, text, unit) {
  const t = clean(text);
  if (!t || f.kind === 'text' || f.kind === CHOICE) return null;
  const n = parseNumber(t);
  const limit = f.kind === 'count' ? 40 : unit === 'in' ? 200 : 5000;
  return n == null || n <= 0 || n > limit ? 'number' : null;
}

/**
 * Read a filled-in form. `get(name)` returns what was typed for a field. Returns the details to
 * keep, and `errors` for numbers that can't be right. Nothing is required: a half-filled form is
 * still useful to staff, but only a complete one makes a key the shop can match on.
 */
export function readMeasurements(type, unit, get) {
  const spec = PART_TYPES[type];
  if (!spec) return { error: 'type' };
  const u = unit === 'in' ? 'in' : 'mm';
  const values = {};
  const errors = [];
  for (const f of spec.fields) {
    const text = clean(get(`f_${f.key}`)).slice(0, 40);
    if (!text) continue;
    if (f.kind === 'text') { values[f.key] = { text }; continue; }
    if (f.kind === CHOICE) { // only what the form offered; anything else is dropped, not saved
      const option = f.options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (option) values[f.key] = { text: option };
      continue;
    }
    const n = parseNumber(text);
    if (fieldProblem(f, text, u)) { errors.push(f.key); continue; }
    values[f.key] = f.kind === 'count' ? { text, n: Math.round(n) } : { text, n, mm: round(u === 'in' ? n * MM_PER_INCH : n, 1) };
  }
  return { ok: errors.length === 0, type, unit: u, values, errors };
}

/** The key a remembered answer is filed under, or null until every field is filled in. Same part, same key, in any unit. */
export function measureKey(type, values) {
  const spec = PART_TYPES[type];
  if (!spec || !spec.fields.length || type === 'other' || spec.service) return null;
  const parts = [];
  for (const f of spec.fields) {
    const v = values?.[f.key];
    if (!v) return null;
    if (f.kind === 'text') parts.push(`${f.short}${clean(v.text).toLowerCase().replace(/[^a-z0-9/.-]+/g, '')}`);
    else if (f.kind === 'count') parts.push(`${f.short}${v.n}`);
    else parts.push(`${f.short}${v.mm}`);
  }
  return `${type} ${parts.join(' ')} mm`;
}

/** For people: "Bearing: inner diameter 25 mm, outer diameter 52 mm …" */
export function describeMeasurements(type, unit, values) {
  const spec = PART_TYPES[type];
  if (!spec) return '';
  return spec.fields.filter((f) => values?.[f.key]).map((f) => `${f.name ?? f.label.replace(/ \(.*\)$/, '')} ${values[f.key].text}${f.kind === LENGTH ? ` ${unit}` : ''}`).join(', ');
}

/**
 * What the AI said about photos of a part, made safe. The AI only suggests: a type that exists, and
 * values for that type's own fields that were read off the part (a stamped size, a printed number),
 * never judged by eye. Anything else is dropped. The customer still checks every value.
 */
export function cleanPartReading(raw) {
  const type = Object.hasOwn(PART_TYPES, raw?.type) ? raw.type : '';
  const spec = type ? PART_TYPES[type] : null;
  const unit = raw?.unit === 'in' ? 'in' : 'mm';
  const values = {};
  if (spec) {
    const given = raw?.values && typeof raw.values === 'object' ? raw.values : {};
    for (const f of spec.fields) {
      const entry = given[f.key];
      const text = clean(typeof entry === 'object' && entry ? entry.value : entry).slice(0, 40);
      if (!text || (typeof entry === 'object' && entry && entry.source !== 'printed')) continue;
      if (f.kind === 'text') { values[f.key] = text; continue; }
      if (f.kind === CHOICE) { const o = f.options.find((x) => x.toLowerCase() === text.toLowerCase()); if (o) values[f.key] = o; continue; }
      if (parseNumber(text) != null && !fieldProblem(f, text, unit)) values[f.key] = text;
    }
  }
  const list = (v, n, max) => (Array.isArray(v) ? v.map((x) => clean(x).slice(0, max)).filter(Boolean).slice(0, n) : []);
  const confidence = ['low', 'medium', 'high'].includes(raw?.confidence) ? raw.confidence : 'low';
  return { type, label: spec?.label ?? '', confidence, unit, values, markings: list(raw?.markings, 6, 40), questions: list(raw?.questions, 4, 120), note: clean(raw?.note).slice(0, 200) };
}
