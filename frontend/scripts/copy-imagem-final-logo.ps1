# Copia o PNG «Imagem final do logo Decide» para public/images/imagem-final-logo-decide.png
# Uso (na pasta frontend):  .\scripts\copy-imagem-final-logo.ps1 -Source "C:\caminho\Imagem final do logo Decide.png"
# Se o Windows não encontrar o ficheiro (caminhos longos), prefixa com \\?\  exemplo:
#   -Source "\\?\C:\Users\...\assets\c__Users_...Imagem_final_do_logo_Decide_....png"
param(
  [Parameter(Mandatory = $true)]
  [string] $Source
)
$destDir = Join-Path $PSScriptRoot "..\public\images"
$dest = Join-Path $destDir "imagem-final-logo-decide.png"
if (-not (Test-Path -LiteralPath $Source)) {
  Write-Error "Ficheiro não encontrado: $Source"
  exit 1
}
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item -LiteralPath $Source -Destination $dest -Force
Write-Host "Copiado para: $dest"
Write-Host "Se as dimensões do PNG não forem 1024×682, atualiza DECIDE_LOGO_INTRINSIC_* em DecideLogoHeader.tsx e aspect-ratio em globals.css (header lockup)."
