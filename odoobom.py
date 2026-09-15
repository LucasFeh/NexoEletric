# -*- coding: utf-8 -*-
"""A lista de materiais do Odoo trazida para cima do esquema.

    python odoobom.py --projeto "DMB - DI231765_P2"              # acha a PCB e mostra o casamento
    python odoobom.py --projeto "DMB - DI231765_P2" --tmpl 1121  # ja sabendo qual PCB

O caminho inverso do `odoolista.py`. Ali o esquema vai para a fila do estoque; aqui a lista
de materiais da PCB **volta** e diz quais componentes do almoxarifado o projeto antigo
deveria estar usando. Nada e gravado por este arquivo: ele so LE (Odoo, espelho, projeto) e
devolve a tabela para a pessoa conferir na tela (`hub-odoobom.js`).

O QUE A BoM TEM E O QUE ELA NAO TEM — medido na base real antes de escrever uma linha:

  tem     product_id e quantidade, por linha (mrp.bom.line)
  NAO tem DESIGNADOR. Nenhum campo, nem custom. Entao "qual R e qual" nao vem do Odoo, e
          nenhuma heuristica inventa isso: o casamento e por GRUPO, e quem confirma e gente.
  NAO tem o esquema inteiro. Na placa medida, 16 linhas para 21 componentes: 7 dos 18 grupos
          do esquema sao alcancados e 11 nao tem linha nenhuma. Por isso a tela mostra DUAS
          listas — sem a segunda, quem aplica ve 7 migrados e conclui que a ferramenta falhou.
  tem     insumo que nao e componente: fio de rolo, fibra virgem, cabo montado. Saem pela
          REGRA 0, antes de disputar grupo com alguem.

A unidade e o DESIGNADOR, nunca o item do arquivo: `CN1` sao 16 itens `comp` (um por via do
conector) e a BoM pede 1. Agrupar por item pediria 16 conectores. A regra de eleger a parte
de menor numero como portadora da identidade e a mesma do `odoolista.py`.
"""
import argparse
import io
import json
import os
import re
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

ESPELHOS = ('almox-basicos.js', 'almox-especiais.js')

# Categorias do Odoo que NUNCA sao componente de folha. E um veto, nunca um sinal positivo:
# o proprio SN74HC245DWR esta arquivado sob "Broca Aco Rapido", entao categoria so presta
# para dizer "isto certamente nao e", jamais "isto e".
CATEGORIA_INSUMO = ('fio', 'cabo', 'fibra', 'solda', 'estanho', 'verniz', 'parafuso', 'porca')

# Prefixo de designador -> pedacos que a familia do almoxarifado tem de conter. E um GATE:
# barra tudo que nao case, e nao pontua nada quando casa. Prefixo desconhecido nao barra.
GATE = {
    'R':  ('RESISTOR',),
    'C':  ('CAPACITOR',),
    'L':  ('INDUTOR', 'FERRITE'),
    'D':  ('DIODO', 'LED', 'PONTE'),
    'Q':  ('TRANSISTOR', 'MOSFET', 'IGBT'),
    'T':  ('TRANSISTOR', 'MOSFET', 'TRANSFORMADOR'),
    'U':  ('CIRCUITO', 'AMPLIFICADOR', 'TRANSCEPTOR', 'REGULADOR', 'MEMORIA', 'MODULO',
           'TIMER', 'OPTO', 'MICROCONTROLADOR', 'CONVERSOR', 'DRIVER', 'SENSOR'),
    'CN': ('CONECTOR', 'BARRA', 'BORNE', 'JACK', 'SOQUETE'),
    'J':  ('CONECTOR', 'BARRA', 'BORNE', 'JACK', 'JUMPER', 'SOQUETE'),
    'K':  ('RELE',),
    'F':  ('FUSIVEL',),
    'SW': ('CHAVE', 'BOTAO', 'DIP'),
    'X':  ('CRISTAL', 'OSCILADOR'),
}
GATE['CI'] = GATE['U']
GATE['S'] = GATE['SW']

