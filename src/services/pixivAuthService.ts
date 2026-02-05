import crypto from 'node:crypto';
import qs from 'qs';

import { getEnv } from '../config/env';
import { pixivApiRequest } from '../http/axiosClient';
import logger from '../logger/logger';
import { getTokenStoreSnapshot } from './tokenStore';

const AUTH_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';

let pixivApiRequestOverride: typeof pixivApiRequest | null = null;

export function setPixivApiRequestOverrideForTest(fn: typeof pixivApiRequest | null): void {
  pixivApiRequestOverride = fn;
}

type PixivAuthEntry = {
  tokenId: string;
  refreshToken: string;
  accessToken: string;
  expireTimestamp: number;
  refreshing: boolean;
  backoffUntilMs: number;
  lastOkAtMs: number;
  lastFailAtMs: number;
  lastError: { message: string | null; code: string | null; status: number | null } | null;
  errors: number;
};

type PixivAuthRefreshResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

let pixivAuthById = new Map<string, PixivAuthEntry>();
let pixivAuth: PixivAuthEntry[] | null = null;
let currentTokenIndex = 0;

export const maskHeader: Record<string, string> = {
  'App-OS': 'ios',
  'App-OS-Version': '10.3.1',
  'App-Version': '6.7.1',
  'User-Agent': 'PixivIOSApp/6.7.1 (iOS 10.3.1; iPhone8,1)',
};

