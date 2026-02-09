param(
  [string]$BaseUrl = 'http://127.0.0.1:3000',
  [int]$TimeoutSec = 20,
  # Optional: provide "user:pass" to verify /metrics when Basic Auth is enabled.
  [string]$MetricsBasicAuth = $env:METRICS_SMOKE_BASIC_AUTH
)

$ErrorActionPreference = 'Stop'

function Invoke-Json {
  param([string]$Url)

  $res = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck
  $json = $null
  try {
    $json = $res.Content | ConvertFrom-Json
  } catch {
    $json = $null
  }

  return [pscustomobject]@{
    Status = [int]$res.StatusCode
    Body = [string]$res.Content
    Json = $json
  }
}

Write-Host "[proxy-smoke] base_url=$BaseUrl"

$health = Invoke-Json -Url "$BaseUrl/healthz"
if ($health.Status -ne 200 -and $health.Status -ne 503) {
  throw "Unexpected /healthz status: $($health.Status)"
}
if (-not $health.Json) {
  throw '/healthz did not return JSON.'
}
if ($null -eq $health.Json.ok -or $null -eq $health.Json.db -or $null -eq $health.Json.queue) {
  throw '/healthz JSON is missing expected keys (ok/db/queue).'
}
Write-Host "[proxy-smoke] healthz status=$($health.Status)"

$favicon = Invoke-WebRequest -Uri "$BaseUrl/favicon.ico" -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck
if ([int]$favicon.StatusCode -ne 200 -and [int]$favicon.StatusCode -ne 204) {
  throw "Unexpected /favicon.ico status: $($favicon.StatusCode)"
}
Write-Host "[proxy-smoke] favicon status=$([int]$favicon.StatusCode)"

$metricsHeaders = @{}
if (-not [string]::IsNullOrWhiteSpace($MetricsBasicAuth)) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($MetricsBasicAuth))
  $metricsHeaders['Authorization'] = "Basic $encoded"
}

$metrics = Invoke-WebRequest -Uri "$BaseUrl/metrics" -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck -Headers $metricsHeaders
$metricsStatus = [int]$metrics.StatusCode

if ($metricsStatus -eq 200) {
  $metricBody = [string]$metrics.Content
  $requiredMetrics = @(
    'pixivcat_up',
    'http_requests_total',
    'outbound_errors_total'
  )
  foreach ($metric in $requiredMetrics) {
    if ($metricBody -notmatch [regex]::Escape($metric)) {
      throw "Missing metric: $metric"
    }
  }
  Write-Host "[proxy-smoke] metrics ok (found $($requiredMetrics -join ', '))"
} elseif ($metricsStatus -eq 401) {
  Write-Host '[proxy-smoke] metrics protected (401)'
} elseif ($metricsStatus -eq 404) {
  Write-Host '[proxy-smoke] metrics disabled/protected (404)'
} else {
  throw "Unexpected /metrics status: $metricsStatus"
}

$randomUrl = "$BaseUrl/random?format=json"
$randomRes = Invoke-WebRequest -Uri $randomUrl -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck
$randomStatus = [int]$randomRes.StatusCode
$randomBody = [string]$randomRes.Content

if ($randomStatus -ne 200 -and $randomStatus -ne 404 -and $randomStatus -ne 500) {
  throw "Unexpected /random?format=json status: $randomStatus"
}

$randomJson = $null
try {
  $randomJson = $randomBody | ConvertFrom-Json
} catch {
  throw '/random?format=json body is not valid JSON.'
}

if ($randomStatus -eq 200) {
  if ($null -eq $randomJson.id -or $null -eq $randomJson.urls) {
    throw '/random success payload missing id/urls.'
  }
  Write-Host "[proxy-smoke] random json ok id=$($randomJson.id)"
} elseif ($randomStatus -eq 404) {
  if ([string]$randomJson.code -ne 'NO_MATCH') {
    throw "Expected NO_MATCH for 404 random response, got: $($randomJson.code)"
  }
  if (-not $randomJson.hints -or -not $randomJson.hints.suggestions) {
    throw '/random NO_MATCH payload is missing hints.suggestions.'
  }
  Write-Host '[proxy-smoke] random json returned NO_MATCH (dataset empty)'
} else {
  if (-not $randomJson.code -or -not $randomJson.message) {
    throw '/random 500 response is missing code/message fields.'
  }
  Write-Host "[proxy-smoke] random json returned 500 code=$($randomJson.code)"
}

$filteredNoMatchRes = Invoke-WebRequest -Uri "$BaseUrl/random?format=json&orientation=portrait&r18=1" -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck
$filteredNoMatchStatus = [int]$filteredNoMatchRes.StatusCode
if ($filteredNoMatchStatus -ne 200 -and $filteredNoMatchStatus -ne 404 -and $filteredNoMatchStatus -ne 500) {
  throw "Unexpected filtered /random status: $filteredNoMatchStatus"
}
if ($filteredNoMatchStatus -eq 404) {
  $filteredNoMatchJson = $filteredNoMatchRes.Content | ConvertFrom-Json
  if ([string]$filteredNoMatchJson.code -ne 'NO_MATCH') {
    throw "Expected NO_MATCH for filtered random 404, got: $($filteredNoMatchJson.code)"
  }
  if (-not $filteredNoMatchJson.hints -or -not $filteredNoMatchJson.hints.applied_filters) {
    throw 'Filtered NO_MATCH payload missing hints.applied_filters.'
  }
  Write-Host '[proxy-smoke] filtered random NO_MATCH includes degrade hints'
}

$redirectRes = Invoke-WebRequest -Uri "$BaseUrl/random?redirect=1" -TimeoutSec $TimeoutSec -MaximumRedirection 0 -UseBasicParsing -SkipHttpErrorCheck
if ($redirectRes.StatusCode -eq 302) {
  $location = $redirectRes.Headers['Location']
  if (-not $location) {
    throw '/random?redirect=1 returned 302 without Location header.'
  }
  Write-Host "[proxy-smoke] redirect ok location=$location"
} elseif ($redirectRes.StatusCode -eq 404) {
  Write-Host '[proxy-smoke] redirect returned 404 (NO_MATCH)'
} elseif ($redirectRes.StatusCode -eq 500) {
  Write-Host '[proxy-smoke] redirect returned 500 (dependency not ready)'
} else {
  throw "Unexpected /random?redirect=1 status: $($redirectRes.StatusCode)"
}

$legacyInvalid = Invoke-WebRequest -Uri "$BaseUrl/136551599-0.jpg" -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck
if ([int]$legacyInvalid.StatusCode -ne 400) {
  throw "Unexpected legacy invalid-page status: $($legacyInvalid.StatusCode)"
}
$legacyType = [string]$legacyInvalid.Headers['Content-Type']
if ($legacyType -notmatch 'application/json') {
  throw "Expected JSON content type for legacy invalid-page route, got: $legacyType"
}
Write-Host '[proxy-smoke] legacy invalid-page route returns JSON BAD_REQUEST'

Write-Host '[proxy-smoke] done'
