-- 012: what happens to each line of a call. A line can now be paint (code, type, brand, amount), carry a
-- VIN (and the vehicle it decoded to), be worked down a list (open, found, need to order, can't get),
-- and wait in a queue for part-number suggestions. SQLite can't change a CHECK, so the table is
-- rebuilt with its rows copied across.
CREATE TABLE call_lines_new (
  id            INTEGER PRIMARY KEY,
  call_id       INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('part', 'vehicle', 'paint')),
  raw           TEXT NOT NULL,
  part          TEXT NOT NULL DEFAULT '',
  qty           INTEGER,
  part_numbers  TEXT NOT NULL DEFAULT '',
  vehicle       TEXT NOT NULL DEFAULT '{}',
  guessed       TEXT NOT NULL DEFAULT '[]',
  done          INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  -- {"code","type","brand","amount","unit"} for a paint line
  paint         TEXT,
  -- the VIN typed on this line, and what it decoded to ({"year","make","model","engine","drivetrain"})
  vin           TEXT NOT NULL DEFAULT '',
  vin_vehicle   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'found', 'order', 'cant')),
  -- the part-number suggestions: '' (not asked), queued, working, ready, none (nothing found),
  -- vehicle (waiting for a vehicle), limited (AI limit reached), off (no AI key and nothing saved), failed
  suggest_state TEXT NOT NULL DEFAULT '' CHECK (suggest_state IN ('', 'queued', 'working', 'ready', 'none', 'vehicle', 'limited', 'off', 'failed')),
  suggestions   TEXT NOT NULL DEFAULT '[]',
  suggested_at  INTEGER
);
INSERT INTO call_lines_new (id, call_id, seq, kind, raw, part, qty, part_numbers, vehicle, guessed, done, created_by, created_at, status)
  SELECT id, call_id, seq, kind, raw, part, qty, part_numbers, vehicle, guessed, done, created_by, created_at, CASE WHEN done = 1 THEN 'found' ELSE 'open' END FROM call_lines;
DROP TABLE call_lines;
ALTER TABLE call_lines_new RENAME TO call_lines;
CREATE INDEX call_lines_call ON call_lines (call_id, seq);
CREATE INDEX call_lines_queue ON call_lines (suggest_state) WHERE suggest_state IN ('queued', 'working', 'vehicle');
