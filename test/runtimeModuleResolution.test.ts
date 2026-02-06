import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRuntimeModulePath } from '../src/utils/runtimeModulePath';

describe('resolveRuntimeModulePath', () => {
  it('uses .ts for source runtime directories', () => {
    const runtimeDir = path.join('tmp', 'pixivcat-backend');
    expect(resolveRuntimeModulePath('./src/routes/api', runtimeDir)).toBe('./src/routes/api.ts');
  });

  it('uses .js for dist runtime directories', () => {
    const runtimeDir = path.join('tmp', 'pixivcat-backend', 'dist');
    expect(resolveRuntimeModulePath('./src/routes/api', runtimeDir)).toBe('./src/routes/api.js');
  });

  it('treats Dist casing as dist runtime', () => {
    const runtimeDir = path.join('tmp', 'pixivcat-backend', 'Dist');
    expect(resolveRuntimeModulePath('./src/middlewares/errorHandler', runtimeDir)).toBe('./src/middlewares/errorHandler.js');
  });
});
