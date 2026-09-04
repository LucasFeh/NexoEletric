# -*- coding: utf-8 -*-
"""Geometria dos simbolos, no mesmo vocabulario do Libs/schlib.js espelhado.

Unidade: mil, X para a direita, Y para cima, origem no centro do corpo - igual ao
editor de SchLib do Altium. O `x,y` de um pino e a ponta do CORPO; a ponta quente
(onde o fio encosta) e `x,y + len*dir(orient)`, exatamente como o hub ja calcula.

Cada forma devolve (pins, graphics). As duas listas sao serializadas como estao,
tanto no espelho do hub quanto no arquivo que o BuildAlmoxLibs.pas le.
"""

PASSIVO = 'Passive'


def _pin(num, nome, x, y, orient, ln=100, tipo=PASSIVO):
    return {'num': str(num), 'name': nome, 'x': x, 'y': y, 'len': ln,
            'orient': orient, 'type': tipo}


def _pl(pts, w=10):
    return {'g': 'polyline', 'pts': pts, 'w': w}


def _poly(pts, w=10, solid=False):
    d = {'g': 'poly', 'pts': pts, 'w': w}
    if solid:
        d['solid'] = True
    return d


def _rect(x1, y1, x2, y2, w=10):
    return {'g': 'rect', 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'w': w}


def _arc(cx, cy, r, sa, ea, w=10):
    return {'g': 'arc', 'cx': cx, 'cy': cy, 'r': r, 'sa': sa, 'ea': ea, 'w': w}


def _lab(txt, x, y, size=8):
    return {'g': 'label', 'text': txt, 'x': x, 'y': y, 'size': size}


# dois terminais horizontais: o par de pinos que quase todo basico usa
def _dois(n1='1', n2='2', nome1='', nome2=''):
    return [_pin(n1, nome1, -100, 0, 180), _pin(n2, nome2, 100, 0, 0)]


# ─── formas de dois terminais ─────────────────────────────────────────────────
def f_res(_n=0):
    return _dois(), [_rect(-100, -40, 100, 40)]


def f_ferr(_n=0):
    return _dois(), [_rect(-100, -30, 100, 30), _pl([[-60, -30], [-60, 30]]),
                     _pl([[0, -30], [0, 30]]), _pl([[60, -30], [60, 30]])]


def f_termi(_n=0):
    return _dois(), [_rect(-100, -40, 100, 40), _pl([[-70, -60], [70, 60]]),
                     _lab('t°', 0, 70, 7)]


def f_varis(_n=0):
    return _dois(), [_rect(-100, -40, 100, 40), _pl([[-40, -60], [-10, -60], [40, 60]]),
                     _lab('U', -60, 62, 7)]


def f_cap(_n=0):
    return _dois(), [_pl([[-100, 0], [-25, 0]]), _pl([[-25, -70], [-25, 70]]),
                     _pl([[25, -70], [25, 70]]), _pl([[25, 0], [100, 0]])]


def f_cpol(_n=0):
    """polarizado: placa da direita curva e o '+' do lado do anodo"""
    return _dois('1', '2', '+', '-'), [
        _pl([[-100, 0], [-25, 0]]), _pl([[-25, -70], [-25, 70]]),
        _pl([[45, -70], [25, -40], [25, 40], [45, 70]]),
        _pl([[45, 0], [100, 0]]),
        _pl([[-80, 40], [-40, 40]]), _pl([[-60, 20], [-60, 60]])]


def f_cvar(_n=0):
    p, g = f_cap()
    return p, g + [_pl([[-70, -60], [70, 60]]), _pl([[45, 45], [70, 60], [55, 35]])]


def f_ind(_n=0):
    g = [_pl([[-100, 0], [-75, 0]]), _pl([[75, 0], [100, 0]]),
         _arc(-50, 0, 25, 0, 180), _arc(0, 0, 25, 0, 180), _arc(50, 0, 25, 0, 180)]
    return _dois(), g


