const API_URL = import.meta.env.VITE_API_URL || '';
const WS_URL = import.meta.env.VITE_WS_URL || (API_URL ? API_URL.replace(/^http/i, 'ws') : '');
const DEFAULT_STUN_URLS = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302'
];

function buildIceServers() {
    const configuredStunUrls = String(import.meta.env.VITE_STUN_URLS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const stunUrls = configuredStunUrls.length > 0 ? configuredStunUrls : DEFAULT_STUN_URLS;
    const iceServers = stunUrls.map((urls) => ({ urls }));

    const turnUrl = String(import.meta.env.VITE_TURN_URL || '').trim();
    const turnUsername = String(import.meta.env.VITE_TURN_USERNAME || '').trim();
    const turnCredential = String(import.meta.env.VITE_TURN_CREDENTIAL || '').trim();

    if (turnUrl) {
        iceServers.push({
            urls: turnUrl,
            username: turnUsername,
            credential: turnCredential
        });
    }

    return iceServers;
}

const ICE_SERVERS = buildIceServers();

export { API_URL, WS_URL, ICE_SERVERS };
