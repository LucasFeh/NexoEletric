# -*- coding: utf-8 -*-
"""Tira do .PcbDoc a DEFINIÇÃO dos polígonos (Polygons6) e o despejo que o Altium gravou, no
formato do `hub-pcbpour.js` -- para o hub redespejar e para medir o nosso despejo contra o dele.

    python tools/pour/pour_extrai.py <arquivo.PcbDoc | .PcbDoc.Zip> <saida.json>

Só LÊ o PcbDoc (pelo `tools/pcbdoc/pcbdoc_leitor.py`, que não é alterado aqui) e grava um JSON:

    { "fonte": caminho, "board": <o board.js inteiro, como o pcbdoc2board grava>,
      "polygons": [ <polígono no formato do hub-pcbpour> ],
      "altium":   [ {"de": "p1", "layer", "net", "regioes": [{"pts", "holes"}]} ],
      "avisos":   [texto] }

O que foi apurado nos 18 PcbDoc do acervo que têm polígono (EQUIPAMENTOS_REVISADOS, 2026-10-13):

  Polygons6     um registro de propriedades por polígono: LAYER, NET (índice no Nets6),
                POURINDEX (ordem de despejo; -1 = sem ordem), HATCHSTYLE (39 de 39 'Solid'),
                POUROVERSTYLE (o TPolygonPourOver do AdvPcb.dll: 0 None, 1 SameNet = cobre por
                cima de tudo da mesma net, 2 SameNetPolygons = só por cima de polígono da mesma
                net), REMOVEDEAD (33 de 39 FALSE), REMOVEISLANDSBYAREA + AREATHRESHOLD (em
                unidade interna AO QUADRADO: 2,5e11 = 2500 mil²), REMOVENECKS +
                NECKWIDTHTHRESHOLD, ARCRESOLUTION (0,5 mil), SHELVED, NAME (às vezes gravado
                como os códigos dos caracteres separados por vírgula: "71,78,68" = "GND") e o
                contorno KINDn/VXn/VYn/CXn/CYn/Rn/SAn/EAn (KIND 1 = arco, como o Board6).
  Regions6      o cobre despejado: registros com o índice do polígono nos bytes 5..6 (o leitor
                chama de 'poly'). O board.js marca só poly:true; aqui sai separado por polígono.
  PolygonConnect  CONNECTSTYLE Direct | Relief | NoConnect, RELIEFCONDUCTORWIDTH, RELIEFENTRIES
                (2/4), POLYGONRELIEFANGLE ('90 Angle'/'45 Angle'), AIRGAPWIDTH. Escopo por pad
                (InComponent, IsVia) aparece em 2 projetos: sai por objeto em conexaoObj.
  Clearance     GAP + a matriz OBJECTCLEARANCES ('ClearanceObj_Track-ClearanceObj_Poly:255906',
                unidade interna). Fica a regra de maior prioridade cujo par de escopos casa com
                (o polígono, o objeto). Escopo que não entendemos (AsMils, IsTrack com
                coordenadas) faz a regra não contar, como no leitor.
  BoardOutlineClearance  1 projeto de 18 (10 mil). Sem ela a folga do contorno é 0.
"""
import json
import math
import os
import re
import sys
from collections import OrderedDict

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..', 'pcbdoc'))

import pcbdoc_leitor as L  # noqa: E402

TIPOS = ('track', 'arc', 'smd', 'th', 'via', 'fill', 'region', 'text', 'poly')
# nome do tipo na matriz OBJECTCLEARANCES do Altium -> o nosso
_MATRIZ = {'Track': 'track', 'Arc': 'arc', 'SMDPad': 'smd', 'THPad': 'th', 'Via': 'via', 'Fill': 'fill',
           'Region': 'region', 'Text': 'text', 'Poly': 'poly', 'Hole': 'hole'}
POUR_OVER = {0: 'none', 1: 'all', 2: 'polygons'}


def mm(v):
    return L.mm(v)                              # o CoordToMMs do Altium (5 casas), como o board.js


