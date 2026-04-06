const DEFAULT_API_URL = 'https://backend.buildergrids.tech';

function normalizeApiUrl(value) {
  const raw = String(value || '').trim();
  const candidate = raw || DEFAULT_API_URL;
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  return withProtocol.replace(/\/$/, '');
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);

export { API_URL };
