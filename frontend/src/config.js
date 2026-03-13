const API_URL = import.meta.env.VITE_API_URL || '';
const WS_URL = import.meta.env.VITE_WS_URL || (API_URL ? API_URL.replace(/^http/i, 'ws') : '');

export { API_URL, WS_URL };
