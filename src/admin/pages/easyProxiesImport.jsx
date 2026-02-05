import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';
import { pageRootStyle } from './uiKit';

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

export default function EasyProxiesImportPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formInitialized, setFormInitialized] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(30 * 60_000);
  const [proxyUriText, setProxyUriText] = useState('');
  const [importEnabled, setImportEnabled] = useState(true);
  const [importConflictPolicy, setImportConflictPolicy] = useState('skip_non_source');

  async function refresh() {
    setError(null);
    try {
      setLoading(true);
      const res = await api.getPage({ pageName: 'easyProxiesImport' });
      setData(res?.data || null);
    } catch (err) {
      setData(null);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runAction(actionName, fields) {
    if (loading) return;
    setNotice(null);

    try {
      setLoading(true);
      const form = new FormData();
      Object.entries(fields || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        form.append(k, String(v));
      });

      const res = await api.resourceAction({
        resourceId: 'ProxyEndpoint',
        actionName,
        method: 'post',
        data: form,
      });

      const n = res?.data?.notice;
      if (n?.message) {
        setNotice({ type: n.type || 'success', message: String(n.message) });
      } else {
        setNotice({ type: 'success', message: 'OK' });
      }

      await refresh();
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || String(err) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (formInitialized) return;
    const cfg = data?.config || null;
    if (!cfg || typeof cfg !== 'object') return;

    const cfgBaseUrl = safeString(cfg.base_url || '');
    if (cfgBaseUrl) setBaseUrl(cfgBaseUrl);

    if (cfg.auto_refresh_enabled !== undefined) setAutoRefreshEnabled(Boolean(cfg.auto_refresh_enabled));

    const interval = Number(cfg.refresh_interval_ms);
    if (Number.isFinite(interval) && interval > 0) setRefreshIntervalMs(interval);

    setFormInitialized(true);
  }, [data, formInitialized]);

  const config = data?.config || null;
  const env = data?.env || null;
  const autoRefresh = data?.auto_refresh || null;
  const proxies = data?.proxies || null;

  const lastResult = useMemo(() => {
    const r = autoRefresh?.last_result || null;
    if (!r || typeof r !== 'object') return null;
    return r;
  }, [autoRefresh]);

  const buttonStyle = {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#111827',
    cursor: loading ? 'not-allowed' : 'pointer',
  };

  return (
    <div style={pageRootStyle}>
      <h2 style={{ marginTop: 0 }}>easy_proxies 导入/刷新</h2>
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
        <h3 style={{ marginTop: 0 }}>当前配置（只显示脱敏摘要）</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>source</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(config?.source || '')}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>base_url</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(config?.base_url || '')}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>password_configured</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{config?.password_configured ? 'true' : 'false'}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>auto_refresh_enabled</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{config?.auto_refresh_enabled ? 'true' : 'false'}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', fontWeight: 600 }}>refresh_interval_ms</td>
              <td style={{ padding: '4px 8px' }}>{formatOptionalNumber(config?.refresh_interval_ms)}</td>
            </tr>
          </tbody>
        </table>

        <p style={{ marginTop: 8, marginBottom: 0, color: '#666' }}>
          Env fallback: base_url={safeString(env?.base_url || '')} password_configured={env?.password_configured ? 'true' : 'false'}
        </p>
      </div>

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>配置编辑</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#666' }}>easy_proxies Base URL（例如 http://127.0.0.1:8080）</div>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid #e5e7eb' }}
              disabled={loading}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#666' }}>管理密码（只用于 /api/auth，页面不回显）</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={config?.password_configured ? '****** (已配置；留空表示不修改)' : '留空表示无密码'}
              style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid #e5e7eb' }}
              disabled={loading || clearPassword}
            />
            <label style={{ display: 'block', marginTop: 8, color: '#374151' }}>
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(e) => setClearPassword(Boolean(e.target.checked))}
                disabled={loading}
                style={{ marginRight: 6 }}
              />
              清除已保存的密码
            </label>
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#666' }}>自动刷新</div>
            <label style={{ display: 'block', marginTop: 10, color: '#374151' }}>
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(e) => setAutoRefreshEnabled(Boolean(e.target.checked))}
                disabled={loading}
                style={{ marginRight: 6 }}
              />
              启用定时刷新（服务进程内 best-effort）
            </label>
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>refresh_interval_ms（最小 60000）</div>
            <input
              type="number"
              value={safeString(refreshIntervalMs)}
              onChange={(e) => setRefreshIntervalMs(Number(e.target.value))}
              style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid #e5e7eb' }}
              disabled={loading}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#666' }}>导入策略</div>
            <p style={{ marginTop: 6, marginBottom: 0, color: '#374151' }}>
              默认只新增/更新 source=easy_proxies 的端点；不会覆盖手动代理端点（保证可回滚）。
            </p>
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={loading}
            onClick={() => runAction('easyProxiesConfigSave', {
              base_url: baseUrl,
              password: clearPassword ? undefined : (password || undefined),
              clear_password: clearPassword ? '1' : undefined,
              auto_refresh_enabled: autoRefreshEnabled ? '1' : '0',
              refresh_interval_ms: refreshIntervalMs,
            })}
            style={buttonStyle}
          >
            保存配置
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => runAction('easyProxiesImport', {})}
            style={buttonStyle}
          >
            立即导入/刷新
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => runAction('easyProxiesRollback', {})}
            style={{ ...buttonStyle, border: '1px solid #fecaca', color: '#991b1b' }}
          >
            回滚到手动代理列表
          </button>

          <button type="button" disabled={loading} onClick={() => refresh()} style={buttonStyle}>
            {loading ? '刷新中…' : '刷新页面'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>URI 一键导入（单行/多行）</h3>
        <p style={{ marginTop: 0, color: '#666' }}>
          支持直接粘贴代理 URI（每行一条），保存后立即可用于代理池，不需要重启服务。
          支持格式：
          {' '}
          <code>http://user:pass@host:port</code>
          {' '}
          /
          {' '}
          <code>socks5://user:pass@host:port</code>
          。
          如果密码包含 <code>@</code>，可直接写入（最后一个 <code>@</code> 作为分隔）或用 <code>%40</code> 编码。
        </p>

        <textarea
          value={proxyUriText}
          onChange={(e) => setProxyUriText(e.target.value)}
          placeholder={'http://user:pass@127.0.0.1:18080\nsocks5://127.0.0.1:19090'}
          spellCheck="false"
          disabled={loading}
          style={{
            width: '100%',
            minHeight: 160,
            marginTop: 6,
            padding: 10,
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
            fontSize: 12,
            lineHeight: 1.5,
            resize: 'vertical',
          }}
        />

        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <label style={{ color: '#374151', fontSize: 13 }}>
            冲突策略
            <select
              value={importConflictPolicy}
              onChange={(e) => setImportConflictPolicy(e.target.value)}
              disabled={loading}
              style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid #e5e7eb' }}
            >
              <option value="skip_non_source">skip_non_source（推荐）</option>
              <option value="overwrite">overwrite</option>
              <option value="skip_non_manual">skip_non_manual</option>
              <option value="skip_non_easy_proxies">skip_non_easy_proxies</option>
            </select>
          </label>

          <label style={{ marginTop: 22, color: '#374151' }}>
            <input
              type="checkbox"
              checked={importEnabled}
              onChange={(e) => setImportEnabled(Boolean(e.target.checked))}
              disabled={loading}
              style={{ marginRight: 6 }}
            />
            导入后默认启用代理
          </label>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={loading}
            onClick={() => runAction('importProxyUris', {
              proxy_uris: proxyUriText,
              source: 'manual',
              enabled: importEnabled ? '1' : '0',
              conflict_policy: importConflictPolicy,
            })}
            style={buttonStyle}
          >
            导入 URI（立即生效）
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setProxyUriText('')}
            style={buttonStyle}
          >
            清空输入
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>自动刷新状态</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>running</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{autoRefresh?.running ? 'true' : 'false'}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>poll_interval_ms</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatOptionalNumber(autoRefresh?.poll_interval_ms)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>last_run_at</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatOptionalIso(autoRefresh?.last_run_at)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', fontWeight: 600 }}>last_result</td>
              <td style={{ padding: '4px 8px' }}>
                {lastResult ? (
                  <span>
                    ok={lastResult.ok ? 'true' : 'false'} status={safeString(lastResult.status || '')} imported={safeString(lastResult.imported || '')} invalid={safeString(lastResult.invalid || '')} conflicts={safeString(lastResult.conflicts || '')} error={safeString(lastResult.error || '')}
                  </span>
                ) : (
                  <span style={{ color: '#666' }}>-</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>代理端点统计</h3>
        {!proxies || typeof proxies !== 'object' ? (
          <p style={{ marginTop: 0, color: '#666' }}>未获取到统计数据（需要 DATABASE_URL）。</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>total</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(proxies.total)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>enabled_total</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(proxies.enabled_total)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>easy_total</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(proxies.easy_total)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', fontWeight: 600 }}>easy_enabled</td>
                <td style={{ padding: '4px 8px' }}>{safeString(proxies.easy_enabled)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
