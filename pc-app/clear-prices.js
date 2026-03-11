const Store = require('electron-store');
const store = new Store();

// Clear old prices
store.delete('colorPrice');
store.delete('bwPrice');

console.log('Cleared old prices from storage');
console.log('Current settings:', {
    shopId: store.get('shopId'),
    colorPrice: store.get('colorPrice'),
    bwPrice: store.get('bwPrice')
});
