# -*- coding: utf-8 -*-
"""A extração de símbolos: fingerprint, classificação por forma e mescla incremental.

    python tests/test_extrair.py

(a) fixtures pequenas, sem arquivo: normaliza, fingerprint, classifica, escolha da descricao,
    mescla, gravar/ler;
(b) a biblioteca da casa publicada no repo (Libs/BIBLIOTECA DE ESQUEMA.SchLib) duas vezes: a segunda não adiciona nada, ids estáveis, renomear sobrevive,
    RES [ SMD ] e RES [ PTH ] viram UMA entrada com 2 aliases, e os básicos óbvios saem com o
    nome certo. Imprime a tabela nome básico -> quantos, para conferir as heurísticas;
(c) a CLI de ponta a ponta, com --fonte/--saida/--relatorio no tmp;
(d) um .SchDoc e um .IntLib reais do Y: passam pelo caminho inteiro (PULA se a rede não está).
"""
import copy
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))
import extrair as E  # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# A biblioteca da casa publicada dentro do repositorio (tools/libpath.py). Era um
# caminho de maquina (D:/ ou a UNC do PC do Lucas), entao este teste PULAVA em
# silencio em qualquer clone que nao fosse o da bancada -- inclusive no servidor.
LIB_LOCAL = os.path.join(RAIZ, 'Libs', 'BIBLIOTECA DE ESQUEMA.SchLib')
DMB = r'Y:\EQUIPAMENTOS_REVISADOS\DMB - DI231765 - DISPLAY ASCII PARA MARCAÇÃO DE BOBINAS\PCB E SCH'
INTLIB = r'Y:\EQUIPAMENTOS_REVISADOS\PAM - DI221694 - MÓDULO AMPLIFICADOR MAGNÉTICO\PROJETO\MODULO AMP MAG.IntLib'
HOJE = '2026-09-03'


def quieto(msg):
    pass


def basico(nome):
    """o nome sem os desempates de colisão: ' #2' e ' (origem)'"""
    return re.sub(r' \([^()]*\)$', '', re.sub(r' #\d+$', '', nome))


# ─── fixtures ─────────────────────────────────────────────────────────────────
def pin(num, x, y, orient, name=None, ln=100):
    return {'num': num, 'name': name if name is not None else num, 'x': x, 'y': y,
            'len': ln, 'orient': orient, 'type': 'Passive'}


def res(dx=0):
    """o RES [ SMD ] da lib: retângulo e dois pinos no eixo"""
    return ([pin('2', 50 + dx, 0, 0), pin('1', -150 + dx, 0, 180)],
            [{'g': 'rect', 'x1': -150 + dx, 'y1': -40, 'x2': 50 + dx, 'y2': 40, 'solid': False}])


def npn():
    """o 2N3904 da lib"""
    return ([pin('1', 180, 120, 90, 'C'), pin('2', 80, 20, 180, 'B'), pin('3', 180, -80, 270, 'E')],
            [{'g': 'line', 'x1': 180, 'y1': 120, 'x2': 80, 'y2': 50, 'w': 4},
             {'g': 'line', 'x1': 80, 'y1': -10, 'x2': 180, 'y2': -80, 'w': 4},
             {'g': 'line', 'x1': 80, 'y1': 110, 'x2': 80, 'y2': -70, 'w': 4},
             {'g': 'poly', 'pts': [[180, -80], [150, -30], [120, -70]], 'solid': True}])


def pnp():
    """o BC807 da lib: a seta nasce na barra e aponta para ela"""
    return ([pin('3', 100, 100, 90, 'C'), pin('1', 0, 0, 180, 'B'), pin('2', 100, -100, 270, 'E')],
            [{'g': 'line', 'x1': 0, 'y1': 90, 'x2': 0, 'y2': -90, 'w': 4},
             {'g': 'line', 'x1': 100, 'y1': 100, 'x2': 0, 'y2': 30, 'w': 4},
             {'g': 'line', 'x1': 30, 'y1': -50, 'x2': 100, 'y2': -100, 'w': 4},
             {'g': 'poly', 'pts': [[0, -30], [60, -40], [30, -80]], 'solid': True}])


def ci(n=5):
    pins = [pin(str(i + 1), -300, 100 * i, 0, 'P%d' % i) for i in range(n)]
    return pins, [{'g': 'rect', 'x1': -200, 'y1': -100, 'x2': 200, 'y2': 100 * n, 'solid': False}]


