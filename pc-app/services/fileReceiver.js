const WebSocket = require('ws');
const wrtc = require('wrtc');
const fs = require('fs');
const path = require('path');

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']);
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];
const CONNECTION_TIMEOUT_MS = 120000;
const DISCONNECT_GRACE_PERIOD_MS = 15000;

class ShopReceiver {
    constructor(shopId, token, signalingUrl, downloadPath, onFileReceived) {
        this.shopId = shopId;
        this.token = token;
        this.signalingUrl = signalingUrl;
        this.downloadPath = downloadPath;
        this.onFileReceived = onFileReceived;
        this.ws = null;
        this.shouldReconnect = true;
        this.transfers = new Map();
    }

    clearTransferTimers(transfer) {
        if (transfer.connectionTimeout) {
            clearTimeout(transfer.connectionTimeout);
            transfer.connectionTimeout = null;
        }
        if (transfer.disconnectTimeout) {
            clearTimeout(transfer.disconnectTimeout);
            transfer.disconnectTimeout = null;
        }
    }

    scheduleDisconnectFailure(transferId, transfer, reason) {
        if (transfer.completed || transfer.disconnectTimeout) {
            return;
        }

        transfer.disconnectTimeout = setTimeout(() => {
            transfer.disconnectTimeout = null;
            if (!transfer.completed) {
                this.failTransfer(transferId, reason);
            }
        }, DISCONNECT_GRACE_PERIOD_MS);
    }

    log(...args) {
        console.log('[ShopReceiver]', ...args);
    }

    disconnect() {
        this.shouldReconnect = false;
        for (const transferId of this.transfers.keys()) {
            this.cleanupTransfer(transferId);
        }
        if (this.ws) {
            try { this.ws.close(); } catch (error) {}
            this.ws = null;
        }
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        this.shouldReconnect = true;
        this.ws = new WebSocket(this.signalingUrl);

        this.ws.on('open', () => {
            this.log('Connected to signaling');
            this.ws.send(JSON.stringify({ type: 'REGISTER_SHOP', token: this.token }));
        });

        this.ws.on('message', async (rawData) => {
            try {
                const message = JSON.parse(rawData.toString());
                if (message.type === 'REGISTER_SUCCESS') {
                    this.log('Shop registered');
                } else if (message.type === 'WEBRTC_OFFER') {
                    await this.handleOffer(message);
                } else if (message.type === 'ICE_CANDIDATE') {
                    await this.handleRemoteIce(message);
                }
            } catch (error) {
                this.log('Parse error:', error);
            }
        });

        this.ws.on('error', (err) => this.log('WS error:', err));

        this.ws.on('close', () => {
            this.log('WS closed');
            for (const transferId of this.transfers.keys()) {
                this.cleanupTransfer(transferId);
            }
            if (this.shouldReconnect) {
                setTimeout(() => this.connect(), 3000);
            }
        });
    }

