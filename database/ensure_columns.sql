-- Ensure required columns for application
ALTER TABLE shops ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS color_price DECIMAL(10,2) DEFAULT 10.00;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS bw_price DECIMAL(10,2) DEFAULT 5.00;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE;

-- Migrate legacy column names if present
-- Safely migrate legacy column names only if those columns exist
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'starts_at') THEN
		UPDATE subscriptions
		SET start_date = starts_at
		WHERE start_date IS NULL AND starts_at IS NOT NULL;
	END IF;

	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'expires_at') THEN
		UPDATE subscriptions
		SET end_date = expires_at
		WHERE end_date IS NULL AND expires_at IS NOT NULL;
	END IF;
END$$;

-- Drop subscriptions table (we'll store subscription end date on shops directly)
DROP TABLE IF EXISTS subscriptions;

-- Add subscription_end to shops
ALTER TABLE shops ADD COLUMN IF NOT EXISTS subscription_end TIMESTAMP WITH TIME ZONE;
