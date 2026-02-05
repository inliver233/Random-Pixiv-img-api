param(
  [string]$BaseUrl = 'http://127.0.0.1:3000',
  [string]$AdminToken = $env:ADMIN_TOKEN,
  [int]$TimeoutSec = 20
)

$ErrorActionPreference = 'Stop'

function Invoke-Endpoint {
  param(
    [string]$Path,
    [int[]]$AllowStatus,
    [hashtable]$Headers
  )

  $uri = "$BaseUrl$Path"
  try {
    $res = Invoke-WebRequest -Uri $uri -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck -Headers $Headers
  } catch {
    throw "backend_unreachable:$uri ($($_.Exception.Message))"
  }
  $status = [int]$res.StatusCode
  if (-not ($AllowStatus -contains $status)) {
    $allow = ($AllowStatus | ForEach-Object { [string]$_ }) -join ','
    throw "Unexpected status $status for $Path (allow: $allow)"
  }
  Write-Host "[admin-ui-smoke] $Path => $status"
  return $res
}

Write-Host "[admin-ui-smoke] base_url=$BaseUrl"

# Baseline availability.
Invoke-Endpoint -Path '/healthz' -AllowStatus @(200, 503) -Headers @{}

# When token is unavailable, verify admin surface is protected and exit as degraded-success.
if ([string]::IsNullOrWhiteSpace($AdminToken)) {
  Write-Host '[admin-ui-smoke] ADMIN_TOKEN is empty; only verifying admin endpoint is protected.'
  Invoke-Endpoint -Path '/admin' -AllowStatus @(401, 403, 302, 503) -Headers @{}
  Write-Host '[admin-ui-smoke] skipped authenticated admin page checks (set -AdminToken to enable).'
  exit 0
}

$authHeaders = @{
  'x-admin-token' = $AdminToken
}

# Core admin pages (200 when ready, 503 when admin bundle/db is not ready).
$pages = @(
  '/admin',
  '/admin/pages/opsNavigator',
  '/admin/pages/importUrls',
  '/admin/pages/easyProxiesImport',
  '/admin/pages/tokenProxyBindings',
  '/admin/pages/proxyPoolOverview',
  '/admin/pages/hydrationOps'
)

foreach ($path in $pages) {
  Invoke-Endpoint -Path $path -AllowStatus @(200, 503) -Headers $authHeaders | Out-Null
}

# Admin page-data APIs.
$pageApis = @(
  '/admin/api/pages/opsNavigator',
  '/admin/api/pages/importUrls',
  '/admin/api/pages/easyProxiesImport',
  '/admin/api/pages/tokenProxyBindings',
  '/admin/api/pages/proxyPoolOverview',
  '/admin/api/pages/hydrationOps'
)

foreach ($path in $pageApis) {
  $res = Invoke-Endpoint -Path $path -AllowStatus @(200, 503) -Headers $authHeaders
  if ([int]$res.StatusCode -eq 200) {
    try {
      $null = $res.Content | ConvertFrom-Json
    } catch {
      throw "Expected JSON payload on $path"
    }
  }
}

Write-Host '[admin-ui-smoke] done'
