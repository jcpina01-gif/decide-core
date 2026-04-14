#Requires -Version 5.1
<#
.SYNOPSIS
    Copia `backend/data/prices_close.csv` de um monorepo DECIDE para outro (mesma coluna de datas nos dois).
.DESCRIPTION
    Usa quando a IB grava o CSV num clone e o deploy / freeze “oficial” vive noutro checkout (ex.: decide-core).
    Depois de copiar, corre `python scripts/regenerate_smooth_freeze_outputs.py` na pasta **Destino** `backend/`
    (ou só no repo que fizeres deploy do KPI).
.PARAMETER SourceRoot
    Repo onde o `prices_close.csv` está actual (ex.: export IB).
.PARAMETER DestRoot
    Repo que deve ficar igual (ex.: decide-core antes de git push / deploy).
#>
param(
    [Parameter(Mandatory = $true)][string] $SourceRoot,
    [Parameter(Mandatory = $true)][string] $DestRoot
)

$src = Join-Path (Resolve-Path -LiteralPath $SourceRoot).Path "backend\data\prices_close.csv"
$dst = Join-Path (Resolve-Path -LiteralPath $DestRoot).Path "backend\data\prices_close.csv"

if (-not (Test-Path -LiteralPath $src)) {
    Write-Error "Não existe: $src"
    exit 1
}
$dir = Split-Path -Parent $dst
if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$tmp = "$dst.new.$([Guid]::NewGuid().ToString('n').Substring(0,8))"
try {
    Copy-Item -LiteralPath $src -Destination $tmp -Force
    Move-Item -LiteralPath $tmp -Destination $dst -Force
}
catch {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    throw
}
$info = Get-Item -LiteralPath $dst
Write-Host "OK: copiado para $dst ($($info.Length) bytes)."
$tail = Get-Content -LiteralPath $dst -Tail 1
Write-Host "Última linha (amostra): $($tail.Substring(0, [Math]::Min(80, $tail.Length)))..."
