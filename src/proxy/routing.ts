export type ProxyRouteMode = 'pixiv_only' | 'all' | 'allowlist';

export type ProxyRoutingOptions = {
  mode?: ProxyRouteMode;
  allowlistDomains?: string[];
};

const DEFAULT_PIXIV_HOSTS = new Set<string>([
  'oauth.secure.pixiv.net',
  'app-api.pixiv.net',
]);

export function isPixivHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return false;
  if (DEFAULT_PIXIV_HOSTS.has(normalized)) return true;
  if (normalized === 'pximg.net' || normalized.endsWith('.pximg.net')) return true;
  return false;
}

function isAllowedByAllowlist(hostname: string, allowlist: string[]): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return false;

  for (const raw of allowlist) {
    const item = String(raw || '').trim().toLowerCase().replace(/\.$/, '');
    if (!item) continue;
    if (normalized === item) return true;
    if (normalized.endsWith(`.${item}`)) return true;
  }
  return false;
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

