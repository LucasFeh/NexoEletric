# -*- coding: utf-8 -*-
"""A parte PURA do casamento BoM x esquema: sem rede, sem Odoo, sem as Libs reais.

    python tests/test_odoobom.py

O que este arquivo existe para impedir, em ordem de importancia:

  1. VINCULO ERRADO APLICADO. A tela reescreve `sym`/`comment`/`params` de componente de
     placa real. Errar por omissao (mandar para a mao o que daria para sugerir) custa um
     clique; errar por comissao troca o componente de uma placa. Todo empate vai para a mao,
     e e isso que a secao (5) prende.
  2. VALOR ELETRICO INVENTADO. A primeira versao colhia "74" de SN74HC245DWR como 74 henries
     e "3.96mm" como 3,96 mili, e dava 50 pontos a quem nao merecia nenhum. Secao (1).
  3. AGRUPAR POR ITEM em vez de por designador. CN1 sao 16 itens `comp` (uma via cada) e a
     BoM pede 1 conector; agrupar por item pediria 16. Secao (3).
  4. FUNDIR R3 e R4. Os dois carregam o mesmo `comment` de formula do Altium que nunca foi
     avaliada (`=Value + ...`), entao a chave do grupo TEM de incluir o params. Secao (4).
"""
import io
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)
sys.path.insert(0, RAIZ)

import odoobom as B                                       # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def comp(ref, sym, fp, comment='', params='', part=1, x=1000, y=1000):
    return {'t': 'comp', 'sheet': 'main', 'ref': ref, 'sym': sym, 'part': part,
            'x': x, 'y': y, 'rot': 0, 'footprint': fp, 'comment': comment, 'params': params}


def linha(pid, nome, qtd=1.0, seq=1, categoria=''):
    return {'product_id': pid, 'nome': nome, 'qtd': qtd, 'sequencia': seq, 'categoria': categoria}


def reg(familia, altium, label='', value='', mpn='', pkgs=(), footprint='', vid=1):
    return {'familia': familia, 'altium': altium, 'label': label or altium, 'value': value,
            'mpn': mpn, 'pkgs': list(pkgs), 'footprint': footprint, 'id': vid,
            'params': [], 'valor': {}}


# ── (1) valor eletrico: quando fala, nao erra ────────────────────────────────
ve = B.valores_eletricos
assert ve('SN74HC245DWR') == set(), 'parte de part number nao e valor: %s' % ve('SN74HC245DWR')
assert ve('Kk 4 vias 3.96mm 180') == set(), 'dimensao em mm nao e valor: %s' % ve('Kk 4 vias 3.96mm 180')
assert ve('SOD3716X135N') == set(), 'codigo de encapsulamento nao e valor'
assert ve('0.1uF / 100nF 16V') == {1e-07}, ve('0.1uF / 100nF 16V')
assert ve('10uF 16V') == {1e-05}
assert ve('120R 1%') == {120.0}
assert ve('4.7nF/0.0047uF 63V') == {4.7e-09}
# ohm sem unidade so vale onde OHM e obvio: designador R
assert ve('SMD 0805 10K 1/4W 1% 100ppm') == set(), 'sem ohm=True, 10K nao e valor'
assert ve('SMD 0805 10K 1/4W 1% 100ppm', True) == {10000.0}
assert ve('47K', True) == {47000.0}
assert ve('4R7', True) == {4.7}
assert ve('1M2', True) == {1200000.0}
print('(1) valor eletrico: 74 de SN74 e 3.96mm nao viram medida; uF/nF/R/K viram ok')

# ── (2) contencao, nao Jaccard ───────────────────────────────────────────────
curto, longo = B.tokens('CONECTOR LATCH FEMEA'), B.tokens('[G-51-3] Conector Latch 16 vias (2x8) passo 2.54mm 180')
assert B.contem(curto, longo) == 1.0, 'o footprint cabe INTEIRO no nome do Odoo: %s' % B.contem(curto, longo)
assert B.contem(longo, curto) < 0.3, 'a contencao nao e simetrica, e e por isso que ela serve'
assert B.contem(set(), longo) == 0.0 and B.contem(curto, set()) == 0.0
print('(2) contencao: o footprint que casa inteiro tira 100%%, nao 12%% — e o que tira o CN1 do descarte')

# ── (3) 16 itens de CN1 sao UM componente ────────────────────────────────────
itens = [comp('CN1', 'CONECTOR PADRÃO', 'CONECTOR LATCH FEMEA', '16 VIAS', part=p, y=1000 + p * 200)
         for p in range(1, 17)]
