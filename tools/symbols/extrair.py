# -*- coding: utf-8 -*-
"""Varre bibliotecas e projetos do Altium e junta os símbolos numa Biblioteca de símbolos.

    python tools/symbols/extrair.py [--config tools/symbols/config.json] [--saida Libs/symbols-lib.js]
                                    [--relatorio tools/symbols/relatorio.txt] [--so schlib|schdoc|intlib]
                                    [--limite N] [--fonte CAMINHO ...]

Lê `.SchLib`, `.SchDoc` e `.IntLib` com o `sch_leitor.py`, fica com a geometria (pinos e
gráficos) e a descrição do componente — nada de parâmetros ou footprint —, deduplica por
fingerprint e MESCLA no `Libs/symbols-lib.js` (formato `symlib-v1`): o que já existe ganha
`usos`/`fontes`/`aliases`, o que é novo entra com id sequencial. Nome e id de quem já estava
nunca mudam — quem renomeia ou apaga é o usuário, pelo hub.

Quatro decisões que valem a pena conhecer:

  fingerprint   sha1 do JSON canônico da geometria arredondada a 1 mil (ângulos a 0,01°),
                pinos ordenados por posição e gráficos em ordem canônica. NÃO recentra: a
                origem do Altium é a âncora do símbolo e faz parte da identidade. Símbolo
                `generico` compara só (x, y, len, orient) dos pinos — `RES [ SMD ]` e
                `RES [ PTH ]` viram uma entrada; `ci` compara também (num, name).
                O mesmo desenho pode chegar escrito de vários jeitos (retângulo pelos cantos
                opostos, linha de trás para frente, arco que cruza 0°, polígono começando
                noutro vértice) — `_grafico` põe cada forma numa escrita só, senão a cópia
                colocada numa folha (que o `localiza` devolve espelhada) nunca deduplica.
                Cor (`color`/`fill`) NÃO é identidade: o mesmo corpo em azul e em vermelho
                é um símbolo só. Os campos seguem no símbolo guardado (é o desenho que o
                usuário vai aplicar), só ficam fora da chave e da ordem canônica.
  kind          `generico` quando tem até 4 pinos, `ci` acima disso. É a regra mais simples
                que separa o que se troca de corpo (resistor, diodo, transistor…) do que se
                nomeia pelo CI; os poucos blocos de 4 pinos (DC/DC, ponte) ficam genéricos e
                a origem fica em `aliases` para o usuário renomear.
  nome básico   heurística POR FORMA (veja `_reconhece`): cada regra está documentada onde
                mora. Quando nenhuma casa, o nome é o de origem limpo de "[ SMD ]"/"PTH".
                Multi-part não reconhecido e todo `ci` recebem " · parte N/M".
  descrição     o `ComponentDescription` do Altium, escolhida entre as concorrentes: como a
                dedup é por FORMA, um mesmo fingerprint recebe a descrição de dezenas de
                origens (o campeão medido tem 20: 'Resistor Metal Filme' 337 vezes,
                'Resistor Metal Filme 1% SMD 1206' 95, '...0805' 23, 'Resistor PR01' 10).
                A preferência da SchLib da casa vale enquanto a candidata dela não estiver
                esmagada pela frequência (`PISO_CASA`); senão a mais frequente, o empate vai
                para a mais longa (diz mais) e o empate que sobra para a ordem alfabética,
                senão duas rodadas iguais dariam arquivos diferentes. Vazia e o placeholder
                "AJUDA" (16 símbolos da casa) não concorrem.
                A escolha é REFEITA a cada varredura que enxerga tudo o que já tinha dado
                descrição ao símbolo (veja `_cobre`): sem isso, mudar a regra não conserta
                rótulo nenhum — o que está no arquivo fica congelado para sempre. Uma rodada
                com `--fonte` num projeto só não cobre as fontes antigas e, por isso, não
                rebaixa o que a varredura inteira escolheu.
  olho do pino  `hideNum`/`hideName` NÃO são complemento: no schlib-v2 a chave ausente é um
                valor e quer dizer VISÍVEL. Então o olho é copiado inteiro das cópias recém
                lidas — põe e TIRA —, pela assinatura mais frequente do lote e só quando os
                pinos casam um a um sem ambiguidade (`_assinatura_olho`); sob a mesma trava
                de cobertura da descrição, que é o que protege o símbolo desenhado no hub
                (fonte 'hub', que varredura nenhuma cobre) e a rodada parcial.

O log de progresso vai para stdout linha a linha, com flush — o hubserver retransmite por SSE.
"""
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter, OrderedDict
from datetime import date, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
LIBS = os.path.join(RAIZ, 'Libs')
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, BASE)

import sch_leitor as L                                  # noqa: E402

CONFIG_PADRAO = os.path.join(BASE, 'config.json')
SAIDA_PADRAO = os.path.join(LIBS, 'symbols-lib.js')
RELATORIO_PADRAO = os.path.join(BASE, 'relatorio.txt')
MOSTRA_CANDIDATAS = 5           # descrições concorrentes por símbolo no relatório
EXT = {'.schlib': 'schlib', '.schdoc': 'schdoc', '.intlib': 'intlib'}
PARTE = ' · parte %d/%d'
CHAVES = ('id', 'name', 'kind', 'fp', 'aliases', 'fontes', 'usos', 'desde', 'pins', 'graphics')
# a descrição é o único campo que nem todo símbolo tem: quem desenha um corpo no editor do
# hub não tem nenhuma para dar (o `/api/symbols/lib` monta as CHAVES e para aí), e quem vem
# de um arquivo do Altium quase sempre tem. Ela sai na linha logo depois do nome, e `_linha`
# grava a chave sempre — vazia quando não há — para o arquivo não ter linha de dois feitios.
CHAVES_ARQ = CHAVES[:2] + ('desc',) + CHAVES[2:]
CORES = ('color', 'fill')
LIXO_DESC = ('AJUDA',)          # 16 símbolos da casa trazem isso no campo; é chamada de ajuda
RUIM = '\ufffd'                  # o caractere de substituição; veja `_sem_dano`
# O piso da preferência da casa. O fingerprint é GRÁFICO: resistor, fusível e PTC são o mesmo
# retângulo e caem no mesmo símbolo. A SchLib da casa descreve a FORMA — ela chama aquele
# retângulo de "FUSÍVEL" —, o uso descreve a PEÇA — os projetos chamam o mesmo retângulo de
# "Resistor Metal Filme", 2668 vezes. Dar a palavra final à casa trocou dezenas de rótulos
# visíveis pela descrição de outro componente. Com o piso, a preferência da casa só vale
# quando o que a CASA disse tem pelo menos esta fração da contagem da mais frequente.
#
# O que entra na conta é a contagem da casa (`casa[d]`), não o total daquela frase no
# acervo: a descrição viaja com o componente colocado na folha, então cada projeto que usa
# o símbolo da casa repete a frase da casa. Somar essas cópias seria contar a mesma
# autoridade várias vezes — medido no capacitor, 74 ocorrências da frase da casa e 72 delas
# são cópias dela mesma, contra 356 de "Capacitor Cerâmico" escrito pelos projetos.
PISO_CASA = 0.10


def _log(msg):
    print(msg, flush=True)


# ─── normalização e fingerprint ───────────────────────────────────────────────
def _i(v):
    """coordenada -> inteiro em mil (o hub trabalha em grade; a fração é ruído de conversão)"""
    try:
        return int(round(float(v)))
    except (TypeError, ValueError, OverflowError):     # inf/nan: lixo de arquivo, não é coordenada
        return 0


def _a(v):
    """ângulo em graus, 2 casas; 360.0 vira 360"""
    try:
        r = round(float(v), 2)
    except (TypeError, ValueError, OverflowError):
        return 0
    if not math.isfinite(r):
        return 0
    return int(r) if r.is_integer() else r


def _pts_i(g):
    fora = []
    for p in g.get('pts') or []:
        try:
            x, y = p[0], p[1]
        except (TypeError, IndexError, KeyError):
            continue
        fora.append((_i(x), _i(y)))
    return fora


def _ciclo(pts, fechado):
    """a escrita canônica de uma sequência de pontos: a menor entre ela e a invertida (uma
    polilinha não tem sentido) e, se é um polígono, entre todas as rotações (não tem começo).
    Polígono com o fecho explícito (último = primeiro) perde o ponto repetido."""
    pts = list(pts)
    if fechado and len(pts) > 3 and pts[0] == pts[-1]:
        pts.pop()
    if not pts:
        return []
    cands = [pts, pts[::-1]]
    if fechado:
        n = len(pts)
        cands = [c[k:] + c[:k] for c in cands for k in range(n)]
    return [list(p) for p in min(cands)]


