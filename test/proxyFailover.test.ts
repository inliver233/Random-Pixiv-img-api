import { describe, expect, it, vi } from 'vitest';

import { runWithProxyFailover, runWithTokenProxyFailover } from '../src/proxy/proxyFailover';

describe('runWithTokenProxyFailover', () => {
  it('switches proxy on proxy_connect errors and records evidence', async () => {
    const getToken = vi.fn(async () => ({ tokenId: 't1', tokenIndex: 0, accessToken: 'a1' }));
    const proxies = [
      { id: 'p1', proxyUri: 'http://p1' },
      { id: 'p2', proxyUri: 'http://p2' },
    ];

    let calls = 0;
    const request = vi.fn(async ({ proxyId }: any) => {
      calls += 1;
      if (calls === 1) {
        throw { message: 'proxy down' };
      }
      return { ok: true, proxyId };
    });

    const { value, evidence } = await runWithTokenProxyFailover({
      getToken,
      proxies,
      request,
      options: {
        poolSalt: 'pool:1',
        overrideTtlMs: 60_000,
        maxProxySwitches: 2,
        maxTokenSwitches: 0,
      },
    });

    expect(value.ok).toBe(true);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(evidence.attempts.length).toBe(2);
    expect(evidence.attempts[0]?.errorType).toBe('proxy_connect');
    const used = new Set(evidence.attempts.map((a) => a.proxyId));
    expect(used.size).toBe(2);
  });

  it('switches token when proxy attempts are exhausted', async () => {
    const tokens = [
      { tokenId: 't1', tokenIndex: 0, accessToken: 'a1' },
      { tokenId: 't2', tokenIndex: 1, accessToken: 'a2' },
    ];
    let tokenCursor = 0;
    const getToken = vi.fn(async () => tokens[Math.min(tokenCursor++, tokens.length - 1)]!);

    const proxies = [
      { id: 'p1', proxyUri: 'http://p1' },
      { id: 'p2', proxyUri: 'http://p2' },
    ];

    const request = vi.fn(async ({ tokenId }: any) => {
      if (tokenId === 't1') throw { message: 'proxy down' };
      return { ok: true };
    });

    const { value, evidence } = await runWithTokenProxyFailover({
      getToken,
      proxies,
      request,
      options: {
        poolSalt: 'pool:1',
        overrideTtlMs: 60_000,
        maxProxySwitches: 0,
        maxTokenSwitches: 1,
      },
    });

    expect(value.ok).toBe(true);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(evidence.attempts[0]?.tokenId).toBe('t1');
    expect(evidence.attempts[1]?.tokenId).toBe('t2');
  });

  it('throws immediately for non-proxy failures and attaches evidence', async () => {
    const getToken = vi.fn(async () => ({ tokenId: 't1', tokenIndex: 0, accessToken: 'a1' }));
    const proxies = [{ id: 'p1', proxyUri: 'http://p1' }];

    const request = vi.fn(async () => {
      throw { response: { status: 500 }, message: 'upstream 5xx' };
    });

    await expect(
      runWithTokenProxyFailover({
        getToken,
        proxies,
        request,
        options: {
          poolSalt: 'pool:1',
          overrideTtlMs: 60_000,
          maxProxySwitches: 2,
          maxTokenSwitches: 1,
        },
      }),
    ).rejects.toMatchObject({
      failoverEvidence: {
        attempts: [{ errorType: 'pixiv_5xx' }],
      },
    });
  });
});

describe('runWithProxyFailover', () => {
  it('switches proxy on proxy_connect errors', async () => {
    const proxies = [
      { id: 'p1', proxyUri: 'http://p1' },
      { id: 'p2', proxyUri: 'http://p2' },
    ];

    let calls = 0;
    const request = vi.fn(async ({ proxyId }: any) => {
      calls += 1;
      if (calls === 1) throw { message: 'proxy down' };
      return { ok: true, proxyId };
    });

    const { value, evidence } = await runWithProxyFailover({
      proxies,
      request,
      maxProxySwitches: 2,
    });

    expect(value.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(evidence.attempts[0]?.errorType).toBe('proxy_connect');
  });
});
