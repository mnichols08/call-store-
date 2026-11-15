// The audit trail: who did what, to which record, when. Written in the same transaction as the
// change it records, so there is no change without it and no entry for a change that rolled back.

export function createAudit(db, now) {
  const insert = db.prepare('INSERT INTO audit_events (at, actor, action, subject, detail) VALUES (?, ?, ?, ?, ?)');
  const recent = db.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?');
  const forSubject = db.prepare('SELECT * FROM audit_events WHERE subject = ? ORDER BY id DESC LIMIT ?');
  const parse = (row) => ({ ...row, detail: JSON.parse(row.detail) });
  return {
    record: (actor, action, subject, detail = {}) => insert.run(now(), actor, action, subject, JSON.stringify(detail)),
    recent: (limit = 100) => recent.all(limit).map(parse),
    about: (subject, limit = 100) => forSubject.all(subject, limit).map(parse),
  };
}
