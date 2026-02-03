import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';

const api = new ApiClient();

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return String(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return String(value);
  return `${(value * 100).toFixed(1)}%`;
}

function renderKeyValueRows(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return Object.entries(obj).map(([key, value]) => (
    <tr key={key}>
      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>{key}</td>
      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{String(value)}</td>
    </tr>
  ));
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    api.getDashboard()
      .then((res) => {
        if (!mounted) return;
        setData(res.data || null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err?.message || String(err));
      });

    return () => {
      mounted = false;
    };
  }, []);

  const summary = useMemo(() => {
    const images = data?.images || null;
    const proc = data?.process || null;
    return {
      images: images
        ? `${images.total} total (${images.active} active, ${images.disabled} disabled, ${images.broken} broken, ${formatPercent(images.broken_ratio)})`
        : 'N/A',
      memory: proc ? `${formatBytes(proc.rss_bytes)} RSS, ${formatBytes(proc.heap_used_bytes)} heap` : 'N/A',
      uptime: proc ? `${Math.round(proc.uptime_s)}s` : 'N/A',
    };
  }, [data]);

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Dashboard</h2>
        <p style={{ color: '#b91c1c' }}>Failed to load dashboard: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Dashboard</h2>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <p style={{ marginTop: 0, color: '#666' }}>generated_at: {data.generated_at}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Summary</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{renderKeyValueRows(summary)}</tbody>
          </table>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Process</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>uptime</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{Math.round(data.process.uptime_s)}s</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>rss</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatBytes(data.process.rss_bytes)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>heap_used</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatBytes(data.process.heap_used_bytes)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>heap_total</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatBytes(data.process.heap_total_bytes)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Images</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>total</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.images.total}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>active</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.images.active}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>disabled</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.images.disabled}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>broken</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                  {data.images.broken} ({formatPercent(data.images.broken_ratio)})
                </td>
              </tr>
            </tbody>
          </table>

          <h4 style={{ marginBottom: 8, marginTop: 16 }}>top_errors (db)</h4>
          {(data.images.top_errors || []).length === 0 ? (
            <p style={{ marginTop: 0, color: '#666' }}>No data.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>code</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>count</th>
                </tr>
              </thead>
              <tbody>
                {data.images.top_errors.map((row) => (
                  <tr key={row.code}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{row.code}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Imports</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>total</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.imports.total}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>last_24h</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.imports.last_24h}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>last_at</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{String(data.imports.last_at || 'N/A')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Traffic</h3>
          {!data.traffic?.ok ? (
            <p style={{ marginTop: 0, color: '#666' }}>N/A</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>http_total</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.total}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>http_2xx</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.status_2xx}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>http_4xx</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.status_4xx}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>http_5xx</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.status_5xx}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>http_success_ratio</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.traffic.http.success_ratio) ? formatPercent(data.traffic.http.success_ratio) : 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>random_total</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.random.total}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>random_success_ratio</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.traffic.random.success_ratio) ? formatPercent(data.traffic.random.success_ratio) : 'N/A'}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p style={{ marginTop: 8, color: '#666' }}>
            success_ratio 仅基于累计计数；更准确的“近 5 分钟成功率”建议用 Prometheus 的 rate/increase。
          </p>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Metrics</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            enabled: <b>{String(Boolean(data.metrics?.enabled))}</b>
          </p>
          <details>
            <summary>metric names</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{(data.metrics?.metric_names || []).join('\n')}</pre>
          </details>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Prometheus (24h)</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            Data source: Prometheus HTTP API (optional). Configure PROMETHEUS_URL to enable.
          </p>
          <p style={{ marginTop: 0 }}>
            requests_24h:{' '}
            <b>
              {data.prometheus?.configured
                ? (Number.isFinite(data.prometheus?.requests_24h?.value) ? String(Math.round(data.prometheus.requests_24h.value)) : 'N/A')
                : 'N/A'}
            </b>
          </p>
          {data.prometheus?.configured && data.prometheus?.requests_24h?.error ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>prometheus_error: {String(data.prometheus.requests_24h.error)}</p>
          ) : null}

          <h4 style={{ marginBottom: 8 }}>top_errors_24h (HTTP status)</h4>
          {!data.prometheus?.configured ? (
            <p style={{ marginTop: 0, color: '#666' }}>N/A</p>
          ) : data.prometheus?.top_errors_24h?.error ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>prometheus_error: {String(data.prometheus.top_errors_24h.error)}</p>
          ) : (data.prometheus?.top_errors_24h?.rows || []).length === 0 ? (
            <p style={{ marginTop: 0, color: '#666' }}>No data.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>status</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>count</th>
                </tr>
              </thead>
              <tbody>
                {data.prometheus.top_errors_24h.rows.map((row) => (
                  <tr key={row.status}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{row.status}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4 style={{ marginBottom: 8, marginTop: 16 }}>latency_p50_p90_p95</h4>
          {!data.prometheus?.configured ? (
            <p style={{ marginTop: 0, color: '#666' }}>N/A</p>
          ) : data.prometheus?.latency_p50_p90_p95?.error ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>prometheus_error: {String(data.prometheus.latency_p50_p90_p95.error)}</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>p50</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.prometheus?.latency_p50_p90_p95?.p50_s)
                      ? `${Math.round(data.prometheus.latency_p50_p90_p95.p50_s * 1000)} ms`
                      : 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>p90</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.prometheus?.latency_p50_p90_p95?.p90_s)
                      ? `${Math.round(data.prometheus.latency_p50_p90_p95.p90_s * 1000)} ms`
                      : 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>p95</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.prometheus?.latency_p50_p90_p95?.p95_s)
                      ? `${Math.round(data.prometheus.latency_p50_p90_p95.p95_s * 1000)} ms`
                      : 'N/A'}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
