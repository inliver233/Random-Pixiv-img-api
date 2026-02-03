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

    return () => { mounted = false; };
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
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.images.broken}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>broken_ratio</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatPercent(data.images.broken_ratio)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Top errors (Image.last_error_code)</h3>
          {data.top_errors.length === 0 ? (
            <p style={{ color: '#666' }}>No error codes recorded.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>code</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>count</th>
                </tr>
              </thead>
              <tbody>
                {data.top_errors.map((row) => (
                  <tr key={row.code}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{row.code}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
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
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.imports.last_at || 'N/A'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Metrics (in-process)</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            Data source: prom-client Registry. Key app metrics will appear after related issues are implemented.
          </p>
          <p style={{ marginTop: 0 }}>
            enabled: <b>{String(data.metrics.enabled)}</b> · metrics_count: <b>{data.metrics.metric_names.length}</b>
          </p>
          <p style={{ marginTop: 0 }}>
            prometheus_query: <b>{data.prometheus?.configured ? (data.prometheus.ok ? 'OK' : 'ERROR') : 'N/A'}</b>
            {data.prometheus?.configured && data.prometheus?.fetched_at ? (
              <span style={{ color: '#666' }}> · fetched_at: {data.prometheus.fetched_at}</span>
            ) : null}
          </p>
          {data.prometheus?.configured && !data.prometheus?.ok && data.prometheus?.error ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>prometheus_error: {String(data.prometheus.error)}</p>
          ) : null}
          <details>
            <summary>metric names</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{data.metrics.metric_names.join('\n')}</pre>
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