def _pino(p):
    q = OrderedDict([('num', str(p.get('num', ''))), ('name', str(p.get('name', ''))),
                     ('x', _i(p.get('x'))), ('y', _i(p.get('y'))), ('len', _i(p.get('len'))),
                     ('orient', _i(p.get('orient')) % 360), ('type', str(p.get('type', 'Passive')))])
    # hideNum/hideName ("o olho" do pino) seguem no símbolo guardado — é desenho, o usuário
    # vê a diferença — mas não são identidade: `fingerprint` monta a chave campo a campo e
    # nunca os lê. Só quando escondido, como o leitor os emite: ausente = visível.
    for k in ('hideNum', 'hideName'):
        if p.get(k):
            q[k] = True
    return q


def _desc(s):
    """a descrição como ela vale para a escolha: corridas de espaço viram uma só (o campo
    guarda o que o usuário digitou, e uma delas traz cinco descrições coladas com cem espaços
    no meio). Vazia, ou o placeholder "AJUDA", não concorre."""
    d = ' '.join(str(s or '').split())
    return '' if d.upper() in LIXO_DESC else d


def _sem_dano(cands):
    """-> `cands` com a candidata danificada somada à gêmea limpa, quando existe uma só.

    O Altium grava o campo duas vezes no registro (`%UTF8%` e latin-1) e em alguns arquivos
    a cópia UTF-8 já chega com U+FFFD no lugar da letra acentuada — o byte morreu antes de
    o arquivo ser gravado, veja a nota "U+FFFD" no `sch_leitor`. Isso não é outra descrição:
    é a MESMA frase com um buraco. Contada à parte, a grafia estragada ganhava da inteira na
    frequência — medido, "Resistor Vari<?>vel NTC" 10 contra "Resistor Variável NTC" 4, e
    o rótulo saindo ilegível na tela. Somadas, a inteira ganha com 14.

    Sem gêmea, ou com mais de uma, a danificada continua candidata como está: o arquivo diz
    aquilo, e adivinhar a letra seria inventar dado."""
    todas = Counter()
    for c in cands:
        todas.update(c)
    danificadas = [d for d in todas if RUIM in d]
    if not danificadas:
        return cands
    limpas = [d for d in todas if RUIM not in d]
    mapa = {}
    for d in danificadas:
        gemeas = [c for c in limpas if len(c) == len(d) and all(x == RUIM or x == y for x, y in zip(d, c))]
        if len(gemeas) == 1:
            mapa[d] = gemeas[0]
    if not mapa:
        return cands
    fora = []
    for c in cands:
        nova = Counter()
        for d, n in c.items():
            nova[mapa.get(d, d)] += n
        fora.append(nova)
    return tuple(fora)


def _escolhe_desc(cands):
    """-> (escolhida, [(descrição, quantas vezes)...] para o relatório). `cands` é
    [Counter da lib preferida, Counter do resto].

    (i) a candidata da casa ganha, mas só enquanto o que a casa disse não estiver esmagado
    pela frequência — `PISO_CASA` da contagem da mais frequente, e o comentário da constante
    diz por que a conta é com `casa[d]` e não com o total;
    (ii) senão a mais FREQUENTE; (iii) empate, a mais LONGA; (iv) empate, a alfabética."""
    cands = _sem_dano(cands)
    todas = Counter()
    for c in cands:
        todas.update(c)
    if not todas:
        return '', []
    ordem = lambda d: (-todas[d], -len(d), d)          # a mesma dos dois lados e do relatório
    campea = min(todas, key=ordem)
    casa = cands[0] if cands else None
    escolhida = campea
    if casa:
        # a candidata da casa: a que a casa mais repete; empate, a que o acervo mais apoia
        preferida = min(casa, key=lambda d: (-casa[d],) + ordem(d))
        if casa[preferida] >= PISO_CASA * todas[campea]:
            escolhida = preferida
    return escolhida, sorted(todas.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))


def _pos(q):
    """a posição de um pino: é ela que amarra o olho ao pino certo"""
    return (q.get('x'), q.get('y'), q.get('len'), q.get('orient'))


def _assinatura_olho(vistos):
    """o olho de uma cópia recém-lida, amarrado à posição de cada pino:
    ((x,y,len,orient), hideNum, hideName) por pino, na ordem canônica de `normaliza`.

    -> None quando dois pinos dividem a mesma posição. Aí a correspondência é AMBÍGUA e o
    olho não pode ser aplicado: para `kind='generico'` o fingerprint nem olha num/name
    (veja `fingerprint`), então dois pinos empilhados sairiam com os flags trocados — o
    número some de um pino e aparece no outro. Recusar é mais seguro que adivinhar."""
    chaves = [_pos(q) for q in vistos]
    if len(set(chaves)) != len(chaves):
        return None
    return tuple((k, bool(q.get('hideNum')), bool(q.get('hideName'))) for k, q in zip(chaves, vistos))


def _aplica_olho(guardados, assinatura):
    """copia o olho INTEIRO da assinatura para os pinos guardados -> aplicou?

    No schlib-v2 a chave ausente não é "sem opinião": é um valor, e quer dizer VISÍVEL (o
    leitor só emite flag onde o pino está escondido, e o `hub-symed` desenha assim). Por
    isso aqui se põe E se tira: completar só o que falta fazia o símbolo acumular flags de
    qualquer origem que escondesse, e o número de um pino deixado de propósito à vista
    sumia da tela na varredura seguinte. Recusa (devolve False) se a correspondência por
    posição não for exata e sem ambiguidade."""
    chaves = [_pos(q) for q in guardados]
    if len(chaves) != len(assinatura) or len(set(chaves)) != len(chaves):
        return False
    if any(k != a[0] for k, a in zip(chaves, assinatura)):
        return False
    for q, (_k, num, nome) in zip(guardados, assinatura):
        q.pop('hideNum', None)              # sai e volta para a ordem das chaves ser sempre
        q.pop('hideName', None)             # a mesma: o arquivo tem que sair byte a byte igual
        if num:
            q['hideNum'] = True
        if nome:
            q['hideName'] = True
    return True


def _cores(g):
    """`color`/`fill` válidos ('#rrggbb' minúsculo, o que o leitor emite), na ordem"""
    return [(k, g[k]) for k in CORES if isinstance(g.get(k), str) and L.RX_COR.match(g[k])]


def _identidade(h):
    """o gráfico sem as cores: o que ordena e o que entra no fingerprint"""
    return OrderedDict((k, v) for k, v in h.items() if k not in CORES)


def _grafico(g):
    """a escrita canônica da forma, com as cores (se válidas) no fim"""
    h = _forma(g)
    if h is not None:
        h.update(_cores(g))
    return h


def _forma(g):
    k = g.get('g')
    if k == 'line':
        # uma linha não tem sentido: os extremos saem em ordem
        a, b = sorted([(_i(g.get('x1')), _i(g.get('y1'))), (_i(g.get('x2')), _i(g.get('y2')))])
        return OrderedDict([('g', k), ('x1', a[0]), ('y1', a[1]), ('x2', b[0]), ('y2', b[1]),
                            ('w', _i(g.get('w', 4)))])
    if k == 'rect':
        # canto inferior-esquerdo e superior-direito: o `localiza` de um componente espelhado
        # devolve os cantos trocados. `w` fica de fora: o leitor nunca o emite e o hub sempre —
        # entrasse na identidade, o corpo salvo pelo hub nunca casaria com o extraído.
        x1, y1, x2, y2 = _i(g.get('x1')), _i(g.get('y1')), _i(g.get('x2')), _i(g.get('y2'))
        return OrderedDict([('g', k), ('x1', min(x1, x2)), ('y1', min(y1, y2)), ('x2', max(x1, x2)),
                            ('y2', max(y1, y2)), ('solid', bool(g.get('solid')))])
    if k == 'arc':
        # sa em [0, 360) e ea = sa + vão: 270→90 e 270→450 são o mesmo arco (o `localiza`
        # devolve ea acima de 360 quando o arco cruza 0°); vão 0 é círculo, escrito 0→360
        sa, ea = _a(g.get('sa')), _a(g.get('ea', 360))
        vao = _a((ea - sa) % 360)
        if vao == 0 or vao >= 360:
            sa, vao = 0, 360
        sa = _a(sa % 360)
        if sa >= 360:
            sa = 0
        return OrderedDict([('g', k), ('cx', _i(g.get('cx'))), ('cy', _i(g.get('cy'))), ('r', _i(g.get('r'))),
                            ('sa', sa), ('ea', _a(sa + vao)), ('w', _i(g.get('w', 4)))])
    if k == 'ellipse':
        return OrderedDict([('g', k), ('cx', _i(g.get('cx'))), ('cy', _i(g.get('cy'))),
                            ('rx', _i(g.get('rx'))), ('ry', _i(g.get('ry'))), ('solid', bool(g.get('solid')))])
    if k == 'poly':
        return OrderedDict([('g', k), ('pts', _ciclo(_pts_i(g), True)), ('solid', bool(g.get('solid')))])
    if k == 'polyline':
        return OrderedDict([('g', k), ('pts', _ciclo(_pts_i(g), False)), ('w', _i(g.get('w', 4)))])
    if k == 'label':
        return OrderedDict([('g', k), ('x', _i(g.get('x'))), ('y', _i(g.get('y'))),
                            ('text', str(g.get('text', ''))), ('rot', _i(g.get('rot', 0)) % 360),
                            ('size', _i(g.get('size', 10)))])
    return None


