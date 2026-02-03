import path from 'node:path';

import express from 'express';
import dotenv from 'dotenv';

import { getEnv, validateEnv } from './src/config/env';
import logger from './src/logger/logger';

dotenv.config();

try {
  validateEnv();
} catch (err: unknown) {
  logger.error({ err }, 'Invalid environment variables');
  process.exit(1);
}

const env = getEnv();

const showVersion = require('./src/middlewares/headerMiddleware').default;
const apiRoutes = require('./src/routes/api').default;
const pixivRoutes = require('./src/routes/pixivRoutes').default;
const requestIdMiddleware = require('./src/middlewares/requestIdMiddleware').default;
const httpLoggerMiddleware = require('./src/middlewares/httpLoggerMiddleware').default;
const corsMiddleware = require('./src/middlewares/cors').default;
const securityHeaders = require('./src/middlewares/securityHeaders').default;
const rateLimitMiddleware = require('./src/middlewares/rateLimit').default;
const errorHandler = require('./src/middlewares/errorHandler').default;

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

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
app.use(['/random', '/i', '/images'], rateLimitMiddleware);
app.use('/', apiRoutes);
app.use('/', showVersion, pixivRoutes);

// Error handling middleware
app.use(errorHandler);

// Start the server
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    logger.info({ host: HOST, port: PORT }, 'Server is running');
  });

  const registerHydrateMetadataWorker = require('./src/jobs/hydrateMetadata').registerHydrateMetadataWorker as () => Promise<void>;
  const registerHealUrlWorker = require('./src/jobs/healUrl').registerHealUrlWorker as () => Promise<void>;

  void registerHydrateMetadataWorker().catch((err: unknown) => {
    logger.error({ err }, 'register hydrate_metadata worker failed');
  });

  void registerHealUrlWorker().catch((err: unknown) => {
    logger.error({ err }, 'register heal_url worker failed');
  });
}

export default app;
