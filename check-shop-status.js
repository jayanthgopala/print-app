#!/usr/bin/env node

/**
 * Database Status Checker
 * Checks the current status of your shop in the Cloudflare D1 database
 */

const API_URL = 'https://print-app-backend.jayanthgopala21.workers.dev';
const SHOP_CODE = 'SHOP001';

console.log('========================================');
console.log(' Print Shop Database Status Checker');
console.log('========================================\n');

async function checkShopStatus() {
    try {
        console.log(`Checking status for shop: ${SHOP_CODE}`);
        console.log(`API URL: ${API_URL}\n`);

        const response = await fetch(`${API_URL}/shop/public/${encodeURIComponent(SHOP_CODE)}`);
        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Error:', data.error);
            return;
        }

        console.log('✅ Shop found in database!\n');
        console.log('Shop Details:');
        console.log('─────────────────────────────────────');
        console.log(`Shop Code:       ${data.shop.code}`);
        console.log(`Shop Name:       ${data.shop.name}`);
        console.log(`Status:          ${data.shop.status || 'unknown'}`);
        console.log(`PC Endpoint:     ${data.shop.pcEndpoint || '❌ NOT SET (This is the problem!)'}`);
        console.log(`Color Price:     ${data.shop.colorPrice || 'not set'}`);
        console.log(`B/W Price:       ${data.shop.bwPrice || 'not set'}`);
        console.log('─────────────────────────────────────\n');

        // Diagnosis
        console.log('Diagnosis:');
        console.log('─────────────────────────────────────');
        
        if (!data.shop.pcEndpoint) {
            console.log('❌ ISSUE FOUND: PC Endpoint is NOT SET');
            console.log('\nThis is why the frontend shows "Shop is offline".');
            console.log('\nTo fix:');
            console.log('1. Set up a Cloudflare tunnel (see TUNNEL-SETUP-GUIDE.md)');
            console.log('2. Open the PC app');
            console.log('3. Enter the tunnel URL in the "Upload Public URL" field');
            console.log('4. Click "Save and Connect"');
        } else if (data.shop.status !== 'online') {
            console.log('❌ ISSUE FOUND: Status is not "online"');
            console.log('\nThe PC app needs to be running and connected.');
        } else {
            console.log('✅ Everything looks good!');
            console.log('If the frontend still shows offline, try:');
            console.log('1. Clear browser cache and reload');
            console.log('2. Check browser console (F12) for errors');
            console.log('3. Verify the shop code in the URL matches');
        }
        console.log('─────────────────────────────────────\n');

    } catch (error) {
        console.error('❌ Failed to check status:', error.message);
        console.error('\nPossible causes:');
        console.error('- Network connectivity issues');
        console.error('- Backend API is down');
        console.error('- CORS issues');
    }
}

// Run the check
checkShopStatus();