def f_xtal(_n=0):
    return _dois(), [_pl([[-100, 0], [-45, 0]]), _pl([[-45, -60], [-45, 60]]),
                     _rect(-25, -60, 25, 60), _pl([[45, -60], [45, 60]]),
                     _pl([[45, 0], [100, 0]])]


def _corpo_diodo():
    return [_pl([[-100, 0], [-30, 0]]), _poly([[-30, -60], [-30, 60], [40, 0]], solid=True),
            _pl([[40, -60], [40, 60]]), _pl([[40, 0], [100, 0]])]


def f_diodo(_n=0):
    return _dois('1', '2', 'A', 'K'), _corpo_diodo()


def f_zener(_n=0):
    return _dois('1', '2', 'A', 'K'), _corpo_diodo() + [_pl([[20, 60], [40, 60]]), _pl([[40, -60], [60, -60]])]


def f_schot(_n=0):
    return _dois('1', '2', 'A', 'K'), _corpo_diodo() + [
        _pl([[20, 40], [20, 60], [40, 60]]), _pl([[40, -60], [60, -60], [60, -40]])]


def f_tvs(_n=0):
    return _dois('1', '2', 'A', 'K'), [
        _pl([[-100, 0], [-70, 0]]), _poly([[-70, -60], [-70, 60], [0, 0]], solid=True),
        _pl([[0, -60], [0, 60]]),
        _poly([[70, -60], [70, 60], [0, 0]], solid=True), _pl([[70, 0], [100, 0]])]


def f_diac(_n=0):
    return _dois(), [
        _pl([[-100, 0], [-70, 0]]), _poly([[-70, -60], [-70, 60], [0, 0]], solid=True),
        _poly([[70, -60], [70, 60], [0, 0]], solid=True), _pl([[70, 0], [100, 0]])]


def f_led(_n=0):
    return _dois('1', '2', 'A', 'K'), _corpo_diodo() + [
        _pl([[10, 70], [50, 110]]), _pl([[50, 110], [35, 105]]), _pl([[50, 110], [45, 95]]),
        _pl([[-20, 70], [20, 110]]), _pl([[20, 110], [5, 105]]), _pl([[20, 110], [15, 95]])]


def f_fuse(_n=0):
    return _dois(), [_rect(-90, -35, 90, 35), _pl([[-100, 0], [100, 0]])]


def f_fusept(_n=0):
    p, g = f_fuse()
    return p, g + [_lab('PTC', 0, 60, 7)]


def f_bat(_n=0):
    return _dois('1', '2', '+', '-'), [
        _pl([[-100, 0], [-45, 0]]), _pl([[-45, -70], [-45, 70]]), _pl([[-15, -35], [-15, 35]]),
        _pl([[15, -70], [15, 70]]), _pl([[45, -35], [45, 35]]), _pl([[45, 0], [100, 0]]),
        _pl([[-90, 45], [-50, 45]]), _pl([[-70, 25], [-70, 65]])]


def f_sw(n=2):
    """chave simples: 2 terminais e a alavanca aberta"""
    if n and n > 2:
        return f_conn(n)
    return _dois(), [_pl([[-100, 0], [-60, 0]]), _pl([[60, 0], [100, 0]]),
                     _pl([[-60, 0], [50, 55]]),
                     {'g': 'ellipse', 'cx': -60, 'cy': 0, 'rx': 10, 'ry': 10, 'w': 8},
                     {'g': 'ellipse', 'cx': 60, 'cy': 0, 'rx': 10, 'ry': 10, 'w': 8}]


# ─── tres terminais ───────────────────────────────────────────────────────────
def f_pot(_n=0):
    p, g = f_res()
    p = p + [_pin('3', 'W', 0, 140, 90)]
    return p, g + [_pl([[0, 140], [0, 70]]), _pl([[0, 70], [-20, 95]]), _pl([[0, 70], [20, 95]])]


