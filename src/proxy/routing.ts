export type ProxyRouteMode = 'pixiv_only' | 'all' | 'allowlist';

export type ProxyRoutingOptions = {
  mode?: ProxyRouteMode;
  allowlistDomains?: string[];
};

export type ProxyFailurePolicy = {
  defaultFailClosed?: boolean;
  failClosedDomains?: string[];
  failOpenDomains?: string[];
};

const DEFAULT_PIXIV_HOSTS = new Set<string>([
  'oauth.secure.pixiv.net',
  'app-api.pixiv.net',
]);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

export function isPixivHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;
  if (DEFAULT_PIXIV_HOSTS.has(normalized)) return true;
  if (normalized === 'pximg.net' || normalized.endsWith('.pximg.net')) return true;
  return false;
}

function isAllowedByAllowlist(hostname: string, allowlist: string[]): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;

  for (const raw of allowlist) {
    const item = normalizeHostname(String(raw || ''));
    if (!item) continue;
    if (normalized === item) return true;
    if (normalized.endsWith(`.${item}`)) return true;
  }
  return false;
}

export function resolveProxyFailClosedForHostname(hostname: string, policy: ProxyFailurePolicy = {}): boolean {
  const normalized = normalizeHostname(hostname);
  const defaultFailClosed = Boolean(policy.defaultFailClosed);

  if (!normalized) return defaultFailClosed;

  const failOpen = policy.failOpenDomains ?? [];
  if (failOpen.length > 0 && isAllowedByAllowlist(normalized, failOpen)) return false;

  const failClosed = policy.failClosedDomains ?? [];
  if (failClosed.length > 0 && isAllowedByAllowlist(normalized, failClosed)) return true;

  return defaultFailClosed;
}

export function shouldProxyUrl(url: string, options: ProxyRoutingOptions = {}): boolean {
  const raw = String(url ?? '').trim();
  if (!raw) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') return false;

  const hostname = parsed.hostname;
  const mode = options.mode ?? 'pixiv_only';

  if (mode === 'all') return true;
  if (mode === 'allowlist') {
    return isAllowedByAllowlist(hostname, options.allowlistDomains ?? []);
  }
  return isPixivHostname(hostname);
}

export function shouldFailClosedForUrl(
  url: string,
  params: { routing?: ProxyRoutingOptions; policy?: ProxyFailurePolicy } = {},
): boolean {
  const routing = params.routing ?? {};
  if (!shouldProxyUrl(url, routing)) return false;

  try {
    const parsed = new URL(url);
    return resolveProxyFailClosedForHostname(parsed.hostname, params.policy);
  } catch {
    return false;
  }
}
