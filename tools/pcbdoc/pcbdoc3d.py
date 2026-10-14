# -*- coding: utf-8 -*-
"""Os corpos 3D do Altium (ComponentBodies6 + Models/) lidos direto do .PcbDoc e da .PcbLib.

Acrescimo ao `pcbdoc_leitor.py` (que ele importa e nao altera): a placa vira o `board3d.js`
(`pcb3d-v1`) que a vista 3D do hub le, e a biblioteca vira o `Libs/pcblib-3d.js`. As linhas de
comando estao em tools/pcb3d/ (extrai3d.py e pcblib3d.py).

O formato no arquivo (medido em 2026-10-13 no DMB, no LM555, nos exemplos do AD21 e na
BIBLIOTECA DE FOOTPRINT da casa):

  * ComponentBodies6/Data: um registro por corpo, no MESMO formato do Regions6 ([u8 tipo=12]
    [u32 tam] + byte de camada, flags, net u16, poligono u16, componente u16, ..., [u32 tam]
    propriedades, [u32 n] vertices double em unidade interna ABSOLUTA, furos). O contorno e a
    projecao do corpo na placa: para o STEP, a caixa XY do modelo ja posicionado (o Altium a
    calcula; e ela que valida a conta da matriz abaixo).
    Propriedades: MODELID, MODEL.CHECKSUM (u32), MODEL.NAME, MODEL.EMBED, MODEL.MODELTYPE
    (0 extrudado, 1 STEP, 2 cilindro, 3 esfera), MODEL.2D.X/Y (onde a origem do modelo cai na
    placa, absoluto), MODEL.2D.ROTATION (0 em todos os 1.120 corpos medidos), MODEL.3D.ROTX/Y/Z
    (graus, JA com a rotacao do componente somada), MODEL.3D.DZ, STANDOFFHEIGHT/OVERALLHEIGHT
    (a faixa Z do corpo, contada da face do lado para fora), BODYPROJECTION (0 Top, 1 Bottom),
    MODEL.EXTRUDED.MINZ/MAXZ, BODYCOLOR3D (BGR do Windows), BODYOPACITY3D, V7_LAYER.
  * Models/Data: o indice ([u32 tam][props], NUL no fim): ID (= MODELID do corpo), NAME,
    CHECKSUM (int32 com sinal: o mesmo numero do corpo, modulo 2^32), EMBED, ROTX/Y/Z, DZ. O
    registro i do indice e o stream Models/<i>: o STEP comprimido com zlib.
  * Na .PcbLib a mesma coisa, em Library/Models/ e no Data de cada footprint (registro 12 entre
    os primitivos; coordenadas relativas a origem do footprint).

A conta da matriz (CONFERIDA: a caixa do STEP posicionado bate com o contorno que o Altium
gravou em 1.076 de 1.078 corpos STEP do DMB, LM555, WiFi e MiniPC -- erro <= 0,008 mm em XY e
em Z contra STANDOFF/OVERALL; as 2 que nao batem sao o mesmo modelo do DMB cujo corpo o Altium
nunca atualizou: OVERALL 0,254 mm para um SOIC de 2,65 mm):

    Top:    M = T(x2d, y2d, dz)          . Rz(rotz) . Ry(roty) . Rx(rotx)
    Bottom: M = T(x2d, y2d, -esp) . Rx(180) . T(0, 0, dz) . Rz(rotz) . Ry(roty) . Rx(rotx)

ou seja: gira em X, depois em Y, depois em Z (eixos fixos), sobe DZ, e no Bottom vira de ponta
cabeca em torno do X da placa (y -> -y, z -> -z) e desce a espessura. Z = 0 e a face de cima,
Z negativo para baixo. As 672 de 672 corpos de Bottom do MiniPC conferem; Ry(180) no lugar do
Rx(180) erra o conector C390 (o unico assimetrico), e tirar o giro erra todos os assimetricos.
"""
import math
import os
import re
import struct
import sys
import zlib
from collections import OrderedDict

