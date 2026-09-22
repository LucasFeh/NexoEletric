# -*- coding: utf-8 -*-
"""O conector lido em campos: subtipo, vias, passo, angulo, genero, matriz e tipo.

POR QUE ISTO EXISTE SEPARADO. Ate 2026-09-22 todo conector do almoxarifado era UMA familia
('CONECTOR'), partida por numero de vias na hora de virar simbolo: CONECTOR 2V, CONECTOR 3V,
... CONECTOR 64V. Procurar um bloco terminal Phoenix de 4 vias queria dizer adivinhar
primeiro o numero de vias, achar a linha 'CONECTOR 4V' no meio de 25 irmas ordenadas
alfabeticamente (10V, 12V, 13V, ..., 2V, 20V) e so entao ler 25 rotulos quase iguais. E metade
do acervo -- 148 dos 291 valores -- nem estava la: caia num balde unico chamado
'CONECTOR [PINAGEM A DEFINIR]', porque o extrator de vias so conhecia a palavra "N vias" e o
Phoenix escreve o numero de vias no meio do part number ("MC 1,5/ 4-G-3,81": o 4 e a via, o
1,5 e a bitola do cabo em mm²).

A troca: a familia passa a ser o SUBTIPO ('CONECTOR BLOCO TERMINAL'), que e como a bancada
pede a peca, e as vias descem para o rotulo do valor. Isso reorganiza tres coisas de uma vez,
porque as tres saem da familia: a lista da esquerda do hub, o nome do simbolo
(almox2lib.nome_simbolo_basico) e o arquivo .SchLib (schlib_escritor.balde_de -> nome_arquivo).

O QUE ESTE ARQUIVO NAO FAZ: nao mexe no `rotulo`. O rotulo e a chave do livro-razao
(Libs/almox-parts.json, via almox2lib.numera_valores) e metade da identidade do valor
(agrupar() chaveia por (rotulo, encapsulamento)). Dois produtos com o mesmo rotulo VIRAM UM
VALOR SO, com o estoque somado. Medido no dump de 2026-09-16: o rotulo curto que o usuario
pediu para a tela -- "4 vias 3.81 180" -- colide em 205 dos 337 conectores, e as colisoes nao
sao gemeos: '2 vias 5.08 90' junta sete blocos terminais Phoenix diferentes, macho E femea.
Por isso os campos saem daqui SOLTOS, um a um, e quem os junta numa linha e a TELA
(hub-almoxpick.js), onde juntar nao funde nada.

CAMPO VAZIO E RESPOSTA. Em CIRCULAR MIL, REGUA TERMINAL, SOQUETE e BAIONETA o passo e o
angulo nao existem como propriedade da peca -- nao e dado faltando. O angulo so sai quando o
nome diz 90 ou 180 com todas as letras (94 de 327); a tentacao de deduzi-lo da letra V das
familias Phoenix (MCV, MSTBV) foi medida e recusada: esse V e a direcao de ENTRADA DO FIO, que
nao e o mesmo eixo do 180/90 que headers e KK escrevem. Preencher 70 blocos terminais com um
palpite faria a tela afirmar o que ninguem mediu.
"""
import re

import unicodedata


def fold(s):
    """minuscula e sem acento — a mesma dobra do familias.fold1, sem a exigencia 1:1.

    Aqui nada recorta o nome ORIGINAL por indice (e o que obriga o familias.fold1 a ser
    1:1), entao esta pode ser a normalizacao honesta do unicodedata.
    """
    d = unicodedata.normalize('NFD', s or '')
    return ''.join(c for c in d if not unicodedata.combining(c)).lower()


