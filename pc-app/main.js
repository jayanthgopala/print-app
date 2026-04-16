const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { randomInt } = require('crypto');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Store = require('electron-store');
const QRCode = require('qrcode');
const pdfPrinter = require('pdf-to-printer');

const APP_ID = 'com.jayanthgopala.printshop.pcapp';
const DEFAULT_API_URL = 'https://backend.buildergrids.tech';
const POLL_INTERVAL_MS = 4000;
const JOB_BATCH_LIMIT = 20;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const store = new Store();
const LOG_FILE_NAME = 'pc-app.log';

let mainWindow = null;
let pollTimer = null;
let polling = false;
let isQuitting = false;
let isClosePromptOpen = false;
const queuedJobs = new Map();

loadLocalEnv(path.join(__dirname, '.env'));
app.setAppUserModelId(APP_ID);

function apiUrl() {
    return normalizeBaseUrl(process.env.API_URL, DEFAULT_API_URL);
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
    mainWindow.on('close', (event) => {
        if (isQuitting) return;
        event.preventDefault();
        void confirmAndCloseApp();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
}

function getLogFilePath() {
    try {
        return path.join(app.getPath('userData'), LOG_FILE_NAME);
    } catch (_error) {
        return path.join(__dirname, LOG_FILE_NAME);
    }
}

function logAppEvent(level, message, details = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...details
    };
    const line = `${JSON.stringify(entry)}\n`;
    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logMethod('[pc-app]', entry);
    try {
        fs.mkdirSync(path.dirname(getLogFilePath()), { recursive: true });
        fs.appendFileSync(getLogFilePath(), line, 'utf8');
    } catch (error) {
        console.error('[pc-app] failed_to_write_log', error);
    }
}

async function readResponseDetails(response) {
    const requestId = response.headers.get('x-request-id') || response.headers.get('cf-ray') || '';
    const contentType = response.headers.get('content-type') || '';
    const bodyText = await response.clone().text().catch(() => '');
    let payload = null;
    if (bodyText && contentType.toLowerCase().includes('application/json')) {
        payload = safeJsonParse(bodyText);
    } else if (bodyText) {
        payload = safeJsonParse(bodyText);
    }
    return {
        status: response.status,
        ok: response.ok,
        requestId,
        bodyText,
        payload: payload && typeof payload === 'object' ? payload : null
    };
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (_error) {
        return null;
    }
}

function getErrorMessageFromResponse(details, fallback) {
    return details.payload?.error || details.payload?.message || details.bodyText || fallback;
}

function getAppIconPath() {
    const iconFile = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';
    return path.join(__dirname, 'assets', iconFile);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
    isQuitting = true;
    stopPolling();
});

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
        const details = await readResponseDetails(response);
        if (!details.ok || !details.payload?.token) {
            logAppEvent('error', 'shop_token_failed', {
                url: `${apiUrl()}/auth/shop-token`,
                status: details.status,
                requestId: details.requestId,
                responseBody: details.bodyText,
                shopId: normalizeShopCode(settings.shopId)
            });
            return {
                success: false,
                message: getErrorMessageFromResponse(details, 'Login failed'),
                status: details.status,
                requestId: details.requestId
            };
        }
        store.set('shopToken', details.payload.token);
        logAppEvent('info', 'shop_token_success', {
            url: `${apiUrl()}/auth/shop-token`,
            status: details.status,
            requestId: details.requestId,
            shopId: normalizeShopCode(settings.shopId)
        });
        return { success: true, token: details.payload.token, shopToken: details.payload.token };
    } catch (error) {
        logAppEvent('error', 'shop_token_request_error', {
            url: `${apiUrl()}/auth/shop-token`,
            error: error.message,
            shopId: normalizeShopCode(settings.shopId)
        });
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
        const frontendUrl = normalizeBaseUrl(process.env.FRONTEND_URL, '');
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
    const firstPoll = await pollJobs();
    if (firstPoll && firstPoll.success === false) {
        sendServiceStatus('offline', {
            message: firstPoll.message,
            requestId: firstPoll.requestId || '',
            statusCode: firstPoll.status || 0
        });
        return firstPoll;
    }
    const presenceResult = await markShopPresence('online');
    if (!presenceResult.success) {
        stopPolling();
        sendServiceStatus('offline', {
            message: presenceResult.message,
            requestId: presenceResult.requestId || '',
            statusCode: presenceResult.status || 0
        });
        return {
            success: false,
            message: presenceResult.message || 'Failed to update shop presence',
            requestId: presenceResult.requestId || '',
            status: presenceResult.status || 0
        };
    }
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

ipcMain.handle('print-file', async (_event, filePath, options) => {
    logAppEvent('info', 'print_file_ipc_received', {
        filePath,
        printerName: options?.printerName || '',
        isColor: options?.isColor !== false,
        pageRanges: options?.pageRanges || '',
        paperSize: options?.paperSize || 'A4',
        orientation: options?.orientation || 'portrait'
    });
    return printFile(filePath, options);
});
ipcMain.handle('open-native-print-dialog', async () => ({ success: false, message: 'Native print dialog is not used in the new flow.' }));
ipcMain.handle('delete-file', async (_event, filePath) => deleteFile(filePath));

async function confirmAndCloseApp() {
    if (!mainWindow || isClosePromptOpen) return;
    isClosePromptOpen = true;
    try {
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            buttons: ['Yes', 'No'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: 'Close App',
            message: 'Do you want to close the app?',
            detail: 'If you continue, the shop will be marked offline.'
        });

        if (response !== 0) return;

        await shutdownShopSession({ markOffline: true });
        isQuitting = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
        }
    } finally {
        isClosePromptOpen = false;
    }
}

