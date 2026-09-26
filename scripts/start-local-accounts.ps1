$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot ".nyx-local.json"

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Missing .nyx-local.json. Create the private local account configuration before starting Nyx."
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$serviceAccountPath = [Environment]::ExpandEnvironmentVariables(
  [string]$config.serviceAccountPath
)

if (-not $serviceAccountPath -or -not (Test-Path -LiteralPath $serviceAccountPath)) {
  throw "The Firebase service-account file configured in .nyx-local.json was not found."
}

$firebase = Get-Content -LiteralPath $serviceAccountPath -Raw | ConvertFrom-Json
$requiredValues = @{
  FIREBASE_PROJECT_ID = [string]$firebase.project_id
  FIREBASE_CLIENT_EMAIL = [string]$firebase.client_email
  FIREBASE_PRIVATE_KEY = [string]$firebase.private_key
  FIREBASE_WEB_API_KEY = [string]$config.firebaseWebApiKey
  NYX_FOUNDER_PROFILE_ADMIN_UID = [string]$config.ownerUid
}

foreach ($entry in $requiredValues.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace($entry.Value)) {
    throw "The local account configuration is missing $($entry.Key)."
  }
  Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value
}

Set-Location -LiteralPath $projectRoot
Write-Host "Firebase accounts loaded for local Nyx." -ForegroundColor Green
& npm run dev
exit $LASTEXITCODE
