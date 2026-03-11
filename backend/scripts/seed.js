import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { queries } from '../src/db/sqlite.js';
import db from '../src/db/sqlite.js';

// Test shop accounts
const testShops = [
  {
    shopCode: 'SHOP001',
    password: 'password123',
    name: 'Downtown Print Shop',
    email: 'downtown@example.com',
  },
  {
    shopCode: 'SHOP002',
    password: 'password123',
    name: 'Uptown Copy Center',
    email: 'uptown@example.com',
  },
  {
    shopCode: 'DEMO',
    password: 'demo123',
    name: 'Demo Print Shop',
    email: 'demo@example.com',
  },
];

async function seed() {
  console.log('🌱 Seeding test data...');

  try {
    for (const shop of testShops) {
      // Check if shop already exists
      const existing = queries.getShopByCode.get(shop.shopCode);
      
      if (existing) {
        console.log(`⏭️  Shop ${shop.shopCode} already exists, skipping`);
        continue;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(shop.password, 12);

      // Create shop
      queries.createShop.run(
        shop.shopCode,
        passwordHash,
        shop.name,
        shop.email
      );

      console.log(`✅ Created shop: ${shop.shopCode}`);
      console.log(`   Name: ${shop.name}`);
      console.log(`   Email: ${shop.email}`);
      console.log(`   Password: ${shop.password}`);
      console.log('');
    }

    console.log('✅ Seeding completed!');
    console.log('');
    console.log('Test Accounts:');
    console.log('─────────────────────────────────────');
    testShops.forEach(shop => {
      console.log(`Shop Code: ${shop.shopCode}`);
      console.log(`Password:  ${shop.password}`);
      console.log('─────────────────────────────────────');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
