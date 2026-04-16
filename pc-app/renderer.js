/* ═══════════════════════════════════════════════════
   Print Shop Manager – Renderer
   ═══════════════════════════════════════════════════ */

let orders = [];
let printHistory = [];
let colorPrice = 0;
let bwPrice = 0;
let printedToday = 0;
let currentPrintJob = null;
let colorPrinter = '';
let bwPrinter = '';
let currentQrDataUrl = '';
let collapsedGroups = new Set();
let notifSound = true;

// ── Bootstrap ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    initTabs();

    const settings = await window.electronAPI.getSettings();
    document.getElementById('shopId').value = settings.shopId || '';
    const pwdEl = document.getElementById('shopPassword');
    if (pwdEl) pwdEl.value = settings.password || '';
    document.getElementById('downloadPath').value = settings.downloadPath || '';

    if (settings.colorPrice) { document.getElementById('colorPrice').value = settings.colorPrice; colorPrice = settings.colorPrice; }
    if (settings.bwPrice) { document.getElementById('bwPrice').value = settings.bwPrice; bwPrice = settings.bwPrice; }
    colorPrinter = settings.colorPrinter || '';
    bwPrinter = settings.bwPrinter || '';
    notifSound = settings.notifSound !== false;
    document.getElementById('toggleSound').checked = notifSound;

    await loadPrinters();

    // IPC listeners
    window.electronAPI.onTunnelStatus((data) => {
        const badge = document.getElementById('statusBadge');
        if (data.status === 'online') {
            badge.textContent = 'Online';
            badge.className = 'topbar-status online';
            toast('Service is online and polling for jobs.', 'success');
        } else {
            badge.textContent = 'Offline';
            badge.className = 'topbar-status offline';
            toast(formatError(data), 'error');
        }
    });

    window.electronAPI.onFileReceived((order) => {
        if (orders.some(o => o.jobId === order.jobId)) return;
        orders.push(order);
        renderQueue();
        updateStats();
        if (notifSound) playNotifSound();
        toast(`New file: ${order.fileName}`, 'info');
    });

    window.electronAPI.onJobProcessed(({ jobId }) => {
        const order = orders.find(o => o.jobId === jobId);
        if (order) { order.printed = true; renderQueue(); updateStats(); }
    });

    renderQueue();
    updateStats();

    // Auto-start if credentials exist
    if (settings.shopId && settings.password && settings.token) {
        autoStart();
    }
});

async function autoStart() {
    const badge = document.getElementById('statusBadge');
    badge.textContent = 'Connecting';
    badge.className = 'topbar-status offline';
    const result = await window.electronAPI.startService();
    if (result.success) {
        badge.textContent = 'Online';
        badge.className = 'topbar-status online';
        toast('Auto-connected. Receiving jobs.', 'success');
    }
}

// ── Tabs ──────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
}

// ── Stats ─────────────────────────────────────────
function updateStats() {
    const active = orders.filter(o => !o.printed && !o.skipped);
    document.getElementById('statPending').textContent = `Pending: ${active.length}`;
    document.getElementById('statPrinted').textContent = `Printed: ${printedToday}`;
    const badge = document.getElementById('queueBadge');
    if (active.length > 0) { badge.style.display = 'inline-flex'; badge.textContent = active.length; }
    else { badge.style.display = 'none'; }
}

