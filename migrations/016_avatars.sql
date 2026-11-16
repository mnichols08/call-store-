-- 016: a small picture a person chooses for themselves, staff or customer. Without one the app
-- shows their initials. `owner` is "staff:<account>" or "portal:<id>". Shrunk in the browser first,
-- so a row is a few kilobytes.
CREATE TABLE avatars (
  owner      TEXT PRIMARY KEY,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes      BLOB NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
