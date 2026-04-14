#Requires -Version 5.1
<#
.SYNOPSIS
    Para processos Python que estejam a correr `kpi_server.py` e volta a arrancar um novo (mesmo repo).
.DESCRIPTION
    Usa o WMI (Win32_Process.CommandLine) para não matar outros `python.exe`.
    Herda `DECIDE_KPI_REPO_ROOT` / `DECIDE_PROJECT_ROOT` = RepoRoot ao arrancar.
    Porta: variável de ambiente `PORT` ou `5000`.
.PARAMETER RepoRoot
    Raiz do monorepo (pasta com `kpi_server.py`).
.PARAMETER PythonExe
    Caminho para `python.exe` (ex.: `backend\.venv\Scripts\python.exe`). Opcional.
#>
param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [string] $PythonExe = ""
)

$ErrorActionPreference = "Continue"
$root = (Resolve-Path -LiteralPath $RepoRoot).Path
$kpiPy = Join-Path $root "kpi_server.py"
if (-not (Test-Path -LiteralPath $kpiPy)) {
    Write-Host "ERRO: não encontro kpi_server.py em $kpiPy"
    exit 1
}

if (-not $PythonExe) {
    foreach ($c in @(
            (Join-Path $root "backend\.venv\Scripts\python.exe"),
            (Join-Path $root "backend\.venv\Scripts\python3.exe")
        )) {
        if (Test-Path -LiteralPath $c) { $PythonExe = $c; break }
    }
}
if (-not $PythonExe) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { $PythonExe = $cmd.Source }
}
if (-not $PythonExe) {
    Write-Host "ERRO: indica -PythonExe ou cria backend\.venv"
    exit 1
}

$killed = @()
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $line = [string]$_.CommandLine
    if ($line.Length -lt 12) { return }
    if ($line -notmatch '(?i)python') { return }
    if ($line -notmatch 'kpi_server\.py') { return }
    try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        $killed += $_.ProcessId
    }
    catch { }
}

if ($killed.Count -gt 0) {
    Write-Host "KPI: parei PID(s):" ($killed -join ", ")
    Start-Sleep -Seconds 2
}
else {
    Write-Host "KPI: nenhum processo com kpi_server.py na linha de comandos (pode já estar parado)."
}

$env:DECIDE_KPI_REPO_ROOT = $root
$env:DECIDE_PROJECT_ROOT = $root
if ([string]::IsNullOrWhiteSpace($env:PORT)) { $env:PORT = "5000" }
$port = [int]$env:PORT

$pyLower = [System.IO.Path]::GetFileName($PythonExe).ToLower()
$isPyLauncher = ($PythonExe -eq "py") -or ($pyLower -eq "py.exe")

try {
    if ($isPyLauncher) {
        $pyCmd = (Get-Command py -ErrorAction SilentlyContinue).Source
        if (-not $pyCmd) { $pyCmd = "py" }
        Start-Process -FilePath $pyCmd -ArgumentList @("-3", "`"$kpiPy`"") -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    }
    else {
        Start-Process -FilePath $PythonExe -ArgumentList "`"$kpiPy`"" -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    }
    Write-Host "KPI: arranque pedido (WorkingDirectory=$root PORT=$port)."
}
catch {
    Write-Host "ERRO ao Start-Process:" $_
    exit 1
}

Start-Sleep -Seconds 3
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 8
    Write-Host "KPI: /api/health ->" $r.StatusCode $r.Content
}
catch {
    Write-Host "Aviso: ainda não respondi a /api/health (pode precisar de mais segundos):" $_
}

exit 0
