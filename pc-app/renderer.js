let orders = [];
let customerGroups = new Map();
let colorPrice = 0;
let bwPrice = 0;
let currentPrintJob = null;
let colorPrinter = '';
let bwPrinter = '';
let currentQrDataUrl = '';

window.addEventListener('DOMContentLoaded', async () => {
    const settings = await window.electronAPI.getSettings();
    document.getElementById('shopId').value = settings.shopId || '';
    const pwdEl = document.getElementById('shopPassword');
    if (pwdEl) pwdEl.value = settings.password || '';
    document.getElementById('downloadPath').value = settings.downloadPath || '';
    const uploadPublicUrlEl = document.getElementById('uploadPublicUrl');
    if (uploadPublicUrlEl) uploadPublicUrlEl.value = settings.uploadPublicUrl || '';
    const uploadPortEl = document.getElementById('uploadPort');
    if (uploadPortEl) uploadPortEl.value = settings.uploadPort || 8788;
    
    // Only set prices if they exist in settings, otherwise leave empty for user to enter
    if (settings.colorPrice) {
        document.getElementById('colorPrice').value = settings.colorPrice;
        colorPrice = settings.colorPrice;
    }
    if (settings.bwPrice) {
        document.getElementById('bwPrice').value = settings.bwPrice;
        bwPrice = settings.bwPrice;
    }
    
    colorPrinter = settings.colorPrinter || '';
    bwPrinter = settings.bwPrinter || '';

    await loadPrinters();

    window.electronAPI.onFileReceived((order) => {
        if (orders.some(existing => existing.filePath === order.filePath)) {
            return;
        }
        const orderId = Date.now();
        const orderWithId = { ...order, id: orderId, timestamp: new Date().toLocaleString(), printed: false, skipped: false };
        orders.push(orderWithId);
        
        // Group by customer
        const customerKey = order.customerName || 'Unknown';
        if (!customerGroups.has(customerKey)) {
            customerGroups.set(customerKey, []);
        }
        customerGroups.get(customerKey).push(orderWithId);
        
        renderOrders();
    });
});

async function loadPrinters() {
    try {
        const colorSelect = document.getElementById('colorPrinter');
        const bwSelect = document.getElementById('bwPrinter');
        
        if (!colorSelect || !bwSelect) {
            console.error('Printer select elements not found');
            return;
        }
        
        colorSelect.innerHTML = '<option value="">Select Color Printer</option>';
        bwSelect.innerHTML = '<option value="">Select B&W Printer</option>';
        
        // Always add common PDF printers
        const defaultPrinters = [
            'Microsoft Print to PDF',
            'Save as PDF',
            'Adobe PDF',
            'Foxit Reader PDF Printer'
        ];
        
        defaultPrinters.forEach(printerName => {
            const colorOption = document.createElement('option');
            colorOption.value = printerName;
            colorOption.textContent = printerName;
            colorSelect.appendChild(colorOption);
            
            const bwOption = document.createElement('option');
            bwOption.value = printerName;
            bwOption.textContent = printerName;
            bwSelect.appendChild(bwOption);
        });
        
        // Try to get system printers
        const result = await window.electronAPI.getPrinters();
        console.log('Printers result:', result);
        
        if (result.success && result.printers && result.printers.length > 0) {
            result.printers.forEach(printer => {
                // Skip if already added as default
                if (!defaultPrinters.includes(printer.name)) {
                    const colorOption = document.createElement('option');
                    colorOption.value = printer.name;
                    colorOption.textContent = printer.name + (printer.isDefault ? ' (Default)' : '');
                    colorSelect.appendChild(colorOption);
                    
                    const bwOption = document.createElement('option');
                    bwOption.value = printer.name;
                    bwOption.textContent = printer.name + (printer.isDefault ? ' (Default)' : '');
                    bwSelect.appendChild(bwOption);
                }
            });
            console.log(`Loaded ${result.printers.length} system printers`);
        }
        
        // Restore saved selections
        if (colorPrinter) colorSelect.value = colorPrinter;
        if (bwPrinter) bwSelect.value = bwPrinter;
        
        console.log('Printers loaded successfully');
    } catch (error) {
        console.error('Error loading printers:', error);
    }
}

async function selectFolder() {
    const path = await window.electronAPI.selectFolder();
    if (path) {
        document.getElementById('downloadPath').value = path;
    }
}