BASE = os.path.dirname(os.path.abspath(__file__))
if BASE not in sys.path:
    sys.path.insert(0, BASE)

import pcbdoc_leitor as L  # noqa: E402

FORMATO = 'pcb3d-v1'
FORMATO_LIB = 'pcblib3d-v1'
VERSAO = '2026-10-13'
ESPESSURA_PADRAO = 1.6
TIPOS = {0: 'extruded', 1: 'step', 2: 'cylinder', 3: 'sphere'}
# o stackup que o Altium cria e ninguem mexeu: Top 1,4 mil + dieletrico 12,6 mil + Bottom 1,4 mil
# (0,391 mm). A casa fabrica 1,6 mm; essa espessura e "nao configurado", nao a placa.
ESPESSURA_NAO_CONFIGURADA = round((1.4 + 12.6 + 1.4) * 0.0254, 4)


# ─── unidades ─────────────────────────────────────────────────────────────────
def mm_prop(s, padrao=0.0):
    """'25787.4447mil' / '1.5mm' / '-3543307' (unidade interna, no indice de modelos) -> mm"""
    if s is None or str(s).strip() == '':
        return padrao
    t = str(s).strip()
    low = t.lower()
    try:
        if low.endswith('mil'):
            return float(t[:-3]) * 0.0254
        if low.endswith('mm'):
            return float(t[:-2])
        return float(t) * 0.0254 / 10000.0
    except ValueError:
        return padrao


def _f(s, padrao=0.0):
    try:
        return float(str(s).strip())
    except (TypeError, ValueError):
        return padrao


def r6(v):
    v = round(v, 6)
    return 0.0 if v == 0 else v


def cor_bgr(v, padrao='#808080'):
    """BODYCOLOR3D (inteiro BGR do Windows) -> '#rrggbb'"""
    try:
        c = int(str(v).strip())
    except (TypeError, ValueError):
        return padrao
    return '#%02x%02x%02x' % (c & 255, (c >> 8) & 255, (c >> 16) & 255)


# ─── matriz 4x4 (linha-maior aqui; sai coluna-maior, como o Matrix4.fromArray do Three.js) ──
def _mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _cs(graus):
    """cosseno/seno exatos nos multiplos de 90 (sem o 6e-17)"""
    a = math.radians(graus)
    c, s = math.cos(a), math.sin(a)
    ex = lambda v: 0.0 if abs(v) < 1e-12 else (math.copysign(1.0, v) if abs(abs(v) - 1) < 1e-12 else v)
    return ex(c), ex(s)


def rot_x(g):
    c, s = _cs(g)
    return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]


def rot_y(g):
    c, s = _cs(g)
    return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]


def rot_z(g):
    c, s = _cs(g)
    return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def transl(x, y, z):
    return [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]


def coluna_maior(M):
    return [r6(M[i][j]) for j in range(4) for i in range(4)]


def matriz_corpo(raw, lado='top', espessura=ESPESSURA_PADRAO):
    """raw = {x2d, y2d, rot2d, rotx, roty, rotz, dz} (mm, graus) -> 4x4 linha-maior (ver o topo).
    MODEL.2D.ROTATION entra como giro em Z depois do rotz (0 em todos os corpos medidos: a
    rotacao do componente ja vem somada no rotz)."""
    R = _mul(rot_z(raw.get('rot2d', 0) + raw.get('rotz', 0)),
             _mul(rot_y(raw.get('roty', 0)), rot_x(raw.get('rotx', 0))))
    if lado == 'bottom':
        return _mul(transl(raw['x2d'], raw['y2d'], -espessura),
                    _mul(rot_x(180), _mul(transl(0, 0, raw.get('dz', 0)), R)))
    return _mul(transl(raw['x2d'], raw['y2d'], raw.get('dz', 0)), R)


