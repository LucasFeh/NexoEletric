# Teste das funcoes puras do hubserver (rodar da raiz: python tests/test_hubapi.py)
import io
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import hubserver as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

board = H.load_var_file(os.path.join(ROOT, 'Projects', '_DemoKit', 'board.js'))
assert isinstance(board, dict) and board.get('components'), 'board.js parseia'

idx = H.build_index(ROOT)
assert idx['projects'], 'indice tem projetos'
demo = next(p for p in idx['projects'] if p['name'] == '_DemoKit')
assert demo['demo'] is True and demo['noSchematic'] is False
assert len(demo['stages']) == 4 and demo['stats']['comps'] > 0
assert sum(1 for v in demo['stages'] if v == 2) <= 1, 'no maximo uma etapa atual'

det = H.build_detail(ROOT, demo['id'])
assert det and det['components'], 'detalhe tem componentes'
c = det['components'][0]
for k in ('des', 'value', 'footprint', 'pins', 'layer', 'pos', 'rot', 'nets'):
    assert k in c, 'campo ' + k
assert det['board'].get('components'), 'board embutido'
assert H.build_detail(ROOT, 'nao-existe') is None

# /__live.js: UMA conexao SSE por janela. Os iframes das vistas se registram e a janela de
# cima repassa o aviso; cada EventSource a mais prende uma das 6 conexoes por host do
# Chromium, e com elas esgotadas o hub para de carregar qualquer coisa.
live = H.app.test_client().get('/__live.js').get_data(as_text=True)
assert live.count("new EventSource('/__events')") == 1, 'um EventSource so'
assert '__hubLiveFilho' in live and 'window.top.__hubLive' in live, 'iframe se registra na janela de cima'
assert live.index('__hubLiveFilho = true; return;') < live.index('new EventSource'), \
    'o iframe registrado nao pode abrir a propria conexao'
assert '__hubOnChange' in live, 'quem tem trabalho nao salvo continua decidindo o proprio reload'

# --host 127.0.0.1 (app desktop): so o Host: de loopback passa. Um dominio que resolve para
# 127.0.0.1 (DNS rebinding) nao pode ler o hub-almox.json nem falar com o chat.
try:
    assert H.configura_escuta('127.0.0.1') is False
    cli = H.app.test_client()
    for host in ('127.0.0.1:8200', 'localhost:8200', '[::1]:8200'):
        assert cli.get('/__live.js', headers={'Host': host}).status_code == 200, host
    for host in ('evil.example.com:8200', 'evil.example.com'):
        assert cli.get('/__live.js', headers={'Host': host}).status_code == 400, host
        assert cli.get('/hub-almox.json', headers={'Host': host}).status_code == 400, host
finally:
    assert H.configura_escuta('0.0.0.0') is True, 'o padrao volta a ser a rede toda'
assert H.app.test_client().get('/__live.js', headers={'Host': 'hub.lan:8100'}).status_code == 200, \
    'escutando na rede, qualquer nome serve (o tablet chega pelo IP ou pelo nome da maquina)'

# A folha do tema e o script dele saem com o tipo certo: o Chrome recusa folha de estilo que nao
# venha como text/css, e sem ela o hub e as vistas abrem sem cor nenhuma. O hubserver fixa os
# dois tipos no import, por cima do que o registro do Windows disser.
_css = H.app.test_client().get('/hub-tema.css')
assert _css.status_code == 200 and _css.mimetype == 'text/css', _css.mimetype
assert H.app.test_client().get('/hub-tema.js').mimetype in ('text/javascript', 'application/javascript')

