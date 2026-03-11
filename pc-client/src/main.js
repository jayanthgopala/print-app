import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { DeviceClient } from './deviceClient.js';
import { PrintQueue } from './printQueue.js';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const store = new Store();
let mainWindow = null;
let tray = null;
let deviceClient = null;
let printQueue = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // icon: path.join(__dirname, '../assets/icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '../assets/tray-icon.png'));
  } catch (error) {
    console.log('Tray icon not found, skipping tray creation');
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        mainWindow.show();
      },
    },
    {
      label: 'Status',
      enabled: false,
    },
    {
      label: 'Connected',
      type: 'checkbox',
      checked: false,
      enabled: false,
      id: 'status',
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Print Platform Client');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

function updateTrayStatus(connected) {
  if (tray) {
    const menu = tray.getContextMenu();
    const statusItem = menu.getMenuItemById('status');
    if (statusItem) {
      statusItem.checked = connected;
    }
  }
}

async function initializeApp() {
  // Get configuration
  const shopCode = process.env.SHOP_CODE || store.get('shopCode');
  const serverUrl = process.env.SERVER_URL || 'ws://localhost:3001';
  let deviceToken = process.env.DEVICE_TOKEN || store.get('deviceToken');

  if (!shopCode) {
    console.error('SHOP_CODE not configured');
    return;
  }

  // Generate device ID if not exists
  let deviceId = store.get('deviceId');
  if (!deviceId) {
    deviceId = `DEVICE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    store.set('deviceId', deviceId);
  }

  const pcName = process.env.PC_NAME || os.hostname();

  // Initialize print queue
  printQueue = new PrintQueue();
  await printQueue.initialize();

  // Initialize device client
  deviceClient = new DeviceClient({
    serverUrl,
    shopCode,
    deviceId,
    pcName,
    deviceToken,
  });
  printQueue.setDeviceClient(deviceClient);

  // Handle device events
  deviceClient.on('connected', () => {
    console.log('✅ Connected to server');
    updateTrayStatus(true);
    sendToRenderer('status-update', { connected: true });
  });

  deviceClient.on('disconnected', () => {
    console.log('⚠️  Disconnected from server');
    updateTrayStatus(false);
    sendToRenderer('status-update', { connected: false });
  });

  deviceClient.on('registered', (data) => {
    console.log('✅ Device registered');
    if (data.deviceToken) {
      store.set('deviceToken', data.deviceToken);
    }
  });

  deviceClient.on('print-job', async (job) => {
    console.log('Received print job:', job.jobId);
    const added = await printQueue.addJob(job);
    if (added) {
      sendToRenderer('new-job', job);
    }
  });

  deviceClient.on('error', (error) => {
    console.error('❌ Device error:', error);
    sendToRenderer('error', { message: error.message });
  });

  // Handle queue events
  printQueue.on('job-started', (jobId) => {
    sendToRenderer('job-update', { jobId, status: 'printing' });
  });

  printQueue.on('job-completed', (jobId) => {
    sendToRenderer('job-update', { jobId, status: 'completed' });
  });

  printQueue.on('job-failed', (jobId, error) => {
    sendToRenderer('job-update', { jobId, status: 'failed', error });
  });

  // Connect to server
  deviceClient.connect();
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// IPC handlers
ipcMain.handle('get-status', () => {
  return {
    connected: deviceClient ? deviceClient.isConnected() : false,
    shopCode: process.env.SHOP_CODE || store.get('shopCode'),
    deviceId: store.get('deviceId'),
    queueLength: printQueue ? printQueue.getQueueLength() : 0,
  };
});

ipcMain.handle('get-jobs', () => {
  return printQueue ? printQueue.getJobs() : [];
});

ipcMain.handle('reconnect', () => {
  if (deviceClient) {
    deviceClient.reconnect();
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  initializeApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (deviceClient) {
    deviceClient.disconnect();
  }
});
