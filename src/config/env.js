const { z } = require('zod');

function booleanFromEnv(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return value;
}

const booleanSchema = z.preprocess(booleanFromEnv, z.boolean());

function trustProxyFromEnv(value) {
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

function parseRefreshTokensValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => typeof item === 'string')
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

const envSchema = z
  .object({
    REFRESH_TOKENS: refreshTokensSchema,
    MEMCACHED_HOST: z.string().min(1),
    MEMCACHED_PORT: z.coerce.number().int().min(1).max(65535),
    MEMCACHED_NAMESPACE: z.string().min(1),

    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    TRUST_PROXY: trustProxySchema.optional().default(0),

    PIXIV_TOKEN_STRATEGY: z.enum(['round_robin', 'random', 'least_error', 'weighted']).optional().default('round_robin'),
    PIXIV_TOKEN_WEIGHTS: z.string().optional(),
    PIXIV_DETAIL_CACHE_ENABLED: booleanSchema.optional().default(true),
    PIXIV_DETAIL_CACHE_TTL_SECONDS: z.coerce.number().int().positive().optional().default(3600),

    DATABASE_URL: z.string().min(1).optional(),
    DB_SSL: booleanSchema.optional(),

    ADMIN_TOKEN: z.string().min(1).optional(),
    ADMIN_IP_ALLOWLIST: z.string().min(1).optional(),

    CORS_ALLOWED_ORIGINS: z.string().optional().default('*'),
    CORS_ADMIN_ALLOWED_ORIGINS: z.string().optional().default('*'),

    JSON_BODY_LIMIT: z.string().optional().default('256kb'),

    ADMIN_IMPORT_MAX_LINES: z.coerce.number().int().min(0).optional().default(0),
    ADMIN_IMPORT_MAX_FILE_BYTES: z.coerce.number().int().positive().optional().default(32 * 1024 * 1024),
    ADMIN_IMPORT_ALLOWED_MIME_TYPES: z.string().optional().default('text/plain,application/octet-stream'),
    ADMIN_IMPORT_BULK_MIN_IMAGES: z.coerce.number().int().min(0).optional().default(1000),
    ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS: z.coerce.number().int().min(0).optional().default(2000),

    RATE_LIMIT_ENABLED: booleanSchema.optional().default(false),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().optional().default(60),
    RATE_LIMIT_MAX_API_KEY: z.coerce.number().int().positive().optional().default(300),
    RATE_LIMIT_API_KEYS: z.string().optional(),

    METRICS_ENABLED: booleanSchema.optional().default(true),
    METRICS_ROUTE: z.string().min(1).optional().default('/metrics'),

    REQUEST_LOG_ENABLED: booleanSchema.optional().default(false),
    REQUEST_LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional().default(0.01),
    REQUEST_LOG_PATH_PREFIXES: z.string().optional().default('/random,/i,/images'),
    REQUEST_LOG_RETENTION_DAYS: z.coerce.number().int().min(0).optional().default(7),

    PROMETHEUS_URL: z.string().url().optional(),

    QUEUE_DEAD_LETTER_ENABLED: booleanSchema.optional().default(true),
    QUEUE_DEAD_LETTER_SUFFIX: z.string().min(1).optional().default('__dlq'),

    HEAL_TRIGGER_STATUSES: z.string().optional().default('403,404'),
    HEAL_TRIGGER_SKIP_IF_RETRY_AFTER: booleanSchema.optional().default(true),
    HEAL_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).optional().default(600),
    HEAL_RETRY_LIMIT: z.coerce.number().int().min(0).optional().default(5),
    HEAL_RETRY_DELAY_SECONDS: z.coerce.number().int().min(0).optional().default(60),
    HEAL_RETRY_DELAY_MAX_SECONDS: z.coerce.number().int().min(0).optional().default(3600),
    HEAL_RETRY_BACKOFF: booleanSchema.optional().default(true),

    HYDRATE_MAX_IN_FLIGHT: z.coerce.number().int().min(0).optional().default(1),
    HYDRATE_MAX_IN_FLIGHT_PER_TOKEN: z.coerce.number().int().min(0).optional().default(1),
    HYDRATE_RATE_LIMIT_GLOBAL_MS: z.coerce.number().int().min(0).optional().default(200),
    HYDRATE_RATE_LIMIT_PER_TOKEN_MS: z.coerce.number().int().min(0).optional().default(1000),

    RANDOM_FAIL_COOLDOWN_MS: z.coerce.number().int().min(0).optional().default(600_000),
    RANDOM_R18_STRICT: booleanSchema.optional().default(false),

    IMGPROXY_URL: z.string().url().optional(),
    IMGPROXY_KEY: z.string().min(1).optional(),
    IMGPROXY_SALT: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
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

function formatZodError(error) {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    return `- ${path}: ${issue.message}`;
  });

  return ['Invalid environment variables:', ...lines].join('\n');
}

let cachedEnv = null;

function getEnv() {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

function validateEnv() {
  void getEnv();
}

function resetEnvForTest() {
  cachedEnv = null;
}

module.exports = {
  getEnv,
  validateEnv,
  resetEnvForTest,
  parseRefreshTokensValue,
};
