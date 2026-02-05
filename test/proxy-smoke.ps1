param(
  [string]$BaseUrl = 'http://127.0.0.1:3000',
  [int]$TimeoutSec = 20
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

$metrics = Invoke-WebRequest -Uri "$BaseUrl/metrics" -TimeoutSec $TimeoutSec -UseBasicParsing -SkipHttpErrorCheck
if ([int]$metrics.StatusCode -ne 200) {
  throw "Unexpected /metrics status: $($metrics.StatusCode)"
}
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
  Write-Host '[proxy-smoke] random json returned NO_MATCH (dataset empty)'
} else {
  if (-not $randomJson.code -or -not $randomJson.message) {
    throw '/random 500 response is missing code/message fields.'
  }
  Write-Host "[proxy-smoke] random json returned 500 code=$($randomJson.code)"
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

Write-Host '[proxy-smoke] done'
