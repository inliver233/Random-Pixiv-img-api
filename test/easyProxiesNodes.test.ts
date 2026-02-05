import { describe, expect, it, vi } from 'vitest';

import { easyProxiesDebug, easyProxiesNodes } from '../src/proxy/easyProxiesClient';

describe('easyProxiesClient nodes/debug', () => {
  it('fetches /api/nodes without auth when password is not set', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      expect(init?.headers?.authorization).toBeUndefined();

      if (url.endsWith('/api/nodes')) {
        return new Response(JSON.stringify({
          nodes: [{ tag: 'n1', name: 'Node1', mode: 'single', port: 24001, last_latency_ms: 123 }],
          total_nodes: 2,
          region_stats: { jp: 2 },
          region_healthy: { jp: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    const res = await easyProxiesNodes({ baseUrl: 'http://localhost:9090', fetch: fetchMock as any });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.baseUrl).toBe('http://localhost:9090');
    expect(res.total_nodes).toBe(2);
    expect(res.nodes.length).toBe(1);
    expect(res.token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('authenticates then fetches /api/nodes with bearer token when password is set', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input);

      if (url.endsWith('/api/auth')) {
        return new Response(JSON.stringify({ token: 'tok123' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.endsWith('/api/nodes')) {
        expect(String(init?.headers?.authorization)).toBe('Bearer tok123');
        return new Response(JSON.stringify({ nodes: [], total_nodes: 0, region_stats: {}, region_healthy: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    const res = await easyProxiesNodes({ baseUrl: 'http://localhost:9090', password: 'pw', fetch: fetchMock as any });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token).toBe('tok123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches /api/debug and parses summary fields', async () => {
    const fetchMock = vi.fn(async (input: any, _init?: any) => {
      const url = String(input);

      if (url.endsWith('/api/debug')) {
        return new Response(JSON.stringify({
          nodes: [{ tag: 'n1', name: 'Node1', mode: 'single', port: 24001, last_latency_ms: 111 }],
          total_calls: 10,
          total_success: 7,
          success_rate: 70,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    const res = await easyProxiesDebug({ baseUrl: 'http://localhost:9090', fetch: fetchMock as any, token: 't' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.total_calls).toBe(10);
    expect(res.total_success).toBe(7);
    expect(res.success_rate).toBe(70);
    expect(res.nodes[0]?.tag).toBe('n1');
  });
});
