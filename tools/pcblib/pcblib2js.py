# -*- coding: utf-8 -*-
"""Le a .PcbLib do Altium direto do arquivo e grava o Libs/pcblib.js (pcblib-v2), sem o Altium.

    python tools/pcblib/pcblib2js.py <biblioteca.PcbLib> <saida pcblib.js> [--fonte TXT] [-q]

--fonte TXT vai no campo "source" (padrao: o caminho da PcbLib). O rename-map.js ao lado da saida,
se existir, padroniza os nomes (ver padroniza).

E o `ExportLibs.pas` (a parte da PcbLib) do lado de fora. Ate a 1.29.0 o pcblib.js era gerado no
Altium, a partir de uma PcbLib numa pasta de rede (Z:), e viajava congelado no instalador: a
biblioteca de footprints que o hub, o esquema, a PCB e o MCP liam nao era a do NexoBD. Agora a
PcbLib da casa mora no NexoBD (Libs/Almox/FOOTPRINTS ALMOX.PcbLib, item "Biblioteca do
NexoEletric", trazida pelo Nexo Hub) e o pcblib.js sai dela, aqui, sempre que ela muda.

O formato e o do ExportLibs.pas (FpPadJSON/FootprintJSON), campo a campo:
  footprint  name (PATTERN dos Parameters), description, bbox, pads, silk
  pad        name, type (smd Top/Bottom | th), shape (circle|oval|rect|octagon|roundrect),
             radius (roundrect), x, y, w, h, rot, layer (Top|Bottom|Multi), e no th:
             drillshape (circle|rect|oblong), drill, drillw (furo nao redondo), holerot
  silk       trilhas e arcos de TopOverlay/BottomOverlay: line {x1,y1,x2,y2,w},
             arc {cx,cy,r,sa,ea,w}
  bbox       pads (centro +- metade do maior lado do Top) + pontas das trilhas + arcos
             (centro +- raio), como o ExportLibs fazia; sem nada, (-1,-1,1,1)
A ordem dos footprints e a da lista do Library/Data (a do painel do Altium); a das primitivas,
a do stream (a do GroupIterator).

O registro binario de pad/trilha/arco e o mesmo do .PcbDoc: quem le e o
tools/pcbdoc/pcbdoc_leitor.py. A diferenca da PcbLib e o contêiner: um storage por footprint,
com o Data trazendo [u32 tam][nome pascal] e depois TODAS as primitivas num stream so, cada uma
com o byte de tipo na frente (1 arco, 2 pad, 3 via, 4 trilha, 5 texto, 6 fill, 11 region,
12 corpo 3D...). O nome do storage e o nome do footprint cortado em 31 caracteres; o
SectionKeys diz qual storage e de qual nome comprido.
"""
import io
import json
import os
import struct
import sys
from collections import OrderedDict
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
_PCBDOC = os.path.join(os.path.dirname(AQUI), 'pcbdoc')
if _PCBDOC not in sys.path:
    sys.path.insert(0, _PCBDOC)

import pcbdoc_leitor as L  # noqa: E402

FORMATO = 'pcblib-v2'

# tipo do registro -> quantos blocos [u32 tam][bytes] vem depois do byte de tipo
BLOCOS = {1: 1, 2: 6, 3: 1, 4: 1, 5: 2, 6: 1, 11: 1, 12: 1}
SILK = ('TopOverlay', 'BottomOverlay')


class PcbLibErro(Exception):
    pass


def _blocos(d, i, n):
    bl = []
    for _ in range(n):
        if i + 4 > len(d):
            raise PcbLibErro('registro truncado no byte %d' % i)
        ln = L._u32(d, i)
        i += 4
        if ln > len(d) - i:
            raise PcbLibErro('bloco truncado no byte %d (tamanho %d)' % (i, ln))
        bl.append(d[i:i + ln])
        i += ln
    return bl, i


def primitivas(d):
    """Data de um footprint -> [(tipo, blocos)] na ordem do stream"""
    if len(d) < 4:
        return []
    i = 4 + L._u32(d, 0)                      # [u32 tam][nome pascal]
    out = []
    while i < len(d):
        t = d[i]
        if t == 0:                            # preenchimento no fim
            break
        if t not in BLOCOS:
            raise PcbLibErro('tipo de registro desconhecido %d no byte %d' % (t, i))
        bl, i = _blocos(d, i + 1, BLOCOS[t])
        out.append((t, bl))
    return out


def _nome(b):
    """string pascal de nome: o Altium grava no codepage do Windows (o travessao de 'TO–220AB'
    e o 0x96), nao em latin-1"""
    if not b:
        return ''
    return b[1:1 + b[0]].decode('cp1252', errors='replace')


def _lista(ole):
    """nomes dos footprints na ordem do Library/Data"""
    d = ole.openstream(['Library', 'Data']).read()
    i = 4 + L._u32(d, 0)
    n = L._u32(d, i)
    i += 4
    nomes = []
    for _ in range(n):
        ln = L._u32(d, i)
        nomes.append(_nome(d[i + 4:i + 4 + ln]))
        i += 4 + ln
    return nomes


