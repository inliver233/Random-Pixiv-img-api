import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';
import {
  createButtonStyle,
  createCalloutStyle,
  createCardStyle,
  createInputStyle,
  pageRootStyle,
  pageTitleStyle,
} from './uiKit';

const api = new ApiClient();

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeUuid(value) {
  const v = safeString(value).trim();
  if (!v) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(v)) return null;
  return v;
}

function formatOptionalIso(iso) {
  if (!iso) return '';
  const s = safeString(iso);
  return s.length > 19 ? s.replace('T', ' ').slice(0, 19) : s;
}

function truncate(value, max = 400) {
  const s = safeString(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function toFriendlyOpsMessage(value, fallback = '服务暂不可用，请稍后重试。') {
  const raw = safeString(value).replace(/\s+/g, ' ').trim();
  if (!raw) return fallback;
  if (/P1001|ECONNREFUSED|Database not reachable|Can't reach database server/i.test(raw)) {
    return '数据库暂不可用，请检查 DATABASE_URL 与 PostgreSQL 服务。';
  }
  if (/start_failed|queue|pgboss/i.test(raw)) {
    return '队列暂不可用，通常由数据库不可达导致。请先恢复数据库连接。';
  }
  return raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
}

export default function AdminJobsPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const queryInit = useMemo(() => {
    try {
      const qs = new URLSearchParams(window.location.search || '');
      return {
        queue: safeString(qs.get('queue') || ''),
        jobId: safeString(qs.get('job_id') || qs.get('jobId') || ''),
        requestId: safeString(qs.get('request_id') || qs.get('requestId') || ''),
      };
    } catch {
      return { queue: '', jobId: '', requestId: '' };
    }
  }, []);

  const [queueFilter, setQueueFilter] = useState(queryInit.queue || '');
  const [jobIdFilter, setJobIdFilter] = useState(queryInit.jobId || '');
  const [requestIdFilter, setRequestIdFilter] = useState(queryInit.requestId || '');

  async function refresh(overrides) {
    setError(null);
    try {
      setLoading(true);
      const nextQueueFilter = overrides && typeof overrides.queueFilter === 'string' ? overrides.queueFilter : queueFilter;
      const nextJobIdFilter = overrides && typeof overrides.jobIdFilter === 'string' ? overrides.jobIdFilter : jobIdFilter;
      const nextRequestIdFilter = overrides && typeof overrides.requestIdFilter === 'string' ? overrides.requestIdFilter : requestIdFilter;

      const jobId = normalizeUuid(nextJobIdFilter);
      const requestId = normalizeUuid(nextRequestIdFilter);
      const queue = safeString(nextQueueFilter).trim();
      const params = jobId
        ? { job_id: jobId, ...(queue ? { queue } : {}) }
        : requestId
          ? { request_id: requestId, ...(queue ? { queue } : {}) }
          : undefined;
      const res = await api.getPage({ pageName: 'adminJobs', params });
      const next = res?.data || null;
      setData(next);
      const nextQueues = Array.isArray(next?.queues) ? next.queues : [];
      const nextJobs = Array.isArray(next?.jobs) ? next.jobs : [];

      if (jobId) {
        const desired = safeString(nextJobs?.[0]?.queue || '').trim();
        setQueueFilter(desired || '');
      } else if (requestId) {
        if (queue && nextQueues.length > 0 && !nextQueues.includes(queue)) setQueueFilter('');
      } else if (nextQueues.length > 0) {
        if (!queueFilter) setQueueFilter(safeString(nextQueues[0]));
        else if (!nextQueues.includes(queueFilter)) setQueueFilter(safeString(nextQueues[0]));
      }
    } catch (err) {
      setData(null);
      setError(toFriendlyOpsMessage(err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  async function postAction(action, fields) {
    if (loading) return null;
    setNotice(null);

    const form = new FormData();
    form.append('action', safeString(action));
    Object.entries(fields || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      form.append(k, safeString(v));
    });

    try {
      setLoading(true);
      const res = await api.getPage({
        pageName: 'adminJobs',
        method: 'post',
        data: form,
      });
      return res?.data || null;
    } catch (err) {
      setNotice({ type: 'error', message: toFriendlyOpsMessage(err?.message || String(err)) });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function cancelJob(job) {
    const q = safeString(job?.queue);
    const id = safeString(job?.id);
    if (!q || !id) return;
    const confirmed = globalThis.confirm ? globalThis.confirm(`确认取消/删除 job ${id} 吗？`) : true;
    if (!confirmed) return;
    const res = await postAction('job_cancel', { queue: q, job_id: id });
    if (!res) return;
    if (res.ok === false) {
      setNotice({ type: 'error', message: safeString(res.error || '取消失败') });
      return;
    }
    setNotice({ type: 'success', message: '已取消/删除' });
    await refresh();
  }

  async function retryJob(job) {
    const q = safeString(job?.queue);
    const id = safeString(job?.id);
    if (!q || !id) return;
    const confirmed = globalThis.confirm ? globalThis.confirm(`确认重试 job ${id} 吗？`) : true;
    if (!confirmed) return;
    const res = await postAction('job_retry', { queue: q, job_id: id });
    if (!res) return;
    if (res.ok === false) {
      setNotice({ type: 'error', message: safeString(res.error || '重试失败') });
      return;
    }
    setNotice({ type: 'success', message: safeString(res.message || `已重试：${safeString(res.new_job_id)}`) });
    await refresh();
  }

  useEffect(() => {
    void refresh();
  }, []);

  const queues = Array.isArray(data?.queues) ? data.queues : [];
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];

  const filteredJobs = useMemo(() => {
    const q = safeString(queueFilter);
    const filteredByQueue = q ? jobs.filter((j) => safeString(j?.queue) === q) : jobs;

    const jobQ = safeString(jobIdFilter).trim();
    const reqQ = safeString(requestIdFilter).trim();

    let out = filteredByQueue;

    if (jobQ) {
      const needle = jobQ.toLowerCase();
      out = out.filter((j) => safeString(j?.id).toLowerCase().includes(needle));
    }

    if (reqQ) {
      const needle = reqQ.toLowerCase();
      out = out.filter((j) => safeString(j?.data_summary?.request_id).toLowerCase().includes(needle));
    }

    return out;
  }, [jobs, queueFilter, jobIdFilter, requestIdFilter]);

  const queueDetail = toFriendlyOpsMessage(data?.queue?.message, '');
  const buttonStyle = createButtonStyle({ disabled: loading });
  const smallBtn = (variant) => ({
    ...createButtonStyle({ disabled: loading, danger: variant === 'danger', primary: variant === 'primary' }),
    padding: '4px 10px',
    fontSize: 12,
  });

  return (
    <div style={pageRootStyle}>
      <h2 style={pageTitleStyle}>后台任务（pg-boss jobs）</h2>
      <p style={{ marginTop: 0, color: '#666' }}>生成时间：{safeString(data?.generated_at || '')}</p>

      {error ? (
        <div style={createCalloutStyle('danger')}>
          <b>加载失败：</b>{safeString(error)}
        </div>
      ) : null}

      {notice?.message ? (
        <div style={{ marginTop: 12, ...(notice.type === 'error' ? createCalloutStyle('danger') : createCalloutStyle('success')) }}>
          {safeString(notice.message)}
        </div>
      ) : null}

      <div style={{ marginTop: 12, ...createCardStyle() }}>
        <h3 style={{ marginTop: 0 }}>概览</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>队列状态</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                {data?.queue?.ok ? '正常' : '异常'} {queueDetail ? `(${queueDetail})` : ''}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', fontWeight: 600 }}>说明</td>
              <td style={{ padding: '4px 8px' }}>
                AdminJS 的长耗时动作会入队；jobId 可用于追踪、重试与取消（不包含敏感信息）。
              </td>
            </tr>
          </tbody>
        </table>

        <button type="button" disabled={loading} onClick={() => refresh()} style={{ ...buttonStyle, marginTop: 8 }}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
        <h3 style={{ marginTop: 0 }}>筛选</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label style={{ fontWeight: 600 }}>队列</label>
          <select
            value={queueFilter}
            onChange={(e) => setQueueFilter(e.target.value)}
            disabled={loading}
            style={{ ...createInputStyle(), minWidth: 260 }}
          >
            <option key="__all__" value="">全部（所有队列）</option>
            {queues.map((q) => (
              <option key={safeString(q)} value={safeString(q)}>{safeString(q)}</option>
            ))}
          </select>
          <label style={{ fontWeight: 600 }}>job_id</label>
          <input
            value={safeString(jobIdFilter)}
            onChange={(e) => setJobIdFilter(e.target.value)}
            disabled={loading}
            placeholder="uuid（可粘贴）"
            style={{ ...createInputStyle({ mono: true }), width: 340 }}
          />
          <label style={{ fontWeight: 600 }}>request_id</label>
          <input
            value={safeString(requestIdFilter)}
            onChange={(e) => setRequestIdFilter(e.target.value)}
            disabled={loading}
            placeholder="uuid（可粘贴）"
            style={{ ...createInputStyle({ mono: true }), width: 340 }}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => refresh()}
            style={smallBtn('primary')}
            title="当输入完整 UUID 时，会向后端按 job_id/request_id 精确查询"
          >
            查询
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setJobIdFilter('');
              setRequestIdFilter('');
              void refresh({ jobIdFilter: '', requestIdFilter: '', queueFilter: '' });
            }}
            style={smallBtn('danger')}
            title="清除 job_id/request_id 并回到最近 jobs"
          >
            清除
          </button>
          <input
            value={safeString(data?.limit)}
            readOnly
            style={{ ...createInputStyle({ mono: true }), width: 120 }}
            title="后端返回的最大条数"
          />
        </div>
      </div>

      <div style={{ marginTop: 12, ...createCardStyle() }}>
        <h3 style={{ marginTop: 0 }}>最近 Jobs</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>队列</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>状态</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>创建</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>数据</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>输出/错误</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '8px', color: '#666' }}>暂无数据</td>
                </tr>
              ) : filteredJobs.map((job) => (
                <tr key={safeString(job?.id)}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace' }}>
                    {truncate(job?.id, 18)}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(job?.queue)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(job?.state)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{formatOptionalIso(job?.created_on)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace', fontSize: 12 }}>
                    {truncate(JSON.stringify(job?.data_summary || {}), 220)}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace', fontSize: 12 }}>
                    {truncate(job?.output_message || job?.output_preview || '', 220)}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                    <button type="button" disabled={loading} style={smallBtn('danger')} onClick={() => { void cancelJob(job); }}>
                      取消/删除
                    </button>
                    <button type="button" disabled={loading} style={{ ...smallBtn('primary'), marginLeft: 8 }} onClick={() => { void retryJob(job); }}>
                      重试
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
