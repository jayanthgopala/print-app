import React, { useEffect, useRef, useState } from 'react';
import { API_URL } from './config';
import './App.css';

const SHARED_FILES_DB = 'printshop-share-target';
const SHARED_FILES_STORE = 'pending-files';
const DEFAULT_PRINT_SETTINGS = {
    colorPages: '',
    bwPages: '',
    imageMode: 'color',
    pageMode: 'custom',
    paperSize: 'A4',
    orientation: 'portrait',
    copies: 1,
    duplex: 'simplex',
    scale: 'fit'
};

export default function App() {
    const transferClientRef = useRef(null);
    const [shopId, setShopId] = useState('');
    const [connectedShopId, setConnectedShopId] = useState('');
    const [status, setStatus] = useState('DISCONNECTED');
    const [customerName, setCustomerName] = useState('');
    const [files, setFiles] = useState([]);
    const [progress, setProgress] = useState(0);
    const [currentFile, setCurrentFile] = useState(0);
    const [pricing, setPricing] = useState(null);
    const [installPrompt, setInstallPrompt] = useState(null);
    const [showInstallBanner, setShowInstallBanner] = useState(false);
    const [showQRScanner, setShowQRScanner] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [infoMessage, setInfoMessage] = useState('');
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isDragActive, setIsDragActive] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('shop');
        const shared = params.get('shared');

        if (id) setShopId(id);

        if (shared === 'true' || window.location.pathname === '/share') {
            handleSharedFiles();
        }

        const onBeforeInstallPrompt = (e) => {
            e.preventDefault();
            setInstallPrompt(e);
            setShowInstallBanner(true);
        };
        const onServiceWorkerMessage = (event) => {
            if (event.data?.type === 'SHARED_FILES_READY') {
                handleSharedFiles();
            }
        };

        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
            navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
            transferClientRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!connectedShopId || !API_URL) {
            return undefined;
        }

        const interval = window.setInterval(() => {
            void fetchShopStatus(connectedShopId, { silent: true });
        }, 15000);

        return () => window.clearInterval(interval);
    }, [connectedShopId]);

    const handleSharedFiles = async () => {
        const params = new URLSearchParams(window.location.search);
        const sharedText = params.get('text');
        const sharedTitle = params.get('title');
        const sharedUrl = params.get('url');

        if (sharedTitle || sharedText || sharedUrl) {
            setStatus('SHARED_MODE');
            if (sharedText) setCustomerName(sharedText.substring(0, 50));
        }

        try {
            const sharedFiles = await takePendingSharedFiles();
            if (sharedFiles.length > 0) {
                const preparedFiles = prepareIncomingFiles(sharedFiles);
                if (preparedFiles.validFiles.length > 0) {
                    setFiles((current) => [...current, ...preparedFiles.validFiles]);
                    setInfoMessage(`Loaded ${preparedFiles.validFiles.length} shared file${preparedFiles.validFiles.length > 1 ? 's' : ''}.`);
                    setErrorMessage(preparedFiles.invalidFiles.join(' | '));
                    setStatus('SHARED_MODE');
                } else if (preparedFiles.invalidFiles.length > 0) {
                    setErrorMessage(preparedFiles.invalidFiles.join(' | '));
                }
            }
        } catch {
            setErrorMessage('Shared files could not be loaded on this device.');
        }

        const url = new URL(window.location.href);
        const shopParam = url.searchParams.get('shop') || '';
        window.history.replaceState({}, '', `/?shop=${shopParam}&shared=true`);
    };

    const handleInstall = async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') {
            setShowInstallBanner(false);
        }
        setInstallPrompt(null);
    };

    const fetchShopStatus = async (inputShopId, options = {}) => {
        const normalizedShopId = normalizeShopCode(inputShopId);
        if (!normalizedShopId) {
            setErrorMessage('Enter a valid shop code before connecting.');
            return false;
        }

        if (!API_URL) {
            setErrorMessage('Frontend API is not configured.');
            return false;
        }

        if (!options.silent) {
            setErrorMessage('');
            setInfoMessage('Checking shop status...');
            setIsConnecting(true);
            setPricing(null);
        }
        setShopId(normalizedShopId);

        try {
            const response = await fetch(`${API_URL}/shop/public/${encodeURIComponent(normalizedShopId)}`);
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                setConnectedShopId('');
                transferClientRef.current = null;
                setStatus('DISCONNECTED');
                setInfoMessage('');
                setErrorMessage(data.error || 'Shop details could not be loaded.');
                return false;
            }

            if (!data.shop) {
                setConnectedShopId('');
                transferClientRef.current = null;
                setStatus('DISCONNECTED');
                setInfoMessage('');
                setErrorMessage('Shop details could not be loaded.');
                return false;
            }

            setConnectedShopId(normalizedShopId);
            setPricing(data.shop);
            transferClientRef.current = {
                shopId: normalizedShopId,
                uploadEndpoint: data.shop.pcEndpoint || null
            };

            if (data.shop.status === 'online' && data.shop.pcEndpoint) {
                setStatus('ONLINE');
                setErrorMessage('');
                setInfoMessage('Shop is online. You can upload files now.');
            } else {
                setStatus('OFFLINE');
                setInfoMessage('');
                if (!options.silent || status !== 'OFFLINE') {
                    setErrorMessage('Shop is offline or upload endpoint is not configured right now.');
                }
            }

            return true;
        } catch {
            if (!options.silent) {
                setErrorMessage('Could not load shop pricing.');
            }
            return false;
        } finally {
            if (!options.silent) {
                setIsConnecting(false);
            }
        }
    };

    const handleConnect = () => {
        void fetchShopStatus(shopId);
    };

    const appendFiles = (selectedFiles) => {
        const { validFiles, invalidFiles } = prepareIncomingFiles(selectedFiles);

        setErrorMessage(invalidFiles.join(' | '));
        if (validFiles.length > 0) {
            setFiles((current) => [...current, ...validFiles]);
            setInfoMessage(`Added ${validFiles.length} file${validFiles.length > 1 ? 's' : ''}.`);
        }
    };

    const handleFileSelect = (e) => {
        appendFiles(Array.from(e.target.files || []));
        e.target.value = '';
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragActive(false);
        appendFiles(Array.from(e.dataTransfer.files || []));
    };

    const updateFilePages = (index, field, value) => {
        const updated = [...files];
        updated[index][field] = value;
        setFiles(updated);
    };

    const updateFileOption = (index, field, value) => {
        const updated = [...files];
        updated[index][field] = value;
        setFiles(updated);
    };

    const deleteFile = (index) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const handleSend = async () => {
        if (!transferClientRef.current) {
            setErrorMessage('Connect to a shop before sending files.');
            return;
        }

        const validationError = validateSubmission({
            customerName,
            files
        });
        if (validationError) {
            setErrorMessage(validationError);
            return;
        }

        setCurrentFile(0);
        setStatus('CONNECTING');
        setErrorMessage('');
        setInfoMessage('Preparing files for transfer...');
        setIsSending(true);
        setProgress(0);

        try {
            const uploadTarget = transferClientRef.current?.uploadEndpoint;
            if (!uploadTarget) {
                throw new Error('Shop upload endpoint is not available. Ask the shop to start the PC app and tunnel.');
            }

            const healthResponse = await fetch(`${String(uploadTarget).replace(/\/$/, '')}/health`, {
                method: 'GET',
                headers: { Accept: 'application/json' }
            });
            if (!healthResponse.ok) {
                throw new Error('Shop upload server is not reachable right now. Wait a moment and try again.');
            }

            const tokenResponse = await fetch(`${API_URL}/auth/client-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shopCode: transferClientRef.current.shopId })
            });

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                throw new Error(errorText || 'Could not create upload token');
            }

            const tokenPayload = await tokenResponse.json();
            const uploadToken = tokenPayload.token;

            for (let i = 0; i < files.length; i++) {
                setCurrentFile(i + 1);
                setStatus('TRANSFERRING');
                const item = files[i];
                const metadata = {
                    customerName,
                    fileIndex: i + 1,
                    totalFiles: files.length,
                    colorPages: item.file.type.startsWith('image/')
                        ? (item.imageMode === 'color' ? 'Full Image' : '')
                        : (item.pageMode === 'all-color' ? 'All Pages' : (item.colorPages || '')),
                    bwPages: item.file.type.startsWith('image/')
                        ? (item.imageMode === 'bw' ? 'Full Image' : '')
                        : (item.pageMode === 'all-bw' ? 'All Pages' : (item.bwPages || '')),
                    paperSize: item.paperSize || 'A4',
                    orientation: item.orientation || 'portrait',
                    copies: Number(item.copies || 1),
                    duplex: item.duplex || 'simplex',
                    scale: item.scale || 'fit'
                };

                await uploadFileToShop({
                    endpoint: uploadTarget,
                    token: uploadToken,
                    file: item.file,
                    metadata,
                    onProgress: setProgress
                });
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
            setFiles([]);
            setProgress(100);
            setStatus('COMPLETED');
            setInfoMessage('Files sent successfully.');
        } catch (error) {
            console.error('Transfer failed:', error);
            setStatus('ERROR');
            setErrorMessage(error.message || 'Transfer failed.');
            setInfoMessage('');
        } finally {
            setIsSending(false);
        }
    };

    const showConnectedPanel = ['ONLINE', 'CONNECTING', 'TRANSFERRING', 'COMPLETED', 'ERROR'].includes(status);
    const canSend = !isSending && status !== 'OFFLINE' && customerName.trim() && files.length > 0;

    return (
        <div className="container">
            <div className="card">
                <h1>Send Files to Print</h1>
                <p className="hero-copy">Fast direct file transfer to your print shop with full print instructions.</p>

                {(errorMessage || infoMessage) && (
                    <div className={`message-banner ${errorMessage ? 'error' : 'info'}`}>
                        {errorMessage || infoMessage}
                    </div>
                )}

                {showInstallBanner && (
                    <div className="install-banner">
                        <div className="install-text">
                            <strong>Install App</strong>
                            <p>Add to home screen to share files directly from WhatsApp, Photos and more.</p>
                        </div>
                        <div className="install-buttons">
                            <button onClick={handleInstall} className="btn-install">Install</button>
                            <button onClick={() => setShowInstallBanner(false)} className="btn-close">X</button>
                        </div>
                    </div>
                )}

                {status === 'SHARED_MODE' && (
                    <div className="shared-mode-section">
                        <div className="shared-files-notice">
                            <h2>Files Ready to Upload</h2>
                            <p>Select your print shop to continue</p>
                        </div>

                        <div className="shop-select-options">
                            <button
                                onClick={() => setShowQRScanner(true)}
                                className="btn-primary"
                                style={{ marginBottom: '10px' }}
                            >
                                Scan Shop QR Code
                            </button>

                            <div className="divider">OR</div>

                            <input
                                type="text"
                                placeholder="Enter Shop Code (e.g., SHOP001)"
                                value={shopId}
                                onChange={(e) => setShopId(e.target.value.toUpperCase())}
                                className="input"
                            />
                            <button
                                onClick={handleConnect}
                                className="btn-primary"
                                disabled={!shopId || isConnecting}
                            >
                                {isConnecting ? 'Connecting...' : 'Connect and Upload'}
                            </button>
                        </div>

                        {showQRScanner && (
                            <div className="qr-scanner-modal">
                                <div className="qr-scanner-content">
                                    <button
                                        onClick={() => setShowQRScanner(false)}
                                        className="btn-close-modal"
                                    >
                                        X
                                    </button>
                                    <h3>Scan Shop QR Code</h3>
                                    <div className="qr-scanner-box">
                                        <div className="qr-placeholder">Camera access coming soon</div>
                                        <p style={{ marginTop: '15px', fontSize: '13px', color: '#666' }}>
                                            For now, please use the manual entry option above
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {status === 'DISCONNECTED' && (
                    <div className="connect-section">
                        <input
                            type="text"
                            placeholder="Enter Shop Code (e.g., SHOP001)"
                            value={shopId}
                            onChange={(e) => setShopId(e.target.value.toUpperCase())}
                            className="input"
                        />
                        <button onClick={handleConnect} className="btn-primary" disabled={!shopId || isConnecting}>
                            {isConnecting ? 'Connecting...' : 'Connect'}
                        </button>
                    </div>
                )}

                {showConnectedPanel && (
                    <>
                        <div className={`status ${status === 'ERROR' ? 'offline' : 'online'}`}>
                            {status === 'ONLINE' && 'Shop Online'}
                            {status === 'CONNECTING' && 'Preparing Upload'}
                            {status === 'TRANSFERRING' && 'Transferring'}
                            {status === 'COMPLETED' && 'Files Sent Successfully'}
                            {status === 'ERROR' && 'Transfer Failed'}
                        </div>

                        {pricing && (
                            <div className="pricing">
                                <strong>Pricing:</strong> Color: Rs {pricing.colorPrice}/page | B&W: Rs {pricing.bwPrice}/page
                            </div>
                        )}

                        <input
                            type="text"
                            placeholder="Your Name"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            className="input"
                            maxLength={50}
                        />

                        <label
                            className={`file-picker ${isDragActive ? 'drag-active' : ''}`}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragActive(true);
                            }}
                            onDragLeave={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget)) {
                                    setIsDragActive(false);
                                }
                            }}
                            onDrop={handleDrop}
                        >
                            <input
                                type="file"
                                multiple
                                onChange={handleFileSelect}
                                className="file-input"
                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            />
                            <span className="file-picker-title">Choose files or drag them here</span>
                            <span className="file-picker-copy">PDF, DOC, DOCX, JPG, JPEG, PNG up to 100 MB each</span>
                        </label>

                        {files.length > 0 && (
                            <div className="files-list">
                                {files.map((item, i) => (
                                    <div key={i} className="file-item">
                                        <div className="file-name">
                                            {item.file.name}
                                            <span className="file-type-badge">
                                                {item.file.type.startsWith('image/') ? 'Image' : 'Document'}
                                            </span>
                                            <button
                                                onClick={() => deleteFile(i)}
                                                className="btn-delete"
                                                title="Remove file"
                                            >
                                                X
                                            </button>
                                        </div>
                                        <>
                                            {item.file.type.startsWith('image/') ? (
                                                <div className="print-type-selector">
                                                    <label className="print-type-label">Image Print</label>
                                                    <div className="radio-group">
                                                        <label className="radio-option">
                                                            <input
                                                                type="radio"
                                                                name={`imageMode-${i}`}
                                                                value="color"
                                                                checked={item.imageMode === 'color'}
                                                                onChange={() => updateFileOption(i, 'imageMode', 'color')}
                                                            />
                                                            <span>Full Color</span>
                                                        </label>
                                                        <label className="radio-option">
                                                            <input
                                                                type="radio"
                                                                name={`imageMode-${i}`}
                                                                value="bw"
                                                                checked={item.imageMode === 'bw'}
                                                                onChange={() => updateFileOption(i, 'imageMode', 'bw')}
                                                            />
                                                            <span>Full Black & White</span>
                                                        </label>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="print-type-selector">
                                                        <label className="print-type-label">Document Print</label>
                                                        <div className="radio-group">
                                                            <label className="radio-option">
                                                                <input
                                                                    type="radio"
                                                                    name={`pageMode-${i}`}
                                                                    value="custom"
                                                                    checked={item.pageMode === 'custom'}
                                                                    onChange={() => updateFileOption(i, 'pageMode', 'custom')}
                                                                />
                                                                <span>Custom Pages</span>
                                                            </label>
                                                            <label className="radio-option">
                                                                <input
                                                                    type="radio"
                                                                    name={`pageMode-${i}`}
                                                                    value="all-color"
                                                                    checked={item.pageMode === 'all-color'}
                                                                    onChange={() => updateFileOption(i, 'pageMode', 'all-color')}
                                                                />
                                                                <span>All Pages Color</span>
                                                            </label>
                                                            <label className="radio-option">
                                                                <input
                                                                    type="radio"
                                                                    name={`pageMode-${i}`}
                                                                    value="all-bw"
                                                                    checked={item.pageMode === 'all-bw'}
                                                                    onChange={() => updateFileOption(i, 'pageMode', 'all-bw')}
                                                                />
                                                                <span>All Pages B&W</span>
                                                            </label>
                                                        </div>
                                                    </div>
                                                    {item.pageMode === 'custom' && (
                                                        <>
                                                            <input
                                                                type="text"
                                                                placeholder="Color pages (e.g., 21,26-29)"
                                                                value={item.colorPages}
                                                                onChange={(e) => updateFilePages(i, 'colorPages', e.target.value)}
                                                                className="input-small"
                                                            />
                                                            <input
                                                                type="text"
                                                                placeholder="B&W pages (e.g., 10-20,22-25,30-40)"
                                                                value={item.bwPages}
                                                                onChange={(e) => updateFilePages(i, 'bwPages', e.target.value)}
                                                                className="input-small"
                                                            />
                                                        </>
                                                    )}
                                                </>
                                            )}
                                            <div className="print-type-selector">
                                                <label className="print-type-label">Paper Size</label>
                                                <select
                                                    value={item.paperSize}
                                                    onChange={(e) => updateFileOption(i, 'paperSize', e.target.value)}
                                                    className="input-small"
                                                >
                                                    <option value="A4">A4</option>
                                                    <option value="A3">A3</option>
                                                    <option value="Letter">Letter</option>
                                                    <option value="Legal">Legal</option>
                                                </select>
                                                <label className="print-type-label">Layout</label>
                                                <select
                                                    value={item.orientation}
                                                    onChange={(e) => updateFileOption(i, 'orientation', e.target.value)}
                                                    className="input-small"
                                                >
                                                    <option value="portrait">Portrait</option>
                                                    <option value="landscape">Landscape</option>
                                                </select>
                                                <label className="print-type-label">Copies</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="20"
                                                    value={item.copies}
                                                    onChange={(e) => updateFileOption(i, 'copies', e.target.value)}
                                                    className="input-small"
                                                />
                                                <label className="print-type-label">Sides</label>
                                                <select
                                                    value={item.duplex}
                                                    onChange={(e) => updateFileOption(i, 'duplex', e.target.value)}
                                                    className="input-small"
                                                >
                                                    <option value="simplex">Single Side</option>
                                                    <option value="long-edge">Both Sides</option>
                                                </select>
                                                <label className="print-type-label">Scale</label>
                                                <select
                                                    value={item.scale}
                                                    onChange={(e) => updateFileOption(i, 'scale', e.target.value)}
                                                    className="input-small"
                                                >
                                                    <option value="fit">Fit to Page</option>
                                                    <option value="actual">Actual Size</option>
                                                </select>
                                            </div>
                                        </>
                                    </div>
                                ))}
                            </div>
                        )}

                        {files.length > 0 && (
                            <button onClick={handleSend} className="btn-primary" disabled={!canSend}>
                                {isSending ? `Sending ${currentFile || 1}/${files.length}` : `Send ${files.length} File${files.length > 1 ? 's' : ''} to Print`}
                            </button>
                        )}

                        {currentFile > 0 && (
                            <div className="progress-section">
                                <div className="progress-text">
                                    Sending file {currentFile} of {files.length}
                                </div>
                                <div className="progress-bar">
                                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                                </div>
                                <div className="progress-percent">{Math.round(progress)}%</div>
                            </div>
                        )}
                    </>
                )}

                {status === 'OFFLINE' && (
                    <div className="status offline">Shop Offline</div>
                )}
            </div>
        </div>
    );
}

function uploadFileToShop({ endpoint, token, file, metadata, onProgress }) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${String(endpoint).replace(/\/$/, '')}/upload`);
        xhr.timeout = 45000;
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('X-File-Size', String(file.size));
        xhr.setRequestHeader('X-File-Type', encodeURIComponent(file.type || 'application/octet-stream'));
        xhr.setRequestHeader('X-Customer-Name', encodeURIComponent(metadata.customerName || 'Unknown'));
        xhr.setRequestHeader('X-Color-Pages', encodeURIComponent(metadata.colorPages || ''));
        xhr.setRequestHeader('X-BW-Pages', encodeURIComponent(metadata.bwPages || ''));
        xhr.setRequestHeader('X-Paper-Size', encodeURIComponent(metadata.paperSize || 'A4'));
        xhr.setRequestHeader('X-Orientation', encodeURIComponent(metadata.orientation || 'portrait'));
        xhr.setRequestHeader('X-Copies', String(Number(metadata.copies || 1)));
        xhr.setRequestHeader('X-Duplex', encodeURIComponent(metadata.duplex || 'simplex'));
        xhr.setRequestHeader('X-Scale', encodeURIComponent(metadata.scale || 'fit'));
        xhr.setRequestHeader('X-File-Index', String(metadata.fileIndex || 1));
        xhr.setRequestHeader('X-Total-Files', String(metadata.totalFiles || 1));

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress((event.loaded / event.total) * 100);
            }
        };

        xhr.onerror = () => reject(new Error('Upload failed. Check the shop tunnel and try again.'));
        xhr.ontimeout = () => reject(new Error('Upload timed out while connecting to the shop tunnel.'));
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
                return;
            }

            try {
                const payload = JSON.parse(xhr.responseText || '{}');
                reject(new Error(payload.error || 'Upload failed'));
            } catch {
                reject(new Error(xhr.responseText || 'Upload failed'));
            }
        };

        xhr.send(file);
    });
}