def _bjt_base(seta, emissor):
    """corpo comum do BJT; o que separa NPN de PNP e para onde a seta aponta.

    A seta E a informacao: no NPN ela fica na saida do emissor apontando para fora, no PNP
    fica encostada na barra da base apontando para dentro. Desenhar os dois igual (o que
    esta biblioteca fazia) e dizer que todo transistor e NPN."""
    pins = [_pin('1', 'B', -200, 0, 180), _pin('2', 'C', 100, 200, 90), _pin('3', 'E', 100, -200, 270)]
    g = [{'g': 'ellipse', 'cx': 0, 'cy': 0, 'rx': 130, 'ry': 130, 'w': 10},
         _pl([[-200, 0], [-60, 0]]), _pl([[-60, -80], [-60, 80]]),
         _pl([[-60, 45], [100, 120], [100, 200]]),
         emissor,
         seta]
    return pins, g


def f_bjt(_n=0):
    return _bjt_base(_poly([[60, -105], [100, -85], [75, -55]], solid=True),
                     _pl([[-60, -45], [100, -120], [100, -200]]))


def f_bjt_pnp(_n=0):
    """PNP: seta na BASE, apontando para dentro — a convencao das proprias BC327/BC807 da
    casa. A perna do emissor comeca depois do triangulo, senao o traco corre por dentro
    dele; e a seta nao e o espelho da do NPN, que e quase equilatera e flutua fora do eixo."""
    return _bjt_base(_poly([[-60, -45], [0, -45], [-20, -90]], solid=True),
                     _pl([[-25, -60], [100, -120], [100, -200]]))


def f_mosfet(_n=0):
    pins = [_pin('1', 'G', -200, 0, 180), _pin('2', 'D', 100, 200, 90), _pin('3', 'S', 100, -200, 270)]
    g = [_pl([[-200, 0], [-70, 0]]), _pl([[-70, -80], [-70, 80]]),
         _pl([[-30, -80], [-30, -30]]), _pl([[-30, -10], [-30, 10]]), _pl([[-30, 30], [-30, 80]]),
         _pl([[-30, 55], [100, 55], [100, 200]]),
         _pl([[-30, -55], [100, -55], [100, -200]]),
         _pl([[-30, 0], [100, 0], [100, -55]]),
         _poly([[10, -20], [10, 20], [50, 0]], solid=True)]
    return pins, g


def f_igbt(_n=0):
    pins, g = f_mosfet()
    pins[1]['name'], pins[2]['name'] = 'C', 'E'
    return pins, g


def f_scr(_n=0):
    pins = [_pin('1', 'A', -100, 0, 180), _pin('2', 'K', 100, 0, 0), _pin('3', 'G', 40, -200, 270)]
    g = _corpo_diodo() + [_pl([[40, -200], [40, -60]])]
    return pins, g


def f_ponte(_n=0):
    pins = [_pin('1', '~', -200, 0, 180), _pin('2', '~', 200, 0, 0),
            _pin('3', '+', 0, 200, 90), _pin('4', '-', 0, -200, 270)]
    g = [_poly([[-140, 0], [0, 140], [140, 0], [0, -140]]),
         _pl([[-200, 0], [-140, 0]]), _pl([[140, 0], [200, 0]]),
         _pl([[0, 140], [0, 200]]), _pl([[0, -200], [0, -140]]),
         _lab('+', 45, 95, 8), _lab('~', -110, 40, 8)]
    return pins, g


# ─── corpos de N pinos ────────────────────────────────────────────────────────
def f_conn(n=2):
    """conector/barra de pinos: pinos a esquerda, corpo retangular"""
    n = max(1, int(n or 1))
    y0 = (n - 1) * 50
    pins = [_pin(i + 1, str(i + 1), -100, y0 - i * 100, 180) for i in range(n)]
    g = [_rect(-100, y0 - (n - 1) * 100 - 50, 100, y0 + 50)]
    for i in range(n):
        g.append(_rect(30, y0 - i * 100 - 25, 80, y0 - i * 100 + 25, 6))
    return pins, g


def f_rede(n=8):
    return f_conn(n)


