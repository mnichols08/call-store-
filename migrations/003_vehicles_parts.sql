-- Vehicles and parts.
--
-- Everything the shop learns is kept here so the same question is never paid for twice: what
-- NHTSA and fueleconomy.gov said, which engines and drivetrains exist for a vehicle, which parts
-- fit it, and whether staff found the part number worked in their system.

-- Answers from outside services, keyed by a hash of the request (so a VIN is never a key).
CREATE TABLE http_cache (
  key        TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Year, make and model, learned from NHTSA: what "closest match" searches.
CREATE TABLE vehicle_models (
  year  INTEGER NOT NULL,
  make  TEXT NOT NULL COLLATE NOCASE,
  model TEXT NOT NULL COLLATE NOCASE,
  norm  TEXT NOT NULL,
  PRIMARY KEY (year, make, model)
) WITHOUT ROWID;
CREATE INDEX vehicle_models_norm ON vehicle_models (year, norm);
-- Which years have been indexed completely (a partial index is not recorded, so it is tried again).
CREATE TABLE vehicle_index_years (
  year     INTEGER PRIMARY KEY,
  built_at INTEGER NOT NULL,
  makes    INTEGER NOT NULL
);

-- Engines and drivetrains known for a vehicle: from VIN decodes, EPA records and what staff picked.
CREATE TABLE vehicle_specs (
  id         INTEGER PRIMARY KEY,
  year       INTEGER NOT NULL,
  make       TEXT NOT NULL COLLATE NOCASE,
  model      TEXT NOT NULL COLLATE NOCASE,
  engine     TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  drivetrain TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  trim       TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  source     TEXT NOT NULL,
  seen       INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (year, make, model, engine, drivetrain, trim)
);
CREATE INDEX vehicle_specs_lookup ON vehicle_specs (year, make, model);

-- A customer's vehicles, kept when a VIN was looked up on one of their calls.
CREATE TABLE customer_vehicles (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  vin          TEXT NOT NULL DEFAULT '',
  year         INTEGER,
  make         TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  engine       TEXT NOT NULL DEFAULT '',
  drivetrain   TEXT NOT NULL DEFAULT '',
  trim         TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX customer_vehicles_vin ON customer_vehicles (customer_id, vin) WHERE vin != '';
CREATE INDEX customer_vehicles_customer ON customer_vehicles (customer_id, last_used_at);

-- What the shop knows about which part fits. One row per candidate per question asked.
-- `vehicle_key` and `part_term` / `query_number` say what was asked; the rest is the answer.
CREATE TABLE part_answers (
  id                INTEGER PRIMARY KEY,
  year              INTEGER NOT NULL DEFAULT 0,
  make              TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  model             TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  engine            TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  drivetrain        TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  part_term         TEXT NOT NULL DEFAULT '',
  query_number      TEXT NOT NULL DEFAULT '',
  brand             TEXT NOT NULL COLLATE NOCASE,
  part_number       TEXT NOT NULL,
  number_key        TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  source_url        TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL CHECK (source IN ('ai', 'staff')),
  confidence        TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  worked            INTEGER NOT NULL DEFAULT 0,
  failed            INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_confirmed_at INTEGER,
  UNIQUE (year, make, model, engine, drivetrain, part_term, query_number, brand, number_key)
);
CREATE INDEX part_answers_vehicle ON part_answers (part_term, make, model, year);
CREATE INDEX part_answers_number ON part_answers (number_key);
CREATE INDEX part_answers_query ON part_answers (query_number);

-- Whether a part number worked in the shop's system. One vote per person per answer; changing
-- your mind replaces it.
CREATE TABLE part_feedback (
  id         INTEGER PRIMARY KEY,
  answer_id  INTEGER NOT NULL REFERENCES part_answers (id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  result     TEXT NOT NULL CHECK (result IN ('worked', 'failed', 'wrong-fit')),
  note       TEXT NOT NULL DEFAULT '',
  call_id    INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (answer_id, email)
);

-- Each lookup a person ran from a call, so its results are still there when the page reloads.
CREATE TABLE part_searches (
  id           INTEGER PRIMARY KEY,
  call_id      INTEGER REFERENCES calls (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  vehicle      TEXT NOT NULL DEFAULT '{}',
  part_term    TEXT NOT NULL DEFAULT '',
  query_number TEXT NOT NULL DEFAULT '',
  answer_ids   TEXT NOT NULL DEFAULT '[]',
  from_memory  INTEGER NOT NULL DEFAULT 0,
  ai_used      INTEGER NOT NULL DEFAULT 0,
  ai_error     TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX part_searches_call ON part_searches (call_id, id);

-- Every call to the AI, for spend and limits. No VIN, customer or free text is kept here.
CREATE TABLE ai_calls (
  id            INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  email         TEXT NOT NULL,
  model         TEXT NOT NULL,
  ok            INTEGER NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  searches      INTEGER NOT NULL DEFAULT 0,
  error         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ai_calls_at ON ai_calls (at);
CREATE INDEX ai_calls_who ON ai_calls (email, at);
