# -*- coding: utf-8 -*-
"""O gerador do almoxarifado so CRIA o que nao existe: o desenho e do HTML.

A regra de autoridade combinada em 2026-09-14: o que esta no espelho (`Libs/almox-*.js`)
e o desenho VALIDO, venha ele do `simbolos.py` de uma geracao antiga, do editor de
simbolos do hub ou do guardiao repondo o que veio do Altium. Uma sincronizacao continua
trazendo do Odoo TODO o resto — valores, saldo, local, custo, footprint, parametros — e
NAO redesenha nada que ja exista.

O que este teste prende, nesta ordem:
  1. simbolo que nao esta no espelho e desenhado (senao "so cria" viraria "nao cria").
  2. simbolo que esta sai com a geometria do espelho, intacta, mesmo que o `simbolos.py`
     desenhasse outra coisa — e `bbox`/`partcount` vao junto.
  3. o desenho PROPRIO de um valor (`valores[].parts`, o que o /save-almox grava)
     sobrevive, embora os valores sejam remontados do zero a cada rodada.
  4. so o DESENHO congelou: saldo, descricao, valores, itens e parametros continuam
     vindo do Odoo.

Roda sem rede e sem Odoo: linhas sinteticas no formato do componentes_odoo.csv.
"""
import copy
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import almox2lib as A                                   # noqa: E402
import familias as F                                    # noqa: E402


def linha(nome, categoria, pid, qtd='1.0'):
    return {'product_id': pid, 'template_id': pid, 'localizacao_codigo': 'G-1-1', 'nome': nome,
            'categoria': categoria, 'unidade': 'Unidades', 'qtd_almoxarifado': qtd,
            'qtd_total_interna': qtd, 'locais_estoque': 'DI/Almoxarifado', 'barcode': '',
            'custo': '1.0', 'preco_venda': '', 'fornecedor_partnumber': '', 'menor_preco_compra': '',
            'estocavel': 'true', 'tipo': 'consu', 'write_date': '2026-09-08 00:00:00'}


LINHAS = [
    linha('Resistor Metal Filme 0R SMD 0603', 'Resistores - 0603', '6'),
    linha('Resistor Metal Filme 1K SMD 0603', 'Resistores - 0603', '7'),
]

# Uma geometria que o simbolos.py nunca desenharia para um resistor: e a assinatura do
# teste. Dois pinos com nome e um triangulo, nada de retangulo.
DESENHO_DO_HUB = [{'part': 1,
                   'pins': [{'num': '1', 'name': 'A', 'x': -200, 'y': 0, 'len': 100,
                             'orient': 180, 'type': 'Passive'},
                            {'num': '2', 'name': 'K', 'x': 200, 'y': 0, 'len': 100,
                             'orient': 0, 'type': 'Passive'}],
                   'graphics': [{'g': 'poly', 'w': 10,
                                 'pts': [[-100, -80], [-100, 80], [100, 0], [-100, -80]]}]}]
BBOX_DO_HUB = {'x1': -300, 'y1': -80, 'x2': 300, 'y2': 80}
DESENHO_DO_VALOR = [{'part': 1, 'pins': [],
                     'graphics': [{'g': 'rect', 'x1': -1, 'y1': -1, 'x2': 1, 'y2': 1,
                                   'solid': True}]}]


def simbolos():
    analisados = [a for a in (F.analisar(r) for r in LINHAS) if a]
    assert len(analisados) == len(LINHAS), 'linha sintetica nao classificada'
    return A.agrupar(analisados)


def monta(s, antes):
    """uma rodada do gerador para UM simbolo, com o espelho anterior que o teste montar"""
    return A.monta_simbolo(s, set(), {}, antes, False, None)


