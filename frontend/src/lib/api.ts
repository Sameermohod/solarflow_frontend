export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

// Override with VITE_API_URL (default in production: /api/v1, proxied to the backend by vercel.json so the login cookie stays first-party).
const BASE: string = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '/api/v1' : 'http://localhost:4001/api/v1');
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: Promise<string | null> | null = null;

export const tokenStore = {
  set: (t: string | null) => { accessToken = t; },
  get: () => accessToken,
  onSessionLost: (fn: () => void) => { onSessionLost = fn; },
};

async function parse(res: Response) {
  if (res.status === 204) return undefined;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(res.status, e?.message ?? res.statusText, e?.code, Array.isArray(e?.details) ? e.details : undefined);
  }
  return body;
}

/** Single-flight refresh: concurrent 401s share one rotation (a second call would trip reuse detection). */
export function refreshSession(): Promise<string | null> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'solarflow' } })
    .then(async (r) => {
      if (!r.ok) return null;
      const body = await r.json();
      accessToken = body.accessToken;
      window.dispatchEvent(new CustomEvent('sf:session', { detail: body }));
      return accessToken;
    })
    .catch(() => null)
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'solarflow' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload, credentials: 'include' });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const t = await refreshSession();
    if (t) return request<T>(method, path, body, false);
    onSessionLost?.();
  }
  return parse(res) as Promise<T>;
}

/** Fetch a protected file (needs the bearer token, so <img src> cannot be used directly). */
export async function fetchBlob(path: string, retry = true): Promise<Blob> {
  const headers: Record<string, string> = { 'X-Requested-With': "solarflow" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, { headers, credentials: "include" });
  if (res.status === 401 && retry) {
    const t = await refreshSession();
    if (t) return fetchBlob(path, false);
    onSessionLost?.();
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  delete: <T = void>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => request<T>('POST', p, form),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