def nome_poligono(s):
    s = s or ''
    if re.match(r'^\d+(,\d+)*$', s):
        try:
            return ''.join(chr(int(c)) for c in s.split(','))
        except ValueError:
            return s
    return s


# ─── escopo das regras (o _Escopo do leitor + o que regra de polígono usa) ────
class Escopo(object):
    _RX = re.compile(r"\s*(\(|\)|'(?:[^']|'')*'|\"[^\"]*\"|[A-Za-z_][A-Za-z0-9_]*|,|<=|>=|<>|=|<|>|[-+]?\d+(?:\.\d+)?)")

    def __init__(self, expr):
        self.toks = []
        s = (expr or 'All').strip() or 'All'
        i = 0
        while i < len(s):
            m = self._RX.match(s, i)
            if not m or m.end() == i:
                raise ValueError('escopo: %r' % s)
            self.toks.append(m.group(1))
            i = m.end()

    def avalia(self, obj):
        self.i = 0
        try:
            v = self._ou(obj)
        except (IndexError, ValueError):
            return None
        return v if self.i == len(self.toks) else None

    def _pega(self):
        return self.toks[self.i] if self.i < len(self.toks) else None

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
        return self._comp(obj)

    def _comp(self, obj):
        v = self._atomo(obj)
        # AsMils(X1) >= 5738 e cia.: comparação que não sabemos avaliar
        if self._pega() in ('<=', '>=', '<>', '=', '<', '>'):
            self.i += 2
            return None
        return v

    def _atomo(self, obj):
        t = self._pega()
        if t is None:
            raise ValueError('fim')
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
            prof = 1
            while self._pega() is not None and prof:
                a = self._pega()
                self.i += 1
                if a == '(':
                    prof += 1
                elif a == ')':
                    prof -= 1
                elif a != ',' and prof == 1:
                    args.append(a.strip("'\"").replace("''", "'"))
        a0 = args[0] if args else ''
        tipo = obj.get('tipo')
        if nome == 'all':
            return True
        if nome in ('ispolygon', 'inpolygon'):
            return tipo == 'poly' if nome == 'ispolygon' else bool(obj.get('do_poligono'))
        if nome == 'ispad':
            return tipo in ('smd', 'th')
        if nome == 'issmdpad':
            return tipo == 'smd'
        if nome in ('isthruhole', 'isthroughhole'):
            return tipo == 'th'
        if nome == 'isvia':
            return tipo == 'via'
        if nome == 'istrack':
            return tipo == 'track'
        if nome == 'isarc':
            return tipo == 'arc'
        if nome == 'isfill':
            return tipo == 'fill'
        if nome == 'isregion':
            return tipo == 'region'
        if nome == 'istext':
            return tipo == 'text'
        if nome == 'innet':
            if obj.get('net') is None:
                return None
            return obj.get('net', '').lower() == a0.lower()
        if nome == 'incomponent':
            if obj.get('ref') is None:
                return None
            return obj.get('ref', '').lower() == a0.lower()
        if nome == 'onlayer':
            return obj.get('camada_nome', '').lower() == a0.lower() or obj.get('camada', '').lower() == a0.lower()
        if nome in ('innetclass', 'incomponentclass', 'inpolygonclass'):
            chave = {'innetclass': 'net', 'incomponentclass': 'ref', 'inpolygonclass': 'poly_nome'}[nome]
            if obj.get(chave) is None:
                return None
            membros = obj.get('classes', {}).get(a0.lower())
            if membros is None:
                return False
            if membros == '*':
                return True
            return obj.get(chave, '') in membros
        return None


