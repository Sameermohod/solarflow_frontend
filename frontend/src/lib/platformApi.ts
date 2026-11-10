import { ApiError } from './api';

/**
 * Client for the platform (super admin) API. It uses its own token, kept in sessionStorage so it ends with the tab and
 * is never mixed with a company user's session. There is no refresh: an expired token sends the admin back to sign in.
 */
const BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4001/api/v1';
const KEY = 'sf.platform.token';

export const platformToken = {
  get: (): string | null => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t: string) => { try { sessionStorage.setItem(KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
};

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'solarflow' };
  const t = platformToken.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/platform${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') { platformToken.clear(); window.dispatchEvent(new Event('sf:platform-logout')); }
    throw new ApiError(res.status, json?.error?.message ?? res.statusText, json?.error?.code);
  }
  return json as T;
}

export const platformApi = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => req<T>('PUT', p, b ?? {}),
};
