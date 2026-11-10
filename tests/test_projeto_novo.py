# -*- coding: utf-8 -*-
"""As rotas /api/projeto/novo* (tools/rotas/projeto_novo.py): o "Novo projeto" do hub.

Contra o motor DE VERDADE (mcp/lib/catalogo.js, rodado pelo node) e um catalogo FALSO montado aqui (o .xlsx no
formato do de verdade), numa pasta temporaria (NEXO_CATALOGO). O catalogo do NAS nunca e tocado.

    python tests/test_projeto_novo.py
"""
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unittest
import zipfile

from flask import Flask

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))
import projeto_novo  # noqa: E402
import equipe  # noqa: E402

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'


def catalogo_falso(arq):
    ss = ['ITEM ', 'TIPO', 'NOME', 'CLIENTE ', 'MODELO', 'VINCULO', 'PLACA', 'PLACA ADAPTADORA ENCODER LINEAR', 'PAEL-DI261940',
          'CABO', 'CABO SERIAL', 'CS-DI261939']
    s = lambda r, k, i: '<c r="%s%d" s="44" t="s"><v>%d</v></c>' % (k, r, i)
    sheet = ('<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="%s"><dimension ref="A1:F4"/><sheetData>' % NS
             # 1.89.0: um cabo (o Definir projeto nao o mostra)
             + '<row r="1"><c r="A1" s="44"><v>1939</v></c>' + s(1, 'B', 9) + s(1, 'C', 10) + s(1, 'E', 11) + '</row>'
             + '<row r="2">' + ''.join(s(2, k, i) for i, k in enumerate('ABCDEF')) + '</row>'
             + '<row r="3"><c r="A3" s="44"><v>1940</v></c>' + s(3, 'B', 6) + s(3, 'C', 7) + s(3, 'E', 8) + '</row>'
             + '<row r="4"><c r="A4" s="44"><v>1940</v></c></row></sheetData></worksheet>')
    with zipfile.ZipFile(arq, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                   '<sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>' % NS)
        z.writestr('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', sheet)
        z.writestr('xl/sharedStrings.xml', '<?xml version="1.0"?><sst xmlns="%s">%s</sst>' % (NS, ''.join('<si><t>%s</t></si>' % x for x in ss)))


