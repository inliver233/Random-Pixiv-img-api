import { describe, expect, it } from 'vitest';

import { classifyOutboundError } from '../src/resilience/outboundErrors';

describe('classifyOutboundError', () => {
  it('classifies axios timeouts', () => {
    const err: any = { code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' };
    expect(classifyOutboundError(err)).toMatchObject({ type: 'timeout', retryable: true });
  });

  it('classifies proxy auth failures via 407', () => {
    const err: any = { response: { status: 407, data: 'Proxy Authentication Required' } };
    expect(classifyOutboundError(err, { usedProxy: true })).toMatchObject({ type: 'proxy_auth', retryable: false, status: 407 });
  });

  it('classifies pixiv rate limit', () => {
    const err: any = { response: { status: 403, data: { error: { message: 'Rate Limit' } } } };
    expect(classifyOutboundError(err)).toMatchObject({ type: 'pixiv_rate_limit', retryable: true, status: 403 });
  });

  it('classifies pixiv 403 (non rate-limit)', () => {
    const err: any = { response: { status: 403, data: { error: { message: 'Forbidden' } } } };
    expect(classifyOutboundError(err)).toMatchObject({ type: 'pixiv_403', retryable: false, status: 403 });
  });

  it('classifies pixiv 5xx', () => {
    const err: any = { response: { status: 503 } };
    expect(classifyOutboundError(err)).toMatchObject({ type: 'pixiv_5xx', retryable: true, status: 503 });
  });

  it('classifies proxy connect failures when usedProxy=true', () => {
    const err: any = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:18080' };
    expect(classifyOutboundError(err, { usedProxy: true })).toMatchObject({ type: 'proxy_connect', retryable: true });
  });

  it('classifies generic network failures when not using proxy', () => {
    const err: any = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:18080' };
    expect(classifyOutboundError(err, { usedProxy: false })).toMatchObject({ type: 'network', retryable: true });
  });
});

