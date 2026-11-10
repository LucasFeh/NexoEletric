# -*- coding: utf-8 -*-
"""O LINK DA BOM pela placa e por variante (1.89.4).

Pedido do dono: "no BOM, o nome que vem no link ainda nao ta pegando o nome atual da placa" e "precisa ser um link
diferente pra cada variante de projeto". O link era /bom/<slug da pasta> (ex. dmb-di231765-p2) e o titulo, o nome da
pasta. Agora o link e o do codigo da placa (cabecalho do schematic.js, lido na hora), cada variante tem o seu
(/bom/<placa>-<variante>, com os suprimidos fora), e o slug da pasta continua abrindo a padrao.

    python tests/test_bomlink_placa.py
"""
import io
import json
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import hubserver as H  # noqa: E402

# ── a regra pura, com os mesmos casos do electron/lib/bom-alvos.js ──
with io.open(os.path.join(RAIZ, 'tests', 'bom-alvos-casos.json'), encoding='utf-8') as f:
    CASOS = json.load(f)['casos']
for c in CASOS:
    got = H.bom_alvos(c['pasta'], c['params'], c['variantes'])
    assert got == c['esperado'], (c['pasta'], json.dumps(got, ensure_ascii=False, indent=1))
assert H._bom_slug('Versão 2') == 'versao-2'
assert H._proj_id('Versão 2') == 'vers-o-2', 'o slug da pasta fica como era (o dos links antigos)'

# ── o servidor, numa pasta de trabalho temporaria ──
PASTA = 'DMB - DI231765_P2'


def esquema(codigo, nome):
    cab = 'CodigoDaPlaca=%s;NomeDaPlaca=%s;CodigoDoEquipamento=DMB-DI231765;NomeDoEquipamento=DMB' % (codigo, nome)
    itens = [{'t': 'sheet', 'name': 'S1', 'size': 'A4'}] + [
        {'t': 'comp', 'sheet': 'S1', 'ref': r, 'sym': 'RES', 'part': 1, 'x': 1000 * i, 'y': 1000, 'rot': 0,
         'footprint': 'R0805', 'comment': '10k'} for i, r in enumerate(('R1', 'R2', 'U3'), 1)]
    return 'var schematic = ' + json.dumps({'format': 'schmirror-v2', 'project': PASTA, 'units': 'mil', 'params': cab,
                                            'items': itens}, ensure_ascii=False) + ';\n'


BOARD = {'board': {'bbox': {'x1': 0, 'y1': 0, 'x2': 20, 'y2': 20}}, 'components': [
    {'ref': r, 'comment': '10k', 'footprint': 'R0805', 'layer': 'Top', 'x': 1, 'y': 1, 'rot': 0, 'pads': []}
    for r in ('R1', 'R2', 'U3')]}

tmp = tempfile.mkdtemp(prefix='bomlink-')
d = os.path.join(tmp, 'Projects', PASTA)
os.makedirs(d)


def grava(nome, txt):
    with io.open(os.path.join(d, nome), 'w', encoding='utf-8', newline='\n') as f:
        f.write(txt)


grava('board.js', 'var pcbmirror = ' + json.dumps(BOARD) + ';\n')
grava('schematic.js', esquema('PMD-DI261946', 'PLACA MAE DMB'))
grava('variantes.json', json.dumps({'formato': 'nexoeletric-variantes-1', 'variantes': [
    {'id': 'v1a2b3c4', 'nome': 'Sem display', 'codigo': 'DMBSD-DI261950', 'suprimidos': [{'ref': 'U3'}]}]}))
