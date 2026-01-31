import axios from 'axios';
import crypto from 'node:crypto';
import qs from 'qs';

const AUTH_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';

type PixivAuthEntry = {
  refreshToken: string;
  accessToken: string;
  expireTimestamp: number;
  refreshing: boolean;
};

type RefreshTokensEnv = string[];

type PixivAuthRefreshResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

const refreshTokens = JSON.parse(process.env.REFRESH_TOKENS as string) as RefreshTokensEnv;
const pixivAuth: PixivAuthEntry[] = refreshTokens.map((token) => ({
  refreshToken: token,
  accessToken: '',
  expireTimestamp: 0,
  refreshing: false,
}));
let currentTokenIndex = 0;

export const maskHeader: Record<string, string> = {
  'App-OS': 'ios',
  'App-OS-Version': '10.3.1',
  'App-Version': '6.7.1',
  'User-Agent': 'PixivIOSApp/6.7.1 (iOS 10.3.1; iPhone8,1)',
};

const refreshAccessToken = async (refreshToken: string): Promise<PixivAuthRefreshResponse> => {
  const localTime = `${new Date().toISOString().replace(/\..+/, '')}+00:00`;
  const response = await axios({
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

const getAccessTokenIndex = () => {
  // Rotate index
  currentTokenIndex = (currentTokenIndex + 1) % pixivAuth.length;
  return currentTokenIndex;
};

export const getAccessToken = async (): Promise<string> => {
  const tokenIndex = getAccessTokenIndex();

  if (pixivAuth[tokenIndex].expireTimestamp < Date.now()) {
    if (!pixivAuth[tokenIndex].refreshing) {
      // Set the refreshing flag to indicate that a refresh is in progress
      pixivAuth[tokenIndex].refreshing = true;

      try {
        const refreshRes = await refreshAccessToken(pixivAuth[tokenIndex].refreshToken);
        pixivAuth[tokenIndex].accessToken = refreshRes.access_token;
        pixivAuth[tokenIndex].refreshToken = refreshRes.refresh_token;
        pixivAuth[tokenIndex].expireTimestamp = Date.now() + refreshRes.expires_in * 0.9 * 1000;
        console.log(`Pixiv access token[${tokenIndex}] refreshed`);
      } catch (err) {
        console.log('Pixiv refresh token failed.', err);
      } finally {
        // Reset the refreshing flag when the refresh is completed (whether successful or not)
        pixivAuth[tokenIndex].refreshing = false;
      }
    } else {
      // If another refresh is already in progress, wait for its completion
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!pixivAuth[tokenIndex].refreshing) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }
  }

  return pixivAuth[tokenIndex].accessToken;
};

