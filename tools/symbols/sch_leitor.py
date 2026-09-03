# -*- coding: utf-8 -*-
"""Lê símbolos de esquema do Altium (.SchLib, .SchDoc, .IntLib) direto do arquivo.

É o `ExportLibs.pas` sem o Altium: o mesmo `schlib-v2` que o hub desenha, lido dos
registros binários com o `schlib_bin.py` do almoxarifado. Serve para regerar o espelho
(`Libs/schlib.js`) e para a extração de símbolos dos projetos antigos.

O que foi apurado nos arquivos reais (e onde o contrato inicial estava errado):

  coordenadas   inteiro em 10 mil + `_Frac` em 1/100000 da unidade, COM sinal:
                mil = (int*100000 + frac) / 10000.  X1=-23, X1_Frac=-62206 -> -236.2206
  pino SchLib   registro binário; a fração fica no stream `PinFrac`, que é ESPARSO:
                `Weight=N` entradas, cada uma `D0` + string pascal com o ORDINAL do pino
                (0-based, entre os registros de pino do Data) + uint32 + zlib de 3 int32
                (xfrac, yfrac, lenfrac). Pino sem entrada = fração zero.
  nome de pino  o binário guarda a negação (traço em cima) como 0xAF depois da letra; a
                API do Altium — e o schlib.js — mostra U+0305 (combining overline). Nome
                com barra literal ("R\\S\\T\\") é barra mesmo, nos dois lados.
  SchDoc        pinos são registros de TEXTO (RECORD=2, PinLength em 10 mil) e os filhos
                apontam para o pai por OwnerIndex = índice do pai na lista de registros
                MENOS UM (o cabeçalho é o índice 0 e não conta). Coordenadas absolutas.
  colocação     o Altium GIRA primeiro e espelha X depois: abs = espelha(gira(local)) + pos.
                O AI-GUIDE diz o contrário ("espelha X antes de rotacionar") e as duas
                ordens só coincidem em 0/180 — nos 104 componentes do DMB com
                Orientation=3 + IsMirrored=T, só a ordem gira-depois-espelha casa com o
                espelho (0 de 104 na outra). Afeta o preview do hub, não o BuildSchematic
                (que usa Orientation/IsMirrored nativos).
  IntLib        cada stream é 1 byte 0x02 + zlib; inflado é uma .SchLib inteira.
  defaults      chave ausente = valor zero/falso: LineWidth 0 (Smallest, 4 mil), IsSolid
                falso, StartAngle 0, Orientation 0, OwnerPartDisplayMode 0.

Nada aqui escreve no Altium: quem grava é o `schlib_patch.py`.
"""
import io
import json
import math
import os
import re
import struct
import sys
import zlib
from collections import OrderedDict
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
LIBS = os.path.join(RAIZ, 'Libs')
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, BASE)

import schlib_bin as SB                                # noqa: E402

LIB_PADRAO = r'Y:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib'

# LineWidth do Altium (0=Smallest .. 3=Large) -> mil, como o LineWMil do ExportLibs
LARGURA = {0: 4, 1: 10, 2: 20, 3: 30}
# Electrical 0..7 -> nome; fora da faixa o ExportLibs devolvia Passive
TIPOS = ['Input', 'IO', 'Output', 'OpenCollector', 'Passive', 'HiZ', 'OpenEmitter', 'Power']
ORIENT = (0, 90, 180, 270)
GEOMETRIA = {'2', '3', '4', '5', '6', '7', '8', '10', '11', '12', '13', '14'}
BARRA = chr(0xAF)          # 0xAF no binario: negacao em cima da letra anterior
SOBRELINHA = chr(0x305)    # como a API do Altium devolve o mesmo sinal

