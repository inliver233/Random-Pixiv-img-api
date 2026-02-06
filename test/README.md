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

Expected status:

- `200` when Admin is ready
- `503` when Admin is not fully ready (for example DB or bundle startup delay)
