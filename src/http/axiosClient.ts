import axios, { type AxiosRequestConfig, type AxiosResponse, type RawAxiosRequestHeaders } from 'axios';
import axiosRetry from 'axios-retry';
import http from 'node:http';
import https from 'node:https';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

function mergeHeaders(
  base: AxiosRequestConfig['headers'] | undefined,
  override: AxiosRequestConfig['headers'] | undefined,
): RawAxiosRequestHeaders | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base as any),
    ...(override as any),
  };
}

function mergeConfig(base: AxiosRequestConfig, override?: AxiosRequestConfig): AxiosRequestConfig {
  if (!override) return base;
  return {
    ...base,
    ...override,
    headers: mergeHeaders(base.headers, override.headers),
  };
}

const MB = 1024 * 1024;

const PIXIV_API_DEFAULTS: AxiosRequestConfig = {
  timeout: 10_000,
  httpAgent,
  httpsAgent,
  maxContentLength: 2 * MB,
  maxBodyLength: 2 * MB,
};

const PIXIV_IMAGE_DEFAULTS: AxiosRequestConfig = {
  timeout: 20_000,
  httpAgent,
  httpsAgent,
  maxContentLength: 50 * MB,
  maxBodyLength: 50 * MB,
};

let retryConfigured = false;

function canConfigureRetry(): boolean {
  const anyAxios: any = axios as any;
  const request = anyAxios?.request;
  const interceptors = anyAxios?.interceptors;
  const hasInterceptors =
    interceptors &&
    interceptors.request &&
    typeof interceptors.request.use === 'function' &&
    interceptors.response &&
    typeof interceptors.response.use === 'function';
  return typeof request === 'function' && hasInterceptors;
}

function ensureRetryConfigured(): void {
  if (retryConfigured) return;
  if (!canConfigureRetry()) {
    retryConfigured = true;
    return;
  }

  axiosRetry(axios, {
    retries: 2,
    retryDelay: axiosRetry.exponentialDelay,
    shouldResetTimeout: true,
    retryCondition: (err: any) => {
      const responseType = err?.config?.responseType;
      if (responseType === 'stream') return false;
      if (err?.code === 'ECONNABORTED') return true; // axios timeout
      return axiosRetry.isNetworkOrIdempotentRequestError(err);
    },
  });

  retryConfigured = true;
}

ensureRetryConfigured();

export async function pixivApiGet<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.get<T>(url, mergeConfig(PIXIV_API_DEFAULTS, config));
}

export async function pixivApiRequest<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.request<T>(mergeConfig(PIXIV_API_DEFAULTS, config));
}

export async function pixivImageGet<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.get<T>(url, mergeConfig(PIXIV_IMAGE_DEFAULTS, config));
}
