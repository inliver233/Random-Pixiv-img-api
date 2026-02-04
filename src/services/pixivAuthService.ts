import crypto from 'node:crypto';
import qs from 'qs';

import { getEnv } from '../config/env';
import { pixivApiRequest } from '../http/axiosClient';
import logger from '../logger/logger';
import { getTokenStoreSnapshot } from './tokenStore';

const AUTH_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';

type PixivAuthEntry = {
  tokenId: string;
  refreshToken: string;
  accessToken: string;
  expireTimestamp: number;
  refreshing: boolean;
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
  const response = await pixivApiRequest({
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

export type PixivTokenStrategy = 'round_robin' | 'random';

export function selectTokenIndex(strategy: PixivTokenStrategy, tokenCount: number, prevIndex: number): number {
  if (tokenCount <= 0) return 0;
  if (strategy === 'random') return Math.floor(Math.random() * tokenCount);
  return (prevIndex + 1) % tokenCount;
}

async function ensureAccessTokenReady(auth: PixivAuthEntry[], tokenIndex: number): Promise<void> {
  if (auth[tokenIndex].expireTimestamp >= Date.now()) {
    return;
  }

  if (!auth[tokenIndex].refreshing) {
    auth[tokenIndex].refreshing = true;
    try {
      const refreshRes = await refreshAccessToken(auth[tokenIndex].refreshToken);
      auth[tokenIndex].accessToken = refreshRes.access_token;
      auth[tokenIndex].refreshToken = refreshRes.refresh_token;
      auth[tokenIndex].expireTimestamp = Date.now() + refreshRes.expires_in * 0.9 * 1000;
      logger.info({ token_index: tokenIndex, token_id: auth[tokenIndex].tokenId }, 'Pixiv access token refreshed');
    } catch (err: any) {
      logger.warn(
        {
          token_index: tokenIndex,
          token_id: auth[tokenIndex].tokenId,
          err: { message: err?.message, code: err?.code, status: err?.response?.status },
        },
        'Pixiv refresh token failed',
      );
    } finally {
      auth[tokenIndex].refreshing = false;
    }

    return;
  }

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (!auth[tokenIndex].refreshing) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

function buildPixivAuthEntry(tokenId: string, refreshToken: string): PixivAuthEntry {
  return {
    tokenId,
    refreshToken,
    accessToken: '',
    expireTimestamp: 0,
    refreshing: false,
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

const getAccessTokenIndex = (auth: PixivAuthEntry[]) => {
  const env = getEnv();
  currentTokenIndex = selectTokenIndex(env.PIXIV_TOKEN_STRATEGY, auth.length, currentTokenIndex);
  return currentTokenIndex;
};

export const getAccessToken = async (): Promise<string> => {
  const auth = await ensurePixivAuthInitialized();
  const tokenIndex = getAccessTokenIndex(auth);

  await ensureAccessTokenReady(auth, tokenIndex);

  return auth[tokenIndex].accessToken;
};

export const getAccessTokenWithMeta = async (): Promise<{ accessToken: string; tokenIndex: number }> => {
  const auth = await ensurePixivAuthInitialized();
  const tokenIndex = getAccessTokenIndex(auth);
  await ensureAccessTokenReady(auth, tokenIndex);
  return { accessToken: auth[tokenIndex].accessToken, tokenIndex };
};
