# -*- coding: utf-8 -*-
"""Lê o .PcbDoc do Altium direto do arquivo e monta o board.js (pcbmirror-v1), sem o Altium.

É o `ExportBoard.pas` do lado de fora: o mesmo board.js que a vista PCB desenha, lido dos
registros binários com o `olefile`. Serve para importar placa sem o Altium (a migração) e para o
teste de ouro do Gerber (placa lida do PcbDoc da MESMA revisão do X2 do Altium -> Gerber do hub
-> comparado camada a camada). A linha de comando é o `pcbdoc2board.py`, ao lado.

A prova é a comparação item a item com board.js que o ExportBoard gerou do mesmo estado da placa
(o DMB v91 e mais 9 projetos de Projects/ cujo PcbDoc não mudou depois do export): saem IGUAIS,
número a número, 337/337 componentes (bbox inclusive), 1.292 pads, 26 pads soltos, 3.785
trilhas, 313 vias, 1.904 regions, 20 recortes, as nets, o contorno e a caixa das 10 placas, e
19.867 de 19.883 linhas de silk; 507 de 595 textos com o centro exato e os outros 88 a até
0,00001 mm. O que sobra está em "Limites", lá embaixo.

O que foi apurado nos arquivos (e onde o que se sabia estava errado ou incompleto):

  unidade       1/10000 mil, coordenada absoluta; o board.js é relativo a ORIGINX/ORIGINY do
                Board6. O CoordToMMs do Altium faz a conta em double e arredonda o double em 5
                casas: nos empates exatos da 6a casa (v = 250 mod 500) o erro do double decide
                e sai para baixo -- round(v*0.0254/10000, 5) reproduz 133.470 de 133.470
                coordenadas; arredondar o decimal exato erra os 9 empates. O número sai pelo
                FloatToStr do Delphi (15 dígitos, '-1E-5' abaixo de 1e-4).
  registros     [u8 tipo][u32 tam][payload] (Tracks6, Arcs6, Vias6, Fills6, Regions6...); pad =
                6 blocos (nome pascal, ..., o registro no 5o, tamanho/forma por camada no 6o);
                texto = 2 blocos (o registro + a string pascal latin-1). O texto Unicode vem do
                WideStrings6 pelo índice do byte 115, MAS pascal vazio manda: nos 2 casos do
                acervo em que divergem o WideStrings traz lixo e o Altium mostra vazio.
  camada        byte 0 do registro (o TLayer: 1 Top, 2..31 Mid, 32 Bottom, 33..38 overlay/
                pasta/máscara, 39..54 planos, 55 DrillGuide, 56 KeepOut, 57..72 Mech, 73
                DrillDrawing, 74 Multi) e o id V7 no fim do registro (tam-8 em trilha/arco/fill,
                +114 no pad), que manda e é o único que diz Mech17+. Region: o V7_LAYER das
                propriedades manda -- Board Cutout grava LAYER=KEEPOUT e a API o vê na Multi.
  ordem         O iterador do ExportBoard anda por TIPO na ordem do ObjectId (arco, via,
                trilha, texto, polígono, region) e, dentro do tipo, camada por camada (TLayer
                crescente), na ordem do stream dentro da camada: o silk do MID sai arcos Top,
                arcos Bottom, linhas Top, linhas Bottom. Componentes e pads soltos (filtro
                AllLayers) saem na ordem do stream, sem separar camada. Os ids c/p/t/a/v/x/s/g/k
                saem daí; o que o ExportBoard de hoje não lê (camadas novas, fills) vem numa 2a
                passada depois, para os ids de hoje não mudarem (contrato 2026-10).
  bbox comp.    BoundingRectangleNoNameCommentForSignals = pads (a forma de cada lado da
                pilha) + trilhas, arcos, fills e regions do componente em TODAS as camadas; sem
                textos e sem corpos 3D. Bate em 337 de 337 componentes.
  texto         O registro guarda o retângulo de seleção que o Altium calculou: largura 124,
                altura 128, justificação 132 (1..9, esquerda-cima .. direita-baixo), o ponto
                244/248 e, no byte 240, se ele vale. O centro do board.js sai dele, exato, sem
                métrica de fonte (conta inteira, meia largura por divisão inteira: 479 de 479).
                Byte 240 = 0 só em texto de footprint nunca redesenhado: aí o
                ponto é a âncora e o tamanho ainda vale (tinta + 1 traço de cada lado); a
                tinta começa na âncora, na linha de base (o '+' sobe 1/6), e no TrueType o
                centro fica 1,0184% da altura abaixo do meio. Byte 230 = moldura (text frame).
                A fonte stroke tem a maiúscula com 0,999676 da altura.
  regions       Regions6 traz os vértices em double (e os furos); ShapeBasedRegions6 os mesmos
                objetos com arcos. BoardRegions (storage próprio) é a forma da placa ("Layer
                Stack Region"), gravada como se fosse Board Cutout: no board.js vai para
                cutouts com kindn -1, para não se misturar com furo de verdade (3) nem com
                recorte de polígono (1).
  contorno      KINDn/VXn/VYn/CXn/... do Board6, fechado repetindo o 1o vértice. A caixa da
                placa sai da geometria de cada segmento (o arco pelo centro/raio/ângulos): o
                vértice gravado de um arco pode estar 1 unidade fora do arco e o Altium não o
                conta (PRJ - DI261930).
  strings       '.Revisao' e cia. são parâmetros do .PrjPcb do projeto (mesma pasta ou até duas
                acima, o que cita o PcbDoc no DocumentPath); .Designator/.Comment, do dono. A
                que fica sem valor (PcbDoc copiado sem o .PrjPcb) vai crua para o board.js, e
                vira aviso: o Gerber do hub a escreveria assim na serigrafia.
  nets          a TStringList.Sorted do Delphi: CompareString do Windows (hífen e apóstrofo
                fora do 1o nível, símbolo < dígito < letra, sem caixa): "-15V" cai entre "0V" e
                "3V3", "NetC1_2" antes de "NetC10_+".
  regras        Rules6 (prefixo de 2 bytes): a regra habilitada de menor PRIORITY cujo escopo 1
                casa com o objeto (All, IsPad, IsVia, InNet, InComponent, HasFootprint, OnLayer,
                InNetClass, InComponentClass, InPadClass, and/or/not). Nenhuma casa: o padrão
                de fábrica (máscara 4 mil, pasta 0) e um aviso.
  TrueType      texts[].polys = o contorno do glifo pela fonte do Windows (fontTools): escala =
                altura / (usWinAscent + usWinDescent), âncora no canto esquerdo da TINTA e na
                linha de base. Contra as 139 regiões da legenda do X2 do DMB: 105 escuras + 34
                furos, IoU 0,981 (raster 0,005 mm; mín. 0,977) nos 30 rótulos.

Limites (medidos):
  * Texto de footprint com o retângulo vencido (byte 240 = 0): o centro sai a até 0,00001 mm do
    ExportBoard (o Altium arredonda a caixa a partir da tinta em double; o registro só guarda o
    tamanho já arredondado). Todo o resto dos textos sai igual. Registro antigo (230 bytes,
    antes do AD 2013) não tem o retângulo: o centro é estimado pela fonte stroke.
  * Membros de union (retângulo paramétrico, SmartUnions) podem sair em outra ordem que a do
    ExportBoard: 16 linhas de 1.518 no SD, mesma geometria, ids trocados entre si. A ordem em
    memória do Altium não está no arquivo.
  * kindn: o inteiro de Kind() da API não pôde ser conferido daqui. Uso 1 = recorte de polígono,
    2 = named region, 3 = Board Cutout, 4 = cavidade (a ordem do TRegionKind), -1 = forma da placa.
  * Cor de camada não está no PcbDoc (fica na configuração de vista do Altium): layers[] sai sem
    "color".
  * PcbDoc em formato ASCII (23 do acervo, exportações para JLC/EasyEDA) não é lido: erro claro.
"""
import io
import math
import os
import re
import struct
import sys
import zipfile
from collections import OrderedDict
from datetime import datetime

VERSAO = '2026-10-02'
EXPORTER = 'pcbdoc2board ' + VERSAO
FORMATO = 'pcbmirror-v1'
ORIGIN_NOTE = ('coordenadas em mm relativas a origem da placa (Board.XOrigin/YOrigin), Y para cima - '
               'identicas ao PCB List / Properties do Altium')


class PcbDocErro(Exception):
    """arquivo que nao da para ler (formato, contêiner, registro truncado)"""


# ─── camadas ──────────────────────────────────────────────────────────────────
# byte de camada do registro (o TLayer do Altium) -> chave do contrato (HubCore.PCB_LAYERS)
CAMADA_V6 = {1: 'Top', 32: 'Bottom', 33: 'TopOverlay', 34: 'BottomOverlay', 35: 'TopPaste',
             36: 'BottomPaste', 37: 'TopSolder', 38: 'BottomSolder', 55: 'DrillGuide', 56: 'KeepOut',
             73: 'DrillDrawing', 74: 'Multi'}
for _n in range(2, 32):
    CAMADA_V6[_n] = 'Mid%d' % (_n - 1)
for _n in range(39, 55):
    CAMADA_V6[_n] = 'Plane%d' % (_n - 38)
for _n in range(57, 73):
    CAMADA_V6[_n] = 'Mech%d' % (_n - 56)
# o numero do TLayer de cada chave: e a ordem em que o iterador do Altium visita as camadas
NUM_CAMADA = {v: k for k, v in CAMADA_V6.items()}
V7_ESPECIAL = {6: 'TopOverlay', 7: 'BottomOverlay', 8: 'TopPaste', 9: 'BottomPaste', 10: 'TopSolder',
               11: 'BottomSolder', 12: 'DrillGuide', 13: 'KeepOut', 14: 'DrillDrawing', 15: 'Multi'}
CAMADA_TXT = {'TOP': 'Top', 'BOTTOM': 'Bottom', 'TOPOVERLAY': 'TopOverlay', 'BOTTOMOVERLAY': 'BottomOverlay',
              'TOPPASTE': 'TopPaste', 'BOTTOMPASTE': 'BottomPaste', 'TOPSOLDER': 'TopSolder',
              'BOTTOMSOLDER': 'BottomSolder', 'DRILLGUIDE': 'DrillGuide', 'KEEPOUT': 'KeepOut',
              'DRILLDRAWING': 'DrillDrawing', 'MULTILAYER': 'Multi'}
NOME_PADRAO = {'Top': 'Top Layer', 'Bottom': 'Bottom Layer', 'TopOverlay': 'Top Overlay',
               'BottomOverlay': 'Bottom Overlay', 'TopPaste': 'Top Paste', 'BottomPaste': 'Bottom Paste',
               'TopSolder': 'Top Solder', 'BottomSolder': 'Bottom Solder', 'DrillGuide': 'Drill Guide',
               'KeepOut': 'Keep-Out Layer', 'DrillDrawing': 'Drill Drawing', 'Multi': 'Multi-Layer'}


def camada_v7(lid):
    """id de camada V7 (u32) -> chave; None se nao e camada de desenho"""
    hi, lo = lid >> 16, lid & 0xFFFF
    if hi == 0x0100:
        return 'Top' if lo == 1 else ('Bottom' if lo == 0xFFFF else 'Mid%d' % (lo - 1))
    if hi == 0x0101:
        return 'Plane%d' % lo
    if hi == 0x0102:
        return 'Mech%d' % lo
    if hi == 0x0103:
        return V7_ESPECIAL.get(lo)
    return None


def camada_txt(s):
    """'TOP', 'MID1', 'MECHANICAL13', 'MULTILAYER' -> chave"""
    u = (s or '').strip().upper()
    if u in CAMADA_TXT:
        return CAMADA_TXT[u]
    m = re.match(r'^MID(?:LAYER)?(\d+)$', u)
    if m:
        return 'Mid%d' % int(m.group(1))
    m = re.match(r'^(?:PLANE|INTERNALPLANE)(\d+)$', u)
    if m:
        return 'Plane%d' % int(m.group(1))
    m = re.match(r'^MECHANICAL(\d+)$', u)
    if m:
        return 'Mech%d' % int(m.group(1))
    return None