class Regras(object):
    def __init__(self, P):
        self.lista = []
        self.classes = {}
        for c in P.classes:
            membros = '*' if L._bool(c.get('SUPERCLASS')) else set(v for k, v in c.items() if re.match(r'^M\d+$', k))
            self.classes[c.get('NAME', '').lower()] = membros
        for r in P.regras:
            if not r or not L._bool(r.get('ENABLED', 'TRUE')):
                continue
            try:
                e1, e2 = Escopo(r.get('SCOPE1EXPRESSION')), Escopo(r.get('SCOPE2EXPRESSION'))
            except ValueError:
                continue
            self.lista.append((int(L._num(r.get('PRIORITY'), 1)), r.get('RULEKIND', ''), e1, e2, r))
        self.lista.sort(key=lambda x: x[0])

    def _casa(self, esc, obj):
        o = dict(obj)
        o['classes'] = self.classes
        return esc.avalia(o)

    def par(self, kind, a, b):
        """a regra de maior prioridade cujo (escopo1, escopo2) casa com (a, b) ou (b, a)"""
        for _, k, e1, e2, r in self.lista:
            if k != kind:
                continue
            if (self._casa(e1, a) and self._casa(e2, b)) or (self._casa(e1, b) and self._casa(e2, a)):
                return r
        return None

    def um(self, kind, a):
        """regra unária (PolygonConnect: escopo 1 = o pad/via, escopo 2 = o polígono)"""
        return None


def matriz(r):
    out = {}
    for item in (r.get('OBJECTCLEARANCES') or '').split(';'):
        m = re.match(r'^ClearanceObj_(\w+)-ClearanceObj_(\w+):(-?\d+)$', item.strip())
        if not m:
            continue
        a, b, v = _MATRIZ.get(m.group(1)), _MATRIZ.get(m.group(2)), int(m.group(3))
        if a == 'poly' and b:
            out[b] = v
        elif b == 'poly' and a:
            out[a] = v
    return out


def folga_da_regra(r, tipo):
    """folga (mm) que a regra de Clearance dá entre o polígono e um objeto do tipo; None = a
    regra só vale para a mesma net (SameNetOnly) e não entra"""
    if r is None:
        return None
    if (r.get('NETSCOPE') or 'DifferentNets') == 'SameNetOnly':
        return None
    m = matriz(r)
    if tipo in m and m[tipo] > 0:
        return mm(m[tipo])
    return mm(L.unid(r.get('GAP')))


def conexao_da_regra(r):
    if r is None:
        return OrderedDict([('tipo', 'relief'), ('condutores', 4), ('largura', 0.254), ('gap', 0.254), ('angulo', 90)])
    estilo = (r.get('CONNECTSTYLE') or 'Relief').lower()
    tipo = {'direct': 'direct', 'relief': 'relief', 'noconnect': 'none'}.get(estilo, 'relief')
    ang = 45 if '45' in (r.get('POLYGONRELIEFANGLE') or '') else 90
    return OrderedDict([('tipo', tipo), ('condutores', int(L._num(r.get('RELIEFENTRIES'), 4))),
                        ('largura', mm(L.unid(r.get('RELIEFCONDUCTORWIDTH')))),
                        ('gap', mm(L.unid(r.get('AIRGAPWIDTH')))), ('angulo', ang)])


# ─── contorno ─────────────────────────────────────────────────────────────────
def _arco_pts(cx, cy, r, a0, a1, tol):
    """pontos do arco de a0 a a1 (graus, já no sentido certo), sem o primeiro"""
    varre = a1 - a0
    if r <= 0 or abs(varre) < 1e-9:
        return []
    passo = 2 * math.degrees(math.acos(max(-1.0, min(1.0, 1 - tol / r)))) if tol < r else 45.0
    n = max(1, int(math.ceil(abs(varre) / max(passo, 0.5))))
    return [(cx + r * math.cos(math.radians(a0 + varre * k / n)), cy + r * math.sin(math.radians(a0 + varre * k / n)))
            for k in range(1, n + 1)]


