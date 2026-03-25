const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const QRCode = require('qrcode');
const pdfPrinter = require('pdf-to-printer');

const APP_ID = 'com.jayanthgopala.printshop.pcapp';
const APP_DATA_DIR_NAME = 'Print Shop Manager';

loadLocalEnv(path.join(__dirname, '.env'));

configureAppPaths();

const store = new Store();
let mainWindow;

// Default to the deployed Worker backend; env vars can still override this.
const DEFAULT_API_URL = 'https://print-app-backend.jayanthgopala21.workers.dev';
const API_URL = process.env.API_URL || DEFAULT_API_URL;
const WS_URL = process.env.WS_URL || API_URL.replace(/^http/, 'ws');
log('PC app backend config:', { API_URL, WS_URL });

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
});

ipcMain.handle('get-settings', () => ({
    shopId: store.get('shopId', ''),
    token: store.get('token', ''),
    downloadPath: store.get('downloadPath', app.getPath('downloads')),
    colorPrice: store.get('colorPrice'),
    bwPrice: store.get('bwPrice'),
    colorPrinter: store.get('colorPrinter', ''),
    bwPrinter: store.get('bwPrinter', ''),
    password: store.get('password', '')
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

        return { success: true, token: store.get('token') };
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

ipcMain.handle('start-service', () => {
    const shopId = store.get('shopId');
    const token = store.get('token');
    const downloadPath = store.get('downloadPath', app.getPath('downloads'));

    if (!shopId || !token) {
        return { success: false, message: 'Missing credentials' };
    }

    return {
        success: true,
        config: {
            shopId,
            token,
            downloadPath,
            wsUrl: WS_URL
        }
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
