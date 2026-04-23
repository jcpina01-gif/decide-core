#Requires -Version 5.1
<#
.SYNOPSIS
    Cria ou actualiza uma tarefa no Agendador do Windows para correr o update diário do freeze às 22:00.
.DESCRIPTION
    Executa como o utilizador actual (recomendado). Se a tarefa precisar de correr sem sessão,
    no Agendador escolhe «Executar quer o utilizador tenha iniciado sessão ou não» e grava a palavra-passe.
.PARAMETER At
    Hora local (ex.: 22:00 ou 10:00PM).
.PARAMETER TaskName
    Nome único da tarefa no biblioteca do Agendador.
.PARAMETER RepoRoot
    Raiz do monorepo decide-core (opcional; por defeito deduzido deste script).
#>
param(
    [string] $At = "22:00",
    [string] $TaskName = "DecideCore_FreezeCSV_Daily",
    [string] $RepoRoot = ""
)

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Se Register-ScheduledTask falhar com permissões, abre PowerShell «Executar como administrador» ou cria a tarefa manualmente apontando para run_daily_freeze_update.ps1"
}

$runner = Join-Path $PSScriptRoot "run_daily_freeze_update.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
    Write-Error "Não encontro $runner"
    exit 1
}

$runnerFull = (Resolve-Path -LiteralPath $runner).Path
# Aspas vía concatenação — evita erro de parser com `` `" `` dentro de strings "..."
$argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runnerFull + '"'
if ($RepoRoot) {
    $argLine += ' -RepoRoot "' + (Resolve-Path -LiteralPath $RepoRoot).Path + '"'
}

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}
catch { }

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "DECIDE: Yahoo -> prices_close.csv + regenera freeze CAP15 (22h)." `
    -Force | Out-Null

Write-Host "Tarefa '$TaskName' registada - diaria as $At (utilizador: $env:USERNAME)."
Write-Host "Log: (raiz do repo)\logs\freeze_daily_update.log"
Write-Host ([string]::Format("Teste manual: powershell -NoProfile -ExecutionPolicy Bypass -File `"{0}`"", $runnerFull))
exit 0
