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

function Assert-NoKnownUiRegression {
  param(
    [string]$Path,
    [string]$Body
  )

  if ([string]::IsNullOrWhiteSpace($Body)) {
    throw "Empty body for $Path"
  }

  $text = $Body.ToLowerInvariant()
  $knownPatterns = @(
    '未指定组件',
    'no component specified',
    'component is not specified'
  )

  foreach ($pattern in $knownPatterns) {
    if ($text.Contains($pattern.ToLowerInvariant())) {
      throw "Detected admin UI regression marker '$pattern' on $Path"
    }
  }
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
  $res = Invoke-Endpoint -Path $path -AllowStatus @(200, 503) -Headers $authHeaders
  if ([int]$res.StatusCode -eq 200 -and $path -like '/admin/pages/*') {
    Assert-NoKnownUiRegression -Path $path -Body ([string]$res.Content)
  }
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
    Assert-NoKnownUiRegression -Path $path -Body ([string]$res.Content)
    try {
      $payload = $res.Content | ConvertFrom-Json
    } catch {
      throw "Expected JSON payload on $path"
    }

    $component = $null
    if ($payload -and $payload.PSObject.Properties.Name -contains 'component') {
      $component = [string]$payload.component
    } elseif ($payload -and $payload.PSObject.Properties.Name -contains 'data') {
      $data = $payload.data
      if ($data -and $data.PSObject.Properties.Name -contains 'component') {
        $component = [string]$data.component
      }
    }

    if ([string]::IsNullOrWhiteSpace($component)) {
      throw "Expected page component metadata on $path"
    }
  }
}

Write-Host '[admin-ui-smoke] done'
