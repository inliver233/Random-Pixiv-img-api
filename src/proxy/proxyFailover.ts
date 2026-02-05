import type { OutboundErrorClassification, OutboundErrorContext } from '../resilience/outboundErrors';

import { classifyOutboundError } from '../resilience/outboundErrors';

import { pickPrimaryProxyRendezvous, planOverride, resolveEffectiveProxy, type TokenProxyBindingLike } from './tokenProxyBinding';

function recordOutboundErrorMetric(type: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { incrementOutboundError } = require('../metrics/outboundMetrics') as typeof import('../metrics/outboundMetrics');
    incrementOutboundError(type);
  } catch {
    // best-effort
  }
}

function isProxyTunnelError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('tunneling socket') ||
    msg.includes('tunnel') && msg.includes('connect') ||
    msg.includes('proxy connection ended') && msg.includes('connect')
  );
}

function mapClassificationToMetric(err: unknown, type: OutboundErrorClassification['type']): string {
  switch (type) {
    case 'proxy_connect':
      return isProxyTunnelError(err) ? 'proxy_tunnel_error' : 'proxy_connect_error';
    case 'proxy_auth':
      return 'proxy_auth_error';
    case 'pixiv_rate_limit':
      return 'upstream_rate_limit';
    case 'pixiv_403':
      return 'upstream_403';
    case 'pixiv_5xx':
      return 'upstream_5xx';
    case 'timeout':
      return 'timeout_error';
    case 'network':
      return 'network_error';
    case 'upstream':
      return 'upstream_error';
    case 'unknown':
    default:
      return 'unknown_error';
  }
}

export type TokenMeta = {
  tokenId: string;
  tokenIndex: number;
  accessToken: string;
};

export type ProxyCandidate = {
  id: string;
  proxyUri: string;
};

export type FailoverAttemptEvidence = {
  attempt: number;
  tokenId?: string;
  tokenIndex?: number;
  proxyId?: string | null;
  errorType?: OutboundErrorClassification['type'];
};

export type FailoverEvidence = {
  attempts: FailoverAttemptEvidence[];
};

export type TokenProxyFailoverOptions = {
  poolSalt: string;
  overrideTtlMs: number;
  maxProxySwitches: number;
  maxTokenSwitches: number;
  now?: () => Date;
};

function isProxyClassFailure(type: OutboundErrorClassification['type']): boolean {
  return type === 'proxy_connect' || type === 'proxy_auth';
}

function attachEvidence(err: unknown, evidence: FailoverEvidence): unknown {
  if (err && typeof err === 'object') {
    (err as any).failoverEvidence = evidence;
    return err;
  }
  const wrapped: any = new Error('Outbound request failed');
  wrapped.cause = err;
  wrapped.failoverEvidence = evidence;
  return wrapped;
}

