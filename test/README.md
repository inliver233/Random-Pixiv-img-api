# Test Scripts

## Admin UI Smoke

Use this script to verify critical Admin UI links and page-data endpoints after deployment.

```powershell
pwsh test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3000 -AdminToken <ADMIN_TOKEN>
```

Strict mode (recommended for CI/release gates):

```powershell
pwsh test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3000 -RequireAuthChecks -AdminToken <ADMIN_TOKEN>
```

Behavior:

- Always checks `/healthz`.
- If `-AdminToken` is empty, it only verifies `/admin` is protected and exits with degraded-success.
- If `-RequireAuthChecks` is set and `-AdminToken` is empty, the script fails fast.
- If `-AdminToken` is provided, it checks:
  - `/admin` and key page URLs
  - `/admin/api/pages/*` data endpoints
  - `/admin/resources/Import/new` route compatibility (`/new -> /actions/new`)
  - `/admin/api/pages/proxyPoolOverview` payload health section

Expected status:

- `200` when Admin is ready
- `503` when Admin is not fully ready (for example DB or bundle startup delay)

## Proxy/API Smoke

```powershell
pwsh test/proxy-smoke.ps1 -BaseUrl http://127.0.0.1:3000
```

It checks:

- `/healthz`, `/metrics`, `/random?format=json`, `/random?redirect=1`
- `/favicon.ico` noise regression (expect 200/204)
- filtered `NO_MATCH` degrade hints (`/random?format=json&orientation=portrait&r18=1`)
- legacy invalid page contract (`/136551599-0.jpg` must be `400 + application/json`)