const refreshAccessToken = async (refreshToken: string): Promise<PixivAuthRefreshResponse> => {
  const localTime = `${new Date().toISOString().replace(/\..+/, '')}+00:00`;
  const request = pixivApiRequestOverride ?? pixivApiRequest;
  const response = await request({
    method: 'post',
    url: AUTH_TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Client-Time': localTime,
      'X-Client-Hash': crypto
        .createHash('md5')
        .update(`${localTime}28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c`)
        .digest('hex'),
      ...maskHeader,
    },
    data: qs.stringify({
      client_id: 'MOBrBDS8blbauoSck0ZfDbtuzpyT',
      client_secret: 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj',
      get_secure_url: 1,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  return response.data.response;
};

export type PixivTokenStrategy = 'round_robin' | 'random' | 'least_error' | 'weighted';

export function selectTokenIndex(
  strategy: PixivTokenStrategy,
  tokenCount: number,
  prevIndex: number,
  options: { errors?: number[]; weights?: number[]; random?: () => number } = {},
): number {
  if (tokenCount <= 0) return 0;

  const random = options.random ?? (() => Math.random());

  if (strategy === 'random') {
    return Math.floor(random() * tokenCount);
  }

  if (strategy === 'least_error') {
    const errors = options.errors ?? [];
    if (errors.length !== tokenCount) {
      return (prevIndex + 1) % tokenCount;
    }

    let minError = Number.POSITIVE_INFINITY;
    for (const e of errors) {
      const n = typeof e === 'number' && Number.isFinite(e) ? e : 0;
      if (n < minError) minError = n;
    }

    // Tie-breaker: keep round-robin over the least-error set for stability.
    for (let offset = 1; offset <= tokenCount; offset += 1) {
      const idx = (prevIndex + offset) % tokenCount;
      const n = typeof errors[idx] === 'number' && Number.isFinite(errors[idx]) ? errors[idx] : 0;
      if (n === minError) return idx;
    }

    return 0;
  }

  if (strategy === 'weighted') {
    const weights = options.weights ?? [];
    if (weights.length !== tokenCount) {
      return (prevIndex + 1) % tokenCount;
    }

    const normalized = weights.map((w) => (typeof w === 'number' && Number.isFinite(w) ? Math.max(0, w) : 0));
    const total = normalized.reduce((acc, w) => acc + w, 0);
    if (total <= 0) return (prevIndex + 1) % tokenCount;

    const r = random() * total;
    let cursor = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      cursor += normalized[i]!;
      if (r < cursor) return i;
    }
    return normalized.length - 1;
  }

  return (prevIndex + 1) % tokenCount;
}

const REFRESH_BACKOFF_BASE_MS = 30_000;
const REFRESH_BACKOFF_MAX_MS = 30 * 60_000;
const BAD_TOKEN_BACKOFF_MS = 6 * 60 * 60_000;

function computeRefreshBackoffMs(params: { failCount: number; status: number | null }): number {
  const failCount = Math.max(1, Math.trunc(params.failCount || 1));
  const status = params.status;

  if (status === 400 || status === 401 || status === 403) {
    return BAD_TOKEN_BACKOFF_MS;
  }

  const exp = Math.min(failCount - 1, 10);
  return Math.min(REFRESH_BACKOFF_MAX_MS, REFRESH_BACKOFF_BASE_MS * 2 ** exp);
}

async function ensureAccessTokenReady(auth: PixivAuthEntry[], tokenIndex: number): Promise<boolean> {
  const entry = auth[tokenIndex];
  const now = Date.now();

  if (entry.expireTimestamp >= now) {
    return true;
  }

  if (entry.backoffUntilMs > now) {
    return false;
  }

  if (!entry.refreshing) {
    entry.refreshing = true;
    try {
      const refreshRes = await refreshAccessToken(entry.refreshToken);
      const refreshedAt = Date.now();
      entry.accessToken = refreshRes.access_token;
      entry.refreshToken = refreshRes.refresh_token;
      entry.expireTimestamp = refreshedAt + refreshRes.expires_in * 0.9 * 1000;
      entry.errors = 0;
      entry.backoffUntilMs = 0;
      entry.lastOkAtMs = refreshedAt;
      entry.lastError = null;

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { recordPixivTokenRefreshSuccess } = require('../metrics/pixivTokenMetrics') as typeof import('../metrics/pixivTokenMetrics');
        recordPixivTokenRefreshSuccess(entry.tokenId);
      } catch {
        // best-effort
      }

      logger.info({ token_index: tokenIndex, token_id: entry.tokenId }, 'Pixiv access token refreshed');
      return true;
    } catch (err: any) {
      const failedAt = Date.now();
      entry.errors = (entry.errors ?? 0) + 1;

      const statusRaw = err?.response?.status;
      const status = typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? statusRaw : null;
      const code = typeof err?.code === 'string' ? err.code : null;
      const message = typeof err?.message === 'string' ? err.message : null;

      entry.lastFailAtMs = failedAt;
      entry.lastError = { message, code, status };

      const backoffMs = computeRefreshBackoffMs({ failCount: entry.errors, status });
      entry.backoffUntilMs = failedAt + backoffMs;

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { recordPixivTokenRefreshFail } = require('../metrics/pixivTokenMetrics') as typeof import('../metrics/pixivTokenMetrics');
        recordPixivTokenRefreshFail(entry.tokenId, entry.backoffUntilMs);
      } catch {
        // best-effort
      }

      logger.warn(
        {
          token_index: tokenIndex,
          token_id: entry.tokenId,
          refresh_fail_count: entry.errors,
          backoff_ms: backoffMs,
          backoff_until: new Date(entry.backoffUntilMs).toISOString(),
          err: { message, code, status },
        },
        'Pixiv refresh token failed',
      );
      return false;
    } finally {
      entry.refreshing = false;
    }
  }

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (!entry.refreshing) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });

  const doneAt = Date.now();
  if (entry.expireTimestamp >= doneAt) return true;
  if (entry.backoffUntilMs > doneAt) return false;
  return false;
}

function buildPixivAuthEntry(tokenId: string, refreshToken: string): PixivAuthEntry {
  return {
    tokenId,
    refreshToken,
    accessToken: '',
    expireTimestamp: 0,
    refreshing: false,
    backoffUntilMs: 0,
    lastOkAtMs: 0,
    lastFailAtMs: 0,
    lastError: null,
    errors: 0,
  };
}

