// Cloudflare Workers backend for Print Shop
// This replaces the Express server.js for Cloudflare deployment

import { WebSocketRelay } from './durable-objects/WebSocketRelay';

export { WebSocketRelay };

// CORS headers helper
function corsHeaders(origin) {
    const allowedOrigins = [
        env.FRONTEND_URL,
        env.ADMIN_FRONTEND_URL,
        env.CLOUDFLARE_URL,
        ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim())
    ].filter(Boolean);

    if (!origin || allowedOrigins.includes(origin)) {
        return {
            'Access-Control-Allow-Origin': origin || '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
            'Access-Control-Allow-Credentials': 'true'
        };
    }
    return {};
}

// Main worker fetch handler
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders(origin) });
        }

        // WebSocket upgrade for relay
        if (request.headers.get('Upgrade') === 'websocket') {
            return handleWebSocket(request, env);
        }

        // REST API endpoints
        try {
            let response;

            if (url.pathname === '/health') {
                response = new Response(JSON.stringify({ 
                    status: 'ok', 
                    timestamp: new Date().toISOString() 
                }), { headers: { 'Content-Type': 'application/json' } });
            }
            else if (url.pathname === '/') {
                response = new Response(JSON.stringify({
                    message: 'Print Shop API Server',
                    version: '2.0.0',
                    status: 'running',
                    platform: 'Cloudflare Workers'
                }), { headers: { 'Content-Type': 'application/json' } });
            }
            else if (url.pathname === '/shop/info' && request.method === 'POST') {
                response = await handleShopInfo(request, env);
            }
            else if (url.pathname === '/auth/login' && request.method === 'POST') {
                response = await handleLogin(request, env);
            }
            else if (url.pathname === '/shop/update-prices' && request.method === 'POST') {
                response = await handleUpdatePrices(request, env);
            }
            else if (url.pathname === '/shop/set-password' && request.method === 'POST') {
                response = await handleSetPassword(request, env);
            }
            else if (url.pathname === '/admin/login' && request.method === 'POST') {
                response = await handleAdminLogin(request, env);
            }
            else if (url.pathname === '/admin/create-shop' && request.method === 'POST') {
                response = await handleCreateShop(request, env);
            }
            else if (url.pathname === '/admin/shops' && request.method === 'GET') {
                response = await handleListShops(request, env);
            }
            else if (url.pathname.startsWith('/admin/shop/') && request.method === 'DELETE') {
                response = await handleDeleteShop(request, env, url);
            }
            else if (url.pathname.startsWith('/admin/shop/') && request.method === 'PATCH') {
                response = await handleUpdateShop(request, env, url);
            }
            else if (url.pathname === '/admin/register' && request.method === 'POST') {
                response = await handleAdminRegister(request, env);
            }
            else if (url.pathname === '/subscription/check' && request.method === 'GET') {
                response = await handleSubscriptionCheck(request, env, url);
            }
            else {
                response = new Response('Not Found', { status: 404 });
            }

            // Add CORS headers to response
            const headers = new Headers(response.headers);
            Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
                headers.set(key, value);
            });

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers
            });

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({ error: 'Internal server error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
            });
        }
    }
};

// WebSocket handler - use Durable Object
function handleWebSocket(request, env) {
    // Get Durable Object ID (one instance for all WebSocket connections)
    const id = env.WEBSOCKET_RELAY.idFromName('global-relay');
    const stub = env.WEBSOCKET_RELAY.get(id);
    return stub.fetch(request);
}

