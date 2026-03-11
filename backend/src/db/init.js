import 'dotenv/config';
import { initializeDatabase } from './sqlite.js';

async function init() {
  console.log('Initializing databases...');

  try {
    await initializeDatabase();
    console.log('SQLite database initialized successfully');
    process.exit(0);
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

init();