async function saveAndStart() {
    const settings = {
        shopId: document.getElementById('shopId').value,
        password: (document.getElementById('shopPassword') ? document.getElementById('shopPassword').value : ''),
        downloadPath: document.getElementById('downloadPath').value,
        colorPrice: parseFloat(document.getElementById('colorPrice').value),
        bwPrice: parseFloat(document.getElementById('bwPrice').value),
        colorPrinter: document.getElementById('colorPrinter').value,
        bwPrinter: document.getElementById('bwPrinter').value,
        uploadPublicUrl: document.getElementById('uploadPublicUrl') ? document.getElementById('uploadPublicUrl').value : '',
        uploadPort: document.getElementById('uploadPort') ? document.getElementById('uploadPort').value : '8788'
    };

    // Require a shop code and password before proceeding to save/start
    if (!settings.shopId || String(settings.shopId).trim() === '' || !settings.password || String(settings.password).trim() === '') {
        showMessage('please make sure you have entered correct shop name and password', 'error');
        return;
    }

    // Update local variables immediately
    colorPrice = settings.colorPrice;
    bwPrice = settings.bwPrice;
    colorPrinter = settings.colorPrinter;
    bwPrinter = settings.bwPrinter;

    const saveResult = await window.electronAPI.saveSettings(settings);
    if (!saveResult.success) {
        const msg = (saveResult.message || '').toLowerCase();
        const authIndicators = ['invalid credentials', 'login failed', 'password', 'credentials', '403', 'missing credentials'];
        const isAuth = authIndicators.some(ind => msg.includes(ind));
        if (isAuth) {
            showMessage('please make sure you have entered correct shop name and password', 'error');
        } else {
            showMessage('Error: ' + saveResult.message, 'error');
        }
        return;
    }

    // Ensure login succeeded and we have a token before starting
    if (!saveResult.token) {
        showMessage('please make sure you have entered correct shop name and password', 'error');
        return;
    }

    const result = await window.electronAPI.startService();
    if (result.success) {
        clearMessage();
        document.getElementById('statusBadge').textContent = 'Online';
        document.getElementById('statusBadge').className = 'status online';
        showMessage(`Upload server ready on port ${result.config.uploadPort}${result.config.uploadPublicUrl ? ` | Public URL: ${result.config.uploadPublicUrl}` : ''}`, 'success');
    } else {
        showMessage('Error: ' + result.message, 'error');
    }
}

async function showQR() {
    const shopId = document.getElementById('shopId').value;
    if (!shopId) {
        showMessage('Please enter a shop code first', 'error');
        return;
    }

    const result = await window.electronAPI.generateQR(shopId);
    if (result.success) {
        currentQrDataUrl = result.qrDataUrl;
        document.getElementById('qrCode').innerHTML = `<img src="${result.qrDataUrl}" alt="QR Code">`;
        document.getElementById('qrSection').style.display = 'block';
    } else {
        showMessage('Error generating QR: ' + result.message, 'error');
    }
}

function closeQR() {
    document.getElementById('qrSection').style.display = 'none';
}

async function printQR() {
    const shopId = document.getElementById('shopId').value;
    if (!shopId) {
        showMessage('Please enter a shop code first', 'error');
        return;
    }

    if (!currentQrDataUrl) {
        await showQR();
    }

    if (!currentQrDataUrl) {
        showMessage('QR code is not ready to print', 'error');
        return;
    }

    const result = await window.electronAPI.printQR({
        shopId,
        qrDataUrl: currentQrDataUrl
    });

    if (result.success) {
        showMessage(result.message || 'QR sent to printer', 'success');
    } else {
        showMessage('Error printing QR: ' + result.message, 'error');
    }
}

function showMessage(text, type = 'error') {
    const el = document.getElementById('uiMessage');
    if (!el) {
        alert(text);
        return;
    }
    el.style.display = 'block';
    el.textContent = text;
    if (type === 'error') {
        el.style.background = '#fdecea';
        el.style.color = '#611a15';
        el.style.border = '1px solid #f5c6cb';
    } else {
        el.style.background = '#e9f7ef';
        el.style.color = '#155724';
        el.style.border = '1px solid #c3e6cb';
    }
}

function clearMessage() {
    const el = document.getElementById('uiMessage');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
    el.style.border = '';
}

