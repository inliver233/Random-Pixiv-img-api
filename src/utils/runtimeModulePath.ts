import path from 'node:path';

/**
 * Source runtime (`node app.js` -> `app.ts`) should load `.ts` modules,
 * while built runtime (`node dist/app.js`) must load compiled `.js` modules.
 */
export function resolveRuntimeModulePath(moduleBasePath: string, runtimeDir: string): string {
  const ext = path.basename(runtimeDir).toLowerCase() === 'dist' ? '.js' : '.ts';
  return `${moduleBasePath}${ext}`;
}
