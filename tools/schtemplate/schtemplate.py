# -*- coding: utf-8 -*-
"""Templates de folha de esquema do Altium (.SchDot, e o template EMBUTIDO num .SchDoc) -> JSON.

É o "Design » Templates" do Altium sem o Altium: lê a folha (RECORD=31) e o desenho do
template — moldura, carimbo, textos com fonte e alinhamento, parâmetros, logo embutido — e
grava `Libs/sch-templates.js`, que o `hub-schtemplate.js` desenha na vista Esquema.

    python tools/schtemplate/schtemplate.py --saida Libs/sch-templates.js \
        "ISO A3 Landscape.SchDot" ... --legado A4.SchDot ... \
        --casa ESQUEMA_1.SchDoc --prjpcb DieletronsAltium.PrjPcb

O que foi apurado nos arquivos reais (AD21, 2026-10-13):

  folha         RECORD=31. `UseCustomSheet=T` -> CustomX/CustomY (+_Frac) em 10 mil, zonas em
                CustomXZones/CustomYZones e margem em CustomMarginWidth. Sem ele vale o
                SheetStyle (0=A4 .. 17=OrCAD E) e a tabela de ESTILOS abaixo — tirada do
                construtor do ArkGlobalSettings (Altium.Sch.Base.dll, por reflexão, sem
                rodar código): A3 é 15500x11100 e tem 8 zonas na horizontal, não 6.
  chaves        os .SchDot antigos (LegacyLocalTemplates.zip, 2014) gravam em MAIÚSCULAS
                (CUSTOMX, BORDERON, EMBEDIMAGE): tudo aqui é lido sem caixa.
  ausente       BorderOn, TitleBlockOn e ShowTemplateGraphics ausentes = desligados;
                ReferenceZonesOn ausente = LIGADO (a folha da casa não traz a chave e o
                preview do Altium mostra as zonas 1..6 / A..D).
  .SchDot       o desenho do template é a própria folha: todo registro de primeiro nível
                (sem OwnerIndex) que é gráfico. RECORD=41 de primeiro nível = parâmetro do
                documento; os 25 que o Altium semeia com Text=* ficam de fora.
  .SchDoc       a folha que USA um template guarda uma cópia dele: o RECORD=39 (com o
                FileName do .SchDot) e os gráficos com OwnerIndex apontando para ele. É assim
                que o carimbo da DIEletrons sai do ESQUEMA_1.SchDoc — o A4_DiEletrons.SchDot
                que ele cita não existe mais nesta máquina.
  texto         RECORD=4. Justification 0..8 = (embaixo, meio, em cima) x (esq, centro, dir),
                Orientation 0..3 x 90° anti-horário, IsMirrored=T troca esquerda por direita
                (o texto continua legível: os Address1..4 do ISO A3 são BottomRight espelhado
                e ficam à DIREITA do logo, não por cima dele). Fonte = tabela FontIdCount do
                RECORD=31; tamanho em pontos, e 1 pt = 10 mil (é a conta do hub-draw).
  quadro        RECORD=28 (text frame): `~1` é quebra de linha; Alignment 0=centro 1=esq 2=dir.
  imagem        RECORD=30 com EmbedImage=T: os bytes moram no stream `Storage` — um registro
                de cabeçalho |HEADER=Icon storage| e, por imagem, um binário com 0xD0, nome
                em string pascal, uint32 do tamanho e o zlib do arquivo original. Sai como
                dataURL (png/jpg/bmp/gif pelo número mágico).
  cor           TColor do Delphi (R + G*256 + B*65536), ausente = 0 = preto.

Nada aqui escreve em arquivo do Altium.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import struct
import sys
import zlib
from collections import OrderedDict
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import schlib_bin as SB                      # noqa: E402
import sch_leitor as SL                      # noqa: E402

FORMATO = 'schtemplate-v1'

# SheetStyle -> (nome, largura, altura, zonas X, zonas Y, margem), em mil. Medido por reflexão
# no ArkGlobalSettings..ctor do AD21 (valores internos /10000). Todas as YZones são 4.
ESTILOS = [
    ('A4', 11500, 7600, 4, 4, 200), ('A3', 15500, 11100, 8, 4, 200),
    ('A2', 22300, 15700, 8, 4, 300), ('A1', 31500, 22300, 12, 4, 300),
    ('A0', 44600, 31500, 16, 4, 400), ('A', 9500, 7500, 4, 4, 200),
    ('B', 15000, 9500, 6, 4, 200), ('C', 20000, 15000, 6, 4, 300),
    ('D', 32000, 20000, 8, 4, 300), ('E', 42000, 32000, 16, 4, 400),
    ('Letter', 11000, 8500, 4, 4, 200), ('Legal', 14000, 8500, 4, 4, 200),
    ('Tabloid', 17000, 11000, 6, 4, 200), ('OrCAD A', 9900, 7900, 4, 4, 200),
    ('OrCAD B', 15400, 9900, 6, 4, 200), ('OrCAD C', 20600, 15600, 6, 4, 300),
    ('OrCAD D', 32600, 20600, 8, 4, 300), ('OrCAD E', 42800, 32800, 16, 4, 400),
]
GRAFICOS = {'5', '6', '7', '8', '10', '11', '12', '13', '14'}   # o resto vai pelo primitiva()
ALINHA_QUADRO = {0: 'center', 1: 'left', 2: 'right'}


# ─── leitura crua ─────────────────────────────────────────────────────────────
def _up(d):
    """registro -> {CHAVE_MAIÚSCULA: valor}: os .SchDot de 2014 gravam em maiúsculas"""
    return {k.upper(): v for k, v in d.items()}


def _int(v, padrao=0):
    return SL._int(v, padrao)


def _mil(u, k):
    """`LOCATION.X` + `LOCATION.X_FRAC` -> mil (mesma conta do sch_leitor)"""
    return SL._mil(_int(u.get(k)), _int(u.get(k + '_FRAC')))


def _sim(u, k, padrao=False):
    v = u.get(k)
    if v is None or v == '':
        return padrao
    return v.upper() == 'T'


def _cor(u, k, padrao='#000000'):
    v = u.get(k)
    if v is None or v == '':
        return padrao
    return SL.cor_hex(v) or padrao


def registros(fonte):
    """(lista de registros de texto — None no lugar dos binários —, bytes do Storage ou None)"""
    olefile = SL.olefile_ou_erro()
    if isinstance(fonte, (bytes, bytearray)):
        fonte = io.BytesIO(bytes(fonte))
    o = olefile.OleFileIO(fonte)
    try:
        regs = SB.desmonta(o.openstream('FileHeader').read())
        storage = o.openstream('Storage').read() if o.exists('Storage') else None
    finally:
        o.close()
    return [SB.le_texto(pl) if t == SB.TEXTO else None for t, pl in regs], storage


def imagens(storage):
    """stream Storage -> {nome do arquivo (minúsculo): bytes}"""
    fora = {}
    if not storage:
        return fora
    for tipo, pl in SB.desmonta(storage):
        if tipo != SB.BINARIO or len(pl) < 6 or pl[0] != 0xD0:
            continue
        n = pl[1]
        nome = pl[2:2 + n].decode('latin-1')
        i = 2 + n
        tam = struct.unpack('<I', pl[i:i + 4])[0]
        bruto = pl[i + 4:i + 4 + tam]
        try:
            fora[nome.lower()] = zlib.decompress(bruto)
        except zlib.error:
            continue
    return fora


def mime(b):
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if b[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if b[:2] == b'BM':
        return 'image/bmp'
    if b[:4] in (b'GIF8',):
        return 'image/gif'
    return None


def _png(w, h, linhas, cor=6):
    """linhas RGB(A) de cima para baixo -> bytes de um PNG (sem PIL: zlib + crc)"""
    def bloco(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    cru = b''.join(b'\x00' + l for l in linhas)
    return (b'\x89PNG\r\n\x1a\n' + bloco(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, cor, 0, 0, 0))
            + bloco(b'IDAT', zlib.compress(cru, 9)) + bloco(b'IEND', b''))


def bmp_para_png(b):
    """O Altium guarda TODA imagem embutida como BMP (o "nova logo.png" da casa vira um BMP
    de 1024x145 a 24 bits, 520 KB): em PNG o mesmo desenho cai para poucas dezenas de KB.
    Só BMP sem compressão de 8/24/32 bits — o que os templates têm; o resto volta None."""
    if b[:2] != b'BM' or len(b) < 54:
        return None
    off = struct.unpack('<I', b[10:14])[0]
    hs, w, h, _pl, bpp, comp = struct.unpack('<IiiHHI', b[14:34])
    if comp not in (0, 3) or bpp not in (8, 24, 32) or w <= 0 or h == 0:
        return None
    paleta = []
    if bpp == 8:
        n = struct.unpack('<I', b[46:50])[0] or 256
        p0 = 14 + hs
        paleta = [bytes((b[p0 + 4 * i + 2], b[p0 + 4 * i + 1], b[p0 + 4 * i])) for i in range(n)]
    passo = ((w * bpp + 31) // 32) * 4
    linhas = []
    for y in range(abs(h)):
        i = off + (abs(h) - 1 - y if h > 0 else y) * passo
        l = b[i:i + passo]
        if bpp == 8:
            linhas.append(b''.join(paleta[c] if c < len(paleta) else b'\0\0\0' for c in l[:w]))
        else:
            k = bpp // 8
            px = bytearray(w * 3)
            px[0::3], px[1::3], px[2::3] = l[2:w * k:k], l[1:w * k:k], l[0:w * k:k]
            linhas.append(bytes(px))
    return _png(w, abs(h), linhas, cor=2)


def data_url(b):
    b = bmp_para_png(b) or b
    m = mime(b)
    if not m:
        return None
    return 'data:%s;base64,%s' % (m, base64.b64encode(b).decode('ascii'))


# ─── folha ────────────────────────────────────────────────────────────────────
def fontes(u):
    """RECORD=31 -> {id: {nome, tam, negrito, italico, sublinhado}}"""
    fora = OrderedDict()
    for i in range(1, _int(u.get('FONTIDCOUNT')) + 1):
        f = OrderedDict([('nome', u.get('FONTNAME%d' % i, 'Times New Roman')),
                         ('tam', _int(u.get('SIZE%d' % i), 10))])
        if _sim(u, 'BOLD%d' % i):
            f['negrito'] = True
        if _sim(u, 'ITALIC%d' % i):
            f['italico'] = True
        if _sim(u, 'UNDERLINE%d' % i):
            f['sublinhado'] = True
        fora[str(i)] = f
    return fora


def folha(u):
    """RECORD=31 -> o "Document Options" da folha"""
    estilo = _int(u.get('SHEETSTYLE'))
    nome, w, h, zx, zy, mg = ESTILOS[estilo] if 0 <= estilo < len(ESTILOS) else ESTILOS[0]
    custom = _sim(u, 'USECUSTOMSHEET')
    if custom:
        w, h = _mil(u, 'CUSTOMX'), _mil(u, 'CUSTOMY')
        zx, zy = _int(u.get('CUSTOMXZONES'), zx), _int(u.get('CUSTOMYZONES'), zy)
        mg = _mil(u, 'CUSTOMMARGINWIDTH') if 'CUSTOMMARGINWIDTH' in u else mg
    elif _int(u.get('WORKSPACEORIENTATION')) == 1:
        # retrato (os *_portrait.SchDot de 2014): a mesma folha em pé, zonas junto
        w, h, zx, zy = h, w, zy, zx
    r3 = lambda v: SL._n(round(v, 3))
    return OrderedDict([
        ('estilo', 'Custom' if custom else nome), ('w', r3(w)), ('h', r3(h)),
        ('margem', r3(mg)), ('zonasX', zx), ('zonasY', zy),
        ('zonas', _sim(u, 'REFERENCEZONESON', True)),
        # 0 = o padrão (1..n da esquerda, A.. de cima); 1 = ASME (o contrário)
        ('estiloZona', _int(u.get('REFERENCEZONESTYLE'))),
        ('borda', _sim(u, 'BORDERON')),
        ('carimbo', _sim(u, 'TITLEBLOCKON')),
        # DocumentBorderStyle: 0 = o carimbo "Standard", 1 = o "ANSI"
        ('estiloCarimbo', 'ansi' if _int(u.get('DOCUMENTBORDERSTYLE')) == 1 else 'standard'),
        ('fonteSistema', _int(u.get('SYSTEMFONT'), 1)),
        ('cor', _cor(u, 'COLOR')),
        ('area', _cor(u, 'AREACOLOR', '#fffcf8')),
    ])


# ─── itens ────────────────────────────────────────────────────────────────────
def _texto(u):
    """RECORD=4 -> item `text`"""
    it = OrderedDict([('g', 'text'), ('x', _mil(u, 'LOCATION.X')), ('y', _mil(u, 'LOCATION.Y')),
                      ('s', u.get('TEXT', '')), ('fonte', _int(u.get('FONTID'), 1))])
    j = _int(u.get('JUSTIFICATION'))
    if j:
        it['just'] = j
    rot = (_int(u.get('ORIENTATION')) & 3) * 90
    if rot:
        it['rot'] = rot
    if _sim(u, 'ISMIRRORED'):
        it['espelho'] = True
    it['color'] = _cor(u, 'COLOR')
    return it


def _quadro(u):
    """RECORD=28 (text frame) -> item `frame`"""
    it = OrderedDict([('g', 'frame'), ('x1', _mil(u, 'LOCATION.X')), ('y1', _mil(u, 'LOCATION.Y')),
                      ('x2', _mil(u, 'CORNER.X')), ('y2', _mil(u, 'CORNER.Y')),
                      ('s', u.get('TEXT', '').replace('~1', '\n')),
                      ('fonte', _int(u.get('FONTID'), 1)),
                      ('alinha', ALINHA_QUADRO.get(_int(u.get('ALIGNMENT')), 'center'))])
    if _sim(u, 'WORDWRAP'):
        it['quebra'] = True
    if _sim(u, 'SHOWBORDER'):
        it['borda'] = True
        it['color'] = _cor(u, 'COLOR')
    if _sim(u, 'ISSOLID'):
        it['fill'] = _cor(u, 'AREACOLOR', '#ffffff')
    it['textColor'] = _cor(u, 'TEXTCOLOR')
    mg = SL._mil(_int(u.get('TEXTMARGIN')), _int(u.get('TEXTMARGIN_FRAC')))
    if mg:
        it['margem'] = SL._n(round(mg, 3))
    return it


def _imagem(u, imgs, avisos):
    """RECORD=30 -> item `image` (dataURL quando embutida)"""
    it = OrderedDict([('g', 'image'), ('x1', _mil(u, 'LOCATION.X')), ('y1', _mil(u, 'LOCATION.Y')),
                      ('x2', _mil(u, 'CORNER.X')), ('y2', _mil(u, 'CORNER.Y'))])
    if _sim(u, 'KEEPASPECT'):
        it['aspecto'] = True
    nome = u.get('FILENAME', '')
    it['arquivo'] = nome.replace('\\', '/').split('/')[-1]
    b = imgs.get(nome.lower()) if _sim(u, 'EMBEDIMAGE') else None
    src = data_url(b) if b else None
    if src:
        it['src'] = src
    else:
        avisos.append('imagem sem bytes embutidos: %s' % nome)
    return it


def item(d, fts, imgs, avisos):
    """um registro (OrderedDict cru) -> item do template, ou None"""
    u = _up(d)
    r = u.get('RECORD')
    if r == '4':
        return _texto(u)
    if r == '28':
        return _quadro(u)
    if r == '30':
        return _imagem(u, imgs, avisos)
    if r in GRAFICOS:
        g = SL.primitiva(SL._canon(d), fts)
        if g is None:
            return None
        g = OrderedDict(g)
        if r in ('13', '6', '5', '12', '11'):
            g.setdefault('color', '#000000')         # ausente = 0 = preto, no Altium
        if r in ('14', '10', '7', '8'):
            g['w'] = SL.LARGURA.get(_int(u.get('LINEWIDTH')), 4)
            g.setdefault('color', '#000000')
            if _sim(u, 'TRANSPARENT'):
                g.pop('fill', None)
                g['solid'] = False
        return g
    return None


# ─── um arquivo inteiro ───────────────────────────────────────────────────────
def le_template(fonte, nome=None, origem='altium', embutido=None):
    """.SchDot (o desenho é a folha) ou .SchDoc (o desenho é o do RECORD=39) -> template.

    `embutido`: None = decide pela presença de RECORD=39."""
    regs, storage = registros(fonte)
    imgs = imagens(storage)
    cab = next((d for d in regs if d is not None and _up(d).get('RECORD') == '31'), None)
    if cab is None:
        raise ValueError('sem RECORD=31: não é uma folha de esquema')
    u31 = _up(cab)
    fts = SL.le_fontes(SL._canon(cab))
    # o template embutido numa .SchDoc: os filhos do RECORD=39 (OwnerIndex = índice - 1)
    i39 = next((i for i, d in enumerate(regs) if d is not None and _up(d).get('RECORD') == '39'), None)
    if embutido is None:
        embutido = i39 is not None
    avisos, itens, params = [], [], OrderedDict()
    for i, d in enumerate(regs):
        if d is None or i == 0:
            continue
        u = _up(d)
        dono = u.get('OWNERINDEX')
        if u.get('RECORD') == '41':
            # parâmetro do documento: só os de primeiro nível; o '*' é a semente vazia do Altium
            if dono is None and u.get('NAME'):
                v = u.get('TEXT', '')
                if v != '*' and not v.strip().startswith('='):
                    params[u['NAME']] = v
            continue
        if embutido:
            if i39 is None or dono is None or _int(dono, -9) + 1 != i39:
                continue
        elif dono is not None:
            continue
        it = item(d, fts, imgs, avisos)
        if it is not None:
            itens.append(it)
    arq = ''
    if i39 is not None:
        arq = _up(regs[i39]).get('FILENAME', '')
    arq = arq or u31.get('TEMPLATEFILENAME', '')
    if nome is None:
        base = arq or getattr(fonte, 'name', '') or (fonte if isinstance(fonte, str) else 'template')
        nome = os.path.splitext(base.replace('\\', '/').split('/')[-1])[0]
    t = OrderedDict([('id', origem + ':' + nome), ('nome', nome), ('origem', origem)])
    if arq:
        t['arquivo'] = arq.replace('\\', '/').split('/')[-1]
    t['folha'] = folha(u31)
    t['fontes'] = fontes(u31)
    t['params'] = params
    t['itens'] = itens
    if avisos:
        t['avisos'] = avisos
    return t


def le_prjpcb(caminho):
    """[ParameterN] Name/Value de um .PrjPcb -> OrderedDict (os parâmetros do PROJETO)"""
    with open(caminho, 'rb') as f:
        bruto = f.read()
    try:
        txt = bruto.decode('utf-8')
    except UnicodeDecodeError:
        txt = bruto.decode('cp1252')
    fora, sec, atual = OrderedDict(), None, {}
    for linha in txt.splitlines() + ['[fim]']:
        linha = linha.strip()
        if linha.startswith('['):
            if sec and atual.get('Name'):
                fora[atual['Name']] = atual.get('Value', '')
            sec = linha if re.match(r'^\[Parameter\d+\]$', linha) else None
            atual = {}
        elif sec and '=' in linha:
            k, _, v = linha.partition('=')
            atual[k] = v
    return fora


def interno(nome):
    """os carimbos que o Altium desenha SEM arquivo (Document Options › Title Block): o
    desenho sai do hub-schtemplate.js, medido no Altium.Sch.Painter.dll; aqui fica só a ficha"""
    f = OrderedDict([('estilo', 'A4'), ('w', 11500), ('h', 7600), ('margem', 200), ('zonasX', 4),
                     ('zonasY', 4), ('zonas', True), ('estiloZona', 0), ('borda', True),
                     ('carimbo', True), ('estiloCarimbo', nome.lower()), ('fonteSistema', 1),
                     ('cor', '#000000'), ('area', '#fffcf8')])
    return OrderedDict([('id', 'altium:' + nome), ('nome', nome + ' (Altium, sem template)'),
                        ('origem', 'altium'), ('interno', True), ('folha', f),
                        ('fontes', OrderedDict([('1', OrderedDict([('nome', 'Times New Roman'), ('tam', 10)]))])),
                        ('params', OrderedDict()), ('itens', [])])


# ─── saída ────────────────────────────────────────────────────────────────────
def separa_imagens(templates):
    """o `src` de cada imagem vai para uma tabela única, por conteúdo: os 8 .SchDot legados
    carregam o MESMO newAltmLogo.bmp e os 5 novos o mesmo Altm black.jpg — repetir os bytes
    em cada um triplicava o arquivo. No item fica `img` (a chave); o hub-schtemplate resolve."""
    tabela = OrderedDict()
    for t in templates:
        for it in t['itens']:
            src = it.pop('src', None) if it.get('g') == 'image' else None
            if not src:
                continue
            k = 'img' + hashlib.sha1(src.encode('ascii')).hexdigest()[:12]
            tabela[k] = src
            it['img'] = k
    return tabela


def js(templates, var='schtemplates', titulo='Templates de folha do Altium'):
    """o arquivo `Libs/sch-templates.js`: um template por linha (o diff de um template não
    arrasta os outros) e as imagens no fim, uma por linha"""
    tabela = separa_imagens(templates)
    L = ['var %s = {' % var,
         '"format":%s,' % json.dumps(FORMATO),
         '"title":%s,' % json.dumps(titulo, ensure_ascii=False),
         '"generated":%s,' % json.dumps(datetime.now().strftime('%d/%m/%Y %H:%M:%S')),
         '"templates":{']
    for i, t in enumerate(templates):
        L.append(json.dumps(t['id'], ensure_ascii=False) + ':' + json.dumps(t, ensure_ascii=False)
                 + (',' if i < len(templates) - 1 else ''))
    L.append('},')
    L.append('"imagens":{')
    ks = list(tabela)
    for i, k in enumerate(ks):
        L.append(json.dumps(k) + ':' + json.dumps(tabela[k]) + (',' if i < len(ks) - 1 else ''))
    L.append('}};')
    return '\n'.join(L) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('altium', nargs='*', help='.SchDot instalados (origem "altium")')
    ap.add_argument('--legado', nargs='*', default=[], help='.SchDot do LegacyLocalTemplates.zip')
    ap.add_argument('--casa', nargs='*', default=[], help='.SchDoc/.SchDot da casa')
    ap.add_argument('--prjpcb', help='.PrjPcb cujos parâmetros viram o padrão dos templates da casa')
    ap.add_argument('--saida', help='grava o .js aqui (sem isto: JSON na saída padrão)')
    a = ap.parse_args(argv)
    fora = [interno('Standard'), interno('ANSI')]
    for origem, lista in (('altium', a.altium), ('altium-legado', a.legado), ('casa', a.casa)):
        for p in lista:
            t = le_template(p, origem=origem,
                            nome=None if origem == 'casa' else os.path.splitext(os.path.basename(p))[0])
            if origem == 'casa' and a.prjpcb:
                proj = le_prjpcb(a.prjpcb)
                proj.update(t['params'])
                t['params'] = proj
            for av in t.get('avisos', []):
                sys.stderr.write('[%s] %s\n' % (t['id'], av))
            fora.append(t)
    if a.saida:
        with open(a.saida, 'w', encoding='utf-8', newline='\n') as f:
            f.write(js(fora))
        print('%d templates -> %s' % (len(fora), a.saida))
        for t in fora:
            print('  %-34s %-8s %9s x %-9s %3d itens' % (t['id'], t['folha']['estilo'], t['folha']['w'],
                                                       t['folha']['h'], len(t['itens'])))
    else:
        json.dump(fora, sys.stdout, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
