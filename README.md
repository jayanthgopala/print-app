# Print Shop File Transfer System

This repository contains the full Print Shop application stack:

- `frontend/`: customer-facing React PWA
- `pc-app/`: Electron app used by the print shop PC
- `backend/`: Node.js signaling and API server
- `frontend-admin/`: admin panel for shop management
- `database/`: schema and migration scripts, including Cloudflare D1 SQLite files

The key design rule is simple: file bytes do not go through the backend. The frontend and PC app transfer files directly using a WebRTC data channel, while the backend only handles authentication, shop availability, and signaling.

## Overview

The system lets a customer open the frontend, choose a shop, and send print files directly to that shop's PC. The print shop PC runs the Electron app, authenticates with the backend, stays online through WebSocket, and receives the transferred files.

Main technologies:

- Frontend: React, Vite, WebRTC, PWA APIs
- PC App: Electron, Node.js, `wrtc`, `ws`
- Backend: Cloudflare Workers, Durable Objects, WebSocket
- Database: Cloudflare D1 (SQLite)

## How Data Flows

1. The PC app logs in using the shop code and password.
2. The backend returns a JWT token.
3. The PC app connects to the backend WebSocket and registers itself as an online shop.
4. The frontend opens with `?shop=<SHOP_CODE>` and connects to the backend WebSocket.
5. The frontend asks whether the shop is online.
6. If the shop is online, the frontend creates a WebRTC offer.
7. The backend forwards the offer to the PC app.
8. The PC app creates a WebRTC answer and sends it back through the backend.
9. ICE candidates are exchanged through the backend until the peer connection is established.
10. Once connected, the frontend sends the actual file directly to the PC app over the WebRTC data channel.
11. The PC app reassembles the chunks, validates the file, saves it locally, and notifies the UI.

## Architecture

### Frontend

- Built with React and Vite.
- Used by customers to choose files and send print instructions.
- Validates file size and file type before transfer.
- Uses WebSocket only for signaling and shop status.
- Uses WebRTC data channels for the actual file transfer.

Important files:

- `frontend/src/App.jsx`
- `frontend/src/services/webrtc.js`
- `frontend/src/config.js`

### PC App

- Built with Electron.
- Stores shop settings locally with `electron-store`.
- Logs in to the backend and keeps the shop online.
- Uses `wrtc` to accept WebRTC offers from the frontend.
- Saves received files to the selected download directory.
- Exposes received file events to the renderer through Electron IPC.

Important files:

- `pc-app/main.js`
- `pc-app/services/fileReceiver.js`
- `pc-app/preload.js`
- `pc-app/renderer.js`

### Backend

- Exposes REST endpoints for login, shop settings, admin operations, and public shop lookup.
- Hosts a WebSocket server for signaling.
- Tracks online shops and active transfer sessions.
- Validates shop subscription status before allowing the PC app to register.
- Does not relay file bytes.

Important files:

- `backend/server.js`
- `server.js`

Note: `server.js` at repo root mirrors the backend server entry. Keep both in sync if both are still required in your deployment flow.

### Database

- Stores shop records, password hashes, prices, and subscription dates.
- Worker runtime uses Cloudflare D1 (SQLite).

Important files:

- `database/schema.sql`
- `database/schema-new.sql`
- `database/ensure_columns.sql`
- `database/add_prices.sql`
- `database/migrate.js`

## Project Structure

