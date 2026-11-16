-- 011: the lines of a call. Each line is one thing the caller asked for, typed as the counter says it
-- ("90 eclipse front brakes"), read into a part and the vehicle it is for. A line with no part just
-- sets the vehicle for the lines after it.
CREATE TABLE call_lines (
  id           INTEGER PRIMARY KEY,
  call_id      INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('part', 'vehicle')),
  raw          TEXT NOT NULL,
  part         TEXT NOT NULL DEFAULT '',
  qty          INTEGER,
  part_numbers TEXT NOT NULL DEFAULT '',
  vehicle      TEXT NOT NULL DEFAULT '{}',
  guessed      TEXT NOT NULL DEFAULT '[]',
  done         INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX call_lines_call ON call_lines (call_id, seq);

-- A short summary of the lines, for the queue and for search.
ALTER TABLE calls ADD COLUMN lines_text TEXT NOT NULL DEFAULT '';
