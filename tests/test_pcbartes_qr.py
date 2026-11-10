# -*- coding: utf-8 -*-
"""O QR das artes de overlay (1.91.0) DECODIFICADO do Gerber gerado.

    python tests/test_pcbartes_qr.py

A arte padrão "Logo DiEletrons + QR" (hub-pcbartes.js) é posta numa placa de teste pelo motor da vista (comp_add com o
desenho, hub-core.js), o Gerber sai pelo hub-gerber.js e a legenda (GTO, e a GBO com a arte virada para baixo) é lida
de volta pelo leitor do visualizador (hub-gerberview.js). As regiões viram uma imagem (a serigrafia CLARA sobre a placa
escura, como se fotografa a placa) e o zxing-cpp a lê: tem de dar "www.dieletrons.com", o mesmo QR das placas da casa
(o da DMB - DI231765_P2). Também um QR comum (não invertido) de uma URL qualquer feito no Studio.

Precisa do Node e do zxing-cpp + Pillow no Python; sem eles PULA, não falha.
"""
import json
import os
import shutil
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    import zxingcpp                 # noqa: E402
    from PIL import Image           # noqa: E402
except ImportError as e:            # pragma: no cover
    print('test_pcbartes_qr: sem %s — pulei' % e)
    sys.exit(0)
if not shutil.which('node'):
    print('test_pcbartes_qr: sem Node — pulei')
    sys.exit(0)

JS = r"""
const A = require('./hub-pcbartes.js'), H = require('./hub-core.js'), G = require('./hub-gerber.js'), GV = require('./hub-gerberview.js');
const [qual, face] = process.argv.slice(1);
const B = { format:'pcbmirror-v1', units:'mm', components:[], tracks:[], arcs:[], vias:[], texts:[], silk:[], regions:[], fills:[], nets:[],
  board:{ bbox:{ x1:0, y1:0, x2:80, y2:60 }, outline:[{ kind:'line', x1:0, y1:0, x2:80, y2:0 }, { kind:'line', x1:80, y1:0, x2:80, y2:60 },
  { kind:'line', x1:80, y1:60, x2:0, y2:60 }, { kind:'line', x1:0, y1:60, x2:0, y2:0 }] } };
let arte = A.lista(null)[0];
if (qual === 'studio') arte = { id:'t', nome:'t', elementos:[{ tipo:'qr', x:0, y:0, tam:14, texto:'https://www.dieletrons.com.br/suporte?placa=PMD-DI261946', ec:'M', borda:4, invertido:false }] };
const ops = [A.opColocar(arte, { ref:'ARTE1', x:40, y:30 })];
if (face === 'Bottom') ops.push({ op:'comp_move', ref:'ARTE1', x:40, y:30, rot:180, layer:'Bottom', orig_x:40, orig_y:30, orig_rot:0, orig_layer:'Top' });
const m = H.applyPcbChanges(B, ops);
const eb = H.effectiveBoard(B, m);
const g = G.gerar(eb, { guid:'00000000-1111-4222-8333-444444444444' });
const arq = g.arquivos.find(a => a.camada === (face === 'Bottom' ? 'BottomOverlay' : 'TopOverlay'));
const cam = GV.parse(arq.texto, arq.nome);
const regs = cam.prims.filter(p => p.k === 'region').map(p => ({ escuro:p.escuro !== false, c:p.contornos }));
process.stdout.write(JSON.stringify({ nome:arq.nome, regs }));
"""


def le(qual, face):
    r = subprocess.run(['node', '-e', JS, qual, face], cwd=RAIZ, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def imagem(regs, x1, x2, espelha, px=0.04, margem=3.0):
    """a serigrafia (região escura no Gerber = tinta branca) branca sobre a placa preta, só a faixa x1..x2"""
    pts = [p for g in regs for c in g['c'] for p in c]
    y1 = min(p[1] for p in pts) - margem
    y2 = max(p[1] for p in pts) + margem
    x1 -= margem
    x2 += margem
    w, h = int((x2 - x1) / px), int((y2 - y1) / px)
    im = Image.new('L', (w, h), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    for g in regs:
        for c in g['c']:
            poly = [((p[0] - x1) / px, (y2 - p[1]) / px) for p in c]
            if len(poly) >= 3:
                d.polygon(poly, fill=255 if g['escuro'] else 0)
    if espelha:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    return im


n = 0
for face in ('Top', 'Bottom'):
    j = le('padrao', face)
    # o QR é a parte quadrada da arte: no Top a ESQUERDA da arte (x < 40 - 7), no Bottom (espelhada) a direita
    regs = j['regs']
    if face == 'Top':
        faixa = [g for g in regs if max(p[0] for c in g['c'] for p in c) < 40 - 6.9]
        im = imagem(faixa, 40 - 17.5, 40 - 7.4, False)
    else:
        faixa = [g for g in regs if min(p[0] for c in g['c'] for p in c) > 40 + 6.9]
        im = imagem(faixa, 40 + 7.4, 40 + 17.5, True)
    lidos = zxingcpp.read_barcodes(im)
    textos = [x.text for x in lidos]
    assert textos == ['www.dieletrons.com'], (face, j['nome'], textos)
    n += 1
    print('  ok  %s (%s): o QR do Gerber lê "%s" (nível %s)' % (j['nome'], face, textos[0], lidos[0].ec_level))

j = le('studio', 'Top')
im = imagem(j['regs'], 40 - 7.5, 40 + 7.5, False)
# QR comum (não invertido): a tinta é o módulo escuro; o zxing lê preto sobre branco, então inverte a foto
from PIL import ImageOps     # noqa: E402
lidos = zxingcpp.read_barcodes(ImageOps.invert(im))
assert [x.text for x in lidos] == ['https://www.dieletrons.com.br/suporte?placa=PMD-DI261946'], [x.text for x in lidos]
n += 1
print('  ok  QR do Studio (URL longa, nível M, não invertido) lê a URL')
print('test_pcbartes_qr: %d verificações ok' % n)
