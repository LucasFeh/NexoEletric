# -*- coding: utf-8 -*-
"""As rotas /api/carimbos* e /api/aprovacao* (tools/rotas/carimbos.py): os carimbos da casa e a aprovacao do projeto.

Numa pasta de trabalho temporaria, com um schematic.js no formato do serializeSchematic (hub-core.js).

    python tests/test_carimbos.py
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
import carimbos  # noqa: E402

MESTRE = 'LucasGatao'
ESQUEMA = ('var schematic = {\n"format":"schmirror-v2",\n"project":"CBM-DI251876",\n"generated":"05/11/2026 10:00:00",\n'
           '"units":"mil",\n"params":"Desenho_linha_unica=CBM-DI251876;Desenhista_DiEletrons=Lucas;Data_desenho=01/11/26;Revisao=REV.A",\n'
           '"items":[\n{"t":"sheet","name":"SCH-DI251876","size":"A4","template":"casa:A4_DiEletrons"},\n'
           '{"t":"text","x":100,"y":100,"s":"oi","sheet":"SCH-DI251876"},\n]};\n')


class Rotas(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='carimbos-')
        self.pdir = os.path.join(self.tmp, 'Projects', 'CBM-DI251876')
        os.makedirs(self.pdir)
        os.makedirs(os.path.join(self.tmp, 'Projects', 'Sem esquema'))
        self.sch = os.path.join(self.pdir, 'schematic.js')
        self.escreve('schematic.js', ESQUEMA)
        self.escreve('changes.js', 'var changes = [\n];\n')
        carimbos._cache_hash.clear()
        carimbos._desde.clear()
        app = Flask(__name__)
        carimbos.registra(app, self.tmp, MESTRE)
        self.c = app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def escreve(self, arq, txt):
        with open(os.path.join(self.pdir, arq), 'w', encoding='utf-8', newline='') as f:
            f.write(txt)
        # mtime diferente mesmo no mesmo instante (o cache da assinatura olha mtime + tamanho)
        st = os.stat(os.path.join(self.pdir, arq))
        os.utime(os.path.join(self.pdir, arq), ns=(st.st_atime_ns, st.st_mtime_ns + 1000))

    def le(self):
        with open(self.sch, encoding='utf-8') as f:
            return f.read()

    def cria(self, nome, senha, tags=(), mestre=None):
        return self.c.post('/api/carimbos', json={'nome': nome, 'senha': senha, 'tags': list(tags), 'mestre': mestre})

    def test_cria_lista_sem_senha_em_claro(self):
        r = self.cria('Luciano', 's3nha')
        self.assertEqual(r.status_code, 200, r.get_json())
        j = self.c.get('/api/carimbos').get_json()
        self.assertEqual([c['nome'] for c in j['carimbos']], ['Luciano'])
        self.assertIsNone(j['ativo'])
        with open(os.path.join(self.tmp, 'Libs', 'carimbos.json'), encoding='utf-8') as f:
            bruto = f.read()
        self.assertNotIn('s3nha', bruto)
        self.assertNotIn('senha', json.dumps(j))
        # nome repetido (sem olhar maiuscula) recusa
        self.assertEqual(self.cria('luciano', 'x').status_code, 409)

    def test_aprovador_pede_senha_mestre(self):
        self.assertEqual(self.cria('Lucas', 'a', ['aprovador']).status_code, 403)
        self.assertEqual(self.cria('Lucas', 'a', ['aprovador'], 'errada').status_code, 403)
        r = self.cria('Lucas', 'a', ['aprovador'], MESTRE)
        self.assertEqual(r.get_json()['carimbo']['tags'], ['aprovador'])

    def test_trocar_pede_a_senha_do_carimbo(self):
        cid = self.cria('Luciano', 'certa').get_json()['carimbo']['id']
        self.assertEqual(self.c.post('/api/carimbos/entrar', json={'id': cid, 'senha': 'errada'}).status_code, 403)
        self.assertIsNone(self.c.get('/api/carimbos').get_json()['ativo'])
        self.assertTrue(self.c.post('/api/carimbos/entrar', json={'id': cid, 'senha': 'certa'}).get_json()['ok'])
        self.assertEqual(self.c.get('/api/carimbos').get_json()['ativo']['nome'], 'Luciano')
        self.c.post('/api/carimbos/sair', json={})
        self.assertIsNone(self.c.get('/api/carimbos').get_json()['ativo'])

    def test_apagar_pede_senha_mestre(self):
        cid = self.cria('Luciano', 'x').get_json()['carimbo']['id']
        self.c.post('/api/carimbos/entrar', json={'id': cid, 'senha': 'x'})
        self.assertEqual(self.c.post('/api/carimbos/apagar', json={'id': cid, 'mestre': 'x'}).status_code, 403)
        self.assertTrue(self.c.post('/api/carimbos/apagar', json={'id': cid, 'mestre': MESTRE}).get_json()['ok'])
        j = self.c.get('/api/carimbos').get_json()
        self.assertEqual(j['carimbos'], [])
        self.assertIsNone(j['ativo'])

    def test_tags_pede_senha_mestre(self):
        cid = self.cria('Luciano', 'x').get_json()['carimbo']['id']
        self.assertEqual(self.c.post('/api/carimbos/tags', json={'id': cid, 'tags': ['aprovador'], 'mestre': ''}).status_code, 403)
        r = self.c.post('/api/carimbos/tags', json={'id': cid, 'tags': 'aprovador, Revisor', 'mestre': MESTRE}).get_json()
        self.assertEqual(r['carimbo']['tags'], ['aprovador', 'revisor'])

    def entra_aprovador(self, nome='Lucas'):
        cid = self.cria(nome, 'p', ['aprovador'], MESTRE).get_json()['carimbo']['id']
        self.c.post('/api/carimbos/entrar', json={'id': cid, 'senha': 'p'})
        return cid

    def test_so_aprovador_aprova(self):
        self.assertEqual(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).status_code, 403)
        cid = self.cria('Luciano', 'x').get_json()['carimbo']['id']
        self.c.post('/api/carimbos/entrar', json={'id': cid, 'senha': 'x'})
        self.assertEqual(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).status_code, 403)
        self.assertFalse(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])

    def test_aprova_preenche_verificador_e_aprovador(self):
        self.entra_aprovador()
        j = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertTrue(j['ok'], j)
        self.assertTrue(j['aprovado'])
        p = carimbos.params_do_texto(self.le())
        hoje = time.strftime('%d/%m/%y')
        self.assertEqual(p['Aprovador_DiEletrons'], 'Lucas')
        self.assertEqual(p['Verificador_DiEletrons'], 'Lucas')
        self.assertEqual(p['Data_aprovacao'], hoje)
        self.assertEqual(p['Data_verificacao'], hoje)
        self.assertEqual(p['Revisao'], 'REV.A')               # o resto do carimbo intacto
        self.assertEqual(j['texto'], self.le())
        # o resto do arquivo nao mudou
        self.assertEqual(self.le().split('"items":')[1], ESQUEMA.split('"items":')[1])
        lista = self.c.get('/api/aprovacoes').get_json()['projetos']
        self.assertEqual(lista['CBM-DI251876'], {'aprovado': True, 'por': 'Lucas', 'data': hoje, 'rev': 'REV.A'})
        self.assertFalse(lista['Sem esquema']['aprovado'])

    def test_modificacao_derruba_a_aprovacao(self):
        self.entra_aprovador()
        self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        # a PCB mudou: sem aprovacao na hora, mas os campos so saem passada a carencia
        self.escreve('changes.js', 'var changes = [\n{"op":"move"},\n];\n')
        e = carimbos.confere(self.pdir, agora=1000.0)
        self.assertFalse(e['aprovado'])
        self.assertIn('Aprovador_DiEletrons', carimbos.params_do_texto(self.le()))
        e = carimbos.confere(self.pdir, agora=1000.0 + carimbos.CARENCIA + 1)
        self.assertFalse(e['aprovado'])
        p = carimbos.params_do_texto(self.le())
        for k in carimbos.CAMPOS_APROVACAO:
            self.assertNotIn(k, p)
        self.assertEqual(p['Data_desenho'], '01/11/26')          # a data do desenho so muda ao criar ou assumir
        self.assertEqual(p['Desenhista_DiEletrons'], 'Lucas')

    def test_arquivo_que_volta_igual_reaprova(self):
        """o NexoBD trazendo os arquivos um de cada vez: a assinatura volta a bater antes da carencia"""
        self.entra_aprovador()
        self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        with open(os.path.join(self.pdir, 'changes.js'), encoding='utf-8') as f:
            orig = f.read()
        self.escreve('changes.js', orig + '\n')
        self.assertFalse(carimbos.confere(self.pdir, agora=10.0)['aprovado'])
        self.escreve('changes.js', orig)
        self.assertTrue(carimbos.confere(self.pdir, agora=10.0 + carimbos.CARENCIA + 5)['aprovado'])

    def test_data_do_desenho_e_crlf_nao_contam(self):
        self.entra_aprovador()
        self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        txt = self.le().replace('Data_desenho=01/11/26', 'Data_desenho=05/11/26').replace('\n', '\r\n')
        self.escreve('schematic.js', txt)
        self.assertTrue(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])
        # mas o resto do cabecalho conta (o codigo da placa e parte do desenho; a revisao, nao: ela e do Aprovar)
        self.escreve('schematic.js', txt.replace('Desenho_linha_unica=CBM-DI251876', 'Desenho_linha_unica=CBM-DI999999'))
        self.assertFalse(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])

    def test_assumir_pede_carimbo_e_senha_mestre(self):
        self.assertEqual(self.c.post('/api/carimbos/assumir', json={'projeto': 'CBM-DI251876', 'mestre': MESTRE}).status_code, 403)
        cid = self.cria('Luciano', 'x').get_json()['carimbo']['id']
        self.c.post('/api/carimbos/entrar', json={'id': cid, 'senha': 'x'})
        self.assertEqual(self.c.post('/api/carimbos/assumir', json={'projeto': 'CBM-DI251876', 'mestre': 'x'}).status_code, 403)
        self.assertEqual(carimbos.params_do_texto(self.le())['Desenhista_DiEletrons'], 'Lucas')
        j = self.c.post('/api/carimbos/assumir', json={'projeto': 'CBM-DI251876', 'mestre': MESTRE}).get_json()
        self.assertTrue(j['ok'], j)
        p = carimbos.params_do_texto(self.le())
        self.assertEqual(p['Desenhista_DiEletrons'], 'Luciano')
        self.assertEqual(p['Desenhista_carimbo'], cid)
        self.assertEqual(p['Data_desenho'], time.strftime('%d/%m/%y'))
        self.assertEqual(p['Revisao'], 'REV.A')
        self.assertEqual(j['texto'], self.le())

    def test_assumir_nao_derruba_a_aprovacao(self):
        self.entra_aprovador()
        self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        j = self.c.post('/api/carimbos/assumir', json={'projeto': 'CBM-DI251876', 'mestre': MESTRE}).get_json()
        self.assertTrue(j['ok'] and j['aprovado'], j)
        self.assertTrue(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])

    def test_revisoes_a_cada_aprovacao(self):
        self.entra_aprovador()
        j = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertEqual((j['rev'], j['resumo']), ('REV.A', ['primeira revisão']))
        self.assertEqual(carimbos.params_do_texto(self.le())['Revisao'], 'REV.A')
        rev_a = os.path.join(self.pdir, 'Revisoes', 'REV.A')
        self.assertTrue(os.path.isfile(os.path.join(rev_a, 'schematic.js')))
        self.assertTrue(os.path.isfile(os.path.join(rev_a, 'changes.js')))
        # aprovado nao aprova de novo
        self.assertEqual(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).status_code, 409)
        # modifica: um componente novo e a PCB mexida
        a_sch = self.le()
        self.escreve('schematic.js', a_sch.replace('\n]};', '\n{"t":"comp","sheet":"SCH-DI251876","ref":"R9","sym":"RES","x":1,"y":2,"footprint":"0805"},\n]};'))
        self.escreve('changes.js', 'var changes = [\n{"op":"move"},\n];\n')
        r = self.c.get('/api/revisoes?projeto=CBM-DI251876').get_json()
        self.assertFalse(r['atual']['aprovado'])
        self.assertEqual(r['atual']['desde'], 'REV.A')
        self.assertIn('componentes novos: R9', r['atual']['mudancas'])
        self.assertIn('PCB: 0 → 1 mudanças no changes.js', r['atual']['mudancas'])
        j = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertEqual(j['rev'], 'REV.B')
        self.assertIn('componentes novos: R9', j['resumo'])
        r = self.c.get('/api/revisoes?projeto=CBM-DI251876').get_json()
        self.assertEqual([x['rev'] for x in r['revisoes']], ['REV.B', 'REV.A'])
        self.assertTrue(r['atual']['aprovado'])
        self.assertNotIn('assinatura', r['revisoes'][0])
        # volta para a REV.A: os arquivos dela, e aprovado de novo (identico ao aprovado)
        j = self.c.post('/api/revisoes/voltar', json={'projeto': 'CBM-DI251876', 'rev': 'REV.A'}).get_json()
        self.assertTrue(j['ok'] and j['aprovado'], j)
        self.assertEqual(self.le(), a_sch)
        with open(os.path.join(self.pdir, 'changes.js'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'var changes = [\n];\n')
        self.assertEqual(self.c.post('/api/revisoes/voltar', json={'projeto': 'CBM-DI251876', 'rev': 'REV.Z'}).status_code, 404)

    def test_primeira_revisao_segue_o_carimbo(self):
        """projeto que ja chegou numa revisao (REV.C do Altium): a primeira aprovacao e a REV.C, a seguinte a REV.D"""
        self.escreve('schematic.js', ESQUEMA.replace('REV.A', 'REV.C'))
        self.entra_aprovador()
        self.assertEqual(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()['rev'], 'REV.C')
        self.escreve('changes.js', 'var changes = [\n{"op":"x"},\n];\n')
        self.assertEqual(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()['rev'], 'REV.D')

    def test_esquema_sem_params(self):
        self.escreve('schematic.js', ESQUEMA.replace(ESQUEMA.split('\n')[5] + '\n', ''))
        self.entra_aprovador('Luciano')
        j = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertTrue(j['aprovado'], j)
        self.assertEqual(carimbos.params_do_texto(self.le())['Aprovador_DiEletrons'], 'Luciano')

    def test_projeto_fora_de_projects(self):
        self.assertEqual(self.c.get('/api/aprovacao?projeto=..').status_code, 404)
        self.assertEqual(self.c.get('/api/aprovacao?projeto=../Projects').status_code, 404)


if __name__ == '__main__':
    unittest.main()
