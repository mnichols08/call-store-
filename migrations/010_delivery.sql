-- Delivery: a call or web request can be marked for delivery, with where to take it. The stages are
-- plain: asked for, ready to go, out on the truck, delivered. `outside` marks a town that isn't in the
-- shop's usual delivery area, so someone confirms it before promising anything.
CREATE TABLE call_delivery (
  call_id      INTEGER PRIMARY KEY REFERENCES calls (id) ON DELETE CASCADE,
  town         TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'ready', 'out', 'delivered')),
  outside      INTEGER NOT NULL DEFAULT 0 CHECK (outside IN (0, 1)),
  requested_by TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX call_delivery_status ON call_delivery (status, town);
