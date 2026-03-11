# API Documentation

Complete REST API reference for the cloud printing platform.

## Base URL

```
Development: http://localhost:3000
Production: https://api.yourdomain.com
```

## Authentication

Most endpoints require authentication using JWT tokens.

**Header Format**:
```
Authorization: Bearer <token>
```

## Response Format

All responses follow this structure:

**Success Response**:
```json
{
  "success": true,
  "data": {},
  "message": "Optional message"
}
```

**Error Response**:
```json
{
  "error": "Error message",
  "details": []
}
```

## Rate Limiting

Rate limits apply to all endpoints:

- **Default**: 100 requests per 15 minutes
- **Login**: 5 attempts per 15 minutes
- **Print Jobs**: 10 submissions per minute

**Rate Limit Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1709980800000
```

## Endpoints

### Health Check

Check API health status.

```http
GET /health
```

**Authentication**: None required

**Response**: 200 OK
```json
{
  "status": "healthy",
  "timestamp": "2026-03-09T12:00:00.000Z",
  "uptime": 3600
}
```

---

## Authentication Endpoints

### Login

Authenticate shop and receive JWT token.

```http
POST /api/auth/login
```

**Authentication**: None required

**Request Body**:
```json
{
  "shopCode": "SHOP001",
  "password": "your-password"
}
```

**Response**: 200 OK
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "shop": {
    "shopCode": "SHOP001",
    "name": "My Print Shop",
    "subscriptionStatus": "active",
    "subscriptionExpiry": "2026-04-09T12:00:00.000Z"
  }
}
```

**Errors**:
- 401: Invalid credentials
- 403: Subscription inactive or expired
- 429: Too many login attempts

---

### Register Shop

Create new shop account (admin only).

```http
POST /api/auth/register
```

**Authentication**: None required (add admin auth in production)

**Request Body**:
```json
{
  "shopCode": "SHOP001",
  "password": "secure-password-123",
  "name": "My Print Shop",
  "email": "shop@example.com"
}
```

**Validation**:
- `shopCode`: 3-50 chars, alphanumeric + dash/underscore
- `password`: 8-100 chars
- `name`: 1-200 chars
- `email`: Valid email format

**Response**: 201 Created
```json
{
  "success": true,
  "message": "Shop created successfully",
  "shopCode": "SHOP001"
}
```

**Errors**:
- 400: Validation failed
- 409: Shop code already exists

---

### Verify Token

Verify JWT token validity.

```http
GET /api/auth/verify
```

**Authentication**: Required

**Response**: 200 OK
```json
{
  "valid": true,
  "shopCode": "SHOP001",
  "name": "My Print Shop"
}
```

**Errors**:
- 401: Invalid or expired token

---

## Print Job Endpoints

### Create Print Job

Submit new print job.

```http
POST /api/jobs
```

**Authentication**: Required

**Request Body**:
```json
{
  "fileUrl": "https://storage.example.com/file.pdf",
  "fileName": "document.pdf",
  "fileSize": 1048576,
  "fileType": "application/pdf",
  "printerName": "HP LaserJet Pro",
  "copies": 2,
  "pageRange": "1-10"
}
```

**Validation**:
- `fileUrl`: Valid URL
- `fileName`: 1-255 chars
- `fileSize`: Max 50MB (52428800 bytes)
- `fileType`: Must be PDF or image (PNG, JPEG)
- `copies`: 1-10
- `pageRange`: Optional, format: "1-10" or "1,3,5"

**Response**: 201 Created
```json
{
  "success": true,
  "jobId": "job_abc123",
  "status": "queued",
  "deviceId": "DEVICE001"
}
```

**Errors**:
- 400: Validation failed
- 503: No online devices available

---

### Get Job Status

Retrieve status of specific print job.

```http
GET /api/jobs/:jobId
```

**Authentication**: Required

**Parameters**:
- `jobId`: Job identifier

**Response**: 200 OK
```json
{
  "jobId": "job_abc123",
  "status": "completed",
  "fileName": "document.pdf",
  "copies": 2,
  "createdAt": "2026-03-09T12:00:00.000Z",
  "startedAt": "2026-03-09T12:00:05.000Z",
  "completedAt": "2026-03-09T12:00:30.000Z",
  "errorMessage": null
}
```

**Status Values**:
- `pending`: Job created, not yet sent to device
- `queued`: Job sent to device, waiting to print
- `printing`: Job currently printing
- `completed`: Job successfully printed
- `failed`: Job failed with error
- `cancelled`: Job cancelled by user

**Errors**:
- 403: Job belongs to different shop
- 404: Job not found

---

### List Jobs

Get list of print jobs for shop.

```http
GET /api/jobs?limit=50
```

