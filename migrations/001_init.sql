-- 001: the first schema. Schema changes only ever arrive as a new numbered file.

-- Where the kit keeps its documents: staff accounts, sessions and link tokens (kit/staff).
CREATE TABLE documents (
  collection TEXT NOT NULL,
  key        TEXT NOT NULL,
  fields     TEXT NOT NULL,
  PRIMARY KEY (collection, key)
) WITHOUT ROWID;

-- Customers: a person or an organisation. Callers need not be one.
CREATE TABLE customers (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'organization')),
  name       TEXT NOT NULL,
  account_no TEXT,
  address    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX customers_account_no ON customers (account_no) WHERE account_no IS NOT NULL;
CREATE INDEX customers_name ON customers (name COLLATE NOCASE);

-- Any number of phones per customer; `digits` is the searchable form.
CREATE TABLE customer_phones (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  ext         TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL,
  digits      TEXT NOT NULL
);
CREATE INDEX customer_phones_digits ON customer_phones (digits);
CREATE INDEX customer_phones_customer ON customer_phones (customer_id);

-- People at an organisation customer.
CREATE TABLE contacts (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  ext         TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX contacts_customer ON contacts (customer_id);

-- Items: the parts and products the store talks about on the phone.
CREATE TABLE items (
  id          INTEGER PRIMARY KEY,
  sku         TEXT NOT NULL,
  name        TEXT NOT NULL,
  brand       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit        TEXT NOT NULL DEFAULT 'each',
  cents       INTEGER CHECK (cents IS NULL OR cents >= 0),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX items_sku ON items (sku COLLATE NOCASE);
CREATE INDEX items_name ON items (name COLLATE NOCASE);

-- Calls: one phone call, counter visit or continuing inquiry. The unit of work.
-- Customer, application and part numbers are all optional; a call can start empty.
-- Workflow status, assignment and help are separate columns on purpose.
CREATE TABLE calls (
  id            INTEGER PRIMARY KEY,
  customer_id   INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  caller_name   TEXT NOT NULL DEFAULT '',
  caller_phone  TEXT NOT NULL DEFAULT '',
  request       TEXT NOT NULL DEFAULT '',
  quantity      INTEGER CHECK (quantity IS NULL OR quantity > 0),
  part_numbers  TEXT NOT NULL DEFAULT '',
  application   TEXT NOT NULL DEFAULT '{}',
  notes         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'working', 'parked', 'resolved', 'closed')),
  assignee      TEXT,
  help          TEXT NOT NULL DEFAULT 'normal' CHECK (help IN ('normal', 'anyone', 'specific')),
  help_from     TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  outcome       TEXT,
  outcome_data  TEXT NOT NULL DEFAULT '{}',
  revision      INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  closed_at     INTEGER
);
CREATE INDEX calls_status ON calls (status, created_at);
CREATE INDEX calls_assignee ON calls (assignee, status);
CREATE INDEX calls_customer ON calls (customer_id, created_at);

-- Items a call is about.
CREATE TABLE call_items (
  call_id  INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  item_id  INTEGER NOT NULL REFERENCES items (id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (call_id, item_id)
) WITHOUT ROWID;

-- What happened on a call, in order: the timeline.
CREATE TABLE call_events (
  id      INTEGER PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  type    TEXT NOT NULL,
  data    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX call_events_call ON call_events (call_id, id);

-- Everything meaningful anyone does, attributed to the signed-in person.
CREATE TABLE audit_events (
  id      INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_subject ON audit_events (subject, id);
CREATE INDEX audit_events_at ON audit_events (at);
