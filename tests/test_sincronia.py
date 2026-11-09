# -*- coding: utf-8 -*-
"""As rotas /api/sincronia/* (tools/rotas/sincronia.py, 1.85.0): a pagina diz o projeto aberto, le o aviso de
desatualizado que o motor escreveu e pede "Sincronizar e atualizar".

    python tests/test_sincronia.py
"""
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

from flask import Flask

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))
import sincronia  # noqa: E402


class Rotas(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='sincronia-')
        os.makedirs(os.path.join(self.tmp, 'Projects', 'P1'))
        app = Flask(__name__)
        sincronia.registra(app, self.tmp)
        self.c = app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_aberto(self):
        self.assertTrue(self.c.post('/api/sincronia/aberto', json={'janela': 'j1', 'projetos': ['P1']}).get_json()['mudou'])
        self.c.post('/api/sincronia/aberto', json={'janela': 'j2', 'projetos': ['P2', '../x']})
        self.assertEqual(sincronia.abertos(self.tmp), {'P1', 'P2'})
        self.assertEqual(sincronia.abertos(self.tmp, time.time() + 600), set(), 'a pagina parou de avisar: fechado')
        self.c.post('/api/sincronia/aberto', json={'janela': 'j1', 'projetos': []})
        self.assertEqual(sincronia.abertos(self.tmp), {'P2'})
        self.assertEqual(self.c.post('/api/sincronia/aberto', json={}).status_code, 400)

    def test_estado_e_pedido(self):
        self.assertEqual(self.c.get('/api/sincronia/estado').get_json()['ligado'], False)
        os.makedirs(os.path.join(self.tmp, '.altiumhub'), exist_ok=True)
        with open(os.path.join(self.tmp, '.altiumhub', sincronia.ARQ_DESATUALIZADOS), 'w', encoding='utf-8') as f:
            json.dump({'ligado': True, 'avisos': {'P1': {'rev': 4, 'autor': 'paula'}}, 'sincronizados': {}}, f)
        j = self.c.get('/api/sincronia/estado').get_json()
        self.assertEqual((j['ligado'], j['avisos']['P1']['autor']), (True, 'paula'))
        r = self.c.post('/api/sincronia/sincronizar', json={'projeto': 'P1'}).get_json()
        self.assertTrue(r['ok'] and r['id'])
        with open(os.path.join(self.tmp, '.altiumhub', sincronia.ARQ_PEDIDO), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['pedidos'][0], {'projeto': 'P1', 'id': r['id'], 'quando': json.load(open(f.name))['pedidos'][0]['quando']})
        self.assertEqual(self.c.get('/api/sincronia/estado').get_json()['pedidos'], ['P1'])
        self.assertEqual(self.c.post('/api/sincronia/sincronizar', json={'projeto': '../P1'}).status_code, 404)
        self.assertEqual(self.c.post('/api/sincronia/sincronizar', json={'projeto': 'Nao'}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
