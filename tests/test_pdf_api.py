# -*- coding: utf-8 -*-
"""POST /api/pdf: o PDF de layout da vista PCB vai para Projects/<proj>/PDF/<nome>.pdf.

    python3 tests/test_pdf_api.py

Como o test_gerber_api.py, roda num workspace de mentira (H.ROOT trocado por um tempdir). Confere
ainda que o /api/save passou a aceitar o rules.js do projeto e o sch-templates-casa.js da Libs/.
"""
import base64
import io
import os
import shutil
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, ValueError):
    pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import hubserver as H  # noqa: E402


def escreve(caminho, texto):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with io.open(caminho, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)


PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'


def b64(b):
    return base64.b64encode(b).decode('ascii')


tmp = tempfile.mkdtemp(prefix='pdf-api-')
real_root, H.ROOT = H.ROOT, tmp
try:
    PROJ = 'PTESTE - DI000000_P1 (rev 2)'
    pdir = os.path.join(tmp, 'Projects', PROJ)
    escreve(os.path.join(pdir, 'board.js'), 'var pcbmirror = {};\n')
    escreve(os.path.join(tmp, 'Projects', 'SEMPLACA', 'schematic.js'), 'var schmirror = {};\n')
    os.makedirs(os.path.join(tmp, 'Libs'), exist_ok=True)
    cli = H.app.test_client()

    r = cli.post('/api/pdf', json={'proj': PROJ, 'nome': 'LO - PTESTE_P1', 'base64': b64(PDF)})
    assert r.status_code == 200, r.get_json()
    alvo = os.path.join(pdir, H.PDF_DIR, 'LO - PTESTE_P1.pdf')
    with open(alvo, 'rb') as f:
        assert f.read() == PDF
    assert r.get_json()['arquivo'] == 'Projects/%s/PDF/LO - PTESTE_P1.pdf' % PROJ
    # .pdf no nome nao dobra, e grava por cima
    r = cli.post('/api/pdf', json={'proj': PROJ, 'nome': 'LO - PTESTE_P1.pdf', 'base64': b64(PDF + b'%x\n')})
    assert r.status_code == 200 and sorted(os.listdir(os.path.join(pdir, H.PDF_DIR))) == ['LO - PTESTE_P1.pdf']
    print('  ok  grava e regrava o PDF na pasta PDF/ do projeto')

    for nome in ('../fora', 'a/b', '.oculto', 'x:y', '', 'nome.', 'a' * 200):
        r = cli.post('/api/pdf', json={'proj': PROJ, 'nome': nome, 'base64': b64(PDF)})
        assert r.status_code in (400, 403), (nome, r.status_code)
    r = cli.post('/api/pdf', json={'proj': PROJ, 'nome': 'x', 'base64': b64(b'<html>')})
    assert r.status_code == 400
    r = cli.post('/api/pdf', json={'proj': PROJ, 'nome': 'x', 'base64': '***'})
    assert r.status_code == 400
    for proj in ('..', 'NAOEXISTE', 'SEMPLACA', None):
        r = cli.post('/api/pdf', json={'proj': proj, 'nome': 'x', 'base64': b64(PDF)})
        assert r.status_code == 404, (proj, r.status_code)
    print('  ok  recusa nome com pasta/oculto/vazio, conteudo que nao e PDF e projeto sem board.js')

    # o vigia nao desce na PDF/ (gravar o PDF nao recarrega a vista)
    assert not any(os.sep + H.PDF_DIR + os.sep in p for p in H._snapshot()), 'o vigia viu a pasta PDF/'
    print('  ok  a pasta PDF/ fica fora do vigia')

    r = cli.post('/api/save', json={'path': 'Projects/%s/rules.js' % PROJ, 'content': 'var pcbrules = {};\n'})
    assert r.status_code == 200, r.get_json()
    r = cli.post('/api/save', json={'path': 'Libs/sch-templates-casa.js', 'content': 'var schtemplatescasa = {};\n'})
    assert r.status_code == 200, r.get_json()
    r = cli.post('/api/save', json={'path': 'Projects/%s/board.js' % PROJ, 'content': 'x'})
    assert r.status_code == 403
    print('  ok  /api/save aceita rules.js e sch-templates-casa.js, e continua recusando board.js')
finally:
    H.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)

print('test_pdf_api OK')
