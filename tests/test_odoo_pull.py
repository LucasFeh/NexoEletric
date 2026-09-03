# -*- coding: utf-8 -*-
"""A puxada incremental do Odoo, com um servidor de mentira.

    python tests/test_odoo_pull.py

O que este teste protege: que uma sincronização normal **não** releia o catálogo inteiro.
Ela só pode baixar a ficha do que é novo ou mudou — mas tem que reescrever saldo e
localização de TODO mundo, que é o que muda sem passar pelo cadastro do produto.
"""
import io, os, sys, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import odoo_pull as OP  # noqa: E402


class OdooFake(object):
    """Só o suficiente de product.product / product.template / stock.quant / supplierinfo.

    Registra cada chamada, que é o ponto do teste: o incremental tem que pedir a ficha
    de poucos produtos, não de todos.
    """

    def __init__(self, produtos, saldos):
        self.produtos = produtos        # [{id, tmpl, nome, categ, write_date, custo, forn}]
        self.saldos = saldos            # {pid: {local: qtd}}
        self.chamadas = []

    # a interface que o odoo_pull usa
    def busca(self, modelo, dominio, campos, passo=2000):
        self.chamadas.append(('busca', modelo, len(campos)))
        if modelo == 'product.product':
            return [{'id': p['id'], 'product_tmpl_id': [p['tmpl'], p['nome']],
                     'write_date': p['write_date']} for p in self.produtos]
        if modelo == 'stock.location':
            return [{'id': 1, 'complete_name': OP.ALMOX},
                    {'id': 2, 'complete_name': 'DI/Producao'}]
        if modelo == 'product.supplierinfo':
            alvo = None
            for c in dominio:
                if c[0] == 'product_tmpl_id':
                    alvo = set(c[2])
            fora = []
            for p in self.produtos:
                if p.get('forn') and (alvo is None or p['tmpl'] in alvo):
                    fora.append({'product_tmpl_id': [p['tmpl'], p['nome']],
                                 'partner_id': [9, 'MOUSER ELETRONICS'],
                                 'product_code': p['forn'], 'price': 1.0})
            return fora
        return []

    def ler(self, modelo, ids, campos, passo=500):
        ids = list(ids)
        self.chamadas.append(('ler', modelo, len(ids)))
        if modelo == 'product.product':
            return [{'id': p['id'], 'product_tmpl_id': [p['tmpl'], p['nome']],
                     'barcode': '', 'standard_price': p.get('custo', 0),
                     'default_code': p.get('bin', ''), 'write_date': p['write_date']}
                    for p in self.produtos if p['id'] in ids]
        if modelo == 'product.template':
            return [{'id': p['tmpl'], 'name': p['nome'], 'categ_id': [1, p['categ']],
                     'uom_id': [1, 'Unidades'], 'list_price': 0, 'type': 'product',
                     'default_code': p.get('bin', '')}
                    for p in self.produtos if p['tmpl'] in ids]
        return []

    def ids(self, modelo, dominio):
        self.chamadas.append(('ids', modelo, 0))
        return []

    def call(self, modelo, metodo, args, kw=None):
        self.chamadas.append((metodo, modelo, 0))
        if modelo == 'stock.quant' and metodo == 'read_group':
            fora = []
            for pid, locs in self.saldos.items():
                for lid, qtd in locs.items():
                    fora.append({'product_id': [pid, 'p%d' % pid],
                                 'location_id': [lid, 'L%d' % lid], 'quantity': qtd})
            return fora
        return []


def produto(i, wd, nome=None, forn=None, bin_=''):
    return {'id': i, 'tmpl': 1000 + i, 'nome': nome or 'Resistor Metal Filme %dK SMD 0805' % i,
            'categ': 'Resistores - 0805', 'write_date': wd, 'custo': 0.01 * i,
            'forn': forn, 'bin': bin_}


def puxa(fake, anteriores):
    """chama OP.puxa com o Odoo trocado pelo dublê"""
    real, OP.Odoo = OP.Odoo, lambda *a, **k: fake
    try:
        return OP.puxa({'url': 'x', 'db': 'y', 'login': 'z', 'senha': 'w'},
                       anteriores, log=lambda *a: None)
    finally:
        OP.Odoo = real


