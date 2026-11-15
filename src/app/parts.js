// Finding the part that fits. The shop's own memory always comes first: answers staff confirmed,
// answers the AI gave before, answers someone taught. The AI is asked only when the shop knows
// nothing for the question, or when a person asks for a fresh search. Feedback ("it worked",
// "it didn't") makes the shop's memory better, so the same question isn't asked twice.
import { can } from '../domain/permissions.js';
import { clip } from '../domain/text.js';
import { isBad, isConfirmed, looksLikePartNumber, numberKey, scoreAnswer, termKey } from '../domain/parts.js';
import { describeVehicle, norm } from '../domain/vehicle.js';

const HOUR = 3_600_000;
const RESULTS = ['worked', 'failed', 'wrong-fit'];

export function createParts({ db, audit, now, ai, limits = { hourly: 30, daily: 200 }, changed = () => {}, log }) {
  const deny = (who, permission) => (can(who, permission) ? null : { error: 'forbidden' });

  const vehicleOf = (v = {}) => ({ year: Number(v.year) || 0, make: clip(v.make, 60), model: clip(v.model, 80), engine: clip(v.engine, 80), drivetrain: clip(v.drivetrain, 30) });

  /** Saved answers for a question, best first. Engine and drivetrain narrow it only where both sides say something. */
  function recall({ vehicle, term, number }) {
    const rows = [];
    if (number) {
      const key = numberKey(number);
      rows.push(...db.prepare('SELECT * FROM part_answers WHERE query_number = ? OR number_key = ?').all(key, key));
    }
    if (term && vehicle.make && vehicle.model) {
      const tk = termKey(term);
      const candidates = db.prepare('SELECT * FROM part_answers WHERE year = ? AND make = ? AND model = ? AND query_number = ?').all(vehicle.year, vehicle.make, vehicle.model, '');
      rows.push(...candidates.filter((a) => termKey(a.part_term) === tk
        && (!a.engine || !vehicle.engine || norm(a.engine) === norm(vehicle.engine))
        && (!a.drivetrain || !vehicle.drivetrain || norm(a.drivetrain) === norm(vehicle.drivetrain))));
    }
    const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
    return unique.sort((a, b) => scoreAnswer(b) - scoreAnswer(a) || b.updated_at - a.updated_at);
  }

  const shape = (a, myVotes = new Map()) => ({
    id: a.id, brand: a.brand, partNumber: a.part_number, description: a.description, notes: a.notes, sourceUrl: a.source_url, source: a.source, confidence: a.confidence,
    worked: a.worked, failed: a.failed, confirmed: isConfirmed(a), lastConfirmedAt: a.last_confirmed_at, mine: myVotes.get(a.id) ?? '',
    vehicle: describeVehicle({ year: a.year || '', make: a.make, model: a.model, engine: a.engine, drivetrain: a.drivetrain }),
  });
  const withVotes = (who, rows, { showBad = false } = {}) => {
    const mine = new Map();
    if (rows.length) for (const r of db.prepare(`SELECT answer_id, result FROM part_feedback WHERE email = ? AND answer_id IN (${rows.map(() => '?').join(',')})`).all(who.email, ...rows.map((r) => r.id))) mine.set(r.answer_id, r.result);
    const shown = showBad ? rows : rows.filter((r) => !isBad(r));
    return { results: shown.map((r) => shape(r, mine)), hidden: rows.length - shown.length };
  };

  function aiAllowance(who) {
    const t = now();
    const spent = (since) => db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE at >= ?').get(since).n;
    if (spent(t - HOUR) >= limits.hourly) return 'hourly';
    if (spent(t - 24 * HOUR) >= limits.daily) return 'daily';
    return null;
  }

  function save(who, { vehicle, term, number, candidates, source }) {
    const t = now();
    const ids = [];
    const insert = db.prepare(`INSERT INTO part_answers (year, make, model, engine, drivetrain, part_term, query_number, brand, part_number, number_key, description, notes, source_url, source, confidence, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (year, make, model, engine, drivetrain, part_term, query_number, brand, number_key) DO UPDATE SET
        description = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
        notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE notes END,
        source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE source_url END,
        updated_at = excluded.updated_at
      RETURNING id`);
    for (const c of candidates) {
      const row = insert.get(vehicle.year, vehicle.make, vehicle.model, vehicle.engine, vehicle.drivetrain, number ? '' : term, number ? numberKey(number) : '', c.brand, c.partNumber, numberKey(c.partNumber),
        c.description, c.notes, c.sourceUrl, source, c.confidence, who.email, t, t);
      ids.push(row.id);
    }
    return ids;
  }

  return {
    aiEnabled: () => ai.enabled,

    /**
     * Answer "what fits": a vehicle and a part description, or just a part number to cross-reference.
     * Returns the shop's own answers when there are any. `fresh` asks the AI again (once per
     * question per hour per person's limit), keeping what it says next to what's already known.
     */
    async find(who, { vehicle: rawVehicle, term: rawTerm, number: rawNumber, fresh = false, showBad = false, callId = null }) {
      const no = deny(who, 'parts.find');
      if (no) return no;
      const vehicle = vehicleOf(rawVehicle);
      let term = clip(rawTerm, 100).trim();
      let number = clip(rawNumber, 40).trim();
      if (!number && looksLikePartNumber(term) && !(vehicle.make && vehicle.model && /\s/.test(term))) [number, term] = [term, ''];
      if (!term && !number) return { error: 'empty' };
      if (!number && !(vehicle.year && vehicle.make && vehicle.model)) return { error: 'vehicle' };

      let known = recall({ vehicle, term, number });
      let usable = known.filter((a) => !isBad(a));
      const search = { ai: false, aiError: '', note: '' };

      if ((!usable.length || fresh) && ai.enabled) {
        const limited = aiAllowance(who);
        if (limited) {
          search.aiError = limited === 'hourly' ? 'limit-hour' : 'limit-day';
        } else {
          const t = now();
          try {
            const answer = await ai.suggest({ vehicle, term, number });
            db.prepare('INSERT INTO ai_calls (at, email, model, ok, input_tokens, output_tokens, searches) VALUES (?, ?, ?, 1, ?, ?, ?)').run(t, who.email, ai.model, answer.usage.input, answer.usage.output, answer.usage.searches);
            search.ai = true;
            search.note = answer.note;
            save(who, { vehicle, term, number, candidates: answer.candidates, source: 'ai' });
            known = recall({ vehicle, term, number });
            usable = known.filter((a) => !isBad(a));
          } catch (error) {
            db.prepare('INSERT INTO ai_calls (at, email, model, ok, error) VALUES (?, ?, ?, 0, ?)').run(t, who.email, ai.model, error.code ?? 'failed');
            search.aiError = error.code ?? 'failed';
            if (!error.code) log?.error('ai lookup crashed', { message: error.message });
          }
        }
      } else if (!usable.length && !ai.enabled) {
        search.aiError = 'off';
      }

      const { results, hidden } = withVotes(who, known, { showBad });
      const fromMemory = !search.ai && results.length > 0;
      db.prepare('INSERT INTO part_searches (call_id, email, vehicle, part_term, query_number, answer_ids, from_memory, ai_used, ai_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(callId, who.email, JSON.stringify(vehicle), term, numberKey(number), JSON.stringify(results.map((r) => r.id)), fromMemory ? 1 : 0, search.ai ? 1 : 0, search.aiError, now());
      if (callId != null) changed({ type: 'call', id: callId }); // anyone watching this call sees the search
      return { ok: true, vehicle, term, number, results, hidden, fromMemory, aiAsked: search.ai, aiError: search.aiError, note: search.note, canAskAi: ai.enabled };
    },

    /** The last lookup made on a call, shown again with today's votes. */
    lastForCall(who, callId) {
      const no = deny(who, 'parts.find');
      if (no) return no;
      const s = db.prepare('SELECT * FROM part_searches WHERE call_id = ? ORDER BY id DESC LIMIT 1').get(callId);
      if (!s) return { ok: true, search: null };
      const ids = JSON.parse(s.answer_ids);
      const rows = ids.length ? db.prepare(`SELECT * FROM part_answers WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
      rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      const { results } = withVotes(who, rows, { showBad: true });
      return { ok: true, search: { vehicle: JSON.parse(s.vehicle), term: s.part_term, number: s.query_number, results, fromMemory: !!s.from_memory, aiAsked: !!s.ai_used, aiError: s.ai_error, at: s.created_at, canAskAi: ai.enabled } };
    },

    /** "It worked in our system" / "it didn't" / "wrong fit for this vehicle". One vote each; a new vote replaces the old. */
    feedback(who, answerId, result, { note = '', callId = null } = {}) {
      const no = deny(who, 'parts.feedback');
      if (no) return no;
      if (!RESULTS.includes(result)) return { error: 'result' };
      const a = db.prepare('SELECT id, brand, part_number FROM part_answers WHERE id = ?').get(answerId);
      if (!a) return { error: 'missing' };
      const t = now();
      db.exec('BEGIN');
      try {
        db.prepare(`INSERT INTO part_feedback (answer_id, email, result, note, call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (answer_id, email) DO UPDATE SET result = excluded.result, note = excluded.note, call_id = excluded.call_id, created_at = excluded.created_at`).run(answerId, who.email, result, clip(note, 300), callId, t);
        const tally = db.prepare("SELECT SUM(result = 'worked') AS w, SUM(result != 'worked') AS f FROM part_feedback WHERE answer_id = ?").get(answerId);
        db.prepare('UPDATE part_answers SET worked = ?, failed = ?, updated_at = ?, last_confirmed_at = CASE WHEN ? = \'worked\' THEN ? ELSE last_confirmed_at END WHERE id = ?').run(tally.w ?? 0, tally.f ?? 0, t, result, t, answerId);
        audit.record(who.email, 'part.feedback', `answer:${answerId}`, { result, part: `${a.brand} ${a.part_number}` });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { ok: true };
    },

    /** Staff add a number they know is right (from a catalogue, a past sale, the shelf). It starts confirmed. */
    teach(who, { vehicle: rawVehicle, term, brand, partNumber, description = '', notes = '' }) {
      const no = deny(who, 'parts.teach');
      if (no) return no;
      const vehicle = vehicleOf(rawVehicle);
      const b = clip(brand, 40).trim();
      const n = clip(partNumber, 40).trim();
      const tm = clip(term, 100).trim();
      if (!b || !numberKey(n)) return { error: 'number' };
      if (!tm || !(vehicle.year && vehicle.make && vehicle.model)) return { error: 'vehicle' };
      const [id] = save(who, { vehicle, term: tm, number: '', candidates: [{ brand: b, partNumber: n, description: clip(description, 200), notes: clip(notes, 300), sourceUrl: '', confidence: 'high' }], source: 'staff' });
      audit.record(who.email, 'part.taught', `answer:${id}`, { part: `${b} ${n}` });
      this.feedback(who, id, 'worked');
      return { ok: true, id };
    },

    get(who, id) {
      const no = deny(who, 'parts.find');
      if (no) return no;
      const a = db.prepare('SELECT * FROM part_answers WHERE id = ?').get(id);
      return a ? { ok: true, answer: shape(a), raw: a } : { error: 'missing' };
    },

    /** Spend and use, for managers. */
    usage(who) {
      const no = deny(who, 'parts.manage');
      if (no) return no;
      const t = now();
      const since = (ms) => db.prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(searches), 0) AS searches, COALESCE(SUM(1 - ok), 0) AS failed FROM ai_calls WHERE at >= ?').get(t - ms);
      const memory = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(from_memory), 0) AS memory, COALESCE(SUM(ai_used), 0) AS asked FROM part_searches WHERE created_at >= ?').get(t - 30 * 24 * HOUR);
      const answers = db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(worked > failed AND worked > 0), 0) AS confirmed, COALESCE(SUM(source = 'staff'), 0) AS taught FROM part_answers").get();
      return { ok: true, day: since(24 * HOUR), month: since(30 * 24 * HOUR), limits, searches: memory, answers, enabled: ai.enabled, model: ai.model };
    },
  };
}