STOP = set('''de do da para com sem em e o a os as um uma vias via passo tipo modelo serie
smd pth mm cm un pct rolo radial axial macho femea conector capacitor resistor diodo barra
pinos circuito impresso placa montada virgem'''.split())

PISO = 15          # abaixo disto a linha nao vira sugestao: fica como "nao e componente"
RAZAO_ALTA = 4.0   # top1/top2 daqui para cima, mais sinal medido: confianca alta


# ─── texto ────────────────────────────────────────────────────────────────────
def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '')
                   if unicodedata.category(c) != 'Mn')


def norm(s):
    return re.sub(r'\s+', ' ', sem_acento(str(s or '')).upper()).strip()


def tokens(s):
    brutos = re.split(r'[^0-9A-Za-z\.]+', sem_acento(str(s or '')).lower())
    return {t for t in brutos if t and len(t) > 1 and t not in STOP}


def contem(a, b):
    """quanto de `a` esta dentro de `b` — NAO e Jaccard, e a diferenca importa.

    O nome do produto no Odoo e longo ("[G-51-3] Conector Latch 16 vias (2x8) passo 2.54mm
    180o") e o da folha e curto ("CONECTOR LATCH FEMEA"). Com Jaccard o denominador cresce
    com o lado longo e o footprint que casa INTEIRO tira nota 0.12; com contencao tira 1.00,
    que e o que ele merece. Medido: com Jaccard o CN1 ficava em 10 pontos, abaixo do piso, e
    a linha do conector latch virava descarte."""
    if not a or not b:
        return 0.0
    return len(a & b) / float(len(a))


# ─── valor eletrico ───────────────────────────────────────────────────────────
MULT = {'p': 1e-12, 'n': 1e-9, 'u': 1e-6, 'm': 1e-3, '': 1.0, 'k': 1e3, 'M': 1e6}

# COM UNIDADE EXPLICITA, e so. A primeira versao disto aceitava prefixo sozinho e colhia
# "74" de SN74HC245DWR como 74 henries e "3.96mm" como 3,96 mili — duas medidas inventadas
# que davam 50 pontos a quem nao merecia nenhum. O olhar-para-tras barra numero colado em
# letra (o 74 de SN74) e o olhar-para-frente barra mm/mil/min, que sao dimensao, nao valor.
# o olhar-para-frente barra DIGITO tambem: sem isso '4R7' era lido aqui como '4R' = 4 ohms,
# e a notacao R-no-lugar-da-virgula (que o RX_R le certo, 4.7) ganhava um 4.0 fantasma junto
RX_UNI = re.compile(r'(?<![A-Za-z0-9.])(\d+(?:[.,]\d+)?)\s*(p|n|u|µ|m|k|K|M)?\s*(F|H|Ω|R|ohms?|OHMS?)(?![A-Za-z0-9])')
# a notacao que usa o prefixo no lugar da virgula: 4R7, 10K, 2M2. So vale onde OHM e a
# unidade obvia, isto e, num designador R — por isso `ohm=True` nao e o padrao.
RX_R = re.compile(r'(?<![A-Za-z0-9.])(\d+)(R|K|M)(\d*)(?![A-Za-z0-9])')


def valores_eletricos(txt, ohm=False):
    """{grandezas} do texto, em unidade base: '0.1uF' e '100nF' viram 1e-07, '10K' vira 1e4.

    So serve para R/L/C, e e o sinal mais PRECISO que existe aqui: quando fala, nao erra.
    O alcance e curto de proposito — 'SN74HC245DWR' nao tem valor eletrico nenhum, e a
    versao que achava que tinha era pior do que nao ter sinal."""
    t = str(txt or '')
    fora = set()
    for m in RX_UNI.finditer(t):
        try:
            v = float(m.group(1).replace(',', '.'))
        except ValueError:
            continue
        pref = m.group(2) or ''
        if pref in ('u', 'µ'):
            pref = 'u'
        if pref == 'K':
            pref = 'k'
        fora.add(round(v * MULT.get(pref, 1.0), 15))
    if ohm:
        for m in RX_R.finditer(t):
            inteiro, pref, dec = m.group(1), m.group(2), m.group(3)
            try:
                v = float(inteiro + ('.' + dec if dec else ''))
            except ValueError:
                continue
            fora.add(round(v * MULT.get(pref.lower() if pref != 'M' else 'M', 1.0), 15))
    return fora