// ── Queue Rendering ───────────────────────────────
function renderQueue() {
    const container = document.getElementById('orderList');
    const active = orders.filter(o => !o.printed && !o.skipped);

    if (active.length === 0) {
        container.innerHTML = `
            <div class="queue-empty">
                <div class="queue-empty-icon">&#128424;</div>
                <div class="queue-empty-text">No print jobs in queue</div>
                <div class="queue-empty-sub">Jobs will appear here when customers send files.</div>
            </div>`;
        return;
    }

    const grouped = new Map();
    active.forEach(order => {
        const key = order.customerName || 'Unknown';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(order);
    });

    let html = '';
    for (const [name, customerOrders] of grouped) {
        const isCollapsed = collapsedGroups.has(name);
        html += `
        <div class="cgroup">
            <div class="cgroup-header" onclick="toggleGroup('${esc(name)}')">
                <div class="cgroup-meta">
                    <span class="cgroup-name">${esc(name)}</span>
                    <span class="cgroup-badge">${customerOrders.length} file${customerOrders.length > 1 ? 's' : ''}</span>
                    <span class="cgroup-time">${customerOrders[0].timestamp}</span>
                </div>
                <button class="btn-skip-cust" onclick="event.stopPropagation();skipCustomer('${esc(name)}')">Skip</button>
            </div>
            <div class="cgroup-body ${isCollapsed ? 'collapsed' : ''}">
                ${customerOrders.map(order => renderJobCard(order)).join('')}
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

function renderJobCard(order) {
    const ext = (order.fileName || '').split('.').pop().toLowerCase();
    let iconClass = 'doc', iconText = 'D';
    if (ext === 'pdf') { iconClass = 'pdf'; iconText = 'P'; }
    else if (['jpg','jpeg','png'].includes(ext)) { iconClass = 'img'; iconText = 'I'; }

    const tags = [];
    if (order.colorPages) tags.push(`<span class="jtag jtag-color">Color: ${esc(order.colorPages)}</span>`);
    if (order.bwPages) tags.push(`<span class="jtag jtag-bw">B&W: ${esc(order.bwPages)}</span>`);
    tags.push(`<span class="jtag jtag-paper">${esc(order.paperSize || 'A4')}</span>`);
    if (Number(order.copies) > 1) tags.push(`<span class="jtag jtag-copies">${order.copies}x</span>`);

    return `
    <div class="job-card">
        <div class="job-icon ${iconClass}">${iconText}</div>
        <div class="job-body">
            <div class="job-filename">${esc(order.fileName)}</div>
            <div class="job-meta">${esc(order.orientation || 'portrait')} | ${esc(order.duplex || 'simplex')} | ${esc(order.scale || 'fit')}</div>
            <div class="job-tags">${tags.join('')}</div>
        </div>
        <div class="job-actions">
            <button class="btn-print-job" data-filepath="${esc(order.filePath)}" data-orderid="${esc(order.id)}" onclick="printFileFromButton(this)" ${order.printed ? 'disabled' : ''}>
                ${order.printed ? 'Done' : 'Print'}
            </button>
        </div>
    </div>`;
}

function toggleGroup(name) {
    if (collapsedGroups.has(name)) collapsedGroups.delete(name);
    else collapsedGroups.add(name);
    renderQueue();
}

function skipCustomer(customerName) {
    if (!confirm(`Skip all orders from ${customerName}?`)) return;
    orders.forEach(o => { if (o.customerName === customerName && !o.printed) o.skipped = true; });
    renderQueue();
    updateStats();
    setTimeout(() => {
        orders.forEach(o => { if (o.customerName === customerName && o.skipped) o.skipped = false; });
        renderQueue();
        updateStats();
    }, 1500);
}

// ── Print Flow ────────────────────────────────────
async function printFileFromButton(button) {
    const filePath = button.getAttribute('data-filepath');
    const orderId = button.getAttribute('data-orderid');
    const order = orders.find(o => String(o.id) === String(orderId));

    if (!order) { toast('Order not found. Try restarting the app.', 'error'); return; }
    currentPrintJob = { filePath, orderId, order };

    const details = document.getElementById('printDetails');
    details.innerHTML = `
        <div class="modal-field">
            <div class="modal-field-label">Customer</div>
            <div class="modal-field-value">${esc(order.customerName)}</div>
        </div>
        <div class="modal-field">
            <div class="modal-field-label">File</div>
            <div class="modal-field-value">${esc(order.fileName)}</div>
        </div>
        <div class="modal-sep"></div>
        <div class="modal-field">
            <div class="modal-field-label">Color Pages</div>
            <input type="text" class="modal-field-input" id="editColorPages" value="${esc(order.colorPages || '')}" placeholder="e.g. 1-5,8,10 or All Pages">
            <div class="modal-field-hint">Printer: ${esc(colorPrinter || 'Not set')}</div>
        </div>
        <div class="modal-field">
            <div class="modal-field-label">B&W Pages</div>
            <input type="text" class="modal-field-input" id="editBWPages" value="${esc(order.bwPages || '')}" placeholder="e.g. 6-7,9 or All Pages">
            <div class="modal-field-hint">Printer: ${esc(bwPrinter || 'Not set')}</div>
        </div>
        <div class="modal-grid">
            <div class="modal-field">
                <div class="modal-field-label">Paper</div>
                <select class="modal-field-input" id="editPaperSize">
                    ${['A4','A3','Letter','Legal'].map(s => `<option value="${s}" ${order.paperSize===s?'selected':''}>${s}</option>`).join('')}
                </select>
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Layout</div>
                <select class="modal-field-input" id="editOrientation">
                    <option value="portrait" ${order.orientation!=='landscape'?'selected':''}>Portrait</option>
                    <option value="landscape" ${order.orientation==='landscape'?'selected':''}>Landscape</option>
                </select>
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Copies</div>
                <input type="number" class="modal-field-input" id="editCopies" min="1" max="20" value="${esc(order.copies||1)}">
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Sides</div>
                <select class="modal-field-input" id="editDuplex">
                    <option value="simplex" ${(order.duplex||'simplex')==='simplex'?'selected':''}>Single Side</option>
                    <option value="long-edge" ${order.duplex==='long-edge'?'selected':''}>Both Sides</option>
                </select>
            </div>
        </div>
        <div class="modal-field">
            <div class="modal-field-label">Scale</div>
            <select class="modal-field-input" id="editScale">
                <option value="fit" ${(order.scale||'fit')==='fit'?'selected':''}>Fit to Page</option>
                <option value="actual" ${order.scale==='actual'?'selected':''}>Actual Size</option>
            </select>
        </div>`;

    document.getElementById('printModal').style.display = 'flex';
    setTimeout(() => document.getElementById('editColorPages').focus(), 80);
}

async function confirmPrint() {
    if (!currentPrintJob) return;
    const { filePath, orderId, order } = currentPrintJob;
    const btn = document.getElementById('btnConfirmPrint');
    btn.disabled = true; btn.textContent = 'Printing...';

    const colorPages = document.getElementById('editColorPages').value.trim();
    const bwPages = document.getElementById('editBWPages').value.trim();

    if (!colorPages && !bwPages) {
        toast('Specify color pages or B&W pages.', 'error');
        btn.disabled = false; btn.textContent = 'Print Now';
        return;
    }

    const nColor = normalizeSel(colorPages);
    const nBW = normalizeSel(bwPages);
    const paperSize = document.getElementById('editPaperSize').value;
    const orientation = document.getElementById('editOrientation').value;
    const copies = Math.max(1, parseInt(document.getElementById('editCopies').value || '1', 10));
    const duplex = document.getElementById('editDuplex').value;
    const scale = document.getElementById('editScale').value;

    if (paperSize !== 'A4' && !confirm(`This job uses ${paperSize}. Make sure it is loaded. Continue?`)) {
        btn.disabled = false; btn.textContent = 'Print Now';
        return;
    }

    try {
        const results = [], failures = [];
        if (colorPages && !colorPrinter) throw new Error('Color printer not set in Settings.');
        if (bwPages && !bwPrinter) throw new Error('B&W printer not set in Settings.');

        const mark = await window.electronAPI.updateJobStatus({ jobId: order.jobId, status: 'printing' });
        if (!mark.success) throw new Error(mark.message || 'Backend rejected status update');

        if (colorPages && colorPrinter) {
            const r = await window.electronAPI.printFile(filePath, { printerName: colorPrinter, isColor: true, pageRanges: nColor, paperSize, orientation, copies, duplex, scale });
            (r.success ? results : failures).push(`Color ${descSel(nColor)}: ${r.message || (r.success ? 'OK' : 'Failed')}`);
        }
        if (bwPages && bwPrinter) {
            const r = await window.electronAPI.printFile(filePath, { printerName: bwPrinter, isColor: false, pageRanges: nBW, paperSize, orientation, copies, duplex, scale });
            (r.success ? results : failures).push(`B&W ${descSel(nBW)}: ${r.message || (r.success ? 'OK' : 'Failed')}`);
        }
        if (failures.length) throw new Error(failures.join('\n'));

        if (results.length > 0) {
            const o = orders.find(x => String(x.id) === String(orderId));
            if (o) o.printed = true;
            printedToday++;

            const comp = await window.electronAPI.completeJob({ jobId: order.jobId });
            if (!comp.success) throw new Error(comp.message || 'Could not complete job');

            try { await window.electronAPI.deleteFile(filePath); } catch (_) {}

            addHistory(order.fileName, order.customerName, true);
            renderQueue();
            updateStats();
            closePrintModal();
            toast('Print job sent: ' + results.join(', '), 'success');
        } else {
            await window.electronAPI.updateJobStatus({ jobId: order.jobId, status: 'failed', error: 'no_pages_selected' });
            removeOrder(orderId);
            closePrintModal();
            toast('No pages printed. Job will be retried.', 'error');
        }
    } catch (error) {
        await window.electronAPI.updateJobStatus({ jobId: order.jobId, status: 'failed', error: `print_failed:${error.message}` });
        addHistory(order.fileName, order.customerName, false, error.message);
        removeOrder(orderId);
        closePrintModal();
        toast('Print failed: ' + error.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Print Now';
}

function removeOrder(orderId) {
    const idx = orders.findIndex(o => String(o.id) === String(orderId));
    if (idx !== -1) orders.splice(idx, 1);
    renderQueue();
    updateStats();
}

function closePrintModal() {
    document.getElementById('printModal').style.display = 'none';
    currentPrintJob = null;
}

// ── History ───────────────────────────────────────
function addHistory(fileName, customer, success, error) {
    printHistory.unshift({ fileName, customer, success, error, time: new Date().toLocaleTimeString() });
    if (printHistory.length > 100) printHistory.pop();
    renderHistory();
}

function renderHistory() {
    const el = document.getElementById('historyList');
    if (printHistory.length === 0) { el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:20px 0;text-align:center">No history yet.</div>'; return; }
    el.innerHTML = printHistory.map(h => `
        <div class="history-item">
            <div class="hi-status ${h.success ? 'ok' : 'fail'}"></div>
            <div class="hi-name" title="${esc(h.fileName)}">${esc(h.fileName)}</div>
            <div style="color:var(--text3);font-size:12px">${esc(h.customer)}</div>
            <div class="hi-time">${h.time}</div>
        </div>`).join('');
}

function clearHistory() { printHistory = []; renderHistory(); }

// ── Settings ──────────────────────────────────────
async function loadPrinters() {
    const colorSel = document.getElementById('colorPrinter');
    const bwSel = document.getElementById('bwPrinter');
    if (!colorSel || !bwSel) return;

    colorSel.innerHTML = '<option value="">Select printer</option>';
    bwSel.innerHTML = '<option value="">Select printer</option>';

    const defaults = ['Microsoft Print to PDF','Save as PDF','Adobe PDF','Foxit Reader PDF Printer'];
    defaults.forEach(n => { colorSel.appendChild(new Option(n, n)); bwSel.appendChild(new Option(n, n)); });

    try {
        const r = await window.electronAPI.getPrinters();
        if (r.success && r.printers) {
            r.printers.forEach(p => {
                if (!defaults.includes(p.name)) {
                    const lbl = p.name + (p.isDefault ? ' (Default)' : '');
                    colorSel.appendChild(new Option(lbl, p.name));
                    bwSel.appendChild(new Option(lbl, p.name));
                }
            });
        }
    } catch (_) {}

    if (colorPrinter) colorSel.value = colorPrinter;
    if (bwPrinter) bwSel.value = bwPrinter;
}

async function selectFolder() {
    const p = await window.electronAPI.selectFolder();
    if (p) document.getElementById('downloadPath').value = p;
}

async function saveAndStart() {
    const btn = document.getElementById('btnSaveStart');
    btn.disabled = true; btn.textContent = 'Connecting...';

    const settings = {
        shopId: document.getElementById('shopId').value,
        password: document.getElementById('shopPassword')?.value || '',
        downloadPath: document.getElementById('downloadPath').value,
        colorPrice: parseFloat(document.getElementById('colorPrice').value),
        bwPrice: parseFloat(document.getElementById('bwPrice').value),
        colorPrinter: document.getElementById('colorPrinter').value,
        bwPrinter: document.getElementById('bwPrinter').value
    };

    if (!settings.shopId?.trim() || !settings.password?.trim()) {
        showSettingsMsg('Enter shop code and password.', 'error');
        btn.disabled = false; btn.textContent = 'Save and Start Service'; return;
    }

    colorPrice = settings.colorPrice; bwPrice = settings.bwPrice;
    colorPrinter = settings.colorPrinter; bwPrinter = settings.bwPrinter;

    const save = await window.electronAPI.saveSettings(settings);
    if (!save.success) {
        const msg = (save.message || '').toLowerCase();
        const isAuth = ['invalid credentials','login failed','password','credentials','403'].some(k => msg.includes(k));
        showSettingsMsg(isAuth ? 'Invalid shop code or password.' : formatError(save, true), 'error');
        btn.disabled = false; btn.textContent = 'Save and Start Service'; return;
    }
    if (!save.token) {
        showSettingsMsg('Invalid shop code or password.', 'error');
        btn.disabled = false; btn.textContent = 'Save and Start Service'; return;
    }

    const result = await window.electronAPI.startService();
    if (result.success) {
        hideSettingsMsg();
        document.getElementById('statusBadge').textContent = 'Online';
        document.getElementById('statusBadge').className = 'topbar-status online';
        toast(result.message || 'Service is online.', 'success');
        switchTab('queue');
    } else {
        document.getElementById('statusBadge').textContent = 'Offline';
        document.getElementById('statusBadge').className = 'topbar-status offline';
        showSettingsMsg('Error: ' + result.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Save and Start Service';
}

function showSettingsMsg(text, type) {
    const el = document.getElementById('uiMessage');
    el.style.display = 'block';
    el.textContent = text;
    el.style.background = type === 'error' ? 'var(--red-soft)' : 'var(--green-soft)';
    el.style.color = type === 'error' ? 'var(--red)' : 'var(--green)';
}
function hideSettingsMsg() { document.getElementById('uiMessage').style.display = 'none'; }

// ── QR ────────────────────────────────────────────
async function showQR() {
    const shopId = document.getElementById('shopId').value;
    if (!shopId) { toast('Enter a shop code in Settings first.', 'error'); return; }

    const r = await window.electronAPI.generateQR(shopId);
    if (r.success) {
        currentQrDataUrl = r.qrDataUrl;
        document.getElementById('qrCode').innerHTML = `<img src="${r.qrDataUrl}" alt="QR" style="width:240px;height:240px">`;
        document.getElementById('qrShopLabel').textContent = shopId;
        document.getElementById('qrDisplay').style.display = 'flex';
        document.getElementById('qrPlaceholder').style.display = 'none';
        document.getElementById('btnPrintQR').disabled = false;
    } else {
        toast('QR error: ' + r.message, 'error');
    }
}

async function printQR() {
    const shopId = document.getElementById('shopId').value;
    if (!shopId || !currentQrDataUrl) { toast('Generate QR first.', 'error'); return; }
    const r = await window.electronAPI.printQR({ shopId, qrDataUrl: currentQrDataUrl });
    toast(r.success ? (r.message || 'QR sent to printer.') : ('QR print failed: ' + r.message), r.success ? 'success' : 'error');
}

// ── Toast Notifications ───────────────────────────
function toast(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ── Audio ─────────────────────────────────────────
function toggleNotifSound(checkbox) {
    notifSound = checkbox.checked;
    window.electronAPI.saveNotifSound(notifSound);
}

function playNotifSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch (_) {}
}

// ── Helpers ───────────────────────────────────────
function normalizeSel(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    return ['all pages','full image','all','all_pages'].includes(s.toLowerCase()) ? '' : s;
}
function descSel(v) { return (!v || v === '') ? '(all)' : `(${v})`; }
function formatError(d, prefix) {
    const m = String(d?.message || '').trim() || 'Request failed';
    return prefix ? 'Error: ' + m : m;
}
function esc(t) {
    const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
    return String(t).replace(/[&<>"']/g, c => map[c]);
}

// ── Keyboard shortcuts ────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePrintModal();
    if (e.key === 'Enter' && document.getElementById('printModal').style.display === 'flex') {
        e.preventDefault();
        confirmPrint();
    }
});
