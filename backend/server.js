require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const fetch = globalThis.fetch || require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// CORS - allow configured frontends to call this backend
// Build allowed origins from multiple env vars: FRONTEND_URL, ADMIN_FRONTEND_URL, CLOUDFLARE_URL, ALLOWED_ORIGINS (comma-separated)
const rawAllowed = [process.env.FRONTEND_URL, process.env.ADMIN_FRONTEND_URL, process.env.CLOUDFLARE_URL, process.env.ALLOWED_ORIGINS].filter(Boolean);
// split comma-separated entries
let allowedOrigins = rawAllowed.reduce((acc, item) => {
    item.split(',').map(s => s.trim()).forEach(s => { if (s) acc.push(s); });
    return acc;
}, []).filter(Boolean);

// Do not implicitly allow localhost in production; require explicit allowed origins via env
if (allowedOrigins.length === 0) {
    console.warn('No allowed origins configured; CORS will block browser requests unless origin is empty or explicitly listed in env vars. Set FRONTEND_URL or ALLOWED_ORIGINS.');
} else {
    console.log('CORS configured for', allowedOrigins.length, 'origin(s)');
}

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, server-side)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        console.log('CORS blocked:', origin);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','Accept']
}));
app.use(express.json());

// Return JSON error for invalid JSON bodies instead of HTML stack trace
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        console.error('Invalid JSON received:', err.message);
        return res.status(400).json({ error: 'Invalid JSON' });
    }
    // body-parser may also surface SyntaxError instances
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('Invalid JSON received (syntax):', err.message);
        return res.status(400).json({ error: 'Invalid JSON' });
    }
    next(err);
});

// PostgreSQL Pool with SSL for production (Supabase)
// Always use the DATABASE_URL from environment (Supabase). Enable SSL for remote DBs.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Supabase REST fallback (uses service role key) for IPv6-only DB projects
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function supabaseFetch(path, opts = {}) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase config missing');
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
    const headers = Object.assign({
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
    }, opts.headers || {});

    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase REST error: ${res.status} ${text}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return res.json();
    return res.text();
}

// Inspect a table via Supabase REST by fetching a single row to infer column names.
async function supabaseInspectTable(table) {
    try {
        const rows = await supabaseFetch(`${table}?select=*&limit=1`);
        if (!rows || rows.length === 0) return [];
        return Object.keys(rows[0]);
    } catch (err) {
        console.error('supabaseInspectTable error:', err && err.message);
        return null; // signal that inspection failed
    }
}

const server = app.listen(port, () => {
    console.log('Backend listening on port', port);
});

const wss = new WebSocket.Server({ server });

const onlineShops = new Map();
const connectedClients = new Map();
const transferSessions = new Map();
// Cache subscription checks to avoid frequent DB calls: { shopCode: { status, lastChecked } }
const subscriptionCache = new Map();
const MAX_TRANSFER_SIZE_BYTES = 100 * 1024 * 1024;

function sendJson(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function registerTransferSession(transferId, shopCode, clientId, clientWs) {
    transferSessions.set(transferId, {
        shopCode,
        clientId,
        clientWs,
        createdAt: Date.now()
    });
}

function getTransferSession(transferId) {
    return transferSessions.get(transferId) || null;
}

function closeTransferSession(transferId) {
    transferSessions.delete(transferId);
}

function cleanupSocketSessions(ws) {
    for (const [transferId, session] of transferSessions.entries()) {
        if (session.clientWs === ws || session.shopCode === ws.shopCode) {
            transferSessions.delete(transferId);
        }
    }
}

setInterval(() => {
    const cutoff = Date.now() - (30 * 60 * 1000);
    for (const [transferId, session] of transferSessions.entries()) {
        if (session.createdAt < cutoff) {
            transferSessions.delete(transferId);
        }
    }
}, 5 * 60 * 1000).unref();

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Print Shop API Server',
        version: '2.0.0',
        status: 'running'
    });
});

