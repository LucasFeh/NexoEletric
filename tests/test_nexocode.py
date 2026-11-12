# -*- coding: utf-8 -*-
"""Rotas /api/nexocode/* (tools/rotas/nexocode.py): o pedido do botao NexoCODE do esquema vira um arquivo de briefing.

    python tests/test_nexocode.py

Tudo numa pasta de mentira (NEXOCODE_BRIEFINGS) e sem abrir nada (NEXOCODE_NAO_ABRIR=1), num Flask de verdade.
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
import nexocode as R  # noqa: E402


def main():
    from flask import Flask
    tmp = tempfile.mkdtemp(prefix='nexocode-')
    os.environ['NEXOCODE_BRIEFINGS'] = tmp
    os.environ['NEXOCODE_NAO_ABRIR'] = '1'
    try:
        app = Flask(__name__)
        R.registra(app, RAIZ, lambda req: True)
        c = app.test_client()
        e = c.get('/api/nexocode/estado').get_json()
        assert e['ok'] is True and 'instalado' in e and 'aberto' in e, e
        briefing = {'projeto': 'PLACA/TESTE: 1', 'esquema': {'componentes': [{'ref': 'U1', 'pinos': [{'num': '1', 'name': 'IO2', 'net': 'LED'}]}]},
                    'temSoftware': False, 'funcionalidade': 'pisca o LED', 'referencias': [{'tipo': 'repositorio', 'url': 'https://github.com/x/y'}]}
        r = c.post('/api/nexocode/abrir', json={'briefing': briefing})
        j = r.get_json()
        assert r.status_code == 200 and j['ok'], j
        assert os.path.dirname(j['arquivo']) == tmp and j['arquivo'].endswith('-PLACA_TESTE_1.json'), j['arquivo']
        with open(j['arquivo'], encoding='utf-8') as f:
            salvo = json.load(f)
        assert salvo['funcionalidade'] == 'pisca o LED' and salvo['versao'] == 1 and salvo['origemApp'] == 'nexoeletric'
        assert salvo['esquema']['componentes'][0]['pinos'][0]['net'] == 'LED'
        r = c.post('/api/nexocode/abrir', json={'briefing': 'nada'})
        assert r.status_code == 400
        # de fora desta maquina: recusa
        app2 = Flask('fora')
        R.registra(app2, RAIZ, lambda req: False)
        assert app2.test_client().post('/api/nexocode/abrir', json={'briefing': briefing}).status_code == 403
        print('ok: rotas do NexoCode')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
