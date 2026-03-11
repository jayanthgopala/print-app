# System Architecture

This document provides detailed system architecture and design decisions for the cloud printing platform.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUD INFRASTRUCTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐ │
│  │   Frontend   │      │   Backend    │      │   Object     │ │
│  │   (React)    │◄────►│   API        │◄────►│   Storage    │ │
│  │   Vercel     │ HTTPS│   Node.js    │ HTTPS│   R2/S3      │ │
│  └──────────────┘      └──────┬───────┘      └──────────────┘ │
│                               │                                 │
│                               │ WebSocket                       │
│                               │ (WSS)                          │
│                               │                                 │
│  ┌────────────────────────────▼───────────────────────────┐   │
│  │           Device Relay / WebSocket Server              │   │
│  │           (Persistent Connections)                      │   │
│  └────────────────────────────┬───────────────────────────┘   │
│                                                                 │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                    WebSocket (WSS) over Internet
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
┌───────▼────────┐       ┌───────▼────────┐       ┌───────▼────────┐
│   Shop PC 1    │       │   Shop PC 2    │       │   Shop PC N    │
│   (Electron)   │       │   (Electron)   │       │   (Electron)   │
│                │       │                │       │                │
│  ┌──────────┐ │       │  ┌──────────┐ │       │  ┌──────────┐ │
│  │  Local   │ │       │  │  Local   │ │       │  │  Local   │ │
│  │ Printer  │ │       │  │ Printer  │ │       │  │ Printer  │ │
│  └──────────┘ │       │  └──────────┘ │       │  └──────────┘ │
└────────────────┘       └────────────────┘       └────────────────┘
```

## Component Architecture

### 1. Frontend (React Web App)

**Purpose**: User interface for submitting print jobs

**Technology Stack**:
- React 18 with functional components (.jsx)
- Vite for build tooling
- Axios for HTTP requests
- WebSocket client for real-time updates

**Key Features**:
- Shop authentication (JWT)
- File upload with drag & drop
- Direct upload to object storage
- Real-time job status updates
- Device status monitoring

**Deployment**:
- Static site hosting (Vercel/Netlify/Cloudflare Pages)
- CDN distribution
- Automatic HTTPS

**Scalability**:
- Stateless design
- CDN caching
- Infinite horizontal scaling
- Global edge distribution

---

### 2. Backend API (Control Plane)

**Purpose**: REST API for business logic and orchestration

**Technology Stack**:
- Node.js with Hono framework
- SQLite for shop/device data
- PostgreSQL for job records
- JWT authentication
- Zod validation

**Key Features**:
- Shop authentication & authorization
- Print job creation and management
- Device registration and tracking
- Subscription verification
- Rate limiting
- Input validation

**Database Strategy**:

**SQLite** (shops.db):
- Shop authentication data
- Device registry
- Fast reads for auth checks
- Simple, file-based
- Suitable for < 10k shops

**PostgreSQL** (job records):
- Print job history
- Job status tracking
- Audit logs
- Device connection logs
- Scalable for millions of records

**Why Two Databases?**
- SQLite: Fast, local, perfect for authentication
- PostgreSQL: Scalable, suitable for high-volume transactional data
- Separation of concerns: auth vs. business data

**Deployment**:
- Containerized deployment (Docker)
- Fly.io / Railway / AWS ECS
- Persistent volume for SQLite
- Managed PostgreSQL (Neon/Supabase)

---

### 3. WebSocket Server (Device Relay)

**Purpose**: Maintain persistent connections with shop PCs

**Technology Stack**:
- Node.js with `ws` library
- Same process as Backend API
- In-memory device registry

**Key Features**:
- Device authentication
- Connection management
- Message routing
- Heartbeat monitoring
- Automatic reconnection handling

**Connection Management**:

```javascript
// Device registry structure
{
  deviceId: {
    ws: WebSocketConnection,
    shopCode: "SHOP001",
    lastHeartbeat: timestamp,
    status: "online"
  }
}