const ensurePixivAuthInitialized = async (): Promise<PixivAuthEntry[]> => {
  const snapshot = await getTokenStoreSnapshot();
  const tokens = snapshot.tokens;
  if (tokens.length === 0) {
    throw new Error('No Pixiv refresh tokens available. Configure REFRESH_TOKENS or create enabled PixivToken rows.');
  }

  const nextById = new Map<string, PixivAuthEntry>();
  const nextAuth: PixivAuthEntry[] = [];

  for (const token of tokens) {
    const existing = pixivAuthById.get(token.id);
    if (existing) {
      nextById.set(token.id, existing);
      nextAuth.push(existing);
      continue;
    }

    const entry = buildPixivAuthEntry(token.id, token.refreshToken);
    nextById.set(token.id, entry);
    nextAuth.push(entry);
  }

  pixivAuthById = nextById;
  pixivAuth = nextAuth;
  return pixivAuth;
};

function parseTokenWeights(value: unknown, tokenCount: number): number[] {
  if (tokenCount <= 0) return [];

  if (typeof value !== 'string') {
    return Array.from({ length: tokenCount }, () => 1);
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return Array.from({ length: tokenCount }, () => 1);
  }

  const parsed = parts.map((part) => {
    const n = Number(part);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n);
  });

  while (parsed.length < tokenCount) parsed.push(1);
  if (parsed.length > tokenCount) parsed.length = tokenCount;

  const total = parsed.reduce((acc, w) => acc + w, 0);
  if (total <= 0) {
    return Array.from({ length: tokenCount }, () => 1);
  }

  return parsed;
}

const getAccessTokenIndex = (auth: PixivAuthEntry[]) => {
  const env = getEnv();
  const now = Date.now();
  const eligible = auth
    .map((_entry, idx) => idx)
    .filter((idx) => auth[idx].backoffUntilMs <= now);
  if (eligible.length === 0) return -1;

  const errors = eligible.map((idx) => auth[idx].errors ?? 0);
  const fullWeights = parseTokenWeights(env.PIXIV_TOKEN_WEIGHTS, auth.length);
  const weights = eligible.map((idx) => fullWeights[idx] ?? 1);

  const prevEligibleIndex = eligible.indexOf(currentTokenIndex);
  const chosen = selectTokenIndex(env.PIXIV_TOKEN_STRATEGY, eligible.length, prevEligibleIndex, { errors, weights });
  currentTokenIndex = eligible[chosen] ?? eligible[0] ?? 0;
  return currentTokenIndex;
};

export const getAccessToken = async (): Promise<string> => {
  const auth = await ensurePixivAuthInitialized();
  const attempted = new Set<number>();

  for (let i = 0; i < auth.length; i += 1) {
    const tokenIndex = getAccessTokenIndex(auth);
    if (tokenIndex < 0 || attempted.has(tokenIndex)) break;
    attempted.add(tokenIndex);

    const ok = await ensureAccessTokenReady(auth, tokenIndex);
    if (!ok) continue;

    const now = Date.now();
    if (auth[tokenIndex].expireTimestamp >= now && auth[tokenIndex].accessToken) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { incrementPixivTokenUseTotal } = require('../metrics/pixivTokenMetrics') as typeof import('../metrics/pixivTokenMetrics');
        incrementPixivTokenUseTotal(auth[tokenIndex].tokenId);
      } catch {
        // best-effort
      }
      return auth[tokenIndex].accessToken;
    }
  }

  const now = Date.now();
  const nextRetryAt = auth.reduce<number | null>((min, entry) => {
    if (entry.backoffUntilMs <= now) return min;
    if (min === null || entry.backoffUntilMs < min) return entry.backoffUntilMs;
    return min;
  }, null);

  if (nextRetryAt !== null) {
    throw new Error(`No Pixiv access token available. All tokens are in backoff until ${new Date(nextRetryAt).toISOString()}.`);
  }

  throw new Error('No Pixiv access token available. All tokens failed to refresh.');
};

