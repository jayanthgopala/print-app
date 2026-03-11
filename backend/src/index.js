import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { initializeDatabase } from './db/sqlite.js';
import { initializeWebSocketServer } from './websocket/deviceManager.js';

const app = createApp();

async function startServer() {
  try {
    console.log('Starting Cloud Printing Platform...');

    console.log('Initializing databases...');
    await initializeDatabase();

    console.log('Starting WebSocket server...');
    await initializeWebSocketServer(process.env.WS_PORT);

    const port = process.env.PORT || 3000;
    console.log(`Starting HTTP server on port ${port}...`);

    serve({
      fetch: app.fetch,
      port: parseInt(port, 10),
    });

    console.log(`Server running on http://localhost:${port}`);
    console.log(`WebSocket server running on ws://localhost:${process.env.WS_PORT || 3001}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

startServer();
