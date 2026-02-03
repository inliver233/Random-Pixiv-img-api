import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from 'adminjs';

const api = new ApiClient();

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

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function chunkByApproxBytes(lines, maxBytes) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = [];
  let currentBytes = 0;

  // Keep some headroom for multipart overhead.
  const budget = Math.max(1, Math.floor(maxBytes * 0.85));

  for (const line of lines) {
    const bytes = encoder.encode(`${line}\n`).length;

    if (current.length > 0 && currentBytes + bytes > budget) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(line);
    currentBytes += bytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
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
    const deduped = clientDedupe ? dedupeLines(lines) : lines;
    const removed = lines.length - deduped.length;
    const approxBytes = new TextEncoder().encode(`${deduped.join('\n')}\n`).length;
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

    const fileEl = fileInputRef.current;
    const file = fileEl?.files?.[0] || null;

    try {
      setLoading(true);

      // File upload path (recommended for very large inputs)
      if (file) {
        const formData = new FormData();
        formData.set('file', file);
        if (mode === 'preview') formData.set('preview', '1');
        const data = await postImport({ baseUrl, formData });
        setResult({ batches: 1, combined: data, responses: [data] });
        return;
      }

      const rawLines = parseLines(text);
      const lines = clientDedupe ? dedupeLines(rawLines) : rawLines;
      if (lines.length === 0) {
        setError('请输入至少一行 URL（每行一个）。');
        return;
      }

      // If no maxBytes known, just send as a single batch.
      const shouldChunk = chunking && maxBytes > 0 && stats.approx_bytes > maxBytes;
      const chunks = shouldChunk ? chunkByApproxBytes(lines, maxBytes) : [lines];

      const responses = [];
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        setProgress({ current: i + 1, total: chunks.length, lines: chunk.length });

        const formData = new FormData();
        formData.set('urls', chunk.join('\n'));
        if (mode === 'preview') formData.set('preview', '1');

        // eslint-disable-next-line no-await-in-loop
        const data = await postImport({ baseUrl, formData });
        responses.push(data);
      }

      const combined = responses.reduce((acc, cur) => {
        const next = { ...acc };
        next.total_lines += Number(cur.total_lines || 0);
        next.unique_images += Number(cur.unique_images || 0);
        next.deduped += Number(cur.deduped || 0);
        next.success += Number(cur.success || 0);
        next.failed += Number(cur.failed || 0);
        next.enqueued_hydrate_metadata += Number(cur.enqueued?.hydrate_metadata || 0);

        const errors = Array.isArray(cur.errors) ? cur.errors : [];
        next.errors = next.errors.concat(errors);
        return next;
      }, {
        total_lines: 0,
        unique_images: 0,
        deduped: 0,
        success: 0,
        failed: 0,
        enqueued_hydrate_metadata: 0,
        errors: [],
      });

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
              前端去重
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={chunking} onChange={(e) => setChunking(e.target.checked)} />
              超限自动分批
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
              正在提交第 {progress.current}/{progress.total} 批（{progress.lines} 行）…
            </p>
          ) : null}
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>上传文件</h3>
          <p style={{ marginTop: 0, color: '#666' }}>
            大量（例如 10w 行）建议用文件上传，更稳。
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
              <h4 style={{ marginTop: 0 }}>错误（{result.combined.errors.length}）</h4>
              <button
                type="button"
                onClick={() => downloadText('import-errors.txt', (result.combined.errors || []).map((e) => e.url).join('\n'))}
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