def ordem_camada(chave):
    """posicao da camada na volta do iterador (o numero do TLayer; Mech17+ no fim)"""
    if chave in NUM_CAMADA:
        return NUM_CAMADA[chave]
    m = re.match(r'^Mech(\d+)$', chave or '')
    if m:
        return 1000 + int(m.group(1))
    return 2000


def eh_cobre(chave):
    return chave in ('Top', 'Bottom') or bool(re.match(r'^(Mid|Plane)\d+$', chave or ''))


def eh_overlay(chave):
    return chave in ('TopOverlay', 'BottomOverlay')


# ─── numeros: o CoordToMMs e o FloatToStr do Delphi ──────────────────────────
def mm(v):
    """unidade interna (1/10000 mil) -> mm em 5 casas: o CoordToMMs do Altium.

    O Altium faz a conta em ponto flutuante e arredonda o double: nos empates exatos da 6a
    casa (v = 250 mod 500, 9 em 133.470 coordenadas dos board.js medidos) o erro do double
    decide, e o resultado sai para baixo. round(v*0.0254/10000, 5) reproduz os 133.470;
    arredondar o decimal exato (meio para cima ou par) erra exatamente os 9 empates."""
    return round(int(round(v)) * 0.0254 / 10000, 5)


def mm_cru(v):
    """unidade interna -> mm sem arredondar (para medir, nao para o board.js)"""
    return v * 0.0254 / 10000.0


def unid(mil_txt, padrao=0):
    """'24895mil' / '1.5mm' / '123' (mil) -> unidade interna (int)"""
    if mil_txt is None:
        return padrao
    s = mil_txt.strip()
    try:
        if s.lower().endswith('mil'):
            return int(round(float(s[:-3]) * 10000))
        if s.lower().endswith('mm'):
            return int(round(float(s[:-2]) / 0.0254 * 10000))
        return int(round(float(s) * 10000))
    except ValueError:
        return padrao


def jf(v):
    """FloatToStr do Delphi: ffGeneral com 15 digitos, sem zeros a direita; notacao
    cientifica quando o expoente sai de [-4, 15) ('-1E-5', como o ExportBoard escreveu)."""
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if v != v or v in (float('inf'), float('-inf')):
        return '0'
    if v == 0:
        return '0'
    s = '%.14e' % v
    mant, ex = s.split('e')
    ex = int(ex)
    neg = mant.startswith('-')
    dig = mant.replace('-', '').replace('.', '').rstrip('0') or '0'
    e10 = ex + 1                     # valor = 0.d1d2... x 10^e10
    if e10 > 15 or e10 < -3:
        txt = dig[0] + ('.' + dig[1:] if len(dig) > 1 else '') + 'E' + ('-' if ex < 0 else '') + str(abs(ex))
    elif e10 <= 0:
        txt = '0.' + '0' * (-e10) + dig
    elif len(dig) <= e10:
        txt = dig + '0' * (e10 - len(dig))
    else:
        txt = dig[:e10] + '.' + dig[e10:]
    return ('-' if neg else '') + txt


def js(s):
    """o JS() do ExportBoard.pas: aspas/barra/controles escapados e tudo fora de 32..125
    como \\uXXXX (hex maiusculo, por unidade UTF-16 -- o Delphi guarda a string assim)"""
    fora = ['"']
    b = (s or '').encode('utf-16-le')
    for i in range(0, len(b), 2):
        n = b[i] | (b[i + 1] << 8)
        c = chr(n) if n < 0xD800 or n > 0xDFFF else None
        if n == 34:
            fora.append('\\"')
        elif n == 92:
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
        elif n < 32 or n > 125:
            fora.append('\\u%04X' % n)
        else:
            fora.append(c)
    fora.append('"')
    return ''.join(fora)


