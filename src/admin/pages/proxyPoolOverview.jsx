import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';
import {
  createButtonStyle,
  createCalloutStyle,
  createCardStyle,
  pageRootStyle,
  pageTitleStyle,
} from './uiKit';

const api = new ApiClient();

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatOptionalNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (digits > 0) return n.toFixed(digits);
  return String(Math.round(n));
}

function formatOptionalIso(iso) {
  if (!iso) return '';
  const s = safeString(iso);
  return s.length > 19 ? s.replace('T', ' ').slice(0, 19) : s;
}

function formatRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${(n * 100).toFixed(1)}%`;
}

export default function ProxyPoolOverviewPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function refresh() {
    setError(null);
    try {
      setLoading(true);
      const res = await api.getPage({ pageName: 'proxyPoolOverview' });
      setData(res?.data || null);
    } catch (err) {
      setData(null);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const outboundErrors = Array.isArray(data?.outbound_errors_total?.values)
    ? data.outbound_errors_total.values
    : [];

  const health = data?.health || null;

  const entries = useMemo(() => {
    if (!health?.ok) return [];
    return Array.isArray(health.entries) ? health.entries : [];
  }, [health]);

  const recentFailures = useMemo(() => {
    if (!health?.ok) return [];
    return Array.isArray(health.recent_failures) ? health.recent_failures : [];
  }, [health]);

  return (
    <div style={pageRootStyle}>
      <h2 style={pageTitleStyle}>代理池概览与可观测性</h2>
      <p style={{ marginTop: 0, color: '#666' }}>生成时间：{safeString(data?.generated_at || '')}</p>

      {error ? (
        <div style={createCalloutStyle('danger')}>
          <b>加载失败：</b>{safeString(error)}
        </div>
      ) : null}

      <div style={{ marginTop: 12, ...createCardStyle() }}>
        <h3 style={{ marginTop: 0 }}>概览</h3>
        <p style={{ marginTop: 0, color: '#666' }}>{safeString(data?.note || '')}</p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>enabled_proxies</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(data?.proxies?.enabled_total)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', fontWeight: 600 }}>health_ok</td>
              <td style={{ padding: '4px 8px' }}>{health?.ok ? 'true' : 'false'}</td>
            </tr>
          </tbody>
        </table>
        <button
          type="button"
          disabled={loading}
          onClick={() => refresh()}
          style={{ marginTop: 8, ...createButtonStyle({ tone: 'ghost', disabled: loading }) }}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
        <h3 style={{ marginTop: 0 }}>健康检查</h3>
        {!health ? (
          <p style={{ marginTop: 0, color: '#666' }}>未获取到健康检查数据。</p>
        ) : health.ok ? (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>checked_at</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatOptionalIso(health.checked_at)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>probe_url</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(health.probe_url)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>pool_total</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                    {safeString(health.pool_total)} (healthy={safeString(health.pool_healthy)} / ok={safeString(health.pool_ok)})
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>counts</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                    healthy={safeString(health.counts?.healthy)} warning={safeString(health.counts?.warning)} error={safeString(health.counts?.error)} unknown={safeString(health.counts?.unknown)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>success_rate</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatRatio(health.totals?.success_rate)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>latency_ms</td>
                  <td style={{ padding: '4px 8px' }}>
                    min={formatOptionalNumber(health.latency_ms?.min)} p50={formatOptionalNumber(health.latency_ms?.p50)} p90={formatOptionalNumber(health.latency_ms?.p90)} p95={formatOptionalNumber(health.latency_ms?.p95)} max={formatOptionalNumber(health.latency_ms?.max)}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ marginTop: 0, color: '#666' }}>health_unavailable: {safeString(health.reason || 'unknown')}</p>
        )}
      </div>

      <div style={{ marginTop: 12, ...createCardStyle() }}>
        <h3 style={{ marginTop: 0 }}>出站错误指标（outbound_errors_total）</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>错误类型</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>累计值</th>
              </tr>
            </thead>
            <tbody>
              {outboundErrors.map((row) => (
                <tr key={safeString(row.type)}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(row.type)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatOptionalNumber(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
        <h3 style={{ marginTop: 0 }}>最近失败原因</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>proxy</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>status</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>latency_ms</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>success_rate</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>checked_at</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>error</th>
              </tr>
            </thead>
            <tbody>
              {recentFailures.map((row) => (
                <tr key={safeString(row.id)}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(row.display || row.id)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(row.status)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatOptionalNumber(row.lastLatencyMs)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatRatio(row.successRate)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{formatOptionalIso(row.lastCheckedAt)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(row.lastError)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 12, ...createCardStyle() }}>
        <h3 style={{ marginTop: 0 }}>节点明细</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>proxy</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>status</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>last_ok</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>latency_ms</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>success_rate</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #eee' }}>score</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>error</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={safeString(row.id)}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(row.display || row.id)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(row.status)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{row.lastOk === null ? '' : String(Boolean(row.lastOk))}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatOptionalNumber(row.lastLatencyMs)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatRatio(row.successRate)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{formatOptionalNumber(row.score, 3)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(row.lastError)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
