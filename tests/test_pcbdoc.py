# -*- coding: utf-8 -*-
"""O leitor de .PcbDoc (tools/pcbdoc), provado com bytes montados aqui e, se a rede estiver, contra
o board.js que o ExportBoard gerou do mesmo estado da placa.

    python3 tests/test_pcbdoc.py

(a) funções puras: CoordToMMs (o empate da 6a casa sai para baixo), o FloatToStr do Delphi, o
    JS() do ExportBoard, a ordem das nets (CompareString do Windows), as strings especiais, o
    avaliador de escopo das regras;
(b) cada registro (trilha, arco, via, fill, pad, texto, region) montado byte a byte e lido de volta;
(c) um .PcbDoc INTEIRO sintético (contêiner OLE escrito pelo tools/almox/cfbf.py): a ordem dos ids
    (tipo, depois camada, depois stream; 2a passada para camada nova), o board.js linha a linha,
    os campos novos do contrato 2026-10 e -- se houver node -- o HubCore.applyPcbChanges(board, [])
    do hub abrindo o resultado;
(d) opcional, com o Y:/X: no ar: o DMB v91 (History) item a item contra Projects/DMB/board.js,
    o v94 contra as contagens do Gerber X2 e o PcbDoc atual contra o painel do Altium.
    Sem a rede, (d) PULA em silêncio.
"""
import io
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'pcbdoc'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import pcbdoc_leitor as L  # noqa: E402

DMB_PASTA = ['%s:/EQUIPAMENTOS_REVISADOS/DMB - DI231765 - DISPLAY ASCII PARA MARCAÇÃO DE BOBINAS/PCB E SCH/'
             'PDMB - DI231765_P2 (Microntrolladora)' % d for d in ('Y', 'X')]
DMB_BOARD = os.path.join(RAIZ, 'Projects', 'DMB - DI231765_P2', 'board.js')
MIL = 10000                                   # 1 mil em unidade interna


# ─── montadores de registro ───────────────────────────────────────────────────
def rec(tipo, p):
    return bytes([tipo]) + struct.pack('<I', len(p)) + p


def props_bytes(d):
    return ('|' + '|'.join('%s=%s' % kv for kv in d.items()) + '\x00').encode('latin-1')


def rec_props(d, prefixo=b''):
    b = props_bytes(d)
    return prefixo + struct.pack('<I', len(b)) + b


def v7(chave):
    return {'Top': 0x01000001, 'Bottom': 0x0100FFFF, 'TopOverlay': 0x01030006, 'BottomOverlay': 0x01030007,
            'Mech1': 0x01020001, 'Mid1': 0x01000002, 'KeepOut': 0x0103000D}[chave]


def trilha(camada, x1, y1, x2, y2, w, net=0xFFFF, comp=0xFFFF, f2=0, poly=0xFFFF):
    p = bytearray(49)
    p[0] = L.NUM_CAMADA[camada]
    p[1], p[2] = 0x0C, f2
    struct.pack_into('<HHH', p, 3, net, poly, comp)
    p[9:13] = b'\xff' * 4
    struct.pack_into('<5i', p, 13, x1, y1, x2, y2, w)
    struct.pack_into('<I', p, 41, v7(camada))
    return bytes(p)


def arco(camada, cx, cy, r, sa, ea, w, net=0xFFFF, comp=0xFFFF):
    p = bytearray(60)
    p[0] = L.NUM_CAMADA[camada]
    p[1] = 0x0C
    struct.pack_into('<HHH', p, 3, net, 0xFFFF, comp)
    struct.pack_into('<3i', p, 13, cx, cy, r)
    struct.pack_into('<2d', p, 25, sa, ea)
    struct.pack_into('<i', p, 41, w)
    struct.pack_into('<I', p, 52, v7(camada))
    return bytes(p)


def via(x, y, d, furo, net, sm=4 * MIL, manual=False):
    p = bytearray(321)
    p[0] = 74
    p[1] = 0x0C
    struct.pack_into('<H', p, 3, net)
    struct.pack_into('<4i', p, 13, x, y, d, furo)
    p[29], p[30] = 1, 32
    struct.pack_into('<i', p, 54, sm)
    p[66] = 0x02 if manual else 0
    return bytes(p)


def fill(camada, x1, y1, x2, y2, rot=0.0, comp=0xFFFF):
    p = bytearray(50)
    p[0] = L.NUM_CAMADA[camada]
    p[1] = 0x0C
    struct.pack_into('<HHH', p, 3, 0xFFFF, 0xFFFF, comp)
    struct.pack_into('<4i', p, 13, x1, y1, x2, y2)
    struct.pack_into('<d', p, 29, rot)
    struct.pack_into('<I', p, 42, v7(camada))
    return bytes(p)


def pad(nome, camada, x, y, sx, sy, forma=2, rot=0.0, furo=0, net=0xFFFF, comp=0xFFFF, metal=True,
        sm_modo=1, sm_val=0, pm_modo=1, pm_val=0, bot=None, raio_pct=None, tipo_furo=0, slot=0):
    b5 = bytearray(185)
    b5[0] = L.NUM_CAMADA[camada]
    b5[1] = 0x0C
    struct.pack_into('<H', b5, 3, net)
    struct.pack_into('<H', b5, 7, comp)
    bx, by, bf = bot if bot else (sx, sy, forma)
    struct.pack_into('<11i', b5, 13, x, y, sx, sy, sx, sy, bx, by, furo, 0, 0)
    b5[49], b5[50], b5[51] = forma, forma, bf
    struct.pack_into('<d', b5, 52, rot)
    b5[60] = 1 if metal else 0
    b5[62] = 1 if bot else 0
    struct.pack_into('<ii', b5, 86, pm_val, sm_val)
    b5[101], b5[102] = pm_modo, sm_modo
    struct.pack_into('<d', b5, 106, 0.0)
    struct.pack_into('<I', b5, 114, v7(camada) if camada != 'Multi' else 0x0103000F)
    b6 = bytearray(651)
    b6[262] = tipo_furo
    struct.pack_into('<i', b6, 263, slot)
    if raio_pct is not None:
        b6[532] = 9                                  # forma alternativa: roundrect no Top
        b6[564] = raio_pct
    blocos = [bytes([len(nome)]) + nome.encode('latin-1'), b'\x00', b'', b'', bytes(b5), bytes(b6)]
    return bytes([2]) + b''.join(struct.pack('<I', len(x)) + x for x in blocos)


