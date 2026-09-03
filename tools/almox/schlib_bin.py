# -*- coding: utf-8 -*-
"""Leitura e escrita dos registros de uma .SchLib do Altium.

Este módulo cuida do CONTEÚDO (os registros dentro de cada stream `Data`); quem cuida
do contêiner OLE2 é o `cfbf.py`.

O que foi apurado abrindo a biblioteca real (403 componentes, 1.759 pinos):

  enquadramento   uint16 tamanho + 0x00 + tipo(0=texto, 1=binário), payload termina em \\0
  texto           "|RECORD=1|LibReference=2N3904|PartCount=2|…|" — chave=valor, sem escape
  pino            registro BINÁRIO, RECORD=2, campos de tamanho fixo + strings pascal
  coordenadas     int16 em unidades de 10 mil (180 mil vira 18)
  PartCount       o ARQUIVO grava partes+1; a API do Altium devolve partes.
                  Conferido: 2N3904 tem 1 parte, o arquivo diz PartCount=2 e o
                  ExportLibs (que lê pela API) espelhou partcount=1.

Tudo que não foi decodificado é preservado byte a byte, e o teste
`tests/test_schlib_bin.py` exige que reescrever a biblioteca real devolva os MESMOS
bytes — é assim que este módulo se prova sem abrir o Altium.
"""
import struct
from collections import OrderedDict

TEXTO, BINARIO = 0, 1
UNIDADE = 10          # mil por unidade de coordenada no arquivo


# ─── enquadramento ────────────────────────────────────────────────────────────
def desmonta(dados):
    """bytes de um stream Data -> [(tipo, payload_sem_o_\\0_final)]"""
    fora, i, n = [], 0, len(dados)
    while i + 4 <= n:
        # o tamanho ocupa TRES bytes; o quarto e o tipo. Na lib real nenhum registro
        # passa de 64 KB, entao o byte alto e sempre zero e da para confundir com um
        # uint16 — o FileHeader de uma lib com 466 componentes passa, e ai aparece.
        tam = dados[i] | (dados[i + 1] << 8) | (dados[i + 2] << 16)
        tipo = dados[i + 3]
        pl = dados[i + 4:i + 4 + tam]
        if len(pl) != tam:
            raise ValueError('registro truncado em %d' % i)
        # payload inteiro, com terminador e tudo: o round-trip fecha por construcao.
        # O \0 final e do registro de TEXTO; 986 dos 4.813 registros de pino da lib real
        # nao terminam em \0, entao ele nao pode ser presumido aqui.
        fora.append((tipo, pl))
        i += 4 + tam
    if i != n:
        raise ValueError('sobraram %d bytes soltos' % (n - i))
    return fora


def monta(regs):
    """[(tipo, payload)] -> bytes do stream"""
    out = bytearray()
    for tipo, pl in regs:
        n = len(pl)
        if n > 0xFFFFFF:
            raise ValueError('registro de %d bytes nao cabe no enquadramento' % n)
        out += bytes([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, tipo]) + pl
    return bytes(out)


# ─── registros de texto ───────────────────────────────────────────────────────
UTF8 = b'%UTF8%'


def segs_texto(pl):
    """Camada exata: os segmentos crus, do jeito que estao no arquivo."""
    return pl.split(b'|')


def junta_texto(segs):
    return b'|'.join(segs)


def le_texto(pl):
    """b"|RECORD=1|Name=X|" -> OrderedDict, na ordem do arquivo.

    Valor com acento aparece DUAS vezes na lib real: "%UTF8%Chave=<utf-8>", dois campos
    vazios, e "Chave=<latin-1>". Aqui fica a versao UTF-8, que e a boa; `escreve_texto`
    reconstroi o par."""
    d = OrderedDict()
    if pl.endswith(b'\x00'):
        pl = pl[:-1]
    for campo in pl.split(b'|'):
        if not campo:
            continue
        if campo.startswith(UTF8):
            k, _, v = campo[len(UTF8):].partition(b'=')
            d[k.decode('latin-1')] = v.decode('utf-8', 'replace')
        else:
            k, _, v = campo.partition(b'=')
            nome = k.decode('latin-1')
            if nome not in d:                 # a copia latin-1 nao sobrescreve a UTF-8
                d[nome] = v.decode('latin-1')
    return d