# ─── subtipos ─────────────────────────────────────────────────────────────────
# A ORDEM IMPORTA: a primeira que casa vence, e o especifico vem antes do generico.
# 'header com trava' antes de 'header'; o bloco terminal, que e o maior grupo (133 itens) e o
# que tem mais nomes de serie, vem por ULTIMO entre os de conector porque as series dele
# ('MC', 'EK') sao curtas e casariam dentro de palavras de outros subtipos.
#
# As series Phoenix e as dos clones (AKZ, KF, EK, GSP, STLZ, HB, ZB) estao aqui porque no
# Odoo metade dos blocos terminais NAO tem a palavra "bloco terminal" no nome: a linha e
# "Conector Macho MSTB 2,5/ 8-GF-5,08 (1776566)" e a unica pista do subtipo e a serie.
_PHX = (r'mstbv|mvstbr|mvstb|mstb|mcvw|mcv|mkdsn|mkdso|mkkds|mkds|fkcn|fkct|fkdso|fkc'
        r'|fk-mcp|ek-mcp|gmstb|gmkds|smkdsn|dfk-mstb|akz|kf ?350|kf ?128|kf2edg|kfhb'
        r'|ek ?381|ek ?508|gsp001|stlz|hb ?9500|zb ?55|zba ?601|ddk ?18|3pcv'
        r'|\bmc ?\d|\bmcp ?\d')

_SUBTIPOS = [
    # acessorio primeiro: "Carcaca De Conector", "Pino De Conector Inserto" sao PARTES de
    # conector, nao conectores, e casariam o subtipo da peca-mae se viessem depois
    (r'carcaca|\binserto\b|aliviador|ferramentas,|ferramentas e acess|caixa de cabos'
     r'|pino de conector', 'ACESSORIO'),
    (r'baioneta|ca06a\d', 'BAIONETA'),
    # SEM TRAVA vem PRIMEIRO desde que a regra de "com trava" afrouxou. O cadastro novo
    # escreve so "Header trava 2x5 10 vias", sem o "c/" — e um `header.*trava` que viesse
    # antes engoliria tambem "header sem trava", que e a peca oposta.
    (r'header[^,]*?(?:s/|sem)\s*trava', 'HEADER SEM TRAVA'),
    (r'header[^,]*?trava', 'HEADER COM TRAVA'),
    (r'\blatch\b', 'LATCH'),
    (r'\bkk\b|molex|alojamento', 'KK'),
    (r'\bjst\b|shr-\d', 'JST'),
    (r'barra de pinos', 'BARRA DE PINOS'),
    (r'regua terminal|bloco terminal de barreira|barra termoplastico|sindal'
     r'|\bbtsp\b|\bbbptc\b|\bbdmu\b|\btep-\d', 'REGUA TERMINAL'),
    # o soquete de rele nao tem a palavra: no cadastro ele e a BASE do rele
    (r'soquete|base p/ ?rele|base para rele', 'SOQUETE'),
    (r'\bdb\d|trapezoidal|sub-?d\b', 'DB'),
    (r'circular mil|circular mike|\bmil spec\b|\bweipu\b|\bdelphi\b|ms3\d{3}|pt0\d[a-z]?-'
     r'|amphenol', 'CIRCULAR MIL'),
    (r'rj ?45|ethernet', 'RJ45'),
    (r'\busb\b', 'USB'),
    # o jack P4 e pedido pela MEDIDA ("Cabo conector 5.5x2.5mm fonte Macho")
    (r'\bjack\b|plug(?:ue)? p4|5[.,]5 ?x ?2[.,][15]', 'JACK'),
    (r'conector plano|slot edge|\bedge\b', 'PLANO'),
    (r'cartao (?:micro )?sd|micro ?sd\b', 'CARTAO SD'),
    (r'clip para bateria|porta.?fusivel', 'ACESSORIO DE PAINEL'),
    (r'poliamida|para terra|\bsak\b', 'TERRA'),
    # "BORNER" e como algumas linhas do cadastro escrevem borne
    (r'\bborner?s?\b', 'BORNE'),
    # "Bloco P/PCB Com/Fix 4 vias" e bloco terminal sem a palavra "terminal"
    (r'bloco terminal|de bloco\b|mini bloco|bloco p/? ?pcb|' + _PHX, 'BLOCO TERMINAL'),
    # terminal de desconexao rapida: tipo proprio, nao e plugue nem acessorio
    (r'\bfaston\b', 'FASTON'),
    (r'\bplug\b|conector e plug', 'PLUGUE'),
]
SUBTIPOS = [(re.compile(rx), s) for rx, s in _SUBTIPOS]

