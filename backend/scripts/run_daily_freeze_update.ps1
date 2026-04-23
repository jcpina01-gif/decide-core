#Requires -Version 5.1
# (Doc: logs/freeze_daily_update.log; Passo 2.5: DECIDE_SYNC_LANDING=0 desactiva copia p/ landing)
param(
    [string] $RepoRoot = "",
    [string] $LogPath = ""
)

$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Write-LogLine([string] $msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = $ts + " " + $msg
    Write-Host $line
    if ($script:LogFile) {
        $enc = New-Object System.Text.UTF8Encoding $false
        $n = [Environment]::NewLine
        [System.IO.File]::AppendAllText($script:LogFile, $line + $n, $enc)
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
} catch {
    Write-Host "ERRO: nao consegui resolver a raiz do repositorio. RepoRoot='$RepoRoot' PSScriptRoot='$PSScriptRoot'"
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

Write-LogLine (("===== Início (repo=" + $root + ") ====="))

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

# Python escreve para a pipeline: se a funcao fizer "return $c", $c1 = Invoke-Py capturava
# as linhas de saida (ex. "TWS indisponivel...") em vez do exit code. Reenviar para o host
# e devolver so o codigo.
function Invoke-Py {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string] $scriptPath
    )
    $backend = Join-Path $root "backend"
    Push-Location $backend
    if ($pythonExe -eq "py") {
        $pout = & py -3 $scriptPath 2>&1
    } else {
        $pout = & $pythonExe $scriptPath 2>&1
    }
    $c = 0
    if ($null -ne $LASTEXITCODE) { $c = [int]$LASTEXITCODE }
    if ($pout) { $pout | ForEach-Object { Write-Host $_ } }
    Pop-Location
    return $c
}

# Por defeito: TWS/IB (Gateway) primeiro, Yahoo para falhados. Ver `update_prices_close.py`.
# DECIDE_PRICES_SOURCE=yf forca so Yahoo; tws = so TWS. DECIDE_SKIP_PRICE_UPDATE=1 pula tudo.
$upd = Join-Path $root "backend\scripts\update_prices_close.py"
if ($env:DECIDE_SKIP_PRICE_UPDATE -eq "1") {
    Write-LogLine "Aviso: DECIDE_SKIP_PRICE_UPDATE=1 - a saltar actualizacao de precos (Passo 1 ignorado)."
}
if ($env:DECIDE_SKIP_PRICE_UPDATE -ne "1" -and (Test-Path -LiteralPath $upd)) {
    Write-LogLine "Passo 1: actualizar prices_close (TWS/IB se disponivel, depois Yahoo para falhados)..."
    $c1 = Invoke-Py $upd
    if ($c1 -ne 0) {
        Write-LogLine "ERRO: update_prices_close.py terminou com codigo $c1"
        exit $c1
    }
    Write-LogLine "OK: passo 1 concluido."
}
if ($env:DECIDE_SKIP_PRICE_UPDATE -ne "1" -and -not (Test-Path -LiteralPath $upd)) {
    Write-LogLine "Aviso: nao existe $upd - so regenero o freeze com o CSV actual."
}

Write-LogLine "Passo 2: regenerar freeze smooth (V5/CAP)..."
$code = Invoke-Py $regen

if ($code -ne 0) {
    Write-LogLine "ERRO: regenerate terminou com codigo $code"
    exit $code
}

# Passo 2.5: espelha model_outputs (freeze) -> frontend/data/landing/freeze-cap15 (Next/Vercel, APIs landing)
# Desactivar: DECIDE_SYNC_LANDING=0 ou false|no
$doLanding = $true
$sl = ($env:DECIDE_SYNC_LANDING -as [string])
if ($null -ne $sl -and $sl -match '^(0|no|false)\s*$') { $doLanding = $false }
if ($doLanding) {
    $mout = Join-Path $root "freeze\DECIDE_MODEL_V5_V2_3_SMOOTH\model_outputs"
    $land = Join-Path $root "frontend\data\landing\freeze-cap15"
    if (Test-Path -LiteralPath $mout) {
        if (-not (Test-Path -LiteralPath $land)) { New-Item -ItemType Directory -Path $land -Force | Out-Null }
        $n = 0
        Get-ChildItem -LiteralPath $mout -File -ErrorAction SilentlyContinue | ForEach-Object {
            $ext = $_.Extension.ToLowerInvariant()
            if ($ext -eq ".csv" -or $ext -eq ".json") {
                Copy-Item -LiteralPath $_.FullName -Destination $land -Force
                $n = $n + 1
            }
        }
        Write-LogLine "Passo 2.5: copiado freeze model_outputs -> frontend\data\landing\freeze-cap15 ($n ficheiros csv/json)."
    } else {
        Write-LogLine "Aviso: Passo 2.5 saltado (nao existe $mout)."
    }
} else {
    Write-LogLine "Aviso: DECIDE_SYNC_LANDING=0 - nao actualizo frontend\data\landing\freeze-cap15."
}

Write-LogLine "OK: pipeline concluido (precos + freeze)."

if ($env:DECIDE_KPI_NO_RESTART -eq "1") {
    Write-LogLine "Aviso: DECIDE_KPI_NO_RESTART=1 - nao reinicio o Flask KPI local."
} else {
    $restart = Join-Path $PSScriptRoot "restart_decide_kpi_server.ps1"
    if (Test-Path -LiteralPath $restart) {
        Write-LogLine "Passo 3: reiniciar kpi_server (Flask) local..."
        try {
            & $restart -RepoRoot $root -PythonExe $pythonExe
            Write-LogLine "OK: passo 3 concluido (ver mensagens KPI se correres em consola)."
        } catch {
            Write-LogLine "ERRO no reinicio KPI: $_"
        }
    } else {
        Write-LogLine "Aviso: falta restart_decide_kpi_server.ps1 junto a este script."
    }
}

Write-LogLine "===== Fim ====="
Write-LogLine "Nota: dashboard Vercel/prod pode precisar de build/CSV a jusante (KPI_EMBED_UPSTREAM)."
exit 0
