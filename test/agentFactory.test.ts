import http from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDirectAgentPair, getProxyAgentPair } from '../src/proxy/agentFactory';
import { pixivApiGet } from '../src/http/axiosClient';

function listen(server: http.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected address'));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agentFactory', () => {
  it('caches direct agent pairs by options', () => {
    const a = getDirectAgentPair({ keepAlive: true, maxSockets: 10 });
    const b = getDirectAgentPair({ keepAlive: true, maxSockets: 10 });
    const c = getDirectAgentPair({ keepAlive: true, maxSockets: 11 });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('caches proxy agent pairs by proxy+options', () => {
    const a = getProxyAgentPair('http://user:pass@127.0.0.1:8080', { keepAlive: true, maxSockets: 10 });
    const b = getProxyAgentPair('http://user:pass@127.0.0.1:8080', { keepAlive: true, maxSockets: 10 });
    const c = getProxyAgentPair('http://user:pass@127.0.0.1:8080', { keepAlive: true, maxSockets: 11 });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('routes an HTTP request through a local HTTP proxy stub', async () => {
    const proxyRequests: string[] = [];
    const proxySockets = new Set<string>();

    const targetServer = http.createServer((req, res) => {
      if (req.url === '/ping') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('pong');
        return;
      }
      res.writeHead(404);
      res.end('not_found');
    });

    const proxyServer = http.createServer((req, res) => {
      proxyRequests.push(String(req.url || ''));

      const u = new URL(String(req.url || ''), 'http://proxy.invalid');
      const forward = http.request(
        {
          method: req.method,
          hostname: u.hostname,
          port: Number(u.port || '80'),
          path: `${u.pathname}${u.search}`,
          headers: req.headers,
        },
        (forwardRes) => {
          res.writeHead(forwardRes.statusCode || 502, forwardRes.headers as any);
          forwardRes.pipe(res);
        },
      );

      forward.on('error', () => {
        res.writeHead(502);
        res.end('bad_gateway');
      });

      req.pipe(forward);
    });

    proxyServer.on('connection', (socket) => {
      proxySockets.add(`${socket.remoteAddress}:${socket.remotePort}`);
    });

    const target = await listen(targetServer);
    const proxy = await listen(proxyServer);

    try {
      const targetUrl = `http://127.0.0.1:${target.port}/ping`;
      const proxyUri = `http://127.0.0.1:${proxy.port}`;

      const res1 = await pixivApiGet<string>(targetUrl, { proxyUri, timeout: 5_000 });
      expect(res1.status).toBe(200);
      expect(res1.data).toBe('pong');

      const res2 = await pixivApiGet<string>(targetUrl, { proxyUri, timeout: 5_000 });
      expect(res2.status).toBe(200);
      expect(res2.data).toBe('pong');

      expect(proxyRequests.length).toBeGreaterThanOrEqual(2);
      expect(proxyRequests[0]).toContain(targetUrl);

      // With keep-alive and agent caching, the proxy connection should be reused.
      expect(proxySockets.size).toBe(1);
    } finally {
      await proxy.close();
      await target.close();
    }
  });
});