def texto(camada, txt, x, y, h, w, rot=0.0, comp=0xFFFF, desig=False, coment=False, largo=0,
          ret=None, tipo=0, espelho=False):
    """ret = (rw, rh, justificacao, px, py, valido)"""
    s1 = bytearray(252)
    s1[0] = L.NUM_CAMADA[camada]
    struct.pack_into('<H', s1, 7, comp)
    struct.pack_into('<3i', s1, 13, x, y, h)
    struct.pack_into('<H', s1, 25, 1)
    struct.pack_into('<d', s1, 27, rot)
    s1[35] = 1 if espelho else 0
    struct.pack_into('<i', s1, 36, w)
    s1[40], s1[41], s1[43] = int(coment), int(desig), tipo
    s1[46:56] = 'Arial'.encode('utf-16-le')
    struct.pack_into('<I', s1, 115, largo)
    if ret:
        rw, rh, j, px, py, valido = ret
        struct.pack_into('<ii', s1, 124, rw, rh)
        s1[132] = j
        s1[240] = 1 if valido else 0
        struct.pack_into('<ii', s1, 244, px, py)
    s2 = bytes([len(txt)]) + txt.encode('latin-1')
    return bytes([5]) + struct.pack('<I', len(s1)) + bytes(s1) + struct.pack('<I', len(s2)) + s2


def regiao(camada_byte, pr, pts, net=0xFFFF, comp=0xFFFF, furos=(), poly=0xFFFF, f2=0):
    b = props_bytes(pr)
    p = bytearray(22)
    p[0] = camada_byte
    p[1], p[2] = 0x0C, f2
    struct.pack_into('<HHH', p, 3, net, poly, comp)
    p[9:14] = b'\xff' * 5
    struct.pack_into('<H', p, 14, len(furos))
    struct.pack_into('<I', p, 18, len(b))
    corpo = bytes(p) + b + struct.pack('<I', len(pts)) + b''.join(struct.pack('<dd', *q) for q in pts)
    for h in furos:
        corpo += struct.pack('<I', len(h)) + b''.join(struct.pack('<dd', *q) for q in h)
    return rec(11, corpo)


def largas(textos):
    return b''.join(struct.pack('<II', i, len(t.encode('utf-16-le')) + 2) + t.encode('utf-16-le') + b'\x00\x00'
                    for i, t in enumerate(textos))


# ─── (a) funções puras ────────────────────────────────────────────────────────
def test_numeros():
    assert L.mm(17639250) == 44.80369, L.mm(17639250)          # empate da 6a casa: para baixo
    assert L.mm(21603250) == 54.87225
    assert L.mm(-5) == -1e-05 and L.jf(L.mm(-5)) == '-1E-5'    # o k6 do DMB
    assert L.mm(0) == 0 and L.jf(L.mm(0)) == '0'
    assert L.mm(322835) == 0.82
    assert L.jf(360.0) == '360' and L.jf(270.0) == '270' and L.jf(0.0) == '0' and L.jf(-0.0) == '0'
    assert L.jf((88.95668 + 88.44571) / 2) == '88.701195'
    assert L.jf(0.0001) == '0.0001' and L.jf(0.00005) == '5E-5' and L.jf(1e20) == '1E20'
    assert L.jf(109.7296072779) == '109.7296072779'
    assert L.unid('24895mil') == 248950000 and L.unid('1.5mm') == 590551
    assert L.js('PDMB\r\nREV. C') == '"PDMB\\r\\nREV. C"'
    assert L.js('MARCAÇÃO') == '"MARCA\\u00C7\\u00C3O"'
    assert L.js('a"b\\c') == '"a\\"b\\\\c"'
    assert L.js('~') == '"\\u007E"'                             # o .pas corta em 125
    print('  numeros/JSON ok')


def test_nets_e_especiais():
    nets = ['TX', 'NetC10_+', '+5V', '-15V', '0V', 'NetC1_2', 'B+', 'B-', '3V3', "+15V'", '+15V', '_GND']
    assert sorted(nets, key=L.chave_net) == ['_GND', '+15V', "+15V'", '+5V', '0V', '-15V', '3V3', 'B-', 'B+',
                                             'NetC1_2', 'NetC10_+', 'TX'], sorted(nets, key=L.chave_net)
    par = {'Revisao': 'REV. C', 'Desenho_linha_unica': 'PUSI-DI261930'}
    assert L.converte_especiais('PDMB-DI231765_P2\r\n.Revisao', par) == 'PDMB-DI231765_P2\r\nREV. C'
    assert L.converte_especiais('.Desenho_linha_unica\r\n.Revisao', par) == 'PUSI-DI261930\r\nREV. C'
    assert L.converte_especiais('.Designator', {}, 'R7') == 'R7'
    assert L.converte_especiais('.', par) == '.' and L.converte_especiais('1.5V .Nada', par) == '1.5V .Nada'
    # a que fica sem valor e contada (teste de ouro: PcbDoc copiado sem o .PrjPcb -> '.Revisao' cru
    # no board.js e na serigrafia do Gerber, sem aviso nenhum)
    crus = []
    assert L.converte_especiais('PDMB-DI231765_P2\r\n.Revisao', {}, sem_valor=crus) == 'PDMB-DI231765_P2\r\n.Revisao'
    assert crus == ['.Revisao'], crus
    crus = []
    assert L.converte_especiais('.Designator .Revisao 1.5V V.A', par, 'R7', sem_valor=crus) == 'R7 REV. C 1.5V V.A'
    assert crus == [], crus
    crus = []
    L.converte_especiais('.Designator / .Nada', par, '', sem_valor=crus)           # texto livre: sem dono
    assert crus == ['.Designator', '.Nada'], crus
    print('  nets/strings especiais ok')


