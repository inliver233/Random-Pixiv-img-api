import { describe, expect, it } from 'vitest';

import { parseAdminJobBigIntId } from '../src/jobs/adminActions';

describe('parseAdminJobBigIntId', () => {
  it('accepts primitive shapes (string/number/bigint)', () => {
    expect(parseAdminJobBigIntId('123', 'token_id')).toEqual({ ok: true, id: 123n });
    expect(parseAdminJobBigIntId(123, 'token_id')).toEqual({ ok: true, id: 123n });
    expect(parseAdminJobBigIntId(123n, 'token_id')).toEqual({ ok: true, id: 123n });
  });

  it('accepts AdminJS reference-like shapes ({id}/{value}/{params.id})', () => {
    expect(parseAdminJobBigIntId({ id: '9' }, 'token_id')).toEqual({ ok: true, id: 9n });
    expect(parseAdminJobBigIntId({ value: '10' }, 'token_id')).toEqual({ ok: true, id: 10n });
    expect(parseAdminJobBigIntId({ params: { id: '11' } }, 'token_id')).toEqual({ ok: true, id: 11n });
    expect(parseAdminJobBigIntId({ id: { value: '12' } }, 'token_id')).toEqual({ ok: true, id: 12n });
  });

  it('rejects invalid ids with stable codes', () => {
    const tokenBad = parseAdminJobBigIntId('', 'token_id');
    expect(tokenBad.ok).toBe(false);
    if (!tokenBad.ok) expect(tokenBad.code).toBe('invalid_token_id');

    const endpointBad = parseAdminJobBigIntId({ foo: 'bar' }, 'endpoint_id');
    expect(endpointBad.ok).toBe(false);
    if (!endpointBad.ok) expect(endpointBad.code).toBe('invalid_endpoint_id');
  });
});