function normalizeShopCode(value) {
    return String(value || '').trim().replace(/[<>]/g, '').toUpperCase();
}

function prepareIncomingFiles(selectedFiles) {
    const validFiles = [];
    const invalidFiles = [];

    for (const file of selectedFiles) {
        if (!isAllowedFileType(file)) {
            invalidFiles.push(`${file.name}: unsupported file type`);
            continue;
        }
        if (file.size <= 0 || file.size > 100 * 1024 * 1024) {
            invalidFiles.push(`${file.name}: file size must be 1 byte to 100 MB`);
            continue;
        }
        validFiles.push({
            file,
            ...DEFAULT_PRINT_SETTINGS
        });
    }

    return { validFiles, invalidFiles };
}

function isAllowedFileType(file) {
    return new Set([
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png'
    ]).has(file.type);
}

function validateSubmission({ customerName, files }) {
    if (!customerName.trim()) {
        return 'Enter your name before sending files.';
    }

    if (files.length === 0) {
        return 'Add at least one file before sending.';
    }

    for (const item of files) {
        if (!item.file.type.startsWith('image/') && item.pageMode === 'custom' && !item.colorPages.trim() && !item.bwPages.trim()) {
            return `Add page ranges or choose an all-pages option for ${item.file.name}.`;
        }

        const copies = Number(item.copies || 1);
        if (!Number.isFinite(copies) || copies < 1 || copies > 20) {
            return `Copies for ${item.file.name} must be between 1 and 20.`;
        }
    }

    return '';
}

async function takePendingSharedFiles() {
    const database = await openSharedFilesDb();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(SHARED_FILES_STORE, 'readwrite');
        const store = transaction.objectStore(SHARED_FILES_STORE);
        const getRequest = store.get('latest');

        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => {
            const files = Array.isArray(getRequest.result?.files) ? getRequest.result.files : [];
            const deleteRequest = store.delete('latest');
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onsuccess = () => resolve(files);
        };
    });
}

function openSharedFilesDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(SHARED_FILES_DB, 1);

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(SHARED_FILES_STORE)) {
                database.createObjectStore(SHARED_FILES_STORE);
            }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}
