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

    PIXIV_TOKEN_STRATEGY: z.enum(['round_robin', 'random']).optional().default('round_robin'),

    DATABASE_URL: z.string().min(1).optional(),
    DB_SSL: booleanSchema.optional(),

    ADMIN_TOKEN: z.string().min(1).optional(),
    ADMIN_IP_ALLOWLIST: z.string().min(1).optional(),

    RATE_LIMIT_ENABLED: booleanSchema.optional().default(false),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().optional().default(60),

    METRICS_ENABLED: booleanSchema.optional().default(true),
    METRICS_ROUTE: z.string().min(1).optional().default('/metrics'),

    RANDOM_FAIL_COOLDOWN_MS: z.coerce.number().int().min(0).optional().default(600_000),

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

module.exports = {
  getEnv,
  validateEnv,
  parseRefreshTokensValue,
};