# ─── (a) unidades ─────────────────────────────────────────────────────────────
def testa_normaliza():
    pins = [pin('b', 100.4, 0.2, 0), pin('a', -100.49, 0, 180, ln=78.74)]
    gr = [{'g': 'arc', 'cx': 0, 'cy': 0, 'r': 49.6, 'sa': 179.988, 'ea': 209.004, 'w': 4},
          {'g': 'line', 'x1': 0, 'y1': 0, 'x2': 10.5, 'y2': 0, 'w': 4}]
    p, g = E.normaliza(pins, gr)
    assert [q['num'] for q in p] == ['a', 'b'], p                      # ordenado por x
    assert p[0]['x'] == -100 and p[0]['len'] == 79 and p[1]['x'] == 100 and p[1]['y'] == 0
    assert g[0]['g'] == 'arc' and g[0]['r'] == 50 and g[0]['sa'] == 179.99 and g[0]['ea'] == 209
    assert g[1]['x2'] == 10 or g[1]['x2'] == 11                        # 1 mil, sem drama no empate
    # ordem canônica: os mesmos gráficos em ordem trocada saem iguais
    p2, g2 = E.normaliza(pins, gr[::-1])
    assert g2 == g and p2 == p
    # escrita canônica: o mesmo desenho escrito de outro jeito dá o mesmo gráfico
    G = E._grafico
    arco = {'g': 'arc', 'cx': 0, 'cy': 0, 'r': 50, 'sa': 270, 'ea': 90, 'w': 4}
    assert G(arco) == G(dict(arco, ea=450)), 'arco que cruza 0°: ea acima de 360 (o localiza) ou abaixo de sa (a lib)'
    assert G(dict(arco, sa=90, ea=450)) == G(dict(arco, sa=0, ea=360)) == G(dict(arco, sa=90, ea=90)), 'círculo é 0→360'
    assert G({'g': 'rect', 'x1': 100, 'y1': -900, 'x2': -200, 'y2': 900}) == \
        G({'g': 'rect', 'x1': -200, 'y1': -900, 'x2': 100, 'y2': 900, 'w': 10}), 'cantos trocados e w não entram'
    assert G({'g': 'line', 'x1': 10, 'y1': 5, 'x2': 0, 'y2': 0, 'w': 4}) == G({'g': 'line', 'x1': 0, 'y1': 0, 'x2': 10, 'y2': 5, 'w': 4})
    assert G({'g': 'polyline', 'pts': [[10, 10], [5, 0], [0, 0]]}) == G({'g': 'polyline', 'pts': [[0, 0], [5, 0], [10, 10]]})
    tri = G({'g': 'poly', 'pts': [[0, 0], [10, 0], [10, 10]], 'solid': True})
    assert G({'g': 'poly', 'pts': [[10, 10], [0, 0], [10, 0], [10, 10]], 'solid': True}) == tri, 'rotação e fecho explícito'
    assert G({'g': 'poly', 'pts': [[10, 0], [0, 0], [10, 10]], 'solid': True}) == tri, 'sentido invertido'
    assert E._i(float('inf')) == 0 and E._a(float('nan')) == 0 and E._i('x') == 0, 'lixo vira 0, não exceção'
    # cor não é identidade: fica no gráfico normalizado (no fim), fora do fingerprint e da ordem
    cores = [dict(gr[1], color='#ff0000'), dict(gr[0], color='#0000ff')]
    pc, gc = E.normaliza(pins, cores)
    assert [h['g'] for h in gc] == [h['g'] for h in g] and gc[0]['color'] == '#0000ff' and gc[1]['color'] == '#ff0000', gc
    assert list(gc[1].keys())[-1] == 'color' and E._identidade(gc[1]) == g[1]
    assert E.fingerprint(pins, cores, 'generico') == E.fingerprint(pins, gr, 'generico')
    assert E.fingerprint(pins, [dict(c, color='#123456') for c in cores], 'ci') == E.fingerprint(pins, gr, 'ci')
    rc = {'g': 'rect', 'x1': 0, 'y1': 0, 'x2': 10, 'y2': 10, 'solid': True, 'color': '#800000', 'fill': '#ffffb0'}
    assert list(G(rc).keys()) == ['g', 'x1', 'y1', 'x2', 'y2', 'solid', 'color', 'fill'], list(G(rc).keys())
    assert 'color' not in G(dict(rc, color='RED')) and 'fill' not in G(dict(rc, fill='#FFFFB0')), 'só #rrggbb minúsculo'
    assert E.fingerprint([], [rc], 'generico') == E.fingerprint([], [dict(rc, color='#000000', fill='#00ff00')], 'generico') \
        == E.fingerprint([], [{k: v for k, v in rc.items() if k not in ('color', 'fill')}], 'generico')
    # visibilidade do texto do pino: viaja no símbolo guardado (é o "olho" que o usuário vê),
    # mas não é identidade — fica fora do fingerprint, e ausente continua querendo dizer visível
    esc = [dict(q, hideNum=True, hideName=True) for q in pins]
    pe, ge = E.normaliza(esc, gr)
    assert ge == g and [(q['num'], q['x']) for q in pe] == [(q['num'], q['x']) for q in p]
    assert all(q['hideNum'] and q['hideName'] for q in pe) and list(pe[0].keys())[-2:] == ['hideNum', 'hideName']
    assert not any('hideNum' in q or 'hideName' in q for q in E.normaliza(pins, gr)[0]), 'ausente = visível'
    assert E.fingerprint(esc, gr, 'ci') == E.fingerprint(pins, gr, 'ci') and E.fingerprint(esc, gr, 'generico') == E.fingerprint(pins, gr, 'generico')
    # o que o leitor devolve de um símbolo colocado numa folha casa com o da biblioteca
    import sch_leitor as L
    pl, gl = L.localiza(pins, [arco], 0, 0, 0, False)
    assert gl[0]['ea'] > 360 and E.fingerprint(pl, gl, 'generico') == E.fingerprint(pins, [arco], 'generico')
    pm, gm = L.localiza(pins, [{'g': 'rect', 'x1': -200, 'y1': -900, 'x2': 100, 'y2': 900, 'solid': False}], 0, 0, 0, True)
    assert gm[0]['x1'] > gm[0]['x2'] and E.normaliza(pm, gm)[1][0]['x1'] == -100, 'espelhado: cantos trocados, canônico em ordem'


