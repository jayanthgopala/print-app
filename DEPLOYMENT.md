# Deployment Guide

This guide covers deploying the cloud printing platform to production.

## Overview

The platform consists of three components:
1. **Backend API** - Node.js server with WebSocket support
2. **Frontend** - React web application
3. **PC Client** - Electron desktop application

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database
- Object storage (Cloudflare R2 or AWS S3)
- Domain with SSL certificate

## Backend Deployment

### Recommended Platforms

- **Fly.io** (recommended for WebSocket support)
- **Railway**
- **AWS ECS**
- **DigitalOcean App Platform**

### Deploy to Fly.io

1. Install Fly CLI:
```bash
curl -L https://fly.io/install.sh | sh
```

2. Login and create app:
```bash
cd backend
fly auth login
fly launch
```

3. Set environment variables:
```bash
fly secrets set JWT_SECRET="your-secret-key"
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set STORAGE_ENDPOINT="..."
fly secrets set STORAGE_ACCESS_KEY="..."
fly secrets set STORAGE_SECRET_KEY="..."
fly secrets set STORAGE_BUCKET="print-files"
```

4. Deploy:
```bash
fly deploy
```

### Environment Variables

Required production variables:

```bash
NODE_ENV=production
PORT=3000
WS_PORT=3001
JWT_SECRET=<strong-random-string-min-32-chars>
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SQLITE_PATH=/data/shops.db
STORAGE_ENDPOINT=https://your-storage.com
STORAGE_ACCESS_KEY=your-key
STORAGE_SECRET_KEY=your-secret
STORAGE_BUCKET=print-files
STORAGE_PUBLIC_URL=https://cdn.yourdomain.com
CORS_ORIGIN=https://yourdomain.com
```

### Database Setup

1. Create PostgreSQL database (e.g., Neon, Supabase)
2. Run initialization:
```bash
npm run db:init
```

### Scaling Considerations

For > 10,000 concurrent WebSocket connections:

1. Use sticky sessions (session affinity)
2. Implement Redis pub/sub for message broadcasting
3. Use load balancer with WebSocket support
4. Deploy multiple instances

Example Redis pub/sub:
```javascript
import Redis from 'ioredis';

const pub = new Redis(process.env.REDIS_URL);
const sub = new Redis(process.env.REDIS_URL);

// Publish job to all instances
pub.publish('print-jobs', JSON.stringify({ shopCode, job }));

// Subscribe to jobs
sub.subscribe('print-jobs', (err) => {
  if (err) console.error(err);
});

sub.on('message', (channel, message) => {
  const data = JSON.parse(message);
  // Send to connected device
});
```

## Frontend Deployment

### Recommended Platforms

- **Vercel** (easiest)
- **Netlify**
- **Cloudflare Pages**
- **AWS S3 + CloudFront**

### Deploy to Vercel

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Deploy:
```bash
cd frontend
vercel
```

3. Set environment variables in Vercel dashboard:
```
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=wss://api.yourdomain.com
VITE_STORAGE_UPLOAD_URL=https://storage.yourdomain.com
```

4. Configure custom domain

### Deploy to Netlify

1. Build:
```bash
npm run build
```

2. Deploy:
```bash
netlify deploy --prod --dir=dist
```

### Deploy to Cloudflare Pages

1. Connect GitHub repository
2. Build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
3. Add environment variables
4. Deploy

## PC Client Distribution

### Building Installers

```bash
cd pc-client

# Windows
npm run build-win

# macOS
npm run build-mac

# Linux
npm run build-linux
```

Installers will be in `dist/` folder.

### Distribution Methods

1. **Direct Download**: Host installers on your website
2. **Auto-update**: Implement using `electron-updater`
3. **Microsoft Store**: Package as MSIX
4. **Mac App Store**: Sign and submit

### Auto-Update Setup

1. Install electron-updater:
```bash
npm install electron-updater
```

2. Configure in main.js:
```javascript
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();

autoUpdater.on('update-available', () => {
  // Notify user
});

autoUpdater.on('update-downloaded', () => {
  // Prompt to restart
});
```

