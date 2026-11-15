-- What a customer can tell us without a phone call: measurements, photos, a note.
-- Staff fill the same details in on a call; a customer fills them in through a private link.

CREATE TABLE call_details (
  call_id    INTEGER PRIMARY KEY REFERENCES calls (id) ON DELETE CASCADE,
  part_type  TEXT NOT NULL,
  unit       TEXT NOT NULL CHECK (unit IN ('mm', 'in')),
  data       TEXT NOT NULL DEFAULT '{}',
  note       TEXT NOT NULL DEFAULT '',
  filled_by  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE call_photos (
  id         INTEGER PRIMARY KEY,
  call_id    INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  size       INTEGER NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('staff', 'customer')),
  added_by   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX call_photos_call ON call_photos (call_id, id);

-- A private link to send a customer. Only a hash of the token is kept, so the database can't
-- be used to rebuild a working link.
CREATE TABLE call_links (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  call_id    INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  opened     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX call_links_call ON call_links (call_id);
