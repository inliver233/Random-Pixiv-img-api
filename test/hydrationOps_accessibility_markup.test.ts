import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('hydrationOps accessibility markup', () => {
  it('binds DLQ queue label and form control id/name', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/admin/pages/hydrationOps.jsx'), 'utf8');
    expect(source).toContain('label htmlFor="hydration-dlq-queue"');
    expect(source).toContain('id="hydration-dlq-queue"');
    expect(source).toContain('name="hydration_dlq_queue"');
  });
});

