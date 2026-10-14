# -*- coding: utf-8 -*-
"""POST /api/board-novo (tools/rotas/board_novo.py): o board.js mestre da placa que nasce no hub.

    python3 tests/test_board_novo.py

Tudo num workspace de mentira (tempdir): a rota cria pasta e grava arquivo. O fim liga a rota num
Flask de verdade e faz o POST pelo cliente de teste.
"""
import json
import os
import shutil
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, ValueError):
    pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))
import board_novo as R  # noqa: E402


def board(master=True, exporter='EletricHUB', extra=''):
    b = {'format': 'pcbmirror-v1', 'exporter': exporter, 'master': master,
         'board': {'bbox': {'x1': 0, 'y1': 0, 'x2': 40, 'y2': 30},
                   'outline': [{'kind': 'line', 'x1': 0, 'y1': 0, 'x2': 40, 'y2': 0}]},
         'nets': [], 'components': [], 'nota': extra}
    if master is None:
        del b['master']
    linhas = ['var pcbmirror = {']
    ks = list(b)
    for i, k in enumerate(ks):
        linhas.append(json.dumps(k) + ':' + json.dumps(b[k]) + (',' if i < len(ks) - 1 else ''))
    linhas.append('};')
    return '\n'.join(linhas) + '\n'


def ler(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


tmp = tempfile.mkdtemp(prefix='boardnovo-')
try:
    os.mkdir(os.path.join(tmp, 'Projects'))
    P = os.path.join(tmp, 'Projects')

    # nome ruim
    for nome in ['', '..', '../x', 'a/b', 'a\\b', 'CON', 'nul.txt', 'x.', 'x ', ' x', 'a:b', '.oculta', 'x' * 121]:
        r, st = R.board_novo(tmp, {'proj': nome, 'conteudo': board()})
        assert st == 400 and not r['ok'], (nome, r)
    assert os.listdir(P) == [], 'nome recusado nao cria nada'

    # conteudo ruim
    for cont, msg in [(None, 'conteudo'), ('', 'conteudo'), ('{}', 'board.js'), ('var pcbmirror = {nao json};', 'invalido'),
                      (board(master=False), 'mestra'), (board(exporter='ExportBoard 2026-10'), 'mestra'),
                      (board(master=None), 'mestra')]:
        r, st = R.board_novo(tmp, {'proj': 'Placa X', 'conteudo': cont})
        assert st == 400 and msg in r['error'], (cont, r)
    assert os.listdir(P) == []
    r, st = R.board_novo(tmp, 'nao e dict')
    assert st == 400

    # cria: pasta, board.js e changes.js vazio; acento no nome vale (os projetos da casa tem)
    r, st = R.board_novo(tmp, {'proj': 'LM555 astável', 'conteudo': board(extra='v1')})
    assert st == 200 and r['ok'] and r['criouPasta'] and not r['sobrescreveu'], r
    d = os.path.join(P, 'LM555 astável')
    assert '"v1"' in ler(os.path.join(d, 'board.js'))
    assert 'var changes = [' in ler(os.path.join(d, 'changes.js'))

    # sobrescreve placa mestra, com .bak; changes.js existente fica
    with open(os.path.join(d, 'changes.js'), 'w', encoding='utf-8') as f:
        f.write('var changes = [\n{"op":"net_add","net":"GND"},\n];\n')
    r, st = R.board_novo(tmp, {'proj': 'LM555 astável', 'conteudo': board(extra='v2')})
    assert st == 200 and r['sobrescreveu'] and not r['criouPasta'], r
    assert '"v2"' in ler(os.path.join(d, 'board.js')) and '"v1"' in ler(os.path.join(d, 'board.js.bak'))
    assert 'net_add' in ler(os.path.join(d, 'changes.js')), 'changes.js do usuario nao e tocado'

    # espelho do Altium: nunca sobrescreve
    e = os.path.join(P, 'DMB')
    os.mkdir(e)
    espelho = board(master=None, exporter='ExportBoard 2026-10')
    with open(os.path.join(e, 'board.js'), 'w', encoding='utf-8') as f:
        f.write(espelho)
    r, st = R.board_novo(tmp, {'proj': 'DMB', 'conteudo': board()})
    assert st == 409 and 'espelho' in r['error'], r
    assert ler(os.path.join(e, 'board.js')) == espelho and not os.path.exists(os.path.join(e, 'board.js.bak'))
    # espelho antigo, sem exporter nem master (os 16 do workspace hoje)
    with open(os.path.join(e, 'board.js'), 'w', encoding='utf-8') as f:
        f.write('var pcbmirror = {\n"format":"pcbmirror-v1",\n"nets":[\n"GND"\n,"VCC"\n],\n};\n')
    r, st = R.board_novo(tmp, {'proj': 'DMB', 'conteudo': board()})
    assert st == 409, r
    # board.js ilegivel: nao sobrescreve
    with open(os.path.join(e, 'board.js'), 'w', encoding='utf-8') as f:
        f.write('lixo')
    r, st = R.board_novo(tmp, {'proj': 'DMB', 'conteudo': board()})
    assert st == 409 and 'legivel' in r['error'], r

    # mesma pasta em outra grafia: recusa (no Windows seria a mesma pasta)
    r, st = R.board_novo(tmp, {'proj': 'dmb', 'conteudo': board()})
    assert st == 409 and 'grafia' in r['error'], r
    # arquivo com o nome do projeto
    with open(os.path.join(P, 'arquivo'), 'w') as f:
        f.write('x')
    r, st = R.board_novo(tmp, {'proj': 'arquivo', 'conteudo': board()})
    assert st == 409, r

    # le_var aceita o formato do ExportBoard (virgula na frente, // no topo)
    v = R.le_var('// x\nvar pcbmirror = {\n"a":[\n1\n,2\n],\n"b":{"c":1},\n};\n')
    assert v == {'a': [1, 2], 'b': {'c': 1}}

    # ligado num Flask de verdade
    try:
        from flask import Flask
    except ImportError:
        Flask = None
    if Flask:
        app = Flask(__name__)
        R.registra(app, lambda: tmp)
        c = app.test_client()
        resp = c.post('/api/board-novo', json={'proj': 'Pela rota', 'conteudo': board(extra='rota')})
        assert resp.status_code == 200 and resp.get_json()['ok'], resp.get_data(as_text=True)
        assert os.path.isfile(os.path.join(P, 'Pela rota', 'board.js'))
        resp = c.post('/api/board-novo', data='nao json', content_type='application/json')
        assert resp.status_code == 400
        resp = c.post('/api/board-novo', json={'proj': 'DMB', 'conteudo': board()})
        assert resp.status_code == 409
    print('test_board_novo: ok' + ('' if Flask else ' (sem flask: a rota nao foi ligada)'))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