async function pollJobs() {
    if (polling) return;
    polling = true;
    try {
        const shopId = normalizeShopCode(store.get('shopId', ''));
        const token = store.get('shopToken', '');
        if (!shopId || !token) return { success: false, message: 'Missing credentials' };
        const response = await fetchWithRetry(`${apiUrl()}/jobs/${encodeURIComponent(shopId)}?limit=${JOB_BATCH_LIMIT}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        });
        const details = await readResponseDetails(response);
        if (!details.ok || !Array.isArray(details.payload?.jobs)) {
            const message = getErrorMessageFromResponse(details, 'Failed to fetch jobs');
            logAppEvent('error', 'poll_jobs_failed', {
                url: `${apiUrl()}/jobs/${encodeURIComponent(shopId)}?limit=${JOB_BATCH_LIMIT}`,
                status: details.status,
                requestId: details.requestId,
                responseBody: details.bodyText,
                shopId
            });
            return { success: false, message, status: details.status, requestId: details.requestId };
        }
        const payload = details.payload;
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
                    status: 'failed',
                    error: `download_failed:${error.message || 'unknown'}`
                });
            }
        }
        return { success: true, count: payload.jobs.length };
    } catch (error) {
        logAppEvent('error', 'poll_jobs_request_error', {
            url: `${apiUrl()}/jobs/${encodeURIComponent(store.get('shopId', ''))}?limit=${JOB_BATCH_LIMIT}`,
            error: error.message
        });
        return { success: false, message: error.message };
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

async function shutdownShopSession({ markOffline = false } = {}) {
    stopPolling();
    if (!markOffline) return { success: true };

    const result = await markShopPresence('offline');
    if (!result.success) {
        logAppEvent('warn', 'shop_presence_offline_failed', {
            message: result.message,
            status: result.status,
            requestId: result.requestId
        });
    }
    return result;
}

function sendServiceStatus(status, extra = {}) {
    if (mainWindow) mainWindow.webContents.send('tunnel-status', { status, ...extra });
}

async function markShopPresence(status) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!['online', 'offline'].includes(normalizedStatus)) {
        return { success: false, message: 'Invalid shop presence status' };
    }

    const shopId = normalizeShopCode(store.get('shopId', ''));
    const token = store.get('shopToken', '');
    if (!shopId || !token) return { success: true, skipped: true };

    return postToBackend('/shop/presence', { status: normalizedStatus });
}

async function postToBackend(pathname, payload) {
    const token = store.get('shopToken', '');
    try {
        const response = await fetchWithRetry(`${apiUrl()}${pathname}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        const details = await readResponseDetails(response);
        if (!details.ok) {
            logAppEvent('error', 'backend_post_failed', {
                url: `${apiUrl()}${pathname}`,
                status: details.status,
                requestId: details.requestId,
                responseBody: details.bodyText,
                payload
            });
            return {
                success: false,
                message: getErrorMessageFromResponse(details, 'Request failed'),
                status: details.status,
                requestId: details.requestId
            };
        }
        return { success: true, ...(details.payload || {}) };
    } catch (error) {
        logAppEvent('error', 'backend_post_request_error', {
            url: `${apiUrl()}${pathname}`,
            error: error.message,
            payload
        });
        return { success: false, message: error.message };
    }
}

async function fetchWithRetry(url, options) {
    let lastError = null;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt += 1) {
        try {
            const response = await fetch(url, options);
            if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
                logAppEvent('warn', 'fetch_retrying_after_server_error', {
                    url,
                    status: response.status,
                    attempt: attempt + 1
                });
                await delay(withJitter(RETRY_DELAYS_MS[attempt]));
                continue;
            }
            return response;
        } catch (error) {
            lastError = error;
            logAppEvent('warn', 'fetch_retrying_after_network_error', {
                url,
                error: error.message,
                attempt: attempt + 1
            });
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
    const limit = Number(maxExclusive);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error('secureRandomInt requires a positive integer');
    }
    return randomInt(limit);
}