function renderOrders() {
    const activeOrders = orders.filter(o => !o.printed && !o.skipped);
    document.getElementById('orderCount').textContent = activeOrders.length;

    if (activeOrders.length === 0) {
        document.getElementById('orderList').innerHTML = '<div class="orders-empty">No orders yet</div>';
        return;
    }

    // Group by customer
    const grouped = new Map();
    activeOrders.forEach(order => {
        const key = order.customerName || 'Unknown';
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(order);
    });

    // Convert to array (oldest customer first - FIFO)
    const customerGroups = Array.from(grouped.entries());
    
    // Show only the first customer group
    const html = customerGroups.slice(0, 1).map(([customerName, customerOrders]) => {
        return `
            <div class="customer-group">
                <div class="customer-header">
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <strong>👤 ${escapeHtml(customerName)}</strong>
                        <span style="color:#fff; font-size:13px;">${customerOrders[0].timestamp}</span>
                        <span style="color:#e3f2fd;">📄 ${customerOrders.length} file(s)</span>
                    </div>
                    <button onclick="skipCustomer('${escapeHtml(customerName)}')" class="btn-skip" title="Skip this customer">
                        ⏭️ Skip Customer
                    </button>
                </div>
                ${customerOrders.map(order => `
                    <div class="order-item" style="margin-left:20px;">
                        <div class="order-header">
                            <div class="order-details">
                                <div><strong>File:</strong> ${escapeHtml(order.fileName)}</div>
                                ${order.colorPages ? `<div style="font-size:13px;"><strong>Color Pages:</strong> ${escapeHtml(order.colorPages)} (@ ₹${colorPrice}/page)</div>` : ''}
                                ${order.bwPages ? `<div style="font-size:13px;"><strong>B&W Pages:</strong> ${escapeHtml(order.bwPages)} (@ ₹${bwPrice}/page)</div>` : ''}
                                <div style="font-size:13px;"><strong>Paper:</strong> ${escapeHtml(order.paperSize || 'A4')} | <strong>Layout:</strong> ${escapeHtml(order.orientation || 'portrait')} | <strong>Copies:</strong> ${escapeHtml(order.copies || 1)}</div>
                                <div style="font-size:13px;"><strong>Sides:</strong> ${escapeHtml(order.duplex || 'simplex')} | <strong>Scale:</strong> ${escapeHtml(order.scale || 'fit')}</div>
                            </div>
                            <button class="print-btn" data-filepath="${escapeHtml(order.filePath)}" data-orderid="${order.id}" onclick="printFileFromButton(this)" ${order.printed ? 'disabled' : ''}>
                                ${order.printed ? '✓ Printed' : '🖨️ Print'}
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }).join('');
    
    document.getElementById('orderList').innerHTML = html + 
        (customerGroups.length > 1 ? `<div style="text-align:center; padding:20px; color:#999; background:#f8f9fa; margin-top:10px; border-radius:8px;">⏳ ${customerGroups.length - 1} more customer(s) waiting...</div>` : '');
}

function skipCustomer(customerName) {
    if (confirm(`Skip all orders from ${customerName}? They will be moved to the end of the queue.`)) {
        // Mark all orders from this customer as skipped
        orders.forEach(order => {
            if (order.customerName === customerName && !order.printed) {
                order.skipped = true;

            }
        });
        
        // After a delay, unmark them so they appear at the end
        setTimeout(() => {
            orders.forEach(order => {
                if (order.customerName === customerName && order.skipped) {
                    order.skipped = false;
                }
            });
            renderOrders();
        }, 1000);
        
        renderOrders();
    }
}