# ─── leitura do espelho e do projeto ──────────────────────────────────────────
def le_var_js(caminho):
    txt = io.open(caminho, encoding='utf-8').read()
    return json.loads(txt[txt.index('=') + 1:].strip().rstrip(';').strip())


def carrega_espelho(raiz=RAIZ):
    """-> {product_id: {familia, valor, ...}} e a lista de valores, do espelho do almoxarifado."""
    por_odoo, valores = {}, []
    for f in ESPELHOS:
        cam = os.path.join(raiz, 'Libs', f)
        if not os.path.isfile(cam):
            continue
        for sim in le_var_js(cam).get('symbols', []):
            for v in sim.get('valores') or []:
                reg = {'familia': sim.get('name'), 'altium': v.get('altium'),
                       'label': v.get('label'), 'value': v.get('value'),
                       'mpn': v.get('mpn') or '', 'pkgs': v.get('pkgs') or [],
                       'footprint': v.get('footprint') or '', 'id': v.get('id'),
                       'params': v.get('params') or [], 'valor': v}
                valores.append(reg)
                for it in v.get('itens') or []:
                    por_odoo.setdefault(str(it.get('odoo')), reg)
    return por_odoo, valores


def le_comps(raiz, projeto):
    """os itens `comp` do schematic.js, um JSON por linha (o formato schmirror-v2).

    Parseia a linha e olha o CAMPO `t`, em vez de procurar a string `"t":"comp"`. O hub
    escreve sem espaco depois dos dois-pontos, mas isso e o estilo do serializador e nao o
    formato: um arquivo escrito com espaco (json.dumps padrao, uma edicao a mao) casava zero
    componente e a tela dizia "este projeto nao tem componente" sem erro nenhum."""
    cam = os.path.join(raiz, 'Projects', projeto, 'schematic.js')
    fora = []
    for linha in io.open(cam, encoding='utf-8'):
        # a virgula pode estar nos DOIS lados: o hub grava ",{...}" no fim da linha e o
        # TCMS_Reader_V2 (exportado noutra epoca) grava ",{...}" no comeco. Tirando so de um
        # lado, o arquivo inteiro era pulado em silencio e o projeto aparecia sem componente.
        linha = linha.strip().strip(',').strip()
        if not linha.startswith('{'):
            continue
        try:
            o = json.loads(linha)
        except ValueError:
            continue
        if isinstance(o, dict) and o.get('t') == 'comp':
            fora.append(o)
    return fora


def par_de(params, chave):
    m = re.search(re.escape(chave) + r'=([^;]*)', params or '')
    return m.group(1).strip() if m else ''


def prefixo(ref):
    m = re.match(r'^([A-Za-z]+)', str(ref or ''))
    return (m.group(1) if m else '').upper()


def componentes(comps):
    """os itens viram COMPONENTES: um por designador, com a parte de menor numero como
    portadora da identidade. `CN1` sao 16 itens e UM componente — e a BoM conta assim."""
    porref = {}
    for c in comps:
        ref = c.get('ref') or ''
        atual = porref.get(ref)
        if atual is None or (c.get('part') or 1) < (atual['carreg'].get('part') or 1):
            porref.setdefault(ref, {'ref': ref, 'itens': [], 'carreg': c})['carreg'] = c
        porref.setdefault(ref, {'ref': ref, 'itens': [], 'carreg': c})['itens'].append(c)
    for r in porref.values():
        r['partes'] = len(r['itens'])
        r['multiparte'] = r['partes'] > 1
    return list(porref.values())


