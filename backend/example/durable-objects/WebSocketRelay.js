// Durable Object for WebSocket relay state
// Handles all WebSocket connections for the print shop relay

export class WebSocketRelay {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessions = new Map(); // WebSocket connections
        this.onlineShops = new Map(); // shopCode -> session
        this.connectedClients = new Map(); // clientId -> session
    }

    async fetch(request) {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected WebSocket', { status: 400 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        this.handleSession(server);

        return new Response(null, {
            status: 101,
            webSocket: client
        });
    }

    handleSession(webSocket) {
        webSocket.accept();

        const sessionId = crypto.randomUUID();
        this.sessions.set(sessionId, {
            webSocket,
            shopCode: null,
            clientId: null,
            isRegistered: false
        });

        webSocket.addEventListener('message', async (event) => {
            try {
                const data = JSON.parse(event.data);
                await this.handleMessage(sessionId, data);
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        });

        webSocket.addEventListener('close', () => {
            const session = this.sessions.get(sessionId);
            if (session) {
                if (session.shopCode) {
                    this.onlineShops.delete(session.shopCode);
                    console.log('Shop disconnected:', session.shopCode);
                }
                if (session.clientId) {
                    this.connectedClients.delete(session.clientId);
                }
                this.sessions.delete(sessionId);
            }
        });

        webSocket.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
        });
    }

    async handleMessage(sessionId, data) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // REGISTER_SHOP - PC app registering
        if (data.type === 'REGISTER_SHOP') {
            if (!data.token) {
                session.webSocket.send(JSON.stringify({
                    type: 'REGISTER_FAILED',
                    reason: 'missing_token'
                }));
                session.webSocket.close();
                return;
            }

            // Verify JWT
            const jwt = await import('@tsndr/cloudflare-worker-jwt');
            let decoded;
            try {
                decoded = await jwt.verify(data.token, this.env.JWT_SECRET);
            } catch (err) {
                session.webSocket.send(JSON.stringify({
                    type: 'REGISTER_FAILED',
                    reason: 'invalid_token'
                }));
                session.webSocket.close();
                return;
            }

            const shopCode = decoded.payload?.shopCode || decoded.payload?.shop_code;
            if (!shopCode) {
                session.webSocket.send(JSON.stringify({
                    type: 'REGISTER_FAILED',
                    reason: 'invalid_payload'
                }));
                session.webSocket.close();
                return;
            }

            // Check subscription
            const supabaseUrl = `${this.env.SUPABASE_URL}/rest/v1/shops?select=subscription_end&shop_code=eq.${encodeURIComponent(shopCode)}`;
            const supabaseHeaders = {
                'apikey': this.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
            };

            const response = await fetch(supabaseUrl, { headers: supabaseHeaders });
            const rows = await response.json();
            const subEnd = rows && rows[0] && rows[0].subscription_end;

            if (subEnd && new Date(subEnd).getTime() <= Date.now()) {
                session.webSocket.send(JSON.stringify({
                    type: 'REGISTER_FAILED',
                    reason: 'subscription_expired'
                }));
                session.webSocket.close();
                return;
            }

            // Register shop
            session.shopCode = shopCode;
            session.isRegistered = true;
            this.onlineShops.set(shopCode, session);

            console.log('Shop registered:', shopCode);
            session.webSocket.send(JSON.stringify({ type: 'REGISTER_SUCCESS' }));
        }

        // CHECK_STATUS - Frontend checking if shop is online
        else if (data.type === 'CHECK_STATUS') {
            const shopSession = this.onlineShops.get(data.shopId);
            const status = shopSession ? 'ONLINE' : 'OFFLINE';

            if (data.senderId) {
                session.clientId = data.senderId;
                this.connectedClients.set(data.senderId, session);
            }

            session.webSocket.send(JSON.stringify({
                type: 'STATUS_RESPONSE',
                status
            }));
        }

        // SEND_FILE - Frontend sending file chunk to shop
        else if (data.type === 'SEND_FILE') {
            const shopSession = this.onlineShops.get(data.shopId);
            if (shopSession) {
                shopSession.webSocket.send(JSON.stringify({
                    type: 'SEND_FILE',
                    chunkIndex: data.chunkIndex,
                    totalChunks: data.totalChunks,
                    isLastChunk: data.isLastChunk,
                    metadata: data.metadata,
                    fileData: data.fileData
                }));
            }
        }

        // CHUNK_ACK - Shop acknowledging chunk received
        else if (data.type === 'CHUNK_ACK') {
            const clientSession = this.connectedClients.get(data.clientId);
            if (clientSession) {
                clientSession.webSocket.send(JSON.stringify({
                    type: 'CHUNK_ACK',
                    chunkIndex: data.chunkIndex
                }));
            }
        }

        // FILE_ACK - Final acknowledgment after all chunks
        else if (data.type === 'FILE_ACK') {
            const clientSession = this.connectedClients.get(data.clientId);
            if (clientSession) {
                clientSession.webSocket.send(JSON.stringify({
                    type: 'FILE_ACK',
                    success: true
                }));
            }
        }
    }
}
