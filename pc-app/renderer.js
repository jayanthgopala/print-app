let orders = [];
let customerGroups = new Map();
let colorPrice = 0;
let bwPrice = 0;
let currentPrintJob = null;
let colorPrinter = '';
let bwPrinter = '';

window.addEventListener('DOMContentLoaded', async () => {
    const settings = await window.electronAPI.getSettings();
    document.getElementById('shopId').value = settings.shopId || '';
    const pwdEl = document.getElementById('shopPassword');
    if (pwdEl) pwdEl.value = settings.password || '';
    document.getElementById('downloadPath').value = settings.downloadPath || '';
    
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
        bwPrinter: document.getElementById('bwPrinter').value
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
        document.getElementById('qrCode').innerHTML = `<img src="${result.qrDataUrl}" alt="QR Code">`;
        document.getElementById('qrSection').style.display = 'block';
    } else {
        showMessage('Error generating QR: ' + result.message, 'error');
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
        document.getElementById('orderList').innerHTML = '<p style="text-align:center; color:#999; padding:40px;">No orders yet</p>';
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
        const allPrinted = customerOrders.every(o => o.printed);
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
                            <div>
                                <div><strong>File:</strong> ${escapeHtml(order.fileName)}</div>
                                ${order.colorPages ? `<div style="font-size:13px;"><strong>Color Pages:</strong> ${escapeHtml(order.colorPages)} (@ ₹${colorPrice}/page)</div>` : ''}
                                ${order.bwPages ? `<div style="font-size:13px;"><strong>B&W Pages:</strong> ${escapeHtml(order.bwPages)} (@ ₹${bwPrice}/page)</div>` : ''}
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
                   placeholder="e.g., 1-5,8,10" 
                   style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
            <div style="margin-top: 5px; color: #666; font-size: 12px;">Printer: ${colorPrinter || 'Not set'}</div>
        </div>
        <div style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">B&W Pages:</label>
            <input type="text" id="editBWPages" value="${escapeHtml(order.bwPages || '')}" 
                   placeholder="e.g., 6-7,9" 
                   style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 6px;">
            <div style="margin-top: 5px; color: #666; font-size: 12px;">Printer: ${bwPrinter || 'Not set'}</div>
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
    
    if (!colorPages && !bwPages) {
        alert('Please specify at least color pages or B&W pages');
        return;
    }
    
    try {
        const results = [];
        
        // Print color pages if specified
        if (colorPages && colorPrinter) {
            const result = await window.electronAPI.printFile(filePath, {
                printerName: colorPrinter,
                isColor: true,
                pageRanges: colorPages
            });
            results.push(`Color pages (${colorPages}): ${result.success ? 'Sent to printer' : result.message}`);
        }
        
        // Print B&W pages if specified
        if (bwPages && bwPrinter) {
            const result = await window.electronAPI.printFile(filePath, {
                printerName: bwPrinter,
                isColor: false,
                pageRanges: bwPages
            });
            results.push(`B&W pages (${bwPages}): ${result.success ? 'Sent to printer' : result.message}`);
        }
        
        // Show results
        if (results.length > 0) {
            const totalPages = (colorPages ? colorPages.split(',').length : 0) + (bwPages ? bwPages.split(',').length : 0);
            alert('Print Job Queued!\n\n' + results.join('\n') + '\n\n⏳ Large print jobs may take a few minutes to process.\nYou can continue working while printing happens in the background.');
            
            // Mark order as printed
            const order = orders.find(o => o.id === orderId);
            if (order) {
                order.printed = true;
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

function closePrintModal() {
    document.getElementById('printModal').style.display = 'none';
    currentPrintJob = null;
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}
