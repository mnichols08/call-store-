-- Nudges: one person asking another to look at something, optionally about a call. Kept until the
-- recipient dismisses them, so a nudge sent while someone was at lunch is still there afterwards.
CREATE TABLE nudges (
  id         INTEGER PRIMARY KEY,
  from_email TEXT NOT NULL,
  to_email   TEXT NOT NULL,
  call_id    INTEGER REFERENCES calls (id) ON DELETE CASCADE,
  message    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  seen_at    INTEGER
);
CREATE INDEX nudges_inbox ON nudges (to_email, seen_at, id);
CREATE INDEX nudges_sent ON nudges (from_email, created_at);

-- Browsers a person has allowed to be notified (Web Push). One row per browser.
CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX push_subscriptions_email ON push_subscriptions (email);
