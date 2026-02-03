import { z } from 'zod';

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim() === '' ? undefined : value;
}

function booleanFromEnv(value: unknown): unknown {
  value = emptyStringToUndefined(value);
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return value;
}

const booleanSchema = z.preprocess(booleanFromEnv, z.boolean());

function trustProxyFromEnv(value: unknown): unknown {
  value = emptyStringToUndefined(value);
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return 1;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return 0;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value;
}

const trustProxySchema = z.preprocess(trustProxyFromEnv, z.number().int().min(0));

const optionalNonEmptyString = z.preprocess(emptyStringToUndefined, z.string().min(1)).optional();
const optionalUrlString = z.preprocess(emptyStringToUndefined, z.string().url()).optional();

function optionalStringWithDefault(defaultValue: string) {
  return z.preprocess(emptyStringToUndefined, z.string()).optional().default(defaultValue);
}

function optionalCoercedInt(schema: z.ZodNumber) {
  return z.preprocess(emptyStringToUndefined, z.coerce.number().pipe(schema)).optional();
}

function optionalCoercedIntWithDefault(schema: z.ZodNumber, defaultValue: number) {
  return optionalCoercedInt(schema).default(defaultValue);
}

export function parseRefreshTokensValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((token) => token.trim())
        .filter((token) => token !== '');
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

const refreshTokensSchema = z.string().transform((value, ctx) => {
  const parsed = parseRefreshTokensValue(value);
  if (parsed.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'REFRESH_TOKENS must be a non-empty JSON array or a comma-separated string.',
    });
    return z.NEVER;
  }
  return parsed;
});

const envSchema = z.object({
  REFRESH_TOKENS: refreshTokensSchema,
  MEMCACHED_HOST: z.string().min(1),
  MEMCACHED_PORT: z.coerce.number().int().min(1).max(65535),
  MEMCACHED_NAMESPACE: z.string().min(1),

  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY: trustProxySchema.optional().default(0),

  PIXIV_TOKEN_STRATEGY: z.enum(['round_robin', 'random']).optional().default('round_robin'),
  PIXIV_DETAIL_CACHE_ENABLED: booleanSchema.optional().default(true),
  PIXIV_DETAIL_CACHE_TTL_SECONDS: optionalCoercedIntWithDefault(z.number().int().positive(), 3600),

  DATABASE_URL: optionalNonEmptyString,
  DB_SSL: booleanSchema.optional(),

  ADMIN_TOKEN: optionalNonEmptyString,
  ADMIN_IP_ALLOWLIST: optionalNonEmptyString,

  CORS_ALLOWED_ORIGINS: optionalStringWithDefault('*'),
  CORS_ADMIN_ALLOWED_ORIGINS: optionalStringWithDefault('*'),

  JSON_BODY_LIMIT: optionalStringWithDefault('256kb'),

  ADMIN_IMPORT_MAX_LINES: optionalCoercedIntWithDefault(z.number().int().min(0), 0),
  ADMIN_IMPORT_MAX_FILE_BYTES: optionalCoercedIntWithDefault(z.number().int().positive(), 1024 * 1024),
  ADMIN_IMPORT_ALLOWED_MIME_TYPES: optionalStringWithDefault('text/plain,application/octet-stream'),

  RATE_LIMIT_ENABLED: booleanSchema.optional().default(false),
  RATE_LIMIT_WINDOW_MS: optionalCoercedIntWithDefault(z.number().int().positive(), 60_000),
  RATE_LIMIT_MAX: optionalCoercedIntWithDefault(z.number().int().positive(), 60),
  RATE_LIMIT_MAX_API_KEY: optionalCoercedIntWithDefault(z.number().int().positive(), 300),
  RATE_LIMIT_API_KEYS: z.preprocess(emptyStringToUndefined, z.string()).optional(),

  METRICS_ENABLED: booleanSchema.optional().default(true),
  METRICS_ROUTE: optionalStringWithDefault('/metrics'),

  PROMETHEUS_URL: optionalUrlString,

  QUEUE_DEAD_LETTER_ENABLED: booleanSchema.optional().default(true),
  QUEUE_DEAD_LETTER_SUFFIX: optionalStringWithDefault('__dlq'),

  HEAL_TRIGGER_STATUSES: optionalStringWithDefault('403,404'),
  HEAL_TRIGGER_SKIP_IF_RETRY_AFTER: booleanSchema.optional().default(true),
  HEAL_DEBOUNCE_SECONDS: optionalCoercedIntWithDefault(z.number().int().min(0), 600),
  HEAL_RETRY_LIMIT: optionalCoercedIntWithDefault(z.number().int().min(0), 5),
  HEAL_RETRY_DELAY_SECONDS: optionalCoercedIntWithDefault(z.number().int().min(0), 60),
  HEAL_RETRY_DELAY_MAX_SECONDS: optionalCoercedIntWithDefault(z.number().int().min(0), 3600),
  HEAL_RETRY_BACKOFF: booleanSchema.optional().default(true),

  HYDRATE_MAX_IN_FLIGHT: optionalCoercedIntWithDefault(z.number().int().min(0), 1),
  HYDRATE_MAX_IN_FLIGHT_PER_TOKEN: optionalCoercedIntWithDefault(z.number().int().min(0), 1),
  HYDRATE_RATE_LIMIT_GLOBAL_MS: optionalCoercedIntWithDefault(z.number().int().min(0), 200),
  HYDRATE_RATE_LIMIT_PER_TOKEN_MS: optionalCoercedIntWithDefault(z.number().int().min(0), 1000),

  RANDOM_FAIL_COOLDOWN_MS: optionalCoercedIntWithDefault(z.number().int().min(0), 600_000),

  IMGPROXY_URL: optionalUrlString,
  IMGPROXY_KEY: optionalNonEmptyString,
  IMGPROXY_SALT: optionalNonEmptyString,
}).superRefine((data, ctx) => {
  const imgproxyConfigured = Boolean(data.IMGPROXY_URL || data.IMGPROXY_KEY || data.IMGPROXY_SALT);
  if (imgproxyConfigured) {
    if (!data.IMGPROXY_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['IMGPROXY_URL'], message: 'IMGPROXY_URL is required.' });
    }
    if (!data.IMGPROXY_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['IMGPROXY_KEY'], message: 'IMGPROXY_KEY is required.' });
    }
    if (!data.IMGPROXY_SALT) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['IMGPROXY_SALT'], message: 'IMGPROXY_SALT is required.' });
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    return `- ${path}: ${issue.message}`;
  });

  return ['Invalid environment variables:', ...lines].join('\n');
}

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function validateEnv(): void {
  void getEnv();
}

export function resetEnvForTest(): void {
  cachedEnv = null;
}
