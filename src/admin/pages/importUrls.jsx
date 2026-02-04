import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from 'adminjs';

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

  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);

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
      const combined = {
        total_lines: 0,
        unique_images: 0,
        deduped: 0,
        success: 0,
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
        const data = await postImport({ baseUrl, formData });
        responses.push(data);

        combined.total_lines += Number(data.total_lines || 0);
        combined.unique_images += Number(data.unique_images || 0);
        combined.deduped += Number(data.deduped || 0);
        combined.success += Number(data.success || 0);
        combined.failed += Number(data.failed || 0);
        combined.enqueued_hydrate_metadata += Number(data.enqueued?.hydrate_metadata || 0);
        if (data.import_id) combined.import_ids.push(String(data.import_id));

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

      setResult({ batches: responses.length, combined, responses });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const maxBytesLabel = config?.adminImportMaxFileBytes
    ? `${Math.round(Number(config.adminImportMaxFileBytes) / (1024 * 1024))} MB`
    : 'unknown';

  return (
    <div style={{ padding: 16, maxWidth: 980 }}>
      <h2 style={{ marginTop: 0 }}>批量导入 URL</h2>
      <p style={{ marginTop: 0, color: '#666' }}>
        批量导入 Pixiv 原图（pximg）URL，一行一个。支持注释行（以 <code>#</code> 开头）。后端会做解析与去重（illustId + page）。
      </p>

      {error ? (
        <div style={{ padding: 12, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 10, color: '#991b1b' }}>
          <b>错误：</b> {error}
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>粘贴导入</h3>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="https://i.pximg.net/img-original/img/.../123456789_p0.jpg"
            spellCheck="false"
            style={{
              width: '100%',
              minHeight: 320,
              padding: 10,
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
              fontSize: 12,
              lineHeight: 1.5,
              resize: 'vertical',
            }}
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
                style={{ width: 96, padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: 8 }}
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
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #111827',
                background: '#111827',
                color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {preview ? '预览（不写入）' : '开始导入'}
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('preview')}
              disabled={loading}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #e5e7eb',
                background: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              预览（不写入）
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('import')}
              disabled={loading}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #e5e7eb',
                background: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              开始导入
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

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
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
        <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
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
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>unique_images</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.unique_images}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>deduped</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.deduped}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>success</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.success}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>failed</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.failed}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 600 }}>enqueued.hydrate_metadata</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{result.combined.enqueued_hydrate_metadata}</td>
              </tr>
            </tbody>
          </table>

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
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  cursor: 'pointer',
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
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  cursor: 'pointer',
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