def testa_fingerprint():
    pins, gr = res()
    fp = E.fingerprint(pins, gr, 'generico')
    assert len(fp) == 16 and all(c in '0123456789abcdef' for c in fp)
    outros = [dict(q, num='X' + q['num'], name='Y' + q['name']) for q in pins]
    assert E.fingerprint(outros, gr, 'generico') == fp, 'genérico ignora num/name'
    assert E.fingerprint(outros, gr, 'ci') != E.fingerprint(pins, gr, 'ci'), 'ci compara num/name'
    assert E.fingerprint(pins[::-1], gr[::-1], 'generico') == fp, 'ordem não importa'
    assert E.fingerprint(*res(dx=10), kind='generico') != fp, 'não recentra: deslocado é outro'
    assert E.fingerprint(pins, gr, 'ci') != fp, 'o kind entra na chave'


def testa_classifica():
    assert E.classifica(*res(), nome_origem='RES [ SMD ]') == ('generico', 'Resistor')
    assert E.classifica(*npn(), nome_origem='2N3904') == ('generico', 'Transistor NPN')
    assert E.classifica(*pnp(), nome_origem='BC807') == ('generico', 'Transistor PNP')
    assert E.classifica(*ci(), nome_origem='SN74HC245DWR') == ('ci', 'SN74HC245DWR')
    assert E.classifica(*ci(), nome_origem='LM324', part=2, partcount=4) == ('ci', 'LM324 · parte 2/4')
    # sem forma conhecida: nome de origem limpo; multi-part ganha o sufixo
    pins = [pin('1', -100, 0, 180), pin('2', 100, 0, 0)]
    gr = [{'g': 'label', 'x': 0, 'y': 0, 'text': 'X', 'rot': 0, 'size': 10}]
    assert E.classifica(pins, gr, 'FOO [  SMD  ]') == ('generico', 'FOO')
    assert E.classifica(pins, gr, 'FOO PTH', 1, 2) == ('generico', 'FOO · parte 1/2')
    assert E._limpa('DIODO [ ZENER ] SMD') == 'DIODO [ ZENER ]'
    assert E._limpa('  [PTH]  ') == '[PTH]', 'não pode ficar vazio'
    # reconhecido multi-part NÃO ganha sufixo (as partes iguais se fundem pelo fingerprint)
    assert E.classifica(*res(), nome_origem='Relé X', part=2, partcount=3) == ('generico', 'Resistor')
    # 1 pino: círculo pequeno é ponto de conexão; qualquer outro desenho fica com o nome de origem
    um = [pin('1', -100, 0, 180)]
    assert E.classifica(um, [{'g': 'ellipse', 'cx': 0, 'cy': 0, 'rx': 20, 'ry': 20, 'solid': False}], 'Cone') == ('generico', 'Conector 1 via')
    assert E.classifica(um, [{'g': 'rect', 'x1': 0, 'y1': -50, 'x2': 100, 'y2': 50, 'solid': False}], 'TEST POINT PTH') == ('generico', 'TEST POINT')


def testa_desc():
    """a descrição que sobrevive ao desempate (a regra está na docstring do extrair)"""
    assert E._desc('  RESISTOR   DE\n  FIO ') == 'RESISTOR DE FIO', 'corrida de espaço vira uma só'
    assert E._desc('AJUDA') == '' and E._desc(' ajuda ') == '' and E._desc(None) == ''
    assert E._desc('AJUDA FINA') == 'AJUDA FINA', 'só o placeholder exato sai'
    C = lambda **kw: Counter(kw)
    # (ii) a mais frequente
    assert E._escolhe_desc((C(), Counter({'Resistor': 3, 'Resistor de precisao 1%': 2})))[0] == 'Resistor'
    # (iii) empate na frequência: a mais longa, que diz mais
    assert E._escolhe_desc((C(), Counter({'Resistor': 2, 'Resistor Metal Filme': 2})))[0] == 'Resistor Metal Filme'
    # (iv) empate no tamanho: ordem alfabética, para duas rodadas darem o mesmo arquivo
    assert E._escolhe_desc((C(), Counter({'Resistor SMD': 1, 'Resistor PTH': 1})))[0] == 'Resistor PTH'
    # (i) a da casa ganha de uma bem mais frequente, mas so ate o piso: o fingerprint e
    # GRAFICO e a casa descreve a FORMA (resistor, fusivel e PTC sao o mesmo retangulo).
    # No piso (10 %) ela ainda ganha...
    esc, todas = E._escolhe_desc((Counter({'Resistor Metal Filme': 1}), Counter({'RESISTOR': 10})))
    assert esc == 'Resistor Metal Filme' and todas == [('RESISTOR', 10), ('Resistor Metal Filme', 1)]
    assert E._escolhe_desc((Counter({'Resistor Metal Filme': 3}), Counter({'RESISTOR': 10})))[0] == 'Resistor Metal Filme'
    # ... abaixo dele a frequencia manda. E o caso medido de verdade: a casa chama aquele
    # retangulo de "FUSIVEL" 6 vezes e os projetos chamam de "Resistor Metal Filme" 2668.
    assert E._escolhe_desc((Counter({'Resistor Metal Filme': 1}), Counter({'RESISTOR': 300})))[0] == 'RESISTOR'
    assert E._escolhe_desc((Counter({'FUSIVEL': 6}), Counter({'Resistor Metal Filme': 2668})))[0] \
        == 'Resistor Metal Filme', 'a casa esmagada pela frequencia nao manda no rotulo'
    # e a conta e com o que a CASA disse, nao com o total da frase: a descricao viaja
    # com o componente colocado, entao projeto que usa o simbolo da casa repete a frase
    # dela -- medido no capacitor, 74 ocorrencias e 72 sao copias da propria casa
    assert E._escolhe_desc((Counter({'CAPACITOR CERAMICO CAPACITOR POLIESTER': 2}),
                            Counter({'Capacitor Ceramico': 356,
                                     'CAPACITOR CERAMICO CAPACITOR POLIESTER': 72})))[0] \
        == 'Capacitor Ceramico', 'o eco da casa no acervo nao e voto novo'
    # a grafia com o byte morto (U+FFFD, que ja vem assim do arquivo) e a MESMA frase:
    # soma na gemea limpa, senao a frequencia elege o rotulo ilegivel
    esc, todas = E._escolhe_desc((C(), Counter({'Resistor Vari\ufffdvel NTC': 10,
                                               'Resistor Vari\u00e1vel NTC': 4})))
    assert esc == 'Resistor Vari\u00e1vel NTC' and todas == [('Resistor Vari\u00e1vel NTC', 14)], todas
    # sem gemea limpa, a danificada segue candidata: adivinhar a letra seria inventar dado
    assert E._escolhe_desc((C(), Counter({'Regulador de tens\ufffdo': 4})))[0] == 'Regulador de tens\ufffdo'
    # duas gemeas possiveis: nao da para saber qual, e ninguem funde nada
    amb = E._escolhe_desc((C(), Counter({'Rel\ufffd X': 5, 'Rel\u00e9 X': 1, 'Rel\u00c9 X': 1})))
    assert amb[0] == 'Rel\ufffd X' and len(amb[1]) == 3, amb
    assert E._escolhe_desc((C(), C())) == ('', [])
    assert E.PISO_CASA == 0.10, 'o piso e uma constante nomeada, nao um numero solto'


