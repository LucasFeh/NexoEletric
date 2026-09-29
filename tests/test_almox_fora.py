# -*- coding: utf-8 -*-
"""Apagar os componentes `fora`: a seleção da categoria, a categoria inteira e a biblioteca.

    python3 tests/test_almox_fora.py

Pedido do dono (2026-09-29): um botão na categoria que seleciona todos os `fora`, e poder
apagar os `fora` da biblioteca. A rota /api/symbols/almox-fora só apaga `fora` — o que ainda
vem do Odoo voltaria no sincronismo seguinte, e o "apagar" mentiria. Roda num workspace
temporário, com espelhos sintéticos, pelo test_client do hubserver: nada encosta na Libs/.
"""
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


def espelhos():
    return {
        'almox-basicos.js': ('almoxBasicos', {'symbols': [
            {'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'valores': [
                valor(1, 'R velho 1', ['101'], fora=True),
                valor(2, 'R velho 2', ['102'], fora=True),
                valor(3, 'R vivo', ['103']),
                valor(4, 'R saiu', ['104'], fora=True)]},
            {'name': 'CAPACITOR [SMD]', 'familia': 'CAPACITOR', 'valores': [
                valor(1, 'C velho', ['201'], fora=True),
                valor(2, 'C vivo', ['202']),
                valor(3, 'R velho 1', ['203'], fora=True)]}]}),   # xara do resistor
        'almox-especiais.js': ('almoxEspeciais', {'symbols': [
            {'name': 'SENSOR', 'familia': 'SENSOR', 'valores': [
                valor(9, 'S velho', ['301'], fora=True)]}]}),
    }


def monta():
    for nome, (var, esp) in espelhos().items():
        G.grava_espelho_almox(os.path.join(tmp, 'Libs', nome), var,
                              dict(esp, title=nome, generated='29/09/2026 10:00:00'))


def nomes():
    fora = {}
    for f in ('almox-basicos.js', 'almox-especiais.js'):
        _v, e = G.le_espelho_almox(os.path.join(tmp, 'Libs', f))
        fora.update({s['name']: [v['altium'] for v in s['valores']] for s in e['symbols']})
    return fora


