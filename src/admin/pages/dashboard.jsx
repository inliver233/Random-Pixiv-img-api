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

function formatDurationMs(ms) {
  if (!Number.isFinite(ms)) return String(ms);
  if (ms <= 0) return '0s';

  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${seconds}s`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h${remMinutes}m`;
}

function clampText(value, maxLen) {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
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
  const [proxyToggleBusy, setProxyToggleBusy] = useState(false);
  const [proxyToggleNotice, setProxyToggleNotice] = useState(null);

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
      图片: images
        ? `${images.total} 总计（${images.active} 正常，${images.disabled} 禁用，${images.broken} 失效，失效率 ${formatPercent(images.broken_ratio)}）`
        : '无',
      内存: proc ? `${formatBytes(proc.rss_bytes)} RSS，${formatBytes(proc.heap_used_bytes)} 堆已用` : '无',
      运行时间: proc ? `${Math.round(proc.uptime_s)} 秒` : '无',
    };
  }, [data]);

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <h2>仪表盘</h2>
        <p style={{ color: '#b91c1c' }}>仪表盘加载失败：{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 16 }}>
        <h2>仪表盘</h2>
        <p>加载中…</p>
      </div>
    );
  }

  const runtimeConfig = data?.runtime_config || null;
  const proxyEnabled = runtimeConfig?.ok ? Boolean(runtimeConfig?.proxy_enabled) : null;

  async function handleProxyToggle(nextEnabled) {
    if (proxyToggleBusy) return;

    if (nextEnabled === false) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm('确认关闭代理？关闭后将使用直连出站（真实 IP 可能暴露），仅建议临时排障/回退。');
      if (!ok) return;
    }

    setProxyToggleNotice(null);

    try {
      setProxyToggleBusy(true);
      const form = new FormData();
      form.append('enabled', nextEnabled ? 'true' : 'false');

      const res = await api.resourceAction({
        resourceId: 'ProxyEndpoint',
        actionName: 'setProxyEnabled',
        method: 'post',
        data: form,
      });

      const notice = res?.data?.notice;
      if (notice?.message) {
        setProxyToggleNotice({ type: notice.type || 'success', message: String(notice.message) });
      } else {
        setProxyToggleNotice({ type: 'success', message: nextEnabled ? '已启用代理' : '已关闭代理（直连）' });
      }

      const refreshed = await api.getDashboard();
      setData(refreshed.data || null);
    } catch (err) {
      setProxyToggleNotice({ type: 'error', message: err?.message || String(err) });
    } finally {
      setProxyToggleBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>仪表盘</h2>
      <p style={{ marginTop: 0, color: '#666' }}>生成时间：{data.generated_at}</p>

      <div style={{
        border: proxyEnabled === false ? '1px solid #fecaca' : '1px solid #e5e7eb',
        background: proxyEnabled === false ? '#fef2f2' : '#fff',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
      }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>代理出站（回退开关）</h3>
        {!runtimeConfig?.ok ? (
          <p style={{ marginTop: 0, color: '#b91c1c' }}>runtime_config_error: {String(runtimeConfig?.error || 'unknown')}</p>
        ) : (
          <>
            <p style={{ marginTop: 0, color: proxyEnabled === false ? '#b91c1c' : '#111827' }}>
              状态：<b>{proxyEnabled === false ? '已关闭（直连）' : '已启用（优先走代理）'}</b>{' '}
              <span style={{ color: '#666' }}>
                （source:{String(runtimeConfig.source || 'unknown')} / version:{String(runtimeConfig.version ?? 'null')}）
              </span>
            </p>
            {proxyEnabled === false ? (
              <p style={{ marginTop: 0, color: '#b91c1c' }}>
                风险提示：当前出站请求将使用直连（真实 IP 可能暴露）。仅建议临时排障；恢复后请及时重新启用代理。
              </p>
            ) : (
              <p style={{ marginTop: 0, color: '#666' }}>
                关闭代理会回退到直连模式（用于临时排障）。若已启用 fail-closed，关闭代理仍会放行直连（避免锁死）。
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={proxyToggleBusy || proxyEnabled === true}
                onClick={() => handleProxyToggle(true)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #111827',
                  background: proxyEnabled === true ? '#e5e7eb' : '#111827',
                  color: proxyEnabled === true ? '#111827' : '#fff',
                  cursor: proxyToggleBusy || proxyEnabled === true ? 'not-allowed' : 'pointer',
                }}
              >
                启用代理
              </button>
              <button
                type="button"
                disabled={proxyToggleBusy || proxyEnabled === false}
                onClick={() => handleProxyToggle(false)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #b91c1c',
                  background: proxyEnabled === false ? '#fecaca' : '#fff',
                  color: '#b91c1c',
                  cursor: proxyToggleBusy || proxyEnabled === false ? 'not-allowed' : 'pointer',
                }}
              >
                关闭代理（直连）
              </button>
            </div>

            {proxyToggleNotice?.message ? (
              <p style={{ marginTop: 8, color: proxyToggleNotice.type === 'error' ? '#b91c1c' : '#166534' }}>
                {String(proxyToggleNotice.message)}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>概览</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{renderKeyValueRows(summary)}</tbody>
          </table>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>进程</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>运行时间</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{Math.round(data.process.uptime_s)}s</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>队列</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                  {data.queue?.ok ? 'ok' : 'error'}{data.queue?.message ? ` (${String(data.queue.message)})` : ''}
                </td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>RSS</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatBytes(data.process.rss_bytes)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>堆已用</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatBytes(data.process.heap_used_bytes)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>堆总量</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatBytes(data.process.heap_total_bytes)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>图片</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>总计</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.images.total}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>正常</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.images.active}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>禁用</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.images.disabled}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>失效</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                  {data.images.broken} ({formatPercent(data.images.broken_ratio)})
                </td>
              </tr>
            </tbody>
          </table>

          <h4 style={{ marginBottom: 8, marginTop: 16 }}>常见错误（DB）</h4>
          {(data.images.top_errors || []).length === 0 ? (
            <p style={{ marginTop: 0, color: '#666' }}>暂无数据。</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>错误码</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>次数</th>
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
          <h3 style={{ marginTop: 0 }}>导入</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>总次数</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.imports.total}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>近 24 小时</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{data.imports.last_24h}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>最近一次</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{String(data.imports.last_at || '无')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>请求统计</h3>
          {!data.traffic?.ok ? (
            <p style={{ marginTop: 0, color: '#666' }}>无</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>HTTP 总请求</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.total}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>HTTP 2xx</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.status_2xx}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>HTTP 4xx</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.status_4xx}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>HTTP 5xx</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.http.status_5xx}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>HTTP 成功率</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.traffic.http.success_ratio) ? formatPercent(data.traffic.http.success_ratio) : '无'}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>随机接口总请求</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{data.traffic.random.total}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>随机接口成功率</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.traffic.random.success_ratio) ? formatPercent(data.traffic.random.success_ratio) : '无'}
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
          <h3 style={{ marginTop: 0 }}>easy_proxies</h3>
          {!data.easy_proxies?.configured ? (
            <p style={{ marginTop: 0, color: '#666' }}>未配置 EASY_PROXIES_BASE_URL</p>
          ) : data.easy_proxies?.error ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>easy_proxies_error: {String(data.easy_proxies.error)}</p>
          ) : (
            <>
              <p style={{ marginTop: 0, color: '#666' }}>
                可用节点：<b>{String(data.easy_proxies.available_nodes)}</b> / {String(data.easy_proxies.total_nodes)}
              </p>
              <details>
                <summary>节点（按延迟排序）</summary>
                {(data.easy_proxies.nodes || []).length === 0 ? (
                  <p style={{ marginTop: 0, color: '#666' }}>暂无数据。</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>Tag</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>Region</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.easy_proxies.nodes.slice(0, 15).map((node) => (
                        <tr key={node.tag}>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{String(node.tag)}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{String(node.region || 'other')}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                            {Number.isFinite(node.last_latency_ms) ? `${Math.round(node.last_latency_ms)} ms` : '无'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
              <details style={{ marginTop: 8 }}>
                <summary>区域统计</summary>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data.easy_proxies.region_stats || {}, null, 2)}</pre>
              </details>
            </>
          )}
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Pixiv Tokens（运行时）</h3>
          {!data.pixiv_tokens?.ok ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>pixiv_tokens_error: {String(data.pixiv_tokens?.error || 'unknown')}</p>
          ) : (data.pixiv_tokens.tokens || []).length === 0 ? (
            <p style={{ marginTop: 0, color: '#666' }}>无</p>
          ) : (
            <>
              <p style={{ marginTop: 0, color: '#666' }}>
                来源：<b>{String(data.pixiv_tokens.source || 'unknown')}</b>；可用：<b>{String((data.pixiv_tokens.tokens || []).length)}</b>
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>Token</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>Fail</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>Backoff</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>Last Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pixiv_tokens.tokens.slice(0, 20).map((t) => (
                    <tr key={String(t.token_id)}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{String(t.token_id)}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{String(t.refresh_fail_count || 0)}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                        {t.backoff_until ? formatDurationMs(Number(t.backoff_remaining_ms || 0)) : '无'}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                        {!t.last_error ? (
                          <span style={{ color: '#666' }}>无</span>
                        ) : (
                          <span>
                            {t.last_error.status ? `HTTP ${t.last_error.status} ` : ''}
                            {clampText(t.last_error.message || t.last_error.code || 'error', 72)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ marginTop: 8, color: '#666' }}>
                refresh_fail_count/backoff 仅表示“refresh_token 刷新”失败；不会展示 refresh_token 明文。
              </p>
            </>
          )}
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>指标</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            启用：<b>{String(Boolean(data.metrics?.enabled))}</b>
          </p>
          <details>
            <summary>指标名称</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{(data.metrics?.metric_names || []).join('\n')}</pre>
          </details>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Prometheus（24 小时）</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            数据来源：Prometheus HTTP API（可选）。配置 PROMETHEUS_URL 后启用。
          </p>
          <p style={{ marginTop: 0 }}>
            24 小时请求数：{' '}
            <b>
              {data.prometheus?.configured
                ? (Number.isFinite(data.prometheus?.requests_24h?.value) ? String(Math.round(data.prometheus.requests_24h.value)) : '无')
                : '无'}
            </b>
          </p>
          {data.prometheus?.configured && data.prometheus?.requests_24h?.error ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>prometheus_error: {String(data.prometheus.requests_24h.error)}</p>
          ) : null}

          <h4 style={{ marginBottom: 8 }}>近 24 小时错误排行（HTTP 状态码）</h4>
          {!data.prometheus?.configured ? (
            <p style={{ marginTop: 0, color: '#666' }}>无</p>
          ) : data.prometheus?.top_errors_24h?.error ? (
            <p style={{ marginTop: 0, color: '#b91c1c' }}>prometheus_error: {String(data.prometheus.top_errors_24h.error)}</p>
          ) : (data.prometheus?.top_errors_24h?.rows || []).length === 0 ? (
            <p style={{ marginTop: 0, color: '#666' }}>暂无数据。</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eee' }}>状态码</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #eee' }}>次数</th>
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

          <h4 style={{ marginBottom: 8, marginTop: 16 }}>延迟（p50 / p90 / p95）</h4>
          {!data.prometheus?.configured ? (
            <p style={{ marginTop: 0, color: '#666' }}>无</p>
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
                      : '无'}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>p90</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.prometheus?.latency_p50_p90_p95?.p90_s)
                      ? `${Math.round(data.prometheus.latency_p50_p90_p95.p90_s * 1000)} ms`
                      : '无'}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>p95</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {Number.isFinite(data.prometheus?.latency_p50_p90_p95?.p95_s)
                      ? `${Math.round(data.prometheus.latency_p50_p90_p95.p95_s * 1000)} ms`
                      : '无'}
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