**Authentication**: Required

**Query Parameters**:
- `limit`: Max jobs to return (default: 50, max: 100)

**Response**: 200 OK
```json
{
  "jobs": [
    {
      "jobId": "job_abc123",
      "status": "completed",
      "fileName": "document.pdf",
      "copies": 1,
      "createdAt": "2026-03-09T12:00:00.000Z",
      "completedAt": "2026-03-09T12:00:30.000Z"
    }
  ]
}
```

---

### Cancel Job

Cancel pending print job.

```http
DELETE /api/jobs/:jobId
```

**Authentication**: Required

**Parameters**:
- `jobId`: Job identifier

**Response**: 200 OK
```json
{
  "success": true,
  "message": "Job cancelled"
}
```

**Errors**:
- 400: Cannot cancel job in current state
- 403: Job belongs to different shop
- 404: Job not found

---

## Device Endpoints

### List Devices

Get all devices for shop.

```http
GET /api/devices
```

**Authentication**: Required

**Response**: 200 OK
```json
{
  "devices": [
    {
      "deviceId": "DEVICE001",
      "pcName": "Shop Main PC",
      "status": "online",
      "lastSeen": "2026-03-09T12:00:00.000Z"
    }
  ]
}
```

**Device Status**:
- `online`: Device connected and active
- `offline`: Device disconnected
- `disconnected`: Device explicitly disconnected

---

### Get Device

Get specific device information.

```http
GET /api/devices/:deviceId
```

**Authentication**: Required

**Parameters**:
- `deviceId`: Device identifier

**Response**: 200 OK
```json
{
  "deviceId": "DEVICE001",
  "pcName": "Shop Main PC",
  "status": "online",
  "lastSeen": "2026-03-09T12:00:00.000Z",
  "createdAt": "2026-03-01T10:00:00.000Z"
}
```

**Errors**:
- 404: Device not found or belongs to different shop

---

### Delete Device

Remove device from shop.

```http
DELETE /api/devices/:deviceId
```

**Authentication**: Required

**Parameters**:
- `deviceId`: Device identifier

**Response**: 200 OK
```json
{
  "success": true,
  "message": "Device removed"
}
```

**Errors**:
- 404: Device not found or belongs to different shop

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Authentication required or failed |
| 403 | Forbidden - Access denied |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable - No devices online |

## HTTP Status Codes

- **2xx Success**
  - 200 OK: Request succeeded
  - 201 Created: Resource created
  
- **4xx Client Error**
  - 400 Bad Request: Invalid input
  - 401 Unauthorized: Auth required
  - 403 Forbidden: Access denied
  - 404 Not Found: Resource missing
  - 429 Too Many Requests: Rate limited

- **5xx Server Error**
  - 500 Internal Server Error
  - 503 Service Unavailable

## Examples

### Complete Print Job Flow

```bash
# 1. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"shopCode": "SHOP001", "password": "password123"}'

# Response: { "token": "eyJhbG..." }

# 2. Create print job
curl -X POST http://localhost:3000/api/jobs \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl": "https://storage.example.com/doc.pdf",
    "fileName": "doc.pdf",
    "fileSize": 102400,
    "fileType": "application/pdf",
    "copies": 1
  }'

# Response: { "jobId": "job_abc123", "status": "queued" }

# 3. Check job status
curl -X GET http://localhost:3000/api/jobs/job_abc123 \
  -H "Authorization: Bearer eyJhbG..."

# Response: { "jobId": "job_abc123", "status": "completed", ... }
```

### JavaScript/Axios Example

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000',
});

// Login
const login = async (shopCode, password) => {
  const { data } = await api.post('/api/auth/login', {
    shopCode,
    password,
  });
  
  // Store token
  api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
  
  return data;
};

// Create job
const createJob = async (jobData) => {
  const { data } = await api.post('/api/jobs', jobData);
  return data;
};

// Get job status
const getJob = async (jobId) => {
  const { data } = await api.get(`/api/jobs/${jobId}`);
  return data;
};
```

## Webhooks (Future)

Webhook support for job status updates (planned):

```http
POST https://your-webhook-url.com/print-job-status
```

**Payload**:
```json
{
  "event": "job.completed",
  "jobId": "job_abc123",
  "shopCode": "SHOP001",
  "status": "completed",
  "timestamp": "2026-03-09T12:00:00.000Z"
}
```

## SDKs

Client libraries (planned):
- JavaScript/TypeScript
- Python
- PHP
- Java

## Changelog

### v1.0.0 (2026-03-09)
- Initial release
- Authentication endpoints
- Print job management
- Device management

## Support

For API issues:
- Check error response details
- Review rate limit headers
- Verify authentication token
- Check request payload format