tmp = tempfile.mkdtemp(prefix='almoxfora-')
real_root = H.ROOT
try:
    os.makedirs(os.path.join(tmp, 'Libs'))
    os.makedirs(os.path.join(tmp, 'Projects', 'P1'))
    monta()
    # R1 usa "R velho 1" com o id 101 (que nao vive em lugar nenhum: fica orfao); R2 sem id
    with open(os.path.join(tmp, 'Projects', 'P1', 'schematic.js'), 'w', encoding='utf-8') as f:
        f.write('var schematic = {\n"format":"schmirror-v2",\n"items":[\n'
                '{"t":"comp","sheet":"s","ref":"R1","sym":"R velho 1","x":0,"y":0,"rot":0,'
                '"footprint":"R0805","params":"Comment=x;OdooId=101;ValorId=1"},\n'
                '{"t":"comp","sheet":"s","ref":"R2","sym":"R velho 2","x":0,"y":0,"rot":0,"footprint":"R0805"}\n'
                ']};\n')
    H.ROOT = S.ROOT = tmp
    cli = H.app.test_client()

    # ── a contagem ────────────────────────────────────────────────────────────
    j = cli.get('/api/symbols/almox-fora').get_json()
    assert j['ok'] and j['total'] == 6, j
    assert dict(j['porSimbolo']) == {'RESISTOR [SMD]': 3, 'CAPACITOR [SMD]': 2, 'SENSOR': 1}, j
    print('contagem ok: 6 fora em 3 categorias')

    # ── pedido mal formado: 400, e apagar tudo tem de ser dito ─────────────────
    for corpo in ({}, {'componentes': ['R velho 1']}, {'simbolo': ''}, {'simbolo': 'RESISTOR [SMD]', 'componentes': 'x'},
                  {'todos': 'sim'}):
        r = cli.post('/api/symbols/almox-fora', json=corpo)
        assert r.status_code == 400, (corpo, r.status_code, r.get_json())
    print('400 ok: sem escopo, componentes sem simbolo, e "todos" que nao e true')

    # ── a SELECAO da categoria: previa ─────────────────────────────────────────
    antes = {f: open(os.path.join(tmp, 'Libs', f), 'rb').read() for f in ('almox-basicos.js', 'almox-especiais.js')}
    sel = {'simbolo': 'RESISTOR [SMD]', 'componentes': ['R velho 1', 'R velho 2', 'R vivo', 'NAO EXISTE']}
    j = cli.post('/api/symbols/almox-fora', json=sel).get_json()
    assert j['ok'] and j['previa'], j
    assert [a['altium'] for a in j['alvos']] == ['R velho 1', 'R velho 2'], j['alvos']
    assert sorted((i['altium'], i['porque']) for i in j['ignorados']) == [
        ('NAO EXISTE', 'não está mais na biblioteca'), ('R vivo', 'não está fora: voltou ao Odoo')], j
    # o xara "R velho 1" do CAPACITOR nao entra: o nome vem com o simbolo
    assert j['usos'] == [{'projeto': 'P1', 'refs': ['R1', 'R2'], 'orfaos': ['R1', 'R2']}], j['usos']
    assert all(open(os.path.join(tmp, 'Libs', f), 'rb').read() == b for f, b in antes.items()), 'a previa nao mexe'
    print('previa da selecao ok: so os fora do simbolo pedido; vivo e sumido sao ignorados com o porque')

    # ── durante a sincronizacao, 409 ──────────────────────────────────────────
    assert S._sync_lock.acquire(blocking=False)
    try:
        assert cli.post('/api/symbols/almox-fora', json=dict(sel, confirmar=True)).status_code == 409
    finally:
        S._sync_lock.release()

    # ── apagar a selecao ───────────────────────────────────────────────────────
    j = cli.post('/api/symbols/almox-fora', json=dict(sel, confirmar=True)).get_json()
    assert j['ok'] and j['apagados'] == 2, j
    n = nomes()
    assert n['RESISTOR [SMD]'] == ['R vivo', 'R saiu'], n
    assert n['CAPACITOR [SMD]'] == ['C velho', 'C vivo', 'R velho 1'], 'o xara de outra familia fica'
    print('apagar a selecao ok')

    # ── a categoria inteira (sem componentes) ─────────────────────────────────
    j = cli.post('/api/symbols/almox-fora', json={'simbolo': 'CAPACITOR [SMD]', 'confirmar': True}).get_json()
    assert j['ok'] and j['apagados'] == 2, j
    assert nomes()['CAPACITOR [SMD]'] == ['C vivo']
    print('apagar os fora de uma categoria ok')

    # ── a biblioteca inteira ──────────────────────────────────────────────────
    j = cli.post('/api/symbols/almox-fora', json={'todos': True}).get_json()
    assert j['previa'] and sorted(a['altium'] for a in j['alvos']) == ['R saiu', 'S velho'], j
    j = cli.post('/api/symbols/almox-fora', json={'todos': True, 'confirmar': True}).get_json()
    assert j['ok'] and j['apagados'] == 2, j
    n = nomes()
    assert n == {'RESISTOR [SMD]': ['R vivo'], 'CAPACITOR [SMD]': ['C vivo'], 'SENSOR': []}, n
    assert cli.get('/api/symbols/almox-fora').get_json()['total'] == 0
    reg = sorted(it['altium'] for it in A.carrega_excluidos(tmp)['itens'])
    assert reg == ['C velho', 'R saiu', 'R velho 1', 'R velho 1', 'R velho 2', 'S velho'], reg
    print('apagar todos os fora da biblioteca ok; os vivos ficam, e tudo vai ao registro')
finally:
    H.ROOT = S.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)

print('test_almox_fora OK (contagem, 400, selecao com ignorados, 409, categoria e biblioteca inteira)')