# ─── espessura (stackup) ──────────────────────────────────────────────────────
def espessura(b6):
    """(mm, origem) do stackup do Board6 (Library/Data na .PcbLib): cobre (COPTHICK) + dieletricos
    entre o primeiro e o ultimo cobre. Sem stackup, ou com o padrao nunca configurado do Altium
    (0,391 mm), vale 1,6 mm."""
    camadas = {}
    for k, v in b6.items():
        m = re.match(r'^V9_STACK_LAYER(\d+)_(COPTHICK|DIELHEIGHT|DIELTYPE|LAYERID)$', k)
        if m:
            camadas.setdefault(int(m.group(1)), {})[m.group(2)] = v
    if not camadas:
        return ESPESSURA_PADRAO, 'padrao (sem stackup)'
    ordem = sorted(camadas)
    cobres = [i for i in ordem if 'COPTHICK' in camadas[i]]
    if not cobres:
        return ESPESSURA_PADRAO, 'padrao (stackup sem cobre)'
    total = 0.0
    for i in ordem:
        if i < cobres[0] or i > cobres[-1]:
            continue
        c = camadas[i]
        total += mm_prop(c.get('COPTHICK')) if 'COPTHICK' in c else mm_prop(c.get('DIELHEIGHT'))
    total = round(total, 4)
    if total <= 0:
        return ESPESSURA_PADRAO, 'padrao (stackup vazio)'
    if abs(total - ESPESSURA_NAO_CONFIGURADA) < 1e-3:
        return ESPESSURA_PADRAO, 'padrao (stackup do Altium nao configurado: %.3f mm)' % total
    return total, 'stackup'


# ─── modelos embutidos ────────────────────────────────────────────────────────
def u32(v):
    try:
        return int(str(v).strip()) & 0xFFFFFFFF
    except (TypeError, ValueError):
        return None


def _ext(dados, nome):
    cab = dados[:64].lstrip()
    if cab.startswith(b'ISO-10303-21'):
        return 'step'
    e = os.path.splitext(nome or '')[1].lower().lstrip('.')
    return e or 'bin'


def le_modelos(arq, storage='Models'):
    """o indice de modelos embutidos -> OrderedDict {ID: {name, checksum, embed, rot*, dz, dados}}
    (dados = o arquivo descomprimido, ou None se nao embutido / ilegivel)"""
    out = OrderedDict()
    for i, b in enumerate(L.it_props(arq.stream(storage + '/Data'))):
        pr = L.props(b)
        mid = pr.get('ID', '')
        if not mid:
            continue
        cru = arq.stream('%s/%d' % (storage, i))
        dados = None
        if cru:
            try:
                dados = zlib.decompress(cru)
            except zlib.error:
                try:
                    dados = zlib.decompressobj().decompress(cru)
                except zlib.error:
                    dados = None
        ck = u32(pr.get('CHECKSUM'))
        nome = pr.get('NAME', '')
        out.setdefault(mid, {'id': mid, 'name': nome, 'checksum': ck, 'embed': L._bool(pr.get('EMBED')),
                             'rotx': _f(pr.get('ROTX')), 'roty': _f(pr.get('ROTY')), 'rotz': _f(pr.get('ROTZ')),
                             'dz': mm_prop(pr.get('DZ')), 'dados': dados,
                             'ext': _ext(dados, nome) if dados else None})
    return out


# ─── corpos ───────────────────────────────────────────────────────────────────
def le_corpos_stream(d, nome='ComponentBodies6'):
    """registros de corpo (formato Region) de um stream inteiro"""
    return [L.le_regiao(p) for _, p in L.it_simples(d, nome)]


