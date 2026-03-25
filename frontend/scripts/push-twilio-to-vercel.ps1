# Envia variáveis Twilio + ALLOW_CLIENT_PHONE_VERIFY para a Vercel (ambiente Production).
# Pré-requisitos (uma vez, na pasta frontend):
#   npx vercel login
#   npx vercel link
#
# Uso (PowerShell):
#   cd frontend
#   .\scripts\push-twilio-to-vercel.ps1
#
# Lê valores de .env.local (não os imprime). Depois: Vercel → Redeploy ou novo push.

$ErrorActionPreference = "Stop"
$frontendRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $frontendRoot ".env.local"
if (-not (Test-Path $envPath)) {
  throw "Falta $envPath"
}

$vercelDir = Join-Path $frontendRoot ".vercel"
if (-not (Test-Path $vercelDir)) {
  throw "Falta pasta .vercel — na pasta frontend corre: npx vercel link"
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
  if ($line -match "^\s*#" -or $line -eq "") { return }
  if ($line -match "^([^=]+)=(.*)$") {
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
    Write-Warning "Ignorado $k (não está em .env.local)"
    continue
  }
  $val = $map[$k]
  if ([string]::IsNullOrWhiteSpace($val)) {
    Write-Warning "Ignorado $k (vazio)"
    continue
  }

  $sensitive = @("TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID") -contains $k
  Write-Host "A definir $k em Production..."

  $argList = @("--yes", "vercel@latest", "env", "add", $k, "production", "--yes", "--force", "--value", $val)
  if ($sensitive) {
    $argList = @("--yes", "vercel@latest", "env", "add", $k, "production", "--yes", "--force", "--sensitive", "--value", $val)
  }

  $p = Start-Process -FilePath "npx" -ArgumentList $argList -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "vercel env add falhou para $k (exit $($p.ExitCode))"
  }
}

Write-Host "Concluído. Na Vercel: Deployments → Redeploy (ou faz um commit vazio / push)."
