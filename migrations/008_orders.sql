-- Special orders: what the counter writes in the order notebook (line code, part number, where it was
-- ordered from, whose it is). Rows come from a photo of the page, read by the AI and checked by a
-- person before they're saved. The photo itself is not kept.
CREATE TABLE special_orders (
  id            INTEGER PRIMARY KEY,
  sheet_date    TEXT NOT NULL,
  line_code     TEXT NOT NULL DEFAULT '',
  part_number   TEXT NOT NULL DEFAULT '',
  ordered_from  TEXT NOT NULL DEFAULT '',
  customer_text TEXT NOT NULL DEFAULT '',
  customer_id   INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  received      INTEGER NOT NULL DEFAULT 0 CHECK (received IN (0, 1)),
  paid          INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
  note          TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX special_orders_date ON special_orders (sheet_date DESC, id);
CREATE INDEX special_orders_customer ON special_orders (customer_id);