async function printFileFromButton(button) {
    const filePath = button.getAttribute('data-filepath');
    const orderId = parseInt(button.getAttribute('data-orderid'));
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return;

    // Store current print job
    currentPrintJob = { filePath, orderId, order };

    // Show print dialog with editable fields
    const modal = document.getElementById('printModal');
    const details = document.getElementById('printDetails');
    
    details.innerHTML = `
        <div><strong>Customer:</strong> ${escapeHtml(order.customerName)}</div>
        <div><strong>File:</strong> ${escapeHtml(order.fileName)}</div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Color Pages:</label>
            <input type="text" id="editColorPages" value="${escapeHtml(order.colorPages || '')}"
                   placeholder="e.g., 1-5,8,10 or 'All Pages'"
                   style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
            <div style="margin-top: 5px; color: #666; font-size: 12px;">
                Printer: ${colorPrinter || 'Not set'}<br>
                Tip: Type "All Pages" to print entire document in color
            </div>
        </div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">B&W Pages:</label>
            <input type="text" id="editBWPages" value="${escapeHtml(order.bwPages || '')}"
                   placeholder="e.g., 6-7,9 or 'All Pages'"
                   style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
            <div style="margin-top: 5px; color: #666; font-size: 12px;">
                Printer: ${bwPrinter || 'Not set'}<br>
                Tip: Type "All Pages" to print entire document in B&W
            </div>
        </div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Paper Size:</label>
            <select id="editPaperSize" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
                ${['A4', 'A3', 'Letter', 'Legal'].map((size) => `<option value="${size}" ${order.paperSize === size ? 'selected' : ''}>${size}</option>`).join('')}
            </select>
        </div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Layout:</label>
            <select id="editOrientation" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
                <option value="portrait" ${order.orientation !== 'landscape' ? 'selected' : ''}>Portrait</option>
                <option value="landscape" ${order.orientation === 'landscape' ? 'selected' : ''}>Landscape</option>
            </select>
        </div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Copies:</label>
            <input type="number" id="editCopies" min="1" max="20" value="${escapeHtml(order.copies || 1)}" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
        </div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Sides:</label>
            <select id="editDuplex" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
                <option value="simplex" ${(order.duplex || 'simplex') === 'simplex' ? 'selected' : ''}>Single Side</option>
                <option value="long-edge" ${order.duplex === 'long-edge' ? 'selected' : ''}>Both Sides</option>
            </select>
        </div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Scale:</label>
            <select id="editScale" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
                <option value="fit" ${(order.scale || 'fit') === 'fit' ? 'selected' : ''}>Fit to Page</option>
                <option value="actual" ${order.scale === 'actual' ? 'selected' : ''}>Actual Size</option>
            </select>
        </div>
    `;
    
    modal.style.display = 'flex';
}

async function confirmPrint() {
    if (!currentPrintJob) return;

    const { filePath, orderId, order } = currentPrintJob;

    // Get edited page ranges
    const colorPages = document.getElementById('editColorPages').value.trim();
    const bwPages = document.getElementById('editBWPages').value.trim();

    // Check if at least one is specified (either as page range or "All Pages")
    if (!colorPages && !bwPages) {
        alert('Please specify at least color pages or B&W pages (or use "All Pages")');
        return;
    }

    const normalizedColorPages = normalizePrintSelection(colorPages);
    const normalizedBWPages = normalizePrintSelection(bwPages);
    const paperSize = document.getElementById('editPaperSize').value;
    const orientation = document.getElementById('editOrientation').value;
    const copies = Math.max(1, parseInt(document.getElementById('editCopies').value || '1', 10));
    const duplex = document.getElementById('editDuplex').value;
    const scale = document.getElementById('editScale').value;

    if (paperSize !== 'A4') {
        const proceed = confirm(`Warning: this job is set to ${paperSize}, not A4. Make sure ${paperSize} paper is loaded before printing. Continue?`);
        if (!proceed) {
            return;
        }
    }

    try {
        const results = [];

        // Print color pages if specified
        if (colorPages && colorPrinter) {
            const result = await window.electronAPI.printFile(filePath, {
                printerName: colorPrinter,
                isColor: true,
                pageRanges: normalizedColorPages,
                paperSize,
                orientation,
                copies,
                duplex,
                scale
            });
            results.push(`Color ${describePrintSelection(normalizedColorPages)}: ${result.success ? 'Sent to printer' : result.message}`);
        }

        // Print B&W pages if specified
        if (bwPages && bwPrinter) {
            const result = await window.electronAPI.printFile(filePath, {
                printerName: bwPrinter,
                isColor: false,
                pageRanges: normalizedBWPages,
                paperSize,
                orientation,
                copies,
                duplex,
                scale
            });
            results.push(`B&W ${describePrintSelection(normalizedBWPages)}: ${result.success ? 'Sent to printer' : result.message}`);
        }

        // Show results
        if (results.length > 0) {
            alert('Print Job Queued!\n\n' + results.join('\n') + '\n\n⏳ Large print jobs may take a few minutes to process.\nYou can continue working while printing happens in the background.');

            // Mark order as printed
            const order = orders.find(o => o.id === orderId);
            if (order) {
                order.printed = true;
            }

            // Delete the file after successful print
            try {
                const deleteResult = await window.electronAPI.deleteFile(filePath);
                if (!deleteResult.success) {
                    console.error('Failed to delete file:', deleteResult.message);
                }
            } catch (error) {
                console.error('Error deleting file:', error);
            }

            renderOrders();
            closePrintModal();
        } else {
            alert('No pages were printed');
        }
    } catch (error) {
        alert('Print error: ' + error.message);
    }
}

