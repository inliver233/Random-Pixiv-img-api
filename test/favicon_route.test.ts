import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('favicon route registration', () => {
  it('registers /favicon.ico with 204 response to remove 400 noise', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app.ts'), 'utf8');
    expect(source).toContain("app.get('/favicon.ico'");
    expect(source).toContain('res.status(204).end()');
  });
});

