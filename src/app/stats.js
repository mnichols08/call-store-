// How the desk is doing: how long callers wait before someone picks up, and how long a call takes
// once someone has it. Computed from the timeline, so it needs nothing extra recorded.
import { can } from '../domain/permissions.js';

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export function createStats({ db, now }) {
  return {
    /**
     * Calls started in the range with when someone first picked each up (claimed, or assigned to a
     * person) and when they were finished. `targetMs` is the pickup promise, e.g. five minutes.
     */
    timing(who, { from, to }, { targetMs = 300_000 } = {}) {
      if (!can(who, 'report.view')) return { error: 'forbidden' };
      const rows = db.prepare(`
        SELECT c.id, c.created_at, c.closed_at, c.status, c.outcome, c.assignee,
          (SELECT e.at FROM call_events e WHERE e.call_id = c.id
             AND (e.type = 'claimed' OR (e.type = 'assigned' AND json_extract(e.data, '$.to') IS NOT NULL)) ORDER BY e.id LIMIT 1) AS picked_up_at,
          (SELECT e.actor FROM call_events e WHERE e.call_id = c.id AND e.type = 'claimed' ORDER BY e.id LIMIT 1) AS picked_up_by
        FROM calls c WHERE c.created_at BETWEEN ? AND ? ORDER BY c.id`).all(from, to);

      const waits = [];
      const handles = [];
      const byPerson = new Map();
      for (const r of rows) {
        r.wait_ms = r.picked_up_at == null ? null : Math.max(0, r.picked_up_at - r.created_at);
        r.handle_ms = r.closed_at != null && r.picked_up_at != null ? Math.max(0, r.closed_at - r.picked_up_at) : null;
        if (r.wait_ms != null) waits.push(r.wait_ms);
        if (r.handle_ms != null) handles.push(r.handle_ms);
        const who2 = r.assignee ?? r.picked_up_by;
        if (who2 && r.handle_ms != null) {
          const entry = byPerson.get(who2) ?? { email: who2, finished: 0, handles: [] };
          entry.finished += 1;
          entry.handles.push(r.handle_ms);
          byPerson.set(who2, entry);
        }
      }
      const waiting = db.prepare(`SELECT id, created_at FROM calls WHERE assignee IS NULL AND status NOT IN ('resolved', 'closed') ORDER BY created_at LIMIT 1`).get();
      return {
        ok: true,
        calls: rows,
        started: rows.length,
        pickedUp: waits.length,
        neverPickedUp: rows.length - waits.length,
        waitMedian: median(waits),
        waitP90: percentile(waits, 90),
        withinTarget: waits.length ? waits.filter((w) => w <= targetMs).length / waits.length : null,
        handleMedian: median(handles),
        handleP90: percentile(handles, 90),
        longestWaitingNow: waiting ? { id: waiting.id, ms: Math.max(0, now() - waiting.created_at) } : null,
        people: [...byPerson.values()].map((p) => ({ email: p.email, finished: p.finished, handleMedian: median(p.handles) })).sort((a, b) => b.finished - a.finished),
      };
    },
  };
}