def testa_mescla(tmp):
    achados = [('A.SchLib', 'RES [ SMD ]', 'Resistor Metal Filme', 1, 1) + res(),
               ('A.SchLib', 'RES [ PTH ]', 'AJUDA', 1, 1) + res(),
               ('B.SchDoc', 'RES', 'Resistor', 1, 1) + res(),
               ('B.SchDoc', '2N3904', '', 1, 1) + npn(),
               ('B.SchDoc', 'XYZ', 'Memoria serial', 1, 1) + ci()]
    lib, r = E.mescla(None, achados, HOJE, log=quieto)
    assert r['novos'] == 3 and r['repetidos'] == 2 and r['arquivos'] == 2, r
    ids = [s['id'] for s in lib['symbols']]
    assert ids == ['s0001', 's0002', 's0003'], ids
    assert [s['name'] for s in lib['symbols']] == ['Resistor', 'Transistor NPN', 'XYZ'], 'novos por nome'
    R = lib['symbols'][0]
    assert R['kind'] == 'generico' and R['usos'] == 3 and R['desde'] == HOJE
    assert R['aliases'] == ['RES [ SMD ]', 'RES [ PTH ]', 'RES'] and R['fontes'] == ['A.SchLib', 'B.SchDoc']
    # a descrição: "AJUDA" não concorre e, no empate de frequência, a mais longa ganha
    assert R['desc'] == 'Resistor Metal Filme', R['desc']
    assert [s['desc'] for s in lib['symbols'][1:]] == ['', 'Memoria serial']
    assert [(n, v) for n, v, _ in r['desc_disputadas']] == [('Resistor', 'Resistor Metal Filme')], r['desc_disputadas']
    assert lib['symbols'][2]['kind'] == 'ci'
    assert r['classes']['Resistor'] == 3 and r['classes']['(ci) XYZ'] == 1

    # a ordem de chegada não muda nomes, ids nem a descrição escolhida
    lib_b, _ = E.mescla(None, achados[::-1], HOJE, log=quieto)
    assert [(s['id'], s['name'], s['fp'], s['desc']) for s in lib_b['symbols']] == \
        [(s['id'], s['name'], s['fp'], s['desc']) for s in lib['symbols']]

    # gravar e ler de volta
    caminho = os.path.join(tmp, 'sub', 'symbols-lib.js')
    E.escreve_symlib(lib, caminho)
    texto = open(caminho, encoding='utf-8').read()
    assert texto.startswith('var symbolsLib = {\n"format":"symlib-v1",') and texto.endswith(']};\n')
    assert texto.count('\n{"id"') == 1 and texto.count('\n,{"id"') == 2, 'um símbolo por linha'
    lido = E.le_symlib(caminho)
    assert lido['symbols'] == lib['symbols'] and lido['format'] == 'symlib-v1'
    assert E.le_symlib(os.path.join(tmp, 'nao-existe.js')) is None

    # segunda rodada da MESMA fonte: nada novo, usos não dobra, renomear sobrevive
    lido['symbols'][0]['name'] = 'Resistor (IEC)'
    lib2, r2 = E.mescla(lido, achados, HOJE, log=quieto)
    assert r2['novos'] == 0 and r2['repetidos'] == 5
    assert lib2['symbols'][0]['name'] == 'Resistor (IEC)' and lib2['symbols'][0]['usos'] == 3
    assert [s['id'] for s in lib2['symbols']] == ids

    # fonte nova com o mesmo resistor: conta; símbolo de mesmo nome e outra forma: " #2"; id segue
    # a rodada so viu C.SchDoc: nao cobre A.SchLib/B.SchDoc, que deram a descricao de hoje,
    # entao nao rebaixa nada -- e esta e a trava que deixa a escolha ser REFEITA sem risco
    lib3, r3 = E.mescla(lib2, [('C.SchDoc', 'R', 'Outra descricao', 1, 1) + res(),
                              ('C.SchDoc', 'R2', 'Resistor deslocado', 1, 1) + res(dx=10)], HOJE, log=quieto)
    assert lib3['symbols'][0]['desc'] == 'Resistor Metal Filme', 'rodada parcial nao rebaixa'
    # a rodada que cobre as fontes antigas REFAZ a escolha: sem isso, mudar a regra de
    # desempate nao conserta rotulo nenhum -- o que esta no arquivo fica congelado
    refeita, _ = E.mescla(lib2, [('A.SchLib', 'RES [ SMD ]', 'Resistor de fio', 1, 1) + res(),
                                 ('B.SchDoc', 'RES', 'Resistor de fio', 1, 1) + res()], HOJE, log=quieto)
    assert refeita['symbols'][0]['desc'] == 'Resistor de fio', refeita['symbols'][0]['desc']
    # e nao apaga quando a rodada nova nao tem candidata nenhuma
    vazia, _ = E.mescla(lib2, [('A.SchLib', 'RES [ SMD ]', '', 1, 1) + res(),
                               ('B.SchDoc', 'RES', 'AJUDA', 1, 1) + res()], HOJE, log=quieto)
    assert vazia['symbols'][0]['desc'] == 'Resistor Metal Filme', vazia['symbols'][0]['desc']
    assert lib3['symbols'][-1]['desc'] == 'Resistor deslocado'
    assert lib3['symbols'][0]['usos'] == 4 and lib3['symbols'][0]['fontes'][-1] == 'C.SchDoc'
    assert r3['novos'] == 1 and lib3['symbols'][-1]['id'] == 's0004' and lib3['symbols'][-1]['name'] == 'Resistor'
    # nome de forma já tomado: a origem entre parênteses; " #N" só quando nem ela desempata
    lib4, _ = E.mescla(lib3, [('D.SchDoc', 'R3', '', 1, 1) + res(dx=20)], HOJE, log=quieto)
    assert lib4['symbols'][-1]['name'] == 'Resistor (R3)', lib4['symbols'][-1]['name']
    lib5, _ = E.mescla(lib4, [('E.SchDoc', 'R3', '', 1, 1) + res(dx=30)], HOJE, log=quieto)
    assert lib5['symbols'][-1]['name'] == 'Resistor (R3) #2', lib5['symbols'][-1]['name']

    # a forma da SchLib oficial fica com o nome limpo mesmo sendo a menos usada
    ach = [('X.SchDoc', 'R', 'RESISTOR', 1, 1) + res(), ('X.SchDoc', 'R', 'RESISTOR', 1, 1) + res(),
           ('BIBLIOTECA.SchLib', 'RES [ PTH ]', 'Resistor Metal Filme', 1, 1) + res(dx=10)]
    libp, _ = E.mescla(None, ach, HOJE, log=quieto, preferida='biblioteca.schlib')
    assert [s['name'] for s in libp['symbols']] == ['Resistor', 'Resistor (R)'], [s['name'] for s in libp['symbols']]
    assert libp['symbols'][0]['fontes'] == ['BIBLIOTECA.SchLib'] and libp['symbols'][1]['usos'] == 2
    libq, _ = E.mescla(None, ach, HOJE, log=quieto)
    assert libq['symbols'][0]['fontes'] == ['X.SchDoc'], 'sem preferida, a mais usada'
    # a mesma forma vinda das duas fontes: a descrição da casa ganha da do projeto
    ach2 = [('X.SchDoc', 'R', 'RESISTOR', 1, 1) + res(), ('X.SchDoc', 'R', 'RESISTOR', 1, 1) + res(),
            ('BIBLIOTECA.SchLib', 'RES [ PTH ]', 'Resistor Metal Filme', 1, 1) + res()]
    libr, _ = E.mescla(None, ach2, HOJE, log=quieto, preferida='biblioteca.schlib')
    assert libr['symbols'][0]['desc'] == 'Resistor Metal Filme', libr['symbols'][0]['desc']
    libs_, _ = E.mescla(None, ach2, HOJE, log=quieto)
    assert libs_['symbols'][0]['desc'] == 'RESISTOR', 'sem preferida, a mais frequente'

    # biblioteca atual editada à mão: id/nome/fp quebrados são consertados, nunca descartados
    # (o resistor guardado com cor recalcula o MESMO fp: a cor fica, mas não é identidade)
    colorido = [dict(g, color='#ff0000', fill='#00ff00') for g in lib['symbols'][0]['graphics']]
    torto = {'symbols': [dict(lib['symbols'][0], id=None, name=None, fp=None, graphics=colorido),
                         dict(lib['symbols'][1], id='s0009'), dict(lib['symbols'][2], id='s0009')]}
    libs, rs = E.mescla(torto, [], HOJE, log=quieto)
    assert [s['id'] for s in libs['symbols']] == ['s0010', 's0009', 's0011'], [s['id'] for s in libs['symbols']]
    assert libs['symbols'][0]['name'] == 'RES [ SMD ]' and libs['symbols'][0]['fp'] == lib['symbols'][0]['fp']
    assert libs['symbols'][0]['graphics'][0]['color'] == '#ff0000', 'a cor sobrevive ao saneamento'
    assert rs['novos'] == 0 and len(libs['symbols']) == 3
    # e o mesmo corpo chegando colorido de outra fonte é repetido, não novo
    _, rc = E.mescla(libs, [('F.SchDoc', 'R', '', 1, 1, res()[0], colorido)], HOJE, log=quieto)
    assert rc['novos'] == 0 and rc['repetidos'] == 1, rc

    # o olho do pino (hideNum/hideName) e um VALOR, nao um complemento: no schlib-v2 a
    # chave ausente quer dizer VISIVEL. A copia recem-lida manda inteira -- poe e TIRA --,
    # e o fingerprint nao muda com isso.
    cego = copy.deepcopy(lib['symbols'][0])
    assert not any('hideName' in q for q in cego['pins'])
    escondidos = [dict(q, hideName=True) for q in res()[0]]
    todas_fontes = [('A.SchLib', 'R', '', 1, 1, escondidos, res()[1]),
                    ('B.SchDoc', 'R', '', 1, 1, escondidos, res()[1])]
    lib7, r7 = E.mescla({'symbols': [cego]}, todas_fontes, HOJE, log=quieto)
    assert all(q.get('hideName') and 'hideNum' not in q for q in lib7['symbols'][0]['pins']), lib7['symbols'][0]['pins']
    assert lib7['symbols'][0]['fp'] == cego['fp'] and len(lib7['symbols']) == 1 and r7['olhos'] == 1
    # e TIRA: o pino que voltou a ficar a vista perde o flag, senao o numero de um pino
    # deixado de proposito a mostra sumia da tela a cada varredura
    lib8, _ = E.mescla(copy.deepcopy(lib7), [('A.SchLib', 'R', '', 1, 1, res()[0], res()[1]),
                              ('B.SchDoc', 'R', '', 1, 1, res()[0], res()[1])], HOJE, log=quieto)
    assert not any('hideName' in q or 'hideNum' in q for q in lib8['symbols'][0]['pins']), lib8['symbols'][0]['pins']
    # rodada parcial NAO mexe no olho: A.SchLib sozinha nao cobre B.SchDoc
    lib9, r9 = E.mescla(copy.deepcopy(lib7), [('A.SchLib', 'R', '', 1, 1, res()[0], res()[1])], HOJE, log=quieto)
    assert all(q.get('hideName') for q in lib9['symbols'][0]['pins']) and r9['olhos'] == 0
    # maioria, nao ordem de chegada: 2 copias escondem, 1 mostra -> fica escondido
    maioria = [('A.SchLib', 'R', '', 1, 1, res()[0], res()[1]),
               ('B.SchDoc', 'R', '', 1, 1, escondidos, res()[1]),
               ('B.SchDoc', 'R', '', 1, 1, escondidos, res()[1])]
    libm, _ = E.mescla({'symbols': [copy.deepcopy(cego)]}, maioria, HOJE, log=quieto)
    assert all(q.get('hideName') for q in libm['symbols'][0]['pins'])
    libn, _ = E.mescla({'symbols': [copy.deepcopy(cego)]}, maioria[::-1], HOJE, log=quieto)
    assert [dict(q) for q in libn['symbols'][0]['pins']] == [dict(q) for q in libm['symbols'][0]['pins']], \
        'a ordem dos arquivos nao pode mudar o olho'
    # pinos EMPILHADOS na mesma posicao: a correspondencia e ambigua e o olho e recusado
    # (para kind generico o fingerprint nem le num/name, entao os flags sairiam trocados)
    juntos = [pin('1', 0, 0, 0), pin('2', 0, 0, 0, name='B')]
    corpo = [{'g': 'rect', 'x1': -100, 'y1': -40, 'x2': 100, 'y2': 40, 'solid': False}]
    libp1, _ = E.mescla(None, [('P.SchDoc', 'X', '', 1, 1, juntos, corpo)], HOJE, log=quieto)
    tortos = [dict(juntos[0], hideNum=True), dict(juntos[1])]
    libp2, rp = E.mescla(libp1, [('P.SchDoc', 'X', '', 1, 1, tortos, corpo)], HOJE, log=quieto)
    assert rp['olhos'] == 0 and not any('hideNum' in q for q in libp2['symbols'][0]['pins']), \
        'pino empilhado: melhor nenhum olho que o olho no pino errado'

    # ilegíveis passam para o resumo
    _, r5 = E.mescla(None, [], HOJE, log=quieto, ilegiveis=['X.SchDoc: quebrado'])
    assert r5['ilegiveis'] == ['X.SchDoc: quebrado'] and r5['novos'] == 0


