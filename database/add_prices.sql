-- Add price columns to shops table
ALTER TABLE shops 
ADD COLUMN IF NOT EXISTS color_price DECIMAL(10,2) DEFAULT 10.00,
ADD COLUMN IF NOT EXISTS bw_price DECIMAL(10,2) DEFAULT 5.00;

-- Update existing shops with default prices
UPDATE shops SET color_price = 10.00, bw_price = 5.00 WHERE color_price IS NULL OR bw_price IS NULL;
