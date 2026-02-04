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
  module.exports = {
    RUNTIME_SETTING_KEYS: {
      proxyFailClosed: 'proxy_fail_closed',
      proxyRetryAttempts: 'proxy_retry_attempts',
      proxyRouteMode: 'proxy_route_mode',
      proxyRouteAllowlistDomains: 'proxy_route_allowlist_domains',
    },
    getRuntimeConfigDefaults() {
      return {
        proxyFailClosed: false,
        proxyRetryAttempts: 2,
        proxyRouteMode: 'pixiv_only',
        proxyRouteAllowlistDomains: [],
      };
    },
  };
}