def _canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def normaliza(pins, graphics):
    """(pins, graphics) do schlib-v2 -> cópia arredondada a 1 mil / 0,01°, pinos por (x, y),
    gráficos em ordem canônica. Não recentra: a origem do Altium é a âncora e importa."""
    npins = sorted((_pino(p) for p in pins or []),
                   key=lambda p: (p['x'], p['y'], p['len'], p['orient'], p['num'], p['name']))
    ngr = [h for h in (_grafico(g) for g in graphics or []) if h is not None]
    ngr.sort(key=lambda h: _canon(_identidade(h)))       # a cor não muda a ordem
    return npins, ngr


def fingerprint(pins, graphics, kind):
    """chave da deduplicação: sha1[:16] do JSON canônico, sem as cores. Aceita geometria
    crua (normaliza antes)."""
    npins, ngr = normaliza(pins, graphics)
    if kind == 'ci':
        chave = [[p['x'], p['y'], p['len'], p['orient'], p['num'], p['name']] for p in npins]
    else:
        chave = [[p['x'], p['y'], p['len'], p['orient']] for p in npins]
    ngr = [_identidade(h) for h in ngr]
    return hashlib.sha1(_canon({'k': kind, 'p': chave, 'g': ngr}).encode('utf-8')).hexdigest()[:16]


# ─── geometria auxiliar da classificação ──────────────────────────────────────
def _len(s):
    return math.hypot(s[2] - s[0], s[3] - s[1])


def _h(s, tol=2):
    return abs(s[3] - s[1]) <= tol and abs(s[2] - s[0]) > tol


def _v(s, tol=2):
    return abs(s[2] - s[0]) <= tol and abs(s[3] - s[1]) > tol


def _diag(s):
    return abs(s[2] - s[0]) > 4 and abs(s[3] - s[1]) > 4


def _dist_seg(px, py, s):
    """distância de um ponto a um segmento"""
    x1, y1, x2, y2 = s
    dx, dy = x2 - x1, y2 - y1
    q = dx * dx + dy * dy
    if q == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / q))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def _dist_reta(px, py, s):
    """distância de um ponto à RETA que contém o segmento"""
    x1, y1, x2, y2 = s
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy)
    if n == 0:
        return math.hypot(px - x1, py - y1)
    return abs((px - x1) * dy - (py - y1) * dx) / n


def _toca(s, t, tol=8):
    """um extremo de `s` encosta em `t`"""
    return _dist_seg(s[0], s[1], t) <= tol or _dist_seg(s[2], s[3], t) <= tol


def _paralelo(s, t):
    return (_h(s) and _h(t)) or (_v(s) and _v(t))


def _limpa_pts(pts):
    """tira pontos repetidos, o fecho e os colineares (o Altium fecha polígono repetindo
    vértice e às vezes deixa um ponto sobre a aresta)"""
    fora = []
    for x, y in pts:
        if not fora or abs(fora[-1][0] - x) > 1 or abs(fora[-1][1] - y) > 1:
            fora.append((x, y))
    if len(fora) > 2 and abs(fora[0][0] - fora[-1][0]) <= 1 and abs(fora[0][1] - fora[-1][1]) <= 1:
        fora.pop()
    if len(fora) > 3:
        n = len(fora)
        fora = [p for i, p in enumerate(fora)
                if _dist_seg(p[0], p[1], fora[(i - 1) % n] + fora[(i + 1) % n]) > 3]
    return fora


def _eixo(pins):
    """'h' se os pinos entram pelos lados, 'v' se por cima/baixo — o desenho dos 2 e 3 pinos
    é analisado num quadro em que o eixo dos pinos é horizontal"""
    h = sum(1 for p in pins if p['orient'] in (0, 180))
    v = sum(1 for p in pins if p['orient'] in (90, 270))
    if h != v:
        return 'h' if h > v else 'v'
    if len(pins) >= 2:
        dx = abs(pins[0]['x'] - pins[-1]['x'])
        dy = abs(pins[0]['y'] - pins[-1]['y'])
        return 'h' if dx >= dy else 'v'
    return 'h'


