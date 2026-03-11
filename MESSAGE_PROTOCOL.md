# Message Protocol Specification

This document defines the message protocol for device communication via WebSocket.

## Overview

All messages between the server and PC client follow a standardized JSON format with message typing, request tracking, and payload encapsulation.

## Message Structure

```json
{
  "type": "message_type",
  "requestId": "unique-request-id",
  "shopCode": "SHOP001",
  "deviceId": "DEVICE001",
  "payload": {}
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Message type identifier |
| `requestId` | string | Yes | Unique request ID (UUID/nanoid) |
| `shopCode` | string | Yes | Shop identifier |
| `deviceId` | string | Yes | Device identifier |
| `payload` | object | Yes | Message-specific data |

## Message Types

### 1. Device Registration

**Direction**: Device → Server

**Type**: `device_register`

**Purpose**: Initial device registration and authentication

**Payload**:
```json
{
  "deviceId": "DEVICE001",
  "pcName": "Shop PC 1",
  "shopCode": "SHOP001",
  "deviceToken": "optional-existing-token"
}
```

**Response**: `device_register_ack`

### 2. Device Registration Acknowledgment

**Direction**: Server → Device

**Type**: `device_register_ack`

**Purpose**: Confirm successful registration

**Payload**:
```json
{
  "success": true,
  "deviceId": "DEVICE001",
  "deviceToken": "jwt-token-here",
  "heartbeatInterval": 30000
}
```

### 3. Heartbeat

**Direction**: Device → Server

**Type**: `heartbeat`

**Purpose**: Keep connection alive and confirm device status

**Payload**:
```json
{
  "timestamp": 1709980800000
}
```

**Response**: `heartbeat_ack`

**Interval**: Every 30 seconds (configurable)

### 4. Heartbeat Acknowledgment

**Direction**: Server → Device

**Type**: `heartbeat_ack`

**Purpose**: Acknowledge heartbeat

**Payload**:
```json
{
  "timestamp": 1709980800000
}
```

### 5. Print Job

**Direction**: Server → Device

**Type**: `print_job`

**Purpose**: Send print job to device

**Payload**:
```json
{
  "jobId": "job_abc123",
  "fileUrl": "https://storage.example.com/files/document.pdf",
  "fileName": "document.pdf",
  "fileType": "application/pdf",
  "fileSize": 1048576,
  "copies": 2,
  "printerName": "HP LaserJet Pro",
  "pageRange": "1-10"
}
```

**Expected Response**: `job_received`

### 6. Job Received

**Direction**: Device → Server

**Type**: `job_received`

**Purpose**: Acknowledge job receipt

**Payload**:
```json
{
  "jobId": "job_abc123",
  "receivedAt": 1709980800000
}
```

### 7. Job Update

**Direction**: Device → Server

**Type**: `job_update`

**Purpose**: Update job status

**Payload**:
```json
{
  "jobId": "job_abc123",
  "status": "printing",
  "errorMessage": null,
  "progress": 50
}
```

**Status Values**:
- `queued` - Job in local queue
- `printing` - Job currently printing
- `completed` - Job successfully printed
- `failed` - Job failed with error

### 8. Printer Status Request

**Direction**: Server → Device

**Type**: `printer_status_request`

**Purpose**: Request list of available printers

**Payload**:
```json
{}
```

**Expected Response**: `printer_status_response`

### 9. Printer Status Response

**Direction**: Device → Server

**Type**: `printer_status_response`

**Purpose**: Provide printer information

**Payload**:
```json
{
  "printers": [
    {
      "name": "HP LaserJet Pro",
      "default": true,
      "status": "ready"
    },
    {
      "name": "Canon Pixma",
      "default": false,
      "status": "ready"
    }
  ]
}
```

### 10. Error

**Direction**: Bidirectional

**Type**: `error`

**Purpose**: Report error condition

**Payload**:
```json
{
  "error": "Error message",
  "code": "ERR_CODE",
  "details": {}
}
```

**Common Error Codes**:
- `AUTH_FAILED` - Authentication failed
- `INVALID_MESSAGE` - Message format invalid
- `JOB_FAILED` - Print job failed
- `DEVICE_NOT_FOUND` - Device not registered
- `TIMEOUT` - Operation timeout

## Connection Lifecycle

```
1. Device connects to WebSocket server
2. Device sends device_register
3. Server validates and responds with device_register_ack
4. Device starts heartbeat loop (every 30s)
5. Server sends print_job when available
6. Device responds with job_received
7. Device processes job and sends job_update messages
8. Loop continues until disconnection
```

## Timeout Behavior

### Heartbeat Timeout

- **Interval**: 30 seconds
- **Timeout**: 90 seconds (3 missed heartbeats)
- **Action**: Server marks device offline and closes connection

### Message Response Timeout

- **Timeout**: 10 seconds for acknowledgments
- **Action**: Log warning, retry if critical

## Connection Recovery

### Device Reconnection

1. Device detects disconnection
2. Wait with exponential backoff (5s, 10s, 20s, ..., max 60s)
3. Reconnect to server
4. Re-register using existing device token
5. Resume heartbeat

### Server-Side Recovery

1. Detect device disconnection
2. Mark device as offline
3. Hold pending jobs in queue
4. On reconnection, send pending jobs

## Security Considerations

### Authentication

- Devices must authenticate with valid device token
- Tokens are JWT with shop and device claims
- Token expiry: 365 days
- Invalid tokens result in connection rejection

### Authorization

- Devices can only receive jobs for their shop
- Server validates shopCode on all messages
- Cross-shop access denied

### Message Validation

- All messages validated against schema
- Malformed messages result in error response
- Invalid message types logged and ignored

## Rate Limiting

### Heartbeat

- Max 1 heartbeat per 20 seconds
- Excess heartbeats ignored

### Job Updates

- Max 10 updates per second per device
- Excess updates throttled

## Example Message Flow

### Complete Print Job Sequence

```
1. Device → Server: device_register
2. Server → Device: device_register_ack
3. Device → Server: heartbeat (every 30s)
4. Server → Device: heartbeat_ack
5. Server → Device: print_job
6. Device → Server: job_received
7. Device → Server: job_update (status: "printing")
8. Device → Server: job_update (status: "completed")
9. Device → Server: heartbeat
10. Server → Device: heartbeat_ack
```

### Error Handling

```
1. Server → Device: print_job
2. Device → Server: job_received
3. Device → Server: job_update (status: "printing")
4. [Error occurs]
5. Device → Server: job_update (status: "failed", errorMessage: "Printer offline")
6. Server logs error and notifies user
```

## Message Examples

### Full Registration Flow

```json
// Device → Server
{
  "type": "device_register",
  "requestId": "req_abc123",
  "shopCode": "SHOP001",
  "deviceId": "DEVICE001",
  "payload": {
    "deviceId": "DEVICE001",
    "pcName": "Shop Main PC",
    "shopCode": "SHOP001"
  }
}