async function printFile(filePath, options) {
    try {
        const normalizedPath = path.normalize(filePath);
        if (!fs.existsSync(normalizedPath)) return { success: false, message: 'File not found' };
        const printerName = options.printerName || '';
        if (!printerName) return { success: false, message: 'Printer not selected' };
        const ext = path.extname(normalizedPath).toLowerCase();
        logAppEvent('info', 'print_file_start', {
            filePath: normalizedPath,
            printerName,
            ext,
            isVirtualPdfPrinter: isVirtualPdfPrinter(printerName)
        });
        if (ext === '.pdf') {
            const printOptions = { printer: printerName, copies: Math.max(1, Number(options.copies || 1)), paperSize: options.paperSize || 'A4' };
            const pageRanges = normalizePageRanges(options.pageRanges || '');
            if (pageRanges) printOptions.pages = pageRanges.replace(/\s/g, '');
            if (options.orientation === 'landscape') printOptions.landscape = true;
            if (options.duplex === 'long-edge') printOptions.side = 'duplexlong';
            if (options.duplex === 'short-edge') printOptions.side = 'duplexshort';
            if (options.scale === 'actual') printOptions.scale = 'noscale';
            logAppEvent('info', 'print_pdf_start', {
                filePath: normalizedPath,
                printerName,
                printOptions
            });
            await pdfPrinter.print(normalizedPath, printOptions);
            return { success: true, message: `Print job sent to ${printerName}` };
        }
        if (isOfficeDocument(normalizedPath)) {
            return { success: false, message: 'DOC and DOCX printing is not supported directly in the desktop app yet. Convert to PDF first.' };
        }
        if (isVirtualPdfPrinter(printerName)) {
            return await printWithDialog(normalizedPath, options);
        }
        const printWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
        await loadPrintablePreview(printWindow, normalizedPath, options);
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
        logAppEvent('error', 'print_file_failed', {
            filePath,
            printerName: options?.printerName || '',
            error: error.message
        });
        return { success: false, message: error.message };
    }
}

