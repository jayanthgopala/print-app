const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Store = require('electron-store');
const QRCode = require('qrcode');
const pdfPrinter = require('pdf-to-printer');
const TunnelManager = require('./tunnel-manager');

const APP_ID = 'com.jayanthgopala.printshop.pcapp';
const APP_DATA_DIR_NAME = 'Print Shop Manager';
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const PUBLIC_HEARTBEAT_INTERVAL_MS = 30000;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']);
const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
]);

loadLocalEnv(path.join(__dirname, '.env'));

configureAppPaths();

const store = new Store();
let mainWindow;
let uploadServer = null;
let uploadServerPort = null;
let heartbeatTimer = null;
let tunnelManager = null;
let currentUploadPublicUrl = null;

// Default to the deployed Worker backend; env vars can still override this.
const DEFAULT_API_URL = 'https://print-app-backend.jayanthgopala21.workers.dev';
const API_URL = process.env.API_URL || DEFAULT_API_URL;
log('PC app backend config:', { API_URL });

app.setAppUserModelId(APP_ID);

process.on('uncaughtException', (err) => log('Uncaught:', formatError(err)));
process.on('unhandledRejection', (err) => log('Unhandled:', formatError(err)));

function configureAppPaths() {
    try {
        const appDataPath = app.getPath('appData');
        const userDataPath = path.join(appDataPath, APP_DATA_DIR_NAME);
        const sessionDataPath = path.join(userDataPath, 'SessionData');

        fs.mkdirSync(userDataPath, { recursive: true });
        fs.mkdirSync(sessionDataPath, { recursive: true });

        app.setPath('userData', userDataPath);
        app.setPath('sessionData', sessionDataPath);
    } catch (error) {
        console.error('Failed to configure app paths:', formatError(error));
    }
}

function loadLocalEnv(envPath) {
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) continue;

        const key = line.slice(0, eqIndex).trim();
        const value = line.slice(eqIndex + 1).trim();
        if (!key || process.env[key]) continue;
        process.env[key] = value;
    }
}

function getLogPath() {
    try {
        return path.join(app.getPath('userData'), 'pc-app.log');
    } catch {
        return path.join(__dirname, 'pc-app.log');
    }
}

function formatError(error) {
    if (!error) return '(empty)';
    if (error instanceof Error) {
        return `${error.message}\n${error.stack || ''}`.trim();
    }
    return typeof error === 'string' ? error : JSON.stringify(error);
}

function log(...args) {
    const line = `[${new Date().toISOString()}] ${args.map((arg) => {
        if (typeof arg === 'string') return arg;
        return formatError(arg);
    }).join(' ')}\n`;

    try {
        fs.appendFileSync(getLogPath(), line);
    } catch {}

    console.log(...args);
}

async function updatePcStatus(status, endpoint = undefined) {
    const token = store.get('shopToken') || store.get('token');
    if (!token) return;

    const payload = { status };
    if (endpoint !== undefined) {
        payload.endpoint = endpoint;
    }

    try {
        await fetch(`${API_URL}/pc/status`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        log('PC status update failed:', formatError(error));
    }
}

async function publishPcOnlineStatus(uploadPublicUrl) {
    if (!uploadPublicUrl) {
        currentUploadPublicUrl = null;
        return { success: false, message: 'Tunnel URL was not detected' };
    }

    currentUploadPublicUrl = String(uploadPublicUrl).replace(/\/$/, '');
    await updatePcStatus('online', currentUploadPublicUrl);
    if (mainWindow) {
        mainWindow.webContents.send('tunnel-status', { status: 'online', url: currentUploadPublicUrl });
    }
    return { success: true, uploadPublicUrl: currentUploadPublicUrl };
}

async function verifyClientUploadToken(token) {
    const response = await fetch(`${API_URL}/auth/verify-client-token`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Upload token verification failed');
    }

    return response.json();
}

function decodeHeaderValue(value, fallback = '') {
    try {
        return decodeURIComponent(String(value || fallback));
    } catch {
        return String(value || fallback);
    }
}

function normalizePublicUploadUrl(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    if (!normalized) {
        return '';
    }

    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error('Tunnel Public Upload URL must be a valid http or https URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Tunnel Public Upload URL must use http or https');
    }

    return parsed.toString().replace(/\/+$/, '');
}

