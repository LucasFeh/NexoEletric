# -*- coding: utf-8 -*-
"""O nome do componente do almoxarifado (o LibReference na .SchLib, o `valores[].altium` do
espelho) so leva o que e FATO do item.

  especiais  o simbolo e por pinagem, nao por montagem: a montagem entra no nome so quando o
             PROPRIO item a declara (encapsulamento SOIC8/DIP8, ou palavra no nome do Odoo).
             A do primeiro item que criou o simbolo e a presumida pela dominante da familia
             NAO entram — foi assim que um SOIC8 saiu "PTH SOIC8 ..." e o SN65HVD75DR (SMD,
             sem encapsulamento no Odoo) saiu "PTH SN65HVD75DR".
  basicos    o simbolo e partido por montagem (RESISTOR [SMD] / RESISTOR [PTH]); o item omisso
             herda a dominante e mora na lib dela, e o nome tem de dizer em qual das duas.

Roda sem rede e sem Odoo: linhas sinteticas no formato do componentes_odoo.csv.
"""
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import almox2lib as A                                   # noqa: E402
import familias as F                                    # noqa: E402


def linha(nome, categoria, pid):
    return {'product_id': pid, 'template_id': pid, 'localizacao_codigo': 'G-1-1', 'nome': nome,
            'categoria': categoria, 'unidade': 'Unidades', 'qtd_almoxarifado': '1.0',
            'qtd_total_interna': '1.0', 'locais_estoque': 'DI/Almoxarifado', 'barcode': '',
            'custo': '1.0', 'preco_venda': '', 'fornecedor_partnumber': '', 'menor_preco_compra': '',
            'estocavel': 'true', 'tipo': 'consu', 'write_date': '2026-09-08 00:00:00'}


LINHAS = [
    # AMPLIFICADOR [8P]: o primeiro item e DIP8 (PTH); o SOIC8 que vem depois nao herda isso
    linha('Amplificador Operacional - CA3140EZ - DIP8', 'Amplificador Operacional (AMPOP)', '1'),
    linha('Amplificador Operacional Duplo TL082IDRQ1 - SOIC8', 'Amplificador Operacional (AMPOP)', '2'),
    # CIRCUITO INTEGRADO: dois PTH declarados (DIP14 e a palavra "(PTH)") fazem PTH a dominante
    # da familia; o SN65HVD75DR, sem encapsulamento no Odoo, herda a presuncao — e ela nao
    # pode ir para o nome
    linha('Circuito Integrado - TBA221A - DIP14', '', '3'),
    linha('CI - Amplificador Operacional - AD706K (PTH)', '', '4'),
    linha('Circuito de Interface RS-485 - SN65HVD75DR', 'Broca Aço Rápido', '5'),
    # basicos: dois resistores SMD 0603 declarados e um sem montagem, que herda o SMD e mora
    # no RESISTOR [SMD] — ai o nome TEM de dizer SMD, e o presumido e estrutural
    linha('Resistor Metal Filme 0R SMD 0603', 'Resistores - 0603', '6'),
    linha('Resistor Metal Filme 1K SMD 0603', 'Resistores - 0603', '7'),
    linha('Resistor 10K 1/4W', 'Resistores', '8'),
]


def main():
    analisados = [a for a in (F.analisar(r) for r in LINHAS) if a]
    assert len(analisados) == len(LINHAS), 'linha sintetica nao classificada: %s' % [
        r['nome'] for r in LINHAS if not F.analisar(r)]
    simbolos = A.agrupar(analisados)

    # a presuncao existe de verdade (senao a regra nao teria o que filtrar)
    sn = next(a for a in analisados if 'SN65HVD75DR' in a['nome'])
    assert sn['mont'] == 'PTH' and sn.get('mont_presumida'), (sn['mont'], sn.get('mont_presumida'))
    tl = next(a for a in analisados if 'TL082IDRQ1' in a['nome'])
    assert tl['mont'] == 'SMD' and not tl.get('mont_presumida'), tl['mont']

    nomes = {}
    for s in simbolos.values():
        sim = A.monta_simbolo(s, set(), {}, {}, False, None)
        for v in sim['valores']:
            nomes[v['altium']] = sim['name']

    def acha(pedaco):
        hits = [n for n in nomes if pedaco in n]
        assert len(hits) == 1, (pedaco, hits)
        return hits[0], nomes[hits[0]]

    nome, sim = acha('CA3140EZ')
    assert (nome, sim) == ('PTH DIP8 CA3140EZ', 'AMPLIFICADOR [8P]'), (nome, sim)
    nome, sim = acha('TL082IDRQ1')
    assert sim == 'AMPLIFICADOR [8P]' and nome.startswith('SMD SOIC8 '), (nome, sim)
    nome, sim = acha('SN65HVD75DR')
    assert (nome, sim) == ('SN65HVD75DR', 'CIRCUITO INTEGRADO [PINAGEM A DEFINIR]'), (nome, sim)
    nome, sim = acha('TBA221A')
    assert nome.startswith('PTH DIP14 ') and sim == 'CIRCUITO INTEGRADO [14P]', (nome, sim)
    nome, sim = acha('AD706K')
    assert nome.startswith('PTH ') and 'DIP' not in nome, nome          # declarado em palavra
    nome, sim = acha('10K')
    assert sim == 'RESISTOR [SMD]' and nome.startswith('SMD '), (nome, sim)
    nome, sim = acha('1K SMD') if any('1K SMD' in n for n in nomes) else acha('0603 1K')
    assert sim == 'RESISTOR [SMD]' and nome.startswith('SMD 0603 '), (nome, sim)

    # a regra em si
    assert A.montagem_declarada([{'mont': 'PTH', 'mont_presumida': True}]) == ''
    assert A.montagem_declarada([{'mont': 'SMD'}, {'mont': 'SMD'}]) == 'SMD'
    assert A.montagem_declarada([{'mont': 'SMD'}, {'mont': 'PTH'}]) == '', 'itens que discordam nao afirmam nada'
    assert A.montagem_declarada([{'mont': ''}, {'mont': 'PTH', 'mont_presumida': True}]) == ''
    print('test_almox_nomes OK (especial sem montagem declarada sai sem prefixo; SOIC8 nao herda o PTH '
          'do primeiro item; basico continua com a montagem do simbolo)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
