export type OutboundErrorType =
  | 'proxy_connect'
  | 'proxy_auth'
  | 'pixiv_rate_limit'
  | 'pixiv_403'
  | 'pixiv_5xx'
  | 'timeout'
  | 'network'
  | 'upstream'
  | 'unknown';

export type OutboundErrorClassification = {
  type: OutboundErrorType;
  retryable: boolean;
  status?: number;
  code?: string;
  message: string;
};

export type OutboundErrorContext = {
  usedProxy?: boolean;
};

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function safeNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function getAxiosStatus(err: any): number | undefined {
  return safeNumber(err?.response?.status);
}

function getAxiosData(err: any): any {
  return err?.response?.data;
}

function isTimeout(err: any): boolean {
  const code = safeString(err?.code).toUpperCase();
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  const msg = safeString(err?.message).toLowerCase();
  return msg.includes('timeout') || msg.includes('timed out');
}

function isProxyAuthFailure(err: any): boolean {
  const status = getAxiosStatus(err);
  if (status === 407) return true; // Proxy Authentication Required

  const code = safeString(err?.code).toLowerCase();
  if (code.includes('auth') && code.includes('socks')) return true;

  const msg = safeString(err?.message).toLowerCase();
  return msg.includes('proxy authentication') || msg.includes('socks authentication');
}

function isPixivRateLimit(err: any): boolean {
  const status = getAxiosStatus(err);
  if (status !== 403) return false;

  const data = getAxiosData(err);
  const message = safeString(data?.error?.message);
  return message === 'Rate Limit';
}

export function classifyOutboundError(err: unknown, context: OutboundErrorContext = {}): OutboundErrorClassification {
  const anyErr: any = err as any;
  const status = getAxiosStatus(anyErr);
  const code = safeString(anyErr?.code) || undefined;
  const message = safeString(anyErr?.message) || 'Unknown error';

  if (isTimeout(anyErr)) {
    return { type: 'timeout', retryable: true, status, code, message };
  }

  if (isProxyAuthFailure(anyErr)) {
    return { type: 'proxy_auth', retryable: false, status, code, message };
  }

  if (isPixivRateLimit(anyErr)) {
    return { type: 'pixiv_rate_limit', retryable: true, status, code, message };
  }

  if (status === 403) {
    return { type: 'pixiv_403', retryable: false, status, code, message };
  }

  if (status !== undefined) {
    if (status >= 500 && status <= 599) {
      return { type: 'pixiv_5xx', retryable: true, status, code, message };
    }
    return { type: 'upstream', retryable: false, status, code, message };
  }

  // No response (network-level)
  if (context.usedProxy) {
    return { type: 'proxy_connect', retryable: true, status, code, message };
  }

  if (code) {
    const normalized = code.toUpperCase();
    if (['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(normalized)) {
      return { type: 'network', retryable: true, status, code, message };
    }
  }

  return { type: 'unknown', retryable: false, status, code, message };
}

