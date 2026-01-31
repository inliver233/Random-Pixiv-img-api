// Ensure env vars exist before importing legacy modules that read env at module-load time.
process.env.NODE_ENV ??= 'test';
process.env.REFRESH_TOKENS ??= '["dummy_refresh_token"]';
process.env.MEMCACHED_HOST ??= '127.0.0.1';
process.env.MEMCACHED_PORT ??= '11211';
process.env.MEMCACHED_NAMESPACE ??= 'test';
