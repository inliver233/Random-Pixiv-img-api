const { Client } = require('pg');

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 1000;

const checkDb = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { ok: false, message: 'DATABASE_URL is not configured.' };
  }

  const useSsl = String(process.env.DB_SSL || '').trim().toLowerCase();
  const sslEnabled = ['1', 'true', 'yes', 'y', 'on'].includes(useSsl);

  const client = new Client({
    connectionString: databaseUrl,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: DEFAULT_DB_CONNECT_TIMEOUT_MS,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true, message: null };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
};

module.exports = {
  checkDb,
};