def grupos_do_esquema(comps):
    """componentes com a MESMA identidade viram um grupo — e o grupo e a unidade do vinculo.

    A chave inclui `params`, e isso nao e detalhe: sem ele, R3 (Value=10R) e R4 (Value=47K)
    caem no mesmo grupo, porque os dois carregam o mesmo `comment` de formula do Altium
    (`=Value + ' - ' + Potencia...`) que nunca foi avaliada. Fundidos, nenhum dos dois casa
    com o resistor certo da BoM."""
    por_chave = {}
    for comp in componentes(comps):
        c = comp['carreg']
        chave = (c.get('sym') or '', c.get('footprint') or '', c.get('comment') or '', c.get('params') or '')
        g = por_chave.setdefault(chave, {
            'sym': c.get('sym') or '', 'footprint': c.get('footprint') or '',
            'comment': c.get('comment') or '', 'params': c.get('params') or '',
            'refs': [], 'comps': [], 'multiparte': False, 'partes': 0,
        })
        g['refs'].append(comp['ref'])
        g['comps'].append(comp)
        g['multiparte'] = g['multiparte'] or comp['multiparte']
        g['partes'] = max(g['partes'], comp['partes'])
    fora = []
    for i, g in enumerate(sorted(por_chave.values(), key=lambda x: x['refs'][0]), 1):
        g['id'] = 'G%d' % i
        g['refs'].sort()
        # o comment de formula nao diz nada; o Value do params diz. O texto EFETIVO do grupo
        # e o que sobrar dos dois — sem isto o sinal de valor eletrico cai para zero.
        formula = g['comment'].strip().startswith('=')
        g['valor_txt'] = par_de(g['params'], 'Value')
        g['texto'] = ' '.join(x for x in ([] if formula else [g['comment']])
                              + [g['valor_txt'], g['sym']] if x)
        fora.append(g)
    return fora


# ─── o casamento ──────────────────────────────────────────────────────────────
def e_insumo(linha, reg):
    """REGRA 0, antes de qualquer pontuacao: a linha e componente de folha, ou insumo?"""
    if reg is None:
        return 'o product_id nao esta no espelho do almoxarifado'
    cat = norm(linha.get('categoria') or '')
    nome = norm(linha.get('nome') or '')
    for t in CATEGORIA_INSUMO:
        if t.upper() in cat:
            return 'categoria do Odoo: %s' % (linha.get('categoria') or '')
    if 'CABO FLAT' in nome or 'ROLO' in nome:
        return 'e material montado/de rolo, nao componente da folha'
    return None


def pontua(reg, grupo, linha=None):
    """quanto o COMPONENTE do almoxarifado (reg) parece ser o que o grupo ja e.

    -> (pontos, [razoes]). Os pesos sao a ordem de forca MEDIDA nos dados reais: valor
    eletrico e MPN nao erram quando falam; texto e o unico que fala quase sempre; footprint
    so presta atras do gate de designador, porque '0805' casa capacitor com resistor.

    O `linha` entra porque o NOME DO PRODUTO NO ODOO e o texto mais rico dos tres — o
    "Conector Latch 16 vias (2x8) passo 2.54mm 180o" diz coisas que nem o `altium` do espelho
    nem o `label` dizem, e e ele que casa com o footprint "CONECTOR LATCH FEMEA" da folha."""
    pontos, razoes = 0, []

    # gate por designador: barra, nao pontua
    fam = norm(reg['familia'])
    pref = prefixo(grupo['refs'][0])
    esperado = GATE.get(pref)
    if esperado and not any(e in fam for e in esperado):
        return 0, ['designador %s nao combina com a familia %s' % (pref, reg['familia'])]

    # valor eletrico — preciso, alcance curto. Ohm sem unidade so vale em designador R.
    so_ohm = pref == 'R'
    ve_g = valores_eletricos(grupo['valor_txt'] or grupo['comment'], so_ohm)
    ve_r = valores_eletricos((reg['value'] or '') + ' ' + (reg['label'] or ''), so_ohm)
    if ve_g and ve_r:
        if ve_g & ve_r:
            pontos += 50
            razoes.append('valor eletrico bate (%s)' % ', '.join('%g' % x for x in sorted(ve_g & ve_r)))
        else:
            pontos -= 25
            razoes.append('valor eletrico DIFERE')

    # MPN literal — ouro quando existe
    mpn = re.sub(r'[\s-]', '', norm(reg['mpn']))
    if mpn and len(mpn) >= 5:
        alvo = re.sub(r'[\s-]', '', norm(grupo['comment'] + ' ' + grupo['sym']))
        if mpn in alvo:
            pontos += 40
            razoes.append('MPN %s aparece no componente' % reg['mpn'])

    # texto: o unico sinal que fala quase sempre. O que vale e o ranking, nao a nota.
    lado_odoo = tokens(' '.join(x for x in [reg['label'], reg['altium'],
                                            (linha or {}).get('nome')] if x))
    j = contem(tokens(grupo['texto']), lado_odoo)
    if j > 0:
        pontos += int(round(j * 30))
        razoes.append('texto do componente (%.0f%%)' % (j * 100))

    # o NOME do footprint contra o nome do produto — pega o que o codigo de package nao pega
    jf = contem(tokens(grupo['footprint']), lado_odoo)
    if jf > 0:
        pontos += int(round(jf * 25))
        razoes.append('footprint no nome do produto (%.0f%%)' % (jf * 100))

    # codigo de package, so depois do gate
    pk = {norm(p) for p in (reg['pkgs'] or []) if p}
    if reg['footprint']:
        pk.add(norm(reg['footprint']))
    if pk:
        fp = norm(grupo['footprint'])
        if any(p and p in fp for p in pk):
            pontos += 10
            razoes.append('encapsulamento no footprint')

    return pontos, razoes


