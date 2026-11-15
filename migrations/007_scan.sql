-- Scanning in both directions.
-- A customer shows a short-lived badge (a QR code) and staff scan it to find them.
CREATE TABLE portal_badges (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES portal_accounts(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- An employee's own QR code: a customer who scans it asks for access, and staff approve.
CREATE TABLE rep_codes (
  token_hash TEXT PRIMARY KEY,
  rep_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rep_email TEXT NOT NULL,
  name TEXT NOT NULL,
  business TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  customer_id INTEGER REFERENCES customers(id),
  created_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER
);
CREATE INDEX access_requests_status ON access_requests (status, id);
