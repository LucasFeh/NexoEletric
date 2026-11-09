# -*- coding: utf-8 -*-
"""As rotas /api/aprovacao* e /api/revisoes* (tools/rotas/aprovacao.py): a aprovacao do projeto pelo login do Nexo Hub.

1.84.0: os carimbos (nome + senha, /api/carimbos*) sairam; quem aprova e quem esta logado no Nexo Hub com a marca de
aprovador (o Hub e de mentira aqui: equipe._provedor). Assumir o projeto e o /api/equipe/assumir (tools/rotas/equipe.py).

Numa pasta de trabalho temporaria, com um schematic.js no formato do serializeSchematic (hub-core.js).

    python tests/test_aprovacao.py
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
import aprovacao as carimbos  # noqa: E402
import equipe  # noqa: E402

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
        # 1.84.0: quem aprova e quem esta logado no Nexo Hub (equipe.sessao); sem nada, o Hub "antigo" (404, sem login)
        self.logado = None
        equipe._provedor[0] = lambda: ({'ok': True, 'logado': True, 'usuario': self.logado} if self.logado else ('http', 404))
        app = Flask(__name__)
        carimbos.registra(app, self.tmp)
        equipe.registra_rotas(app, self.tmp, {'desenhista': carimbos.assume_desenhista})
        self.c = app.test_client()

    def tearDown(self):
        equipe._provedor[0] = None
        shutil.rmtree(self.tmp, ignore_errors=True)

    def entra(self, nome, aprovador=False, admin=False):
        self.logado = {'id': 'u-' + nome.lower(), 'login': nome.lower(), 'nome': nome, 'aprovador': aprovador, 'admin': admin}
        return self.logado

    def escreve(self, arq, txt):
        with open(os.path.join(self.pdir, arq), 'w', encoding='utf-8', newline='') as f:
            f.write(txt)
        # mtime diferente mesmo no mesmo instante (o cache da assinatura olha mtime + tamanho)
        st = os.stat(os.path.join(self.pdir, arq))
        os.utime(os.path.join(self.pdir, arq), ns=(st.st_atime_ns, st.st_mtime_ns + 1000))

    def le(self):
        with open(self.sch, encoding='utf-8') as f:
            return f.read()

    def entra_aprovador(self, nome='Lucas', admin=False):
        """1.84.0: o aprovador e quem esta logado no Nexo Hub com a marca de aprovador (nao mais o carimbo)"""
        return self.entra(nome, aprovador=True, admin=admin)['id']

    def test_so_aprovador_aprova(self):
        # Hub antigo (sem login): recusa e diz para atualizar
        r = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        self.assertEqual(r.status_code, 403)
        self.assertIn('2.26.0', r.get_json()['error'])
        # logado sem a marca de aprovador
        self.entra('Luciano')
        r = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        self.assertEqual(r.status_code, 403)
        self.assertIn('Só quem é aprovador no Nexo Hub aprova', r.get_json()['error'])
        self.assertFalse(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])

    def test_aprovador_de_fora_da_equipe_nao_aprova(self):
        equipe.grava(self.pdir, {'responsavel': {'id': 'u-dono', 'login': 'dono', 'nome': 'Dono'}, 'colaboradores': []})
        self.entra_aprovador('Lucas')
        r = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        self.assertEqual((r.status_code, r.get_json()['codigo']), (403, 'sem_permissao'))
        self.entra_aprovador('Chefe', admin=True)          # o admin mexe em tudo sem convite
        j = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertTrue(j['ok'], j)
        self.assertEqual(j['usuario'], {'id': 'u-chefe', 'login': 'chefe', 'nome': 'Chefe'})
        self.assertEqual(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['usuario']['nome'], 'Chefe')
        # a aprovacao entra no historico do projeto, com quem aprovou
        ent = equipe.lista(self.pdir)
        self.assertEqual((ent[0]['tipo'], ent[0]['usuario']['nome']), ('aprovacao', 'Chefe'))

    def test_aprova_preenche_verificador_e_aprovador(self):
        self.entra_aprovador()
        j = self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertTrue(j['ok'], j)
        self.assertTrue(j['aprovado'])
        p = carimbos.params_do_texto(self.le())
        hoje = time.strftime('%d/%m/%y')
        self.assertEqual(p['Aprovador_DiEletrons'], 'Lucas')
        self.assertEqual(p['Verificador_DiEletrons'], 'Lucas')
        self.assertEqual(p['Aprovacao_carimbo'], 'lucas')       # o login no campo de sempre
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

    # ── 1.80.0: a assinatura eletrica (mover no esquema nao derruba; trocar componente ou ligacao derruba) ──
    def esquema_eletrico(self, dx=0, footprint='R0805', sem_fio=False, extra=''):
        it = [{'t': 'sheet', 'name': 'SCH-DI251876', 'size': 'A4', 'template': 'casa:A4_DiEletrons'}]
        for ref, x, y in (('R1', 1000, 1000), ('R2', 1800, 1000), ('R3', 1000, 2000)):
            it.append({'t': 'comp', 'sheet': 'SCH-DI251876', 'ref': ref, 'sym': 'RES [SMD]', 'part': 1, 'x': x + dx, 'y': y,
                       'rot': 0, 'mirror': False, 'footprint': footprint if ref == 'R1' else 'R0805', 'comment': '1k'})
        if not sem_fio:
            it.append({'t': 'wire', 'sheet': 'SCH-DI251876', 'pts': [[1150 + dx, 1000], [1550 + dx, 1000]]})
        it.append({'t': 'wire', 'sheet': 'SCH-DI251876', 'pts': [[1950 + dx, 1000], [1950 + dx, 2000], [1150 + dx, 2000]]})
        it.append({'t': 'netlabel', 'sheet': 'SCH-DI251876', 'net': 'SINAL', 'x': 1350 + dx, 'y': 1000, 'rot': 0})
        it.append({'t': 'text', 'sheet': 'SCH-DI251876', 'x': 100 + dx, 'y': 100, 's': 'nota'})
        cab = ESQUEMA.split('"items":')[0]
        if extra:
            cab = cab.replace('Revisao=REV.A', 'Revisao=REV.A;' + extra)
        return cab + '"items":[\n' + ''.join(json.dumps(x, ensure_ascii=False) + ',\n' for x in it) + ']};\n'

    def test_mover_no_esquema_nao_derruba_trocar_componente_derruba(self):
        self.escreve('schematic.js', self.esquema_eletrico())
        self.entra_aprovador()
        self.assertTrue(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()['ok'])
        aprov = carimbos.params_do_texto(self.le())
        self.assertTrue(aprov['Aprovacao_assinatura'].startswith(carimbos.PREFIXO))
        extra = ';'.join('%s=%s' % (k, aprov[k]) for k in carimbos.CAMPOS_APROVACAO)
        # tudo andou 700 mil (componentes, fios, rotulo, texto): continua aprovado
        self.escreve('schematic.js', self.esquema_eletrico(dx=700, extra=extra))
        self.assertTrue(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])
        # o footprint do R1 trocou: sem aprovacao
        self.escreve('schematic.js', self.esquema_eletrico(dx=700, footprint='R1206', extra=extra))
        self.assertFalse(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])
        # um fio saiu (a ligacao mudou): sem aprovacao
        self.escreve('schematic.js', self.esquema_eletrico(dx=700, sem_fio=True, extra=extra))
        self.assertFalse(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])
        # de volta ao eletrico aprovado, em outro lugar da folha: aprovado de novo; e a PCB que mexe derruba
        self.escreve('schematic.js', self.esquema_eletrico(dx=300, extra=extra))
        self.assertTrue(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])
        self.escreve('board.js', 'var board = {"comps":[{"ref":"R1","x":1}]};\n')
        self.assertFalse(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])

    def test_aprovacao_antiga_vale_pela_pasta_da_revisao(self):
        """aprovada antes da 1.80.0 (assinatura do texto inteiro): mover depois nao derruba, pela copia em Revisoes/REV.A"""
        self.escreve('schematic.js', self.esquema_eletrico())
        velha = carimbos.assinatura_legada(self.pdir)
        extra = ('Verificador_DiEletrons=Lucas;Aprovador_DiEletrons=Lucas;Data_verificacao=01/11/26;Data_aprovacao=01/11/26;'
                 'Aprovacao_carimbo=lucas;Aprovacao_assinatura=' + velha)
        self.escreve('schematic.js', self.esquema_eletrico(extra=extra))
        self.assertTrue(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'])
        rd = os.path.join(self.pdir, 'Revisoes', 'REV.A')
        os.makedirs(rd)
        for n in ('schematic.js', 'changes.js'):
            shutil.copy2(os.path.join(self.pdir, n), os.path.join(rd, n))
        self.escreve('schematic.js', self.esquema_eletrico(dx=500, extra=extra))
        self.assertTrue(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'], 'so mudou o layout')
        self.escreve('schematic.js', self.esquema_eletrico(dx=500, sem_fio=True, extra=extra))
        self.assertFalse(self.c.get('/api/aprovacao?projeto=CBM-DI251876').get_json()['aprovado'], 'a ligacao mudou')

    def test_sem_node_nao_limpa_a_aprovacao(self):
        self.escreve('schematic.js', self.esquema_eletrico())
        self.entra_aprovador()
        self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        antes = self.le()
        velho = carimbos.impressoes_eletricas
        carimbos.impressoes_eletricas = lambda arqs: {a: None for a in arqs}
        try:
            carimbos._cache_hash.clear()
            self.escreve('changes.js', 'var changes = [\n{"op":"move"},\n];\n')
            e = carimbos.confere(self.pdir, agora=1.0)
            e = carimbos.confere(self.pdir, agora=1.0 + carimbos.CARENCIA + 10)
            self.assertFalse(e['conferida'])
            self.assertEqual(self.le(), antes, 'sem conferir, nada sai do carimbo')
        finally:
            carimbos.impressoes_eletricas = velho

    def test_assumir_pelo_login(self):
        """1.84.0: quem esta logado assume o projeto sem responsavel (vira o responsavel e o desenhista), sem senha;
        o admin assume sempre"""
        self.entra('Luciano')
        j = self.c.post('/api/equipe/assumir', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertTrue(j['ok'], j)
        p = carimbos.params_do_texto(self.le())
        self.assertEqual((p['Desenhista_DiEletrons'], p['Desenhista_carimbo']), ('Luciano', 'luciano'))
        self.assertEqual(equipe.le(self.pdir)['responsavel']['nome'], 'Luciano')
        self.entra('Outro')                                     # ja tem responsavel: so o admin troca
        self.assertEqual(self.c.post('/api/equipe/assumir', json={'projeto': 'CBM-DI251876'}).status_code, 403)
        self.entra('Chefe', admin=True)
        self.assertTrue(self.c.post('/api/equipe/assumir', json={'projeto': 'CBM-DI251876'}).get_json()['ok'])
        self.assertEqual(equipe.le(self.pdir)['responsavel']['nome'], 'Chefe')

    def test_assumir_nao_derruba_a_aprovacao(self):
        self.entra_aprovador()
        self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        j = self.c.post('/api/equipe/assumir', json={'projeto': 'CBM-DI251876'}).get_json()
        self.assertTrue(j['ok'], j)
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

    def test_apagar_revisao(self):
        """2026-11-06: apagar uma revisao do historico; a revisao em que o projeto esta aprovado leva a aprovacao junto.
        1.86.0: sem senha mestre -- o administrador do Nexo Hub ou o responsavel pelo projeto, pelo login"""
        self.entra_aprovador()
        self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'})
        self.escreve('schematic.js', self.le().replace('\n]};', '\n{"t":"comp","sheet":"SCH-DI251876","ref":"R9","sym":"RES","x":1,"y":2,"footprint":"0805"},\n]};'))
        self.assertEqual(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()['rev'], 'REV.B')
        url = '/api/revisoes/apagar'
        # o aprovador que nao e admin nem responsavel nao apaga (a senha mestre de antes nao vale nada); projeto sem
        # responsavel: so o admin, e o motivo manda assumir
        r = self.c.post(url, json={'projeto': 'CBM-DI251876', 'rev': 'REV.A', 'mestre': 'LucasGatao', 'password': 'LucasGatao'})
        self.assertEqual((r.status_code, r.get_json()['codigo']), (403, 'sem_permissao'))
        self.assertIn('Assuma o projeto', r.get_json()['error'])
        self.assertIn('apagar revisões', r.get_json()['error'])
        self.assertTrue(os.path.isdir(os.path.join(self.pdir, 'Revisoes', 'REV.A')))
        self.entra_aprovador('Lucas', admin=True)
        # uma revisao antiga: sai do historico e a pasta some; o projeto continua aprovado na REV.B
        j = self.c.post(url, json={'projeto': 'CBM-DI251876', 'rev': 'REV.A'}).get_json()
        self.assertTrue(j['ok'] and j['aprovado'] and not j['aprovacaoTirada'], j)
        self.assertFalse(os.path.isdir(os.path.join(self.pdir, 'Revisoes', 'REV.A')))
        r = self.c.get('/api/revisoes?projeto=CBM-DI251876').get_json()
        self.assertEqual([x['rev'] for x in r['revisoes']], ['REV.B'])
        # o responsavel apaga; quem nao e da equipe (nem com a senha mestre) e o Hub sem login, nao
        self.entra('Dono')
        self.assertTrue(self.c.post('/api/equipe/assumir', json={'projeto': 'CBM-DI251876'}).get_json()['ok'])
        self.entra('Outro')
        r = self.c.post(url, json={'projeto': 'CBM-DI251876', 'rev': 'REV.B', 'mestre': 'LucasGatao'})
        self.assertEqual(r.status_code, 403)
        self.assertIn('Só o administrador ou o responsável (Dono) apaga revisões deste projeto', r.get_json()['error'])
        self.logado = None                                      # Hub antigo, sem login: ninguem apaga
        r = self.c.post(url, json={'projeto': 'CBM-DI251876', 'rev': 'REV.B', 'mestre': 'LucasGatao'})
        self.assertEqual((r.status_code, r.get_json()['codigo']), (403, 'sem_permissao'))
        self.assertIn('Atualize o Nexo Hub', r.get_json()['error'])
        self.assertTrue(os.path.isdir(os.path.join(self.pdir, 'Revisoes', 'REV.B')))
        # a revisao de agora, pelo responsavel: a aprovacao sai do carimbo da folha
        self.entra('Dono')
        j = self.c.post(url, json={'projeto': 'CBM-DI251876', 'rev': 'REV.B'}).get_json()
        self.assertTrue(j['ok'] and j['aprovacaoTirada'] and not j['aprovado'], j)
        self.assertNotIn('Aprovador_DiEletrons', carimbos.params_do_texto(self.le()))
        self.assertEqual(self.c.get('/api/revisoes?projeto=CBM-DI251876').get_json()['revisoes'], [])
        self.assertEqual(self.c.post(url, json={'projeto': 'CBM-DI251876', 'rev': 'REV.Z'}).status_code, 404)
        # aprovar de novo (o responsavel, aprovador) grava a letra do carimbo da folha
        self.entra_aprovador('Dono')
        self.assertEqual(self.c.post('/api/aprovacao', json={'projeto': 'CBM-DI251876'}).get_json()['rev'], 'REV.B')

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
