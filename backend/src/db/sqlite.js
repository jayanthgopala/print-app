const schemaSql = `
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
`;

let nodeDb = null;
let nodeStatements = null;
let nodeInitialized = false;
let nodeRuntime = null;
let workerInitialized = false;

function isWorkerRuntime(env) {
  return Boolean(env?.DB);
}

async function loadNodeRuntime() {
  if (!nodeRuntime) {
    const [{ DatabaseSync }, { fileURLToPath }, { dirname, join }, fs] = await Promise.all([
      import('node:sqlite'),
      import('node:url'),
      import('node:path'),
      import('node:fs'),
    ]);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    nodeRuntime = {
      DatabaseSync,
      existsSync: fs.existsSync,
      join,
      mkdirSync: fs.mkdirSync,
      dataDir: join(__dirname, '../../data'),
    };
  }

  return nodeRuntime;
}

async function ensureDataDir() {
  const runtime = await loadNodeRuntime();

  if (!runtime.existsSync(runtime.dataDir)) {
    runtime.mkdirSync(runtime.dataDir, { recursive: true });
  }
}

async function getNodeDb(env = {}) {
  if (!nodeDb) {
    const runtime = await loadNodeRuntime();
    await ensureDataDir();
    const processPath = typeof process !== 'undefined' ? process.env.SQLITE_PATH : undefined;
    const dbPath = env.SQLITE_PATH || processPath || runtime.join(runtime.dataDir, 'shops.db');
    nodeDb = new runtime.DatabaseSync(dbPath);
    nodeDb.exec('PRAGMA journal_mode = WAL');
  }

  if (!nodeStatements) {
    nodeStatements = {
      getShopByCode: nodeDb.prepare('SELECT * FROM shops WHERE shop_code = ?'),
      createShop: nodeDb.prepare(`
        INSERT INTO shops (shop_code, password_hash, name, email, subscription_expiry)
        VALUES (?, ?, ?, ?, datetime('now', '+30 days'))
      `),
      updateShopSubscription: nodeDb.prepare(`
        UPDATE shops
        SET subscription_status = ?, subscription_expiry = ?, updated_at = CURRENT_TIMESTAMP
        WHERE shop_code = ?
      `),
      getDeviceByToken: nodeDb.prepare('SELECT * FROM devices WHERE device_token = ?'),
      getDevicesByShopCode: nodeDb.prepare('SELECT * FROM devices WHERE shop_code = ?'),
      createDevice: nodeDb.prepare(`
        INSERT INTO devices (device_id, shop_code, device_token, pc_name, status)
        VALUES (?, ?, ?, ?, 'online')
      `),
      updateDeviceStatus: nodeDb.prepare(`
        UPDATE devices
        SET status = ?, last_seen = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `),
      updateDeviceLastSeen: nodeDb.prepare(`
        UPDATE devices
        SET last_seen = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `),
      getOnlineDevices: nodeDb.prepare("SELECT * FROM devices WHERE status = 'online'"),
      deleteDevice: nodeDb.prepare('DELETE FROM devices WHERE device_id = ?'),
    };
  }

  return { db: nodeDb, statements: nodeStatements };
}

async function execD1(env, sql) {
  await env.DB.exec(sql);
}

async function runD1(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).run();
}

async function firstD1(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).first();
}

async function allD1(env, sql, params = []) {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results || [];
}

export async function initializeDatabase(env = {}) {
  if (isWorkerRuntime(env)) {
    if (!workerInitialized) {
      await execD1(env, schemaSql);
      workerInitialized = true;
    }
    return;
  }

  if (!nodeInitialized) {
    const { db } = await getNodeDb(env);
    db.exec(schemaSql);
    nodeInitialized = true;
    console.log('SQLite database initialized');
  }
}

export async function getShopByCode(env, shopCode) {
  if (isWorkerRuntime(env)) {
    return firstD1(env, 'SELECT * FROM shops WHERE shop_code = ?', [shopCode]);
  }

  const { statements } = await getNodeDb(env);
  return statements.getShopByCode.get(shopCode) || null;
}

export async function createShop(env, shopCode, passwordHash, name, email) {
  if (isWorkerRuntime(env)) {
    await runD1(
      env,
      `
        INSERT INTO shops (shop_code, password_hash, name, email, subscription_expiry)
        VALUES (?, ?, ?, ?, datetime('now', '+30 days'))
      `,
      [shopCode, passwordHash, name, email]
    );
    return;
  }

  const { statements } = await getNodeDb(env);
  statements.createShop.run(shopCode, passwordHash, name, email);
}

export async function updateShopSubscription(env, status, expiry, shopCode) {
  if (isWorkerRuntime(env)) {
    await runD1(
      env,
      `
        UPDATE shops
        SET subscription_status = ?, subscription_expiry = ?, updated_at = CURRENT_TIMESTAMP
        WHERE shop_code = ?
      `,
      [status, expiry, shopCode]
    );
    return;
  }

  const { statements } = await getNodeDb(env);
  statements.updateShopSubscription.run(status, expiry, shopCode);
}

export async function getDeviceByToken(env, token) {
  if (isWorkerRuntime(env)) {
    return firstD1(env, 'SELECT * FROM devices WHERE device_token = ?', [token]);
  }

  const { statements } = await getNodeDb(env);
  return statements.getDeviceByToken.get(token) || null;
}

export async function getDevicesByShopCode(env, shopCode) {
  if (isWorkerRuntime(env)) {
    return allD1(env, 'SELECT * FROM devices WHERE shop_code = ?', [shopCode]);
  }

  const { statements } = await getNodeDb(env);
  return statements.getDevicesByShopCode.all(shopCode);
}

export async function createDevice(env, deviceId, shopCode, token, pcName) {
  if (isWorkerRuntime(env)) {
    await runD1(
      env,
      `
        INSERT INTO devices (device_id, shop_code, device_token, pc_name, status)
        VALUES (?, ?, ?, ?, 'online')
      `,
      [deviceId, shopCode, token, pcName]
    );
    return;
  }

  const { statements } = await getNodeDb(env);
  statements.createDevice.run(deviceId, shopCode, token, pcName);
}

export async function updateDeviceStatus(env, status, deviceId) {
  if (isWorkerRuntime(env)) {
    await runD1(
      env,
      `
        UPDATE devices
        SET status = ?, last_seen = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `,
      [status, deviceId]
    );
    return;
  }

  const { statements } = await getNodeDb(env);
  statements.updateDeviceStatus.run(status, deviceId);
}

export async function updateDeviceLastSeen(env, deviceId) {
  if (isWorkerRuntime(env)) {
    await runD1(
      env,
      `
        UPDATE devices
        SET last_seen = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `,
      [deviceId]
    );
    return;
  }

  const { statements } = await getNodeDb(env);
  statements.updateDeviceLastSeen.run(deviceId);
}

export async function deleteDevice(env, deviceId) {
  if (isWorkerRuntime(env)) {
    await runD1(env, 'DELETE FROM devices WHERE device_id = ?', [deviceId]);
    return;
  }

  const { statements } = await getNodeDb(env);
  statements.deleteDevice.run(deviceId);
}

export async function getOnlineDevices(env) {
  if (isWorkerRuntime(env)) {
    return allD1(env, "SELECT * FROM devices WHERE status = 'online'");
  }

  const { statements } = await getNodeDb(env);
  return statements.getOnlineDevices.all();
}