function parseUploadPort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Local Upload Port must be between 1 and 65535');
    }

    return port;
}

function validateIncomingUpload({ fileName, fileType, declaredSize, copies, fileIndex, totalFiles }) {
    const normalizedFileName = path.basename(String(fileName || '').trim());
    const extension = path.extname(normalizedFileName).toLowerCase();
    const normalizedType = String(fileType || '').trim().toLowerCase();

    if (!normalizedFileName || !ALLOWED_EXTENSIONS.has(extension)) {
        throw new Error('Unsupported file type');
    }
    if (normalizedType && !ALLOWED_MIME_TYPES.has(normalizedType)) {
        throw new Error('Unsupported MIME type');
    }
    if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_FILE_SIZE_BYTES) {
        throw new Error('Invalid file size');
    }
    if (!Number.isFinite(copies) || copies < 1 || copies > 20) {
        throw new Error('Invalid copies value');
    }
    if (!Number.isFinite(fileIndex) || fileIndex < 1 || !Number.isFinite(totalFiles) || totalFiles < fileIndex) {
        throw new Error('Invalid file ordering metadata');
    }
}

async function startUploadServer(shopId, requestedPort) {
    const port = parseUploadPort(requestedPort);

    if (uploadServer) {
        if (uploadServerPort === port) {
            return { port: uploadServer.address()?.port || port };
        }
        stopUploadServer();
    }

    uploadServer = http.createServer(async (req, res) => {
        log('Upload server request:', { method: req.method, url: req.url });

        if (req.method === 'OPTIONS') {
            res.writeHead(204, buildUploadCorsHeaders());
            res.end();
            return;
        }

        if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { ...buildUploadCorsHeaders(), 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', shopId }));
            return;
        }

        if (req.method !== 'POST' || req.url !== '/upload') {
            res.writeHead(404, buildUploadCorsHeaders());
            res.end('Not found');
            return;
        }

        try {
            const authHeader = String(req.headers.authorization || '');
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
            if (!token) {
                throw new Error('Missing upload token');
            }

            log('Verifying upload token for incoming request');
            const tokenInfo = await verifyClientUploadToken(token);
            if (normalizeShopCode(tokenInfo.shopCode) !== normalizeShopCode(shopId)) {
                throw new Error('Upload token shop mismatch');
            }

            const fileName = decodeHeaderValue(req.headers['x-file-name'], 'upload.bin');
            const fileType = decodeHeaderValue(req.headers['x-file-type'], 'application/octet-stream');
            const customerName = decodeHeaderValue(req.headers['x-customer-name'], 'Unknown');
            const colorPages = decodeHeaderValue(req.headers['x-color-pages'], '');
            const bwPages = decodeHeaderValue(req.headers['x-bw-pages'], '');
            const paperSize = decodeHeaderValue(req.headers['x-paper-size'], 'A4');
            const orientation = decodeHeaderValue(req.headers['x-orientation'], 'portrait');
            const duplex = decodeHeaderValue(req.headers['x-duplex'], 'simplex');
            const scale = decodeHeaderValue(req.headers['x-scale'], 'fit');
            const copies = Math.max(1, Number(req.headers['x-copies'] || 1));
            const fileIndex = Math.max(1, Number(req.headers['x-file-index'] || 1));
            const totalFiles = Math.max(1, Number(req.headers['x-total-files'] || 1));
            const declaredSize = Number(req.headers['x-file-size'] || 0);
            validateIncomingUpload({ fileName, fileType, declaredSize, copies, fileIndex, totalFiles });
            log('Upload accepted:', { fileName, declaredSize, shopId });

            const chunks = [];
            let totalBytes = 0;
            req.on('data', (chunk) => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_FILE_SIZE_BYTES) {
                    req.destroy(new Error('File too large'));
                    return;
                }
                chunks.push(chunk);
            });

            req.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (declaredSize > 0 && buffer.length !== declaredSize) {
                    res.writeHead(400, { ...buildUploadCorsHeaders(), 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Incomplete upload' }));
                    return;
                }

                const filePath = saveReceivedFile(store.get('downloadPath', app.getPath('downloads')), fileName, buffer);
                const order = {
                    customerName,
                    fileName,
                    fileType,
                    filePath,
                    colorPages,
                    bwPages,
                    paperSize,
                    orientation,
                    copies,
                    duplex,
                    scale,
                    fileIndex,
                    totalFiles,
                    shopId
                };

                log('HTTP upload received:', { fileName, bytes: buffer.length, shopId });
                if (mainWindow) {
                    mainWindow.webContents.send('file-received', order);
                }

                res.writeHead(200, { ...buildUploadCorsHeaders(), 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, filePath }));
            });

            req.on('error', (error) => {
                log('Upload request failed:', formatError(error));
                if (!res.headersSent) {
                    res.writeHead(400, { ...buildUploadCorsHeaders(), 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message || 'Upload failed' }));
                }
            });
        } catch (error) {
            log('Upload handling failed:', formatError(error));
            res.writeHead(401, { ...buildUploadCorsHeaders(), 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message || 'Unauthorized' }));
        }
    });

    await new Promise((resolve, reject) => {
        uploadServer.once('error', reject);
        uploadServer.listen(port, '0.0.0.0', () => {
            uploadServer.off('error', reject);
            resolve();
        });
    });

    uploadServerPort = port;
    log('Upload server listening on port', port);
    return { port };
}

function buildUploadCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-File-Name,X-File-Size,X-File-Type,X-Customer-Name,X-Color-Pages,X-BW-Pages,X-Paper-Size,X-Orientation,X-Copies,X-Duplex,X-Scale,X-File-Index,X-Total-Files',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    };
}

function normalizeShopCode(value) {
    return String(value || '').trim().replace(/[<>]/g, '').toUpperCase();
}

function stopUploadServer() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (uploadServer) {
        try {
            uploadServer.close();
        } catch (error) {
            log('Failed to close upload server:', formatError(error));
        }
        uploadServer = null;
        uploadServerPort = null;
    }
    currentUploadPublicUrl = null;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: getAppIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Remove the menu bar
    Menu.setApplicationMenu(null);

    mainWindow.loadFile('index.html');
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        log('Renderer process gone:', details);
    });
    mainWindow.webContents.on('unresponsive', () => {
        log('Renderer became unresponsive');
    });
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        log('Window load failed:', { errorCode, errorDescription });
    });
}

function getAppIconPath() {
    const iconFile = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';
    return path.join(__dirname, 'assets', iconFile);
}

function getInstallerScriptPath() {
    const candidatePaths = [
        path.join(process.resourcesPath || '', 'INSTALLER', 'install-cloudflared.bat'),
        path.join(__dirname, '..', 'INSTALLER', 'install-cloudflared.bat'),
        path.join(process.cwd(), 'INSTALLER', 'install-cloudflared.bat')
    ];

    return candidatePaths.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

async function launchCloudflaredInstaller() {
    if (process.platform !== 'win32') {
        return { success: false, message: 'Cloudflared installer is only configured for Windows in this app.' };
    }

    return new Promise((resolve) => {
        const wingetCommand = "Start-Process -Verb RunAs -FilePath 'winget.exe' -ArgumentList 'install','--id','Cloudflare.cloudflared','--exact','--source','winget'";
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', wingetCommand], {
            detached: true,
            stdio: 'ignore'
        });

        child.on('error', (error) => {
            const installerPath = getInstallerScriptPath();
            if (!installerPath) {
                resolve({ success: false, message: error.message || 'Failed to launch installer' });
                return;
            }

            const fallbackCommand = `Start-Process -FilePath '${installerPath.replace(/'/g, "''")}' -Verb RunAs`;
            const fallback = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', fallbackCommand], {
                detached: true,
                stdio: 'ignore'
            });

            fallback.on('error', (fallbackError) => {
                resolve({ success: false, message: fallbackError.message || error.message || 'Failed to launch installer' });
            });

            fallback.unref();
            resolve({
                success: true,
                method: 'script-fallback'
            });
        });

        child.unref();
        resolve({
            success: true,
            method: 'winget'
        });
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('child-process-gone', (event, details) => {
    log('Child process gone:', details);
});
app.on('before-quit', () => {
    log('App quitting');
    stopUploadServer();
    if (tunnelManager) {
        tunnelManager.stop();
    }
    void updatePcStatus('offline', null);
});