# a familia que o familias.py ja devolve e que este modulo re-etiqueta
FAMILIAS_CONECTOR = ('CONECTOR', 'BARRA DE PINOS')


def subtipo(nome):
    """'BLOCO TERMINAL', 'KK'... ou '' quando nenhuma regra casa.

    Vazio nao e erro: e o degrade certo. A familia fica 'CONECTOR' puro e o item aparece
    na lista sob esse nome, em vez de ser empurrado para um balde 'OUTROS' que so diz
    'nao sei' com mais palavras.
    """
    f = fold(nome)
    for rx, s in SUBTIPOS:
        if rx.search(f):
            return s
    return ''


def familia_com_subtipo(fam, nome):
    """'CONECTOR' + 'Conector Bloco Terminal MC...' -> 'CONECTOR BLOCO TERMINAL'.

    BARRA DE PINOS vira subtipo de CONECTOR (e o que a bancada chama de conector), e por
    isso entra aqui em vez de continuar familia propria.
    """
    if fam not in FAMILIAS_CONECTOR:
        return fam
    s = subtipo(nome)
    if not s and fam == 'BARRA DE PINOS':
        s = 'BARRA DE PINOS'
    return ('CONECTOR ' + s) if s else 'CONECTOR'


# ─── vias ─────────────────────────────────────────────────────────────────────
# O numero de vias e o campo que decide a PINAGEM do simbolo, entao ele nao pode ser chute:
# cada pista abaixo foi medida contra o dump inteiro e listada com o que ela resgata.
# Total: 173 itens sem vias -> 30.

# 1. a palavra. `pos` fica, `p` sozinho SAI: o regex antigo lia "RJ45 P/ PCB" como 45 vias, e
#    e dai que vinha o simbolo fantasma 'CONECTOR 45V', com um unico valor dentro (o RJ45).
_VIAS_PALAVRA = re.compile(
    r'(\d+)\s*-?\s*(?:vias?|pinos?|pins?|bornes?|polos?|posicoes|terminais|contatos'
    r'|niveis|pos\b)')

# 2. a matriz: "2x13", "1x40", "4x25". Recusa decimal dos dois lados, senao
#    "jack painel 5.5 x 2.5mm" vira 10 vias (medido: 1 falso positivo em 327).
_VIAS_MATRIZ = re.compile(r'(?<![0-9.,])(\d{1,2})\s*[x*]\s*(\d{1,3})(?![0-9.,])')

# 3. Phoenix e clones: "MC 1,5/ 4-G-3,81" -> 4. O numero ANTES da barra e a bitola do cabo em
#    mm² (2,5 em 54 linhas, 1,5 em 49); o de DEPOIS e a contagem de vias. O `(?:\s*hc)?` e
#    pela serie de alta corrente ("MSTB 2,5 HC/ 2-STF"), 4 itens.
_VIAS_PHX = re.compile(r'(?:' + _PHX + r')[\w.,-]*\s*\d+(?:[.,]\d+)?(?:\s*h[cv])?\s*/\s*-?\s*(\d+)')

# 4. AKZ/STLZ escrevem em grupos soltos: "AKZ 602 04 3,81" -> 4, "STLZ 950 02F 5,08" -> 2.
_VIAS_AKZ = re.compile(r'(?:akz|stlz)\s*\d{3}\s*/?\s*(\d{1,2})[a-z]?\b')