class _Formas(object):
    """os gráficos de um símbolo decompostos no que as regras enxergam, já no quadro em que o
    eixo dos pinos é horizontal (eixo 'v' gira tudo -90°)"""

    def __init__(self, pins, graphics):
        self.eixo = _eixo(pins)
        T = (lambda x, y: (x, y)) if self.eixo == 'h' else (lambda x, y: (y, -x))
        self.pins = []
        for p in pins:
            x, y = T(p['x'], p['y'])
            o = p['orient'] if self.eixo == 'h' else (p['orient'] - 90) % 360
            self.pins.append(dict(p, x=x, y=y, orient=o))
        self.y0 = sum(p['y'] for p in self.pins) / float(len(self.pins)) if self.pins else 0
        self.segs, self.tris, self.setas = [], [], []      # seta = polilinha em V (3 pontos)
        self.polilinhas = []                                 # as polilinhas inteiras (zigue-zague)
        self.rects, self.arcos, self.circulos, self.elipses = [], [], [], []
        for g in graphics:
            k = g['g']
            if k == 'line':
                self._seg(T(g['x1'], g['y1']) + T(g['x2'], g['y2']))
            elif k == 'rect':
                (x1, y1), (x2, y2) = T(g['x1'], g['y1']), T(g['x2'], g['y2'])
                self.rects.append((min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2), bool(g['solid'])))
            elif k == 'arc':
                vao = (g['ea'] - g['sa']) % 360 or 360
                cx, cy = T(g['cx'], g['cy'])
                (self.circulos if vao >= 359 else self.arcos).append((cx, cy, g['r'], vao))
            elif k == 'ellipse':
                cx, cy = T(g['cx'], g['cy'])
                self.elipses.append((cx, cy, g['rx'], g['ry']))
            elif k in ('poly', 'polyline'):
                pts = _limpa_pts([T(x, y) for x, y in g['pts']])
                if len(pts) == 3 and (k == 'poly' or self._fecha(g['pts'], T)):
                    self.tris.append(pts)
                    continue
                if k == 'polyline' and len(pts) == 3 and self._em_v(pts):
                    self.setas.append(pts)
                if k == 'polyline':
                    self.polilinhas.append(pts)
                if k == 'poly' and len(pts) >= 3:
                    pts = pts + [pts[0]]
                for i in range(len(pts) - 1):
                    self._seg(pts[i] + pts[i + 1])
        self._caixas()
        self.placas = [s for s in self.segs if _v(s) and _len(s) >= 60]        # perpendiculares ao eixo
        self.diagonais = [s for s in self.segs if _diag(s)]

    @staticmethod
    def _fecha(pts, T):
        a, b = T(*pts[0]), T(*pts[-1])
        return abs(a[0] - b[0]) <= 1 and abs(a[1] - b[1]) <= 1

    @staticmethod
    def _em_v(pts):
        a, b = _len(pts[0] + pts[1]), _len(pts[1] + pts[2])
        if not a or not b or min(a, b) / max(a, b) < 0.7:
            return False
        ux, uy = (pts[0][0] - pts[1][0]) / a, (pts[0][1] - pts[1][1]) / a
        vx, vy = (pts[2][0] - pts[1][0]) / b, (pts[2][1] - pts[1][1]) / b
        return ux * vx + uy * vy > -0.35          # ângulo interno < ~110°

    def _seg(self, s):
        if _len(s) > 1:
            self.segs.append(tuple(s))

    def _caixas(self):
        """4 segmentos formando um retângulo viram uma caixa (o fusível, a bobina do relé e o
        cristal são desenhados a linhas, não com RECORD 14)"""
        hs = [s for s in self.segs if _h(s)]
        vs = [s for s in self.segs if _v(s)]
        usados = set()
        for i, a in enumerate(hs):
            for b in hs[i + 1:]:
                ax1, ax2 = sorted((a[0], a[2]))
                bx1, bx2 = sorted((b[0], b[2]))
                if abs(ax1 - bx1) > 3 or abs(ax2 - bx2) > 3 or abs(a[1] - b[1]) < 15:
                    continue
                y1, y2 = sorted((a[1], b[1]))
                lados = [s for s in vs if abs(min(s[1], s[3]) - y1) <= 3 and abs(max(s[1], s[3]) - y2) <= 3
                         and (abs(s[0] - ax1) <= 3 or abs(s[0] - ax2) <= 3)]
                if len({round(s[0]) for s in lados}) >= 2:
                    self.rects.append((ax1, y1, ax2, y2, False))
                    usados.update([a, b] + lados)
        if usados:
            self.segs = [s for s in self.segs if s not in usados]

    # ── consultas ──
    def caixa_no_eixo(self):
        """uma caixa só, deitada no eixo dos pinos e atravessada por ele"""
        if len(self.rects) != 1:
            return None
        x1, y1, x2, y2, _ = self.rects[0]
        if (x2 - x1) >= 1.3 * (y2 - y1) and y1 - 5 <= self.y0 <= y2 + 5:
            return self.rects[0]
        return None

    def diodos(self):
        """triângulos com base alinhada a um eixo E uma barra no ápice -> [(tri, barra, dir)]
        dir = (dx, dy) unitário da base para o ápice"""
        fora = []
        for t in self.tris:
            for k in range(3):
                b1, b2, ap = t[k], t[(k + 1) % 3], t[(k + 2) % 3]
                if abs(b1[0] - b2[0]) <= 3:                 # base vertical, aponta em x
                    d = (1 if ap[0] > b1[0] else -1, 0)
                    barra = [s for s in self.segs if _v(s) and abs(s[0] - ap[0]) <= 10
                             and min(s[1], s[3]) <= ap[1] + 5 and max(s[1], s[3]) >= ap[1] - 5 and _len(s) >= 40]
                elif abs(b1[1] - b2[1]) <= 3:               # base horizontal, aponta em y
                    d = (0, 1 if ap[1] > b1[1] else -1)
                    barra = [s for s in self.segs if _h(s) and abs(s[1] - ap[1]) <= 10
                             and min(s[0], s[2]) <= ap[0] + 5 and max(s[0], s[2]) >= ap[0] - 5 and _len(s) >= 40]
                else:
                    continue
                if barra and not any(u[1] == barra[0] and u[2] == d
                                     and math.hypot(u[0][2][0] - ap[0], u[0][2][1] - ap[1]) <= 15 for u in fora):
                    fora.append(((b1, b2, ap), barra[0], d, _len(b1 + b2) / 2.0))
                break
        return fora

    def cabecas(self):
        """triângulos pequenos que não são diodo (as pontas das setas do LED)"""
        corpos = [set(u[0]) for u in self.diodos()]
        return [t for t in self.tris if set(t) not in corpos]

    def ganchos(self, barra):
        """segmentos presos às pontas da barra (o Z do zener, o S do Schottky)"""
        pontas = ((barra[0], barra[1]), (barra[2], barra[3]))
        fora = []
        for s in self.segs:
            if s == barra:
                continue
            for px, py in pontas:
                if math.hypot(s[0] - px, s[1] - py) <= 6 or math.hypot(s[2] - px, s[3] - py) <= 6:
                    fora.append(s)
                    break
        return fora

    def circulos_pequenos(self, r=45):
        return [c for c in self.circulos if c[2] <= r] + [e for e in self.elipses if max(e[2], e[3]) <= r]


# ─── as regras, uma por forma ─────────────────────────────────────────────────
def _diodo_2(F):
    """2 pinos com um triângulo apontado no eixo e barra no ápice. Da barra para fora:
    ganchos paralelos ao eixo = Schottky; ganchos diagonais = zener (rasos) ou TVS (a 45°);
    duas diagonais soltas fora do corpo = LED; dois triângulos = TVS bidirecional."""
    ds = F.diodos()
    if not ds:
        return None
    if len(ds) >= 2:
        return 'Diodo TVS bidirecional'
    tri, barra, d, meia = ds[0]
    g = F.ganchos(barra)
    if any((_h(s) if d[0] else _v(s)) for s in g):
        return 'Diodo Schottky'
    diag = [s for s in g if _diag(s)]
    if diag:
        along = max(abs(s[2] - s[0]) if d[0] else abs(s[3] - s[1]) for s in diag)
        perp = max(abs(s[3] - s[1]) if d[0] else abs(s[2] - s[0]) for s in diag)
        return 'Diodo TVS' if perp >= 0.8 * along else 'Diodo zener'
    fora = []
    for s in F.diagonais:
        if s in g:
            continue
        a = (abs(s[1] - F.y0), abs(s[3] - F.y0)) if d[0] else (abs(s[0] - tri[0][0]), abs(s[2] - tri[0][0]))
        if min(a) >= 0.9 * meia:
            fora.append(s)
    if len(fora) >= 2:
        # a cabeça da seta na ponta de fora = luz saindo (LED); na ponta de dentro = entrando
        corpo = (sum(p[0] for p in tri) / 3.0, sum(p[1] for p in tri) / 3.0)
        for c in F.cabecas():
            cc = (sum(p[0] for p in c) / 3.0, sum(p[1] for p in c) / 3.0)
            s = min(fora, key=lambda s: min(math.hypot(s[0] - cc[0], s[1] - cc[1]),
                                            math.hypot(s[2] - cc[0], s[3] - cc[1])))
            a, b = (s[0], s[1]), (s[2], s[3])
            if math.hypot(a[0] - cc[0], a[1] - cc[1]) > math.hypot(b[0] - cc[0], b[1] - cc[1]):
                a, b = b, a                     # a = ponta com a cabeça
            if math.hypot(a[0] - corpo[0], a[1] - corpo[1]) < math.hypot(b[0] - corpo[0], b[1] - corpo[1]):
                return 'Fotodiodo'
            return 'LED'
        return 'LED'
    return 'Diodo'


def _caixa_2(F):
    """2 pinos e UMA caixa: diagonal de canto a canto = bobina de relé; caixa deitada no eixo
    atravessada por uma linha = fusível; cortada por uma diagonal com um pé = termistor, com
    dois pés = varistor; caixa limpa = resistor (o IEC, de retângulo)."""
    if len(F.rects) != 1 or F.tris or F.arcos or F.circulos:
        return None
    x1, y1, x2, y2, _ = F.rects[0]
    cantos = [(x1, y1), (x1, y2), (x2, y1), (x2, y2)]
    for s in F.diagonais:
        if (min(math.hypot(s[0] - cx, s[1] - cy) for cx, cy in cantos) <= 10
                and min(math.hypot(s[2] - cx, s[3] - cy) for cx, cy in cantos) <= 10):
            return 'Bobina de relé'
    if F.caixa_no_eixo() is None:
        return None
    for s in F.segs:
        if _h(s) and y1 < s[1] < y2 and min(s[0], s[2]) <= x1 + 8 and max(s[0], s[2]) >= x2 - 8:
            return 'Fusível'
    for s in F.diagonais:
        if _dist_seg((x1 + x2) / 2.0, (y1 + y2) / 2.0, s) <= 15:
            pontas = ((s[0], s[1]), (s[2], s[3]))
            pes = [t for t in F.segs if _h(t) and abs(t[1] - F.y0) > 10
                   and any(math.hypot(t[i] - px, t[i + 1] - py) <= 6 for px, py in pontas for i in (0, 2))]
            return 'Varistor' if len(pes) >= 2 else 'Termistor'
    if all(_h(s) and abs(s[1] - F.y0) <= 5 for s in F.segs):
        return 'Resistor'
    return None


def _ziguezague(F):
    """resistor ANSI: UMA polilinha de 6+ pontos cujos vértices alternam acima/abaixo do eixo"""
    if F.rects or F.tris or F.arcos:
        return None
    for pts in F.polilinhas:
        lados = [1 if y > F.y0 + 15 else -1 for x, y in pts if abs(y - F.y0) > 15]
        trocas = sum(1 for a, b in zip(lados, lados[1:]) if a != b)
        if len(pts) >= 6 and trocas >= 3:
            return 'Resistor zigue-zague'
    return None


