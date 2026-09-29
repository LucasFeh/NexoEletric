# -*- coding: utf-8 -*-
"""Renomear o produto no Odoo nao cria componente novo nem deixa zumbi.

    python3 tests/test_almox_renome.py

O livro-razao (Libs/almox-parts.json) chaveia o valor pelo ROTULO, e o rotulo sai do nome do
produto. Sem seguir a renomeacao, trocar o nome no cadastro faz DUAS coisas erradas de uma
vez: nasce um componente novo -- numero novo, data de hoje, sem as escolhas de footprint -- e
o antigo fica na lista como `fora: true`, saldo zero, para sempre, porque `numera_valores`
ressuscita do espelho tudo que esta em `ids` e nao veio no CSV. Uma faxina de nomes no Odoo
dobrava a biblioteca.

O `product_id` do Odoo nao muda quando o nome muda: e ele que diz "e a mesma peca".

Roda sem rede e sem Odoo: duas rodadas do gerador sobre linhas sinteticas, em memoria.
"""
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import almox2lib as A                                   # noqa: E402
import familias as F                                    # noqa: E402

falhas = []


def eq(achado, esperado, porque):
    if achado != esperado:
        falhas.append('%s\n     esperado %r, veio %r' % (porque, esperado, achado))


def ok(cond, porque):
    if not cond:
        falhas.append(porque)


def linha(pid, nome, categoria='', saldo='5.0'):
    return {'product_id': pid, 'template_id': pid, 'localizacao_codigo': 'G-1-1', 'nome': nome,
            'categoria': categoria, 'unidade': 'Unidades', 'qtd_almoxarifado': saldo,
            'qtd_total_interna': saldo, 'locais_estoque': 'DI/Almoxarifado', 'barcode': '',
            'custo': '1.0', 'preco_venda': '', 'fornecedor_partnumber': '',
            'menor_preco_compra': '', 'estocavel': 'true', 'tipo': 'consu',
            'write_date': '2026-09-08 00:00:00'}


def roda(linhas, mapa, antes, quando, fpman=None, fpodoo=None):
    """uma geracao inteira, em memoria -> ({nome_simbolo: simbolo}, renomeacoes)"""
    A.AGORA_ISO = quando
    itens = [a for a in (F.analisar(l) for l in linhas) if a]
    simbolos = A.agrupar(itens)
    renomes = A.segue_renomeacoes(simbolos, antes, mapa)
    montados = [A.monta_simbolo(s, {}, mapa, antes, False, None, fpman, fpodoo)
                for s in simbolos.values()]
    A.grava_indice_odoo(montados, mapa)
    return {s['name']: s for s in montados}, renomes


def por_odoo(esp, oid):
    """os valores do espelho que carregam o produto `oid` -> [(simbolo, valor)]"""
    return [(nome, v) for nome, s in esp.items() for v in s['valores']
            if oid in [str(it.get('odoo')) for it in v.get('itens') or []]]


DESENHO = [{'part': 1, 'pins': [{'num': '1', 'name': 'A', 'x': 0, 'y': 0, 'len': 100, 'orient': 180}],
            'graphics': [{'g': 'rect', 'x1': 0, 'y1': -50, 'x2': 200, 'y2': 50}]}]