def testa_arquivos(tmp):
    """a varredura: ignorar por prefixo, a pasta de backup fora, arquivo repetido uma vez só"""
    base = os.path.join(tmp, 'fontes')
    for rel in ('History/velho.SchLib', 'Project Outputs for X/X.IntLib', 'Backup-hub/lib.2026.SchLib',
                'a.SchDoc', 'sub/b.schlib', 'sub/nada.txt'):
        p = os.path.join(base, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'wb').close()
    cfg = {'fontes': [base, os.path.join(base, 'sub'), os.path.join(base, 'a.SchDoc'),
                      os.path.join(base, 'History', 'velho.SchLib')],
           'ignorar': ['History', 'Project Outputs'], 'backup_dir': os.path.join(base, 'Backup-hub')}
    rel = lambda arqs: [os.path.relpath(c, base).replace('\\', '/') for c, _ in arqs]
    assert rel(E._arquivos(cfg)) == ['a.SchDoc', 'sub/b.schlib', 'History/velho.SchLib'], rel(E._arquivos(cfg))
    assert rel(E._arquivos(cfg, so='schlib')) == ['sub/b.schlib', 'History/velho.SchLib']
    todos = rel(E._arquivos(dict(cfg, ignorar=[], backup_dir=None)))
    assert len(todos) == 5 and 'Backup-hub/lib.2026.SchLib' in todos and 'Project Outputs for X/X.IntLib' in todos, todos