def jv(v):
    """valor -> JSON no estilo do ExportBoard (sem espacos)"""
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return jf(v)
    if isinstance(v, str):
        return js(v)
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(jv(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(js(k) + ':' + jv(x) for k, x in v.items()) + '}'
    if v is None:
        return 'null'
    return js(str(v))


# ─── binario ──────────────────────────────────────────────────────────────────
def _u16(b, o):
    return struct.unpack_from('<H', b, o)[0]


def _i32(b, o):
    return struct.unpack_from('<i', b, o)[0]


def _u32(b, o):
    return struct.unpack_from('<I', b, o)[0]


def _f64(b, o):
    return struct.unpack_from('<d', b, o)[0]


def _pascal(b):
    """string pascal (1 byte de tamanho + latin-1)"""
    if not b:
        return ''
    n = b[0]
    return b[1:1 + n].decode('latin-1')


def props(b):
    """'|K=V|K=V' (latin-1, NUL no fim) -> dict com chaves em maiusculas; a 1a ocorrencia
    vence (o Board6 repete chaves genericas). %UTF8%K traz a versao UTF-8 de K e manda."""
    if isinstance(b, (bytes, bytearray)):
        s = bytes(b).split(b'\x00')[0].decode('latin-1')
    else:
        s = b
    out = {}
    utf = {}
    for tok in s.split('|'):
        if '=' not in tok:
            continue
        k, v = tok.split('=', 1)
        k = k.strip().upper()
        if k.startswith('%UTF8%'):
            try:
                utf[k[6:]] = v.encode('latin-1').decode('utf-8')
            except UnicodeError:
                pass
            continue
        if k not in out:
            out[k] = v
    out.update(utf)
    return out


def _bool(s):
    return str(s or '').strip().upper() == 'TRUE'


def _num(s, padrao=0.0):
    try:
        return float(str(s).strip())
    except (TypeError, ValueError):
        return padrao


def it_simples(d, nome=''):
    """[u8 tipo][u32 tam][payload]"""
    i, n = 0, len(d)
    while i < n:
        if i + 5 > n:
            raise PcbDocErro('%s: registro truncado no byte %d' % (nome, i))
        t = d[i]
        ln = _u32(d, i + 1)
        if ln > n - i - 5:
            raise PcbDocErro('%s: registro truncado no byte %d (tamanho %d)' % (nome, i, ln))
        yield t, d[i + 5:i + 5 + ln]
        i += 5 + ln


def it_blocos(d, nblocos, nome=''):
    """[u8 tipo] + nblocos x ([u32 tam][bloco])  (pads: 6 blocos; textos: 2)"""
    i, n = 0, len(d)
    while i < n:
        t = d[i]
        i += 1
        bl = []
        for _ in range(nblocos):
            if i + 4 > n:
                raise PcbDocErro('%s: registro truncado no byte %d' % (nome, i))
            ln = _u32(d, i)
            i += 4
            if ln > n - i:
                raise PcbDocErro('%s: bloco truncado no byte %d (tamanho %d)' % (nome, i, ln))
            bl.append(d[i:i + ln])
            i += ln
        yield t, bl


def it_props(d, prefixo=0):
    """[prefixo][u32 tam][props]  (Components6, Nets6, Polygons6, Classes6: 0; Rules6: 2)"""
    i, n = 0, len(d)
    while i + prefixo + 4 <= n:
        i += prefixo
        ln = _u32(d, i) & 0x00FFFFFF
        i += 4
        yield d[i:i + ln]
        i += ln


# ─── contêiner ────────────────────────────────────────────────────────────────
def olefile_ou_erro():
    try:
        import olefile
        return olefile
    except ImportError:
        raise PcbDocErro('falta o modulo olefile, que le o .PcbDoc do Altium.\n'
                         'Instale no MESMO Python:\n    "%s" -m pip install olefile' % sys.executable)


def abre(fonte):
    """caminho (.PcbDoc, .PcbDoc.Zip do History, .zip) ou bytes -> (bytes do PcbDoc, rotulo)"""
    if isinstance(fonte, (bytes, bytearray)):
        dados, rotulo = bytes(fonte), ''
    else:
        rotulo = str(fonte)
        with open(fonte, 'rb') as f:              # so leitura
            dados = f.read()
    if dados[:4] == b'PK\x03\x04':
        with zipfile.ZipFile(io.BytesIO(dados)) as z:
            nomes = [n for n in z.namelist() if n.lower().endswith('.pcbdoc')]
            if not nomes:
                raise PcbDocErro('o zip nao tem .PcbDoc dentro: %s' % rotulo)
            dados = z.read(nomes[0])
    return dados, rotulo


class Arquivo(object):
    """os streams do .PcbDoc (OLE2)"""

    def __init__(self, dados):
        if dados[:8] != bytes.fromhex('d0cf11e0a1b11ae1'):
            if dados.lstrip(b'\xef\xbb\xbf')[:8].startswith(b'|RECORD'):
                raise PcbDocErro('PcbDoc em formato ASCII: este leitor so le o binario (salve como '
                                 'binario no Altium)')
            raise PcbDocErro('nao e um .PcbDoc (assinatura %r)' % dados[:8])
        ole = olefile_ou_erro()
        self.ole = ole.OleFileIO(io.BytesIO(dados))
        self._cache = {}

    def stream(self, nome):
        if nome not in self._cache:
            try:
                self._cache[nome] = self.ole.openstream(nome).read() if self.ole.exists(nome) else b''
            except Exception:
                self._cache[nome] = b''
        return self._cache[nome]

    def dados(self, storage):
        return self.stream(storage + '/Data')

    def cabecalho(self, storage):
        d = self.stream(storage + '/Header')
        return _u32(d, 0) if len(d) >= 4 else None

    def fecha(self):
        try:
            self.ole.close()
        except Exception:
            pass


# ─── registros ────────────────────────────────────────────────────────────────
def _camada(byte, v7=None):
    """byte do registro + id V7 (quando o registro traz) -> chave. O V7 manda: e ele que
    diz Mech17+; nos 444 arquivos do acervo ele nunca divergiu do byte."""
    if v7 is not None and (v7 >> 24) == 1:
        k = camada_v7(v7)
        if k:
            return k
    return CAMADA_V6.get(byte, 'L%d' % byte)


def le_trilha(p):
    v7 = _u32(p, len(p) - 8) if len(p) >= 45 else None
    return {'camada': _camada(p[0], v7), 'f1': p[1], 'f2': p[2], 'net': _u16(p, 3), 'poly': _u16(p, 5),
            'comp': _u16(p, 7), 'x1': _i32(p, 13), 'y1': _i32(p, 17), 'x2': _i32(p, 21), 'y2': _i32(p, 25),
            'w': _i32(p, 29)}


def le_arco(p):
    v7 = _u32(p, len(p) - 8) if len(p) >= 56 else None
    return {'camada': _camada(p[0], v7), 'f1': p[1], 'f2': p[2], 'net': _u16(p, 3), 'poly': _u16(p, 5),
            'comp': _u16(p, 7), 'cx': _i32(p, 13), 'cy': _i32(p, 17), 'r': _i32(p, 21), 'sa': _f64(p, 25),
            'ea': _f64(p, 33), 'w': _i32(p, 41)}


def le_fill(p):
    v7 = _u32(p, len(p) - 8) if len(p) >= 45 else None
    return {'camada': _camada(p[0], v7), 'f1': p[1], 'f2': p[2], 'net': _u16(p, 3), 'comp': _u16(p, 7),
            'x1': _i32(p, 13), 'y1': _i32(p, 17), 'x2': _i32(p, 21), 'y2': _i32(p, 25), 'rot': _f64(p, 29)}


def le_via(p):
    v = {'camada': 'Multi', 'f1': p[1], 'f2': p[2], 'net': _u16(p, 3), 'x': _i32(p, 13), 'y': _i32(p, 17),
         'd': _i32(p, 21), 'furo': _i32(p, 25), 'de': CAMADA_V6.get(p[29], 'L%d' % p[29]),
         'ate': CAMADA_V6.get(p[30], 'L%d' % p[30]), 'sm_manual': None, 'sm': None, 'modo': 0}
    if len(p) > 74:
        v['sm'] = _i32(p, 54)
        v['sm_manual'] = bool(p[66] & 0x02)
        v['modo'] = p[74]
    return v


def le_pad(bl):
    """6 blocos: [0] nome (pascal), [4] o registro, [5] tamanho/forma por camada (>= 596)"""
    p, s6 = bl[4], bl[5]
    if len(p) < 114:
        raise PcbDocErro('pad com registro curto (%d bytes)' % len(p))
    v7 = _u32(p, 114) if len(p) >= 118 else None
    d = {'nome': _pascal(bl[0]), 'camada': _camada(p[0], v7), 'f1': p[1], 'f2': p[2], 'net': _u16(p, 3),
         'comp': _u16(p, 7), 'x': _i32(p, 13), 'y': _i32(p, 17),
         'tx': _i32(p, 21), 'ty': _i32(p, 25), 'mx': _i32(p, 29), 'my': _i32(p, 33),
         'bx': _i32(p, 37), 'by': _i32(p, 41), 'furo': _i32(p, 45),
         'ftop': p[49], 'fmid': p[50], 'fbot': p[51], 'rot': _f64(p, 52), 'metal': p[60] != 0,
         'modo': p[62], 'pm_val': _i32(p, 86), 'sm_val': _i32(p, 90), 'pm_modo': p[101], 'sm_modo': p[102],
         'furo_rot': _f64(p, 106), 'tipo_furo': 0, 'slot': 0, 'slot_rot': 0.0, 'alt': None, 'raio': None,
         'offs': None}
    if len(s6) >= 596:
        d['tipo_furo'] = s6[262]
        d['slot'] = _i32(s6, 263)
        d['slot_rot'] = _f64(s6, 267)
        d['offs'] = (struct.unpack_from('<32i', s6, 275), struct.unpack_from('<32i', s6, 403))
        d['alt'] = s6[532:564]
        d['raio'] = s6[564:596]
    return d


def le_largas(d):
    """WideStrings6: o texto Unicode de cada string, pelo indice que o registro do texto guarda.
    Binario ([u32 indice][u32 bytes][UTF-16 com NUL]) nos arquivos de hoje; nos antigos e um
    registro de propriedades ENCODEDTEXTn=codigos,separados,por,virgula."""
    out = {}
    if not d:
        return out
    if b'ENCODEDTEXT' in d[:64]:
        for k, v in props(d[4:]).items():
            m = re.match(r'^ENCODEDTEXT(\d+)$', k)
            if m:
                try:
                    out[int(m.group(1))] = ''.join(chr(int(x)) for x in v.split(',') if x.strip())
                except ValueError:
                    out[int(m.group(1))] = v
        return out
    i = 0
    while i + 8 <= len(d):
        idx, ln = struct.unpack_from('<II', d, i)
        i += 8
        if ln > len(d) - i:
            break
        out[idx] = d[i:i + ln].decode('utf-16-le', 'replace').rstrip('\x00')
        i += ln
    return out


def le_texto(bl, largas):
    s1, s2 = bl[0], (bl[1] if len(bl) > 1 else b'')
    if len(s1) < 40:
        raise PcbDocErro('texto com registro curto (%d bytes)' % len(s1))
    d = {'camada': CAMADA_V6.get(s1[0], 'L%d' % s1[0]), 'comp': _u16(s1, 7), 'x': _i32(s1, 13),
         'y': _i32(s1, 17), 'h': _i32(s1, 21), 'sfonte': _u16(s1, 25), 'rot': _f64(s1, 27),
         'espelho': s1[35] != 0, 'w': _i32(s1, 36), 'eh_comment': False, 'eh_designator': False,
         'tipo': 0, 'bold': False, 'italic': False, 'fonte': '', 'invertido': False, 'margem': 0,
         'largo': None, 'ret_inv': False, 'cru': s1}
    if len(s1) >= 123:
        d.update({'eh_comment': s1[40] != 0, 'eh_designator': s1[41] != 0, 'tipo': s1[43],
                  'bold': s1[44] != 0, 'italic': s1[45] != 0,
                  'fonte': s1[46:110].decode('utf-16-le', 'replace').split('\x00')[0],
                  'invertido': s1[110] != 0, 'margem': _i32(s1, 111), 'largo': _u32(s1, 115)})
        if len(s1) > 123:
            d['ret_inv'] = s1[123] != 0
    # O texto Unicode vem do WideStrings6; o pascal do bloco 2 e a copia latin-1. Pascal vazio
    # manda: nos 2 casos do acervo em que eles divergem o pascal e vazio, o WideStrings traz
    # lixo ('i', o caractere 0x11) e o Altium mostra o texto vazio (comment do FB2 no PESDA).
    pas = _pascal(s2)
    txt = largas.get(d['largo']) if d['largo'] is not None else None
    d['texto'] = txt if (txt is not None and pas != '') else pas
    return d


def le_regiao(p):
    """Regions6 / BoardRegions: vertices em double (unidade interna) e os furos. (O
    ShapeBasedRegions6 traz os mesmos objetos com arco, em vertices de 37 bytes; o board.js
    usa o contorno achatado, como o GetMainContour do ExportBoard.) Camada: o V7_LAYER das
    propriedades manda -- Board Cutout tem LAYER=KEEPOUT no byte e V7_LAYER=MULTILAYER, e a
    API do Altium o reporta na Multi."""
    if len(p) < 22:
        raise PcbDocErro('region com registro curto (%d bytes)' % len(p))
    furos_n = _u16(p, 14)
    pl = _u32(p, 18) & 0x00FFFFFF
    pr = props(p[22:22 + pl])
    o = 22 + pl
    n = _u32(p, o) if o + 4 <= len(p) else 0
    o += 4
    if o + 16 * n > len(p):
        raise PcbDocErro('region truncada (%d vertices em %d bytes)' % (n, len(p)))
    pts = [struct.unpack_from('<dd', p, o + 16 * k) for k in range(n)]
    o += 16 * n
    furos = []
    for _ in range(furos_n):
        if o + 4 > len(p):
            break
        m = _u32(p, o)
        o += 4
        if o + 16 * m > len(p):
            break
        furos.append([struct.unpack_from('<dd', p, o + 16 * k) for k in range(m)])
        o += 16 * m
    cam = camada_txt(pr.get('V7_LAYER')) or CAMADA_V6.get(p[0], 'L%d' % p[0])
    return {'camada': cam, 'f1': p[1], 'f2': p[2], 'net': _u16(p, 3), 'poly': _u16(p, 5),
            'comp': _u16(p, 7), 'props': pr, 'kind': int(_num(pr.get('KIND'), 0)),
            'recorte': _bool(pr.get('ISBOARDCUTOUT')), 'pts': pts, 'furos': furos}


# ─── a placa decodificada ─────────────────────────────────────────────────────
class Placa(object):
    """Tudo o que o .PcbDoc diz, decodificado e ainda em unidade interna (1/10000 mil,
    coordenada absoluta). A conversao para o referencial do board.js e do `monta()`."""

    def __init__(self, fonte, parametros=None):
        dados, self.caminho = abre(fonte)
        A = self.arq = Arquivo(dados)
        self.avisos = []
        b6 = {}
        for b in it_props(A.dados('Board6')):
            for k, v in props(b).items():
                b6.setdefault(k, v)
        self.b6 = b6
        self.ox, self.oy = unid(b6.get('ORIGINX')), unid(b6.get('ORIGINY'))
        self.nets = [props(b).get('NAME', '') for b in it_props(A.dados('Nets6'))]
        self.comps = [props(b) for b in it_props(A.dados('Components6'))]
        self.polys = [props(b) for b in it_props(A.dados('Polygons6'))]
        self.classes = [props(b) for b in it_props(A.dados('Classes6'))]
        self.regras = [props(b) for b in it_props(A.dados('Rules6'), 2)]
        # o "Rules To Check" do DRC (RULESETTOCHECK = lote, ONLINERULESETTOCHECK = online): indices
        # na tabela de RULEKIND do AD21 -- quem traduz e o HubPcbRegras (KINDS_AD21)
        self.drc_opcoes = OrderedDict()
        try:
            for b in it_props(A.dados('Design Rule Checker Options6')):
                self.drc_opcoes.update(props(b))
        except Exception:
            self.drc_opcoes = OrderedDict()
        self.trilhas = [le_trilha(p) for _, p in it_simples(A.dados('Tracks6'), 'Tracks6')]
        self.arcos = [le_arco(p) for _, p in it_simples(A.dados('Arcs6'), 'Arcs6')]
        self.vias = [le_via(p) for _, p in it_simples(A.dados('Vias6'), 'Vias6')]
        self.fills = [le_fill(p) for _, p in it_simples(A.dados('Fills6'), 'Fills6')]
        self.pads = [le_pad(bl) for _, bl in it_blocos(A.dados('Pads6'), 6, 'Pads6')]
        self.largas = le_largas(A.dados('WideStrings6'))
        self.textos = [le_texto(bl, self.largas) for _, bl in it_blocos(A.dados('Texts6'), 2, 'Texts6')]
        self.regioes = [le_regiao(p) for _, p in it_simples(A.dados('Regions6'), 'Regions6')]
        self.placa_reg = [le_regiao(p) for _, p in it_simples(A.dados('BoardRegions'), 'BoardRegions')]
        # cabecalho x registros lidos: divergencia aqui e arquivo que este leitor nao entende
        for st, lista in (('Tracks6', self.trilhas), ('Arcs6', self.arcos), ('Vias6', self.vias),
                          ('Fills6', self.fills), ('Pads6', self.pads), ('Texts6', self.textos),
                          ('Regions6', self.regioes), ('Components6', self.comps)):
            n = A.cabecalho(st)
            if n is not None and n != len(lista):
                self.avisos.append('%s: o cabecalho diz %d registros e li %d' % (st, n, len(lista)))
        self.desig, self.coment = {}, {}
        for t in self.textos:
            if t['comp'] == 0xFFFF:
                continue
            if t['eh_designator']:
                self.desig.setdefault(t['comp'], t)
            elif t['eh_comment']:
                self.coment.setdefault(t['comp'], t)
        self.parametros = dict(parametros or {})
        # {string especial que ficou crua: [ids dos textos]}, preenchido pelo monta() (o aviso
        # vai em avisos; quem chama -- o pcbdoc2board -- pode dizer como resolver)
        self.especiais_crus = OrderedDict()

    def ref(self, i):
        """designator do componente i (o texto do designator; SOURCEDESIGNATOR se faltar)"""
        if i == 0xFFFF or i is None or not (0 <= i < len(self.comps)):
            return ''
        t = self.desig.get(i)
        if t is not None:
            return t['texto']
        return self.comps[i].get('SOURCEDESIGNATOR', '')

    def net(self, i):
        return self.nets[i] if i is not None and 0 <= i < len(self.nets) else ''

    def fecha(self):
        self.arq.fecha()


# ─── geometria (unidade interna, coordenada absoluta) ─────────────────────────
def _arco_pontos(cx, cy, r, sa, ea):
    """as pontas do arco anti-horario sa -> ea e os quadrantes que ele cruza"""
    sa = sa % 360.0
    varre = (ea - sa) % 360.0
    if varre == 0:
        varre = 360.0
    angs = [sa, sa + varre] + [q * 90.0 for q in range(8) if 0 < (q * 90.0 - sa) % 360.0 < varre]
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in angs]


def _une(caixas):
    cs = [c for c in caixas if c]
    if not cs:
        return None
    return (min(c[0] for c in cs), min(c[1] for c in cs), max(c[2] for c in cs), max(c[3] for c in cs))


def _caixa_pts(pts, folga=0.0):
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs) - folga, min(ys) - folga, max(xs) + folga, max(ys) + folga)


