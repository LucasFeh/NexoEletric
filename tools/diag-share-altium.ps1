<#
  diag-share-altium.ps1 - por que o script do Altium nao consegue GRAVAR no share

  Rode NO PC DO ALTIUM. Duas vezes:
     1) numa janela normal
     2) numa janela "Executar como administrador"
  Se o resultado mudar entre as duas, o problema e elevacao (veja o veredito).

  O script NAO apaga credencial, NAO apaga conexao e NAO altera o schematic.js.
  Ele cria um arquivo _teste_*.tmp e apaga em seguida.
#>

$ErrorActionPreference = 'SilentlyContinue'
$SRV     = '192.168.15.192'
$CURRENT = "\\$SRV\altiumhub\current"
$SHARED  = "\\$SRV\altiumhub\shared"

function Titulo($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function OK($t)     { Write-Host "  [OK]    $t" -ForegroundColor Green }
function FALHA($t)  { Write-Host "  [FALHA] $t" -ForegroundColor Red }
function INFO($t)   { Write-Host "  [ .. ]  $t" }

# ---------------------------------------------------------------- estado local
Titulo "Quem sou eu"
$id   = [Security.Principal.WindowsIdentity]::GetCurrent()
$elev = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
INFO "Usuario Windows: $($id.Name)"
if ($elev) { INFO "Processo ELEVADO (administrador): SIM" } else { INFO "Processo elevado (administrador): nao" }

# ------------------------------------------------------------------ credencial
Titulo "Credencial guardada para $SRV"
$cmd = (cmdkey /list:$SRV) -join "`n"
$credUser = $null
if ($cmd -match '(?m)^\s*(?:Usu.rio|User)\s*:\s*(.+)$') { $credUser = $Matches[1].Trim() }
if ($credUser) { OK "cmdkey tem credencial para $SRV, usuario: $credUser" }
else           { FALHA "cmdkey NAO tem credencial para $SRV nesta sessao" }

# ------------------------------------------------------------------ sessao SMB
Titulo "Sessao SMB com $SRV"
$conn = $null
try { $conn = Get-SmbConnection -ServerName $SRV -ErrorAction Stop } catch { }
if ($conn) {
  foreach ($c in $conn) {
    INFO ("share {0} | usuario da sessao: {1} | dialeto SMB {2}" -f $c.ShareName, $c.UserName, $c.Dialect)
  }
} else {
  INFO "Get-SmbConnection nao respondeu (ele exige janela elevada). Caindo para 'net use':"
  $linhas = @((net use) -split "`r?`n" | Where-Object { $_ -match [regex]::Escape($SRV) })
  if ($linhas.Count) { $linhas | ForEach-Object { INFO ("net use: " + $_.Trim()) } }
  else { INFO "net use: nenhuma conexao aberta com $SRV neste momento" }
}
$outras = @()
if ($conn) { $outras = @($conn | Select-Object -ExpandProperty UserName -Unique) }
if ($outras.Count -gt 1) { FALHA ("mais de um usuario em sessao com ${SRV}: " + ($outras -join ', ')) }

# --------------------------------------------------------------------- LEITURA
Titulo "Leitura"
$leu = $false
$pjs = "$CURRENT\projects.js"
try {
  $n = (Get-Item -LiteralPath $pjs -ErrorAction Stop).Length
  OK "leu $pjs ($n bytes)"
  $leu = $true
} catch {
  FALHA "NAO leu $pjs -> $($_.Exception.Message)"
}

# --------------------------------------------------------------------- ESCRITA
function TesteEscrita($dir) {
  $alvo = Join-Path $dir ("_teste_diag_{0}.tmp" -f $PID)
  $fs = $null
  try {
    $fs = [System.IO.File]::Open($alvo, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $b = [Text.Encoding]::ASCII.GetBytes("diag")
    $fs.Write($b, 0, $b.Length)
    $fs.Close(); $fs = $null
    Remove-Item -LiteralPath $alvo -Force -ErrorAction Stop
    OK "criou e apagou arquivo de teste em $dir"
    return $true
  } catch {
    $e = $_.Exception
    $code = 0
    try { $code = [Runtime.InteropServices.Marshal]::GetHRForException($e) -band 0xFFFF } catch { }
    FALHA ("NAO criou arquivo em {0} -> {1} (erro {2})" -f $dir, $e.Message, $code)
    if ($fs) { try { $fs.Close() } catch { } }
    Remove-Item -LiteralPath $alvo -Force -ErrorAction SilentlyContinue
    return $false
  }
}
Titulo "Escrita (cria e apaga um arquivo de teste)"
$wCur = TesteEscrita "$CURRENT\Projects"
$wSha = TesteEscrita "$SHARED\Projects"

# ----------------------------------------- o arquivo real: atributos e abertura
Titulo "O arquivo que o Altium tenta gravar"
$alvoReal = $null
try {
  $alvoReal = Get-ChildItem -LiteralPath "$CURRENT\Projects" -Directory -ErrorAction Stop |
              ForEach-Object { Join-Path $_.FullName 'schematic.js' } |
              Where-Object { Test-Path -LiteralPath $_ } |
              Select-Object -First 1
} catch { }
if (-not $alvoReal) {
  INFO "nenhum schematic.js encontrado para testar"
} else {
  $it = Get-Item -LiteralPath $alvoReal -Force
  INFO ("{0}" -f $alvoReal)
  INFO ("tamanho {0} bytes | atributos: {1}" -f $it.Length, $it.Attributes)
  $mau = @()
  foreach ($a in 'ReadOnly', 'Hidden', 'System') {
    if ($it.Attributes -band [IO.FileAttributes]::$a) { $mau += $a }
  }
  if ($mau.Count) {
    FALHA ("atributo " + ($mau -join '+') + " presente: o Delphi grava com CREATE_ALWAYS+NORMAL e o Windows responde Acesso negado")
  } else {
    OK "sem atributo ReadOnly/Hidden/System"
  }
  # mesma abertura exclusiva de que o TStringList.SaveToFile precisa, SEM truncar o arquivo
  $fs = $null
  try {
    $fs = [System.IO.File]::Open($alvoReal, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $fs.Close(); $fs = $null
    OK "abre o arquivo real para escrita exclusiva (nada foi gravado nele)"
  } catch {
    $e = $_.Exception
    $code = 0
    try { $code = [Runtime.InteropServices.Marshal]::GetHRForException($e) -band 0xFFFF } catch { }
    if ($code -eq 32) {
      FALHA "arquivo EM USO por outro processo (erro 32) - feche o hub ou o editor que esta com ele aberto"
    } else {
      FALHA ("NAO abre o arquivo real para escrita -> {0} (erro {1})" -f $e.Message, $code)
    }
    if ($fs) { try { $fs.Close() } catch { } }
  }
}

# ------------------------------------------------ bloqueios de antivirus/cache
Titulo "Bloqueios do lado do Windows"
$cfa = $null
try { $cfa = (Get-MpPreference -ErrorAction Stop).EnableControlledFolderAccess } catch { }
if     ($cfa -eq 1) { FALHA "Acesso Controlado a Pastas (Defender) LIGADO - ele bloqueia a gravacao e deixa a leitura passar" }
elseif ($cfa -eq 2) { INFO  "Acesso Controlado a Pastas em modo auditoria (nao bloqueia)" }
elseif ($cfa -eq 0) { OK    "Acesso Controlado a Pastas desligado" }
else                { INFO  "Acesso Controlado a Pastas: nao foi possivel consultar" }

$av = @()
try { $av = @(Get-CimInstance -Namespace root\SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop) } catch { }
$av3 = @($av | Where-Object { $_.displayName -notmatch 'Defender' })
if ($av3.Count) {
  FALHA ("antivirus de terceiros instalado: " + (($av3 | Select-Object -ExpandProperty displayName) -join ', ') + " - confira o escudo anti-ransomware dele")
} else {
  INFO "sem antivirus de terceiros registrado"
}

$csc = $null
try { $csc = Get-CimInstance -Namespace root\cimv2 -ClassName Win32_OfflineFilesCache -ErrorAction Stop } catch { }
if ($csc -and $csc.Enabled) {
  FALHA "Arquivos Offline (Central de Sincronizacao) LIGADO - com a pasta 'offline' voce le do cache e a gravacao falha"
} else {
  OK "Arquivos Offline desligado"
}

$eventos = @()
try {
  $eventos = @(Get-WinEvent -FilterHashtable @{
    LogName   = 'Microsoft-Windows-Windows Defender/Operational'
    Id        = 1123, 1124
    StartTime = (Get-Date).AddDays(-7)
  } -ErrorAction Stop)
} catch { }
if ($eventos.Count) { FALHA ("{0} bloqueio(s) do Acesso Controlado a Pastas nos ultimos 7 dias" -f $eventos.Count) }

# --------------------------------------------------------------------- VEREDITO
Titulo "VEREDITO"
if (-not $leu) {
  Write-Host "  Nem a leitura funciona: a sessao com $SRV nao esta autenticada como 'altiumhub'." -ForegroundColor Yellow
  Write-Host "  CONSERTO: feche tudo que usa o share e rode (sem apagar nada):" -ForegroundColor Yellow
  Write-Host "     cmdkey /add:$SRV /user:altiumhub /pass" -ForegroundColor Yellow
}
elseif ($wCur -and $wSha) {
  if ($elev) { Write-Host "  Leitura e gravacao OK nesta janela ELEVADA." -ForegroundColor Green }
  else       { Write-Host "  Leitura e gravacao OK nesta janela NORMAL." -ForegroundColor Green }
  Write-Host "  ATENCAO: este script e OUTRO processo, nao o DXP.exe. Se o Altium continua falhando" -ForegroundColor Yellow
  Write-Host "  com o script dizendo OK, o bloqueio e POR APLICATIVO ou por elevacao. Faca nesta ordem:" -ForegroundColor Yellow
  Write-Host "   1) rode este script tambem na outra condicao (normal <-> como administrador);" -ForegroundColor Yellow
  Write-Host "   2) abra o Bloco de Notas e tente salvar um .txt em $CURRENT\Projects." -ForegroundColor Yellow
  Write-Host "      Se o Bloco de Notas salva e so o Altium falha, o culpado e o escudo anti-ransomware" -ForegroundColor Yellow
  Write-Host "      (Acesso Controlado a Pastas / antivirus): libere o DXP.exe na lista de aplicativos." -ForegroundColor Yellow
  Write-Host "   3) confira se o atalho do Altium esta marcado 'Executar como administrador'; se estiver," -ForegroundColor Yellow
  Write-Host "      desmarque, ou grave a credencial numa janela elevada: cmdkey /add:$SRV /user:altiumhub /pass" -ForegroundColor Yellow
}
else {
  Write-Host "  LE mas NAO GRAVA: o servidor esta liberado, o bloqueio e deste PC." -ForegroundColor Yellow
  if ($cfa -eq 1) {
    Write-Host "  CONSERTO: Seguranca do Windows > Protecao contra ransomware > Acesso controlado a pastas:" -ForegroundColor Yellow
    Write-Host "  desligar, ou permitir o Altium (DXP.exe) na lista de aplicativos." -ForegroundColor Yellow
  }
  elseif ($av3.Count) {
    Write-Host ("  CONSERTO: liberar o Altium (DXP.exe) no escudo anti-ransomware do " + ($av3 | Select-Object -First 1).displayName + ".") -ForegroundColor Yellow
  }
  elseif ($csc -and $csc.Enabled) {
    Write-Host "  CONSERTO: Central de Sincronizacao > desmarcar 'Sempre disponivel offline' no share e sair do modo offline." -ForegroundColor Yellow
  }
  elseif ($elev -and -not $credUser) {
    Write-Host "  CONSERTO: a sessao elevada nao enxerga a credencial. Rode 'cmdkey /add:$SRV /user:altiumhub /pass'" -ForegroundColor Yellow
    Write-Host "  NESTA janela elevada, ou abra o Altium sem elevacao." -ForegroundColor Yellow
  }
  elseif ($outras.Count -gt 1) {
    Write-Host "  CONSERTO: ha sessao com outro usuario para $SRV (em geral pelo share 'Compartilhado')." -ForegroundColor Yellow
    Write-Host "  Reinicie o PC e acesse primeiro \\$SRV\altiumhub, antes de qualquer outro share desse servidor." -ForegroundColor Yellow
  }
  else {
    Write-Host "  CONSERTO: nenhum culpado obvio nesta lista. Mande esta saida inteira para analise." -ForegroundColor Yellow
  }
}
Write-Host ""
