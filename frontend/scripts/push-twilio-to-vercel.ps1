# Push Twilio + ALLOW_CLIENT_PHONE_VERIFY to Vercel Production (reads frontend/.env.local).
# Once: npx vercel login ; npx vercel link
# Run: cd frontend ; .\scripts\push-twilio-to-vercel.ps1
#
# Regex patterns use single-quoted strings so [ is not parsed as a PowerShell wildcard.

$ErrorActionPreference = "Stop"
$frontendRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $frontendRoot ".env.local"
if (-not (Test-Path $envPath)) {
  throw "Missing $envPath"
}

$vercelDir = Join-Path $frontendRoot ".vercel"
if (-not (Test-Path $vercelDir)) {
  throw "Missing .vercel folder - run from frontend: npx vercel link"
}

$keys = @(
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "ALLOW_CLIENT_PHONE_VERIFY"
)

$map = @{}
Get-Content $envPath -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if ($line -match '^\s*#' -or $line -eq "") { return }
  if ($line -match '^([^=]+)=(.*)$') {
    $k = $matches[1].Trim()
    $v = $matches[2].Trim()
    if ($v.Length -ge 2 -and $v.StartsWith('"') -and $v.EndsWith('"')) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    if ($v.Length -ge 2 -and $v.StartsWith("'") -and $v.EndsWith("'")) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$k] = $v
  }
}

Set-Location $frontendRoot

foreach ($k in $keys) {
  if (-not $map.ContainsKey($k)) {
    Write-Warning "Skip $k (not in .env.local)"
    continue
  }
  $val = $map[$k]
  if ([string]::IsNullOrWhiteSpace($val)) {
    Write-Warning "Skip $k (empty)"
    continue
  }

  $sensitive = @("TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID") -contains $k
  Write-Host "Setting $k for Production..."

  $argList = @("--yes", "vercel@latest", "env", "add", $k, "production", "--yes", "--force", "--value", $val)
  if ($sensitive) {
    $argList = @("--yes", "vercel@latest", "env", "add", $k, "production", "--yes", "--force", "--sensitive", "--value", $val)
  }

  $p = Start-Process -FilePath "npx" -ArgumentList $argList -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "vercel env add failed for $k (exit $($p.ExitCode))"
  }
}

Write-Host "Done. Vercel: Redeploy last deployment or push again."
