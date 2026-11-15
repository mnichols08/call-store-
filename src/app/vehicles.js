// Vehicles: reading a VIN, the year / make / model / engine / drivetrain picker, "closest match",
// and a customer's saved vehicles. Whatever the outside services say is kept, so the next person
// who asks the same thing gets the answer from the shop's own database.
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';
import { drivetrainOf, engineLabel, matchVehicles, maskVin, norm, readVin } from '../domain/vehicle.js';
import { SourceError } from '../infra/vehicle-sources.js';

const YEAR = /\b(19[5-9]\d|20[0-3]\d)\b/;
const DAY = 86_400_000;

// Makes worth trying even when the EPA doesn't list them (heavy trucks, farm and work vehicles).
export const COMMON_MAKES = ['Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat', 'Ford', 'Freightliner', 'Genesis', 'GMC', 'Honda', 'Hino',
  'Hyundai', 'Infiniti', 'International', 'Isuzu', 'Jaguar', 'Jeep', 'Kenworth', 'Kia', 'Land Rover', 'Lexus', 'Lincoln', 'Mack', 'Mazda', 'Mercedes-Benz', 'Mercury', 'MINI',
  'Mitsubishi', 'Nissan', 'Oldsmobile', 'Peterbilt', 'Plymouth', 'Pontiac', 'Porsche', 'Ram', 'Saturn', 'Scion', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'];

const SHORT_UPPER = new Set(['GMC', 'BMW', 'MINI']);
/** NHTSA gives makes in capitals: "CHEVROLET", "MERCEDES-BENZ", "GMC". */
export function titleCase(text) {
  return String(text ?? '').trim().split(/(\s+|-)/).map((w) => (SHORT_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : /^[A-Z]/.test(w) && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)).join('');
}

async function pool(items, size, work) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i], i);
    }
  }));
  return results;
}

