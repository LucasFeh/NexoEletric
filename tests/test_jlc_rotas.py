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
  diz({ fim: { etapa: 'carrinho', quantidade: a.quantidade, camadas: 2, gdir: a.gdir, mostrar: a.mostrar, esperaLogin: a.esperaLogin } });
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

    def test_recusas(self):
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': 'Sem Gerber', 'quantidade': 5}).status_code, 409)
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': '../fora', 'quantidade': 5}).status_code, 404)
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 'x'}).status_code, 400)
        self.assertEqual(self.c.get('/api/jlc/estado?job=nada').status_code, 404)
        self.local = False
        self.assertEqual(self.c.post('/api/jlc/enviar', json={'proj': 'Placa A', 'quantidade': 5}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