def casa(linhas, grupos, por_odoo):
    """-> (sugestoes, descartes). Exclusao mutua: um grupo nao pode ser prometido a duas
    linhas. Empate exato NAO e desempatado por criterio inventado — vai para a mao, com as
    duas candidatas nomeadas. Foi a decisao que manteve o placar em zero vinculo errado."""
    sugestoes, descartes = [], []
    cands = []
    for ln in linhas:
        reg = por_odoo.get(str(ln['product_id']))
        motivo = e_insumo(ln, reg)
        if motivo:
            descartes.append(dict(ln, motivo=motivo, componente=(reg or {}).get('altium')))
            continue
        notas = []
        for g in grupos:
            p, r = pontua(reg, g, ln)
            if p > 0:
                notas.append({'grupo': g['id'], 'pontos': p, 'razoes': r})
        notas.sort(key=lambda x: -x['pontos'])
        cands.append({'linha': ln, 'reg': reg, 'notas': notas})

    # DUAS LINHAS QUE EMPATAM NO MESMO GRUPO NAO PRE-SELECIONAM NENHUMA. O par
    # "Kk 4 vias Femea" x "Kk 4 vias macho" pontua exatamente igual contra o CN4, porque o
    # comment da folha ("KK / 3.96mm/ 4 vias") nao diz o genero — nenhum sinal medivel separa
    # as duas. Desempatar por ordem de chegada escolheu a femea, que era a errada: um vinculo
    # errado APLICADO, que e o unico tipo de erro que esta tela nao pode cometer. Erro de
    # omissao (mandar para a mao o que daria para sugerir) custa um clique; erro de comissao
    # reescreve o componente de uma placa.
    disputa = {}
    for c in cands:
        if c['notas']:
            t = c['notas'][0]
            disputa.setdefault((t['grupo'], t['pontos']), []).append(c)
    empatados = {id(c) for chave, lst in disputa.items() if len(lst) > 1 for c in lst}

    # o mais confiante escolhe primeiro
    cands.sort(key=lambda c: -(c['notas'][0]['pontos'] if c['notas'] else 0))
    tomados = {}
    for c in cands:
        ln, reg, notas = c['linha'], c['reg'], c['notas']
        topo = notas[0] if notas else None
        if not topo or topo['pontos'] < PISO:
            descartes.append(dict(ln, motivo='nenhum grupo do esquema se parece com ela'
                                  + (' (melhor: %d pontos)' % topo['pontos'] if topo else ''),
                                  componente=reg['altium'], familia=reg['familia']))
            continue
        segundo = notas[1]['pontos'] if len(notas) > 1 else 0
        # empate DENTRO da linha (dois grupos igualmente bons) ou ENTRE linhas (duas linhas
        # brigando pelo mesmo grupo com a mesma nota) — os dois vao para a mao
        empate = segundo == topo['pontos'] or id(c) in empatados
        dono = tomados.get(topo['grupo'])
        s = {
            'product_id': ln['product_id'], 'nome': ln['nome'], 'qtd': ln['qtd'],
            'componente': reg['altium'], 'familia': reg['familia'], 'valorId': reg['id'],
            'grupo': topo['grupo'], 'pontos': topo['pontos'], 'razoes': topo['razoes'],
            'alternativas': [n['grupo'] for n in notas[1:4]],
            'confianca': 'alta' if (not empate and segundo and topo['pontos'] / float(segundo) >= RAZAO_ALTA)
                         or (not empate and not segundo and topo['pontos'] >= 40)
                         else ('mao' if empate or dono else 'media'),
        }
        if empate:
            outras = [o['linha']['nome'] for o in disputa.get((topo['grupo'], topo['pontos']), [])
                      if o is not c]
            s['aviso'] = ('empata com %s — nenhum sinal medivel separa as duas; escolha na mao'
                          % (', '.join(x[:44] for x in outras) if outras
                             else 'outro grupo do esquema, nos mesmos pontos'))
            s['empatadaCom'] = outras
        elif dono:
            s['aviso'] = 'o grupo %s ja foi sugerido para "%s"' % (topo['grupo'], dono)
        else:
            tomados[topo['grupo']] = ln['nome']
        sugestoes.append(s)
    sugestoes.sort(key=lambda s: (s['confianca'] != 'alta', s['confianca'] != 'media', -s['pontos']))
    return sugestoes, descartes