// Supabase helper
async function supabaseQuery(env, endpoint, options = {}) {
    const url = `${env.SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers = {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase error: ${response.status} ${text}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }
    return response.text();
}

// Handler functions
async function handleShopInfo(request, env) {
    const { shopCode } = await request.json();
    if (!shopCode) {
        return new Response(JSON.stringify({ error: 'shopCode required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const rows = await supabaseQuery(env, `shops?shop_code=eq.${encodeURIComponent(shopCode)}&select=*`);
    if (!rows || rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Shop not found', shop: null }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const shop = rows[0];
    return new Response(JSON.stringify({
        shop: {
            code: shop.shop_code,
            name: shop.shop_name || shop.shop_code,
            colorPrice: shop.color_price,
            bwPrice: shop.bw_price
        }
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleLogin(request, env) {
    const { shopCode, password } = await request.json();
    if (!shopCode || !password) {
        return new Response(JSON.stringify({ error: 'shopCode and password required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const rows = await supabaseQuery(env, `shops?shop_code=eq.${encodeURIComponent(shopCode)}&select=*`);
    if (!rows || rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Shop not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const shop = rows[0];
    const hash = shop.password_hash;
    if (!hash) {
        return new Response(JSON.stringify({ error: 'Password not set for shop' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Use bcrypt-edge for Cloudflare Workers
    const bcrypt = await import('bcrypt-edge');
    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check subscription
    const subEnd = shop.subscription_end;
    if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: 'Subscription expired' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Use @tsndr/cloudflare-worker-jwt
    const jwt = await import('@tsndr/cloudflare-worker-jwt');
    const token = await jwt.sign({
        shopId: shop.id,
        shopCode: shop.shop_code
    }, env.JWT_SECRET);

    return new Response(JSON.stringify({
        token,
        shop: {
            code: shop.shop_code,
            name: shop.shop_name,
            colorPrice: shop.color_price,
            bwPrice: shop.bw_price,
            subscriptionEnd: subEnd || null
        }
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleUpdatePrices(request, env) {
    const { shopCode, colorPrice, bwPrice } = await request.json();
    
    await supabaseQuery(env, `shops?shop_code=eq.${encodeURIComponent(shopCode)}`, {
        method: 'PATCH',
        body: JSON.stringify({ color_price: colorPrice, bw_price: bwPrice }),
        headers: { 'Prefer': 'return=representation' }
    });

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleSetPassword(request, env) {
    const { shopCode, password } = await request.json();
    if (!shopCode || !password) {
        return new Response(JSON.stringify({ error: 'shopCode and password required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const bcrypt = await import('bcrypt-edge');
    const hash = await bcrypt.hash(password, 10);

    await supabaseQuery(env, `shops?shop_code=eq.${encodeURIComponent(shopCode)}`, {
        method: 'PATCH',
        body: JSON.stringify({ password_hash: hash }),
        headers: { 'Prefer': 'return=representation' }
    });

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleAdminLogin(request, env) {
    const { username, password } = await request.json();
    if (!username || !password) {
        return new Response(JSON.stringify({ error: 'username and password required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const rows = await supabaseQuery(env, `admins?username=eq.${encodeURIComponent(username)}&select=*`);
    if (!rows || rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Admin not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const admin = rows[0];
    const bcrypt = await import('bcrypt-edge');
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const jwt = await import('@tsndr/cloudflare-worker-jwt');
    const token = await jwt.sign({
        adminId: admin.id,
        username: admin.username,
        isAdmin: true
    }, env.JWT_SECRET, { expiresIn: '12h' });

    return new Response(JSON.stringify({
        token,
        admin: { id: admin.id, username: admin.username }
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleCreateShop(request, env) {
    const auth = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!auth) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const jwt = await import('@tsndr/cloudflare-worker-jwt');
    const decoded = await jwt.verify(auth, env.JWT_SECRET);
    if (!decoded || !decoded.payload?.isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const { shopCode, shopName, password, colorPrice, bwPrice, subscriptionDays, subscriptionEnd } = await request.json();
    if (!shopCode || !password) {
        return new Response(JSON.stringify({ error: 'shopCode and password required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const bcrypt = await import('bcrypt-edge');
    const hash = await bcrypt.hash(password, 10);

    let endDate;
    if (subscriptionEnd) {
        endDate = new Date(subscriptionEnd);
    } else {
        const days = parseInt(subscriptionDays || '365', 10);
        endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const shop = await supabaseQuery(env, 'shops', {
        method: 'POST',
        body: JSON.stringify([{
            shop_code: shopCode,
            shop_name: shopName || null,
            password_hash: hash,
            color_price: colorPrice || null,
            bw_price: bwPrice || null,
            subscription_end: endDate.toISOString()
        }])
    });

    return new Response(JSON.stringify({ success: true, shop: shop[0] }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleListShops(request, env) {
    const auth = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!auth) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const jwt = await import('@tsndr/cloudflare-worker-jwt');
    const decoded = await jwt.verify(auth, env.JWT_SECRET);
    if (!decoded || !decoded.payload?.isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const shops = await supabaseQuery(env, 'shops?select=*');
    return new Response(JSON.stringify({ shops }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleDeleteShop(request, env, url) {
    const auth = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!auth) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const jwt = await import('@tsndr/cloudflare-worker-jwt');
    const decoded = await jwt.verify(auth, env.JWT_SECRET);
    if (!decoded || !decoded.payload?.isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const shopCode = url.pathname.split('/').pop();
    await supabaseQuery(env, `shops?shop_code=eq.${encodeURIComponent(shopCode)}`, {
        method: 'DELETE'
    });

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleUpdateShop(request, env, url) {
    const auth = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!auth) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const jwt = await import('@tsndr/cloudflare-worker-jwt');
    const decoded = await jwt.verify(auth, env.JWT_SECRET);
    if (!decoded || !decoded.payload?.isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const shopCode = url.pathname.split('/').pop();
    const { colorPrice, bwPrice, subscriptionDays, subscriptionEnd } = await request.json();

    const body = {};
    if (colorPrice !== undefined) body.color_price = colorPrice;
    if (bwPrice !== undefined) body.bw_price = bwPrice;
    
    if (subscriptionEnd) {
        body.subscription_end = new Date(subscriptionEnd).toISOString();
    } else if (subscriptionDays) {
        const days = parseInt(subscriptionDays, 10);
        body.subscription_end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    await supabaseQuery(env, `shops?shop_code=eq.${encodeURIComponent(shopCode)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Prefer': 'return=representation' }
    });

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleAdminRegister(request, env) {
    const { username, password, setupKey } = await request.json();
    if (!username || !password) {
        return new Response(JSON.stringify({ error: 'username and password required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const requiredKey = env.ADMIN_SETUP_KEY;
    if (requiredKey && setupKey !== requiredKey) {
        return new Response(JSON.stringify({ error: 'setup key required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (!requiredKey) {
        const admins = await supabaseQuery(env, 'admins?select=id');
        if (admins && admins.length > 0) {
            return new Response(JSON.stringify({ error: 'Admin registration disabled' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    const bcrypt = await import('bcrypt-edge');
    const hash = await bcrypt.hash(password, 10);

    const admin = await supabaseQuery(env, 'admins', {
        method: 'POST',
        body: JSON.stringify([{ username, password_hash: hash }])
    });

    const created = admin[0];
    const jwt = await import('@tsndr/cloudflare-worker-jwt');
    const token = await jwt.sign({
        adminId: created.id,
        username: created.username,
        isAdmin: true
    }, env.JWT_SECRET, { expiresIn: '12h' });

    return new Response(JSON.stringify({
        success: true,
        token,
        admin: { id: created.id, username: created.username }
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleSubscriptionCheck(request, env, url) {
    const shopCode = url.searchParams.get('shop');
    if (!shopCode) {
        return new Response(JSON.stringify({ error: 'shop query required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const rows = await supabaseQuery(env, `shops?select=subscription_end&shop_code=eq.${encodeURIComponent(shopCode)}`);
    const endVal = rows && rows[0] && rows[0].subscription_end;
    const status = (!endVal || new Date(endVal).getTime() > Date.now()) ? 'active' : 'expired';

    return new Response(JSON.stringify({ shop: shopCode, status, source: 'cloudflare' }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
