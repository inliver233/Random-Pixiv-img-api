const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';
const CIRCULAR_VALUE = '[CIRCULAR]';

export function getRedactedValue(): string {
  return REDACTED_VALUE;
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;

  if (normalized.includes('password')) return true;
  if (normalized === 'refresh_token' || normalized === 'refreshtoken') return true;
  if (normalized === 'authorization' || normalized === 'cookie') return true;
  if (normalized.includes('secret')) return true;
  return false;
}

export function redactString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('bearer ')) {
    return `Bearer ${REDACTED_VALUE}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.password) {
      url.password = REDACTED_VALUE;
      return url.toString();
    }
  } catch {
    // ignore
  }

  return value;
}

export function sanitizeStructuredData(detail: unknown): unknown {
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value !== 'object') return value;

    if (depth > 8) return TRUNCATED_VALUE;

    const obj = value as object;
    if (seen.has(obj)) return CIRCULAR_VALUE;
    seen.add(obj);

    if (Array.isArray(obj)) {
      return obj.map((item) => walk(item, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveKey(k)) out[k] = REDACTED_VALUE;
      else out[k] = walk(v, depth + 1);
    }
    return out;
  };

  return walk(detail, 0);
}