# ─── (b) a lib local, duas vezes ──────────────────────────────────────────────
BASICOS = {'RES [ SMD ]': 'Resistor', 'RES [ PTH ]': 'Resistor', 'CAP [  SMD  ]': 'Capacitor',
           'CAP EL [ SMD  ]': 'Capacitor polarizado', 'DIODO SMD': 'Diodo', 'DIODO PTH': 'Diodo', 'LED': 'LED',
           'DIODO [ ZENER ] SMD': 'Diodo zener', 'DIODO [ Schottky ] SMD': 'Diodo Schottky',
           'Indutor magnético': 'Indutor', '2N3904': 'Transistor NPN', 'BC807': 'Transistor PNP',
           'MOSFET': 'MOSFET N', 'IRF9Z34N': 'MOSFET P', 'Cristal': 'Cristal', 'FUSIVEL': 'Fusível',
           'Bateria': 'Bateria', 'Potenciometro': 'Potenciômetro', 'Chave ON/OFF': 'Chave',
           'Ponte ret': 'Ponte retificadora', 'PC817': 'Optoacoplador'}


def testa_lib_local(tmp):
    if not os.path.exists(LIB_LOCAL):
        print('PULADO: lib local ausente (%s)' % LIB_LOCAL)
        return None
    lib_tmp = os.path.join(tmp, 'BIBLIOTECA DE ESQUEMA.SchLib')
    shutil.copyfile(LIB_LOCAL, lib_tmp)
    cfg = {'fontes': [lib_tmp], 'ignorar': []}
    saida = os.path.join(tmp, 'symbols-lib.js')

    lib1, r1 = E.mescla(None, E.varre(cfg, log=quieto), HOJE, log=quieto)
    assert r1['arquivos'] == 1 and r1['novos'] >= 150, r1['novos']
    E.escreve_symlib(lib1, saida)
    por_alias = {}
    for s in lib1['symbols']:
        for a in s['aliases']:
            por_alias[a] = s
    # RES [ SMD ] e RES [ PTH ]: mesma geometria, UMA entrada, dois aliases
    R = por_alias['RES [ SMD ]']
    assert R is por_alias['RES [ PTH ]'] and R['name'].startswith('Resistor'), (R['name'], R['aliases'])
    assert R['usos'] >= 2 and R['kind'] == 'generico'
    # a cor lida da SchLib fica no símbolo guardado (o 24LC256 é o corpo da casa: 128/11599871)
    rect = next(g for g in por_alias['24LC256']['graphics'] if g['g'] == 'rect')
    assert (rect['color'], rect['fill']) == ('#800000', '#ffffb0'), rect
    assert next(g for g in R['graphics'] if g['g'] == 'rect')['color'] == '#0000ff' and 'fill' not in next(g for g in R['graphics'] if g['g'] == 'rect')
    # a descrição do componente atravessa: o campo existe em todo símbolo e "AJUDA" não entra
    com_desc = [s for s in lib1['symbols'] if s['desc']]
    assert all('desc' in s for s in lib1['symbols']) and len(com_desc) >= 0.6 * len(lib1['symbols']), \
        '%d de %d com descrição' % (len(com_desc), len(lib1['symbols']))
    assert not any(s['desc'].upper() == 'AJUDA' for s in lib1['symbols']), 'o placeholder não é descrição'
    assert por_alias['RES [ SMD ]']['desc'], 'o resistor da casa tem descrição'
    # e o olho do pino veio junto: a lib da casa esconde nome ou número em centenas de pinos
    olhos = sum(1 for s in lib1['symbols'] for q in s['pins'] if q.get('hideNum') or q.get('hideName'))
    assert olhos >= 100, olhos
    erros = []
    for origem, esperado in BASICOS.items():
        s = por_alias.get(origem)
        nome = s and basico(s['name'])
        if nome != esperado:
            erros.append('%s -> %r (esperado %r)' % (origem, nome, esperado))
    assert not erros, '\n'.join(erros)
    # CI multi-part: kind ci, nome com a parte, alias com a parte
    p1 = por_alias.get('PIC18F452 · parte 1/3')
    assert p1 and p1['kind'] == 'ci' and p1['name'] == 'PIC18F452 · parte 1/3', p1 and p1['name']
    assert por_alias['STWD100YNYWY3F']['kind'] == 'ci'
    # nomes únicos, ids únicos e sequenciais, um símbolo = uma parte
    nomes = [s['name'] for s in lib1['symbols']]
    assert len(set(nomes)) == len(nomes)
    assert [s['id'] for s in lib1['symbols']] == ['s%04d' % i for i in range(1, len(nomes) + 1)]
    assert all(s['pins'] and isinstance(s['graphics'], list) for s in lib1['symbols'])

    # segunda rodada: nada novo, ids e usos iguais, renomeação sobrevive
    lido = E.le_symlib(saida)
    lido['symbols'][0]['name'] = 'Renomeado pelo usuário'
    E.escreve_symlib(lido, saida)
    lib2, r2 = E.mescla(E.le_symlib(saida), E.varre(cfg, log=quieto), HOJE, log=quieto)
    assert r2['novos'] == 0, r2['novos']
    assert [(s['id'], s['fp'], s['usos']) for s in lib2['symbols']] == [(s['id'], s['fp'], s['usos']) for s in lib1['symbols']]
    assert lib2['symbols'][0]['name'] == 'Renomeado pelo usuário'
    assert all(len(s['fontes']) == 1 for s in lib2['symbols']), 'a mesma fonte não entra duas vezes'

    print('lib local: %d partes com pinos -> %d símbolos (%d repetidos)' % (
        r1['novos'] + r1['repetidos'], r1['novos'], r1['repetidos']))
    print('classificação (nome básico -> quantos), os 40 maiores:')
    for i, (nome, n) in enumerate(r1['classes'].items()):
        if i >= 40:
            break
        print('  %5d  %s' % (n, nome))
    return lib_tmp


