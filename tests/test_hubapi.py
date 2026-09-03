# Teste das funcoes puras do hubserver (rodar da raiz: python tests/test_hubapi.py)
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
    r = cli.post('/api/project/zz-teste/delete', json={'password': H.MASTER_PASSWORD})
    assert r.status_code == 200, 'senha certa passa'
    assert not os.path.exists(alvo), 'saiu de Projects'
    lixo = os.path.join(tmp, r.get_json()['trash'])
    assert os.path.isfile(os.path.join(lixo, 'board.js')), 'a pasta inteira foi para o Trash'
    assert not any(p['id'] == 'zz-teste' for p in H.build_index(tmp)['projects']), 'sumiu do indice'
    assert cli.post('/api/project/zz-teste/delete',
                    json={'password': H.MASTER_PASSWORD}).status_code == 404
finally:
    H.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)
    H.build_index(real_root)

# Seletor de pasta: a rota inteira sem UI, trocando _pergunta_pasta. Cobre o normpath
# (o Tcl devolve barra normal), o cancelamento e o lock de uma janela por vez.
cli = H.app.test_client()          # test_client chega como 127.0.0.1, entao passa no _is_local
escolhido = []
H._pergunta_pasta = lambda inicial: (escolhido.append(inicial), 'C:/Users/Lucas/Desktop')[1]
r = cli.post('/api/pick-dir')
assert r.status_code == 200, 'escolha vale'
assert r.get_json()['dir'] == os.path.normpath('C:/Users/Lucas/Desktop'), 'caminho normalizado'
assert not r.get_json().get('cancelado')

H._pergunta_pasta = lambda inicial: ''
r = cli.post('/api/pick-dir')
assert r.status_code == 200 and r.get_json()['cancelado'] is True, 'cancelar nao e erro'
assert r.get_json()['dir'] == '', 'cancelar nao devolve caminho (senao apagaria a pasta)'

H._pick_lock.acquire()
try:
    r = cli.post('/api/pick-dir')
    assert r.status_code == 409, 'segunda janela e recusada'
finally:
    H._pick_lock.release()
r = cli.post('/api/pick-dir')
assert r.status_code == 200, 'e o lock volta a liberar'

print('test_hubapi OK')
