# -*- coding: utf-8 -*-
"""A equipe do projeto, a permissao de gravar e o historico com autor (tools/rotas/equipe.py, 1.84.0).

O Nexo Hub e de mentira (equipe._provedor: a resposta do /api/v1/sessao; equipe._provedor_usuarios: a equipe), numa
pasta de trabalho temporaria. O /api/save e o do hubserver.py de verdade (com o ROOT trocado).

    python tests/test_equipe.py
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
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))
import equipe  # noqa: E402
import hubserver as H  # noqa: E402

ADMIN = {'id': 'u-admin', 'login': 'admin', 'nome': 'Ana Admin', 'admin': True, 'aprovador': False}
DONO = {'id': 'u-dono', 'login': 'dono', 'nome': 'Davi Dono', 'admin': False, 'aprovador': False}
COLAB = {'id': 'u-colab', 'login': 'colab', 'nome': 'Carla Colab', 'admin': False, 'aprovador': False}
ESTRANHO = {'id': 'u-fora', 'login': 'fora', 'nome': 'Fabio Fora', 'admin': False, 'aprovador': True}
TODOS = [ADMIN, DONO, COLAB, ESTRANHO]

CAB = ('var schematic = {\n"format":"schmirror-v2",\n"project":"P1",\n"units":"mil",\n'
       '"params":"CodigoDaPlaca=P-DI1;Revisao=REV.A",\n"items":[\n')


def esquema(itens):
    return CAB + ''.join(json.dumps(x, ensure_ascii=False) + ',\n' for x in itens) + ']};\n'


R5 = {'t': 'comp', 'sheet': 'S1', 'ref': 'R5', 'sym': 'RES', 'part': 1, 'x': 1000, 'y': 1000, 'rot': 0, 'footprint': 'R0805', 'comment': '10k'}
C1 = {'t': 'comp', 'sheet': 'S1', 'ref': 'C1', 'sym': 'CAP', 'part': 1, 'x': 2000, 'y': 1000, 'rot': 0, 'footprint': 'C0805', 'comment': '100n'}
FOLHA = {'t': 'sheet', 'name': 'S1', 'size': 'A4'}


def changes(ops):
    return '// AltiumPCBMirror\nvar changes = [\n' + ''.join(json.dumps(o) + ',\n' for o in ops) + '];\n'


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='equipe-')
        self.pdir = os.path.join(self.tmp, 'Projects', 'P1')
        os.makedirs(self.pdir)
        with open(os.path.join(self.pdir, 'schematic.js'), 'w', encoding='utf-8') as f:
            f.write(esquema([FOLHA, R5]))
        with open(os.path.join(self.pdir, 'changes.js'), 'w', encoding='utf-8') as f:
            f.write(changes([]))
        self.logado = None
        self.modo_hub = 'login'
        equipe._provedor[0] = self._sessao
        equipe._provedor_usuarios[0] = lambda: TODOS
        equipe._bases.clear()
        self.app = Flask(__name__)
        equipe.registra_rotas(self.app, self.tmp)
        self.c = self.app.test_client()
        self.root_real, H.ROOT = H.ROOT, self.tmp
        self.h = H.app.test_client()

    def tearDown(self):
        H.ROOT = self.root_real
        equipe._provedor[0] = None
        equipe._provedor_usuarios[0] = None
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _sessao(self):
        if self.modo_hub == 'legado':
            return ('http', 404)
        if self.modo_hub == 'fora':
            return ('http', 0)
        return {'ok': True, 'logado': bool(self.logado), 'usuario': self.logado}

    def como(self, u):
        self.logado = u
        return u

    def salva(self, arq, txt):
        return self.h.post('/api/save', json={'path': 'Projects/P1/' + arq, 'content': txt})

    def le(self, arq):
        with open(os.path.join(self.pdir, arq), encoding='utf-8') as f:
            return f.read()

    def com_dono(self, colaboradores=()):
        equipe.grava(self.pdir, {'responsavel': equipe.quem(equipe.publico(DONO)),
                                 'colaboradores': [equipe.quem(equipe.publico(c)) for c in colaboradores]})


class Permissao(Base):
    def test_matriz(self):
        self.com_dono([COLAB])
        papeis = {}
        for u in TODOS:
            self.como(u)
            p = equipe.permissao(self.pdir)
            papeis[u['login']] = (p['papel'], p['pode'], p['gerir'], p['trocarResponsavel'])
        self.assertEqual(papeis, {'admin': ('admin', True, True, True), 'dono': ('responsavel', True, True, False),
                                  'colab': ('colaborador', True, False, False), 'fora': ('leitura', False, False, False)})
        self.como(ESTRANHO)
        self.assertIn('Só o responsável (Davi Dono) e os colaboradores convidados mexem neste projeto',
                      equipe.permissao(self.pdir)['motivo'])
        # projeto sem responsavel: qualquer logado edita e pode assumir
        os.remove(os.path.join(self.pdir, 'equipe.json'))
        p = equipe.permissao(self.pdir)
        self.assertEqual((p['papel'], p['pode'], p['assumir']), ('livre', True, True))
        # Hub antigo (sem login) ou fora: edicao liberada (quem barra sem Hub e o portao)
        self.com_dono()
        for modo in ('legado', 'fora'):
            self.modo_hub = modo
            p = equipe.permissao(self.pdir)
            self.assertEqual((p['modo'], p['pode']), (modo, True))

    def test_save_python(self):
        self.com_dono([COLAB])
        txt = esquema([FOLHA, R5, C1])
        # o estranho: 403 sem_permissao, e o arquivo nao muda
        self.como(ESTRANHO)
        r = self.salva('schematic.js', txt)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.get_json()['codigo'], 'sem_permissao')
        self.assertIn('Davi Dono', r.get_json()['error'])
        self.assertNotIn('C1', self.le('schematic.js'))
        # ninguem logado com responsavel no projeto: tambem nao
        self.como(None)
        self.assertEqual(self.salva('schematic.js', txt).status_code, 403)
        # admin, responsavel e colaborador gravam
        for u in (ADMIN, DONO, COLAB):
            self.como(u)
            r = self.salva('changes.js', changes([{'op': 'via_add', 'x': 1, 'y': 2, 'net': 'GND', 'size': 0.6, 'drill': 0.3, 'note': u['login']}]))
            self.assertEqual(r.status_code, 200, (u['login'], r.get_json()))
        # Libs/ nao tem dono
        os.makedirs(os.path.join(self.tmp, 'Libs'))
        self.como(ESTRANHO)
        self.assertEqual(self.h.post('/api/save', json={'path': 'Libs/lib-subs.js', 'content': '//\n'}).status_code, 200)
        # projeto sem responsavel: qualquer logado; Hub antigo: todo mundo
        os.remove(os.path.join(self.pdir, 'equipe.json'))
        self.assertEqual(self.salva('schematic.js', txt).status_code, 200)
        self.com_dono()
        self.modo_hub = 'legado'
        self.assertEqual(self.salva('schematic.js', esquema([FOLHA])).status_code, 200)

    def apaga(self):
        H.build_index(self.tmp)
        return self.h.post('/api/project/p1/delete', json={'password': 'LucasGatao'})   # a senha mestre de antes nao vale

    def recusa(self, trecho):
        r = self.apaga()
        self.assertEqual(r.status_code, 403, r.get_json())
        j = r.get_json()
        self.assertEqual(j['codigo'], 'sem_permissao')
        self.assertNotIn('mestre', j)
        self.assertIn(trecho, j['error'])
        self.assertTrue(os.path.isdir(self.pdir), 'recusado nao move nada')
        return j

    def test_apagar_projeto_pelo_login(self):
        """1.86.0: "tira a senha mestre de vez, so admin ou responsavel exclui" """
        self.com_dono([COLAB])
        # colaborador e quem nao e da equipe: 403 sem_permissao, com o motivo (e a senha mestre nao abre nada)
        self.como(COLAB)
        self.recusa('Só o administrador ou o responsável (Davi Dono) exclui este projeto')
        self.como(ESTRANHO)
        self.recusa('Só o administrador ou o responsável (Davi Dono) exclui este projeto')
        # sem login, Hub antigo e Hub fora: ninguem exclui
        self.como(None)
        self.recusa('Entre no Nexo Hub')
        self.como(ADMIN)
        self.modo_hub = 'legado'
        self.recusa('Atualize o Nexo Hub')
        self.modo_hub = 'fora'
        self.recusa('O Nexo Hub não respondeu')
        self.modo_hub = 'login'
        # o que a interface le: a permissao (e a lista da arvore) diz quem exclui e por que nao
        self.como(COLAB)
        p = self.c.get('/api/equipe?projeto=P1').get_json()['permissao']
        self.assertEqual((p['apagar'], p['motivoApagar']), (False, 'Só o administrador ou o responsável (Davi Dono) exclui este projeto'))
        e = self.c.get('/api/equipes').get_json()['projetos']['P1']
        self.assertEqual((e['apagar'], e['motivoApagar']), (False, p['motivoApagar']))
        self.como(DONO)
        self.assertTrue(self.c.get('/api/equipes').get_json()['projetos']['P1']['apagar'])
        # o responsavel exclui, pelo login
        r = self.apaga()
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertFalse(os.path.isdir(self.pdir))

    def test_apagar_projeto_pelo_admin(self):
        self.com_dono()
        self.como(ADMIN)
        r = self.apaga()
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertFalse(os.path.isdir(self.pdir))
        self.assertTrue(any(n.startswith('P1-') for n in os.listdir(os.path.join(self.tmp, 'Trash'))))

    def test_apagar_projeto_sem_responsavel(self):
        """projeto sem responsavel: so o admin; os outros veem o motivo e podem Assumir projeto antes"""
        self.como(ESTRANHO)
        j = self.recusa('Este projeto não tem responsável: só o administrador exclui')
        self.assertTrue(j['assumir'])
        self.assertIn('Assuma o projeto', j['error'])
        self.assertTrue(self.c.post('/api/equipe/assumir', json={'projeto': 'P1'}).get_json()['ok'])
        r = self.apaga()
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertFalse(os.path.isdir(self.pdir))

class Equipe(Base):
    def test_convidar_remover_trocar(self):
        self.com_dono()
        # quem nao e o responsavel nem admin nao convida
        self.como(ESTRANHO)
        self.assertEqual(self.c.post('/api/equipe/convidar', json={'projeto': 'P1', 'id': 'u-fora'}).status_code, 403)
        # o responsavel convida (o nome vem do Hub)
        self.como(DONO)
        j = self.c.post('/api/equipe/convidar', json={'projeto': 'P1', 'id': 'u-colab', 'nome': 'forjado'}).get_json()
        self.assertTrue(j['ok'], j)
        c = j['equipe']['colaboradores'][0]
        self.assertEqual((c['nome'], c['convidado_por']['nome']), ('Carla Colab', 'Davi Dono'))
        self.assertEqual(self.c.post('/api/equipe/convidar', json={'projeto': 'P1', 'id': 'u-colab'}).status_code, 409)
        self.assertEqual(self.c.post('/api/equipe/convidar', json={'projeto': 'P1', 'id': 'u-nada'}).status_code, 404)
        # a convidada grava
        self.como(COLAB)
        self.assertEqual(self.salva('schematic.js', esquema([FOLHA, R5, C1])).status_code, 200)
        self.assertEqual(self.c.get('/api/equipe?projeto=P1').get_json()['permissao']['papel'], 'colaborador')
        # a arvore: um pedido so com todos os projetos
        self.assertEqual(self.c.get('/api/equipes').get_json()['projetos']['P1']['papel'], 'colaborador')
        # so o admin troca o responsavel
        self.como(DONO)
        self.assertEqual(self.c.post('/api/equipe/responsavel', json={'projeto': 'P1', 'id': 'u-fora'}).status_code, 403)
        self.como(ADMIN)
        j = self.c.post('/api/equipe/responsavel', json={'projeto': 'P1', 'id': 'u-colab'}).get_json()
        self.assertEqual((j['equipe']['responsavel']['nome'], j['equipe']['colaboradores']), ('Carla Colab', []))
        # o responsavel tira; a propria pessoa tambem sai
        self.como(COLAB)
        self.c.post('/api/equipe/convidar', json={'projeto': 'P1', 'id': 'u-dono'})
        self.c.post('/api/equipe/convidar', json={'projeto': 'P1', 'id': 'u-fora'})
        self.assertTrue(self.c.post('/api/equipe/remover', json={'projeto': 'P1', 'id': 'u-dono'}).get_json()['ok'])
        self.como(ESTRANHO)
        self.assertTrue(self.c.post('/api/equipe/remover', json={'projeto': 'P1', 'id': 'u-fora'}).get_json()['ok'])
        self.assertEqual(equipe.le(self.pdir)['colaboradores'], [])
        # tudo isso aparece no historico
        textos = [m for e in equipe.lista(self.pdir) if e['tipo'] == 'equipe' for m in e['mudancas']]
        self.assertIn('Davi Dono convidou Carla Colab como colaborador', textos)
        self.assertIn('responsável: Davi Dono → Carla Colab', textos)

    def test_assumir_projeto_sem_responsavel(self):
        self.como(None)
        self.assertEqual(self.c.post('/api/equipe/assumir', json={'projeto': 'P1'}).status_code, 401)
        self.como(COLAB)
        j = self.c.post('/api/equipe/assumir', json={'projeto': 'P1'}).get_json()
        self.assertEqual(j['equipe']['responsavel']['nome'], 'Carla Colab')
        self.como(DONO)
        self.assertEqual(self.c.post('/api/equipe/assumir', json={'projeto': 'P1'}).status_code, 403)
        self.modo_hub = 'legado'
        r = self.c.post('/api/equipe/assumir', json={'projeto': 'P1'})
        self.assertEqual(r.status_code, 409)
        self.assertIn('2.26.0', r.get_json()['error'])


class Historico(Base):
    def test_entrada_com_autor_e_diff_do_esquema(self):
        self.como(DONO)
        r5b = dict(R5, comment='22k')
        self.assertEqual(self.salva('schematic.js', esquema([FOLHA, r5b, C1])).status_code, 200)
        ent = equipe.lista(self.pdir)
        self.assertEqual(len(ent), 1)
        e = ent[0]
        self.assertEqual((e['usuario'], e['origem'], e['arquivo'], e['tipo']),
                         ({'id': 'u-dono', 'login': 'dono', 'nome': 'Davi Dono'}, 'app', 'schematic.js', 'esquema'))
        self.assertIn('C1 adicionado (100n, C0805)', e['mudancas'])
        self.assertIn('R5: valor 10k → 22k', e['mudancas'])
        # um arquivo por pessoa (o espelho do NexoBD nao junta linhas de duas maquinas no mesmo arquivo)
        self.assertTrue(os.path.isfile(os.path.join(self.pdir, 'Historico', 'u-dono.jsonl')))

    def test_diff_do_esquema(self):
        a = esquema([FOLHA, R5, C1, {'t': 'netlabel', 'sheet': 'S1', 'net': 'VCC', 'x': 1, 'y': 1}])
        d = esquema([FOLHA, dict(R5, x=1500, footprint='R1206'),
                     {'t': 'netlabel', 'sheet': 'S1', 'net': 'GND', 'x': 1, 'y': 1},
                     {'t': 'wire', 'sheet': 'S1', 'pts': [[0, 0], [100, 0]]}])
        m = equipe.muda_esquema(a, d)
        for t in ('C1 removido', 'R5: footprint R0805 → R1206', 'R5 movido', 'rótulo de net GND adicionado',
                  'rótulo de net VCC removido', 'fio adicionado'):
            self.assertIn(t, m)
        self.assertEqual(equipe.muda_esquema(a, a), [])

    def test_diff_da_pcb(self):
        a = changes([{'op': 'via_del', 'id': 'v9', 'orig_x': 36, 'orig_y': 5},
                     {'op': 'comp_move', 'ref': 'C1', 'x': 1, 'y': 1, 'orig_x': 0, 'orig_y': 0}])
        d = changes([{'op': 'track_add', 'layer': 'Top', 'x1': 0, 'y1': 0, 'x2': 1, 'y2': 0, 'w': 0.3, 'net': 'GND'},
                     {'op': 'track_add', 'layer': 'Top', 'x1': 1, 'y1': 0, 'x2': 2, 'y2': 0, 'w': 0.3, 'net': 'GND'},
                     {'op': 'comp_move', 'ref': 'R5', 'x': 12.7, 'y': 8.4, 'rot': 90, 'orig_x': 10, 'orig_y': 8.4, 'orig_rot': 0},
                     {'op': 'comp_move', 'ref': 'C1', 'x': 3, 'y': 1, 'orig_x': 0, 'orig_y': 0},
                     {'op': 'via_add', 'x': 16, 'y': 22, 'size': 0.6, 'drill': 0.3, 'net': 'GND'},
                     {'op': 'text_edit', 'id': 'x7', 'text': '27', 'orig_text': '1', 'x': 1, 'y': 1, 'orig_x': 1, 'orig_y': 1}])
        m = equipe.muda_pcb(a, d)
        for t in ('2 trilhas na net GND adicionadas (Top)', 'R5 movido para (12,7; 8,4) mm, girado para 90°',
                  'C1 movido para (3; 1) mm', 'via na net GND adicionada em (16; 22)', 'via v9 voltou',
                  'texto x7 alterado: "1" → "27"'):
            self.assertIn(t, m)
        self.assertNotIn('movimento de C1 desfeito', m, 'a op que mudou nao aparece como desfeita')
        self.assertEqual(equipe.muda_pcb(changes([{'op': 'via_del', 'id': 'v3', 'orig_x': 1, 'orig_y': 1, 'orig_layer': 'Top'}]),
                                         changes([])), ['via v3 voltou'])
        self.assertEqual(equipe.muda_pcb(changes([]), changes([{'op': 'via_del', 'id': 'v3'}])), ['via v3 removida'])

    def test_diff_das_regras(self):
        cab = 'var pcbrules = {\n"format":"x",\n"units":"mm",\n"origem":"",\n"classes":{},\n"verificar":null,\n"rules":[\n'
        a = cab + '{"name":"Width","kind":"Width","min":0.2}\n]};\n'
        d = cab + '{"name":"Width","kind":"Width","min":0.3},\n{"name":"Folga","kind":"Clearance","gap":0.2}\n]};\n'
        self.assertEqual(equipe.muda_regras(a, d), ['regra Folga adicionada (Clearance)', 'regra Width alterada: min 0,2 → 0,3'])

    def test_junta_gravacoes_em_5_minutos(self):
        self.como(DONO)
        t0 = 1_800_000_000.0
        v0 = changes([])
        v1 = changes([{'op': 'via_add', 'x': 1, 'y': 1, 'net': 'GND'}])
        v2 = changes([{'op': 'via_add', 'x': 1, 'y': 1, 'net': 'GND'}, {'op': 'track_add', 'layer': 'Top', 'net': 'VCC'}])
        u = equipe.publico(DONO)
        equipe.registra(self.pdir, 'changes.js', v0, v1, usuario=u, agora=t0)
        equipe.registra(self.pdir, 'changes.js', v1, v2, usuario=u, agora=t0 + 120)
        ent = equipe.lista(self.pdir)
        self.assertEqual(len(ent), 1, 'o autosave de 2 min depois junta')
        self.assertEqual(ent[0]['gravacoes'], 2)
        self.assertEqual(ent[0]['mudancas'], ['via na net GND adicionada em (1; 1)', 'trilha na net VCC adicionada (Top)'],
                         'o diff e do inicio da janela ate agora')
        # outra pessoa no mesmo arquivo: entrada propria
        equipe.registra(self.pdir, 'changes.js', v2, v1, usuario=equipe.publico(COLAB), agora=t0 + 130)
        # passada a janela: entrada nova
        equipe.registra(self.pdir, 'changes.js', v1, v0, usuario=u, agora=t0 + 120 + equipe.JANELA + 1)
        ent = equipe.lista(self.pdir)
        self.assertEqual([e['usuario']['login'] for e in ent], ['dono', 'colab', 'dono'])
        self.assertEqual(ent[0]['mudancas'], ['via na net GND removida'])
        # dentro da janela, voltar ao que era no inicio tira a entrada
        equipe.registra(self.pdir, 'changes.js', v0, v1, usuario=u, agora=t0 + 120 + equipe.JANELA + 60)
        self.assertEqual(len(equipe.lista(self.pdir)), 2)

    def test_registra_do_rust_e_da_ia(self):
        """o Rust e o MCP gravam o arquivo e avisam aqui com o conteudo anterior"""
        self.como(COLAB)
        antes = self.le('changes.js')
        with open(os.path.join(self.pdir, 'changes.js'), 'w', encoding='utf-8') as f:
            f.write(changes([{'op': 'via_add', 'x': 1, 'y': 1, 'net': 'GND'}]))
        j = self.c.post('/api/historico/registra', json={'projeto': 'P1', 'arquivo': 'changes.js', 'antes': antes,
                                                         'origem': 'ia', 'ferramenta': 'pcb_via'}).get_json()
        self.assertTrue(j['ok'], j)
        e = self.c.get('/api/historico?projeto=P1').get_json()['entradas'][0]
        self.assertEqual((e['origem'], e['usuario']['nome'], e['ferramentas']), ('ia', 'Carla Colab', ['pcb_via']))
        self.assertEqual(self.c.post('/api/historico/registra', json={'projeto': 'P1', 'arquivo': 'board.js'}).status_code, 404)
        self.assertEqual(self.c.post('/api/historico/registra', json={'projeto': '..', 'arquivo': 'changes.js'}).status_code, 404)


class Sessao(Base):
    def test_sessao_do_hub(self):
        self.como(dict(ADMIN, foto={'sha256': 'abcdef0123456789', 'mime': 'image/png'}, iniciais='AA'))
        j = self.c.get('/api/sessao').get_json()
        self.assertEqual((j['modo'], j['usuario']['nome'], j['usuario']['foto'], j['usuario']['admin']),
                         ('login', 'Ana Admin', 'abcdef012345', True))
        self.modo_hub = 'legado'
        self.assertEqual(self.c.get('/api/sessao').get_json()['modo'], 'legado')
        self.modo_hub = 'fora'
        self.assertEqual(self.c.get('/api/sessao').get_json()['modo'], 'fora')
        self.modo_hub = 'login'
        self.como(None)
        self.assertEqual(self.c.get('/api/sessao').get_json()['modo'], 'deslogado')
        lst = self.c.get('/api/sessao/usuarios').get_json()['usuarios']
        self.assertEqual([u['nome'] for u in lst], ['Ana Admin', 'Carla Colab', 'Davi Dono', 'Fabio Fora'])


if __name__ == '__main__':
    unittest.main()
