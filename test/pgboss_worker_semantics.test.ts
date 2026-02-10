import { afterEach, describe, expect, it, vi } from 'vitest';

import * as queue from '../src/queue/queue';
import * as importJobs from '../src/jobs/importImages';
import * as adminActions from '../src/jobs/adminActions';

describe('pg-boss worker callback semantics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registerAdminImportWorker uses jobs[] callback and delegates to handlers', async () => {
    const fakeBoss = { work: vi.fn(async () => undefined) } as any;

    vi.spyOn(queue, 'startQueue').mockResolvedValue(fakeBoss);
    vi.spyOn(queue, 'ensureQueue').mockResolvedValue(fakeBoss);

    const handleImport = vi.spyOn(importJobs.adminImportWorkerHandlers, 'handleAdminImagesImportJobs').mockResolvedValueOnce({ ok: true } as any);
    const handleRollback = vi.spyOn(importJobs.adminImportWorkerHandlers, 'handleAdminImportRollbackJobs').mockResolvedValueOnce({ ok: true } as any);

    await importJobs.registerAdminImportWorker();

    const importCall = fakeBoss.work.mock.calls.find((call: any[]) => call[0] === 'admin_images_import');
    const rollbackCall = fakeBoss.work.mock.calls.find((call: any[]) => call[0] === 'admin_import_rollback');

    expect(importCall).toBeTruthy();
    expect(rollbackCall).toBeTruthy();

    expect(importCall?.[1]).toMatchObject({ batchSize: 1 });
    expect(rollbackCall?.[1]).toMatchObject({ batchSize: 1 });

    const importCallback = importCall?.[2] as (jobs: any[]) => Promise<any>;
    const rollbackCallback = rollbackCall?.[2] as (jobs: any[]) => Promise<any>;

    await importCallback([{ id: 'job-1', data: { import_id: '10', items: [{ line: 1, illust_id: '1', page_index: 0, ext: 'jpg', original_url: 'x' }] } }]);
    await rollbackCallback([{ id: 'job-2', data: { import_id: '10', mode: 'disable' } }]);

    expect(handleImport).toHaveBeenCalledTimes(1);
    expect(handleImport).toHaveBeenCalledWith(expect.any(Array));
    expect(handleRollback).toHaveBeenCalledTimes(1);
    expect(handleRollback).toHaveBeenCalledWith(expect.any(Array));
  });

  it('registerAdminActionsWorker uses jobs[] callback and delegates to handlers', async () => {
    const fakeBoss = { work: vi.fn(async () => undefined) } as any;

    vi.spyOn(queue, 'startQueue').mockResolvedValue(fakeBoss);
    vi.spyOn(queue, 'ensureQueue').mockResolvedValue(fakeBoss);

    const handleRefresh = vi.spyOn(adminActions.adminActionsWorkerHandlers, 'handleAdminPixivTokenTestRefreshJobs').mockResolvedValueOnce({ ok: true } as any);
    const handleProbe = vi.spyOn(adminActions.adminActionsWorkerHandlers, 'handleAdminProxyEndpointProbeJobs').mockResolvedValueOnce({ ok: true } as any);

    await adminActions.registerAdminActionsWorker();

    const refreshCall = fakeBoss.work.mock.calls.find((call: any[]) => call[0] === 'admin_pixiv_token_test_refresh');
    const probeCall = fakeBoss.work.mock.calls.find((call: any[]) => call[0] === 'admin_proxy_endpoint_probe');

    expect(refreshCall).toBeTruthy();
    expect(probeCall).toBeTruthy();

    expect(refreshCall?.[1]).toMatchObject({ batchSize: 1 });
    expect(probeCall?.[1]).toMatchObject({ batchSize: 1 });

    const refreshCallback = refreshCall?.[2] as (jobs: any[]) => Promise<any>;
    const probeCallback = probeCall?.[2] as (jobs: any[]) => Promise<any>;

    await refreshCallback([{ id: 'job-3', data: { token_id: '1' } }]);
    await probeCallback([{ id: 'job-4', data: { endpoint_id: '1' } }]);

    expect(handleRefresh).toHaveBeenCalledTimes(1);
    expect(handleRefresh).toHaveBeenCalledWith(expect.any(Array));
    expect(handleProbe).toHaveBeenCalledTimes(1);
    expect(handleProbe).toHaveBeenCalledWith(expect.any(Array));
  });
});
