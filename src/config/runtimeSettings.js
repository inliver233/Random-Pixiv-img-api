// NOTE: Prefer delegating to the built TS module when available.
let delegated = false;
try {
  // eslint-disable-next-line import/no-unresolved, global-require
  const built = require('../../dist/src/config/runtimeSettings');
  module.exports = built.default || built;
  delegated = true;
} catch {
  delegated = false;
}

if (!delegated) {
  const RUNTIME_SETTING_KEYS = {
    proxyEnabled: 'proxy_enabled',
    proxyFailClosed: 'proxy_fail_closed',
    proxyFailClosedDomains: 'proxy_fail_closed_domains',
    proxyFailOpenDomains: 'proxy_fail_open_domains',
    proxyRetryAttempts: 'proxy_retry_attempts',
    proxyRouteMode: 'proxy_route_mode',
    proxyRouteAllowlistDomains: 'proxy_route_allowlist_domains',
    adminImportMaxHydrateIllusts: 'admin_import_max_hydrate_illusts',
  };

  function adminImportMaxHydrateIllustsFromEnv() {
    const raw = typeof process.env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS === 'string' ? process.env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS : '';
    const normalized = raw.trim();
    if (!normalized) return 2000;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return 2000;
    return Math.max(0, Math.trunc(parsed));
  }

  function getRuntimeConfigDefaults() {
    return {
      proxyEnabled: true,
      proxyFailClosed: false,
      proxyFailClosedDomains: [],
      proxyFailOpenDomains: [],
      proxyRetryAttempts: 2,
      proxyRouteMode: 'pixiv_only',
      proxyRouteAllowlistDomains: [],
      // Backward compatible default: historically import always enqueued hydrate jobs (unless skipped by count guard).
      hydrateOnImport: true,
      opportunisticHydrate: false,
      adminImportMaxHydrateIllusts: adminImportMaxHydrateIllustsFromEnv(),
    };
  }

  function coerceBoolean(value, defaultValue) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value !== 'string') return defaultValue;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return defaultValue;
  }

  function coerceInt(value, defaultValue) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized) return defaultValue;
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return defaultValue;
  }

  function coerceStringArray(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(/[,\n|]/g)
        .map((part) => part.trim())
        .filter(Boolean);
    }

    return [];
  }

  function coerceProxyRouteMode(value, defaultValue) {
    if (value === 'pixiv_only' || value === 'all' || value === 'allowlist') return value;
    if (typeof value !== 'string') return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'pixiv_only' || normalized === 'all' || normalized === 'allowlist') return normalized;
    return defaultValue;
  }

  function resolveRuntimeConfig(defaults, settings) {
    const resolved = { ...defaults };

    for (const setting of settings) {
      if (!setting?.key) continue;

      switch (setting.key) {
        case RUNTIME_SETTING_KEYS.proxyEnabled:
          resolved.proxyEnabled = coerceBoolean(setting.value, defaults.proxyEnabled);
          break;
        case RUNTIME_SETTING_KEYS.proxyFailClosed:
          resolved.proxyFailClosed = coerceBoolean(setting.value, defaults.proxyFailClosed);
          break;
        case RUNTIME_SETTING_KEYS.proxyFailClosedDomains:
          resolved.proxyFailClosedDomains = coerceStringArray(setting.value);
          break;
        case RUNTIME_SETTING_KEYS.proxyFailOpenDomains:
          resolved.proxyFailOpenDomains = coerceStringArray(setting.value);
          break;
        case RUNTIME_SETTING_KEYS.proxyRetryAttempts:
          resolved.proxyRetryAttempts = Math.max(0, coerceInt(setting.value, defaults.proxyRetryAttempts));
          break;
        case RUNTIME_SETTING_KEYS.proxyRouteMode:
          resolved.proxyRouteMode = coerceProxyRouteMode(setting.value, defaults.proxyRouteMode);
          break;
        case RUNTIME_SETTING_KEYS.proxyRouteAllowlistDomains:
          resolved.proxyRouteAllowlistDomains = coerceStringArray(setting.value);
          break;
        case RUNTIME_SETTING_KEYS.adminImportMaxHydrateIllusts:
          resolved.adminImportMaxHydrateIllusts = Math.max(0, coerceInt(setting.value, defaults.adminImportMaxHydrateIllusts));
          break;
        default:
          break;
      }
    }

    return resolved;
  }

  module.exports = {
    RUNTIME_SETTING_KEYS,
    getRuntimeConfigDefaults,
    resolveRuntimeConfig,
  };
}