def test_escopo():
    obj = {'tipo': 'pad', 'net': 'GND', 'ref': 'U1', 'footprint': 'SOIC8', 'camada': 'Top',
           'camada_nome': 'Top Layer', 'smd': True, 'classes_net': {'pwr': {'GND'}}, 'classes_comp': {}}
    av = lambda e: L._Escopo(e).avalia(obj)          # noqa: E731
    assert av('All') is True and av('IsPad') is True and av('IsVia') is False
    assert av("InNet('GND')") is True and av("InNet('VCC') or IsPad") is True
    assert av("HasFootprint('No Footprint') And OnLayer('Top Layer')") is False
    assert av("HasFootprint('SOIC8') And OnLayer('Top Layer')") is True
    assert av("not (InComponent('U1'))") is False and av("InNetClass('PWR')") is True
    assert av('IsQualquerCoisa') is None and av('IsQualquerCoisa or IsPad') is True
    assert av('IsQualquerCoisa and IsVia') is False
    print('  escopo de regra ok')


def test_regras():
    """o rules.js cru (pcbdoc2board --regras) e o escopo com comparacao/unidade (o MIRBC tem
    "AsMils(X1) >= 6669.9799"): a regra fica de fora com aviso, nunca excecao"""
    av = []
    R = L.Regras([{'RULEKIND': 'Width', 'NAME': 'mirbc', 'PRIORITY': '1',
                   'SCOPE1EXPRESSION': "(IsVia And (InNet('COM') And ((AsMils(X1) >= 6669.9799) And (AsMils(Y1) <= 290.0201))))"},
                  {'RULEKIND': 'Width', 'NAME': 'cmp', 'PRIORITY': '2', 'SCOPE1EXPRESSION': 'Width > 10 AsMils'},
                  {'RULEKIND': 'Width', 'NAME': 'geral', 'PRIORITY': '3', 'SCOPE1EXPRESSION': 'All'}], [], av)
    assert R.dominante('Width', {'tipo': 'via', 'net': 'COM'})['NAME'] == 'geral'
    assert R.dominante('Width', {'tipo': 'via', 'net': 'X'})['NAME'] == 'geral'
    assert any('mirbc' in a for a in av), av

    class P(object):
        regras = [{'RULEKIND': 'Clearance', 'NAME': 'Clearance', 'PRIORITY': '1', 'ENABLED': 'TRUE', 'GAP': '7.874mil',
                   'SCOPE1EXPRESSION': 'All', 'SCOPE2EXPRESSION': 'All', 'NETSCOPE': 'DifferentNets'},
                  {'RULEKIND': 'Width', 'NAME': 'Terra', 'PRIORITY': '1', 'ENABLED': 'TRUE', 'MINLIMIT': '15.748mil',
                   'PREFEREDWIDTH': '39.3701mil', 'MAXLIMIT': '78.7402mil', 'SCOPE1EXPRESSION': "InNet('0V')"}]
        classes = [{'KIND': '0', 'NAME': 'POWER', 'SUPERCLASS': 'FALSE', 'M0': '0V', 'M1': '5V'}]
        drc_opcoes = {'RULESETTOCHECK': '0,2,15', 'ONLINERULESETTOCHECK': '0,24', 'DOMAKEDRCFILE': 'TRUE'}
    txt = L.regras_js(P(), 'C:\\placa.PcbDoc')
    assert txt.startswith('// ') and 'var pcbrules = {' in txt and txt.rstrip().endswith('};')
    assert '"drc":{"RULESETTOCHECK": "0,2,15", "ONLINERULESETTOCHECK": "0,24"}' in txt, txt
    assert 'DOMAKEDRCFILE' not in txt
    # o hub traduz (HubPcbRegras.ler): a traducao mora num lugar so
    node = shutil.which('node')
    if not node:
        print('  regras ok (traducao pelo hub PULADA: sem node)')
        return
    d = tempfile.mkdtemp(prefix='regras-')
    try:
        rj = os.path.join(d, 'rules.js')
        with open(rj, 'w', encoding='ascii', newline='\n') as f:
            f.write(txt)
        script = os.path.join(d, 'le.cjs')
        with open(script, 'w', encoding='utf-8') as f:
            f.write("const R=require(%s);const S=R.ler(require('fs').readFileSync(%s,'utf8'));\n"
                    "const c=S.rules.find(r=>r.kind==='Clearance'),w=S.rules.find(r=>r.kind==='Width');\n"
                    "console.log(JSON.stringify({gap:c.gap,w:[w.min,w.pref,w.max],cl:S.classes.net,v:S.verificar}));\n"
                    % (json.dumps(os.path.join(RAIZ, 'hub-pcbregras.js')), json.dumps(rj)))
        r = subprocess.run([node, script], capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, r.stderr[-800:]
        res = json.loads(r.stdout.strip().splitlines()[-1])
        assert res['gap'] == 0.2 and res['w'] == [0.4, 1, 2], res
        assert res['cl'] == {'POWER': ['0V', '5V']}, res
        assert res['v'] == {'lote': ['Clearance', 'Width', 'ShortCircuit'], 'online': ['Clearance', 'ComponentClearance']}, res
        print('  regras ok (rules.js cru -> HubPcbRegras: %s)' % res['w'])
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ─── (b) registros ────────────────────────────────────────────────────────────
def test_registros():
    t = L.le_trilha(trilha('Bottom', 1, 2, 3, 4, 5, net=7, comp=1, f2=2))
    assert (t['camada'], t['x1'], t['y1'], t['x2'], t['y2'], t['w'], t['net'], t['comp'], t['f2']) == \
        ('Bottom', 1, 2, 3, 4, 5, 7, 1, 2)
    a = L.le_arco(arco('TopOverlay', 10, 20, 30, 90.0, 270.0, 5))
    assert (a['camada'], a['cx'], a['cy'], a['r'], a['sa'], a['ea'], a['w']) == ('TopOverlay', 10, 20, 30, 90.0, 270.0, 5)
    v = L.le_via(via(100, 200, 196850, 118110, 3, sm=0, manual=True))
    assert (v['x'], v['y'], v['d'], v['furo'], v['de'], v['ate'], v['sm'], v['sm_manual']) == \
        (100, 200, 196850, 118110, 'Top', 'Bottom', 0, True)
    f = L.le_fill(fill('Mech1', 1, 2, 3, 4, 180.0, comp=0))
    assert (f['camada'], f['x1'], f['y2'], f['rot'], f['comp']) == ('Mech1', 1, 4, 180.0, 0)
    # pad: 6 blocos; roundrect vem do bloco 6 (forma alternativa 9 + raio em %)
    bl = next(L.it_blocos(pad('7', 'Top', 5, 6, 236220, 570866, forma=1, raio_pct=17, net=2)[0:], 6))[1]
    p = L.le_pad(bl)
    assert p['nome'] == '7' and p['camada'] == 'Top' and (p['x'], p['y'], p['tx'], p['ty']) == (5, 6, 236220, 570866)
    nome, sx, sy, raio = L.forma_pad(p, 'top')
    assert nome == 'roundrect' and abs(raio - 17 * 236220 / 200.0) < 1e-9
    bl = next(L.it_blocos(pad('1', 'Multi', 0, 0, 3 * MIL, 3 * MIL, forma=1, furo=40 * MIL, metal=False,
                              tipo_furo=2, slot=80 * MIL), 6))[1]
    p = L.le_pad(bl)
    assert p['camada'] == 'Multi' and not p['metal'] and p['tipo_furo'] == 2 and p['slot'] == 80 * MIL
    # texto: o retangulo gravado da o centro sem metrica de fonte
    bl = next(L.it_blocos(texto('TopOverlay', 'GND', 1000, 2000, 787402, 78740, rot=270.0,
                                ret=(2256541, 944628, 3, 1000, 2000, True)), 2))[1]
    t = L.le_texto(bl, {})
    assert t['texto'] == 'GND' and t['rot'] == 270.0 and t['h'] == 787402
    # j3 a 270 graus: o retangulo comeca no ponto e desce (largura vira -Y), em inteiro
    assert L.caixa_texto(t) == (1000, 2000 - 2256541, 1000 + 944628, 2000), L.caixa_texto(t)
    # j5 com largura impar: meia largura por divisao INTEIRA (o lado direito leva a sobra)
    bl = next(L.it_blocos(texto('TopOverlay', 'D19', 0, 0, 1, 1, espelho=True,
                                ret=(1699515, 799806, 5, 5000, 7000, True)), 2))[1]
    assert L.caixa_texto(L.le_texto(bl, {})) == (5000 - 849758, 7000 - 399903, 5000 + 849757, 7000 + 399903)
    # byte 240 = 0 (footprint): o ponto e a ancora, o '+' sobe 1/6 da altura
    bl = next(L.it_blocos(texto('TopOverlay', '+', 0, 0, 600000, 100000, ret=(599868, 599868, 5, 0, 0, False)), 2))[1]
    t = L.le_texto(bl, {})
    x1, y1, x2, y2 = L.caixa_texto(t)
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    assert abs(cx - 199934) < 1 and abs(cy - (100000 * 0.999676 + 199934)) < 2, (cx, cy)
    # pascal vazio manda sobre o WideStrings (o comment do FB2 do PESDA)
    bl = next(L.it_blocos(texto('TopOverlay', '', 0, 0, 1, 1, largo=4), 2))[1]
    assert L.le_texto(bl, {4: 'i'})['texto'] == ''
    bl = next(L.it_blocos(texto('TopOverlay', 'MARCA??O', 0, 0, 1, 1, largo=4), 2))[1]
    assert L.le_texto(bl, {4: 'MARCAÇÃO'})['texto'] == 'MARCAÇÃO'
    # region: vertices em double + furos; V7_LAYER manda sobre o byte
    r = next(L.it_simples(regiao(56, {'V7_LAYER': 'MULTILAYER', 'KIND': '0', 'ISBOARDCUTOUT': 'TRUE'},
                                 [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)], furos=[[(1.0, 1.0), (2.0, 1.0), (2.0, 2.0)]])))[1]
    g = L.le_regiao(r)
    assert g['camada'] == 'Multi' and g['recorte'] and g['kind'] == 0 and len(g['pts']) == 3 and len(g['furos']) == 1
    # iterador: registro truncado e erro claro, nao lixo
    try:
        list(L.it_simples(rec(4, b'x' * 10)[:-3], 'Tracks6'))
        raise AssertionError('truncado passou')
    except L.PcbDocErro as e:
        assert 'truncado' in str(e)
    print('  registros ok')


