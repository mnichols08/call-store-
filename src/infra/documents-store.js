// The kit's store seam, kept in SQLite. The kit asks for three functions: reads are synchronous
// and a write is stored before it returns, which is exactly what the synchronous driver gives.
// The returned promise is only there because the contract has one (the broadcast, elsewhere).
export function sqliteStore(db) {
  const one = db.prepare('SELECT fields FROM documents WHERE collection = ? AND key = ?');
  const many = db.prepare("SELECT key, fields FROM documents WHERE collection = ? AND substr(key, 1, ?) = ? ORDER BY key");
  const put = db.prepare(`INSERT INTO documents (collection, key, fields) VALUES (?, ?, ?)
    ON CONFLICT (collection, key) DO UPDATE SET fields = excluded.fields`);
  return {
    get(collection, key) {
      const row = one.get(collection, key);
      return row ? JSON.parse(row.fields) : null;
    },
    under(collection, prefix = '') {
      return many.all(collection, prefix.length, prefix).map((row) => ({ key: row.key, ...JSON.parse(row.fields) }));
    },
    write(collection, key, fields) {
      const row = one.get(collection, key);
      put.run(collection, key, JSON.stringify({ ...(row ? JSON.parse(row.fields) : {}), ...fields }));
      return Promise.resolve();
    },
  };
}
