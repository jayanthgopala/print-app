# Frontend Web Application

React-based web application for the cloud printing platform.

## Features

- ✅ Shop authentication
- ✅ File upload with drag & drop
- ✅ Print job submission
- ✅ Real-time job status tracking
- ✅ Device status monitoring
- ✅ Responsive design
- ✅ Modern UI with animations

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:
- `VITE_API_URL`: Backend API URL
- `VITE_STORAGE_UPLOAD_URL`: Direct upload URL for object storage

## Development

```bash
npm run dev
```

The app will start at `http://localhost:5173`

## Building for Production

```bash
npm run build
```

The production build will be in the `dist/` folder.

## Preview Production Build

```bash
npm run preview
```

## Project Structure

```
src/
├── components/           # React components
│   ├── Header.jsx
│   ├── FileUpload.jsx
│   ├── JobsList.jsx
│   └── DeviceStatus.jsx
├── pages/               # Page components
│   ├── Login.jsx
│   └── Dashboard.jsx
├── context/             # React context
│   └── AuthContext.jsx
├── services/            # API services
│   └── api.js
├── hooks/               # Custom hooks
│   └── useWebSocket.js
├── App.jsx              # Main app component
└── main.jsx             # App entry point
```

## Features Explained

### Authentication
- JWT-based authentication
- Token stored in localStorage
- Auto-redirect on expiry

### File Upload
- Drag & drop support
- File validation (type & size)
- Progress indication
- Direct upload to object storage

### Real-time Updates
- WebSocket connection for live job updates
- Auto-refresh fallback
- Connection status indicator

### Print Jobs
- Submit new print jobs
- View job history
- Track job status
- Cancel pending jobs

### Device Management
- View connected devices
- Online/offline status
- Last seen timestamp

## Deployment

### Vercel

```bash
npm install -g vercel
vercel
```

### Netlify

```bash
npm install -g netlify-cli
netlify deploy --prod
```

### Cloudflare Pages

1. Connect your repository
2. Set build command: `npm run build`
3. Set output directory: `dist`

## Environment Variables

Set these in your deployment platform:

- `VITE_API_URL`: Production API URL
- `VITE_WS_URL`: Production WebSocket URL
- `VITE_STORAGE_UPLOAD_URL`: Storage upload endpoint

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile browsers: iOS Safari, Chrome Android

## Security

- HTTPS only in production
- JWT tokens with expiry
- Input validation
- File type restrictions
- XSS protection via React

## Performance

- Code splitting
- Lazy loading
- Optimized bundle size
- Static asset caching

## License

Proprietary