def corpo(reg, ox, oy, esp, owner='', modelos=None):
    """um registro lido (le_regiao) -> o corpo do contrato pcb3d-v1, em mm, relativo a (ox, oy)
    (unidade interna). Devolve None para corpo sem tipo que este leitor nao entende."""
    pr = reg['props']
    tipo = TIPOS.get(int(_f(pr.get('MODEL.MODELTYPE'), -1)), None)
    if tipo is None:
        # corpo sem MODEL.* (3 na SL1 do AD21): o Altium o trata como extrudado pelo contorno
        tipo = 'extruded'
    lado = 'bottom' if str(pr.get('BODYPROJECTION', '0')).strip() == '1' else 'top'
    para_mm = lambda x, y: [r6(L.mm_cru(x - ox)), r6(L.mm_cru(y - oy))]
    standoff = mm_prop(pr.get('STANDOFFHEIGHT'))
    overall = mm_prop(pr.get('OVERALLHEIGHT'))
    raw = OrderedDict([
        ('x2d', r6(mm_prop(pr.get('MODEL.2D.X')) - L.mm_cru(ox))),
        ('y2d', r6(mm_prop(pr.get('MODEL.2D.Y')) - L.mm_cru(oy))),
        ('rot2d', _f(pr.get('MODEL.2D.ROTATION'))),
        ('rotx', _f(pr.get('MODEL.3D.ROTX'))), ('roty', _f(pr.get('MODEL.3D.ROTY'))),
        ('rotz', _f(pr.get('MODEL.3D.ROTZ'))), ('dz', r6(mm_prop(pr.get('MODEL.3D.DZ')))),
        ('standoff', r6(standoff)), ('overall', r6(overall))])
    b = OrderedDict([('owner', owner), ('side', lado), ('kind', tipo), ('layer', reg['camada']),
                     ('color', cor_bgr(pr.get('BODYCOLOR3D'))),
                     ('opacity', r6(max(0.0, min(1.0, _f(pr.get('BODYOPACITY3D'), 1.0)))))])
    if tipo == 'extruded':
        if 'MODEL.EXTRUDED.MINZ' in pr or 'MODEL.EXTRUDED.MAXZ' in pr:
            standoff = mm_prop(pr.get('MODEL.EXTRUDED.MINZ'))
            overall = mm_prop(pr.get('MODEL.EXTRUDED.MAXZ'))
        b['pts'] = [para_mm(x, y) for x, y in reg['pts']]
        if reg['furos']:
            b['holes'] = [[para_mm(x, y) for x, y in f] for f in reg['furos']]
        b['standoff'] = r6(standoff)
        b['height'] = r6(overall)
    else:
        if tipo == 'step':
            b['model'] = pr.get('MODELID', '')
            b['name'] = pr.get('MODEL.NAME', '')
        elif tipo == 'cylinder':
            # sem exemplo no acervo nem nos exemplos do AD21: o eixo e o Z local, base na origem
            b['radius'] = r6(mm_prop(pr.get('MODEL.CYLINDER.RADIUS')))
            b['height'] = r6(mm_prop(pr.get('MODEL.CYLINDER.HEIGHT')) or (overall - standoff))
        elif tipo == 'sphere':
            b['radius'] = r6(mm_prop(pr.get('MODEL.SPHERE.RADIUS')))
        b['matrix'] = coluna_maior(matriz_corpo(raw, lado, esp))
        b['outline'] = [para_mm(x, y) for x, y in reg['pts']]
    b['raw'] = raw
    return b


def nome_modelo(m):
    return '%d.%s' % (m['checksum'] if m['checksum'] is not None else 0, m['ext'] or 'step')


def modelos_contrato(modelos, usados, pasta='3d'):
    """{modelId: {file, name, checksum, bytes}} so dos modelos que algum corpo usa"""
    out = OrderedDict()
    for mid in usados:
        m = modelos.get(mid)
        if m is None:
            out[mid] = OrderedDict([('file', None), ('name', ''), ('checksum', None), ('bytes', 0),
                                    ('missing', 'modelo nao esta no indice Models/ do arquivo')])
            continue
        if m['dados'] is None:
            out[mid] = OrderedDict([('file', None), ('name', m['name']), ('checksum', m['checksum']),
                                    ('bytes', 0), ('missing', 'modelo nao embutido (link para arquivo externo)')])
            continue
        out[mid] = OrderedDict([('file', pasta + '/' + nome_modelo(m)), ('name', m['name']),
                                ('checksum', m['checksum']), ('bytes', len(m['dados']))])
    return out


