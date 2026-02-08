import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('hydration_backfill missing-tags criteria', () => {
  it('supports tags in missing_fields and maps it to imageTags none filter', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/jobs/hydrationBackfill.ts'), 'utf8');
    expect(source).toContain("return 'tags'");
    expect(source).toContain('imageTags: { none: {} }');
  });
});

