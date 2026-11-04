# -*- coding: utf-8 -*-
"""Componentes criados localmente (tools/rotas/componentes_locais.py) e o envio deles ao Odoo.

    python tests/test_componentes_locais.py

Num workspace de mentira: a biblioteca de simbolos, a PcbLib e o almoxarifado minimos. Confere a
criacao (o desenho copiado, a pinagem tirada dos pinos, o nome unico, o bloco so com as chaves do
contrato), o envio da lista (a linha do local vai com o bloco `componente` e sem product_id), a
conferencia pelo di_confere_lista (um Odoo falso) e a integracao: o produto com o mesmo MPN e
encapsulamento chega no almoxarifado, a tag sai e a linha passa a ir com o product_id.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))
import componentes_locais as CL  # noqa: E402
import odoolista as OL  # noqa: E402
from flask import Flask  # noqa: E402


def escreve(raiz, nome, var, valor):
    p = os.path.join(raiz, 'Libs', nome)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('var %s = %s;\n' % (var, json.dumps(valor, ensure_ascii=False)))


SIMBOLOS = {'format': 'symbols-lib', 'symbols': [
    {'id': 's1', 'name': 'TRANSISTOR NPN', 'pins': [
        {'num': '1', 'name': 'B', 'x': -100, 'y': 0, 'len': 100, 'orient': 180, 'type': 'Input'},
        {'num': '2', 'name': 'E', 'x': 100, 'y': -50, 'len': 100, 'orient': 0, 'type': 'Passive'},
        {'num': '3', 'name': 'C', 'x': 100, 'y': 50, 'len': 100, 'orient': 0, 'type': 'qualquer'}],
     'graphics': [{'g': 'rect', 'x1': -50, 'y1': -60, 'x2': 50, 'y2': 60}]}]}
PCBLIB = {'footprints': [{'name': 'SOT-23', 'pads': []}, {'name': 'R0603', 'pads': []}]}
FAMILIA_R = {'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'designator': 'R', 'montagem': 'SMD',
             'parts': [{'part': 1, 'pins': [{'num': '1'}, {'num': '2'}], 'graphics': []}], 'valores': []}
FAMILIA_Q = {'name': 'TRANSISTOR [SMD]', 'familia': 'TRANSISTOR', 'designator': 'Q', 'montagem': 'SMD',
             'parts': [{'part': 1, 'pins': [], 'graphics': []}], 'valores': []}

FICHA = {'x_familia': 'transistor', 'x_polaridade': 'npn', 'x_montagem': 'SMD', 'x_encapsulamento': 'SOT-23',
         'x_mpn': 'MMBT3904', 'x_valor_txt': '40V', 'x_corrente': '200mA', 'x_vias': '', 'name': 'nao pode',
         'cor': 'azul', 'links': [{'name': 'Mouser', 'url': 'https://www.mouser.com/x'}, {'name': 'ruim', 'url': 'ftp://x'}]}


class Locais(unittest.TestCase):
    def setUp(self):
        self.raiz = tempfile.mkdtemp(prefix='locais-')
        escreve(self.raiz, 'symbols-lib.js', 'symbolsLib', SIMBOLOS)
        escreve(self.raiz, 'pcblib.js', 'pcblib', PCBLIB)
        escreve(self.raiz, 'almox-basicos.js', 'almoxBasicos', {'symbols': [FAMILIA_R, FAMILIA_Q]})
        CL._cache.clear()
        self._cliente = CL._cliente

    def tearDown(self):
        CL._cliente = self._cliente
        shutil.rmtree(self.raiz, ignore_errors=True)

    def cria(self, **kw):
        d = {'simbolo': 'TRANSISTOR NPN', 'footprint': 'SOT-23', 'componente': dict(FICHA),
             'datasheet': 'https://www.onsemi.com/pdf/MMBT3904.pdf'}
        d.update(kw)
        return CL.salva(self.raiz, d, por='lucas')

    def test_cria_no_formato_do_almoxarifado(self):
        s, avisos = self.cria()
        meta = s['criadoLocal']
        self.assertEqual(meta['id'], 'L1')
        b = meta['componente']
        self.assertEqual(b['x_familia'], 'TRANSISTOR')
        self.assertEqual(b['x_montagem'], 'smd')
        self.assertNotIn('name', b)
        self.assertNotIn('cor', b)
        self.assertNotIn('x_vias', b, 'vazio nao vai')
        self.assertEqual(b['links'], [{'name': 'Mouser', 'url': 'https://www.mouser.com/x'}])
        self.assertTrue(any('name' in a for a in avisos) and any('cor' in a for a in avisos))
        self.assertEqual(b['x_pinagem'], '1:B:Input;2:E:Passive;3:C:Passive', 'a pinagem sai dos pinos do simbolo')
        self.assertEqual(b['footprint'], 'SOT-23')
        self.assertEqual(s['designator'], 'Q', 'o designator da familia do almoxarifado')
        self.assertEqual(len(s['parts'][0]['pins']), 3, 'o desenho copiado da biblioteca de simbolos')
        self.assertEqual(meta['simbolo'], {'nome': 'TRANSISTOR NPN', 'de': 'biblioteca'})
        v = s['valores'][0]
        self.assertEqual(v['altium'], s['name'])
        self.assertTrue(v['criadoLocal'])
        self.assertEqual(v['itens'], [])
        self.assertIn({'n': 'LocalId', 'v': 'L1'}, v['params'])
        self.assertIn('[MMBT3904]', s['name'])
        # o arquivo e um acervo como os outros (var almoxLocais)
        lib = OL.le_var_js(os.path.join(self.raiz, 'Libs', 'almox-locais.js'))
        self.assertEqual(lib['symbols'][0]['name'], s['name'])
        r = CL.resumo(s)
        self.assertEqual(r['tag'], 'criado localmente')
        self.assertEqual(r['situacao'], 'nao conferido')
        self.assertIn('LocalId=L1', r['comp']['params'])
        self.assertEqual(r['comp']['ref'], 'Q?')

    def test_recusas(self):
        with self.assertRaises(CL.ErroLocal):
            self.cria(simbolo='NAO EXISTE')
        with self.assertRaises(CL.ErroLocal):
            self.cria(footprint='NAO EXISTE')
        with self.assertRaises(CL.ErroLocal):
            self.cria(componente=dict(FICHA, x_montagem='superficie'))
        with self.assertRaises(CL.ErroLocal):
            self.cria(componente=dict(FICHA, x_pinos='muitos'))
        with self.assertRaises(CL.ErroLocal):
            self.cria(nome='a": b')
        with self.assertRaises(CL.ErroLocal):
            CL.salva(self.raiz, {'id': 'L99', 'componente': {}})

    def test_editar_mantem_o_nome_e_zera_a_conferencia(self):
        s, _ = self.cria()
        lib = CL.le(self.raiz)
        lib['symbols'][0]['criadoLocal']['conferencia'] = {'pronto': True}
        CL.grava(self.raiz, lib)
        s2, _ = CL.salva(self.raiz, {'id': 'L1', 'componente': {'x_corrente': '300mA'}, 'mesclar': True})
        self.assertEqual(s2['name'], s['name'], 'o nome e o sym dos esquemas: nao muda sozinho')
        self.assertEqual(s2['criadoLocal']['componente']['x_corrente'], '300mA')
        self.assertEqual(s2['criadoLocal']['componente']['x_mpn'], 'MMBT3904', 'mesclar mantem o resto')
        self.assertNotIn('conferencia', s2['criadoLocal'], 'a ficha mudou: a conferencia de antes nao vale')
        # nome repetido ganha o sufixo
        s3, _ = self.cria(nome=s['name'])
        self.assertTrue(s3['name'].endswith('· local'))
        self.assertEqual(s3['criadoLocal']['id'], 'L2')

    def test_envio_com_a_ficha_e_depois_integrado(self):
        s, _ = self.cria()
        sch = {'items': [{'t': 'comp', 'ref': 'Q1', 'sym': s['name'], 'comment': '40V', 'footprint': 'SOT-23',
                          'params': CL.resumo(s)['comp']['params']},
                         {'t': 'comp', 'ref': 'Q2', 'sym': s['name'], 'comment': '40V', 'footprint': 'SOT-23',
                          'params': CL.resumo(s)['comp']['params']}]}
        acervo = OL.carrega_acervo(self.raiz)
        p = OL.monta_payload('PROJ', 'A', sch, acervo)
        ln = p['linhas'][0]
        self.assertEqual(ln['designadores'], 'Q1, Q2')
        self.assertNotIn('product_id', ln)
        self.assertNotIn('mpn', ln, 'o bloco faz a busca por x_mpn + x_encapsulamento')
        self.assertEqual(ln['componente']['x_mpn'], 'MMBT3904')
        self.assertEqual(ln['componente']['footprint'], 'SOT-23')
        self.assertIn({'name': 'Datasheet', 'url': 'https://www.onsemi.com/pdf/MMBT3904.pdf'}, ln['componente']['links'])
        self.assertEqual(ln['nome_altium'], s['name'])
        self.assertEqual(ln['_local'], 'L1')
        limpo = OL.payload_limpo(p)
        self.assertIn('componente', limpo['linhas'][0])
        self.assertNotIn('_local', limpo['linhas'][0])
        # o almoxarifado criou a peca; o sincronismo a traz
        FAMILIA_Q2 = dict(FAMILIA_Q, valores=[{'id': 7, 'altium': 'SMD Transistor NPN 40V 200mA MMBT3904', 'mpn': 'MMBT3904',
                                               'label': 'Transistor NPN', 'itens': [{'odoo': '5001', 'tmpl': '5000', 'nome': 'Transistor NPN 40V 200mA [MMBT3904] SOT-23 SMD', 'pkg': 'SOT-23', 'mpn': 'MMBT3904'}]}])
        escreve(self.raiz, 'almox-basicos.js', 'almoxBasicos', {'symbols': [FAMILIA_R, FAMILIA_Q2]})
        CL._cache.clear()
        ativos, integrados = CL.lista(self.raiz)
        self.assertEqual(ativos, [])
        self.assertEqual(integrados[0]['integrado']['odoo'], '5001')
        self.assertIsNone(integrados[0]['tag'], 'a tag sai')
        lib = CL.le(self.raiz)
        v = lib['symbols'][0]['valores'][0]
        self.assertFalse(v['criadoLocal'])
        self.assertEqual(v['itens'][0]['odoo'], '5001', 'o link do Odoo passa a funcionar')
        self.assertIn({'n': 'OdooId', 'v': '5001'}, v['params'])
        # o esquema antigo (so com o LocalId) vai com o product_id
        p2 = OL.monta_payload('PROJ', 'A', sch, OL.carrega_acervo(self.raiz))
        self.assertEqual(p2['linhas'][0]['product_id'], 5001)
        self.assertNotIn('componente', p2['linhas'][0])
        with self.assertRaises(CL.ErroLocal):
            CL.salva(self.raiz, {'id': 'L1', 'componente': {}})

    def test_nao_integra_com_encapsulamento_diferente(self):
        self.cria()
        FAMILIA_Q2 = dict(FAMILIA_Q, valores=[{'id': 7, 'altium': 'x', 'mpn': 'MMBT3904', 'itens': [{'odoo': '5001', 'tmpl': '5000', 'pkg': 'SOT-323', 'mpn': 'MMBT3904'}]}])
        escreve(self.raiz, 'almox-basicos.js', 'almoxBasicos', {'symbols': [FAMILIA_Q2]})
        CL._cache.clear()
        self.assertEqual(CL.integra(self.raiz), [])

    def test_conferencia_pelo_odoo(self):
        self.cria()
        visto = {}

        class Falso:
            url = 'http://odoo-falso'

            def confere(self, payload):
                visto['p'] = payload
                return {'linhas_pendentes': 1, 'linhas_prontas': 1, 'pendencias': [
                    {'designadores': 'Q1', 'motivo': 'MPN MMBT3904 nao existe no acervo',
                     'componente': {'pronto': True, 'nome_previsto': 'Transistor NPN 40V 200mA [MMBT3904] SOT-23 SMD',
                                    'faltas': [], 'erros': [], 'avisos': [], 'ignorados': []}}]}
        CL._cliente = lambda root: (OL, Falso())
        conf = CL.confere(self.raiz, 'L1')
        self.assertTrue(conf['pronto'])
        self.assertEqual(conf['nome_previsto'], 'Transistor NPN 40V 200mA [MMBT3904] SOT-23 SMD')
        ln = visto['p']['linhas'][0]
        self.assertEqual(ln['componente']['x_polaridade'], 'npn')
        self.assertNotIn('product_id', ln)
        self.assertEqual(CL.resumo(CL.le(self.raiz)['symbols'][0])['situacao'], 'pronto')
        # sem pendencia: o Odoo ja tem a peca
        Falso.confere = lambda self, p: {'linhas_pendentes': 0, 'pendencias': []}
        self.assertTrue(CL.confere(self.raiz, 'L1')['jaExiste'])

    def test_rotas(self):
        app = Flask(__name__)
        CL.registra(app, self.raiz)
        c = app.test_client()
        r = c.post('/api/locais', json={'simbolo': 'TRANSISTOR NPN', 'footprint': 'SOT-23', 'componente': FICHA})
        self.assertEqual(r.status_code, 200, r.get_json())
        j = c.get('/api/locais').get_json()
        self.assertEqual(j['componentes'][0]['id'], 'L1')
        self.assertEqual(j['tag'], 'criado localmente')
        self.assertEqual(c.get('/api/locais/L1').get_json()['componente']['criadoLocal']['id'], 'L1')
        self.assertEqual(c.get('/api/locais/L9').status_code, 404)
        o = c.get('/api/locais/opcoes').get_json()
        self.assertIn('SOT-23', o['footprints'])
        self.assertTrue(any(x['nome'] == 'TRANSISTOR NPN' and x['pinos'] == 3 for x in o['simbolos']))
        self.assertEqual(c.post('/api/locais', json={'simbolo': 'X'}).status_code, 400)
        self.assertEqual(c.post('/api/locais/L1/apagar').status_code, 200)
        self.assertEqual(c.get('/api/locais').get_json()['componentes'], [])


if __name__ == '__main__':
    unittest.main()