def tudo_por_id():
    """2026-09-29: "tudo e vinculado pelo ID do Odoo". Renomear o produto troca o nome do
    componente e mais nada — o desenho aplicado, o vinculo com o simbolo, o footprint
    escolhido e o numero vao junto; e o produto que ja aparece duas vezes e APONTADO."""
    import copy
    import guardiao as G

    # ── (a) o desenho proprio do valor (o simbolo aplicado pelo hub) atravessa o rename,
    #        dentro do mesmo simbolo E trocando de simbolo ──────────────────────────────
    R1 = [linha('101', 'Resistor Metal Filme 1K 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
          linha('102', 'Resistor Metal Filme 2K2 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
          linha('103', 'Resistor Metal Filme 4K7 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805')]
    mapa = {}
    esp1, _ = roda(R1, mapa, {}, '2026-08-01 09:00')
    for _n, v in por_odoo(esp1, '101') + por_odoo(esp1, '103'):
        v['parts'] = copy.deepcopy(DESENHO)            # o que o /save-almox grava no espelho
    R2 = [linha('101', 'Resistor SMD 0805 1K 1/4W 1% 100ppm - Yageo RC0805FR-071KL', 'Resistores'),
          linha('102', 'Resistor Metal Filme 2K2 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
          linha('103', 'Resistor Metal Filme 4K7 1/4W 1% 100ppm PTH', 'Resistores')]
    esp2, _ = roda(R2, mapa, esp1, '2026-09-29 10:00')
    for oid, sim in (('101', 'RESISTOR [SMD]'), ('103', 'RESISTOR [PTH]')):
        achados = por_odoo(esp2, oid)
        eq([n for n, _v in achados], [sim], 'o produto %s tem de estar em UM componente, em %s' % (oid, sim))
        if achados:
            eq(achados[0][1].get('parts'), DESENHO,
               'o produto %s renomeado tem de manter o desenho aplicado' % oid)
    eq(por_odoo(esp2, '102')[0][1].get('parts'), None,
       'quem nunca teve desenho proprio continua com o da familia')

    # ── (b) o numero ja ocupado no simbolo de destino NAO deixa zumbi ───────────────────
    #        o 201 mora no BLOCO TERMINAL com o nº 1 e vai para o KK, onde o nº 1 e do 401
    C1 = [linha('201', 'Conector Bloco Terminal - MC 1,5/ 4-STF-3,81 (1827729)', 'Conectores'),
          linha('202', 'Conector Bloco Terminal MSTB 2,5/ 2-GF-5,08 (1776508)', 'Conectores'),
          linha('401', 'Conector Kk 2 vias macho, passo 2.54mm, 180 PTH', 'Conectores')]
    mapa = {}
    esp1, _ = roda(C1, mapa, {}, '2026-08-01 09:00')
    ok(por_odoo(esp1, '201')[0][1]['id'] == por_odoo(esp1, '401')[0][1]['id'],
       'pre-condicao: o 201 e o 401 tem o mesmo numero, cada um no seu simbolo')
    desde_201 = por_odoo(esp1, '201')[0][1]['desde']
    C2 = [linha('201', 'Conector Kk 4 vias macho, passo 3.96mm, 180 PTH', 'Conectores'),
          linha('202', 'Conector Bloco Terminal MSTB 2,5/ 2-GF-5,08 (1776508)', 'Conectores'),
          linha('401', 'Conector Kk 2 vias macho, passo 2.54mm, 180 PTH', 'Conectores')]
    esp2, _ = roda(C2, mapa, esp1, '2026-09-29 10:00')
    eq([(n, v.get('fora')) for n, v in por_odoo(esp2, '201')], [('CONECTOR KK', None)],
       'sem numero livre no destino, o renomeado tira um novo — e o velho NAO fica como zumbi')
    k201, k401 = por_odoo(esp2, '201')[0][1], por_odoo(esp2, '401')[0][1]
    ok(k201['id'] != k401['id'], 'e o 401, que ja morava no KK, nao divide o numero com ele')
    eq(k201['desde'], desde_201, 'a data de entrada vem de qualquer jeito')

    # ── (c) dois produtos num valor so, e um deles muda de nome: o outro NAO renumera ───
    D1 = [linha('501', 'Resistor Metal Filme 10K 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
          linha('502', 'Resistor Metal Filme 10K 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805')]
    mapa = {}
    esp1, _ = roda(D1, mapa, {}, '2026-08-01 09:00')
    junto = por_odoo(esp1, '501')
    ok(junto and junto == por_odoo(esp1, '502'), 'pre-condicao: 501 e 502 sao um valor so')
    D2 = [linha('501', 'Resistor Metal Filme 10K 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
          linha('502', 'Resistor SMD 0805 10K 1/4W 1% 100ppm - Yageo RC0805FR-0710KL', 'Resistores')]
    esp2, _ = roda(D2, mapa, esp1, '2026-09-29 10:00')
    if junto:
        eq(por_odoo(esp2, '501')[0][1]['id'], junto[0][1]['id'],
           'quem ficou no lugar antigo mantem o numero: o lugar continua ocupado, nao e origem')
    eq([v.get('fora') for _n, v in por_odoo(esp2, '502')], [None], 'o que saiu vira um so, vivo')

    # ── (d) o footprint escolhido a mao acompanha o ID, e o do ESPECIAL e achado ────────
    mapa = {}
    esp1, _ = roda(R1, mapa, {}, '2026-08-01 09:00')
    esp2, _ = roda(R2, mapa, esp1, '2026-09-29 10:00', fpman={}, fpodoo={'101': 'RES 0805 CASA'})
    eq(por_odoo(esp2, '101')[0][1]['footprint'], 'RES 0805 CASA',
       'renomeado: o ledger ainda tem o nome velho, e o id acha a escolha na MESMA rodada')
    E1 = [linha('601', 'Circuito de Interface RS-485 - SN65HVD75DR', 'Circuitos Integrados')]
    esp1, _ = roda(E1, {}, {}, '2026-08-01 09:00')
    (sim_e, v_e), = por_odoo(esp1, '601')
    eq(esp1[sim_e]['grupo'], 'especiais', 'pre-condicao: o SN65HVD75DR e um especial')
    esp2, _ = roda(E1, {}, {}, '2026-08-01 09:00',
                   fpman={('ESPECIAIS', v_e['altium']): 'D008a_n'}, fpodoo={})
    eq(por_odoo(esp2, '601')[0][1]['footprint'], 'D008a_n',
       'o ledger chaveia o especial por "ESPECIAIS" (a familia do ARQUIVO): o gerador tem de '
       'achar a escolha por essa chave, nao pela familia do simbolo')

    # ── (e) o TMAG: o produto que JA aparece duas vezes e apontado, e o indice fica no vivo
    mapa = {}
    esp1, _ = roda(R1, mapa, {}, '2026-08-01 09:00')
    esp2, _ = roda(R2, mapa, esp1, '2026-09-29 10:00')
    # o estado de antes deste conserto: o nome velho sobrou no livro-razao e no espelho, fora,
    # com os itens do produto que hoje mora no nome novo
    velho = copy.deepcopy(next(v for v in esp1['RESISTOR [SMD]']['valores']
                               if '101' in [it['odoo'] for it in v['itens']]))
    velho.update(fora=True, estoque=0)
    esp2['RESISTOR [SMD]']['valores'].append(velho)
    mapa['RESISTOR [SMD]']['ids'][velho['label']] = velho['id']
    por_odoo(esp2, '101')[0][1]['parts'] = copy.deepcopy(DESENHO)    # o simbolo aplicado no vivo
    # como no servidor: o indice do livro-razao ja aponta o nome NOVO — nada ali diz "renomeie"
    esp3, _ = roda(R2, mapa, esp2, '2026-09-29 11:00')
    dups = A.duplicados_odoo(list(esp3.values()))
    eq([d['odoo'] for d in dups], ['101'], 'o produto 101 esta em dois componentes: tem de ser apontado')
    if dups:
        eq(sorted(v['fora'] for v in dups[0]['valores']), [False, True],
           'um e o vivo, o outro o zumbi — e a lista diz qual e qual')
    vivo = next(v for _n, v in por_odoo(esp3, '101') if not v.get('fora'))
    zumbi = next(v for _n, v in por_odoo(esp3, '101') if v.get('fora'))
    eq(vivo.get('parts'), DESENHO, 'o vivo mantem o simbolo aplicado')
    eq(zumbi.get('parts'), None, 'e o zumbi NAO herda pelo id o desenho do vivo')
    eq(mapa['RESISTOR [SMD]']['odoo'].get('101'), A.chave_do_valor(vivo),
       'o indice do livro-razao continua no VIVO')
    eq(A.duplicados_odoo(list(roda(R2, {}, {}, '2026-09-29 12:00')[0].values())), [],
       'biblioteca limpa: nada a apontar')
    # o vivo ganha do zumbi mesmo quando o zumbi vem DEPOIS na lista (a ordem e a do rotulo)
    m2 = {}
    A.grava_indice_odoo([{'name': 'S', 'valores': [
        {'label': 'B vivo', 'itens': [{'odoo': '7'}]},
        {'label': 'Z zumbi', 'fora': True, 'itens': [{'odoo': '7'}, {'odoo': '8'}]}]}], m2)
    eq(m2['S']['odoo'], {'7': 'B vivo', '8': 'Z zumbi'},
       'o 7 e do vivo; o 8, que nao vive em lugar nenhum, continua apontando o fora')
    # e o indice ANTIGO que aponta o zumbi (o livro-razao de antes deste conserto guardava os
    # `fora`) nao vira "renomeacao": ela daria ao vivo o numero do zumbi — renumerar peca em
    # uso. Medido no servidor: seriam 49. Onde o produto estava VIVO no espelho e que manda.
    mapa['RESISTOR [SMD]']['odoo']['101'] = velho['label']
    id_vivo = vivo['id']
    esp4, ren4 = roda(R2, mapa, esp3, '2026-09-29 13:00')
    eq(ren4, [], 'duplicado antigo nao e renomeacao')
    eq(sorted((v['id'], bool(v.get('fora'))) for _n, v in por_odoo(esp4, '101')),
       sorted([(id_vivo, False), (velho['id'], True)]),
       'o vivo mantem o numero dele, e o zumbi continua la, so apontado')

    # ── (f) o GUARDIAO: a protecao presa no zumbi vai para o vivo, com o vinculo ────────
    esp = {'symbols': [{'name': 'SENSOR [PINAGEM A DEFINIR]', 'familia': 'SENSOR', 'valores': [
        {'altium': 'Hall / Magnetico TMAG5131A1', 'fora': True, 'itens': [{'odoo': '1523'}]},
        {'altium': 'Hall Magnetico TMAG5131A1', 'itens': [{'odoo': '1523'}]},
        {'altium': 'Saiu do Odoo', 'fora': True, 'itens': [{'odoo': '999'}]},
        {'altium': 'X velho', 'fora': True, 'itens': [{'odoo': '777'}]},
        {'altium': 'X novo', 'itens': [{'odoo': '777'}]}]}]}
    espelhos = [(os.path.join(RAIZ, 'Libs', 'almox-especiais.js'), 'almoxEspeciais', esp)]
    idx = G.indice_almox(espelhos)
    prot = lambda **k: dict({'simbolo': 'SENSOR [PINAGEM A DEFINIR]', 'origem': 'hub',   # noqa: E731
                             'parts': DESENHO}, **k)
    led = {'protegidos': {'ESPECIAIS': {
               'Hall / Magnetico TMAG5131A1': prot(lib='s0042'),
               'Saiu do Odoo': prot(odoo='999', lib='s0007'),
               'X velho': prot(odoo='777', lib='s0001'),
               'X novo': prot(odoo='777', lib='s0002')}},
           'footprints': {'ESPECIAIS': {'Hall / Magnetico TMAG5131A1': {'nome': 'SOT-23'}}}}
    G.segue_renomeacoes(led, espelhos, idx, log=lambda *a: None)
    pe = led['protegidos']['ESPECIAIS']
    ok('Hall / Magnetico TMAG5131A1' not in pe, 'a protecao nao pode ficar no zumbi')
    eq((pe.get('Hall Magnetico TMAG5131A1') or {}).get('lib'), 's0042',
       'o componente vivo recebe o desenho E o vinculo com o simbolo')
    eq(list(led['footprints']['ESPECIAIS']), ['Hall Magnetico TMAG5131A1'],
       'o footprint escolhido vai junto')
    eq(pe.get('Saiu do Odoo', {}).get('lib'), 's0007',
       'produto que saiu do Odoo de verdade nao tem para onde ir: a protecao fica')
    eq((pe['X velho']['lib'], pe['X novo']['lib']), ('s0001', 's0002'),
       'os dois com registro: nao sobrescreve o do vivo (a tela aponta o duplicado)')
    _pid, _dc, zumbis = G.indice_odoo_almox(espelhos)
    eq(_pid.get('1523'), ('ESPECIAIS', 'Hall Magnetico TMAG5131A1'), 'o indice por id so aponta o vivo')

    # ── (g) footprint por id: id disputado com escolhas diferentes nao e resposta ───────
    led = {'footprints': {'A': {'a1': {'nome': 'F1', 'odoo': '1 2'}, 'a2': {'nome': 'F2', 'odoo': '2'}},
                          'B': {'b1': {'nome': 'F3', 'odoo': '3'}, 'b2': {'nome': 'F3', 'odoo': '3'},
                                'b3': {'nome': 'F4'}}}}
    eq(G.footprints_manuais_por_odoo(led), {'1': 'F1', '3': 'F3'},
       'o 2 e reclamado por F1 e F2: fica de fora; o 3, pela mesma escolha duas vezes, vale')
    G.poe_footprint(led, 'B', 'b3', 'F5', odoo='9')
    eq(led['footprints']['B']['b3'].get('odoo'), '9', 'a escolha nova ja nasce com o id do produto')
    G.poe_footprint(led, 'B', 'b3', 'F6')
    eq(led['footprints']['B']['b3'].get('odoo'), '9', 'e trocar o footprint nao apaga o id')


def valor(esp, simbolo, rotulo):
    s = esp.get(simbolo)
    if not s:
        return None
    return next((v for v in s['valores'] if v['label'] == rotulo), None)


def main():
    # ── rodada 1: o cadastro como esta hoje ───────────────────────────────────
    ANTES = [
        linha('101', 'Resistor Metal Filme 1K 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
        linha('102', 'Resistor Metal Filme 2K2 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
        linha('201', 'Conector Bloco Terminal - MC 1,5/ 4-STF-3,81 (1827729)', 'Conectores'),
        linha('202', 'Conector Bloco Terminal MSTB 2,5/ 2-GF-5,08 (1776508)', 'Conectores'),
        linha('301', 'Diodo Zener 12V 0.5W PTH DO-35', 'Diodos'),
        linha('302', 'Diodo Zener 5V1 0.5W PTH DO-35', 'Diodos'),
    ]
    mapa = {}
    esp1, ren1 = roda(ANTES, mapa, {}, '2026-08-01 09:00')
    eq(ren1, [], 'na primeira rodada nao ha de onde renomear')

    r1 = valor(esp1, 'RESISTOR [SMD]', '1K 1/4W 1% 100ppm')
    ok(r1 is not None, 'o resistor 1K tem de existir na rodada 1')
    c1 = valor(esp1, 'CONECTOR BLOCO TERMINAL', 'MC 1,5/ 4-STF-3,81 (1827729)')
    ok(c1 is not None, 'o bloco terminal de 4 vias tem de existir na rodada 1')
    if not (r1 and c1):
        print('test_almox_renome ABORTADO: a rodada 1 nao montou o esperado')
        for s in sorted(esp1):
            print('   %-32s %s' % (s, [v['label'] for v in esp1[s]['valores']]))
        return 1
    id_r, desde_r = r1['id'], r1['desde']
    id_c, desde_c = c1['id'], c1['desde']

    # ── rodada 2: os MESMOS produtos, com os nomes refeitos no Odoo ───────────
    # o product_id nao muda; o nome, a categoria e ate o SUBTIPO do conector mudam
    DEPOIS = [
        linha('101', 'Resistor SMD 0805 1K 1/4W 1% 100ppm - Yageo RC0805FR-071KL',
              'Resistores SMD 0805'),
        linha('102', 'Resistor Metal Filme 2K2 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
        linha('201', 'Conector Kk 4 vias macho, passo 3.96mm, 180 PTH', 'Conectores'),
        linha('202', 'Conector Bloco Terminal MSTB 2,5/ 2-GF-5,08 (1776508)', 'Conectores'),
        linha('302', 'Diodo Zener 5V1 0.5W PTH DO-35', 'Diodos'),
        # o 301 sumiu do Odoo de verdade: e o caso que TEM de virar `fora: true`.
        # O 302 fica para o simbolo continuar existindo: simbolo sem item nenhum nao e
        # montado, e ai nao ha de onde ressuscitar o que saiu.
    ]
    esp2, ren2 = roda(DEPOIS, mapa, esp1, '2026-09-22 10:00')

    ok(len(ren2) >= 2, 'as duas renomeacoes tem de ser detectadas — vieram %d' % len(ren2))

    # 1. renomeado dentro da MESMA familia: o numero e a data ficam
    r2 = valor(esp2, 'RESISTOR [SMD]', '1K 1/4W 1% 100ppm - Yageo RC0805FR-071KL')
    ok(r2 is not None, 'o resistor renomeado tem de aparecer com o rotulo novo')
    if r2:
        eq(r2['id'], id_r, 'o resistor renomeado tem de manter o NUMERO de part')
        eq(r2['desde'], desde_r, 'e a data de entrada — senao ele aparece como "novo"')

    # 2. renomeado ATRAVESSANDO o simbolo: no Odoo o bloco terminal virou um KK
    c2 = valor(esp2, 'CONECTOR KK', 'Kk 4 vias macho, passo 3.96mm, 180')
    ok(c2 is not None, 'o conector renomeado tem de aparecer no subtipo novo')
    if c2:
        eq(c2['id'], id_c, 'o numero acompanha o produto mesmo mudando de simbolo')
        eq(c2['desde'], desde_c, 'e a data tambem')

    # 3. E NAO PODE SOBRAR ZUMBI. Este e o ponto do pedido: o "fora: true" e para quem
    #    SUMIU do Odoo, nunca para quem so trocou de nome.
    zumbis = [(nome, v['label']) for nome, s in esp2.items()
              for v in s['valores'] if v.get('fora')]
    eq(sorted(zumbis), [('DIODO ZENER [PTH]', '12V 0.5W')],
       'so o produto que sumiu de verdade do Odoo pode ficar como `fora`')

    velho_r = valor(esp2, 'RESISTOR [SMD]', '1K 1/4W 1% 100ppm')
    eq(velho_r, None, 'o rotulo antigo do resistor nao pode continuar na lista')
    eq(esp2.get('CONECTOR BLOCO TERMINAL') and
       [v['label'] for v in esp2['CONECTOR BLOCO TERMINAL']['valores']],
       ['MSTB 2,5/ 2-GF-5,08 (1776508)'],
       'o bloco terminal fica so com quem realmente e dele')

    # 4. o numero do que NAO mudou nao pode andar de lado
    a1 = valor(esp1, 'RESISTOR [SMD]', '2K2 1/4W 1% 100ppm')
    a2 = valor(esp2, 'RESISTOR [SMD]', '2K2 1/4W 1% 100ppm')
    ok(a1 and a2 and a1['id'] == a2['id'], 'quem nao foi tocado mantem o numero')

    # 5. o indice do Odoo ficou gravado no livro-razao, que e o que faz a PROXIMA
    #    renomeacao ser seguida mesmo sem o espelho (ele e gitignored)
    ix = (mapa.get('RESISTOR [SMD]') or {}).get('odoo') or {}
    eq(ix.get('101'), '1K 1/4W 1% 100ppm - Yageo RC0805FR-071KL',
       'o livro-razao tem de saber de que produto veio cada valor')

    # 6. e com o espelho APAGADO (clone novo), o indice do livro-razao sozinho resolve
    DEPOIS2 = [
        linha('101', 'Resistor 0805 1K 1/4W 1% 100ppm Yageo', 'Resistores SMD 0805'),
        linha('102', 'Resistor Metal Filme 2K2 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805'),
        linha('201', 'Conector Kk 4 vias macho, passo 3.96mm, 180 PTH', 'Conectores'),
        linha('202', 'Conector Bloco Terminal MSTB 2,5/ 2-GF-5,08 (1776508)', 'Conectores'),
        linha('302', 'Diodo Zener 5V1 0.5W PTH DO-35', 'Diodos'),
    ]
    esp3, ren3 = roda(DEPOIS2, mapa, {}, '2026-09-23 10:00')
    r3 = valor(esp3, 'RESISTOR [SMD]', '1K 1/4W 1% 100ppm Yageo')
    ok(r3 is not None, 'o resistor renomeado de novo tem de aparecer')
    if r3:
        eq(r3['id'], id_r, 'sem espelho nenhum, o indice do livro-razao ainda segue o rename')

    # ── o outro lado: a PROTECAO tambem segue o rename ───────────────────────
    # `protegidos` e `footprints` sao chaveados por (familia do arquivo, NOME DO COMPONENTE).
    # Sem seguir, uma faxina de nomes torna orfa toda protecao de uma vez: o desenho adotado
    # do Altium deixa de ser reposto e o footprint escolhido a mao volta para a deducao.
    import guardiao as G
    espelho = {'symbols': [
        {'name': 'CONECTOR KK', 'familia': 'CONECTOR KK', 'valores': [
            {'altium': 'Kk 4 vias macho 3.96mm', 'itens': [{'odoo': '201'}]}]},
        {'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'valores': [
            {'altium': 'SMD 0805 1K NOVO', 'itens': [{'odoo': '101'}]}]},
    ]}
    espelhos = [(os.path.join(RAIZ, 'Libs', 'almox-basicos.js'), 'almoxBasicos', espelho)]
    idx = G.indice_almox(espelhos)
    led = {
        # o nome VELHO, de antes da faxina, com o id do produto ja registrado
        'protegidos': {'CONECTOR BLOCO TERMINAL': {
            'MC 1,5/ 4-STF-3,81': {'odoo': '201', 'simbolo': 'CONECTOR BLOCO TERMINAL',
                                   'origem': 'altium', 'parts': [], 'orfao': True}}},
        'footprints': {'RESISTOR': {
            'SMD 0805 1K': {'odoo': '101', 'nome': 'RES 0805'},
            'SMD 0805 1K NOVO': {'nome': 'RES 0805'}}},
    }
    G.segue_renomeacoes(led, espelhos, idx, log=lambda *a: None)

    prot = led['protegidos']
    ok('CONECTOR KK' in prot and 'Kk 4 vias macho 3.96mm' in prot['CONECTOR KK'],
       'o desenho protegido tem de acompanhar o componente renomeado')
    eq(prot.get('CONECTOR BLOCO TERMINAL'), None,
       'e a familia velha nao pode ficar com a entrada orfa')
    if 'CONECTOR KK' in prot:
        d = prot['CONECTOR KK']['Kk 4 vias macho 3.96mm']
        eq(d.get('orfao'), None, 'ele deixa de ser orfao: foi achado')
        eq(d.get('simbolo'), 'CONECTOR KK', 'o simbolo guardado dentro tambem e atualizado')

    # SEM o id registrado: a entrada e anterior ao campo e o que mudou foi a FAMILIA.
    # E o caso do servidor no dia em que o conector ganhou subtipo — o ledger de la nao
    # passa pelo deploy (fica em shared/), entao ele chega sem `odoo` nenhum.
    led2 = {'protegidos': {'BARRA DE PINOS': {
                'Kk 4 vias macho 3.96mm': {'simbolo': 'BARRA DE PINOS 4V', 'parts': []}}},
            'footprints': {}}
    G.segue_renomeacoes(led2, espelhos, idx, log=lambda *a: None)
    ok('CONECTOR KK' in led2['protegidos']
       and 'Kk 4 vias macho 3.96mm' in led2['protegidos']['CONECTOR KK'],
       'sem o id, o nome do componente sozinho tem de reencontrar a familia nova')
    eq(led2['protegidos'].get('BARRA DE PINOS'), None, 'e a familia velha sai')

    # ...mas nome ambiguo nao e resposta: com dois candidatos, nao mexe
    esp_amb = {'symbols': [
        {'name': 'A', 'familia': 'FAM A', 'valores': [{'altium': 'X', 'itens': [{'odoo': '9'}]}]},
        {'name': 'B', 'familia': 'FAM B', 'valores': [{'altium': 'X', 'itens': [{'odoo': '8'}]}]},
    ]}
    esps = [(os.path.join(RAIZ, 'Libs', 'almox-basicos.js'), 'almoxBasicos', esp_amb)]
    led3 = {'protegidos': {'FAM VELHA': {'X': {'parts': []}}}, 'footprints': {}}
    G.segue_renomeacoes(led3, esps, G.indice_almox(esps), log=lambda *a: None)
    eq(list(led3['protegidos']), ['FAM VELHA'],
       'dois candidatos com o mesmo nome: nao adivinha, deixa como esta')

    # e o BACKFILL: a entrada achada pelo nome ganha o id do produto, que e o que faz a
    # PROXIMA renomeacao ser seguida
    eq(led['footprints']['RESISTOR']['SMD 0805 1K NOVO'].get('odoo'), '101',
       'a entrada achada pelo nome tem de guardar o id do produto')
    # o destino ja ocupado nao e sobrescrito: a escolha que ja existe la manda
    eq('SMD 0805 1K' in led['footprints']['RESISTOR'], True,
       'destino ocupado: a entrada velha fica onde esta, sem atropelar a de la')

    tudo_por_id()

    if falhas:
        print('test_almox_renome FALHOU em %d caso(s):\n' % len(falhas))
        for f in falhas:
            print('  - %s\n' % f)
        return 1
    print('test_almox_renome OK (mantem numero e data, atravessa simbolo, nao deixa '
          'zumbi, sobrevive sem o espelho, e leva junto desenho e footprint)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
