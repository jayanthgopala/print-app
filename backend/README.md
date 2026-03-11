# Backend API

Backend API for the cloud printing platform. The HTTP API can now run on either Node.js or Cloudflare Workers.

## Features

- REST API with Hono
- Dual runtime support: Node.js server or Cloudflare Workers
- SQLite locally or Cloudflare D1 in Worker deployments
- WebSocket relay for device communication on Node.js
- JWT authentication
- Rate limiting
- Input validation with Zod

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key environment variables:
- `JWT_SECRET`: Strong random string (min 32 characters)
- `SQLITE_PATH`: SQLite database path
- `PORT`, `WS_PORT`: API and WebSocket ports
- `D1_BINDING`: Cloudflare D1 binding name for Worker deployments

## Database Setup

Initialize SQLite:

```bash
npm run db:init
```

## Development

```bash
npm run dev
```

## Cloudflare Workers

Install dependencies, then run:

```bash
npm run start:worker
```

Deploy with:

```bash
npm run deploy:worker
```

The Worker runtime serves the REST API and uses D1 for shop/device data. The current stateful device relay still runs only on the Node/WebSocket path, so print dispatch in Worker mode requires a separate relay process or a future Durable Object migration.

## Production

```bash
npm start
```

## Notes

- Job metadata is handled in memory at runtime (not persisted in DB).
- If backend restarts, in-memory jobs are cleared.
- Cloudflare Worker mode does not yet replace the long-lived WebSocket relay.