// Shop to devices mapping
{
  "SHOP001": Set(["DEVICE001", "DEVICE002"]),
  "SHOP002": Set(["DEVICE003"])
}
```

**Scalability**:
- Single instance: ~10,000 concurrent connections
- Multi-instance: Requires Redis pub/sub
- Sticky sessions for load balancing
- Horizontal scaling strategy:

```
┌─────────┐      ┌──────────────┐      ┌──────────────┐
│  Load   │      │   WS Server  │      │    Redis     │
│ Balancer├─────►│   Instance 1 ├─────►│   Pub/Sub    │
│ (Sticky)│      └──────────────┘      └──────────────┘
│         │      ┌──────────────┐             ▲
│         ├─────►│   WS Server  │             │
│         │      │   Instance 2 ├─────────────┘
└─────────┘      └──────────────┘
```

**Heartbeat Mechanism**:
- Interval: 30 seconds
- Timeout: 90 seconds (3 missed beats)
- Automatic device offline marking
- Connection cleanup

---

### 4. PC Client (Electron App)

**Purpose**: Run on shop PCs to receive and execute print jobs

**Technology Stack**:
- Electron (cross-platform desktop)
- Node.js backend
- WebSocket client
- PDF printing library

**Key Features**:
- Auto-connect on startup
- Persistent WebSocket connection
- Local print queue management
- Automatic file download
- Printer integration
- System tray integration
- Auto-update support

**Architecture**:

```
┌─────────────────────────────────────────┐
│         Electron Main Process           │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐    ┌──────────────┐ │
│  │   Device     │    │    Print     │ │
│  │   Client     │◄──►│    Queue     │ │
│  │ (WebSocket)  │    │   Manager    │ │
│  └──────────────┘    └──────┬───────┘ │
│                              │          │
│  ┌──────────────┐    ┌──────▼───────┐ │
│  │   Storage    │    │   Printer    │ │
│  │  Downloader  │    │   Driver     │ │
│  └──────────────┘    └──────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

**Print Queue State Machine**:

```
pending → queued → printing → completed
                            └─→ failed
```

**Deployment**:
- Installable executables (Windows/Mac/Linux)
- Auto-update mechanism
- Configured per shop with credentials
- Runs as background service

---

## Data Flow

### Print Job Submission Flow

```
1. User uploads file in frontend
   ├─ File validated (type, size)
   └─ Direct upload to R2/S3

2. Frontend sends job metadata to backend
   ├─ POST /api/jobs
   └─ Includes file URL, shop code, options

3. Backend processes request
   ├─ Authenticate shop (JWT)
   ├─ Verify subscription
   ├─ Check online devices
   ├─ Create job in PostgreSQL
   └─ Assign to available device

4. Backend sends job to device via WebSocket
   ├─ Look up device WebSocket connection
   ├─ Send print_job message
   └─ Wait for acknowledgment

5. PC Client receives job
   ├─ Acknowledge receipt (job_received)
   ├─ Download file from storage
   ├─ Add to local print queue
   └─ Send status update (queued)

6. PC Client prints job
   ├─ Send status update (printing)
   ├─ Execute print command
   ├─ Monitor completion
   └─ Send final status (completed/failed)

7. Backend updates job status
   ├─ Update PostgreSQL record
   └─ Log status history

8. Frontend receives update
   ├─ Via WebSocket (real-time)
   └─ Via polling (fallback)
```

### Device Registration Flow

```
1. PC Client starts
   ├─ Load configuration (shop code, device ID)
   └─ Connect to WebSocket server

2. Send device_register message
   ├─ Include device ID, PC name, shop code
   └─ Include device token if existing

3. Backend validates registration
   ├─ Verify shop exists in SQLite
   ├─ Check subscription status
   ├─ Validate or generate device token
   └─ Update device status to "online"

4. Backend sends device_register_ack
   ├─ Include device token (JWT)
   ├─ Include heartbeat interval
   └─ Confirm registration success

5. PC Client starts heartbeat loop
   ├─ Send heartbeat every 30s
   └─ Listen for print jobs

6. Backend monitors connection
   ├─ Track last heartbeat time
   ├─ Mark offline if timeout
   └─ Clean up on disconnect
```

## Security Architecture

### Authentication Layers

**Layer 1: Shop Authentication (Frontend → Backend)**
- JWT tokens with 7-day expiry
- Password hashed with bcrypt (cost: 12)
- Token stored in localStorage
- Auto-refresh on API calls

**Layer 2: Device Authentication (PC → Backend)**
- Separate device tokens (365-day expiry)
- Issued during registration
- Validated on WebSocket connection
- Stored securely in electron-store

**Layer 3: Authorization**
- Shop can only access own jobs
- Device can only receive jobs for own shop
- Cross-shop access blocked at API level

### Transport Security

**Production Requirements**:
- HTTPS for all HTTP traffic (Frontend ↔ Backend)
- WSS (WebSocket Secure) for device connections
- TLS 1.2+ only
- Valid SSL certificates

### Input Validation

**Frontend**:
- File type restrictions
- File size limits (50MB)
- Form validation

**Backend**:
- Zod schema validation
- SQL injection prevention (parameterized queries)
- Path traversal protection
- Rate limiting

### File Security

**Upload Security**:
- Direct upload to signed URLs
- File type verification
- Size restrictions
- Virus scanning (future enhancement)

