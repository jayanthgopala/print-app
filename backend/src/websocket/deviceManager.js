import { verifyDeviceToken, generateDeviceToken } from '../middleware/auth.js';
import {
  createDevice,
  getShopByCode,
  updateDeviceLastSeen,
  updateDeviceStatus,
} from '../db/sqlite.js';
import { nanoid } from 'nanoid';
import { getJobRecord, updateJobStatus } from '../store/jobStore.js';

const nodeEnv = typeof process !== 'undefined' ? process.env : {};
const HEARTBEAT_INTERVAL = parseInt(nodeEnv.DEVICE_HEARTBEAT_INTERVAL, 10) || 30000;
const DEVICE_TIMEOUT = parseInt(nodeEnv.DEVICE_TIMEOUT, 10) || 90000;
const JOB_ACK_TIMEOUT = parseInt(nodeEnv.JOB_ACK_TIMEOUT, 10) || 10000;

const deviceConnections = new Map();
const shopDevices = new Map();
const pendingJobAcks = new Map();

let wss = null;

export async function initializeWebSocketServer(port = nodeEnv.WS_PORT || 3001) {
  const { WebSocketServer } = await import('ws');
  wss = new WebSocketServer({ port });

  console.log(`WebSocket server listening on port ${port}`);

  wss.on('connection', handleConnection);

  setInterval(checkDeviceTimeouts, 30000);

  return wss;
}

function handleConnection(ws) {
  console.log('New WebSocket connection attempt');

  let deviceId = null;
  let shopCode = null;
  let isAuthenticated = false;
  let lastHeartbeat = Date.now();

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'device_register') {
        const result = await handleDeviceRegister(ws, message);
        if (result) {
          deviceId = result.deviceId;
          shopCode = result.shopCode;
          isAuthenticated = true;
          lastHeartbeat = Date.now();

          deviceConnections.set(deviceId, { ws, shopCode, lastHeartbeat, deviceId });

          if (!shopDevices.has(shopCode)) {
            shopDevices.set(shopCode, new Set());
          }
          shopDevices.get(shopCode).add(deviceId);

          console.log(`Device registered: ${deviceId} (Shop: ${shopCode})`);
        }
        return;
      }

      if (!isAuthenticated) {
        sendError(ws, 'Not authenticated', message.requestId);
        return;
      }

      lastHeartbeat = Date.now();
      if (deviceConnections.has(deviceId)) {
        deviceConnections.get(deviceId).lastHeartbeat = lastHeartbeat;
      }

      switch (message.type) {
        case 'heartbeat':
          await handleHeartbeat(ws, message, deviceId);
          break;
        case 'job_received':
          await handleJobReceived(message, deviceId, shopCode);
          break;
        case 'job_update':
          await handleJobUpdate(message, deviceId, shopCode);
          break;
        case 'printer_status_response':
          handlePrinterStatus(message, deviceId);
          break;
        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', () => {
    if (deviceId) {
      void handleDeviceDisconnect(deviceId, shopCode);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

async function handleDeviceRegister(ws, message) {
  const { deviceId, pcName, shopCode, deviceToken } = message.payload;

  if (!deviceId || !pcName || !shopCode) {
    sendError(ws, 'Missing required fields', message.requestId);
    return null;
  }

  const shop = await getShopByCode({}, shopCode);
  if (!shop) {
    sendError(ws, 'Invalid shop code', message.requestId);
    return null;
  }

  if (shop.subscription_status !== 'active') {
    sendError(ws, 'Shop subscription is not active', message.requestId);
    return null;
  }

  let token = deviceToken;
  let deviceRecord = null;

  if (token) {
    const verified = await verifyDeviceToken(token);
    if (verified && verified.deviceId === deviceId && verified.shopCode === shopCode) {
      deviceRecord = verified.device;
    }
  }

  if (!deviceRecord) {
    token = await generateDeviceToken(deviceId, shopCode);

    try {
      await createDevice({}, deviceId, shopCode, token, pcName);
    } catch {
      await updateDeviceStatus({}, 'online', deviceId);
    }
  } else {
    await updateDeviceStatus({}, 'online', deviceId);
  }

  sendMessage(ws, {
    type: 'device_register_ack',
    requestId: message.requestId,
    payload: {
      success: true,
      deviceId,
      deviceToken: token,
      heartbeatInterval: HEARTBEAT_INTERVAL,
    },
  });

  return { deviceId, shopCode };
}

async function handleHeartbeat(ws, message, deviceId) {
  await updateDeviceLastSeen({}, deviceId);

  sendMessage(ws, {
    type: 'heartbeat_ack',
    requestId: message.requestId,
    payload: { timestamp: Date.now() },
  });
}

async function handleJobReceived(message, deviceId, shopCode) {
  const { jobId } = message.payload;

  if (!jobId) return;

  console.log(`Job ${jobId} received by device ${deviceId}`);

  let matchedPendingAck = false;
  if (message.requestId && pendingJobAcks.has(message.requestId)) {
    const pending = pendingJobAcks.get(message.requestId);
    clearTimeout(pending.timeout);
    pending.resolve(true);
    pendingJobAcks.delete(message.requestId);
    matchedPendingAck = true;
  }

  if (matchedPendingAck) {
    updateJobStatus(jobId, 'queued');
  }
}

async function handleJobUpdate(message, deviceId, shopCode) {
  const { jobId, status, errorMessage } = message.payload;

  if (!jobId || !status) return;

  const job = getJobRecord(jobId);
  if (!job || job.shopCode !== shopCode) {
    console.warn(`Job ${jobId} does not belong to shop ${shopCode}`);
    return;
  }

  updateJobStatus(jobId, status, errorMessage);

  console.log(`Job ${jobId} status updated: ${status}`);
}

function handlePrinterStatus(message, deviceId) {
  const { printers } = message.payload;
  console.log(`Device ${deviceId} printers:`, printers);
}

export async function sendJobToDevice(deviceId, jobData) {
  const connection = deviceConnections.get(deviceId);

  if (!connection || connection.ws.readyState !== 1) {
    console.warn(`Device ${deviceId} is not connected`);
    return false;
  }

  const requestId = nanoid();

  sendMessage(connection.ws, {
    type: 'print_job',
    requestId,
    payload: jobData,
  });

  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingJobAcks.delete(requestId);
      resolve(false);
    }, JOB_ACK_TIMEOUT);

    pendingJobAcks.set(requestId, {
      resolve,
      timeout,
      jobId: jobData.jobId,
      deviceId,
    });
  });
}

