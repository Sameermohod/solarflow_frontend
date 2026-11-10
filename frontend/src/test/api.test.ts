import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, tokenStore, ApiError } from '@/lib/api';

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const sessionBody = (t: string) => ({ accessToken: t, user: {}, organization: {}, roles: [], permissions: [] });

describe('api client', () => {
  beforeEach(() => tokenStore.set('old'));
  afterEach(() => vi.restoreAllMocks());

  it('sends bearer token and CSRF header', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: 1 }));
    await api.get('/users');
    const h = (f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer old');
    expect(h['X-Requested-With']).toBe('solarflow');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: { message: 'expired' } }))
      .mockResolvedValueOnce(json(200, sessionBody('new')))
      .mockResolvedValueOnce(json(200, { data: [] }));
    expect(await api.get('/users')).toEqual({ data: [] });
    expect(f).toHaveBeenCalledTimes(3);
    expect(tokenStore.get()).toBe('new');
  });

  it('concurrent 401s share ONE refresh call (a second would trip reuse detection)', async () => {
    let refreshes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, sessionBody('n2'));
      }
      const h = (init?.headers ?? {}) as Record<string, string>;
      return h.Authorization === 'Bearer n2' ? json(200, { ok: true }) : json(401, { error: { message: 'x' } });
    });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshes).toBe(1);
  });

  it('signals session loss when refresh fails', async () => {
    const lost = vi.fn();
    tokenStore.onSessionLost(lost);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { error: { message: 'no' } }));
    await expect(api.get('/users')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalled();
  });

  it('surfaces server error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, { error: { code: 'CONFLICT', message: 'Email taken' } }));
    await expect(api.post('/users', {})).rejects.toMatchObject({ status: 409, message: 'Email taken' });
  });
});
