import { useEffect, useMemo, useRef, useState } from 'react';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLines(text) {
  const rawLines = String(text || '').split(/\r?\n/);
  const out = [];

  for (const raw of rawLines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    out.push(line);
  }

  return out;
}

function maybeParsePximgOriginalKey(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  if (!/pximg\.net/i.test(s)) return null;

  const m = /\/(\d+)_p(\d+)(?:_[^/?#]+)?\.(?:jpg|jpeg|png|gif|webp)(?:[?#].*)?$/i.exec(s);
  if (!m) return null;

  const illustId = m[1];
  const pageIndex = Number(m[2]);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;

  return `${illustId}:${pageIndex}`;
}

function buildClientDedupeKey(line) {
  const key = maybeParsePximgOriginalKey(line);
  if (key) return `pixiv:${key}`;
  return `raw:${line}`;
}

async function dedupeLinesAsync(lines, { enabled, onProgress } = {}) {
  if (!enabled) return lines;

  const seen = new Set();
  const chunks = [];
  const yieldEvery = 2000;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const key = buildClientDedupeKey(line);
    if (!seen.has(key)) {
      seen.add(key);
      chunks.push(line);
    }

    if (i > 0 && i % yieldEvery === 0) {
      if (onProgress) onProgress(i + 1);
      // Yield to keep the UI responsive for huge imports (10w~20w lines).
      // eslint-disable-next-line no-await-in-loop
      await sleep(0);
    }
  }

  if (onProgress) onProgress(lines.length);
  return chunks;
}

function chunkLines(lines, { maxLines, maxBytes } = {}) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;

  const effectiveMaxLines = Math.max(1, Number(maxLines) || 2000);
  const effectiveMaxBytes = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0 ? Number(maxBytes) : Infinity;
  // Keep some headroom for multipart overhead.
  const budgetBytes = effectiveMaxBytes === Infinity ? Infinity : Math.max(1, Math.floor(effectiveMaxBytes * 0.85));

  for (const line of lines) {
    const approxBytes = String(line || '').length + 1;
    const shouldFlushByLines = current.length >= effectiveMaxLines;
    const shouldFlushByBytes = current.length > 0 && (currentBytes + approxBytes > budgetBytes);

    if (shouldFlushByLines || shouldFlushByBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(line);
    currentBytes += approxBytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function sumApproxBytes(lines) {
  let total = 0;
  for (const line of lines) {
    total += String(line || '').length + 1;
  }
  return total;
}

async function postImport({ baseUrl, formData }) {
  const res = await fetch(`${baseUrl}/admin/images/import`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, status: res.status, body: text };
  }

  if (!res.ok) {
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    const err = new Error(message);
    err.data = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

async function postHydrate({ baseUrl, formData }) {
  const res = await fetch(`${baseUrl}/admin/images/hydrate`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, status: res.status, body: text };
  }

  if (!res.ok) {
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    const err = new Error(message);
    err.data = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

async function fetchImportProgress({ baseUrl, importId }) {
  const res = await fetch(`${baseUrl}/admin/imports/${encodeURIComponent(String(importId))}`, {
    method: 'GET',
    credentials: 'include',
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, status: res.status, body: text };
  }

  if (!res.ok) {
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    const err = new Error(message);
    err.data = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

async function postRollback({ baseUrl, importId, mode = 'disable' }) {
  const res = await fetch(`${baseUrl}/admin/imports/${encodeURIComponent(String(importId))}/rollback`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, status: res.status, body: text };
  }

  if (!res.ok) {
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    const err = new Error(message);
    err.data = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ImportUrlsPage() {
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [clientDedupe, setClientDedupe] = useState(true);
  const [chunking, setChunking] = useState(true);
  const [batchLines, setBatchLines] = useState(2000);
  const [batchInitialized, setBatchInitialized] = useState(false);

  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [progressByImportId, setProgressByImportId] = useState({});
  const [rollbackBusy, setRollbackBusy] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    api.getPage({ pageName: 'importUrls' })
      .then((res) => {
        if (!mounted) return;
        setConfig(res.data || null);
      })
      .catch((err) => {
        if (!mounted) return;
        setConfig(null);
        setError(err?.message || String(err));
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (batchInitialized) return;
    const maxLines = Number(config?.adminImportMaxLines || 0);
    if (Number.isFinite(maxLines) && maxLines > 0) {
      setBatchLines(Math.max(100, Math.min(2000, Math.trunc(maxLines))));
      setBatchInitialized(true);
    }
  }, [config, batchInitialized]);

  const stats = useMemo(() => {
    const lines = parseLines(text);
    const deduped = clientDedupe ? Array.from(new Set(lines)) : lines;
    const removed = lines.length - deduped.length;
    const approxBytes = sumApproxBytes(deduped);
    return {
      raw_lines: lines.length,
      after_dedupe_lines: deduped.length,
      deduped_removed: removed,
      approx_bytes: approxBytes,
    };
  }, [text, clientDedupe]);

  async function handleSubmit(mode) {
    setError(null);
    setResult(null);
    setProgress(null);
    setProgressByImportId({});

    const hydrateOnly = mode === 'hydrate';
    const postFn = hydrateOnly ? postHydrate : postImport;

    const baseUrl = config?.baseUrl || '';
    const maxBytes = Number(config?.adminImportMaxFileBytes || 0) || 0;
    const maxLines = Number(config?.adminImportMaxLines || 0) || 0;

    const fileEl = fileInputRef.current;
    const file = fileEl?.files?.[0] || null;

    try {
      setLoading(true);

      const inputText = file ? await file.text() : text;
      const rawLines = parseLines(inputText);
      if (rawLines.length === 0) {
        setError(file ? '文件为空或没有可解析的 URL（请确保一行一个）。' : '请输入至少一行 URL（每行一个），或选择文件导入。');
        return;
      }

      // Preview mode should be quick: only process the first batch.
      const normalizedBatchLines = Math.max(1, Math.min(10000, Number(batchLines) || 2000));
      const previewMaxLines = Math.max(50, Math.min(normalizedBatchLines, 2000));
      const inputLines = mode === 'preview' ? rawLines.slice(0, previewMaxLines) : rawLines;

      if (mode !== 'preview' && inputLines.length >= 5000) {
        const confirmed = globalThis.confirm
          ? globalThis.confirm(`本次将提交 ${inputLines.length} 行，可能需要较长时间。是否继续？`)
          : true;
        if (!confirmed) {
          setLoading(false);
          return;
        }
      }

      setProgress({
        stage: 'prepare',
        processed_lines: 0,
        total_lines: inputLines.length,
        message: '正在解析并去重…',
      });

      const lines = await dedupeLinesAsync(inputLines, {
        enabled: clientDedupe,
        onProgress: (processed) => setProgress({
          stage: 'prepare',
          processed_lines: processed,
          total_lines: inputLines.length,
          message: clientDedupe ? '正在解析并去重（illustId + pageIndex 优先）…' : '正在解析…',
        }),
      });

      // Always chunk by default: avoid long-running single requests (Cloudflare 524 / proxy 504).
      // Also respect backend upload limits when known.
      const effectiveMaxLines = maxLines > 0 ? Math.min(normalizedBatchLines, maxLines) : normalizedBatchLines;
      const shouldChunk = chunking && lines.length > effectiveMaxLines;
      const chunks = shouldChunk ? chunkLines(lines, { maxLines: effectiveMaxLines, maxBytes }) : [lines];

      // Preview only runs a single request for the first chunk.
      const plannedChunks = mode === 'preview' ? chunks.slice(0, 1) : chunks;

      const responses = [];
      const startedAt = Date.now();
      let processedLines = 0;
      const MAX_COMBINED_ERRORS = 2000;
      const combined = hydrateOnly
        ? {
          total_lines: 0,
          unique_illusts: 0,
          failed: 0,
          enqueued_hydrate_metadata: 0,
          errors: [],
          error_urls_text: '',
          error_urls_with_comments_text: '',
        }
        : {
          total_lines: 0,
          unique_images: 0,
          deduped: 0,
          accepted: 0,
          failed: 0,
          enqueued_hydrate_metadata: 0,
          errors: [],
          import_ids: [],
          error_urls_text: '',
          error_urls_with_comments_text: '',
        };

      for (let i = 0; i < plannedChunks.length; i += 1) {
        const chunk = plannedChunks[i];
        const elapsedMs = Date.now() - startedAt;
        const rate = processedLines > 0 && elapsedMs > 0 ? (processedLines / elapsedMs) : null; // lines per ms
        const remaining = lines.length - processedLines;
        const etaMs = rate ? Math.round(remaining / rate) : null;

        setProgress({
          stage: 'upload',
          current: i + 1,
          total: plannedChunks.length,
          batch_lines: chunk.length,
          processed_lines: processedLines,
          total_lines: lines.length,
          elapsed_ms: elapsedMs,
          eta_ms: etaMs,
          message: `正在提交第 ${i + 1}/${plannedChunks.length} 批…`,
        });

        const formData = new FormData();
        formData.set('urls', chunk.join('\n'));
        if (mode === 'preview') formData.set('preview', '1');

        // eslint-disable-next-line no-await-in-loop
        const data = await postFn({ baseUrl, formData });
        responses.push(data);

        combined.total_lines += Number(data.total_lines || 0);
        combined.failed += Number(data.failed || 0);
        combined.enqueued_hydrate_metadata += Number(data.enqueued?.hydrate_metadata || 0);

        if (hydrateOnly) {
          combined.unique_illusts += Number(data.unique_illusts || 0);
        } else {
          combined.unique_images += Number(data.unique_images || 0);
          combined.deduped += Number(data.deduped || 0);
          combined.accepted += Number(data.accepted || 0);
          if (data.import_id) combined.import_ids.push(String(data.import_id));
        }

        if (data.error_export?.urls_text) {
          combined.error_urls_text += `${combined.error_urls_text ? '\n' : ''}${String(data.error_export.urls_text)}`;
        }
        if (data.error_export?.urls_with_comments_text) {
          combined.error_urls_with_comments_text += `${combined.error_urls_with_comments_text ? '\n' : ''}${String(data.error_export.urls_with_comments_text)}`;
        }

        const errors = Array.isArray(data.errors) ? data.errors : [];
        if (combined.errors.length < MAX_COMBINED_ERRORS) {
          const remaining = MAX_COMBINED_ERRORS - combined.errors.length;
          combined.errors = combined.errors.concat(errors.slice(0, remaining));
        }

        processedLines += chunk.length;
      }

      setResult({ mode, batches: responses.length, combined, responses });
      if (!hydrateOnly && Array.isArray(combined.import_ids) && combined.import_ids.length > 0) {
        // Best-effort: auto refresh progress so users can see async processing state.
        void refreshAllImportProgress(combined.import_ids);
      }
    } catch (err) {
      const status = Number(err?.status || err?.data?.status || 0);
      const code = String(err?.data?.code || '');
      const message = String(err?.message || err);

      if (status === 413 || code === 'PAYLOAD_TOO_LARGE') {
        setError(`上传体积超过限制。请减小“每批行数”或改用更多批次（当前建议 <= ${batchLines}）。`);
      } else if (code === 'MAX_LINES_EXCEEDED') {
        setError(`单批行数超过后端限制。请降低“每批行数”，或开启分批提交后重试。`);
      } else if (code === 'INVALID_UPLOAD_TYPE') {
        setError('上传文件类型不支持。请使用 .txt / text/plain。');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  async function refreshAllImportProgress(importIds) {
    const ids = Array.isArray(importIds) ? importIds.map((v) => String(v)) : [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await refreshImportProgress(id);
      // eslint-disable-next-line no-await-in-loop
      await sleep(120);
    }
  }

  async function refreshImportProgress(importId) {
    const baseUrl = config?.baseUrl || '';
    try {
      const data = await fetchImportProgress({ baseUrl, importId });
      setProgressByImportId((prev) => ({ ...prev, [String(importId)]: data }));
    } catch (err) {
      setProgressByImportId((prev) => ({
        ...prev,
        [String(importId)]: {
          ok: false,
          error: err?.message || String(err),
          status: err?.status || err?.data?.status || null,
          code: err?.data?.code || null,
        },
      }));
    }
  }

  async function rollbackImport(importId) {
    const baseUrl = config?.baseUrl || '';
    const id = String(importId);

    const confirmed = globalThis.confirm
      ? globalThis.confirm(`确认回滚导入 #${id} 吗？\n\n将禁用“本次新增”的图片（不会删除导入记录）。`)
      : true;
    if (!confirmed) return;

    try {
      setRollbackBusy(true);
      await postRollback({ baseUrl, importId: id, mode: 'disable' });
      await refreshImportProgress(id);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRollbackBusy(false);
    }
  }

  const maxBytesLabel = config?.adminImportMaxFileBytes
    ? `${Math.round(Number(config.adminImportMaxFileBytes) / (1024 * 1024))} MB`
    : 'unknown';

  const importProgressAgg = useMemo(() => {
    if (!result || result.mode === 'hydrate') return null;
    const ids = Array.isArray(result.combined.import_ids) ? result.combined.import_ids.map((v) => String(v)) : [];
    if (ids.length === 0) return null;

    let processed = 0;
    let total = 0;
    let deduped = 0;
    let remaining = 0;
    let done = 0;
    let okFetched = 0;
    let failedFetched = 0;
    let queueNotOk = 0;
    let enqueuedHydrateMetadata = 0;
    const enqueueNotes = new Map();

    for (const id of ids) {
      const p = progressByImportId?.[id] || null;
      if (!p) continue;
      if (!p.ok) {
        failedFetched += 1;
        continue;
      }

      okFetched += 1;
      processed += Number(p.progress?.processed || 0);
      total += Number(p.progress?.total || 0);
      deduped += Number(p.progress?.deduped || 0);
      remaining += Number(p.progress?.remaining || 0);
      if (p.progress?.done) done += 1;
      if (p.queue && p.queue.ok === false) queueNotOk += 1;

      const enqueued = p.import?.detail?.enqueued;
      const n = Number(enqueued?.hydrate_metadata ?? 0);
      if (Number.isFinite(n)) enqueuedHydrateMetadata += Math.max(0, Math.trunc(n));

      const note = typeof enqueued?.note === 'string' ? enqueued.note.trim() : '';
      if (note) enqueueNotes.set(note, (enqueueNotes.get(note) || 0) + 1);
    }

    const enqueueNotesText = [...enqueueNotes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([note, count]) => `${note}×${count}`)
      .join(', ');

    return {
      import_count: ids.length,
      ok_fetched: okFetched,
      failed_fetched: failedFetched,
      processed,
      total,
      deduped,
      remaining,
      done,
      queue_not_ok: queueNotOk,
      enqueued_hydrate_metadata: enqueuedHydrateMetadata,
      enqueue_notes_text: enqueueNotesText,
    };
  }, [result, progressByImportId]);

  return (
    <div style={{ ...pageRootStyle, maxWidth: 980 }}>
      <h2 style={pageTitleStyle}>批量导入 URL</h2>
      <p style={{ marginTop: 0, color: '#666' }}>
        批量导入 Pixiv 原图（pximg）URL，一行一个。支持注释行（以 <code>#</code> 开头）。后端会做解析与去重（illustId + page）。
      </p>

      {error ? (
        <div style={createCalloutStyle('danger')}>
          <b>错误：</b> {error}
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
        <div style={createCardStyle()}>
          <h3 style={{ marginTop: 0 }}>粘贴导入</h3>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="https://i.pximg.net/img-original/img/.../123456789_p0.jpg"
            spellCheck="false"
            style={{
              ...createTextareaStyle({ disabled: loading, minHeight: 320 }),
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
              fontSize: 12,
            }}
            disabled={loading}
          />

          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={clientDedupe} onChange={(e) => setClientDedupe(e.target.checked)} />
              前端去重（illustId + pageIndex 优先）
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={chunking} onChange={(e) => setChunking(e.target.checked)} />
              分批提交（避免 524/504）
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              每批行数
              <input
                type="number"
                value={batchLines}
                onChange={(e) => setBatchLines(e.target.value ? Number(e.target.value) : 2000)}
                min={100}
                max={10000}
                step={100}
                style={{ ...createInputStyle({ disabled: loading }), width: 96, marginTop: 0, padding: '4px 6px' }}
                disabled={loading}
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
              默认预览（dry-run）
            </label>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => handleSubmit(preview ? 'preview' : 'import')}
              disabled={loading}
              style={createButtonStyle({ primary: true, disabled: loading })}
            >
              {preview ? '预览（不写入）' : '开始导入'}
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('preview')}
              disabled={loading}
              style={createButtonStyle({ disabled: loading })}
            >
              预览（不写入）
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('import')}
              disabled={loading}
              style={createButtonStyle({ disabled: loading })}
            >
              开始导入
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('hydrate')}
              disabled={loading}
              style={createButtonStyle({ disabled: loading })}
            >
              仅补全（入队 hydrate_metadata）
            </button>
            <button
              type="button"
              onClick={() => {
                setText('');
                setResult(null);
                setError(null);
                setProgress(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              disabled={loading}
              style={createButtonStyle({ tone: 'ghost', disabled: loading })}
            >
              清空输入
            </button>
          </div>

          {progress ? (
            <p style={{ marginTop: 10, color: '#666' }}>
              {progress.stage === 'prepare'
                ? `${progress.message || '正在处理…'} ${progress.processed_lines}/${progress.total_lines}`
                : `${progress.message || '正在提交…'}（${progress.current}/${progress.total}，${progress.batch_lines} 行/批，已处理 ${progress.processed_lines}/${progress.total_lines}`
                  + (Number.isFinite(progress.eta_ms) ? `，预计剩余 ${Math.ceil(progress.eta_ms / 1000)}s` : '')
                  + '）'}
            </p>
          ) : null}
        </div>

        <div style={createCardStyle({ alt: true })}>
          <h3 style={{ marginTop: 0 }}>上传文件</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            大量（例如 10w~20w 行）建议用文件：浏览器读取后分批提交到服务端，避免单请求超时（Cloudflare 524 / 反代 504）。
          </p>
          <input ref={fileInputRef} type="file" accept=".txt,text/plain" />

          <h3 style={{ marginTop: 16 }}>限制</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>单次最大上传</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{maxBytesLabel}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>原始行数</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{stats.raw_lines}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>去重后行数</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{stats.after_dedupe_lines}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>去重移除</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{stats.deduped_removed}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>估算大小</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{stats.approx_bytes.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {result ? (
        <div style={{ marginTop: 12, ...createCardStyle() }}>
          <h3 style={{ marginTop: 0 }}>结果</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            批次数：<b>{result.batches}</b>
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>total_lines</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.total_lines}</td>
              </tr>
              {result.mode === 'hydrate' ? (
                <tr>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>unique_illusts</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.unique_illusts}</td>
                </tr>
              ) : (
                <>
                  <tr>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>unique_images</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.unique_images}</td>
                  </tr>
                   <tr>
                     <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>deduped</td>
                     <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.deduped}</td>
                   </tr>
                   <tr>
                     <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>accepted（已接收/入队）</td>
                     <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.accepted}</td>
                   </tr>
                   <tr>
                     <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>progress（已处理/总计）</td>
                     <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                       {importProgressAgg
                         ? `${importProgressAgg.processed}/${importProgressAgg.total} (done ${importProgressAgg.done}/${importProgressAgg.import_count})`
                         : '（请看下方 import_id 进度）'}
                     </td>
                   </tr>
                 </>
               )}
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>failed</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.failed}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>enqueued.hydrate_metadata（以 Import 记录为准）</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                  {result.mode === 'hydrate'
                    ? result.combined.enqueued_hydrate_metadata
                    : importProgressAgg
                      ? `${importProgressAgg.enqueued_hydrate_metadata}${importProgressAgg.enqueue_notes_text ? ` (${importProgressAgg.enqueue_notes_text})` : ''}`
                      : '（后台异步写入 Import 记录；请在下方点击「刷新全部进度」）'}
                </td>
              </tr>
            </tbody>
          </table>

          {result.mode !== 'hydrate' && Array.isArray(result.combined.import_ids) && result.combined.import_ids.length > 0 ? (
            <div style={{ marginTop: 12 }}>
                <h4 style={{ marginTop: 0 }}>import_id（可审计 / 可回滚）</h4>
                <p style={{ marginTop: 0, color: '#666' }}>
                  导入写入已异步入队：本页 <code>accepted</code> 表示已接收/入队的唯一图片数；处理进度以 Import 记录的 <code>progress</code> 为准，可用「刷新进度」查看。回滚会<b>禁用</b>本次新增图片（不删除导入记录）。
                </p>

              <button
                type="button"
                disabled={loading || rollbackBusy}
                onClick={() => refreshAllImportProgress(result.combined.import_ids)}
                style={createButtonStyle({ disabled: loading || rollbackBusy })}
              >
                刷新全部进度
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.combined.import_ids.map((importId) => {
                  const id = String(importId);
                  const p = progressByImportId?.[id] || null;
                  return (
                    <div key={id} style={{ padding: '8px 10px', border: '1px solid #eee', borderRadius: 10, background: '#fafafa' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <code>#{id}</code>
                        <a href={`/admin/resources/Import/records/${encodeURIComponent(id)}/show`} target="_blank" rel="noreferrer">
                          打开记录
                        </a>
                        <button
                          type="button"
                          disabled={loading || rollbackBusy}
                          onClick={() => refreshImportProgress(id)}
                          style={createButtonStyle({ disabled: loading || rollbackBusy })}
                        >
                          刷新进度
                        </button>
                        <button
                          type="button"
                          disabled={loading || rollbackBusy}
                          onClick={() => rollbackImport(id)}
                          style={createButtonStyle({ tone: 'danger', disabled: loading || rollbackBusy })}
                        >
                          回滚（禁用）
                        </button>
                      </div>

                      {p ? (
                        p.ok ? (
                          <p style={{ margin: '6px 0 0', color: '#666' }}>
                            progress: {p.progress?.processed}/{p.progress?.total}
                            {Number.isFinite(p.progress?.deduped) ? ` (deduped ${p.progress?.deduped})` : ''}
                            {Number.isFinite(p.progress?.remaining) ? ` remaining ${p.progress?.remaining}` : ''}
                            {typeof p.progress?.done === 'boolean' ? ` done=${String(p.progress?.done)}` : ''}
                            {p.queue ? `; queue=${p.queue.ok ? 'ok' : 'not_ok'}` : ''}
                          </p>
                        ) : (
                          <p style={{ margin: '6px 0 0', color: '#b91c1c' }}>
                            progress fetch failed: {p.error || 'error'}
                          </p>
                        )
                      ) : null}

                      {p && p.ok && p.import?.detail?.enqueued ? (
                        <p style={{ margin: '6px 0 0', color: '#666' }}>
                          hydrate_metadata enqueued: {Number(p.import.detail.enqueued.hydrate_metadata || 0)}
                          {p.import.detail.enqueued.note ? `; note=${String(p.import.detail.enqueued.note)}` : ''}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {(result.combined.errors || []).length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ marginTop: 0 }}>
                错误（展示 {result.combined.errors.length} / 失败 {result.combined.failed}）
              </h4>
              <button
                type="button"
                onClick={() => downloadText(
                  'import-errors.txt',
                  result.combined.error_urls_text || (result.combined.errors || []).map((e) => e.url).join('\n'),
                )}
                style={{
                  ...createButtonStyle(),
                  marginBottom: 8,
                }}
              >
                下载错误 URL
              </button>
              <button
                type="button"
                onClick={() => downloadText(
                  'import-errors-with-comments.txt',
                  result.combined.error_urls_with_comments_text
                    || (result.combined.errors || []).map((e) => `# code=${e.code}\n${e.url}`).join('\n'),
                )}
                style={{
                  ...createButtonStyle(),
                  marginBottom: 8,
                  marginLeft: 8,
                }}
              >
                下载错误 URL（带注释）
              </button>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#fafafa', border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
                {JSON.stringify(result.combined.errors.slice(0, 50), null, 2)}
              </pre>
              {result.combined.errors.length > 50 ? <p style={{ color: '#666' }}>仅展示前 50 条。</p> : null}
            </div>
          ) : (
            <p style={{ marginTop: 12, color: '#065f46' }}><b>没有错误。</b></p>
          )}
        </div>
      ) : null}
    </div>
  );
}
