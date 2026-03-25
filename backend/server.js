const MAX_TRANSFER_SIZE_BYTES = 100 * 1024 * 1024;
const subscriptionCache = new Map();
let schemaReadyPromise;

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

            if (isWebSocketUpgrade(request)) {
                const id = env.SIGNALING_ROOM.idFromName('global');
                return env.SIGNALING_ROOM.get(id).fetch(request);
            }

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

            if (request.method === 'POST' && url.pathname === '/turn/ice-servers') {
                return handleTurnIceServers(request, env);
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

export class SignalingRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.onlineShops = new Map();
        this.connectedClients = new Map();
        this.transferSessions = new Map();
        this.socketMeta = new Map();
    }

    async fetch(request) {
        if (!isWebSocketUpgrade(request)) {
            return new Response('Expected WebSocket upgrade', { status: 426 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        this.socketMeta.set(server, { isRegistered: false, shopCode: null, clientId: null });

        server.addEventListener('message', (event) => {
            this.handleMessage(server, event.data).catch((error) => {
                console.error('DO WebSocket message error:', error);
                this.safeSend(server, { type: 'TRANSFER_ERROR', reason: 'internal_error' });
            });
        });

        server.addEventListener('close', () => this.cleanupSocket(server));
        server.addEventListener('error', () => this.cleanupSocket(server));

        return new Response(null, { status: 101, webSocket: client });
    }

    async handleMessage(ws, rawMessage) {
        let data;
        try {
            data = JSON.parse(rawMessage);
        } catch {
            this.safeSend(ws, { type: 'TRANSFER_ERROR', reason: 'invalid_json' });
            return;
        }

        if (data.type === 'REGISTER_SHOP') {
            if (!data.token) {
                this.safeSend(ws, { type: 'REGISTER_FAILED', reason: 'missing_token' });
                ws.close(1008, 'missing_token');
                return;
            }

            let decoded;
            try {
                decoded = await verifyJwt(data.token, this.env.JWT_SECRET);
            } catch {
                this.safeSend(ws, { type: 'REGISTER_FAILED', reason: 'invalid_token' });
                ws.close(1008, 'invalid_token');
                return;
            }

            const shopCode = normalizeShopCode(decoded.shopCode || decoded.shop_code || decoded.shop || decoded.code);
            if (!shopCode) {
                this.safeSend(ws, { type: 'REGISTER_FAILED', reason: 'invalid_payload' });
                ws.close(1008, 'invalid_payload');
                return;
            }

            try {
                const shop = await dbGetShopByCode(this.env, shopCode);
                const subEnd = shop?.subscription_end;
                if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
                    this.safeSend(ws, { type: 'REGISTER_FAILED', reason: 'subscription_expired' });
                    ws.close(1008, 'subscription_expired');
                    return;
                }
            } catch (error) {
                console.error('WS register subscription check error:', error);
                this.safeSend(ws, { type: 'REGISTER_FAILED', reason: 'internal_error' });
                ws.close(1011, 'internal_error');
                return;
            }

            const meta = this.socketMeta.get(ws) || {};
            meta.isRegistered = true;
            meta.shopCode = shopCode;
            this.socketMeta.set(ws, meta);
            this.onlineShops.set(shopCode, ws);
            this.safeSend(ws, { type: 'REGISTER_SUCCESS' });
            return;
        }

        if (data.type === 'CHECK_STATUS') {
            const shopWs = this.onlineShops.get(normalizeShopCode(data.shopId));
            const meta = this.socketMeta.get(ws) || {};
            meta.clientId = data.senderId || meta.clientId || crypto.randomUUID();
            this.socketMeta.set(ws, meta);
            this.connectedClients.set(meta.clientId, ws);
            this.safeSend(ws, { type: 'STATUS_RESPONSE', status: shopWs ? 'ONLINE' : 'OFFLINE' });
            return;
        }

        if (data.type === 'TRANSFER_INIT') {
            const shopWs = this.onlineShops.get(data.shopId);
            const transferSize = Number(data?.metadata?.fileSize || 0);

            if (!data.transferId || !data.senderId) {
                this.safeSend(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId || null, reason: 'invalid_transfer' });
                return;
            }
            if (!Number.isFinite(transferSize) || transferSize <= 0 || transferSize > MAX_TRANSFER_SIZE_BYTES) {
                this.safeSend(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId, reason: 'invalid_file_size' });
                return;
            }
            if (!shopWs) {
                this.safeSend(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId, reason: 'shop_offline' });
                return;
            }

            this.connectedClients.set(data.senderId, ws);
            const meta = this.socketMeta.get(ws) || {};
            meta.clientId = data.senderId;
            this.socketMeta.set(ws, meta);
            this.registerTransferSession(data.transferId, data.shopId, data.senderId, ws);

            this.safeSend(shopWs, {
                type: 'TRANSFER_INIT',
                transferId: data.transferId,
                clientId: data.senderId,
                metadata: data.metadata
            });
            return;
        }

        if (data.type === 'WEBRTC_OFFER') {
            const shopWs = this.onlineShops.get(data.shopId);
            if (!shopWs) {
                this.safeSend(ws, { type: 'TRANSFER_ERROR', transferId: data.transferId, reason: 'shop_offline' });
                this.transferSessions.delete(data.transferId);
                return;
            }

            this.connectedClients.set(data.senderId, ws);
            const meta = this.socketMeta.get(ws) || {};
            meta.clientId = data.senderId;
            this.socketMeta.set(ws, meta);
            this.registerTransferSession(data.transferId, data.shopId, data.senderId, ws);

            this.safeSend(shopWs, {
                type: 'WEBRTC_OFFER',
                transferId: data.transferId,
                clientId: data.senderId,
                offer: data.offer,
                metadata: data.metadata
            });
            return;
        }

        if (data.type === 'WEBRTC_ANSWER') {
            const session = this.transferSessions.get(data.transferId);
            if (!session) return;
            this.safeSend(session.clientWs, {
                type: 'WEBRTC_ANSWER',
                transferId: data.transferId,
                answer: data.answer
            });
            return;
        }

        if (data.type === 'ICE_CANDIDATE') {
            const session = this.transferSessions.get(data.transferId);
            if (!session) return;

            const meta = this.socketMeta.get(ws) || {};
            if (meta.shopCode) {
                this.safeSend(session.clientWs, {
                    type: 'ICE_CANDIDATE',
                    transferId: data.transferId,
                    candidate: data.candidate
                });
            } else {
                const shopWs = this.onlineShops.get(session.shopCode);
                if (shopWs) {
                    this.safeSend(shopWs, {
                        type: 'ICE_CANDIDATE',
                        transferId: data.transferId,
                        clientId: session.clientId,
                        candidate: data.candidate
                    });
                }
            }
            return;
        }

        if (data.type === 'TRANSFER_STATE') {
            const session = this.transferSessions.get(data.transferId);
            if (!session) return;
            this.safeSend(session.clientWs, {
                type: 'TRANSFER_STATE',
                transferId: data.transferId,
                state: data.state,
                details: data.details || null
            });
            if (data.state === 'COMPLETED' || data.state === 'FAILED') {
                this.transferSessions.delete(data.transferId);
            }
            return;
        }

        if (data.type === 'SEND_FILE') {
            const meta = this.socketMeta.get(ws) || {};
            const shopCode = normalizeShopCode(data.shopId || data.shopCode);
            const shopWs = this.onlineShops.get(shopCode);
            if (!shopWs) {
                this.safeSend(ws, {
                    type: 'TRANSFER_ERROR',
                    transferId: data.transferId || null,
                    reason: 'shop_offline'
                });
                return;
            }

            const senderId = data.senderId || data.clientId || meta.clientId;
            if (senderId) {
                this.connectedClients.set(senderId, ws);
                meta.clientId = senderId;
                this.socketMeta.set(ws, meta);
            }

            this.safeSend(shopWs, {
                type: 'SEND_FILE',
                transferId: data.transferId || null,
                clientId: senderId || null,
                chunkIndex: data.chunkIndex,
                totalChunks: data.totalChunks,
                isLastChunk: data.isLastChunk,
                metadata: data.metadata || null,
                fileData: data.fileData
            });
            return;
        }

        if (data.type === 'CHUNK_ACK') {
            const clientSession = this.connectedClients.get(data.clientId);
            if (clientSession) {
                this.safeSend(clientSession, {
                    type: 'CHUNK_ACK',
                    transferId: data.transferId || null,
                    chunkIndex: data.chunkIndex
                });
            }
            return;
        }

        if (data.type === 'FILE_ACK') {
            const clientSession = this.connectedClients.get(data.clientId);
            if (clientSession) {
                this.safeSend(clientSession, {
                    type: 'FILE_ACK',
                    transferId: data.transferId || null,
                    success: data.success !== false
                });
            }
            return;
        }
    }

    registerTransferSession(transferId, shopCode, clientId, clientWs) {
        this.transferSessions.set(transferId, {
            shopCode,
            clientId,
            clientWs,
            createdAt: Date.now()
        });
    }

    cleanupSocket(ws) {
        const meta = this.socketMeta.get(ws);
        if (meta?.shopCode) {
            this.onlineShops.delete(meta.shopCode);
        }
        if (meta?.clientId) {
            this.connectedClients.delete(meta.clientId);
        }

        for (const [transferId, session] of this.transferSessions.entries()) {
            if (session.clientWs === ws || session.shopCode === meta?.shopCode) {
                this.transferSessions.delete(transferId);
            }
        }

        this.socketMeta.delete(ws);
    }

    safeSend(ws, payload) {
        try {
            ws.send(JSON.stringify(payload));
        } catch (error) {
            console.error('safeSend failed:', error);
        }
    }
}

