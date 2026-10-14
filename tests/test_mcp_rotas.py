"""As rotas do canal MCP <-> vista aberta (mcp/rotas_hub.py), num Flask de teste.

O ciclo inteiro: o MCP pede, a vista pega, a vista responde, o MCP le a resposta. E as travas:
pedido so desta maquina, acao/alvo validados, pedido vencido, espera com teto.
Roda sozinho: python tests/test_mcp_rotas.py (ou pelo pytest/unittest)."""
import os
import sys
import threading
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..', 'mcp'))

from flask import Flask  # noqa: E402

import rotas_hub  # noqa: E402


def novo_app():
    app = Flask(__name__)
    rotas_hub._pedidos.clear()
    rotas_hub._vistas.clear()
    rotas_hub.registra(app, '/raiz/do/hub')
    return app.test_client()


class TestRotasMcp(unittest.TestCase):
    def test_status(self):
        c = novo_app()
        j = c.get('/api/mcp/status').get_json()
        self.assertTrue(j['ok'])
        self.assertEqual(j['root'], '/raiz/do/hub')
        self.assertEqual(j['vistas'], [])

    def test_ciclo_completo(self):
        c = novo_app()
        # a vista se apresenta (pergunta e nao ha nada)
        j = c.get('/api/mcp/pedidos?alvo=pcb&proj=LM555').get_json()
        self.assertEqual(j['pedidos'], [])
        self.assertEqual(c.get('/api/mcp/status').get_json()['vistas'][0]['proj'], 'LM555')
        # o MCP pede
        r = c.post('/api/mcp/pedido', json={'alvo': 'pcb', 'proj': 'LM555', 'acao': 'screenshot'})
        self.assertEqual(r.status_code, 200)
        pid = r.get_json()['id']
        self.assertTrue(r.get_json()['vista_aberta'])
        # outra vista (outro projeto) nao pega
        self.assertEqual(c.get('/api/mcp/pedidos?alvo=pcb&proj=Outro').get_json()['pedidos'], [])
        # a vista certa pega uma vez so
        p = c.get('/api/mcp/pedidos?alvo=pcb&proj=LM555').get_json()['pedidos']
        self.assertEqual([x['id'] for x in p], [pid])
        self.assertEqual(c.get('/api/mcp/pedidos?alvo=pcb&proj=LM555').get_json()['pedidos'], [])
        # sem resposta ainda: pendente, e diz que foi pego
        j = c.get('/api/mcp/resposta/%s?espera=0' % pid).get_json()
        self.assertTrue(j['pendente'])
        self.assertTrue(j['pego'])
        # a vista responde; o MCP le; o pedido some
        self.assertTrue(c.post('/api/mcp/resposta/' + pid, json={'ok': True, 'dados': {'png': 'AAAA'}}).get_json()['ok'])
        j = c.get('/api/mcp/resposta/' + pid).get_json()
        self.assertEqual(j, {'ok': True, 'dados': {'png': 'AAAA'}, 'erro': None})
        self.assertEqual(c.get('/api/mcp/resposta/' + pid).status_code, 404)

    def test_espera_acorda_com_a_resposta(self):
        c = novo_app()
        pid = c.post('/api/mcp/pedido', json={'alvo': 'sch', 'proj': 'X', 'acao': 'recarregar'}).get_json()['id']

        def vista():
            time.sleep(0.3)
            c2 = c.application.test_client()
            c2.get('/api/mcp/pedidos?alvo=sch&proj=X')
            c2.post('/api/mcp/resposta/' + pid, json={'ok': True, 'dados': {'recarregando': True}})
        t = threading.Thread(target=vista)
        t.start()
        t0 = time.time()
        j = c.get('/api/mcp/resposta/%s?espera=5' % pid).get_json()
        t.join()
        self.assertTrue(j['ok'])
        self.assertLess(time.time() - t0, 4)

    def test_sem_vista_responde_pendente(self):
        c = novo_app()
        r = c.post('/api/mcp/pedido', json={'alvo': 'pcb', 'proj': 'Y', 'acao': 'focar', 'args': {'x': 1, 'y': 2}})
        self.assertFalse(r.get_json()['vista_aberta'])
        j = c.get('/api/mcp/resposta/%s?espera=0.2' % r.get_json()['id']).get_json()
        self.assertFalse(j['ok'])
        self.assertIn('hub-mcpvista', j['erro'])

    def test_validacao(self):
        c = novo_app()
        self.assertEqual(c.post('/api/mcp/pedido', json={'alvo': 'pcb', 'proj': 'Y', 'acao': 'apagar_tudo'}).status_code, 400)
        self.assertEqual(c.post('/api/mcp/pedido', json={'alvo': 'gerber', 'proj': 'Y', 'acao': 'screenshot'}).status_code, 400)
        self.assertEqual(c.post('/api/mcp/pedido', data='x').status_code, 400)
        self.assertEqual(c.post('/api/mcp/resposta/naoexiste', json={'ok': True}).status_code, 404)

    def test_so_desta_maquina(self):
        c = novo_app()
        r = c.post('/api/mcp/pedido', json={'alvo': 'pcb', 'proj': 'Y', 'acao': 'screenshot'},
                   environ_base={'REMOTE_ADDR': '10.9.8.7'})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(c.get('/api/mcp/resposta/x', environ_base={'REMOTE_ADDR': '10.9.8.7'}).status_code, 403)

    def test_pedido_vencido_nao_e_entregue(self):
        c = novo_app()
        pid = c.post('/api/mcp/pedido', json={'alvo': 'pcb', 'proj': 'Z', 'acao': 'screenshot'}).get_json()['id']
        rotas_hub._pedidos[pid]['criado'] -= rotas_hub.VALIDADE + 1
        self.assertEqual(c.get('/api/mcp/pedidos?alvo=pcb&proj=Z').get_json()['pedidos'], [])


if __name__ == '__main__':
    unittest.main()
