const express = require('express');
const path = require('path');
require('dotenv').config();

const { validateEnv } = require('./src/config/env');

try {
  validateEnv();
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}

const requestIdMiddleware = require('./src/middlewares/requestIdMiddleware');
const httpLoggerMiddleware = require('./src/middlewares/httpLoggerMiddleware');
const showVersion = require('./src/middlewares/headerMiddleware');
const errorHandler = require('./src/middlewares/errorHandler');
const apiRoutes = require('./src/routes/api');
const pixivRoutes = require('./src/routes/pixivRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
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

// Start the server (only when executed directly; allow importing app for tests)
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server is running on ${HOST}:${PORT}`);
  });
}

module.exports = app;
