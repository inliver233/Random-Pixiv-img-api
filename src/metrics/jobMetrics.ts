import client from 'prom-client';

const SUCCESS_METRIC_NAME = 'job_success_total';
const FAIL_METRIC_NAME = 'job_fail_total';
const DURATION_METRIC_NAME = 'job_duration_seconds';
const LAST_ILLUST_ID_METRIC_NAME = 'job_last_illust_id';

export type JobOutcome = 'success' | 'fail';

type JobMetricsState = {
  initialized: boolean;
  jobSuccessTotal: client.Counter<'job'> | null;
  jobFailTotal: client.Counter<'job'> | null;
  jobDurationSeconds: client.Histogram<'job' | 'outcome'> | null;
  jobLastIllustId: client.Gauge<'job' | 'outcome'> | null;
};

function ensureJobMetricsState(): JobMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatJobMetrics ??= {
    initialized: false,
    jobSuccessTotal: null,
    jobFailTotal: null,
    jobDurationSeconds: null,
    jobLastIllustId: null,
  } satisfies JobMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatJobMetrics as JobMetricsState;
}

export function getJobSuccessTotalCounter(): client.Counter<'job'> {
  const state = ensureJobMetricsState();

  if (!state.initialized) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };

    const registry = getMetricsRegistry();
    state.jobSuccessTotal = new client.Counter({
      name: SUCCESS_METRIC_NAME,
      help: 'Total number of successfully completed jobs.',
      labelNames: ['job'],
      registers: [registry],
    });
    state.jobFailTotal = new client.Counter({
      name: FAIL_METRIC_NAME,
      help: 'Total number of failed jobs (after handler throws).',
      labelNames: ['job'],
      registers: [registry],
    });
    state.jobDurationSeconds = new client.Histogram({
      name: DURATION_METRIC_NAME,
      help: 'Job execution duration in seconds.',
      labelNames: ['job', 'outcome'],
      registers: [registry],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 60, 120],
    });
    state.jobLastIllustId = new client.Gauge({
      name: LAST_ILLUST_ID_METRIC_NAME,
      help: 'Last illust_id processed by a job (value is illust_id as number).',
      labelNames: ['job', 'outcome'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.jobSuccessTotal!;
}

export function getJobFailTotalCounter(): client.Counter<'job'> {
  const state = ensureJobMetricsState();
  if (!state.initialized) void getJobSuccessTotalCounter();
  return state.jobFailTotal!;
}

export function ensureJobMetricsInitialized(): void {
  void getJobSuccessTotalCounter();
}

export function incrementJobSuccessTotal(jobName: string): void {
  getJobSuccessTotalCounter().labels(jobName).inc();
}

export function incrementJobFailTotal(jobName: string): void {
  getJobFailTotalCounter().labels(jobName).inc();
}

export function observeJobDurationSeconds(jobName: string, outcome: JobOutcome, durationSeconds: number): void {
  const state = ensureJobMetricsState();
  if (!state.initialized) void getJobSuccessTotalCounter();

  state.jobDurationSeconds!.labels(jobName, outcome).observe(durationSeconds);
}

export function setJobLastIllustId(jobName: string, outcome: JobOutcome, illustId: unknown): void {
  const state = ensureJobMetricsState();
  if (!state.initialized) void getJobSuccessTotalCounter();

  const raw =
    typeof illustId === 'bigint'
      ? illustId.toString()
      : typeof illustId === 'number'
        ? String(illustId)
        : typeof illustId === 'string'
          ? illustId.trim()
          : '';
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return;

  state.jobLastIllustId!.labels(jobName, outcome).set(value);
}

export function recordJobSuccess(params: { job: string; illustId?: unknown; durationSeconds: number }): void {
  incrementJobSuccessTotal(params.job);
  observeJobDurationSeconds(params.job, 'success', params.durationSeconds);
  if (params.illustId !== undefined) setJobLastIllustId(params.job, 'success', params.illustId);
}

export function recordJobFail(params: { job: string; illustId?: unknown; durationSeconds: number }): void {
  incrementJobFailTotal(params.job);
  observeJobDurationSeconds(params.job, 'fail', params.durationSeconds);
  if (params.illustId !== undefined) setJobLastIllustId(params.job, 'fail', params.illustId);
}

export default {
  SUCCESS_METRIC_NAME,
  FAIL_METRIC_NAME,
  DURATION_METRIC_NAME,
  LAST_ILLUST_ID_METRIC_NAME,
  ensureJobMetricsInitialized,
  getJobSuccessTotalCounter,
  getJobFailTotalCounter,
  incrementJobSuccessTotal,
  incrementJobFailTotal,
  observeJobDurationSeconds,
  recordJobSuccess,
  recordJobFail,
};