export async function runWithTokenProxyFailover<T>(params: {
  getToken: () => Promise<TokenMeta>;
  proxies: ProxyCandidate[];
  request: (ctx: { accessToken: string; tokenId: string; tokenIndex: number; proxyUri?: string; proxyId?: string }) => Promise<T>;
  options: TokenProxyFailoverOptions;
  classify?: (err: unknown, context: OutboundErrorContext) => OutboundErrorClassification;
}): Promise<{ value: T; evidence: FailoverEvidence }> {
  const classify = params.classify ?? classifyOutboundError;
  const now = params.options.now ?? (() => new Date());

  const evidence: FailoverEvidence = { attempts: [] };

  const proxies = params.proxies ?? [];
  const proxyById = new Map<string, string>();
  const proxyIds: string[] = [];
  for (const p of proxies) {
    if (!p) continue;
    const id = String(p.id ?? '').trim();
    const proxyUri = String(p.proxyUri ?? '').trim();
    if (!id || !proxyUri) continue;
    if (proxyById.has(id)) continue;
    proxyById.set(id, proxyUri);
    proxyIds.push(id);
  }

  if (proxyIds.length === 0) {
    const token = await params.getToken();
    const value = await params.request({ ...token });
    return { value, evidence };
  }

  const globalFailedProxies = new Set<string>();
  let lastErr: unknown = null;
  let attemptCounter = 0;

  for (let tokenSwitch = 0; tokenSwitch <= params.options.maxTokenSwitches; tokenSwitch += 1) {
    const token = await params.getToken();

    const primaryProxyId = pickPrimaryProxyRendezvous(token.tokenId, proxyIds, params.options.poolSalt);
    const binding: TokenProxyBindingLike = { primaryProxyId };

    // If the primary is already known-bad (in this request), pre-plan an override.
    if (globalFailedProxies.has(primaryProxyId)) {
      const planned = planOverride({
        tokenId: token.tokenId,
        poolSalt: params.options.poolSalt,
        failedProxyId: primaryProxyId,
        availableProxyIds: proxyIds.filter((id) => !globalFailedProxies.has(id)),
        ttlMs: params.options.overrideTtlMs,
        now: now(),
        reason: 'proxy_connect',
      });
      if (planned) {
        binding.overrideProxyId = planned.overrideProxyId;
        binding.overrideExpiresAt = planned.overrideExpiresAt;
      }
    }

    for (let proxySwitch = 0; proxySwitch <= params.options.maxProxySwitches; proxySwitch += 1) {
      const { proxyId } = (() => {
        const resolved = resolveEffectiveProxy(binding, now());
        return { proxyId: resolved.proxyId };
      })();

      if (globalFailedProxies.has(proxyId)) {
        const planned = planOverride({
          tokenId: token.tokenId,
          poolSalt: params.options.poolSalt,
          failedProxyId: proxyId,
          availableProxyIds: proxyIds.filter((id) => !globalFailedProxies.has(id)),
          ttlMs: params.options.overrideTtlMs,
          now: now(),
          reason: 'proxy_connect',
        });
        if (!planned) break;
        binding.overrideProxyId = planned.overrideProxyId;
        binding.overrideExpiresAt = planned.overrideExpiresAt;
        continue;
      }

      const proxyUri = proxyById.get(proxyId);
      if (!proxyUri) {
        globalFailedProxies.add(proxyId);
        continue;
      }

      try {
        const value = await params.request({ ...token, proxyId, proxyUri });
        evidence.attempts.push({ attempt: attemptCounter, tokenId: token.tokenId, tokenIndex: token.tokenIndex, proxyId });
        return { value, evidence };
      } catch (err: unknown) {
        lastErr = err;
        const classification = classify(err, { usedProxy: true });
        recordOutboundErrorMetric(mapClassificationToMetric(err, classification.type));
        evidence.attempts.push({
          attempt: attemptCounter,
          tokenId: token.tokenId,
          tokenIndex: token.tokenIndex,
          proxyId,
          errorType: classification.type,
        });

        if (!isProxyClassFailure(classification.type)) {
          throw attachEvidence(err, evidence);
        }

        globalFailedProxies.add(proxyId);
        const planned = planOverride({
          tokenId: token.tokenId,
          poolSalt: params.options.poolSalt,
          failedProxyId: proxyId,
          availableProxyIds: proxyIds.filter((id) => !globalFailedProxies.has(id)),
          ttlMs: params.options.overrideTtlMs,
          now: now(),
          reason: classification.type,
        });

        if (!planned) break;
        binding.overrideProxyId = planned.overrideProxyId;
        binding.overrideExpiresAt = planned.overrideExpiresAt;
      } finally {
        attemptCounter += 1;
      }
    }
  }

  throw attachEvidence(lastErr, evidence);
}

export async function runWithProxyFailover<T>(params: {
  proxies: ProxyCandidate[];
  request: (ctx: { proxyUri?: string; proxyId?: string }) => Promise<T>;
  maxProxySwitches: number;
  classify?: (err: unknown, context: OutboundErrorContext) => OutboundErrorClassification;
}): Promise<{ value: T; evidence: FailoverEvidence }> {
  const classify = params.classify ?? classifyOutboundError;
  const evidence: FailoverEvidence = { attempts: [] };

  const proxies = params.proxies ?? [];
  const unique: ProxyCandidate[] = [];
  const seen = new Set<string>();
  for (const p of proxies) {
    if (!p) continue;
    const id = String(p.id ?? '').trim();
    const proxyUri = String(p.proxyUri ?? '').trim();
    if (!id || !proxyUri) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push({ id, proxyUri });
  }

  if (unique.length === 0) {
    const value = await params.request({});
    return { value, evidence };
  }

  let lastErr: unknown = null;
  const maxAttempts = Math.min(unique.length, Math.max(1, params.maxProxySwitches + 1));

  for (let i = 0; i < maxAttempts; i += 1) {
    const p = unique[i]!;
    try {
      const value = await params.request({ proxyId: p.id, proxyUri: p.proxyUri });
      evidence.attempts.push({ attempt: i, proxyId: p.id });
      return { value, evidence };
    } catch (err: unknown) {
      lastErr = err;
      const classification = classify(err, { usedProxy: true });
      recordOutboundErrorMetric(mapClassificationToMetric(err, classification.type));
      evidence.attempts.push({ attempt: i, proxyId: p.id, errorType: classification.type });
      if (!isProxyClassFailure(classification.type)) {
        throw attachEvidence(err, evidence);
      }
    }
  }

  throw attachEvidence(lastErr, evidence);
}