export const getAccessTokenWithMeta = async (): Promise<{ accessToken: string; tokenIndex: number; tokenId: string }> => {
  const auth = await ensurePixivAuthInitialized();
  const attempted = new Set<number>();

  for (let i = 0; i < auth.length; i += 1) {
    const tokenIndex = getAccessTokenIndex(auth);
    if (tokenIndex < 0 || attempted.has(tokenIndex)) break;
    attempted.add(tokenIndex);

    const ok = await ensureAccessTokenReady(auth, tokenIndex);
    if (!ok) continue;

    const now = Date.now();
    if (auth[tokenIndex].expireTimestamp >= now && auth[tokenIndex].accessToken) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { incrementPixivTokenUseTotal } = require('../metrics/pixivTokenMetrics') as typeof import('../metrics/pixivTokenMetrics');
        incrementPixivTokenUseTotal(auth[tokenIndex].tokenId);
      } catch {
        // best-effort
      }
      return { accessToken: auth[tokenIndex].accessToken, tokenIndex, tokenId: auth[tokenIndex].tokenId };
    }
  }

  const now = Date.now();
  const nextRetryAt = auth.reduce<number | null>((min, entry) => {
    if (entry.backoffUntilMs <= now) return min;
    if (min === null || entry.backoffUntilMs < min) return entry.backoffUntilMs;
    return min;
  }, null);

  if (nextRetryAt !== null) {
    throw new Error(`No Pixiv access token available. All tokens are in backoff until ${new Date(nextRetryAt).toISOString()}.`);
  }

  throw new Error('No Pixiv access token available. All tokens failed to refresh.');
};

export type PixivTokenRuntimeState = {
  token_id: string;
  refreshing: boolean;
  refresh_fail_count: number;
  access_token_expires_at: string | null;
  backoff_until: string | null;
  backoff_remaining_ms: number;
  last_ok_at: string | null;
  last_fail_at: string | null;
  last_error: { message: string | null; code: string | null; status: number | null } | null;
};

export async function getPixivTokenRuntimeStates(): Promise<
  { ok: true; source: 'db' | 'env'; tokens: PixivTokenRuntimeState[] }
  | { ok: false; error: string }
> {
  try {
    const [auth, snapshot] = await Promise.all([ensurePixivAuthInitialized(), getTokenStoreSnapshot()]);
    const now = Date.now();

    return {
      ok: true,
      source: snapshot.source,
      tokens: auth.map((entry) => {
        const backoffRemainingMs = entry.backoffUntilMs > now ? entry.backoffUntilMs - now : 0;
        return {
          token_id: entry.tokenId,
          refreshing: entry.refreshing,
          refresh_fail_count: entry.errors ?? 0,
          access_token_expires_at: entry.expireTimestamp > 0 ? new Date(entry.expireTimestamp).toISOString() : null,
          backoff_until: entry.backoffUntilMs > now ? new Date(entry.backoffUntilMs).toISOString() : null,
          backoff_remaining_ms: backoffRemainingMs,
          last_ok_at: entry.lastOkAtMs > 0 ? new Date(entry.lastOkAtMs).toISOString() : null,
          last_fail_at: entry.lastFailAtMs > 0 ? new Date(entry.lastFailAtMs).toISOString() : null,
          last_error: entry.lastError,
        };
      }),
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function resetPixivTokenRefreshFailures(tokenId: string): { ok: true } | { ok: false; error: string } {
  const entry = pixivAuthById.get(tokenId);
  if (!entry) return { ok: false, error: 'token_not_found' };

  entry.errors = 0;
  entry.backoffUntilMs = 0;
  entry.lastFailAtMs = 0;
  entry.lastError = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setPixivTokenBackoffUntilMs } = require('../metrics/pixivTokenMetrics') as typeof import('../metrics/pixivTokenMetrics');
    setPixivTokenBackoffUntilMs(entry.tokenId, 0);
  } catch {
    // best-effort
  }

  return { ok: true };
}
