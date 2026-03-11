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
