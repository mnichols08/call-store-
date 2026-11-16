-- 013: the outbox holds texts too, when no text provider is set up. `to_email` holds the number then.
ALTER TABLE outbox ADD COLUMN channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'text'));