def _gira(x, y, a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    return x * c - y * s, x * s + y * c


def forma_pad(p, lado):
    """('circle'|'oval'|'rect'|'octagon'|'roundrect', sx, sy, raio) do pad no lado pedido
    ('top', 'mid', 'bot'). O raio do roundrect sai do % gravado por camada (bloco 6)."""
    if lado == 'bot':
        sx, sy, cod, k = p['bx'], p['by'], p['fbot'], 31
    elif lado == 'mid':
        sx, sy, cod, k = p['mx'], p['my'], p['fmid'], 1
    else:
        sx, sy, cod, k = p['tx'], p['ty'], p['ftop'], 0
    raio = 0
    if p['alt'] is not None and p['alt'][k] == 9:
        cod = 9
        raio = p['raio'][k] * min(sx, sy) / 200.0
    nome = {1: 'circle' if sx == sy else 'oval', 2: 'rect', 3: 'octagon', 9: 'roundrect'}.get(cod, 'circle')
    return nome, sx, sy, raio


def _caixa_forma(x, y, rot, nome, sx, sy, raio):
    if nome in ('circle', 'oval'):
        L_, S_ = max(sx, sy), min(sx, sy)
        a = rot if sx >= sy else rot + 90.0
        hs = (L_ - S_) / 2.0
        dx, dy = _gira(hs, 0.0, a)
        return (x - abs(dx) - S_ / 2.0, y - abs(dy) - S_ / 2.0, x + abs(dx) + S_ / 2.0, y + abs(dy) + S_ / 2.0)
    folga = raio if nome == 'roundrect' else 0.0
    hx, hy = sx / 2.0 - folga, sy / 2.0 - folga
    cantos = [_gira(px, py, rot) for px, py in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))]
    return _caixa_pts([(x + cx_, y + cy_) for cx_, cy_ in cantos], folga)


def caixa_pad(p):
    lados = ['top']
    if p['camada'] == 'Bottom':
        lados = ['bot']
    elif p['camada'] != 'Top':
        lados = ['top', 'bot'] + (['mid'] if p['modo'] else [])
    return _une([_caixa_forma(p['x'], p['y'], p['rot'], *forma_pad(p, l)) for l in lados])


def caixa_trilha(t):
    h = t['w'] / 2.0
    return _caixa_pts([(t['x1'], t['y1']), (t['x2'], t['y2'])], h)


def caixa_arco(a):
    return _caixa_pts(_arco_pontos(a['cx'], a['cy'], a['r'], a['sa'], a['ea']), a['w'] / 2.0)


def cantos_fill(f):
    """os 4 cantos da fill depois da rotacao (gira em torno do centro)"""
    cx, cy = (f['x1'] + f['x2']) / 2.0, (f['y1'] + f['y2']) / 2.0
    hx, hy = abs(f['x2'] - f['x1']) / 2.0, abs(f['y2'] - f['y1']) / 2.0
    return [(cx + px, cy + py) for px, py in
            (_gira(sx_ * hx, sy_ * hy, f['rot']) for sx_, sy_ in ((-1, -1), (1, -1), (1, 1), (-1, 1)))]


def caixa_fill(f):
    return _caixa_pts(cantos_fill(f))


def caixa_regiao(g):
    return _caixa_pts(g['pts'])


# ─── texto: o retangulo de selecao ────────────────────────────────────────────
# onde o retangulo comeca em relacao ao ponto gravado, pela justificacao (1 esq-cima, 2 esq-
# meio, 3 esq-baixo, 4 meio-cima, 5 centro, 6 meio-baixo, 7..9 direita): 0 = comeca no ponto,
# 1 = centrado (meia largura em divisao INTEIRA, como o Altium), 2 = termina no ponto
_JUST_X = {1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2}
_JUST_Y = {3: 0, 6: 0, 9: 0, 2: 1, 5: 1, 8: 1, 1: 2, 4: 2, 7: 2}
# glifos da fonte stroke que nao encostam na linha de base (fracao da altura): o retangulo
# gravado guarda a largura/altura da tinta, nao onde ela comeca
_STROKE_YMIN = {'+': 1 / 6.0, '-': 0.5, '=': 1 / 3.0, '*': 1 / 6.0, '~': 1 / 3.0, '^': 0.5, '"': 2 / 3.0,
                "'": 2 / 3.0, '`': 2 / 3.0}
# a altura de maiuscula da fonte stroke e 0,999676 x a altura do texto (medido em 501 textos:
# a tinta do retangulo gravado sempre da isso), e a grade do glifo e de 1/6 dela
_STROKE_ESCALA = 0.999676
_STROKE_DESC = set('gjpqy')
# TrueType sem retangulo valido (rotulos de footprint): o centro da selecao fica 1,0184% da
# altura abaixo do meio do retangulo gravado -- medido na "Arial Rounded MT Bold", a unica
# fonte TrueType de footprint do acervo (337 textos; h 1,5748 e 1,9685, desvio < 0,00001 mm)
_TT_DY = 0.010184


