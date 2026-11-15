// What is known about a vehicle, as pure rules: reading a VIN, tidying what the sources say, and
// finding the closest match to what someone typed. No network and no database here.

const VIN_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no I, O or Q
const TRANSLITERATE = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** A VIN as typed, tidied: upper case, spaces and dashes removed. */
export const cleanVin = (text) => String(text ?? '').toUpperCase().replace(/[\s-]+/g, '');

/**
 * Whether `text` can be a VIN: 17 characters, no I, O or Q. `checkDigit` says whether the ninth
 * character agrees with the rest (North American vehicles must; others often don't, so a mismatch
 * is a warning, never a refusal).
 */
export function readVin(text) {
  const vin = cleanVin(text);
  if (vin.length !== 17) return { ok: false, vin, reason: 'length' };
  if (!new RegExp(`^[0-9${VIN_LETTERS}]{17}$`).test(vin)) return { ok: false, vin, reason: 'characters' };
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += (/\d/.test(vin[i]) ? Number(vin[i]) : TRANSLITERATE[vin[i]]) * WEIGHTS[i];
  const expected = sum % 11 === 10 ? 'X' : String(sum % 11);
  return { ok: true, vin, checkDigit: vin[8] === expected };
}

/** Only the end of a VIN, for logs and the audit trail: enough to find it, not to look it up. */
export const maskVin = (vin) => (vin ? `…${String(vin).slice(-6)}` : '');

const MAKES_ALIASES = { chevy: 'chevrolet', vw: 'volkswagen', merc: 'mercedes benz', mercedes: 'mercedes benz', benz: 'mercedes benz', olds: 'oldsmobile', caddy: 'cadillac', landrover: 'land rover', rover: 'land rover', alfa: 'alfa romeo', gmc: 'gmc', dodge: 'dodge' };

/** Letters and digits only, lower case, single spaces: "F-150" and "f150" both become "f150". */
export const norm = (text) => String(text ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (text) => norm(text).replace(/ /g, '');

function distance(a, b) {
  // Optimal string alignment distance (edits, and swapping two neighbours, cost one).
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
const similarity = (a, b) => (a || b ? 1 - distance(a, b) / Math.max(a.length, b.length) : 1);

/** Expand a typed query: "chevy silverado" → tokens that can be matched against make and model. */
function queryTokens(query) {
  return norm(query).split(' ').filter(Boolean).flatMap((token) => (MAKES_ALIASES[token] ?? token).split(' '));
}

/**
 * The vehicles closest to what someone typed, best first. `rows` are `{ make, model }` (all for
 * one year, or several). The query can be a model ("silverado", "f150", a slip like "silvrado"),
 * or a make and model ("chevy silverado 1500"). Scores run 0 to 100; below 45 isn't a match.
 */
export function matchVehicles(query, rows, { limit = 8 } = {}) {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const flat = tokens.join('');
  const seen = new Map();
  for (const row of rows) {
    const model = squash(row.model);
    const make = squash(row.make);
    const both = `${make}${model}`;
    const words = norm(`${row.make} ${row.model}`).split(' ');
    let score = 0;
    if (flat === model) score = 100;
    else if (flat === both) score = 98;
    else if (model.startsWith(flat) && flat.length >= 2) score = 88 + Math.min(8, Math.round((flat.length / model.length) * 8));
    else if (tokens.every((t) => words.some((w) => w === t || (t.length >= 2 && w.startsWith(t))))) score = 78 + Math.round((tokens.length / words.length) * 10);
    else {
      // A slip in what was typed: compare with the start of the model too, since people type the short name.
      const starts = [-1, 0, 1].map((d) => similarity(flat, model.slice(0, Math.max(1, flat.length + d))));
      score = Math.round(Math.max(similarity(flat, model) * 70, similarity(flat, both) * 70, Math.max(...starts) * 85, similarity(flat, make) * 42));
    }
    if (score < 45) continue;
    const key = `${row.make.toLowerCase()}|${row.model.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || score > existing.score) seen.set(key, { make: row.make, model: row.model, score, year: row.year });
  }
  return [...seen.values()].sort((a, b) => b.score - a.score || a.model.length - b.model.length || a.model.localeCompare(b.model)).slice(0, limit);
}

/** NHTSA and EPA spell drivetrains many ways; the counter wants one of five. */
export function drivetrainOf(text) {
  const t = String(text ?? '').toUpperCase();
  if (!t.trim()) return '';
  if (/\b4WD\b|4X4|4[- ]WHEEL|FOUR[- ]WHEEL/.test(t)) return '4WD';
  if (/\bAWD\b|ALL[- ]WHEEL|4X2.*AWD/.test(t)) return 'AWD';
  if (/\bRWD\b|REAR[- ]WHEEL|4X2|6X4|8X4/.test(t)) return 'RWD';
  if (/\bFWD\b|FRONT[- ]WHEEL/.test(t)) return 'FWD';
  if (/\b2WD\b|2[- ]WHEEL|TWO[- ]WHEEL/.test(t)) return '2WD';
  return String(text).trim().slice(0, 30);
}

/** "5.7L V8 gas" from the pieces a source gives. */
export function engineLabel({ displacement, cylinders, fuel, model } = {}) {
  const parts = [];
  const liters = Number.parseFloat(displacement);
  if (Number.isFinite(liters) && liters > 0) parts.push(`${Number(liters.toFixed(1))}L`);
  const cyl = Number.parseInt(cylinders, 10);
  // Every source gives the cylinder count but few say how they're laid out, so the label is the same whichever one answered.
  if (cyl > 0) parts.push(cyl >= 8 ? `V${cyl}` : `${cyl}-cyl`);
  const fuelText = String(fuel ?? '').toLowerCase();
  if (fuelText.includes('diesel')) parts.push('diesel');
  else if (fuelText.includes('electric') && !fuelText.includes('gas')) parts.push('electric');
  else if (fuelText.includes('flex') || fuelText.includes('e85')) parts.push('flex-fuel');
  const name = String(model ?? '').trim();
  if (name && !parts.join(' ').includes(name)) parts.push(`(${name})`);
  return parts.join(' ');
}

/** What the counter calls a vehicle: "2015 Chevrolet Silverado 1500 5.3L V8 4WD". */
export const describeVehicle = (v) => [v.year, v.make, v.model, v.engine, v.drivetrain].filter(Boolean).join(' ');

/** The part of a vehicle that decides which part fits, as a stable key (lower case, no punctuation). */
export const vehicleKey = (v) => [v.year ?? '', norm(v.make), norm(v.model), norm(v.engine), norm(v.drivetrain)].join('|');
