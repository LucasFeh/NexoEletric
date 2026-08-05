# Teste das funcoes puras do hubserver (rodar da raiz: python tests/test_hubapi.py)
import os
import sys

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

print('test_hubapi OK')