def contorno_poligono(pg, tol):
    """KINDn/VXn/... -> [(x, y)] em unidade interna, com os arcos achatados pela tolerância"""
    vs = []
    i = 0
    while 'VX%d' % i in pg and 'VY%d' % i in pg:
        vs.append({'kind': int(L._num(pg.get('KIND%d' % i), 0)), 'x': L.unid(pg['VX%d' % i]), 'y': L.unid(pg['VY%d' % i]),
                   'cx': L.unid(pg.get('CX%d' % i)), 'cy': L.unid(pg.get('CY%d' % i)), 'r': L.unid(pg.get('R%d' % i)),
                   'sa': L._num(pg.get('SA%d' % i), 0.0), 'ea': L._num(pg.get('EA%d' % i), 0.0)})
        i += 1
    if len(vs) > 1 and (vs[-1]['x'], vs[-1]['y']) == (vs[0]['x'], vs[0]['y']):
        vs.pop()
    pts = []
    for k, v in enumerate(vs):
        pts.append((v['x'], v['y']))
        if v['kind'] == 1 and v['r'] > 0:
            w = vs[(k + 1) % len(vs)]
            sa, ea = v['sa'], v['ea']
            while ea <= sa:
                ea += 360.0
            ps = (v['cx'] + v['r'] * math.cos(math.radians(sa)), v['cy'] + v['r'] * math.sin(math.radians(sa)))
            pe = (v['cx'] + v['r'] * math.cos(math.radians(ea)), v['cy'] + v['r'] * math.sin(math.radians(ea)))
            d_ini = math.hypot(ps[0] - v['x'], ps[1] - v['y']) + math.hypot(pe[0] - w['x'], pe[1] - w['y'])
            d_fim = math.hypot(pe[0] - v['x'], pe[1] - v['y']) + math.hypot(ps[0] - w['x'], ps[1] - w['y'])
            arco = _arco_pts(v['cx'], v['cy'], v['r'], sa, ea, tol) if d_ini <= d_fim else \
                _arco_pts(v['cx'], v['cy'], v['r'], ea, sa, tol)
            pts.extend(arco[:-1])                      # o ultimo e o proximo vertice
    return pts


