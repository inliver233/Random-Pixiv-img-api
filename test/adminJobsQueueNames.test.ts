import { describe, expect, it } from 'vitest';

import { getAdminJobsQueueNames } from '../src/admin/utils/adminJobsQueueNames';

describe('getAdminJobsQueueNames', () => {
  it('includes core queues', () => {
    process.env.QUEUE_DEAD_LETTER_ENABLED = '1';
    process.env.QUEUE_DEAD_LETTER_SUFFIX = '__dlq';

    const names = getAdminJobsQueueNames();

    expect(names).toContain('admin_pixiv_token_test_refresh');
    expect(names).toContain('admin_proxy_endpoint_probe');
    expect(names).toContain('admin_images_import');
    expect(names).toContain('admin_import_rollback');
    expect(names).toContain('hydrate_metadata');
    expect(names).toContain('heal_url');
    expect(names).toContain('hydration_backfill');
  });

  it('adds DLQ queues when enabled', () => {
    process.env.QUEUE_DEAD_LETTER_ENABLED = '1';
    process.env.QUEUE_DEAD_LETTER_SUFFIX = '__dlq';

    const names = getAdminJobsQueueNames();
    expect(names).toContain('admin_images_import__dlq');
    expect(names).toContain('hydrate_metadata__dlq');
  });
});

