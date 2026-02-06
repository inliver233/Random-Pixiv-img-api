import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('hydration run empty-state recovery', () => {
  it('supports start_backfill action on hydrationOps page handler', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/admin/adminJs.ts'), 'utf8');
    expect(source).toContain("if (action === 'start_backfill')");
    expect(source).toContain('hydration_run_start_from_ops');
  });

  it('guides pause/resume/cancel not-found paths back to hydrationOps', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/admin/adminJs.ts'), 'utf8');
    const redirectHits = source.split("redirectUrl: '/admin/pages/hydrationOps'").length - 1;
    expect(redirectHits).toBeGreaterThanOrEqual(3);
  });

  it('renders UI call-to-action for creating first backfill run', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/admin/pages/hydrationOps.jsx'), 'utf8');
    expect(source).toContain('立即创建首个 backfill run');
    expect(source).toContain("postAction('start_backfill'");
  });
});
