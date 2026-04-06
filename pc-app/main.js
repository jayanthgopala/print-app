const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const QRCode = require('qrcode');
const pdfPrinter = require('pdf-to-printer');

const APP_ID = 'com.jayanthgopala.printshop.pcapp';
const DEFAULT_API_URL = 'https://backend.buildergrids.tech';
const POLL_INTERVAL_MS = 4000;
const JOB_BATCH_LIMIT = 20;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const store = new Store();

let mainWindow = null;
let pollTimer = null;
let polling = false;
const queuedJobs = new Map();

loadLocalEnv(path.join(__dirname, '.env'));
app.setAppUserModelId(APP_ID);

function apiUrl() {
    return (process.env.API_URL || DEFAULT_API_URL).replace(/\/$/, '');
}

function loadLocalEnv(envPath) {
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key && !process.env[key]) process.env[key] = value;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: getAppIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    Menu.setApplicationMenu(null);
    mainWindow.loadFile('index.html');
    mainWindow.on('closed', () => { mainWindow = null; });
}

function getAppIconPath() {
    const iconFile = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';
    return path.join(__dirname, 'assets', iconFile);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', stopPolling);

ipcMain.handle('get-settings', () => ({
    shopId: store.get('shopId', ''),
    token: store.get('shopToken', ''),
    shopToken: store.get('shopToken', ''),
    downloadPath: store.get('downloadPath', app.getPath('downloads')),
    colorPrice: store.get('colorPrice', ''),
    bwPrice: store.get('bwPrice', ''),
    colorPrinter: store.get('colorPrinter', ''),
    bwPrinter: store.get('bwPrinter', ''),
    password: store.get('password', '')
}));

ipcMain.handle('save-settings', async (_event, settings) => {
    store.set('shopId', normalizeShopCode(settings.shopId));
    store.set('password', settings.password || '');
    store.set('downloadPath', settings.downloadPath || app.getPath('downloads'));
    store.set('colorPrice', settings.colorPrice ?? '');
    store.set('bwPrice', settings.bwPrice ?? '');
    store.set('colorPrinter', settings.colorPrinter || '');
    store.set('bwPrinter', settings.bwPrinter || '');

    try {
        const response = await fetch(`${apiUrl()}/auth/shop-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopCode: normalizeShopCode(settings.shopId),
                password: settings.password || ''
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.token) {
            return { success: false, message: payload.error || 'Login failed' };
        }
        store.set('shopToken', payload.token);
        return { success: true, token: payload.token, shopToken: payload.token };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('install-cloudflared', async () => ({ success: false, message: 'Local upload tunnel is no longer used in this architecture.' }));

ipcMain.handle('get-printers', async () => {
    try {
        const printers = mainWindow ? mainWindow.webContents.getPrinters() : [];
        return { success: true, printers };
    } catch (error) {
        return { success: false, printers: [], message: error.message };
    }
});

ipcMain.handle('generate-qr', async (_event, shopId) => {
    try {
        const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
        if (!frontendUrl) return { success: false, message: 'FRONTEND_URL not set' };
        const qrDataUrl = await QRCode.toDataURL(`${frontendUrl}?shop=${normalizeShopCode(shopId)}`, { width: 300 });
        return { success: true, qrDataUrl };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('print-qr', async (_event, payload) => {
    try {
        if (!payload?.qrDataUrl) return { success: false, message: 'QR code not generated' };
        const printerName = store.get('colorPrinter', '') || store.get('bwPrinter', '');
        const printWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
        const html = `<!DOCTYPE html><html><body style="font-family:Arial;padding:32px;text-align:center"><h1>Scan to Send Files</h1><p>Share files directly to this print shop.</p><img src="${payload.qrDataUrl}" style="width:320px;height:320px" alt="QR"><div style="margin-top:16px;font-size:18px;font-weight:700">${escapeHtml(payload.shopId || '')}</div></body></html>`;
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return await new Promise((resolve) => {
            printWindow.webContents.print({ silent: true, printBackground: true, deviceName: printerName, copies: 1, pageSize: 'A4' }, (success, errorType) => {
                printWindow.close();
                resolve(success ? { success: true, message: 'QR sent to printer' } : { success: false, message: errorType || 'QR print failed' });
            });
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('start-service', async () => {
    const shopId = normalizeShopCode(store.get('shopId', ''));
    const token = store.get('shopToken', '');
    if (!shopId || !token) return { success: false, message: 'Missing credentials' };
    stopPolling();
    await pollJobs();
    pollTimer = setInterval(() => { void pollJobs(); }, POLL_INTERVAL_MS);
    sendServiceStatus('online');
    return { success: true, config: { shopId, token, status: 'online', batchLimit: JOB_BATCH_LIMIT }, message: 'Polling backend for jobs.' };
});

ipcMain.handle('update-job-status', async (_event, payload) => {
    return postToBackend('/job/update-status', payload);
});

ipcMain.handle('complete-job', async (_event, payload) => {
    const result = await postToBackend('/job/complete', payload);
    if (result.success && payload?.jobId) {
        queuedJobs.delete(payload.jobId);
        if (mainWindow) mainWindow.webContents.send('job-processed', { jobId: payload.jobId });
    }
    return result;
});

ipcMain.handle('print-file', async (_event, filePath, options) => printFile(filePath, options));
ipcMain.handle('open-native-print-dialog', async () => ({ success: false, message: 'Native print dialog is not used in the new flow.' }));
ipcMain.handle('delete-file', async (_event, filePath) => deleteFile(filePath));

async function pollJobs() {
    if (polling) return;
    polling = true;
    try {
        const shopId = normalizeShopCode(store.get('shopId', ''));
        const token = store.get('shopToken', '');
        if (!shopId || !token) return;
        const response = await fetchWithRetry(`${apiUrl()}/jobs/${encodeURIComponent(shopId)}?limit=${JOB_BATCH_LIMIT}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(payload.jobs)) return;
        for (const job of payload.jobs) {
            if (queuedJobs.has(job.id)) continue;
            try {
                const filePath = await downloadJob(job);
                const order = mapJobToOrder(job, filePath);
                queuedJobs.set(job.id, order);
                if (mainWindow) mainWindow.webContents.send('file-received', order);
            } catch (error) {
                console.error('Job download failed:', job.id, error);
                await postToBackend('/job/update-status', {
                    jobId: job.id,
                    status: 'pending',
                    error: `download_failed:${error.message || 'unknown'}`
                });
            }
        }
    } finally {
        polling = false;
    }
}

async function downloadJob(job) {
    const response = await fetchWithRetry(job.download_url || job.file_url, {});
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return saveReceivedFile(store.get('downloadPath', app.getPath('downloads')), job.file_name, bytes);
}

function mapJobToOrder(job, filePath) {
    const isColor = String(job.color_mode || '').toLowerCase() === 'color';
    return {
        id: `${job.id}-${Date.now()}-${secureRandomInt(1000000)}`,
        jobId: job.id,
        customerName: job.shop_code,
        fileName: job.file_name,
        filePath,
        colorPages: job.color_pages || (isColor ? 'All Pages' : ''),
        bwPages: job.bw_pages || (!isColor ? 'All Pages' : ''),
        paperSize: job.paper_size || 'A4',
        orientation: job.orientation || 'portrait',
        copies: Math.max(1, Number(job.copies || 1)),
        duplex: job.duplex || 'simplex',
        scale: job.scale || 'fit',
        timestamp: new Date(job.created_at || Date.now()).toLocaleString(),
        printed: false,
        skipped: false
    };
}

function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    polling = false;
}

function sendServiceStatus(status, extra = {}) {
    if (mainWindow) mainWindow.webContents.send('tunnel-status', { status, ...extra });
}

async function postToBackend(pathname, payload) {
    const token = store.get('shopToken', '');
    try {
        const response = await fetchWithRetry(`${apiUrl()}${pathname}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        const body = await response.json().catch(() => ({}));
        return response.ok ? { success: true, ...body } : { success: false, message: body.error || 'Request failed' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function fetchWithRetry(url, options) {
    let lastError = null;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt += 1) {
        try {
            const response = await fetch(url, options);
            if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
                await delay(withJitter(RETRY_DELAYS_MS[attempt]));
                continue;
            }
            return response;
        } catch (error) {
            lastError = error;
            if (attempt >= RETRY_DELAYS_MS.length) break;
            await delay(withJitter(RETRY_DELAYS_MS[attempt]));
        }
    }
    throw lastError || new Error('Request failed');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(baseMs) {
    return baseMs + secureRandomInt(250);
}

function secureRandomInt(maxExclusive) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return Number(values[0] % maxExclusive);
}

async function printFile(filePath, options) {
    try {
        const normalizedPath = path.normalize(filePath);
        if (!fs.existsSync(normalizedPath)) return { success: false, message: 'File not found' };
        const printerName = options.printerName || '';
        const ext = path.extname(normalizedPath).toLowerCase();
        if (ext === '.pdf') {
            const printOptions = { printer: printerName, copies: Math.max(1, Number(options.copies || 1)), paperSize: options.paperSize || 'A4' };
            const pageRanges = normalizePageRanges(options.pageRanges || '');
            if (pageRanges) printOptions.pages = pageRanges.replace(/\s/g, '');
            if (options.orientation === 'landscape') printOptions.landscape = true;
            if (options.duplex === 'long-edge') printOptions.side = 'duplexlong';
            if (options.duplex === 'short-edge') printOptions.side = 'duplexshort';
            if (options.scale === 'actual') printOptions.scale = 'noscale';
            await pdfPrinter.print(normalizedPath, printOptions);
            return { success: true, message: `Print job sent to ${printerName}` };
        }
        const printWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
        await printWindow.loadURL(`file://${normalizedPath}`);
        return await new Promise((resolve) => {
            printWindow.webContents.print({
                silent: true,
                printBackground: true,
                deviceName: printerName,
                color: options.isColor !== false,
                landscape: options.orientation === 'landscape',
                copies: Math.max(1, Number(options.copies || 1)),
                pageSize: options.paperSize || 'A4'
            }, (success, errorType) => {
                printWindow.close();
                resolve(success ? { success: true } : { success: false, message: errorType || 'Print failed' });
            });
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function deleteFile(filePath) {
    try {
        const normalizedPath = path.normalize(filePath);
        if (fs.existsSync(normalizedPath)) fs.unlinkSync(normalizedPath);
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

function saveReceivedFile(downloadPath, filename, buffer) {
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dir = downloadPath || app.getPath('downloads');
    const parsed = path.parse(safeFilename);
    fs.mkdirSync(dir, { recursive: true });
    let candidate = path.join(dir, safeFilename);
    let count = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${parsed.name}_${count}${parsed.ext}`);
        count += 1;
    }
    fs.writeFileSync(candidate, buffer);
    return path.normalize(candidate);
}

function normalizeShopCode(value) {
    return String(value || '').trim().replace(/[<>]/g, '').toUpperCase();
}

function normalizePageRanges(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return ['all pages', 'all', 'full image', 'all_pages'].includes(normalized.toLowerCase()) ? '' : normalized;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[match]));
}