def f_dipsw(n=4):
    """dip switch: n chaves, pino i a esquerda e pino (2n-i+1) a direita"""
    n = max(1, int(n or 4))
    y0 = (n - 1) * 50
    pins = []
    for i in range(n):
        y = y0 - i * 100
        pins.append(_pin(i + 1, str(i + 1), -100, y, 180))
        pins.append(_pin(2 * n - i, str(2 * n - i), 100, y, 0))
    g = [_rect(-100, y0 - (n - 1) * 100 - 50, 100, y0 + 50)]
    for i in range(n):
        y = y0 - i * 100
        g.append(_pl([[-60, y], [40, y + 35]]))
    return pins, g


def f_opto(_n=0):
    pins = [_pin('1', 'A', -200, 50, 180), _pin('2', 'K', -200, -50, 180),
            _pin('3', 'C', 200, 50, 0), _pin('4', 'E', 200, -50, 0)]
    g = [_rect(-150, -120, 150, 120),
         _pl([[-200, 50], [-90, 50]]), _pl([[-200, -50], [-90, -50]]),
         _poly([[-90, 50], [-90, -50], [-30, 0]], solid=True), _pl([[-30, 50], [-30, -50]]),
         _pl([[-30, 0], [-30, -50]]),
         _pl([[30, 60], [30, -60]]), _pl([[30, 30], [200, 50]]), _pl([[30, -30], [200, -50]]),
         _pl([[0, 20], [20, 10]]), _pl([[0, -20], [20, -30]])]
    return pins, g


def f_trafo(_n=0):
    pins = [_pin('1', 'P1', -200, 100, 180), _pin('2', 'P2', -200, -100, 180),
            _pin('3', 'S1', 200, 100, 0), _pin('4', 'S2', 200, -100, 0)]
    g = [_pl([[-200, 100], [-60, 100]]), _pl([[-200, -100], [-60, -100]]),
         _pl([[200, 100], [60, 100]]), _pl([[200, -100], [60, -100]]),
         _arc(-60, 50, 25, 270, 90), _arc(-60, 0, 25, 270, 90), _arc(-60, -50, 25, 270, 90),
         _arc(60, 50, 25, 90, 270), _arc(60, 0, 25, 90, 270), _arc(60, -50, 25, 90, 270),
         _pl([[-15, -110], [-15, 110]]), _pl([[15, -110], [15, 110]])]
    return pins, g


# Convencao da casa para corpo de CI, contada nos 3.834 pinos da
# BIBLIOTECA DE ESQUEMA.SchLib real:
#   comprimento do pino  100 mil - 2.431 pinos contra 1.066 de 200 e 113 de 300
#   passo entre pinos    200 mil - 140 simbolos contra 36 de 100 e 31 de 400
# O gerador usava passo 100 e pino de 200: um DIP40 saia 400x2100 quando a casa
# desenha 1600x4200. Era esse o "ta muito errado a construcao" - o corpo ficava
# quatro vezes mais estreito com os pinos amontoados no dobro da densidade.
PASSO_PINO = 200
COMPR_PINO = 100


def largura_corpo(n):
    """Largura do corpo em mil para um CI de n pinos.

    SEMPRE multipla de 200. O corpo e centrado na origem e o pino sai de +-largura/2,
    entao meia largura precisa ser multipla de 100 para a ponta quente cair na grade
    de 100 mil do Altium - senao o fio nao engata no pino. A escada anterior tinha
    700 e 900, que davam meia largura de 350 e 450 e jogavam a ponta para fora da
    grade. Os degraus batem com a moda por faixa medida na lib da casa
    (8-15 pinos -> 800; a faixa de 40+ tem 4 simbolos, mediana 1375, e o PIC16F77,
    que e o DIP40 da casa, tem 1600).
    """
    if n >= 40:
        return 1600
    if n >= 24:
        return 1000
    if n >= 8:
        return 800
    return 600