// Server → Device
{
  "type": "device_register_ack",
  "requestId": "req_abc123",
  "shopCode": "SHOP001",
  "deviceId": "DEVICE001",
  "payload": {
    "success": true,
    "deviceId": "DEVICE001",
    "deviceToken": "eyJhbGciOiJIUzI1NiIs...",
    "heartbeatInterval": 30000
  }
}
```

### Full Print Job Flow

```json
// Server → Device: Send job
{
  "type": "print_job",
  "requestId": "req_xyz789",
  "shopCode": "SHOP001",
  "deviceId": "DEVICE001",
  "payload": {
    "jobId": "job_abc123",
    "fileUrl": "https://storage.example.com/document.pdf",
    "fileName": "document.pdf",
    "fileType": "application/pdf",
    "copies": 1
  }
}

// Device → Server: Acknowledge
{
  "type": "job_received",
  "requestId": "req_xyz789",
  "shopCode": "SHOP001",
  "deviceId": "DEVICE001",
  "payload": {
    "jobId": "job_abc123",
    "receivedAt": 1709980800000
  }
}

// Device → Server: Update status
{
  "type": "job_update",
  "requestId": "req_new456",
  "shopCode": "SHOP001",
  "deviceId": "DEVICE001",
  "payload": {
    "jobId": "job_abc123",
    "status": "completed"
  }
}
```

## Versioning

- **Current Version**: 1.0
- **Protocol**: WebSocket (RFC 6455)
- **Encoding**: UTF-8 JSON
- **Date Format**: ISO 8601 for timestamps

## Future Extensions

Potential future message types:

- `device_config_update` - Push configuration changes
- `job_cancel` - Cancel pending job
- `file_preview` - Request file preview
- `bulk_print_job` - Send multiple jobs
- `device_command` - Send arbitrary commands

## Implementation Notes

### Backend (Node.js)

```javascript
// Message handler example
function handleMessage(ws, message) {
  switch (message.type) {
    case 'device_register':
      handleDeviceRegister(ws, message);
      break;
    case 'heartbeat':
      handleHeartbeat(ws, message);
      break;
    case 'job_update':
      handleJobUpdate(message);
      break;
    default:
      sendError(ws, 'Unknown message type', message.requestId);
  }
}
```

### PC Client (Electron)

```javascript
// Message sender example
function sendMessage(type, payload) {
  const message = {
    type,
    requestId: generateId(),
    shopCode: config.shopCode,
    deviceId: config.deviceId,
    payload,
  };
  ws.send(JSON.stringify(message));
}
```

## References

- WebSocket RFC: https://tools.ietf.org/html/rfc6455
- JWT Spec: https://tools.ietf.org/html/rfc7519
- JSON Schema: https://json-schema.org/
