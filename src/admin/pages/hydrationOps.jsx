import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';

const api = new ApiClient();

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatOptionalIso(iso) {
  if (!iso) return '';
  const s = safeString(iso);
  return s.length > 19 ? s.replace('T', ' ').slice(0, 19) : s;
}

function formatOptionalNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (digits > 0) return n.toFixed(digits);
  return String(Math.round(n));
}

function truncate(value, max = 400) {
  const s = safeString(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export default function HydrationOpsPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [selectedDlq, setSelectedDlq] = useState('');
  const [dlqJobs, setDlqJobs] = useState([]);

  async function refresh() {
    setError(null);
    try {
      setLoading(true);
      const res = await api.getPage({ pageName: 'hydrationOps' });
      const next = res?.data || null;
      setData(next);
      setDlqJobs(Array.isArray(next?.dlq?.jobs) ? next.dlq.jobs : []);

      const queues = Array.isArray(next?.dlq?.queues) ? next.dlq.queues : [];
      if (!selectedDlq && queues.length > 0) {
        setSelectedDlq(safeString(queues[0]?.name || ''));
      }
    } catch (err) {
      setData(null);
      setDlqJobs([]);
      setError(err?.message || String(err));
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
        pageName: 'hydrationOps',
        method: 'post',
        data: form,
      });
      return res?.data || null;
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || String(err) });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadDlqJobs(queueName) {
    const q = safeString(queueName || selectedDlq);
    if (!q) return;
    const res = await postAction('dlq_list', { queue: q });
    if (!res) return;
    if (res.ok === false) {
      setNotice({ type: 'error', message: safeString(res.error || 'DLQ 加载失败') });
      return;
    }
    const jobs = Array.isArray(res.jobs) ? res.jobs : [];
    setDlqJobs(jobs);
    setSelectedDlq(q);
  }

  async function retryDlqJob(job) {
    const q = safeString(job?.queue || selectedDlq);
    const id = safeString(job?.id);
    if (!q || !id) return;
    const res = await postAction('dlq_retry', { queue: q, job_id: id });
    if (!res) return;
    if (res.ok === false) {
      setNotice({ type: 'error', message: safeString(res.error || '重试失败') });
      return;
    }
    const msg = res?.message ? safeString(res.message) : '已重试';
    setNotice({ type: 'success', message: msg });
    await loadDlqJobs(q);
  }

  async function deleteDlqJob(job) {
    const q = safeString(job?.queue || selectedDlq);
    const id = safeString(job?.id);
    if (!q || !id) return;
    const confirmed = globalThis.confirm ? globalThis.confirm(`删除 DLQ job?\nqueue=${q}\nid=${id}`) : true;
    if (!confirmed) return;
    const res = await postAction('dlq_delete', { queue: q, job_id: id });
    if (!res) return;
    if (res.ok === false) {
      setNotice({ type: 'error', message: safeString(res.error || '删除失败') });
      return;
    }
    setNotice({ type: 'success', message: '已删除' });
    await loadDlqJobs(q);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const runs = Array.isArray(data?.runs) ? data.runs : [];
  const dlq = data?.dlq || null;
  const dlqQueues = Array.isArray(dlq?.queues) ? dlq.queues : [];

  const dlqCountsByName = useMemo(() => {
    const map = new Map();
    for (const q of dlqQueues) {
      map.set(safeString(q?.name), q);
    }
    return map;
  }, [dlqQueues]);

  useEffect(() => {
    if (!selectedDlq && dlqQueues.length > 0) {
      setSelectedDlq(safeString(dlqQueues[0]?.name || ''));
    }
  }, [selectedDlq, dlqQueues]);

  const selectedQueueMeta = dlqCountsByName.get(safeString(selectedDlq)) || null;

  const buttonStyle = {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#111827',
    cursor: loading ? 'not-allowed' : 'pointer',
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>补全运行面板与 DLQ</h2>
      <p style={{ marginTop: 0, color: '#666' }}>生成时间：{safeString(data?.generated_at || '')}</p>

      {error ? (
        <div style={{ padding: 12, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 12, color: '#991b1b' }}>
          <b>加载失败：</b>{safeString(error)}
        </div>
      ) : null}

      {notice?.message ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            border: notice.type === 'error' ? '1px solid #fecaca' : '1px solid #bbf7d0',
            background: notice.type === 'error' ? '#fef2f2' : '#f0fdf4',
            color: notice.type === 'error' ? '#991b1b' : '#166534',
          }}
        >
          {safeString(notice.message)}
        </div>
      ) : null}

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>概览</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>queue</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                {data?.queue?.ok ? 'ok' : 'not_ok'} {data?.queue?.message ? `(${safeString(data.queue.message)})` : ''}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', fontWeight: 600 }}>dlq_enabled</td>
              <td style={{ padding: '4px 8px' }}>{dlq?.enabled ? 'true' : 'false'}</td>
            </tr>
          </tbody>
        </table>

        <button type="button" disabled={loading} onClick={() => refresh()} style={{ ...buttonStyle, marginTop: 8 }}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>补全运行（HydrationRun）</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>id</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>type</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>status</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>processed/total</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>success</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>failed</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>updated_at</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>last_error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const id = safeString(run?.id);
                const total = run?.total === null || run?.total === undefined ? '' : formatOptionalNumber(run.total);
                const processed = formatOptionalNumber(run?.processed);
                const lastError = run?.last_error_code ? `${safeString(run.last_error_code)}: ${truncate(run?.last_error_msg || '')}` : '';
                return (
                  <tr key={id}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                      <a href={`/admin/resources/HydrationRun/records/${encodeURIComponent(id)}/show`} style={{ color: '#2563eb' }}>
                        {id}
                      </a>
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(run?.type)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(run?.status)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>
                      {processed}{total ? `/${total}` : ''}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatOptionalNumber(run?.success)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatOptionalNumber(run?.failed)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{formatOptionalIso(run?.updated_at)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', color: run?.last_error_code ? '#991b1b' : '#6b7280' }}>
                      {safeString(lastError)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Dead-letter（DLQ）</h3>
        {!dlq?.enabled ? (
          <p style={{ marginTop: 0, color: '#666' }}>DLQ 已禁用（QUEUE_DEAD_LETTER_ENABLED=false）。</p>
        ) : dlq?.ok === false ? (
          <div style={{ padding: 12, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 12, color: '#991b1b' }}>
            <b>DLQ 查询失败：</b>{safeString(dlq?.error || '')}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div style={{ border: '1px solid #f3f4f6', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, color: '#666' }}>选择 DLQ 队列</div>
                <select
                  value={selectedDlq}
                  onChange={(e) => {
                    const q = e.target.value;
                    setSelectedDlq(q);
                    void loadDlqJobs(q);
                  }}
                  style={{ width: '100%', marginTop: 6, padding: '6px 8px', borderRadius: 8, border: '1px solid #e5e7eb' }}
                  disabled={loading}
                >
                  {dlqQueues.map((q) => (
                    <option key={safeString(q?.name)} value={safeString(q?.name)}>
                      {safeString(q?.name)} (count={formatOptionalNumber(q?.count)})
                    </option>
                  ))}
                </select>

                <p style={{ marginTop: 8, marginBottom: 0, color: '#666', fontSize: 12 }}>
                  说明：DLQ 默认不注册 worker，因此 job 会保留用于排障。点击“重试”会把 payload 重新 enqueue 回原队列，并删除当前 DLQ job。
                </p>
              </div>

              <div style={{ border: '1px solid #f3f4f6', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, color: '#666' }}>当前队列</div>
                <div style={{ marginTop: 6, fontWeight: 700 }}>{safeString(selectedQueueMeta?.name || selectedDlq)}</div>
                <div style={{ marginTop: 6, color: '#374151' }}>count: {formatOptionalNumber(selectedQueueMeta?.count)}</div>
                <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
                  newest: {formatOptionalIso(selectedQueueMeta?.newest)}<br />
                  oldest: {formatOptionalIso(selectedQueueMeta?.oldest)}
                </div>
                <button type="button" disabled={loading || !selectedDlq} onClick={() => loadDlqJobs(selectedDlq)} style={{ ...buttonStyle, marginTop: 10 }}>
                  {loading ? '加载中…' : '加载 job 列表'}
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1060 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>id</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>queue</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>created_on</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>state</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>data</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>error</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dlqJobs.map((job) => (
                    <tr key={safeString(job?.id)}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
                        {safeString(job?.id)}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(job?.queue)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{formatOptionalIso(job?.created_on)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(job?.state)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                        <div style={{ fontSize: 12, color: '#374151' }}>
                          {job?.data_summary && typeof job.data_summary === 'object'
                            ? Object.entries(job.data_summary).map(([k, v]) => (
                              <div key={k}>
                                <span style={{ fontWeight: 600 }}>{safeString(k)}:</span> {truncate(v, 120)}
                              </div>
                            ))
                            : '-'}
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', color: '#991b1b' }}>
                        {truncate(job?.error_message || '', 220)}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                        <button type="button" disabled={loading} onClick={() => retryDlqJob(job)} style={{ ...buttonStyle, marginRight: 8 }}>
                          重试
                        </button>
                        <button type="button" disabled={loading} onClick={() => deleteDlqJob(job)} style={{ ...buttonStyle, borderColor: '#fecaca', color: '#991b1b' }}>
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