itens += [comp('C4', 'CAP [  SMD  ]', 'CAP 0805', '=Value', 'Value=0.1uF'),
          comp('C6', 'CAP [  SMD  ]', 'CAP 0805', '=Value', 'Value=0.1uF')]
cs = B.componentes(itens)
assert len(cs) == 3, 'CN1(16 partes) + C4 + C6 = 3 componentes, nao %d' % len(cs)
cn1 = next(c for c in cs if c['ref'] == 'CN1')
assert cn1['partes'] == 16 and cn1['multiparte'] is True
assert cn1['carreg']['part'] == 1, 'a parte 1 carrega a identidade, nao a 16'
assert next(c for c in cs if c['ref'] == 'C4')['multiparte'] is False
print('(3) 18 itens comp -> 3 componentes; CN1 e um so, com a parte 1 como portadora')

# ── (4) a chave do grupo inclui o params, senao R3 e R4 viram um ─────────────
FORMULA = "=Value + ' - ' + Potência"
rs = [comp('R3', 'RES [ SMD ]', '1206 resistor', FORMULA, 'Value=10R'),
      comp('R4', 'RES [ SMD ]', '1206 resistor', FORMULA, 'Value=47K')]
gs = B.grupos_do_esquema(rs)
assert len(gs) == 2, 'R3 (10R) e R4 (47K) nao podem cair no mesmo grupo: %d grupo(s)' % len(gs)
assert {g['valor_txt'] for g in gs} == {'10R', '47K'}
# e o texto efetivo ignora a formula, que nao diz nada
g10 = next(g for g in gs if g['valor_txt'] == '10R')
assert FORMULA not in g10['texto'] and '10R' in g10['texto'], g10['texto']
# ja dois capacitores identicos sao UM grupo de dois refs
gc = B.grupos_do_esquema([comp('C4', 'CAP [  SMD  ]', 'CAP 0805', '=V', 'Value=0.1uF'),
                          comp('C6', 'CAP [  SMD  ]', 'CAP 0805', '=V', 'Value=0.1uF')])
assert len(gc) == 1 and gc[0]['refs'] == ['C4', 'C6']
print('(4) R3 e R4 ficam separados pelo params; C4 e C6 identicos viram um grupo de dois')

# ── (5) empate entre duas linhas pelo MESMO grupo: nenhuma pre-selecionada ───
grupos_kk = B.grupos_do_esquema([comp('CN4', 'CONECTOR PADRÃO', 'KK 3.96 4p', 'KK / 3.96mm/ 4 vias', part=p)
                                 for p in range(1, 5)])
por_odoo = {
    '2512': reg('CONECTOR 4V', 'Kk 4 vias Fêmea, passo 3.96mm, 180º 13mm', vid=11),
    '1432': reg('CONECTOR 4V', 'Kk 4 vias macho, passo 3.96mm, 180º 13mm', vid=12),
}
linhas_kk = [linha(2512, '[G-117-7] Conector Kk 4 vias Fêmea, passo 3.96mm, 180º PTH 13mm'),
             linha(1432, '[G-117-7] Conector Kk 4 vias macho, passo 3.96mm, 180º PTH 13mm')]
sug, desc = B.casa(linhas_kk, grupos_kk, por_odoo)
assert len(sug) == 2, sug
assert all(s['confianca'] == 'mao' for s in sug), \
    'empate exato nao pode pre-selecionar ninguem: %s' % [(s['componente'], s['confianca']) for s in sug]
assert all(s.get('empatadaCom') for s in sug), 'cada uma tem de NOMEAR a outra'
assert 'macho' in sug[0]['aviso'].lower() or 'macho' in sug[1]['aviso'].lower()
print('(5) o par KK macho/femea empata e as DUAS vao para a mao, nomeando uma a outra')

# ── (6) o valor eletrico separa o que o texto nao separa ─────────────────────
grupos_r = B.grupos_do_esquema([comp('R1', 'RES [ SMD ]', 'RES 1206', '=V', 'Value=10K'),
                                comp('R3', 'RES [ SMD ]', '1206 resistor', '=V', 'Value=10R')])
r10k = reg('RESISTOR [SMD]', 'SMD 0805 10K 1/4W 1% 100ppm', value='10K', pkgs=['0805'], vid=7)
sug, desc = B.casa([linha(903, '[G-157-7] Resistor de Filme Espesso 10K 1/4W 1% 100ppm SMD 1206')],
                   grupos_r, {'903': r10k})
assert len(sug) == 1 and not desc, (sug, desc)
alvo = next(g for g in grupos_r if g['id'] == sug[0]['grupo'])
assert alvo['refs'] == ['R1'], 'o 10K tem de ir para o R1 (10K), nao para o R3 (10R): %s' % alvo['refs']
assert sug[0]['confianca'] == 'alta'
assert any('valor eletrico' in z for z in sug[0]['razoes'])
print('(6) o 10K da BoM vai para o R1 e nao para o R3, pelo valor — os dois tem o mesmo comment')

