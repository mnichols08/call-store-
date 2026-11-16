-- foreign-keys: off
-- 014: a person can join a customer from a one-time link a rep sends (text, email or a QR on the
-- rep's phone) and sign in with a passkey or a username and password, with the emailed link as a
-- backup. Email becomes optional, so portal_accounts is rebuilt (rows and ids kept).
CREATE TABLE portal_accounts_new (
  id            INTEGER PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  email         TEXT COLLATE NOCASE UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  notify        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  -- signing in with a username and password (scrypt, the kit's format); both or neither
  username      TEXT COLLATE NOCASE UNIQUE,
  password_hash TEXT,
  phone         TEXT NOT NULL DEFAULT '',
  CHECK ((username IS NULL) = (password_hash IS NULL))
);
INSERT INTO portal_accounts_new (id, customer_id, email, name, role, status, notify, created_at, last_login_at)
  SELECT id, customer_id, email, name, role, status, notify, created_at, last_login_at FROM portal_accounts;
DROP TABLE portal_accounts;
ALTER TABLE portal_accounts_new RENAME TO portal_accounts;
CREATE INDEX portal_accounts_customer ON portal_accounts (customer_id, status);

-- Passkeys (WebAuthn credentials). Only the public key is kept.
CREATE TABLE portal_passkeys (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES portal_accounts (id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    BLOB NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT NOT NULL DEFAULT '[]',
  label         TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX portal_passkeys_account ON portal_passkeys (account_id);

-- A one-time link a rep makes for one person at a customer. Works once, for 72 hours.
CREATE TABLE portal_person_invites (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  sent_by     TEXT NOT NULL DEFAULT '' CHECK (sent_by IN ('', 'text', 'email', 'qr')),
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  account_id  INTEGER REFERENCES portal_accounts (id) ON DELETE SET NULL
);
CREATE INDEX portal_person_invites_customer ON portal_person_invites (customer_id);

-- A passkey ceremony in progress: the challenge the browser must sign, for five minutes.
CREATE TABLE webauthn_challenges (
  id          INTEGER PRIMARY KEY,
  handle_hash TEXT NOT NULL UNIQUE,
  challenge   TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('register', 'sign-in')),
  data        TEXT NOT NULL DEFAULT '{}',
  expires_at  INTEGER NOT NULL
);
