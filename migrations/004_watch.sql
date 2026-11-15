-- Watching a coworker's call, and suggesting a part to them.

-- Small shop-wide switches (watching is off until a manager or owner turns it on).
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- Who is looking at a call right now. A row older than a couple of minutes means they left.
CREATE TABLE call_watchers (
  call_id    INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  seen_at    INTEGER NOT NULL,
  PRIMARY KEY (call_id, email)
) WITHOUT ROWID;

-- A part suggested to whoever has the call. They accept (it goes on the call and into the shop's
-- saved answers) or dismiss it.
CREATE TABLE call_suggestions (
  id          INTEGER PRIMARY KEY,
  call_id     INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  from_email  TEXT NOT NULL,
  term        TEXT NOT NULL DEFAULT '',
  brand       TEXT NOT NULL,
  part_number TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  decided_by  TEXT,
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX call_suggestions_call ON call_suggestions (call_id, id);