**Download Security**:
- Temporary signed URLs
- File name sanitization
- Path traversal prevention

## Scalability Considerations

### Current Capacity (Single Instance)

- **Backend API**: ~1000 req/s
- **WebSocket**: ~10,000 concurrent connections
- **Database**: 
  - SQLite: 10,000 shops, 100,000 reads/s
  - PostgreSQL: Millions of jobs
- **Storage**: Unlimited (R2/S3)

### Scaling Strategy

**Frontend**: Already infinitely scalable (static site)

**Backend API** (when >1000 req/s):
1. Deploy multiple instances
2. Load balancer with round-robin
3. Shared PostgreSQL database
4. Replicate SQLite or migrate to PostgreSQL

**WebSocket Server** (when >10,000 connections):
1. Deploy multiple instances
2. Load balancer with sticky sessions
3. Redis pub/sub for message broadcasting
4. Shared device state in Redis

**Database** (when needed):
1. Migrate SQLite → PostgreSQL
2. Connection pooling
3. Read replicas for queries
4. Partitioning for job history

**Storage** (when needed):
1. CDN for file delivery
2. Lifecycle policies for old files
3. Multi-region replication

### Cost Optimization

**Free Tier Goals**:
- Vercel: Frontend hosting (free)
- Fly.io: Backend (free tier or $5/mo)
- Neon: PostgreSQL (free tier)
- Cloudflare R2: Storage ($0.015/GB)

**Production Costs** (5,000-10,000 users/day):
- Hosting: $45-125/month
- Storage: $10-30/month
- Total: ~$55-155/month

## Monitoring & Observability

### Metrics to Track

**Application**:
- Request rate and latency
- Error rate
- WebSocket connections (active/total)
- Device heartbeat success rate

**Business**:
- Print jobs per day
- Job success rate
- Average job completion time
- Active shops and devices

**Infrastructure**:
- CPU and memory usage
- Database query performance
- Storage usage
- Network bandwidth

### Logging Strategy

**Application Logs**:
- Request/response logs
- Error logs with stack traces
- WebSocket connection events
- Job lifecycle events

**Audit Logs** (PostgreSQL):
- Job status changes
- Device connections/disconnections
- Authentication events

### Alerting

**Critical Alerts**:
- API error rate > 5%
- Database connection failures
- Storage unavailable
- WebSocket server down

**Warning Alerts**:
- High CPU/memory (>80%)
- Slow API responses (>500ms p95)
- Device offline for > 5 minutes
- Job failure rate > 10%

## Disaster Recovery

### Backup Strategy

**Daily Backups**:
- PostgreSQL: Automated by provider
- SQLite: Copy to object storage
- Configuration: Stored in Git

**Recovery Time Objective (RTO)**: 15 minutes
**Recovery Point Objective (RPO)**: 24 hours

### Incident Response

1. **Detect**: Alerts trigger
2. **Assess**: Check monitoring dashboards
3. **Mitigate**: Roll back or scale resources
4. **Communicate**: Notify users if needed
5. **Resolve**: Fix root cause
6. **Post-mortem**: Document and improve

## Future Enhancements

### Phase 2 Features

- [ ] Printer management dashboard
- [ ] Print job scheduling
- [ ] Multi-device load balancing
- [ ] Job preview before printing
- [ ] Usage analytics and reporting
- [ ] Webhook notifications
- [ ] Mobile app (React Native)

### Phase 3 Features

- [ ] Multi-tenancy with sub-accounts
- [ ] Advanced print options (color, duplex)
- [ ] Document conversion (DOCX → PDF)
- [ ] Batch printing
- [ ] Integrated billing
- [ ] White-label solution

## Technology Decisions

### Why Node.js?
- Single language (JavaScript) across stack
- Excellent for I/O-bound operations
- Native WebSocket support
- Large ecosystem
- Easy to deploy

### Why React?
- Component-based architecture
- Large community and ecosystem
- Excellent tooling (Vite)
- Virtual DOM performance
- Hooks for state management

### Why Electron?
- Cross-platform (Windows/Mac/Linux)
- Familiar web technologies
- Native printer access
- Auto-update support
- System tray integration

### Why SQLite + PostgreSQL?
- SQLite: Fast local authentication
- PostgreSQL: Scalable job records
- Best of both worlds
- Easy to migrate if needed

### Why Hono?
- Lightweight and fast
- TypeScript support
- Edge runtime compatible
- Clean API
- Good middleware ecosystem

## References

- [Hono Documentation](https://hono.dev/)
- [WebSocket RFC 6455](https://tools.ietf.org/html/rfc6455)
- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