# ─── (c) um PcbDoc inteiro ────────────────────────────────────────────────────
def pcbdoc_sintetico():
    import cfbf
    o = (1000 * MIL, 2000 * MIL)
    X = lambda mil: o[0] + int(mil * MIL)            # noqa: E731
    Y = lambda mil: o[1] + int(mil * MIL)            # noqa: E731
    board = {'ORIGINX': '1000mil', 'ORIGINY': '2000mil', 'LAYER1NAME': 'Top Layer', 'LAYER1NEXT': '32',
             'LAYER32NAME': 'Bottom Layer', 'LAYER32NEXT': '0', 'LAYER57MECHENABLED': 'TRUE',
             'LAYER57NAME': 'Mechanical 1', 'LAYER33NAME': 'Top Overlay'}
    for i, (vx, vy) in enumerate([(0, 0), (2000, 0), (2000, 1000), (0, 1000), (0, 0)]):
        board.update({'KIND%d' % i: '0', 'VX%d' % i: '%dmil' % (1000 + vx), 'VY%d' % i: '%dmil' % (2000 + vy),
                      'CX%d' % i: '0mil', 'CY%d' % i: '0mil', 'R%d' % i: '0mil',
                      'SA%d' % i: ' 0.00000000000000E+0000', 'EA%d' % i: ' 0.00000000000000E+0000'})
    nets = [{'NAME': 'VCC'}, {'NAME': 'GND'}, {'NAME': 'NetR1_1'}]
    comps = [{'LAYER': 'TOP', 'X': '2500mil', 'Y': '2500mil', 'PATTERN': 'RES1206', 'NAMEON': 'TRUE',
              'COMMENTON': 'FALSE', 'ROTATION': ' 9.00000000000000E+0001', 'SOURCEDESIGNATOR': 'R1'}]
    regras = [{'RULEKIND': 'SolderMaskExpansion', 'NAME': 'M', 'ENABLED': 'TRUE', 'PRIORITY': '1',
               'SCOPE1EXPRESSION': 'All', 'SCOPE2EXPRESSION': 'All', 'EXPANSION': '4mil', 'ISTENTINGTOP': 'FALSE'},
              {'RULEKIND': 'PasteMaskExpansion', 'NAME': 'P', 'ENABLED': 'TRUE', 'PRIORITY': '1',
               'SCOPE1EXPRESSION': 'All', 'SCOPE2EXPRESSION': 'All', 'EXPANSION': '0mil'},
              {'RULEKIND': 'Clearance', 'NAME': 'C', 'ENABLED': 'TRUE', 'PRIORITY': '1',
               'SCOPE1EXPRESSION': 'All', 'SCOPE2EXPRESSION': 'All', 'GAP': '10mil'},
              {'RULEKIND': 'RoutingVias', 'NAME': 'V', 'ENABLED': 'TRUE', 'PRIORITY': '1',
               'SCOPE1EXPRESSION': 'All', 'SCOPE2EXPRESSION': 'All', 'WIDTH': '19.685mil', 'HOLEWIDTH': '11.811mil'}]
    # trilhas: o STREAM mistura camadas de proposito -- o board.js sai por camada
    trilhas = [trilha('Top', X(100), Y(100), X(400), Y(100), 10 * MIL, net=1),           # t1
               trilha('TopOverlay', X(0), Y(900), X(300), Y(900), 5 * MIL),             # s2 (silk livre)
               trilha('Bottom', X(100), Y(200), X(400), Y(200), 20 * MIL, net=0),        # t3
               trilha('Mech1', X(0), Y(0), X(2000), Y(0), 5 * MIL),                      # l1 (2a passada)
               trilha('Top', X(100), Y(300), X(400), Y(300), 10 * MIL, f2=2),            # t2, keepout
               trilha('TopOverlay', X(1450), Y(2440 - 2000), X(1550), Y(2440 - 2000), 5 * MIL, comp=0),
               trilha('Mid1', X(100), Y(400), X(400), Y(400), 10 * MIL, net=1)]          # t4 (2a passada)
    arcos = [arco('Bottom', X(500), Y(500), 50 * MIL, 0.0, 90.0, 10 * MIL, net=1),       # a1
             arco('TopOverlay', X(600), Y(600), 25 * MIL, 0.0, 360.0, 5 * MIL)]          # s1
    pads = [pad('1', 'Top', X(1500), Y(450), 60 * MIL, 50 * MIL, rot=90.0, net=2, comp=0),
            pad('2', 'Top', X(1500), Y(550), 60 * MIL, 50 * MIL, rot=90.0, net=1, comp=0, sm_modo=2, sm_val=0),
            pad('M', 'Multi', X(200), Y(800), 70 * MIL, 70 * MIL, forma=1, furo=40 * MIL, net=1, metal=False,
                pm_modo=2, pm_val=-L.unid('1000mm'), bot=(80 * MIL, 80 * MIL, 2))]
    textos = [texto('TopOverlay', 'R1', X(1480), Y(620), 600000, 100000, comp=0, desig=True, largo=0,
                    ret=(800000, 800000, 5, X(1500), Y(640), True)),
              texto('TopOverlay', '1k', X(1480), Y(380), 600000, 100000, comp=0, coment=True, largo=1),
              texto('TopOverlay', '.Revisao', X(50), Y(50), 600000, 100000, largo=2,
                    ret=(4000000, 800000, 3, X(50) - 100000, Y(50) - 100000, True)),
              texto('Mech1', 'MEC', X(10), Y(10), 600000, 100000, largo=3,
                    ret=(1600000, 800000, 3, X(10) - 100000, Y(10) - 100000, True))]
    fills = [fill('TopOverlay', X(700), Y(700), X(800), Y(750)), fill('Mech1', X(0), Y(0), X(10), Y(10))]
    cobre = [(X(100), Y(600)), (X(300), Y(600)), (X(300), Y(700)), (X(100), Y(700))]
    furo = [(X(150), Y(620)), (X(200), Y(620)), (X(200), Y(650))]
    regioes = [regiao(1, {'V7_LAYER': 'TOP', 'KIND': '0'}, cobre, net=1, furos=[furo]),
               regiao(56, {'V7_LAYER': 'MULTILAYER', 'KIND': '0', 'ISBOARDCUTOUT': 'TRUE'},
                      [(X(1900), Y(900)), (X(1950), Y(900)), (X(1950), Y(950))]),
               regiao(1, {'V7_LAYER': 'TOP', 'KIND': '1'}, [(X(10), Y(10)), (X(20), Y(10)), (X(20), Y(20))])]
    placa = regiao(56, {'V7_LAYER': 'MULTILAYER', 'KIND': '0', 'ISBOARDCUTOUT': 'TRUE', 'OBJECTKIND': 'BoardRegion'},
                   [(X(0), Y(0)), (X(2000), Y(0)), (X(2000), Y(1000)), (X(0), Y(1000))])

    def st(dados, n):
        return {'Data': dados, 'Header': struct.pack('<I', n)}
    arvore = {
        'FileHeader': b'\x1b\x00\x00\x00PCB 6.0 Binary File',
        'Board6': st(rec_props(board), 1),
        'Nets6': st(b''.join(rec_props(n) for n in nets), len(nets)),
        'Components6': st(b''.join(rec_props(c) for c in comps), len(comps)),
        'Rules6': st(b''.join(rec_props(r, b'\x02\x00') for r in regras), len(regras)),
        'Tracks6': st(b''.join(rec(4, t) for t in trilhas), len(trilhas)),
        'Arcs6': st(b''.join(rec(1, a) for a in arcos), len(arcos)),
        'Vias6': st(rec(3, via(X(1000), Y(500), 196850, 118110, 1)), 1),
        'Fills6': st(b''.join(rec(6, f) for f in fills), len(fills)),
        'Pads6': st(b''.join(pads), len(pads)),
        'Texts6': st(b''.join(textos), len(textos)),
        'WideStrings6': st(largas(['R1', '1k', '.Revisao', 'MEC']), 4),
        'Regions6': st(b''.join(regioes), len(regioes)),
        'BoardRegions': st(placa, 1),
    }
    return cfbf.escreve(arvore)


