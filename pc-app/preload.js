const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    installCloudflared: () => ipcRenderer.invoke('install-cloudflared'),
    generateQR: (shopId) => ipcRenderer.invoke('generate-qr', shopId),
    printQR: (payload) => ipcRenderer.invoke('print-qr', payload),
    startService: () => ipcRenderer.invoke('start-service'),
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    updateJobStatus: (payload) => ipcRenderer.invoke('update-job-status', payload),
    completeJob: (payload) => ipcRenderer.invoke('complete-job', payload),
    printFile: (filePath, options) => ipcRenderer.invoke('print-file', filePath, options),
    openNativePrintDialog: (filePath, options) => ipcRenderer.invoke('open-native-print-dialog', filePath, options),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    saveNotifSound: (enabled) => ipcRenderer.invoke('save-notif-sound', enabled),
    savePaperSizes: (sizes) => ipcRenderer.invoke('save-paper-sizes', sizes),
    onFileReceived: (callback) => ipcRenderer.on('file-received', (event, data) => callback(data)),
    onJobProcessed: (callback) => ipcRenderer.on('job-processed', (event, data) => callback(data)),
    onTunnelStatus: (callback) => ipcRenderer.on('tunnel-status', (event, data) => callback(data))
});
