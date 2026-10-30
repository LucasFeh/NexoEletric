# Comparativo NexoEletric Rust x Electron na MESMA placa (mesmos arquivos do projeto).
# Para cada app: abre a placa, fica parado -Idle s, anima a camera -Secs s (mesma formula nos dois),
# enquanto o medir.ps1 le CPU/memoria/GPU da arvore inteira de processos.
#
#   -Modo vsync : como a pessoa usa (quadro preso ao monitor)
#   -Modo livre : sem vsync (Rust --novsync; Electron --disable-gpu-vsync --disable-frame-rate-limit)
#
# O Electron roda numa instancia de TESTE isolada (ALTIUMHUB_USERDATA/ALTIUMHUB_WORKSPACE, hub na
# porta 8371, modo desenvolvedor: sem Nexo Hub/NexoBD) -- a instancia aberta da pessoa nao e tocada.
param(
    [string]$ProjDir,
    [string]$UserData,
    [string]$Workspace,
    [string]$TestHome,
    [string]$OutDir,
    [string]$Modo = 'vsync',
    [int]$Idle = 20,
    [int]$Secs = 30,
    [string]$Apps = 'rust,electron',
    [string]$Tag = '1',
    [string]$RustExe = "$PSScriptRoot\..\target\release\NexoEletric.exe",
    [string]$ElectronExe = 'C:\Program Files\NexoEletric\NexoEletric.exe'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$projeto = Split-Path $ProjDir -Leaf
$medir = Join-Path $PSScriptRoot 'medir.ps1'

function Dono([int]$porta) {
    $l = netstat -ano -p TCP | Select-String (":$porta\s+0\.0\.0\.0:0\s+\S+\s+(\d+)")
    if ($l) { [int]$l.Matches[0].Groups[1].Value } else { 0 }
}

function Medidor([int]$procId, [string]$csv, [string]$fase) {
    Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $medir,
        '-RootPid', $procId, '-Out', $csv, '-FaseFile', $fase, '-MaxSeconds', ($Idle + $Secs + 120))
}

foreach ($app in $Apps.Split(',')) {
    $base = Join-Path $OutDir "$app-$Modo-$Tag"
    $fase = "$base-fase.txt"; $csv = "$base.csv"; $json = "$base.json"
    'abrir' | Set-Content $fase -NoNewline
    Remove-Item $json -ErrorAction SilentlyContinue
    if ($app -eq 'rust') {
        $a = @("`"$ProjDir`"", '--bench', $Secs, '--bench-idle', $Idle, '--bench-out', "`"$json`"", '--bench-fase', "`"$fase`"")
        if ($Modo -eq 'livre') { $a += '--novsync' }
        $p = Start-Process $RustExe -ArgumentList $a -PassThru
        $m = Medidor $p.Id $csv $fase
        $p.WaitForExit(($Idle + $Secs + 120) * 1000) | Out-Null
        'fim' | Set-Content $fase -NoNewline
    } else {
        # trava 1: a instancia de teste tem de subir o hub na 8371 (settings.json legivel, sem BOM)
        $porta = node -e "const t=require('fs').readFileSync(process.argv[1],'utf8');try{console.log(JSON.parse(t).port)}catch(e){console.log('ilegivel')}" (Join-Path $UserData 'settings.json')
        if ("$porta".Trim() -ne '8371') { throw "settings.json da instancia de teste com porta '$porta' (precisa 8371): abortado para nao tocar no hub da pessoa" }
        $dono8200 = Dono 8200
        $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        # trava 2: USERPROFILE proprio -- o session.json do MCP (~\.nexoeletric) fica fora do da pessoa
        $homeAntes = $env:USERPROFILE
        $env:USERPROFILE = $TestHome
        $env:ALTIUMHUB_USERDATA = $UserData; $env:ALTIUMHUB_WORKSPACE = $Workspace
        $a = @('--remote-debugging-port=9333')
        if ($Modo -eq 'livre') { $a += @('--disable-gpu-vsync', '--disable-frame-rate-limit') }
        $p = Start-Process $ElectronExe -ArgumentList $a -PassThru
        Remove-Item Env:ALTIUMHUB_USERDATA, Env:ALTIUMHUB_WORKSPACE
        $env:USERPROFILE = $homeAntes
        $m = Medidor $p.Id $csv $fase
        try {
            # trava 3: o hub da pessoa (porta 8200) continua com o mesmo dono
            $vigia = Start-Job -ArgumentList $dono8200, $p.Id -ScriptBlock {
                param($dono, $teste)
                while ($true) {
                    Start-Sleep -Milliseconds 500
                    $l = netstat -ano -p TCP | Select-String ':8200\s+0\.0\.0\.0:0\s+\S+\s+(\d+)'
                    $agora = if ($l) { [int]$l.Matches[0].Groups[1].Value } else { 0 }
                    if ($dono -and $agora -ne $dono) { Stop-Process -Id $teste -Force -ErrorAction SilentlyContinue; return "ABORTADO: dono da 8200 mudou de $dono para $agora" }
                }
            }
            $ErrorActionPreference = 'Continue'
            node (Join-Path $PSScriptRoot 'electron.mjs') --cdp 9333 --hub 8371 --projeto $projeto --board (Join-Path $ProjDir 'board.js') --idle $Idle --secs $Secs --fase $fase --out $json --t0 $t0 2>&1 | ForEach-Object { "$_" }
            $ErrorActionPreference = 'Stop'
        } finally {
            $msg = Receive-Job $vigia -ErrorAction SilentlyContinue; Stop-Job $vigia -ErrorAction SilentlyContinue; Remove-Job $vigia -Force -ErrorAction SilentlyContinue
            if ($msg) { Write-Warning $msg }
            'fim' | Set-Content $fase -NoNewline
            Start-Sleep 2
            # encerra so a arvore da instancia de teste (inclusive o python do hub dela)
            Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$UserData*" -or $_.CommandLine -like "*$Workspace*") } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    }
    $m.WaitForExit(30000) | Out-Null
    "$app/$Modo/$Tag -> $csv"
    Start-Sleep 5
}