# hub-almox.json (login e senha do Odoo) nao sai por HTTP para ninguem, nem pelos apelidos
# que o Windows aceita para o mesmo arquivo. Os outros arquivos da raiz continuam servidos.
tmp = tempfile.mkdtemp()
real_root, H.ROOT = H.ROOT, tmp
try:
    with io.open(os.path.join(tmp, 'hub-almox.json'), 'w', encoding='utf-8') as fh:
        fh.write('{"url":"http://x","login":"a","senha":"SEGREDO"}')
    with io.open(os.path.join(tmp, 'hub-almox.json.tmp'), 'w', encoding='utf-8') as fh:
        fh.write('{"senha":"SEGREDO"}')
    with io.open(os.path.join(tmp, 'hub.html'), 'w', encoding='utf-8') as fh:
        fh.write('<html><body>ok</body></html>')
    cli = H.app.test_client()
    lan = {'Host': '192.168.15.50:8100'}
    caminhos = ['/hub-almox.json', '/hub-almox.json.tmp', '/./hub-almox.json', '/Libs/../hub-almox.json']
    if os.name == 'nt':
        caminhos += ['/HUB-ALMOX.JSON', '/hub-almox.json.', '/hub-almox.json%20', '/hub-almox.json::$DATA']
    for u in caminhos:
        r = cli.get(u, headers=lan)
        assert r.status_code == 404 and b'SEGREDO' not in r.data, (u, r.status_code)
    assert cli.get('/hub.html', headers=lan).status_code == 200, 'o resto da raiz continua servido'
finally:
    H.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)

# Exclusao de projeto: senha errada nao pode encostar na pasta, e senha certa MOVE
# (nao apaga). Roda num workspace de mentira - ROOT e lido em tempo de chamada.
tmp = tempfile.mkdtemp()
alvo = os.path.join(tmp, 'Projects', 'ZZ_Teste')
os.makedirs(alvo)
with open(os.path.join(alvo, 'board.js'), 'w', encoding='utf-8') as f:
    f.write('var board = {"components":[],"nets":[],"tracks":[],"vias":[]};')
real_root, H.ROOT = H.ROOT, tmp
try:
    H.build_index(tmp)
    cli = H.app.test_client()
    r = cli.post('/api/project/zz-teste/delete', json={'password': 'nao e essa'})
    assert r.status_code == 403, 'senha errada barra'
    assert os.path.isdir(alvo), 'senha errada nao move nada'
    r = cli.post('/api/project/zz-teste/delete', json={})
    assert r.status_code == 403, 'sem senha barra'
    assert os.path.isdir(alvo), 'sem senha nao move nada'
    nota = os.path.join(tmp, '.altiumhub', 'nexobd-apagar.json')
    os.environ['ALTIUMHUB_NEXOBD'] = '1'    # app desktop com o NexoBD: anota para o armazem apagar la
    try:
        r = cli.post('/api/project/zz-teste/delete', json={'password': H.MASTER_PASSWORD})
    finally:
        del os.environ['ALTIUMHUB_NEXOBD']
    assert r.status_code == 200, 'senha certa passa'
    assert not os.path.exists(alvo), 'saiu de Projects'
    with open(nota, encoding='utf-8') as f:
        assert json.load(f) == ['ZZ_Teste'], 'o nome da pasta fica anotado para apagar no NexoBD'
    lixo = os.path.join(tmp, r.get_json()['trash'])
    assert os.path.isfile(os.path.join(lixo, 'board.js')), 'a pasta inteira foi para o Trash'
    assert not any(p['id'] == 'zz-teste' for p in H.build_index(tmp)['projects']), 'sumiu do indice'
    assert cli.post('/api/project/zz-teste/delete',
                    json={'password': H.MASTER_PASSWORD}).status_code == 404
finally:
    H.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)
    H.build_index(real_root)

# BOM por link: /bom/<id> monta a pagina na hora, e o estado da bancada e compartilhado.
# Roda contra o _DemoKit, que esta no repositorio, e limpa os arquivos de estado no fim.
cli = H.app.test_client()          # test_client chega como 127.0.0.1, entao passa no _is_local
pid = H._proj_id('_DemoKit')
assert os.path.basename(H._proj_dir_by_id(pid)) == '_DemoKit', 'o slug volta para a pasta'
assert H._proj_dir_by_id('nao-existe') is None, 'id que nao existe nao pode virar pasta'