app.get('/shop/public/:shopCode', async (req, res) => {
    try {
        const shopCode = req.params.shopCode;
        if (!shopCode) return res.status(400).json({ error: 'shopCode required' });

        let shop;
        try {
            const result = await pool.query('SELECT shop_code, shop_name, color_price, bw_price, subscription_end FROM shops WHERE shop_code = $1', [shopCode]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
            shop = result.rows[0];
        } catch (dbErr) {
            try {
                const rows = await supabaseFetch(`shops?shop_code=eq.${encodeURIComponent(shopCode)}&select=shop_code,shop_name,color_price,bw_price,subscription_end`);
                if (!rows || rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
                shop = rows[0];
            } catch (restErr) {
                console.error('Public shop lookup DB/REST error:', dbErr && dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }

        const subEnd = shop.subscription_end || shop.subscriptionEnd || shop.end_date || shop.expires_at;
        if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
            return res.status(403).json({ error: 'Subscription expired' });
        }

        return res.json({
            shop: {
                code: shop.shop_code,
                name: shop.shop_name || shop.name || shop.shop_code,
                colorPrice: shop.color_price ?? null,
                bwPrice: shop.bw_price ?? null
            }
        });
    } catch (error) {
        console.error('Public shop lookup error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Login endpoint
app.post('/auth/login', async (req, res) => {
    try {
        const { shopCode, password } = req.body;
        if (!shopCode || !password) return res.status(400).json({ error: 'shopCode and password required' });
        let shop;
        try {
            const result = await pool.query('SELECT s.* FROM shops s WHERE s.shop_code = $1', [shopCode]);
            if (result.rows.length === 0) {
                throw new Error('Not found');
            }
            shop = result.rows[0];
        } catch (dbErr) {
            // Fallback to Supabase REST
            try {
                const rows = await supabaseFetch(`shops?shop_code=eq.${encodeURIComponent(shopCode)}&select=*`);
                if (!rows || rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
                shop = rows[0];
            } catch (restErr) {
                console.error('Login DB/REST error:', dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
        // Verify password via password_hash
        const hash = shop.password_hash || shop.passwordHash || shop.passwordHash;
        if (!hash) return res.status(403).json({ error: 'Password not set for shop' });
        const ok = await bcrypt.compare(password, hash);
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

        // Check subscription end date (if present). If expired, prevent login.
        const subEnd = shop.subscription_end || shop.subscriptionEnd || shop.end_date || shop.expires_at;
        if (subEnd) {
            const now = Date.now();
            const endTs = new Date(subEnd).getTime();
            if (!isNaN(endTs) && now > endTs) {
                return res.status(403).json({ error: 'Subscription expired' });
            }
        }

        const token = jwt.sign({ shopId: shop.id, shopCode: shop.shop_code || shop.shop_code }, process.env.JWT_SECRET);
        res.json({ token, shop: { code: shop.shop_code || shop.shop_code, name: shop.shop_name || shop.name, colorPrice: shop.color_price, bwPrice: shop.bw_price, subscriptionEnd: subEnd || null } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update shop prices endpoint
app.post('/shop/update-prices', async (req, res) => {
    try {
        const { shopCode, colorPrice, bwPrice } = req.body;
        // Per config: do not access Postgres for price updates. Use Supabase REST API only.
        try {
            const updated = await supabaseFetch(`shops?shop_code=eq.${encodeURIComponent(shopCode)}`, {
                method: 'PATCH',
                body: JSON.stringify({ color_price: colorPrice, bw_price: bwPrice }),
                headers: { Prefer: 'return=representation' }
            });
            return res.json({ success: true, shop: updated && updated[0] });
        } catch (restErr) {
            console.error('Update prices REST error:', restErr.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    } catch (error) {
        console.error('Update prices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Set shop password (hashes server-side). Allows initial password setup.
app.post('/shop/set-password', async (req, res) => {
    try {
        const { shopCode, password } = req.body;
        if (!shopCode || !password) return res.status(400).json({ error: 'shopCode and password required' });

        const hash = await bcrypt.hash(password, 10);

        // Try direct DB update first
        try {
            const result = await pool.query('UPDATE shops SET password_hash = $1 WHERE shop_code = $2 RETURNING *', [hash, shopCode]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
            return res.json({ success: true });
        } catch (dbErr) {
            // Fallback to Supabase REST
            try {
                await supabaseFetch(`shops?shop_code=eq.${encodeURIComponent(shopCode)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ password_hash: hash }),
                    headers: { Prefer: 'return=representation' }
                });
                return res.json({ success: true });
            } catch (restErr) {
                console.error('Set password DB/REST error:', dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Set password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Admin endpoints ---
// Admin login: POST { username, password }
app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'username and password required' });

        // Try DB first
        try {
            const q = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
            if (q.rows.length === 0) {
                // fallback to REST
                throw new Error('notfound');
            }
            const admin = q.rows[0];
            const ok = await bcrypt.compare(password, admin.password_hash);
            if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
            const token = jwt.sign({ adminId: admin.id, username: admin.username, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
            return res.json({ token, admin: { id: admin.id, username: admin.username } });
        } catch (dbErr) {
            // Supabase REST fallback
            try {
                const rows = await supabaseFetch(`admins?username=eq.${encodeURIComponent(username)}&select=*`);
                if (!rows || rows.length === 0) return res.status(404).json({ error: 'Admin not found' });
                const admin = rows[0];
                const ok = await bcrypt.compare(password, admin.password_hash);
                if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
                const token = jwt.sign({ adminId: admin.id, username: admin.username, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
                return res.json({ token, admin: { id: admin.id, username: admin.username } });
            } catch (restErr) {
                console.error('Admin login error:', dbErr && dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create shop (admin only) - requires Authorization: Bearer <token>
app.post('/admin/create-shop', async (req, res) => {
    try {
        const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!auth) return res.status(401).json({ error: 'Unauthorized' });
        let decoded;
        try { decoded = jwt.verify(auth, process.env.JWT_SECRET); } catch (err) { return res.status(401).json({ error: 'Invalid token' }); }
        if (!decoded || !decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });

        const { shopCode, shopName, password, colorPrice, bwPrice, subscriptionDays, subscriptionEnd } = req.body;
        if (!shopCode || !password) return res.status(400).json({ error: 'shopCode and password required' });

        const hash = await bcrypt.hash(password, 10);
        const startDate = new Date();
        let endDate;
        if (subscriptionEnd) {
            // accept ISO date or yyyy-mm-dd from frontend
            endDate = new Date(subscriptionEnd);
            if (isNaN(endDate.getTime())) {
                return res.status(400).json({ error: 'Invalid subscriptionEnd date' });
            }
        } else {
            const days = parseInt(subscriptionDays || '365', 10) || 365;
            endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
        }

        // Try DB insert first
        try {
            const shopRes = await pool.query('INSERT INTO shops (shop_code, shop_name, password_hash, color_price, bw_price, subscription_end, created_at) VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING *', [shopCode, shopName || null, hash, colorPrice || null, bwPrice || null, endDate.toISOString()]);
            const shop = shopRes.rows[0];
            return res.json({ success: true, shop: shop });
        } catch (dbErr) {
            // REST fallback: insert into shops and subscriptions
            try {
                // Inspect Supabase 'shops' to ensure password_hash exists and use subscription_end field
                const shopCols = await supabaseInspectTable('shops');
                if (shopCols === null) {
                    console.error('Could not inspect Supabase shops table schema');
                    return res.status(500).json({ error: 'Supabase inspect failed' });
                }
                if (!shopCols.includes('password_hash')) {
                    return res.status(500).json({
                        error: 'Supabase schema missing column',
                        details: "Missing column: password_hash on 'shops'. Run the DB migration to add this column (see database/ensure_columns.sql)."
                    });
                }

                const shopPayload = { shop_code: shopCode, shop_name: shopName || null, password_hash: hash, color_price: colorPrice || null, bw_price: bwPrice || null, subscription_end: endDate.toISOString() };
                const shopInsert = await supabaseFetch('shops', {
                    method: 'POST',
                    body: JSON.stringify([shopPayload])
                });
                const createdShop = Array.isArray(shopInsert) ? shopInsert[0] : shopInsert;
                return res.json({ success: true, shop: createdShop });
            } catch (restErr) {
                console.error('Create shop DB/REST error:', dbErr && dbErr.message, restErr && restErr.message);
                const msg = restErr && restErr.message ? restErr.message : '';
                if (msg.includes("Could not find the 'password_hash'")) {
                    return res.status(500).json({
                        error: 'Supabase schema missing column',
                        details: "Missing column: password_hash. Run the DB migration to add this column (see database/schema.sql). Example: ALTER TABLE shops ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);"
                    });
                }
                if (msg.includes('PGRST204')) {
                    return res.status(500).json({ error: 'Supabase REST schema error', details: msg });
                }
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Create shop error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List shops for admin with subscription status
app.get('/admin/shops', async (req, res) => {
    try {
        const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!auth) return res.status(401).json({ error: 'Unauthorized' });
        let decoded;
        try { decoded = jwt.verify(auth, process.env.JWT_SECRET); } catch (err) { return res.status(401).json({ error: 'Invalid token' }); }
        if (!decoded || !decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });

        // Try DB first: read shops and subscription_end
        try {
            const q = await pool.query(`SELECT s.shop_code, s.shop_name, s.color_price, s.bw_price, s.subscription_end, s.created_at FROM shops s ORDER BY s.shop_code`);
            return res.json({ shops: q.rows });
        } catch (dbErr) {
            try {
                const rows = await supabaseFetch('shops?select=*');
                return res.json({ shops: rows });
            } catch (restErr) {
                console.error('Admin shops DB/REST error:', dbErr && dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Admin shops error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete shop (admin only)
app.delete('/admin/shop/:shopCode', async (req, res) => {
    try {
        const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!auth) return res.status(401).json({ error: 'Unauthorized' });
        let decoded;
        try { decoded = jwt.verify(auth, process.env.JWT_SECRET); } catch (err) { return res.status(401).json({ error: 'Invalid token' }); }
        if (!decoded || !decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });

        const shopCode = req.params.shopCode;
        if (!shopCode) return res.status(400).json({ error: 'shopCode required' });

        // Try DB delete first
        try {
            // find shop id
            const q = await pool.query('SELECT id FROM shops WHERE shop_code = $1', [shopCode]);
            if (q.rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
            const shopId = q.rows[0].id;
            const del = await pool.query('DELETE FROM shops WHERE id = $1 RETURNING *', [shopId]);
            return res.json({ success: true, shop: del.rows[0] });
        } catch (dbErr) {
            // Supabase REST fallback: delete shops
            try {
                await supabaseFetch(`shops?shop_code=eq.${encodeURIComponent(shopCode)}`, { method: 'DELETE' });
                return res.json({ success: true });
            } catch (restErr) {
                console.error('Delete shop DB/REST error:', dbErr && dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Delete shop error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// --- end admin endpoints ---

// Admin: update shop fields (prices, subscription_end)
app.patch('/admin/shop/:shopCode', async (req, res) => {
    try {
        const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!auth) return res.status(401).json({ error: 'Unauthorized' });
        let decoded;
        try { decoded = jwt.verify(auth, process.env.JWT_SECRET); } catch (err) { return res.status(401).json({ error: 'Invalid token' }); }
        if (!decoded || !decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });

        const shopCode = req.params.shopCode;
        const { colorPrice, bwPrice, subscriptionDays, subscriptionEnd } = req.body;
        if (!shopCode) return res.status(400).json({ error: 'shopCode required' });

        let endDate = null;
        if (subscriptionEnd) {
            endDate = new Date(subscriptionEnd);
            if (isNaN(endDate.getTime())) return res.status(400).json({ error: 'Invalid subscriptionEnd' });
        } else if (subscriptionDays) {
            const days = parseInt(subscriptionDays, 10) || 0;
            endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        }

        // Build update query
        const updates = [];
        const params = [];
        let idx = 1;
        if (colorPrice !== undefined) { updates.push(`color_price = $${idx}`); params.push(colorPrice); idx++; }
        if (bwPrice !== undefined) { updates.push(`bw_price = $${idx}`); params.push(bwPrice); idx++; }
        if (endDate !== null) { updates.push(`subscription_end = $${idx}`); params.push(endDate.toISOString()); idx++; }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(shopCode);
        const q = `UPDATE shops SET ${updates.join(', ')} WHERE shop_code = $${idx} RETURNING *`;
        try {
            const r = await pool.query(q, params);
            if (r.rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
            return res.json({ success: true, shop: r.rows[0] });
        } catch (dbErr) {
            // REST fallback
            try {
                const body = {};
                if (colorPrice !== undefined) body.color_price = colorPrice;
                if (bwPrice !== undefined) body.bw_price = bwPrice;
                if (endDate !== null) body.subscription_end = endDate.toISOString();
                await supabaseFetch(`shops?shop_code=eq.${encodeURIComponent(shopCode)}`, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=representation' } });
                return res.json({ success: true });
            } catch (restErr) {
                console.error('Update shop DB/REST error:', dbErr && dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Update shop error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// One-time admin registration endpoint.
// If `ADMIN_SETUP_KEY` is set in env, caller must supply matching `setupKey` in the POST body.
// Otherwise registration is allowed only when no admins exist (first-time setup).
app.post('/admin/register', async (req, res) => {
    try {
        const { username, password, setupKey } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'username and password required' });

        const requiredKey = process.env.ADMIN_SETUP_KEY;
        if (requiredKey) {
            if (!setupKey || setupKey !== requiredKey) return res.status(403).json({ error: 'setup key required' });
        } else {
            // If no setup key defined, only allow registration if there are no admins yet
            try {
                const q = await pool.query('SELECT count(*) AS cnt FROM admins');
                const cnt = parseInt(q.rows[0].cnt || '0', 10);
                if (cnt > 0) return res.status(403).json({ error: 'Admin registration disabled' });
            } catch (dbErr) {
                // fallback to REST check
                try {
                    const rows = await supabaseFetch('admins?select=id');
                    if (rows && rows.length > 0) return res.status(403).json({ error: 'Admin registration disabled' });
                } catch (restErr) {
                    console.error('Admin register check error:', dbErr && dbErr.message, restErr && restErr.message);
                    return res.status(500).json({ error: 'Internal server error' });
                }
            }
        }

        const hash = await bcrypt.hash(password, 10);

        // Try DB insert first
        try {
            const ins = await pool.query('INSERT INTO admins (username, password_hash, created_at) VALUES ($1,$2,now()) RETURNING *', [username, hash]);
            const admin = ins.rows[0];
            const token = jwt.sign({ adminId: admin.id, username: admin.username, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
            return res.json({ success: true, token, admin: { id: admin.id, username: admin.username } });
        } catch (dbErr) {
            // REST fallback
            try {
                const insert = await supabaseFetch('admins', { method: 'POST', body: JSON.stringify([{ username, password_hash: hash }]) });
                const created = Array.isArray(insert) ? insert[0] : insert;
                const token = jwt.sign({ adminId: created.id, username: created.username, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
                return res.json({ success: true, token, admin: { id: created.id, username: created.username } });
            } catch (restErr) {
                console.error('Admin register DB/REST error:', dbErr && dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Admin register error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Subscription check endpoint: returns subscription status; queries DB at most once per 24h
app.get('/subscription/check', async (req, res) => {
    try {
        const shopCode = req.query.shop;
        if (!shopCode) return res.status(400).json({ error: 'shop query required' });

        const cached = subscriptionCache.get(shopCode);
        const now = Date.now();
        if (cached && (now - cached.lastChecked) < 24 * 60 * 60 * 1000) {
            return res.json({ shop: shopCode, status: cached.status, source: 'cache' });
        }

        // Check subscription_end on shops table first
        try {
            const result = await pool.query('SELECT subscription_end FROM shops WHERE shop_code = $1', [shopCode]);
            const endVal = result.rows && result.rows[0] && result.rows[0].subscription_end;
            const status = (!endVal || new Date(endVal).getTime() > now) ? 'active' : 'expired';
            subscriptionCache.set(shopCode, { status, lastChecked: now });
            return res.json({ shop: shopCode, status, source: 'db' });
        } catch (dbErr) {
            try {
                const rows = await supabaseFetch(`shops?select=subscription_end&shop_code=eq.${encodeURIComponent(shopCode)}`);
                const endVal = rows && rows[0] && (rows[0].subscription_end || rows[0].end_date || rows[0].expires_at);
                const status = (!endVal || new Date(endVal).getTime() > now) ? 'active' : 'expired';
                subscriptionCache.set(shopCode, { status, lastChecked: now });
                return res.json({ shop: shopCode, status, source: 'rest' });
            } catch (restErr) {
                console.error('Subscription check DB/REST error:', dbErr.message, restErr && restErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
    } catch (error) {
        console.error('Subscription check error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Share Target endpoint (for PWA shared files)
app.post('/share', (req, res) => {
    // Redirect to frontend with shared=true flag
    const shopId = req.query.shop || '';
    res.redirect(`/?shop=${shopId}&shared=true`);
});

wss.on('connection', (ws) => {
    // mark as not registered until a successful REGISTER_SHOP with valid JWT
    ws.isRegistered = false;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'REGISTER_SHOP') {
                // Require token
                if (!data.token) {
                    ws.send(JSON.stringify({ type: 'REGISTER_FAILED', reason: 'missing_token' }));
                    ws.close();
                    return;
                }

                let decoded;
                try {
                    decoded = jwt.verify(data.token, process.env.JWT_SECRET);
                } catch (err) {
                    ws.send(JSON.stringify({ type: 'REGISTER_FAILED', reason: 'invalid_token' }));
                    ws.close();
                    return;
                }

                // decoded must contain shopCode/shopCode
                const shopCode = decoded.shopCode || decoded.shop_code || decoded.shop || decoded.code;
                if (!shopCode) {
                    ws.send(JSON.stringify({ type: 'REGISTER_FAILED', reason: 'invalid_payload' }));
                    ws.close();
                    return;
                }
                // Ensure subscription still valid for this shop
                try {
                    const r = await pool.query('SELECT subscription_end FROM shops WHERE shop_code = $1', [shopCode]);
                    const subEnd = r.rows && r.rows[0] && r.rows[0].subscription_end;
                    if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
                        ws.send(JSON.stringify({ type: 'REGISTER_FAILED', reason: 'subscription_expired' }));
                        ws.close();
                        return;
                    }
                } catch (dbErr) {
                    // fallback to REST check
                    try {
                        const rows = await supabaseFetch(`shops?select=subscription_end&shop_code=eq.${encodeURIComponent(shopCode)}`);
                        const subEnd = rows && rows[0] && (rows[0].subscription_end || rows[0].end_date || rows[0].expires_at);
                        if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
                            ws.send(JSON.stringify({ type: 'REGISTER_FAILED', reason: 'subscription_expired' }));
                            ws.close();
                            return;
                        }
                    } catch (restErr) {
                        console.error('WS register subscription check error:', dbErr && dbErr.message, restErr && restErr.message);
                        ws.send(JSON.stringify({ type: 'REGISTER_FAILED', reason: 'internal_error' }));
                        ws.close();
                        return;
                    }
                }

                onlineShops.set(shopCode, ws);
                ws.shopCode = shopCode;
                ws.isRegistered = true;
                console.log('shop registered', shopCode);
                ws.send(JSON.stringify({ type: 'REGISTER_SUCCESS' }));
            }

            else if (data.type === 'CHECK_STATUS') {
                const shopWs = onlineShops.get(data.shopId);
                if (shopWs && shopWs.readyState === WebSocket.OPEN) {
                    connectedClients.set(data.senderId, ws);
                    ws.clientId = data.senderId;
                    sendJson(ws, { type: 'STATUS_RESPONSE', status: 'ONLINE' });
                } else {
                    sendJson(ws, { type: 'STATUS_RESPONSE', status: 'OFFLINE' });
                }
            }

            else if (data.type === 'TRANSFER_INIT') {
                const shopWs = onlineShops.get(data.shopId);
                const transferSize = Number(data?.metadata?.fileSize || 0);

                if (!data.transferId || !data.senderId) {
                    sendJson(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId || null, reason: 'invalid_transfer' });
                    return;
                }
                if (!Number.isFinite(transferSize) || transferSize <= 0 || transferSize > MAX_TRANSFER_SIZE_BYTES) {
                    sendJson(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId, reason: 'invalid_file_size' });
                    return;
                }
                if (!shopWs || shopWs.readyState !== WebSocket.OPEN) {
                    sendJson(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId, reason: 'shop_offline' });
                    return;
                }

                connectedClients.set(data.senderId, ws);
                ws.clientId = data.senderId;
                registerTransferSession(data.transferId, data.shopId, data.senderId, ws);

                sendJson(shopWs, {
                    type: 'TRANSFER_INIT',
                    transferId: data.transferId,
                    clientId: data.senderId,
                    metadata: data.metadata
                });
            }

            else if (data.type === 'WEBRTC_OFFER') {
                const shopWs = onlineShops.get(data.shopId);
                if (!shopWs || shopWs.readyState !== WebSocket.OPEN) {
                    sendJson(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId, reason: 'shop_offline' });
                    closeTransferSession(data.transferId);
                    return;
                }

                connectedClients.set(data.senderId, ws);
                ws.clientId = data.senderId;
                registerTransferSession(data.transferId, data.shopId, data.senderId, ws);
                sendJson(shopWs, {
                    type: 'WEBRTC_OFFER',
                    transferId: data.transferId,
                    clientId: data.senderId,
                    offer: data.offer,
                    metadata: data.metadata
                });
            }

            else if (data.type === 'WEBRTC_ANSWER') {
                const session = getTransferSession(data.transferId);
                if (!session) return;
                sendJson(session.clientWs, {
                    type: 'WEBRTC_ANSWER',
                    transferId: data.transferId,
                    answer: data.answer
                });
            }

            else if (data.type === 'ICE_CANDIDATE') {
                const session = getTransferSession(data.transferId);
                if (!session) return;

                const isShopSender = !!ws.shopCode;
                if (isShopSender) {
                    sendJson(session.clientWs, {
                        type: 'ICE_CANDIDATE',
                        transferId: data.transferId,
                        candidate: data.candidate
                    });
                } else {
                    const shopWs = onlineShops.get(session.shopCode);
                    if (shopWs && shopWs.readyState === WebSocket.OPEN) {
                        sendJson(shopWs, {
                            type: 'ICE_CANDIDATE',
                            transferId: data.transferId,
                            clientId: session.clientId,
                            candidate: data.candidate
                        });
                    }
                }
            }

            else if (data.type === 'TRANSFER_STATE') {
                const session = getTransferSession(data.transferId);
                if (!session) return;
                sendJson(session.clientWs, {
                    type: 'TRANSFER_STATE',
                    transferId: data.transferId,
                    state: data.state,
                    details: data.details || null
                });
                if (data.state === 'COMPLETED' || data.state === 'FAILED') {
                    closeTransferSession(data.transferId);
                }
            }
        } catch (error) {
            console.error('WebSocket error:', error);
        }
    });

    ws.on('close', () => {
        if (ws.shopCode) {
            onlineShops.delete(ws.shopCode);
            console.log('shop disconnected', ws.shopCode);
        }
        if (ws.clientId) {
            connectedClients.delete(ws.clientId);
        }
        cleanupSocketSessions(ws);
    });
});

console.log('✓ Signaling server ready');