# 5. sufixo -NNP do clone chines: "EK508V-02P", "KF350-3,50-4P", "MSTBV 5.08/13P".
#    O P E COLADO NO NUMERO, sem espaco. Aceitar espaco no meio reintroduz por outra porta
#    exatamente o bug que a pista 1 acabou de perder: "RJ45 P/ PCB" volta a valer 45 vias.
_VIAS_NNP = re.compile(r'(?<![0-9.,])(\d{1,3})p\b')

# 6. o proprio nome do conector de video/serial: DB9 -> 9, DB25 -> 25.
_VIAS_DB = re.compile(r'\bdb(\d{1,2})\b')

# 7. soquete de CI: "DIP 40", "[ste-28]", "(MCI-15)".
_VIAS_DIP = re.compile(r'\bdip\s*(\d{1,2})\b|\bste-(\d{1,2})\b|\bmci-(\d{1,2})\b')

# 8. codigos de serie que terminam na contagem: BTSP-12, BBPTC-22, BPSC-40, BPSN-40.
_VIAS_CODIGO = re.compile(r'\b(?:btsp|bbptc|bbptp|bdmu|bpsc|bpsn|bpdc|tep)-?(\d{1,2})\b')

# 9. o que a peca E. Nao e leitura do nome, e propriedade do tipo: um RJ45 tem 8 contatos.
#    So entra quando nenhuma pista do nome respondeu.
_VIAS_POR_TIPO = {'RJ45': 8, 'USB': 4, 'CARTAO SD': 9, 'JACK': 3}


def vias(nome, sub=None):
    """o numero de vias, ou 0 quando o nome nao diz.

    0 nao e "zero vias": e "nao sei", e o gerador o trata assim (o simbolo vai para
    [PINAGEM A DEFINIR] em vez de nascer com uma pinagem inventada).
    """
    f = fold(nome)
    # o numero de pedido entre parenteses ("(1827761)") nao e contagem de nada
    f = re.sub(r'\(\s*\d{6,}\s*\)', ' ', f)

    # o teto era 80 (familias.vias_de) e cortava peca que existe no estoque: o header com
    # trava de 100 vias (4x25) e o conector plano de 96 (3x32) voltavam 0 e iam para o
    # balde de pinagem indefinida por serem grandes demais, nao por serem ilegiveis
    def ok(n):
        return n if 1 <= n <= 128 else 0

    m = _VIAS_PALAVRA.search(f)
    if m and ok(int(m.group(1))):
        return int(m.group(1))
    m = _VIAS_MATRIZ.search(f)
    if m:
        n = ok(int(m.group(1)) * int(m.group(2)))
        if n:
            return n
    for rx in (_VIAS_PHX, _VIAS_AKZ, _VIAS_DB, _VIAS_CODIGO, _VIAS_NNP):
        m = rx.search(f)
        if m and ok(int(m.group(1))):
            return int(m.group(1))
    m = _VIAS_DIP.search(f)
    if m:
        n = ok(int(next(g for g in m.groups() if g)))
        if n:
            return n
    return _VIAS_POR_TIPO.get(sub or subtipo(nome), 0)


def matriz(nome):
    """'2x13' quando o nome traz a matriz, senao ''.

    Ela nao cabe na contagem de vias e some sem deixar rastro: 1x8 e 2x4 tem OITO VIAS os
    dois e footprints diferentes. Sem este campo, "8 vias 2.54 180" juntaria na tela a barra
    simples de 8, a femea 2x4 e a macho 2x4 dupla.
    """
    m = _VIAS_MATRIZ.search(fold(nome))
    return ('%sx%s' % (m.group(1), m.group(2))) if m else ''