function sendMessage(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws, error, requestId = null) {
  sendMessage(ws, {
    type: 'error',
    requestId,
    payload: { error },
  });
}

async function handleDeviceDisconnect(deviceId, shopCode) {
  console.log(`Device disconnected: ${deviceId}`);

  deviceConnections.delete(deviceId);

  if (shopCode && shopDevices.has(shopCode)) {
    shopDevices.get(shopCode).delete(deviceId);
  }

  await updateDeviceStatus({}, 'offline', deviceId);

  for (const [requestId, pending] of pendingJobAcks.entries()) {
    if (pending.deviceId === deviceId) {
      clearTimeout(pending.timeout);
      pending.resolve(false);
      pendingJobAcks.delete(requestId);
    }
  }
}

function checkDeviceTimeouts() {
  const now = Date.now();

  for (const [deviceId, connection] of deviceConnections.entries()) {
    if (now - connection.lastHeartbeat > DEVICE_TIMEOUT) {
      console.warn(`Device ${deviceId} timed out`);
      connection.ws.close();
      void handleDeviceDisconnect(deviceId, connection.shopCode);
    }
  }
}

export function getOnlineDevicesForShop(shopCode) {
  const devices = shopDevices.get(shopCode);
  if (!devices) return [];

  return Array.from(devices).map((deviceId) => {
    const connection = deviceConnections.get(deviceId);
    return {
      deviceId,
      isOnline: connection && connection.ws.readyState === 1,
    };
  });
}

export function broadcastToShop(shopCode, message) {
  const devices = shopDevices.get(shopCode);
  if (!devices) return 0;

  let sent = 0;
  for (const deviceId of devices) {
    const connection = deviceConnections.get(deviceId);
    if (connection && connection.ws.readyState === 1) {
      sendMessage(connection.ws, message);
      sent++;
    }
  }

  return sent;
}

export default {
  initializeWebSocketServer,
  sendJobToDevice,
  getOnlineDevicesForShop,
  broadcastToShop,
};