def f_box(n=4, largura=0, rotulo=''):
    """corpo generico dos ESPECIAIS: caixa com metade dos pinos de cada lado.

    A pinagem sai do encapsulamento (DIP8 -> 8 pinos) e a numeracao segue a
    convencao de encapsulamento: 1..n/2 descendo a esquerda, n/2+1..n subindo a
    direita. E um esqueleto para o vinculo manual, nao a pinagem do datasheet.
    """
    n = max(2, int(n or 2))
    esq = (n + 1) // 2
    dir_ = n - esq
    largura = largura or largura_corpo(n)
    alt = max(2 * PASSO_PINO, max(esq, dir_) * PASSO_PINO + PASSO_PINO)
    topo = alt // 2
    meia = largura // 2
    pins = []
    for i in range(esq):
        pins.append(_pin(i + 1, str(i + 1), -meia,
                         topo - PASSO_PINO - i * PASSO_PINO, 180, COMPR_PINO))
    for j in range(dir_):
        pins.append(_pin(esq + j + 1, str(esq + j + 1), meia,
                         topo - PASSO_PINO - (dir_ - 1 - j) * PASSO_PINO, 0, COMPR_PINO))
    g = [_rect(-meia, -topo, meia, topo)]
    if rotulo:
        # ABAIXO do corpo, nao no meio dele. No centro o nome da familia cobria o
        # desenho - "CIRCUITO INTEGRADO" tem uns 990 mil de largura e o corpo mais
        # estreito tem 600. A ancora de um texto no Altium e o pe da linha e a letra
        # cresce para CIMA: 150 mil abaixo da borda deixa a linha (uns 100 mil) fora
        # do retangulo com 50 de respiro. O x acompanha a borda esquerda - nome
        # comprido escapa para a direita em vez de ficar torto em volta do zero.
        g.append(_lab(rotulo, -meia, -topo - 150, 9))
    return pins, g


FORMAS = {
    'res': f_res, 'ferr': f_ferr, 'termi': f_termi, 'varis': f_varis,
    'cap': f_cap, 'cpol': f_cpol, 'cvar': f_cvar, 'ind': f_ind, 'xtal': f_xtal,
    'diodo': f_diodo, 'zener': f_zener, 'schot': f_schot, 'tvs': f_tvs, 'diac': f_diac,
    'led': f_led, 'ponte': f_ponte, 'fuse': f_fuse, 'fusept': f_fusept, 'bat': f_bat,
    'sw': f_sw, 'pot': f_pot, 'bjt': f_bjt, 'bjt_pnp': f_bjt_pnp,
    'mosfet': f_mosfet, 'igbt': f_igbt,
    'scr': f_scr, 'conn': f_conn, 'rede': f_rede, 'dipsw': f_dipsw, 'opto': f_opto,
    'trafo': f_trafo, 'box': f_box,
}


def desenha(forma, n=0, rotulo=''):
    fn = FORMAS.get(forma, f_box)
    if forma == 'box':
        return fn(n or 4, rotulo=rotulo)
    return fn(n)


def bbox(pins, graphics):
    xs, ys = [], []

    def ext(x, y):
        xs.append(x); ys.append(y)

    for p in pins:
        d = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}[p['orient'] % 360]
        ext(p['x'], p['y'])
        ext(p['x'] + d[0] * p['len'], p['y'] + d[1] * p['len'])
    for g in graphics:
        k = g['g']
        if k in ('rect', 'line'):
            ext(g['x1'], g['y1']); ext(g['x2'], g['y2'])
        elif k == 'arc':
            ext(g['cx'] - g['r'], g['cy'] - g['r']); ext(g['cx'] + g['r'], g['cy'] + g['r'])
        elif k == 'ellipse':
            ext(g['cx'] - g['rx'], g['cy'] - g['ry']); ext(g['cx'] + g['rx'], g['cy'] + g['ry'])
        elif k in ('poly', 'polyline'):
            for p in g['pts']:
                ext(p[0], p[1])
        elif k == 'label':
            ext(g['x'] - 100, g['y'] - 40); ext(g['x'] + 100, g['y'] + 40)
    if not xs:
        return (0, 0, 0, 0)
    return (min(xs), min(ys), max(xs), max(ys))
