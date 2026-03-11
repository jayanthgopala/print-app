import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  getJobs: () => ipcRenderer.invoke('get-jobs'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  
  // Event listeners
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, data) => callback(data));
  },
  onNewJob: (callback) => {
    ipcRenderer.on('new-job', (event, data) => callback(data));
  },
  onJobUpdate: (callback) => {
    ipcRenderer.on('job-update', (event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (event, data) => callback(data));
  },
});
