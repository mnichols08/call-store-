// Where vehicle facts come from: NHTSA's vPIC (VIN decoding, models by make and year) and
// fueleconomy.gov (makes, models and engines of light vehicles). Both are free and need no key.
//
// Every answer is cached in the database, so a question is asked of the outside world once. The
// network is injected (`fetcher`), so tests never leave the machine. A source that is down throws
// `SourceError`; callers fall back to what the shop already knows.
import { createHash } from 'node:crypto';

export class SourceError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'SourceError';
    this.status = status;
  }
}

const DAY = 86_400_000;
const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const EPA = 'https://www.fueleconomy.gov/ws/rest/vehicle';
const toArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

export function createVehicleSources({ db, fetcher = globalThis.fetch, now = Date.now, timeoutMs = 10_000, ttl = { decode: 90 * DAY, lists: 30 * DAY } } = {}) {
  const inflight = new Map();
  const read = db.prepare('SELECT body, fetched_at FROM http_cache WHERE key = ?');
  const write = db.prepare('INSERT INTO http_cache (key, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at');

  /** GET json, from the cache when it's fresh. Keyed by a hash, so a VIN never sits in a key. */
  async function getJson(url, maxAge) {
    const key = createHash('sha256').update(url).digest('hex');
    const hit = read.get(key);
    if (hit && now() - hit.fetched_at < maxAge) return JSON.parse(hit.body);
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      let response;
      try {
        response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        if (hit) return JSON.parse(hit.body); // stale beats nothing
        throw new SourceError(`${new URL(url).host} could not be reached`, { cause: error });
      }
      if (!response.ok) {
        if (hit) return JSON.parse(hit.body);
        throw new SourceError(`${new URL(url).host} answered ${response.status}`, { status: response.status });
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        throw new SourceError(`${new URL(url).host} sent something unreadable`, { cause: error });
      }
      write.run(key, JSON.stringify(body), now());
      return body;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  return {
    /** NHTSA's decode of a VIN: one flat record of strings. */
    async decodeVin(vin, modelYear) {
      const url = `${VPIC}/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json${modelYear ? `&modelyear=${encodeURIComponent(modelYear)}` : ''}`;
      const body = await getJson(url, ttl.decode);
      return body?.Results?.[0] ?? {};
    },

    /** Every model of a make sold in a year, from NHTSA (it includes heavy trucks the EPA list doesn't). */
    async modelsForMakeYear(make, year) {
      const body = await getJson(`${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`, ttl.lists);
      return toArray(body?.Results).map((r) => ({ make: String(r.Make_Name ?? make).trim(), model: String(r.Model_Name ?? '').trim() })).filter((r) => r.model);
    },

    /** The makes the EPA lists for a year (light vehicles only). */
    async epaMakes(year) {
      const body = await getJson(`${EPA}/menu/make?year=${encodeURIComponent(year)}`, ttl.lists);
      return toArray(body?.menuItem).map((i) => String(i.value ?? i.text ?? '').trim()).filter(Boolean);
    },

    /** The EPA's engine and drivetrain variants of a model: one record each. */
    async epaVariants(year, make, model) {
      const menu = await getJson(`${EPA}/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`, ttl.lists);
      const options = toArray(menu?.menuItem).map((i) => ({ id: String(i.value ?? '').trim(), label: String(i.text ?? '').trim() })).filter((o) => o.id).slice(0, 40);
      const out = [];
      for (let i = 0; i < options.length; i += 8) {
        const batch = await Promise.all(options.slice(i, i + 8).map(async (o) => {
          try {
            return { ...o, data: await getJson(`${EPA}/${encodeURIComponent(o.id)}`, ttl.lists) };
          } catch {
            return null;
          }
        }));
        out.push(...batch.filter(Boolean));
      }
      return out;
    },
  };
}
