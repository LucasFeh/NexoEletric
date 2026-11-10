# -*- coding: utf-8 -*-
"""A biblioteca das artes de overlay da PCB (tools/rotas/pcb_artes.py, 1.91.0).

    python tests/test_pcb_artes.py

Numa pasta temporária (nunca a Libs/ do repositório nem a do NexoBD): o arquivo nasce na primeira gravação, a versão
sobe, a edição concorrente leva 409, o visualizador não grava, a arte da casa só o admin muda/apaga/restaura, e apagar
qualquer arte é só do admin (usuário comum, visualizador e sem login: 403 sem_permissao).
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))
import pcb_artes as PA  # noqa: E402
import equipe  # noqa: E402
from flask import Flask  # noqa: E402

ADMIN = {'id': 'u-a', 'login': 'ana', 'nome': 'Ana Admin', 'admin': True, 'funcao': 'admin'}
COMUM = {'id': 'u-c', 'login': 'caio', 'nome': 'Caio', 'admin': False, 'funcao': 'usuario'}
VISUAL = {'id': 'u-v', 'login': 'vera', 'nome': 'Vera', 'admin': False, 'visualizador': True, 'funcao': 'visualizador'}
ARTE = {'id': 'selo-teste', 'nome': 'Selo de teste', 'elementos': [{'tipo': 'texto', 'x': 0, 'y': 0, 'texto': '=CodigoDaPlaca', 'h': 1.5, 'w': 0.2}]}


class Artes(unittest.TestCase):
    def setUp(self):
        self.raiz = tempfile.mkdtemp(prefix='pcb-artes-')
        os.makedirs(os.path.join(self.raiz, 'Libs'))
        self.app = Flask(__name__)
        self.logado = [COMUM]
        equipe._provedor[0] = lambda: {'ok': True, 'logado': bool(self.logado[0]), 'usuario': self.logado[0]}
        equipe.esquece_sessao()
        equipe.registra_rotas(self.app, self.raiz)
        PA.registra(self.app, self.raiz)
        self.c = self.app.test_client()

    def tearDown(self):
        equipe._provedor[0] = None
        equipe.esquece_sessao()
        shutil.rmtree(self.raiz, ignore_errors=True)

    def como(self, u):
        self.logado[0] = u
        equipe.esquece_sessao()

    def test_lista_vazia_e_primeira_gravacao(self):
        r = self.c.get('/api/pcb-artes').get_json()
        self.assertEqual((r['ok'], r['artes'], r['padrao']), (True, [], ['dieletrons-logo-qr', 'codigo-revisao']))
        self.assertFalse(os.path.exists(os.path.join(self.raiz, 'Libs', 'pcb-artes.json')), 'só ler não cria o arquivo')
        r = self.c.post('/api/pcb-artes/salvar', json={'arte': ARTE})
        self.assertEqual(r.status_code, 200, r.get_json())
        a = r.get_json()['arte']
        self.assertEqual((a['versao'], a['autor']), (1, 'Caio'))
        with open(os.path.join(self.raiz, 'Libs', 'pcb-artes.json'), encoding='utf-8') as f:
            d = json.load(f)
        self.assertEqual(d['formato'], PA.FORMATO)
        self.assertEqual([x['id'] for x in d['artes']], ['selo-teste'])
        # a versão sobe; quem abriu a versão 1 e outra pessoa gravou antes leva 409
        self.assertEqual(self.c.post('/api/pcb-artes/salvar', json={'arte': ARTE, 'base': 1}).get_json()['arte']['versao'], 2)
        r = self.c.post('/api/pcb-artes/salvar', json={'arte': ARTE, 'base': 1})
        self.assertEqual(r.status_code, 409)
        self.assertIn('conflito', r.get_json()['error'])

    def test_recusas(self):
        for ruim in ({'id': 'X Y', 'nome': 'a', 'elementos': [{'tipo': 'texto'}]}, {'id': 'a', 'nome': '', 'elementos': [{'tipo': 'texto'}]},
                     {'id': 'a', 'nome': 'a', 'elementos': []}, {'id': 'a', 'nome': 'a', 'elementos': [{'tipo': 'imagem-crua'}]}):
            self.assertEqual(self.c.post('/api/pcb-artes/salvar', json={'arte': ruim}).status_code, 400, ruim)

    def test_visualizador_nao_grava(self):
        self.como(VISUAL)
        r = self.c.post('/api/pcb-artes/salvar', json={'arte': ARTE})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.get_json()['codigo'], 'sem_permissao')
        self.assertTrue(self.c.get('/api/pcb-artes').get_json()['visualizador'])

    def test_arte_da_casa_e_apagar_so_admin(self):
        padrao = dict(ARTE, id='codigo-revisao', nome='Código + revisão (editado)')
        for u in (COMUM, VISUAL, None):
            self.como(u)
            self.assertEqual(self.c.post('/api/pcb-artes/salvar', json={'arte': padrao}).status_code, 403, u)
        self.como(COMUM)
        self.assertEqual(self.c.post('/api/pcb-artes/salvar', json={'arte': ARTE}).status_code, 200)
        for u in (COMUM, VISUAL, None):
            self.como(u)
            for rota, corpo in (('apagar', {'id': 'selo-teste'}), ('apagar', {'id': 'dieletrons-logo-qr'}), ('restaurar', {'id': 'codigo-revisao'})):
                r = self.c.post('/api/pcb-artes/' + rota, json=corpo)
                self.assertEqual(r.status_code, 403, (u, rota, corpo))
                self.assertEqual(r.get_json()['codigo'], 'sem_permissao')
        self.como(ADMIN)
        self.assertTrue(self.c.get('/api/pcb-artes').get_json()['admin'])
        self.assertEqual(self.c.post('/api/pcb-artes/salvar', json={'arte': padrao}).status_code, 200)
        self.assertEqual(self.c.post('/api/pcb-artes/apagar', json={'id': 'selo-teste'}).status_code, 200)
        self.assertEqual(self.c.post('/api/pcb-artes/apagar', json={'id': 'dieletrons-logo-qr'}).status_code, 200)
        artes = {a['id']: a for a in self.c.get('/api/pcb-artes').get_json()['artes']}
        self.assertEqual(sorted(artes), ['codigo-revisao', 'dieletrons-logo-qr'])
        self.assertTrue(artes['dieletrons-logo-qr']['apagada'], 'a da casa apagada vira marca (o programa a esconde)')
        self.assertEqual(artes['codigo-revisao']['nome'], 'Código + revisão (editado)')
        self.assertEqual(self.c.post('/api/pcb-artes/restaurar', json={'id': 'codigo-revisao'}).status_code, 200)
        self.assertEqual(self.c.post('/api/pcb-artes/restaurar', json={'id': 'dieletrons-logo-qr'}).status_code, 200)
        self.assertEqual(self.c.get('/api/pcb-artes').get_json()['artes'], [], 'as da casa voltam ao desenho do programa')
        self.assertEqual(self.c.post('/api/pcb-artes/apagar', json={'id': 'nao-existe'}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