# ─── chaves dos registros ─────────────────────────────────────────────────────
# Arquivos antigos (Altium 6/DXP: "SCH Gerador 600.SchDoc") e o formato ASCII gravam as
# chaves em MAIÚSCULAS ("LIBREFERENCE", "LOCATION.X"); os de hoje, em CamelCase. O leitor
# fala CamelCase, então toda chave passa por aqui — nos arquivos novos é identidade.
_CANON_NOMES = (
    'RECORD', 'HEADER', 'Weight', 'MinorVersion', 'UniqueID', 'OwnerIndex', 'OwnerPartId',
    'OwnerPartDisplayMode', 'IndexInSheet', 'IsNotAccesible', 'Location.X', 'Location.Y',
    'Location.X_Frac', 'Location.Y_Frac', 'Corner.X', 'Corner.Y', 'Corner.X_Frac',
    'Corner.Y_Frac', 'Radius', 'Radius_Frac', 'SecondaryRadius', 'SecondaryRadius_Frac',
    'StartAngle', 'EndAngle', 'LineWidth', 'IsSolid', 'LocationCount', 'Text', 'Orientation',
    'FontID', 'Justification', 'IsMirrored', 'Color', 'AreaColor', 'Transparent',
    'LibReference', 'ComponentDescription', 'CurrentPartId', 'PartCount', 'DisplayModeCount',
    'DisplayMode', 'AllPinCount', 'DesignItemId', 'SourceLibraryName', 'LibraryPath',
    'PinConglomerate', 'PinLength', 'PinLength_Frac', 'Electrical', 'Name', 'Designator',
    'Description', 'FontIdCount', 'ModelName', 'ModelType', 'IsCurrent', 'IsHidden',
    'ReadOnlyState', 'SwapIDPart', 'Symbol', 'ScaleFactor', 'FormalType', 'KeyCount',
)
_CANON = {n.upper(): n for n in _CANON_NOMES}
_CANON_PREFIXO = {'X': 'X', 'Y': 'Y', 'SIZE': 'Size', 'FONTNAME': 'FontName', 'ROTATION': 'Rotation',
                  'UNDERLINE': 'Underline', 'BOLD': 'Bold', 'ITALIC': 'Italic', 'LIBREF': 'LibRef',
                  'COMPDESCR': 'CompDescr', 'PARTCOUNT': 'PartCount', 'SECTIONKEY': 'SectionKey'}
_CANON_RX = re.compile(r'^(X|Y|SIZE|FONTNAME|ROTATION|UNDERLINE|BOLD|ITALIC|LIBREF|COMPDESCR|PARTCOUNT|SECTIONKEY)(\d+)(_FRAC)?$')


def _canon(d):
    """chaves em qualquer caixa -> as CamelCase que o resto do módulo procura"""
    fora = OrderedDict()
    for k, v in d.items():
        K = k.upper()
        c = _CANON.get(K)
        if c is None:
            m = _CANON_RX.match(K)
            c = (_CANON_PREFIXO[m.group(1)] + m.group(2) + ('_Frac' if m.group(3) else '')) if m else k
        fora[c] = v
    return fora


def _texto(pl):
    """registro de texto -> OrderedDict com as chaves canônicas"""
    return _canon(SB.le_texto(pl))


