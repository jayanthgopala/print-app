# Print Shop File Transfer System

This repository contains the full Print Shop application stack:

- `frontend/`: customer-facing React PWA
- `pc-app/`: Electron app used by the print shop PC
- `backend/`: Cloudflare Worker API
- `frontend-admin/`: admin panel for shop management
- `database/`: schema and migration scripts, including Cloudflare D1 setup files

The current transport model is tunnel-based:

- the backend authenticates shops and customers
- the PC app runs a local HTTP upload server
- a public tunnel forwards internet traffic to that local upload server
- the frontend uploads files directly to the PC app through the tunnel
- the backend never stores or relays file bytes

## Overview

The system lets a customer open the frontend, choose a shop, and upload print files directly to that shop's PC. The print shop PC runs the Electron app, authenticates with the backend, starts the local upload server, and publishes its public tunnel URL to the backend so customers can upload to it.

Main technologies:

- Frontend: React, Vite, PWA APIs
- PC App: Electron, Node.js HTTP server
- Backend: Cloudflare Workers, D1
- Database: Cloudflare D1 (SQLite)

## How Data Flows

1. The shop enters its shop code, password, download folder, local upload port, and public tunnel URL in the PC app.
2. The PC app logs in with the backend and stores the shop token.
3. The PC app starts a local HTTP upload server, usually on port `8788`.
4. A tunnel such as Cloudflare Tunnel exposes that local upload server on a public HTTPS URL.
5. The PC app sends its public upload URL to the backend with `POST /pc/status`.
6. The customer opens the frontend with `?shop=<SHOP_CODE>`.
7. The frontend calls `GET /shop/public/:shopCode` to check whether the shop is online and fetch the public upload URL.
8. Before each upload session, the frontend requests a short-lived upload token from `POST /auth/client-token`.
9. The frontend uploads the file bytes directly to the shop tunnel at `POST <pcEndpoint>/upload`.
10. The PC app validates the token and file metadata, saves the file locally, and pushes the order into the Electron UI.

## Architecture

### Frontend

- Built with React and Vite.
- Used by customers to choose files and send print instructions.
- Validates file size and file type before upload.
- Uses backend REST APIs for shop lookup and upload token minting.
- Sends the actual file directly to the PC app tunnel with HTTP.

Important files:

- `frontend/src/App.jsx`
- `frontend/src/config.js`

### PC App

- Built with Electron.
- Stores shop settings locally with `electron-store`.
- Logs in to the backend and keeps the shop marked online.
- Runs a local HTTP upload server.
- Verifies upload tokens with the backend before accepting files.
- Saves received files to the selected download directory.
- Exposes received file events to the renderer through Electron IPC.

Important files:

- `pc-app/main.js`
- `pc-app/preload.js`
- `pc-app/renderer.js`
- `pc-app/index.html`

### Backend

- Exposes REST endpoints for login, shop settings, admin operations, upload token creation, and public shop lookup.
- Stores shop records and the current public PC endpoint.
- Does not relay file bytes.

Important files:

- `backend/server.js`
- `backend/wrangler.toml`

### Database

- Stores shop records, password hashes, prices, subscription dates, and the active PC endpoint/status.
- Worker runtime uses Cloudflare D1 (SQLite).

Important files:

- `database/d1-setup.sql`
- `database/schema.sql`

## Project Structure

```text
.
|-- backend/
|-- database/
|-- frontend/
|-- frontend-admin/
|-- pc-app/
`-- README.md
```

## Setup

### 1. Database Setup

Run the D1 schema and seed:

```bash
cd backend
npx wrangler d1 execute print_app --file=../database/d1-setup.sql
```

### 2. Backend Setup

Install dependencies:

```bash
cd backend
npm install
```

Create Worker secrets / environment variables:

```env
JWT_SECRET=change-this
FRONTEND_URL=https://your-frontend.example
ADMIN_FRONTEND_URL=https://your-admin.example
ALLOWED_ORIGINS=https://your-frontend.example,https://your-admin.example
```

Run locally:

```bash
npm run dev
```

Deploy:

```bash
npm run deploy
```

### 3. Frontend Setup

Install and run:

```bash
cd frontend
npm install
npm run dev
```

Configure:

- `frontend/src/config.js`
- `frontend/.env.development` if you use one
- `frontend/wrangler.toml`

Open:

```text
https://your-frontend.example/?shop=SHOP001
```

### 4. PC App Setup

Install and run:

```bash
cd pc-app
npm install
npm start
```

In the app:

1. Enter the shop code.
2. Enter the password.
3. Select the download folder.
4. Enter the public tunnel URL, for example `https://shop-001.your-domain.example`.
5. Choose the local upload port, for example `8788`.
6. Save settings.
7. Start the service.

When the service starts successfully:

- the local upload server listens on the configured port
- the backend stores the public tunnel URL in `pc_endpoint`
- the shop becomes available to the frontend

