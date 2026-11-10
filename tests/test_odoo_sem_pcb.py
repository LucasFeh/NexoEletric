# -*- coding: utf-8 -*-
"""O envio da lista ao Odoo só com a PCB declarada (1.92.2).

    python tests/test_odoo_sem_pcb.py

Pedido do dono: "se um esquema não tiver com PCB declarada, é pra impedir o envio pro Odoo". A PCB declarada é o código
da placa escolhido no Definir projeto (o CodigoDaPlaca do cabeçalho do esquema); projeto sem documento de PCB (board.js)
também não vai. O servidor recusa o ensaio e o envio (409, semPcb), a prévia monta a lista e diz o porquê, e o
/api/lista/bloqueio responde à tela (o botão desligado com o motivo). Nada chega ao Odoo: o cliente é o falso do
tests/test_lista_extras.py, e o de verdade derruba o teste se for construído.
"""
import io
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import test_lista_extras as TX  # noqa: E402  (a bancada: Flask so com o Blueprint, Odoo falso, acervo fixo)

OL, OS = TX.OL, TX.OS


def projeto(params=None, board=True):
    d = TX.raiz_com('P', TX.comp('R1', TX.R10K))
    pasta = os.path.join(d, 'Projects', 'P')
    sch = TX.esquema(TX.comp('R1', TX.R10K))
    if params is None:
        sch.pop('params', None)
    else:
        sch['params'] = params
    with io.open(os.path.join(pasta, 'schematic.js'), 'w', encoding='utf-8') as f:
        f.write('var schematic = ' + json.dumps(sch, ensure_ascii=False) + ';\n')
    if not board:
        os.remove(os.path.join(pasta, 'board.js'))
    return d


def test_motivo_sem_pcb():
    casos = (
        (dict(params='CodigoDaPlaca=PMD-DI261946;Revisao=REV. C'), None),
        (dict(params=None), 'PCB não declarada'),
        (dict(params='CodigoDaPlaca='), 'PCB não declarada'),
        (dict(params='CodigoDaPlaca=PROJETO NÃO DEFINIDO'), 'PCB não declarada'),
        (dict(params='CodigoDaPlaca=*'), 'PCB não declarada'),
        (dict(params='CodigoDaPlaca=PMD-DI261946', board=False), 'não tem PCB'),
    )
    for kw, esperado in casos:
        d = projeto(**kw)
        try:
            m = OL.motivo_sem_pcb('P', OL.le_schematic('P', d), d)
            if esperado is None:
                assert m is None, (kw, m)
            else:
                assert m and esperado in m, (kw, m)
                assert esperado != 'PCB não declarada' or 'Definir projeto' in m, m
        finally:
            import shutil
            shutil.rmtree(d, ignore_errors=True)
    # o palpite pelo nome da pasta não declara a PCB
    assert OL.codigo_da_placa({'params': 'Revisao=B'}) == ''
    assert OL.codigo_da_placa({'params': 'codigodaplaca= PMD-DI261946 '}) == 'PMD-DI261946'


def test_rotas_recusam_sem_pcb_declarada():
    for kw, trecho in ((dict(params=None), 'Definir projeto'), (dict(params='CodigoDaPlaca=PMD-DI261946', board=False), 'não tem PCB')):
        b = TX._Bancada(projeto(**kw))
        try:
            st, j = b.get('/bloqueio?projeto=P')
            assert st == 200 and j['ok'] and trecho in (j['bloqueio'] or ''), j
            st, j = b.post('/previa', {'projeto': 'P', 'revisao': 'A'})
            assert st == 200 and j['ok'] and trecho in (j['bloqueio'] or ''), 'a prévia monta e diz o porquê: %r' % j
            assert j['payload']['linhas'], 'a lista aparece mesmo bloqueada'
            st, j = b.post('/ensaio', {'projeto': 'P', 'revisao': 'A'})
            assert st == 409 and j.get('semPcb') and trecho in j['error'], (st, j)
            st, j = b.post('/envio', {'projeto': 'P', 'revisao': 'A', 'confirmado': True,
                                      'uid_externo': 'altium:P:A', 'total_linhas': 1})
            assert st == 409 and j.get('semPcb') and trecho in j['error'], (st, j)
            assert not b.falso.visto, 'nada chegou ao Odoo (nem o ensaio)'
        finally:
            b.fecha()


def test_com_pcb_declarada_segue():
    b = TX._Bancada(projeto(params='CodigoDaPlaca=PMD-DI261946'))
    try:
        st, j = b.get('/bloqueio?projeto=P')
        assert st == 200 and j['bloqueio'] is None, j
        st, j = b.post('/previa', {'projeto': 'P', 'revisao': 'A'})
        assert j['ok'] and j['bloqueio'] is None, j
        st, ens = b.post('/ensaio', {'projeto': 'P', 'revisao': 'A'})
        assert st == 200 and ens['ok'], ens
        st, j = b.post('/envio', {'projeto': 'P', 'revisao': 'A', 'confirmado': True, 'uid_externo': ens['uid_externo'],
                                  'total_linhas': len(ens['payload']['linhas']), 'assinatura': ens['assinatura']})
        assert st == 200 and j['ok'], (st, j)
        assert [x[0] for x in b.falso.visto] == ['confere', 'envia'], 'só o Odoo falso'
    finally:
        b.fecha()


def main():
    n = 0
    for nome, fn in sorted(globals().items()):
        if nome.startswith('test_') and callable(fn):
            fn()
            n += 1
    print('test_odoo_sem_pcb OK (%d casos: sem PCB declarada e sem PCB recusam ensaio e envio, a prévia diz o porquê, '
          'com a PCB declarada segue)' % n)


if __name__ == '__main__':
    main()
