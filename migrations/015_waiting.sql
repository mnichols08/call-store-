-- 015: why a parked call is parked. The two reasons the counter gives most: the part is on order,
-- or the customer has to get back to us. Empty means it is simply parked.
ALTER TABLE calls ADD COLUMN waiting TEXT NOT NULL DEFAULT '' CHECK (waiting IN ('', 'ordered', 'customer'));
