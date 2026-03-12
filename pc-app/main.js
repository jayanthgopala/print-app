const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const ShopReceiver = require('./services/fileReceiver');
const QRCode = require('qrcode');
const pdfPrinter = require('pdf-to-printer');

loadLocalEnv(path.join(__dirname, '.env'));

const store = new Store();
let mainWindow;
let shopReceiver;

// Default to the deployed Worker backend; env vars can still override this.
const DEFAULT_API_URL = 'https://print-app-backend.jayanthgopala21.workers.dev';
const API_URL = process.env.API_URL || DEFAULT_API_URL;
const WS_URL = process.env.WS_URL || API_URL.replace(/^http/, 'ws');
console.log('PC app backend config:', { API_URL, WS_URL });

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {});

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
    console.log('Saving settings:', { shopId, colorPrice, bwPrice });
    
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
                console.log('Login successful');
            } else if (loginResp.status === 403) {
                // Password not set on server: set it and retry
                console.log('Password not set on server, attempting to set password...');
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
                            console.log('Login successful after setting password');
                        } else {
                            console.error('Login failed after setting password', data2);
                            return { success: false, message: 'Login failed after setting password' };
                        }
                    } else {
                        const errText = await setResp.text();
                        console.error('Set password failed:', errText);
                        return { success: false, message: 'Failed to set password' };
                    }
                } catch (setErr) {
                    console.error('Set password error:', setErr.message);
                    return { success: false, message: setErr.message };
                }
            } else {
                console.error('Login failed:', loginData);
                return { success: false, message: loginData.error || 'Invalid credentials' };
            }
        } catch (err) {
            console.error('Login request failed:', err.message);
            return { success: false, message: err.message };
        }

        // Update prices in database (best-effort)
        if (colorPrice && bwPrice && shopId) {
            console.log('Updating database prices...');
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
                    console.log('Database updated:', updateData);
                }
            } catch (dbError) {
                console.error('Database update failed (continuing anyway):', dbError.message);
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

    try {
        if (shopReceiver) {
            shopReceiver.disconnect();
        }

        shopReceiver = new ShopReceiver(shopId, token, WS_URL, downloadPath, (order) => {
            if (mainWindow) {
                mainWindow.webContents.send('file-received', order);
            }
        });
        shopReceiver.connect();

        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('print-file', async (event, filePath, options) => {
    try {
        const normalizedPath = path.normalize(filePath);
        const printerName = options.printerName || '';
        const pageRanges = options.pageRanges || '';
        
        console.log(`Printing to ${printerName}: ${normalizedPath}, Pages: ${pageRanges || 'all'}`);
        
        if (!fs.existsSync(normalizedPath)) {
            return { success: false, message: 'File not found' };
        }

        const ext = path.extname(normalizedPath).toLowerCase();
        
        // For PDFs, use pdf-to-printer library
        if (ext === '.pdf') {
            try {
                const printOptions = {
                    printer: printerName
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
                silent: false,
                printBackground: true,
                deviceName: printerName,
                color: options.isColor !== false,
                margins: { marginType: 'default' }
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