# ─── placa (.PcbDoc) ──────────────────────────────────────────────────────────
def le_placa3d(fonte):
    """.PcbDoc -> (dados do board3d.js, {arquivo: bytes} dos modelos, resumo)"""
    P = L.Placa(fonte)
    try:
        esp, esp_fonte = espessura(P.b6)
        modelos = le_modelos(P.arq, 'Models')
        regs = le_corpos_stream(P.arq.dados('ComponentBodies6'))
        bodies, usados = [], []
        for reg in regs:
            ref = P.ref(reg['comp']) if reg['comp'] != 0xFFFF else ''
            b = corpo(reg, P.ox, P.oy, esp, ref, modelos)
            if b is None:
                continue
            if b['kind'] == 'step' and b['model'] not in usados:
                usados.append(b['model'])
            bodies.append(b)
        comps = OrderedDict()
        for i, c in enumerate(P.comps):
            ref = P.ref(i)
            if not ref or ref in comps:
                continue
            comps[ref] = OrderedDict([
                ('x', L.mm(L.unid(c.get('X')) - P.ox)), ('y', L.mm(L.unid(c.get('Y')) - P.oy)),
                ('rot', r6(L._num(c.get('ROTATION')) % 360.0)),
                ('layer', 'Bottom' if (c.get('LAYER') or '').upper() == 'BOTTOM' else 'Top'),
                ('footprint', c.get('PATTERN', ''))])
        mc = modelos_contrato(modelos, usados)
        arquivos = OrderedDict()
        for mid in usados:
            m = modelos.get(mid)
            if m is not None and m['dados'] is not None:
                arquivos[nome_modelo(m)] = m['dados']
        d = OrderedDict([('format', FORMATO), ('generator', 'extrai3d ' + VERSAO),
                         ('source', P.caminho), ('units', 'mm'),
                         ('thickness', r6(esp)), ('thicknessFrom', esp_fonte),
                         ('bodies', bodies), ('models', mc), ('componentes', comps)])
        com = set(b['owner'] for b in bodies if b['owner'])
        com_step = set(b['owner'] for b in bodies if b['owner'] and b['kind'] == 'step')
        resumo = OrderedDict([
            ('componentes', len(comps)), ('com_step', len(com_step)),
            ('so_extrudado', len(com - com_step)), ('sem_corpo', len([r for r in comps if r not in com])),
            ('corpos', len(bodies)),
            ('por_tipo', dict((k, sum(1 for b in bodies if b['kind'] == k)) for k in ('extruded', 'step', 'cylinder', 'sphere'))),
            ('modelos', len(arquivos)), ('bytes_modelos', sum(len(v) for v in arquivos.values())),
            ('sem_modelo', [mid for mid, m in mc.items() if not m['file']]),
            ('espessura', esp), ('espessura_fonte', esp_fonte)])
        return d, arquivos, resumo
    finally:
        P.fecha()


# ─── biblioteca (.PcbLib) ─────────────────────────────────────────────────────
def _registros_footprint(d):
    """o Data de um footprint: [u32 tam][pascal nome] e os primitivos [u8 tipo] + blocos
    (pad = 6 blocos, texto = 2, o resto 1). So o corpo (12) interessa aqui; um tipo que este
    leitor nao conhece encerra a leitura (o que veio antes vale)."""
    if len(d) < 4:
        return '', []
    n = L._u32(d, 0)
    nome = L._pascal(d[4:4 + n]) if n else ''
    i = 4 + n
    out = []
    while i < len(d):
        t = d[i]
        i += 1
        nb = {2: 6, 5: 2}.get(t, 1)
        if t not in (1, 2, 3, 4, 5, 6, 11, 12):
            break
        bl = []
        for _ in range(nb):
            if i + 4 > len(d):
                return nome, out
            ln = L._u32(d, i)
            i += 4
            bl.append(d[i:i + ln])
            i += ln
        if t == 12:
            out.append(bl[0])
    return nome, out


