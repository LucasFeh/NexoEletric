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


def roda(linhas, mapa, antes, quando):
    """uma geracao inteira, em memoria -> ({nome_simbolo: simbolo}, renomeacoes)"""
    A.AGORA_ISO = quando
    itens = [a for a in (F.analisar(l) for l in linhas) if a]
    simbolos = A.agrupar(itens)
    renomes = A.segue_renomeacoes(simbolos, antes, mapa)
    montados = [A.monta_simbolo(s, {}, mapa, antes, False) for s in simbolos.values()]
    A.grava_indice_odoo(montados, mapa)
    return {s['name']: s for s in montados}, renomes


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
