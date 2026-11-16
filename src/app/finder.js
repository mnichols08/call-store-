// The suggestion queue: each part line typed on a call is asked about in the background, one at a
// time, through the part finder (app/parts.js): the shop's own answers first, the AI only when there
// are none. The answers land on the line, so the person on the call can work down the list while
// the queue catches up. Nothing here decides for them: a suggestion is only a suggestion.
//
// A line waits in `suggest_state`: queued → working → ready / none / vehicle / limited / off / failed.
// Lines left "working" by a restart go back to "queued" when the queue starts.

/** At most this many suggestions are kept on a line. */
export const SUGGESTIONS_PER_LINE = 5;

const compact = (a) => ({ id: a.id, brand: a.brand ?? '', partNumber: a.partNumber ?? '', description: a.description ?? '', source: a.source ?? '', confidence: a.confidence ?? '', worked: a.votes?.worked ?? 0 });

export function createFinder({ db, now, changed, parts, log }) {
  let running = null;
  let again = false;

  db.prepare("UPDATE call_lines SET suggest_state = 'queued' WHERE suggest_state = 'working'").run();

  function stateFor(found) {
    if (found.error === 'vehicle') return 'vehicle';
    if (found.error) return 'failed';
    if (found.results.length) return 'ready';
    if (found.aiError === 'off') return 'off';
    if (/^limit/.test(found.aiError)) return 'limited';
    if (found.aiError) return 'failed';
    return 'none';
  }

  async function one(row) {
    const who = { email: row.created_by, name: '', roles: ['staff'] }; // the person who typed the line asked
    const number = row.part_numbers.split(',').map((n) => n.trim()).find(Boolean) ?? '';
    let found;
    try {
      found = await parts.find(who, { vehicle: JSON.parse(row.vehicle), term: row.part, number, callId: row.call_id });
    } catch (error) {
      log?.error('suggestion lookup crashed', { message: error.message });
      found = { error: 'failed' };
    }
    const state = stateFor(found);
    const list = found.results ? found.results.slice(0, SUGGESTIONS_PER_LINE).map(compact) : [];
    // Only if the line wasn't retyped while we asked (then it is queued again, with what it says now).
    const { changes } = db.prepare("UPDATE call_lines SET suggest_state = ?, suggestions = ?, suggested_at = ? WHERE id = ? AND suggest_state = 'working'").run(state, JSON.stringify(list), now(), row.id);
    if (changes) changed({ type: 'call', id: row.call_id, why: 'lines', by: 'finder' });
  }

  async function drain() {
    for (;;) {
      const row = db.prepare("SELECT * FROM call_lines WHERE suggest_state = 'queued' ORDER BY id LIMIT 1").get();
      if (!row) return;
      db.prepare("UPDATE call_lines SET suggest_state = 'working' WHERE id = ?").run(row.id);
      await one(row);
    }
  }

  return {
    /** Start working the queue if it isn't already. Safe to call as often as you like. */
    kick() {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        do {
          again = false;
          await drain();
        } while (again);
      })().finally(() => {
        running = null;
      });
      return running;
    },
    /** Resolves when the queue is empty (for tests and shutdown). */
    idle: () => running ?? Promise.resolve(),
  };
}
