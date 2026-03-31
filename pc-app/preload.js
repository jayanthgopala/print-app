const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    installCloudflared: () => ipcRenderer.invoke('install-cloudflared'),
    generateQR: (shopId) => ipcRenderer.invoke('generate-qr', shopId),
    printQR: (payload) => ipcRenderer.invoke('print-qr', payload),
    startService: () => ipcRenderer.invoke('start-service'),
    saveReceivedFile: (payload) => ipcRenderer.invoke('save-received-file', payload),
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    printFile: (filePath, options) => ipcRenderer.invoke('print-file', filePath, options),
    openNativePrintDialog: (filePath) => ipcRenderer.invoke('open-native-print-dialog', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    onFileReceived: (callback) => ipcRenderer.on('file-received', (event, data) => callback(data)),
    onTunnelStatus: (callback) => ipcRenderer.on('tunnel-status', (event, data) => callback(data))
});
