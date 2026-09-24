# O ALMOX.DbLib aponta o SQLite por caminho absoluto. No servidor e o share; no app desktop
# (electron/) e a pasta de trabalho local, via ALTIUMHUB_DBLIB_DIR. Sem a variavel nada muda.
# Rodar da raiz: python tests/test_dblib_dir.py
import importlib
import io
import os
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))


def carrega(valor):
    if valor is None:
        os.environ.pop('ALTIUMHUB_DBLIB_DIR', None)
    else:
        os.environ['ALTIUMHUB_DBLIB_DIR'] = valor
    import dblib
    return importlib.reload(dblib)


d = carrega(None)
assert d.UNC == r'\\192.168.15.192\altiumhub\current\Libs\Almox', 'sem a variavel o padrao e o share'

local = r'C:\Users\alguem\AltiumHub\Libs\Almox'
d = carrega(local)
assert d.UNC == local, 'a variavel troca o caminho'

tmp = tempfile.mkdtemp()
try:
    arq = os.path.join(tmp, 'ALMOX.DbLib')
    d.grava_dblib(arq, d.UNC + r'\almox.sqlite')
    txt = io.open(arq, encoding='utf-8').read()
    assert 'Database=%s\\almox.sqlite;' % local in txt, 'o DbLib aponta o SQLite local'
    assert '192.168.15.192' not in txt, 'nada do share sobrou no DbLib local'
finally:
    carrega(None)
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)

d = carrega('')
assert d.UNC.startswith('\\\\192.168.15.192'), 'variavel vazia vale como ausente'

print('test_dblib_dir OK')
