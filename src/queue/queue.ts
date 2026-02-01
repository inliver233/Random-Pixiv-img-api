import logger from '../logger/logger';

export type PgBossInstance = any;

type QueueState = {
  boss: PgBossInstance | null;
  starting: Promise<PgBossInstance> | null;
  startError: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatQueue: QueueState | undefined;
}

function ensureState(): QueueState {
  globalThis.__pixivcatQueue ??= {
    boss: null,
    starting: null,
    startError: null,
  };
  return globalThis.__pixivcatQueue;
}

function getDatabaseUrl(): string | null {
  const url = String(process.env.DATABASE_URL || '').trim();
  return url ? url : null;
}

export async function startQueue(): Promise<PgBossInstance | null> {
  const state = ensureState();
  if (state.boss) return state.boss;
  if (state.starting) return state.starting;

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return null;

  state.starting = (async () => {
    const { PgBoss } = await import('pg-boss') as any;

    const boss = new PgBoss({
      connectionString: databaseUrl,
      schema: 'pgboss',
      application_name: 'pixivcat-backend',
    } as any);

    boss.on('error', (err: unknown) => {
      logger.error({ err }, 'pg-boss error');
    });

    boss.on('warning', (warning: unknown) => {
      logger.warn({ warning }, 'pg-boss warning');
    });

    await boss.start();

    state.boss = boss;
    state.startError = null;
    return boss;
  })()
    .catch((err: unknown) => {
      state.boss = null;
      state.startError = err instanceof Error ? err.message : String(err);
      throw err;
    })
    .finally(() => {
      state.starting = null;
    });

  return state.starting;
}

export async function stopQueue(): Promise<void> {
  const state = ensureState();
  const boss = state.boss;
  state.boss = null;

  if (!boss) return;

  try {
    await boss.stop({ graceful: true, timeout: 30_000 });
  } catch (err: unknown) {
    logger.warn({ err }, 'pg-boss stop failed');
  }
}

export async function enqueue<T = any>(queueName: string, data?: T, options?: any): Promise<string> {
  const boss = await startQueue();
  if (!boss) {
    const err = new Error('Queue is disabled (DATABASE_URL not set).');
    (err as any).code = 'QUEUE_DISABLED';
    throw err;
  }

  await boss.createQueue(queueName);
  const id = await boss.send(queueName, data ?? {}, options);
  if (!id) {
    const err = new Error('Failed to enqueue job.');
    (err as any).code = 'ENQUEUE_FAILED';
    throw err;
  }
  return id;
}

export async function work<T = any>(
  queueName: string,
  handler: (jobs: Array<{ id: string; data: T }>) => Promise<void> | void,
  options?: { batchSize?: number; pollingIntervalSeconds?: number },
): Promise<void> {
  const boss = await startQueue();
  if (!boss) return;

  await boss.createQueue(queueName);
  await boss.work(queueName, options ?? {}, handler as any);
}

export async function getQueueHealth(): Promise<{ ok: boolean; message: string | null }> {
  const state = ensureState();
  if (!getDatabaseUrl()) return { ok: true, message: 'disabled' };
  if (state.startError) return { ok: false, message: `start_failed:${state.startError}` };
  if (!state.boss) return { ok: true, message: 'not_initialized' };

  try {
    await state.boss.getQueues();
    return { ok: true, message: null };
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
