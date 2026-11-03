# -*- coding: utf-8 -*-
"""As rotas /api/jlc/* (tools/rotas/jlc.py): o botao "Enviar pra JLC" da vista PCB.

O motor de verdade (mcp/lib/jlc.js) e testado no tests/test-jlc.js; aqui um jlc.js FALSO, numa pasta
de trabalho temporaria, faz o papel dele: a rota tem de rodar o node com a entrada certa, repassar o
progresso e o fim, recusar quem nao e desta maquina e pedir o Gerber salvo antes.

    python tests/test_jlc_rotas.py
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
import jlc  # noqa: E402

FALSO = r"""
let e = ''; process.stdin.on('data', d => { e += d; }); process.stdin.on('end', () => {
  const a = JSON.parse(e);
  const diz = o => process.stdout.write(JSON.stringify(o) + '\n');
  diz({ progresso: 'montando o .zip do Gerber' });
  diz({ preparado: { camadas: 2, camadasJlc: 2, arquivos: 9 } });
  diz({ progresso: 'quantidade ' + a.quantidade });
  if (a.quantidade === 8) { diz({ erro: 'a JLC nao vende 8' }); return; }
  if (a.quantidade === 999) { setInterval(() => {}, 1000); return; }   /* preso: so o cancelar tira */
  diz({ fim: { etapa: 'carrinho', quantidade: a.quantidade, camadas: 2, gdir: a.gdir, mostrar: a.mostrar, esperaLogin: a.esperaLogin,
               usuario: a.usuario || '', senhaOk: a.senha === 'segredo-123', temSenha: !!a.senha } });
});
"""


@unittest.skipUnless(shutil.which('node'), 'sem node no PATH')
class Rotas(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='jlc-rotas-')
        os.makedirs(os.path.join(self.tmp, 'mcp', 'lib'))
        with open(os.path.join(self.tmp, 'mcp', 'lib', 'jlc.js'), 'w', encoding='utf-8') as f:
            f.write(FALSO)
        g = os.path.join(self.tmp, 'Projects', 'Placa A', 'Gerber')
        os.makedirs(g)
        with open(os.path.join(g, 'gerber.json'), 'w', encoding='utf-8') as f:
            json.dump({'base': 'Placa A', 'arquivos': []}, f)
        os.makedirs(os.path.join(self.tmp, 'Projects', 'Sem Gerber'))
        os.environ['NEXOELETRIC_NODE'] = ''
        os.environ['HOME'] = os.environ['USERPROFILE'] = self.tmp     # sem session.json: o node do PATH
        app = Flask(__name__)
        self.local = True
        jlc.registra(app, self.tmp, lambda req: self.local)
        self.c = app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def espera(self, job):
        for _ in range(100):
            r = self.c.get('/api/jlc/estado?job=' + job).get_json()
            if r['fim']:
                return r
            time.sleep(0.1)
        self.fail('o envio nao terminou')

    def test_envia_e_acompanha(self):
        r = self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 10})
        self.assertEqual(r.status_code, 200, r.get_json())
        e = self.espera(r.get_json()['job'])
        self.assertIsNone(e['erro'])
        self.assertEqual(e['resultado']['etapa'], 'carrinho')
        self.assertEqual(e['resultado']['quantidade'], 10)
        self.assertTrue(e['resultado']['mostrar'])
        self.assertGreater(e['resultado']['esperaLogin'], 60000, 'o botao espera a pessoa entrar na conta')
        self.assertEqual(os.path.normcase(e['resultado']['gdir']), os.path.normcase(os.path.join(self.tmp, 'Projects', 'Placa A', 'Gerber')))
        self.assertEqual(e['preparado']['camadas'], 2)
        self.assertIn('quantidade 10', e['passos'])

    def test_erro_do_motor(self):
        e = self.espera(self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 8}).get_json()['job'])
        self.assertIn('8', e['erro'])

    def test_cancelar(self):
        job = self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 999}).get_json()['job']
        time.sleep(0.5)
        self.assertFalse(self.c.get('/api/jlc/estado?job=' + job).get_json()['fim'])
        self.assertEqual(self.c.post('/api/jlc/cancelar', data=json.dumps({'job': job}), content_type='text/plain').status_code, 200,
                         'aceita o sendBeacon (corpo JSON com qualquer content-type)')
        e = self.espera(job)
        self.assertEqual(e['erro'], 'envio cancelado')
        self.assertEqual(self.c.post('/api/jlc/cancelar', json={'job': 'nada'}).status_code, 404)
        self.local = False
        self.assertEqual(self.c.post('/api/jlc/cancelar', json={'job': job}).status_code, 403)

    def test_conta_da_jlc(self):
        """1.57.2: a conta da configuracao do hub chega ao motor pela entrada padrao; a senha nunca volta."""
        cfg = self.c.get('/api/jlc/config').get_json()
        self.assertEqual(cfg['config']['email'], '')
        self.assertFalse(cfg['config']['temSenha'])
        e = self.espera(self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 5}).get_json()['job'])
        self.assertFalse(e['resultado']['temSenha'], 'sem conta gravada, o motor nao recebe senha')
        r = self.c.post('/api/jlc/config', json={'email': ' compras@dieletrons.com ', 'senha': 'segredo-123'})
        self.assertEqual(r.status_code, 200, r.get_json())
        j = r.get_json()
        self.assertEqual(j['config']['email'], 'compras@dieletrons.com')
        self.assertTrue(j['config']['temSenha'] and j['config']['senhaAbre'])
        self.assertNotIn('segredo-123', json.dumps(j))
        self.assertNotIn('segredo-123', json.dumps(self.c.get('/api/jlc/config').get_json()))
        bruto = open(os.path.join(self.tmp, jlc.CFG_FILE), encoding='utf-8').read()
        if os.name == 'nt':
            self.assertTrue(j['config']['protegida'])
            self.assertNotIn('segredo-123', bruto, 'no Windows a senha vai cifrada pela DPAPI')
        e = self.espera(self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 5}).get_json()['job'])
        self.assertEqual(e['resultado']['usuario'], 'compras@dieletrons.com')
        self.assertTrue(e['resultado']['senhaOk'], 'a senha chega ao motor')
        self.assertNotIn('segredo-123', json.dumps(e), 'e nao fica no estado do envio')
        # senha vazia nao mexe; troca o e-mail
        self.c.post('/api/jlc/config', json={'email': 'outro@dieletrons.com', 'senha': ''})
        self.assertEqual(jlc.credencial(self.tmp), ('outro@dieletrons.com', 'segredo-123'))
        # de outra maquina: le (sem senha), nao grava
        self.local = False
        self.assertEqual(self.c.post('/api/jlc/config', json={'email': 'x@y.z'}).status_code, 403)
        self.assertFalse(self.c.get('/api/jlc/config').get_json()['local'])
        self.local = True
        self.assertEqual(self.c.post('/api/jlc/config', json={'email': 'a' + chr(10) + 'b'}).status_code, 400)
        # apagar a senha
        self.assertFalse(self.c.post('/api/jlc/config', json={'apagarSenha': True}).get_json()['config']['temSenha'])
        self.assertEqual(jlc.credencial(self.tmp), ('outro@dieletrons.com', None))
        # arquivo torto: nao grava por cima
        open(os.path.join(self.tmp, jlc.CFG_FILE), 'w').write('{nao e json')
        self.assertTrue(self.c.get('/api/jlc/config').get_json()['config']['arquivoIlegivel'])
        self.assertEqual(self.c.post('/api/jlc/config', json={'email': 'z@z.z'}).status_code, 409)

    def test_recusas(self):
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': 'Sem Gerber', 'quantidade': 5}).status_code, 409)
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': '../fora', 'quantidade': 5}).status_code, 404)
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 'x'}).status_code, 400)
        self.assertEqual(self.c.get('/api/jlc/estado?job=nada').status_code, 404)
        self.local = False
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 5}).status_code, 403)


class AchaNode(unittest.TestCase):
    """1.56.2: o session.json da 1.54.0+ aponta para a janela Rust (resources\\rust\\NexoEletric.exe), que nao e um
    Node: o envio tem de usar o Electron da mesma instalacao."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='jlc-node-')
        self.env = {k: os.environ.get(k) for k in ('NEXOELETRIC_NODE', 'HOME', 'USERPROFILE', 'LOCALAPPDATA')}
        inst = os.path.join(self.tmp, 'NexoEletric')
        self.electron = os.path.join(inst, 'NexoEletric.exe')
        self.rust = os.path.join(inst, 'resources', 'rust', 'NexoEletric.exe')
        os.makedirs(os.path.dirname(self.rust))
        for f in (self.electron, os.path.join(inst, 'icudtl.dat'), self.rust):
            open(f, 'wb').close()
        os.makedirs(os.path.join(self.tmp, '.nexoeletric'))
        with open(os.path.join(self.tmp, '.nexoeletric', 'session.json'), 'w', encoding='utf-8') as f:
            json.dump({'app': 'nexoeletric', 'exe': self.rust}, f)
        os.environ['HOME'] = os.environ['USERPROFILE'] = self.tmp
        os.environ['NEXOELETRIC_NODE'] = ''
        os.environ['LOCALAPPDATA'] = self.tmp

    def tearDown(self):
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_janela_rust_no_session_usa_o_electron_da_instalacao(self):
        self.assertFalse(jlc.eh_electron(self.rust))
        cmd, extra = jlc.acha_node()
        if cmd[0] == r'C:\Program Files\NexoEletric\NexoEletric.exe':
            self.skipTest('o Electron instalado nesta maquina vem antes (so depois do session.json)')
        self.assertEqual(cmd, [self.electron])
        self.assertEqual(extra, {'ELECTRON_RUN_AS_NODE': '1'})

    def test_nexoeletric_node_ganha_e_aceita_o_node_puro(self):
        os.environ['NEXOELETRIC_NODE'] = self.rust          # a janela Rust passada a mao: vira o Electron dela
        self.assertEqual(jlc.acha_node()[0], [self.electron])
        node = os.path.join(self.tmp, 'node.exe')
        open(node, 'wb').close()
        os.environ['NEXOELETRIC_NODE'] = node
        self.assertEqual(jlc.acha_node(), ([node], {}))


if __name__ == '__main__':
    unittest.main()
