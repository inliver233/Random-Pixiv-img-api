const client = require('prom-client');
const { getMetricsRegistry } = require('./registry');

const SUCCESS_METRIC_NAME = 'job_success_total';
const FAIL_METRIC_NAME = 'job_fail_total';
const DURATION_METRIC_NAME = 'job_duration_seconds';
const LAST_ILLUST_ID_METRIC_NAME = 'job_last_illust_id';

const ensureJobMetricsState = () => {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatJobMetrics ??= {
    initialized: false,
    jobSuccessTotal: null,
    jobFailTotal: null,
    jobDurationSeconds: null,
    jobLastIllustId: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatJobMetrics;
};

function getJobSuccessTotalCounter() {
  const state = ensureJobMetricsState();

  if (!state.initialized) {
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

  return state.jobSuccessTotal;
}

function getJobFailTotalCounter() {
  const state = ensureJobMetricsState();
  if (!state.initialized) void getJobSuccessTotalCounter();
  return state.jobFailTotal;
}

function ensureJobMetricsInitialized() {
  void getJobSuccessTotalCounter();
}

function incrementJobSuccessTotal(jobName) {
  getJobSuccessTotalCounter().labels(jobName).inc();
}

function incrementJobFailTotal(jobName) {
  getJobFailTotalCounter().labels(jobName).inc();
}

function observeJobDurationSeconds(jobName, outcome, durationSeconds) {
  const state = ensureJobMetricsState();
  if (!state.initialized) void getJobSuccessTotalCounter();
  state.jobDurationSeconds.labels(jobName, outcome).observe(durationSeconds);
}

function setJobLastIllustId(jobName, outcome, illustId) {
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

  state.jobLastIllustId.labels(jobName, outcome).set(value);
}

function recordJobSuccess(params) {
  incrementJobSuccessTotal(params.job);
  observeJobDurationSeconds(params.job, 'success', params.durationSeconds);
  if (params.illustId !== undefined) setJobLastIllustId(params.job, 'success', params.illustId);
}

function recordJobFail(params) {
  incrementJobFailTotal(params.job);
  observeJobDurationSeconds(params.job, 'fail', params.durationSeconds);
  if (params.illustId !== undefined) setJobLastIllustId(params.job, 'fail', params.illustId);
}

module.exports = {
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

