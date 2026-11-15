// A small fixed-window limiter, kept in the process: the kit's sign-in lockouts reset on restart and
// its README asks for a rate limit in front of the sign-in route. This is it.
export function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map(); // key → { count, resetAt }
  return {
    /** Whether this one is allowed; counts it. */
    take(key) {
      const t = now();
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
  };
}