# ─── números ──────────────────────────────────────────────────────────────────
def _int(v, padrao=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return padrao


def _n(v):
    """inteiro quando é inteiro — o JSON sai '100', não '100.0'"""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def _mil(inteiro, frac):
    """unidade do arquivo (10 mil) + fração assinada -> mil, com 3 casas: é o que o
    CoordToMils da API devolve (175.5907 no arquivo, 175.591 no ExportLibs).

    O empate é decidido pelo double, não pelo decimal: 390.5515 vira 390.551 e -196.8505
    vira -196.851 no schlib.js, exatamente o que round() faz sobre o valor binário.
    Conferido em 649 pinos e 978 coordenadas de gráficos da lib real; a única exceção
    é Radius ausente com _Frac=59055 (5.9055 -> o Altium deu 5.906), 0,001 mil.

    A 4ª casa existe no arquivo e é jogada fora de propósito: o vocabulário do hub é o da
    API (3 casas) e o schlib.js tem que sair byte a byte. O preço é que o schlib_patch,
    ao regravar a partir disso, muda o _Frac de 1 em cada 4 coordenadas em até 0,0005
    mil (1/20000 da grade de pino) — invisível na tolerância de 0,01 do round-trip."""
    return _n(round((inteiro * 100000 + frac) / 10000.0, 3))


def coord(d, k):
    """`Location.X` (+ `Location.X_Frac`) -> mil"""
    return _mil(_int(d.get(k)), _int(d.get(k + '_Frac')))


def _ang(d, k, padrao=0.0):
    try:
        return _n(float(d.get(k, padrao) or padrao))
    except ValueError:
        return padrao


def _w(d):
    return LARGURA.get(_int(d.get('LineWidth')), 30)


def _solid(d):
    return d.get('IsSolid') == 'T'


def _pts(d):
    n = _int(d.get('LocationCount'))
    return [[coord(d, 'X%d' % i), coord(d, 'Y%d' % i)] for i in range(1, n + 1)]


def _r3(v):
    return _n(round(v, 3))


def _amostra_arco(cx, cy, rx, ry, sa, ea, seg):
    """arco elíptico amostrado — o hub só desenha arco circular"""
    if ea <= sa:
        ea += 360
    pts = []
    for i in range(seg + 1):
        a = math.radians(sa + (ea - sa) * i / seg)
        pts.append([_r3(cx + rx * math.cos(a)), _r3(cy + ry * math.sin(a))])
    return pts


def _amostra_bezier(p, seg):
    pts = []
    for i in range(seg + 1):
        t = i / float(seg)
        u = 1 - t
        x = u ** 3 * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t ** 3 * p[3][0]
        y = u ** 3 * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t ** 3 * p[3][1]
        pts.append([_r3(x), _r3(y)])
    return pts


# ─── primitivas ───────────────────────────────────────────────────────────────
def primitiva(d, fontes, extras=True):
    """um registro de texto (OrderedDict) -> item de `graphics`, ou None se não é desenho.

    As 7 formas do hub saem iguais ao ExportLibs; o que ele ignorava (bezier, arco
    elíptico, retângulo arredondado — RECORD 5, 11, 10) vira polyline/arc/rect para não
    sumir do desenho. `extras=False` reproduz o ExportLibs à risca (é o que o teste compara)."""
    r = d.get('RECORD')
    if not extras and r in ('5', '10', '11'):
        return None
    if r == '13':
        return OrderedDict([('g', 'line'), ('x1', coord(d, 'Location.X')), ('y1', coord(d, 'Location.Y')),
                            ('x2', coord(d, 'Corner.X')), ('y2', coord(d, 'Corner.Y')), ('w', _w(d))])
    if r in ('14', '10'):
        return OrderedDict([('g', 'rect'), ('x1', coord(d, 'Location.X')), ('y1', coord(d, 'Location.Y')),
                            ('x2', coord(d, 'Corner.X')), ('y2', coord(d, 'Corner.Y')), ('solid', _solid(d))])
    if r == '12':
        return OrderedDict([('g', 'arc'), ('cx', coord(d, 'Location.X')), ('cy', coord(d, 'Location.Y')),
                            ('r', coord(d, 'Radius')), ('sa', _ang(d, 'StartAngle')),
                            ('ea', _ang(d, 'EndAngle')), ('w', _w(d))])
    if r == '11':
        cx, cy = coord(d, 'Location.X'), coord(d, 'Location.Y')
        rx, ry = coord(d, 'Radius'), coord(d, 'SecondaryRadius')
        sa, ea = _ang(d, 'StartAngle'), _ang(d, 'EndAngle')
        # "círculo" desenhado como elipse: os raios diferem por fração de mil (arredondamento
        # do Altium ao converter grade), e o hub só sabe arco circular — vale a média
        if abs(rx - ry) <= max(1.0, 0.05 * max(rx, ry)):
            return OrderedDict([('g', 'arc'), ('cx', cx), ('cy', cy), ('r', _r3((rx + ry) / 2.0)),
                                ('sa', sa), ('ea', ea), ('w', _w(d))])
        return OrderedDict([('g', 'polyline'), ('pts', _amostra_arco(cx, cy, rx, ry, sa, ea, 24)), ('w', _w(d))])
    if r == '8':
        return OrderedDict([('g', 'ellipse'), ('cx', coord(d, 'Location.X')), ('cy', coord(d, 'Location.Y')),
                            ('rx', coord(d, 'Radius')), ('ry', coord(d, 'SecondaryRadius')), ('solid', _solid(d))])
    if r == '7':
        return OrderedDict([('g', 'poly'), ('pts', _pts(d)), ('solid', _solid(d))])
    if r == '6':
        return OrderedDict([('g', 'polyline'), ('pts', _pts(d)), ('w', _w(d))])
    if r == '5':
        pts = _pts(d)
        if len(pts) == 4:
            pts = _amostra_bezier(pts, 16)
        return OrderedDict([('g', 'polyline'), ('pts', pts), ('w', _w(d))])
    if r == '4':
        fid = _int(d.get('FontID'), 1)
        return OrderedDict([('g', 'label'), ('x', coord(d, 'Location.X')), ('y', coord(d, 'Location.Y')),
                            ('text', d.get('Text', '')), ('rot', ORIENT[_int(d.get('Orientation')) & 3]),
                            ('size', (fontes or {}).get(fid, 10))])
    return None          # 3 (IEEE), 2 (pino), 34/41 (parâmetros), 44-48 (modelos)…


# ─── pinos ────────────────────────────────────────────────────────────────────
def _pino(num, nome, x, y, comp, cong, eletrico):
    return OrderedDict([('num', num), ('name', nome), ('x', _n(x)), ('y', _n(y)), ('len', _n(comp)),
                        ('orient', ORIENT[cong & 3]),
                        ('type', TIPOS[eletrico] if 0 <= eletrico < len(TIPOS) else 'Passive')])


def _texto_pino(b):
    return b.decode('cp1252', 'replace').replace(BARRA, SOBRELINHA)


_RX_BARRA = re.compile(r'(.)\\')


def nome_canonico(s):
    """as duas grafias da negação numa só: a barra literal do Altium ("R\\S\\T\\", 56 pinos
    da lib, e a única forma que aparece em SchDoc) vira a sobrelinha da API ("R̅S̅T̅").

    NÃO é aplicado no que o leitor devolve: o espelho tem que sair igual ao ExportLibs, que
    mostra a barra. Serve para quem compara nomes de pino (o fingerprint do extrair)."""
    return _RX_BARRA.sub(lambda m: m.group(1) + SOBRELINHA, str(s or ''))


def pino_binario(p, frac=None):
    """dict do `schlib_bin.le_pino` (+ (xfrac, yfrac, lenfrac) do PinFrac) -> pin do hub"""
    xf, yf, lf = frac or (0, 0, 0)
    return _pino(_texto_pino(p['designador']), _texto_pino(p['nome']),
                 _mil(p['x'], xf), _mil(p['y'], yf), _mil(p['comprimento'], lf),
                 p['conglomerado'], p['eletrico'])


def pino_texto(d):
    """RECORD=2 em texto (SchDoc) -> pin do hub"""
    return _pino(d.get('Designator', ''), d.get('Name', ''), coord(d, 'Location.X'), coord(d, 'Location.Y'),
                 coord(d, 'PinLength'), _int(d.get('PinConglomerate')), _int(d.get('Electrical'), 4))


def _le_pinfrac(dados, avisos, onde):
    """stream PinFrac -> {ordinal do pino: (xfrac, yfrac, lenfrac)}; esparso"""
    fora = {}
    try:
        regs = SB.desmonta(dados)
    except ValueError as e:
        avisos.append('%s: PinFrac ilegível (%s)' % (onde, e))
        return fora
    for tipo, pl in regs:
        if not pl or pl[0] != 0xD0 or len(pl) < 7:
            continue
        try:
            n = pl[1]
            idx = int(pl[2:2 + n])
            tam = struct.unpack('<I', pl[2 + n:6 + n])[0]
            z = zlib.decompress(pl[6 + n:6 + n + tam])
            if len(z) >= 12:
                fora[idx] = struct.unpack('<iii', z[:12])
        except (ValueError, struct.error, zlib.error) as e:
            avisos.append('%s: entrada do PinFrac ilegível (%s)' % (onde, e))
    return fora


# ─── um componente da SchLib ──────────────────────────────────────────────────
def _modo_zero(d):
    return _int(d.get('OwnerPartDisplayMode')) <= 0


def _simbolo(regs, fontes, pinfrac, com_footprints, pcblib_names, avisos, extras=True):
    cab = _texto(regs[0][1])
    nome = cab.get('LibReference', '')
    partcount = max(1, _int(cab.get('PartCount'), 2) - 1)      # o arquivo grava partes+1
    pinos, graficos, fps = [], [], []
    ordinal = 0
    for tipo, pl in regs[1:]:
        if tipo == SB.BINARIO:
            if pl[:1] != b'\x02':
                continue
            try:
                p = SB.le_pino(pl)
            except (ValueError, IndexError, struct.error) as e:
                avisos.append('%s: pino ilegível (%s)' % (nome, e))
                ordinal += 1
                continue
            if p['displaymode'] == 0:
                pinos.append((p['ownerpartid'], pino_binario(p, pinfrac.get(ordinal))))
            ordinal += 1
            continue
        d = _texto(pl)
        r = d.get('RECORD')
        if r == '45':
            if com_footprints and (d.get('ModelType') or '').upper() == 'PCBLIB':
                mn = d.get('ModelName', '')
                fps.append(OrderedDict([('name', mn),
                                        ('incurrentlib', bool(pcblib_names) and mn.lower() in pcblib_names),
                                        ('current', d.get('IsCurrent') == 'T')]))
            continue
        if r in GEOMETRIA and _modo_zero(d):
            g = primitiva(d, fontes, extras)
            if g is not None:
                graficos.append((_int(d.get('OwnerPartId'), 1), g))
    parts = []
    for parte in range(1, partcount + 1):
        # como o ExportLibs: OwnerPartId da parte, ou <= 0 (comum a todas)
        parts.append(OrderedDict([
            ('part', parte),
            ('pins', [p for o, p in pinos if o == parte or o <= 0]),
            ('graphics', [g for o, g in graficos if o == parte or o <= 0])]))
    return OrderedDict([('name', nome), ('description', cab.get('ComponentDescription', '')),
                        ('partcount', partcount), ('parts', parts), ('footprints', fps)])


def _abre(fonte):
    import olefile
    if isinstance(fonte, (bytes, bytearray)):
        return olefile.OleFileIO(io.BytesIO(bytes(fonte))), ''
    if hasattr(fonte, 'read'):
        return olefile.OleFileIO(fonte), ''
    return olefile.OleFileIO(fonte), str(fonte)


def le_fontes(cab):
    """FileHeader -> {FontID: tamanho em pontos} (o `FontManager.Size` do ExportLibs)"""
    fontes = {}
    for k, v in cab.items():
        if k.startswith('Size') and k[4:].isdigit():
            fontes[int(k[4:])] = _int(v, 10)
    return fontes


def le_schlib(fonte, com_footprints=True, pcblib_names=None, extras=True):
    """.SchLib (caminho, bytes ou BytesIO) -> {'source','generated','fontes','symbols','avisos'}

    Ordem dos símbolos = índice `LibRef0..N` do FileHeader (é a ordem do ExportLibs);
    o componente é achado pelo `LibReference` do seu RECORD=1, nunca pelo nome do storage."""
    o, source = _abre(fonte)
    avisos = []
    try:
        cab = _texto(SB.desmonta(o.openstream('FileHeader').read())[0][1])
        fontes = le_fontes(cab)
        if pcblib_names:
            pcblib_names = {str(n).lower() for n in pcblib_names}
        comps = OrderedDict()
        for s in o.listdir():
            if len(s) != 2 or s[1] != 'Data':
                continue
            onde = s[0]
            try:
                regs = SB.desmonta(o.openstream('/'.join(s)).read())
            except ValueError as e:
                avisos.append('%s: Data ilegível (%s)' % (onde, e))
                continue
            if not regs or regs[0][0] != SB.TEXTO or _texto(regs[0][1]).get('RECORD') != '1':
                continue
            pinfrac = {}
            if o.exists(onde + '/PinFrac'):
                pinfrac = _le_pinfrac(o.openstream(onde + '/PinFrac').read(), avisos, onde)
            sym = _simbolo(regs, fontes, pinfrac, com_footprints, pcblib_names, avisos, extras)
            if sym['name'] in comps:
                avisos.append('%s: LibReference repetido (storage %s ignorado)' % (sym['name'], onde))
                continue
            comps[sym['name']] = sym
    finally:
        o.close()

    symbols = []
    i = 0
    while ('LibRef%d' % i) in cab:
        ref = cab['LibRef%d' % i]
        sym = comps.pop(ref, None)
        if sym is None:
            avisos.append('%s: está no índice do FileHeader mas não tem Data' % ref)
        else:
            symbols.append(sym)
        i += 1
    for ref, sym in comps.items():        # fora do índice: vai no fim, mas vai
        avisos.append('%s: tem Data mas não está no índice do FileHeader' % ref)
        symbols.append(sym)
    return {'source': source, 'generated': agora(), 'fontes': fontes,
            'symbols': symbols, 'avisos': avisos}


def agora():
    return datetime.now().strftime('%d/%m/%Y %H:%M:%S')      # DateTimeToStr(Now) pt-BR


# ─── .IntLib ──────────────────────────────────────────────────────────────────
def le_intlib(caminho, com_footprints=True):
    """concatena os símbolos de cada SchLib embutida (só os `SchLib/*.schlib`)"""
    import olefile
    o = olefile.OleFileIO(caminho)
    fora = []
    try:
        for s in o.listdir():
            if len(s) != 2 or s[0].lower() != 'schlib' or not s[1].lower().endswith('.schlib'):
                continue
            dados = o.openstream('/'.join(s)).read()
            if dados[:1] == b'\x02':
                dados = zlib.decompress(dados[1:])
            fora.extend(le_schlib(dados, com_footprints)['symbols'])
    finally:
        o.close()
    return fora


# ─── .SchDoc ──────────────────────────────────────────────────────────────────
def _gira(x, y, rot):
    """gira anti-horário por múltiplo de 90°"""
    if rot == 90:
        return -y, x
    if rot == 180:
        return -x, -y
    if rot == 270:
        return y, -x
    return x, y


def localiza(pins, graphics, x0, y0, rot, mirror):
    """absoluto na folha -> local do símbolo: desfaz posição, espelho e rotação, nessa ordem.

    Colocar, no Altium, foi girar CCW, espelhar X e transladar (ver o cabeçalho do módulo:
    provado nos 104 componentes espelhados a 270° do DMB) — o inverso anda de trás para
    frente. Em 0/180 espelho e giro comutam, por isso a ordem só aparece em 90/270."""
    rot = ((_int(rot) % 360) + 360) % 360

    def pt(x, y):
        x, y = x - x0, y - y0
        if mirror:
            x = -x
        x, y = _gira(x, y, (360 - rot) % 360)
        return _r3(x), _r3(y)

    def ang(a):
        if mirror:
            a = (180 - a) % 360
        return _n((a - rot) % 360)

    npins = []
    for p in pins:
        q = OrderedDict(p)
        q['x'], q['y'] = pt(p['x'], p['y'])
        q['orient'] = int(ang(p['orient']))
        npins.append(q)
    ngr = []
    for g in graphics:
        h = OrderedDict(g)
        k = g['g']
        if k in ('line', 'rect'):
            h['x1'], h['y1'] = pt(g['x1'], g['y1'])
            h['x2'], h['y2'] = pt(g['x2'], g['y2'])
        elif k in ('arc', 'ellipse'):
            h['cx'], h['cy'] = pt(g['cx'], g['cy'])
            if k == 'ellipse' and rot in (90, 270):
                h['rx'], h['ry'] = g['ry'], g['rx']
            if k == 'arc':
                sa, ea = float(g['sa']), float(g['ea'])
                vao = ea - sa
                if vao <= 0:
                    vao += 360
                if vao >= 360:
                    h['sa'], h['ea'] = 0, 360          # círculo: não tem começo
                else:
                    a1, a2 = ang(sa), ang(ea)
                    if mirror:
                        a1, a2 = a2, a1                # espelho inverte o sentido
                    h['sa'] = _n(round(a1, 3))
                    h['ea'] = _n(round(a1 + vao, 3))
        elif k in ('poly', 'polyline'):
            h['pts'] = [list(pt(x, y)) for x, y in g['pts']]
        elif k == 'label':
            h['x'], h['y'] = pt(g['x'], g['y'])
            h['rot'] = int(ang(g.get('rot', 0)))
        ngr.append(h)
    return npins, ngr


def _registros_schdoc(caminho):
    """a lista de registros da folha (cabeçalho no índice 0), venha ela do OLE2 ou do
    formato ASCII ("Schematic Capture Ascii File": uma linha |CHAVE=valor|... por registro,
    que o EasyEDA e o próprio Altium exportam). Nos dois, `OwnerIndex` conta a partir do
    registro seguinte ao cabeçalho."""
    import olefile
    if olefile.isOleFile(caminho):
        o = olefile.OleFileIO(caminho)
        try:
            regs = SB.desmonta(o.openstream('FileHeader').read())
        finally:
            o.close()
        return [_texto(pl) if t == SB.TEXTO else None for t, pl in regs]
    with open(caminho, 'rb') as f:
        bruto = f.read()
    if b'Schematic Capture Ascii File' not in bruto[:300]:
        raise ValueError('nem OLE2 nem ASCII do Altium')
    return [_texto(l.rstrip(b'\r')) for l in bruto.split(b'\n') if l.strip()]


def le_schdoc(caminho):
    """componentes colocados numa folha, já em coordenadas LOCAIS do símbolo.

    Uma entrada por (componente, parte) que tem geometria — o Altium só grava na folha a
    parte colocada, então normalmente é uma. Só o modo de exibição 0, como no espelho."""
    txt = _registros_schdoc(caminho)
    filhos = {}
    for j, d in enumerate(txt):
        if d is not None and 'OwnerIndex' in d:
            filhos.setdefault(_int(d['OwnerIndex'], -2) + 1, []).append(d)
    # as fontes da folha moram no RECORD=31 (o cabeçalho, índice 0, só tem HEADER/Weight)
    folha = next((d for d in txt if d is not None and d.get('RECORD') == '31'), None)
    fontes = le_fontes(folha) if folha else {}
    fora = []
    for i, d in enumerate(txt):
        if d is None or d.get('RECORD') != '1' or i == 0:
            continue
        x0, y0 = coord(d, 'Location.X'), coord(d, 'Location.Y')
        rot = ORIENT[_int(d.get('Orientation')) & 3]
        mirror = d.get('IsMirrored') == 'T'
        atual = _int(d.get('CurrentPartId'), 1)
        partcount = max(1, _int(d.get('PartCount'), 2) - 1)
        designador = ''
        pinos, graficos = [], []
        for f in filhos.get(i, []):
            r = f.get('RECORD')
            if r == '34':
                designador = f.get('Text', '')
            elif r == '2' and _modo_zero(f):
                pinos.append((_int(f.get('OwnerPartId'), 1), pino_texto(f)))
            elif r in GEOMETRIA and _modo_zero(f):
                g = primitiva(f, fontes)
                if g is not None:
                    graficos.append((_int(f.get('OwnerPartId'), 1), g))
        partes = sorted({o for o, _ in pinos + graficos if o > 0}) or [atual]
        for parte in partes:
            pins, graphics = localiza([p for o, p in pinos if o == parte or o <= 0],
                                      [g for o, g in graficos if o == parte or o <= 0],
                                      x0, y0, rot, mirror)
            fora.append(OrderedDict([
                ('ref', d.get('LibReference', '')), ('designator', designador), ('part', parte),
                ('partcount', partcount), ('current', parte == atual),
                ('x', x0), ('y', y0), ('rot', rot), ('mirror', mirror),
                ('pins', pins), ('graphics', graphics)]))
    return fora


# ─── espelho (Libs/schlib.js) ─────────────────────────────────────────────────
def _js(s):
    """o JS() do ExportLibs: escapa aspas/barra/controle e tudo fora do ASCII como \\uXXXX
    (o schlib.js real tem "~" literal, então o corte é em 126 e não nos 125 do .pas de hoje)"""
    fora = ['"']
    for c in str(s):
        n = ord(c)
        if c == '"':
            fora.append('\\"')
        elif c == '\\':
            fora.append('\\\\')
        elif n == 8:
            fora.append('\\b')
        elif n == 9:
            fora.append('\\t')
        elif n == 10:
            fora.append('\\n')
        elif n == 12:
            fora.append('\\f')
        elif n == 13:
            fora.append('\\r')
        elif n < 32 or n > 126:
            if n > 0xFFFF:
                n -= 0x10000
                fora.append('\\u%04X\\u%04X' % (0xD800 + (n >> 10), 0xDC00 + (n & 0x3FF)))
            else:
                fora.append('\\u%04X' % n)
        else:
            fora.append(c)
    fora.append('"')
    return ''.join(fora)


def _jf(v):
    """o FloatToStr do Delphi: 15 dígitos significativos, sem zeros à direita"""
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    s = '%.15g' % v
    if 'e' in s or 'E' in s:
        s = ('%.15f' % v).rstrip('0').rstrip('.')
    return s


def _jv(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return _jf(v)
    if isinstance(v, str):
        return _js(v)
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(_jv(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(_js(k) + ':' + _jv(x) for k, x in v.items()) + '}'
    if v is None:
        return 'null'
    return _js(str(v))


def simbolo_json(sym):
    """um símbolo numa linha, com as chaves na ordem do ExportLibs"""
    partes = []
    for p in sym.get('parts') or []:
        partes.append('{"part":%d,"pins":[%s],"graphics":[%s]}' % (
            _int(p.get('part'), 1),
            ','.join(_jv(q) for q in p.get('pins') or []),
            ','.join(_jv(g) for g in p.get('graphics') or [])))
    fps = ['{"name":%s,"incurrentlib":%s,"current":%s}' % (
        _js(f.get('name', '')), _jv(bool(f.get('incurrentlib'))), _jv(bool(f.get('current'))))
        for f in sym.get('footprints') or []]
    return ('{"name":%s,"description":%s,"partcount":%d,"parts":[%s],"footprints":[%s]}' % (
        _js(sym.get('name', '')), _js(sym.get('description', '')),
        _int(sym.get('partcount'), 1), ','.join(partes), ','.join(fps)))


def _sem_footprint(sym):
    """motivo do relatório, ou None quando o símbolo tem footprint na PcbLib"""
    fps = sym.get('footprints') or []
    if any(f.get('incurrentlib') for f in fps):
        return None
    return 'modelo aponta p/ footprint fora da PcbLib' if fps else 'sem modelo de footprint'


def _aplica_pcblib(lib, pcblib_names):
    if pcblib_names is None:
        return
    baixos = {str(n).lower() for n in pcblib_names}
    for sym in lib['symbols']:
        for f in sym.get('footprints') or []:
            f['incurrentlib'] = f.get('name', '').lower() in baixos


def espelho(schlib_json, pcblib_names=None):
    """dict do le_schlib -> texto do Libs/schlib.js (um símbolo por linha, CRLF, ASCII)"""
    _aplica_pcblib(schlib_json, pcblib_names)
    syms = schlib_json['symbols']
    linhas = ['var schlib = {', '"format":"schlib-v2",',
              '"generated":' + _js(schlib_json.get('generated') or agora()) + ',',
              '"source":' + _js(schlib_json.get('source', '')) + ',',
              '"units":"mil",', '"symbols":[']
    for i, sym in enumerate(syms):
        linhas.append((',' if i else '') + simbolo_json(sym))
    linhas.append('],')
    linhas.append('"stats":{"symbols":%d,"nofootprint":%d}' % (
        len(syms), sum(1 for s in syms if _sem_footprint(s))))
    linhas.append('};')
    return '\r\n'.join(linhas) + '\r\n'


def relatorio(schlib_json, pcblib_names=None):
    """o Libs/libs-report.txt do ExportLibs"""
    _aplica_pcblib(schlib_json, pcblib_names)
    syms = schlib_json['symbols']
    faltam = [(s['name'], _sem_footprint(s)) for s in syms if _sem_footprint(s)]
    linhas = ['AltiumPCBMirror - relatorio das bibliotecas',
              'Data: ' + (schlib_json.get('generated') or agora()),
              'Simbolos: %d   Footprints: %d' % (len(syms), len(pcblib_names or ())), '',
              'Simbolos SEM footprint valido na PcbLib (%d):' % len(faltam)]
    linhas += ['%s (%s)' % (n, m) for n, m in faltam]
    return '\r\n'.join(linhas) + '\r\n'


def nomes_pcblib(caminho=None):
    """nomes dos footprints do Libs/pcblib.js (um por linha, como o ExportLibs escreve)"""
    caminho = caminho or os.path.join(LIBS, 'pcblib.js')
    nomes = set()
    if not os.path.exists(caminho):
        return nomes
    rx = re.compile(r'^,?\{"name":("(?:[^"\\]|\\.)*")')
    with open(caminho, encoding='utf-8', errors='replace') as f:
        for linha in f:
            m = rx.match(linha)
            if m:
                nomes.add(json.loads(m.group(1)))
    return nomes


def caminho_lib():
    """a SchLib real: o config.json da extração manda; sem ele, o caminho da casa"""
    cfg = os.path.join(BASE, 'config.json')
    try:
        with open(cfg, encoding='utf-8') as f:
            return json.load(f).get('schlib') or LIB_PADRAO
    except (OSError, ValueError):
        return LIB_PADRAO


def _grava(caminho, texto):
    tmp = caminho + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='') as f:
        f.write(texto)
    os.replace(tmp, caminho)


# ─── CLI ──────────────────────────────────────────────────────────────────────
def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='lê símbolos do Altium sem abrir o Altium')
    ap.add_argument('--espelho', action='store_true', help='regera Libs/schlib.js a partir da SchLib real')
    ap.add_argument('--lib', help='caminho da .SchLib (default: config.json ou a lib da casa)')
    ap.add_argument('--saida', help='onde escrever o espelho (default: Libs/schlib.js)')
    ap.add_argument('--pcblib', help='Libs/pcblib.js para o crosscheck dos footprints')
    ap.add_argument('--dump', metavar='ARQUIVO', help='imprime o JSON dos componentes (.SchDoc/.SchLib/.IntLib)')
    a = ap.parse_args(argv)

    if a.dump:
        ext = os.path.splitext(a.dump)[1].lower()
        if ext == '.schdoc':
            obj = le_schdoc(a.dump)
        elif ext == '.intlib':
            obj = le_intlib(a.dump)
        else:
            obj = le_schlib(a.dump)
        print(json.dumps(obj, ensure_ascii=False, indent=1))
        return 0

    if a.espelho:
        lib = a.lib or caminho_lib()
        saida = a.saida or os.path.join(LIBS, 'schlib.js')
        nomes = nomes_pcblib(a.pcblib)
        dados = le_schlib(lib, pcblib_names=nomes)
        _grava(saida, espelho(dados, nomes))
        rel = os.path.join(os.path.dirname(os.path.abspath(saida)), 'libs-report.txt')
        _grava(rel, relatorio(dados, nomes))
        for av in dados['avisos']:
            print('aviso:', av)
        print('%d simbolos -> %s (%d sem footprint; relatorio em %s)' % (
            len(dados['symbols']), saida, sum(1 for s in dados['symbols'] if _sem_footprint(s)), rel))
        return 0

    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
