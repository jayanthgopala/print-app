const DEFAULT_API_URL = 'https://backend.buildergrids.tech';

const API_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/$/, '');

export { API_URL };
