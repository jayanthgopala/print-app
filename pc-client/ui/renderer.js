// Renderer process script
let currentStatus = null;
let currentJobs = [];

// DOM elements
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const shopCode = document.getElementById('shop-code');
const deviceId = document.getElementById('device-id');
const queueLength = document.getElementById('queue-length');
const reconnectBtn = document.getElementById('reconnect-btn');
const jobsContainer = document.getElementById('jobs-container');
const logsContainer = document.getElementById('logs-container');

// Initialize
async function init() {
  await updateStatus();
  await updateJobs();
  
  // Set up periodic updates
  setInterval(updateStatus, 5000);
  setInterval(updateJobs, 3000);
}

async function updateStatus() {
  try {
    const status = await window.electronAPI.getStatus();
    currentStatus = status;
    
    shopCode.textContent = status.shopCode || '-';
    deviceId.textContent = status.deviceId || '-';
    queueLength.textContent = status.queueLength || 0;
    
    if (status.connected) {
      statusIndicator.className = 'status-indicator connected';
      statusText.textContent = 'Connected';
    } else {
      statusIndicator.className = 'status-indicator disconnected';
      statusText.textContent = 'Disconnected';
    }
  } catch (error) {
    console.error('Failed to update status:', error);
  }
}

async function updateJobs() {
  try {
    const jobs = await window.electronAPI.getJobs();
    currentJobs = jobs;
    renderJobs(jobs);
  } catch (error) {
    console.error('Failed to update jobs:', error);
  }
}

function renderJobs(jobs) {
  if (jobs.length === 0) {
    jobsContainer.innerHTML = '<p class="empty-state">No jobs in queue</p>';
    return;
  }
  
  jobsContainer.innerHTML = jobs.map(job => `
    <div class="job-card">
      <div class="job-header">
        <span class="job-id">${job.jobId}</span>
        <span class="job-status ${job.status}">${job.status}</span>
      </div>
      <div class="job-details">
        <div><strong>File:</strong> ${job.fileName}</div>
        <div><strong>Copies:</strong> ${job.copies || 1}</div>
        ${job.printerName ? `<div><strong>Printer:</strong> ${job.printerName}</div>` : ''}
        <div><strong>Added:</strong> ${new Date(job.addedAt).toLocaleTimeString()}</div>
      </div>
    </div>
  `).join('');
}

function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${type}`;
  logEntry.innerHTML = `<span class="log-time">${time}</span>${message}`;
  
  logsContainer.insertBefore(logEntry, logsContainer.firstChild);
  
  // Keep only last 50 logs
  while (logsContainer.children.length > 50) {
    logsContainer.removeChild(logsContainer.lastChild);
  }
}

// Event listeners
reconnectBtn.addEventListener('click', async () => {
  addLog('Reconnecting...', 'info');
  await window.electronAPI.reconnect();
});

window.electronAPI.onStatusUpdate((data) => {
  if (data.connected) {
    addLog('Connected to server', 'success');
  } else {
    addLog('Disconnected from server', 'error');
  }
  updateStatus();
});

window.electronAPI.onNewJob((job) => {
  addLog(`New print job received: ${job.fileName}`, 'info');
  updateJobs();
});

window.electronAPI.onJobUpdate((data) => {
  addLog(`Job ${data.jobId} status: ${data.status}`, data.status === 'failed' ? 'error' : 'success');
  updateJobs();
});

window.electronAPI.onError((data) => {
  addLog(`Error: ${data.message}`, 'error');
});

// Start the app
init();
