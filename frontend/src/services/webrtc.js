import { ICE_SERVERS } from '../config';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;
const MAX_BUFFERED_AMOUNT = CHUNK_SIZE * 8;
const CONNECTION_TIMEOUT_MS = 120000;
const ICE_GATHERING_TIMEOUT_MS = 20000; // 20 seconds to gather ICE candidates
const DISCONNECT_GRACE_PERIOD_MS = 15000;
const ALLOWED_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
]);

export class FileTransferClient {
    constructor(shopId, signalingUrl, onStatusChange, onProgress) {
        this.shopId = shopId;
        this.signalingUrl = signalingUrl;
        this.onStatusChange = onStatusChange;
        this.onProgress = onProgress;
        this.ws = null;
        this.clientId = crypto.randomUUID();
        this.pendingTransfers = new Map();
    }

    clearTransferTimers(transfer) {
        if (transfer.connectionTimeout) {
            clearTimeout(transfer.connectionTimeout);
            transfer.connectionTimeout = null;
        }
        if (transfer.iceTimeout) {
            clearTimeout(transfer.iceTimeout);
            transfer.iceTimeout = null;
        }
        if (transfer.disconnectTimeout) {
            clearTimeout(transfer.disconnectTimeout);
            transfer.disconnectTimeout = null;
        }
    }

    scheduleDisconnectFailure(transferId, transfer, reason) {
        if (transfer.acknowledged || transfer.disconnectTimeout) {
            return;
        }

        transfer.disconnectTimeout = setTimeout(() => {
            if (!transfer.acknowledged) {
                transfer.disconnectTimeout = null;
                transfer.rejectOnce(new Error(reason));
            }
        }, DISCONNECT_GRACE_PERIOD_MS);
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.checkShopStatus();
            return;
        }

        this.ws = new WebSocket(this.signalingUrl);

        this.ws.onopen = () => {
            setTimeout(() => this.checkShopStatus(), 300);
        };