def test_pcbdoc_inteiro():
    try:
        import olefile  # noqa: F401
    except ImportError:
        print('  PcbDoc inteiro PULADO (olefile nao instalado)')
        return None
    dados = pcbdoc_sintetico()
    P = L.Placa(dados)
    assert not P.avisos, P.avisos
    P.parametros = {'Revisao': 'REV. A'}
    B = L.monta(P, gerado='02/10/2026 12:00:00', fonte='C:\\placa.PcbDoc')
    texto_js = L.board_js(B)
    linhas = texto_js.split('\n')
    assert linhas[0] == 'var pcbmirror = {' and linhas[-2] == '};' and linhas[-1] == ''
    assert '"format":"pcbmirror-v1",' in linhas and '"exporter":"%s",' % L.EXPORTER in linhas
    J = json.loads(texto_js[texto_js.index('{'):texto_js.rindex('}') + 1])
    # um item por linha, virgula no comeco da seguinte (como o ExportBoard)
    i = linhas.index('"tracks":[')
    assert linhas[i + 1].startswith('{"id":"t1"') and linhas[i + 2].startswith(',{"id":"t2"')
    # placa e contorno
    assert J['board']['bbox'] == {'x1': 0, 'y1': 0, 'x2': 50.8, 'y2': 25.4}
    assert [s['kind'] for s in J['board']['outline']] == ['line'] * 4
    # ids: tipo, depois camada (Top antes de Bottom), depois stream; Mid1 na 2a passada
    assert [(t['id'], t['layer']) for t in J['tracks']] == [('t1', 'Top'), ('t2', 'Top'), ('t3', 'Bottom'), ('t4', 'Mid1')]
    assert J['tracks'][1].get('keepout') is True and 'keepout' not in J['tracks'][0]
    assert [(s['id'], s['kind']) for s in J['silk']] == [('s1', 'arc'), ('s2', 'line'), ('s3', 'line')]
    assert J['silk'][2]['owner'] == 'R1' and 'owner' not in J['silk'][1]
    assert [(a['id'], a['layer']) for a in J['arcs']] == [('a1', 'Bottom')]
    assert [(l['id'], l['layer'], l['kind']) for l in J['lines']] == [('l1', 'Mech1', 'line')]
    assert J['tracks'][0] == {'id': 't1', 'layer': 'Top', 'x1': 2.54, 'y1': 2.54, 'x2': 10.16, 'y2': 2.54,
                              'w': 0.254, 'net': 'GND'}
    # componente, pads e campos novos
    c = J['components'][0]
    assert (c['ref'], c['footprint'], c['comment'], c['layer'], c['x'], c['y'], c['rot']) == \
        ('R1', 'RES1206', '1k', 'Top', 38.1, 12.7, 90)
    # bbox = pads (60x50 mil girados 90) + a linha de silk do R1 (com a meia largura)
    assert c['bbox'] == {'x1': 36.7665, 'y1': 10.668, 'x2': 39.4335, 'y2': 14.732}, c['bbox']
    p1, p2 = c['pads']
    assert (p1['id'], p1['type'], p1['shape'], p1['w'], p1['h'], p1['rot'], p1['net']) == \
        ('c1p1', 'smd', 'rect', 1.524, 1.27, 90, 'NetR1_1')
    assert p1['sm'] == 0.1016 and p1['pm'] == 0 and p2['sm'] == 0 and p1['tentTop'] is False
    fp = J['freepads'][0]
    assert (fp['id'], fp['type'], fp['shape'], fp['drill'], fp['plated'], fp.get('nopaste')) == \
        ('p1', 'th', 'circle', 1.016, False, True)
    assert fp['bot'] == {'w': 2.032, 'h': 2.032, 'shape': 'rect'}, fp.get('bot')
    v = J['vias'][0]
    assert (v['size'], v['drill'], v['from'], v['to'], v['net'], v['sm'], v['tentTop']) == \
        (0.5, 0.3, 'Top', 'Bottom', 'GND', 0.1016, False)
    # textos: designator pelo retangulo gravado; comment oculto fica fora; string especial
    # convertida; a Mech1 vem na 2a passada
    assert [(t['id'], t['text']) for t in J['texts']] == [('x1', 'R1'), ('x2', 'REV. A'), ('x3', 'MEC')]
    assert (J['texts'][0]['x'], J['texts'][0]['y']) == (38.1, 16.256)              # j5: o ponto e o centro
    assert (J['texts'][1]['x'], J['texts'][1]['y']) == (6.096, 2.032)              # j3: canto + meio retangulo
    t = J['texts'][1]
    assert (t['w'], t['kind'], t['ax'], t['ay']) == (0.254, 'stroke', 1.27, 1.27)
    # regions, recortes, fills, camadas, regras, nets
    g = J['regions'][0]
    assert g['net'] == 'GND' and len(g['points']) == 4 and len(g['holes']) == 1 and len(g['holes'][0]) == 3
    assert [(k['id'], k['layer'], k['kindn']) for k in J['cutouts']] == [('k1', 'Top', 1), ('k2', 'Multi', 3), ('k3', 'Multi', -1)]
    assert [(f['id'], f['layer']) for f in J['fills']] == [('f1', 'TopOverlay'), ('f2', 'Mech1')]
    assert J['fills'][0] == {'id': 'f1', 'layer': 'TopOverlay', 'x1': 17.78, 'y1': 17.78, 'x2': 20.32, 'y2': 19.05,
                             'rot': 0, 'net': ''}
    chaves = [l['key'] for l in J['layers']]
    assert chaves[:3] == ['Top', 'Bottom', 'Mech1'] and chaves[-1] == 'Multi' and J['layers'][1]['stack'] == 2
    assert J['rules'] == {'sm': 0.1016, 'pm': 0, 'clearance': 0.254, 'viaSize': 0.5, 'viaDrill': 0.3}
    assert J['nets'] == ['GND', 'NetR1_1', 'VCC']
    assert J['stats'] == {'components': 1, 'freepads': 1, 'tracks': 4, 'arcs': 1, 'vias': 1, 'texts': 3, 'silk': 3,
                          'regions': 1, 'cutouts': 3, 'fills': 2, 'lines': 1}
    assert P.especiais_crus == {} and not any('string especial' in a for a in P.avisos), P.avisos
    # sem os parametros do projeto (PcbDoc copiado sem o .PrjPcb): o texto fica cru, como antes,
    # mas agora com aviso -- o Gerber do hub escreveria '.Revisao' na serigrafia
    P2 = L.Placa(dados)
    J2 = L.monta(P2, gerado='02/10/2026 12:00:00', fonte='C:\\placa.PcbDoc')
    assert [t['text'] for t in J2['texts'] if t['id'] == 'x2'] == ['.Revisao']
    assert P2.especiais_crus == {'.Revisao': ['x2']}, P2.especiais_crus
    av = [a for a in P2.avisos if a.startswith('string especial .Revisao sem valor em 1 texto(s) (x2): ')]
    assert len(av) == 1 and 'passe --prjpcb' in av[0], P2.avisos
    print('  PcbDoc sintetico ok (%d bytes de OLE, %d linhas de board.js)' % (len(dados), len(linhas)))
    return texto_js


