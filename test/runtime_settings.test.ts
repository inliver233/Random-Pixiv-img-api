import { describe, expect, it } from 'vitest';

import { getRuntimeConfigDefaults, resolveRuntimeConfig, RUNTIME_SETTING_KEYS } from '../src/config/runtimeSettings.ts';

describe('runtime settings config resolution', () => {
  it('returns defaults when no overrides exist', () => {
    const defaults = getRuntimeConfigDefaults();
    const resolved = resolveRuntimeConfig(defaults, []);
    expect(resolved).toEqual(defaults);
  });

  it('coerces boolean and integer values', () => {
    const defaults = getRuntimeConfigDefaults();
    const resolved = resolveRuntimeConfig(defaults, [
      { key: RUNTIME_SETTING_KEYS.proxyFailClosed, value: 'true' },
      { key: RUNTIME_SETTING_KEYS.proxyRetryAttempts, value: '3' },
    ]);

    expect(resolved.proxyFailClosed).toBe(true);
    expect(resolved.proxyRetryAttempts).toBe(3);
  });

  it('coerces route mode and allowlist domains', () => {
    const defaults = getRuntimeConfigDefaults();
    const resolved = resolveRuntimeConfig(defaults, [
      { key: RUNTIME_SETTING_KEYS.proxyRouteMode, value: 'allowlist' },
      { key: RUNTIME_SETTING_KEYS.proxyRouteAllowlistDomains, value: 'a.com,b.com|c.com\n d.com ' },
    ]);

    expect(resolved.proxyRouteMode).toBe('allowlist');
    expect(resolved.proxyRouteAllowlistDomains).toEqual(['a.com', 'b.com', 'c.com', 'd.com']);
  });

  it('ignores unknown keys', () => {
    const defaults = getRuntimeConfigDefaults();
    const resolved = resolveRuntimeConfig(defaults, [
      { key: 'unknown', value: true },
    ]);
    expect(resolved).toEqual(defaults);
  });
});