# ─── passo ────────────────────────────────────────────────────────────────────
# Os passos de catalogo. A lista fechada e o que separa passo de bitola, de diametro de pino
# e de comprimento de corpo: qualquer numero em mm que nao esteja aqui nao e passo.
# 2.5 e 2.54 sao os DOIS passos de verdade (2,5 mm metrico e 0,1" = 2,54), e o mesmo vale
# para 5.08 contra um "5,0" digitado. Por isso a leitura e EXATA primeiro e so encaixa o que
# nao bater exato: com encaixe por folga, 2,54 caia em 2,5 e 1,27 em 1,25, e a tela passava a
# anunciar um passo metrico para um conector de polegada.
PASSOS = (1.0, 1.27, 2.0, 2.5, 2.54, 3.5, 3.81, 3.96, 5.08,
          6.35, 7.5, 7.62, 9.5, 10.0)
# ...e os que NUNCA sao passo quando aparecem antes da barra do Phoenix: ali sao bitola de
# cabo em mm². Medido: 113 linhas tem o padrao, e em 110 o numero e bitola (2,5 em 54 linhas,
# 1,5 em 49, 3 em 4, 1 em 3). Nas outras 3 e passo mesmo ("MSTBV 5.08/10P").
_BITOLAS = (1.0, 1.5, 2.5, 3.0)

_PASSO_PALAVRA = re.compile(r'(?:passo|espacamento(?: entre pinos)?)\s*:?\s*(\d+[.,]?\d*)')
# o sufixo do part number: "-3,81", "-5,08 (1827729)", "MC 1,5/ 6-G-3,81"
_PASSO_SUFIXO = re.compile(r'-\s*(\d[.,]\d{1,2})\b')
_PASSO_MM = re.compile(r'(?<![0-9.,])(\d+[.,]?\d*)\s*mm\b')
_PASSO_BARRA = re.compile(r'(?:' + _PHX + r')[\w-]*\s*(\d+[.,]\d+)\s*/')
# o passo cravado no codigo do clone: EK508 = 5.08, KF350 = 3.5, HB9500 = 9.5
_PASSO_CODIGO = [
    (re.compile(r'ek ?508|akz ?250|akz ?700|akz ?950|gsp001[a-z]?w?-?5[.,]08'), 5.08),
    (re.compile(r'ek ?381|akz ?602'), 3.81),
    (re.compile(r'kf ?350'), 3.5),
    (re.compile(r'kf ?128|kf2edg'), 2.54),
    (re.compile(r'hb ?9500|kfhb ?9500'), 9.5),
    (re.compile(r'zb ?55|zba ?601'), 10.0),
    (re.compile(r'3pcv'), 6.35),
]
# o "2mm"/"4mm" do borne banana e o DIAMETRO DO PINO, nao passo. Sao 7 linhas.
_NAO_E_PASSO = re.compile(r'(?:p(?:ara)?/? ?pino|seguranca|pino)\s*(?:de\s*)?\d')


def _num(t):
    try:
        return float(str(t).replace(',', '.'))
    except ValueError:
        return None


def _encaixa(v):
    """o passo de catalogo mais proximo, quando o numero lido esta a 0,1 mm dele.

    Existe por causa de tres digitacoes do Odoo: '5,0' no lugar de 5,08 em quatro linhas
    (MSTB 2,5/ 3-GF-5,0 e irmas). 5,0 nao e passo de catalogo nenhum e 5,08 e o da serie
    inteira; encaixar e ler a intencao, nao inventar dado. A folga e curta de proposito --
    o outro erro visto, '5,8' (MSTB 2,5/17-STF-5,8), fica de fora e sai sem passo, porque
    a 0,72 mm de distancia ja nao da para afirmar qual era.
    """
    if v is None:
        return None
    if v in PASSOS:
        return v                     # exato ganha sempre: 2,5 e 2,54 sao passos diferentes
    perto = min(PASSOS, key=lambda p: abs(v - p))
    return perto if abs(v - perto) < 0.1 else None