async function printWithDialog(filePath, options) {
    const printerName = options?.printerName || '';
    const printWindow = new BrowserWindow({
        show: false,
        width: 960,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    try {
        logAppEvent('info', 'print_with_dialog_start', {
            filePath,
            printerName
        });
        if (isOfficeDocument(filePath)) {
            if (!printWindow.isDestroyed()) printWindow.close();
            return { success: false, message: 'DOC and DOCX printing is not supported directly in the desktop app yet. Convert to PDF first.' };
        }
        await loadPrintablePreview(printWindow, filePath, options);

        if (isVirtualPdfPrinter(printerName)) {
            const pdfBuffer = await printWindow.webContents.printToPDF({
                printBackground: true,
                landscape: options?.orientation === 'landscape',
                pageSize: options?.paperSize || 'A4',
                margins: { top: 0, bottom: 0, left: 0, right: 0 }
            });
            if (!printWindow.isDestroyed()) printWindow.close();

            const defaultName = path.parse(path.basename(filePath)).name + '_print.pdf';
            const { canceled, filePath: savePath } = await dialog.showSaveDialog(mainWindow, {
                title: 'Save Printed PDF',
                defaultPath: path.join(app.getPath('downloads'), defaultName),
                filters: [{ name: 'PDF', extensions: ['pdf'] }]
            });
            if (canceled || !savePath) {
                return { success: false, message: 'Save cancelled' };
            }
            fs.writeFileSync(savePath, pdfBuffer);
            logAppEvent('info', 'print_virtual_pdf_saved', { savePath });
            return { success: true, message: `Saved to ${savePath}` };
        }

        return await new Promise((resolve) => {
            printWindow.webContents.print({
                silent: false,
                printBackground: true,
                deviceName: printerName,
                color: options?.isColor !== false,
                landscape: options?.orientation === 'landscape',
                copies: Math.max(1, Number(options?.copies || 1)),
                pageSize: options?.paperSize || 'A4'
            }, (success, errorType) => {
                if (!printWindow.isDestroyed()) printWindow.close();
                if (success) {
                    resolve({ success: true, message: `Print dialog completed for ${printerName}` });
                    return;
                }
                resolve({ success: false, message: errorType || 'Print dialog cancelled or failed' });
            });
        });
    } catch (error) {
        if (!printWindow.isDestroyed()) printWindow.close();
        throw error;
    }
}

function isVirtualPdfPrinter(printerName) {
    const normalized = String(printerName || '').trim().toLowerCase();
    return [
        'microsoft print to pdf',
        'save as pdf',
        'adobe pdf',
        'foxit reader pdf printer'
    ].includes(normalized);
}

async function loadPrintablePreview(printWindow, filePath, options) {
    const normalizedPath = path.normalize(filePath);
    const ext = path.extname(normalizedPath).toLowerCase();
    logAppEvent('info', 'load_printable_preview_start', {
        filePath: normalizedPath,
        ext,
        paperSize: options?.paperSize || 'A4',
        orientation: options?.orientation || 'portrait'
    });
    if (isImageFile(normalizedPath)) {
        const imageUrl = pathToFileURL(normalizedPath).toString();
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
            html, body { margin: 0; padding: 0; background: white; }
            body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
            .page { width: 100%; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
            img { max-width: 100%; max-height: 100vh; object-fit: ${options?.scale === 'actual' ? 'none' : 'contain'}; }
            @page { size: ${escapeHtml(options?.paperSize || 'A4')} ${options?.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 0; }
        </style></head><body><div class="page"><img src="${imageUrl}" alt="Printable image"></div></body></html>`;
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        await printWindow.webContents.executeJavaScript(`
            new Promise((resolve, reject) => {
                const img = document.querySelector('img');
                if (!img) {
                    reject(new Error('Printable image element not found'));
                    return;
                }
                if (img.complete && img.naturalWidth > 0) {
                    resolve(true);
                    return;
                }
                img.addEventListener('load', () => resolve(true), { once: true });
                img.addEventListener('error', () => reject(new Error('Image could not be loaded for printing')), { once: true });
            });
        `);
        logAppEvent('info', 'load_printable_preview_image_ready', {
            filePath: normalizedPath
        });
        return;
    }

    if (ext === '.pdf') {
        await printWindow.loadURL(pathToFileURL(normalizedPath).toString());
        logAppEvent('info', 'load_printable_preview_pdf_ready', {
            filePath: normalizedPath
        });
        return;
    }

    await printWindow.loadURL(pathToFileURL(normalizedPath).toString());
    logAppEvent('info', 'load_printable_preview_file_ready', {
        filePath: normalizedPath
    });
}

function isImageFile(filePath) {
    return ['.png', '.jpg', '.jpeg'].includes(path.extname(String(filePath || '')).toLowerCase());
}

function isOfficeDocument(filePath) {
    return ['.doc', '.docx'].includes(path.extname(String(filePath || '')).toLowerCase());
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

function normalizeBaseUrl(value, fallback = '') {
    const raw = String(value || fallback || '').trim();
    if (!raw) return '';
    const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
    return withProtocol.replace(/\/+$/, '');
}

function normalizePageRanges(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return ['all pages', 'all', 'full image', 'all_pages'].includes(normalized.toLowerCase()) ? '' : normalized;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[match]));
}
