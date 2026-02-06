import path from 'node:path';

import express from 'express';
import dotenv from 'dotenv';

import { getEnv, validateEnv } from './src/config/env';
import logger from './src/logger/logger';
import { resolveRuntimeModulePath } from './src/utils/runtimeModulePath';

dotenv.config();

const argv = process.argv.slice(2);
const isSmokeMode = argv.includes('smoke');

if (isSmokeMode) {
  // Provide minimal defaults so `node dist/app.js smoke` can run without external env.
  process.env.REFRESH_TOKENS ??= '["smoke"]';
  process.env.MEMCACHED_HOST ??= '127.0.0.1';
  process.env.MEMCACHED_PORT ??= '11211';
  process.env.MEMCACHED_NAMESPACE ??= 'pixiv';
}

try {
  validateEnv();
} catch (err: unknown) {
  logger.error({ err }, 'Invalid environment variables');
  process.exit(1);
}

const env = getEnv();

function requireDefault<T>(moduleBasePath: string): T {
  const runtimePath = resolveRuntimeModulePath(moduleBasePath, __dirname);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(runtimePath) as any;
  return (mod && 'default' in mod) ? (mod.default as T) : (mod as T);
}

const showVersion = requireDefault<express.RequestHandler>('./src/middlewares/headerMiddleware');
const apiRoutes = requireDefault<express.Router>('./src/routes/api');
const pixivRoutes = requireDefault<express.Router>('./src/routes/pixivRoutes');
const requestIdMiddleware = requireDefault<express.RequestHandler>('./src/middlewares/requestIdMiddleware');
const httpLoggerMiddleware = requireDefault<express.RequestHandler>('./src/middlewares/httpLoggerMiddleware');
const corsMiddleware = requireDefault<express.RequestHandler>('./src/middlewares/cors');
const securityHeaders = requireDefault<express.RequestHandler>('./src/middlewares/securityHeaders');
const rateLimitMiddleware = requireDefault<express.RequestHandler>('./src/middlewares/rateLimit');
const errorHandler = requireDefault<express.ErrorRequestHandler>('./src/middlewares/errorHandler');

const app = express();
const PORT = env.PORT;
const HOST = env.HOST;

if (env.TRUST_PROXY > 0) {
  app.set('trust proxy', env.TRUST_PROXY);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);
app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT }));
app.use(corsMiddleware);
app.use(['/random', '/images', '/healthz', '/metrics', '/admin'], securityHeaders);

// Routes
app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.use(['/random', '/i', '/images'], rateLimitMiddleware);
app.use('/', apiRoutes);
app.use('/', showVersion, pixivRoutes);

// Error handling middleware
app.use(errorHandler);

export async function runApp(params: { argv?: string[] } = {}): Promise<void> {
  const runArgv = params.argv ?? process.argv.slice(2);

  if (runArgv.includes('smoke')) {
    logger.info({ ok: true }, 'smoke_ok');
    return;
  }

  app.listen(PORT, HOST, () => {
    logger.info({ host: HOST, port: PORT }, 'Server is running');
  });

  const registerHydrateMetadataWorker = require('./src/jobs/hydrateMetadata').registerHydrateMetadataWorker as () => Promise<void>;
  const registerHealUrlWorker = require('./src/jobs/healUrl').registerHealUrlWorker as () => Promise<void>;
  const registerHydrationBackfillWorker = require('./src/jobs/hydrationBackfill').registerHydrationBackfillWorker as () => Promise<void>;

  void registerHydrateMetadataWorker().catch((err: unknown) => {
    logger.error({ err }, 'register hydrate_metadata worker failed');
  });

  void registerHealUrlWorker().catch((err: unknown) => {
    logger.error({ err }, 'register heal_url worker failed');
  });

  void registerHydrationBackfillWorker().catch((err: unknown) => {
    logger.error({ err }, 'register hydration_backfill worker failed');
  });
}

if (require.main === module) {
  void runApp().then(() => {
    if (isSmokeMode) {
      process.exit(0);
    }
  }).catch((err: unknown) => {
    logger.error({ err }, 'app startup failed');
    process.exit(1);
  });
}

export default app;