async function handlePublicShopLookup(shopCode, request, env) {
    if (!shopCode) return json({ error: 'shopCode required' }, 400, request, env);

    try {
        const shop = await dbGetShopByCode(env, normalizeShopCode(shopCode));
        if (!shop) return json({ error: 'Shop not found' }, 404, request, env);

        const subEnd = shop.subscription_end;
        if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
            return json({ error: 'Subscription expired' }, 403, request, env);
        }

        return json({
            shop: {
                code: shop.shop_code,
                name: shop.shop_name || shop.name || shop.shop_code,
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
        return json({
            shop: {
                code: shop.shop_code,
                name: shop.shop_name || shop.name || shop.shop_code,
                pcEndpoint: shop.pc_endpoint || null,
                status: shop.pc_status || 'offline',
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

    const { endpoint, status } = body.data;
    const patch = {};
    if (endpoint !== undefined) patch.pc_endpoint = endpoint;
    if (status !== undefined) patch.pc_status = status;

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
        clauses.push('updated_at = CURRENT_TIMESTAMP');
        params.push(decoded.shopId);
        await dbRun(env, `UPDATE shops SET ${clauses.join(', ')} WHERE id = ?`, ...params);
        return json({ success: true }, 200, request, env);
    } catch (error) {
        console.error('PC status update error:', error);
        return json({ error: 'Internal server error' }, 500, request, env);
    }
}

async function handleTurnIceServers(request, env) {
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
        return json({ error: 'TURN is not configured on the server' }, 503, request, env);
    }

    let body = {};
    try {
        body = await request.json();
    } catch {}

    const shopCode = normalizeShopCode(body.shopId || body.shopCode);
    if (!shopCode) {
        return json({ error: 'shopId is required' }, 400, request, env);
    }

    const shop = await dbGetShopByCode(env, shopCode);
    if (!shop) {
        return json({ error: 'Shop not found' }, 404, request, env);
    }

    const ttl = Math.max(300, Math.min(Number(body.ttl || 3600), 172800));
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('TURN credential generation failed:', response.status, errorText);
        return json({ error: 'Failed to generate TURN credentials' }, 502, request, env);
    }

    const payload = await response.json();
    const iceServers = Array.isArray(payload.iceServers)
        ? payload.iceServers.map((server) => ({
            ...server,
            urls: Array.isArray(server.urls)
                ? server.urls.filter((url) => !String(url).includes(':53'))
                : server.urls
        })).filter((server) => Array.isArray(server.urls) ? server.urls.length > 0 : Boolean(server.urls))
        : [];

    return json({ iceServers, ttl }, 200, request, env);
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
        'SELECT id, shop_code, shop_name, owner_name, email, phone, password_hash, color_price, bw_price, subscription_end, pc_endpoint, pc_status, created_at, updated_at FROM shops WHERE shop_code = ?',
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

function isWebSocketUpgrade(request) {
    return (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
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
