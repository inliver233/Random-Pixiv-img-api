param(
  [switch]$SkipProxySmoke,
  [string]$BaseUrl = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'

Write-Host '[regression] running npm run test:all'
npm run test:all

if ($SkipProxySmoke) {
  Write-Host '[regression] skip proxy smoke by request'
  exit 0
}

Write-Host "[regression] running proxy smoke against $BaseUrl"
& "$PSScriptRoot/proxy-smoke.ps1" -BaseUrl $BaseUrl

Write-Host '[regression] done'
