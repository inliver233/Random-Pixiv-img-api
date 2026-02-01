import logger from '../logger/logger';
import { enqueue, startQueue, stopQueue, work } from './queue';

const DEMO_QUEUE = 'pixivcat_demo';

async function main() {
  const boss = await startQueue();
  if (!boss) {
    logger.error({ code: 'QUEUE_DISABLED' }, 'Queue disabled (DATABASE_URL not set)');
    process.exit(2);
  }

  await work(DEMO_QUEUE, async (jobs) => {
    for (const job of jobs) {
      logger.info({ job_id: job.id, data: job.data }, 'demo job received');
    }
  });

  const id = await enqueue(DEMO_QUEUE, { hello: 'world', ts: new Date().toISOString() });
  logger.info({ job_id: id }, 'demo job enqueued');

  // allow worker to pick up once
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await stopQueue();
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'demo job failed');
    process.exit(1);
  });
}

