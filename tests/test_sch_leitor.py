# -*- coding: utf-8 -*-
"""O leitor de símbolos, provado contra a biblioteca REAL e contra o schlib.js do ExportLibs.

    python tests/test_sch_leitor.py

(a) lê a SchLib do Y: e exige que >= 97 % dos símbolos saiam iguais ao Libs/schlib.js
    (pinos e gráficos, tolerância 0.01 mil); os que diferem são listados com o motivo.
(b) lê .SchDoc reais e prova a localização: um componente colocado, desfeitas posição,
    rotação e espelho, tem os mesmos pinos do espelho.
(c) lê um .IntLib real.
(d) o espelho() gera um texto que o Node lê igual ao que o Python tem na mão.

O que depende do Y: PULA (não falha) quando a rede não está.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))
import sch_leitor as L  # noqa: E402

LIB = L.LIB_PADRAO
DMB = r'Y:\EQUIPAMENTOS_REVISADOS\DMB - DI231765 - DISPLAY ASCII PARA MARCAÇÃO DE BOBINAS\PCB E SCH'
REV = r'Y:\EQUIPAMENTOS_REVISADOS'
# folha antiga (Altium 6): chaves em MAIÚSCULAS no binário — antes o leitor via 0 componentes
ANTIGO = r'Y:\EQUIPAMENTOS ATUALIZADOS\GERADORES DE PULSOS PDM\GP-DI92120-22C9E600HPF - UNIGAL\PROJETO PCB E SCH\Gerador De Pulsos 600\SCH Gerador 600.SchDoc'
# folha em formato ASCII (exportada do EasyEDA)
ASCII = r'Y:\EQUIPAMENTOS ATUALIZADOS\SMVT - DI221660 - SISTEMA DE MONITORAMENTO DE VIBRAÇÃO E TEMPERATURA\SMTV-DI221661\SCH e PCB\Sensor grande\VERSAO 1.0\REFS\Sheet_1_2022-05-27.schdoc'
TOL = 0.01
NUM = (int, float)


# ─── o espelho atual e o mapa de renomeação ───────────────────────────────────
def le_js(caminho):
    """Libs/schlib.js -> [(linha, símbolo)] na ordem do arquivo"""
    rx = re.compile(r'^,?(\{"name":.*\})\s*$')
    fora = []
    with open(caminho, encoding='utf-8') as f:
        for linha in f:
            m = rx.match(linha)
            if m:
                fora.append((m.group(1), json.loads(m.group(1))))
    return fora


def le_rename():
    """o schlib.js atual saiu do RenameLibs: nomes padronizados e uma fusão. A SchLib real
    ainda tem os nomes antigos, então o casamento passa pelo rename-map."""
    p = os.path.join(RAIZ, 'Libs', 'rename-map.js')
    if not os.path.exists(p):
        return {}, {}
    raw = open(p, encoding='utf-8').read()
    obj = json.loads(raw[raw.index('{'):raw.rindex('}') + 1])
    return obj.get('symRename') or {}, obj.get('mergeSym') or {}


def le_rename_fp():
    """footprints: renomeados E fundidos (o modelo do símbolo passa a apontar para o que ficou)"""
    p = os.path.join(RAIZ, 'Libs', 'rename-map.js')
    if not os.path.exists(p):
        return {}
    raw = open(p, encoding='utf-8').read()
    obj = json.loads(raw[raw.index('{'):raw.rindex('}') + 1])
    ren, fund = obj.get('fpRename') or {}, obj.get('mergeFp') or {}
    return {k: fund.get(v, v) for k, v in ren.items()} | {k: ren.get(v, v) for k, v in fund.items() if k not in ren}


# ─── comparação com tolerância ────────────────────────────────────────────────
def _perto(a, b):
    if isinstance(a, NUM) and isinstance(b, NUM) and not isinstance(a, bool) and not isinstance(b, bool):
        return abs(a - b) <= TOL
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_perto(x, y) for x, y in zip(a, b))
    return a == b


def _difere(a, b, campos):
    for k in campos:
        if not _perto(a.get(k), b.get(k)):
            return '%s %r != %r' % (k, a.get(k), b.get(k))
    return None


def compara_simbolo(meu, js):
    """-> lista de motivos (vazia = idêntico)"""
    motivos = []
    if meu['partcount'] != js.get('partcount'):
        motivos.append('partcount %s != %s' % (meu['partcount'], js.get('partcount')))
    for pm, pj in zip(meu['parts'], js.get('parts') or []):
        if len(pm['pins']) != len(pj['pins']):
            motivos.append('parte %d: %d pinos != %d' % (pm['part'], len(pm['pins']), len(pj['pins'])))
        else:
            for a, b in zip(pm['pins'], pj['pins']):
                d = _difere(a, b, ('num', 'name', 'x', 'y', 'len', 'orient', 'type'))
                if d:
                    motivos.append('parte %d pino %s: %s' % (pm['part'], a['num'], d))
                    break
        if len(pm['graphics']) != len(pj['graphics']):
            motivos.append('parte %d: %d graficos != %d (%s != %s)' % (
                pm['part'], len(pm['graphics']), len(pj['graphics']),
                [g['g'] for g in pm['graphics']][:8], [g['g'] for g in pj['graphics']][:8]))
        else:
            for i, (a, b) in enumerate(zip(pm['graphics'], pj['graphics'])):
                if a['g'] != b['g']:
                    motivos.append('parte %d grafico %d: %s != %s' % (pm['part'], i, a['g'], b['g']))
                    break
                d = _difere(a, b, sorted(set(a) | set(b)))
                if d:
                    motivos.append('parte %d %s %d: %s' % (pm['part'], a['g'], i, d))
                    break
    return motivos


# ─── (offline) localização e serialização ─────────────────────────────────────
def _coloca(x, y, rot, mirror, x0, y0):
    """como o Altium coloca: gira CCW, espelha X, soma a posição. (Não é a ordem do
    AI-GUIDE — a do arquivo real ganha; veja o cabeçalho do sch_leitor e o teste (b).)"""
    x, y = L._gira(x, y, rot)
    if mirror:
        x = -x
    return x + x0, y + y0


def _coloca_ang(a, rot, mirror):
    a = (a + rot) % 360
    return (180 - a) % 360 if mirror else a


def test_offline():
    pins = [dict(num='1', name='A', x=-100, y=50, len=100, orient=180, type='Passive'),
            dict(num='2', name='B', x=100, y=-50, len=100, orient=0, type='Passive')]
    gr = [dict(g='line', x1=-100, y1=50, x2=100, y2=50, w=10),
          dict(g='arc', cx=0, cy=0, r=50, sa=30, ea=120, w=10),
          dict(g='arc', cx=10, cy=20, r=50, sa=0, ea=360, w=10),
          dict(g='ellipse', cx=0, cy=0, rx=30, ry=10, solid=False),
          dict(g='label', x=5, y=5, text='t', rot=90, size=10),
          dict(g='poly', pts=[[0, 0], [10, 0], [0, 10]], solid=True)]
    for rot in (0, 90, 180, 270):
        for mirror in (False, True):
            aps = []
            for p in pins:
                q = dict(p)
                q['x'], q['y'] = _coloca(p['x'], p['y'], rot, mirror, 3000, 2000)
                q['orient'] = _coloca_ang(p['orient'], rot, mirror)
                aps.append(q)
            ags = []
            for g in gr:
                h = dict(g)
                if g['g'] == 'line':
                    h['x1'], h['y1'] = _coloca(g['x1'], g['y1'], rot, mirror, 3000, 2000)
                    h['x2'], h['y2'] = _coloca(g['x2'], g['y2'], rot, mirror, 3000, 2000)
                elif g['g'] in ('arc', 'ellipse'):
                    h['cx'], h['cy'] = _coloca(g['cx'], g['cy'], rot, mirror, 3000, 2000)
                    if g['g'] == 'ellipse' and rot in (90, 270):
                        h['rx'], h['ry'] = g['ry'], g['rx']
                    if g['g'] == 'arc' and g['ea'] - g['sa'] < 360:
                        sa, ea = (g['sa'] + rot) % 360, (g['ea'] + rot) % 360
                        if mirror:
                            sa, ea = (180 - ea) % 360, (180 - sa) % 360
                        h['sa'], h['ea'] = sa, ea
                elif g['g'] == 'label':
                    h['x'], h['y'] = _coloca(g['x'], g['y'], rot, mirror, 3000, 2000)
                    h['rot'] = _coloca_ang(g['rot'], rot, mirror)
                elif g['g'] == 'poly':
                    h['pts'] = [list(_coloca(x, y, rot, mirror, 3000, 2000)) for x, y in g['pts']]
                ags.append(h)
            lp, lg = L.localiza(aps, ags, 3000, 2000, rot, mirror)
            for a, b in zip(lp, pins):
                assert _difere(a, b, ('x', 'y', 'orient')) is None, (rot, mirror, a, b)
            for a, b in zip(lg, gr):
                if a['g'] == 'arc':
                    assert _perto(a['sa'] % 360, b['sa'] % 360) and _perto((a['ea'] - a['sa']) % 360, (b['ea'] - b['sa']) % 360), (rot, mirror, a, b)
                else:
                    assert _difere(a, b, sorted(set(a) | set(b))) is None, (rot, mirror, a, b)
    # serialização: o JS() e o FloatToStr do ExportLibs
    assert L._js('R\\S\\T\\') == '"R\\\\S\\\\T\\\\"'
    assert L._js('Relé "x"') == '"Rel\\u00E9 \\"x\\""'
    assert L._jf(100.0) == '100' and L._jf(175.591) == '175.591' and L._jf(-0.5) == '-0.5'
    assert L._jf(3594.3309) == '3594.3309'
    # coordenada com fração negativa (X1=-23, X1_Frac=-62206 -> -236.2206), nas 3 casas da API
    assert L.coord({'X1': '-23', 'X1_Frac': '-62206'}, 'X1') == -236.221
    assert L.coord({'Location.X': '359', 'Location.X_Frac': '43309'}, 'Location.X') == 3594.331
    assert L.coord({'Location.X': '-10'}, 'Location.X') == -100 and L.coord({}, 'Location.Y') == 0
    # o empate segue o double, como a API fez no schlib.js (390.5515 -> .551; -196.8505 -> -.851)
    assert L.coord({'X1': '39', 'X1_Frac': '5515'}, 'X1') == 390.551
    assert L.coord({'X1': '-19', 'X1_Frac': '-68505'}, 'X1') == -196.851
    # nome de pino: 0xAF vira a sobrelinha que a API do Altium devolve; barra fica barra
    p = L.pino_binario({'designador': b'7', 'nome': b'C\xafL\xafR\xaf/R\\S\\', 'x': 14, 'y': 6,
                        'comprimento': 1, 'conglomerado': 0x30, 'eletrico': 4}, (0, 0, 0))
    assert p['name'] == 'C̅L̅R̅/R\\S\\' and p['x'] == 140 and p['len'] == 10 and p['orient'] == 0
    # a forma canônica (para quem compara nomes) junta as duas grafias; o leitor não a aplica
    assert L.nome_canonico('R\\S\\T\\') == 'R̅S̅T̅' and L.nome_canonico('C\\S\\/LD') == 'C̅S̅/LD'
    assert L.nome_canonico(p['name']) == 'C̅L̅R̅/R̅S̅' and L.nome_canonico('GND') == 'GND'
    assert L.pino_texto({'RECORD': '2', 'Name': 'C\\L\\R\\', 'Designator': '1'})['name'] == 'C\\L\\R\\'
    # PinFrac esparso: fração no pino, comprimento também
    p = L.pino_binario({'designador': b'1', 'nome': b'A', 'x': 35, 'y': -35, 'comprimento': 7,
                        'conglomerado': 0x31, 'eletrico': 0}, (43307, -43309, 87402))
    assert p['x'] == 354.331 and p['y'] == -354.331 and p['len'] == 78.74 and p['orient'] == 90 and p['type'] == 'Input'
    # arco elíptico: quase círculo vira arc; elipse de verdade vira polyline amostrada
    g = L.primitiva({'RECORD': '11', 'Location.X': '-2', 'Radius': '10', 'SecondaryRadius': '10',
                     'SecondaryRadius_Frac': '20000', 'LineWidth': '1', 'StartAngle': '209.055', 'EndAngle': '150.945'}, {})
    assert g['g'] == 'arc' and g['r'] == 101 and g['cx'] == -20 and g['sa'] == 209.055
    g = L.primitiva({'RECORD': '11', 'Radius': '3', 'SecondaryRadius': '4', 'EndAngle': '90'}, {})
    assert g['g'] == 'polyline' and len(g['pts']) == 25 and g['pts'][0] == [30, 0] and g['pts'][-1] == [0, 40]
    assert L.primitiva({'RECORD': '11', 'Radius': '3', 'SecondaryRadius': '4'}, {}, extras=False) is None
    assert L.primitiva({'RECORD': '3', 'Symbol': '1'}, {}) is None
    g = L.primitiva({'RECORD': '4', 'Location.X': '37', 'Orientation': '1', 'FontID': '13', 'Text': 'GND'}, {13: 12})
    assert g == {'g': 'label', 'x': 370, 'y': 0, 'text': 'GND', 'rot': 90, 'size': 12}
    print('  offline: localiza/serializa OK')


# ─── (a) a SchLib real contra o schlib.js ─────────────────────────────────────
def _so_poly_solid(motivos):
    """o ExportLibs escrevia "solid":true FIXO para polígono; o leitor lê o IsSolid real.
    Diferença só nisso é o ExportLibs errado, não o leitor — conta como conhecida."""
    return all(re.match(r'parte \d+ poly \d+: solid False != True$', m) for m in motivos)


def test_schlib():
    nomes = L.nomes_pcblib()
    assert len(nomes) > 500, 'pcblib.js: %d footprints' % len(nomes)
    # extras=False: só as 7 formas do ExportLibs, que é o que o schlib.js atual tem
    dados = L.le_schlib(LIB, pcblib_names=nomes, extras=False)
    syms = dados['symbols']
    print('  (a) %d simbolos lidos, %d avisos' % (len(syms), len(dados['avisos'])))
    for av in dados['avisos'][:10]:
        print('      aviso:', av)
    assert len(syms) >= 400, 'poucos simbolos: %d' % len(syms)

    js = le_js(os.path.join(RAIZ, 'Libs', 'schlib.js'))
    por_nome = {s['name']: (linha, s) for linha, s in js}
    ren, fund = le_rename()
    ren_fp = le_rename_fp()
    baixos = {n.lower() for n in nomes}
    iguais, comparados, texto_igual, conhecidas = 0, 0, 0, []
    diferentes, linhas_dif = [], []
    for sym in syms:
        if sym['name'] in fund:
            continue                              # fundido pelo RenameLibs: saiu do espelho
        nome_js = ren.get(sym['name'], sym['name'])
        if nome_js not in por_nome:
            continue                              # entrou na lib depois do último ExportLibs
        linha, alvo = por_nome[nome_js]
        comparados += 1
        motivos = compara_simbolo(sym, alvo)
        if motivos and _so_poly_solid(motivos):
            conhecidas.append(sym['name'])
            iguais += 1
            continue
        if motivos:
            diferentes.append((sym['name'], motivos))
            continue
        iguais += 1
        # e a LINHA do espelho tem que sair igual, byte a byte, trocados só os nomes
        # (símbolo e footprints) que o RenameLibs padronizou
        copia = dict(sym)
        copia['name'] = nome_js
        copia['footprints'] = [dict(f, name=ren_fp.get(f['name'], f['name']),
                                    incurrentlib=ren_fp.get(f['name'], f['name']).lower() in baixos)
                               for f in sym['footprints']]
        if L.simbolo_json(copia) == linha:
            texto_igual += 1
        else:
            a, b = L.simbolo_json(copia), linha
            i = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
            linhas_dif.append('%s @%d: %r != %r' % (nome_js, i, a[max(0, i - 30):i + 40], b[max(0, i - 30):i + 40]))
    print('  (a) %d/%d simbolos identicos (%.1f %%); %d com a linha do schlib.js byte a byte' % (
        iguais, comparados, 100.0 * iguais / max(1, comparados), texto_igual))
    if conhecidas:
        print('      poligono sem IsSolid que o ExportLibs chamava de solid:true (lido como false): %s' % ', '.join(conhecidas))
    for nome, motivos in diferentes:
        print('      DIFERE %s: %s' % (nome, '; '.join(motivos)))
    for d in linhas_dif[:20]:
        print('      linha difere:', d)
    assert comparados >= 380, 'poucos simbolos casaram pelo nome: %d' % comparados
    assert iguais >= 0.97 * comparados, 'so %d de %d identicos' % (iguais, comparados)
    assert texto_igual >= 0.9 * iguais, 'so %d linhas byte a byte' % texto_igual

    # com extras, o que o ExportLibs ignorava (arco elíptico, bezier, round rect) aparece
    cheio = L.le_schlib(LIB, pcblib_names=nomes)
    n0 = sum(len(p['graphics']) for s in syms for p in s['parts'])
    n1 = sum(len(p['graphics']) for s in cheio['symbols'] for p in s['parts'])
    print('  (a) graficos: %d nas 7 formas do ExportLibs, %d com as conversoes extras' % (n0, n1))
    assert n1 > n0
    return cheio


# ─── (b) .SchDoc: localização contra o espelho ────────────────────────────────
def _chave(p):
    return (p['num'], round(p['x'], 2), round(p['y'], 2), p['orient'])


def _forma(p):
    """só posição e orientação: o número muda quando a lib renumerou (CAP 1/2 -> A/B)"""
    return (round(p['x'], 2), round(p['y'], 2), p['orient'])


MINIMO_GRUPO = 5          # grupos (rot, mirror) menores que isso só informam
TAXA_GRUPO = 0.9          # e os maiores têm que casar por forma em >= 90 %


def test_schdoc():
    """todas as folhas do DMB (~3 s): a prova tem que cobrir CADA (rot, mirror) que
    aparece — espelho e giro comutam em 0/180, então um bug na ordem só se vê em 90/270
    com IsMirrored=T (o DE - DI231764_3.SchDoc tem 104 desses)."""
    docs = []
    for dp, dn, fn in os.walk(DMB):
        for f in fn:
            if f.lower().endswith('.schdoc'):
                docs.append(os.path.join(dp, f))
    docs.sort()
    assert docs, 'nenhum .SchDoc em ' + DMB
    js = {s['name']: s for _, s in le_js(os.path.join(RAIZ, 'Libs', 'schlib.js'))}
    ren, _ = le_rename()
    exatos, candidatos, total = 0, [], 0
    grupos = {}                       # (rot, mirror) -> [comparados, iguais por forma]
    piores = {}                       # (rot, mirror) -> pior candidato, para o relatório
    for doc in docs:
        comps = L.le_schdoc(doc)
        assert comps, 'folha sem componentes: ' + doc
        for c in comps:
            total += 1
            assert c['pins'], '%s %s sem pinos' % (c['designator'], c['ref'])
            alvo = js.get(ren.get(c['ref'], c['ref']))
            if not alvo:
                continue
            parte = next((p for p in alvo['parts'] if p['part'] == c['part']), alvo['parts'][0])
            a = {_chave(p) for p in c['pins']}
            b = {_chave(p) for p in parte['pins']}
            score = len(a & b) / float(len(a | b) or 1)
            candidatos.append((score, c['designator'], c['ref'], c['rot'], c['mirror'], sorted(a - b)[:3], sorted(b - a)[:3]))
            if a == b:
                exatos += 1
            k = (c['rot'], c['mirror'])
            g = grupos.setdefault(k, [0, 0])
            g[0] += 1
            fa, fb = {_forma(p) for p in c['pins']}, {_forma(p) for p in parte['pins']}
            if fa == fb:
                g[1] += 1
            elif k not in piores:
                piores[k] = (c['designator'], c['ref'], os.path.basename(doc), sorted(fa - fb)[:3], sorted(fb - fa)[:3])
    print('  (b) %d folhas, %d componentes, %d com pinos iguais ao espelho (num incluso)' % (len(docs), total, exatos))
    if not exatos:
        for cand in sorted(candidatos, reverse=True)[:3]:
            print('      quase:', cand)
        raise AssertionError('nenhum componente casou com o espelho')
    ruins = []
    for k in sorted(grupos):
        n, ok = grupos[k]
        taxa = ok / float(n)
        print('      rot=%3d mirror=%-5s %5d comparados, %5d iguais por forma (%.1f %%)' % (k[0], k[1], n, ok, 100 * taxa))
        if k in piores:
            print('          ex.: %s %s em %s; so na folha %s; so no espelho %s' % piores[k])
        if n >= MINIMO_GRUPO and taxa < TAXA_GRUPO:
            ruins.append('rot=%d mirror=%s: %d/%d' % (k[0], k[1], ok, n))
    assert not ruins, 'grupos abaixo de %d %%: %s' % (100 * TAXA_GRUPO, '; '.join(ruins))
    # sem um grupo espelhado a 90/270 a prova é vazia: é o único caso em que a ordem importa
    girados = [k for k in grupos if k[1] and k[0] in (90, 270) and grupos[k][0] >= MINIMO_GRUPO]
    assert girados, 'nenhuma folha do DMB com IsMirrored=T + Orientation 1/3 (>= %d componentes)' % MINIMO_GRUPO


# ─── (c) .IntLib ──────────────────────────────────────────────────────────────
def test_formatos_antigos():
    """(e) folha antiga com chaves em maiúsculas e (f) folha ASCII: os dois têm que dar
    componentes com pinos, e o antigo tem que trazer o LibReference certo"""
    if os.path.isfile(ANTIGO):
        comps = L.le_schdoc(ANTIGO)
        com_pinos = [c for c in comps if c['pins']]
        print('  (e) %s: %d componentes, %d com pinos' % (os.path.basename(ANTIGO), len(comps), len(com_pinos)))
        assert len(com_pinos) >= 30, 'a folha antiga tem 41 componentes e 100 pinos'
        assert any(c['ref'] == 'Sensor HP' for c in comps), 'LIBREFERENCE em maiusculas nao virou LibReference'
        assert all(isinstance(p['x'], NUM) and p['len'] > 0 for c in comps for p in c['pins'])
    else:
        print('  (e) PULADO (nao alcancei %s)' % ANTIGO)
    if os.path.isfile(ASCII):
        comps = L.le_schdoc(ASCII)
        com_pinos = [c for c in comps if c['pins']]
        print('  (f) %s: %d componentes, %d com pinos' % (os.path.basename(ASCII), len(comps), len(com_pinos)))
        assert com_pinos, 'a folha ASCII tem componentes com pinos'
    else:
        print('  (f) PULADO (nao alcancei %s)' % ASCII)
    # canonização é identidade nos nomes de hoje e cobre os numerados
    d = L._canon({'LOCATION.X': '1', 'Location.Y': '2', 'X12_FRAC': '3', 'SIZE2': '9', 'FONTNAME2': 'Arial', 'Cor': 'x'})
    assert list(d.keys()) == ['Location.X', 'Location.Y', 'X12_Frac', 'Size2', 'FontName2', 'Cor'], list(d.keys())


def test_intlib():
    alvo = None
    for dp, dn, fn in os.walk(REV):
        for f in fn:
            if f.lower().endswith('.intlib'):
                alvo = os.path.join(dp, f)
                break
        if alvo:
            break
    assert alvo, 'nenhum .IntLib em ' + REV
    syms = L.le_intlib(alvo)
    com_pinos = [s for s in syms if any(p['pins'] for p in s['parts'])]
    print('  (c) %s: %d simbolos, %d com pinos' % (os.path.basename(alvo), len(syms), len(com_pinos)))
    assert com_pinos


# ─── (d) espelho(): o Node lê o que o Python escreveu ─────────────────────────
def test_espelho(dados):
    nomes = L.nomes_pcblib()
    texto = L.espelho(dados, nomes)
    assert texto.startswith('var schlib = {\r\n"format":"schlib-v2",\r\n')
    assert all(ord(c) < 128 for c in texto), 'o espelho e ASCII puro, como o do ExportLibs'
    tmp = tempfile.mkdtemp()
    js = os.path.join(tmp, 'schlib.js')
    with open(js, 'w', encoding='utf-8', newline='') as f:
        f.write(texto)
    prova = os.path.join(tmp, 'prova.js')
    with open(prova, 'w', encoding='utf-8') as f:
        f.write("const fs=require('fs');const src=fs.readFileSync(process.argv[2],'utf8');"
                "const o=new Function(src+';return schlib;')();"
                "fs.writeFileSync(process.argv[3], JSON.stringify(o));")
    saida = os.path.join(tmp, 'saida.json')
    subprocess.run(['node', prova, js, saida], check=True)
    obj = json.load(open(saida, encoding='utf-8'))
    ref = le_js(os.path.join(RAIZ, 'Libs', 'schlib.js'))
    assert list(obj.keys()) == ['format', 'generated', 'source', 'units', 'symbols', 'stats']
    assert obj['stats']['symbols'] == len(dados['symbols']) == len(obj['symbols'])
    assert list(obj['symbols'][0].keys()) == list(ref[0][1].keys())
    # o objeto que o Node leu e o que o Python tem sao o mesmo
    assert obj['symbols'] == json.loads(json.dumps(dados['symbols']))
    rel = L.relatorio(dados, nomes)
    assert rel.startswith('AltiumPCBMirror - relatorio das bibliotecas')
    assert ('(%d):' % obj['stats']['nofootprint']) in rel
    print('  (d) espelho: %d simbolos, %d sem footprint, Node le igual' % (
        obj['stats']['symbols'], obj['stats']['nofootprint']))


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # nomes com acento no console
    except AttributeError:
        pass
    test_offline()
    if not os.path.exists(LIB):
        print('test_sch_leitor PULADO (nao alcancei %s)' % LIB)
        return 0
    dados = test_schlib()
    test_espelho(dados)
    if os.path.isdir(DMB):
        test_schdoc()
    else:
        print('  (b) PULADO (nao alcancei %s)' % DMB)
    test_formatos_antigos()
    if os.path.isdir(REV):
        test_intlib()
    else:
        print('  (c) PULADO (nao alcancei %s)' % REV)
    print('test_sch_leitor OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