def test_cli():
    """o pcbdoc2board.py: grava, recusa sobrescrever Projects/*/board.js sem --forcar, faz o .bak"""
    import pcbdoc2board as C
    assert C.disco_de_rede('\\\\servidor\\share\\board.js') and C.disco_de_rede('//servidor/share/b.js')
    assert C.eh_board_de_projeto('C:/x/Projects/Placa/board.js') and not C.eh_board_de_projeto('C:/x/board.js')
    d = tempfile.mkdtemp(prefix='pcbdoc-cli-')
    try:
        doc = os.path.join(d, 'placa.PcbDoc')
        with open(doc, 'wb') as f:
            f.write(pcbdoc_sintetico())
        saida = os.path.join(d, 'Projects', 'Placa', 'board.js')
        os.makedirs(os.path.dirname(saida))
        cli = os.path.join(RAIZ, 'tools', 'pcbdoc', 'pcbdoc2board.py')
        roda = lambda *a: subprocess.run([sys.executable, cli, doc, saida, '-q'] + list(a),      # noqa: E731
                                         capture_output=True, text=True, timeout=120)
        r = roda()
        assert r.returncode == 0 and os.path.exists(saida), r.stdout + r.stderr
        with open(saida, encoding='ascii') as f:
            primeira = f.readline()
        assert primeira == 'var pcbmirror = {\n'
        r = roda()
        assert r.returncode == 2 and 'RECUSADO' in r.stdout, r.stdout
        r = roda('--forcar')
        assert r.returncode == 0 and os.path.exists(saida + '.bak'), r.stdout + r.stderr
        r = subprocess.run([sys.executable, cli, os.path.join(d, 'nao-existe.PcbDoc'), os.path.join(d, 'x.js')],
                           capture_output=True, text=True, timeout=60)
        assert r.returncode == 1 and 'ERRO' in r.stdout, r.stdout
        # sem .PrjPcb ao lado: o '.Revisao' fica cru E o resumo avisa, dizendo como resolver (o
        # teste de ouro so via "nenhum .PrjPcb achado" e o Gerber saia com '.REVISAO')
        livre = os.path.join(d, 'livre.js')
        roda2 = lambda *a: subprocess.run([sys.executable, cli, doc, livre] + list(a),            # noqa: E731
                                          capture_output=True, text=True, timeout=120, encoding='utf-8')
        r = roda2()
        assert r.returncode == 0, r.stdout + r.stderr
        assert 'aviso: string especial .Revisao sem valor em 1 texto(s) (x2): ' in r.stdout and '--prjpcb' in r.stdout, r.stdout
        with open(livre, encoding='ascii') as f:
            assert '"text":".Revisao"' in f.read()
        # com o .PrjPcb do projeto: convertido, sem aviso (fora da pasta do PcbDoc, para a busca
        # automatica nao o achar nas rodadas de cima)
        os.makedirs(os.path.join(d, 'prj'))
        prj = os.path.join(d, 'prj', 'placa.PrjPcb')
        with open(prj, 'w', encoding='utf-8', newline='\r\n') as f:
            f.write('[Design]\nVersion=1.0\n[Document1]\nDocumentPath=..\\placa.PcbDoc\n'
                    '[Parameter1]\nName=Revisao\nValue=REV. B\n')
        r = roda2('--prjpcb', prj)
        assert r.returncode == 0 and 'string especial' not in r.stdout, r.stdout
        with open(livre, encoding='ascii') as f:
            assert '"text":"REV. B"' in f.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print('  CLI ok (grava, recusa sem --forcar, .bak com --forcar, erro claro, string especial sem valor avisa)')