def passo(nome):
    """o passo em mm (float) ou None quando o nome nao diz.

    None e frequente e e resposta: em CIRCULAR MIL, DB, RJ45, USB, BAIONETA e SOQUETE o
    passo nao existe como propriedade da peca.
    """
    f = fold(nome)
    f = re.sub(r'\(\s*\d{6,}\s*\)', ' ', f)          # numero de pedido nao e medida
    for rx, v in _PASSO_CODIGO:
        if rx.search(f):
            return v
    m = _PASSO_PALAVRA.search(f)
    p = _encaixa(_num(m.group(1))) if m else None
    if p:
        return p
    m = _PASSO_SUFIXO.search(f)
    p = _encaixa(_num(m.group(1))) if m else None
    if p:
        return p
    m = _PASSO_BARRA.search(f)
    if m:
        v = _num(m.group(1))
        # so vale como passo quando e de catalogo E nao e uma das bitolas
        if v is not None and v not in _BITOLAS:
            p = _encaixa(v)
            if p:
                return p
    if not _NAO_E_PASSO.search(f):
        for m in _PASSO_MM.finditer(f):
            p = _encaixa(_num(m.group(1)))
            if p:
                return p
    # O PASSO ESCRITO SOLTO, sem o "mm": "Barra de Pinos 5.08 linhas 10 vias Macho 180g".
    # So vale um DECIMAL que seja passo de catalogo, e so quando o nome NAO tem serie
    # Phoenix — porque la o decimal solto e a bitola do cabo ("MSTB 2,5 HC/ 4-STF" e passo
    # 5,08, e 2,5 esta na tabela de passos). Sem essa trava, 54 blocos terminais passariam
    # a anunciar 2,5 mm de passo, que e o numero errado com cara de certo.
    if not re.search(_PHX, f):
        for m in re.finditer(r'(?<![0-9.,])(\d+[.,]\d+)(?![0-9])', f):
            p = _encaixa(_num(m.group(1)))
            if p:
                return p
    return None


def passo_txt(p):
    """5.08 -> '5.08', 3.5 -> '3.5', None -> '' — o texto que a tela mostra"""
    if p is None:
        return ''
    return ('%.2f' % p).rstrip('0').rstrip('.')


# ─── angulo ───────────────────────────────────────────────────────────────────
# So o explicito. Ver o cabecalho: deduzir do V do Phoenix foi medido e recusado.
#
# O `g\b` e o padrao NOVO do cadastro ("180g", "90g", de graus), e ele nao entrava por
# acidente de regex: entre o "0" e o "g" nao ha fronteira de palavra, entao a alternativa
# `\b` solta do fim nao casava e o angulo saia vazio. Medido contra os 618 conectores do
# Odoo de producao em 2026-09-22: 96 nomes ja no padrao novo, e o extrator lia ZERO deles.
_ANGULO = re.compile(r'(?<![0-9.,])(90|180)\s*(?:°|º|o\b|g\b|graus\b|\b)')
_VERTICAL = re.compile(r'\bvertical\b|\d[.,]\d+\s*(?:mm)?\s*v\b|-v-')


def angulo(nome):
    """90, 180 ou 0 quando o nome nao diz."""
    f = fold(nome)
    # o numero de pedido entre parenteses ("(1803578)") tem 90 e 180 dentro dele o tempo
    # todo; sem tirar, dois blocos terminais liam 180 de um numero de pedido
    f = re.sub(r'\([^)]*\)', ' ', f)
    achados = {int(m.group(1)) for m in _ANGULO.finditer(f)}
    if len(achados) == 1:
        return achados.pop()
    if achados:
        return 0                     # o nome diz os dois: nao afirma nenhum
    return 180 if _VERTICAL.search(f) else 0


