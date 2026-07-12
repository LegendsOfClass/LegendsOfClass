/** Networking layer — the ONLY module that talks to the server (Rule 4 separation). */
// Dev: talk to the local API. Production: same origin (server serves both game and API).
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3000');
let token: string | null = localStorage.getItem('loce.token');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('loce.token', t); else localStorage.removeItem('loce.token');
}
export function hasToken() { return !!token; }

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ messageKey: 'error.network' }));
    throw Object.assign(new Error(err.messageKey ?? 'error'), { code: res.status, messageKey: err.messageKey });
  }
  return res.json();
}
