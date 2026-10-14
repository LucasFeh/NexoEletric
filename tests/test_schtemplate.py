# -*- coding: utf-8 -*-
"""O extrator de templates de folha (tools/schtemplate/schtemplate.py).

    python tests/test_schtemplate.py

(a) offline: BMP -> PNG sem PIL (8 e 24 bits), o .PrjPcb, a tabela de estilos igual à do
    hub-schtemplate.js, e o Libs/sch-templates.js versionado se lendo como o Node o lê.
(b) com o Altium instalado (C:\\Users\\Public\\Documents\\Altium\\AD21\\Templates): os .SchDot
    e o ESQUEMA_1.SchDoc da casa, COPIADOS para uma pasta temporária antes de abrir (a pasta do
    Altium é só leitura). Sem a instalação: PULA, não falha.
"""
import json
import os
import re
import shutil
import struct
import sys
import tempfile
import zipfile
import zlib

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'schtemplate'))
import schtemplate as ST     # noqa: E402

TPL = r'C:\Users\Public\Documents\Altium\AD21\Templates'
CASA = os.path.join(TPL, 'DieletronsAltium', 'DieletronsAltium')
n = 0


def ok(c, m):
    global n
    assert c, m
    n += 1


def png_px(b):
    """PNG (o nosso: um IDAT, filtro 0) -> (w, h, bytes RGB)"""
    w, h, _, cor = struct.unpack('>IIBB', b[16:26])
    i, dados = 8, b''
    while i < len(b):
        tam = struct.unpack('>I', b[i:i + 4])[0]
        if b[i + 4:i + 8] == b'IDAT':
            dados += b[i + 8:i + 8 + tam]
        i += 12 + tam
    cru = zlib.decompress(dados)
    k = 3 if cor == 2 else 4
    return w, h, b''.join(cru[y * (w * k + 1) + 1:(y + 1) * (w * k + 1)] for y in range(h))


