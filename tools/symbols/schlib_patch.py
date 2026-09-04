# -*- coding: utf-8 -*-
"""Grava a geometria de UM símbolo dentro da .SchLib real do Altium, sem abrir o Altium.

É o caminho de volta do `sch_leitor.py`: o hub edita pinos e gráficos no vocabulário
`schlib-v2`, e este módulo reescreve só o stream `Data` daquele componente. Tudo o
mais — os outros 400 componentes, `SectionKeys`, `Storage`, os parâmetros e modelos do
próprio componente — sai byte a byte igual ao que entrou.

O que foi apurado na biblioteca real e manda no que está escrito aqui:

  zero é ausência      o Altium não grava chave com valor 0: `Location.Y`, `X1`,
                       `LineWidth`, `StartAngle`, `IndexInSheet` somem quando são zero.
                       Aqui também, para o registro sair como o Altium escreveria.
  fração              `X=-23|X_Frac=-62206` = -236.2206 mil: o inteiro trunca para o
                       zero e a fração carrega o MESMO sinal (4.783 casos, nenhum de
                       sinal trocado). O pino binário só tem o inteiro; a fração dele
                       mora no stream PinFrac do storage (abaixo) — é assim que a lib
                       guarda pino a 2 mm (78,74 mil) ou a 10 mm (393,701 mil).
  IndexInSheet         posição 0-based do filho entre TODOS os filhos, pinos inclusive;
                       o designador e o Comment (que ficam no fim) levam -1.
  OwnerIndex           posicional: `45` aponta para o `44`, `46`/`48` para o `45`, pelo
                       índice do registro no stream. Quem tira/põe registros antes do
                       bloco de modelos precisa remapear — aqui todo registro mantido
                       tem o índice antigo -> novo, e qualquer OwnerIndex passa pelo mapa.
  conglomerado do pino bits 0-1 rotação, 0x08 mostra o NOME, 0x10 mostra o designador
                       (o 24LC256 tem 0x38 com os dois visíveis; o RES [ SMD ] tem 0x20
                       com os dois escondidos). 0x20 está na maioria mas NÃO em todos —
                       bits altos na lib: 0x38 ×1932, 0x30 ×831, 0x28 ×722, 0x20 ×271,
                       0x18 ×70 — e o que ele significa não foi apurado. (O comentário
                       do schlib_bin.py, "0x20 = mostra nome", está errado.) Os bits
                       0x08/0x10 vêm do pino do hub: `hideName`/`hideNum` true apaga o
                       bit, ausente (ou false) acende — é o que o schlib-v2 diz
                       (ausente = visível) e o que o olho da ficha mostra na tela;
                       herdar o bit do pino antigo faria o olho não valer no Altium.
                       Os outros bits altos (0x20, 0x04…) continuam vindo do pino
                       antigo de mesmo número, ou da moda do componente para pino novo.
  rótulos              o hub só sabe texto/posição/rotação/tamanho; Justification,
                       IsMirrored, cor e a fonte exata (negrito, rotação da fonte) vêm
                       do RECORD=4 antigo de mesmo texto e posição (ou só texto, se o
                       rótulo foi movido). Na lib: 9 rótulos com fonte rotacionada, 1 em
                       negrito, 4 com Justification, 2 espelhados, 42 sem Color (preto).
  cores                o corpo da casa é Color=128 + AreaColor=11599871 (283 dos 335
                       retângulos); linhas/arcos/polilinhas 16711680; rótulos 8388608.
                       Gráfico com `color`/`fill` ('#rrggbb', o que o leitor emite) grava
                       Color/AreaColor a partir deles (hex -> TColor, R + G*256 + B*65536);
                       sem os campos, o componente mantém as cores que já tinha por tipo —
                       inclusive a AUSÊNCIA de cor, que é preto (0) e não "sem paleta".
                       Preto explícito ('#000000') também sai como ausência, e ganha da
                       paleta. `fill` é gravado tenha ou não IsSolid (o Altium guarda a
                       AreaColor do retângulo vazado — 13 na lib); o leitor só a devolve
                       quando sólido, e a `esperado()` sabe disso. Chave que seria 0 nunca
                       é escrita — nem a AreaColor de linha/arco/polilinha/rótulo, que a
                       paleta lia como 0 e uma versão anterior deste módulo gravava.
  PinFrac              regravado, não descartado: `|HEADER=PinFrac|Weight=N` + N
                       registros binários `D0` + string pascal do ORDINAL do pino +
                       uint32 + zlib de 3 int32 (xfrac, yfrac, lenfrac em 1/100000 da
                       unidade, com sinal — a mesma conta da `_unidade`). É ESPARSO:
                       Weight conta entradas, não pinos (AD711KN tem 5 pinos, Weight=1,
                       ordinal 4). O ordinal é a posição do pino entre TODOS os registros
                       binários de pino do Data, 0-based, contando também os de modo de
                       exibição > 0 — é como o `sch_leitor._simbolo` conta; a lib não tem
                       nenhum desses, mas se tiver ele fica e leva a fração antiga junto.
                       Sem pino com fração o stream não existe, como em 347 dos 404.
  PinTextData/WideText removidos do componente editado — o Altium regenera. Os dos
                       outros componentes ficam.
  fração das coords    o leitor entrega 3 casas (as da API) e o patch regrava a partir
                       delas: 1 em 4 coordenadas com _Frac volta com a 4ª casa mudada
                       (<= 0,0005 mil); no PinFrac idem — 649 valores da lib têm 4ª casa,
                       e a menor fração (1/100000) vira zero. Só o Data e o PinFrac do
                       componente editado; e nada no hub ou no Altium enxerga 1/20000 da
                       grade.
  Weight               do FileHeader é a contagem de registros (+1) e NÃO é validado pelo
                       Altium (o escritor do almoxarifado grava outra coisa e abre). Fica
                       como está, por instrução — o índice LibRef/CompDescr/PartCount é
                       o que importa, e só o PartCount do componente editado muda.

Uso: python tools/symbols/schlib_patch.py CAMINHO.SchLib simbolo.json [--sem-backup] [--sem-verificar]
"""
import collections
import io
import json
import os
import re
import shutil
import struct
import sys
import zlib
from collections import OrderedDict
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, BASE)

import cfbf                                            # noqa: E402
import schlib_bin as SB                                # noqa: E402
from schlib_escritor import _uid                       # noqa: E402
import sch_leitor                                      # noqa: E402