dbom = H._proj_dir_by_id(pid)
try:
    r = cli.get('/bom/' + pid)
    assert r.status_code == 200, '/bom/<id> tem que ganhar da rota /<path:path>'
    pag = r.get_data(as_text=True)
    # A pagina NAO e um BOM gravado: e um bootstrap que carrega o gerador ATUAL e monta na
    # hora. E por isso que mexer no hub-bom.js muda o BOM de todos os projetos de uma vez.
    assert '/hub-bom.js' in pag, 'o bootstrap nao carrega o gerador'
    # A ORDEM dos <script> importa e nao e cosmetica: no browser o hub-bom.js le
    # root.HubFont e root.HubLaser, e fora do CommonJS ninguem resolve isso sozinho. Com a
    # ordem errada a pagina abre morta, com "reading 'padPrim'" no console.
    assert pag.index('/hub-font.js') < pag.index('/hub-laser.js') < pag.index('/hub-bom.js'),         'as dependencias do gerador precisam vir antes dele, nesta ordem'
    assert '/source' in pag, 'o bootstrap nao busca a fonte conjunta do BOM'
    assert '/api/bom/' + pid in pag, 'o bootstrap nao sabe com quem falar'
    assert 'HubBom.gerar' in pag, 'o bootstrap nao monta a pagina'
    assert cli.get('/bom/nao-existe').status_code == 404
    assert cli.get('/api/bom/nao-existe/source').status_code == 404

    # O link tem que servir para OUTRA maquina: quem abre o hub em 127.0.0.1 copiaria um
    # endereco que so funciona no proprio PC, e o ponto do link e abrir no tablet.
    j = cli.get('/api/bom/%s/link' % pid).get_json()
    assert j['ok'] and j['url'].endswith('/bom/' + pid)
    ip = H._lan_ip()
    if ip:
        assert ip in j['url'] and j['trocado'], 'localhost tinha de virar o IP da rede'
    assert cli.get('/api/bom/nao-existe/link').status_code == 404
    # Escutando so em 127.0.0.1 (--host 127.0.0.1, o app desktop sem "compartilhar na rede"),
    # o IP da rede seria um link MORTO: nada responde nele. Fica o de loopback.
    real_rede, H._ESCUTA_REDE = H._ESCUTA_REDE, False
    try:
        j = cli.get('/api/bom/%s/link' % pid).get_json()
        assert j['ok'] and not j['trocado'] and not j['lan'], j
        assert '://localhost' in j['url'] or '://127.0.0.1' in j['url'], j['url']
    finally:
        H._ESCUTA_REDE = real_rede

    # Vistos: o corpo e um DELTA, nao o mapa inteiro. Dois tablets marcando pecas
    # diferentes ao mesmo tempo se somam, em vez de o ultimo apagar o trabalho do outro.
    assert cli.get('/api/bom/%s/vistos' % pid).get_json()['vistos'] == {}
    a = cli.post('/api/bom/%s/vistos' % pid, json={'set': {'R1|10k': True}}).get_json()
    b = cli.post('/api/bom/%s/vistos' % pid, json={'set': {'C2|100n': True}}).get_json()
    assert b['vistos'] == {'R1|10k': True, 'C2|100n': True}, 'o segundo apagou o primeiro'
    assert b['rev'] != a['rev'], 'o rev nao mudou - a outra maquina nao notaria'
    # desmarcar APAGA a entrada em vez de gravar False: o arquivo guarda o que foi feito
    assert cli.post('/api/bom/%s/vistos' % pid,
                    json={'set': {'R1|10k': False}}).get_json()['vistos'] == {'C2|100n': True}
    assert cli.post('/api/bom/%s/vistos' % pid, json={'clear': True}).get_json()['vistos'] == {}
    assert cli.post('/api/bom/%s/vistos' % pid, json={'set': {'x' * 400: True}}).status_code == 400
    assert cli.post('/api/bom/%s/vistos' % pid, json={'set': 5}).status_code == 400
    assert cli.post('/api/bom/%s/vistos' % pid, json=[]).status_code == 400
    assert cli.post('/api/bom/nao-existe/vistos', json={'set': {}}).status_code == 404
    # estado ilegivel vira estado vazio: um arquivo corrompido nao pode derrubar a pagina
    # que serve justamente para montar a placa
    with io.open(os.path.join(dbom, H.BOM_VISTOS), 'w', encoding='utf-8') as f:
        f.write('nao e json')
    assert cli.get('/api/bom/%s/vistos' % pid).get_json()['vistos'] == {}

    # Opcoes: o link abre do jeito que quem gerou escolheu
    assert cli.get('/api/bom/%s/opts' % pid).get_json()['opts'] is None
    assert cli.post('/api/bom/%s/opts' % pid, json={'opts': {'dark': False}}).status_code == 200
    assert cli.get('/api/bom/%s/opts' % pid).get_json()['opts'] == {'dark': False}
    assert cli.post('/api/bom/%s/opts' % pid, json={'opts': 'nao'}).status_code == 400

    # No app desktop (1.31.0) a BOM de REFERENCIA e a do NexoBD: o link copiado e o dele (pelo Nexo Hub),
    # conferido la; sem o Hub, nao ha link (aviso). Um NexoBD de mentira faz o papel; o Hub, um monkeypatch.
    import http.server
    import threading as _th
    visto = {'head': []}

    class Ref(http.server.BaseHTTPRequestHandler):
        def do_HEAD(self):
            visto['head'].append(self.path)
            self.send_response(200 if self.path == '/bom/' + pid else 404)
            self.end_headers()

        def do_GET(self):
            self.do_HEAD()

        def log_message(self, *a):
            pass

    ref = http.server.HTTPServer(('127.0.0.1', 0), Ref)
    _th.Thread(target=ref.serve_forever, daemon=True).start()
    base_nexobd = 'http://127.0.0.1:%d' % ref.server_port
    antes = (H._bom_no_nexobd, H._bom_base_nexobd, H.BOM_NEXOBD_ESPERA)
    try:
        H._bom_no_nexobd = lambda: True
        H._bom_base_nexobd = lambda: (base_nexobd, None)
        H.BOM_NEXOBD_ESPERA = 1.5
        j = cli.get('/api/bom/%s/link' % pid).get_json()
        assert j['ok'] and j['externo'] and j['nexobd'] and j['url'] == base_nexobd + '/bom/' + pid, j
        assert 'aviso' not in j, 'a BOM esta no NexoBD: sem aviso'
        n = len(visto['head'])
        j = cli.get('/api/bom/%s/link?verificar=0' % pid).get_json()
        assert j['url'].startswith(base_nexobd) and len(visto['head']) == n, 'rodape e "abrir" nao esperam a rede'
        # a pagina local leva para a do NexoBD; os vistos nao se gravam mais aqui
        rr = cli.get('/bom/%s' % pid)
        assert rr.status_code == 302 and rr.headers['Location'] == base_nexobd + '/bom/' + pid, rr.status_code
        rr = cli.post('/api/bom/%s/vistos' % pid, json={'set': {'R1|10k': True}})
        assert rr.status_code == 409 and rr.get_json()['nexobd'], rr.status_code
        # as opcoes do "Copiar link" continuam no projeto (o armazem as leva ao NexoBD)
        assert cli.post('/api/bom/%s/opts' % pid, json={'opts': {'dark': True}}).status_code == 200
        # o NexoBD ainda nao tem a BOM: espera um pouco (o armazem esta subindo) e avisa
        Ref.do_HEAD = lambda self: (self.send_response(404), self.end_headers())
        j = cli.get('/api/bom/%s/link' % pid).get_json()
        assert j['url'].startswith(base_nexobd) and 'ainda não chegou ao NexoBD' in j['aviso'], j
        # NexoBD fora da rede
        H._bom_base_nexobd = lambda: ('http://127.0.0.1:1', None)
        j = cli.get('/api/bom/%s/link' % pid).get_json()
        assert 'não respondeu' in j['aviso'], j
        # sem o Nexo Hub: nada de link (o painel avisa), nem do servidor central
        H._bom_base_nexobd = lambda: (None, H.nexohub_gate.MSG)
        rr = cli.get('/api/bom/%s/link' % pid)
        j = rr.get_json()
        assert rr.status_code == 503 and not j['ok'] and j['nexobd'] and 'Nexo Hub' in j['error'], j
        assert '192.168.15.192' not in json.dumps(j)
        rr = cli.get('/bom/%s' % pid)
        assert rr.status_code == 503 and 'Nexo Hub' in rr.get_data(as_text=True)
    finally:
        H._bom_no_nexobd, H._bom_base_nexobd, H.BOM_NEXOBD_ESPERA = antes
        ref.shutdown()
    assert 'externo' not in cli.get('/api/bom/%s/link' % pid).get_json(), 'fora do app desktop, o de sempre'
    assert not hasattr(H, 'BOM_LINK_BASE'), 'o link do servidor central saiu (1.31.0)'

    # _bom_base_nexobd: o que o Hub diz (saude) -> o endereco da rede
    import nexohub_gate as G
    import urllib.request as _ur

    class _Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def saude(j):
        return lambda req, timeout=0: _Resp(json.dumps(j).encode('utf-8'))
    real_open = _ur.urlopen
    try:
        _ur.urlopen = saude({'ok': True, 'bd': {'ok': True, 'url': 'http://127.0.0.1:47810', 'versao': '1.9.0'},
                             'rede': {'bom': True, 'url': 'http://192.168.15.213:47810'}})
        assert H._bom_base_nexobd() == ('http://192.168.15.213:47810', None)
        _ur.urlopen = saude({'ok': True, 'bd': {'ok': True, 'url': 'http://192.168.15.190:47810', 'versao': '1.9.0'},
                             'rede': {'bom': True, 'url': 'http://172.17.0.2:47810'}})
        assert H._bom_base_nexobd() == ('http://192.168.15.190:47810', None), 'NexoBD de outra maquina: o endereco do Hub'
        _ur.urlopen = saude({'ok': True, 'bd': {'ok': True, 'url': 'http://127.0.0.1:47810', 'versao': '1.5.0'}})
        b, e = H._bom_base_nexobd()
        assert b is None and '1.9.0' in e, e
        _ur.urlopen = saude({'ok': False, 'bd': {'ok': False}})
        assert H._bom_base_nexobd() == (None, G.MSG)
    finally:
        _ur.urlopen = real_open

    # O estado da bancada NAO pode entrar no watcher: ele muda a cada visto marcado, e o
    # SSE recarregaria todas as paginas abertas - no meio da montagem, que e quando
    # ninguem pode perder a tela de vista.
    assert not [k for k in H._snapshot() if os.path.basename(k) in H.BOM_STATE_FILES], \
        'visto marcado dispararia reload na pagina de quem esta montando'
