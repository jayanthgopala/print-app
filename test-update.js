async function testUpdate() {
    try {
        const API = process.env.API_URL;
        if (!API) throw new Error('Set API_URL environment variable before running this script');
        const response = await fetch(`${API.replace(/\/$/, '')}/shop/update-prices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopCode: 'SHOP001',
                colorPrice: 15,
                bwPrice: 7
            })
        });
        
        const text = await response.text();
        console.log('Response status:', response.status);
        console.log('Response body:', text);
        
        if (response.ok) {
            const data = JSON.parse(text);
            console.log('Success! Updated prices:', data);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testUpdate();
