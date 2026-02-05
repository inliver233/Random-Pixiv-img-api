import crypto from 'node:crypto';

import { Client, type ClientConfig, type Notification } from 'pg';

import logger from '../logger/logger';

export type RuntimeCacheInvalidationOptions = {
  settings?: boolean;
  tokens?: boolean;
  proxies?: boolean;
};

type RuntimeCacheInvalidationMessage = {
  kind: 'runtime_cache_invalidate';
  origin: string;
  ts: number;
  options: RuntimeCacheInvalidationOptions;
};

export type RuntimeCacheNotifyListenerParams = {
  onInvalidation: (options: RuntimeCacheInvalidationOptions) => void;
};

type RuntimeCacheNotifyState = {
  origin: string;
  started: boolean;
  startError: string | null;
  client: Client | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelayMs: number;
  listener: RuntimeCacheNotifyListenerParams | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatRuntimeCacheNotifyState: RuntimeCacheNotifyState | undefined;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 1000;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 60_000;

function ensureState(): RuntimeCacheNotifyState {
  globalThis.__pixivcatRuntimeCacheNotifyState ??= {
    origin: crypto.randomBytes(10).toString('hex'),
    started: false,
    startError: null,
    client: null,
    reconnectTimer: null,
    reconnectDelayMs: DEFAULT_RECONNECT_DELAY_MS,
    listener: null,
  };

  return globalThis.__pixivcatRuntimeCacheNotifyState;
}

function parseBooleanEnv(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function isNotifyEnabled(): boolean {
  return parseBooleanEnv(process.env.RUNTIME_NOTIFY_ENABLED, true);
}

function getChannel(): string {
  const raw = String(process.env.RUNTIME_NOTIFY_CHANNEL || '').trim();
  return raw || 'pixivcat_runtime_cache_invalidate';
}

function getDatabaseUrl(): string | null {
  const url = String(process.env.DATABASE_URL || '').trim();
  return url ? url : null;
}

function createClientConfig(): ClientConfig | null {
  const connectionString = getDatabaseUrl();
  if (!connectionString) return null;

  const useSsl = String(process.env.DB_SSL || '').trim().toLowerCase();
  const sslEnabled = ['1', 'true', 'yes', 'y', 'on'].includes(useSsl);

  return {
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MS,
  };
}

function parseMessagePayload(payload: string | null | undefined): RuntimeCacheInvalidationMessage | null {
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as any;
    if (!parsed || typeof parsed !== 'object') return null;

    const kind = String(parsed.kind || '').trim();
    if (kind !== 'runtime_cache_invalidate') return null;

    const origin = String(parsed.origin || '').trim();
    if (!origin) return null;

    const optionsObj = parsed.options && typeof parsed.options === 'object' ? parsed.options : {};

    const options: RuntimeCacheInvalidationOptions = {
      settings: Boolean((optionsObj as any).settings),
      tokens: Boolean((optionsObj as any).tokens),
      proxies: Boolean((optionsObj as any).proxies),
    };

    return {
      kind: 'runtime_cache_invalidate',
      origin,
      ts: Number.isFinite(Number(parsed.ts)) ? Number(parsed.ts) : Date.now(),
      options,
    };
  } catch {
    return null;
  }
}

function clearReconnectTimer(state: RuntimeCacheNotifyState): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function scheduleReconnect(reason: string): void {
  const state = ensureState();
  if (!state.started) return;

  if (state.reconnectTimer) return;

  const delay = Math.max(DEFAULT_RECONNECT_DELAY_MS, Math.min(MAX_RECONNECT_DELAY_MS, state.reconnectDelayMs));
  state.reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, delay * 2);

  state.reconnectTimer = setTimeout(() => {
    const s = ensureState();
    clearReconnectTimer(s);
    void connectListener({ reason: `reconnect:${reason}` });
  }, delay);
}

async function cleanupClient(state: RuntimeCacheNotifyState): Promise<void> {
  const client = state.client;
  state.client = null;

  if (!client) return;

  try {
    client.removeAllListeners();
  } catch {
    // ignore
  }

  try {
    await client.end();
  } catch {
    // ignore
  }
}

async function connectListener(params: { reason: string }): Promise<void> {
  const state = ensureState();
  if (!state.started) return;
  if (!state.listener) return;

  const config = createClientConfig();
  if (!config) return;
  if (!isNotifyEnabled()) return;
  if (process.env.NODE_ENV === 'test') return;

  const channel = getChannel();

  await cleanupClient(state);

  const client = new Client(config);
  state.client = client;

  client.on('error', (err) => {
    logger.warn({ err: { message: err instanceof Error ? err.message : String(err) } }, 'runtime notify client error');
  });

  client.on('notification', (msg: Notification) => {
    if (!state.listener) return;
    if (!msg || msg.channel !== channel) return;
    const message = parseMessagePayload(msg.payload);
    if (!message) return;
    if (message.origin === state.origin) return;

    try {
      state.listener.onInvalidation(message.options);
    } catch (err: unknown) {
      logger.warn({ err: { message: err instanceof Error ? err.message : String(err) } }, 'runtime notify handler failed');
    }
  });

  try {
    await client.connect();
    await client.query(`LISTEN "${channel}"`);

    state.reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS;
    state.startError = null;

    logger.info(
      { channel, reason: params.reason },
      'runtime notify listener started',
    );
  } catch (err: unknown) {
    state.startError = err instanceof Error ? err.message : String(err);
    logger.warn(
      { channel, err: { message: state.startError }, reason: params.reason },
      'runtime notify listener failed',
    );

    await cleanupClient(state);
    scheduleReconnect('connect_failed');
  }
}

export function ensureRuntimeCacheNotifyListenerStarted(params: RuntimeCacheNotifyListenerParams): void {
  const state = ensureState();
  state.listener = params;

  if (state.started) return;
  state.started = true;

  clearReconnectTimer(state);

  void connectListener({ reason: 'init' });
}

export async function publishRuntimeCacheInvalidation(options: RuntimeCacheInvalidationOptions): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  if (!isNotifyEnabled()) return;

  const config = createClientConfig();
  if (!config) return;

  const state = ensureState();
  const channel = getChannel();

  const message: RuntimeCacheInvalidationMessage = {
    kind: 'runtime_cache_invalidate',
    origin: state.origin,
    ts: Date.now(),
    options: {
      settings: Boolean(options.settings),
      tokens: Boolean(options.tokens),
      proxies: Boolean(options.proxies),
    },
  };

  const payload = JSON.stringify(message);

  const client = new Client(config);

  try {
    await client.connect();
    await client.query(`NOTIFY "${channel}", $1`, [payload]);
  } catch (err: unknown) {
    logger.warn(
      { channel, err: { message: err instanceof Error ? err.message : String(err) } },
      'runtime notify publish failed',
    );
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}
