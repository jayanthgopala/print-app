import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import auth from './api/auth.js';
import jobs from './api/jobs.js';
import devices from './api/devices.js';

function getEnvValue(c, key, fallback) {
  const processValue = typeof process !== 'undefined' ? process.env[key] : undefined;
  return c.env?.[key] ?? processValue ?? fallback;
}

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: (_origin, c) => getEnvValue(c, 'CORS_ORIGIN', '*'),
      credentials: true,
    })
  );

  app.get('/health', (c) => {
    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);

    return c.json({
      status: 'healthy',
      runtime: c.env?.DB ? 'cloudflare-worker' : 'node',
      relay: c.env?.DB ? 'disabled' : 'enabled',
      timestamp: new Date().toISOString(),
      uptime: isNode ? process.uptime() : null,
    });
  });

  app.route('/api/auth', auth);
  app.route('/api/jobs', jobs);
  app.route('/api/devices', devices);

  app.get('/', (c) => {
    return c.json({
      name: 'Cloud Printing Platform API',
      version: '1.0.0',
      runtime: c.env?.DB ? 'cloudflare-worker' : 'node',
      endpoints: {
        health: '/health',
        auth: '/api/auth/*',
        jobs: '/api/jobs/*',
        devices: '/api/devices/*',
      },
    });
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((err, c) => {
    console.error('Server error:', err);
    return c.json(
      {
        error: 'Internal server error',
        message: getEnvValue(c, 'NODE_ENV', 'development') === 'development' ? err.message : undefined,
      },
      500
    );
  });

  return app;
}