# ─── tudo ─────────────────────────────────────────────────────────────────────
def extrai(caminho):
    P = L.Placa(caminho)
    try:
        M = L._Montador(P, gerado='', fonte=caminho)
        B = M.monta()
        R = Regras(P)
        avisos = list(P.avisos)
        X, Y = M.X, M.Y
        # objetos de teste para as regras (o pad e a via pela net/componente reais)
        comp_ref = {}
        for c in B['components']:
            for p in c.get('pads', []):
                comp_ref[p['id']] = c['ref']
        bo = R.par('BoardOutlineClearance', {'tipo': 'poly'}, {'tipo': 'track'})
        folga_placa = mm(L.unid(bo.get('GAP'))) if bo is not None else 0.0
        polys, altium = [], []
        nets_placa = sorted(set(B['nets']))
        for k, pg in enumerate(P.polys):
            pid = 'p%d' % (k + 1)
            cam = L.camada_txt(pg.get('LAYER')) or ''
            ni = int(L._num(pg.get('NET'), -1)) if pg.get('NET') not in (None, '') else -1
            net = P.net(ni) if ni >= 0 else ''
            nome = nome_poligono(pg.get('NAME'))
            tol = L.unid(pg.get('ARCRESOLUTION')) or L.unid('0.5mil')
            pts = [[X(int(round(x))), Y(int(round(y)))] for x, y in contorno_poligono(pg, tol)]
            eu = {'tipo': 'poly', 'net': net, 'camada': cam, 'camada_nome': L.NOME_PADRAO.get(cam, cam),
                  'poly_nome': nome, 'ref': ''}
            hatch = (pg.get('HATCHSTYLE') or 'Solid').lower()
            o = OrderedDict()
            o['id'] = pid
            o['nome'] = nome
            o['layer'] = cam
            o['net'] = net
            o['pts'] = pts
            o['pour'] = 'none' if L._bool(pg.get('SHELVED')) else ('solid' if hatch == 'solid' else 'hatch')
            o['ordem'] = int(L._num(pg.get('POURINDEX'), -1))
            o['pourOver'] = POUR_OVER.get(int(L._num(pg.get('POUROVERSTYLE'), 1)), 'all')
            o['removeDead'] = L._bool(pg.get('REMOVEDEAD'))
            o['removeNecks'] = L._bool(pg.get('REMOVENECKS'))
            o['neck'] = mm(L.unid(pg.get('NECKWIDTHTHRESHOLD'))) if pg.get('NECKWIDTHTHRESHOLD') else 0.127
            area = L._num(pg.get('AREATHRESHOLD'), 0.0)
            o['minArea'] = round(area * (0.0254 / 10000.0) ** 2, 6) if L._bool(pg.get('REMOVEISLANDSBYAREA')) else 0
            o['arco'] = mm(tol)
            if hatch != 'solid':
                o['hatch'] = OrderedDict([('estilo', hatch), ('grade', mm(L.unid(pg.get('GRIDSIZE')))),
                                          ('largura', mm(L.unid(pg.get('TRACKWIDTH'))))])
            # clearance: a regra do polígono contra um objeto de net qualquer, tipo a tipo
            outra = '\x00outra-net'
            base = {t: folga_da_regra(R.par('Clearance', eu, {'tipo': t, 'net': outra, 'ref': '', 'camada': cam,
                                                               'camada_nome': eu['camada_nome']}), t) for t in TIPOS}
            gen = base['track'] if base['track'] is not None else 0.254
            o['clearance'] = gen
            ct = OrderedDict((t, v) for t, v in base.items() if v is not None and abs(v - gen) > 1e-9)
            if ct:
                o['clearanceTipo'] = ct
            cn = OrderedDict()
            for n in nets_placa:
                if n == net:
                    continue
                d = OrderedDict()
                for t in TIPOS:
                    v = folga_da_regra(R.par('Clearance', eu, {'tipo': t, 'net': n, 'ref': '', 'camada': cam,
                                                               'camada_nome': eu['camada_nome']}), t)
                    if v is not None and base[t] is not None and abs(v - base[t]) > 1e-9:
                        d[t] = v
                if d:
                    cn[n] = d
            if cn:
                o['clearanceNet'] = cn
            o['clearanceBorda'] = folga_placa
            # conexão: a regra do pad/via (escopo 1) com o polígono (escopo 2)
            def con(obj):
                return conexao_da_regra(R.par('PolygonConnect', obj, eu))
            o['conexao'] = con({'tipo': 'th', 'net': net, 'ref': '', 'camada': 'Multi'})
            cv = con({'tipo': 'via', 'net': net, 'ref': '', 'camada': 'Multi'})
            if cv != o['conexao']:
                o['conexaoVia'] = cv
            cs = con({'tipo': 'smd', 'net': net, 'ref': '', 'camada': cam})
            if cs != o['conexao']:
                o['conexaoSmd'] = cs
            co = OrderedDict()
            for c in B['components']:
                for p in c.get('pads', []):
                    if p.get('net') != net:
                        continue
                    t = 'smd' if p.get('type') == 'smd' else 'th'
                    v = con({'tipo': t, 'net': net, 'ref': c['ref'], 'camada': p.get('layer')})
                    ref = o.get('conexaoSmd' if t == 'smd' else 'conexao', o['conexao'])
                    if v != ref:
                        co[p['id']] = v
            if co:
                o['conexaoObj'] = co
            polys.append(o)
            regs = []
            for g in P.regioes:
                if g['poly'] == k:
                    regs.append(OrderedDict([('pts', M.pontos(g['pts'])), ('holes', [M.pontos(h) for h in g['furos']])]))
            altium.append(OrderedDict([('de', pid), ('layer', cam), ('net', net), ('regioes', regs),
                                       ('trilhas', sum(1 for t in P.trilhas + P.arcos if t['poly'] == k))]))
        return OrderedDict([('fonte', caminho), ('board', B), ('polygons', polys), ('altium', altium),
                            ('avisos', avisos)])
    finally:
        P.fecha()


def main(argv):
    if len(argv) != 2:
        print(__doc__.split('\n\n')[1])
        return 2
    saida = argv[1]
    if saida.replace('\\', '/').lower().startswith(('z:', 'x:', 'y:', '//')):
        print('RECUSADO: a saida e sempre local (o acervo e so leitura)')
        return 2
    J = extrai(argv[0])
    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(J, f, ensure_ascii=False)
    print('%s: %d poligono(s), %d regioes do Altium' % (os.path.basename(argv[0]), len(J['polygons']),
                                                       sum(len(a['regioes']) for a in J['altium'])))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
