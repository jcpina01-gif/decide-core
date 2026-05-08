#Requires -Version 5.1
# Actualizacao diaria: prices_close.csv (Yahoo) + regenera freeze CAP15 + copia landing.
# Agendado para as 22:15 via Task Scheduler (DecideCore22_FreezeCSV_Daily).
param(
    [string] $RepoRoot = "",
    [string] $LogPath  = ""
)

$ErrorActionPreference = "Continue"

function Write-LogLine([string] $msg) {
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$ts $msg"
    Write-Host $line
    if ($script:LogFile) {
        $enc = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::AppendAllText($script:LogFile, $line + [Environment]::NewLine, $enc)
    }
}

# Resolver raiz do repositorio
try {
    if ($RepoRoot -and (Test-Path -LiteralPath $RepoRoot)) {
        $root = (Resolve-Path -LiteralPath $RepoRoot).Path
    } else {
        $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
        $root = (Resolve-Path -LiteralPath (Join-Path $here "..\..")).Path
    }
} catch {
    Write-Host "ERRO: nao consegui resolver a raiz do repositorio."
    exit 1
}

# Log
if (-not $LogPath) {
    $logDir = Join-Path $root "logs"
    if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $LogPath = Join-Path $logDir "freeze_daily_update.log"
}
$script:LogFile = $LogPath

Write-LogLine "===== Inicio (repo=$root) ====="

# Encontrar Python do venv
$pyExe = $null
foreach ($c in @("$root\backend\.venv\Scripts\python.exe","$root\backend\.venv\Scripts\python3.exe")) {
    if (Test-Path -LiteralPath $c) { $pyExe = $c; break }
}
if (-not $pyExe) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { $pyExe = $cmd.Source }
}
if (-not $pyExe) { Write-LogLine "ERRO: Python nao encontrado."; exit 1 }
Write-LogLine "Python: $pyExe"

function Invoke-Py([string]$scriptPath) {
    Push-Location (Join-Path $root "backend")
    $out = & $pyExe $scriptPath 2>&1
    $ec  = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    if ($out) { $out | ForEach-Object { Write-Host $_ } }
    Pop-Location
    return $ec
}

# Passo 1: actualizar precos
$upd = Join-Path $root "backend\scripts\update_prices_close.py"
if (Test-Path -LiteralPath $upd) {
    Write-LogLine "Passo 1: actualizar prices_close.csv..."
    $c = Invoke-Py $upd
    if ($c -ne 0) { Write-LogLine "ERRO passo 1 (codigo $c)"; exit $c }
    Write-LogLine "OK passo 1."
} else {
    Write-LogLine "Aviso: update_prices_close.py nao encontrado - a saltar."
}

# Passo 2: regenerar freeze smooth
$regen = Join-Path $root "backend\scripts\regenerate_smooth_freeze_outputs.py"
if (Test-Path -LiteralPath $regen) {
    Write-LogLine "Passo 2: regenerar freeze smooth (V5/CAP)..."
    $c = Invoke-Py $regen
    if ($c -ne 0) { Write-LogLine "ERRO passo 2 (codigo $c)"; exit $c }
    Write-LogLine "OK passo 2."
} else {
    Write-LogLine "ERRO: regenerate_smooth_freeze_outputs.py nao encontrado."; exit 1
}

# Passo 2.5: copiar model_outputs -> frontend/data/landing/freeze-cap15
$mout = Join-Path $root "freeze\DECIDE_MODEL_V5_V2_3_SMOOTH\model_outputs"
$land = Join-Path $root "frontend\data\landing\freeze-cap15"
if (Test-Path -LiteralPath $mout) {
    if (-not (Test-Path -LiteralPath $land)) { New-Item -ItemType Directory -Path $land -Force | Out-Null }
    $n = 0
    Get-ChildItem -LiteralPath $mout -File -ErrorAction SilentlyContinue | ForEach-Object {
        $ext = $_.Extension.ToLowerInvariant()
        if ($ext -eq ".csv" -or $ext -eq ".json") {
            Copy-Item -LiteralPath $_.FullName -Destination $land -Force
            $n++
        }
    }
    Write-LogLine "Passo 2.5: copiado freeze -> frontend\data\landing\freeze-cap15 ($n ficheiros)."
} else {
    Write-LogLine "Aviso: pasta model_outputs nao encontrada, passo 2.5 ignorado."
}

Write-LogLine "===== Fim OK ====="
exit 0