def le_biblioteca3d(fonte):
    """.PcbLib -> (dados do pcblib-3d.js, {arquivo: bytes}, resumo). Corpos locais ao footprint
    (origem dele, rotacao 0, Top), no mesmo contrato do board3d.js."""
    L.olefile_ou_erro()
    with open(fonte, 'rb') as f:
        dados = f.read()
    A = L.Arquivo(dados)
    try:
        b6 = {}
        for b in L.it_props(A.stream('Library/Data')):
            for k, v in L.props(b).items():
                b6.setdefault(k, v)
        esp, _ = espessura(b6)
        modelos = le_modelos(A, 'Library/Models')
        fps = OrderedDict()
        usados = []
        n_fp = 0
        sem = []
        for ent in A.ole.listdir(streams=True, storages=False):
            if len(ent) != 2 or ent[1] != 'Data' or ent[0] == 'Library':
                continue
            n_fp += 1
            d = A.stream(ent[0] + '/Data')
            nome, regs = _registros_footprint(d)
            par = L.props(A.stream(ent[0] + '/Parameters')[4:]) if A.ole.exists(ent[0] + '/Parameters') else {}
            nome = par.get('PATTERN') or nome or ent[0]
            bodies = []
            for r in regs:
                if isinstance(r, tuple):
                    continue
                try:
                    reg = L.le_regiao(r)
                except L.PcbDocErro:
                    continue
                b = corpo(reg, 0, 0, esp, '', modelos)
                if b is None:
                    continue
                if b['kind'] == 'step' and b['model'] not in usados:
                    usados.append(b['model'])
                bodies.append(b)
            if bodies:
                fps[nome] = OrderedDict([('bodies', bodies)])
            else:
                sem.append(nome)
        mc = modelos_contrato(modelos, usados)
        arquivos = OrderedDict()
        for mid in usados:
            m = modelos.get(mid)
            if m is not None and m['dados'] is not None:
                arquivos[nome_modelo(m)] = m['dados']
        com_step = sum(1 for f in fps.values() if any(b['kind'] == 'step' for b in f['bodies']))
        d = OrderedDict([('format', FORMATO_LIB), ('generator', 'pcblib3d ' + VERSAO), ('source', fonte),
                         ('units', 'mm'), ('footprints', fps), ('models', mc)])
        resumo = OrderedDict([('footprints', n_fp), ('com_step', com_step),
                              ('so_extrudado', len(fps) - com_step), ('sem_corpo', len(sem)),
                              ('modelos', len(arquivos)), ('bytes_modelos', sum(len(v) for v in arquivos.values())),
                              ('sem_modelo', [mid for mid, m in mc.items() if not m['file']])])
        return d, arquivos, resumo
    finally:
        A.fecha()


# ─── saida JS ─────────────────────────────────────────────────────────────────
def _js(v):
    """JSON com numero curto e sem NaN (o hub le com new Function, como o board.js)"""
    import json
    return json.dumps(v, ensure_ascii=True, separators=(',', ':'), allow_nan=False)


def board3d_js(d):
    """var pcbmirror3d = {...}; -- um corpo por linha (diff legivel), como o board.js"""
    linhas = ['var pcbmirror3d = {']
    for k, v in d.items():
        if k == 'bodies':
            linhas.append('"bodies":[')
            for i, b in enumerate(v):
                linhas.append(('' if i == 0 else ',') + _js(b))
            linhas.append('],')
        elif k in ('models', 'componentes', 'footprints'):
            linhas.append('"%s":{' % k)
            itens = list(v.items())
            for i, (kk, vv) in enumerate(itens):
                linhas.append(('' if i == 0 else ',') + _js(kk) + ':' + _js(vv))
            linhas.append('},')
        else:
            linhas.append(_js(k) + ':' + _js(v) + ',')
    linhas[-1] = linhas[-1].rstrip(',')
    linhas.append('};')
    return '\n'.join(linhas) + '\n'


def pcblib3d_js(d):
    return board3d_js(d).replace('var pcbmirror3d = {', 'var pcblib3d = {', 1)
