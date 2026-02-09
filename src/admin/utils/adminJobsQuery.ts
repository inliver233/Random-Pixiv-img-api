import { Prisma } from '@prisma/client';

import { redactString, sanitizeStructuredData } from '../../utils/redaction';

export type AdminJobsQueryMode = 'recent' | 'job_id' | 'request_id';

export type AdminJobsQueryParams = {
  queues: string[];
  limit: number;
  jobId?: string | null;
  requestId?: string | null;
};

export type AdminJobsPageJob = {
  id: string;
  queue: string;
  state: string;
  created_on: string | null;
  data_summary: Record<string, unknown>;
  output_message: string | null;
  output_stack: string | null;
  output_preview: string | null;
};

type PgBossJobRow = {
  id: string;
  queue: string;
  state: string;
  created_on: Date | null;
  data: unknown;
  output: unknown;
};

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(v)) return null;
  return v;
}

export function safeJobSummary(data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!data || typeof data !== 'object') return out;
  const keys = [
    'request_id',
    'illust_id',
    'run_id',
    'token_id',
    'endpoint_id',
  ];
  for (const key of keys) {
    const value = (data as any)[key];
    if (value === undefined || value === null) continue;
    const s = String(value).trim();
    if (!s) continue;
    out[key] = s;
  }
  return out;
}

function extractOutputMessage(output: unknown): { message: string | null; stack: string | null } {
  if (!output || typeof output !== 'object') return { message: null, stack: null };
  const value = (output as any).value ?? output;
  if (!value || typeof value !== 'object') return { message: null, stack: null };
  const rawMessage = typeof (value as any).message === 'string' ? (value as any).message : null;
  const rawStack = typeof (value as any).stack === 'string' ? (value as any).stack : null;
  return {
    message: rawMessage ? redactString(rawMessage) : null,
    stack: rawStack ? redactString(rawStack) : null,
  };
}

function truncate(value: string, max = 240): string {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function mergeQueues(baseQueues: string[], jobs: AdminJobsPageJob[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const s = String(q ?? '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  for (const job of jobs) push(job.queue);
  for (const q of baseQueues) push(q);

  return out;
}

export async function queryAdminJobs(
  prisma: { $queryRaw: <T>(query: unknown) => Promise<T> },
  params: AdminJobsQueryParams,
): Promise<{ mode: AdminJobsQueryMode; limit: number; queues: string[]; jobs: AdminJobsPageJob[] }> {
  const baseQueues = Array.isArray(params.queues) ? params.queues.filter((q) => typeof q === 'string' && q.trim()) : [];
  const maxLimit = Math.max(1, Math.min(200, params.limit));

  const jobId = normalizeUuid(params.jobId);
  const requestId = normalizeUuid(params.requestId);

  let mode: AdminJobsQueryMode = 'recent';
  let limitUsed = maxLimit;

  if (jobId) {
    mode = 'job_id';
    limitUsed = 1;
  } else if (requestId) {
    mode = 'request_id';
  }

  if (baseQueues.length === 0) {
    return { mode, limit: limitUsed, queues: [], jobs: [] };
  }

  let query: any;
  if (mode === 'job_id' && jobId) {
    query = Prisma.sql`
      SELECT
        id::text as id,
        name::text as queue,
        state::text as state,
        created_on,
        data,
        output
      FROM pgboss.job
      WHERE name IN (${Prisma.join(baseQueues)}) AND id = ${jobId}::uuid
      LIMIT 1
    `;
  } else if (mode === 'request_id' && requestId) {
    query = Prisma.sql`
      SELECT
        id::text as id,
        name::text as queue,
        state::text as state,
        created_on,
        data,
        output
      FROM pgboss.job
      WHERE name IN (${Prisma.join(baseQueues)})
        AND (data->>'request_id' = ${requestId} OR data->>'requestId' = ${requestId})
      ORDER BY created_on DESC
      LIMIT ${limitUsed}
    `;
  } else {
    query = Prisma.sql`
      SELECT
        id::text as id,
        name::text as queue,
        state::text as state,
        created_on,
        data,
        output
      FROM pgboss.job
      WHERE name IN (${Prisma.join(baseQueues)})
      ORDER BY created_on DESC
      LIMIT ${limitUsed}
    `;
  }

  const rows = await prisma.$queryRaw<PgBossJobRow[]>(query);
  const jobs = rows.map((row) => {
    const output = extractOutputMessage(row.output);
    const outputPreview = row.output ? truncate(JSON.stringify(sanitizeStructuredData(row.output)), 240) : null;
    return {
      id: row.id,
      queue: row.queue,
      state: row.state,
      created_on: row.created_on ? row.created_on.toISOString() : null,
      data_summary: safeJobSummary(row.data),
      output_message: output.message,
      output_stack: output.stack,
      output_preview: output.message ? null : outputPreview,
    };
  });

  return {
    mode,
    limit: limitUsed,
    queues: mergeQueues(baseQueues, jobs),
    jobs,
  };
}

