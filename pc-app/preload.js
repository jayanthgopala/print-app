const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    generateQR: (shopId) => ipcRenderer.invoke('generate-qr', shopId),
    startService: () => ipcRenderer.invoke('start-service'),
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    printFile: (filePath, options) => ipcRenderer.invoke('print-file', filePath, options),
    onFileReceived: (callback) => ipcRenderer.on('file-received', (event, data) => callback(data))
});
