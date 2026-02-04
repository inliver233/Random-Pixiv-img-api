import axios, { type AxiosRequestConfig, type AxiosResponse, type RawAxiosRequestHeaders } from 'axios';
import axiosRetry from 'axios-retry';

import { getDirectAgentPair, getProxyAgentPair, type AgentFactoryOptions } from '../proxy/agentFactory';
import { shouldProxyUrl } from '../proxy/routing';

export type PixivAxiosRequestConfig = AxiosRequestConfig & {
  proxyUri?: string;
  proxyAgentOptions?: AgentFactoryOptions;
};

const directAgents = getDirectAgentPair({ keepAlive: true });

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
  httpAgent: directAgents.httpAgent,
  httpsAgent: directAgents.httpsAgent,
  maxContentLength: 2 * MB,
  maxBodyLength: 2 * MB,
};

const PIXIV_IMAGE_DEFAULTS: AxiosRequestConfig = {
  timeout: 20_000,
  httpAgent: directAgents.httpAgent,
  httpsAgent: directAgents.httpsAgent,
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

function buildPixivConfig(
  base: AxiosRequestConfig,
  requestUrl: string | undefined,
  override?: PixivAxiosRequestConfig,
): AxiosRequestConfig {
  if (!override) return base;

  const { proxyUri, proxyAgentOptions, ...axiosOverride } = override as any;
  const merged = mergeConfig(base, axiosOverride);

  const hasExplicitAgents = Boolean((axiosOverride as any).httpAgent || (axiosOverride as any).httpsAgent);
  const shouldApplyProxyUri =
    typeof proxyUri === 'string' &&
    proxyUri.trim().length > 0 &&
    !hasExplicitAgents &&
    typeof requestUrl === 'string' &&
    shouldProxyUrl(requestUrl);

  if (shouldApplyProxyUri) {
    const agents = getProxyAgentPair(proxyUri, proxyAgentOptions);
    merged.httpAgent = agents.httpAgent;
    merged.httpsAgent = agents.httpsAgent;
    // Ensure axios doesn't attempt to apply its own proxy handling when custom agents are used.
    (merged as any).proxy = false;
    // Used by retry/error-classification logic (do not attach full proxy URI to avoid leaking credentials).
    (merged as any).__pixivcat_usedProxy = true;
  }

  return merged;
}

export async function pixivApiGet<T = any>(url: string, config?: PixivAxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.get<T>(url, buildPixivConfig(PIXIV_API_DEFAULTS, url, config));
}

export async function pixivApiRequest<T = any>(config: PixivAxiosRequestConfig): Promise<AxiosResponse<T>> {
  const { url, ...rest } = config;
  return axios.request<T>({ url, ...buildPixivConfig(PIXIV_API_DEFAULTS, url, rest) });
}

export async function pixivImageGet<T = any>(url: string, config?: PixivAxiosRequestConfig): Promise<AxiosResponse<T>> {
  return axios.get<T>(url, buildPixivConfig(PIXIV_IMAGE_DEFAULTS, url, config));
}
