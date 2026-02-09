import { useMemo, useState } from 'react';
import { ApiClient, useNotice } from 'adminjs';

import {
  createButtonStyle,
  createCalloutStyle,
  createCardStyle,
  createInputStyle,
  createTextareaStyle,
} from '../pages/uiKit';

const api = new ApiClient();

function safeText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function toBoolString(value) {
  return value ? 'true' : 'false';
}

export default function ResourceActionForm(props) {
  const { action, resource } = props;
  const sendNotice = useNotice();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const meta = useMemo(() => {
    const actionName = action?.name || '';
    const actionLabel = action?.label || actionName || 'Action';
    const resourceId = resource?.id || '';
    return { actionName, actionLabel, resourceId };
  }, [action, resource]);

  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [proxyUrisText, setProxyUrisText] = useState('');
  const [proxyUrisSource, setProxyUrisSource] = useState('manual');
  const [proxyUrisEnabled, setProxyUrisEnabled] = useState(true);
  const [proxyUrisConflictPolicy, setProxyUrisConflictPolicy] = useState('skip_non_source');

  const [easyBaseUrl, setEasyBaseUrl] = useState('');
  const [easyPassword, setEasyPassword] = useState('');
  const [easyClearPassword, setEasyClearPassword] = useState(false);
  const [easyAutoRefreshEnabled, setEasyAutoRefreshEnabled] = useState(true);
  const [easyRefreshIntervalMs, setEasyRefreshIntervalMs] = useState(30 * 60_000);

  async function submit(fields) {
    if (busy) return;
    if (!meta.resourceId || !meta.actionName) {
      sendNotice({ type: 'error', message: 'Action metadata is missing.' });
      return;
    }

    const guard = action?.guard;
    if (guard && !window.confirm(safeText(guard))) return;

    try {
      setBusy(true);
      const form = new FormData();
      Object.entries(fields || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        form.append(k, safeText(v));
      });

      const res = await api.resourceAction({
        resourceId: meta.resourceId,
        actionName: meta.actionName,
        method: 'post',
        data: form,
      });

      const payload = res?.data || {};
      const notice = payload.notice;
      if (notice && (notice.message || notice.type)) {
        sendNotice({ type: notice.type || 'success', message: safeText(notice.message || 'OK') });
      } else {
        sendNotice({ type: 'success', message: 'OK' });
      }

      setLastResult({
        ok: true,
        at: new Date().toISOString(),
        redirectUrl: payload.redirectUrl || null,
      });

      if (payload.redirectUrl) {
        window.location.href = payload.redirectUrl;
      }
    } catch (err) {
      const message = err?.message || safeText(err);
      setLastResult({ ok: false, at: new Date().toISOString(), error: message });
      sendNotice({ type: 'error', message: message || 'Failed.' });
    } finally {
      setBusy(false);
    }
  }

  const smallBtn = (variant) => ({
    ...createButtonStyle({ disabled: busy, danger: variant === 'danger', primary: variant === 'primary' }),
    padding: '6px 10px',
    fontSize: 13,
  });

  const body = (() => {
    if (meta.actionName === 'setProxyEnabled') {
      return (
        <div style={createCardStyle({ alt: true })}>
          <h3 style={{ marginTop: 0 }}>代理总开关</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            用于紧急切换“强制走代理 / 直连回退”。关闭代理可能暴露真实 IP。
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#374151' }}>
              <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} disabled={busy} />
              enabled
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({ enabled: toBoolString(proxyEnabled) })}
              style={smallBtn(proxyEnabled ? 'primary' : 'danger')}
            >
              {proxyEnabled ? '启用代理' : '关闭代理'}
            </button>
          </div>
        </div>
      );
    }

    if (meta.actionName === 'importProxyUris') {
      return (
        <div style={createCardStyle({ alt: true })}>
          <h3 style={{ marginTop: 0 }}>URI 批量导入</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            每行一个代理 URI（支持含用户名/密码）。密码会保存到数据库，但不会在后台明文展示。
          </p>

          <label style={{ display: 'block', fontWeight: 600 }}>
            proxy_uris
            <textarea
              rows={10}
              value={proxyUrisText}
              onChange={(e) => setProxyUrisText(e.target.value)}
              disabled={busy}
              placeholder="例如：http://user:pass@host:port"
              style={createTextareaStyle({ disabled: busy, minHeight: 180 })}
            />
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <label style={{ minWidth: 240, fontWeight: 600 }}>
              source
              <input
                value={proxyUrisSource}
                onChange={(e) => setProxyUrisSource(e.target.value)}
                disabled={busy}
                style={createInputStyle({ disabled: busy })}
              />
            </label>

            <label style={{ minWidth: 280, fontWeight: 600 }}>
              conflict_policy
              <select
                value={proxyUrisConflictPolicy}
                onChange={(e) => setProxyUrisConflictPolicy(e.target.value)}
                disabled={busy}
                style={createInputStyle({ disabled: busy })}
              >
                <option value="skip_non_source">skip_non_source（默认）</option>
                <option value="skip_non_manual">skip_non_manual</option>
                <option value="skip_non_easy_proxies">skip_non_easy_proxies</option>
                <option value="overwrite">overwrite</option>
              </select>
            </label>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 26, color: '#374151' }}>
              <input
                type="checkbox"
                checked={proxyUrisEnabled}
                onChange={(e) => setProxyUrisEnabled(e.target.checked)}
                disabled={busy}
              />
              enabled
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({
                proxy_uris: proxyUrisText,
                source: proxyUrisSource,
                enabled: toBoolString(proxyUrisEnabled),
                conflict_policy: proxyUrisConflictPolicy,
              })}
              style={smallBtn('primary')}
            >
              导入
            </button>
          </div>
        </div>
      );
    }

    if (meta.actionName === 'easyProxiesConfigSave') {
      return (
        <div style={createCardStyle({ alt: true })}>
          <h3 style={{ marginTop: 0 }}>easy_proxies 配置保存</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            可仅更新 base_url；密码留空会保留原值。勾选清空密码将移除现有密码配置。
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 12 }}>
            <label style={{ fontWeight: 600 }}>
              base_url
              <input
                value={easyBaseUrl}
                onChange={(e) => setEasyBaseUrl(e.target.value)}
                disabled={busy}
                placeholder="https://example.com"
                style={createInputStyle({ disabled: busy })}
              />
            </label>

            <label style={{ fontWeight: 600 }}>
              refresh_interval_ms
              <input
                type="number"
                min={60_000}
                step={10_000}
                value={Number(easyRefreshIntervalMs) || 0}
                onChange={(e) => setEasyRefreshIntervalMs(Number(e.target.value))}
                disabled={busy}
                style={createInputStyle({ disabled: busy })}
              />
            </label>
          </div>

          <label style={{ display: 'block', fontWeight: 600, marginTop: 10 }}>
            password（留空保留原值）
            <input
              type="password"
              value={easyPassword}
              onChange={(e) => setEasyPassword(e.target.value)}
              disabled={busy}
              style={createInputStyle({ disabled: busy })}
            />
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#374151' }}>
              <input type="checkbox" checked={easyClearPassword} onChange={(e) => setEasyClearPassword(e.target.checked)} disabled={busy} />
              clear_password
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#374151' }}>
              <input type="checkbox" checked={easyAutoRefreshEnabled} onChange={(e) => setEasyAutoRefreshEnabled(e.target.checked)} disabled={busy} />
              auto_refresh_enabled
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({
                base_url: easyBaseUrl,
                password: easyPassword,
                clear_password: toBoolString(easyClearPassword),
                auto_refresh_enabled: toBoolString(easyAutoRefreshEnabled),
                refresh_interval_ms: String(Math.trunc(Number(easyRefreshIntervalMs) || 0)),
              })}
              style={smallBtn('primary')}
            >
              保存
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={createCalloutStyle('warning')}>
        未实现该 action 的表单组件：<b>{safeText(meta.actionName) || 'unknown'}</b>
      </div>
    );
  })();

  return (
    <div style={{ padding: 16, maxWidth: 920 }}>
      <h2 style={{ marginTop: 0, marginBottom: 6 }}>{safeText(meta.actionLabel)}</h2>
      <p style={{ marginTop: 0, color: '#666' }}>
        resource: <b>{safeText(meta.resourceId) || 'unknown'}</b> / action: <b>{safeText(meta.actionName)}</b>
      </p>

      {lastResult ? (
        <div style={{ marginTop: 12, ...(lastResult.ok ? createCalloutStyle('success') : createCalloutStyle('danger')) }}>
          <div style={{ fontWeight: 700 }}>{lastResult.ok ? '已提交' : '提交失败'}</div>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            at: {safeText(lastResult.at)}
            {lastResult.redirectUrl ? (
              <>
                {' '}
                / redirect: <a href={lastResult.redirectUrl}>{safeText(lastResult.redirectUrl)}</a>
              </>
            ) : null}
          </div>
          {!lastResult.ok && lastResult.error ? (
            <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', color: '#b91c1c' }}>{safeText(lastResult.error)}</pre>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        {body}
      </div>
    </div>
  );
}