# registros que são desenho/pino e saem do Data para dar lugar à geometria nova (o 3 e
# os modos de exibição > 0 ficam: veja _e_geometria)
GEOMETRIA = {'2', '3', '4', '5', '6', '7', '8', '10', '11', '12', '13', '14'}
# streams do componente que descrevem os pinos antigos e que ninguém regrava (o
# PinFrac também depende deles, mas esse o `aplica` reescreve)
DEPENDEM_DOS_PINOS = ('PinTextData', 'PinWideText')
# w em mil -> LineWidth do Altium (0=Smallest .. 3=Large)
LARGURA = {4: 0, 10: 1, 20: 2, 30: 3}
TIPOS = ['Input', 'IO', 'Output', 'OpenCollector', 'Passive', 'HiZ', 'OpenEmitter', 'Power']
SOBRELINHA = chr(0x305)          # a API do Altium/schlib.js: negação sobre a letra
BARRA = chr(0xAF)                # o mesmo sinal, no binário do pino
CONG_ALTOS = 0xFC                # tudo que não é rotação no conglomerado do pino
CONG_VIS = sch_leitor.CONG_NOME | sch_leitor.CONG_NUM   # 0x18: os bits que o olho do hub manda
CONG_PADRAO = 0x38               # nome e número visíveis, como a maioria da lib
BACKUPS = 30
FONTE_NOVA = 'Times New Roman'

# cor por tipo de registro quando o componente ainda não tem nada daquele tipo
PALETA = {
    '13': {'Color': 16711680},
    '12': {'Color': 16711680},
    '6': {'Color': 16711680},
    '7': {'Color': 16711680, 'AreaColor': 16711680},
    '8': {'Color': 16711680, 'AreaColor': 12632256},
    '14': {'Color': 128, 'AreaColor': 11599871},
    '4': {'Color': 8388608},
}


class LibOcupada(Exception):
    """a .SchLib está aberta no Altium (ou em outro programa que trava o arquivo)"""


