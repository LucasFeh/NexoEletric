"""Resumo do comparativo: junta os CSV do medir.ps1 e os JSON do condutor por app e modo.
Uso: python resumo.py <pasta-de-resultados> [saida.json]"""
import csv
import glob
import json
import os
import statistics as st
import sys

pasta = sys.argv[1]
saida = sys.argv[2] if len(sys.argv) > 2 else os.path.join(pasta, 'resumo.json')
grupos = {}
for j in sorted(glob.glob(os.path.join(pasta, '*-*-*.json'))):
    base = j[:-5]
    app, modo, tag = os.path.basename(base).split('-')[:3]
    if not os.path.exists(base + '.csv'):
        continue
    r = json.load(open(j, encoding='utf-8'))
    linhas = list(csv.DictReader(open(base + '.csv', encoding='utf-8-sig'), delimiter=';'))
    fases = {}
    for l in linhas:
        fases.setdefault(l['fase'], []).append(l)
    med = {}
    for f in ('abrir', 'parado', 'animando'):
        ls = fases.get(f, [])
        if f == 'parado':
            ls = ls[3:] or ls          # os primeiros segundos ainda sao o fim da abertura
        if not ls:
            continue
        g = lambda k: [float(x[k]) for x in ls]
        med[f] = {
            'amostras': len(ls), 'processos': max(int(x['procs']) for x in ls),
            'cpu_pct': st.mean(g('cpu_pct')), 'cpu_pct_max': max(g('cpu_pct')),
            'ws_mb': st.mean(g('ws_mb')), 'ws_mb_max': max(g('ws_mb')),
            'priv_mb': st.mean(g('priv_mb')), 'gpu3d_pct': st.mean(g('gpu3d_pct')),
            'gpu_ded_mb': st.mean(g('gpu_ded_mb')), 'gpu_shr_mb': st.mean(g('gpu_shr_mb')),
        }
    grupos.setdefault((app, modo), []).append({'tag': tag, 'abrir_ms': r.get('abrir_ms'), 'fps': r.get('fps_medio'),
                                               'quadro_p95': r.get('quadro_ms', {}).get('p95'), 'area': r.get('area_px'), 'fases': med})

def media(rs, *ch):
    v = []
    for r in rs:
        x = r
        for c in ch:
            x = x.get(c) if isinstance(x, dict) else None
        if isinstance(x, (int, float)):
            v.append(x)
    return st.mean(v) if v else None

tabela = {}
for (app, modo), rs in sorted(grupos.items()):
    t = {'execucoes': len(rs), 'abrir_s': (media(rs, 'abrir_ms') or 0) / 1000, 'fps': media(rs, 'fps'), 'quadro_p95_ms': media(rs, 'quadro_p95')}
    for f in ('parado', 'animando'):
        for k in ('cpu_pct', 'ws_mb', 'ws_mb_max', 'priv_mb', 'gpu3d_pct', 'gpu_ded_mb', 'processos'):
            t[f'{f}.{k}'] = media(rs, 'fases', f, k)
    tabela[f'{app}/{modo}'] = t
json.dump({'tabela': tabela, 'execucoes': {f'{a}/{m}': rs for (a, m), rs in grupos.items()}}, open(saida, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

cols = list(tabela)
print('%-26s' % 'medida' + ''.join('%22s' % c for c in cols))
for k in tabela[cols[0]]:
    print('%-26s' % k + ''.join('%22s' % (('%.1f' % tabela[c][k]) if isinstance(tabela[c][k], (int, float)) else '-') for c in cols))
