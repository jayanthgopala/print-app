CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  subscription_status TEXT DEFAULT 'active' CHECK(subscription_status IN ('active', 'suspended', 'expired')),
  subscription_plan TEXT DEFAULT 'basic',
  subscription_expiry DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  shop_code TEXT NOT NULL,
  device_token TEXT UNIQUE NOT NULL,
  pc_name TEXT NOT NULL,
  status TEXT DEFAULT 'offline' CHECK(status IN ('online', 'offline', 'disconnected')),
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_code) REFERENCES shops(shop_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shops_shop_code ON shops(shop_code);
CREATE INDEX IF NOT EXISTS idx_devices_shop_code ON devices(shop_code);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(device_token);