### 5. Tunnel Setup

The PC app expects an external tunnel to forward HTTPS traffic to the local upload server.

Example Cloudflare Tunnel mapping:

```text
https://shop-001.example.com  ->  http://localhost:8788
```

Minimum requirement:

- the tunnel public URL must reach `POST /upload` on the PC app
- the tunnel public URL must also allow `GET /health`

### 6. Admin Panel Setup

Install and run:

```bash
cd frontend-admin
npm install
npm run dev
```

## API Behavior

### Public / REST endpoints

Key endpoints in the current tunnel flow:

- `GET /health`
- `GET /shop/public/:shopCode`
- `POST /auth/login`
- `POST /auth/client-token`
- `POST /auth/verify-client-token`
- `POST /pc/status`
- `POST /shop/set-password`
- `POST /shop/update-prices`
- `POST /admin/login`
- `POST /admin/create-shop`
- `PATCH /admin/shop/:shopCode`
- `DELETE /admin/shop/:shopCode`

### Actual file upload

The frontend sends the file to the shop tunnel with:

- `POST /upload`
- `Authorization: Bearer <client-upload-token>`
- `Content-Type: <mime-type>`
- `X-File-Name`
- `X-File-Size`
- `X-File-Type`
- `X-Customer-Name`
- `X-Color-Pages`
- `X-BW-Pages`
- `X-Paper-Size`
- `X-Orientation`
- `X-Copies`
- `X-Duplex`
- `X-Scale`
- `X-File-Index`
- `X-Total-Files`

The PC app verifies:

- the upload token belongs to the target shop
- the file size is valid
- the file extension is allowed
- the MIME type is allowed
- copies and file ordering metadata are sane

## PWA and Share Support

The customer frontend is a Progressive Web App so users can install it and share files into it from other apps.

Important files:

- `frontend/public/manifest.json`
- `frontend/public/sw.js`
- `frontend/public/_redirects`

## Security Rules

- The backend must never receive or store actual file bytes.
- The PC app must authenticate with a valid shop token.
- The frontend must use a backend-minted client upload token.
- Subscription checks happen before a shop is allowed online.
- The frontend validates file size and allowed MIME types.
- The PC app validates file name, extension, MIME type, file size, and metadata before saving.
- Saved filenames are sanitized to avoid path traversal.

## Limits and Validation

Current transfer rules in code:

- maximum file size: `100 MB`
- allowed MIME types:
  - PDF
  - DOC
  - DOCX
  - JPG / JPEG
  - PNG
- allowed saved extensions:
  - `.pdf`
  - `.doc`
  - `.docx`
  - `.jpg`
  - `.jpeg`
  - `.png`
- copies per file: `1` to `20`

## Failure Handling

| Case | Behavior |
| --- | --- |
| Shop offline | Frontend shows the shop as offline |
| Missing tunnel URL | PC app refuses to start service |
| Invalid upload token | PC app rejects the upload |
| Subscription expired | Backend blocks the shop from being online |
| File too large | Frontend and PC app both reject it |
| Wrong tunnel target | Upload fails before the file is accepted |
| Upload interrupted | Frontend shows an upload error and the user can retry |

## Production Notes

### HTTPS

Use:

- `https://` for the frontend
- `https://` for the public tunnel URL
- `https://` for the backend Worker API

### Tunnel Notes

- The tunnel is now the transport layer, not WebRTC.
- The public tunnel URL must stay stable enough for customers to reach the shop.
- The local tunnel target must match the PC app's configured local upload port.
- If you change the port in the PC app, update the tunnel target too.

### PC App Notes

- The PC app can be online only when both the local upload server and public tunnel URL are configured.
- The backend stores whatever public upload URL the PC app reports as `pc_endpoint`.

## Troubleshooting

### Shop shows offline

- Check that the backend is running.
- Check that the PC app has a valid token.
- Check that the PC app service was started.
- Check that a public tunnel URL is configured in the PC app.
- Check that the backend row for the shop has `pc_status = online`.

### Upload fails from the frontend

- Check that the tunnel public URL is reachable from another device.
- Check that the tunnel forwards to the same local port configured in the PC app.
- Check that the PC app is still running.
- Check that `POST /upload` reaches the Electron app.
- Check the PC app log for upload token verification or metadata validation failures.

### Files save incorrectly

- Check the configured download folder in the PC app.
- Check OS file permissions.
- Check whether the uploaded MIME type and file extension are supported.

### CORS problems

- Make sure `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, or `ALLOWED_ORIGINS` include the exact deployed frontend origins.
- Make sure the public tunnel allows browser requests to `POST /upload`.

## Summary

This project is now a direct browser-to-PC tunnel upload system:

- frontend checks whether the shop is online
- backend authenticates and publishes the shop's public tunnel endpoint
- frontend uploads files directly to the PC app over HTTPS
- PC app validates and saves files locally for printing
