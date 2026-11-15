// Streaming, the careful way. Zubra sends a page's shell at once and fills in any region whose prop is
// a promise when it settles. Two things it leaves to the caller (see docs/zubra-findings.md, 5 and 6):
// a promise that never settles holds the response open forever, and a rejection's message goes to the
// browser as written. `bounded` fixes both: it settles within a time limit and only ever rejects with
// a message written here.

/** A promise for `work()` that settles within `ms`, and fails with `message` (never the real error). */
export function bounded(work, { ms = 8000, message = 'That took too long. Try again.', onError } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve()
      .then(work)
      .then(resolve, (error) => { onError?.(error); reject(new Error(message)); })
      .finally(() => clearTimeout(timer));
  });
}