export function createVehicles({ db, audit, now, sources, log }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });
  const building = new Map();

  const addModel = db.prepare('INSERT OR IGNORE INTO vehicle_models (year, make, model, norm) VALUES (?, ?, ?, ?)');
  const addSpec = db.prepare(`INSERT INTO vehicle_specs (year, make, model, engine, drivetrain, trim, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (year, make, model, engine, drivetrain, trim) DO UPDATE SET seen = seen + 1`);

  /** Keep what a source or a person told us about a vehicle. */
  function keep(spec, source) {
    const year = Number(spec.year);
    const make = clip(spec.make, 60);
    const model = clip(spec.model, 80);
    if (!Number.isInteger(year) || year < 1900 || year > 2100 || !make || !model) return false;
    addModel.run(year, make, model, norm(model));
    if (spec.engine || spec.drivetrain || spec.trim) addSpec.run(year, make, model, clip(spec.engine, 80), clip(spec.drivetrain, 30), clip(spec.trim, 60), source, now());
    return true;
  }

  /** Index a year: every model NHTSA lists for every make worth trying. Done once, then it's local. */
  function ensureIndex(year) {
    const done = db.prepare('SELECT built_at FROM vehicle_index_years WHERE year = ?').get(year);
    if (done && now() - done.built_at < 180 * DAY) return Promise.resolve({ built: true });
    if (building.has(year)) return building.get(year);
    const job = (async () => {
      let makes = [...COMMON_MAKES];
      try {
        const known = new Set(makes.map((m) => m.toLowerCase()));
        for (const m of await sources.epaMakes(year)) if (!known.has(m.toLowerCase())) makes.push(m);
      } catch {}
      makes = [...new Set(makes)];
      let failed = 0;
      const lists = await pool(makes, 6, async (make) => {
        try {
          return await sources.modelsForMakeYear(make, year);
        } catch {
          failed += 1;
          return [];
        }
      });
      db.exec('BEGIN');
      try {
        for (const list of lists) for (const r of list) addModel.run(year, titleCase(r.make), r.model, norm(r.model));
        if (failed <= makes.length / 2) db.prepare('INSERT OR REPLACE INTO vehicle_index_years (year, built_at, makes) VALUES (?, ?, ?)').run(year, now(), makes.length - failed);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { built: failed <= makes.length / 2, failed };
    })().finally(() => building.delete(year));
    building.set(year, job);
    return job;
  }
  const indexed = (year) => Boolean(db.prepare('SELECT 1 FROM vehicle_index_years WHERE year = ?').get(year));

  return {
    /** Read a VIN with NHTSA. The VIN is kept only if someone saves it to a customer or call. */
    async decode(who, text) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      const read = readVin(text);
      if (!read.ok) return { error: read.reason === 'length' ? 'vin-length' : 'vin-characters' };
      let record;
      try {
        record = await sources.decodeVin(read.vin);
      } catch (error) {
        if (error instanceof SourceError) {
          log?.warn('vin decode unavailable', { message: error.message });
          return { error: 'source' };
        }
        throw error;
      }
      const make = titleCase(record.Make);
      const year = Number.parseInt(record.ModelYear, 10);
      if (!make || !Number.isInteger(year)) return { error: 'vin-unknown', detail: clip(record.ErrorText, 200) };
      const spec = {
        vin: read.vin,
        year,
        make,
        model: clip(record.Model, 80),
        trim: clip(record.Trim || record.Series, 60),
        engine: engineLabel({ displacement: record.DisplacementL, cylinders: record.EngineCylinders, fuel: record.FuelTypePrimary, config: record.EngineConfiguration, model: record.EngineModel }),
        drivetrain: drivetrainOf(record.DriveType),
        body: clip(record.BodyClass, 60),
      };
      const warnings = [];
      if (!read.checkDigit) warnings.push('The VIN’s check digit doesn’t add up. Double-check the characters.');
      const codes = String(record.ErrorCode ?? '0').split(',').map((c) => c.trim()).filter((c) => c && c !== '0');
      if (codes.length && record.ErrorText) warnings.push(clip(String(record.ErrorText).replace(/^\d+ - /, ''), 200));
      keep(spec, 'vin');
      audit.record(who.email, 'vehicle.vin', `vin:${maskVin(read.vin)}`, { year, make, model: spec.model });
      return { ok: true, spec, warnings };
    },

    /** Makes for a year. Quick: from what's indexed, else a short list; the index builds in the background. */
    async makes(who, year) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      if (!Number.isInteger(year) || year < 1950 || year > 2100) return { error: 'year' };
      if (indexed(year)) return { ok: true, makes: db.prepare('SELECT DISTINCT make FROM vehicle_models WHERE year = ? ORDER BY make').all(year).map((r) => r.make), indexed: true };
      ensureIndex(year).catch(() => {});
      const set = new Map(COMMON_MAKES.map((m) => [m.toLowerCase(), m]));
      for (const r of db.prepare('SELECT DISTINCT make FROM vehicle_models WHERE year = ?').all(year)) set.set(r.make.toLowerCase(), r.make);
      return { ok: true, makes: [...set.values()].sort((a, b) => a.localeCompare(b)), indexed: false };
    },

    async models(who, year, make) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      const name = clip(make, 60);
      if (!Number.isInteger(year) || !name) return { error: 'year' };
      const local = () => db.prepare('SELECT DISTINCT model FROM vehicle_models WHERE year = ? AND make = ? ORDER BY model').all(year, name).map((r) => r.model);
      let models = local();
      if (!models.length) {
        try {
          for (const r of await sources.modelsForMakeYear(name, year)) addModel.run(year, titleCase(r.make), r.model, norm(r.model));
        } catch {}
        models = local();
      }
      return { ok: true, models };
    },

    /** Engines and drivetrains for a vehicle: what the shop knows first, the EPA's list if it knows little. */
    async options(who, year, make, model) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      const [m, md] = [clip(make, 60), clip(model, 80)];
      if (!Number.isInteger(year) || !m || !md) return { error: 'year' };
      const known = () => db.prepare('SELECT engine, drivetrain, trim, source, seen FROM vehicle_specs WHERE year = ? AND make = ? AND model = ? ORDER BY seen DESC, engine').all(year, m, md);
      let rows = known();
      let source = rows.length ? 'memory' : 'none';
      if (!rows.some((r) => r.source === 'epa' || r.source === 'vin')) {
        try {
          for (const v of await sources.epaVariants(year, m, md)) {
            const d = v.data ?? {};
            keep({ year, make: m, model: md, engine: engineLabel({ displacement: d.displ, cylinders: d.cylinders, fuel: d.fuelType1 }), drivetrain: drivetrainOf(d.drive || v.label), trim: '' }, 'epa');
          }
          rows = known();
          if (rows.length) source = 'epa';
        } catch {}
      }
      const uniq = (key) => [...new Map(rows.filter((r) => r[key]).map((r) => [r[key].toLowerCase(), r[key]])).values()];
      return { ok: true, engines: uniq('engine'), drivetrains: uniq('drivetrain'), combos: rows, source };
    },

    /**
     * The closest vehicles to "2015 silverado": the year can be typed in the text or given. The first
     * search for a year builds that year's index from NHTSA (a few seconds); after that it's local.
     */
    async match(who, { year, text }) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      let query = String(text ?? '');
      let y = Number(year) || null;
      const typed = YEAR.exec(query);
      if (typed) {
        y ??= Number(typed[1]);
        query = query.replace(typed[0], ' ');
      }
      if (!norm(query)) return { error: 'empty' };
      let partial = false;
      if (y) {
        try {
          partial = !(await ensureIndex(y)).built;
        } catch {
          partial = true;
        }
      }
      const rows = y
        ? db.prepare('SELECT year, make, model FROM vehicle_models WHERE year = ?').all(y)
        : db.prepare('SELECT year, make, model FROM vehicle_models LIMIT 30000').all();
      return { ok: true, year: y, matches: matchVehicles(query, rows), partial: partial && !rows.length ? true : partial };
    },

    /** Remember a vehicle someone picked or typed, so the engine and drivetrain lists grow with use. */
    remember(who, spec) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      return { ok: keep(spec, 'picked') };
    },

    // ------------------------------------------------------------ a customer's vehicles
    saveFor(who, customerId, spec) {
      const no = deny(who, 'vehicle.save');
      if (no) return no;
      if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) return { error: 'customer' };
      const read = spec.vin ? readVin(spec.vin) : { ok: false };
      const vin = read.ok ? read.vin : '';
      if (!vin && !(spec.year && spec.make && spec.model)) return { error: 'vehicle' };
      const t = now();
      const existing = vin ? db.prepare('SELECT id FROM customer_vehicles WHERE customer_id = ? AND vin = ?').get(customerId, vin)
        : db.prepare("SELECT id FROM customer_vehicles WHERE customer_id = ? AND vin = '' AND year IS ? AND make = ? AND model = ? AND engine = ?").get(customerId, Number(spec.year) || null, clip(spec.make, 60), clip(spec.model, 80), clip(spec.engine, 80));
      if (existing) {
        db.prepare('UPDATE customer_vehicles SET last_used_at = ? WHERE id = ?').run(t, existing.id);
        return { ok: true, id: existing.id, existing: true };
      }
      const { lastInsertRowid } = db.prepare(`INSERT INTO customer_vehicles (customer_id, vin, year, make, model, engine, drivetrain, trim, created_by, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(customerId, vin, Number(spec.year) || null, clip(spec.make, 60), clip(spec.model, 80), clip(spec.engine, 80), clip(spec.drivetrain, 30), clip(spec.trim, 60), who.email, t, t);
      audit.record(who.email, 'vehicle.saved', `customer:${customerId}`, { vin: maskVin(vin), make: clip(spec.make, 60), model: clip(spec.model, 80) });
      return { ok: true, id: Number(lastInsertRowid) };
    },
    forCustomer(who, customerId) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      return { ok: true, vehicles: db.prepare('SELECT * FROM customer_vehicles WHERE customer_id = ? ORDER BY last_used_at DESC').all(customerId) };
    },
    get(who, id) {
      const no = deny(who, 'vehicle.lookup');
      if (no) return no;
      const v = db.prepare('SELECT * FROM customer_vehicles WHERE id = ?').get(id);
      return v ? { ok: true, vehicle: v } : { error: 'missing' };
    },
    touch(who, id) {
      db.prepare('UPDATE customer_vehicles SET last_used_at = ? WHERE id = ?').run(now(), id);
    },
    removeFor(who, id) {
      const no = deny(who, 'vehicle.save');
      if (no) return no;
      const v = db.prepare('SELECT customer_id, vin FROM customer_vehicles WHERE id = ?').get(id);
      if (!v) return { error: 'missing' };
      db.prepare('DELETE FROM customer_vehicles WHERE id = ?').run(id);
      audit.record(who.email, 'vehicle.removed', `customer:${v.customer_id}`, { vin: maskVin(v.vin) });
      return { ok: true };
    },
  };
}