def monta(raiz, projeto, linhas):
    """junta os tres lados e devolve o que a tela precisa, incluindo a LISTA INVERSA."""
    por_odoo, _ = carrega_espelho(raiz)
    grupos = grupos_do_esquema(le_comps(raiz, projeto))
    sugestoes, descartes = casa(linhas, grupos, por_odoo)
    cobertos = {s['grupo'] for s in sugestoes}
    return {
        'projeto': projeto,
        'grupos': grupos,
        'sugestoes': sugestoes,
        'descartes': descartes,
        # sem esta lista quem aplica ve 7 migrados de 21 e conclui que a ferramenta falhou
        'semLinha': [g['id'] for g in grupos if g['id'] not in cobertos],
    }


# ─── Odoo (so leitura) ────────────────────────────────────────────────────────
def conecta():
    import odoo_pull as OP
    cfg = OP.le_config()
    return OP.Odoo(cfg['url'], cfg['db'], cfg['login'], cfg['senha']), cfg


def pcbs_do_projeto(o, projeto):
    """os product.template que podem ser a PCB deste projeto, com a BoM de cada um.

    O nome no Odoo nao e o do projeto: "DMB - DI231765_P2" vira "Placa de Circuito Impresso
    (Montada) PDMB-DI231765_P2 REV. B". O ilike pelo nome sem espacos ao redor do hifen acha
    os quatro parentes (Montada, Virgem e a variante _32S) — quem escolhe e a pessoa, porque
    escolher a placa errada e o erro mais caro desta tela."""
    termos = [projeto, projeto.replace(' - ', '-'), projeto.replace(' - ', '-').replace(' ', '')]
    vistos, fora = set(), []
    for t in termos:
        if not t:
            continue
        for x in o.call('product.template', 'search_read',
                        [[('name', 'ilike', t)], ['id', 'name', 'default_code']], {'limit': 40}):
            if x['id'] in vistos:
                continue
            vistos.add(x['id'])
            boms = o.call('mrp.bom', 'search_read',
                          [[('product_tmpl_id', '=', x['id'])], ['id', 'code', 'bom_line_ids']],
                          {'limit': 3})
            fora.append({'tmpl': x['id'], 'nome': x['name'], 'codigo': x.get('default_code') or '',
                         'boms': [{'id': b['id'], 'codigo': b.get('code') or '',
                                   'linhas': len(b['bom_line_ids'])} for b in boms],
                         # "(Montada)" e a placa com componentes; "(Virgem)" e so a fibra
                         'montada': 'MONTADA' in norm(x['name'])})
    fora.sort(key=lambda p: (not p['montada'], not p['boms'], p['nome']))
    return fora


