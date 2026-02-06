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

function formatOptionalIso(iso) {
  if (!iso) return '';
  const s = String(iso);
  return s.length > 19 ? s.replace('T', ' ').slice(0, 19) : s;
}

function safeString(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return s;
}

function buildTokenLabel(token) {
  const label = token?.label ? String(token.label) : '';
  if (label) return `${label} (#${safeString(token.id)})`;
  return `#${safeString(token?.id)}`;
}

function formatMode(mode) {
  const normalized = safeString(mode).toLowerCase();
  if (normalized === 'override') return '临时覆盖';
  if (normalized === 'primary') return '主代理';
  return normalized || '-';
}

export default function TokenProxyBindingsPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [selectedTokenId, setSelectedTokenId] = useState('');
  const [rebindProxyId, setRebindProxyId] = useState('');
  const [clearOverride, setClearOverride] = useState(true);

  const [overrideProxyId, setOverrideProxyId] = useState('');
  const [overrideTtlMinutes, setOverrideTtlMinutes] = useState(60);
  const [reason, setReason] = useState('');

  async function refresh() {
    setError(null);
    try {
      setLoading(true);
      const res = await api.getPage({ pageName: 'tokenProxyBindings' });
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
        resourceId: 'TokenProxyBinding',
        actionName,
        method: 'post',
        data: form,
      });

      const n = res?.data?.notice;
      if (n?.message) {
        setNotice({ type: n.type || 'success', message: String(n.message) });
      } else {
        setNotice({ type: 'success', message: '操作完成。' });
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

  const tokens = Array.isArray(data?.tokens) ? data.tokens : [];
  const proxies = Array.isArray(data?.proxies) ? data.proxies : [];
  const bindings = Array.isArray(data?.bindings) ? data.bindings : [];

  const tokenById = useMemo(() => {
    const out = new Map();
    for (const t of tokens) out.set(String(t.id), t);
    return out;
  }, [tokens]);

  const proxyDisplayById = useMemo(() => {
    const out = new Map();
    for (const p of proxies) out.set(String(p.id), String(p.display || p.id));
    return out;
  }, [proxies]);

  const bindingByTokenId = useMemo(() => {
    const out = new Map();
    for (const b of bindings) out.set(String(b.tokenId), b);
    return out;
  }, [bindings]);

  useEffect(() => {
    if (!selectedTokenId && tokens.length > 0) {
      setSelectedTokenId(String(tokens[0].id));
    }
  }, [selectedTokenId, tokens]);

  useEffect(() => {
    if (!selectedTokenId) return;
    const b = bindingByTokenId.get(String(selectedTokenId));
    if (b?.primaryProxyId) setRebindProxyId(String(b.primaryProxyId));
    else if (b?.suggestedPrimaryProxyId) setRebindProxyId(String(b.suggestedPrimaryProxyId));
    if (b?.overrideProxyId) setOverrideProxyId(String(b.overrideProxyId));
  }, [selectedTokenId, bindingByTokenId]);

  const summary = data?.summary || {};
  const pool = data?.pool || null;

  return (
    <div style={pageRootStyle}>
      <h2 style={pageTitleStyle}>令牌与代理绑定</h2>
      <p style={{ marginTop: 0, color: '#666' }}>
        生成时间：{safeString(data?.generated_at || '')}
      </p>

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
        <h3 style={{ marginTop: 0 }}>概览</h3>
        <p style={{ marginTop: 0, color: '#666' }}>
          代理池：{pool ? `${safeString(pool.name)} (#${safeString(pool.id)})` : '未初始化（首次操作会自动创建 default 代理池）'}
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>令牌总数</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(summary.tokens_total)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>代理总数</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(summary.proxies_total)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>绑定总数</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{safeString(summary.bindings_total)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', fontWeight: 600 }}>缺失绑定数</td>
              <td style={{ padding: '4px 8px' }}>{safeString(summary.missing_bindings)}</td>
            </tr>
          </tbody>
        </table>
        {data?.note ? (
          <p style={{ marginTop: 8, marginBottom: 0, color: '#666' }}>{safeString(data.note)}</p>
        ) : null}
      </div>

      <div style={{ marginTop: 12, ...createCardStyle({ alt: true }) }}>
        <h3 style={{ marginTop: 0 }}>绑定列表</h3>
        {loading && !data ? (
          <p style={{ marginTop: 0, color: '#666' }}>加载中…</p>
        ) : null}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>令牌</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>主代理</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>当前生效</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>临时覆盖到期</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>建议代理</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => {
                const token = tokenById.get(String(b.tokenId));
                const primaryDisplay = b.primaryProxyId ? proxyDisplayById.get(String(b.primaryProxyId)) || String(b.primaryProxyId) : '-';
                const effectiveDisplay = b.effectiveProxyId ? proxyDisplayById.get(String(b.effectiveProxyId)) || String(b.effectiveProxyId) : '-';
                const suggestedDisplay = b.suggestedPrimaryProxyId ? proxyDisplayById.get(String(b.suggestedPrimaryProxyId)) || String(b.suggestedPrimaryProxyId) : '';
                const mode = b.effectiveMode ? String(b.effectiveMode) : '';

                return (
                  <tr key={String(b.tokenId)}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ fontWeight: 600 }}>{buildTokenLabel(token)}</div>
                      {token?.refreshTokenMasked ? (
                        <div style={{ color: '#666', fontSize: 12 }}>刷新凭据：{safeString(token.refreshTokenMasked)}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(primaryDisplay)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ fontWeight: mode === 'override' ? 700 : 400, color: mode === 'override' ? '#b45309' : '#111827' }}>
                        {safeString(effectiveDisplay)}
                      </span>
                      {mode ? <span style={{ color: '#666' }}> ({formatMode(mode)})</span> : null}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{formatOptionalIso(b.overrideExpiresAt)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{safeString(suggestedDisplay)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 12, ...createCardStyle() }}>
        <h3 style={{ marginTop: 0 }}>操作</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div style={createCardStyle({ alt: true })}>
            <h4 style={{ marginTop: 0 }}>选择令牌</h4>
            <select
              value={selectedTokenId}
              onChange={(e) => setSelectedTokenId(e.target.value)}
              style={createInputStyle()}
            >
              {tokens.map((t) => (
                <option key={String(t.id)} value={String(t.id)}>
                  {buildTokenLabel(t)}
                </option>
              ))}
            </select>
            <p style={{ marginTop: 8, marginBottom: 0, color: '#666', fontSize: 12 }}>
              所有操作影响范围：仅当前 token（affected=1），不会触发全量重算，避免大规模抖动。
            </p>
          </div>

          <div style={createCardStyle({ alt: true })}>
            <h4 style={{ marginTop: 0 }}>重绑主代理</h4>
            <select
              value={rebindProxyId}
              onChange={(e) => setRebindProxyId(e.target.value)}
              style={createInputStyle()}
            >
              <option value="">(请选择代理)</option>
              {proxies.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {safeString(p.display)}
                </option>
              ))}
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, color: '#374151' }}>
              <input type="checkbox" checked={clearOverride} onChange={(e) => setClearOverride(e.target.checked)} />
              同时清空临时覆盖
            </label>

            <button
              type="button"
              disabled={!selectedTokenId || !rebindProxyId || loading}
              onClick={() => {
                const confirmed = globalThis.confirm
                  ? globalThis.confirm('将重绑当前令牌的主代理。是否继续？')
                  : true;
                if (!confirmed) return;
                void runAction('rebindPrimary', {
                  tokenId: selectedTokenId,
                  primaryProxyId: rebindProxyId,
                  clearOverride: clearOverride ? 'true' : 'false',
                  reason,
                });
              }}
              style={{ marginTop: 8, ...createButtonStyle({ primary: true, disabled: !selectedTokenId || !rebindProxyId || loading }) }}
            >
              执行重绑
            </button>
          </div>

          <div style={createCardStyle({ alt: true })}>
            <h4 style={{ marginTop: 0 }}>设置临时覆盖</h4>
            <select
              value={overrideProxyId}
              onChange={(e) => setOverrideProxyId(e.target.value)}
              style={createInputStyle()}
            >
              <option value="">(请选择代理)</option>
              {proxies.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {safeString(p.display)}
                </option>
              ))}
            </select>

            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'block', color: '#374151', marginBottom: 4 }}>TTL（分钟）</label>
              <input
                type="number"
                min={1}
                max={10080}
                value={overrideTtlMinutes}
                onChange={(e) => setOverrideTtlMinutes(Number(e.target.value))}
                style={createInputStyle()}
              />
            </div>

            <button
              type="button"
              disabled={!selectedTokenId || !overrideProxyId || loading}
              onClick={() => {
                const ttlMinutes = Math.max(1, Math.min(10080, Number(overrideTtlMinutes) || 60));
                const confirmed = globalThis.confirm
                  ? globalThis.confirm(`将设置临时 override（TTL ${ttlMinutes} 分钟）。是否继续？`)
                  : true;
                if (!confirmed) return;
                void runAction('setOverride', { tokenId: selectedTokenId, overrideProxyId, ttlMinutes, reason });
              }}
              style={{ marginTop: 8, ...createButtonStyle({ disabled: !selectedTokenId || !overrideProxyId || loading }) }}
            >
              设置临时覆盖
            </button>

            <button
              type="button"
              disabled={!selectedTokenId || loading}
              onClick={() => {
                const confirmed = globalThis.confirm
                  ? globalThis.confirm('将清空当前令牌的 override 并恢复主代理。是否继续？')
                  : true;
                if (!confirmed) return;
                void runAction('clearOverride', { tokenId: selectedTokenId, reason });
              }}
              style={{ marginTop: 8, marginLeft: 8, ...createButtonStyle({ tone: 'ghost', disabled: !selectedTokenId || loading }) }}
            >
              清空临时覆盖
            </button>
          </div>

          <div style={createCardStyle({ alt: true })}>
            <h4 style={{ marginTop: 0 }}>审计原因（可选）</h4>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：代理不稳定 / 手工排障 / 临时切换"
              style={createTextareaStyle({ minHeight: 96 })}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => refresh()}
              style={{ marginTop: 8, ...createButtonStyle({ tone: 'ghost', disabled: loading }) }}
            >
              刷新
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
