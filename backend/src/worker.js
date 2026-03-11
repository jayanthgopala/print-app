import { createApp } from './app.js';
import { initializeDatabase } from './db/sqlite.js';

const app = createApp();

export default {
  async fetch(request, env, ctx) {
    await initializeDatabase(env);
    return app.fetch(request, env, ctx);
  },
};