def test_contorno_truetype():
    """o contorno do glifo pela fonte do Windows: 'O' = 1 contorno escuro + 1 furo"""
    try:
        import fontTools  # noqa: F401
    except ImportError:
        print('  contorno TrueType PULADO (sem fontTools)')
        return
    arial = L.acha_fonte('Arial')
    if not arial:
        print('  contorno TrueType PULADO (sem a Arial)')
        return
    cs, xmin = L.contornos_glifos(arial, 'O8', 20)
    furos = [f for f, _ in cs]
    assert furos.count(True) == 3 and furos.count(False) == 2, furos     # O: 1 furo; 8: 2 furos
    assert xmin > 0 and all(len(p) > 8 for _, p in cs)
    print('  contorno TrueType ok (%s)' % os.path.basename(arial))


def test_motor_do_hub(texto_js=None):
    """o board.js sintetico abre no motor do hub: HubCore.applyPcbChanges(board, []) sem erro"""
    if texto_js is None:
        texto_js = test_pcbdoc_inteiro()      # pelo pytest, sem argumento: monta o sintetico de novo
    node = shutil.which('node')
    if not node or texto_js is None:
        print('  motor do hub PULADO (sem node)')
        return
    d = tempfile.mkdtemp(prefix='pcbdoc-')
    try:
        bj = os.path.join(d, 'board.js')
        with open(bj, 'w', encoding='ascii', newline='\n') as f:
            f.write(texto_js)
        script = os.path.join(d, 'abre.cjs')
        with open(script, 'w', encoding='utf-8') as f:
            f.write("const fs=require('fs'),vm=require('vm');const H=require(%s);\n"
                    "const ctx={};vm.runInNewContext(fs.readFileSync(%s,'utf8')+';this.b=pcbmirror;',ctx);\n"
                    "const m=H.applyPcbChanges(ctx.b,[]);const eb=H.effectiveBoard(ctx.b,m);\n"
                    "console.log(JSON.stringify({erros:m.validation.filter(v=>v.level==='err').length,"
                    "tracks:m.tracks.length,vias:m.vias.length,texts:m.texts.length,ebTracks:eb.tracks.length,"
                    "camadas:H.boardLayers(ctx.b).length}));\n" % (json.dumps(os.path.join(RAIZ, 'hub-core.js')), json.dumps(bj)))
        r = subprocess.run([node, script], capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, r.stderr[-800:]
        res = json.loads(r.stdout.strip().splitlines()[-1])
        assert res['erros'] == 0 and res['vias'] == 1 and res['texts'] == 3, res
        print('  motor do hub ok %s' % res)
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ─── (d) o DMB real (pula sem a rede) ─────────────────────────────────────────
def _dmb(nome):
    for pasta in DMB_PASTA:
        for c in (os.path.join(pasta, 'History', 'PDMB - DI231765_P2.~(%s).PcbDoc.Zip' % nome),
                  os.path.join(pasta, nome)):
            if os.path.exists(c):
                return c
    return None


def _carrega(caminho):
    s = open(caminho, encoding='utf-8').read()
    return json.loads(s[s.index('{'):s.rindex('}') + 1])


def _igual(a, b, tol=1e-9):
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= tol
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_igual(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return all(k in a and _igual(a[k], b[k], tol) for k in b)      # campos novos nao contam
    return a == b


def test_dmb_real():
    v91 = _dmb('91')
    if not v91 or not os.path.exists(DMB_BOARD):
        print('  DMB real PULADO (rede fora do ar)')
        return
    par, prj = L.parametros_do_projeto(v91)
    B, avisos = L.le_pcbdoc(v91, parametros=par)
    texto_js = L.board_js(B)
    meu = json.loads(texto_js[texto_js.index('{'):texto_js.rindex('}') + 1])
    ref = _carrega(DMB_BOARD)
    assert meu['nets'] == ref['nets']
    assert _igual(meu['board'], ref['board'])
    linha = []
    for lista in ('components', 'freepads', 'tracks', 'arcs', 'vias', 'silk', 'regions', 'cutouts'):
        a, b = meu[lista], ref[lista]
        assert len(a) == len(b), (lista, len(a), len(b))
        dif = [y['id'] for x, y in zip(a, b) if not _igual(x, y)]
        assert not dif, (lista, dif[:5])
        linha.append('%s %d' % (lista, len(b)))
    # textos: os 64 do ExportBoard vem primeiro (os 2 da Mech6 depois, na 2a passada); o centro
    # sai igual, salvo os 30 TrueType de footprint (retangulo vencido): ate 0,00001 mm
    t_meu, t_ref = meu['texts'][:len(ref['texts'])], ref['texts']
    assert len(meu['texts']) == len(t_ref) + 2 and all(t['layer'] == 'Mech6' for t in meu['texts'][len(t_ref):])
    exatos, pior = 0, 0.0
    for x, y in zip(t_meu, t_ref):
        assert all(_igual(x[k], y[k]) for k in y if k not in ('x', 'y')), (y['id'], x, y)
        e = math.hypot(x['x'] - y['x'], x['y'] - y['y'])
        pior = max(pior, e)
        exatos += e < 1e-9
    assert pior <= 1.5e-5, pior
    pads = sum(len(c['pads']) for c in meu['components'])
    print('  DMB v91 x board.js: %s, pads %d, nets %d -- iguais; textos %d/%d exatos, pior centro %.6f mm'
          % (', '.join(linha), pads, len(meu['nets']), exatos, len(t_ref), pior))
    # v94 = o estado do Gerber X2 de 22/09 09:21
    v94 = _dmb('94')
    if v94:
        tt = None
        try:
            import fontTools  # noqa: F401
            tt = L.contornos_truetype if L.acha_fonte('Arial Rounded MT Bold') else None
        except ImportError:
            pass
        B, _ = L.le_pcbdoc(v94, contornos=tt)
        n = {'top': sum(t['layer'] == 'Top' for t in B['tracks']), 'bot': sum(t['layer'] == 'Bottom' for t in B['tracks'])}
        assert (n['top'], n['bot'], len(B['vias']), len(B['fills'])) == (207, 103, 33, 392), n
        assert B['board']['bbox']['y1'] == -8.1757 and sum(c['kindn'] == 3 for c in B['cutouts']) == 6
        extra = ''
        if tt:
            # os 30 rotulos TrueType da legenda: o X2 tem 139 regioes, 105 escuras + 34 furos
            ps = [p for t in B['texts'] if t['layer'] == 'TopOverlay' and t.get('polys') for p in t['polys']]
            assert (sum(not p['hole'] for p in ps), sum(p['hole'] for p in ps)) == (105, 34)
            extra = ', contorno TrueType 105 + 34 furos (= as 139 regioes do X2)'
        print('  DMB v94 x Gerber X2: trilhas 207/103, vias 33, fills 392, 6 recortes, contorno ate Y -8,1757' + extra)
    # o PcbDoc atual contra o painel Board Information do Altium
    atual = _dmb('PDMB - DI231765_P2.PcbDoc')
    if atual:
        B, _ = L.le_pcbdoc(atual)
        arcos = len(B['arcs']) + sum(s['kind'] == 'arc' for s in B['silk']) + sum(s['kind'] == 'arc' for s in B['lines'])
        trilhas = len(B['tracks']) + sum(s['kind'] == 'line' for s in B['silk']) + sum(s['kind'] == 'line' for s in B['lines'])
        strings = sum(not t['designator'] and not t['comment'] for t in B['texts'])
        pads = sum(len(c['pads']) for c in B['components']) + len(B['freepads'])
        got = (len(B['components']), arcos, len(B['fills']), pads, strings, trilhas, len(B['vias']))
        if got == (21, 19, 392, 139, 45, 3300, 33):
            print('  DMB atual x painel do Altium: 21 comp, 19 arcos, 392 fills, 139 pads, 45 strings, 3300 trilhas, 33 vias')
        else:
            print('  DMB atual mudou desde 29/09 (painel medido: 21/19/392/139/45/3300/33; agora %s)' % (got,))


def main():
    print('test_pcbdoc')
    test_numeros()
    test_nets_e_especiais()
    test_escopo()
    test_regras()
    test_registros()
    js = test_pcbdoc_inteiro()
    test_cli()
    test_contorno_truetype()
    test_motor_do_hub(js)
    test_dmb_real()
    print('test_pcbdoc OK')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
