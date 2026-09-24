# -*- coding: utf-8 -*-
"""A url do Odoo atravessa a regeracao sem puxar (almox2lib.url_odoo_anterior).

Regerar sem --pull ("So regerar do snapshot", a unica opcao do hub sem senha gravada)
escreve `fonte = 'snapshot em disco'`, sem url. O "Odoo ↗" das telas (hub-odoolink.js) monta
o link da ficha a partir da url do indice, e todos sumiam ate a proxima puxada. O gerador
agora carrega a url da puxada anterior em `odooUrl`; este teste prende a leitura dela:
  1. `odooUrl` do indice anterior vale primeiro;
  2. sem ele (indice de antes do campo), a url de dentro do `fonte` — sem o " · odoo_db";
  3. indice de snapshot sem url, arquivo ausente ou corrompido: '' (nunca excecao).

Nao roda o gerador: ele escreve na Libs/ real. Roda com pytest ou sozinho.
"""
import io
import json
import os
import sys
import tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import almox2lib as A                                   # noqa: E402


def _indice(pasta, obj):
    caminho = os.path.join(pasta, 'almox-index.js')
    with io.open(caminho, 'w', encoding='utf-8', newline='\n') as f:
        f.write('var almoxIndex = %s;\n' % json.dumps(obj, ensure_ascii=False, indent=1))
    return caminho


def test_odoo_url_vale_primeiro():
    with tempfile.TemporaryDirectory() as d:
        c = _indice(d, {'fonte': 'snapshot em disco', 'odooUrl': 'http://192.168.15.192:8070/'})
        assert A.url_odoo_anterior(c) == 'http://192.168.15.192:8070'


def test_sem_campo_cai_na_url_do_fonte():
    with tempfile.TemporaryDirectory() as d:
        c = _indice(d, {'fonte': 'Odoo completo · http://192.168.15.182:8070 · odoo_db'})
        assert A.url_odoo_anterior(c) == 'http://192.168.15.182:8070', \
            'o separador " · " nao pode entrar na url'


def test_snapshot_sem_url_ausente_e_corrompido():
    with tempfile.TemporaryDirectory() as d:
        assert A.url_odoo_anterior(_indice(d, {'fonte': 'snapshot em disco'})) == ''
        assert A.url_odoo_anterior(os.path.join(d, 'nao-existe.js')) == ''
        ruim = os.path.join(d, 'ruim.js')
        io.open(ruim, 'w', encoding='utf-8').write('var almoxIndex = {quebrado;')
        assert A.url_odoo_anterior(ruim) == ''


def test_indice_real_tem_url():
    """o indice que esta no disco (se o sync ja rodou nesta maquina) rende uma url"""
    real = os.path.join(RAIZ, 'Libs', 'almox-index.js')
    if not os.path.exists(real):
        return
    url = A.url_odoo_anterior(real)
    assert url.startswith('http'), url


if __name__ == '__main__':
    for nome, fn in sorted(globals().items()):
        if nome.startswith('test_') and callable(fn):
            fn()
    print('test_almox_odoo_url OK (odooUrl primeiro, url do fonte sem o " · db", '
          'snapshot/ausente/corrompido dao vazio, indice real rende url)')