def linhas_da_bom(o, bom_id):
    b = o.call('mrp.bom', 'read', [[bom_id], ['bom_line_ids']])
    if not b:
        return []
    ids = b[0]['bom_line_ids']
    if not ids:
        return []
    cru = o.call('mrp.bom.line', 'read', [ids, ['product_id', 'product_qty', 'sequence']])
    pids = [l['product_id'][0] for l in cru if l.get('product_id')]
    cat = {}
    if pids:
        for p in o.call('product.product', 'read', [pids, ['id', 'categ_id']]):
            cat[p['id']] = (p['categ_id'] or [0, ''])[1]
    fora = []
    for l in cru:
        if not l.get('product_id'):
            continue
        pid = l['product_id'][0]
        fora.append({'product_id': pid, 'nome': l['product_id'][1],
                     'qtd': l.get('product_qty') or 0, 'sequencia': l.get('sequence') or 0,
                     'categoria': cat.get(pid, '')})
    fora.sort(key=lambda x: (x['sequencia'], x['nome']))
    return fora


def main(argv=None):
    ap = argparse.ArgumentParser(description='a lista de materiais do Odoo sobre o esquema')
    ap.add_argument('--projeto', required=True)
    ap.add_argument('--tmpl', type=int, help='o product.template da PCB, se voce ja sabe')
    ap.add_argument('--raiz', default=RAIZ)
    a = ap.parse_args(argv)

    o, cfg = conecta()
    print('Odoo %s (base %s)' % (cfg['url'], cfg['db']))
    pcbs = pcbs_do_projeto(o, a.projeto)
    if not pcbs:
        print('nenhuma PCB no Odoo casa com %r' % a.projeto)
        return 1
    print('\nPCBs que casam com %r:' % a.projeto)
    for p in pcbs:
        print('   tmpl %-6s %-72s %s' % (p['tmpl'], p['nome'][:72],
              ', '.join('bom %s (%d linhas)' % (b['id'], b['linhas']) for b in p['boms']) or 'sem BoM'))
    alvo = next((p for p in pcbs if p['tmpl'] == a.tmpl), None) if a.tmpl else \
        next((p for p in pcbs if p['montada'] and p['boms']), None)
    if not alvo or not alvo['boms']:
        print('\nescolha uma com --tmpl')
        return 1
    print('\nusando: %s (bom %s)' % (alvo['nome'], alvo['boms'][0]['id']))
    linhas = linhas_da_bom(o, alvo['boms'][0]['id'])
    r = monta(a.raiz, a.projeto, linhas)

    print('\n%d linha(s) na BoM, %d grupo(s) no esquema\n' % (len(linhas), len(r['grupos'])))
    print('SUGESTOES DE VINCULO')
    porid = {g['id']: g for g in r['grupos']}
    for s in r['sugestoes']:
        g = porid[s['grupo']]
        print('  [%-5s] %-46s -> %-34s %s (%s)' % (
            s['confianca'], s['nome'][:46], s['componente'][:34], s['grupo'], ', '.join(g['refs'])[:24]))
        print('          %s%s' % ('; '.join(s['razoes'])[:96], '  !! ' + s['aviso'] if s.get('aviso') else ''))
    print('\nDESCARTES (nao sao componente da folha)')
    for d in r['descartes']:
        print('  %-50s %s' % (d['nome'][:50], d['motivo'][:56]))
    print('\nGRUPOS DO ESQUEMA SEM LINHA NA BoM (%d de %d)' % (len(r['semLinha']), len(r['grupos'])))
    for gid in r['semLinha']:
        g = porid[gid]
        print('  %-4s %-22s %-34s %s' % (gid, ', '.join(g['refs'])[:22], g['sym'][:34],
              ('%d partes' % g['partes']) if g['multiparte'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