# ─── (c) a CLI ────────────────────────────────────────────────────────────────
def testa_cli(tmp, lib_tmp):
    if not lib_tmp:
        print('PULADO: CLI (sem a lib local)')
        return
    saida = os.path.join(tmp, 'cli', 'symbols-lib.js')
    rel = os.path.join(tmp, 'cli', 'relatorio.txt')
    cfg = os.path.join(tmp, 'config.json')
    with open(cfg, 'w', encoding='utf-8') as f:
        f.write('{"fontes": ["%s"], "ignorar": ["History"]}' % os.path.dirname(lib_tmp).replace('\\', '\\\\'))
    cmd = [sys.executable, os.path.join(RAIZ, 'tools', 'symbols', 'extrair.py'), '--config', cfg,
           '--saida', saida, '--relatorio', rel, '--limite', '1', '--so', 'schlib']
    r = subprocess.run(cmd, capture_output=True, timeout=300)
    out = r.stdout.decode('utf-8', 'replace')
    assert r.returncode == 0, r.stderr.decode('utf-8', 'replace')[-2000:]
    assert '[1/1] BIBLIOTECA DE ESQUEMA.SchLib' in out and 'classificação' in out and 'novo(s)' in out, out[-800:]
    assert os.path.exists(saida) and not os.path.exists(saida + '.tmp')
    texto = open(rel, encoding='utf-8').read()
    assert 'Classificacao' in texto and 'Novos (' in texto and 'Resistor' in texto
    r2 = subprocess.run(cmd, capture_output=True, timeout=300)
    assert r2.returncode == 0 and '0 novo(s)' in r2.stdout.decode('utf-8', 'replace')
    print('CLI: ok (%d linhas de log)' % out.count('\n'))


