-- The customer portal: accounts that belong to one business, one-time sign-in links, invites
-- (the QR codes), the requests customers send, and the updates staff post back.

ALTER TABLE calls ADD COLUMN source TEXT NOT NULL DEFAULT 'phone' CHECK (source IN ('phone', 'portal'));
ALTER TABLE calls ADD COLUMN portal_account INTEGER;
CREATE INDEX calls_portal ON calls (customer_id, source, created_at);

CREATE TABLE portal_accounts (
  id            INTEGER PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  email         TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  notify        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX portal_accounts_customer ON portal_accounts (customer_id, status);

-- An invite is what a QR code or an emailed join link points at. Several coworkers can use one
-- until it runs out or expires; each still has to prove their email.
CREATE TABLE portal_invites (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  max_uses    INTEGER NOT NULL,
  uses        INTEGER NOT NULL DEFAULT 0,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX portal_invites_customer ON portal_invites (customer_id);

-- One-time links sent by email: to sign in, or to finish joining.
CREATE TABLE portal_tokens (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('login', 'join')),
  email      TEXT NOT NULL COLLATE NOCASE,
  name       TEXT NOT NULL DEFAULT '',
  account_id INTEGER REFERENCES portal_accounts (id) ON DELETE CASCADE,
  invite_id  INTEGER REFERENCES portal_invites (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX portal_tokens_email ON portal_tokens (email, created_at);

CREATE TABLE portal_sessions (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES portal_accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- What a customer sees about a request: the shop's updates, and the customer's own notes.
CREATE TABLE portal_updates (
  id          INTEGER PRIMARY KEY,
  call_id     INTEGER NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  at          INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  staff_email TEXT,
  account_id  INTEGER REFERENCES portal_accounts (id) ON DELETE SET NULL
);
CREATE INDEX portal_updates_call ON portal_updates (call_id, id);

-- Mail that couldn't be sent because no mail service is set up. Staff-only; see docs/portal.md.
CREATE TABLE outbox (
  id         INTEGER PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