def _placas(F, n):
    """placas = segmentos perpendiculares ao eixo com >= 60 mil. Duas iguais e coladas =
    capacitor; uma placa e um arco grande do lado = capacitor polarizado (o eletrolítico);
    duas placas com uma caixa no meio = cristal; placas de tamanhos diferentes = bateria."""
    pl = sorted(F.placas, key=lambda s: s[0])
    if not pl:
        return None
    if len(pl) == 2 and not F.tris:
        gap = abs(pl[0][0] - pl[1][0])
        l1, l2 = _len(pl[0]), _len(pl[1])
        if F.rects and any(pl[0][0] < r[0] and r[2] < pl[1][0] for r in F.rects):
            return 'Cristal' if n == 2 else 'Cristal com terra'
        if n != 2:
            return None
        if abs(l1 - l2) <= 0.2 * max(l1, l2) and 15 <= gap <= 100 and not F.arcos:
            if any(min(s[0], s[2]) < pl[0][0] and max(s[0], s[2]) > pl[1][0] for s in F.diagonais):
                return 'Capacitor variável'          # a seta atravessando as placas (trimmer)
            curtos = [s for s in F.segs if _len(s) <= 50 and s not in pl and abs(s[1] - F.y0) > 10]
            cruz = any(_h(a) and _v(b) and _dist_seg((a[0] + a[2]) / 2.0, a[1], b) <= 5
                       for a in curtos for b in curtos)
            return 'Capacitor polarizado' if cruz else 'Capacitor'
    if n != 2:
        return None
    if n == 2 and len(pl) == 1 and any(a[2] >= 60 and abs(a[1] - F.y0) <= 10 for a in F.arcos):
        return 'Capacitor polarizado'
    if n == 2 and len(pl) == 1 and any(r[2] - r[0] <= 25 and r[4] for r in F.rects):
        return 'Capacitor polarizado'          # placa cheia (retângulo sólido estreito)
    if n == 2 and len(pl) >= 2 and not F.arcos and not F.tris:
        ls = [_len(s) for s in pl]
        if max(ls) >= 1.3 * min(ls):
            return 'Bateria'
    return None


