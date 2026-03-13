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
