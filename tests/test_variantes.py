# -*- coding: utf-8 -*-
"""A VARIANTE DE PROJETO (tools/rotas/variantes.py, 1.88.0): a mesma PCB, so o que e montado muda.

Numa pasta de trabalho temporaria, com o Nexo Hub de mentira (equipe._provedor). Confere: criar exige codigo (unico entre
as variantes e diferente do da PCB); suprimir tira o componente do BOM, da lista do Odoo e da Neoden (a mesma marca), e a
placa (board.js, changes.js, Gerber) nao muda; salvar o esquema ou a PCB com uma variante ativa e recusado (so o mesmo
texto passa); as permissoes (criar/apagar/suprimir = a equipe; trocar de variante = livre, tambem para o visualizador); a
PCB montada e a virgem pelos codigos certos; o historico diz quem suprimiu o que.

    python tests/test_variantes.py
"""
import base64
import json
import os
import shutil
import sys
import tempfile
import unittest

from flask import Flask

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))
import equipe  # noqa: E402
import variantes as VR  # noqa: E402
import hubserver as H  # noqa: E402
import odoolista as OL  # noqa: E402
import odoolista_server as OS  # noqa: E402

DONO = {'id': 'u-dono', 'login': 'dono', 'nome': 'Davi Dono', 'admin': False}
COLAB = {'id': 'u-colab', 'login': 'colab', 'nome': 'Carla Colab', 'admin': False}
ADMIN = {'id': 'u-admin', 'login': 'admin', 'nome': 'Ana Admin', 'admin': True}
FORA = {'id': 'u-fora', 'login': 'fora', 'nome': 'Fabio Fora', 'admin': False}
VISU = {'id': 'u-dono', 'login': 'dono', 'nome': 'Davi Dono', 'admin': False, 'visualizador': True, 'funcao': 'visualizador'}

PLACA = 'PAEL-DI261940'
# um PNG de 1x1 (as fotos 3D do envio)
PNG = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AAX+Av6nNYGEAAAAAElFTkSuQmCC")
CAB = ('var schematic = {\n"format":"schmirror-v2",\n"project":"P1",\n"units":"mil",\n'
       '"params":"CodigoDaPlaca=%s;NomeDaPlaca=PLACA ADAPTADORA ENCODER LINEAR;CodigoDoEquipamento=EQ-DI261000;'
       'NomeDoEquipamento=ENCODER;Revisao=REV.A",\n"items":[\n' % PLACA)
FOLHA = {'t': 'sheet', 'name': 'S1', 'size': 'A4'}
R5 = {'t': 'comp', 'sheet': 'S1', 'ref': 'R5', 'sym': 'RES', 'part': 1, 'x': 1000, 'y': 1000, 'rot': 0, 'footprint': 'R0805', 'comment': '10k'}
R6 = dict(R5, ref='R6', x=1500)
U3 = {'t': 'comp', 'sheet': 'S1', 'ref': 'U3', 'sym': 'LM555', 'part': 1, 'x': 3000, 'y': 1000, 'rot': 0, 'footprint': 'SOIC8', 'comment': 'LM555'}
BOARD = {'board': {'outline': [[0, 0], [20, 0], [20, 20], [0, 20]]}, 'components': [
    {'ref': 'R5', 'comment': '10k', 'footprint': 'R0805', 'layer': 'Top', 'x': 1, 'y': 1, 'rot': 0, 'pads': []},
    {'ref': 'R6', 'comment': '10k', 'footprint': 'R0805', 'layer': 'Top', 'x': 3, 'y': 1, 'rot': 0, 'pads': []},
    {'ref': 'U3', 'comment': 'LM555', 'footprint': 'SOIC8', 'layer': 'Top', 'x': 9, 'y': 9, 'rot': 0, 'pads': []}]}


def esquema(itens):
    return CAB + ''.join(json.dumps(x, ensure_ascii=False) + ',\n' for x in itens) + ']};\n'