def _indutor(F, n):
    """3+ arcos do mesmo raio com centros enfileirados = indutor; com 4 pinos e duas fileiras
    (enrolamentos frente a frente) = transformador"""
    ar = [a for a in F.arcos if a[2] >= 20]
    if len(ar) < 3 or F.tris:
        return None
    r = sorted(a[2] for a in ar)[len(ar) // 2]
    ar = [a for a in ar if abs(a[2] - r) <= 0.1 * r]
    linhas = Counter()
    for a in ar:
        linhas[('y', round(a[1] / 10.0))] += 1
        linhas[('x', round(a[0] / 10.0))] += 1
    fileiras = [k for k, c in linhas.items() if c >= 3]
    if not fileiras:
        return None
    if n == 2:
        return 'Indutor'
    if n == 4 and len(fileiras) >= 2:
        return 'Transformador'
    return None


def _chave(F, n):
    """dois círculos pequenos (os contatos) e uma diagonal (a lâmina) = chave; com o T em cima
    = botão momentâneo; 4 pinos e 4 círculos = chave de 2 polos"""
    c = F.circulos_pequenos()
    if len(c) < 2 or F.tris:
        return None

    def borda(px, py):
        return any(abs(math.hypot(px - k[0], py - k[1]) - k[2]) <= 15 for k in c)

    def dentro(px, py):
        return any(math.hypot(px - k[0], py - k[1]) < k[2] for k in c)

    # a lâmina nasce na borda de um contato; a fenda do parafuso de borne fica DENTRO do círculo
    laminas = [s for s in F.diagonais if _len(s) >= 80 and (borda(s[0], s[1]) or borda(s[2], s[3]))
               and not dentro((s[0] + s[2]) / 2.0, (s[1] + s[3]) / 2.0)]
    if n == 4 and len(c) >= 4 and len(laminas) >= 2:
        return 'Chave 2 polos'
    if n != 2:
        return None
    if laminas:
        extras = [s for s in F.segs if (_h(s) or _v(s)) and abs(s[1] - F.y0) > 20]
        return 'Chave momentânea' if len(extras) >= 3 else 'Chave'
    # botão: sem lâmina, uma barra por cima dos dois contatos e a haste
    xs = sorted(k[0] for k in c)
    barra = [s for s in F.segs if _h(s) and abs(s[1] - F.y0) > 20
             and min(s[0], s[2]) <= xs[0] + 5 and max(s[0], s[2]) >= xs[-1] - 5]
    if barra and any(_v(s) for s in F.segs):
        return 'Chave momentânea'
    return None


def _mosfet(F):
    """3 pinos: a barra do gate é o segmento mais longo, o canal são 2+ tocos paralelos e
    perto dela, e a seta (triângulo ou V) decide: ponta virada para a barra = canal N."""
    if not F.segs:
        return None
    barra = max(F.segs, key=_len)
    if _len(barra) < 150 or not (_h(barra) or _v(barra)):
        return None
    hor = _h(barra)

    def perp(px, py):
        return abs(py - barra[1]) if hor else abs(px - barra[0])

    tocos = [s for s in F.segs if s != barra and _paralelo(s, barra) and 15 <= _len(s) <= 150
             and 10 <= perp(s[0], s[1]) <= 60]
    if len(tocos) < 2:
        return None
    setas = []
    for t in F.tris:
        for k in range(3):
            b1, b2, ap = t[k], t[(k + 1) % 3], t[(k + 2) % 3]
            if (abs(b1[1] - b2[1]) <= 3) == hor and (abs(b1[0] - b2[0]) <= 3) != hor:
                setas.append((ap, ((b1[0] + b2[0]) / 2.0, (b1[1] + b2[1]) / 2.0)))
    for a, b, c in F.setas:
        if (abs(a[1] - c[1]) <= 3) == hor:
            setas.append((b, ((a[0] + c[0]) / 2.0, (a[1] + c[1]) / 2.0)))
    setas = [s for s in setas if perp(*s[0]) <= 120 or perp(*s[1]) <= 120]
    if not setas:
        return 'MOSFET'
    ap, base = min(setas, key=lambda s: min(perp(*s[0]), perp(*s[1])))
    return 'MOSFET N' if perp(*ap) < perp(*base) else 'MOSFET P'


def _bjt(F):
    """3 pinos, 3 segmentos e 1 triângulo: a barra da base é tocada pelas duas diagonais; a
    seta fica na diagonal do emissor e a ponta dela longe da barra = NPN, perto = PNP."""
    if len(F.tris) != 1 or not 3 <= len(F.segs) <= 4 or F.rects or F.arcos or F.diodos():
        return None
    tri = F.tris[0]
    lados = [tri[k] + tri[(k + 1) % 3] for k in range(3)]

    def dentro(px, py):
        sinais = [(l[2] - l[0]) * (py - l[1]) - (l[3] - l[1]) * (px - l[0]) for l in lados]
        return all(v >= 0 for v in sinais) or all(v <= 0 for v in sinais)

    def no_tri(s):          # a diagonal do emissor nasce na borda ou por baixo da seta
        return any(_dist_seg(s[0], s[1], l) <= 8 or _dist_seg(s[2], s[3], l) <= 8 for l in lados)             or dentro(s[0], s[1]) or dentro(s[2], s[3])

    for barra in F.segs:
        if _len(barra) < 100:
            continue
        outros = [s for s in F.segs if s != barra and not _paralelo(s, barra) and (_toca(s, barra) or no_tri(s))]
        if len(outros) < 2:
            continue
        cx = sum(p[0] for p in tri) / 3.0
        cy = sum(p[1] for p in tri) / 3.0
        emissor = min(outros, key=lambda s: _dist_seg(cx, cy, s))
        ponta = min(tri, key=lambda p: _dist_reta(p[0], p[1], emissor))
        dp, dc = _dist_reta(ponta[0], ponta[1], barra), _dist_reta(cx, cy, barra)
        if abs(dp - dc) < 3:
            return 'Transistor'
        return 'Transistor NPN' if dp > dc else 'Transistor PNP'
    return None


def _tres(F):
    """os 3 pinos depois do MOSFET: diodo duplo, tiristor, BJT, potenciômetro/trimpot, cristal"""
    ds = F.diodos()
    if len(ds) >= 2:
        return 'Diodo duplo'
    if len(ds) == 1 and not F.rects:
        tri, barra, d, meia = ds[0]
        ap = [p for p in tri if abs(p[0] - barra[0]) <= 10 or abs(p[1] - barra[1]) <= 10]
        gate = [s for s in F.diagonais if ap and (math.hypot(s[0] - ap[0][0], s[1] - ap[0][1]) <= 8
                                                  or math.hypot(s[2] - ap[0][0], s[3] - ap[0][1]) <= 8)]
        if gate:
            return 'Tiristor'
    bjt = _bjt(F)
    if bjt:
        return bjt
    cx = F.caixa_no_eixo()
    if cx is not None and not F.arcos and not F.circulos:
        x1, y1, x2, y2, _ = cx
        if any(_dist_seg((x1 + x2) / 2.0, (y1 + y2) / 2.0, s) <= 15 for s in F.diagonais):
            return 'Trimpot'
        if F.tris or len(F.diagonais) >= 2 or F.setas:
            return 'Potenciômetro'
    return _placas(F, 3)


def _quatro(F, nomes):
    """4 pinos: ponte (4 diodos, ou caixa com pino "~"), optoacoplador (diodo + seta + luz),
    transformador, chave de 2 polos"""
    ds = F.diodos()
    if len(ds) >= 4:
        return 'Ponte retificadora'
    if len(F.rects) == 1 and not F.segs and not F.tris and any('~' in n for n in nomes):
        return 'Ponte retificadora'
    if len(ds) >= 1 and len(F.tris) >= 2 and len(F.diagonais) >= 2:
        return 'Optoacoplador'
    return _indutor(F, 4) or _chave(F, 4)


def _um(F):
    """1 pino: traços paralelos e minguantes = terra; um círculo = ponto de conector"""
    par = [s for s in F.segs if _v(s)] if F.pins[0]['orient'] in (0, 180) else [s for s in F.segs if _h(s)]
    ls = sorted((_len(s) for s in par), reverse=True)
    if len(ls) >= 3 and all(a > b for a, b in zip(ls, ls[1:])):
        return 'Terra'
    # o resto (círculo pequeno = ponto de conexão) fica com a regra geral de `_reconhece`;
    # borne, ponto de teste, parafuso, cone… ficam com o nome de origem, que diz mais
    return None


def _reconhece(pins, graphics):
    """nome básico pela forma, ou None. As regras estão nas funções acima, uma por família;
    a ordem importa (diodo antes de caixa, MOSFET antes de BJT…)."""
    n = len(pins)
    if not n or n > 4:
        return None
    F = _Formas(pins, graphics)
    nome = None
    if n == 1:
        nome = _um(F)
    elif n == 2:
        nome = (_diodo_2(F) or _caixa_2(F) or _ziguezague(F) or _placas(F, 2)
                or _indutor(F, 2) or _chave(F, 2))
    elif n == 3:
        nome = _mosfet(F) or _tres(F)
    elif n == 4:
        nome = _quatro(F, [p['name'] for p in pins])
    if nome:
        return nome
    # um círculo (ou elipse) pequeno por pino e nada "elétrico" em volta (arco de corpo,
    # diagonal fora dos círculos): conector, borne, jumper
    c = F.circulos_pequenos()
    if len(c) >= n and not any(a[2] >= 20 for a in F.arcos) and not any(
            _len(s) >= 50 and all(math.hypot((s[0] + s[2]) / 2.0 - k[0], (s[1] + s[3]) / 2.0 - k[1]) >= k[2] for k in c)
            for s in F.diagonais):
        return 'Conector %d via%s' % (n, '' if n == 1 else 's')
    return None


def _limpa(nome):
    """nome de origem sem o encapsulamento: "CAP [  SMD  ]" -> "CAP", "DIODO PTH" -> "DIODO" """
    s = re.sub(r'\[\s*(SMD|PTH)\s*\]', ' ', nome or '', flags=re.I)
    s = re.sub(r'(?<!\w)(SMD|PTH)(?!\w)', ' ', s, flags=re.I)
    s = re.sub(r'\s+', ' ', s).strip()
    return s or (nome or '').strip() or 'sem nome'


def _classifica(pins, graphics, nome_origem, part=1, partcount=1):
    """-> (kind, nome, visto): `visto` diz se o nome veio da forma (e não da origem)"""
    pins, graphics = normaliza(pins, graphics)
    if len(pins) > 4:
        kind, nome, visto = 'ci', (nome_origem or '').strip() or 'sem nome', False
    else:
        kind = 'generico'
        basico = _reconhece(pins, graphics)
        visto = basico is not None
        nome = basico or _limpa(nome_origem)
    if partcount > 1 and not visto:
        nome += PARTE % (part, partcount)
    return kind, nome, visto


def classifica(pins, graphics, nome_origem, part=1, partcount=1):
    """-> (kind, nome). `generico` até 4 pinos (nome pela forma, senão o de origem limpo),
    `ci` acima (nome = LibReference). Multi-part não reconhecido e `ci` ganham " · parte N/M"."""
    return _classifica(pins, graphics, nome_origem, part, partcount)[:2]


# ─── varredura ────────────────────────────────────────────────────────────────
def _mesmo(caminho):
    return os.path.normcase(os.path.abspath(caminho))


def _arquivos(config, so=None):
    """lista (caminho, tipo) das fontes, em ordem estável. Pastas de `ignorar` não são
    abertas — por PREFIXO do nome, porque o Altium chama "Project Outputs for <Projeto>" —
    nem a `backup_dir` (as cópias antigas da SchLib que o hub guarda a cada Salvar
    ressuscitariam geometria que o usuário já mudou). Fonte repetida, ou pasta que contém
    outra fonte, não lista o mesmo arquivo duas vezes."""
    ignorar = tuple(str(n).lower() for n in config.get('ignorar') or [] if str(n))
    backup = _mesmo(config['backup_dir']) if config.get('backup_dir') else None
    fora, vistos = [], set()

    def poe(caminho, t):
        chave = _mesmo(caminho)
        if chave in vistos:
            return
        vistos.add(chave)
        fora.append((caminho, t))

    def pula(caminho):
        return backup is not None and (_mesmo(caminho) == backup or _mesmo(caminho).startswith(backup + os.sep))

    for fonte in config.get('fontes') or []:
        if os.path.isfile(fonte):
            t = EXT.get(os.path.splitext(fonte)[1].lower())
            if t and (so is None or t == so):
                poe(fonte, t)
            continue
        if not os.path.isdir(fonte):
            continue
        for raiz, dirs, files in os.walk(fonte):
            dirs[:] = sorted(d for d in dirs if not d.lower().startswith(ignorar)
                             and not pula(os.path.join(raiz, d)))
            for f in sorted(files):
                t = EXT.get(os.path.splitext(f)[1].lower())
                if t and (so is None or t == so):
                    poe(os.path.join(raiz, f), t)
    return fora


def _le(caminho, tipo):
    """-> [(nome_origem, desc, part, partcount, pins, graphics)] de um arquivo"""
    fora = []
    if tipo == 'schdoc':
        for c in L.le_schdoc(caminho):
            if not c['pins']:
                continue
            fora.append((c['ref'] or c['designator'] or 'sem nome', c.get('description') or '',
                         c['part'], c['partcount'], c['pins'], c['graphics']))
        return fora
    syms = L.le_intlib(caminho, com_footprints=False) if tipo == 'intlib' \
        else L.le_schlib(caminho, com_footprints=False)['symbols']
    for s in syms:
        for p in s['parts']:
            if p['pins']:
                fora.append((s['name'], s.get('description') or '', p['part'], s['partcount'],
                             p['pins'], p['graphics']))
    return fora


def varre(config, log=_log, so=None, limite=None, ilegiveis=None, stats=None):
    """iterador de (origem_basename, nome_origem, desc, part, partcount, pins, graphics).
    Arquivo ilegível vai para o log (e para `ilegiveis`, se passado) e a varredura segue;
    `stats['arquivos']` recebe quantos foram lidos (o basename repete entre pastas)."""
    arqs = _arquivos(config, so)
    por_tipo = Counter(t for _, t in arqs)
    log('%d arquivo(s): %d .SchLib, %d .SchDoc, %d .IntLib' % (
        len(arqs), por_tipo['schlib'], por_tipo['schdoc'], por_tipo['intlib']))
    if limite:
        arqs = arqs[:limite]
        log('limite: só os %d primeiros' % len(arqs))
    total = len(arqs)
    for i, (caminho, tipo) in enumerate(arqs, 1):
        nome = os.path.basename(caminho)
        try:
            itens = _le(caminho, tipo)
        except Exception as e:              # olefile, zlib, struct… qualquer coisa: registra e segue
            log('  [%d/%d] %s — ILEGÍVEL: %s' % (i, total, nome, e))
            if ilegiveis is not None:
                ilegiveis.append('%s: %s' % (caminho, e))
            continue
        log('  [%d/%d] %s — %d componente%s' % (i, total, nome, len(itens), '' if len(itens) == 1 else 's'))
        if stats is not None:
            stats['arquivos'] = stats.get('arquivos', 0) + 1
        for nome_origem, desc, part, partcount, pins, graphics in itens:
            yield nome, nome_origem, desc, part, partcount, pins, graphics


# ─── mescla ───────────────────────────────────────────────────────────────────
def _lib_vazia():
    return OrderedDict([('format', 'symlib-v1'), ('generated', ''), ('units', 'mil'), ('symbols', [])])


def _num_id(s):
    m = re.match(r'^s(\d+)$', str(s.get('id', '')))
    return int(m.group(1)) if m else 0


def _nome_unico(nome, usados):
    if nome not in usados:
        return nome
    k = 2
    while '%s #%d' % (nome, k) in usados:
        k += 1
    return '%s #%d' % (nome, k)


def _lib_saneada(lib_atual, log):
    """as entradas do symbols-lib.js atual, com o que um arquivo editado à mão pode ter
    quebrado consertado no lugar (nunca descartado — descartar apaga o símbolo do usuário):
    id fora do padrão ou repetido ganha um novo, nome vazio/repetido vira único, fp ausente é
    recalculado. Só entrada sem pins/graphics fica de fora — não há o que guardar."""
    fora = []
    for s in (lib_atual or {}).get('symbols') or []:
        if not isinstance(s, dict) or not isinstance(s.get('pins'), list) or not isinstance(s.get('graphics'), list):
            log('  biblioteca atual: entrada sem pins/graphics ignorada (%r)' % (s.get('id') if isinstance(s, dict) else s))
            continue
        e = OrderedDict((k, s.get(k)) for k in CHAVES_ARQ)
        e['desc'] = _desc(e['desc'])
        e['aliases'] = [str(a) for a in (e['aliases'] if isinstance(e['aliases'], list) else [])]
        e['fontes'] = [str(f) for f in (e['fontes'] if isinstance(e['fontes'], list) else [])]
        e['usos'] = _i(e['usos'])
        if e['kind'] not in ('generico', 'ci'):
            e['kind'] = 'generico' if len(e['pins']) <= 4 else 'ci'
        if not isinstance(e['fp'], str) or not e['fp']:
            e['fp'] = fingerprint(e['pins'], e['graphics'], e['kind'])
            log('  biblioteca atual: %s sem fingerprint, recalculado' % e['id'])
        fora.append(e)
    ids, nomes = set(), set()
    maior = max([_num_id(s) for s in fora] or [0])
    for e in fora:
        sid = str(e['id'] or '')
        if not re.match(r'^s\d+$', sid) or sid in ids:
            maior += 1
            log('  biblioteca atual: id %r inválido ou repetido -> s%04d' % (e['id'], maior))
            e['id'] = 's%04d' % maior
        ids.add(e['id'])
        nome = e['name'].strip() if isinstance(e['name'], str) else ''
        nome = nome or (e['aliases'][0] if e['aliases'] else '') or 'sem nome'
        if nome in nomes or nome != e['name']:
            nome = _nome_unico(nome, nomes)
            log('  biblioteca atual: %s sem nome ou repetido -> %r' % (e['id'], nome))
            e['name'] = nome
        nomes.add(e['name'])
    return fora


def mescla(lib_atual, achados, hoje, log=_log, ilegiveis=None, stats=None, preferida=None):
    """-> (lib_nova, resumo). Quem já existe (mesmo fingerprint) ganha usos/fontes/aliases;
    o novo entra ordenado por nome, com id depois do maior existente. Nome/id existentes
    nunca mudam. `usos` de um arquivo já visto numa rodada anterior não conta de novo —
    rodar duas vezes a mesma fonte não dobra a conta. `preferida` = basename da SchLib
    oficial: entre formas de mesmo nome, a dela fica com o nome limpo."""
    lib = _lib_vazia()
    symbols = lib['symbols']
    symbols.extend(_lib_saneada(lib_atual, log))
    por_fp = {}
    for s in symbols:
        if s['fp'] in por_fp:
            log('  biblioteca atual: %s e %s têm o mesmo fingerprint (%s fica de fora da mescla)'
                % (por_fp[s['fp']]['id'], s['id'], s['id']))
            continue
        por_fp[s['fp']] = s
    nomes = {s['name'] for s in symbols}
    fontes_antes = {s['fp']: set(s['fontes']) for s in symbols}
    maior = max([_num_id(s) for s in symbols] or [0])
    preferida = (preferida or '').lower()

    novos = OrderedDict()
    classes, origem_de, forma_de = Counter(), {}, {}
    repetidos, arquivos, candidatas, olhos = Counter(), set(), {}, {}
    for origem, nome_origem, desc, part, partcount, pins, graphics in achados:
        arquivos.add(origem)
        npins, ngr = normaliza(pins, graphics)
        kind, nome, visto = _classifica(npins, ngr, nome_origem, part, partcount)
        classes[nome.split(PARTE[:3])[0].split(' #')[0] if kind == 'generico' else '(ci) ' + nome_origem] += 1
        alias = nome_origem if partcount <= 1 else nome_origem + PARTE % (part, partcount)
        fp = fingerprint(npins, ngr, kind)
        d = _desc(desc)
        if d:
            cands = candidatas.setdefault(fp, (Counter(), Counter()))
            cands[0 if origem.lower() == preferida else 1][d] += 1
        assinatura = _assinatura_olho(npins)
        if assinatura is not None:
            olhos.setdefault(fp, Counter())[assinatura] += 1
        s = por_fp.get(fp) or novos.get(fp)
        if s is not None:
            repetidos[fp] += 1
            if alias not in s['aliases']:
                s['aliases'].append(alias)
            if origem not in s['fontes']:
                s['fontes'].append(origem)
            if origem not in fontes_antes.get(fp, ()):
                s['usos'] += 1
            continue
        novos[fp] = OrderedDict([('id', None), ('name', nome), ('desc', ''), ('kind', kind), ('fp', fp),
                                 ('aliases', [alias]), ('fontes', [origem]), ('usos', 1), ('desde', hoje),
                                 ('pins', npins), ('graphics', ngr)])
        origem_de[fp] = origem
        forma_de[fp] = _limpa(alias) if visto else None      # com a parte, se multi-part

    # A descrição e o olho só podem ser decididos com a contagem fechada: quem ganha é o do
    # lote inteiro, não o que chegou primeiro.
    #
    # `_cobre` é a trava que permite REFAZER a escolha sem estragar nada. Só reescreve o que
    # já estava no arquivo quando esta rodada enxergou todas as fontes que já tinham dado
    # descrição/olho àquele símbolo: aí ela tem, no mínimo, a prova que a rodada anterior
    # tinha, e regravar é atualizar, não rebaixar. Uma rodada com `--fonte` num projeto só
    # não cobre as fontes antigas e passa reto; símbolo desenhado no hub (fonte 'hub') nenhuma
    # varredura cobre, então o desenho e o olho do usuário ficam intactos. Símbolo novo não
    # tem fonte anterior — conjunto vazio cabe em qualquer rodada — e é sempre decidido aqui.
    def _cobre(fp):
        return fontes_antes.get(fp, set()) <= arquivos

    disputadas = []
    for fp, cands in candidatas.items():
        s = por_fp.get(fp) or novos.get(fp)
        if s is None:
            continue
        escolhida, todas = _escolhe_desc(cands)
        if escolhida and (not _desc(s.get('desc')) or _cobre(fp)):
            s['desc'] = escolhida
        if len(todas) > 1:
            disputadas.append((fp, s['desc'], todas))
    disputadas.sort(key=lambda d: (-len(d[2]), -d[2][0][1], d[0]))

    # o olho: a assinatura mais frequente do lote, copiada inteira (põe e tira). O desempate
    # é pelo `repr` da assinatura, e não pela ordem de chegada, senão duas rodadas com os
    # arquivos em ordem diferente dariam arquivos diferentes.
    olhos_postos = 0
    for fp, votos in olhos.items():
        s = por_fp.get(fp) or novos.get(fp)
        if s is None or not _cobre(fp):
            continue
        vence = min(votos.items(), key=lambda kv: (-kv[1], repr(kv[0])))[0]
        if _aplica_olho(s['pins'], vence):
            olhos_postos += 1

    lista = []

    # por nome; entre formas de mesmo nome, a da SchLib oficial e depois a mais usada fica
    # com o nome limpo; as outras levam a origem entre parênteses ("Resistor (RES PTH)") —
    # diz de onde veio, que " #2" não diz — e " #N" só quando nem isso desempata
    def ordem(e):
        return (e['name'].lower(), e['name'], 0 if any(f.lower() == preferida for f in e['fontes']) else 1,
                -e['usos'], e['fp'])
    for e in sorted(novos.values(), key=ordem):
        nome, limpo = e['name'], forma_de[e['fp']]
        if nome in nomes and limpo and limpo.lower() != nome.lower():
            nome = '%s (%s)' % (nome, limpo)
        e['name'] = _nome_unico(nome, nomes)
        nomes.add(e['name'])
        maior += 1
        e['id'] = 's%04d' % maior
        symbols.append(e)
        lista.append((e['id'], e['name'], e['kind'], origem_de[e['fp']]))
    lib['generated'] = datetime.now().strftime('%Y-%m-%d %H:%M')
    por_nome = {s['fp']: s['name'] for s in symbols}
    resumo = {'novos': len(novos), 'repetidos': sum(repetidos.values()),
              'arquivos': (stats or {}).get('arquivos', len(arquivos)),
              'ilegiveis': list(ilegiveis or []), 'lista_novos': lista,
              'repetidos_por': OrderedDict((por_nome[fp], n) for fp, n in repetidos.most_common()),
              'classes': OrderedDict(classes.most_common()),
              'olhos': olhos_postos,
              'desc_disputadas': [(por_nome[fp], venc, todas) for fp, venc, todas in disputadas]}
    log('%d novo(s), %d repetido(s) em %d arquivo(s)%s' % (
        len(novos), resumo['repetidos'], resumo['arquivos'],
        ', %d ilegível(is)' % len(resumo['ilegiveis']) if resumo['ilegiveis'] else ''))
    return lib, resumo


# ─── arquivo symlib-v1 ────────────────────────────────────────────────────────
def _linha(s):
    e = OrderedDict((k, s.get(k)) for k in CHAVES_ARQ)
    e['desc'] = e['desc'] or ''          # símbolo desenhado no hub não tem: vazia, nunca null
    return json.dumps(e, ensure_ascii=True, separators=(',', ':'))


def escreve_symlib(lib, caminho):
    """Libs/symbols-lib.js: um símbolo por linha (o git diffa bem), gravação atômica"""
    linhas = ['var symbolsLib = {', '"format":"symlib-v1",',
              '"generated":%s,' % json.dumps(lib.get('generated') or datetime.now().strftime('%Y-%m-%d %H:%M')),
              '"units":"mil",', '"symbols":[']
    for i, s in enumerate(lib.get('symbols') or []):
        linhas.append((',' if i else '') + _linha(s))
    linhas.append(']};')
    d = os.path.dirname(os.path.abspath(caminho))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    tmp = caminho + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(linhas) + '\n')
    os.replace(tmp, caminho)