# ─── números ──────────────────────────────────────────────────────────────────
def _int(v, padrao=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return padrao


def _unidade(mil):
    """mil -> (inteiro em 10 mil, fração em 1/100000 da unidade), como o Altium grava:
    inteiro truncado para o zero e fração com o mesmo sinal."""
    dec = float(mil) / 10.0
    i = int(dec)                                   # trunca para o zero
    f = int(round((dec - i) * 100000))
    if abs(f) >= 100000:                           # 9.99999.. arredondou para o inteiro
        i += 1 if f > 0 else -1
        f = 0
    return i, f


def _coord(d, chave, mil):
    """põe `chave` (+ `chave_Frac`) no registro; zero não é gravado, como no Altium"""
    i, f = _unidade(mil)
    if i:
        d[chave] = i
    if f:
        d[chave + '_Frac'] = f


def _largura(w):
    """w em mil -> LineWidth; valor fora da tabela vai para o mais próximo"""
    if w is None:
        return None
    w = float(w)
    return LARGURA[min(LARGURA, key=lambda k: abs(k - w))]


def _mil10(v):
    """coordenada na grade de 10 mil (utilitário; o pino não passa mais por aqui — a
    fração dele vai para o PinFrac)"""
    return SB.mil(float(v)) * SB.UNIDADE


# ─── a biblioteca em memória ──────────────────────────────────────────────────
class Lib(object):
    """A .SchLib inteira: `arvore` é o que o `cfbf.escreve` recebe; `comps` e `topo` são
    vistas dela (storage -> {stream: bytes} e nome -> bytes); `cab` é o FileHeader já
    decodificado e `indice` liga LibReference -> storage, lido dos `Data` — nunca
    derivado do nome, porque dois storages da lib real não batem com a derivação."""

    def __init__(self, caminho=''):
        self.caminho = caminho
        self.arvore = OrderedDict()
        self.comps = OrderedDict()
        self.topo = OrderedDict()
        self.cab_regs = []
        self.cab = OrderedDict()
        self.cab_mudou = False
        self.indice = OrderedDict()
        self.editados = []


def _le_ole(fonte):
    """caminho | bytes | BytesIO -> {caminho/do/stream: bytes}; fecha o arquivo logo, para
    não segurar um handle na hora do os.replace"""
    olefile = sch_leitor.olefile_ou_erro()   # sem o modulo, um recado em vez de traceback
    if isinstance(fonte, (bytes, bytearray)):
        o = olefile.OleFileIO(io.BytesIO(bytes(fonte)))
    else:
        o = olefile.OleFileIO(fonte)
    try:
        return OrderedDict(('/'.join(p), o.openstream('/'.join(p)).read()) for p in o.listdir())
    finally:
        o.close()


def carrega(caminho):
    """.SchLib -> Lib (o arquivo é lido inteiro para a memória e fechado)"""
    streams = _le_ole(caminho)
    lib = Lib(caminho if isinstance(caminho, str) else '')
    for nome, dados in streams.items():
        partes = nome.split('/')
        no = lib.arvore
        for p in partes[:-1]:
            no = no.setdefault(p, OrderedDict())
        no[partes[-1]] = dados
    for k, v in lib.arvore.items():
        (lib.comps if isinstance(v, dict) else lib.topo)[k] = v
    if 'FileHeader' not in lib.topo:
        raise ValueError('não é uma .SchLib: falta o FileHeader')
    lib.cab_regs = SB.desmonta(lib.topo['FileHeader'])
    if not lib.cab_regs or lib.cab_regs[0][0] != SB.TEXTO:
        raise ValueError('FileHeader sem o registro de cabeçalho')
    lib.cab = SB.le_texto(lib.cab_regs[0][1])
    for st, streams_st in lib.comps.items():
        dados = streams_st.get('Data')
        if not dados:
            continue
        try:
            regs = SB.desmonta(dados)
        except ValueError:
            continue
        if regs and regs[0][0] == SB.TEXTO:
            d = SB.le_texto(regs[0][1])
            if d.get('RECORD') == '1' and d.get('LibReference', '') not in lib.indice:
                lib.indice[d.get('LibReference', '')] = st
    return lib


def acha(lib, nome):
    """storage do componente com RECORD=1 » LibReference == nome (sem caixa como 2ª chance)"""
    if nome in lib.indice:
        return lib.indice[nome]
    baixo = (nome or '').lower()
    for ref, st in lib.indice.items():
        if ref.lower() == baixo:
            return st
    return None


# ─── fontes de rótulo ─────────────────────────────────────────────────────────
def _poe_depois(cab, ref, novos):
    """insere pares (chave, valor) logo depois de `ref` — o FileHeader tem layout (fontes
    juntas, índice junto) e um Altium que lê por posição não estranha"""
    fora = OrderedDict()
    feito = ref not in cab
    for k, v in cab.items():
        fora[k] = v
        if k == ref:
            for nk, nv in novos:
                fora[nk] = nv
            feito = True
    if not feito:
        for nk, nv in novos:
            fora[nk] = nv
    cab.clear()
    cab.update(fora)


def _font_id(cab, size, avisos, preferida=None):
    """FontID com aquele tamanho. `preferida` é a fonte do rótulo antigo: se o tamanho
    ainda bate, é ela, negrito ou rotacionada que seja — regravar não muda a cara.

    Sem rótulo antigo: fonte lisa; depois uma com negrito/itálico/sublinhado (cosmético);
    uma com Rotation nunca, porque ela GIRA o texto e o hub já disse a rotação no
    Orientation. Só então se acrescenta uma fonte ao FileHeader."""
    size = int(round(float(size or 10)))
    n = _int(cab.get('FontIdCount'))
    if preferida and 1 <= _int(preferida) <= n and _int(cab.get('Size%d' % _int(preferida))) == size:
        return _int(preferida)
    lisas, estilizadas = [], []
    for k in range(1, n + 1):
        if _int(cab.get('Size%d' % k)) != size or ('Rotation%d' % k) in cab:
            continue
        if any(('%s%d' % (p, k)) in cab for p in ('Bold', 'Italic', 'Underline')):
            estilizadas.append(k)
        else:
            lisas.append(k)
    for candidatos in (lisas, estilizadas):
        if candidatos:
            return sorted(candidatos, key=lambda k: (cab.get('FontName%d' % k) != FONTE_NOVA, k))[0]
    k = n + 1
    ultimo = 'FontName%d' % n if n else 'FontIdCount'
    _poe_depois(cab, ultimo, [('Size%d' % k, size), ('FontName%d' % k, FONTE_NOVA)])
    cab['FontIdCount'] = k
    avisos.append('fonte %d (%s %dpt) acrescentada ao FileHeader' % (k, FONTE_NOVA, size))
    return k


# ─── pinos ────────────────────────────────────────────────────────────────────
def _bytes_pino(s):
    """nome/número do pino como o binário guarda: cp1252, negação como 0xAF"""
    return str(s if s is not None else '').replace(SOBRELINHA, BARRA).encode('cp1252', 'replace')


def _visibilidade(pin):
    """bits 0x08/0x10 do conglomerado pelo `hideName`/`hideNum` do pino: true apaga,
    ausente ou false acende (ausente = visível, como o schlib-v2 e o canvas do hub)"""
    v = 0
    if not pin.get('hideName'):
        v |= sch_leitor.CONG_NOME
    if not pin.get('hideNum'):
        v |= sch_leitor.CONG_NUM
    return v


def _pino_registro(pin, parte, antigo, altos):
    """pin schlib-v2 -> ((tipo, payload) binário, (xfrac, yfrac, lenfrac)); `antigo` é o
    dict do pino de mesmo número que estava no arquivo (o que o hub não sabe editar vem
    dele — menos a visibilidade de nome/número, que é do hub). O binário leva o inteiro
    TRUNCADO (o `SB.pino` arredonda, por isso a conta é refeita aqui com a `_unidade`)
    e a fração vai para o PinFrac."""
    x, y, comp = (float(pin.get(k, d) or 0) for k, d in (('x', 0), ('y', 0), ('len', 100)))
    p = SB.pino(pin.get('num', ''), pin.get('name', ''), x, y, comp,
                _int(pin.get('orient')), pin.get('type', 'Passive'), parte)
    (p['x'], xf), (p['y'], yf), (p['comprimento'], lf) = _unidade(x), _unidade(y), _unidade(comp)
    p['nome'] = _bytes_pino(pin.get('name', ''))
    p['designador'] = _bytes_pino(pin.get('num', ''))
    rot = p['conglomerado'] & 3
    if antigo:
        for k in ('cabeca', 'simbolos', 'descricao', 'formal', 'cor', 'cauda'):
            p[k] = antigo[k]
    herdado = (antigo['conglomerado'] if antigo else altos) & CONG_ALTOS & ~CONG_VIS
    p['conglomerado'] = rot | herdado | _visibilidade(pin)
    return (SB.BINARIO, SB.escreve_pino(p)), (xf, yf, lf)


def monta_pinfrac(entradas):
    """{ordinal: (xfrac, yfrac, lenfrac)} -> bytes do stream PinFrac, no formato apurado
    no cabeçalho do módulo (o `sch_leitor._le_pinfrac` é o inverso). Sem entradas, None:
    o stream não é gravado. O ordinal vai como string pascal (1 byte de tamanho + os
    dígitos): conferido na lib real até 2 dígitos (maior ordinal 29); 3 dígitos seguem
    a mesma regra, mas ninguém viu o Altium escrever um."""
    entradas = {k: v for k, v in entradas.items() if any(v)}
    if not entradas:
        return None
    regs = [(SB.TEXTO, SB.escreve_texto(OrderedDict([('HEADER', 'PinFrac'), ('Weight', len(entradas))])))]
    for ordinal in sorted(entradas):
        s = str(ordinal).encode('ascii')
        z = zlib.compress(struct.pack('<iii', *entradas[ordinal]))
        regs.append((SB.BINARIO, b'\xd0' + bytes([len(s)]) + s + struct.pack('<I', len(z)) + z))
    return SB.monta(regs)


def _e_pino(tipo, pl):
    """registro binário de pino — o que o leitor conta no ordinal do PinFrac"""
    return tipo == SB.BINARIO and pl[:1] == b'\x02'


# ─── rótulos antigos ──────────────────────────────────────────────────────────
def _mil_de(d, k):
    """`Location.X` (+ `_Frac`) -> mil, nas 3 casas do leitor (é com ele que se compara)"""
    return round((_int(d.get(k)) * 100000 + _int(d.get(k + '_Frac'))) / 10000.0, 3)


def rotulo_antigo(d):
    """RECORD=4 -> o que o hub não representa e tem que sobreviver à regravação"""
    r = {'text': d.get('Text', ''), 'x': _mil_de(d, 'Location.X'), 'y': _mil_de(d, 'Location.Y'),
         'FontID': _int(d.get('FontID'), 1), 'Color': _int(d.get('Color'))}
    for k in ('Justification', 'IsMirrored'):
        if k in d:
            r[k] = d[k]
    return r


def _casa_rotulo(antigos, g):
    """o rótulo antigo deste `label`: mesmo texto e posição; senão, mesmo texto se for o
    único que sobrou com ele (o usuário só o moveu). Tira da lista para não casar duas
    vezes. Devolve None para rótulo novo de verdade."""
    texto = str(g.get('text', ''))
    x, y = float(g.get('x', 0) or 0), float(g.get('y', 0) or 0)
    for i, r in enumerate(antigos):
        if r['text'] == texto and abs(r['x'] - x) <= TOL and abs(r['y'] - y) <= TOL:
            return antigos.pop(i)
    mesmos = [i for i, r in enumerate(antigos) if r['text'] == texto]
    if len(mesmos) == 1:
        return antigos.pop(mesmos[0])
    return None


# ─── gráficos ─────────────────────────────────────────────────────────────────
def _registro(rec, parte, idx, uid, campos):
    """o registro de texto na ordem de `campos`; zero/vazio não é gravado (o Altium também não)"""
    d = OrderedDict([('RECORD', rec), ('IsNotAccesible', 'T')])
    if idx:
        d['IndexInSheet'] = idx
    d['OwnerPartId'] = parte
    for k, v in campos:
        if v is None or v == 0 or v == '':
            continue
        d[k] = v
    d['UniqueID'] = uid
    return (SB.TEXTO, SB.escreve_texto(d))


def _cor(g, chave, cores, k):
    """o TColor de `k` (Color/AreaColor): o `color`/`fill` do gráfico quando veio, senão o
    que o componente já usa nesse tipo (ou o da casa). Sai de `cores` nos dois casos. 0
    (preto) vira ausência no `_registro`, como o Altium grava."""
    herdada = cores.pop(k, None)
    v = sch_leitor.cor_int(g.get(chave))
    return herdada if v is None else v


def _pts(g):
    campos = [('LocationCount', len(g.get('pts') or []))]
    saida = []
    for i, (x, y) in enumerate(g.get('pts') or [], 1):
        d = OrderedDict()
        _coord(d, 'X%d' % i, x)
        _coord(d, 'Y%d' % i, y)
        saida += list(d.items())
    return campos + saida


def _xy(g, chave, kx, ky):
    d = OrderedDict()
    _coord(d, chave + '.X', g.get(kx, 0))
    _coord(d, chave + '.Y', g.get(ky, 0))
    return list(d.items())


def _raio(g, chave, k):
    d = OrderedDict()
    _coord(d, chave, g.get(k, 0))
    return list(d.items())


def grafico_para_registro(g, parte, idx, uid, cab, paleta, avisos, antigo=None):
    """um item `graphics` do hub -> registro de texto do Altium (RECORD 13/14/12/8/7/6/4).
    `antigo` (só para label) é o dict de `rotulo_antigo` de onde vêm fonte, cor,
    Justification e IsMirrored. `color`/`fill` do gráfico mandam na Color/AreaColor;
    sem eles, a paleta do componente (`_paleta`) e, por último, a da casa (PALETA)."""
    k = g.get('g')
    cores = dict(PALETA.get({'line': '13', 'rect': '14', 'arc': '12', 'ellipse': '8',
                             'poly': '7', 'polyline': '6', 'label': '4'}.get(k, ''), {}))
    rec = None
    if k == 'line':
        rec, campos = 13, _xy(g, 'Location', 'x1', 'y1') + _xy(g, 'Corner', 'x2', 'y2')
    elif k == 'rect':
        rec, campos = 14, _xy(g, 'Location', 'x1', 'y1') + _xy(g, 'Corner', 'x2', 'y2')
    elif k == 'arc':
        sa, ea = float(g.get('sa', 0) or 0), float(g.get('ea', 360) or 0)
        rec = 12
        campos = _xy(g, 'Location', 'cx', 'cy') + _raio(g, 'Radius', 'r')
    elif k == 'ellipse':
        rec = 8
        campos = _xy(g, 'Location', 'cx', 'cy') + _raio(g, 'Radius', 'rx') + _raio(g, 'SecondaryRadius', 'ry')
    elif k == 'poly':
        rec, campos = 7, []
    elif k == 'polyline':
        rec, campos = 6, []
    elif k == 'label':
        rec, campos = 4, _xy(g, 'Location', 'x', 'y')
    if rec is None:
        avisos.append('gráfico "%s" desconhecido, ignorado' % k)
        return None
    cores.update(paleta.get(str(rec), {}))
    w = _largura(g.get('w')) if 'w' in g else cores.pop('LineWidth', None)
    cores.pop('LineWidth', None)
    if rec in (13, 14, 12, 8, 6, 7):
        if rec == 7:
            # o Altium escreve AreaColor/IsSolid ANTES dos pontos no polígono
            campos = [('LineWidth', w), ('Color', _cor(g, 'color', cores, 'Color')),
                      ('AreaColor', _cor(g, 'fill', cores, 'AreaColor')),
                      ('IsSolid', 'T' if g.get('solid') else None)] + _pts(g)
        elif rec == 6:
            campos = [('LineWidth', w), ('Color', _cor(g, 'color', cores, 'Color'))] + _pts(g)
        else:
            campos.append(('LineWidth', w))
    if rec == 12:
        campos += [('StartAngle', '%.3f' % sa if sa else None), ('EndAngle', '%.3f' % ea)]
        campos.append(('Color', _cor(g, 'color', cores, 'Color')))
    if rec in (13,):
        campos.append(('Color', _cor(g, 'color', cores, 'Color')))
    if rec == 14:
        # Transparent segue o que o componente já tinha (193 dos 335 retângulos da lib têm)
        campos += [('Color', _cor(g, 'color', cores, 'Color')), ('AreaColor', _cor(g, 'fill', cores, 'AreaColor')),
                   ('IsSolid', 'T' if g.get('solid') else None),
                   ('Transparent', 'T' if cores.pop('Transparent', True) else None)]
    if rec == 8:
        campos += [('Color', _cor(g, 'color', cores, 'Color')), ('AreaColor', _cor(g, 'fill', cores, 'AreaColor')),
                   ('IsSolid', 'T' if g.get('solid') else None)]
    if rec == 4:
        rot = (_int(g.get('rot')) % 360) // 90
        antigo = antigo or {}
        if 'Color' in antigo:
            cores['Color'] = antigo['Color']         # 0 = preto = não gravar
        # a ordem das chaves é a do Altium: Orientation, Justification, Color, FontID, Text, IsMirrored
        campos += [('Orientation', rot or None), ('Justification', antigo.get('Justification')),
                   ('Color', _cor(g, 'color', cores, 'Color')),
                   ('FontID', _font_id(cab, g.get('size', 10), avisos, antigo.get('FontID'))),
                   ('Text', g.get('text', '')), ('IsMirrored', antigo.get('IsMirrored'))]
    return _registro(rec, parte, idx, uid, campos)


def _paleta(regs):
    """cores e largura que o componente já usa, por tipo de registro (primeira ocorrência):
    regravar um símbolo não pode mudar a cara dele. Chave ausente é zero (preto,
    Smallest) e entra como zero — senão a PALETA padrão pintaria de azul o que era preto."""
    fora = {}
    for tipo, pl in regs:
        if tipo != SB.TEXTO:
            continue
        d = SB.le_texto(pl)
        r = d.get('RECORD')
        if r in GEOMETRIA and r not in fora:
            fora[r] = {k: _int(d.get(k)) for k in ('Color', 'AreaColor', 'LineWidth')}
            if r in ('14', '10'):
                fora[r]['Transparent'] = d.get('Transparent') == 'T'
    # retângulo arredondado e arco elíptico voltam como retângulo/arco
    for de, para in (('10', '14'), ('11', '12')):
        if de in fora and para not in fora:
            fora[para] = fora[de]
    return fora


def simbolo_para_registros(sym_parts, cab, nome='', inicio=0, paleta=None, pinos_antigos=None,
                           avisos=None, rotulos_antigos=None, fracs=None):
    """parts schlib-v2 -> (registros de geometria, cab). Pinos binários e gráficos texto,
    por parte, com IndexInSheet sequencial a partir de `inicio` (a posição entre os
    filhos do componente onde eles vão entrar). `rotulos_antigos` (lista de
    `rotulo_antigo`) é consumida: cada label casa no máximo um. `fracs` (dict) recebe
    posição-na-lista -> (xfrac, yfrac, lenfrac) de cada pino que tem fração — quem monta
    o PinFrac é o `aplica`, porque o ordinal só existe depois do Data inteiro."""
    avisos = avisos if avisos is not None else []
    fracs = fracs if fracs is not None else {}
    paleta = paleta or {}
    pinos_antigos = pinos_antigos or {}
    rotulos_antigos = list(rotulos_antigos or [])
    fora = []
    idx = inicio
    # bits altos do conglomerado para pino que não existia: a moda do componente
    contagem = collections.Counter(p['conglomerado'] & CONG_ALTOS for p in pinos_antigos.values())
    altos = contagem.most_common(1)[0][0] if contagem else CONG_PADRAO
    for n, parte in enumerate(sym_parts or []):
        pid = _int(parte.get('part'), n + 1) or (n + 1)
        for j, pin in enumerate(parte.get('pins') or []):
            num = str(pin.get('num', ''))
            antigo = pinos_antigos.get((pid, num)) or pinos_antigos.get((0, num)) or \
                next((p for (_o, n), p in pinos_antigos.items() if n == num), None)
            reg, frac = _pino_registro(pin, pid, antigo, altos)
            if any(frac):
                fracs[len(fora)] = frac
            fora.append(reg)
            idx += 1
        for j, g in enumerate(parte.get('graphics') or []):
            antigo = _casa_rotulo(rotulos_antigos, g) if g.get('g') == 'label' else None
            r = grafico_para_registro(g, pid, idx, _uid('%s#p%d#g%d' % (nome, pid, j)), cab, paleta, avisos, antigo)
            if r is not None:
                fora.append(r)
                idx += 1
    return fora, cab


# ─── o componente inteiro ─────────────────────────────────────────────────────
def _e_geometria(tipo, pl, avisos=None):
    """o registro é desenho/pino que o hub editou? O que o hub NÃO representa fica no
    arquivo: o símbolo IEEE (RECORD 3) e a geometria dos modos de exibição alternativos
    (OwnerPartDisplayMode > 0) — descartar seria perder o que ninguém pediu para mudar."""
    if tipo == SB.BINARIO:
        if pl[:1] != b'\x02':
            return False
        try:
            return SB.le_pino(pl)['displaymode'] == 0
        except (ValueError, IndexError):
            return False
    d = SB.le_texto(pl)
    r = d.get('RECORD')
    if r not in GEOMETRIA:
        return False
    if _int(d.get('OwnerPartDisplayMode')) > 0:
        return False
    if r == '3':
        if avisos is not None:
            avisos.append('símbolo IEEE (RECORD 3) mantido: o hub não o desenha')
        return False
    return True


def aplica(lib, sym):
    """troca a geometria do componente `sym['name']` pela de `sym['parts']`; devolve avisos.

    Mantém, na ordem, tudo que não é desenho: RECORD=1 (com AllPinCount/PartCount
    atualizados), designador (34), parâmetros (41) e o bloco de modelos (44/45/46/48) com
    os OwnerIndex remapeados. A geometria nova entra onde a antiga começava. O PinFrac
    é refeito a partir das frações dos pinos novos (e das antigas dos pinos de modo de
    exibição > 0, que ficam)."""
    avisos = []
    nome = sym.get('name', '')
    st = acha(lib, nome)
    if st is None:
        raise ValueError('símbolo "%s" não existe na biblioteca' % nome)
    regs = SB.desmonta(lib.comps[st]['Data'])
    cabc = SB.le_texto(regs[0][1])
    parts = sym.get('parts') or []
    if not parts:
        raise ValueError('símbolo "%s" sem partes' % nome)
    # PartCount é uma contagem, não uma lista: parte 3 sem parte 2 ficaria fora dela e o
    # Altium (e o leitor) a descartariam — melhor recusar antes de escrever
    ids = [_int(p.get('part'), n + 1) or (n + 1) for n, p in enumerate(parts)]
    if sorted(ids) != list(range(1, len(parts) + 1)):
        raise ValueError('símbolo "%s": as partes têm que ser 1..%d, vieram %s' % (nome, len(parts), ids))

    # 1. separa o que fica do que sai; guarda o pino antigo por (parte, número) e os
    #    rótulos antigos (fonte/cor/justificação que o hub não sabe)
    mantidos = []            # (indice_antigo, tipo, payload)
    pinos_antigos = {}
    rotulos_antigos = []
    onde = None              # posição (entre os filhos) onde a geometria começava
    # o PinFrac antigo é indexado pelo ordinal do pino no Data antigo — ordinal que conta
    # TODO registro binário de pino, legível ou não, de qualquer modo de exibição
    frac_antigo = sch_leitor._le_pinfrac(lib.comps[st]['PinFrac'], avisos, st) if lib.comps[st].get('PinFrac') else {}
    ordinal_antigo = {}      # indice_antigo -> ordinal, só dos pinos que ficam
    ordinal = 0
    for i, (tipo, pl) in enumerate(regs):
        if i == 0:
            continue
        if _e_pino(tipo, pl):
            ordinal_antigo[i] = ordinal
            ordinal += 1
        if _e_geometria(tipo, pl, avisos):
            if onde is None:
                onde = len(mantidos)
            if tipo == SB.BINARIO:
                try:
                    p = SB.le_pino(pl)
                    pinos_antigos.setdefault((max(p['ownerpartid'], 0), p['designador'].decode('cp1252', 'replace')), p)
                except (ValueError, IndexError):
                    avisos.append('pino antigo ilegível descartado')
            else:
                d = SB.le_texto(pl)
                if d.get('RECORD') == '4':
                    rotulos_antigos.append(rotulo_antigo(d))
            continue
        mantidos.append((i, tipo, pl))
    if onde is None:
        # sem desenho nenhum: entra antes do primeiro registro que "fecha" o componente
        onde = len(mantidos)
        for j, (i, tipo, pl) in enumerate(mantidos):
            r = SB.le_texto(pl).get('RECORD')
            if r in ('34', '44') or (r == '41' and SB.le_texto(pl).get('Name') == 'Comment'):
                onde = j
                break

    # 2. a geometria nova (pode acrescentar uma fonte ao FileHeader)
    cab_antes = SB.escreve_texto(lib.cab)
    paleta = _paleta(regs[1:])
    fracs = {}               # posição em `novos` -> (xfrac, yfrac, lenfrac)
    novos, _ = simbolo_para_registros(parts, lib.cab, nome, onde, paleta, pinos_antigos, avisos,
                                      rotulos_antigos, fracs)

    # 3. cabeçalho do componente
    npinos = sum(len(p.get('pins') or []) for p in parts)
    cabc['AllPinCount'] = npinos
    cabc['PartCount'] = len(parts) + 1                    # o arquivo grava partes+1
    cabc.setdefault('DisplayModeCount', 1)
    if sym.get('description') is not None and str(sym['description']) != cabc.get('ComponentDescription', ''):
        cabc['ComponentDescription'] = str(sym['description'])
        if not cabc['ComponentDescription']:
            del cabc['ComponentDescription']

    # 4. remonta: mantidos antes, geometria, mantidos depois; índice antigo -> novo
    saida = [(SB.TEXTO, SB.escreve_texto(cabc))]
    mapa = {0: 0}
    frac_saida = {}          # posição em `saida` -> (xfrac, yfrac, lenfrac)
    fila = mantidos[:onde] + [None] * len(novos) + mantidos[onde:]
    k_novo = 0
    for pos, item in enumerate(fila):
        if item is None:
            if k_novo in fracs:
                frac_saida[len(saida)] = fracs[k_novo]
            saida.append(novos[k_novo])
            k_novo += 1
            continue
        i, tipo, pl = item
        mapa[i] = len(saida)
        if i in ordinal_antigo and ordinal_antigo[i] in frac_antigo:
            frac_saida[len(saida)] = frac_antigo[ordinal_antigo[i]]
        if tipo == SB.TEXTO and pos >= onde + len(novos):
            d = SB.le_texto(pl)
            if 'IndexInSheet' in d and _int(d['IndexInSheet'], -1) >= 0:
                d['IndexInSheet'] = pos             # os que ficaram depois deslizaram
                pl = SB.escreve_texto(d)
        saida.append((tipo, pl))
    # OwnerIndex é posicional: 45 -> 44, 46/48 -> 45. Tudo que ficou passa pelo mapa.
    for j, (tipo, pl) in enumerate(saida):
        if tipo != SB.TEXTO or b'OwnerIndex=' not in pl:
            continue
        d = SB.le_texto(pl)
        velho = _int(d.get('OwnerIndex'), -1)
        if velho in mapa:
            if mapa[velho] != velho:
                d['OwnerIndex'] = mapa[velho]
                saida[j] = (tipo, SB.escreve_texto(d))
        else:
            avisos.append('RECORD=%s apontava para o registro %d, que saiu' % (d.get('RECORD'), velho))
    lib.comps[st]['Data'] = SB.monta(saida)

    # 5. o PinFrac, pelo ordinal de cada pino no Data que acabou de ser montado — a
    #    mesma contagem do leitor: todo registro binário de pino, na ordem gravada
    entradas = {}
    ordinal = 0
    for j, (tipo, pl) in enumerate(saida):
        if not _e_pino(tipo, pl):
            continue
        if j in frac_saida:
            entradas[ordinal] = frac_saida[j]
        ordinal += 1
    pinfrac = monta_pinfrac(entradas)
    if pinfrac is not None:
        lib.comps[st]['PinFrac'] = pinfrac
    elif 'PinFrac' in lib.comps[st]:
        del lib.comps[st]['PinFrac']
        avisos.append('PinFrac de "%s" removido: nenhum pino com fração' % nome)
    # os streams que descrevem os pinos antigos não servem mais; o Altium regenera
    for s in DEPENDEM_DOS_PINOS:
        if s in lib.comps[st]:
            del lib.comps[st][s]
            avisos.append('%s de "%s" removido' % (s, nome))

    # 6. o índice do FileHeader
    k = _indice_cab(lib.cab, cabc.get('LibReference', nome))
    if k is not None:
        if _int(lib.cab.get('PartCount%d' % k)) != len(parts) + 1:
            lib.cab['PartCount%d' % k] = len(parts) + 1
            avisos.append('PartCount de "%s": %d parte(s)' % (nome, len(parts)))
        desc = cabc.get('ComponentDescription', '')
        if lib.cab.get('CompDescr%d' % k, '') != desc:
            if desc:
                if ('CompDescr%d' % k) in lib.cab:
                    lib.cab['CompDescr%d' % k] = desc
                else:
                    _poe_depois(lib.cab, 'LibRef%d' % k, [('CompDescr%d' % k, desc)])
            else:
                del lib.cab['CompDescr%d' % k]
    else:
        avisos.append('"%s" não está no índice LibRef do FileHeader' % nome)
    if SB.escreve_texto(lib.cab) != cab_antes:
        lib.cab_mudou = True
    lib.editados.append(st)
    return avisos


def _indice_cab(cab, nome):
    i = 0
    while ('LibRef%d' % i) in cab:
        if cab['LibRef%d' % i] == nome:
            return i
        i += 1
    return None


# ─── gravação ─────────────────────────────────────────────────────────────────
def _bytes_lib(lib):
    arvore = OrderedDict()
    for k, v in lib.arvore.items():
        arvore[k] = v
    if lib.cab_mudou:
        regs = list(lib.cab_regs)
        regs[0] = (SB.TEXTO, SB.escreve_texto(lib.cab))
        arvore['FileHeader'] = SB.monta(regs)
    return cfbf.escreve(arvore)


def _ocupada(e):
    return LibOcupada('feche a biblioteca no Altium e tente de novo (%s)' % e)


def faz_backup(caminho, backup_dir=None):
    """cópia datada do arquivo em backup_dir (default <dir>/Backup-hub/); guarda as 30 mais novas"""
    if not os.path.exists(caminho):
        return None
    backup_dir = backup_dir or os.path.join(os.path.dirname(os.path.abspath(caminho)), 'Backup-hub')
    os.makedirs(backup_dir, exist_ok=True)
    base, ext = os.path.splitext(os.path.basename(caminho))
    alvo = os.path.join(backup_dir, '%s.%s%s' % (base, datetime.now().strftime('%Y-%m-%d_%H%M%S'), ext))
    n = 0
    while os.path.exists(alvo):                     # dois saves no mesmo segundo
        n += 1
        alvo = os.path.join(backup_dir, '%s.%s-%d%s' % (base, datetime.now().strftime('%Y-%m-%d_%H%M%S'), n, ext))
    try:
        shutil.copy2(caminho, alvo)
    except PermissionError as e:
        raise _ocupada(e)
    # poda pelo carimbo do nome (data, depois o -n do mesmo segundo) — ordenar o nome cru
    # põe "…_131452-1" antes de "…_131452." e apagaria o backup que acabou de nascer; o
    # mtime não serve porque o copy2 preserva o do original
    rx = re.compile(r'^' + re.escape(base) + r'\.(\d{4}-\d{2}-\d{2}_\d{6})(?:-(\d+))?' + re.escape(ext) + '$')
    velhos = []
    for f in os.listdir(backup_dir):
        m = rx.match(f)
        if m and os.path.join(backup_dir, f) != alvo:
            velhos.append((m.group(1), int(m.group(2) or 0), os.path.join(backup_dir, f)))
    velhos.sort()
    for _d, _n, f in velhos[:max(0, len(velhos) + 1 - BACKUPS)]:
        try:
            os.remove(f)
        except OSError:
            pass
    return alvo


def registra_no_ledger(raiz, caminho):
    """anota no Libs/lib-ledger.json de `raiz` que o HUB acabou de escrever `caminho` — senão
    o próprio save apareceria como "mudou no Altium". Import tardio: o guardião importa
    este módulo. `raiz` None = ninguém registra (os testes patcham cópias em tmp)."""
    if not raiz:
        return
    import guardiao
    if guardiao.do_hub(raiz, caminho):          # cópia em tmp não é do hub: fica fora
        guardiao.registra_arquivo(raiz, caminho)


def grava(lib, caminho, backup_dir=None, backup=True, raiz=None):
    """escreve a lib em `caminho` (tmp + os.replace), com backup do que estava lá; com
    `raiz`, registra o arquivo no ledger do workspace"""
    bruto = _bytes_lib(lib)
    bk = faz_backup(caminho, backup_dir) if backup else None
    tmp = caminho + '.tmp'
    try:
        with open(tmp, 'wb') as f:
            f.write(bruto)
        os.replace(tmp, caminho)
    except PermissionError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise _ocupada(e)
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        # ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION no Windows
        if getattr(e, 'winerror', None) in (32, 33):
            raise _ocupada(e)
        raise
    registra_no_ledger(raiz, caminho)
    return {'backup': bk, 'bytes': len(bruto)}


# ─── verificação ──────────────────────────────────────────────────────────────
NUM = (int, float)
TOL = 0.01
FECHADAS = ('rect', 'ellipse', 'poly')       # as formas que têm área (e AreaColor)


def _texto_lido(s):
    """o que um texto vira depois de ir e voltar: '|' separa campos (vira '/')"""
    return str(s if s is not None else '').replace('|', '/')


def esperado(sym):
    """o que o leitor tem que devolver depois do patch: coordenadas de pino nas 3 casas
    da API (a fração vai e volta pelo PinFrac), nome de pino pelo cp1252, hideNum/hideName
    só quando true (o leitor não emite o visível), defaults do leitor (size 10, rot 0,
    sa 0, ea 360), a largura na tabela do Altium e as cores como ele as lê: minúsculas,
    preto (0) ausente, `fill` só em forma fechada E sólida"""
    parts = []
    for p in sym.get('parts') or []:
        pins = []
        for q in p.get('pins') or []:
            q = dict(q)
            for k in ('x', 'y', 'len'):
                q[k] = round(float(q.get(k, 0) or 0), 3)
            q['orient'] = _int(q.get('orient')) % 360
            q['type'] = q.get('type') if q.get('type') in TIPOS else 'Passive'
            for k in ('num', 'name'):
                q[k] = _bytes_pino(q.get(k, '')).decode('cp1252', 'replace').replace(BARRA, SOBRELINHA)
            for k in ('hideNum', 'hideName'):
                if q.get(k):
                    q[k] = True
                else:
                    q.pop(k, None)
            pins.append(q)
        gs = []
        for g in p.get('graphics') or []:
            g = dict(g)
            if 'w' in g and g['w'] is not None:
                g['w'] = min(LARGURA, key=lambda k: abs(k - float(g['w'])))
            if g.get('g') == 'label':
                g['size'] = int(round(float(g.get('size') or 10)))
                g['rot'] = ((_int(g.get('rot')) % 360) // 90) * 90
                g['text'] = _texto_lido(g.get('text', ''))
            if g.get('g') == 'arc':
                g['sa'] = float(g.get('sa', 0) or 0)
                g['ea'] = float(g.get('ea', 360) or 0)
            for k in ('color', 'fill'):
                v = sch_leitor.cor_int(g.get(k))
                if v is None or v == 0 or (k == 'fill' and not (g.get('g') in FECHADAS and g.get('solid'))):
                    g.pop(k, None)
                else:
                    g[k] = sch_leitor.cor_hex(v)
            gs.append(g)
        parts.append({'pins': pins, 'graphics': gs})
    return parts


def _dif(a, b, onde):
    """diferença entre dois itens (pino ou gráfico) do vocabulário do hub, ou None"""
    for k in set(a) | set(b):
        va, vb = a.get(k), b.get(k)
        if k == 'w' and (va is None or vb is None):
            continue                                 # rect não devolve w
        if k in ('color', 'fill') and va is None:
            continue                                 # sem cor no pedido: a da paleta é a certa
        if isinstance(va, bool) or isinstance(vb, bool):
            if bool(va) != bool(vb):
                return '%s.%s: %r != %r' % (onde, k, va, vb)
        elif isinstance(va, NUM) and isinstance(vb, NUM):
            if abs(float(va) - float(vb)) > TOL:
                return '%s.%s: %r != %r' % (onde, k, va, vb)
        elif isinstance(va, list) and isinstance(vb, list):
            if len(va) != len(vb):
                return '%s.%s: %d != %d pontos' % (onde, k, len(va), len(vb))
            for i, (pa, pb) in enumerate(zip(va, vb)):
                if abs(float(pa[0]) - float(pb[0])) > TOL or abs(float(pa[1]) - float(pb[1])) > TOL:
                    return '%s.%s[%d]: %r != %r' % (onde, k, i, pa, pb)
        elif (va or '') != (vb or ''):
            return '%s.%s: %r != %r' % (onde, k, va, vb)
    return None


def compara(esperado_parts, lido_parts):
    """lista de diferenças (vazia = igual)"""
    fora = []
    if len(esperado_parts) != len(lido_parts):
        return ['%d partes esperadas, %d lidas' % (len(esperado_parts), len(lido_parts))]
    for n, (e, l) in enumerate(zip(esperado_parts, lido_parts), 1):
        for rotulo, ke in (('pino', 'pins'), ('gráfico', 'graphics')):
            ea, la = e.get(ke) or [], l.get(ke) or []
            if len(ea) != len(la):
                fora.append('parte %d: %d %ss esperados, %d lidos' % (n, len(ea), rotulo, len(la)))
                continue
            for i, (x, y) in enumerate(zip(ea, la)):
                d = _dif(x, y, 'parte %d %s %d' % (n, rotulo, i))
                if d:
                    fora.append(d)
    return fora


def verifica(bruto, sym):
    """relê a lib (bytes) com o sch_leitor e compara o componente com o que foi pedido"""
    lido = sch_leitor.le_schlib(bruto, com_footprints=False)
    nome = sym.get('name', '')
    alvo = None
    for s in lido['symbols']:
        if s['name'] == nome or s['name'].lower() == (nome or '').lower():
            alvo = s
            break
    if alvo is None:
        return ['"%s" não voltou na releitura' % nome]
    return compara(esperado(sym), alvo['parts'])


def patch(caminho, sym, backup_dir=None, verificar=True, backup=True, raiz=None):
    """carrega + aplica + grava (+ relê e confere). Falhou a conferência: volta o backup.
    Com `raiz`, o arquivo entra no ledger do workspace — só DEPOIS da conferência, porque
    um backup restaurado é outro mtime."""
    lib = carrega(caminho)
    avisos = aplica(lib, sym)
    r = grava(lib, caminho, backup_dir, backup=backup)
    r['avisos'] = avisos
    r['storage'] = acha(lib, sym.get('name', ''))
    r['verificado'] = False
    if verificar:
        with open(caminho, 'rb') as f:
            bruto = f.read()
        difs = verifica(bruto, sym)
        if difs:
            if r.get('backup'):
                shutil.copy2(r['backup'], caminho)
            raise RuntimeError('a releitura de "%s" não bate com o que foi gravado%s:\n  %s' % (
                sym.get('name'), ' (backup restaurado)' if r.get('backup') else ' (SEM backup para restaurar)',
                '\n  '.join(difs[:10])))
        r['verificado'] = True
    registra_no_ledger(raiz, caminho)
    return r


# ─── CLI ──────────────────────────────────────────────────────────────────────
def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='grava a geometria de um símbolo na .SchLib do Altium')
    ap.add_argument('lib', help='caminho da .SchLib')
    ap.add_argument('simbolo', help='JSON do símbolo schlib-v2 (name, parts[, description])')
    ap.add_argument('--backup-dir')
    ap.add_argument('--sem-backup', action='store_true')
    ap.add_argument('--sem-verificar', action='store_true')
    ap.add_argument('--sem-ledger', action='store_true',
                    help='não registrar o arquivo no Libs/lib-ledger.json deste repositório')
    a = ap.parse_args(argv)
    with open(a.simbolo, encoding='utf-8') as f:
        sym = json.load(f)
    if isinstance(sym, dict) and 'symbols' in sym:
        sym = sym['symbols'][0]
    try:
        r = patch(a.lib, sym, a.backup_dir, verificar=not a.sem_verificar, backup=not a.sem_backup,
                  raiz=None if a.sem_ledger else RAIZ)
    except LibOcupada as e:
        print('biblioteca ocupada:', e)
        return 2
    for av in r['avisos']:
        print('aviso:', av)
    print('%s gravado em %s (storage %s, %d bytes%s%s)' % (
        sym.get('name'), a.lib, r['storage'], r['bytes'],
        ', backup ' + r['backup'] if r.get('backup') else '',
        ', conferido' if r['verificado'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