    async handleOffer(message) {
        const { transferId, clientId, offer, metadata } = message;
        try {
            this.validateMetadata(metadata);

            const peer = new wrtc.RTCPeerConnection({
                iceServers: ICE_SERVERS,
                iceCandidatePoolSize: 10
            });
            const transfer = {
                peer,
                channel: null,
                clientId,
                transferId,
                metadata: null,
                chunks: [],
                bytesReceived: 0,
                completed: false,
                cleanedUp: false,
                connectionTimeout: null,
                disconnectTimeout: null
            };
            this.transfers.set(transferId, transfer);

            // Connection timeout for slow networks
            transfer.connectionTimeout = setTimeout(() => {
                if (!transfer.completed && (!transfer.channel || transfer.channel.readyState !== 'open')) {
                    this.log('Connection timeout on slow network');
                    this.failTransfer(transferId, 'Connection timeout. Please retry.');
                }
            }, CONNECTION_TIMEOUT_MS);

            peer.onicecandidate = (event) => {
                if (!event.candidate || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
                this.ws.send(JSON.stringify({
                    type: 'ICE_CANDIDATE',
                    transferId,
                    candidate: event.candidate
                }));
            };

            peer.onicegatheringstatechange = () => {
                this.log(`ICE gathering state: ${peer.iceGatheringState}`);
            };

            peer.oniceconnectionstatechange = () => {
                this.log(`ICE connection state: ${peer.iceConnectionState}`);
                // Only fail on permanent failure, not temporary disconnections
                if (peer.iceConnectionState === 'failed' && !transfer.completed) {
                    this.failTransfer(transferId, 'Connection failed');
                } else if (peer.iceConnectionState === 'disconnected') {
                    this.scheduleDisconnectFailure(transferId, transfer, 'Connection interrupted for too long');
                } else if (['connected', 'completed'].includes(peer.iceConnectionState) && transfer.disconnectTimeout) {
                    clearTimeout(transfer.disconnectTimeout);
                    transfer.disconnectTimeout = null;
                }
            };

            peer.onconnectionstatechange = () => {
                this.log(`Peer connection state: ${peer.connectionState}`);
                if (transfer.completed) return;
                if (peer.connectionState === 'failed') {
                    this.failTransfer(transferId, `Peer connection failed`);
                } else if (peer.connectionState === 'disconnected') {
                    this.scheduleDisconnectFailure(transferId, transfer, 'Connection interrupted for too long');
                } else if (['connected', 'completed'].includes(peer.connectionState) && transfer.disconnectTimeout) {
                    clearTimeout(transfer.disconnectTimeout);
                    transfer.disconnectTimeout = null;
                } else if (peer.connectionState === 'connected') {
                    this.log('Peer connected successfully');
                }
            };

            peer.ondatachannel = (event) => {
                transfer.channel = event.channel;
                this.log('Data channel received');

                // Clear timeout when channel opens
                transfer.channel.onopen = () => {
                    this.log('Data channel opened');
                    if (transfer.connectionTimeout) {
                        clearTimeout(transfer.connectionTimeout);
                        transfer.connectionTimeout = null;
                    }
                };

                transfer.channel.onmessage = (msg) => this.handleChannelMessage(transferId, msg.data);
                transfer.channel.onerror = () => this.failTransfer(transferId, 'Data channel error');
                transfer.channel.onclose = () => {
                    if (!transfer.completed) {
                        this.scheduleDisconnectFailure(transferId, transfer, 'Data channel closed before transfer completed');
                    }
                };
            };

            await peer.setRemoteDescription(new wrtc.RTCSessionDescription(offer));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);

            this.ws.send(JSON.stringify({
                type: 'WEBRTC_ANSWER',
                transferId,
                answer: peer.localDescription
            }));
        } catch (error) {
            this.log('Offer handling failed:', error);
            this.failTransfer(transferId, error.message || 'Offer handling failed');
        }
    }

    async handleRemoteIce(message) {
        const transfer = this.transfers.get(message.transferId);
        if (!transfer || !message.candidate) return;

        try {
            await transfer.peer.addIceCandidate(new wrtc.RTCIceCandidate(message.candidate));
        } catch (error) {
            this.log('ICE add failed:', error);
            this.failTransfer(message.transferId, 'ICE candidate rejected');
        }
    }

    handleChannelMessage(transferId, data) {
        const transfer = this.transfers.get(transferId);
        if (!transfer) return;

        if (typeof data === 'string') {
            const message = JSON.parse(data);
            if (message.type === 'FILE_METADATA') {
                this.validateMetadata(message.metadata);
                transfer.metadata = message.metadata;
                this.notifyTransferState(transferId, 'RECEIVING');
                return;
            }

            if (message.type === 'FILE_COMPLETE') {
                this.finalizeTransfer(transferId);
            }
            return;
        }

        const chunk = Buffer.from(data);
        transfer.bytesReceived += chunk.length;

        if (transfer.bytesReceived > MAX_FILE_SIZE_BYTES) {
            this.failTransfer(transferId, 'File too large');
            return;
        }

        transfer.chunks.push(chunk);
    }

