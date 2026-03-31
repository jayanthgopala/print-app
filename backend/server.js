const subscriptionCache = new Map();
let schemaReadyPromise;
const PC_HEARTBEAT_TTL_MS = 90 * 1000;
const PC_HEALTHCHECK_TIMEOUT_MS = 4000;

const SCHEMA_SQL = `
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
    pc_last_seen TEXT,
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
`;

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);

            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: buildCorsHeaders(request, env)
                });
            }

            if (request.method === 'GET' && url.pathname === '/health') {
                return json({ status: 'ok', timestamp: new Date().toISOString() }, 200, request, env);
            }

            if (request.method === 'GET' && url.pathname === '/') {
                return json({
                    message: 'Print Shop API Server',
                    version: '3.0.0-worker',
                    status: 'running'
                }, 200, request, env);
            }

            if (request.method === 'GET' && matchPath(url.pathname, '/shop/public/:shopCode')) {
                const { shopCode } = matchPath(url.pathname, '/shop/public/:shopCode');
                return handlePublicShopLookup(shopCode, request, env);
            }

            if (request.method === 'POST' && url.pathname === '/shop/info') {
                return handleShopInfo(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/auth/login') {
                return handleShopLogin(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/auth/shop-login') {
                return handleShopLogin(request, env, { tokenType: 'SHOP', expiresInSeconds: 30 * 24 * 60 * 60 });
            }

            if (request.method === 'POST' && url.pathname === '/auth/client-token') {
                return handleClientToken(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/auth/verify-client-token') {
                return handleVerifyClientToken(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/auth/shop-token') {
                return handleShopToken(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/shop/update-prices') {
                return handleUpdatePrices(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/shop/set-password') {
                return handleSetPassword(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/admin/login') {
                return handleAdminLogin(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/admin/create-shop') {
                return handleCreateShop(request, env);
            }

            if (request.method === 'GET' && url.pathname === '/admin/shops') {
                return handleListShops(request, env);
            }

            if (request.method === 'DELETE' && matchPath(url.pathname, '/admin/shop/:shopCode')) {
                const { shopCode } = matchPath(url.pathname, '/admin/shop/:shopCode');
                return handleDeleteShop(shopCode, request, env);
            }

            if (request.method === 'PATCH' && matchPath(url.pathname, '/admin/shop/:shopCode')) {
                const { shopCode } = matchPath(url.pathname, '/admin/shop/:shopCode');
                return handlePatchShop(shopCode, request, env);
            }

            if (request.method === 'POST' && url.pathname === '/admin/register') {
                return handleAdminRegister(request, env);
            }

            if (request.method === 'GET' && url.pathname === '/subscription/check') {
                return handleSubscriptionCheck(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/pc/status') {
                return handlePcStatus(request, env);
            }

            if (request.method === 'POST' && url.pathname === '/share') {
                const shopId = url.searchParams.get('shop') || '';
                return redirect(`/?shop=${encodeURIComponent(shopId)}&shared=true`, request, env);
            }

            return json({ error: 'Not found' }, 404, request, env);
        } catch (error) {
            console.error('Unhandled worker error:', error);
            return json({ error: 'Internal server error' }, 500, request, env);
        }
    }
};

async function handlePublicShopLookup(shopCode, request, env) {
    if (!shopCode) return json({ error: 'shopCode required' }, 400, request, env);

    try {
        const shop = await dbGetShopByCode(env, normalizeShopCode(shopCode));
        if (!shop) return json({ error: 'Shop not found' }, 404, request, env);

        const subEnd = shop.subscription_end;
        if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
            return json({ error: 'Subscription expired' }, 403, request, env);
        }

        const availability = await resolveShopPcAvailability(shop);

        return json({
            shop: {
                code: shop.shop_code,
                name: shop.shop_name || shop.name || shop.shop_code,
                pcEndpoint: availability.status === 'online' ? availability.endpoint : null,
                status: availability.status,
                colorPrice: shop.color_price ?? null,
                bwPrice: shop.bw_price ?? null
            }
        }, 200, request, env);
    } catch (error) {
        console.error('Public shop lookup error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleShopInfo(request, env) {
    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { shopCode } = body.data;
    if (!shopCode) return json({ error: 'shopCode required' }, 400, request, env);

    try {
        const shop = await dbGetShopByCode(env, normalizeShopCode(shopCode));
        if (!shop) {
            return json({ error: 'Shop not found', shop: null }, 404, request, env);
        }

        const availability = await resolveShopPcAvailability(shop);
        return json({
            shop: {
                code: shop.shop_code,
                name: shop.shop_name || shop.name || shop.shop_code,
                pcEndpoint: availability.endpoint,
                status: availability.status,
                colorPrice: shop.color_price ?? null,
                bwPrice: shop.bw_price ?? null
            }
        }, 200, request, env);
    } catch (error) {
        console.error('Shop info error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleShopLogin(request, env, options = {}) {
    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { shopCode, password } = body.data;
    if (!shopCode || !password) {
        return json({ error: 'shopCode and password required' }, 400, request, env);
    }

    try {
        const normalizedShopCode = normalizeShopCode(shopCode);
        const shop = await dbGetShopByCode(env, normalizedShopCode);
        if (!shop) return json({ error: 'Shop not found' }, 404, request, env);

        const hash = shop.password_hash;
        if (!hash) return json({ error: 'Password not set for shop' }, 403, request, env);

        const ok = await comparePassword(password, hash);
        if (!ok) return json({ error: 'Invalid credentials' }, 401, request, env);

        const subEnd = shop.subscription_end;
        if (subEnd && Date.now() > new Date(subEnd).getTime()) {
            return json({ error: 'Subscription expired' }, 403, request, env);
        }

        const token = await signJwt({
            shopId: shop.id,
            shopCode: shop.shop_code,
            type: options.tokenType || undefined,
            exp: Math.floor(Date.now() / 1000) + (options.expiresInSeconds || (24 * 60 * 60))
        }, env.JWT_SECRET);

        return json({
            token,
            shop: {
                code: shop.shop_code,
                name: shop.shop_name || shop.name,
                colorPrice: shop.color_price,
                bwPrice: shop.bw_price,
                subscriptionEnd: subEnd || null
            }
        }, 200, request, env);
    } catch (error) {
        console.error('Login error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleClientToken(request, env) {
    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { shopCode } = body.data;
    if (!shopCode) return json({ error: 'shopCode required' }, 400, request, env);

    try {
        const normalizedShopCode = normalizeShopCode(shopCode);
        const shop = await dbGetShopByCode(env, normalizedShopCode);
        if (!shop) return json({ error: 'Shop not found' }, 404, request, env);

        const subEnd = shop.subscription_end;
        if (subEnd && Date.now() > new Date(subEnd).getTime()) {
            return json({ error: 'Subscription expired' }, 403, request, env);
        }

        const token = await signJwt({
            type: 'CLIENT',
            clientId: crypto.randomUUID(),
            shopCode: shop.shop_code,
            shopId: shop.id,
            exp: Math.floor(Date.now() / 1000) + (60 * 60)
        }, env.JWT_SECRET);

        return json({ token }, 200, request, env);
    } catch (error) {
        console.error('Client token error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleShopToken(request, env) {
    return handleShopLogin(request, env, { tokenType: 'SHOP', expiresInSeconds: 30 * 24 * 60 * 60 });
}

async function handleVerifyClientToken(request, env) {
    const auth = getBearerToken(request);
    if (!auth) return json({ error: 'Unauthorized' }, 401, request, env);

    let decoded;
    try {
        decoded = await verifyJwt(auth, env.JWT_SECRET);
    } catch {
        return json({ error: 'Invalid token' }, 401, request, env);
    }

    if (!decoded || decoded.type !== 'CLIENT' || !decoded.shopCode) {
        return json({ error: 'Client token required' }, 403, request, env);
    }

    try {
        const shop = await dbGetShopByCode(env, normalizeShopCode(decoded.shopCode));
        if (!shop) {
            return json({ error: 'Shop not found' }, 404, request, env);
        }

        const subEnd = shop.subscription_end;
        if (subEnd && Date.now() > new Date(subEnd).getTime()) {
            return json({ error: 'Subscription expired' }, 403, request, env);
        }

        return json({
            ok: true,
            clientId: decoded.clientId || null,
            shopCode: shop.shop_code,
            shopId: shop.id
        }, 200, request, env);
    } catch (error) {
        console.error('Verify client token error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleUpdatePrices(request, env) {
    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { shopCode, colorPrice, bwPrice } = body.data;
    if (!shopCode) return json({ error: 'shopCode required' }, 400, request, env);

    try {
        await dbRun(
            env,
            'UPDATE shops SET color_price = ?, bw_price = ?, updated_at = CURRENT_TIMESTAMP WHERE shop_code = ?',
            colorPrice,
            bwPrice,
            normalizeShopCode(shopCode)
        );
        const updated = await dbGetShopByCode(env, normalizeShopCode(shopCode));
        return json({ success: true, shop: updated || null }, 200, request, env);
    } catch (error) {
        console.error('Update prices error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleSetPassword(request, env) {
    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { shopCode, password } = body.data;
    if (!shopCode || !password) {
        return json({ error: 'shopCode and password required' }, 400, request, env);
    }

    try {
        const hash = await hashPassword(password);
        await dbRun(
            env,
            'UPDATE shops SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE shop_code = ?',
            hash,
            normalizeShopCode(shopCode)
        );
        return json({ success: true }, 200, request, env);
    } catch (error) {
        console.error('Set password error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleAdminLogin(request, env) {
    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { username, password } = body.data;
    if (!username || !password) {
        return json({ error: 'username and password required' }, 400, request, env);
    }

    try {
        const admin = await dbGetAdminByUsername(env, username);
        if (!admin) return json({ error: 'Admin not found' }, 404, request, env);

        const ok = await comparePassword(password, admin.password_hash);
        if (!ok) return json({ error: 'Invalid credentials' }, 401, request, env);

        const token = await signJwt({
            adminId: admin.id,
            username: admin.username,
            isAdmin: true,
            exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60)
        }, env.JWT_SECRET);

        return json({ token, admin: { id: admin.id, username: admin.username } }, 200, request, env);
    } catch (error) {
        console.error('Admin login error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleCreateShop(request, env) {
    const admin = await requireAdmin(request, env);
    if (admin.errorResponse) return admin.errorResponse;

    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { shopCode, shopName, password, colorPrice, bwPrice, subscriptionDays, subscriptionEnd } = body.data;
    if (!shopCode || !password) {
        return json({ error: 'shopCode and password required' }, 400, request, env);
    }

    try {
        const hash = await hashPassword(password);
        const startDate = new Date();
        let endDate;

        if (subscriptionEnd) {
            endDate = new Date(subscriptionEnd);
            if (Number.isNaN(endDate.getTime())) {
                return json({ error: 'Invalid subscriptionEnd date' }, 400, request, env);
            }
        } else {
            const days = parseInt(subscriptionDays || '365', 10) || 365;
            endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
        }

        const shopId = crypto.randomUUID();
        await dbRun(
            env,
            `INSERT INTO shops (
                id, shop_code, shop_name, password_hash, color_price, bw_price, subscription_end, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            shopId,
            normalizeShopCode(shopCode),
            shopName || normalizeShopCode(shopCode),
            hash,
            colorPrice ?? null,
            bwPrice ?? null,
            endDate.toISOString()
        );

        return json({ success: true, shop: await dbGetShopByCode(env, normalizeShopCode(shopCode)) }, 200, request, env);
    } catch (error) {
        console.error('Create shop error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleListShops(request, env) {
    const admin = await requireAdmin(request, env);
    if (admin.errorResponse) return admin.errorResponse;

    try {
        const rows = await dbAll(
            env,
            'SELECT shop_code, shop_name, color_price, bw_price, subscription_end, created_at FROM shops ORDER BY shop_code'
        );
        return json({ shops: rows || [] }, 200, request, env);
    } catch (error) {
        console.error('Admin shops error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleDeleteShop(shopCode, request, env) {
    const admin = await requireAdmin(request, env);
    if (admin.errorResponse) return admin.errorResponse;

    if (!shopCode) return json({ error: 'shopCode required' }, 400, request, env);

    try {
        await dbRun(env, 'DELETE FROM shops WHERE shop_code = ?', normalizeShopCode(shopCode));
        return json({ success: true }, 200, request, env);
    } catch (error) {
        console.error('Delete shop error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handlePatchShop(shopCode, request, env) {
    const admin = await requireAdmin(request, env);
    if (admin.errorResponse) return admin.errorResponse;

    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    if (!shopCode) return json({ error: 'shopCode required' }, 400, request, env);

    const { colorPrice, bwPrice, subscriptionDays, subscriptionEnd } = body.data;
    const patch = {};

    if (colorPrice !== undefined) patch.color_price = colorPrice;
    if (bwPrice !== undefined) patch.bw_price = bwPrice;

    if (subscriptionEnd) {
        const endDate = new Date(subscriptionEnd);
        if (Number.isNaN(endDate.getTime())) return json({ error: 'Invalid subscriptionEnd' }, 400, request, env);
        patch.subscription_end = endDate.toISOString();
    } else if (subscriptionDays) {
        const days = parseInt(subscriptionDays, 10) || 0;
        patch.subscription_end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    if (Object.keys(patch).length === 0) {
        return json({ error: 'No fields to update' }, 400, request, env);
    }

    try {
        const clauses = [];
        const params = [];
        if (patch.color_price !== undefined) {
            clauses.push('color_price = ?');
            params.push(patch.color_price);
        }
        if (patch.bw_price !== undefined) {
            clauses.push('bw_price = ?');
            params.push(patch.bw_price);
        }
        if (patch.subscription_end !== undefined) {
            clauses.push('subscription_end = ?');
            params.push(patch.subscription_end);
        }
        clauses.push('updated_at = CURRENT_TIMESTAMP');
        params.push(normalizeShopCode(shopCode));
        await dbRun(env, `UPDATE shops SET ${clauses.join(', ')} WHERE shop_code = ?`, ...params);
        return json({ success: true }, 200, request, env);
    } catch (error) {
        console.error('Update shop error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleAdminRegister(request, env) {
    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const { username, password, setupKey } = body.data;
    if (!username || !password) {
        return json({ error: 'username and password required' }, 400, request, env);
    }

    try {
        if (env.ADMIN_SETUP_KEY) {
            if (!setupKey || setupKey !== env.ADMIN_SETUP_KEY) {
                return json({ error: 'setup key required' }, 403, request, env);
            }
        } else {
            const existingAdmins = await dbAll(env, 'SELECT id FROM admins LIMIT 1');
            if (existingAdmins?.length) {
                return json({ error: 'Admin registration disabled' }, 403, request, env);
            }
        }

        const hash = await hashPassword(password);
        const adminId = crypto.randomUUID();
        await dbRun(
            env,
            'INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            adminId,
            username,
            hash
        );
        const created = await dbGetAdminByUsername(env, username);
        const token = await signJwt({
            adminId: created.id,
            username: created.username,
            isAdmin: true,
            exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60)
        }, env.JWT_SECRET);

        return json({
            success: true,
            token,
            admin: { id: created.id, username: created.username }
        }, 200, request, env);
    } catch (error) {
        console.error('Admin register error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleSubscriptionCheck(request, env) {
    const url = new URL(request.url);
    const shopCode = url.searchParams.get('shop');
    if (!shopCode) return json({ error: 'shop query required' }, 400, request, env);

    const cached = subscriptionCache.get(shopCode);
    const now = Date.now();
    if (cached && (now - cached.lastChecked) < 24 * 60 * 60 * 1000) {
        return json({ shop: shopCode, status: cached.status, source: 'cache' }, 200, request, env);
    }

    try {
        const shop = await dbGetShopByCode(env, normalizeShopCode(shopCode));
        const endVal = shop?.subscription_end;
        const status = (!endVal || new Date(endVal).getTime() > now) ? 'active' : 'expired';
        subscriptionCache.set(shopCode, { status, lastChecked: now });
        return json({ shop: shopCode, status, source: 'd1' }, 200, request, env);
    } catch (error) {
        console.error('Subscription check error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handlePcStatus(request, env) {
    const auth = getBearerToken(request);
    if (!auth) return json({ error: 'Unauthorized' }, 401, request, env);

    let decoded;
    try {
        decoded = await verifyJwt(auth, env.JWT_SECRET);
    } catch {
        return json({ error: 'Invalid token' }, 401, request, env);
    }

    if (!decoded || decoded.type !== 'SHOP') {
        return json({ error: 'Shop token required' }, 403, request, env);
    }

    const body = await readJson(request, env);
    if (body.errorResponse) return body.errorResponse;

    const normalizedStatus = normalizePcStatus(body.data.status);
    if (!normalizedStatus) {
        return json({ error: 'Invalid PC status' }, 400, request, env);
    }

    let normalizedEndpoint;
    try {
        normalizedEndpoint = normalizePcEndpoint(body.data.endpoint);
    } catch (error) {
        return json({ error: error.message || 'Invalid endpoint' }, 400, request, env);
    }

    const patch = {};
    patch.pc_status = normalizedStatus;
    patch.pc_endpoint = normalizedStatus === 'online' ? normalizedEndpoint : null;
    patch.pc_last_seen = normalizedStatus === 'online' ? new Date().toISOString() : null;

    try {
        const clauses = [];
        const params = [];
        if (patch.pc_endpoint !== undefined) {
            clauses.push('pc_endpoint = ?');
            params.push(patch.pc_endpoint);
        }
        if (patch.pc_status !== undefined) {
            clauses.push('pc_status = ?');
            params.push(patch.pc_status);
        }
        if (patch.pc_last_seen !== undefined) {
            clauses.push('pc_last_seen = ?');
            params.push(patch.pc_last_seen);
        }
        clauses.push('updated_at = CURRENT_TIMESTAMP');
        params.push(decoded.shopId);
        await dbRun(env, `UPDATE shops SET ${clauses.join(', ')} WHERE id = ?`, ...params);
        return json({ success: true }, 200, request, env);
    } catch (error) {
        console.error('PC status update error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function requireAdmin(request, env) {
    const auth = getBearerToken(request);
    if (!auth) {
        return { errorResponse: json({ error: 'Unauthorized' }, 401, request, env) };
    }

    try {
        const decoded = await verifyJwt(auth, env.JWT_SECRET);
        if (!decoded?.isAdmin) {
            return { errorResponse: json({ error: 'Forbidden' }, 403, request, env) };
        }
        return { decoded };
    } catch {
        return { errorResponse: json({ error: 'Invalid token' }, 401, request, env) };
    }
}

async function dbGetShopByCode(env, shopCode) {
    return dbFirst(
        env,
        'SELECT id, shop_code, shop_name, owner_name, email, phone, password_hash, color_price, bw_price, subscription_end, pc_endpoint, pc_status, pc_last_seen, created_at, updated_at FROM shops WHERE shop_code = ?',
        shopCode
    );
}

async function dbGetAdminByUsername(env, username) {
    return dbFirst(
        env,
        'SELECT id, username, password_hash, created_at FROM admins WHERE username = ?',
        username
    );
}

async function dbFirst(env, sql, ...params) {
    assertDb(env);
    await ensureSchema(env);
    return env.DB.prepare(sql).bind(...params).first();
}

async function dbAll(env, sql, ...params) {
    assertDb(env);
    await ensureSchema(env);
    const result = await env.DB.prepare(sql).bind(...params).all();
    return result.results || [];
}

async function dbRun(env, sql, ...params) {
    assertDb(env);
    await ensureSchema(env);
    return env.DB.prepare(sql).bind(...params).run();
}

async function ensureSchema(env) {
    if (schemaReadyPromise) {
        return schemaReadyPromise;
    }

    schemaReadyPromise = (async () => {
        const statements = SCHEMA_SQL
            .split(';')
            .map((statement) => statement.trim())
            .filter(Boolean);

        for (const statement of statements) {
            await env.DB.prepare(statement).run();
        }

        await ensureColumn(env, 'shops', 'pc_last_seen', 'TEXT');
    })().catch((error) => {
        schemaReadyPromise = null;
        throw error;
    });

    return schemaReadyPromise;
}

function assertDb(env) {
    if (!env.DB) {
        throw new Error('D1 binding DB is missing');
    }
}

async function readJson(request, env) {
    try {
        return { data: await request.json() };
    } catch {
        return { errorResponse: json({ error: 'Invalid JSON' }, 400, request, env) };
    }
}

function matchPath(pathname, pattern) {
    const pathParts = pathname.split('/').filter(Boolean);
    const patternParts = pattern.split('/').filter(Boolean);
    if (pathParts.length !== patternParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i += 1) {
        const patternPart = patternParts[i];
        const pathPart = pathParts[i];
        if (patternPart.startsWith(':')) {
            params[patternPart.slice(1)] = decodeURIComponent(pathPart);
            continue;
        }
        if (patternPart !== pathPart) return null;
    }
    return params;
}

function getBearerToken(request) {
    const auth = request.headers.get('authorization') || '';
    return auth.replace(/^Bearer\s+/i, '') || '';
}

function json(payload, status, request, env) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...buildCorsHeaders(request, env)
        }
    });
}

function redirect(location, request, env) {
    return new Response(null, {
        status: 302,
        headers: {
            Location: location,
            ...buildCorsHeaders(request, env)
        }
    });
}

function buildCorsHeaders(request, env) {
    const allowedOrigins = getAllowedOrigins(env);
    const origin = request.headers.get('Origin');
    const allowOrigin = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin) ? (origin || '*') : 'null';

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
        Vary: 'Origin'
    };
}

function getAllowedOrigins(env) {
    return [
        env.FRONTEND_URL,
        env.ADMIN_FRONTEND_URL,
        env.CLOUDFLARE_URL,
        env.ALLOWED_ORIGINS
    ]
        .filter(Boolean)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
}

function normalizeShopCode(value) {
    return String(value || '').trim().replace(/[<>]/g, '').toUpperCase();
}

function normalizePcStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (['online', 'offline', 'starting', 'error'].includes(normalized)) {
        return normalized;
    }
    return '';
}

function normalizePcEndpoint(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(String(value).trim());
    } catch {
        throw new Error('PC endpoint must be a valid URL');
    }

    if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new Error('PC endpoint must use http or https');
    }

    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = '';
    return parsed.toString().replace(/\/+$/, '');
}

function isFreshPcHeartbeat(isoValue) {
    if (!isoValue) return false;
    const timestamp = new Date(isoValue).getTime();
    if (Number.isNaN(timestamp)) return false;
    return (Date.now() - timestamp) <= PC_HEARTBEAT_TTL_MS;
}

async function resolveShopPcAvailability(shop) {
    const endpoint = normalizeStoredEndpoint(shop.pc_endpoint);
    if (!endpoint) {
        return { status: 'offline', endpoint: null };
    }

    if ((shop.pc_status || '').toLowerCase() !== 'online') {
        return { status: 'offline', endpoint: null };
    }

    if (!isFreshPcHeartbeat(shop.pc_last_seen)) {
        return { status: 'offline', endpoint: null };
    }

    return { status: 'online', endpoint };
}

function normalizeStoredEndpoint(value) {
    try {
        return normalizePcEndpoint(value);
    } catch {
        return null;
    }
}

async function probePcHealth(endpoint) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PC_HEALTHCHECK_TIMEOUT_MS);

    try {
        const response = await fetch(`${endpoint}/health`, {
            method: 'GET',
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

async function ensureColumn(env, tableName, columnName, definition) {
    const columns = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = (columns.results || []).some((column) => column.name === columnName);
    if (!exists) {
        await env.DB.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
    }
}

async function signJwt(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = await hmacSha256(signingInput, secret);
    return `${signingInput}.${signature}`;
}

async function verifyJwt(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');

    const [encodedHeader, encodedPayload, signature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = await hmacSha256(signingInput, secret);
    if (!timingSafeEqual(signature, expectedSignature)) throw new Error('Invalid signature');

    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header.alg !== 'HS256') throw new Error('Unsupported algorithm');

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error('Token expired');
    return payload;
}

async function comparePassword(password, hash) {
    if (!hash) return false;
    return compareLegacyPassword(password, hash);
}

async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        ),
        256
    );

    const combined = new Uint8Array([...salt, ...new Uint8Array(derived)]);
    return encodeBytesToBase64(combined);
}

async function compareLegacyPassword(password, hash) {
    try {
        const combined = decodeBase64ToBytes(hash);
        const salt = combined.slice(0, 16);
        const originalHash = combined.slice(16);
        const derived = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(password),
                { name: 'PBKDF2' },
                false,
                ['deriveBits']
            ),
            256
        );

        const candidate = new Uint8Array(derived);
        if (candidate.length !== originalHash.length) return false;

        let mismatch = 0;
        for (let i = 0; i < candidate.length; i += 1) {
            mismatch |= candidate[i] ^ originalHash[i];
        }
        return mismatch === 0;
    } catch {
        return false;
    }
}

async function hmacSha256(value, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
    return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncode(value) {
    return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return atob(padded);
}

function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i += 1) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}

function decodeBase64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function encodeBytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}