# ─── (d) o Y: ─────────────────────────────────────────────────────────────────
def testa_rede():
    if not os.path.isdir(DMB):
        print('PULADO: Y: inacessível (%s)' % DMB)
        return
    schdoc = None
    for raiz, dirs, files in os.walk(DMB):
        dirs[:] = sorted(d for d in dirs if d.lower() not in ('history', '__previews'))
        for f in sorted(files):
            if f.lower().endswith('.schdoc'):
                schdoc = os.path.join(raiz, f)
                break
        if schdoc:
            break
    assert schdoc, 'nenhum .SchDoc em ' + DMB
    ilegiveis = []
    achados = list(E.varre({'fontes': [schdoc], 'ignorar': []}, log=quieto, ilegiveis=ilegiveis))
    assert achados and not ilegiveis, ilegiveis
    assert all(a[0] == os.path.basename(schdoc) and a[5] for a in achados)
    assert sum(1 for a in achados if a[2]) >= 0.5 * len(achados), 'a folha traz descrição na maioria'

    lib, r = E.mescla(None, achados, HOJE, log=quieto)
    assert r['novos'] >= 1 and all(s['fontes'] == [os.path.basename(schdoc)] for s in lib['symbols'])
    print('SchDoc %s: %d componentes -> %d símbolos' % (os.path.basename(schdoc), len(achados), r['novos']))
    if os.path.exists(INTLIB):
        achados = list(E.varre({'fontes': [INTLIB], 'ignorar': []}, log=quieto, so='intlib'))
        assert achados and achados[0][5], 'IntLib sem pinos'
        print('IntLib %s: %d partes' % (os.path.basename(INTLIB), len(achados)))
    else:
        print('PULADO: IntLib de amostra ausente')



# ─── a suíte não pode escrever na biblioteca de verdade ──────────────────────
# Tudo aqui mora em tempdir; a Libs/ do repositório é só LEITURA (a .SchLib da casa é
# copiada de lá, nunca escrita). Teste que suja o acervo versionado é um bug de teste —
# quem roda a suíte depois não sabe mais o que é dele e o que é do teste —, então a
# invariante fica provada aqui, e não na memória de quem escreveu. A foto é (tamanho,
# mtime_ns): pega até a regravação de conteúdo idêntico, que comparar hash não pegaria.
def _foto_libs():
    fora = {}
    for raiz, _dirs, files in os.walk(os.path.join(RAIZ, 'Libs')):
        for f in files:
            p = os.path.join(raiz, f)
            try:
                st = os.stat(p)
            except OSError:                       # sumiu entre o walk e o stat: conta como mexido
                fora[p] = None
                continue
            fora[p] = (st.st_size, st.st_mtime_ns)
    return fora


def confere_libs(antes):
    depois = _foto_libs()
    mexidos = sorted(set(antes) ^ set(depois)) + sorted(p for p in set(antes) & set(depois)
                                                       if antes[p] != depois[p])
    assert not mexidos, ('a suite escreveu na Libs/ de verdade (tudo tem que ficar no tempdir): '
                         + ', '.join(os.path.relpath(p, RAIZ) for p in mexidos))


def main():
    libs = _foto_libs()
    tmp = tempfile.mkdtemp(prefix='extrair-')
    try:
        testa_normaliza()
        testa_fingerprint()
        testa_classifica()
        testa_desc()
        testa_mescla(tmp)
        testa_arquivos(tmp)
        lib_tmp = testa_lib_local(tmp)
        testa_cli(tmp, lib_tmp)
        testa_rede()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    confere_libs(libs)
    print('test_extrair OK (fingerprint, classificação, mescla incremental, CLI)')


if __name__ == '__main__':
    main()