finally:
    for f in H.BOM_STATE_FILES:
        try:
            os.remove(os.path.join(dbom, f))
        except OSError:
            pass

# O BOM acompanha comment/footprint do esquema sem esperar novo ExportBoard. Se a PCB
# for exportada depois, o espelho novo dela prevalece. A revisao muda nos dois casos.
tmp = tempfile.mkdtemp()
try:
    pasta = os.path.join(tmp, 'Projects', 'Placa BOM')
    os.makedirs(pasta)
    bp, sp = os.path.join(pasta, 'board.js'), os.path.join(pasta, 'schematic.js')
    with io.open(bp, 'w', encoding='utf-8') as f:
        f.write('var pcbmirror = ' + json.dumps({'components': [
            {'ref': 'R1', 'comment': '15k', 'footprint': '0603', 'layer': 'Top'}]}) + ';')
    with io.open(sp, 'w', encoding='utf-8') as f:
        f.write('var schematic = ' + json.dumps({'items': [
            {'t': 'comp', 'ref': 'R1', 'comment': '16k', 'footprint': '0805'}]}) + ';')
    os.utime(bp, ns=(1000000000, 1000000000))
    os.utime(sp, ns=(2000000000, 2000000000))
    antigo = H.ROOT
    H.ROOT = tmp
    try:
        cli = H.app.test_client()
        fonte = cli.get('/api/bom/placa-bom/source').get_json()
        assert fonte['board']['components'][0]['comment'] == '16k'
        assert fonte['board']['components'][0]['footprint'] == '0805'
        assert cli.get('/api/bom/placa-bom/vistos').get_json()['sourceRev'] == fonte['sourceRev']
        rev = fonte['sourceRev']
        os.utime(bp, ns=(3000000000, 3000000000))
        fonte = cli.get('/api/bom/placa-bom/source').get_json()
        assert fonte['board']['components'][0]['comment'] == '15k', 'ExportBoard novo prevalece'
        assert fonte['sourceRev'] != rev, 'mudanca da PCB nao disparou atualizacao'
        rev = fonte['sourceRev']
        os.utime(sp, ns=(4000000000, 4000000000))
        assert cli.get('/api/bom/placa-bom/vistos').get_json()['sourceRev'] != rev, \
            'mudanca do esquema nao disparou atualizacao'
        # footprint VAZIO no esquema (o hub grava assim o componente sem footprint conhecido)
        # e "defina no Altium", nao "sem footprint": o da placa fica; o comment segue o esquema
        with io.open(sp, 'w', encoding='utf-8') as f:
            f.write('var schematic = ' + json.dumps({'items': [
                {'t': 'comp', 'ref': 'R1', 'comment': '18k', 'footprint': ''}]}) + ';')
        os.utime(sp, ns=(5000000000, 5000000000))
        fonte = cli.get('/api/bom/placa-bom/source').get_json()
        assert fonte['board']['components'][0]['footprint'] == '0603', \
            'footprint vazio do esquema apagou o da placa'
        assert fonte['board']['components'][0]['comment'] == '18k'
    finally:
        H.ROOT = antigo
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# Credencial do almoxarifado: campo em branco no formulario significa "nao mexe", nunca
# "apaga". Valia so para a senha. Passou a valer para os quatro quando a url saiu do
# PADRAO do odoo_pull: gravar "" por cima de uma url valida deixou de ser inocente, porque
# nao existe mais servidor para onde cair caladamente — some a configuracao e o proximo
# sincronismo para. Roda num ROOT de mentira: este teste GRAVA hub-almox.json.
tmp = tempfile.mkdtemp()
real_root, H.ROOT = H.ROOT, tmp
try:
    cli = H.app.test_client()
    cheio = {'url': 'http://alvo:8070', 'db': 'base', 'login': 'a@b.c', 'senha': 'x'}
    assert cli.post('/api/almox/config', json=cheio).status_code == 200, 'gravou a config'
    for k in ('url', 'db', 'login', 'senha'):
        for branco in ('', '   ', '\t'):
            assert cli.post('/api/almox/config', json={k: branco}).status_code == 200
    with io.open(os.path.join(tmp, H.ALMOX_CFG_FILE), encoding='utf-8') as fh:
        depois = json.load(fh)
    assert depois == cheio, 'campo em branco apagou configuracao: %r' % (depois,)

    # o que NAO esta em branco continua gravando, senao o guard viraria so-leitura
    assert cli.post('/api/almox/config', json={'url': 'http://outro:8070'}).status_code == 200
    with io.open(os.path.join(tmp, H.ALMOX_CFG_FILE), encoding='utf-8') as fh:
        assert json.load(fh)['url'] == 'http://outro:8070', 'valor de verdade tem que gravar'

    # e a senha nunca volta pela rede, so o booleano
    corpo = cli.get('/api/almox/config').get_json()
    assert 'senha' not in corpo['config'], 'a senha vazou pelo GET'
    assert corpo['config']['temSenha'] is True
finally:
    H.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)

print('test_hubapi OK')
