import type { AxiosResponse } from 'axios';
import type { Readable } from 'node:stream';

import { getEffectiveRuntimeConfig } from '../config/runtimeConfig';
import { runWithProxyFailover } from '../proxy/proxyFailover';
import { loadEnabledProxyCandidates } from '../proxy/proxyEndpointStore';
import { shouldFailClosedForUrl, shouldProxyUrl } from '../proxy/routing';

import { pixivImageGet } from './axiosClient';

export const PIXIV_IMAGE_HEADERS = {
  Referer: 'https://www.pixiv.net/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
};

function buildProxyRequiredError(url: string): Error {
  const err: any = new Error('Proxy required (fail-closed).');
  err.code = 'proxy_required';
  err.status = 503;
  err.origin_url = url;
  return err;
}

export async function fetchPixivImageStream(url: string, signal: AbortSignal): Promise<AxiosResponse<Readable>> {
  const runtimeConfig = await getEffectiveRuntimeConfig();
  const routing = { mode: runtimeConfig.proxyRouteMode, allowlistDomains: runtimeConfig.proxyRouteAllowlistDomains };
  const policy = {
    defaultFailClosed: runtimeConfig.proxyFailClosed,
    failClosedDomains: runtimeConfig.proxyFailClosedDomains,
    failOpenDomains: runtimeConfig.proxyFailOpenDomains,
  };

  if (!shouldProxyUrl(url, routing)) {
    return pixivImageGet<Readable>(url, {
      headers: PIXIV_IMAGE_HEADERS,
      responseType: 'stream',
      signal,
      proxyRouting: routing,
    });
  }

  const proxies = await loadEnabledProxyCandidates();
  if (proxies.length === 0) {
    if (shouldFailClosedForUrl(url, { routing, policy })) {
      throw buildProxyRequiredError(url);
    }
    return pixivImageGet<Readable>(url, {
      headers: PIXIV_IMAGE_HEADERS,
      responseType: 'stream',
      signal,
      proxyRouting: routing,
    });
  }

  const { value } = await runWithProxyFailover({
    proxies,
    maxProxySwitches: 2,
    request: ({ proxyUri }) =>
      pixivImageGet<Readable>(url, {
        headers: PIXIV_IMAGE_HEADERS,
        responseType: 'stream',
        signal,
        proxyUri,
        proxyRouting: routing,
      }),
  });

  return value;
}
