import React, { useEffect, useState } from 'react';
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
    const [shopId, setShopId] = useState('');
    const [connectedShopId, setConnectedShopId] = useState('');
    const [status, setStatus] = useState('DISCONNECTED');
    const [customerName, setCustomerName] = useState('');
    const [files, setFiles] = useState([]);
    const [progress, setProgress] = useState(0);
    const [currentFile, setCurrentFile] = useState(0);
    const [totalFiles, setTotalFiles] = useState(0);
    const [sentFileCount, setSentFileCount] = useState(0);
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
        if (shared === 'true' || window.location.pathname === '/share') handleSharedFiles();

        const onBeforeInstallPrompt = (e) => { e.preventDefault(); setInstallPrompt(e); setShowInstallBanner(true); };
        const onServiceWorkerMessage = (event) => { if (event.data?.type === 'SHARED_FILES_READY') handleSharedFiles(); };
        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
            navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
        };
    }, []);

    useEffect(() => {
        if (!connectedShopId || !API_URL) return undefined;
        const pollMs = status === 'OFFLINE' ? 5000 : 15000;
        const interval = window.setInterval(() => { void fetchShopStatus(connectedShopId, { silent: true }); }, pollMs);
        return () => window.clearInterval(interval);
    }, [connectedShopId, status]);

    const handleSharedFiles = async () => {
        const params = new URLSearchParams(window.location.search);
        const sharedText = params.get('text');
        const sharedTitle = params.get('title');
        const sharedUrl = params.get('url');
        if (sharedTitle || sharedText || sharedUrl) { setStatus('SHARED_MODE'); if (sharedText) setCustomerName(sharedText.substring(0, 50)); }
        try {
            const sharedFiles = await takePendingSharedFiles();
            if (sharedFiles.length > 0) {
                const preparedFiles = prepareIncomingFiles(sharedFiles);
                if (preparedFiles.validFiles.length > 0) { setFiles((c) => [...c, ...preparedFiles.validFiles]); setInfoMessage(`Loaded ${preparedFiles.validFiles.length} shared file(s).`); setErrorMessage(preparedFiles.invalidFiles.join(' | ')); setStatus('SHARED_MODE'); }
                else if (preparedFiles.invalidFiles.length > 0) setErrorMessage(preparedFiles.invalidFiles.join(' | '));
            }
        } catch { setErrorMessage('Shared files could not be loaded.'); }
        const url = new URL(window.location.href);
        window.history.replaceState({}, '', `/?shop=${url.searchParams.get('shop') || ''}&shared=true`);
    };

    const handleInstall = async () => { if (!installPrompt) return; installPrompt.prompt(); const { outcome } = await installPrompt.userChoice; if (outcome === 'accepted') setShowInstallBanner(false); setInstallPrompt(null); };

    const fetchShopStatus = async (inputShopId, options = {}) => {
        const normalizedShopId = normalizeShopCode(inputShopId);
        if (!normalizedShopId) { setErrorMessage('Enter a valid shop code.'); return false; }
        if (!API_URL) { setErrorMessage('API is not configured.'); return false; }
        if (!options.silent) { setErrorMessage(''); setInfoMessage('Connecting...'); setIsConnecting(true); setPricing(null); }
        setShopId(normalizedShopId);
        try {
            const response = await fetch(`${API_URL}/shop/public/${encodeURIComponent(normalizedShopId)}`, { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.shop) { setConnectedShopId(''); setStatus('DISCONNECTED'); setInfoMessage(''); setErrorMessage(data.error || 'Shop not found.'); return false; }
            setConnectedShopId(normalizedShopId);
            setPricing(data.shop);
            if (data.shop.status === 'online') { setStatus('ONLINE'); setErrorMessage(''); setInfoMessage('Shop is online. Upload your files.'); }
            else { setStatus('OFFLINE'); setInfoMessage(''); if (!options.silent || status !== 'OFFLINE') setErrorMessage('Shop is offline right now.'); }
            return true;
        } catch { if (!options.silent) setErrorMessage('Could not reach the shop.'); return false; }
        finally { if (!options.silent) setIsConnecting(false); }
    };

    const handleConnect = () => { void fetchShopStatus(shopId); };
    const appendFiles = (selectedFiles) => { const { validFiles, invalidFiles } = prepareIncomingFiles(selectedFiles); setErrorMessage(invalidFiles.join(' | ')); if (validFiles.length > 0) { setFiles((c) => [...c, ...validFiles]); setInfoMessage(`Added ${validFiles.length} file(s).`); } };
    const handleFileSelect = (e) => { appendFiles(Array.from(e.target.files || [])); e.target.value = ''; };
    const handleDrop = (e) => { e.preventDefault(); setIsDragActive(false); appendFiles(Array.from(e.dataTransfer.files || [])); };
    const updateFileOption = (index, field, value) => { const u = [...files]; u[index][field] = value; setFiles(u); };
    const updateFilePages = (index, field, value) => { const u = [...files]; u[index][field] = value; setFiles(u); };
    const deleteFile = (index) => { setFiles(files.filter((_, i) => i !== index)); };

    const handleSend = async () => {
        if (!connectedShopId) { setErrorMessage('Connect to a shop first.'); return; }
        const validationError = validateSubmission({ customerName, files });
        if (validationError) { setErrorMessage(validationError); return; }
        setCurrentFile(0); setTotalFiles(files.length); setStatus('CONNECTING'); setErrorMessage(''); setInfoMessage('Preparing...'); setIsSending(true); setProgress(0);
        try {
            for (let i = 0; i < files.length; i++) {
                setCurrentFile(i + 1); setStatus('TRANSFERRING');
                const item = files[i];
                const uploadPlan = await createUploadPlan(connectedShopId, item.file);
                await uploadFileToR2(uploadPlan.uploadUrl, item.file, setProgress);
                await createJobRecord(connectedShopId, item, uploadPlan);
                await new Promise((r) => setTimeout(r, 400));
            }
            setSentFileCount(files.length); setFiles([]); setCurrentFile(0); setTotalFiles(0); setProgress(100); setStatus('COMPLETED'); setInfoMessage(''); setErrorMessage('');
        } catch (error) { setStatus('ERROR'); setErrorMessage(error.message || 'Transfer failed.'); setInfoMessage(''); }
        finally { setIsSending(false); }
    };

    const handleSendMore = () => { setFiles([]); setCurrentFile(0); setTotalFiles(0); setSentFileCount(0); setProgress(0); setCustomerName(''); setErrorMessage(''); setInfoMessage('Shop is online. Upload your files.'); setStatus('ONLINE'); };

    const showConnectedPanel = ['ONLINE', 'CONNECTING', 'TRANSFERRING', 'ERROR'].includes(status);
    const canSend = !isSending && status !== 'OFFLINE' && customerName.trim() && files.length > 0;

    const getFileIcon = (type) => {
        if (type === 'application/pdf') return { cls: 'pdf', letter: 'P' };
        if (type.startsWith('image/')) return { cls: 'img', letter: 'I' };
        return { cls: 'doc', letter: 'D' };
    };

    return (
        <div className="app">
            <div className="header">
                <div className="header-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#6366f1' }}>
                        <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
                    </svg>
                </div>
                <h1>Send to Print</h1>
                <p>Upload files with print instructions directly to your shop.</p>
            </div>

            {showInstallBanner && (
                <div className="install-banner">
                    <div className="install-banner-text"><strong>Install App</strong>Share files from WhatsApp, Photos and more.</div>
                    <button onClick={handleInstall} className="btn-sm">Install</button>
                    <button onClick={() => setShowInstallBanner(false)} className="btn-x">X</button>
                </div>
            )}

            {errorMessage && <div className="msg msg-error">{errorMessage}</div>}
            {infoMessage && !errorMessage && <div className="msg msg-info">{infoMessage}</div>}

            {/* ── Shared Mode ── */}
            {status === 'SHARED_MODE' && (
                <div className="card">
                    <div className="shared-banner"><h2>Files Ready</h2><p>Connect to your print shop to continue.</p></div>
                    <div className="connect-section">
                        <input type="text" placeholder="Enter Shop Code (e.g. SHOP001)" value={shopId} onChange={(e) => setShopId(e.target.value.toUpperCase())} className="input" />
                        <button onClick={handleConnect} className="btn btn-brand" disabled={!shopId || isConnecting}>{isConnecting ? 'Connecting...' : 'Connect'}</button>
                    </div>
                </div>
            )}

            {/* ── Disconnected ── */}
            {status === 'DISCONNECTED' && (
                <div className="card">
                    <div className="connect-section">
                        <input type="text" placeholder="Enter Shop Code (e.g. SHOP001)" value={shopId} onChange={(e) => setShopId(e.target.value.toUpperCase())} className="input" />
                        <button onClick={handleConnect} className="btn btn-brand" disabled={!shopId || isConnecting}>{isConnecting ? 'Connecting...' : 'Connect to Shop'}</button>
                    </div>
                </div>
            )}

            {/* ── Offline ── */}
            {status === 'OFFLINE' && <div className="status-chip offline">Shop Offline</div>}

            {/* ── Connected Panel ── */}
            {showConnectedPanel && (
                <>
                    <div className={`status-chip ${status === 'ERROR' ? 'error' : status === 'TRANSFERRING' || status === 'CONNECTING' ? 'transfer' : 'online'}`}>
                        {status === 'ONLINE' && 'Shop Online'}
                        {status === 'CONNECTING' && 'Preparing Upload'}
                        {status === 'TRANSFERRING' && 'Transferring'}
                        {status === 'ERROR' && 'Transfer Failed'}
                    </div>

                    {pricing && (
                        <div className="pricing-row">
                            <div className="pricing-chip"><strong>Rs {pricing.colorPrice}</strong>Color / page</div>
                            <div className="pricing-chip"><strong>Rs {pricing.bwPrice}</strong>B&W / page</div>
                        </div>
                    )}

                    <div className="card">
                        <input type="text" placeholder="Your Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="input" maxLength={50} />
                    </div>

                    <label className={`file-picker ${isDragActive ? 'active' : ''}`} onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragActive(false); }} onDrop={handleDrop}>
                        <input type="file" multiple onChange={handleFileSelect} className="file-input" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
                        <div className="file-picker-icon">+</div>
                        <div className="file-picker-title">Choose files or drag here</div>
                        <div className="file-picker-sub">PDF, DOC, DOCX, JPG, PNG up to 100 MB</div>
                    </label>

                    {files.length > 0 && (
                        <div className="file-list">
                            {files.map((item, i) => {
                                const icon = getFileIcon(item.file.type);
                                const isImage = item.file.type.startsWith('image/');
                                return (
                                    <div key={i} className="file-card">
                                        <div className="file-card-header">
                                            <div className={`file-card-icon ${icon.cls}`}>{icon.letter}</div>
                                            <div className="file-card-name">{item.file.name}</div>
                                            <span className="file-card-badge">{isImage ? 'Image' : 'Doc'}</span>
                                            <button onClick={() => deleteFile(i)} className="btn-remove">X</button>
                                        </div>

                                        {isImage ? (
                                            <div className="opt-section">
                                                <div className="opt-label">Print Mode</div>
                                                <div className="opt-pills">
                                                    <label className={`opt-pill ${item.imageMode === 'color' ? 'selected' : ''}`}>
                                                        <input type="radio" name={`img-${i}`} checked={item.imageMode === 'color'} onChange={() => updateFileOption(i, 'imageMode', 'color')} />Color
                                                    </label>
                                                    <label className={`opt-pill ${item.imageMode === 'bw' ? 'selected' : ''}`}>
                                                        <input type="radio" name={`img-${i}`} checked={item.imageMode === 'bw'} onChange={() => updateFileOption(i, 'imageMode', 'bw')} />B&W
                                                    </label>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="opt-section">
                                                    <div className="opt-label">Page Mode</div>
                                                    <div className="opt-pills">
                                                        <label className={`opt-pill ${item.pageMode === 'custom' ? 'selected' : ''}`}>
                                                            <input type="radio" name={`pm-${i}`} checked={item.pageMode === 'custom'} onChange={() => updateFileOption(i, 'pageMode', 'custom')} />Custom
                                                        </label>
                                                        <label className={`opt-pill ${item.pageMode === 'all-color' ? 'selected' : ''}`}>
                                                            <input type="radio" name={`pm-${i}`} checked={item.pageMode === 'all-color'} onChange={() => updateFileOption(i, 'pageMode', 'all-color')} />All Color
                                                        </label>
                                                        <label className={`opt-pill ${item.pageMode === 'all-bw' ? 'selected' : ''}`}>
                                                            <input type="radio" name={`pm-${i}`} checked={item.pageMode === 'all-bw'} onChange={() => updateFileOption(i, 'pageMode', 'all-bw')} />All B&W
                                                        </label>
                                                    </div>
                                                </div>
                                                {item.pageMode === 'custom' && (
                                                    <div className="opt-grid">
                                                        <div className="opt-field">
                                                            <div className="opt-label">Color Pages</div>
                                                            <input type="text" placeholder="e.g. 21,26-29" value={item.colorPages} onChange={(e) => updateFilePages(i, 'colorPages', e.target.value)} className="input-sm" />
                                                        </div>
                                                        <div className="opt-field">
                                                            <div className="opt-label">B&W Pages</div>
                                                            <input type="text" placeholder="e.g. 10-20,30-40" value={item.bwPages} onChange={(e) => updateFilePages(i, 'bwPages', e.target.value)} className="input-sm" />
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        <div className="opt-grid">
                                            <div className="opt-field">
                                                <div className="opt-label">Paper</div>
                                                <select value={item.paperSize} onChange={(e) => updateFileOption(i, 'paperSize', e.target.value)} className="input-sm">
                                                    {(pricing?.paperSizes || ['A4']).map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            </div>
                                            <div className="opt-field">
                                                <div className="opt-label">Layout</div>
                                                <select value={item.orientation} onChange={(e) => updateFileOption(i, 'orientation', e.target.value)} className="input-sm">
                                                    <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
                                                </select>
                                            </div>
                                            <div className="opt-field">
                                                <div className="opt-label">Copies</div>
                                                <input type="number" min="1" max="20" value={item.copies} onChange={(e) => updateFileOption(i, 'copies', e.target.value)} className="input-sm" />
                                            </div>
                                            <div className="opt-field">
                                                <div className="opt-label">Sides</div>
                                                <select value={item.duplex} onChange={(e) => updateFileOption(i, 'duplex', e.target.value)} className="input-sm">
                                                    <option value="simplex">Single</option><option value="long-edge">Both Sides</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {currentFile > 0 && totalFiles > 0 && (
                        <div className="progress-section">
                            <div className="progress-top">
                                <span>File {currentFile} of {totalFiles}</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                        </div>
                    )}

                    {files.length > 0 && status !== 'ERROR' && (
                        <button onClick={handleSend} className="btn btn-green" disabled={!canSend}>
                            {isSending ? `Sending ${currentFile || 1}/${totalFiles}` : `Send ${files.length} File${files.length > 1 ? 's' : ''}`}
                        </button>
                    )}

                    {status === 'ERROR' && files.length > 0 && (
                        <button onClick={() => void handleSend()} className="btn btn-brand" disabled={!canSend}>Retry Send</button>
                    )}
                </>
            )}

            {/* ── Success ── */}
            {status === 'COMPLETED' && (
                <div className="success-page">
                    <div className="success-icon">
                        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
                            <circle cx="36" cy="36" r="36" fill="rgba(52,211,153,0.15)" />
                            <path d="M22 38l9 9 19-21" stroke="#34d399" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                    </div>
                    <h2 className="success-title">Sent Successfully</h2>
                    <p className="success-detail">{sentFileCount} {sentFileCount === 1 ? 'file' : 'files'} sent to the print shop.</p>
                    <p className="success-shop">{connectedShopId}</p>
                    <button onClick={handleSendMore} className="btn btn-brand" style={{ marginTop: '24px', maxWidth: '320px' }}>Send More Files</button>
                </div>
            )}
        </div>
    );
}

// ── Helpers (unchanged) ──

async function createUploadPlan(shopCode, file) {
    const response = await fetch(`${API_URL}/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopCode, fileName: file.name, contentType: file.type || 'application/octet-stream', fileSize: file.size }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not create upload URL');
    return payload;
}

function uploadFileToR2(uploadUrl, file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl); xhr.timeout = 45000; xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (event) => { if (event.lengthComputable && event.total > 0) onProgress((event.loaded / event.total) * 100); };
        xhr.onerror = () => reject(new Error('Upload failed.')); xhr.ontimeout = () => reject(new Error('Upload timed out.'));
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; } try { reject(new Error(JSON.parse(xhr.responseText || '{}').error || 'Upload failed')); } catch { reject(new Error(xhr.responseText || 'Upload failed')); } };
        xhr.send(file);
    });
}

async function createJobRecord(shopCode, item, uploadPlan) {
    const colorMode = item.file.type.startsWith('image/') ? item.imageMode : (item.pageMode === 'all-color' ? 'color' : 'bw');
    const colorPages = item.file.type.startsWith('image/') ? (item.imageMode === 'color' ? 'Full Image' : '') : (item.pageMode === 'all-color' ? 'All Pages' : (item.colorPages || ''));
    const bwPages = item.file.type.startsWith('image/') ? (item.imageMode === 'bw' ? 'Full Image' : '') : (item.pageMode === 'all-bw' ? 'All Pages' : (item.bwPages || ''));
    const response = await fetch(`${API_URL}/job/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopCode, fileUrl: uploadPlan.fileUrl, objectKey: uploadPlan.objectKey, uploadTicket: uploadPlan.uploadTicket, fileName: item.file.name, contentType: item.file.type || 'application/octet-stream', copies: Number(item.copies || 1), colorMode, colorPages, bwPages, paperSize: item.paperSize || 'A4', orientation: item.orientation || 'portrait', duplex: item.duplex || 'simplex', scale: item.scale || 'fit' }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not save job metadata');
}

function normalizeShopCode(value) { return String(value || '').trim().replace(/[<>]/g, '').toUpperCase(); }

function prepareIncomingFiles(selectedFiles) {
    const validFiles = [], invalidFiles = [];
    for (const file of selectedFiles) {
        if (!isAllowedFileType(file)) { invalidFiles.push(`${file.name}: unsupported type`); continue; }
        if (file.size <= 0 || file.size > 100 * 1024 * 1024) { invalidFiles.push(`${file.name}: must be 1B to 100MB`); continue; }
        validFiles.push({ file, ...DEFAULT_PRINT_SETTINGS });
    }
    return { validFiles, invalidFiles };
}

function isAllowedFileType(file) { return new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png']).has(file.type); }

function validateSubmission({ customerName, files }) {
    if (!customerName.trim()) return 'Enter your name.';
    if (files.length === 0) return 'Add at least one file.';
    for (const item of files) {
        if (!item.file.type.startsWith('image/') && item.pageMode === 'custom' && !item.colorPages.trim() && !item.bwPages.trim()) return `Add page ranges for ${item.file.name}.`;
        const copies = Number(item.copies || 1);
        if (!Number.isFinite(copies) || copies < 1 || copies > 20) return `Copies for ${item.file.name} must be 1-20.`;
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
        getRequest.onsuccess = () => { const files = Array.isArray(getRequest.result?.files) ? getRequest.result.files : []; const del = store.delete('latest'); del.onerror = () => reject(del.error); del.onsuccess = () => resolve(files); };
    });
}

function openSharedFilesDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(SHARED_FILES_DB, 1);
        request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(SHARED_FILES_STORE)) db.createObjectStore(SHARED_FILES_STORE); };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}
