import { afterEach, describe, expect, it, vi } from 'vitest';
import { JevClient } from '../src/adapters/jevClient';

describe('JevClient (TypeSafe API adapter)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should POST typed questions to /v1/systemone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answers: { ok: { type: 'noul', noul: 0.8 } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new JevClient('ts_test_key');
    const res = await client.systemOne({
      state: { query: 'q' },
      questions: { ok: { type: 'noul', instructions: 'ok?' } },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('jev-latest');
    expect(body.questions.ok.type).toBe('noul');
    expect(res.isSimulated).toBe(false);
  });

  it('should report a fallback instead of silently simulating when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'bad request' }));
    const onFallback = vi.fn();

    const client = new JevClient('ts_test_key');
    client.onFallback = onFallback;
    const res = await client.systemOne({
      state: { query: 'q' },
      questions: { ok: { type: 'noul', instructions: 'ok?' } },
    });

    expect(res.isSimulated).toBe(true);
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ reason: 'http_error' }));
  });
});
