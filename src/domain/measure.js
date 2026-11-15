// The measurements that identify a part, by kind of part. Pure rules: what to ask for, reading
// what was typed, and turning it into a key the shop can remember an answer under.

const LENGTH = 'length';
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
    const n = parseNumber(text);
    const limit = f.kind === 'count' ? 40 : u === 'in' ? 200 : 5000;
    if (n == null || n <= 0 || n > limit) { errors.push(f.key); continue; }
    values[f.key] = f.kind === 'count' ? { text, n: Math.round(n) } : { text, n, mm: round(u === 'in' ? n * MM_PER_INCH : n, 1) };
  }
  return { ok: errors.length === 0, type, unit: u, values, errors };
}

/** The key a remembered answer is filed under, or null until every field is filled in. Same part, same key, in any unit. */
export function measureKey(type, values) {
  const spec = PART_TYPES[type];
  if (!spec || !spec.fields.length || type === 'other') return null;
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
  return spec.fields.filter((f) => values?.[f.key]).map((f) => `${f.label.replace(/ \(.*\)$/, '')} ${values[f.key].text}${f.kind === LENGTH ? ` ${unit}` : ''}`).join(', ');
}
