import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit/adminAudit', () => ({
  auditAdminModelChange: vi.fn(),
}));

vi.mock('../src/config/runtimeConfig', () => ({
  invalidateRuntimeCaches: vi.fn(),
}));

vi.mock('../src/jobs/adminActions', () => ({
  enqueueAdminProxyEndpointProbe: vi.fn(),
}));

import { createProxyEndpointResourceOptions } from '../src/admin/resources/proxyEndpoints';
import { enqueueAdminProxyEndpointProbe } from '../src/jobs/adminActions';

describe('AdminJS ProxyEndpoint write-only password', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('declares password property as a password input', () => {
    const options: any = createProxyEndpointResourceOptions({});
    expect(options.properties.password.type).toBe('password');
    expect(String(options.properties.password.props?.placeholder || '')).toContain('留空');
  });

  it('edit.before keeps existing password when empty/placeholder is submitted', async () => {
    const options: any = createProxyEndpointResourceOptions({});
    const before = options.actions.edit.before;

    const out1 = await before({ method: 'post', payload: { host: 'h', password: '' } });
    expect('password' in out1.payload).toBe(false);

    const out2 = await before({ method: 'post', payload: { host: 'h', password: '   ' } });
    expect('password' in out2.payload).toBe(false);

    const out3 = await before({ method: 'post', payload: { host: 'h', password: '***' } });
    expect('password' in out3.payload).toBe(false);
  });

  it('edit.after strips password from record params in GET responses (edit form)', async () => {
    const options: any = createProxyEndpointResourceOptions({});
    const after = options.actions.edit.after;

    const response: any = { record: { params: { id: '1', host: 'h', password: 'secret' } } };
    const out = await after(response, { method: 'get' }, {});
    expect(out.record.params.password).toBeUndefined();
  });

  it('list.after strips password from each record', async () => {
    const options: any = createProxyEndpointResourceOptions({});
    const after = options.actions.list.after;

    const response: any = {
      records: [
        { params: { id: '1', password: 'secret' } },
        { params: { id: '2', password: '' } },
        { params: { id: '3' } },
      ],
    };

    const out = await after(response);
    for (const rec of out.records) {
      expect(rec.params.password).toBeUndefined();
    }
  });

  it('probe GET returns record JSON without leaking password', async () => {
    const options: any = createProxyEndpointResourceOptions({});
    const handler = options.actions.probe.handler;

    const record: any = {
      params: { id: '1', password: 'secret' },
      id: () => '1',
      toJSON: () => ({ params: { id: '1', password: 'secret' } }),
    };

    const out = await handler(
      { method: 'get' },
      {},
      {
        record,
        currentAdmin: {},
        resource: { id: () => 'ProxyEndpoint' },
        h: { resourceUrl: () => '/admin/resources/ProxyEndpoint' },
      },
    );

    expect(out.record.params.password).toBeUndefined();
  });

  it('probe POST enqueues job and does not leak password', async () => {
    (enqueueAdminProxyEndpointProbe as any).mockResolvedValueOnce('job-1');

    const prisma: any = {
      proxyEndpoint: {
        findUnique: vi.fn(async () => ({ id: 1n, enabled: true })),
      },
    };
    const options: any = createProxyEndpointResourceOptions(prisma);
    const handler = options.actions.probe.handler;

    const record: any = {
      params: { id: '1', password: 'secret' },
      id: () => '1',
      toJSON: () => ({ params: { id: '1', password: 'secret' } }),
    };

    const out = await handler(
      { method: 'post', headers: { 'x-request-id': 'req-1' }, session: { admin_user: 'admin' } },
      {},
      {
        record,
        currentAdmin: {},
        resource: { id: () => 'ProxyEndpoint' },
        h: {
          recordActionUrl: () => '/admin/resources/ProxyEndpoint/records/1/show',
          resourceUrl: () => '/admin/resources/ProxyEndpoint',
        },
      },
    );

    expect(prisma.proxyEndpoint.findUnique).toHaveBeenCalledTimes(1);
    expect(enqueueAdminProxyEndpointProbe).toHaveBeenCalledTimes(1);
    expect(out.notice.type).toBe('success');
    expect(String(out.notice.message)).toContain('job-1');
    expect(JSON.stringify(out)).not.toContain('secret');
  });
});
