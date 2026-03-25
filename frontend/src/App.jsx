import React, { useEffect, useRef, useState } from 'react';
import { FileTransferClient } from './services/webrtc';
import { API_URL, WS_URL } from './config';
import './App.css';

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
        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
            transferClientRef.current = null;
        };
    }, []);

    const handleSharedFiles = async () => {
        const params = new URLSearchParams(window.location.search);
        const sharedText = params.get('text');
        const sharedTitle = params.get('title');
        const sharedUrl = params.get('url');

        if (sharedTitle || sharedText || sharedUrl) {
            setStatus('SHARED_MODE');
            if (sharedText) setCustomerName(sharedText.substring(0, 50));
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

    const handleConnect = () => {
        const normalizedShopId = normalizeShopCode(shopId);
        if (!normalizedShopId) {
            setErrorMessage('Enter a valid shop code before connecting.');
            return;
        }

        if (!WS_URL) {
            setErrorMessage('Frontend WebSocket is not configured.');
            return;
        }

        if (!API_URL) {
            setErrorMessage('Frontend API is not configured.');
            return;
        }

        setErrorMessage('');
        setInfoMessage('Checking shop status...');
        setIsConnecting(true);
        setPricing(null);

        const client = new FileTransferClient(normalizedShopId, WS_URL, (nextStatus) => {
            setStatus(nextStatus);
            if (nextStatus === 'ONLINE') {
                setErrorMessage('');
                setInfoMessage('Shop is online. You can upload files now.');
            } else if (nextStatus === 'OFFLINE') {
                setInfoMessage('');
                setErrorMessage('Shop is offline or not connected right now.');
            } else if (nextStatus === 'ERROR') {
                setInfoMessage('');
                setErrorMessage('Connection or transfer failed. On mobile data or weak networks, a TURN relay may be required.');
            } else if (nextStatus === 'TRANSFERRING') {
                setInfoMessage('Transfer in progress...');
            } else if (nextStatus === 'COMPLETED') {
                setInfoMessage('Files sent successfully.');
            }
        }, setProgress);
        client.connect();
        transferClientRef.current = client;
        setShopId(normalizedShopId);

        fetch(`${API_URL}/shop/public/${encodeURIComponent(normalizedShopId)}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.shop) {
                    setPricing(data.shop);
                } else {
                    setErrorMessage('Shop details could not be loaded.');
                }
            })
            .catch(() => {
                setErrorMessage('Could not load shop pricing.');
            })
            .finally(() => {
                setIsConnecting(false);
            });
    };

    const handleFileSelect = (e) => {
        const selectedFiles = Array.from(e.target.files);
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

        if (invalidFiles.length > 0) {
            setErrorMessage(invalidFiles.join(' | '));
        } else {
            setErrorMessage('');
        }

        if (validFiles.length > 0) {
            setFiles((current) => [...current, ...validFiles]);
        }
        e.target.value = '';
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
            for (let i = 0; i < files.length; i++) {
                setCurrentFile(i + 1);
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

                await transferClientRef.current.startFileTransfer(item.file, metadata);
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
            setFiles([]);
            setProgress(100);
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
                            {status === 'CONNECTING' && 'Connecting Directly'}
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

                        <input
                            type="file"
                            multiple
                            onChange={handleFileSelect}
                            className="file-input"
                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                        />

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

function normalizeShopCode(value) {
    return String(value || '').trim().replace(/[<>]/g, '').toUpperCase();
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
