import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';
import {
  createButtonStyle,
  createCalloutStyle,
  createCardStyle,
  createInputStyle,
  createTextareaStyle,
  pageRootStyle,
  pageTitleStyle,
} from './uiKit';

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

function parseUriEntries(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line, idx) => ({
      line: idx + 1,
      uri: String(line || '').trim(),
    }))
    .filter((entry) => entry.uri && !entry.uri.startsWith('#'));
}

function normalizeImportSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const totalLines = Number(raw.total_lines);
  const imported = Number(raw.imported);
  const invalid = Number(raw.invalid);
  const conflicts = Number(raw.conflicts);
  const errorsRaw = Array.isArray(raw.errors) ? raw.errors : [];

  return {
    total_lines: Number.isFinite(totalLines) ? totalLines : 0,
    imported: Number.isFinite(imported) ? imported : 0,
    invalid: Number.isFinite(invalid) ? invalid : 0,
    conflicts: Number.isFinite(conflicts) ? conflicts : 0,
    errors: errorsRaw
      .map((item) => ({
        line: Number(item?.line),
        error: safeString(item?.error || '解析失败'),
      }))
      .filter((item) => Number.isFinite(item.line) && item.line > 0),
  };
}

export default function EasyProxiesImportPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [importSummary, setImportSummary] = useState(null);

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

      if (actionName === 'importProxyUris') {
        const summary = normalizeImportSummary(
          res?.data?.import_summary || res?.data?.meta?.import_summary || null,
        );
        setImportSummary(summary);
      }

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

  const uriEntries = useMemo(() => parseUriEntries(proxyUriText), [proxyUriText]);
  const uniqueUriCount = useMemo(() => new Set(uriEntries.map((entry) => entry.uri)).size, [uriEntries]);
  const duplicateUriCount = Math.max(0, uriEntries.length - uniqueUriCount);

  const buttonStyle = createButtonStyle({ disabled: loading });

  function submitProxyUriImport() {
    if (uriEntries.length === 0) {
      setNotice({ type: 'error', message: '请输入至少 1 条代理 URI（支持多行）。' });
      return;
    }

    if (importConflictPolicy === 'overwrite') {
      const confirmed = globalThis.confirm
        ? globalThis.confirm('overwrite 会覆盖同 host+port+username 的现有条目，是否继续？')
        : true;
      if (!confirmed) return;
    }

    setImportSummary(null);
    void runAction('importProxyUris', {
      proxy_uris: uriEntries.map((entry) => entry.uri).join('\n'),
      source: 'manual',
      enabled: importEnabled ? '1' : '0',
      conflict_policy: importConflictPolicy,
    });
  }

  return (
    <div style={pageRootStyle}>
      <h2 style={pageTitleStyle}>easy_proxies 导入与即时生效</h2>
      <p style={{ marginTop: 0, color: '#666' }}>生成时间：{safeString(data?.generated_at || '')}</p>

      {error ? (
        <div style={createCalloutStyle('danger')}>
          <b>加载失败：</b>{safeString(error)}
        </div>
      ) : null}

      {notice?.message ? (
        <div
          style={{
            marginTop: 12,
            ...(notice.type === 'error' ? createCalloutStyle('danger') : createCalloutStyle('success')),
          }}
        >
          {safeString(notice.message)}
        </div>
      ) : null}

      <div style={{ marginTop: 12, ...createCardStyle() }}>
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

      <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
        <h3 style={{ marginTop: 0 }}>配置编辑</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#666' }}>easy_proxies Base URL（例如 http://127.0.0.1:8080）</div>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              style={createInputStyle({ disabled: loading })}
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
              style={createInputStyle({ disabled: loading || clearPassword })}
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
              style={createInputStyle({ disabled: loading })}
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
              refresh_interval_ms: Math.max(60_000, Number(refreshIntervalMs) || 0),
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
            onClick={() => {
              const confirmed = globalThis.confirm
                ? globalThis.confirm('回滚会禁用 source=easy_proxies 的代理，并关闭自动刷新。是否继续？')
                : true;
              if (!confirmed) return;
              void runAction('easyProxiesRollback', {});
            }}
            style={createButtonStyle({ danger: true, disabled: loading })}
          >
            回滚到手动代理列表
          </button>

          <button type="button" disabled={loading} onClick={() => refresh()} style={createButtonStyle({ tone: 'ghost', disabled: loading })}>
            {loading ? '刷新中…' : '刷新页面'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, ...createCardStyle() }}>
        <h3 style={{ marginTop: 0 }}>URI 一键导入（单行/多行）</h3>
        <p style={{ marginTop: 0, color: '#666' }}>
          支持直接粘贴代理 URI（每行一条），点击一次即导入并立即生效，无需重启服务。
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

        <div style={createCalloutStyle('info')}>
          操作建议：先粘贴 URI，再选择冲突策略，然后点「导入 URI（立即生效）」。
          可使用 <b>Ctrl/Command + Enter</b> 快速提交。
        </div>

        <textarea
          value={proxyUriText}
          onChange={(e) => setProxyUriText(e.target.value)}
          onKeyDown={(e) => {
            const enterPressed = e.key === 'Enter';
            const quickSubmit = e.ctrlKey || e.metaKey;
            if (!enterPressed || !quickSubmit || loading) return;
            e.preventDefault();
            submitProxyUriImport();
          }}
          placeholder={'http://user:pass@127.0.0.1:18080\nsocks5://127.0.0.1:19090'}
          spellCheck="false"
          disabled={loading}
          style={createTextareaStyle({ disabled: loading, minHeight: 160 })}
        />

        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <label style={{ color: '#374151', fontSize: 13 }}>
            冲突策略
            <select
              value={importConflictPolicy}
              onChange={(e) => setImportConflictPolicy(e.target.value)}
              disabled={loading}
              style={createInputStyle({ disabled: loading })}
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
            onClick={submitProxyUriImport}
            style={createButtonStyle({ primary: true, disabled: loading })}
          >
            导入 URI（立即生效）
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setProxyUriText('')}
            style={createButtonStyle({ tone: 'ghost', disabled: loading })}
          >
            清空输入
          </button>
        </div>
        <p style={{ marginTop: 8, marginBottom: 0, color: '#666', fontSize: 12 }}>
          当前有效行数：{uriEntries.length}，去重后：{uniqueUriCount}，重复行：{duplicateUriCount}。
          建议优先使用 <code>skip_non_source</code>，避免误覆盖手工维护的代理条目。
        </p>

        {importSummary ? (
          <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
            <h4 style={{ marginTop: 0, marginBottom: 8 }}>最近一次导入结果</h4>
            <p style={{ marginTop: 0, marginBottom: 8, color: '#374151' }}>
              共解析 {importSummary.total_lines} 行，导入成功 {importSummary.imported} 行，冲突跳过 {importSummary.conflicts} 行，无效 {importSummary.invalid} 行。
            </p>
            {importSummary.invalid > 0 ? (
              <div style={createCalloutStyle('warning')}>
                无效 URI 会按行号提示，请先修复后再重新导入。
              </div>
            ) : (
              <div style={createCalloutStyle('success')}>
                所有 URI 都已通过校验并落库。
              </div>
            )}
            {importSummary.errors.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>错误定位（最多展示前 {importSummary.errors.length} 条）</div>
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {importSummary.errors.map((item) => (
                    <li key={`${item.line}-${item.error}`} style={{ marginBottom: 4 }}>
                      第 {item.line} 行：{item.error}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
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

      <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
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
