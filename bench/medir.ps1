# Mede uma arvore de processos a cada ~1 s: CPU (% de 1 nucleo, somada), memoria (working set e
# privada, somadas), GPU 3D (% do motor, somada) e memoria de GPU (dedicada e compartilhada).
# A fase atual (abrir/parado/animando/fim) vem do arquivo -FaseFile, escrito por quem dirige o teste.
# Para quando a fase vira "fim" ou a arvore morre. Grava CSV em -Out.
#
# Uso: medir.ps1 -RootPid N -Out medidas.csv -FaseFile fase.txt [-MaxSeconds 240]
param([int]$RootPid, [string]$Out, [string]$FaseFile, [int]$MaxSeconds = 240)

function Arvore([int]$root) {
    $todos = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
    $filhos = @{}
    foreach ($p in $todos) {
        if (-not $filhos.ContainsKey([int]$p.ParentProcessId)) { $filhos[[int]$p.ParentProcessId] = New-Object System.Collections.ArrayList }
        [void]$filhos[[int]$p.ParentProcessId].Add([int]$p.ProcessId)
    }
    $out = New-Object System.Collections.ArrayList
    $fila = New-Object System.Collections.Queue
    $fila.Enqueue($root)
    while ($fila.Count) {
        $x = $fila.Dequeue()
        if ($out.Contains($x)) { continue }
        [void]$out.Add($x)
        if ($filhos.ContainsKey($x)) { foreach ($c in $filhos[$x]) { $fila.Enqueue($c) } }
    }
    return $out
}

$cpuAnt = @{}
$tAnt = Get-Date
"t;fase;procs;cpu_pct;ws_mb;priv_mb;gpu3d_pct;gpu_ded_mb;gpu_shr_mb" | Set-Content $Out -Encoding utf8
$inicio = Get-Date
while ($true) {
    $pids = Arvore $RootPid
    $vivos = @($pids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_ })
    if ($vivos.Count -eq 0) { break }
    # o Get-Counter de 1 s e o relogio do laco (a utilizacao de GPU precisa de duas amostras)
    $gpu3d = 0.0; $ded = 0.0; $shr = 0.0
    try {
        $cs = Get-Counter -Counter '\GPU Engine(*engtype_3D)\Utilization Percentage', '\GPU Process Memory(*)\Dedicated Usage', '\GPU Process Memory(*)\Shared Usage' -SampleInterval 1 -MaxSamples 1 -ErrorAction SilentlyContinue
        foreach ($s in $cs.CounterSamples) {
            if ($s.InstanceName -match '^pid_(\d+)_') {
                if ($pids -contains [int]$Matches[1]) {
                    if ($s.Path -like '*utilization percentage') { $gpu3d += $s.CookedValue }
                    elseif ($s.Path -like '*dedicated usage') { $ded += $s.CookedValue }
                    elseif ($s.Path -like '*shared usage') { $shr += $s.CookedValue }
                }
            }
        }
    } catch {}
    $agora = Get-Date
    $dt = ($agora - $tAnt).TotalMilliseconds
    $cpu = 0.0; $ws = 0; $priv = 0
    foreach ($p in $vivos) {
        $p.Refresh()
        $c = $p.TotalProcessorTime.TotalMilliseconds
        if ($cpuAnt.ContainsKey($p.Id)) { $cpu += ($c - $cpuAnt[$p.Id]) }
        $cpuAnt[$p.Id] = $c
        $ws += $p.WorkingSet64; $priv += $p.PrivateMemorySize64
    }
    $tAnt = $agora
    $fase = if (Test-Path $FaseFile) { (Get-Content $FaseFile -Raw).Trim() } else { 'abrir' }
    $t = [math]::Round(($agora - $inicio).TotalSeconds, 2)
    $linha = "{0};{1};{2};{3:F2};{4:F1};{5:F1};{6:F2};{7:F1};{8:F1}" -f $t, $fase, $vivos.Count, ($cpu / $dt * 100), ($ws / 1MB), ($priv / 1MB), $gpu3d, ($ded / 1MB), ($shr / 1MB)
    Add-Content $Out ($linha -replace ',', '.')
    if ($fase -eq 'fim' -or $t -gt $MaxSeconds) { break }
}