```text
.
|-- backend/
|-- database/
|-- frontend/
|-- frontend-admin/
|-- pc-app/
|-- server.js
|-- start-all.ps1
`-- README.md
```

## Setup

### 1. Database Setup

Create and initialize the Cloudflare D1 database used by the Worker backend.

Run the D1 schema and seed:

```bash
cd backend
npx wrangler d1 execute print_app --file=../database/d1-setup.sql
```

This creates the SQLite tables and inserts a default admin plus a demo shop user.

### 2. Backend Setup

The backend is now configured for Cloudflare Workers with:

- a Durable Object handling WebSocket signaling
- Cloudflare D1 for SQLite storage
- Web Crypto PBKDF2 password hashing

Install dependencies:

```bash
cd backend
npm install
```

Create Worker secrets / environment variables. At minimum you need:

```env
JWT_SECRET=change-this
FRONTEND_URL=https://your-frontend.example
ADMIN_FRONTEND_URL=https://your-admin.example
ALLOWED_ORIGINS=https://your-frontend.example,https://your-admin.example
```

Run locally with Wrangler:

```bash
npm run dev
```

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

Worker files:

- `backend/server.js`
- `backend/wrangler.toml`

Important backend note:

- This Worker version uses D1 (`env.DB`) directly.
- The old Node `pg` / Express server flow is no longer the runtime target for `backend/`.

### 3. Frontend Setup

Install and run:

```bash
cd frontend
npm install
npm run dev
```

Configure the frontend to point at your backend HTTP and WebSocket URLs. Check:

- `frontend/src/config.js`
- `frontend/.env.development`
- `frontend/wrangler.toml`

Open the app with a shop code:

```text
https://your-frontend.example/?shop=SHOP001
```

### 4. PC App Setup

Install dependencies:

```bash
cd pc-app
npm install
```

Start the Electron app:

```bash
npm start
```

In the app:

1. Enter the shop code.
2. Enter the password.
3. Select the download folder.
4. Set prices and printer selections if needed.
5. Save settings.
6. Start the receiver service.

When the PC app successfully logs in and registers over WebSocket, the shop becomes available to the frontend.

### 5. Admin Panel Setup

Install and run:

```bash
cd frontend-admin
npm install
npm run dev
```

The admin panel uses the backend REST endpoints for:

- admin login
- create shop
- list shops
- update prices and subscription end date
- delete shop

## API and Signaling Behavior

### Public / REST endpoints

Examples from the backend:

- `GET /health`
- `GET /shop/public/:shopCode`
- `POST /auth/login`
- `POST /shop/set-password`
- `POST /shop/update-prices`
- `POST /admin/login`
- `POST /admin/create-shop`
- `PATCH /admin/shop/:shopCode`
- `DELETE /admin/shop/:shopCode`
- `POST /admin/register`
- `GET /subscription/check`

### WebSocket message types

The important signaling messages are:

- `REGISTER_SHOP`
- `REGISTER_SUCCESS`
- `REGISTER_FAILED`
- `CHECK_STATUS`
- `STATUS_RESPONSE`
- `WEBRTC_OFFER`
- `WEBRTC_ANSWER`
- `ICE_CANDIDATE`
- `TRANSFER_STATE`
- `TRANSFER_ERROR`

### Actual file transfer

Once WebRTC is connected:

- The frontend sends `FILE_METADATA` over the data channel.
- The frontend sends binary chunks.
- The frontend sends `FILE_COMPLETE`.
- The PC app validates, saves, and replies with `FILE_RECEIVED`.

## PWA and Share Support

The customer frontend is built as a Progressive Web App so users can install it and share files into it from other apps.

Features:

- installable on mobile and desktop
- offline-capable shell through service worker
- manifest for app-like behavior
- share-target flow for direct sharing from other apps
- responsive layout for phones, tablets, and desktops

Important files:

- `frontend/public/manifest.json`
- `frontend/public/sw.js`
- `frontend/public/_redirects`

### iPhone usage

1. Open the frontend in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch the installed app from the home screen.
5. From WhatsApp, Photos, Files, or other apps, share supported files to the installed app.

### Android usage

1. Open the frontend in Chrome.
2. Install the app from the browser prompt or menu.
3. Share files from supported apps into the installed PWA.

### Desktop usage

- The app works in a normal browser.
- Installation is optional.
- File upload still works without PWA installation.

### Custom app icons

Replace the placeholder icons by adding real PNG files into `frontend/public/`:

- `icon-192.png`
- `icon-512.png`

If you do that, remove the placeholder `.svg` versions or update the manifest to match your final asset names.

## Security Rules

- The backend must never receive or store actual file bytes.
- The PC app must authenticate with a valid JWT.
- Subscription checks happen before the PC app is allowed to register online.
- The frontend validates file size and allowed MIME types.
- The PC app validates file name, extension, and file size again before saving.
- Saved filenames are sanitized to avoid path traversal.

## Limits and Validation

Current transfer rules in code:

- maximum file size: `100 MB`
- allowed frontend MIME types:
  - PDF
  - DOC
  - DOCX
  - JPG / JPEG
  - PNG
- allowed PC app extensions:
  - `.pdf`
  - `.doc`
  - `.docx`
  - `.jpg`
  - `.jpeg`
  - `.png`

## Failure Handling

| Case | Behavior |
| --- | --- |
| Shop offline | Frontend gets `OFFLINE` and shows offline state |
| Invalid token | Backend rejects PC app registration |
| Subscription expired | Backend blocks registration |
| File too large | Frontend and PC app both reject it |
| WebRTC failure | Transfer ends with error and cleanup |
| Connection drop | WebSocket or peer disconnect triggers reconnect / retry logic |

## Production Notes

### HTTPS and WSS

WebRTC in production requires secure origins. Use:

- `https://` for frontend and admin
- `wss://` for backend Worker WebSocket endpoint

### STUN / TURN

The app currently uses Google's public STUN server. This is enough for some networks, but not all. For production use across stricter NAT or firewall conditions, add a TURN server such as Coturn.

### Electron / `wrtc`

If the PC app fails because of native module issues, rebuild Electron dependencies:

```bash
cd pc-app
npx electron-rebuild
```

You may need to install it first:

```bash
npm install -g electron-rebuild
```

## Troubleshooting

### Shop shows offline

- Check that the backend is running.
- Check that the PC app has a valid token.
- Check that the PC app receiver service was started.
- Check backend logs for WebSocket registration errors.

### Login fails in PC app

- Verify `API_URL` is set correctly in the Electron environment.
- Verify the shop exists in the database.
- Verify `JWT_SECRET` is configured on the backend.
- Verify password setup is allowed and backend DB access is working.

### Files do not transfer

- Check frontend `WS_URL`.
- Check PC app `WS_URL`.
- Confirm the shop is online before sending.
- Test on the same network first.
- If cross-network tests fail, add TURN support.

### Files save incorrectly

- Check the configured download folder in the PC app.
- Check OS file permissions.
- Check whether the frontend MIME type and backend extension validation match the file being sent.

### CORS problems

- Make sure `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `CLOUDFLARE_URL`, or `ALLOWED_ORIGINS` include the exact deployed frontend origins.

## Development Notes

- Prefer changing `backend/server.js` and `server.js` together if both are still active.
- `start-all.ps1` can be used to start multiple local services more quickly.
- `test-update.js` is a utility script for testing price updates.

## Summary

This project is a direct browser-to-PC print file transfer system:

- frontend checks if the shop is online
- backend connects frontend and PC app only for signaling
- frontend and PC app transfer the actual files directly with WebRTC
- PC app saves files locally and can route them to printers
