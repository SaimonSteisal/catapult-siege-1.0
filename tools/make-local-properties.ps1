# ============================================================================
#  tools/make-local-properties.ps1
#  Находит Android SDK на машине и прописывает его в android/local.properties,
#  чтобы Gradle перестал падать с "SDK location not found".
#  Запуск из корня проекта:
#     powershell -ExecutionPolicy Bypass -File .\tools\make-local-properties.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $root 'android'
if (-not (Test-Path $androidDir)) {
    Write-Host "ERROR: no android/ folder. Run:  npm install; npm run sync" -ForegroundColor Red
    exit 1
}

$cands = @(
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    'C:\Android\Sdk',
    'D:\Android\Sdk',
    'C:\Program Files (x86)\Android\android-sdk',
    'C:\Program Files\Android\Sdk',
    (Join-Path $env:USERPROFILE 'Android\Sdk')
)

$sdk = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $sdk) {
    Write-Host 'Android SDK not found on this machine.' -ForegroundColor Yellow
    Write-Host 'Install it (recommended):  winget install Google.AndroidStudio' -ForegroundColor Yellow
    Write-Host '...then launch Android Studio once so it downloads the SDK, and re-run this script.' -ForegroundColor Yellow
    exit 2
}

$props = Join-Path $androidDir 'local.properties'
$line = 'sdk.dir=' + ($sdk -replace '\\', '/')
Set-Content -Path $props -Value $line -Encoding ASCII
Write-Host "Wrote $props" -ForegroundColor Green
Write-Host $line -ForegroundColor Green
Write-Host 'Now:  cd android; .\gradlew.bat assembleDebug' -ForegroundColor Cyan
