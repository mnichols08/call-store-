-- What kind of account a customer is: a walk-in or retail customer, a professional (mechanic, body
-- shop, contractor), or a fleet. Only a label for the people at the counter; nothing else changes.
ALTER TABLE customers ADD COLUMN tier TEXT NOT NULL DEFAULT 'retail' CHECK (tier IN ('retail', 'pro', 'fleet'));
