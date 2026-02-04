export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5';

export type ProxyUriParts = {
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string;
  password: string;
};

const DEFAULT_PORTS: Record<ProxyScheme, number> = {
  http: 80,
  https: 443,
  socks4: 1080,
  socks5: 1080,
};

function toProxyScheme(value: string): ProxyScheme | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'http' || normalized === 'https' || normalized === 'socks4' || normalized === 'socks5') return normalized;
  return null;
}

function stripAuthorityTail(value: string): string {
  let out = value;
  for (const sep of ['/', '?', '#']) {
    const idx = out.indexOf(sep);
    if (idx !== -1) out = out.slice(0, idx);
  }
  return out;
}

function decodeMaybe(value: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePort(raw: string): number {
  const normalized = raw.trim();
  if (!normalized) throw new Error('Invalid proxy port: empty.');
  if (!/^\d+$/.test(normalized)) throw new Error(`Invalid proxy port: ${raw}`);

  const n = Number(normalized);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`Invalid proxy port: ${raw}`);
  if (n < 1 || n > 65535) throw new Error(`Invalid proxy port: ${raw}`);
  return n;
}

function parseHostPort(raw: string, scheme: ProxyScheme): { host: string; port: number } {
  const hostPort = raw.trim();
  if (!hostPort) throw new Error('Proxy URI missing host.');

  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    if (end === -1) throw new Error('Invalid IPv6 host: missing closing bracket.');
    const host = hostPort.slice(1, end).trim();
    if (!host) throw new Error('Proxy URI missing host.');
    const after = hostPort.slice(end + 1).trim();
    if (!after) return { host, port: DEFAULT_PORTS[scheme] };
    if (!after.startsWith(':')) throw new Error(`Invalid host/port: ${raw}`);
    const port = parsePort(after.slice(1));
    return { host, port };
  }

  const lastColon = hostPort.lastIndexOf(':');
  if (lastColon === -1) {
    const host = hostPort.trim();
    if (!host) throw new Error('Proxy URI missing host.');
    return { host, port: DEFAULT_PORTS[scheme] };
  }

  // If there are multiple colons without brackets, it's very likely an IPv6 literal without `[]`.
  if (hostPort.indexOf(':') !== lastColon) {
    throw new Error('IPv6 addresses must be wrapped in [ ].');
  }

  const host = hostPort.slice(0, lastColon).trim();
  if (!host) throw new Error('Proxy URI missing host.');
  const port = parsePort(hostPort.slice(lastColon + 1));
  return { host, port };
}

export function parseProxyUri(input: string): ProxyUriParts {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Proxy URI is empty.');

  const schemeSep = raw.indexOf('://');
  if (schemeSep <= 0) {
    throw new Error('Proxy URI must include scheme (http/https/socks4/socks5).');
  }

  const schemeRaw = raw.slice(0, schemeSep);
  const scheme = toProxyScheme(schemeRaw);
  if (!scheme) throw new Error(`Unsupported proxy scheme: ${schemeRaw}`);

  const authorityRaw = stripAuthorityTail(raw.slice(schemeSep + 3));
  if (!authorityRaw.trim()) throw new Error('Proxy URI missing host.');

  const atIndex = authorityRaw.lastIndexOf('@');
  const userinfoRaw = atIndex === -1 ? '' : authorityRaw.slice(0, atIndex);
  const hostPortRaw = atIndex === -1 ? authorityRaw : authorityRaw.slice(atIndex + 1);

  const { host, port } = parseHostPort(hostPortRaw, scheme);

  let username = '';
  let password = '';

  if (userinfoRaw) {
    const colonIdx = userinfoRaw.indexOf(':');
    if (colonIdx === -1) {
      username = decodeMaybe(userinfoRaw).trim();
    } else {
      username = decodeMaybe(userinfoRaw.slice(0, colonIdx)).trim();
      password = decodeMaybe(userinfoRaw.slice(colonIdx + 1));
    }
  }

  return {
    scheme,
    host: host.trim().toLowerCase(),
    port,
    username,
    password,
  };
}

export function tryParseProxyUri(
  input: string,
): { ok: true; value: ProxyUriParts } | { ok: false; error: string } {
  try {
    return { ok: true, value: parseProxyUri(input) };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