        this.ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            await this.handleMessage(data);
        };

        this.ws.onerror = () => this.onStatusChange('ERROR');
        this.ws.onclose = () => this.onStatusChange('OFFLINE');
    }

    checkShopStatus() {
        if (!this.isSocketOpen()) return;
        this.ws.send(JSON.stringify({
            type: 'CHECK_STATUS',
            shopId: this.shopId,
            senderId: this.clientId
        }));
    }

    async startFileTransfer(file, metadata = {}) {
        if (!this.isSocketOpen()) {
            throw new Error('Signaling server is not connected');
        }
        this.validateFile(file);

        const transferId = crypto.randomUUID();
        const peer = new RTCPeerConnection({
            iceServers: ICE_SERVERS,
            iceCandidatePoolSize: 10
        });
        const channel = peer.createDataChannel('printshop-transfer', {
            ordered: true
        });

        return new Promise(async (resolve, reject) => {
            const transfer = {
                file,
                metadata,
                peer,
                channel,
                resolve,
                reject,
                acknowledged: false,
                connectionTimeout: null,
                iceTimeout: null,
                disconnectTimeout: null,
                settled: false
            };
            this.pendingTransfers.set(transferId, transfer);

            transfer.rejectOnce = (error) => {
                if (transfer.settled) return;
                transfer.settled = true;
                const err = error instanceof Error ? error : new Error(String(error));
                this.clearTransferTimers(transfer);
                this.cleanupTransfer(transferId);
                reject(err);
            };

            transfer.resolveOnce = () => {
                if (transfer.settled) return;
                transfer.settled = true;
                this.clearTransferTimers(transfer);
                this.cleanupTransfer(transferId);
                resolve();
            };

            // Connection timeout for slow networks
            transfer.connectionTimeout = setTimeout(() => {
                if (!transfer.acknowledged && channel.readyState !== 'open') {
                    transfer.rejectOnce(new Error('Connection timeout. Please check your internet connection and try again.'));
                }
            }, CONNECTION_TIMEOUT_MS);

            // ICE gathering timeout
            transfer.iceTimeout = setTimeout(() => {
                if (peer.iceGatheringState !== 'complete') {
                    console.warn('ICE gathering taking longer than expected on slow connection');
                }
            }, ICE_GATHERING_TIMEOUT_MS);

            peer.onicecandidate = (event) => {
                if (!event.candidate || !this.isSocketOpen()) return;
                this.ws.send(JSON.stringify({
                    type: 'ICE_CANDIDATE',
                    shopId: this.shopId,
                    senderId: this.clientId,
                    transferId,
                    candidate: event.candidate
                }));
            };

            peer.onicegatheringstatechange = () => {
                console.log(`ICE gathering state: ${peer.iceGatheringState}`);
                if (peer.iceGatheringState === 'complete' && transfer.iceTimeout) {
                    clearTimeout(transfer.iceTimeout);
                }
            };

            peer.oniceconnectionstatechange = () => {
                console.log(`ICE connection state: ${peer.iceConnectionState}`);
                // Only fail if truly failed, not just disconnected (which can recover)
                if (peer.iceConnectionState === 'failed' && !transfer.acknowledged) {
                    transfer.rejectOnce(new Error('Direct connection failed. If you are on mobile data or a restricted network, TURN server support is required.'));
                } else if (peer.iceConnectionState === 'disconnected') {
                    this.scheduleDisconnectFailure(transferId, transfer, 'Connection was interrupted for too long. Please retry the transfer.');
                } else if (['connected', 'completed'].includes(peer.iceConnectionState) && transfer.disconnectTimeout) {
                    clearTimeout(transfer.disconnectTimeout);
                    transfer.disconnectTimeout = null;
                }
            };

            peer.onconnectionstatechange = () => {
                console.log(`Peer connection state: ${peer.connectionState}`);
                if (peer.connectionState === 'failed' && !transfer.acknowledged) {
                    transfer.rejectOnce(new Error('Direct connection failed. If you are on mobile data or a restricted network, TURN server support is required.'));
                } else if (peer.connectionState === 'disconnected') {
                    this.scheduleDisconnectFailure(transferId, transfer, 'Connection was interrupted for too long. Please retry the transfer.');
                } else if (['connected', 'completed'].includes(peer.connectionState)) {
                    if (transfer.disconnectTimeout) {
                        clearTimeout(transfer.disconnectTimeout);
                        transfer.disconnectTimeout = null;
                    }
                    console.log('Peer connected successfully');
                } else if (peer.connectionState === 'closed' && !transfer.acknowledged) {
                    transfer.rejectOnce(new Error('Connection closed before the transfer completed.'));
                }
            };

            channel.binaryType = 'arraybuffer';
            channel.onopen = async () => {
                console.log('Data channel opened');
                if (transfer.connectionTimeout) clearTimeout(transfer.connectionTimeout);
                try {
                    await this.sendFileOverChannel(channel, file, {
                        ...metadata,
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: file.type || 'application/octet-stream'
                    });
                } catch (error) {
                    transfer.rejectOnce(error);
                }
            };

            channel.onmessage = (event) => {
                if (typeof event.data !== 'string') return;
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'FILE_RECEIVED') {
                        transfer.acknowledged = true;
                        this.onProgress(100);
                        this.onStatusChange('COMPLETED');
                        transfer.resolveOnce();
                    } else if (message.type === 'TRANSFER_ERROR') {
                        transfer.rejectOnce(new Error(message.reason || 'Transfer failed'));
                    }
                } catch (error) {
                    transfer.rejectOnce(error);
                }
            };

            channel.onerror = () => transfer.rejectOnce(new Error('Data channel error'));
            channel.onclose = () => {
                if (!transfer.acknowledged && !transfer.settled) {
                    this.scheduleDisconnectFailure(transferId, transfer, 'Data channel closed before the transfer completed.');
                }
            };

            try {
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);

                this.ws.send(JSON.stringify({
                    type: 'WEBRTC_OFFER',
                    shopId: this.shopId,
                    senderId: this.clientId,
                    transferId,
                    metadata: {
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: file.type || 'application/octet-stream',
                        customerName: metadata.customerName || 'Unknown',
                        colorPages: metadata.colorPages || '',
                        bwPages: metadata.bwPages || '',
                        paperSize: metadata.paperSize || 'A4',
                        orientation: metadata.orientation || 'portrait',
                        copies: Number(metadata.copies || 1),
                        duplex: metadata.duplex || 'simplex',
                        scale: metadata.scale || 'fit',
                        fileIndex: metadata.fileIndex || 1,
                        totalFiles: metadata.totalFiles || 1,
                        printType: metadata.printType || ''
                    },
                    offer: peer.localDescription
                }));

                this.onStatusChange('CONNECTING');
            } catch (error) {
                transfer.rejectOnce(error);
            }
        });
    }

    async handleMessage(data) {
        if (data.type === 'STATUS_RESPONSE') {
            this.onStatusChange(data.status);
            return;
        }

        if (data.type === 'WEBRTC_ANSWER') {
            const transfer = this.pendingTransfers.get(data.transferId);
            if (transfer) {
                await transfer.peer.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
            return;
        }

        if (data.type === 'ICE_CANDIDATE') {
            const transfer = this.pendingTransfers.get(data.transferId);
            if (transfer && data.candidate) {
                await transfer.peer.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
            return;
        }

        if (data.type === 'TRANSFER_STATE') {
            if (data.state === 'RECEIVING') {
                this.onStatusChange('TRANSFERRING');
            } else if (data.state === 'FAILED') {
                const transfer = this.pendingTransfers.get(data.transferId);
                if (transfer) {
                    transfer.rejectOnce(new Error(data.details || 'Transfer failed'));
                }
            }
            return;
        }

        if (data.type === 'TRANSFER_ERROR') {
            const transfer = this.pendingTransfers.get(data.transferId);
            if (transfer) {
                transfer.rejectOnce(new Error(data.reason || 'Transfer setup failed'));
            }
            this.onStatusChange('ERROR');
        }
    }

    async sendFileOverChannel(channel, file, metadata) {
        channel.send(JSON.stringify({ type: 'FILE_METADATA', metadata }));
        channel.bufferedAmountLowThreshold = CHUNK_SIZE * 2;

        let offset = 0;
        const totalSize = file.size;
        const startTime = Date.now();

        while (offset < totalSize) {
            while (channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                await new Promise((resolve) => {
                    const resumeSend = () => {
                        channel.removeEventListener('bufferedamountlow', resumeSend);
                        resolve();
                    };

                    channel.addEventListener('bufferedamountlow', resumeSend, { once: true });
                    if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
                        channel.removeEventListener('bufferedamountlow', resumeSend);
                        resolve();
                    }
                });
            }

            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await slice.arrayBuffer();

            try {
                channel.send(buffer);
                offset += buffer.byteLength;

                // Update progress
                const progress = (offset / totalSize) * 100;
                this.onProgress(progress);

                // Log transfer speed every 5MB
                if (offset % (5 * 1024 * 1024) < CHUNK_SIZE) {
                    const elapsedSec = (Date.now() - startTime) / 1000;
                    const speedMBps = (offset / (1024 * 1024)) / elapsedSec;
                    console.log(`Transfer: ${Math.round(progress)}%, Speed: ${speedMBps.toFixed(2)} MB/s`);
                }
            } catch (error) {
                throw new Error(`Failed to send chunk at offset ${offset}: ${error.message}`);
            }
        }

        channel.send(JSON.stringify({ type: 'FILE_COMPLETE' }));
        console.log(`Transfer complete: ${(totalSize / (1024 * 1024)).toFixed(2)} MB in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    }

    validateFile(file) {
        if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
            throw new Error('File size must be between 1 byte and 100 MB');
        }
        if (!ALLOWED_TYPES.has(file.type)) {
            throw new Error('Unsupported file type');
        }
    }

    cleanupTransfer(transferId) {
        const transfer = this.pendingTransfers.get(transferId);
        if (!transfer) return;

        this.clearTransferTimers(transfer);

        try {
            transfer.channel?.close();
        } catch (error) {}
        try {
            transfer.peer?.close();
        } catch (error) {}
        this.pendingTransfers.delete(transferId);
    }

    isSocketOpen() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}