ipcMain.handle('get-settings', () => ({
    shopId: store.get('shopId', ''),
    token: store.get('token', ''),
    shopToken: store.get('shopToken', ''),
    downloadPath: store.get('downloadPath', app.getPath('downloads')),
    colorPrice: store.get('colorPrice'),
    bwPrice: store.get('bwPrice'),
    colorPrinter: store.get('colorPrinter', ''),
    bwPrinter: store.get('bwPrinter', ''),
    password: store.get('password', ''),
    uploadPublicUrl: store.get('uploadPublicUrl', process.env.UPLOAD_PUBLIC_URL || ''),
    uploadPort: store.get('uploadPort', Number(process.env.UPLOAD_PORT || 8788))
}));

ipcMain.handle('save-settings', async (event, settings) => {
    const shopId = settings.shopId;
    const colorPrice = parseFloat(settings.colorPrice);
    const bwPrice = parseFloat(settings.bwPrice);
    const password = settings.password || '';
    log('Saving settings:', { shopId, colorPrice, bwPrice });
    
    store.set('shopId', shopId);
    store.set('downloadPath', settings.downloadPath);
    store.set('colorPrice', colorPrice);
    store.set('bwPrice', bwPrice);
    if (password) store.set('password', password);
    store.set('colorPrinter', settings.colorPrinter || '');
    store.set('bwPrinter', settings.bwPrinter || '');
    store.set('uploadPublicUrl', settings.uploadPublicUrl || process.env.UPLOAD_PUBLIC_URL || '');
    store.set('uploadPort', Number(settings.uploadPort || process.env.UPLOAD_PORT || 8788));

    try {
        if (!/^https?:\/\//i.test(API_URL)) {
            return { success: false, message: `Invalid API_URL: ${API_URL || '(empty)'}` };
        }

        // Try login first with provided password
        try {
            const loginResp = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shopCode: shopId, password })
            });
            const loginData = await loginResp.json();
            if (loginResp.ok && loginData.token) {
                store.set('token', loginData.token);
                log('Login successful');
            } else if (loginResp.status === 403) {
                // Password not set on server: set it and retry
                log('Password not set on server, attempting to set password...');
                try {
                    const setResp = await fetch(`${API_URL}/shop/set-password`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shopCode: shopId, password })
                    });
                    if (setResp.ok) {
                        // retry login
                        const r2 = await fetch(`${API_URL}/auth/login`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ shopCode: shopId, password })
                        });
                        const data2 = await r2.json();
                        if (r2.ok && data2.token) {
                            store.set('token', data2.token);
                            log('Login successful after setting password');
                        } else {
                            log('Login failed after setting password', data2);
                            return { success: false, message: 'Login failed after setting password' };
                        }
                    } else {
                        const errText = await setResp.text();
                        log('Set password failed:', errText);
                        return { success: false, message: 'Failed to set password' };
                    }
                } catch (setErr) {
                    log('Set password error:', setErr.message);
                    return { success: false, message: setErr.message };
                }
            } else {
                log('Login failed:', loginData);
                return { success: false, message: loginData.error || 'Invalid credentials' };
            }
        } catch (err) {
            log('Login request failed:', err.message);
            return { success: false, message: err.message };
        }

        try {
            const shopTokenResp = await fetch(`${API_URL}/auth/shop-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shopCode: shopId, password })
            });
            const shopTokenData = await shopTokenResp.json();
            if (shopTokenResp.ok && shopTokenData.token) {
                store.set('shopToken', shopTokenData.token);
                log('Shop token issued for status updates');
            } else {
                log('Shop token request failed:', shopTokenData);
                return { success: false, message: shopTokenData.error || 'Could not create shop service token' };
            }
        } catch (err) {
            log('Shop token request failed:', err.message);
            return { success: false, message: err.message };
        }

        // Update prices in database (best-effort)
        if (colorPrice && bwPrice && shopId) {
            log('Updating database prices...');
            try {
                const updateResp = await fetch(`${API_URL}/shop/update-prices`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        shopCode: shopId,
                        colorPrice: colorPrice,
                        bwPrice: bwPrice
                    })
                });

                if (updateResp.ok) {
                    const updateData = await updateResp.json();
                    log('Database updated:', updateData);
                }
            } catch (dbError) {
                log('Database update failed (continuing anyway):', dbError.message);
            }
        }

        return { success: true, token: store.get('token'), shopToken: store.get('shopToken') };
    } catch (error) {
        console.error('Save settings error:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('install-cloudflared', async () => {
    return launchCloudflaredInstaller();
});
ipcMain.handle('get-printers', async () => {
    try {
        if (mainWindow && mainWindow.webContents) {
            const printers = mainWindow.webContents.getPrinters();
            return { success: true, printers };
        }
        return { success: false, printers: [], message: 'Window not ready' };
    } catch (error) {
        return { success: false, printers: [], message: error.message };
    }
});
ipcMain.handle('generate-qr', async (event, shopId) => {
    try {
        const frontendUrl = process.env.FRONTEND_URL || '';
        if (!frontendUrl) return { success: false, message: 'FRONTEND_URL not set' };
        const url = `${frontendUrl.replace(/\/$/, '')}?shop=${shopId}`;
        const qrDataUrl = await QRCode.toDataURL(url, { width: 300 });
        return { success: true, qrDataUrl };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('start-service', async () => {
    const shopId = store.get('shopId');
    const token = store.get('token');
    const downloadPath = store.get('downloadPath', app.getPath('downloads'));

    if (!shopId || !token) {
        return { success: false, message: 'Missing credentials' };
    }

    let uploadPort;
    try {
        uploadPort = parseUploadPort(store.get('uploadPort', process.env.UPLOAD_PORT || 8788) || 8788);
    } catch (error) {
        return { success: false, message: error.message };
    }

    // Start local upload server before creating or publishing any public endpoint.
    try {
        await startUploadServer(shopId, uploadPort);
    } catch (error) {
        if (tunnelManager) {
            tunnelManager.stop();
        }
        return { success: false, message: `Upload server failed to start: ${error.message}` };
    }

    // Check if manual URL is configured (backwards compatibility)
    const manualUrl = store.get('uploadPublicUrl', process.env.UPLOAD_PUBLIC_URL || '');
    let uploadPublicUrl = null;

    if (manualUrl && manualUrl.trim()) {
        try {
            uploadPublicUrl = normalizePublicUploadUrl(manualUrl);
            log('Using manual tunnel URL:', uploadPublicUrl);
        } catch (error) {
            stopUploadServer();
            return { success: false, message: `Invalid upload URL: ${error.message}` };
        }
    } else {
        log('Starting automatic tunnel...');

        const installed = await TunnelManager.checkInstalled();
        if (!installed.installed) {
            stopUploadServer();
            return {
                success: false,
                message: 'Cloudflared not installed. Please install cloudflared from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'
            };
        }

        if (!tunnelManager) {
            tunnelManager = new TunnelManager({
                port: uploadPort,
                host: '127.0.0.1',
                logPath: path.join(__dirname, 'tunnel.log'),
                onStatusChange: (status, url, error) => {
                    log('Tunnel status changed:', status, url, error);
                    if (status === 'offline' || status === 'error') {
                        currentUploadPublicUrl = null;
                        void updatePcStatus('offline', null);
                    }
                    if (mainWindow) {
                        mainWindow.webContents.send('tunnel-status', { status, url, error });
                    }
                },
                onUrlDetected: async (url) => {
                    log('Tunnel URL detected:', url);
                }
            });
        }

        try {
            const tunnelResult = await tunnelManager.start();
            if (!tunnelResult.success) {
                stopUploadServer();
                return { success: false, message: 'Failed to start tunnel' };
            }
            uploadPublicUrl = tunnelResult.url;
            log('Tunnel started successfully:', uploadPublicUrl);
        } catch (error) {
            log('Tunnel start error:', error);
            stopUploadServer();
            return {
                success: false,
                message: `Failed to start tunnel: ${error.message}`
            };
        }
    }

    const publishedStatus = await publishPcOnlineStatus(uploadPublicUrl);
    if (!publishedStatus.success) {
        await updatePcStatus('starting', null);
    }

    // Setup heartbeat
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }
    heartbeatTimer = setInterval(async () => {
        const currentUrl = tunnelManager ? tunnelManager.getUrl() : currentUploadPublicUrl;
        if (!currentUrl) {
            await updatePcStatus('offline', null);
            return;
        }

        currentUploadPublicUrl = String(currentUrl).replace(/\/$/, '');
        await updatePcStatus('online', currentUploadPublicUrl);
        if (mainWindow) {
            mainWindow.webContents.send('tunnel-status', { status: 'online', url: currentUploadPublicUrl });
        }
    }, PUBLIC_HEARTBEAT_INTERVAL_MS);

    return {
        success: true,
        config: {
            shopId,
            token,
            downloadPath,
            uploadPublicUrl: String(uploadPublicUrl || '').replace(/\/$/, ''),
            uploadPort,
            autoTunnel: !manualUrl,
            status: publishedStatus.success ? 'online' : 'starting'
        },
        message: publishedStatus.success
            ? 'Service is online.'
            : `Tunnel created but URL was not detected cleanly: ${publishedStatus.message}`
    };
});

ipcMain.handle('save-received-file', async (event, payload) => {
    try {
        const fileName = payload?.fileName || '';
        const bytes = payload?.bytes;
        const shopId = payload?.shopId || store.get('shopId');
        const downloadPath = store.get('downloadPath', app.getPath('downloads'));

        if (!fileName || !bytes) {
            return { success: false, message: 'Missing file payload' };
        }

        const buffer = Buffer.from(bytes);
        const filePath = saveReceivedFile(downloadPath, fileName, buffer);
        const order = {
            customerName: payload?.customerName || 'Unknown',
            fileName,
            filePath,
            colorPages: payload?.colorPages || '',
            bwPages: payload?.bwPages || '',
            paperSize: payload?.paperSize || 'A4',
            orientation: payload?.orientation || 'portrait',
            copies: Math.max(1, Number(payload?.copies || 1)),
            duplex: payload?.duplex || 'simplex',
            scale: payload?.scale || 'fit',
            fileIndex: payload?.fileIndex || 1,
            totalFiles: payload?.totalFiles || 1,
            shopId
        };

        log('Saved received file:', order);

        if (mainWindow) {
            mainWindow.webContents.send('file-received', order);
        }

        return { success: true, filePath };
    } catch (error) {
        log('save-received-file failed:', formatError(error));
        return { success: false, message: error.message };
    }
});

ipcMain.handle('print-qr', async (event, payload) => {
    try {
        const qrDataUrl = payload?.qrDataUrl || '';
        const shopId = payload?.shopId || store.get('shopId', '');
        const printerName = store.get('colorPrinter', '') || store.get('bwPrinter', '');

        if (!qrDataUrl) {
            return { success: false, message: 'QR code not generated' };
        }

        const printWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Shop QR</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 0; padding: 32px; display: flex; justify-content: center; }
                    .sheet { width: 100%; max-width: 520px; text-align: center; }
                    h1 { margin: 0 0 8px; font-size: 28px; }
                    p { margin: 0 0 20px; color: #444; }
                    img { width: 320px; height: 320px; object-fit: contain; }
                    .code { margin-top: 14px; font-size: 18px; font-weight: 700; letter-spacing: 1px; }
                </style>
            </head>
            <body>
                <div class="sheet">
                    <h1>Scan to Send Files</h1>
                    <p>Share files directly to this print shop.</p>
                    <img src="${qrDataUrl}" alt="Shop QR Code">
                    <div class="code">${escapeHtmlForHtml(shopId)}</div>
                </div>
            </body>
            </html>
        `;

        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

        return await new Promise((resolve) => {
            printWindow.webContents.print({
                silent: true,
                printBackground: true,
                deviceName: printerName,
                copies: 1,
                pageSize: 'A4'
            }, (success, errorType) => {
                printWindow.close();
                if (!success) {
                    resolve({ success: false, message: errorType || 'QR print failed' });
                } else {
                    resolve({ success: true, message: printerName ? `QR sent to ${printerName}` : 'QR sent to printer' });
                }
            });
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('print-file', async (event, filePath, options) => {
    try {
        const normalizedPath = path.normalize(filePath);
        const printerName = options.printerName || '';
        const pageRanges = normalizePageRanges(options.pageRanges || '');
        const paperSize = options.paperSize || 'A4';
        const orientation = options.orientation || 'portrait';
        const copies = Math.max(1, Number(options.copies || 1));
        const duplex = options.duplex || 'simplex';
        const scale = options.scale || 'fit';
        
        console.log(`Printing to ${printerName}: ${normalizedPath}, Pages: ${pageRanges || 'all'}, Paper: ${paperSize}, Layout: ${orientation}, Copies: ${copies}, Duplex: ${duplex}, Scale: ${scale}`);
        
        if (!fs.existsSync(normalizedPath)) {
            return { success: false, message: 'File not found' };
        }

        const ext = path.extname(normalizedPath).toLowerCase();
        
        // For PDFs, use pdf-to-printer library
        if (ext === '.pdf') {
            try {
                const printOptions = {
                    printer: printerName,
                    copies
                };
                
                // Add page ranges if specified (format: "1-3,5,7-9")
                // Remove any spaces from page ranges
                if (pageRanges) {
                    const cleanedPages = pageRanges.replace(/\s/g, '');
                    printOptions.pages = cleanedPages;
                    console.log('Original page ranges:', pageRanges);
                    console.log('Cleaned page ranges:', cleanedPages);
                    console.log('Printing to:', printerName);
                }

                printOptions.paperSize = paperSize;
                if (orientation === 'landscape') {
                    printOptions.landscape = true;
                }
                if (duplex === 'long-edge') {
                    printOptions.side = 'duplexlong';
                } else if (duplex === 'short-edge') {
                    printOptions.side = 'duplexshort';
                }
                if (scale === 'actual') {
                    printOptions.scale = 'noscale';
                }
                
                console.log('Print options:', JSON.stringify(printOptions));
                
                // Don't wait for print to complete - just send the command
                pdfPrinter.print(normalizedPath, printOptions).catch(err => {
                    console.error('Print error (async):', err);
                });
                
                console.log('PDF print command sent');
                return { success: true, message: `Print job sent to ${printerName}` };
            } catch (error) {
                console.error('PDF print error:', error);
                console.error('Error details:', error.message, error.stack);
                return { success: false, message: 'Print failed: ' + error.message };
            }
        }
        
        // For images, use Electron print
        const printWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        await printWindow.loadURL(`file://${normalizedPath}`);

        return new Promise((resolve) => {
            printWindow.webContents.print({
                silent: true,
                printBackground: true,
                deviceName: printerName,
                color: options.isColor !== false,
                margins: { marginType: 'default' },
                landscape: orientation === 'landscape',
                copies,
                pageSize: paperSize
            }, (success, errorType) => {
                printWindow.close();
                if (!success) {
                    console.error('Print failed:', errorType);
                    resolve({ success: false, message: errorType });
                } else {
                    resolve({ success: true });
                }
            });
        });
    } catch (error) {
        console.error('Print error:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('open-native-print-dialog', async (event, filePath) => {
    try {
        const normalizedPath = path.normalize(filePath);

        if (!fs.existsSync(normalizedPath)) {
            return { success: false, message: 'File not found' };
        }

        // Create a hidden window to load the file and show print dialog
        const printWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        // Load the file
        await printWindow.loadURL(`file://${normalizedPath}`);

        // Show the native system print dialog
        printWindow.webContents.print({
            silent: false,  // Show the print dialog
            printBackground: true,
            color: true
        }, (success, errorType) => {
            printWindow.close();
            if (!success && errorType) {
                log('Print dialog error:', errorType);
            }
        });

        return { success: true, message: 'Print dialog opened' };
    } catch (error) {
        console.error('Error opening native print dialog:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        const normalizedPath = path.normalize(filePath);

        if (!fs.existsSync(normalizedPath)) {
            return { success: true, message: 'File does not exist' };
        }

        // Delete the file
        fs.unlinkSync(normalizedPath);
        log(`Deleted file after print: ${normalizedPath}`);

        return { success: true, message: 'File deleted successfully' };
    } catch (error) {
        log('Error deleting file:', formatError(error));
        return { success: false, message: error.message };
    }
});

function saveReceivedFile(downloadPath, filename, buffer) {
    const originalName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dir = downloadPath || path.join(process.cwd(), 'downloads');
    const parsed = path.parse(originalName);
    let candidate = path.join(dir, originalName);
    let counter = 1;

    fs.mkdirSync(dir, { recursive: true });
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${parsed.name}_${counter}${parsed.ext}`);
        counter += 1;
    }

    fs.writeFileSync(candidate, buffer);
    return path.normalize(candidate);
}

function escapeHtmlForHtml(text) {
    return String(text).replace(/[&<>"']/g, (match) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[match]));
}

function normalizePageRanges(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    const lowered = normalized.toLowerCase();
    if (lowered === 'all pages' || lowered === 'full image' || lowered === 'all' || lowered === 'all_pages') {
        return '';
    }

    return normalized;
}