# ─── genero ───────────────────────────────────────────────────────────────────
# Phoenix: G/GF = base (macho, fica na placa), ST/STF = plugue (femea). Circulares
# MIL: sufixo P = pin (macho), S = socket (femea).
_MACHO = re.compile(r'\bmacho\b|\bmale\b')
_FEMEA = re.compile(r'\bfemea\b|\bfemale\b')
_PHX_MACHO = re.compile(r'-\s*g[f]?\s*-|\bg[f]?\b\s*-\s*\d[.,]\d')
_PHX_FEMEA = re.compile(r'-\s*st[f]?\s*-|\bst[f]?\b\s*-?\s*\d?[.,]?\d*')
_MIL_MACHO = re.compile(r'(?:ms3\d{3}[a-z]?\d*[a-z]*|pt0\d[a-z]-\d+(?:s|-\d+)?)-?\d*p\b')
_MIL_FEMEA = re.compile(r'(?:ms3\d{3}[a-z]?\d*[a-z]*|pt0\d[a-z]-\d+(?:s|-\d+)?)-?\d*s\b')


def genero(nome):
    """'macho', 'femea' ou '' — e '' quando o nome traz os dois (kit, par)."""
    f = fold(nome)
    m, fe = bool(_MACHO.search(f)), bool(_FEMEA.search(f))
    if m and not fe:
        return 'macho'
    if fe and not m:
        return 'femea'
    if m and fe:
        return ''                                    # kit/par: nao e nem um nem outro
    m, fe = bool(_PHX_MACHO.search(f)), bool(_PHX_FEMEA.search(f))
    if m != fe:
        return 'macho' if m else 'femea'
    m, fe = bool(_MIL_MACHO.search(f)), bool(_MIL_FEMEA.search(f))
    if m != fe:
        return 'macho' if m else 'femea'
    return ''


# ─── tipo (o codigo do fabricante) ────────────────────────────────────────────
# E o '[MC 1.5/ 4-G-3.81]' do pedido: o que desempata duas linhas que, em vias/passo/angulo,
# sao identicas. NAO e o `mpn` do familias.py -- aquele so le colchetes ou ' - XXX ', e 310
# dos 337 conectores nao tem nenhum dos dois.
# A SERIE SO COM LETRAS. O `_PHX` la de cima nao serve aqui: a alternativa dele para a serie
# MC e `\bmc ?\d`, que ENGOLE o primeiro digito da bitola -- depois de casar "MC 1", o resto
# do padrao pedia outro numero e nao achava, e "MC 1,5/2-STF-3,81" saia sem codigo nenhum.
_PHX_SERIE = (r'mstbv|mvstbr|mvstb|mstb|mcvw|mcv|mkdsn|mkdso|mkkds|mkds|fkcn|fkct|fkdso'
              r'|fkc|fk-mcp|ek-mcp|gmstb|gmkds|smkdsn|dfk-mstb|mcp|mc')
_TIPO_PHX = re.compile(
    r'((?:' + _PHX_SERIE + r')\s*\d+(?:[.,]\d+)?(?:\s*h[cv])?\s*/\s*-?\s*\d+\s*'
    r'-?\s*[a-z]*\s*-?\s*\d*(?:[.,]\d+)?)', re.I)
# AKZ e STLZ escrevem a serie separada por espaco ("AKZ 602 04 3,81"), o que o
# `[\w./-]*` do padrao geral nao atravessa
_TIPO_AKZ = re.compile(r'((?:akz|stlz)\s*\d{3}(?:\s*/?\s*\d{1,2}[a-z]?)?(?:\s*-?\s*\d[.,]\d+)?)',
                       re.I)
_TIPO_CODIGO = re.compile(
    r'\b((?:ek|kf|kfhb|hb|zb|zba|gsp|btsp|bbptc|bbptp|bdmu|bpsc|bpsn|bpdc|tep'
    r'|mci|ste|shr|sa|ds|dm|mem|bor|bo|ms3|pt0)[\w./-]*\d[\w./-]*)\b', re.I)
_PARENTESE = re.compile(r'\(([^)]{2,})\)')
_COLCHETE = re.compile(r'\[([^\]]{2,})\]')


