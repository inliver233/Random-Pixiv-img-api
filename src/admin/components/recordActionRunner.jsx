import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, useNotice } from 'adminjs';

const api = new ApiClient();

function safeText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

export default function RecordActionRunner(props) {
  const { action, resource, record, records } = props;
  const sendNotice = useNotice();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const autoRunOnceRef = useRef(false);

  const meta = useMemo(() => {
    const actionName = action?.name || '';
    const actionLabel = action?.label || actionName || 'Action';
    const resourceId = resource?.id || '';
    const recordId = record?.id || '';
    const bulkIds = Array.isArray(records) ? records.map((r) => r?.id).filter(Boolean) : [];
    const actionType = action?.actionType || (record ? 'record' : bulkIds.length ? 'bulk' : 'resource');
    return { actionName, actionLabel, actionType, resourceId, recordId, bulkIds };
  }, [action, resource, record, records]);

  async function run() {
    if (busy) return;
    if (!meta.resourceId || !meta.actionName) {
      sendNotice({ type: 'error', message: 'Action metadata is missing.' });
      return;
    }

    const guard = action?.guard;
    if (guard && !window.confirm(safeText(guard))) return;

    try {
      setBusy(true);

      let res;
      if (meta.actionType === 'record') {
        if (!meta.recordId) throw new Error('recordId is missing.');
        const form = new FormData();
        res = await api.recordAction({
          resourceId: meta.resourceId,
          recordId: meta.recordId,
          actionName: meta.actionName,
          method: 'post',
          data: form,
        });
      } else if (meta.actionType === 'bulk') {
        const form = new FormData();
        res = await api.bulkAction({
          resourceId: meta.resourceId,
          recordIds: meta.bulkIds,
          actionName: meta.actionName,
          method: 'post',
          data: form,
        });
      } else {
        const form = new FormData();
        res = await api.resourceAction({
          resourceId: meta.resourceId,
          actionName: meta.actionName,
          method: 'post',
          data: form,
        });
      }

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

  useEffect(() => {
    if (autoRunOnceRef.current) return;
    autoRunOnceRef.current = true;
    if (action?.guard) void run();
  }, []);

  return (
    <div style={{ padding: 16, maxWidth: 780 }}>
      <h2 style={{ marginTop: 0, marginBottom: 6 }}>{meta.actionLabel}</h2>
      <p style={{ marginTop: 0, color: '#666' }}>
        resource: <b>{safeText(meta.resourceId) || 'unknown'}</b>
        {' '}
        {meta.recordId ? (
          <>
            record: <b>{safeText(meta.recordId)}</b>{' '}
          </>
        ) : null}
        action: <b>{safeText(meta.actionName)}</b>
      </p>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          style={{
            border: '1px solid #111827',
            background: busy ? '#9ca3af' : '#111827',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 10,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? '执行中…' : '执行'}
        </button>
        <span style={{ marginLeft: 10, color: '#666' }}>
          {action?.guard ? '（将弹出二次确认）' : null}
        </span>
      </div>

      {lastResult ? (
        <div style={{ marginTop: 14, padding: 12, border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <div style={{ fontWeight: 700 }}>{lastResult.ok ? '已执行' : '执行失败'}</div>
          <div style={{ marginTop: 6, color: '#666', fontSize: 13 }}>
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
    </div>
  );
}

