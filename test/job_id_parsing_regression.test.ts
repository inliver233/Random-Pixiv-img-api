import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('job id parsing regression', () => {
  it('does not use the broken /^\\\\d+$/ regex in hydrateMetadata.ts', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/jobs/hydrateMetadata.ts'), 'utf8');
    expect(source).not.toContain('^\\\\d+$');
    expect(source).toContain('&& /^\\d+$/.test(value.trim())');
  });

  it('does not use the broken /^\\\\d+$/ regex in hydrationBackfill.ts', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/jobs/hydrationBackfill.ts'), 'utf8');
    expect(source).not.toContain('^\\\\d+$');
    expect(source).toContain('&& /^\\d+$/.test(value.trim())');
  });
});

