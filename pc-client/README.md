# PC Client Application

Electron-based PC client for the cloud printing platform. Runs on shop PCs and receives print jobs via WebSocket.

## Features

- ✅ Persistent WebSocket connection to server
- ✅ Auto-reconnection with exponential backoff
- ✅ Local print queue management
- ✅ Printer integration
- ✅ File download from object storage
- ✅ Real-time job status updates
- ✅ System tray integration
- ✅ Runs in background

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `SHOP_CODE`: Your shop identifier
- `SERVER_URL`: WebSocket server URL
- `PC_NAME`: Name for this PC (optional, defaults to hostname)

## Development

```bash
npm run dev
```

This starts the Electron app with DevTools enabled.

## Building

Build for your platform:

```bash
# Windows
npm run build-win

# macOS
npm run build-mac

# Linux
npm run build-linux
```

The installer will be created in the `dist/` folder.

## Usage

1. Configure your shop credentials in `.env`
2. Start the application
3. The app will connect to the server automatically
4. Minimize to system tray - the app continues running in the background
5. Print jobs will be received and printed automatically

## How It Works

1. **Connection**: App connects to WebSocket server on startup
2. **Registration**: Registers device with shop code and device token
3. **Heartbeat**: Sends heartbeat every 30 seconds to maintain connection
4. **Receive Jobs**: Server pushes print jobs via WebSocket
5. **Download**: Downloads print file from object storage
6. **Print**: Sends file to local printer
7. **Update**: Reports job status back to server

## Security

- Device authentication using JWT tokens
- Tokens stored securely in electron-store
- File name sanitization to prevent path traversal
- Secure WebSocket connection (WSS in production)

## Printer Support

The app uses `pdf-to-printer` library which supports:
- Windows: All installed printers
- macOS: System printers
- Linux: CUPS printers

Supported file types:
- PDF (recommended)
- PNG, JPEG images

## Troubleshooting

### Connection Issues

- Check SERVER_URL is correct
- Verify shop credentials
- Check firewall settings
- Review logs in the app

### Print Issues

- Verify printer is online
- Check default printer is set
- Ensure PDF/image files are valid
- Review printer permissions

### Auto-start on Boot

To make the app start automatically:

**Windows:**
1. Press `Win + R`
2. Type `shell:startup`
3. Create shortcut to the installed app

**macOS:**
1. System Preferences → Users & Groups
2. Login Items → Add the app

**Linux:**
1. Add to autostart applications in your desktop environment

## Logs

The app logs to:
- Console (visible in DevTools)
- Activity log in the UI

## Updates

To update the app:
1. Download new version
2. Install over existing installation
3. Configuration and device tokens are preserved

## License

Proprietary
