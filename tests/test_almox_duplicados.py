# -*- coding: utf-8 -*-
"""O mesmo produto do Odoo em mais de um componente: o aviso e o "apagar os antigos".

    python3 tests/test_almox_duplicados.py

Pedido do dono (2026-09-29): tudo é vinculado pelo ID do Odoo, e o produto que aparece duas
vezes na biblioteca — o TMAG5131A1, nº 4 `fora` com o nome antigo e nº 46 vivo com o novo —
tem de ser APONTADO. O gerador nunca apaga sozinho; quem apaga é o usuário, em lote, pela
rota /api/symbols/almox-duplicados. Roda num workspace temporário, com espelhos sintéticos,
pelo test_client do hubserver: nada encosta na Libs/ de verdade.
"""
import json
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import hubserver as H            # noqa: E402  (o blueprint tem que vir registrado daqui)
import symserver as S            # noqa: E402
import guardiao as G             # noqa: E402
import almox2lib as A            # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def valor(vid, altium, oids, fora=False):
    v = {'id': vid, 'altium': altium, 'label': altium, 'itens': [{'odoo': o} for o in oids]}
    if fora:
        v.update(fora=True, estoque=0)
    return v


ESPECIAIS = {'symbols': [
    {'name': 'SENSOR [PINAGEM A DEFINIR]', 'familia': 'SENSOR', 'grupo': 'especiais', 'valores': [
        valor(4, 'Hall / Magnetico TMAG5131A1', ['1523'], fora=True),     # o zumbi
        valor(46, 'Hall Magnetico TMAG5131A1', ['1523']),                 # o vivo
        valor(7, 'Saiu do Odoo', ['900'], fora=True),                     # fora de verdade: fica
    ]},
]}
BASICOS = {'symbols': [
    {'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'grupo': 'basicos', 'valores': [
        valor(1, 'SMD 0805 1K', ['101'], fora=True),
        valor(9, 'SMD 0805 1K Yageo', ['101']),
        valor(2, 'SMD 0805 2K2', ['102']),
        # dois zumbis do MESMO produto que saiu do Odoo: duplicado, mas sem vivo — nao e
        # "antigo de ninguem", o lote nao leva
        valor(3, 'SMD 0805 10K', ['103'], fora=True),
        valor(5, 'SMD 0805 10K 1%', ['103'], fora=True),
        # zumbi que carrega DOIS produtos e so um vive noutro: nao entra no lote
        valor(6, 'SMD 0805 47K', ['104', '105'], fora=True),
        valor(8, 'SMD 0805 47K novo', ['104']),
    ]},
]}


def grava_espelho(nome, var, esp):
    G.grava_espelho_almox(os.path.join(tmp, 'Libs', nome), var,
                          dict(esp, title=nome, generated='29/09/2026 10:00:00'))


