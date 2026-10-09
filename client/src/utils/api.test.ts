import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from './api.js';

describe('api wrapper', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it('api.get returns parsed JSON on success', async () => {
    const data = { id: 1, name: 'test' };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(data), { status: 200 }));

    const result = await api.get<typeof data>('/test');

    expect(result).toEqual(data);
  });

  it('api.get throws ApiError with status on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );

    await expect(api.get('/missing')).rejects.toThrow(ApiError);
    await expect(api.get('/missing')).rejects.toMatchObject({ status: 404, name: 'ApiError' });
  });

  it('api.post sends correct method, body, and Content-Type header', async () => {
    const responseData = { created: true };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(responseData), { status: 201 })
    );

    const payload = { name: 'new item' };
    await api.post('/items', payload);

    expect(fetch).toHaveBeenCalledOnce();
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.method).toBe('POST');
    expect(options?.body).toBe(JSON.stringify(payload));
    expect((options?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('api.post throws ApiError on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );

    let caught: unknown;
    try {
      await api.post('/missing', { data: 'value' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(404);
    expect((caught as ApiError).name).toBe('ApiError');
  });

  it('AbortSignal is passed through to fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const controller = new AbortController();
    await api.get('/test', controller.signal);

    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.signal).toBe(controller.signal);
  });

  it('AbortSignal is passed through to fetch for post requests', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const controller = new AbortController();
    await api.post('/test', { x: 1 }, controller.signal);

    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.signal).toBe(controller.signal);
  });
});
