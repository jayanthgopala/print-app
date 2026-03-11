import WebSocket from 'ws';
import { EventEmitter } from 'events';

const RECONNECT_INTERVAL = 5000;
const MAX_RECONNECT_INTERVAL = 60000;
const HEARTBEAT_INTERVAL = 30000;

export class DeviceClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.heartbeatInterval = null;
    this.messageHandlers = new Map();
  }

  connect() {
    if (this.ws) {
      this.ws.close();
    }

    console.log(`Connecting to ${this.config.serverUrl}...`);

    this.ws = new WebSocket(this.config.serverUrl);

    this.ws.on('open', () => {
      this.handleOpen();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', () => {
      this.handleClose();
    });

    this.ws.on('error', (error) => {
      this.handleError(error);
    });
  }

  handleOpen() {
    console.log('✅ WebSocket connection established');
    this.connected = true;
    this.reconnectAttempts = 0;

    // Send registration message
    this.register();

    // Start heartbeat
    this.startHeartbeat();

    this.emit('connected');
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'device_register_ack':
          this.handleRegistrationAck(message);
          break;

        case 'heartbeat_ack':
          // Heartbeat acknowledged
          break;

        case 'print_job':
          this.handlePrintJob(message);
          break;

        case 'error':
          console.error('Server error:', message.payload.error);
          this.emit('error', new Error(message.payload.error));
          break;

        default:
          console.warn('Unknown message type:', message.type);
      }

      // Call registered message handlers
      if (this.messageHandlers.has(message.type)) {
        this.messageHandlers.get(message.type)(message);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  handleClose() {
    console.log('⚠️  WebSocket connection closed');
    this.connected = false;
    this.stopHeartbeat();
    this.emit('disconnected');

    // Attempt to reconnect with exponential backoff
    this.scheduleReconnect();
  }

  handleError(error) {
    console.error('WebSocket error:', error);
    this.emit('error', error);
  }

  register() {
    this.sendMessage({
      type: 'device_register',
      payload: {
        deviceId: this.config.deviceId,
        pcName: this.config.pcName,
        shopCode: this.config.shopCode,
        deviceToken: this.config.deviceToken,
      },
    });
  }

  handleRegistrationAck(message) {
    const { success, deviceToken, heartbeatInterval } = message.payload;

    if (success) {
      console.log('✅ Device registered successfully');
      
      if (deviceToken) {
        this.config.deviceToken = deviceToken;
      }

      this.emit('registered', message.payload);
    } else {
      console.error('❌ Registration failed');
      this.emit('error', new Error('Registration failed'));
    }
  }

  handlePrintJob(message) {
    const job = message.payload;
    console.log('📄 Received print job:', job.jobId);

    // Send acknowledgment
    this.sendMessage({
      type: 'job_received',
      requestId: message.requestId,
      payload: {
        jobId: job.jobId,
      },
    });

    // Emit print job event
    this.emit('print-job', job);
  }

  sendJobUpdate(jobId, status, errorMessage = null) {
    this.sendMessage({
      type: 'job_update',
      payload: {
        jobId,
        status,
        errorMessage,
      },
    });
  }

  sendMessage(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message: WebSocket not connected');
      return false;
    }

    const fullMessage = {
      ...message,
      requestId: message.requestId || this.generateRequestId(),
      shopCode: this.config.shopCode,
      deviceId: this.config.deviceId,
    };

    this.ws.send(JSON.stringify(fullMessage));
    return true;
  }

  startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      this.sendMessage({
        type: 'heartbeat',
        payload: {
          timestamp: Date.now(),
        },
      });
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Exponential backoff with jitter
    const backoff = Math.min(
      RECONNECT_INTERVAL * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_INTERVAL
    );
    const jitter = Math.random() * 1000;
    const delay = backoff + jitter;

    console.log(`Reconnecting in ${Math.round(delay / 1000)}s...`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  reconnect() {
    console.log('Manual reconnect requested');
    this.reconnectAttempts = 0;
    this.connect();
  }

  disconnect() {
    console.log('Disconnecting...');
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default DeviceClient;