def _quando(ole):
    """'dd/mm/aaaa hh:mm:ss' do ultimo save da PcbLib (cabecalho do Library/Data): o "generated"
    sai dela, e nao do relogio, para a mesma PcbLib dar o mesmo pcblib.js em toda maquina"""
    d = ole.openstream(['Library', 'Data']).read()
    pr = L.props(d[4:4 + L._u32(d, 0)])
    return ('%s %s' % (pr.get('DATE', ''), pr.get('TIME', ''))).strip()


def _chaves(ole):
    """SectionKeys: nome comprido -> storage"""
    if not ole.exists('SectionKeys'):
        return {}
    d = ole.openstream('SectionKeys').read()
    n = L._u32(d, 0)
    i = 4
    m = {}
    for _ in range(n):
        ln = L._u32(d, i)
        nome = _nome(d[i + 4:i + 4 + ln])
        i += 4 + ln
        ln = L._u32(d, i)
        sto = _nome(d[i + 4:i + 4 + ln])
        i += 4 + ln
        m[nome] = sto
    return m


def _limpo(nome):
    """o Altium troca por '_' o que nao pode ir em nome de storage"""
    return ''.join('_' if c in '/\\:*?"<>|' else c for c in nome)


def _storage(nome, chaves, existentes):
    for cand in (chaves.get(nome), nome[:31], nome, _limpo(nome)[:31]):
        if cand and cand in existentes:
            return cand
    baixo = {e.lower(): e for e in existentes}
    return baixo.get(nome[:31].lower())


def _1252(t):
    """texto que o props() leu em latin-1 sem a versao %UTF8%: volta ao codepage do Windows"""
    if any('' <= c <= '' for c in t):
        try:
            return t.encode('latin-1').decode('cp1252')
        except UnicodeError:
            return t
    return t


def _params(ole, sto):
    try:
        d = ole.openstream([sto, 'Parameters']).read()
    except OSError:
        return {}
    return L.props(d[4:] if len(d) >= 4 and d[4:5] == b'|' else d)


def pad_json(p):
    cam = p['camada']
    if cam == 'Top':
        tipo, lado = 'smd', 'top'
    elif cam == 'Bottom':
        tipo, lado = 'smd', 'bot'
    else:
        tipo, lado, cam = 'th', 'top', 'Multi'
    nome, sx, sy, raio = L.forma_pad(p, lado)
    w_, h_ = L.mm(sx), L.mm(sy)
    if nome in ('circle', 'oval'):
        nome = 'circle' if L.jf(w_) == L.jf(h_) else 'oval'
    o = OrderedDict([('name', p['nome']), ('type', tipo), ('shape', nome)])
    if nome == 'roundrect':
        o['radius'] = L.mm(int(round(raio)))
    o['x'] = L.mm(p['x'])
    o['y'] = L.mm(p['y'])
    o['w'] = w_
    o['h'] = h_
    o['rot'] = p['rot']
    o['layer'] = cam
    if tipo == 'th':
        o['drillshape'] = L._FORMA_FURO.get(p['tipo_furo'], 'circle')
        o['drill'] = L.mm(p['furo'])
        if p['tipo_furo'] != 0:
            o['drillw'] = L.mm(p['slot'])
        # furo oblongo/retangular: a rotacao que vale e a do slot (bloco 6), a mesma que o
        # HoleRotation da API devolvia ao ExportLibs; o byte 106 do registro fica 0 nesses pads
        o['holerot'] = p['slot_rot'] if p['tipo_furo'] != 0 and not p['furo_rot'] else p['furo_rot']
    return o


