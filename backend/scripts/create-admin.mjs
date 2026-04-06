import crypto from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL || '';
const username = String(process.env.ADMIN_USERNAME || '').trim();
const password = String(process.env.ADMIN_PASSWORD || '');

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

if (!username) {
  console.error('ADMIN_USERNAME is required');
  process.exit(1);
}

if (password.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters');
  process.exit(1);
}

async function hashPassword(value) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return Buffer.from(new Uint8Array([...salt, ...new Uint8Array(derivedBits)])).toString('base64');
}

const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existing = await client.query(
    'SELECT id, username, created_at FROM admins WHERE LOWER(username) = LOWER($1) LIMIT 1',
    [username]
  );

  if (existing.rows[0]) {
    console.log(JSON.stringify({ success: true, existed: true, admin: existing.rows[0] }));
    process.exit(0);
  }

  const inserted = await client.query(
    `INSERT INTO admins (id, username, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, created_at`,
    [crypto.randomUUID(), username, await hashPassword(password)]
  );

  console.log(JSON.stringify({ success: true, existed: false, admin: inserted.rows[0] }));
} catch (error) {
  console.error(JSON.stringify({ success: false, message: error.message, code: error.code || null }));
  process.exit(1);
} finally {
  try {
    await client.end();
  } catch {}
}