@unittest.skipUnless(shutil.which('node'), 'sem node no PATH')
class Rotas(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='projnovo-')
        os.makedirs(os.path.join(self.tmp, 'Projects', 'Antigo'))
        self.cat = os.path.join(self.tmp, 'catalogo.xlsx')
        catalogo_falso(self.cat)
        self.env = os.environ.get('NEXO_CATALOGO')
        os.environ['NEXO_CATALOGO'] = self.cat
        os.environ['NEXOELETRIC_NODE'] = shutil.which('node')
        # o motor de verdade, na pasta de trabalho temporaria (a rota roda <root>/mcp/lib/catalogo.js)
        os.makedirs(os.path.join(self.tmp, 'mcp', 'lib'))
        os.makedirs(os.path.join(self.tmp, 'Libs'))
        shutil.copy(os.path.join(RAIZ, 'Libs', 'sch-templates-casa.js'), os.path.join(self.tmp, 'Libs', 'sch-templates-casa.js'))
        for m in ('catalogo.js', 'catalogo-fila.js', 'nexohub.js'):
            shutil.copy(os.path.join(RAIZ, 'mcp', 'lib', m), os.path.join(self.tmp, 'mcp', 'lib', m))
        self.indexado = []
        # o Nexo Hub desta maquina fica de fora: sem nada, o Hub "antigo" (sem login, 404); self.logado = alguem logado
        self.logado = None
        equipe._provedor[0] = lambda: ({'ok': True, 'logado': True, 'usuario': self.logado} if self.logado else ('http', 404))
        app = Flask(__name__)
        projeto_novo.registra(app, self.tmp, {
            'nome_ok': lambda n: bool(n) and not re.search(r'[\\/:*?"<>|]', n) and not n.startswith('.') and not n.endswith('.'),
            'proj_id': lambda n: re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-'),
            'build_index': lambda: self.indexado.append(1),
            'vazios': lambda n: {'changes.js': 'var changes = [\n];\n', 'annotations.js': 'var annotations = [\n];\n'}})
        self.c = app.test_client()

    def tearDown(self):
        equipe._provedor[0] = None
        if self.env is None:
            os.environ.pop('NEXO_CATALOGO', None)
        else:
            os.environ['NEXO_CATALOGO'] = self.env
        os.environ.pop('NEXOELETRIC_NODE', None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_desenhista_e_responsavel_e_quem_esta_logado(self):
        """1.84.0: o desenhista e quem esta logado no Nexo Hub (por cima do carimbo e do `iniciador`), e ele vira o
        responsavel pelo projeto (equipe.json)"""
        self.logado = {'id': 'u7', 'login': 'romeu', 'nome': 'Romeu Yukio', 'admin': False, 'aprovador': False}
        j = self.c.post('/api/projeto/novo', json={'nome': 'Placa Y', 'iniciador': 'Outro', 'template': ''}).get_json()
        self.assertTrue(j['ok'], j)
        self.assertEqual((j['params']['Desenhista_DiEletrons'], j['params']['Desenhista_carimbo']), ('Romeu Yukio', 'romeu'))
        eq = equipe.le(os.path.join(self.tmp, 'Projects', j['name']))
        self.assertEqual(eq['responsavel'], {'id': 'u7', 'login': 'romeu', 'nome': 'Romeu Yukio'})
        self.assertEqual(eq['colaboradores'], [])

    def test_previa_e_criar(self):
        j = self.c.get('/api/projeto/novo/previa?nome=Placa%20medidora%20de%20nivel').get_json()
        self.assertTrue(j['ok'], j)
        self.assertEqual((j['proximo'], j['sigla']), (1941, 'PMN'))
        cod = 'PMN-DI%s1941' % j['ano']
        self.assertEqual(j['codigo'], cod)
        # sem quem iniciou: recusa, e nada vai para o catalogo
        r = self.c.post('/api/projeto/novo', json={'nome': 'Placa medidora de nivel'})
        self.assertEqual(r.status_code, 400)
        r = self.c.post('/api/projeto/novo', json={'nome': 'Placa medidora de nivel', 'iniciador': 'Ana', 'cliente': 'alumar'})
        j = r.get_json()
        self.assertEqual(r.status_code, 200, j)
        self.assertEqual((j['name'], j['codigo'], j['item'], j['linha']), (cod, cod, 1941, 4))
        sch = open(os.path.join(self.tmp, 'Projects', cod, 'schematic.js'), encoding='utf-8').read()
        self.assertIn('"template": "casa:A4_DiEletrons"', sch)
        self.assertIn('Desenhista_DiEletrons=Ana', sch)
        self.assertIn('Cliente=ALUMAR', sch)
        self.assertIn('"name": "SCH-' + cod.split('-', 1)[1] + '"', sch)       # o Arquivo do carimbo e o nome da folha
        self.assertIn('CodigoDaPlaca=' + cod, sch)
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, 'Projects', cod, 'changes.js')))
        self.assertEqual(self.indexado, [1])
        # o catalogo ganhou a linha
        with zipfile.ZipFile(self.cat) as z:
            self.assertIn('>%s<' % cod, z.read('xl/worksheets/sheet1.xml').decode('utf-8'))
        # a busca acha o produto novo
        a = self.c.get('/api/projeto/novo/catalogo?codigo=' + cod).get_json()
        self.assertEqual(a['achou']['cliente'], 'ALUMAR')

    def test_definir_so_placas_e_equipamentos(self):
        """1.89.0 (pedido do dono: "sistemas, cabos, acessorios, softwares podem sair, deixa so placa, codigo de placa
        errado e equipamento no definir"): a lista, o cadastro e a categoria so de placa e equipamento; o cabo continua na
        planilha"""
        j = self.c.get('/api/catalogo').get_json()
        self.assertTrue(j['ok'], j)
        self.assertEqual(sorted({i['grupo'] for i in j['itens']}), ['placa'])
        self.assertEqual([c['id'] for c in j['categorias']], ['placa', 'equipamento'])
        self.assertEqual(j['ultimo'], 1940)
        self.assertIn('fila', j)
        r = self.c.post('/api/catalogo/registrar', json={'nome': 'Cabo novo', 'tipo': 'CABO'})
        self.assertEqual(r.status_code, 400)
        r = self.c.post('/api/catalogo/editar', json={'item': 1940, 'codigo': 'PAEL-DI261940', 'novoGrupo': 'cabo'})
        self.assertEqual(r.status_code, 400)
        j = self.c.post('/api/catalogo/registrar', json={'nome': 'Equipamento novo', 'tipo': 'EQUIPAMENTO'}).get_json()
        self.assertTrue(j['ok'], j)
        self.assertEqual((j['item'], j['pendente']), (1941, False))
        with zipfile.ZipFile(self.cat) as z:
            self.assertIn('>CS-DI261939<', z.read('xl/sharedStrings.xml').decode('utf-8'), 'o cabo continua na planilha')

    def test_template_do_esquema(self):
        t = self.c.get('/api/projeto/novo/templates').get_json()
        self.assertEqual(t['padrao'], 'casa:A4_DiEletrons')
        # 1.93.0: o A3 da casa (A3 + DiEletrons) tambem, com a folha A3 ISO
        self.assertEqual([x['id'] for x in t['templates']], ['casa:A3_DiEletrons', 'casa:A4_DiEletrons'])
        a3 = t['templates'][0]
        self.assertEqual((round(a3['w'], 3), round(a3['h'], 3), a3['estilo']), (16535.433, 11692.913, 'A3'))
        # template que nao existe: recusa antes de registrar
        r = self.c.post('/api/projeto/novo', json={'nome': 'Placa Y', 'iniciador': 'Ana', 'template': 'casa:nao-existe'})
        self.assertEqual(r.status_code, 400)
        # sem template: a folha A4 sem o campo template
        j = self.c.post('/api/projeto/novo', json={'nome': 'Placa Y', 'iniciador': 'Ana', 'template': ''}).get_json()
        self.assertTrue(j['ok'], j)
        sch = open(os.path.join(self.tmp, 'Projects', j['name'], 'schematic.js'), encoding='utf-8').read()
        self.assertNotIn('"template"', sch)
        self.assertIn('"size": "A4"', sch)

    def test_nome_do_projeto_que_ja_existe_nao_registra(self):
        r = self.c.post('/api/projeto/novo', json={'nome': 'Placa X', 'iniciador': 'Ana', 'projeto': 'antigo'})
        self.assertEqual(r.status_code, 409)
        with zipfile.ZipFile(self.cat) as z:
            self.assertNotIn('PX-DI', z.read('xl/worksheets/sheet1.xml').decode('utf-8'), 'nada registrado')

    def test_sem_catalogo(self):
        os.environ['NEXO_CATALOGO'] = os.path.join(self.tmp, 'nao-existe.xlsx')
        j = self.c.get('/api/projeto/novo/previa?nome=x').get_json()
        self.assertFalse(j['ok'])
        self.assertIn('192.168.15.31', j['error'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