def le_symlib(caminho):
    """-> dict do symbols-lib.js, ou None se não existe / não parseia"""
    try:
        with open(caminho, encoding='utf-8') as f:
            raw = f.read()
        return json.loads(raw[raw.index('{'):raw.rindex('}') + 1], object_pairs_hook=OrderedDict)
    except (OSError, ValueError):
        return None


def le_config(caminho=CONFIG_PADRAO):
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


# ─── relatório ────────────────────────────────────────────────────────────────
def relatorio(lib, resumo, config, saida):
    li = ['AltiumPCBMirror - extracao de simbolos', 'Data: ' + (lib.get('generated') or ''),
          'Biblioteca: %s (%d simbolos)' % (saida, len(lib.get('symbols') or [])), '',
          'Fontes varridas:'] + ['  ' + str(f) for f in config.get('fontes') or []]
    li += ['', 'Arquivos lidos: %d   ilegiveis: %d' % (resumo['arquivos'], len(resumo['ilegiveis']))]
    li += ['  ' + x for x in resumo['ilegiveis']]
    li += ['Olho do pino (hideNum/hideName) recopiado em %d simbolo(s)' % resumo.get('olhos', 0)]
    li += ['', 'Novos (%d):' % resumo['novos']]
    li += ['  %s  %-40s %-8s %s' % (i, n, k, o) for i, n, k, o in resumo['lista_novos']]
    li += ['', 'Repetidos (%d ocorrencias):' % resumo['repetidos']]
    li += ['  %5d  %s' % (n, nome) for nome, n in resumo['repetidos_por'].items()]
    li += ['', 'Classificacao (nome basico -> quantos):']
    li += ['  %5d  %s' % (n, nome) for nome, n in resumo['classes'].items()]
    # escolher a descrição é a única coisa que esta varredura joga fora (as candidatas que
    # perderam), então ela presta contas aqui em vez de engordar o symbols-lib.js com a
    # procedência de cada uma: é este o arquivo que se abre quando o rótulo sai errado
    disputadas = resumo.get('desc_disputadas') or []
    li += ['', 'Descricoes disputadas (%d simbolos; a escolhida vem marcada, ate %d candidatas):'
           % (len(disputadas), MOSTRA_CANDIDATAS)]
    for nome, venc, todas in disputadas:
        # a escolhida abre a lista mesmo quando perde na contagem: é quase sempre o caso
        # interessante (a da lib da casa ganhando de uma mais frequente), e de nada adianta
        # o relatório mostrar cinco candidatas e esconder justamente a que está no arquivo
        quantas = dict(todas)
        li.append('  ' + nome)
        li.append('    <- %s  %s' % ('%5d' % quantas[venc] if venc in quantas else '    -', venc))
        resto = [(d, n) for d, n in todas if d != venc]
        for d, n in resto[:MOSTRA_CANDIDATAS - 1]:
            li.append('       %5d  %s' % (n, d))
        if len(resto) >= MOSTRA_CANDIDATAS:
            li.append('             e mais %d' % (len(resto) - MOSTRA_CANDIDATAS + 1))
    return '\n'.join(li) + '\n'


