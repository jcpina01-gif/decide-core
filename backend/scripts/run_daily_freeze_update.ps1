#Requires -Version 5.1
<#
.SYNOPSIS
    Regenera o freeze CAP15 smooth a partir de `prices_close.csv` (e opcionalmente preços Yahoo).
.DESCRIPTION
    Por defeito tenta primeiro `update_prices_close_yfinance.py` (Yahoo). Se actualizas preços **só pela IB**
    (TWS / export / outro fluxo) e já gravaste `backend/data/prices_close.csv`, define
    `$env:DECIDE_SKIP_PRICE_UPDATE = "1"` na tarefa agendada — assim só corre:
    `regenerate_smooth_freeze_outputs.py` (por defeito **motor V5** `export_smooth_freeze_from_v5.py`;
    requer `DECIDE_CORE22_CLONE` ou `DECIDE_V5_ENGINE_ROOT`; fallback: `DECIDE_FREEZE_FALLBACK_ENGINE_V2=1`
    ou `--legacy-engine-v2`) e reinício local do KPI.
    Define `DECIDE_KPI_REPO_ROOT` / `DECIDE_PROJECT_ROOT` para a raiz do repo.
.NOTES
    Log: `<repo>/logs/freeze_daily_update.log`
#>
param(
    [string] $RepoRoot = "",
    [string] $LogPath = ""
)

$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Write-LogLine([string] $msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Host $line
    if ($script:LogFile) {
        $enc = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::AppendAllText($script:LogFile, "$line`r`n", $enc)
    }
}

try {
    if ($RepoRoot -and (Test-Path -LiteralPath $RepoRoot)) {
        $root = (Resolve-Path -LiteralPath $RepoRoot).Path
    }
    else {
        $here = $PSScriptRoot
        if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
        $root = (Resolve-Path -LiteralPath (Join-Path $here "..\..")).Path
    }
}
catch {
    Write-Host "ERRO: não consegui resolver a raiz do repositório. RepoRoot='$RepoRoot' PSScriptRoot='$PSScriptRoot'"
    exit 1
}

if (-not $LogPath) {
    $logDir = Join-Path $root "logs"
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $LogPath = Join-Path $logDir "freeze_daily_update.log"
}
$script:LogFile = $LogPath

Write-LogLine "===== Início (repo=$root) ====="

$pyCandidates = @(
    (Join-Path $root "backend\.venv\Scripts\python.exe"),
    (Join-Path $root "backend\.venv\Scripts\python3.exe")
)
$pythonExe = $null
foreach ($c in $pyCandidates) {
    if (Test-Path -LiteralPath $c) {
        $pythonExe = $c
        break
    }
}
if (-not $pythonExe) {
    foreach ($name in @("python", "python3", "py")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) {
            if ($name -eq "py") {
                $pythonExe = "py"
                $pyArgsPrefix = @("-3")
            }
            else {
                $pythonExe = $cmd.Source
                $pyArgsPrefix = @()
            }
            break
        }
    }
}

if (-not $pythonExe) {
    Write-LogLine "ERRO: não encontrei Python (nem backend\.venv\Scripts\python.exe). Instala o venv ou adiciona Python ao PATH da conta que corre a tarefa."
    exit 1
}

$regen = Join-Path $root "backend\scripts\regenerate_smooth_freeze_outputs.py"
if (-not (Test-Path -LiteralPath $regen)) {
    Write-LogLine "ERRO: não existe $regen"
    exit 1
}

$env:DECIDE_KPI_REPO_ROOT = $root
$env:DECIDE_PROJECT_ROOT = $root
Write-LogLine "Python: $pythonExe"

function Invoke-Py([string] $scriptPath) {
    Push-Location (Join-Path $root "backend")
    try {
        if ($pythonExe -eq "py") {
            & py -3 $scriptPath
        }
        else {
            & $pythonExe $scriptPath
        }
        return $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}

$upd = Join-Path $root "backend\scripts\update_prices_close_yfinance.py"
if ($env:DECIDE_SKIP_PRICE_UPDATE -eq "1") {
    Write-LogLine "Aviso: DECIDE_SKIP_PRICE_UPDATE=1 — a saltar actualização Yahoo."
}
elseif (Test-Path -LiteralPath $upd) {
    Write-LogLine "Passo 1: actualizar prices_close (Yahoo)…"
    $c1 = Invoke-Py $upd
    if ($c1 -ne 0) {
        Write-LogLine "ERRO: update_prices_close_yfinance terminou com código $c1"
        exit $c1
    }
    Write-LogLine "OK: passo 1 concluído."
}
else {
    Write-LogLine "Aviso: não existe $upd — só regenero o freeze com o CSV actual."
}

Write-LogLine "Passo 2: regenerar freeze smooth…"
$code = Invoke-Py $regen

if ($code -ne 0) {
    Write-LogLine "ERRO: regenerate terminou com código $code"
    exit $code
}

Write-LogLine "OK: pipeline concluído (preços + freeze)."

if ($env:DECIDE_KPI_NO_RESTART -eq "1") {
    Write-LogLine "Aviso: DECIDE_KPI_NO_RESTART=1 — não reinicio o Flask KPI."
}
else {
    $restart = Join-Path $PSScriptRoot "restart_decide_kpi_server.ps1"
    if (Test-Path -LiteralPath $restart) {
        Write-LogLine "Passo 3: reiniciar kpi_server (Flask) local…"
        try {
            & $restart -RepoRoot $root -PythonExe $pythonExe
            Write-LogLine "OK: passo 3 concluído (ver mensagens KPI acima se correres em consola)."
        }
        catch {
            Write-LogLine "ERRO no reinício KPI: $_"
        }
    }
    else {
        Write-LogLine "Aviso: falta restart_decide_kpi_server.ps1 ao lado deste script."
    }
}

Write-LogLine "===== Fim ====="
Write-LogLine "Nota: se o dashboard for Vercel/producao, o iframe usa KPI_EMBED_UPSTREAM — lá também precisa de CSV/build actualizados."
exit 0