def escreve_texto(d):
    """Reconstroi o registro no formato do Altium, inclusive o par %UTF8% dos acentos."""
    segs = [b'']
    for k, v in d.items():
        kb = k.encode('latin-1')
        # '|' separa campos e o formato nao tem escape: deixar passar cortaria o registro
        s = ('' if v is None else str(v)).replace('|', '/')
        try:
            s.encode('ascii')
            segs.append(kb + b'=' + s.encode('latin-1'))
        except UnicodeEncodeError:
            segs.append(UTF8 + kb + b'=' + s.encode('utf-8'))
            segs.append(b'')
            segs.append(b'')
            segs.append(kb + b'=' + s.encode('latin-1', 'replace'))
    return b'|'.join(segs) + b'\x00'


# ─── registro de pino (binário) ───────────────────────────────────────────────
def _pascal(dados, i):
    n = dados[i]
    return dados[i + 1:i + 1 + n], i + 1 + n


def _pascal_out(b):
    if len(b) > 255:
        b = b[:255]
    return bytes([len(b)]) + b


def le_pino(pl):
    """payload binário -> dict. `cauda` guarda o que vier depois, intocado."""
    if not pl or pl[0] != 2:
        raise ValueError('nao e registro de pino')
    p = {}
    p['cabeca'] = pl[1:5]                       # 4 bytes constantes (00 00 00 00)
    p['ownerpartid'] = struct.unpack('<h', pl[5:7])[0]
    p['displaymode'] = pl[7]
    p['simbolos'] = pl[8:12]                    # inner/outer edge, inside/outside
    desc, i = _pascal(pl, 12)
    p['descricao'] = desc
    p['formal'] = pl[i]
    p['eletrico'] = pl[i + 1]
    p['conglomerado'] = pl[i + 2]               # bits 0-1 = rotacao, 4-5 = mostrar nome/desig
    p['comprimento'] = struct.unpack('<h', pl[i + 3:i + 5])[0]
    p['x'] = struct.unpack('<h', pl[i + 5:i + 7])[0]
    p['y'] = struct.unpack('<h', pl[i + 7:i + 9])[0]
    p['cor'] = struct.unpack('<I', pl[i + 9:i + 13])[0]
    i += 13
    p['nome'], i = _pascal(pl, i)
    p['designador'], i = _pascal(pl, i)
    p['cauda'] = pl[i:]
    return p


def escreve_pino(p):
    corpo = bytearray(b'\x02')
    corpo += p['cabeca']
    corpo += struct.pack('<h', p['ownerpartid'])
    corpo.append(p['displaymode'])
    corpo += p['simbolos']
    corpo += _pascal_out(p['descricao'])
    corpo.append(p['formal'])
    corpo.append(p['eletrico'])
    corpo.append(p['conglomerado'])
    corpo += struct.pack('<hhh', p['comprimento'], p['x'], p['y'])
    corpo += struct.pack('<I', p['cor'])
    corpo += _pascal_out(p['nome'])
    corpo += _pascal_out(p['designador'])
    corpo += p['cauda']
    return bytes(corpo)


# ─── vocabulário do Altium ────────────────────────────────────────────────────
ELETRICO = {'Input': 0, 'IO': 1, 'Output': 2, 'OpenCollector': 3, 'Passive': 4,
            'HiZ': 5, 'OpenEmitter': 6, 'Power': 7}
ROTACAO = {0: 0, 90: 1, 180: 2, 270: 3}
# bits 4 e 5 do conglomerado: mostrar designador e mostrar nome
CONG_MOSTRA_DESIG, CONG_MOSTRA_NOME = 0x10, 0x20


def mil(v):
    """mil -> unidade do arquivo (10 mil), arredondando para o inteiro mais proximo"""
    return int(round(v / float(UNIDADE)))


def pino(num, nome, x, y, comprimento, orient, eletrico='Passive', parte=1,
         mostra_nome=True, mostra_desig=True):
    """Monta um pino a partir dos mesmos campos que o espelho schlib-v2 usa."""
    cong = ROTACAO.get(((orient % 360) + 360) % 360, 0)
    if mostra_desig:
        cong |= CONG_MOSTRA_DESIG
    if mostra_nome:
        cong |= CONG_MOSTRA_NOME
    return {
        'cabeca': b'\x00\x00\x00\x00', 'ownerpartid': parte, 'displaymode': 0,
        'simbolos': b'\x00\x00\x00\x00', 'descricao': b'',
        'formal': 1, 'eletrico': ELETRICO.get(eletrico, 4), 'conglomerado': cong,
        'comprimento': mil(comprimento), 'x': mil(x), 'y': mil(y), 'cor': 0,
        'nome': str(nome).encode('latin-1', 'replace'),
        'designador': str(num).encode('latin-1', 'replace'),
        'cauda': b'\x00\x00\x00',
    }