    finalizeTransfer(transferId) {
        const transfer = this.transfers.get(transferId);
        if (!transfer || !transfer.metadata) {
            this.failTransfer(transferId, 'Missing file metadata');
            return;
        }

        try {
            if (transfer.bytesReceived !== Number(transfer.metadata.fileSize)) {
                throw new Error('Incomplete file received');
            }

            const buffer = Buffer.concat(transfer.chunks);
            const filePath = this.saveFile(transfer.metadata.fileName, buffer);

            if (this.onFileReceived) {
                this.onFileReceived({
                    customerName: transfer.metadata.customerName || 'Unknown',
                    fileName: transfer.metadata.fileName,
                    filePath,
                    colorPages: transfer.metadata.colorPages || '',
                    bwPages: transfer.metadata.bwPages || '',
                    fileIndex: transfer.metadata.fileIndex || 1,
                    totalFiles: transfer.metadata.totalFiles || 1
                });
            }

            transfer.completed = true;

            // Clear timeout on successful completion
            this.clearTransferTimers(transfer);

            this.log('Transfer completed:', { transferId, filePath, bytesReceived: transfer.bytesReceived });

            if (transfer.channel && transfer.channel.readyState === 'open') {
                transfer.channel.send(JSON.stringify({ type: 'FILE_RECEIVED' }));
            }

            this.notifyTransferState(transferId, 'COMPLETED');
            // Let the remote peer react to FILE_RECEIVED before tearing down native WebRTC objects.
            setTimeout(() => this.cleanupTransfer(transferId), 2000);
        } catch (error) {
            this.log('Finalize transfer failed:', error);
            this.failTransfer(transferId, error.message || 'Save failed');
        }
    }

    validateMetadata(metadata = {}) {
        const fileName = path.basename(metadata.fileName || '').trim();
        const ext = path.extname(fileName).toLowerCase();
        const fileSize = Number(metadata.fileSize || 0);

        if (!fileName || !ALLOWED_EXTENSIONS.has(ext)) {
            throw new Error('Unsupported file type');
        }
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
            throw new Error('Invalid file size');
        }
    }

    saveFile(filename, buffer) {
        const originalName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const dir = this.downloadPath || path.join(process.cwd(), 'downloads');
        const parsed = path.parse(originalName);
        let candidate = path.join(dir, originalName);
        let counter = 1;

        fs.mkdirSync(dir, { recursive: true });
        while (fs.existsSync(candidate)) {
            candidate = path.join(dir, `${parsed.name}_${counter}${parsed.ext}`);
            counter += 1;
        }

        fs.writeFileSync(candidate, buffer);
        this.log(`Saved to: ${candidate}`);
        return path.normalize(candidate);
    }

    notifyTransferState(transferId, state, details = null) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'TRANSFER_STATE', transferId, state, details }));
    }

    failTransfer(transferId, reason) {
        const transfer = this.transfers.get(transferId);
        if (!transfer || transfer.completed) {
            this.cleanupTransfer(transferId);
            return;
        }

        // Clear timeout
        this.clearTransferTimers(transfer);

        if (transfer && transfer.channel && transfer.channel.readyState === 'open') {
            try {
                transfer.channel.send(JSON.stringify({ type: 'TRANSFER_ERROR', reason }));
            } catch (error) {}
        }
        this.notifyTransferState(transferId, 'FAILED', reason);
        this.cleanupTransfer(transferId);
    }

    cleanupTransfer(transferId) {
        const transfer = this.transfers.get(transferId);
        if (!transfer) return;
        if (transfer.cleanedUp) return;
        transfer.cleanedUp = true;

        // Clear timeout
        this.clearTransferTimers(transfer);

        const finish = () => {
            this.transfers.delete(transferId);
        };

        setTimeout(() => {
            try {
                if (transfer.channel) {
                    transfer.channel.onmessage = null;
                    transfer.channel.onerror = null;
                    transfer.channel.onclose = null;
                    transfer.channel.onopen = null;
                    if (!transfer.completed && transfer.channel.readyState !== 'closed') {
                        transfer.channel.close();
                    }
                }
            } catch (error) {
                this.log('Channel cleanup failed:', error);
            }

            try {
                if (transfer.peer) {
                    transfer.peer.onicecandidate = null;
                    transfer.peer.onconnectionstatechange = null;
                    transfer.peer.ondatachannel = null;
                    transfer.peer.onicegatheringstatechange = null;
                    transfer.peer.oniceconnectionstatechange = null;
                    if (!transfer.completed && transfer.peer.signalingState !== 'closed') {
                        transfer.peer.close();
                    }
                }
            } catch (error) {
                this.log('Peer cleanup failed:', error);
            }

            finish();
        }, transfer.completed ? 3000 : 0);
    }
}

module.exports = ShopReceiver;
