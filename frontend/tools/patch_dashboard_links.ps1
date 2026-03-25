$ErrorActionPreference = "Stop"

$ROOT = "C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE"
$FRONT = Join-Path $ROOT "frontend"
$FILE = Join-Path $FRONT "pages\dashboard.tsx"

if (-not (Test-Path $FILE)) {
    throw "Nao encontrei: $FILE"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$FILE.bak_links_$stamp"
Copy-Item $FILE $backup -Force
Write-Host "BACKUP = $backup"

$text = Get-Content $FILE -Raw -Encoding UTF8

if ($text -notmatch 'DashboardQuickLinks') {
    $lines = Get-Content $FILE -Encoding UTF8
    $lastImportIndex = -1

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*import\s+') {
            $lastImportIndex = $i
        }
    }

    if ($lastImportIndex -ge 0) {
        $newLines = New-Object System.Collections.Generic.List[string]
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $newLines.Add($lines[$i])
            if ($i -eq $lastImportIndex) {
                $newLines.Add('import DashboardQuickLinks from "../components/DashboardQuickLinks";')
            }
        }
        $text = ($newLines -join "`r`n")
    } else {
        throw "Nao encontrei bloco de imports em dashboard.tsx"
    }
}

if ($text -notmatch '<DashboardQuickLinks\s*/>') {
    if ($text.Contains('{error ? (')) {
        $text = $text.Replace('{error ? (', "<DashboardQuickLinks />`r`n`r`n      {error ? (")
    }
    elseif ($text.Contains('marginBottom: 24')) {
        $text = $text.Replace('marginBottom: 24 }}>','marginBottom: 24 }}>')
        $text = $text -replace '(<\/div>\s*\r?\n\s*)(<div style=\{\{ display: "grid")', "`$1<DashboardQuickLinks />`r`n`r`n      `$2"
    } else {
        throw "Nao consegui encontrar ponto seguro para inserir <DashboardQuickLinks />"
    }
}

[System.IO.File]::WriteAllText($FILE, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "PATCHED = $FILE"