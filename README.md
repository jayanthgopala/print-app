# Print App

Remote printing platform with:

- `backend`: Hono API deployed through Cloudflare Workers
- `frontend`: React + Vite web app
- `pc-client`: Electron desktop client for shop PCs

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

```bash
cd pc-client
npm install
cp .env.example .env
npm start
```

## Notes

- The backend is intended to run on Cloudflare Workers.
- The device relay still runs on the Node backend path.
- Each app folder includes its own `.env.example`.

## Cloudflare Deployment

### Backend to Workers

The backend Worker lives in [`backend/wrangler.toml`](C:\Users\jayanth gopala v\Desktop\New folder (4)\backend\wrangler.toml) and uses D1.

Required Worker vars:

- `JWT_SECRET`: strong random secret, at least 32 characters
- `CORS_ORIGIN`: your Pages origin, or a comma-separated allowlist of origins
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`

Deploy commands:

```bash
cd backend
npm install
npx wrangler deploy
```

Useful follow-up commands:

```bash
cd backend
npx wrangler d1 execute print_app --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

### Frontend to Pages

The frontend is a static Vite app. Set these Pages environment variables before deploying:

- `VITE_API_URL=https://<your-worker-subdomain>.workers.dev`
- `VITE_ENABLE_WEBSOCKET_UPDATES=false`

Optional:

- `VITE_WS_URL=wss://<your-node-relay-host>`

Deploy commands:

```bash
cd frontend
npm install
npm run build
npx wrangler pages deploy dist
```

Cloudflare Pages also needs SPA fallback routing. This repo includes [`frontend/public/_redirects`](C:\Users\jayanth gopala v\Desktop\New folder (4)\frontend\public\_redirects) for that.