def _serve_de_tipo(t, mat):
    """um candidato a codigo so vale se ACRESCENTA alguma coisa a linha.

    Dois candidatos enganam. O colchete `[KK]` e o nome do subtipo, que ja esta na familia:
    devolvido como codigo, as quatro linhas de alojamento KK vinham com 'KK' na coluna da
    direita e a serie de verdade (2510 contra 5051, que sao alojamentos diferentes) ficava
    de fora. E o parentese `(2x3)` e a MATRIZ, que a propria linha ja mostra.
    """
    if not t or len(t) > 24:
        return False
    if not re.search(r'\d', t):
        return False                                 # sem digito nao e codigo de peca
    f = fold(t).replace(' ', '')
    if f == fold(mat).replace(' ', ''):
        return False
    # "[4 vias]", "[12 Vias]": a regua terminal poe a CONTAGEM entre colchetes, e o colchete
    # e o primeiro lugar onde se procura part number. Tres reguas de series diferentes
    # (BBPTC-4, BTSP-04N, Ref.201/RB) vinham todas com o codigo "4 vias" e ficavam
    # indistinguiveis na lista; recusado aqui, a busca desce para a serie de verdade.
    return not re.fullmatch(r'\d+(?:vias?|pinos?|polos?|bornes?|contatos?)', f)


def tipo(nome, mat=None):
    """o codigo de tipo do fabricante, ou ''.

    A ordem e por confiabilidade: o padrao Phoenix inteiro (que ja carrega serie, bitola,
    vias e passo), depois o colchete, depois um codigo de serie conhecido, e por ultimo o
    parentese -- so quando NAO e numero de pedido. Numero de pedido Phoenix tem 6 ou 7
    digitos ('(1827761)'); a serie Molex tem 4 ('(2510)', '(5051)') e e informacao de
    verdade: e o que separa o alojamento KK 2510 do 5051.
    """
    mat = matriz(nome) if mat is None else mat
    for achar in (_TIPO_PHX, _TIPO_AKZ):
        m = achar.search(nome)
        if m:
            return re.sub(r'\s+', ' ', m.group(1)).strip(' -')
    for achar in (_COLCHETE, _TIPO_CODIGO):
        for m in achar.finditer(nome):
            t = m.group(1).strip(' .-')
            if _serve_de_tipo(t, mat):
                return t
    for m in _PARENTESE.finditer(nome):
        t = m.group(1).strip()
        if re.fullmatch(r'\d{6,}', t):
            continue                                 # numero de pedido, nao tipo
        if _serve_de_tipo(t, mat):
            return t
    return ''


# ─── tudo de uma vez ──────────────────────────────────────────────────────────
def campos(nome, fam):
    """{'subtipo','vias','matriz','passo','angulo','genero','tipo'} para um nome do Odoo.

    Devolve None quando a familia nao e de conector — assim quem chama nao precisa saber
    a lista de familias.
    """
    if fam not in FAMILIAS_CONECTOR and not (fam or '').startswith('CONECTOR'):
        return None
    sub = subtipo(nome)
    mat = matriz(nome)
    return {
        'subtipo': sub,
        'vias': vias(nome, sub),
        'matriz': mat,
        'passo': passo(nome),
        'angulo': angulo(nome),
        'genero': genero(nome),
        'tipo': tipo(nome, mat),
    }


def rotulo_curto(c):
    """os campos numa linha, como a tela os mostra: '4 vias (2x2) 3.81 180 macho'.

    Existe aqui, e nao so no JS, porque o relatorio do gerador e os testes precisam da
    MESMA frase que o hub pinta — duas montagens da mesma linha divergiriam na primeira
    mudanca. NAO e o `rotulo` do valor: ver o cabecalho deste arquivo.
    """
    if not c:
        return ''
    p = []
    if c['vias']:
        p.append('%d via%s' % (c['vias'], '' if c['vias'] == 1 else 's'))
    if c['matriz']:
        p.append('(%s)' % c['matriz'])
    if c['passo'] is not None:
        p.append(passo_txt(c['passo']))
    if c['angulo']:
        p.append('%d' % c['angulo'])
    if c['genero']:
        p.append(c['genero'])
    return ' '.join(p)
