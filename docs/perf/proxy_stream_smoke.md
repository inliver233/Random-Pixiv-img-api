# Image proxy stream perf smoke

Goal: verify image streaming stays **O(1)** memory vs file size (no buffering entire image in-process), and establish a repeatable bandwidth/memory sanity check.

This checks the stable proxy route (`/i/:id.:ext`) which must remain stream-based.

## Prereqs
- Server running locally.
- At least one **large** image available in DB (larger file size makes regressions obvious).

## Run (PowerShell)
1) Pick a stable image URL (from `/random?format=json&redirect=1` or AdminJS Image list):

```text
http://127.0.0.1:3000/i/<image_id>.jpg
```

2) Record baseline RSS:

```powershell
$pid = (Get-Process node | Sort-Object StartTime | Select-Object -Last 1).Id
(Get-Process -Id $pid).WorkingSet64
```

3) Download the image to `NUL` (repeat a few times):

```powershell
curl.exe -L "http://127.0.0.1:3000/i/<image_id>.jpg" -o NUL
curl.exe -L "http://127.0.0.1:3000/i/<image_id>.jpg" -o NUL
curl.exe -L "http://127.0.0.1:3000/i/<image_id>.jpg" -o NUL
```

4) Record RSS again:

```powershell
(Get-Process -Id $pid).WorkingSet64
```

## Suggested baseline / thresholds (guide)
- RSS should not scale with image size (expect small fluctuations only; investigate sustained growth > ~50MB after several large downloads).
- No increase in response latency across repeated downloads from the same stable URL.

## Notes
- If you see growth, verify the response is piped/streamed end-to-end (no `arrayBuffer()`/`buffer()` usage on the proxy path).
- Run the same test with multiple clients to sanity-check concurrency.