# ── (7) o gate do designador barra familia errada ────────────────────────────
gc4 = B.grupos_do_esquema([comp('C4', 'CAP [  SMD  ]', 'CAP 0805', '=V', 'Value=0.1uF')])
p_res, _ = B.pontua(reg('RESISTOR [SMD]', 'SMD 0805 10K', value='10K', pkgs=['0805']), gc4[0])
assert p_res == 0, 'resistor nao pode pontuar num designador C, mesmo com o mesmo 0805: %d' % p_res
p_cap, _ = B.pontua(reg('CAPACITOR CERAMICO [SMD]', 'SMD 0805 0.1uF / 100nF 16V',
                        value='0.1uF', pkgs=['0805']), gc4[0])
assert p_cap > 0
print('(7) o gate barra o resistor no designador C — sem ele, "0805" casaria os dois')

# ── (8) REGRA 0: insumo nao disputa grupo com ninguem ────────────────────────
assert B.e_insumo(linha(1, 'Fio Flexível Preto Rolo 100m', categoria='Fios e Cabos'), reg('X', 'y'))
assert B.e_insumo(linha(2, 'qualquer coisa'), None), 'sem product_id no espelho = nao e componente'
assert B.e_insumo(linha(3, 'Conector Latch 6 Vias com Cabo Flat 30cm', categoria='Fios e Cabos'), reg('X', 'y'))
assert not B.e_insumo(linha(4, 'Capacitor Cerâmico 0.1uF', categoria='Capacitores'), reg('X', 'y'))
# a categoria so vale como VETO: o SN74HC245DWR esta arquivado sob "Broca Aco Rapido"
assert not B.e_insumo(linha(5, 'Transceptor SN74HC245DWR', categoria='Broca Aço Rápido'), reg('X', 'y'))
print('(8) fio, cabo e fora-do-espelho saem pela REGRA 0; categoria estranha nao derruba componente')

# ── (9) a lista INVERSA: grupo do esquema sem linha na BoM ───────────────────
tmp = os.path.join(BASE, '_tmp_odoobom')
os.makedirs(os.path.join(tmp, 'Projects', 'P'), exist_ok=True)
os.makedirs(os.path.join(tmp, 'Libs'), exist_ok=True)
with io.open(os.path.join(tmp, 'Projects', 'P', 'schematic.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('var schematic = {\n"format":"schmirror-v2",\n"items":[\n')
    f.write(json.dumps(comp('C4', 'CAP [  SMD  ]', 'CAP 0805', '=V', 'Value=0.1uF'), ensure_ascii=False) + ',\n')
    f.write(json.dumps(comp('T1', 'SQJ431AEP-T1_GE3', 'SQJ402EPT1', 'SQJ431AEP-T1_GE3'), ensure_ascii=False) + '\n')
    f.write(']};\n')
with io.open(os.path.join(tmp, 'Libs', 'almox-basicos.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('var almoxBasicos = ' + json.dumps({'symbols': [{
        'name': 'CAPACITOR CERAMICO [SMD]',
        'valores': [{'altium': 'SMD 0805 0.1uF / 100nF 16V', 'label': '0.1uF / 100nF 16V',
                     'value': '0.1uF', 'id': 3, 'pkgs': ['0805'], 'params': [],
                     'itens': [{'odoo': 116}]}]}]}, ensure_ascii=False) + ';\n')
r = B.monta(tmp, 'P', [linha(116, '[G-161-4] Capacitor Cerâmico 0.1uF / 100nF 16V SMD 0805', 2.0)])
assert len(r['grupos']) == 2
assert len(r['sugestoes']) == 1 and r['sugestoes'][0]['componente'] == 'SMD 0805 0.1uF / 100nF 16V'
ids_sem = set(r['semLinha'])
gt1 = next(g for g in r['grupos'] if g['refs'] == ['T1'])
assert gt1['id'] in ids_sem, 'o T1 nao tem linha na BoM e TEM de aparecer na lista inversa'
assert r['sugestoes'][0]['grupo'] not in ids_sem
import shutil                                             # noqa: E402
shutil.rmtree(tmp, ignore_errors=True)
print('(9) o grupo sem linha na BoM sai em `semLinha` — a segunda lista da tela')

print('\ntest_odoobom OK (valor que nao inventa, contencao, agrupar por designador, '
      'params na chave, empate para a mao, gate, REGRA 0 e a lista inversa)')