tmp = tempfile.mkdtemp(prefix='duplicados-')
real_root = H.ROOT
try:
    os.makedirs(os.path.join(tmp, 'Libs'))
    os.makedirs(os.path.join(tmp, 'Projects', 'P1'))
    grava_espelho('almox-basicos.js', 'almoxBasicos', BASICOS)
    grava_espelho('almox-especiais.js', 'almoxEspeciais', ESPECIAIS)
    # um projeto que usa o nome ANTIGO: U1 com o id (a folha o leva ao vivo), U2 sem
    with open(os.path.join(tmp, 'Projects', 'P1', 'schematic.js'), 'w', encoding='utf-8') as f:
        f.write('var schematic = {\n"format":"schmirror-v2",\n"items":[\n'
                '{"t":"comp","sheet":"s","ref":"U1","sym":"Hall / Magnetico TMAG5131A1","x":0,"y":0,"rot":0,'
                '"footprint":"SOT-23","params":"Comment=x;OdooId=1523;ValorId=4"},\n'
                '{"t":"comp","sheet":"s","ref":"U2","sym":"Hall / Magnetico TMAG5131A1","x":0,"y":0,"rot":0,'
                '"footprint":"SOT-23","params":"Comment=x;ValorId=4"},\n'
                '{"t":"comp","sheet":"s","ref":"R1","sym":"SMD 0805 2K2","x":0,"y":0,"rot":0,"footprint":"R0805"}\n'
                ']};\n')
    H.ROOT = S.ROOT = tmp
    cli = H.app.test_client()

    # ── a lista ───────────────────────────────────────────────────────────────
    j = cli.get('/api/symbols/almox-duplicados').get_json()
    assert j['ok'], j
    assert [g['odoo'] for g in j['grupos']] == ['101', '103', '104', '1523'], j['grupos']
    assert j['soFora'] == 1, 'o 103 so tem zumbis: duplicado, mas sem vivo'
    assert j['misturados'] == 1, 'o 104: tem vivo, mas o antigo carrega tambem o 105, que saiu'
    antigos = sorted((a['simbolo'], a['altium']) for a in j['antigos'])
    assert antigos == [('RESISTOR [SMD]', 'SMD 0805 1K'),
                       ('SENSOR [PINAGEM A DEFINIR]', 'Hall / Magnetico TMAG5131A1')], antigos
    print('lista ok: 4 produtos repetidos, 2 antigos apagaveis (o de dois produtos e os so-fora ficam)')

    # ── a previa nao encosta em nada e diz onde e usado ──────────────────────
    antes = {f: open(os.path.join(tmp, 'Libs', f), 'rb').read()
             for f in ('almox-basicos.js', 'almox-especiais.js')}
    j = cli.post('/api/symbols/almox-duplicados', json={}).get_json()
    assert j['ok'] and j['previa'] and len(j['antigos']) == 2, j
    assert j['usos'] == [{'projeto': 'P1', 'refs': ['U1', 'U2'], 'semId': ['U2']}], j['usos']
    assert j['total'] == 2 and j['semId'] == 1, j
    assert all(open(os.path.join(tmp, 'Libs', f), 'rb').read() == b for f, b in antes.items()), \
        'a previa nao pode mexer no espelho'
    print('previa ok: usos por nome, e quem nao tem OdooId e contado a parte')

    # ── durante a sincronizacao, 409 ──────────────────────────────────────────
    assert S._sync_lock.acquire(blocking=False)
    try:
        r = cli.post('/api/symbols/almox-duplicados', json={'confirmar': True})
        assert r.status_code == 409, r.status_code
    finally:
        S._sync_lock.release()

    # ── apagar ────────────────────────────────────────────────────────────────
    j = cli.post('/api/symbols/almox-duplicados', json={'confirmar': True}).get_json()
    assert j['ok'] and j['apagados'] == 2, j
    esp = {}
    for f in ('almox-basicos.js', 'almox-especiais.js'):
        _v, e = G.le_espelho_almox(os.path.join(tmp, 'Libs', f))
        esp.update({s['name']: [v['altium'] for v in s['valores']] for s in e['symbols']})
    assert esp['SENSOR [PINAGEM A DEFINIR]'] == ['Hall Magnetico TMAG5131A1', 'Saiu do Odoo'], esp
    assert esp['RESISTOR [SMD]'] == ['SMD 0805 1K Yageo', 'SMD 0805 2K2', 'SMD 0805 10K',
                                     'SMD 0805 10K 1%', 'SMD 0805 47K', 'SMD 0805 47K novo'], esp
    reg = A.carrega_excluidos(tmp)['itens']
    assert sorted(it['altium'] for it in reg) == ['Hall / Magnetico TMAG5131A1', 'SMD 0805 1K'], reg
    assert all(it.get('quando') for it in reg), 'o registro diz quando'
    # e a lista que sobra
    j = cli.get('/api/symbols/almox-duplicados').get_json()
    assert [g['odoo'] for g in j['grupos']] == ['103', '104'] and j['antigos'] == [], j
    # segunda passada: nada a apagar, e o registro nao duplica
    j = cli.post('/api/symbols/almox-duplicados', json={'confirmar': True}).get_json()
    assert j['ok'] and j['apagados'] == 0, j
    assert len(A.carrega_excluidos(tmp)['itens']) == 2
    print('apagar ok: so os antigos com gemeo vivo saem; registro em almox-excluidos.json')
finally:
    H.ROOT = S.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)

print('test_almox_duplicados OK (lista, previa com usos, 409 na sincronizacao, apaga so os antigos)')