def footprint(ole, sto, nome_lista):
    pr = _params(ole, sto)
    nome = _1252(pr.get('PATTERN', '')) or nome_lista
    d = ole.openstream([sto, 'Data']).read()
    pads, silk = [], []
    cx = []

    def caixa(x1, y1, x2, y2):
        cx.append((x1, y1, x2, y2))

    for t, bl in primitivas(d):
        if t == 2:
            p = L.le_pad(bl)
            pads.append(pad_json(p))
            mx, my = L.mm(p['x']), L.mm(p['y'])
            half = max(L.mm(p['tx']), L.mm(p['ty'])) / 2
            caixa(mx - half, my - half, mx + half, my + half)
        elif t == 4:
            r = L.le_trilha(bl[0])
            if r['camada'] in SILK:
                x1, y1, x2, y2 = L.mm(r['x1']), L.mm(r['y1']), L.mm(r['x2']), L.mm(r['y2'])
                silk.append(OrderedDict([('kind', 'line'), ('x1', x1), ('y1', y1), ('x2', x2), ('y2', y2),
                                         ('w', L.mm(r['w']))]))
                caixa(min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
        elif t == 1:
            a = L.le_arco(bl[0])
            if a['camada'] in SILK:
                ax, ay, ar = L.mm(a['cx']), L.mm(a['cy']), L.mm(a['r'])
                silk.append(OrderedDict([('kind', 'arc'), ('cx', ax), ('cy', ay), ('r', ar), ('sa', a['sa']),
                                         ('ea', a['ea']), ('w', L.mm(a['w']))]))
                caixa(ax - ar, ay - ar, ax + ar, ay + ar)
    if cx:
        bbox = OrderedDict([('x1', min(c[0] for c in cx)), ('y1', min(c[1] for c in cx)),
                            ('x2', max(c[2] for c in cx)), ('y2', max(c[3] for c in cx))])
    else:
        bbox = OrderedDict([('x1', -1), ('y1', -1), ('x2', 1), ('y2', 1)])
    return OrderedDict([('name', nome), ('description', _1252(pr.get('DESCRIPTION', ''))), ('bbox', bbox),
                        ('pads', pads), ('silk', silk)])


def le_renomes(arq):
    """Libs/rename-map.js -> (fpRename, mergeFp); sem o arquivo, ({}, {})"""
    try:
        with io.open(arq, encoding='utf-8') as f:
            t = f.read()
        m = json.loads(t[t.index('{'):t.rstrip().rstrip(';').rindex('}') + 1])
    except (OSError, ValueError):
        return {}, {}
    return m.get('fpRename') or {}, m.get('mergeFp') or {}


def padroniza(fps, renomes, fundidos):
    """Os nomes padronizados do RenameLibs (Libs/rename-map.js), como o pcblib.js do Altium
    sempre trouxe: a PcbLib guarda o nome antigo, o espelho o novo; o fundido sai do espelho
    (virou ZZ-OBSOLETO no Altium). Nome novo que ja existe na PcbLib nao e trocado."""
    nomes = {f['name'] for f in fps}
    out = []
    for f in fps:
        n = f['name']
        if n in fundidos and fundidos[n] in nomes:
            continue
        novo = renomes.get(n)
        if novo and novo not in nomes:
            f = OrderedDict(f)
            f['name'] = novo
        out.append(f)
    return out


def le(caminho):
    """caminho da .PcbLib -> (footprints, avisos, quando)"""
    ole_mod = L.olefile_ou_erro()
    with open(caminho, 'rb') as f:
        dados = f.read()
    if dados[:8] != bytes.fromhex('d0cf11e0a1b11ae1'):
        raise PcbLibErro('nao e uma .PcbLib binaria: %s' % caminho)
    ole = ole_mod.OleFileIO(io.BytesIO(dados))
    try:
        existentes = {e[0] for e in ole.listdir(streams=True, storages=False) if len(e) == 2 and e[1] == 'Data'}
        existentes.discard('Library')
        chaves = _chaves(ole)
        fps, avisos, vistos = [], [], set()
        for nome in _lista(ole):
            sto = _storage(nome, chaves, existentes)
            if not sto or sto in vistos:
                avisos.append('%s: sem storage na PcbLib' % nome)
                continue
            vistos.add(sto)
            try:
                fps.append(footprint(ole, sto, nome))
            except (PcbLibErro, L.PcbDocErro, struct.error) as e:
                avisos.append('%s: %s' % (nome, e))
        return fps, avisos, _quando(ole)
    finally:
        ole.close()


def _num(v):
    if isinstance(v, float):
        return L.jf(v)
    return json.dumps(v, ensure_ascii=True)


def _js(o):
    if isinstance(o, dict):
        return '{' + ','.join(json.dumps(k) + ':' + _js(v) for k, v in o.items()) + '}'
    if isinstance(o, list):
        return '[' + ','.join(_js(v) for v in o) + ']'
    return _num(o)


def texto(fps, fonte, gerado=None):
    linhas = ['var pcblib = {',
              '"format":"%s",' % FORMATO,
              '"generated":%s,' % json.dumps(gerado or datetime.now().strftime('%d/%m/%Y %H:%M:%S')),
              '"source":%s,' % json.dumps(fonte, ensure_ascii=True),
              '"units":"mm",',
              '"footprints":[']
    linhas.append('\n,'.join(_js(f) for f in fps))
    linhas += ['],', '"stats":{"footprints":%d}' % len(fps), '};', '']
    return '\n'.join(linhas)


def gera(pcblib, saida, fonte=None, renomes=None):
    """le a PcbLib e grava o pcblib.js (atomico) -> (n footprints, avisos). renomes: o
    rename-map.js (padrao: o que esta ao lado da saida)"""
    fps, avisos, quando = le(pcblib)
    fps = padroniza(fps, *le_renomes(renomes or os.path.join(os.path.dirname(os.path.abspath(saida)), 'rename-map.js')))
    tmp = saida + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto(fps, fonte or pcblib, quando or None))
    os.replace(tmp, saida)
    return len(fps), avisos


def main(argv):
    fonte = None
    if '--fonte' in argv:
        i = argv.index('--fonte')
        fonte = argv[i + 1] if i + 1 < len(argv) else None
        argv = argv[:i] + argv[i + 2:]
    args = [a for a in argv if not a.startswith('-')]
    if len(args) != 2:
        print(__doc__)
        return 2
    n, avisos = gera(args[0], args[1], fonte)
    if '-q' not in argv:
        print('%d footprint(s) em %s' % (n, args[1]))
        for a in avisos:
            print('aviso: ' + a)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
