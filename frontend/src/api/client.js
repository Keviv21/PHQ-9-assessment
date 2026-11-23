// Only a public API address is configurable in the browser. Database URLs and
// provider keys belong exclusively to backend/.env.
const base = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path) {
  const url = new URL(path, window.location.origin);
  return base ? `${base}${url.pathname}${url.search}` : `${url.pathname}${url.search}`;
}

export async function apiFetch(path, options) {
  try {
    return await globalThis.fetch(apiUrl(path), options);
  } catch (cause) {
    throw new Error('Unable to reach the assessment server. Check that the backend is running.', { cause });
  }
}

export function socketUrl(path) {
  const url = new URL(apiUrl(path), window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
