CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    shop_code TEXT NOT NULL UNIQUE,
    shop_name TEXT,
    owner_name TEXT,
    email TEXT,
    phone TEXT,
    password_hash TEXT,
    color_price REAL,
    bw_price REAL,
    subscription_end TEXT,
    pc_endpoint TEXT,
    pc_status TEXT DEFAULT 'offline',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shops_shop_code ON shops (shop_code);
CREATE INDEX IF NOT EXISTS idx_admins_username ON admins (username);

INSERT OR IGNORE INTO admins (
    id,
    username,
    password_hash,
    created_at
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'admin',
    'ABEiM0RVZneImaq7zN3u/41yNOHk9SaAiZt1zYIMQfN3G5iC74pnFzfzoZ106YzI',
    CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO shops (
    id,
    shop_code,
    shop_name,
    owner_name,
    email,
    phone,
    password_hash,
    color_price,
    bw_price,
    subscription_end,
    pc_endpoint,
    pc_status,
    created_at,
    updated_at
) VALUES
(
    '22222222-2222-2222-2222-222222222221',
    'SHOP001',
    'Demo Print Shop 1',
    'Test Owner 1',
    'shop001@example.com',
    '9000000001',
    'EBEiM0RVZneImaq7zN3u/7PELlcPKr7/hs1Z7z1W+r3blECCRj/6vp4JR+lKPu7I',
    5.00,
    2.00,
    '2027-12-31T23:59:59.000Z',
    NULL,
    'offline',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    '22222222-2222-2222-2222-222222222222',
    'SHOP002',
    'Demo Print Shop 2',
    'Test Owner 2',
    'shop002@example.com',
    '9000000002',
    'IBEiM0RVZneImaq7zN3u/0gHlHliSKCBf3V7txes+pRCRtd1l2rR6oE5Un0gkvvy',
    6.50,
    2.50,
    '2027-12-31T23:59:59.000Z',
    NULL,
    'offline',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