3. Host update files on S3 or GitHub Releases

## SSL/TLS Configuration

### Backend (Required for WSS)

1. Obtain certificate (Let's Encrypt, Cloudflare)
2. Configure in deployment platform
3. Ensure WebSocket endpoint uses `wss://`

### Frontend

Most platforms (Vercel, Netlify) provide automatic HTTPS.

## Object Storage Setup

### Cloudflare R2

1. Create R2 bucket
2. Generate API tokens
3. Configure CORS:
```json
{
  "AllowedOrigins": ["https://yourdomain.com"],
  "AllowedMethods": ["GET", "PUT", "POST"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}
```

### AWS S3

1. Create S3 bucket
2. Configure CORS policy
3. Create IAM user with S3 permissions
4. Generate access keys

## Monitoring & Logging

### Application Monitoring

1. **Sentry** - Error tracking
```bash
npm install @sentry/node
```

2. **LogRocket** - Session replay

3. **Datadog** - Full-stack monitoring

### Database Monitoring

- PostgreSQL: Built-in monitoring in Neon/Supabase
- Connection pooling metrics
- Query performance

### WebSocket Metrics

Track:
- Active connections
- Connection duration
- Message throughput
- Reconnection rate

## Backup Strategy

### Database Backups

1. Automated daily backups (provided by Neon/Supabase)
2. Point-in-time recovery
3. Off-site backup storage

### SQLite Backups

```bash
# Backup SQLite database
cp /data/shops.db /backups/shops_$(date +%Y%m%d).db
```

### File Storage

- S3/R2 versioning enabled
- Lifecycle policies for old files

## Security Checklist

- [ ] HTTPS/WSS only in production
- [ ] Strong JWT secret (min 32 chars)
- [ ] Rate limiting enabled
- [ ] CORS configured correctly
- [ ] Input validation on all endpoints
- [ ] File type restrictions enforced
- [ ] Database connections encrypted
- [ ] Environment variables secured
- [ ] Regular security updates
- [ ] Monitoring and alerting enabled

## Performance Optimization

### Backend

- Enable compression
- Use connection pooling
- Cache frequent queries
- Optimize WebSocket message size

### Frontend

- Code splitting implemented (Vite default)
- Image optimization
- CDN for static assets
- Lazy loading components

### Database

- Proper indexes (already configured)
- Query optimization
- Connection pooling

## Troubleshooting

### WebSocket Connection Issues

1. Check firewall rules
2. Verify WSS certificate
3. Check sticky sessions
4. Review connection limits

### High Latency

1. Use CDN for frontend
2. Deploy closer to users
3. Database connection pooling
4. Optimize queries

### Failed Print Jobs

1. Check device connectivity
2. Verify object storage access
3. Review printer configuration
4. Check file compatibility

## Cost Estimates (for 5000-10000 daily users)

### Hosting
- Backend (Fly.io): ~$20-50/month
- Database (Neon): ~$20-40/month
- Frontend (Vercel): Free-$20/month
- Storage (R2): ~$5-15/month

**Total: ~$45-125/month**

## Support & Maintenance

### Regular Tasks

- Monitor error rates
- Review logs weekly
- Update dependencies monthly
- Database maintenance
- Backup verification

### Scaling Triggers

- > 80% CPU usage consistently
- > 10,000 WebSocket connections
- > 1GB database size (migrate SQLite to PostgreSQL)
- > 100ms API response time

## Post-Deployment

1. Test all functionality in production
2. Create test shop accounts
3. Test PC client connection
4. Submit test print jobs
5. Monitor for 24 hours
6. Set up alerts
7. Document procedures

## Rollback Procedure

If issues arise:

1. Revert frontend deployment
2. Rollback backend to previous version
3. Restore database from backup if needed
4. Notify users of maintenance

## Additional Resources

- [Fly.io Docs](https://fly.io/docs/)
- [Vercel Docs](https://vercel.com/docs)
- [PostgreSQL Best Practices](https://www.postgresql.org/docs/)
- [WebSocket Scaling Guide](https://socket.io/docs/v4/scaling/)