def tabela(classes, log=_log):
    """a tabela de classificação no log, para conferir as heurísticas de relance"""
    log('classificação (nome básico -> quantos):')
    for nome, n in classes.items():
        log('  %5d  %s' % (n, nome))


# ─── CLI ──────────────────────────────────────────────────────────────────────
def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='junta os símbolos dos projetos numa Biblioteca de símbolos')
    ap.add_argument('--config', default=CONFIG_PADRAO)
    ap.add_argument('--saida', default=SAIDA_PADRAO, help='Libs/symbols-lib.js (mesclado, nunca reescrito)')
    ap.add_argument('--relatorio', default=RELATORIO_PADRAO)
    ap.add_argument('--so', choices=sorted(set(EXT.values())), help='só um tipo de arquivo')
    ap.add_argument('--limite', type=int, help='lê só os N primeiros arquivos')
    ap.add_argument('--fonte', nargs='+', help='arquivo(s)/pasta(s) no lugar das fontes do config')
    ap.add_argument('--sem-tabela', action='store_true', help='não imprime a tabela de classificação')
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')     # o SSE lê UTF-8

    config = le_config(a.config)
    if a.fonte:
        config['fontes'] = a.fonte
    _log('fontes: ' + '; '.join(str(f) for f in config.get('fontes') or []))
    atual = le_symlib(a.saida)
    _log('biblioteca atual: %s' % ('%d símbolos' % len(atual['symbols']) if atual else 'nenhuma (vai criar)'))
    ilegiveis, stats = [], {}
    lib, resumo = mescla(atual, varre(config, so=a.so, limite=a.limite, ilegiveis=ilegiveis, stats=stats),
                         date.today().isoformat(), ilegiveis=ilegiveis, stats=stats,
                         preferida=os.path.basename(str(config.get('schlib') or '')))
    escreve_symlib(lib, a.saida)
    if a.relatorio:
        d = os.path.dirname(os.path.abspath(a.relatorio))
        if not os.path.isdir(d):
            os.makedirs(d)
        with open(a.relatorio, 'w', encoding='utf-8') as f:
            f.write(relatorio(lib, resumo, config, a.saida))
    if not a.sem_tabela:
        tabela(resumo['classes'])
    _log('%d símbolos -> %s%s' % (len(lib['symbols']), a.saida,
                                  (' (relatório em %s)' % a.relatorio) if a.relatorio else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
