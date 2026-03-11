import React, { useEffect, useState } from 'react';
import { FileTransferClient } from './services/webrtc';
import { API_URL, WS_URL } from './config';
import './App.css';

export default function App() {
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

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('shop');
        const shared = params.get('shared');

        if (id) setShopId(id);

        if (shared === 'true' || window.location.pathname === '/share') {
            handleSharedFiles();
        }

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            setInstallPrompt(e);
            setShowInstallBanner(true);
        });
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
        if (!shopId || !WS_URL) return;

        const client = new FileTransferClient(shopId, WS_URL, setStatus, setProgress);
        client.connect();
        window.transferClient = client;

        fetch(`${API_URL}/shop/public/${encodeURIComponent(shopId)}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.shop) {
                    setPricing(data.shop);
                }
            })
            .catch(console.error);
    };

    const handleFileSelect = (e) => {
        const selectedFiles = Array.from(e.target.files).map((file) => {
            const isImage = file.type.startsWith('image/');
            return {
                file,
                isImage,
                printType: isImage ? 'color' : null,
                colorPages: isImage ? null : '',
                bwPages: isImage ? null : ''
            };
        });
        setFiles([...files, ...selectedFiles]);
        e.target.value = '';
    };

    const updateFilePages = (index, field, value) => {
        const updated = [...files];
        updated[index][field] = value;
        setFiles(updated);
    };

    const updatePrintType = (index, type) => {
        const updated = [...files];
        updated[index].printType = type;
        setFiles(updated);
    };

    const deleteFile = (index) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const handleSend = async () => {
        if (!window.transferClient || !customerName || files.length === 0) return;

        setCurrentFile(0);
        setStatus('CONNECTING');

        try {
            for (let i = 0; i < files.length; i++) {
                setCurrentFile(i + 1);
                const item = files[i];
                const metadata = {
                    customerName,
                    fileIndex: i + 1,
                    totalFiles: files.length
                };

                if (item.isImage) {
                    metadata.printType = item.printType;
                    metadata.colorPages = item.printType === 'color' ? 'Full Image' : '';
                    metadata.bwPages = item.printType === 'bw' ? 'Full Image' : '';
                } else {
                    metadata.colorPages = item.colorPages || '';
                    metadata.bwPages = item.bwPages || '';
                }

                await window.transferClient.startFileTransfer(item.file, metadata);
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
        } catch (error) {
            console.error('Transfer failed:', error);
            setStatus('ERROR');
        }
    };

    const showConnectedPanel = ['ONLINE', 'CONNECTING', 'TRANSFERRING', 'COMPLETED', 'ERROR'].includes(status);

    return (
        <div className="container">
            <div className="card">
                <h1>Send Files to Print</h1>

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
                                onChange={(e) => setShopId(e.target.value)}
                                className="input"
                            />
                            <button
                                onClick={handleConnect}
                                className="btn-primary"
                                disabled={!shopId}
                            >
                                Connect and Upload
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
                            onChange={(e) => setShopId(e.target.value)}
                            className="input"
                        />
                        <button onClick={handleConnect} className="btn-primary">
                            Connect
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
                                                {item.isImage ? 'Image' : 'Document'}
                                            </span>
                                            <button
                                                onClick={() => deleteFile(i)}
                                                className="btn-delete"
                                                title="Remove file"
                                            >
                                                X
                                            </button>
                                        </div>
                                        {item.isImage ? (
                                            <div className="print-type-selector">
                                                <label className="print-type-label">Print Type:</label>
                                                <div className="radio-group">
                                                    <label className="radio-option">
                                                        <input
                                                            type="radio"
                                                            name={`printType-${i}`}
                                                            value="color"
                                                            checked={item.printType === 'color'}
                                                            onChange={() => updatePrintType(i, 'color')}
                                                        />
                                                        <span>Color</span>
                                                    </label>
                                                    <label className="radio-option">
                                                        <input
                                                            type="radio"
                                                            name={`printType-${i}`}
                                                            value="bw"
                                                            checked={item.printType === 'bw'}
                                                            onChange={() => updatePrintType(i, 'bw')}
                                                        />
                                                        <span>Black & White</span>
                                                    </label>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Color pages (e.g., 1-5,8,10)"
                                                    value={item.colorPages}
                                                    onChange={(e) => updateFilePages(i, 'colorPages', e.target.value)}
                                                    className="input-small"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="B&W pages (e.g., 6-7,9)"
                                                    value={item.bwPages}
                                                    onChange={(e) => updateFilePages(i, 'bwPages', e.target.value)}
                                                    className="input-small"
                                                />
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {files.length > 0 && (
                            <button onClick={handleSend} className="btn-primary">
                                Send {files.length} File{files.length > 1 ? 's' : ''} to Print
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
