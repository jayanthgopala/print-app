const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' }
];

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;
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
        const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
        const channel = peer.createDataChannel('printshop-transfer', { ordered: true });

        return new Promise(async (resolve, reject) => {
            const transfer = {
                file,
                metadata,
                peer,
                channel,
                resolve,
                reject,
                acknowledged: false
            };
            this.pendingTransfers.set(transferId, transfer);

            const failTransfer = (error) => {
                const err = error instanceof Error ? error : new Error(String(error));
                this.cleanupTransfer(transferId);
                reject(err);
            };

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

            peer.onconnectionstatechange = () => {
                if (['failed', 'closed', 'disconnected'].includes(peer.connectionState) && !transfer.acknowledged) {
                    failTransfer(new Error(`Peer connection ${peer.connectionState}`));
                }
            };

            channel.binaryType = 'arraybuffer';
            channel.onopen = async () => {
                try {
                    await this.sendFileOverChannel(channel, file, {
                        ...metadata,
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: file.type || 'application/octet-stream'
                    });
                } catch (error) {
                    failTransfer(error);
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
                        this.cleanupTransfer(transferId);
                        resolve();
                    } else if (message.type === 'TRANSFER_ERROR') {
                        failTransfer(new Error(message.reason || 'Transfer failed'));
                    }
                } catch (error) {
                    failTransfer(error);
                }
            };

            channel.onerror = () => failTransfer(new Error('Data channel error'));

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
                failTransfer(error);
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
                    transfer.reject(new Error(data.details || 'Transfer failed'));
                    this.cleanupTransfer(data.transferId);
                }
            }
            return;
        }

        if (data.type === 'TRANSFER_ERROR') {
            const transfer = this.pendingTransfers.get(data.transferId);
            if (transfer) {
                transfer.reject(new Error(data.reason || 'Transfer setup failed'));
                this.cleanupTransfer(data.transferId);
            }
            this.onStatusChange('ERROR');
        }
    }

    async sendFileOverChannel(channel, file, metadata) {
        channel.send(JSON.stringify({ type: 'FILE_METADATA', metadata }));

        let offset = 0;
        while (offset < file.size) {
            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await slice.arrayBuffer();
            channel.send(buffer);
            offset += buffer.byteLength;
            this.onProgress((offset / file.size) * 100);

            if (channel.bufferedAmount > CHUNK_SIZE * 16) {
                await new Promise((resolve) => {
                    const check = () => {
                        if (channel.bufferedAmount <= CHUNK_SIZE * 2) {
                            resolve();
                        } else {
                            setTimeout(check, 20);
                        }
                    };
                    check();
                });
            }
        }

        channel.send(JSON.stringify({ type: 'FILE_COMPLETE' }));
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