def bmp(w, h, bpp, px, paleta=None):
    """BMP de baixo para cima; px = lista de linhas de CIMA para baixo (bytes por pixel cru)"""
    passo = ((w * bpp + 31) // 32) * 4
    pal = b''.join(bytes((c[2], c[1], c[0], 0)) for c in (paleta or []))
    off = 54 + len(pal)
    corpo = b''.join(l.ljust(passo, b'\0') for l in reversed(px))
    cab = b'BM' + struct.pack('<IHHI', off + len(corpo), 0, 0, off)
    info = struct.pack('<IiiHHIIiiII', 40, w, h, 1, bpp, 0, len(corpo), 0, 0, len(paleta or []), 0)
    return cab + info + pal + corpo


def offline():
    # BMP 24 bits: 2x2, vermelho/verde em cima, azul/branco embaixo (BGR no arquivo)
    b = bmp(2, 2, 24, [b'\x00\x00\xff\x00\xff\x00', b'\xff\x00\x00\xff\xff\xff'])
    w, h, px = png_px(ST.bmp_para_png(b))
    ok((w, h) == (2, 2), 'tamanho do PNG')
    ok(px == b'\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\xff', 'BGR de baixo para cima -> RGB de cima: %r' % px)
    b8 = bmp(3, 1, 8, [b'\x00\x01\x00'], paleta=[(10, 20, 30), (200, 100, 50)])
    _, _, px = png_px(ST.bmp_para_png(b8))
    ok(px == bytes((10, 20, 30, 200, 100, 50, 10, 20, 30)), 'paleta de 8 bits')
    ok(ST.bmp_para_png(b'\x89PNG....') is None, 'o que não é BMP volta None')
    ok(ST.data_url(b).startswith('data:image/png;base64,'), 'BMP embutido sai PNG')

    d = tempfile.mkdtemp()
    try:
        p = os.path.join(d, 'x.PrjPcb')
        with open(p, 'w', encoding='utf-8') as f:
            f.write('[Design]\nVersion=1.0\n[Parameter1]\nName=Revisao\nValue=REV.A\n\n'
                    '[Parameter2]\nName=Escala\nValue=1:1\n[Document1]\nDocumentPath=a.SchDoc\n')
        ok(dict(ST.le_prjpcb(p)) == {'Revisao': 'REV.A', 'Escala': '1:1'}, 'parâmetros do projeto')
    finally:
        shutil.rmtree(d)

    # a tabela de estilos é a mesma dos dois lados (Altium.Sch.Base.dll, medida uma vez)
    js = open(os.path.join(RAIZ, 'hub-schtemplate.js'), encoding='utf-8').read()
    lado_js = re.findall(r"\['([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+)\]", js.split('const CARIMBOS')[0])
    ok([(a, int(b), int(c), int(e), int(f), int(g)) for a, b, c, e, f, g in lado_js] == ST.ESTILOS,
       'ESTILOS do Python e do JS iguais')

    # o Libs versionado: JSON válido entre o "var x =" e o ";"
    txt = open(os.path.join(RAIZ, 'Libs', 'sch-templates.js'), encoding='utf-8').read()
    lib = json.loads(txt[txt.index('{'):txt.rindex(';')])
    ok(lib['format'] == ST.FORMATO, 'formato do Libs')
    ids = set(lib['templates'])
    for i in ('altium:Standard', 'altium:ANSI', 'altium:ISO A3 Landscape', 'casa:A4_DiEletrons', 'altium-legado:A4'):
        ok(i in ids, 'falta ' + i)
    refs = {it['img'] for t in lib['templates'].values() for it in t['itens'] if it.get('img')}
    ok(refs and refs <= set(lib['imagens']), 'toda imagem citada está na tabela')


def com_altium():
    if not os.path.isdir(TPL):
        print('  (pulado: sem %s)' % TPL)
        return
    d = tempfile.mkdtemp()
    try:
        def copia(src):
            dst = os.path.join(d, os.path.basename(src))
            shutil.copyfile(src, dst)
            return dst
        a3 = ST.le_template(copia(os.path.join(TPL, 'ISO A3 Landscape.SchDot')), nome='ISO A3 Landscape')
        f = a3['folha']
        ok((f['w'], f['h'], f['zonasX'], f['zonasY'], f['margem']) == (16535.433, 11692.913, 6, 4, 200),
           'ISO A3: %r' % f)
        img = [i for i in a3['itens'] if i['g'] == 'image']
        ok(len(img) == 1 and img[0]['src'].startswith('data:image/png'), 'logo embutido do Storage')
        end = [i for i in a3['itens'] if i.get('s') == '=Address1'][0]
        ok(end.get('espelho') and end.get('just') == 2, 'IsMirrored + BottomRight preservados')
        ok(any(i.get('rot') == 270 for i in a3['itens']), 'Orientation=3')
        ok(a3['fontes']['8'] == {'nome': 'Arial Narrow', 'tam': 22}, 'tabela de fontes')

        casa = ST.le_template(copia(os.path.join(CASA, 'ESQUEMATICO', 'ESQUEMA_1.SchDoc')), origem='casa')
        ok(casa['id'] == 'casa:A4_DiEletrons', 'o nome vem do TemplateFileName: %s' % casa['id'])
        ok(len(casa['itens']) == 37, 'os 37 gráficos do RECORD=39 (%d)' % len(casa['itens']))
        ok(casa['folha']['borda'] and abs(casa['folha']['margem'] - 196.85) < 0.01, 'moldura de 5 mm')
        ok(any(i.get('s') == '=Desenhista_DiEletrons' and i.get('just') == 3 for i in casa['itens']), 'campo DESEN.')
        ok(casa['params'].get('Formato') == 'A4', 'parâmetro do documento')
        ok('SheetNumber' in casa['params'] and 'CurrentDate' not in casa['params'], 'semente * fica de fora')
        proj = ST.le_prjpcb(copia(os.path.join(CASA, 'DieletronsAltium.PrjPcb')))
        ok(proj.get('Desenhista_DiEletrons') == 'SEU_NOME', 'parâmetros do .PrjPcb da casa')

        z = os.path.join(TPL, 'LegacyLocalTemplates.zip')
        if os.path.isfile(z):
            with zipfile.ZipFile(z) as zz:
                a4 = ST.le_template(zz.read('A4.SchDot'), nome='A4', origem='altium-legado')
                r0 = ST.le_template(zz.read('A0_portrait.SchDot'), nome='A0_portrait', origem='altium-legado')
            ok((a4['folha']['w'], a4['folha']['h'], a4['folha']['zonasX']) == (11500, 7600, 4), 'A4 legado (chaves em maiúsculas)')
            ok(r0['folha']['h'] > r0['folha']['w'], 'WorkspaceOrientation=1 = em pé')
            ok(any(i.get('s') == '=sheetnumber' for i in a4['itens']), 'special string minúscula preservada')
    finally:
        shutil.rmtree(d)


if __name__ == '__main__':
    offline()
    com_altium()
    print('test_schtemplate: %d verificações ok' % n)