class Variantes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='variantes-')
        self.pdir = os.path.join(self.tmp, 'Projects', 'P1')
        os.makedirs(self.pdir)
        self.sch = esquema([FOLHA, R5, R6, U3])
        for nome, txt in (('schematic.js', self.sch), ('changes.js', 'var changes = [\n];\n'),
                          ('board.js', 'var pcbmirror = ' + json.dumps(BOARD) + ';\n')):
            with open(os.path.join(self.pdir, nome), 'w', encoding='utf-8') as f:
                f.write(txt)
        equipe.grava(self.pdir, {'responsavel': equipe.quem(DONO), 'colaboradores': [dict(equipe.quem(COLAB))]})
        self.logado = DONO
        equipe._provedor[0] = lambda: {'ok': True, 'logado': bool(self.logado), 'usuario': self.logado}
        equipe._bases.clear()
        self.app = Flask(__name__)
        equipe.registra_rotas(self.app, self.tmp)
        VR.registra(self.app, self.tmp, equipe, lambda d: H.load_var_file(os.path.join(d, 'schematic.js')))
        self.c = self.app.test_client()
        self.root_real, H.ROOT = H.ROOT, self.tmp
        self.h = H.app.test_client()

    def tearDown(self):
        H.ROOT = self.root_real
        equipe._provedor[0] = None
        shutil.rmtree(self.tmp, ignore_errors=True)

    def post(self, rota, **corpo):
        corpo.setdefault('projeto', 'P1')
        return self.c.post(rota, json=corpo)

    def cria(self, nome='Sem timer', codigo='PAELST-DI261951'):
        r = self.post('/api/variantes/criar', nome=nome, codigo=codigo, nomeCatalogo='PLACA SEM TIMER')
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()['variante']

    def test_criar_exige_codigo_unico_e_diferente_da_pcb(self):
        r = self.post('/api/variantes/criar', nome='Sem timer', codigo='')
        self.assertEqual(r.status_code, 400)
        self.assertIn('sem código não há variante', r.get_json()['error'])
        r = self.post('/api/variantes/criar', nome='Sem timer', codigo=PLACA.lower())
        self.assertEqual(r.status_code, 409)
        self.assertIn('é o código da PCB', r.get_json()['error'])
        v = self.cria()
        self.assertEqual(v['codigo'], 'PAELST-DI261951')
        self.assertTrue(VR._ID.match(v['id']))
        r = self.post('/api/variantes/criar', nome='Outra', codigo=' paelst - di261951 ')
        self.assertEqual(r.status_code, 409)
        self.assertIn('já é da variante "Sem timer"', r.get_json()['error'])
        r = self.post('/api/variantes/criar', nome='sem TIMER', codigo='PX-DI1')
        self.assertEqual(r.status_code, 409, 'nome repetido')
        r = self.post('/api/variantes/criar', nome='', codigo='PX-DI1')
        self.assertEqual(r.status_code, 400, '1.89.0: o nome da variante e obrigatorio')
        # 1.89.0: o equipamento do projeto padrao nao pode ser o da variante
        r = self.post('/api/variantes/criar', nome='Mesmo equipamento', codigo='eq-di261000')
        self.assertEqual(r.status_code, 409)
        self.assertIn('equipamento do projeto padrão', r.get_json()['error'])
        # o arquivo: o formato e a variante
        with open(os.path.join(self.pdir, 'variantes.json'), encoding='utf-8') as f:
            d = json.load(f)
        self.assertEqual(d['formato'], 'nexoeletric-variantes-1')
        self.assertEqual([x['codigo'] for x in d['variantes']], ['PAELST-DI261951'])
        # trocar o codigo: as mesmas regras
        v2 = self.cria('Com display', 'PAELCD-DI261952')
        r = self.post('/api/variantes/editar', id=v2['id'], codigo='PAELST-DI261951')
        self.assertEqual(r.status_code, 409)
        r = self.post('/api/variantes/editar', id=v2['id'], codigo='PAELCD2-DI261953', nome='Com display 2')
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()['variante']['codigo'], 'PAELCD2-DI261953')

    def test_suprimir_tira_do_bom_odoo_e_neoden_e_a_placa_nao_muda(self):
        v = self.cria()
        antes = {n: open(os.path.join(self.pdir, n), 'rb').read() for n in ('schematic.js', 'changes.js', 'board.js')}
        r = self.post('/api/variantes/suprimir', id=v['id'], refs=['U3', 'X99'])
        self.assertEqual(r.status_code, 400, 'ref fora do esquema e recusado')
        r = self.post('/api/variantes/suprimir', id=v['id'], refs=['U3'])
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()['mudou'], ['U3'])
        sup = r.get_json()['variante']['suprimidos'][0]
        self.assertEqual((sup['ref'], sup['sym'], sup['footprint'], sup['por']['nome']), ('U3', 'LM555', 'SOIC8', 'Davi Dono'))
        # na padrao (nada ativo): o BOM tem os tres
        d = self.pdir
        self.assertEqual(sorted(c['ref'] for c in H._bom_source(d)['components']), ['R5', 'R6', 'U3'])
        # ativa: o U3 sai do BOM (a fonte do painel e da pagina do NexoBD)
        self.assertEqual(self.post('/api/variantes/ativar', id=v['id']).status_code, 200)
        b = H._bom_source(d)
        self.assertEqual(sorted(c['ref'] for c in b['components']), ['R5', 'R6'])
        self.assertEqual(b['variante']['codigo'], 'PAELST-DI261951')
        # a lista do Odoo (o _prepara de verdade): o U3 nao vai; a montada e a da variante, a virgem a da PCB
        root_os, OS.ROOT = OS.ROOT, self.tmp
        try:
            payload, erro, st = OS._prepara({'projeto': 'P1', 'revisao': 'A'})
        finally:
            OS.ROOT = root_os
        self.assertIsNone(erro, erro)
        refs = sorted(r for ln in payload['linhas'] for r in str(ln.get('designadores') or ln.get('refs') or '').replace(',', ' ').split())
        self.assertNotIn('U3', json.dumps(payload['linhas']))
        self.assertIn('R5', json.dumps(payload['linhas']))
        self.assertEqual(payload['codigo_placa'], PLACA)
        # 1.89.0: a montada da variante = o codigo da placa + o nome da variante; a virgem nao vai
        self.assertEqual(payload['pcb_montada'], {'codigo': PLACA + ' SEM TIMER'})
        self.assertEqual(VR.montada_da_variante(PLACA, ' sem  timer '), PLACA + VR.SEPARADOR_MONTADA + 'SEM TIMER')
        self.assertEqual(payload['variante'], {'nome': 'Sem timer', 'codigo': 'PAELST-DI261951'})
        self.assertEqual(payload['_suprimidos'], ['U3'])
        self.assertTrue(payload['uid_externo'].startswith('altium:P1-PAELST-DI261951:'), payload['uid_externo'])
        limpo = OL.payload_limpo(payload)
        self.assertNotIn('_suprimidos', limpo)
        os.makedirs(os.path.join(self.tmp, 'Projects', 'P1', 'Renders'), exist_ok=True)
        with open(os.path.join(self.tmp, 'Projects', 'P1', 'Renders', OL.RENDERS['virgem']), 'wb') as f:
            f.write(base64.b64decode(PNG))
        with open(os.path.join(self.tmp, 'Projects', 'P1', 'Renders', OL.RENDERS['montada']), 'wb') as f:
            f.write(base64.b64decode(PNG))
        com = OL.anexa_imagens(limpo, 'P1', self.tmp)
        self.assertNotIn('pcb_virgem', com, 'variante: a lista vai sem a PCB virgem (nem a foto dela)')
        self.assertIn('imagem_montada', com, 'a foto da montada vai')
        # na padrao: a virgem vai, com o codigo da PCB e a foto
        self.assertEqual(self.post('/api/variantes/ativar', id=None).status_code, 200)
        root_os, OS.ROOT = OS.ROOT, self.tmp
        try:
            p0, erro, st = OS._prepara({'projeto': 'P1', 'revisao': 'A'})
        finally:
            OS.ROOT = root_os
        self.assertEqual(p0['pcb_montada'], {'codigo': PLACA})
        c0 = OL.anexa_imagens(OL.payload_limpo(p0), 'P1', self.tmp)
        self.assertEqual((c0['pcb_virgem']['codigo'], c0['pcb_virgem']['quantidade'], bool(c0['pcb_virgem'].get('imagem'))), (PLACA, 1, True))
        self.assertEqual(self.post('/api/variantes/ativar', id=v['id']).status_code, 200)
        # Neoden/BOM da tela: a mesma marca (o HubCore.dnpRefs le o dnp do esquema aplicado)
        apl = VR.aplica(H.load_var_file(os.path.join(d, 'schematic.js')), VR.ativa(d))
        self.assertEqual(OL.dnp_refs(apl), {'U3'})
        # a placa e a mesma: nada do desenho mudou
        for n, b0 in antes.items():
            self.assertEqual(open(os.path.join(self.pdir, n), 'rb').read(), b0, n)
        # voltar a montar
        r = self.post('/api/variantes/suprimir', id=v['id'], refs=['U3'], suprimir=False)
        self.assertEqual(r.get_json()['mudou'], ['U3'])
        self.assertEqual(sorted(c['ref'] for c in H._bom_source(d)['components']), ['R5', 'R6', 'U3'])

    def test_na_padrao_montada_e_virgem_sao_a_pcb(self):
        root_os, OS.ROOT = OS.ROOT, self.tmp
        try:
            payload, erro, _ = OS._prepara({'projeto': 'P1', 'revisao': 'A'})
        finally:
            OS.ROOT = root_os
        self.assertIsNone(erro)
        self.assertEqual((payload['codigo_placa'], payload['pcb_montada']['codigo']), (PLACA, PLACA))
        self.assertNotIn('variante', payload)
        self.assertEqual(payload['uid_externo'], 'altium:P1:A', 'sem variante, a chave de sempre')
        self.assertNotIn('EQ-DI261000', json.dumps(OL.payload_limpo(payload)), 'o equipamento não vai ao Odoo')

    def test_salvar_com_variante_ativa_nao_muda_o_desenho(self):
        v = self.cria()
        novo = esquema([FOLHA, R5, dict(R6, x=9999), U3])
        # padrao: grava
        r = self.h.post('/api/save', json={'path': 'Projects/P1/changes.js', 'content': 'var changes = [\n{"op":"via_add","x":1,"y":1},\n];\n'})
        self.assertEqual(r.status_code, 200, r.get_json())
        ch = open(os.path.join(self.pdir, 'changes.js'), encoding='utf-8').read()
        self.post('/api/variantes/ativar', id=v['id'])
        for arq, txt in (('schematic.js', novo), ('changes.js', 'var changes = [\n];\n'), ('rules.js', 'var rules = {};\n'),
                         ('annotations.js', 'var annotations = [];\n')):
            r = self.h.post('/api/save', json={'path': 'Projects/P1/' + arq, 'content': txt})
            self.assertEqual(r.status_code, 409, arq)
            self.assertEqual(r.get_json()['codigo'], 'variante_ativa')
            self.assertIn('Sem timer', r.get_json()['error'])
        self.assertEqual(open(os.path.join(self.pdir, 'schematic.js'), encoding='utf-8').read(), self.sch)
        self.assertEqual(open(os.path.join(self.pdir, 'changes.js'), encoding='utf-8').read(), ch)
        self.assertFalse(os.path.exists(os.path.join(self.pdir, 'rules.js')))
        # o mesmo texto do disco passa (o Salvar sem mudança)
        r = self.h.post('/api/save', json={'path': 'Projects/P1/changes.js', 'content': ch})
        self.assertEqual(r.status_code, 200)
        # de volta a padrao: grava de novo
        self.post('/api/variantes/ativar', id=None)
        r = self.h.post('/api/save', json={'path': 'Projects/P1/schematic.js', 'content': novo})
        self.assertEqual(r.status_code, 200)

    def test_permissoes(self):
        v = self.cria()
        # o colaborador e o admin editam; quem nao foi convidado e o visualizador nao
        for u, st in ((COLAB, 200), (ADMIN, 200), (FORA, 403), (VISU, 403)):
            self.logado = u
            equipe.esquece_sessao()
            r = self.post('/api/variantes/suprimir', id=v['id'], refs=['R5'], suprimir=(st == 200 and u is COLAB))
            self.assertEqual(r.status_code, st, (u['login'], r.get_json()))
            if st == 403:
                self.assertEqual(r.get_json()['codigo'], 'sem_permissao')
                for rota, corpo in (('/api/variantes/criar', {'nome': 'X', 'codigo': 'PX-DI9'}), ('/api/variantes/apagar', {'id': v['id']}),
                                    ('/api/variantes/editar', {'id': v['id'], 'nome': 'Y'})):
                    self.assertEqual(self.post(rota, **corpo).status_code, 403, (u['login'], rota))
                # trocar de variante (ver e exportar) e livre
                self.assertEqual(self.post('/api/variantes/ativar', id=v['id']).status_code, 200, u['login'])
                self.assertEqual(self.post('/api/variantes/ativar', id=None).status_code, 200)
                self.assertEqual(self.c.get('/api/variantes?projeto=P1').get_json()['permissao']['pode'], False)
        # o visualizador e barrado tambem pelo before_request (ROTAS_EDICAO), venha de onde vier
        self.assertIsNotNone(equipe.ROTAS_EDICAO.match('/api/variantes/suprimir'))
        self.assertIsNone(equipe.ROTAS_EDICAO.match('/api/variantes/ativar'))
        self.logado = DONO
        equipe.esquece_sessao()
        self.assertEqual(self.post('/api/variantes/apagar', id=v['id']).status_code, 200)
        self.assertEqual(self.c.get('/api/variantes?projeto=P1').get_json()['variantes'], [])

    def test_historico_diz_quem_suprimiu_o_que(self):
        v = self.cria()
        self.post('/api/variantes/suprimir', id=v['id'], refs=['R6', 'U3'])
        txt = json.dumps(equipe.lista(self.pdir), ensure_ascii=False)
        self.assertIn('criou a variante \\"Sem timer\\" (PAELST-DI261951)', txt)
        self.assertIn('suprimiu R6, U3 na variante', txt)
        self.assertIn('Davi Dono', txt)

    def test_estado_e_index(self):
        v = self.cria()
        self.post('/api/variantes/suprimir', id=v['id'], refs=['U3'])
        e = self.c.get('/api/variantes?projeto=P1').get_json()
        self.assertEqual(e['placa'], {'codigo': PLACA, 'nome': 'PLACA ADAPTADORA ENCODER LINEAR'})
        self.assertEqual(e['codigos']['montada'], PLACA, 'a padrao ativa: a montada e a PCB')
        self.post('/api/variantes/ativar', id=v['id'])
        e = self.c.get('/api/variantes?projeto=P1').get_json()
        self.assertEqual((e['ativa'], e['codigos']['montada'], e['codigos']['virgem'], e['codigos']['virgemVai'], e['codigos']['equipamento']),
                         (v['id'], PLACA + ' SEM TIMER', PLACA, False, 'PAELST-DI261951'))
        # 1.89.3: o dropdown chama a padrao pelo equipamento do projeto, mesmo com a variante ativa
        self.assertEqual((e['codigos']['equipamentoProjeto'], e['codigos']['nomeEquipamentoProjeto']), ('EQ-DI261000', 'ENCODER'))
        # a ativa e desta maquina: o arquivo comeca com ponto (fora do NexoBD e do HTTP); o variantes.json viaja
        self.assertTrue(os.path.exists(os.path.join(self.pdir, '.variante-ativa.json')))
        idx = H.build_index(self.tmp)['projects'][0]
        self.assertEqual(idx['placa'], {'codigo': PLACA, 'nome': 'PLACA ADAPTADORA ENCODER LINEAR'})
        self.assertEqual(idx['variantes'], 1)
        # o espelho do NexoBD: o variantes.json entra, o .variante-ativa.json nao (LIXO = comeca com ponto)
        self.assertFalse(VR.ARQ.startswith('.'))
        self.assertTrue(VR.ATIVA.startswith('.'))


if __name__ == '__main__':
    unittest.main(verbosity=1)
