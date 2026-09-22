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
    test_encap_separa_valores_e_preserva_o_id()
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


# ─────────── o encapsulamento faz parte da identidade (2026-09-17) ───────────
# Dois produtos do Odoo com o MESMO valor e encapsulamentos diferentes sao pecas
# diferentes -- saldo proprio, local proprio, footprint proprio. Agrupados so pelo rotulo,
# viravam um componente com dois `itens` e `pkgs` de dois. Medido na lib real antes do
# conserto: 26 valores assim, entre eles o "SMD 0603 1K 1/4W 1% 100ppm", que juntava o
# resistor 0603 e o 1206.


def test_encap_separa_valores_e_preserva_o_id():
    import almox2lib as A2

    def item(nome, pkg):
        return {'familia': 'RESISTOR', 'grupo': 'b', 'des': 'R', 'forma': 'res', 'vias': 0,
                'npin': 0, 'mont': 'SMD', 'unidade': 'Unidades', 'pkg': pkg, 'mpn': '',
                'mpn_expl': '', 'rotulo': '1K', 'valor': 1000.0, 'valor_txt': '1K',
                'nome': nome, 'categoria': 'Resistores', 'estoque': 1, 'local': '',
                'custo': 0.0, 'mouser': '', 'fornecedores': '', 'odoo_id': 1, 'tmpl_id': 1,
                'pinos_pkg': 0}

    sims = A2.agrupar([item('R 1K 0603', '0603'), item('R 1K 1206', '1206')])
    sim = next(iter(sims.values()))
    assert len(sim['parts']) == 2, 'mesmo valor, encaps diferentes = DUAS pecas: %s' % list(sim['parts'])
    chaves = sorted(p['chave'] for p in sim['parts'].values())
    # o encap alfabeticamente primeiro fica com a chave LIMPA, e por isso com o id de
    # ontem; so o extra nasce componente novo
    assert chaves == ['1K', '1K 1206'], chaves

    # e o vazio vai para o FIM: o nome do componente sai de `pkgs`, que descarta vazio,
    # entao quem batiza o valor e o primeiro encap NAO vazio. Sem isto o item sem
    # encapsulamento herdava a chave limpa -- e o id -- de um valor cujo nome e do outro.
    sims2 = A2.agrupar([item('R 1K sem encap', ''), item('R 1K DO-35', 'DO-35')])
    sim2 = next(iter(sims2.values()))
    chaves2 = sorted(p['chave'] for p in sim2['parts'].values())
    assert chaves2 == ['1K', '1K (sem encap)'], chaves2
    assert next(p['chave'] for p in sim2['parts'].values() if p['encap'] == 'DO-35') == '1K',         'quem tem encapsulamento e quem fica com a chave limpa'

    # e a numeracao chaveia pela CHAVE: dois rotulos iguais nao podem levar o mesmo id
    mapa = {}
    vals = [{'altium': 'SMD 0603 1K', 'label': '1K'},
            {'altium': 'SMD 1206 1K', 'label': '1K', 'chave': '1K 1206'}]
    A2.numera_valores('RESISTOR [SMD]', vals, mapa, {}, False)
    assert vals[0]['id'] != vals[1]['id'], 'os dois receberam o mesmo id: %s' % vals
    assert sorted(mapa['RESISTOR [SMD]']['ids']) == ['1K', '1K 1206'], mapa['RESISTOR [SMD]']['ids']
    print('encap separa valores, e o primario mantem a chave (e o id) ok')
    testa_marca_de_componente()



def testa_marca_de_componente():
    """A marca "e componente eletronico" do Odoo (coluna `componente`) manda no que entra.

    Ela ganha do LIXO -- a lista de palavras que tenta adivinhar o que nao e componente e
    erra dos dois lados: deixa passar a "Chave Canhao 8mm Gedore" porque o nome comeca com
    "Chave", e barra o "Conector DB9 com Borne Parafuso" porque tem "parafuso" no meio.

    VAZIO NAO E "NAO". Dump anterior a esta coluna, ou Odoo sem a customizacao, nao trazem o
    campo -- e trata-lo como "nao e componente" faria a biblioteca nascer VAZIA no primeiro
    sincronismo depois da atualizacao. E o unico caso aqui em que errar custa tudo.
    """
    base = linha('Resistor Metal Filme 1K 1/4W 1% 100ppm SMD 0805', 'Resistores - 0805', '9')

    r = dict(base); r['componente'] = 'true'
    assert F.analisar(r), 'marcado entra'

    r = dict(base); r['componente'] = 'false'
    assert F.analisar(r) is None, 'NAO marcado fica de fora'

    r = dict(base); r['componente'] = ''
    assert F.analisar(r), 'vazio nao e "nao": entra (Odoo sem o campo)'

    r = dict(base)                              # a chave nem existe: dump antigo
    assert F.analisar(r), 'dump sem a coluna nao pode esvaziar a biblioteca'

    # e o portao vem ANTES do LIXO: marcar resolve o falso positivo da lista de palavras
    r = linha('Conector DB9 Macho com Borne Parafuso Serial RS232/RS485', 'Conectores', '10')
    assert F.analisar(r) is None, 'sem marca, o "parafuso" do LIXO ainda derruba'
    r['componente'] = 'true'
    assert F.analisar(r) is None, ('o LIXO continua valendo depois do portao: a marca nao '
                                   'desliga a lista de palavras, so a antecede')
    print('marca de componente ok (marcado entra, desmarcado sai, vazio nao e nao)')


if __name__ == '__main__':
    sys.exit(main())