def _inicio(tam, modo):
    return 0 if modo == 0 else (-(tam // 2) if modo == 1 else -tam)


def retangulo_texto(t):
    """(px, py, x0, y0, x1, y1, angulo, espelho): o retangulo de selecao do texto no referencial
    dele -- [x0, x1] x [y0, y1] a partir do ponto (px, py), antes do espelho e da rotacao --, em
    unidade interna. Fonte da verdade, nesta ordem:
      1. o registro guarda o retangulo que o Altium calculou (largura 124, altura 128,
         justificacao 132, ponto 244/248) e o byte 240 diz se ele vale -- 1 em todo texto que
         o Altium redesenhou; e o mesmo BoundingRectangleForSelection do ExportBoard, e a conta
         em inteiro (meia largura por divisao inteira) bate 479 de 479 textos;
      2. byte 240 = 0 (texto de footprint que nunca foi redesenhado): a largura/altura ainda
         valem (tinta + uma espessura de traco de cada lado), mas o ponto e a ancora; a tinta
         comeca na ancora (x) e na linha de base (y, salvo os glifos de _STROKE_YMIN);
      3. registro antigo sem retangulo: estimativa pela fonte stroke (largura 2/3 da altura
         por caractere, espaco de 1/3)."""
    s1 = t['cru']
    a, esp, w, h = t['rot'], t['espelho'], t['w'], t['h']
    if not t['texto']:
        return t['x'], t['y'], 0, 0, 0, 0, a, esp
    if len(s1) >= 252:
        rw, rh = _i32(s1, 124), _i32(s1, 128)
        if s1[240] == 1 and rw > 0 and rh > 0:
            j = s1[132]
            x0, y0 = _inicio(rw, _JUST_X.get(j, 0)), _inicio(rh, _JUST_Y.get(j, 0))
            return _i32(s1, 244), _i32(s1, 248), x0, y0, x0 + rw, y0 + rh, a, esp
        if rw > 0 and rh > 0:
            if t['tipo'] == 1:
                y0 = -_ri(_TT_DY * h)
                return t['x'], t['y'], 0, y0, rw, y0 + rh, a, esp
            y0 = _ri(_y0_stroke(t['texto'], h)) - w
            return t['x'], t['y'], -w, y0, rw - w, y0 + rh, a, esp
    # estimativa (registro de 230 bytes, de antes do AD 2013)
    linhas = t['texto'].replace('\r\n', '\n').split('\n')
    n = max(len(l) for l in linhas) if linhas else 0
    ink_w = _ri(max(0.0, n * h - h / 3.0))
    ink_h = _ri(h * len(linhas) + (len(linhas) - 1) * h / 3.0)
    y0 = -_ri((len(linhas) - 1) * (h + h / 3.0))
    return t['x'], t['y'], -w, y0 - w, ink_w + w, y0 + ink_h + w, a, esp


def _y0_stroke(txt, h):
    if any(c in _STROKE_DESC for c in txt):
        return -h / 3.0
    ys = [_STROKE_YMIN.get(c, 0.0) for c in txt if not c.isspace()]
    return (min(ys) if ys else 0.0) * h * _STROKE_ESCALA


def caixa_texto(t):
    """o BoundingRectangleForSelection: caixa alinhada aos eixos do retangulo espelhado e
    girado. Em 0/90/180/270 a conta e inteira (e exata); fora disso, double e arredonda."""
    px, py, x0, y0, x1, y1, a, esp = retangulo_texto(t)
    xs = (-x1, -x0) if esp else (x0, x1)
    q = (a % 360.0) / 90.0
    if abs(q - round(q)) < 1e-9:
        k = int(round(q)) % 4
        cantos = [(x, y) for x in xs for y in (y0, y1)]
        cantos = [(x, y) if k == 0 else (-y, x) if k == 1 else (-x, -y) if k == 2 else (y, -x) for x, y in cantos]
    else:
        cantos = [_gira(x, y, a) for x in xs for y in (y0, y1)]
    return _caixa_pts([(px + dx, py + dy) for dx, dy in cantos])


# ─── strings especiais ────────────────────────────────────────────────────────
_RX_ESPECIAL = re.compile(r'(?<![\w.])\.([A-Za-z_][A-Za-z0-9_]*)')


def _le_texto(caminho):
    """arquivo de texto do Altium: UTF-8 (com ou sem BOM) nos de hoje, cp1252 nos antigos"""
    with open(caminho, 'rb') as f:
        b = f.read()
    try:
        return b.decode('utf-8-sig')
    except UnicodeDecodeError:
        return b.decode('cp1252', 'replace')


def parametros_do_projeto(caminho_pcbdoc):
    """[ParameterN] Name=/Value= do .PrjPcb do PcbDoc -- e de la que sai o '.Revisao' ->
    'REV. C' que o Altium mostra. O projeto costuma estar na mesma pasta ou uma/duas acima
    (PRJ/PCB/placa.PcbDoc); vale o PrjPcb cujo DocumentPath cita o PcbDoc, e, sem nenhum
    que cite, o unico PrjPcb da propria pasta. Do History, procura a partir da pasta-mae.
    -> (parametros, caminho do PrjPcb ou None)"""
    out = {}
    if not caminho_pcbdoc:
        return out, None
    d = os.path.dirname(os.path.abspath(caminho_pcbdoc))
    if os.path.basename(d).lower() == 'history':
        d = os.path.dirname(d)
    base = os.path.basename(caminho_pcbdoc)
    base = re.sub(r'\.~\(\d+\)(\.#\(.*?\))?', '', base)
    base = re.sub(r'\.zip$', '', base, flags=re.I).lower()
    escolhido, sozinho = None, None
    pasta = d
    for nivel in range(3):
        try:
            cands = sorted(os.path.join(pasta, n) for n in os.listdir(pasta) if n.lower().endswith('.prjpcb'))
        except OSError:
            cands = []
        if nivel == 0 and len(cands) == 1:
            sozinho = cands[0]
        for c in cands:
            try:
                txt = _le_texto(c)
            except OSError:
                continue
            docs = [l.split('=', 1)[1].strip().replace('\\', '/').split('/')[-1].lower()
                    for l in txt.splitlines() if l.startswith('DocumentPath=')]
            if base in docs:
                escolhido = c
                break
        if escolhido:
            break
        pai = os.path.dirname(pasta)
        if pai == pasta:
            break
        pasta = pai
    escolhido = escolhido or sozinho
    if not escolhido:
        return out, None
    return parametros_do_prjpcb(escolhido), escolhido


def parametros_do_prjpcb(caminho):
    """{Name: Value} das secoes [ParameterN] de um .PrjPcb ({} se nao der para ler)"""
    out = {}
    try:
        txt = _le_texto(caminho)
    except OSError:
        return out
    nome = None
    for linha in txt.splitlines():
        linha = linha.strip()
        if linha.startswith('['):
            nome = None
            continue
        if linha.startswith('Name='):
            nome = linha[5:]
        elif linha.startswith('Value=') and nome:
            out[nome] = linha[6:]
            nome = None
    return out


def converte_especiais(txt, parametros, comp_ref='', comp_comment='', camada_nome='', arquivo='', sem_valor=None):
    """'.Revisao' -> valor do parametro; .Designator/.Comment do dono; o resto fica como esta.
    sem_valor (lista): recebe cada string especial que ficou crua -- sem o .PrjPcb do projeto o
    '.Revisao' fica '.Revisao' no board.js, e o Gerber o escreveria assim na serigrafia"""
    if '.' not in txt:
        return txt
    fixos = {'DESIGNATOR': comp_ref, 'COMMENT': comp_comment, 'LAYER_NAME': camada_nome,
             'PCB_FILE_NAME': arquivo, 'PCB_FILE_NAME_NO_PATH': os.path.basename(arquivo)}
    par = {k.upper(): v for k, v in parametros.items()}

    def troca(m):
        k = m.group(1).upper()
        if k in par:
            return par[k]
        if k in fixos and fixos[k]:
            return fixos[k]
        if sem_valor is not None:
            sem_valor.append(m.group(0))
        return m.group(0)
    return _RX_ESPECIAL.sub(troca, txt)


# ─── regras ───────────────────────────────────────────────────────────────────
class _Escopo(object):
    """avaliador das expressoes de escopo mais comuns do Altium (All, IsPad, IsVia, InNet,
    InComponent, HasFootprint, OnLayer, InNetClass, InComponentClass, InPadClass, and/or/not).
    Funcao desconhecida -> None (a regra nao entra na conta, e o aviso diz qual)."""
    _RX = re.compile(r"\s*(\(|\)|'(?:[^']|'')*'|\"[^\"]*\"|[A-Za-z_][A-Za-z0-9_]*|,|<=|>=|<>|=|<|>|[-+]?\d+(?:\.\d+)?)")

    def __init__(self, expr):
        self.toks = []
        s = (expr or '').strip()
        i = 0
        while i < len(s):
            m = self._RX.match(s, i)
            if not m or m.end() == i:
                raise ValueError('escopo: %r' % s)
            self.toks.append(m.group(1))
            i = m.end()

    def avalia(self, obj):
        self.i = 0
        v = self._ou(obj)
        if self.i != len(self.toks):
            raise ValueError('escopo: sobra')
        return v

    def _pega(self):
        t = self.toks[self.i] if self.i < len(self.toks) else None
        return t

    def _ou(self, obj):
        v = self._e(obj)
        while (self._pega() or '').lower() == 'or':
            self.i += 1
            w = self._e(obj)
            v = True if (v is True or w is True) else (None if (v is None or w is None) else False)
        return v

    def _e(self, obj):
        v = self._nao(obj)
        while (self._pega() or '').lower() == 'and':
            self.i += 1
            w = self._nao(obj)
            v = False if (v is False or w is False) else (None if (v is None or w is None) else True)
        return v

    def _nao(self, obj):
        if (self._pega() or '').lower() == 'not':
            self.i += 1
            v = self._nao(obj)
            return None if v is None else (not v)
        return self._atomo(obj)

    def _atomo(self, obj):
        t = self._pega()
        if t is None:
            raise ValueError('escopo: fim')
        self.i += 1
        if t == '(':
            v = self._ou(obj)
            if self._pega() == ')':
                self.i += 1
            return v
        nome = t.lower()
        args = []
        if self._pega() == '(':
            self.i += 1
            while self._pega() not in (')', None):
                a = self._pega()
                self.i += 1
                if a != ',':
                    args.append(a.strip("'\"").replace("''", "'"))
            self.i += 1
        if self._pega() in ('=', '<>', '<', '>', '<=', '>='):
            self.i += 2
            if (self._pega() or '').lower() in ('asmils', 'asmm', 'asinches'):
                self.i += 1
            return None
        a0 = args[0] if args else ''
        tipo = obj.get('tipo')
        if nome == 'all':
            return True
        if nome == 'ispad':
            return tipo == 'pad'
        if nome == 'isvia':
            return tipo == 'via'
        if nome == 'issmdpad':
            return tipo == 'pad' and obj.get('smd', False)
        if nome == 'isthruhole' or nome == 'isthroughhole':
            return tipo == 'pad' and not obj.get('smd', False)
        if nome == 'innet':
            return obj.get('net', '').lower() == a0.lower()
        if nome == 'incomponent':
            return obj.get('ref', '').lower() == a0.lower()
        if nome == 'hasfootprint':
            return obj.get('footprint', '').lower() == a0.lower()
        if nome == 'onlayer':
            return obj.get('camada_nome', '').lower() == a0.lower() or obj.get('camada', '').lower() == a0.lower()
        if nome in ('innetclass', 'incomponentclass', 'inpadclass'):
            grupo, chave = {'innetclass': ('classes_net', 'net'), 'incomponentclass': ('classes_comp', 'ref'),
                            'inpadclass': ('classes_pad', 'pad_id')}[nome]
            membros = obj.get(grupo, {}).get(a0.lower())
            if membros is None:
                return False
            if membros == '*':                         # superclasse: "All Nets", "All Pads"...
                return nome != 'inpadclass' or tipo == 'pad'
            return obj.get(chave, '') in membros
        return None


class Regras(object):
    def __init__(self, regras, classes, avisos):
        self.lista = []
        self.avisos = avisos
        self.classes_net, self.classes_comp, self.classes_pad = {}, {}, {}
        for c in classes:
            # Classes6: KIND 0 net, 1 componente, 3 pad (membro "REF-PINO"); superclasse = todos
            membros = '*' if _bool(c.get('SUPERCLASS')) else \
                set(v for k, v in c.items() if re.match(r'^M\d+$', k))
            destino = {'0': self.classes_net, '1': self.classes_comp, '3': self.classes_pad}.get(c.get('KIND'))
            if destino is not None:
                destino[c.get('NAME', '').lower()] = membros
        for r in regras:
            if not r or not _bool(r.get('ENABLED', 'TRUE')):
                continue
            try:
                esc = _Escopo(r.get('SCOPE1EXPRESSION', 'All'))
            except ValueError:
                esc = None
            self.lista.append((int(_num(r.get('PRIORITY'), 1)), r.get('RULEKIND', ''), esc, r))
        self.lista.sort(key=lambda x: x[0])
        self._avisados = set()

    def dominante(self, tipo_regra, obj):
        """a regra habilitada de maior prioridade (menor numero) cujo escopo 1 casa com obj"""
        o = dict(obj)
        o['classes_net'], o['classes_comp'], o['classes_pad'] = self.classes_net, self.classes_comp, self.classes_pad
        for pri, kind, esc, r in self.lista:
            if kind != tipo_regra:
                continue
            try:
                v = esc.avalia(o) if esc is not None else None
            except (ValueError, IndexError):
                # escopo que o avaliador nao segue ate o fim (comparacao com unidade, como
                # "Width > 10 AsMils" do MIRBC): a regra fica de fora, com aviso -- nunca exceção
                v = None
            if v is None:
                chave = (kind, r.get('NAME'))
                if chave not in self._avisados:
                    self._avisados.add(chave)
                    self.avisos.append('regra %s "%s": escopo nao entendido (%s) -- ignorada' % (
                        kind, r.get('NAME'), r.get('SCOPE1EXPRESSION')))
                continue
            if v:
                return r
        return None

    def da_placa(self, tipo_regra):
        """a regra de escopo All (nos dois escopos) de maior prioridade"""
        for pri, kind, esc, r in self.lista:
            if kind == tipo_regra and (r.get('SCOPE1EXPRESSION', 'All') or 'All').strip().lower() == 'all' \
                    and (r.get('SCOPE2EXPRESSION', 'All') or 'All').strip().lower() == 'all':
                return r
        return None


# ─── ordenacao das nets (TStringList.Sorted do Delphi = CompareString do Windows) ──
_SIMBOLOS = " !\"#$%&()*,./:;?@[\\]^_`{|}~+<=>"


def _peso(c):
    if c in "-'":
        return None                          # hifen e apostrofo: ignorados no 1o nivel
    if c in _SIMBOLOS:
        return (0, _SIMBOLOS.index(c))
    if c.isdigit():
        return (1, ord(c))
    import unicodedata
    base = unicodedata.normalize('NFD', c)[0].upper()
    if base.isalpha():
        return (2, ord(base))
    return (0, 100 + ord(c))


def chave_net(s):
    return (tuple(p for p in (_peso(c) for c in s) if p is not None), s.upper(), s)


# ─── o board.js ───────────────────────────────────────────────────────────────
# As camadas que o ExportBoard de hoje le (o filtro da linha 1221 do .pas). Tudo que esta
# nelas sai na 1a passada, na ordem dele; o resto (camadas novas e fills) numa 2a passada,
# depois, para os ids de hoje nao mudarem.
PASSO1 = ('Top', 'Bottom', 'TopOverlay', 'BottomOverlay', 'Multi')
_PASSO1 = frozenset(PASSO1)
ESPECIAIS = ('TopOverlay', 'BottomOverlay', 'TopPaste', 'BottomPaste', 'TopSolder', 'BottomSolder',
             'DrillGuide', 'KeepOut', 'DrillDrawing', 'Multi')
_FORMA_FURO = {0: 'circle', 1: 'rect', 2: 'oblong'}
_TIPO_TEXTO = {0: 'stroke', 1: 'truetype', 2: 'barcode'}
SEM_PASTA = -unid('500mm')          # pasta manual <= -500 mm: o jeito do Altium dizer "sem pasta"
# o valor de fabrica do Altium quando nenhuma regra do tipo casa com o objeto
PADRAO_REGRA = {'SolderMaskExpansion': unid('4mil'), 'PasteMaskExpansion': 0}


def na_ordem(itens, filtro):
    """os itens que o iterador do Altium visita, na ordem dele: camada por camada (o numero
    do TLayer, crescente) e, dentro da camada, a ordem do stream. Medido: trilha antes de
    arco nao -- e o TIPO que vem primeiro (o silk do MID sai arcos Top, arcos Bottom, linhas
    Top, linhas Bottom), e cada tipo varre as camadas em ordem."""
    sel = [(ordem_camada(it['camada']), k, it) for k, it in enumerate(itens) if filtro(it['camada'])]
    sel.sort(key=lambda x: (x[0], x[1]))
    return [x[2] for x in sel]


def _ri(v):
    """coordenada de caixa -> TCoord (o retangulo do Altium e inteiro)"""
    return int(math.floor(v + 0.5))


class _Montador(object):
    def __init__(self, P, gerado=None, fonte=None, contornos=None):
        self.P = P
        self.gerado = gerado or datetime.now().strftime('%d/%m/%Y %H:%M:%S')
        self.fonte = fonte if fonte is not None else (P.caminho or '')
        self.contornos = contornos             # funcao(texto) -> polys, opcional (TrueType)
        self.nets = []
        self.regras = Regras(P.regras, P.classes, P.avisos)
        self.cont = {}
        self.sem_regra = {}
        self.fontes_faltando = {}
        self.especiais_crus = OrderedDict()

    # coordenadas
    def X(self, v):
        return mm(v - self.P.ox)

    def Y(self, v):
        return mm(v - self.P.oy)

    def caixa_json(self, c):
        return OrderedDict([('x1', self.X(_ri(c[0]))), ('y1', self.Y(_ri(c[1]))),
                            ('x2', self.X(_ri(c[2]))), ('y2', self.Y(_ri(c[3])))])

    def net(self, i):
        n = self.P.net(i) if i != 0xFFFF else ''
        if n:
            self.nets.append(n)
        return n

    def dono(self, i):
        return self.P.ref(i) if i != 0xFFFF else ''

    def novo_id(self, prefixo):
        self.cont[prefixo] = self.cont.get(prefixo, 0) + 1
        return '%s%d' % (prefixo, self.cont[prefixo])

    # ── regras por objeto
    def _obj_regra(self, tipo, net='', comp=0xFFFF, camada='', smd=False, pino=''):
        P = self.P
        ref = self.dono(comp)
        fp = P.comps[comp].get('PATTERN', '') if comp != 0xFFFF and comp < len(P.comps) else ''
        return {'tipo': tipo, 'net': net, 'ref': ref, 'footprint': fp, 'camada': camada,
                'camada_nome': NOME_PADRAO.get(camada, camada), 'smd': smd,
                'pad_id': ('%s-%s' % (ref, pino)) if tipo == 'pad' else ''}

    def _expansao(self, modo, valor, tipo_regra, obj):
        if modo == 2:
            return valor
        r = self.regras.dominante(tipo_regra, obj)
        if r is None:
            # nenhuma regra casou (o PAPR so tem SolderMaskExpansion com escopo
            # HasFootprint('No Footprint')): vale o padrao de fabrica do Altium
            self.sem_regra[tipo_regra] = self.sem_regra.get(tipo_regra, 0) + 1
            return PADRAO_REGRA[tipo_regra]
        return unid(r.get('EXPANSION'))

    # ── primitivas
    def pad(self, p, pid):
        P = self.P
        cam = p['camada']
        if cam == 'Top':
            tipo, lado = 'smd', 'top'
        elif cam == 'Bottom':
            tipo, lado = 'smd', 'bot'
        else:
            tipo, lado = 'th', 'top'
        nome, sx, sy, raio = forma_pad(p, lado)
        w_, h_ = mm(sx), mm(sy)
        if nome in ('circle', 'oval'):
            nome = 'circle' if jf(w_) == jf(h_) else 'oval'
        o = OrderedDict([('id', pid), ('name', p['nome']), ('layer', cam), ('type', tipo), ('shape', nome)])
        if nome == 'roundrect':
            o['radius'] = mm(_ri(raio))
        o['x'] = self.X(p['x'])
        o['y'] = self.Y(p['y'])
        o['w'] = w_
        o['h'] = h_
        o['rot'] = p['rot']
        if tipo == 'th':
            o['drillshape'] = _FORMA_FURO.get(p['tipo_furo'], 'circle')
            o['drill'] = mm(p['furo'])
            if p['tipo_furo'] != 0:
                o['drillw'] = mm(p['slot'])
            o['holerot'] = p['furo_rot']
        nn = self.net(p['net'])
        o['net'] = nn
        # ── campos novos (contrato 2026-10)
        if tipo == 'th':
            o['plated'] = bool(p['metal'])
        obj = self._obj_regra('pad', nn, p['comp'], cam, tipo == 'smd', p['nome'])
        sm = self._expansao(p['sm_modo'], p['sm_val'], 'SolderMaskExpansion', obj)
        pm = self._expansao(p['pm_modo'], p['pm_val'], 'PasteMaskExpansion', obj)
        if sm is not None:
            o['sm'] = mm(sm)
        if pm is not None:
            if p['pm_modo'] == 2 and p['pm_val'] <= SEM_PASTA:
                o['nopaste'] = True
            else:
                o['pm'] = mm(pm)
        o['tentTop'] = bool(p['f1'] & 0x20)
        o['tentBot'] = bool(p['f1'] & 0x40)
        # pilha top-mid-bottom / completa: o lado de baixo so vai quando difere do de cima (no
        # acervo o modo pilha aparece em 40 projetos e so 6 tem de fato top != bottom)
        if tipo == 'th' and p['modo'] != 0:
            nt, tx, ty, rt = forma_pad(p, 'top')
            nb, bx, by, rb = forma_pad(p, 'bot')
            if (nb, bx, by, _ri(rb)) != (nt, tx, ty, _ri(rt)):
                if nb in ('circle', 'oval'):
                    nb = 'circle' if jf(mm(bx)) == jf(mm(by)) else 'oval'
                b = OrderedDict([('w', mm(bx)), ('h', mm(by)), ('shape', nb)])
                if nb == 'roundrect':
                    b['radius'] = mm(_ri(rb))
                o['bot'] = b
        if p['offs'] is not None and (p['offs'][0][0] or p['offs'][1][0]):
            o['hox'] = mm(p['offs'][0][0])
            o['hoy'] = mm(p['offs'][1][0])
        return o

    def componente(self, i, c):
        P = self.P
        cid = 'c%d' % (i + 1)
        coment = P.coment[i]['texto'] if i in P.coment else c.get('COMMENT', '')
        o = OrderedDict([('id', cid), ('ref', P.ref(i)), ('footprint', c.get('PATTERN', '')),
                         ('comment', coment), ('layer', camada_txt(c.get('LAYER')) or 'Top'),
                         ('x', self.X(unid(c.get('X')))), ('y', self.Y(unid(c.get('Y')))),
                         ('rot', _num(c.get('ROTATION'), 0.0))])
        meus = [p for p in P.pads if p['comp'] == i]
        cx = [caixa_pad(p) for p in meus]
        for lst, fn in ((P.trilhas, caixa_trilha), (P.arcos, caixa_arco), (P.fills, caixa_fill),
                        (P.regioes, caixa_regiao)):
            cx.extend(fn(q) for q in lst if q['comp'] == i)
        cx = _une(cx)
        if cx is None:
            x0, y0 = unid(c.get('X')), unid(c.get('Y'))
            cx = (x0, y0, x0, y0)
        o['bbox'] = self.caixa_json(cx)
        o['pads'] = [self.pad(p, '%sp%d' % (cid, k + 1)) for k, p in enumerate(meus)]
        return o

    def trilha(self, t, tid):
        o = OrderedDict([('id', tid), ('layer', t['camada']), ('x1', self.X(t['x1'])), ('y1', self.Y(t['y1'])),
                         ('x2', self.X(t['x2'])), ('y2', self.Y(t['y2'])), ('w', mm(t['w'])),
                         ('net', self.net(t['net']))])
        if t['comp'] != 0xFFFF:
            o['owner'] = self.dono(t['comp'])
        if t['f2'] == 2:
            o['keepout'] = True
        return o

    def arco(self, a, aid):
        o = OrderedDict([('id', aid), ('layer', a['camada']), ('cx', self.X(a['cx'])), ('cy', self.Y(a['cy'])),
                         ('r', mm(a['r'])), ('sa', a['sa']), ('ea', a['ea']), ('w', mm(a['w'])),
                         ('net', self.net(a['net']))])
        if a['comp'] != 0xFFFF:
            o['owner'] = self.dono(a['comp'])
        if a['f2'] == 2:
            o['keepout'] = True
        return o

    def linha(self, t, sid):
        o = OrderedDict([('id', sid), ('layer', t['camada']), ('kind', 'line'), ('x1', self.X(t['x1'])),
                         ('y1', self.Y(t['y1'])), ('x2', self.X(t['x2'])), ('y2', self.Y(t['y2'])),
                         ('w', mm(t['w']))])
        if t['comp'] != 0xFFFF:
            o['owner'] = self.dono(t['comp'])
        if t['f2'] == 2:
            o['keepout'] = True
        return o

    def linha_arco(self, a, sid):
        o = OrderedDict([('id', sid), ('layer', a['camada']), ('kind', 'arc'), ('cx', self.X(a['cx'])),
                         ('cy', self.Y(a['cy'])), ('r', mm(a['r'])), ('sa', a['sa']), ('ea', a['ea']),
                         ('w', mm(a['w']))])
        if a['comp'] != 0xFFFF:
            o['owner'] = self.dono(a['comp'])
        if a['f2'] == 2:
            o['keepout'] = True
        return o

    def via(self, v, vid):
        o = OrderedDict([('id', vid), ('x', self.X(v['x'])), ('y', self.Y(v['y'])), ('size', mm(v['d'])),
                         ('drill', mm(v['furo'])), ('from', v['de']), ('to', v['ate']), ('net', self.net(v['net']))])
        obj = self._obj_regra('via', o['net'], 0xFFFF, 'Multi')
        r = self.regras.dominante('SolderMaskExpansion', obj)
        if v['sm_manual']:
            o['sm'] = mm(v['sm'])
        elif r is not None:
            o['sm'] = mm(unid(r.get('EXPANSION')))
        else:
            self.sem_regra['SolderMaskExpansion'] = self.sem_regra.get('SolderMaskExpansion', 0) + 1
            o['sm'] = mm(PADRAO_REGRA['SolderMaskExpansion'])
        regra_tt = bool(r is not None and not v['sm_manual'] and _bool(r.get('ISTENTINGTOP')))
        regra_tb = bool(r is not None and not v['sm_manual'] and _bool(r.get('ISTENTINGBOTTOM')))
        o['tentTop'] = bool(v['f1'] & 0x20) or regra_tt
        o['tentBot'] = bool(v['f1'] & 0x40) or regra_tb
        return o

    def texto(self, t, xid):
        P = self.P
        cx = caixa_texto(t)
        x1, y1 = self.X(_ri(cx[0])), self.Y(_ri(cx[1]))
        x2, y2 = self.X(_ri(cx[2])), self.Y(_ri(cx[3]))
        ref = self.dono(t['comp'])
        coment = P.coment[t['comp']]['texto'] if t['comp'] in P.coment else ''
        crus = []
        txt = converte_especiais(t['texto'], P.parametros, ref, coment,
                                 NOME_PADRAO.get(t['camada'], t['camada']), P.caminho or '', crus)
        for nome in crus:
            ids = self.especiais_crus.setdefault(nome, [])
            if xid not in ids:
                ids.append(xid)
        o = OrderedDict([('id', xid), ('layer', t['camada']), ('x', (x1 + x2) / 2), ('y', (y1 + y2) / 2),
                         ('text', txt), ('h', mm(t['h'])), ('rot', t['rot']), ('mirror', t['espelho']),
                         ('designator', t['eh_designator']), ('comment', t['eh_comment'])])
        if t['comp'] != 0xFFFF:
            o['owner'] = ref
        # campos novos na ordem do ExportBoard 2026-10: fonte/negrito/italico so no TrueType
        o['w'] = mm(t['w'])
        o['kind'] = _TIPO_TEXTO.get(t['tipo'], 'stroke')
        if t['tipo'] == 1:
            o['font'] = t['fonte']
            o['bold'] = bool(t['bold'])
            o['italic'] = bool(t['italic'])
        o['inverted'] = bool(t['invertido'])
        o['ax'] = self.X(t['x'])
        o['ay'] = self.Y(t['y'])
        if self.contornos is not None and t['tipo'] == 1:
            try:
                ps = self.contornos(t, txt, self)
            except Exception as e:                       # contorno e opcional: falha vira aviso
                ps = None
                self.P.avisos.append('contorno do texto %s: %s' % (xid, e))
            if ps:
                o['polys'] = ps
        return o

    def pontos(self, pts):
        return [[self.X(_ri(x)), self.Y(_ri(y))] for x, y in pts]

    def regiao(self, g, gid, net=None):
        o = OrderedDict([('id', gid), ('layer', g['camada']),
                         ('net', self.net(g['net']) if net is None else net),
                         ('points', self.pontos(g['pts']))])
        if g['furos']:
            o['holes'] = [self.pontos(h) for h in g['furos']]
        if g['poly'] != 0xFFFF:
            o['poly'] = True
        if g['comp'] != 0xFFFF:
            o['owner'] = self.dono(g['comp'])
        if g['f2'] == 2 or (g['camada'] == 'KeepOut' and not g['recorte']):
            o['keepout'] = True
        return o

    def recorte(self, g, kid, kindn):
        o = OrderedDict([('id', kid), ('layer', g['camada']), ('incomp', g['comp'] != 0xFFFF),
                         ('points', self.pontos(g['pts']))])
        o['kindn'] = kindn
        return o

    def fill(self, f, fid):
        o = OrderedDict([('id', fid), ('layer', f['camada']), ('x1', self.X(f['x1'])), ('y1', self.Y(f['y1'])),
                         ('x2', self.X(f['x2'])), ('y2', self.Y(f['y2'])), ('rot', f['rot']),
                         ('net', self.net(f['net']) if eh_cobre(f['camada']) else '')])
        if f['comp'] != 0xFFFF:
            o['owner'] = self.dono(f['comp'])
        if f['f2'] == 2:
            o['keepout'] = True
        return o

    # ── contorno da placa
    def contorno(self):
        b6 = self.P.b6
        vs = []
        i = 0
        while 'VX%d' % i in b6 and 'VY%d' % i in b6:
            vs.append({'kind': int(_num(b6.get('KIND%d' % i), 0)), 'x': unid(b6['VX%d' % i]), 'y': unid(b6['VY%d' % i]),
                       'cx': unid(b6.get('CX%d' % i)), 'cy': unid(b6.get('CY%d' % i)), 'r': unid(b6.get('R%d' % i)),
                       'sa': _num(b6.get('SA%d' % i), 0.0), 'ea': _num(b6.get('EA%d' % i), 0.0)})
            i += 1
        if len(vs) > 1 and (vs[-1]['x'], vs[-1]['y']) == (vs[0]['x'], vs[0]['y']):
            vs.pop()                                   # o Board6 fecha repetindo o 1o vertice
        segs, pts = [], []
        for k, v in enumerate(vs):
            w = vs[(k + 1) % len(vs)]
            # caixa: a reta entra pelo vertice inicial, o arco pela geometria dele (centro, raio,
            # angulos) -- o vertice gravado de um arco pode estar 1 unidade fora do arco, e o
            # Altium nao o conta (PRJ - DI261930: 89,14727 no vertice, 89,14726 na caixa)
            if v['kind'] == 0:
                pts.append((v['x'], v['y']))
            if v['kind'] == 0:
                segs.append(OrderedDict([('kind', 'line'), ('x1', self.X(v['x'])), ('y1', self.Y(v['y'])),
                                         ('x2', self.X(w['x'])), ('y2', self.Y(w['y']))]))
            else:
                segs.append(OrderedDict([('kind', 'arc'), ('cx', self.X(v['cx'])), ('cy', self.Y(v['cy'])),
                                         ('r', mm(v['r'])), ('sa', v['sa']), ('ea', v['ea'])]))
                pts.extend(_arco_pontos(v['cx'], v['cy'], v['r'], v['sa'], v['ea']))
        cx = _caixa_pts(pts) or (self.P.ox, self.P.oy, self.P.ox, self.P.oy)
        return segs, cx

    # ── camadas e regras da placa
    def camadas(self, usadas):
        b6 = self.P.b6
        out = []
        cadeia, vistos, cur = [], set(), 1
        while cur and cur not in vistos and len(cadeia) < 90:
            vistos.add(cur)
            cadeia.append(cur)
            cur = int(_num(b6.get('LAYER%dNEXT' % cur), 0))
        cobre = [n for n in cadeia if 1 <= n <= 32 or 39 <= n <= 54]
        if 32 not in cobre:
            cobre = [1, 32]
        for k, n in enumerate(cobre):
            chave = CAMADA_V6[n]
            out.append(OrderedDict([('key', chave), ('name', b6.get('LAYER%dNAME' % n) or NOME_PADRAO.get(chave, chave)),
                                    ('stack', k + 1)]))
        mecs = {}
        for n in range(57, 73):
            if _bool(b6.get('LAYER%dMECHENABLED' % n)):
                mecs[CAMADA_V6[n]] = b6.get('LAYER%dNAME' % n) or 'Mechanical %d' % (n - 56)
        k = 0
        while ('LAYER_V8_%dLAYERID' % k) in b6 or ('LAYER_V8_%dNAME' % k) in b6:
            lid = int(_num(b6.get('LAYER_V8_%dLAYERID' % k), 0))
            chave = camada_v7(lid) if lid else None
            if chave and chave.startswith('Mech') and _bool(b6.get('LAYER_V8_%dMECHENABLED' % k)):
                mecs[chave] = b6.get('LAYER_V8_%dNAME' % k) or mecs.get(chave) or chave
            k += 1
        for chave in usadas:
            if chave.startswith('Mech') and chave not in mecs:
                n = NUM_CAMADA.get(chave)
                mecs[chave] = (b6.get('LAYER%dNAME' % n) if n else None) or 'Mechanical %s' % chave[4:]
        for chave in sorted(mecs, key=ordem_camada):
            out.append(OrderedDict([('key', chave), ('name', mecs[chave])]))
        for chave in ESPECIAIS:
            n = NUM_CAMADA[chave]
            out.append(OrderedDict([('key', chave), ('name', b6.get('LAYER%dNAME' % n) or NOME_PADRAO[chave])]))
        return out

    def regras_placa(self):
        R = self.regras
        out = OrderedDict()
        for chave, tipo, campo in (('sm', 'SolderMaskExpansion', 'EXPANSION'), ('pm', 'PasteMaskExpansion', 'EXPANSION'),
                                   ('clearance', 'Clearance', 'GAP'), ('width', 'Width', 'PREFEREDWIDTH'),
                                   ('viaSize', 'RoutingVias', 'WIDTH'), ('viaDrill', 'RoutingVias', 'HOLEWIDTH')):
            r = R.da_placa(tipo)
            if r is not None and r.get(campo) not in (None, ''):
                out[chave] = mm(unid(r.get(campo)))
        return out

    # ── tudo
    def monta(self):
        P = self.P
        B = OrderedDict()
        comps = [self.componente(i, c) for i, c in enumerate(P.comps)]
        # pads soltos: ordem do stream (o iterador do ExportBoard usa AllLayers, que nao separa
        # por camada -- medido no PRJ-UR: o pad da Multi vem antes do SMD do Top)
        livres = [p for p in P.pads if p['comp'] == 0xFFFF]
        freepads = [self.pad(p, 'p%d' % (k + 1)) for k, p in enumerate(livres)]

        tracks, arcs, vias, texts, silk, regions, cutouts, fills, lines = ([] for _ in range(9))

        def oculto(t):
            if t['comp'] == 0xFFFF or t['comp'] >= len(P.comps):
                return False
            c = P.comps[t['comp']]
            if t['eh_designator']:
                return not _bool(c.get('NAMEON', 'TRUE'))
            if t['eh_comment']:
                return not _bool(c.get('COMMENTON', 'FALSE'))
            return False

        def passo(filtro, novo):
            # a ordem dos tipos e a do ObjectId do Altium: arco, via, trilha, texto, fill, poligono, regiao
            for a in na_ordem(P.arcos, filtro):
                c = a['camada']
                if eh_cobre(c):
                    arcs.append(self.arco(a, self.novo_id('a')))
                elif eh_overlay(c) and not novo:
                    silk.append(self.linha_arco(a, self.novo_id('s')))
                elif novo and c != 'Multi':
                    lines.append(self.linha_arco(a, self.novo_id('l')))
            if not novo:
                for v in P.vias:
                    vias.append(self.via(v, self.novo_id('v')))
            for t in na_ordem(P.trilhas, filtro):
                c = t['camada']
                if eh_cobre(c):
                    tracks.append(self.trilha(t, self.novo_id('t')))
                elif eh_overlay(c) and not novo:
                    silk.append(self.linha(t, self.novo_id('s')))
                elif novo and c != 'Multi':
                    lines.append(self.linha(t, self.novo_id('l')))
            for t in na_ordem(P.textos, filtro):
                if not oculto(t):
                    texts.append(self.texto(t, self.novo_id('x')))
            if novo:
                for f in na_ordem(P.fills, lambda k: True):
                    fills.append(self.fill(f, self.novo_id('f')))
            polys = [(k, pg) for k, pg in enumerate(P.polys)]
            # poligono fora de Top/Bottom: o ExportBoard de hoje nao o le, entao vai na 2a passada
            # mesmo quando a camada e de la (um poligono no TopOverlay, por exemplo)
            polys = [x for x in sorted(polys, key=lambda x: (ordem_camada(camada_txt(x[1].get('LAYER')) or ''), x[0]))
                     if filtro(camada_txt(x[1].get('LAYER')) or '') or
                     (novo and (camada_txt(x[1].get('LAYER')) or '') not in ('Top', 'Bottom'))]
            for k, pg in polys:
                c = camada_txt(pg.get('LAYER')) or ''
                if not novo and c not in ('Top', 'Bottom'):
                    continue
                ni = int(_num(pg.get('NET'), -1)) if pg.get('NET') not in (None, '') else -1
                nn = self.net(ni) if ni >= 0 else ''
                for g in P.regioes:
                    if g['poly'] == k:
                        regions.append(self.regiao(g, self.novo_id('g'), nn))
            for g in na_ordem(P.regioes, filtro):
                if g['poly'] != 0xFFFF:
                    continue                          # pedaco de poligono: saiu acima
                if g['kind'] == 0 and not g['recorte']:
                    regions.append(self.regiao(g, self.novo_id('g')))
                else:
                    kindn = 3 if (g['kind'] == 0 and g['recorte']) else g['kind']
                    cutouts.append(self.recorte(g, self.novo_id('k'), kindn))
            if not novo:
                for g in P.placa_reg:
                    # a forma da placa (Layer Stack Region), nao um furo: -1 a separa dos
                    # recortes de verdade (3) e dos recortes de poligono (1)
                    cutouts.append(self.recorte(g, self.novo_id('k'), -1))

        passo(lambda k: k in _PASSO1, False)
        passo(lambda k: k not in _PASSO1, True)
        for t in P.trilhas + P.arcos:
            if t['camada'] == 'Multi':
                P.avisos.append('primitiva na Multi-Layer (trilha/arco) ficou de fora: o board.js nao tem onde a por')
                break

        for nome, n in sorted(self.fontes_faltando.items()):
            P.avisos.append('fonte TrueType "%s" nao achada no Windows: %d texto(s) sem contorno exato' % (nome, n))
        # string especial sem valor: o Altium escreve o parametro do projeto ('.Revisao' -> 'REV. C');
        # aqui ela fica crua no board.js e o Gerber do hub a escreveria assim na serigrafia
        for nome, ids in self.especiais_crus.items():
            P.avisos.append('string especial %s sem valor em %d texto(s) (%s): fica crua no board.js, e o Gerber a '
                            'escreveria assim na serigrafia -- %s' % (
                                nome, len(ids), ', '.join(ids[:8]) + (' ...' if len(ids) > 8 else ''),
                                'o projeto nao tem esse parametro' if P.parametros else
                                'sem os parametros do projeto (nenhum .PrjPcb: passe --prjpcb <projeto>.PrjPcb)'))
        P.especiais_crus = OrderedDict((k, list(v)) for k, v in self.especiais_crus.items())
        for tipo_regra, n in sorted(self.sem_regra.items()):
            P.avisos.append('%d objeto(s) sem regra %s que case: usei o padrao do Altium (%s mm)' % (
                n, tipo_regra, jf(mm(PADRAO_REGRA[tipo_regra]))))
        segs, cx = self.contorno()
        vistos, nets = set(), []
        for n in self.nets:
            if n.upper() not in vistos:
                vistos.add(n.upper())
                nets.append(n)
        nets.sort(key=chave_net)
        usadas = set()
        for lst in (tracks, arcs, texts, silk, regions, fills, lines):
            usadas.update(o['layer'] for o in lst)

        # a ordem das chaves e a do ExportBoard 2026-10 (exporter logo depois de format; nets,
        # layers e rules antes dos componentes): os dois board.js se comparam linha a linha
        B['format'] = FORMATO
        B['exporter'] = EXPORTER
        B['generated'] = self.gerado
        B['source'] = self.fonte
        B['units'] = 'mm'
        B['axis'] = 'y-up'
        B['origin_note'] = ORIGIN_NOTE
        B['board'] = OrderedDict([('bbox', self.caixa_json(cx)), ('outline', segs)])
        B['nets'] = nets
        B['layers'] = self.camadas(usadas)
        B['rules'] = self.regras_placa()
        B['components'] = comps
        B['freepads'] = freepads
        B['tracks'] = tracks
        B['arcs'] = arcs
        B['vias'] = vias
        B['texts'] = texts
        B['silk'] = silk
        B['regions'] = regions
        B['cutouts'] = cutouts
        B['fills'] = fills
        B['lines'] = lines
        B['stats'] = OrderedDict([('components', len(comps)), ('freepads', len(freepads)), ('tracks', len(tracks)),
                                  ('arcs', len(arcs)), ('vias', len(vias)), ('texts', len(texts)), ('silk', len(silk)),
                                  ('regions', len(regions)), ('cutouts', len(cutouts)), ('fills', len(fills)),
                                  ('lines', len(lines))])
        return B


# ─── as regras inteiras (o rules.js do hub) ───────────────────────────────────
def regras_js(P, fonte=''):
    """O Rules6 e o Classes6 CRUS, no rules.js que o hub le (Projects/<p>/rules.js):

        var pcbrules = {"format":"pcbrules-v1", "origem":..., "altium":[{registro}, ...], "classes":[...],
                        "drc":{RULESETTOCHECK, ONLINERULESETTOCHECK, MAXVIOLATIONCOUNT}};

    Um registro por linha, os campos como o Altium os grava (|CHAVE=VALOR|). A traducao para o
    modelo do hub (mm, nomes de campo, matriz de folgas) mora num lugar so, o
    HubPcbRegras.deAltium do hub-pcbregras.js: quando o hub abre um rules.js com "altium" e sem
    "rules", ele traduz; quando grava pelo editor, grava "rules" ja traduzido."""
    import json
    lin = ['// regras de projeto lidas do .PcbDoc (Rules6/Classes6 crus; o hub traduz: HubPcbRegras.deAltium)',
           'var pcbrules = {',
           '"format":"pcbrules-v1",',
           '"origem":%s,' % json.dumps('Rules6 de ' + (fonte or 'PcbDoc') + ' (' + EXPORTER + ')'),
           '"altium":[']
    regs = [OrderedDict((k, v) for k, v in r.items()) for r in P.regras if r]
    for i, r in enumerate(regs):
        lin.append(json.dumps(r) + (',' if i < len(regs) - 1 else ''))
    lin.append('],')
    cls = [OrderedDict((k, v) for k, v in c.items()) for c in P.classes if c]
    lin.append('"classes":[')
    for i, c in enumerate(cls):
        lin.append(json.dumps(c) + (',' if i < len(cls) - 1 else ''))
    lin.append('],')
    drc = OrderedDict((k, v) for k, v in getattr(P, 'drc_opcoes', {}).items()
                      if k in ('RULESETTOCHECK', 'ONLINERULESETTOCHECK', 'MAXVIOLATIONCOUNT'))
    lin.append('"drc":%s' % json.dumps(drc))
    lin.append('};')
    lin.append('')
    return '\n'.join(lin)


# ─── contorno exato do texto TrueType (texts[].polys) ─────────────────────────
# Calibrado contra a legenda do Gerber X2 do DMB (v94, o estado do Gerber de 22/09): os 30
# rotulos "Arial Rounded MT Bold" h 1,5748 a 225 graus dao IoU 0,9815 (min 0,978, max 0,986)
# por raster de 0,005 mm contra as 139 regioes do Altium; vertice a vertice, mediana 0,004 mm.
# A conta do Altium (medida nos 2 lados do byte 240):
#   escala   = altura do texto / (usWinAscent + usWinDescent) da fonte;
#   x local  = (x do glifo + avanco acumulado - xmin da tinta do texto) * escala -- a ancora e
#              o canto esquerdo da TINTA, nao a origem da caneta;
#   y local  = y do glifo * escala -- a ancora fica na linha de base;
#   espelho  = x local trocado de sinal; depois gira pela rotacao do texto e soma a ancora.
# O retangulo gravado no registro confere: largura = tinta, canto de baixo = ancora + ymin.
_PASTA_FONTES = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts')
_FONTE_CONHECIDA = {('arial', False, False): 'arial.ttf', ('arial', True, False): 'arialbd.ttf',
                    ('arial', False, True): 'ariali.ttf', ('arial', True, True): 'arialbi.ttf',
                    ('arial rounded mt bold', False, False): 'ARLRDBD.TTF'}
_FONTES = {}
_INDICE_FONTES = None
_PASSO_CURVA = 0.02                    # mm por segmento ao achatar a curva (IoU nao muda de 0,01 a 0,03)


def _indice_fontes():
    """{(familia, negrito, italico): arquivo} das fontes do Windows (lido uma vez)"""
    global _INDICE_FONTES
    if _INDICE_FONTES is not None:
        return _INDICE_FONTES
    _INDICE_FONTES = {}
    try:
        from fontTools.ttLib import TTFont
        nomes = os.listdir(_PASTA_FONTES)
    except (ImportError, OSError):
        return _INDICE_FONTES
    for n in nomes:
        if not n.lower().endswith(('.ttf', '.otf')):
            continue
        try:
            f = TTFont(os.path.join(_PASTA_FONTES, n), lazy=True)
            nm = f['name']
            fam = (nm.getDebugName(1) or '').strip().lower()
            sub = (nm.getDebugName(2) or '').strip().lower()
            f.close()
        except Exception:
            continue
        chave = (fam, 'bold' in sub, 'italic' in sub or 'oblique' in sub)
        _INDICE_FONTES.setdefault(chave, os.path.join(_PASTA_FONTES, n))
        _INDICE_FONTES.setdefault((fam + ' ' + sub, False, False), os.path.join(_PASTA_FONTES, n))
    return _INDICE_FONTES


def acha_fonte(nome, negrito=False, italico=False):
    """o arquivo da fonte TrueType do Windows, ou None"""
    k = (nome.strip().lower(), bool(negrito), bool(italico))
    for chave in (k, (k[0], False, False)):
        if chave in _FONTE_CONHECIDA:
            p = os.path.join(_PASTA_FONTES, _FONTE_CONHECIDA[chave])
            if os.path.exists(p) and (chave == k or not (negrito or italico)):
                return p
    idx = _indice_fontes()
    return idx.get(k) or idx.get((k[0], False, False))


def _fonte(caminho):
    if caminho not in _FONTES:
        from fontTools.ttLib import TTFont
        f = TTFont(caminho)
        _FONTES[caminho] = (f, f.getGlyphSet(), f.getBestCmap() or {})
    return _FONTES[caminho]


def _dentro(px, py, pts):
    d = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            d = not d
        j = i
    return d


def contornos_glifos(caminho_fonte, txt, passo_unid):
    """contornos (em unidade da fonte, caneta comecando em 0) do texto de uma linha:
    [(furo, [(x, y), ...]), ...] e o xmin da tinta. Curva achatada em passos de passo_unid;
    furo = contorno dentro de um numero impar de outros contornos do mesmo glifo."""
    from fontTools.pens.recordingPen import RecordingPen
    f, gs, cmap = _fonte(caminho_fonte)
    hmtx = f['hmtx']
    out, caneta, xmin = [], 0, None

    def achata(p0, pts, cubica):
        if cubica:
            c1, c2, e = pts
            comp = math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + \
                math.hypot(e[0] - c2[0], e[1] - c2[1])
            n = max(2, int(math.ceil(comp / passo_unid)))
            return [((1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * c1[0] + 3 * (1 - u) * u * u * c2[0] + u ** 3 * e[0],
                     (1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * c1[1] + 3 * (1 - u) * u * u * c2[1] + u ** 3 * e[1])
                    for u in (k / float(n) for k in range(1, n + 1))]
        c, e = pts
        comp = math.hypot(c[0] - p0[0], c[1] - p0[1]) + math.hypot(e[0] - c[0], e[1] - c[1])
        n = max(2, int(math.ceil(comp / passo_unid)))
        return [((1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * c[0] + u * u * e[0],
                 (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * c[1] + u * u * e[1])
                for u in (k / float(n) for k in range(1, n + 1))]

    for ch in txt:
        g = cmap.get(ord(ch))
        if g is None:
            continue
        rp = RecordingPen()
        gs[g].draw(rp)
        glifo, cur, ini = [], [], None
        for op, args in rp.value:
            if op == 'moveTo':
                cur, ini = [args[0]], args[0]
            elif op == 'lineTo':
                cur.append(args[0])
            elif op == 'qCurveTo':
                ctrl, fim = list(args[:-1]), args[-1] if args[-1] is not None else ini
                p0 = cur[-1] if cur else ini
                for k, c in enumerate(ctrl):
                    e = fim if k == len(ctrl) - 1 else ((c[0] + ctrl[k + 1][0]) / 2.0, (c[1] + ctrl[k + 1][1]) / 2.0)
                    cur.extend(achata(p0, (c, e), False))
                    p0 = e
            elif op == 'curveTo':
                cur.extend(achata(cur[-1], args, True))
            elif op in ('closePath', 'endPath'):
                if len(cur) >= 3:
                    if cur[-1] == cur[0]:
                        cur = cur[:-1]
                    glifo.append([(caneta + x, y) for x, y in cur])
                cur = []
        for k, pts in enumerate(glifo):
            prof = sum(1 for m, outro in enumerate(glifo) if m != k and _dentro(pts[0][0], pts[0][1], outro))
            out.append((prof % 2 == 1, pts))
            xs = min(p[0] for p in pts)
            xmin = xs if xmin is None else min(xmin, xs)
        caneta += hmtx[g][0]
    return out, (xmin or 0.0)


def contornos_truetype(t, txt, montador):
    """texts[].polys de um texto TrueType: [{"hole": bool, "pts": [[x, y], ...]}, ...] em mm no
    referencial do board.js, ou None (texto de varias linhas, fonte que o Windows nao tem)"""
    if t['tipo'] != 1 or not txt or '\n' in txt or '\r' in txt:
        return None
    caminho = acha_fonte(t['fonte'] or 'Arial', t['bold'], t['italic'])
    if not caminho:
        falta = montador.fontes_faltando
        falta[t['fonte']] = falta.get(t['fonte'], 0) + 1
        return None
    f = _fonte(caminho)[0]
    os2 = f['OS/2']
    escala = t['h'] / float(os2.usWinAscent + os2.usWinDescent)       # unidade interna por unidade da fonte
    passo = (_PASSO_CURVA / 0.0254 * 10000) / escala
    cs, xmin = contornos_glifos(caminho, txt, passo)
    a = math.radians(t['rot'])
    co, si = math.cos(a), math.sin(a)
    out = []
    for furo, pts in cs:
        q = []
        for x, y in pts:
            lx, ly = (x - xmin) * escala, y * escala
            if t['espelho']:
                lx = -lx
            q.append([montador.X(t['x'] + lx * co - ly * si), montador.Y(t['y'] + lx * si + ly * co)])
        out.append(OrderedDict([('hole', furo), ('pts', q)]))
    return out


def monta(P, gerado=None, fonte=None, contornos=None):
    """Placa -> OrderedDict no formato do board.js (pcbmirror-v1 + campos do contrato 2026-10)"""
    return _Montador(P, gerado, fonte, contornos).monta()


# ─── texto do board.js ────────────────────────────────────────────────────────
_LISTAS = ('nets', 'components', 'freepads', 'tracks', 'arcs', 'vias', 'texts', 'silk', 'regions', 'cutouts',
           'fills', 'lines', 'layers')


def board_js(B):
    """o board.js como o ExportBoard escreve: 'var pcbmirror = {', uma chave por linha no
    cabecalho, e cada lista com um item por linha (a virgula no comeco da linha seguinte)"""
    L_ = ['var pcbmirror = {']
    chaves = list(B.keys())
    for k, ch in enumerate(chaves):
        v = B[ch]
        fim = '' if k == len(chaves) - 1 else ','
        if ch == 'board':
            L_.append('"board":{"bbox":' + jv(v['bbox']) + ',')
            L_.append('"outline":' + jv(v['outline']) + '}' + fim)
        elif ch in _LISTAS:
            L_.append(js(ch) + ':[')
            for i, it in enumerate(v):
                L_.append(('' if i == 0 else ',') + jv(it))
            L_.append(']' + fim)
        else:
            L_.append(js(ch) + ':' + jv(v) + fim)
    L_.append('};')
    return '\n'.join(L_) + '\n'


def le_pcbdoc(fonte, parametros=None, gerado=None, contornos=None, nome_fonte=None):
    """atalho: caminho/bytes -> (OrderedDict do board.js, avisos)"""
    P = Placa(fonte)
    try:
        if parametros is None and isinstance(fonte, str):
            parametros, _ = parametros_do_projeto(fonte)
        P.parametros = dict(parametros or {})
        B = monta(P, gerado=gerado, fonte=nome_fonte, contornos=contornos)
    finally:
        P.fecha()
    return B, P.avisos
