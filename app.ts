import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import dotenv from 'dotenv';

import { validateEnv } from './src/config/env';

dotenv.config();

try {
  validateEnv();
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const showVersion = require('./src/middlewares/headerMiddleware').default;
const apiRoutes = require('./src/routes/api').default;
const pixivRoutes = require('./src/routes/pixivRoutes').default;
const requestIdMiddleware = require('./src/middlewares/requestIdMiddleware').default;
const httpLoggerMiddleware = require('./src/middlewares/httpLoggerMiddleware').default;
const errorHandler = require('./src/middlewares/errorHandler').default;

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

// Routes
app.use('/', apiRoutes);
app.use('/', showVersion, pixivRoutes);

// Error handling middleware
app.use(errorHandler);

// Start the server
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server is running on ${HOST}:${PORT}`);
  });
}

export default app;
