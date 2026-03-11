// Load dotenv from backend's node_modules so this script runs regardless of CWD
const dotenv = require(require('path').join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: __dirname + '/../backend/.env' });
const { Pool } = require(require('path').join(__dirname, '../backend/node_modules/pg'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function migrate() {
    try {
        // Add price columns
        await pool.query(`
            ALTER TABLE shops 
            ADD COLUMN IF NOT EXISTS color_price DECIMAL(10,2) DEFAULT 10.00,
            ADD COLUMN IF NOT EXISTS bw_price DECIMAL(10,2) DEFAULT 5.00
        `);
        console.log('✓ Price columns added');

        // Add password hash column for shop credentials
        await pool.query(`
            ALTER TABLE shops
            ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)
        `);
        console.log('✓ password_hash column ensured');

        // Ensure shops have subscription_end column (single-column approach)
        await pool.query(`
            ALTER TABLE shops
            ADD COLUMN IF NOT EXISTS subscription_end TIMESTAMP WITH TIME ZONE
        `);
        console.log('✓ subscription_end column ensured on shops');

        process.exit(0);
    } catch (error) {
        console.error('Migration error:', error);
        process.exit(1);
    }
}

migrate();