def main():
    cfg_produtos = [produto(1, '2026-01-01 10:00:00', bin_='G-1-1'),
                    produto(2, '2026-01-01 10:00:00', bin_='G-1-2'),
                    produto(3, '2026-01-01 10:00:00', bin_='G-1-3')]
    saldos = {1: {1: 10.0}, 2: {1: 5.0, 2: 3.0}, 3: {2: 7.0}}

    # ── 1. primeira puxada: sem CSV anterior, le tudo ──────────────────────────
    f = OdooFake(cfg_produtos, saldos)
    linhas, st = puxa(f, None)
    assert st['incremental'] is False, st
    assert st['total'] == 3, st
    assert st['fichas'] == 3, 'a primeira puxada tem que baixar as tres fichas'
    por = {int(r['product_id']): r for r in linhas}
    assert por[1]['qtd_almoxarifado'] == 10.0
    assert por[2]['qtd_total_interna'] == 8.0, por[2]
    assert por[2]['locais_estoque'] == 'DI/Almoxarifado | DI/Producao', por[2]
    assert por[3]['qtd_almoxarifado'] == 0.0, 'produto so na producao nao conta no almox'
    assert por[1]['localizacao_codigo'] == 'G-1-1'

    # ── 2. nada mudou: nenhuma ficha e baixada, mas o saldo e reescrito ────────
    saldos2 = {1: {1: 99.0}, 2: {1: 5.0, 2: 3.0}, 3: {2: 7.0}}
    f2 = OdooFake(cfg_produtos, saldos2)
    linhas2, st2 = puxa(f2, linhas)
    assert st2['incremental'] is True, st2
    assert st2['fichas'] == 0, 'sem mudanca nao se baixa ficha nenhuma: %r' % st2
    assert st2['novos'] == 0 and st2['sumiram'] == 0, st2
    lidos = [c for c in f2.chamadas if c[0] == 'ler']
    assert not lidos, 'leu ficha sem precisar: %r' % lidos
    por2 = {int(r['product_id']): r for r in linhas2}
    assert por2[1]['qtd_almoxarifado'] == 99.0, 'o saldo TEM que ser reescrito sempre'
    assert por2[1]['nome'] == por[1]['nome'], 'o resto veio do CSV anterior'

    # ── 3. um novo, um alterado, um arquivado ─────────────────────────────────
    novos = [produto(1, '2026-02-01 09:00:00', bin_='G-9-9'),      # mudou (bin novo)
             produto(4, '2026-02-01 09:00:00', nome='Resistor Metal Filme 4K7 SMD 0805',
                     forn='667-NOVO', bin_='G-4-4')]               # novo
    f3 = OdooFake([novos[0], cfg_produtos[1], novos[1]],           # o 3 saiu (arquivado)
                  {1: {1: 12.0}, 2: {1: 5.0}, 4: {1: 40.0}})
    linhas3, st3 = puxa(f3, linhas2)
    assert st3['novos'] == 1, st3
    assert st3['alterados'] == 1, st3
    assert st3['sumiram'] == 1, st3
    assert st3['fichas'] == 2, 'so as duas fichas que interessam: %r' % st3
    lidos = [c for c in f3.chamadas if c[0] == 'ler' and c[1] == 'product.product']
    assert lidos and lidos[0][2] == 2, 'baixou %r fichas em vez de 2' % (lidos,)
    por3 = {int(r['product_id']): r for r in linhas3}
    assert set(por3) == {1, 2, 4}, 'o arquivado tinha que sair: %r' % sorted(por3)
    assert por3[1]['localizacao_codigo'] == 'G-9-9', 'a prateleira nova nao entrou'
    assert por3[4]['fornecedor_partnumber'] == 'MOUSER ELETRONICS:667-NOVO', por3[4]
    assert por3[4]['qtd_almoxarifado'] == 40.0
    assert por3[2]['qtd_almoxarifado'] == 5.0

    # ── 4. CSV velho, sem write_date: cai no completo em vez de achar que nada mudou ──
    sem_wd = [{k: (v if k != 'write_date' else '') for k, v in r.items()} for r in linhas3]
    f4 = OdooFake([novos[0], cfg_produtos[1], novos[1]], {1: {1: 12.0}})
    _, st4 = puxa(f4, sem_wd)
    assert st4['incremental'] is False, 'sem write_date nao da para comparar: %r' % st4
    assert st4['fichas'] == 3, st4

    # ── 5. o CSV gravado tem as colunas que o gerador espera ──────────────────
    tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_pull.csv')
    try:
        OP.grava(linhas3, tmp)
        with io.open(tmp, encoding='utf-8') as fh:
            cab = fh.readline().strip().split(',')
        assert cab == OP.COLUNAS, cab
        assert 'write_date' in cab, 'sem write_date o proximo sync volta a ser completo'
        assert OP.le_csv(tmp) and len(OP.le_csv(tmp)) == 3
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    print('test_odoo_pull OK (incremental baixou 2 fichas de 3 produtos; '
          'saldo e prateleira sempre reescritos)')


if __name__ == '__main__':
    main()