def main():
    alvo = next(s for s in simbolos().values() if s['nome'] == 'RESISTOR [SMD]')

    # -- (1) simbolo novo: o gerador desenha -----------------------------------
    novo = monta(copy.deepcopy(alvo), {})
    assert novo['parts'] and novo['parts'][0]['pins'], 'simbolo novo tem que sair desenhado'
    assert novo['partcount'] == 1
    desenhado = copy.deepcopy(novo['parts'])
    assert desenhado != DESENHO_DO_HUB, 'a assinatura do teste tem que diferir do simbolos.py'
    assert novo['bbox']['x1'] != BBOX_DO_HUB['x1'], 'idem para a bbox'
    print('(1) simbolo que nao existe no espelho e desenhado pelo simbolos.py ok')

    # -- (2) simbolo que ja existe: a geometria do espelho manda ----------------
    espelho = {'RESISTOR [SMD]': {'name': 'RESISTOR [SMD]',
                                  'parts': copy.deepcopy(DESENHO_DO_HUB),
                                  'bbox': dict(BBOX_DO_HUB), 'partcount': 1, 'valores': []}}
    r = monta(copy.deepcopy(alvo), espelho)
    assert r['parts'] == DESENHO_DO_HUB, 'o desenho do espelho tem que sair intacto'
    assert r['bbox'] == BBOX_DO_HUB, r['bbox']
    assert r['partcount'] == 1
    assert espelho['RESISTOR [SMD]']['parts'] == DESENHO_DO_HUB, \
        'o gerador nao pode editar o espelho que leu'
    print('(2) simbolo que ja existe sai com a geometria do espelho, e a bbox vai junto ok')

    multi = copy.deepcopy(espelho)
    multi['RESISTOR [SMD]']['parts'] = DESENHO_DO_HUB + [{'part': 2, 'pins': [], 'graphics': []}]
    multi['RESISTOR [SMD]']['partcount'] = 2
    assert monta(copy.deepcopy(alvo), multi)['partcount'] == 2
    print('(2b) partcount acompanha o numero de parts do espelho ok')

    vazio = {'RESISTOR [SMD]': {'name': 'RESISTOR [SMD]', 'parts': [], 'valores': []}}
    assert monta(copy.deepcopy(alvo), vazio)['parts'] == desenhado, \
        'entrada sem parts nao e desenho congelado: e entrada sem desenho'
    print('(2c) entrada do espelho sem `parts` volta a ser desenhada ok')

    # -- (3) o desenho proprio de um valor sobrevive ----------------------------
    label = monta(copy.deepcopy(alvo), {})['valores'][0]['label']
    com_valor = copy.deepcopy(espelho)
    com_valor['RESISTOR [SMD]']['valores'] = [{'label': label,
                                               'parts': copy.deepcopy(DESENHO_DO_VALOR)}]
    r = monta(copy.deepcopy(alvo), com_valor)
    v = next(x for x in r['valores'] if x['label'] == label)
    assert v.get('parts') == DESENHO_DO_VALOR, (label, v.get('parts'))
    outros = [x for x in r['valores'] if x['label'] != label]
    assert outros and all(not x.get('parts') for x in outros), \
        'valor sem desenho proprio continua sem — quem nao tem usa o da familia'
    print('(3) valores[].parts do espelho sobrevive a remontagem dos valores ok')

    # -- (4) so o desenho congelou ---------------------------------------------
    mexido = copy.deepcopy(espelho)
    mexido['RESISTOR [SMD]']['estoque'] = 999
    mexido['RESISTOR [SMD]']['description'] = 'descricao velha do espelho'
    r = monta(copy.deepcopy(alvo), mexido)
    assert r['estoque'] == novo['estoque'] != 999, (r['estoque'], novo['estoque'])
    assert r['description'] == novo['description'], r['description']
    assert [x['label'] for x in r['valores']] == [x['label'] for x in novo['valores']]
    assert r['itens'] == novo['itens']
    pr = {p['n']: p['v'] for p in r['valores'][0]['params']}
    pn = {p['n']: p['v'] for p in novo['valores'][0]['params']}
    assert pr['Estoque'] == pn['Estoque'] and pr['Local'] == pn['Local']
    print('(4) saldo, descricao, valores, itens e parametros continuam vindo do Odoo ok')

    print('test_almox_congelado OK (o gerador so cria o que nao existe; o desenho e do HTML)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
