# Print Shop File Transfer System Architecture

## 1. System Overview
This system enables direct Peer-to-Peer (P2P) file transfer from a customer's mobile browser to a shop's PC using WebRTC. The backend serves only as a signaling server and subscription validator, never handling file data.

## 2. Architecture Components

### A. Frontend (Customer)
- **Tech**: React (Vite), WebRTC (Native API).
- **Role**: Scans QR, connects to Signaling Server, establishes P2P connection, sends file.
- **Hosting**: Static hosting (Cloudflare Pages / Vercel).
- **Security**: Validates file type/size before sending. No auth required (public QR).

### B. PC Application (Shop)
- **Tech**: Electron, Node.js, `wrtc` (Node WebRTC), WebSocket.
- **Role**: Authenticates as Shop, listens for connections, receives files, saves to disk.
- **Security**: Validates subscription token, re-validates file type/size.

### C. Backend (Signaling)
- **Tech**: Node.js, Express, `ws` (WebSocket), PostgreSQL.
- **Role**: 
    - Authenticates PC App.
    - Routes WebRTC signaling messages (Offer/Answer/ICE).
    - Checks Subscription status.
    - **NEVER** touches file data.

### D. Database
- **Tech**: PostgreSQL (Supabase).
- **Role**: Stores Shop credentials and Subscription status.

## 3. System Flow

1.  **Shop Login**: PC App logs in -> Backend validates -> Returns JWT.
2.  **Shop Online**: PC App connects to WS with JWT -> Backend marks Shop as ONLINE.
3.  **Customer Scan**: User scans QR (`app.com/?shopId=123`).
4.  **Status Check**: Frontend connects to WS -> Asks "Is Shop 123 Online?".
5.  **P2P Handshake**:
    - Frontend creates WebRTC Offer -> Sends to Backend -> Backend forwards to PC.
    - PC accepts Offer -> Creates Answer -> Sends to Backend -> Backend forwards to Frontend.
    - ICE Candidates exchanged similarly.
6.  **File Transfer**:
    - Direct DataChannel opens between Frontend and PC.
    - File sent in chunks.
    - PC reassembles and saves.

## 4. Folder Structure
```
/
├── backend/          # Node.js Signaling Server
│   ├── server.js     # Main entry point
│   └── package.json
├── database/         # SQL Scripts
│   └── schema.sql    # DB Schema
├── frontend/         # React Web App
│   ├── src/
│   │   └── services/
│   │       └── webrtc.js # WebRTC Logic
├── pc-app/           # Electron App
│   ├── src/
│   │   └── services/
│   │       └── fileReceiver.js # Receiver Logic
```

## 5. Failure Handling

| Failure Case | Handling Strategy |
| :--- | :--- |
| **Shop Offline** | Frontend receives "OFFLINE" status from Backend. UI shows "Shop is currently offline". |
| **Subscription Expired** | Backend checks DB on connection. If expired, returns "EXPIRED" status. PC App refuses to accept files. |
| **P2P Blocked (NAT)** | Use STUN server (Google's public STUN). If strict firewall, fallback to TURN (requires hosting/cost). |
| **File Too Large** | Frontend checks size < 100MB. PC App double-checks metadata before accepting. |
| **Network Drop** | WebRTC `iceConnectionState` changes to `disconnected`. UI prompts user to retry. |

## 6. Security & Production Rules
- **No Files on Server**: Backend only routes JSON messages.
- **Token Security**: PC App JWT expires every 12-24h.
- **Input Validation**: PC App sanitizes filenames to prevent directory traversal attacks.
