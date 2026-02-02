const { pixivApiRequest } = require('../http/axiosClient.cjs');
const crypto = require('crypto');
const qs = require('qs');

const { getEnv } = require('../config/env');
const logger = require('../logger/logger');

const AUTH_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';
let pixivAuth = null;
let currentTokenIndex = 0;

const maskHeader = {
  'App-OS': 'ios',
  'App-OS-Version': '10.3.1',
  'App-Version': '6.7.1',
  'User-Agent': 'PixivIOSApp/6.7.1 (iOS 10.3.1; iPhone8,1)',
};

const refreshAccessToken = async (refreshToken) => {
  const localTime = `${new Date().toISOString().replace(/\..+/, '')}+00:00`;
  const response = await pixivApiRequest({
    method: 'post',
    url: AUTH_TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Client-Time': localTime,
      'X-Client-Hash': crypto.createHash('md5').update(`${localTime}28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c`).digest('hex'),
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

const selectTokenIndex = (strategy, tokenCount, prevIndex) => {
  if (tokenCount <= 0) return 0;
  if (strategy === 'random') return Math.floor(Math.random() * tokenCount);
  return (prevIndex + 1) % tokenCount;
};

const ensureAccessTokenReady = async (auth, tokenIndex) => {
  if (auth[tokenIndex].expireTimestamp >= Date.now()) {
    return;
  }

  if (!auth[tokenIndex].refreshing) {
    auth[tokenIndex].refreshing = true;
    try {
      const refreshRes = await refreshAccessToken(auth[tokenIndex].refreshToken);
      auth[tokenIndex].accessToken = refreshRes.access_token;
      auth[tokenIndex].refreshToken = refreshRes.refresh_token;
      auth[tokenIndex].expireTimestamp = Date.now() + (refreshRes.expires_in * 0.9) * 1000;
      logger.info({ token_index: tokenIndex }, 'Pixiv access token refreshed');
    } catch (err) {
      logger.warn(
        { token_index: tokenIndex, err: { message: err?.message, code: err?.code, status: err?.response?.status } },
        'Pixiv refresh token failed',
      );
    } finally {
      auth[tokenIndex].refreshing = false;
    }

    return;
  }

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!auth[tokenIndex].refreshing) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
};

const ensurePixivAuthInitialized = () => {
  if (pixivAuth) return pixivAuth;

  const env = getEnv();
  pixivAuth = env.REFRESH_TOKENS.map((token) => ({
    refreshToken: token,
    accessToken: '',
    expireTimestamp: 0,
    refreshing: false,
  }));

  return pixivAuth;
};

const getAccessTokenIndex = () => {
  const env = getEnv();
  const auth = ensurePixivAuthInitialized();

  currentTokenIndex = selectTokenIndex(env.PIXIV_TOKEN_STRATEGY, auth.length, currentTokenIndex);
  return currentTokenIndex;
};

const getAccessToken = async () => {
  const auth = ensurePixivAuthInitialized();
  const tokenIndex = getAccessTokenIndex();

  await ensureAccessTokenReady(auth, tokenIndex);

  return auth[tokenIndex].accessToken;
};

module.exports = {
  getAccessToken,
  getAccessTokenWithMeta: async () => {
    const auth = ensurePixivAuthInitialized();
    const tokenIndex = getAccessTokenIndex();
    await ensureAccessTokenReady(auth, tokenIndex);
    return { accessToken: auth[tokenIndex].accessToken, tokenIndex };
  },
  maskHeader,
  selectTokenIndex,
};
