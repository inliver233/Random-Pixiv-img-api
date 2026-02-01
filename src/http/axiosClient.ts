import axios, { type AxiosRequestConfig, type AxiosResponse, type RawAxiosRequestHeaders } from 'axios';
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

export async function pixivApiGet<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.get<T>(url, mergeConfig(PIXIV_API_DEFAULTS, config));
}

export async function pixivApiRequest<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.request<T>(mergeConfig(PIXIV_API_DEFAULTS, config));
}

export async function pixivImageGet<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.get<T>(url, mergeConfig(PIXIV_IMAGE_DEFAULTS, config));
}