function convertPageRangesToElectron(pageStr) {
    // Convert "1-5,8,10" format to Electron format
    // For now, return as-is since Electron supports this format
    return pageStr.replace(/\s/g, '');
}

function normalizePrintSelection(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    const lowered = normalized.toLowerCase();
    if (lowered === 'all pages' || lowered === 'full image' || lowered === 'all' || lowered === 'all_pages') {
        return '';
    }

    return normalized;
}

function describePrintSelection(value) {
    if (!value || value === '') {
        return 'pages (all)';
    }

    return `pages (${value})`;
}

function closePrintModal() {
    document.getElementById('printModal').style.display = 'none';
    currentPrintJob = null;
}

async function openNativePrintDialog() {
    if (!currentPrintJob) return;

    const { filePath } = currentPrintJob;

    try {
        const result = await window.electronAPI.openNativePrintDialog(filePath);
        if (result.success) {
            showMessage('Native printer dialog opened', 'success');
        } else {
            showMessage('Failed to open printer dialog: ' + result.message, 'error');
        }
    } catch (error) {
        showMessage('Error opening printer dialog: ' + error.message, 'error');
    }
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

renderOrders = function renderOrdersPatched() {
    const activeOrders = orders.filter((o) => !o.printed && !o.skipped);
    document.getElementById('orderCount').textContent = activeOrders.length;

    if (activeOrders.length === 0) {
        document.getElementById('orderList').innerHTML = '<div class="orders-empty">No orders yet</div>';
        return;
    }

    const grouped = new Map();
    activeOrders.forEach((order) => {
        const key = order.customerName || 'Unknown';
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(order);
    });

    const customerGroups = Array.from(grouped.entries());
    const html = customerGroups.slice(0, 1).map(([customerName, customerOrders]) => `
        <div class="customer-group">
            <div class="customer-header">
                <div style="display:flex; align-items:center; gap:10px; flex:1; flex-wrap:wrap;">
                    <strong>Customer: ${escapeHtml(customerName)}</strong>
                    <span style="color:#fff; font-size:13px;">${customerOrders[0].timestamp}</span>
                    <span style="color:#e3f2fd;">${customerOrders.length} file(s)</span>
                </div>
                <button onclick="skipCustomer('${escapeHtml(customerName)}')" class="btn-skip" title="Skip this customer">
                    Skip Customer
                </button>
            </div>
            ${customerOrders.map((order) => `
                <div class="order-item" style="margin-left:20px;">
                    <div class="order-header">
                        <div class="order-details">
                            <div><strong>File:</strong> ${escapeHtml(order.fileName)}</div>
                            ${order.colorPages ? `<div style="font-size:13px;"><strong>Color Pages:</strong> ${escapeHtml(order.colorPages)} (@ Rs ${colorPrice}/page)</div>` : ''}
                            ${order.bwPages ? `<div style="font-size:13px;"><strong>B&W Pages:</strong> ${escapeHtml(order.bwPages)} (@ Rs ${bwPrice}/page)</div>` : ''}
                            <div style="font-size:13px;"><strong>Paper:</strong> ${escapeHtml(order.paperSize || 'A4')} | <strong>Layout:</strong> ${escapeHtml(order.orientation || 'portrait')} | <strong>Copies:</strong> ${escapeHtml(order.copies || 1)}</div>
                            <div style="font-size:13px;"><strong>Sides:</strong> ${escapeHtml(order.duplex || 'simplex')} | <strong>Scale:</strong> ${escapeHtml(order.scale || 'fit')}</div>
                        </div>
                        <button class="print-btn" data-filepath="${escapeHtml(order.filePath)}" data-orderid="${order.id}" onclick="printFileFromButton(this)" ${order.printed ? 'disabled' : ''}>
                            ${order.printed ? 'Printed' : 'Print'}
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `).join('');

    document.getElementById('orderList').innerHTML = html +
        (customerGroups.length > 1 ? `<div class="orders-empty">${customerGroups.length - 1} more customer(s) waiting...</div>` : '');
};
