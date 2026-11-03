# -*- coding: utf-8 -*-
"""POST /api/render: as fotos 3D da placa (Gerar render da vista PCB e do envio ao Odoo) vao para
Projects/<proj>/Renders/placa-montada.png e placa-virgem.png, com o renders.json.

    python3 tests/test_render_api.py

Roda num workspace de mentira (H.ROOT trocado por um tempdir), como o test_pdf_api.py. Confere ainda
que o envio ao Odoo (odoolista.imagens_do_projeto) enxerga o que a rota gravou.
"""
import base64
import io
import json
import os
import shutil
import sys
import tempfile
import zlib
import struct

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, ValueError):
    pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import hubserver as H  # noqa: E402
import odoolista as OL  # noqa: E402


def escreve(caminho, texto):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with io.open(caminho, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)


def png(cor):
    """Um PNG 1x1 de verdade."""
    def bloco(tipo, dados):
        c = struct.pack('>I', len(dados)) + tipo + dados
        return c + struct.pack('>I', zlib.crc32(tipo + dados) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + bloco(b'IHDR', ihdr) + bloco(b'IDAT', zlib.compress(b'\x00' + bytes(cor)))
            + bloco(b'IEND', b''))


def url(b):
    return 'data:image/png;base64,' + base64.b64encode(b).decode('ascii')


tmp = tempfile.mkdtemp(prefix='render-api-')
real_root, H.ROOT = H.ROOT, tmp
try:
    PROJ = 'PTESTE - DI000000_P1 (rev 2)'
    pdir = os.path.join(tmp, 'Projects', PROJ)
    escreve(os.path.join(pdir, 'board.js'), 'var pcbmirror = {};\n')
    escreve(os.path.join(tmp, 'Projects', 'SEMPLACA', 'schematic.js'), 'var schmirror = {};\n')
    cli = H.app.test_client()
    M, V = png([0, 128, 0]), png([200, 200, 200])

    r = cli.post('/api/render', json={'proj': PROJ, 'fotos': {
        'montada': {'png': url(M), 'pose': 'iso', 'largura': 1600, 'altura': 1200, 'realView': True, 'corpos': 12,
                    'steps': 9, 'falhas': ['U1: sem modelo']},
        'virgem': {'png': base64.b64encode(V).decode('ascii'), 'pose': 'topo', 'largura': 1600, 'altura': 1200}}})
    assert r.status_code == 200, r.get_json()
    j = r.get_json()
    assert j['pasta'] == 'Projects/%s/Renders' % PROJ
    rdir = os.path.join(pdir, 'Renders')
    with open(os.path.join(rdir, 'placa-montada.png'), 'rb') as f:
        assert f.read() == M
    with open(os.path.join(rdir, 'placa-virgem.png'), 'rb') as f:
        assert f.read() == V
    with open(os.path.join(rdir, 'renders.json'), encoding='utf-8') as f:
        man = json.load(f)
    assert man['montada']['arquivo'] == 'placa-montada.png' and man['montada']['corpos'] == 12
    assert man['montada']['falhas'] == ['U1: sem modelo'] and man['montada']['tag'] == 'placa montada'
    assert man['virgem']['pose'] == 'topo' and 'corpos' not in man['virgem']
    assert j['fotos']['montada']['arquivo'] == 'Projects/%s/Renders/placa-montada.png' % PROJ
    print('  ok  grava as duas fotos e o renders.json na pasta Renders/ do projeto')

    # so a montada: a virgem que ja estava fica, e o manifesto guarda as duas
    M2 = png([10, 20, 30])
    r = cli.post('/api/render', json={'proj': PROJ, 'fotos': {'montada': {'png': url(M2)}}})
    assert r.status_code == 200, r.get_json()
    with open(os.path.join(rdir, 'placa-virgem.png'), 'rb') as f:
        assert f.read() == V
    with open(os.path.join(rdir, 'renders.json'), encoding='utf-8') as f:
        man = json.load(f)
    assert set(man) == {'montada', 'virgem'} and 'corpos' not in man['montada']
    print('  ok  so o tipo que veio e trocado')

    # o envio ao Odoo enxerga as fotos
    im = OL.imagens_do_projeto(PROJ, tmp)
    assert im['montada'] and im['virgem'], im
    print('  ok  o envio ao Odoo acha as fotos gravadas')

    # recusas: projeto sem placa, de fora, tipo desconhecido, nao-PNG, base64 quebrado, corpo vazio
    casos = [
        ({'proj': 'SEMPLACA', 'fotos': {'montada': {'png': url(M)}}}, 404),
        ({'proj': '../fora', 'fotos': {'montada': {'png': url(M)}}}, 404),
        ({'proj': PROJ, 'fotos': {'lateral': {'png': url(M)}}}, 400),
        ({'proj': PROJ, 'fotos': {'montada': {'png': base64.b64encode(b'GIF89a....').decode('ascii')}}}, 400),
        ({'proj': PROJ, 'fotos': {'montada': {'png': '@@@'}}}, 400),
        ({'proj': PROJ, 'fotos': {}}, 400),
        ({'proj': PROJ}, 400),
    ]
    for corpo, st in casos:
        r = cli.post('/api/render', json=corpo)
        assert r.status_code == st, (corpo, r.status_code, r.get_json())
    assert sorted(os.listdir(rdir)) == ['placa-montada.png', 'placa-virgem.png', 'renders.json'], os.listdir(rdir)
    print('  ok  recusa projeto sem placa, nome de fora, tipo desconhecido e o que nao e PNG')
finally:
    H.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)
print('test_render_api: ok')
