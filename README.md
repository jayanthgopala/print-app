# Cloud-Managed Remote Printing Platform

A production-grade, scalable distributed printing system supporting thousands of shop PCs and 5,000-10,000 daily users.

## System Architecture

```
Frontend (React)
    ↓ HTTPS/WSS
Backend API (Control Plane)
    ↓ WebSocket
Device Relay Server
    ↓ WebSocket
Shop PC Application (Electron)
    ↓
Local Printer
```

## Components

### 1. Backend API (`/backend`)
- Hono REST API deployable on Node.js or Cloudflare Workers
- SQLite locally or Cloudflare D1 for shop authentication and verification
- PostgreSQL for production job records
- JWT authentication
- Rate limiting and security middleware

### 2. WebSocket Device Relay (`/backend/src/websocket`)
- Persistent WebSocket connections for shop PCs
- Device registry and routing
- Heartbeat monitoring
- Message protocol handlers
- Currently stays on the Node runtime; Worker migration for the relay would require Durable Objects or another stateful transport layer

### 3. Frontend Web App (`/frontend`)
- React with .jsx components
- Vite build system
- File upload to object storage
- Real-time job status updates
- WebSocket client for updates

### 4. PC Client (`/pc-client`)
- Electron + Node.js application
- WebSocket connection to server
- Local print queue management
- Printer integration
- Auto-reconnection with exponential backoff

## Technology Stack

- **Frontend**: React, Vite, Axios, WebSocket
- **Backend**: Node.js, Hono, SQLite, PostgreSQL
- **Storage**: Cloudflare R2 / AWS S3
- **PC Client**: Electron, Node.js, node-printer
- **Transport**: HTTPS, WSS (WebSocket Secure)

## Security Features

✅ JWT authentication for users  
✅ Device token authentication for PCs  
✅ Rate limiting on all endpoints  
✅ Input validation and sanitization  
✅ File type restrictions (PDF/images only)  
✅ Path traversal protection  
✅ HTTPS/WSS only in production  
✅ Device isolation (shops can only access their own jobs)  

## Scalability Features

✅ Direct file upload to object storage  
✅ Connection pooling for databases  
✅ Horizontal scaling support for WebSocket server  
✅ Device heartbeat monitoring  
✅ Efficient message routing  
✅ Queue-based print job processing  

## Quick Start

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Configure environment variables
npm run dev
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
# Configure API endpoint
npm run dev
```

### PC Client
```bash
cd pc-client
npm install
cp .env.example .env
# Configure shop credentials
npm start
```

## Environment Variables

See individual `.env.example` files in each component directory.

## Deployment

- Backend: Deploy to services like Fly.io, Railway, or AWS ECS
- Frontend: Deploy to Vercel, Netlify, or Cloudflare Pages
- Database: Neon PostgreSQL, Supabase, or AWS RDS
- Storage: Cloudflare R2 or AWS S3

## Message Protocol

All device communication uses a standardized JSON format:

```json
{
  "type": "message_type",
  "requestId": "uuid",
  "shopCode": "SHOP001",
  "deviceId": "DEVICE001",
  "payload": {}
}
```

Supported message types:
- `device_register` / `device_register_ack`
- `heartbeat`
- `print_job` / `job_received` / `job_update`
- `printer_status_request` / `printer_status_response`
- `error`

## Production Considerations

1. **Database**: Migrate SQLite to PostgreSQL for shop data in production
2. **WebSocket Scaling**: Use sticky sessions or Redis pub/sub for multi-instance deployments
3. **File Storage**: Configure CDN for file delivery
4. **Monitoring**: Implement logging and monitoring (e.g., Sentry, LogRocket)
5. **Backups**: Automated database backups
6. **SSL/TLS**: Use valid certificates for all domains

## Support

For issues and questions, refer to the documentation in each component directory.

## License

Proprietary