real_root, H.ROOT = H.ROOT, tmp
cli = H.app.test_client()
antigo = H._proj_id(PASTA)
try:
    assert antigo == 'dmb-di231765-p2'
    # o link do painel (pedido com o id da pasta, como o hub faz) e o da PLACA, com o nome atual no titulo
    j = cli.get('/api/bom/%s/link' % antigo).get_json()
    assert j['ok'] and j['url'].endswith('/bom/pmd-di261946'), j
    assert j['nome'] == 'PMD-DI261946 · PLACA MAE DMB', j['nome']
    assert [(x['id'], x['ativa']) for x in j['links']] == [('pmd-di261946', True), ('pmd-di261946-sem-display', False)]
    assert j['links'][0]['apelidos'] == [antigo]

    # a fonte pelo id do link: o titulo e o id vem junto; a da variante sem o suprimido
    s = cli.get('/api/bom/pmd-di261946/source').get_json()
    assert s['ok'] and s['projeto'] == 'PMD-DI261946 · PLACA MAE DMB' and s['bomId'] == 'pmd-di261946', s.get('projeto')
    assert sorted(c['ref'] for c in s['board']['components']) == ['R1', 'R2', 'U3']
    sv = cli.get('/api/bom/pmd-di261946-sem-display/source').get_json()
    assert sv['ok'] and sv['projeto'] == 'PMD-DI261946 SEM DISPLAY' and sv['variante']['id'] == 'v1a2b3c4'
    assert sorted(c['ref'] for c in sv['board']['components']) == ['R1', 'R2'], 'o suprimido fica fora da BOM da variante'
    # o armazem pede pela pasta com ?variante= ('' = a padrao)
    assert cli.get('/api/bom/%s/source?variante=v1a2b3c4' % antigo).get_json()['bomId'] == 'pmd-di261946-sem-display'
    assert cli.get('/api/bom/%s/source?variante=' % antigo).get_json()['bomId'] == 'pmd-di261946'
    assert cli.get('/api/bom/%s/source?variante=v9999999' % antigo).status_code == 404

    # a pagina: o link antigo (pela pasta) leva a padrao pela placa; a pagina tem o nome atual e a variante certa
    r = cli.get('/bom/' + antigo)
    assert r.status_code == 302 and r.headers['Location'].endswith('/bom/pmd-di261946'), (r.status_code, r.headers)
    pag = cli.get('/bom/pmd-di261946-sem-display').get_data(as_text=True)
    assert 'BOM — PMD-DI261946 SEM DISPLAY' in pag and '?variante=v1a2b3c4' in pag and 'res[0].projeto' in pag
    assert cli.get('/bom/pmd-di261946').status_code == 200
    assert cli.get('/api/bom/pmd-di261946/vistos').get_json()['ok'], 'os vistos pelo id do link'

    # com a variante ativa nesta maquina, o link do painel e o dela
    grava('.variante-ativa.json', json.dumps({'id': 'v1a2b3c4'}))
    j = cli.get('/api/bom/%s/link' % antigo).get_json()
    assert j['url'].endswith('/bom/pmd-di261946-sem-display') and j['nome'] == 'PMD-DI261946 SEM DISPLAY', j
    assert cli.get('/api/bom/%s/source' % antigo).get_json()['bomId'] == 'pmd-di261946-sem-display', 'o painel: a ativa'
    os.remove(os.path.join(d, '.variante-ativa.json'))

    # o Definir projeto troca a placa: o link e o titulo acompanham na hora (sem reiniciar nada)
    import time
    time.sleep(0.02)
    grava('schematic.js', esquema('PMD-DI261999', 'PLACA MAE DMB REV B'))
    j = cli.get('/api/bom/%s/link' % antigo).get_json()
    assert j['url'].endswith('/bom/pmd-di261999') and j['nome'] == 'PMD-DI261999 · PLACA MAE DMB REV B', j
    assert cli.get('/api/bom/pmd-di261999/source').get_json()['projeto'] == 'PMD-DI261999 · PLACA MAE DMB REV B'

    # no app desktop o link e o do NexoBD, pelo id da placa (e o /bom/ local redireciona para la)
    real = (H._bom_no_nexobd, H._bom_base_nexobd)
    H._bom_no_nexobd = lambda: True
    H._bom_base_nexobd = lambda: ('http://192.168.15.83:47810', None)
    try:
        j = cli.get('/api/bom/%s/link?verificar=0' % antigo).get_json()
        assert j['url'] == 'http://192.168.15.83:47810/bom/pmd-di261999', j
        assert j['links'][1]['url'] == 'http://192.168.15.83:47810/bom/pmd-di261999-sem-display'
        r = cli.get('/bom/' + antigo)
        assert r.status_code == 302 and r.headers['Location'] == 'http://192.168.15.83:47810/bom/pmd-di261999'
    finally:
        H._bom_no_nexobd, H._bom_base_nexobd = real
finally:
    H.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)
print('ok - o link da BOM pela placa e por variante')
