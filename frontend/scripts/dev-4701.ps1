# Legado: delega em dev-4701.cjs (mata porta 4701 + next dev).
# Preferir: npm run dev:clean

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Split-Path -Parent $scriptDir
Set-Location $frontend
node ./scripts/dev-4701.cjs
