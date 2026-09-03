<#
  wt-novo.ps1 - cria (ou reequipa) um worktree do AltiumPCBMirror ja pronto pra rodar.

  Um worktree novo nasce so com o que esta versionado. O hub nao sobe assim:
  faltam a config da maquina e a saida do sync do almoxarifado, que o
  .gitignore mantem fora do historico de proposito. Este script repoe isso.

  Uso:
    .\tools\wt-novo.ps1 -Pasta APM-neoden -Branch agente/neoden
    .\tools\wt-novo.ps1 -Pasta APM-bom                        # so reequipa

  Pasta e criada como irma do repo principal, nunca dentro dele.
#>
param(
  [Parameter(Mandatory=$true)][string]$Pasta,
  [string]$Branch,
  [string]$Base = "HEAD"
)

$ErrorActionPreference = "Stop"

$comum      = git rev-parse --path-format=absolute --git-common-dir
$principal  = Split-Path $comum -Parent
$destino    = Join-Path (Split-Path $principal -Parent) $Pasta

if (-not (Test-Path $destino)) {
  if (-not $Branch) { throw "Pasta $destino nao existe: passe -Branch para cria-la." }
  Write-Host "criando worktree $destino  ($Branch a partir de $Base)"
  git -C $principal worktree add $destino -b $Branch $Base
  if ($LASTEXITCODE -ne 0) { throw "git worktree add falhou" }
}

# arquivos de maquina / saida gerada: copia, porque cada worktree pode
# regerar os seus sem atropelar o vizinho
$copiar = @(
  'hub-config.json',
  'hub-almox.json',
  'Libs/almox-basicos.js',
  'Libs/almox-especiais.js',
  'Libs/almox-index.js',
  'Libs/almox-sync.js',
  'tools/almox/componentes_odoo.csv'
)

foreach ($rel in $copiar) {
  $de   = Join-Path $principal $rel
  $para = Join-Path $destino   $rel
  if (-not (Test-Path $de)) { Write-Host "  - $rel (nao existe no principal, pulando)"; continue }
  $dir = Split-Path $para -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  Copy-Item $de $para -Force
  Write-Host "  copiado  $rel"
}

# Libs/Almox sao 69 MB de biblioteca binaria vinda da rede: cache de maquina,
# nao estado de branch. Junction para os worktrees dividirem a mesma copia.
$deAlmox   = Join-Path $principal 'Libs/Almox'
$paraAlmox = Join-Path $destino   'Libs/Almox'
if ((Test-Path $deAlmox) -and -not (Test-Path $paraAlmox)) {
  New-Item -ItemType Junction -Path $paraAlmox -Target $deAlmox | Out-Null
  Write-Host "  junction Libs/Almox -> principal (69 MB compartilhados)"
}

Write-Host ""
Write-Host "pronto: $destino"
