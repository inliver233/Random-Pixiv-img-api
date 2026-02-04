import http from 'node:http';
import https from 'node:https';

import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { parseProxyUri, type ProxyUriParts } from './proxyUri';

export type AgentFactoryOptions = {
  keepAlive?: boolean;
  maxSockets?: number;
  maxFreeSockets?: number;
};

export type AgentPair = {
  httpAgent: http.Agent;
  httpsAgent: http.Agent;
};

type NormalizedAgentOptions = {
  keepAlive: boolean;
  maxSockets: number | undefined;
  maxFreeSockets: number | undefined;
};

function normalizeOptions(options?: AgentFactoryOptions): NormalizedAgentOptions {
  const keepAlive = options?.keepAlive !== undefined ? options.keepAlive : true;
  const maxSockets = options?.maxSockets;
  const maxFreeSockets = options?.maxFreeSockets;
  return { keepAlive, maxSockets, maxFreeSockets };
}

function optionsKey(options: NormalizedAgentOptions): string {
  return `ka=${options.keepAlive ? 1 : 0}&ms=${options.maxSockets ?? ''}&mfs=${options.maxFreeSockets ?? ''}`;
}

function agentOptions(options: NormalizedAgentOptions): http.AgentOptions {
  const out: http.AgentOptions = { keepAlive: options.keepAlive };
  if (options.maxSockets !== undefined) out.maxSockets = options.maxSockets;
  if (options.maxFreeSockets !== undefined) out.maxFreeSockets = options.maxFreeSockets;
  return out;
}

function formatHostForUrl(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(':') && !trimmed.startsWith('[') && !trimmed.endsWith(']')) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

function toProxyUrl(parts: ProxyUriParts): string {
  const scheme = parts.scheme;
  const host = formatHostForUrl(parts.host);
  const port = parts.port;

  const user = parts.username ?? '';
  const pass = parts.password ?? '';

  let auth = '';
  if (user || pass) {
    const encUser = encodeURIComponent(user);
    if (pass) {
      const encPass = encodeURIComponent(pass);
      auth = `${encUser}:${encPass}@`;
    } else {
      auth = `${encUser}@`;
    }
  }

  return `${scheme}://${auth}${host}:${port}`;
}

const directAgentsCache = new Map<string, AgentPair>();
const proxyAgentsCache = new Map<string, AgentPair>();

export function getDirectAgentPair(options?: AgentFactoryOptions): AgentPair {
  const normalized = normalizeOptions(options);
  const key = optionsKey(normalized);
  const cached = directAgentsCache.get(key);
  if (cached) return cached;

  const pair: AgentPair = {
    httpAgent: new http.Agent(agentOptions(normalized)),
    httpsAgent: new https.Agent(agentOptions(normalized) as any),
  };

  directAgentsCache.set(key, pair);
  return pair;
}

export function getProxyAgentPair(proxy: string | ProxyUriParts, options?: AgentFactoryOptions): AgentPair {
  const parts = typeof proxy === 'string' ? parseProxyUri(proxy) : proxy;
  const normalized = normalizeOptions(options);
  const key =
    `${parts.scheme}|${parts.host}|${parts.port}|${parts.username}|${parts.password}|${optionsKey(normalized)}`;

  const cached = proxyAgentsCache.get(key);
  if (cached) return cached;

  const proxyUrl = toProxyUrl(parts);
  const opts = agentOptions(normalized);

  const pair: AgentPair = (() => {
    if (parts.scheme === 'socks4' || parts.scheme === 'socks5') {
      const socksAgent = new SocksProxyAgent(proxyUrl, opts);
      return { httpAgent: socksAgent, httpsAgent: socksAgent };
    }

    return {
      httpAgent: new HttpProxyAgent(proxyUrl, opts as any),
      httpsAgent: new HttpsProxyAgent(proxyUrl, opts as any),
    };
  })();

  proxyAgentsCache.set(key, pair);
  return pair;
}
