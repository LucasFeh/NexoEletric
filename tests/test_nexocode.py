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
        # 1.106.0: /api/nexocode/conectar acha a pasta LIGADA ao projeto (.nexocode/projeto.json) nas recentes e em Documentos
        docs = os.path.join(tmp, 'docs'); outra = os.path.join(tmp, 'outro-lugar', 'firmware-x')
        for d in (os.path.join(docs, 'SEM-LIGACAO'), os.path.join(outra, '.nexocode'), os.path.join(docs, 'PELO-NOME', 'src')):
            os.makedirs(d)
        with open(os.path.join(outra, '.nexocode', 'projeto.json'), 'w', encoding='utf-8') as f:
            json.dump({'projetoEletric': 'PLACA-LEDS', 'esquema': {'projeto': 'PLACA-LEDS', 'mcu': {'ref': 'U1'}}}, f)
        cfg = os.path.join(tmp, 'config.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'recentes': [outra, os.path.join(tmp, 'sumiu')]}, f)
        os.environ['NEXOCODE_DOCS'] = docs; os.environ['NEXOCODE_CONFIG'] = cfg
        r = c.post('/api/nexocode/conectar', json={'projeto': 'placa-leds', 'mcu': 'U1'}); j = r.get_json()
        assert r.status_code == 200 and j['ok'] and os.path.normcase(j['pasta']) == os.path.normcase(outra) and j['mcu'] == 'U1', j
        j = c.post('/api/nexocode/conectar', json={'projeto': 'PELO-NOME'}).get_json()
        assert j['ok'] and j['pasta'].endswith('PELO-NOME'), j
        r = c.post('/api/nexocode/conectar', json={'projeto': 'SEM-LIGACAO'})
        assert r.status_code == 404 and r.get_json()['semCodigo'], r.get_json()
        assert c.post('/api/nexocode/conectar', json={}).status_code == 400
        assert app2.test_client().post('/api/nexocode/conectar', json={'projeto': 'PLACA-LEDS'}).status_code == 403
        print('ok: rotas do NexoCode')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
