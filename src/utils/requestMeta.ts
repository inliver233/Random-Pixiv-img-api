export function pickForwardedFor(req: any): string | undefined {
  const raw = req?.headers?.['x-forwarded-for'];
  if (!raw) return undefined;
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  const first = value.split(',')[0]?.trim();
  return first || undefined;
}

export function safeRequestId(req: any): string | undefined {
  return req?.request_id || req?.headers?.['x-request-id'] || undefined;
}

