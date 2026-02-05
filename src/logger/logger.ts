import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'err.config.headers.authorization',
      'err.config.headers.Authorization',
      'err.config.headers.cookie',
      'err.config.headers.Cookie',
      'err.config.data',
      'err.response.config.headers.authorization',
      'err.response.config.headers.Authorization',
      'err.response.config.data',
      'refreshToken',
      'refresh_token',
      'accessToken',
      'access_token',
      'password',
      'pass',
      'proxyUri',
      'proxy_uri',
      'proxyUrl',
      'proxy_url',
      'REFRESH_TOKENS',
      'ADMIN_TOKEN',
      'ADMIN_SESSION_SECRET',
      'ADMIN_SESSION_PASS',
      'EASY_PROXIES_PASSWORD',
      'IMGPROXY_KEY',
      'IMGPROXY_SALT',
    ],
    censor: '[REDACTED]',
  },
});

export default logger;
