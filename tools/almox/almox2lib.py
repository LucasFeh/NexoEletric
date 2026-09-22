# -*- coding: utf-8 -*-
"""Gera as duas bibliotecas de esquema do almoxarifado a partir do dump do Odoo.

    python tools/almox/almox2lib.py                 # regera do snapshot em disco
    python tools/almox/almox2lib.py --pull          # puxa o Odoo (incremental) e regera
    python tools/almox/almox2lib.py --pull --full   # ... relendo o catalogo inteiro
    python tools/almox/almox2lib.py --podar         # renumera as parts do zero

A lib ACUMULA, nao e recriada: o numero de uma part, uma vez dado, e daquele valor para
sempre (Libs\\almox-parts.json guarda o mapa). Valor novo entra na posicao ordenada da
LISTA mas leva o proximo numero livre; valor que sai do Odoo nao devolve o numero - fica
com saldo zero e `fora: true`. Sem isso, um resistor novo de valor baixo empurraria todas
as parts seguintes, e o "parte 47" de um esquema ja desenhado passaria a apontar para
outro componente.

O DESENHO TAMBEM ACUMULA, desde 2026-09-14: este gerador so CRIA o que nao existe.
Simbolo que ja esta no espelho sai daqui com a geometria que o espelho tem hoje — a
autoridade sobre o desenho e do HTML (o editor de simbolos do hub), e uma sincronizacao
nunca a reescreve. Veja `geometria_congelada`. O resto continua vindo do Odoo a cada
rodada: valores, saldo, local, custo, footprint, parametros. Congelou o desenho, nao a
ficha.

EXCLUIR E APAGAR, E O ODOO E QUEM DECIDE SE VOLTA (mudado em 2026-09-17). Este gerador
NAO consulta lista de exclusao nenhuma: o que esta no CSV vira componente. Excluir pelo
hub apaga o valor do espelho, e a proxima geracao decide sozinha o destino dele:

  - ainda existe no Odoo -> e remontado do CSV, com o mesmo id. Excluir por engano se
    conserta puxando de novo;
  - nao existe mais no Odoo (o duplicado do tempo em que o cadastro nao tinha padrao de
    nome) -> so existia porque estava no espelho anterior, entao morre de vez.

Libs\\almox-excluidos.json continua existindo, mas como REGISTRO do que foi apagado e
quando — quem o le e a tela, nao o gerador.

Escreve em Libs\\:
    almox-basicos.js       espelho (formato schlib-v2, o mesmo que o hub ja le)
    almox-especiais.js     idem
    almox-index.js         registro das bibliotecas, para o combobox da config
    almox-sync.js          o que mudou em relacao a geracao anterior
    almox-parts.json       o mapa de numeros de part (rotulo -> numero), por simbolo
E em tools/almox\\relatorio.txt o que entrou, o que ficou de fora e por que.

A divisao pedida:
  BASICOS   - mesmo simbolo e mesmos pinos, muitos valores. Uma part por valor,
              em ordem crescente; todos os encapsulamentos da familia ficam
              associados ao simbolo (o vinculo de footprint vem depois).
  ESPECIAIS - pinagem propria. Agrupados por familia + numero de pinos do
              encapsulamento; a part e o part number (ou "24/5" nos conversores).
"""
import argparse, csv, io, json, os, re, sys, collections, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
LIBS = os.path.join(RAIZ, 'Libs')
sys.path.insert(0, BASE)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import familias as F                                    # noqa: E402
import simbolos as SY                                   # noqa: E402
from classificar import CSV_ODOO, canon_ohm             # noqa: E402


# ─── nomes ────────────────────────────────────────────────────────────────────
def nome_simbolo_basico(fam, mont, vias):
    """RESISTOR [SMD] · CONECTOR 4V [PTH] · BATERIA (familia sem montagem declarada)"""
    suf = (' [%s]' % mont) if mont else ''
    return '%s %dV%s' % (fam, vias, suf) if vias else fam + suf


def montagem_dominante(itens):
    """Metade do dump nao diz SMD/PTH, e um terceiro simbolo "[SEM MONT]" por
       familia so fragmenta. A regra: se a MAIORIA da familia declara montagem, o
       omisso herda a dominante; se nao declara (LED 3mm, potenciometro), a
       familia inteira fica sem sufixo em vez de inventar um split que o Odoo
       nao sustenta."""
    tot = collections.Counter(a['familia'] for a in itens)
    cont = collections.defaultdict(collections.Counter)
    for a in itens:
        if a['mont']:
            cont[a['familia']][a['mont']] += 1
    dom = {}
    for fam, n in tot.items():
        c = cont.get(fam)
        dom[fam] = c.most_common(1)[0][0] if c and sum(c.values()) * 2 >= n else None
    return dom


def montagem_declarada(itens):
    """A montagem que os proprios itens de um VALOR declaram — pelo encapsulamento (SOIC8,
    DIP8) ou por palavra no nome do Odoo ("(PTH)", "SMD") — e nunca a que o `classifica`
    presumiu pela dominante da familia (`mont_presumida`). Itens que discordam entre si (o
    mesmo part number em DIP e em SOIC) nao afirmam nada: ''."""
    m = {x['mont'] for x in itens if x.get('mont') and not x.get('mont_presumida')}
    return m.pop() if len(m) == 1 else ''


def nome_simbolo_especial(fam, npinos):
    return '%s [%dP]' % (fam, npinos) if npinos else '%s [PINAGEM A DEFINIR]' % fam


# ─── chaves de ordenacao ──────────────────────────────────────────────────────
_NUM = re.compile(r'(\d+(?:[.,]\d+)?)')


def chave_natural(s):
    """ordena '2W' antes de '10W' - digito por digito nao serve"""
    out = []
    for p in _NUM.split(s or ''):
        try:
            out.append((0, float(p.replace(',', '.')), ''))
        except ValueError:
            out.append((1, 0.0, p.lower()))
    return out


def chave_conversor(rotulo):
    """'24/5 2W' -> ordena por saida, depois por entrada"""
    m = re.match(r'^([\d.~]+)/([±\+\-]?[\d.~]+)', rotulo or '')
    if not m:
        return (1e18, 1e18)
    def prim(t):
        t = t.lstrip('±+-')
        try:
            return float(t.split('~')[0])
        except ValueError:
            return 1e17
    return (prim(m.group(2)), prim(m.group(1)))


# ─── footprints conhecidos (marca o que ja existe na PcbLib espelhada) ────────
def carrega_pcblib():
    p = os.path.join(LIBS, 'pcblib.js')
    if not os.path.exists(p):
        return set()
    txt = io.open(p, encoding='utf-8', errors='replace').read()
    return set(re.findall(r'\{"name":"([^"]+)"', txt))


def norm_fp(n):
    return re.sub(r'[^a-z0-9]', '', (n or '').lower())


# ─── montagem das familias ────────────────────────────────────────────────────
def classifica(a, dominante):
    """De um item analisado para (simbolo, rotulo, grupo, forma, npin).

    Estava embutido no agrupar; saiu porque agora e preciso saber o rotulo de TODOS os
    itens antes de montar qualquer simbolo — e a unica forma de descobrir que dois part
    numbers diferentes cairiam no mesmo valor."""
    fam, gr = a['familia'], a['grupo']
    forma, vias = a['forma'], a['vias']
    # UM SIMBOLO POR SUBTIPO DE CONECTOR, e o numero de vias NAO entra no nome dele.
    # A pinagem e atributo do COMPONENTE, nao de um simbolo diferente: o bloco terminal de
    # 4 e o de 10 sao o mesmo tipo de peca, com contagem diferente. Cada valor carrega o
    # proprio desenho (`valores[].parts`, montado no monta_simbolo a partir das vias), que
    # e um recurso que o formato ja tinha — no .SchLib cada valor ja e um componente
    # proprio, com geometria propria. O que muda aqui e so parar de fabricar um SIMBOLO por
    # contagem: eram 116 para 326 valores, e a aba Biblioteca e o painel de bibliotecas do
    # Altium mostravam "CONECTOR BARRA DE PINOS 10V, 12V, 13V…" onde tem de haver um.
    conector = bool(a.get('conn'))
    if conector:
        # a montagem tambem nao parte o conector. No Odoo ela e quase toda PTH e serve so
        # para rachar um subtipo em dois ("CONECTOR PLANO" e "CONECTOR PLANO [PTH]").
        a['mont'] = ''
        return fam, (a['rotulo'] or a['mpn'] or 'S/ VALOR'), 'b', 'conn', vias

    if dominante.get(fam) is None:
        a['mont'] = ''                       # familia sem split de montagem
    elif not a['mont']:
        a['mont'] = dominante[fam]
        a['mont_presumida'] = True

    if gr == 'b' and forma in ('rede', 'dipsw') and not vias:
        # rede/dipsw sem numero de vias no nome: a pinagem seria chute, entao
        # ele vai para os especiais, onde o vinculo ja e manual
        gr, forma = 'e', 'box'

    if gr == 'b':
        npin = vias if forma in ('conn', 'rede', 'dipsw') else 0
        if forma == 'sw' and vias and vias > 2:
            npin = vias
        nome = nome_simbolo_basico(fam, a['mont'], npin)
        rotulo = a['rotulo'] or a['mpn'] or 'S/ VALOR'
    else:
        npin = a['pinos_pkg']
        nome = nome_simbolo_especial(fam, npin)
        if fam.startswith('CONVERSOR'):
            vin, vout = F.conversor_io(a['nome'])
            pot = F.POT_W.search(a['nome'])
            rotulo = ('%s/%s' % (vin, vout)) if vin and vout else (a['mpn'] or a['rotulo'])
            if vin and vout and pot:
                rotulo += ' ' + pot.group(1).replace(',', '.') + 'W'
        else:
            rotulo = a['mpn'] or a['rotulo'] or 'S/ REFERENCIA'
    return nome, rotulo, gr, forma, npin


def agrupar(itens):
    """itens analisados -> {nome_simbolo: {...}} para basicos e especiais"""
    dominante = montagem_dominante(itens)
    fila = [(a,) + classifica(a, dominante) for a in itens]

    # O PART NUMBER DECLARADO FAZ PARTE DA IDENTIDADE, sempre. O Odoo o escreve entre
    # colchetes ("Diodo de Comutacao de Sinal [BAW56] SMD") e o limpa_rotulo o tirava do
    # rotulo porque ele tem campo proprio — so que ai BAV70, BAW56 e 1N4148WS viravam um
    # unico valor chamado "de Sinal", com um footprint so, um mpn so e o estoque dos tres
    # somado. BAV70 e BAW56 sao duplos SOT-23 de pinagem OPOSTA: erro de bancada.
    #
    # A primeira versao so desempatava quando os colchetes divergiam. Isso conserta o caso
    # visto, mas deixa a garantia dependendo de quem mais esta no mesmo saco: o mesmo item
    # tem nome com part number ou sem ele conforme os vizinhos. Duas pecas com nome
    # declarado NUNCA se fundem, e o nome que o almoxarifado escreveu nao se perde no
    # caminho — que e a regra que o usuario pediu.
    #
    # Nos especiais isto ja valia: la o rotulo e o proprio MPN (veja classifica()).
    simbolos = {}
    for a, nome, rotulo, gr, forma, npin in fila:
        fam = a['familia']
        pn = a.get('mpn_expl') or ''
        if pn and pn.upper() not in rotulo.upper():
            # o rotulo as vezes ja traz o part number ENCURTADO ("BAT85" para o
            # "BAT85S-TAP" do colchete): por os dois lado a lado nao acrescenta nada
            repetido = any(len(t) >= 5 and pn.upper().startswith(t.upper())
                           for t in re.split(r'[^A-Za-z0-9]+', rotulo))
            if repetido:
                pass
            elif rotulo in ('', 'S/ VALOR'):
                rotulo = pn
            elif fam.startswith('DIODO') and not re.search(r'\d', rotulo):
                # Num diodo o part number E o nome: ninguem procura "diodo de sinal",
                # procura BAV70. O que sobra do nome do Odoo quando nao ha especificacao
                # nenhuma ("de Sinal") e ruido na frente dele. Onde HA especificacao
                # ("6.2V 500mW 1N753") ela fica, porque e por ela que se acha um zener —
                # e e ela que da a ordem crescente da lista.
                rotulo = pn
            else:
                rotulo = rotulo + ' ' + pn

        s = simbolos.get(nome)
        if not s:
            s = simbolos[nome] = {
                'nome': nome, 'familia': fam, 'grupo': gr, 'des': a['des'],
                'forma': forma, 'npin': npin, 'mont': a['mont'],
                'unidade': a['unidade'], 'parts': collections.OrderedDict(),
                'pkgs': collections.Counter(), 'cats': collections.Counter(),
                'vias_cnt': collections.Counter(),
            }
        # a contagem de vias de todos os itens do simbolo. So o conector usa: o `npin` dele
        # deixou de sair do primeiro item que criou o simbolo (o que e acaso, e com um
        # simbolo por subtipo passou a ser acaso VISIVEL — o desenho da familia inteira) e
        # passa a ser a pinagem mais comum do subtipo, resolvida no fim desta funcao.
        if a.get('conn') and a['vias']:
            s['vias_cnt'][a['vias']] += 1
        if a['pkg']:
            s['pkgs'][a['pkg']] += 1
        if a['categoria']:
            s['cats'][a['categoria']] += 1

        # O ENCAPSULAMENTO FAZ PARTE DA IDENTIDADE, como o part number acima. Dois produtos
        # do Odoo com o MESMO valor e encapsulamentos diferentes sao pecas diferentes: tem
        # saldo proprio, local proprio na prateleira e footprint proprio. Agrupados pelo
        # rotulo sozinho, viravam um componente so com dois `itens` e uma lista `pkgs` de
        # dois -- e a tela mostrava "2 itens do Odoo neste valor", que foi como o dono
        # achou isto. Medido antes da mudanca: 26 valores em 2513 misturavam assim, sendo
        # um deles o "SMD 0603 1K 1/4W 1% 100ppm", que juntava o resistor 0603 e o 1206.
        chave = (rotulo, a['pkg'] or '')
        p = s['parts'].get(chave)
        if not p:
            p = s['parts'][chave] = {'rotulo': rotulo, 'encap': a['pkg'] or '',
                                     'valor': a['valor'], 'valor_txt': a['valor_txt'],
                                     'itens': []}
        if p['valor'] is None and a['valor'] is not None:
            p['valor'], p['valor_txt'] = a['valor'], a['valor_txt']
        p['itens'].append(a)

    # A CHAVE DO LIVRO-RAZAO so muda para quem se DIVIDIU, e so para os extras. O id de uma
    # part, uma vez dado, e daquele valor para sempre (Libs/almox-parts.json), e um rotulo
    # que ate ontem era um componente so nao pode perder o numero dele: o encapsulamento
    # alfabeticamente primeiro -- que ja era o que batizava o nome, porque `pkgs` sai
    # ordenado -- FICA com a chave limpa e com o id. Os outros nascem componentes novos,
    # com chave propria e numero novo. Assim nenhum esquema ja desenhado muda de peca.
    for s in simbolos.values():
        porrot = collections.defaultdict(list)
        for (rot, enc) in s['parts']:
            porrot[rot].append(enc)
        for rot, encs in porrot.items():
            # O VAZIO VAI PARA O FIM, e isso nao e detalhe: o NOME do componente sai de
            # `pkgs`, que descarta encapsulamento vazio (monta_simbolo), entao quem batiza o
            # valor hoje e o primeiro encap NAO VAZIO. Ordenar com o vazio na frente fazia o
            # item sem encapsulamento herdar a chave limpa -- e o id -- de um valor cujo
            # nome pertence ao outro. Medido: o "PTH DO-35 1N4148" perdia o id 48 para um
            # "PTH 1N4148" recem-nascido. Seis valores mudavam de numero por isso.
            primeiro = sorted(encs, key=lambda e: (e == '', e))[0]
            for enc in encs:
                pt = s['parts'][(rot, enc)]
                pt['chave'] = (rot if enc == primeiro
                               else ('%s %s' % (rot, enc) if enc else rot + ' (sem encap)'))

    # a pinagem do DESENHO DA FAMILIA do conector: a mais comum do subtipo, com empate
    # resolvido pela menor. Ela e so a previa — cada valor desenha com as vias dele.
    for s in simbolos.values():
        c = s.pop('vias_cnt', None)
        if c:
            s['npin'] = min(c, key=lambda n: (-c[n], n))
    return simbolos


def ordena_parts(s):
    ps = list(s['parts'].values())
    if s['familia'].startswith('CONVERSOR'):
        ps.sort(key=lambda p: (chave_conversor(p['rotulo']), chave_natural(p['rotulo'])))
    elif s['grupo'] == 'b':
        # o pedido e explicito: do menor valor para o maior. Sem valor lido do
        # nome, vai para o fim, em ordem natural.
        ps.sort(key=lambda p: (0, p['valor'], chave_natural(p['rotulo']))
                if p['valor'] is not None else (1, 0.0, chave_natural(p['rotulo'])))
    else:
        ps.sort(key=lambda p: chave_natural(p['rotulo']))
    return ps


# ─── serializacao ─────────────────────────────────────────────────────────────
def par(n, v):
    return {'n': n, 'v': '' if v is None else str(v)}


def carrega_reciclagem():
    """{nome_do_simbolo: [(footprint, e_o_atual)]} vindo da biblioteca real do usuario.

    Sem isto o espelho listaria o encapsulamento do Odoo ("0805") e a .SchLib teria o
    footprint da casa ("RES 0805") - dois nomes para a mesma coisa, e o BuildSchematic
    perdido no meio."""
    try:
        import schlib_escritor as ESC
        _cab, comps = ESC.carrega_lib()
    except Exception as e:                                  # noqa: BLE001
        # Cair aqui em silencio ja custou caro: sem a lib da casa a geracao perde os
        # footprints reciclados E o cabecalho de documento, e as .SchLib saiam abrindo com
        # a folha PRETA no Altium. O CABECALHO_PADRAO do escritor cobre a folha; este aviso
        # cobre o resto, que ninguem ve ate abrir o Altium.
        print('AVISO: a biblioteca da casa nao pode ser lida (%s: %s)' % (type(e).__name__, e))
        print('       as libs vao sair SEM footprint reciclado — confira a rede antes de usar')
        return {}, None
    return comps, ESC


def geometria_congelada(nome, antes):
    """O desenho que JA ESTA no espelho, se houver — (parts, bbox, partcount) ou None.

    A REGRA DE AUTORIDADE, desde 2026-09-14: o desenho e do HTML. Este gerador so CRIA o
    que nao existe; simbolo que ja esta no espelho sai daqui com a geometria que ele tem
    hoje, venha ela do `simbolos.py` de uma geracao antiga, do editor de simbolos do hub ou
    do guardiao. Nada do que o usuario desenhou volta a ser redesenhado por uma
    sincronizacao — que continua trazendo do Odoo TODO o resto (valores, saldo, local,
    custo, footprint, parametros): o que congelou foi o desenho, nao a ficha.

    Antes disto, cada rodada reescrevia `parts` a partir do `simbolos.py` e o guardiao
    repunha por cima o que estava protegido. Funcionava para o protegido e so para ele: o
    que fosse desenhado no hub sem virar protecao — ou cuja protecao tivesse sido retirada
    pelo caminho do Altium — voltava ao desenho generico no sincronismo seguinte, calado.
    """
    v = (antes or {}).get(nome)
    if not isinstance(v, dict):
        return None
    parts = v.get('parts')
    if not isinstance(parts, list) or not parts:
        return None
    bb = v.get('bbox') if isinstance(v.get('bbox'), dict) else None
    return parts, bb, (v.get('partcount') if isinstance(v.get('partcount'), int) else len(parts))


def conn_do_valor(itens):
    """Os campos de conector de um VALOR, a partir dos itens do Odoo que caem nele.

    Um valor pode juntar mais de uma linha do Odoo (mesmo rotulo, mesmo encapsulamento).
    Campo em que os itens DISCORDAM nao afirma nada e sai vazio — a mesma regra do
    `montagem_declarada` logo acima, e pelo mesmo motivo: um numero de vias tirado do
    primeiro item de dois desenharia a pinagem de um e o rotulo do outro.
    """
    cs = [x['conn'] for x in itens if x.get('conn')]
    if not cs:
        return None
    fora = {}
    for k in ('subtipo', 'vias', 'matriz', 'passo', 'angulo', 'genero', 'tipo'):
        vals = {c.get(k) for c in cs}
        fora[k] = vals.pop() if len(vals) == 1 else (0 if k in ('vias', 'angulo') else
                                                     None if k == 'passo' else '')
    return fora


def monta_simbolo(s, reais, mapa=None, antes=None, podar=False, recicl=None, fpman=None):
    pins, gfx = SY.desenha(s['forma'], s['npin'], rotulo=s['familia'] if s['forma'] == 'box' else '')
    ps = ordena_parts(s)
    x1, y1, x2, y2 = SY.bbox(pins, gfx)
    # o desenho de quem ja existe vem do espelho, nao do simbolos.py (ver acima)
    congelado = geometria_congelada(s['nome'], antes)
    if congelado and congelado[1]:
        b = congelado[1]
        x1, y1, x2, y2 = b.get('x1', x1), b.get('y1', y1), b.get('x2', x2), b.get('y2', y2)

    modelos = []
    # primeiro os footprints que vem do simbolo reciclado: sao os da casa, existem na
    # PcbLib e sao os nomes que a .SchLib gerada realmente carrega
    for nome_fp, atual in (recicl or {}).get(s['nome'], []):
        modelos.append({'name': nome_fp, 'incurrentlib': norm_fp(nome_fp) in reais,
                        'current': atual or not modelos, 'daCasa': True})
    for pkg, _n in s['pkgs'].most_common():
        if any(m['name'] == pkg for m in modelos):
            continue
        modelos.append({'name': pkg, 'incurrentlib': norm_fp(pkg) in reais,
                        'current': not modelos})

    # O prefixo da familia nos nomes da casa: o que vem ANTES do encapsulamento em
    # "RES 0805" e "RES 1206" e "res". Depende so do simbolo, entao sai do laco dos valores.
    prefixos_da_casa = set()
    for m in modelos:
        if not m.get('daCasa'):
            continue
        nm = norm_fp(m['name'])
        for pk_casa in s['pkgs']:
            i = nm.find(norm_fp(pk_casa))
            if i > 0:
                prefixos_da_casa.add(nm[:i])

    estoque_total = sum(i['estoque'] for p in ps for i in p['itens'])
    # Um simbolo, UMA parte. O valor deixou de ser part: no Altium, part de componente
    # multi-part se identifica so por letra (A, B, C...) e o valor ficava invisivel na
    # hora de escolher. Agora o valor e um conjunto de PARAMETROS, com o Comment na
    # frente - e a escolha acontece no hub ou, dentro do Altium, pelo .DbLib.
    valores = []
    for p in ps:
        # ordena uma vez so: o item de maior saldo e o representante do valor, e e dele
        # que sai a descricao. Antes a descricao vinha do primeiro da lista NAO ordenada,
        # e divergia do itens[0] que o espelho publica.
        p['itens'] = sorted(p['itens'], key=lambda z: -z['estoque'])
        est = sum(x['estoque'] for x in p['itens'])
        mouser = next((x['mouser'] for x in p['itens'] if x['mouser']), '')
        mpn = next((x['mpn'] for x in p['itens'] if x['mpn']), '')
        conn = conn_do_valor(p['itens'])
        pkgs = sorted({x['pkg'] for x in p['itens'] if x['pkg']})
        locais = sorted({x['local'] for x in p['itens'] if x['local']})
        custos = [x['custo'] for x in p['itens'] if x['custo']]
        # O footprint DESTE valor. Percorre os encapsulamentos do item na ordem e tenta as
        # duas regras em cada um, porque e o PRIMEIRO deles que batiza o componente
        # ("SMD 0603 1K 1/4W"): esgotar a regra 1 em todos antes de tentar a regra 2 fazia
        # um valor ["0603","1206"] sair chamado 0603 com o pad de um 1206.
        #   1. um modelo do simbolo reciclado que carrega o encapsulamento ("RES 1206")
        #   2. a casa tem o footprint com OUTRO nome: o simbolo trouxe "RES 0805" e
        #      "RES 1206", e "RES 0603" existe na PcbLib sem estar entre os modelos dele.
        #      Reconstroi por prefixo da familia + encapsulamento, e so vale se a PcbLib
        #      confirmar e a resposta for unica - "0603" tambem casaria com "CAP 0603", e
        #      adivinhar entre os dois seria pior que nao resolver.
        fp = ''
        for pk in pkgs:
            alvo = norm_fp(pk)
            if not alvo:
                continue
            fp = next((m['name'] for m in modelos
                       if m.get('daCasa') and alvo in norm_fp(m['name'])), '')
            if fp:
                break
            achados = {reais[p + alvo] for p in prefixos_da_casa if p + alvo in reais}
            if len(achados) == 1:
                fp = achados.pop()
                break

        if not fp and pkgs:
            # tem encapsulamento, mas a casa nao tem footprint desse tamanho: fica o
            # nome do Odoo, que aparece como pendente. Herdar o footprint "atual" da
            # familia poria um 0603 num pad 2512 — errado e silencioso.
            fp = pkgs[0]
        if not fp:
            # Sem encapsulamento no nome, so herda o padrao da familia quando ele vem do
            # SIMBOLO RECICLADO da casa: ali o footprint e o da familia inteira (todo
            # "RES [ PTH ]" usa o mesmo pad) e herdar e correto. Quando os footprints da
            # familia sao so encapsulamentos soltos do Odoo — o caso de
            # "CIRCUITO INTEGRADO [PINAGEM A DEFINIR]", onde um "DIP114" digitado errado
            # viraria o footprint de 20 CIs sem relacao — fica vazio, que e a verdade.
            daCasa = [m for m in modelos if m.get('daCasa')]
            if daCasa:
                fp = next((m['name'] for m in daCasa if m.get('current')), daCasa[0]['name'])
        # O nome do componente no Altium: encapsulamento + caracteristica.
        # "SMD 0805 10K 1/8W 1% 100ppm". Cada valor vira um componente proprio na lib
        # da familia, entao e este nome que o esquema referencia — nao o da familia.
        # A montagem no nome: nos BASICOS e a do SIMBOLO, porque o simbolo e partido por ela
        # (RESISTOR [SMD] / RESISTOR [PTH]) e o item omisso herda a dominante junto com a lib
        # em que vai morar — o nome tem de dizer em qual das duas ele esta. Nos ESPECIAIS o
        # simbolo e por pinagem, nao por montagem, e s['mont'] e so a do PRIMEIRO item que
        # o criou; ela entrava no nome de todos os valores: um SOIC8 saia "PTH SOIC8 ...", e
        # o SN65HVD75DR (SMD, sem encapsulamento no Odoo) saiu "PTH SN65HVD75DR" por heranca
        # da dominante de CIRCUITO INTEGRADO. Ali o nome leva SO o que o proprio item
        # declara; montagem presumida nao e fato e nao entra em nome de componente.
        mont = s['mont'] if s['grupo'] == 'b' else montagem_declarada(p['itens'])
        enc = ' '.join(x for x in (mont, (pkgs[0] if pkgs else '')) if x)
        nome_altium = re.sub(r'\s+', ' ', (enc + ' ' + p['rotulo'])).strip()
        # ── o footprint ESCOLHIDO A MAO vence o calculado ───────────────────────────
        # `fp` acima e deducao: sai dos encapsulamentos que o Odoo mandou e dos modelos da
        # lib da casa. Quando alguem escolheu na tela (Biblioteca >> Footprints), a deducao
        # nao tem o direito de desfazer a escolha no sincronismo seguinte -- e o mesmo
        # contrato do DESENHO protegido, e pelo mesmo motivo: o que a pessoa decidiu sobre
        # a peca sobrevive ao que o gerador acha. A chave e (familia do arquivo, nome do
        # componente), a mesma do ledger; ela e montada aqui porque so aqui o nome final do
        # componente existe.
        if fpman:
            escolhido = fpman.get((s['familia'], nome_altium))
            if escolhido:
                fp = escolhido
        # Nao ha filtro de exclusao aqui, e isso e proposital: o que esta no CSV vira
        # componente, ponto. Excluir e apagar do espelho, e o que ainda existe no Odoo
        # volta por esta linha na proxima geracao — ver a nota em `numera_valores`.
        # ── desenho proprio deste valor ──────────────────────────────────────────────
        # A familia desenha uma vez so, e para o BJT isso e uma afirmacao ERRADA: a seta no
        # emissor diz NPN, e um terco do estoque e PNP. Dividir TRANSISTOR em duas familias
        # renumeraria o livro-razao inteiro (a chave dele e o nome do simbolo), entao quem
        # desce para o VALOR e o desenho — cada valor ja e um componente proprio na .SchLib.
        # So carrega geometria quem DISCORDA da familia; quem nao declara polaridade herda,
        # que e o degrade certo (a maioria do estoque e NPN).
        parts_valor = None
        if s['forma'] == 'bjt':
            pols = {x.get('polaridade') for x in p['itens'] if x.get('polaridade')}
            if pols == {'pnp'}:
                pv, gv = SY.desenha('bjt_pnp')
                parts_valor = [{'part': 1, 'pins': pv, 'graphics': gv}]
        # O CONECTOR DESENHA POR VALOR. O simbolo do subtipo e um so, entao a pinagem tem de
        # descer para ca — e o lugar certo: no .SchLib cada valor ja e um componente proprio,
        # com geometria propria (schlib_escritor » `valor.get('parts') or sim['parts']`).
        # Regenerar todo sincronismo nao apaga trabalho manual: o desenho editado no hub ou
        # adotado do Altium vive no ledger do guardiao (`protegidos[familia][componente]`,
        # symserver » /save-almox), e e de la que ele volta, por cima deste.
        elif conn and conn.get('vias'):
            pv, gv = SY.desenha('conn', conn['vias'])
            parts_valor = [{'part': 1, 'pins': pv, 'graphics': gv}]
        valores.append({
            'id': 0,                        # numerado depois, por `numera_valores`
            'altium': nome_altium,
            'label': p['rotulo'],
            # a chave do livro-razao. SO aparece quando difere do rotulo (os valores que se
            # dividiram por encapsulamento): poe-la em todos engordaria o espelho e mudaria
            # o diff de 2513 linhas para dizer o que o rotulo ja diz.
            **({'chave': p['chave']} if p.get('chave') and p['chave'] != p['rotulo'] else {}),
            # geometria propria: so aparece quando o valor discorda do desenho da familia
            **({'parts': parts_valor} if parts_valor else {}),
            'value': p['valor_txt'] or p['rotulo'],
            # a chave que ordenou este valor, em SI (ohm, farad, henry, volt, ampere,
            # hertz). null = o nome no Odoo nao trazia valor legivel; esses vao para o
            # fim da lista. Fica no arquivo para o hub e os testes conferirem a ordem
            # sem reinterpretar o rotulo.
            'ord': p['valor'],
            # o conector em campos. Sai como objeto proprio, e nao diluido no `label`, para
            # a tela poder montar "4 vias 3.81 180 femea" sem que o gerador tenha de escrever
            # essa frase no rotulo -- que e a chave do livro-razao e funde homonimos.
            **({'conn': conn} if conn else {}),
            'estoque': est,
            'pkgs': pkgs,
            'footprint': fp,
            'mouser': mouser,
            'mpn': mpn,
            'local': ' · '.join(locais),
            'custo': round(min(custos), 4) if custos else 0,
            'itens': [{'odoo': x['odoo_id'], 'tmpl': x['tmpl_id'], 'nome': x['nome'],
                       'pkg': x['pkg'], 'mont': x['mont'], 'estoque': x['estoque'],
                       'local': x['local'], 'custo': round(x['custo'], 4),
                       'mpn': x['mpn'], 'mouser': x['mouser'],
                       'fornecedores': x['fornecedores'], 'categoria': x['categoria']}
                      for x in p['itens']],
            'params': [par('Comment', p['rotulo']),
                       par('Value', p['valor_txt'] or p['rotulo']),
                       par('Encapsulamento', ' / '.join(pkgs)),
                       par('MPN', mpn),
                       par('Mouser', mouser),
                       par('OdooId', ' '.join(str(x['odoo_id']) for x in p['itens'])),
                       par('Estoque', ('%g' % est)),
                       par('Local', ' · '.join(locais)),
                       par('Custo', ('%.4f' % min(custos)) if custos else ''),
                       par('Descricao', p['itens'][0]['nome'])],
        })

    numera_valores(s['nome'], valores, mapa, antes, podar)
    # O desenho PROPRIO de um valor (o que o /save-almox grava quando um componente foge do
    # desenho da familia) tambem e do HTML: os valores sao remontados do zero a cada rodada,
    # entao sem repor daqui o `parts` do valor sumiria do espelho na sincronizacao seguinte.
    velhos_v = {v.get('label'): v for v in ((antes or {}).get(s['nome']) or {}).get('valores', [])
                if isinstance(v, dict)}
    for v in valores:
        if v.get('parts'):
            continue
        antigo = velhos_v.get(v.get('label'))
        if antigo and antigo.get('parts'):
            v['parts'] = antigo['parts']
    if mapa is not None:
        reg = mapa.setdefault(s['nome'], {})
        reg.setdefault('desdeSym', AGORA_ISO)
        desde_sym = reg['desdeSym']
    else:
        desde_sym = AGORA_ISO

    return {
        'name': s['nome'],
        'desde': desde_sym,
        'description': '%s — %d valor(es), %d item(ns) do almoxarifado' % (
            s['familia'], len(valores), sum(len(p['itens']) for p in valores)),
        'designator': s['des'],
        'familia': s['familia'],
        'montagem': s['mont'],
        'grupo': 'basicos' if s['grupo'] == 'b' else 'especiais',
        'partcount': congelado[2] if congelado else 1,
        'estoque': estoque_total,
        'itens': sum(len(p['itens']) for p in valores),
        'bbox': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2},
        'categorias': [c for c, _ in s['cats'].most_common(6)],
        'footprints': modelos,
        'params': [par('Familia', s['familia']), par('Montagem', s['mont'] or '—'),
                   par('Designator', s['des']), par('Fonte', 'Odoo · Almoxarifado DI')],
        # a geometria: do espelho se o simbolo ja existe, desenhada so se ele e novo
        'parts': congelado[0] if congelado else [{'part': 1, 'pins': pins, 'graphics': gfx}],
        'valores': valores,
    }


def balde_de(sim):
    """Em qual .SchLib o simbolo vai morar — e, por isso, onde o nome dele precisa ser unico.

    UMA regra, TRES consumidores: `desempata_nomes` logo abaixo (o dominio em que dois
    valores nao podem ter o mesmo nome), `schlib_escritor.gera` (o arquivo que vai para o
    disco) e `tests/test_schlib_gerada` (o que o teste espera achar la). Ela ja esteve
    escrita tres vezes, cada uma na sua casa, e foi assim que a biblioteca por subtipo de
    conector nasceu certa no disco e errada no teste na mesma rodada.

    A excecao do conector: um especial normalmente vai para a lib unica 'ESPECIAIS', mas
    conector sai por familia dos dois lados, porque a familia E o subtipo e o pedido era uma
    biblioteca por subtipo. Sem isso os 7 simbolos de conector sem pinagem legivel ficariam
    escondidos dentro de ESPECIAIS 1/2 ALMOX.SchLib.
    """
    fam = sim.get('familia') or ''
    especial = (sim.get('grupo') or '') in ('especiais', 'e')
    return 'ESPECIAIS' if (especial and not fam.startswith('CONECTOR')) else fam


def desempata_nomes(simbolos, mapa=None):
    """O `altium` de cada valor, unico DENTRO da .SchLib em que ele vai morar.

    Dois valores de simbolos diferentes da mesma biblioteca podem cair no mesmo nome (a
    familia ESPECIAIS junta pinagens que nao se conhecem): o segundo leva ' #<id>'. Hoje,
    na biblioteca real, isso acontece uma vez — CIRCUITO INTEGRADO [8P] /
    "PTH DIP8 OP07CP #27", homonimo do AMPLIFICADOR [8P] / "PTH DIP8 OP07CP".

    UM SUFIXO, UMA VEZ DADO, NAO SAI MAIS. Quem ja nasceu "#27" continua "#27" mesmo
    quando o homonimo some — e ele some o tempo todo: o dono apaga o duplicado, ou o
    produto e arquivado no Odoo. Sem essa trava o par tem uma simetria venenosa: sumido o
    "PTH DIP8 OP07CP", o "#27" deixa de colidir e seria RENOMEADO para "PTH DIP8 OP07CP",
    e todo schematic.js que grava esse texto em `sym` passaria a apontar, calado, para
    outra peca. Apagar um componente nao pode mexer no nome de outro.

    A reserva mora no LIVRO-RAZAO (Libs/almox-parts.json, campo `sufixados` por simbolo),
    e nao na lista de excluidos onde morava antes. Duas razoes: a lista deixou de ser
    consultada pelo gerador em 2026-09-17, e ela so cobria o sumico por exclusao — o
    sumico por arquivamento no Odoo ja renomeava o sobrevivente, calado, e ninguem via.
    O livro-razao e versionado e e a mesma coisa que ja segura o `id`.

    E funcao, e nao um trecho do main, porque e uma regra de NOME: o que ela decide fica
    dentro da .SchLib do usuario e dentro do `sym` dos esquemas ja desenhados. Regra assim
    se testa — tests/test_almox_excluir.py, secao 6.
    """
    porfam = collections.defaultdict(set)
    for sim in simbolos:
        fam = balde_de(sim)
        reg = (mapa or {}).get(sim['name'])
        reg = reg if isinstance(reg, dict) else None
        fixos = set((reg or {}).get('sufixados') or ())
        novos = []
        for v in sim['valores']:
            nome = v['altium'] or (sim['name'] + ' #' + str(v['id']))
            # colidiu agora, ou ja carregava o sufixo numa rodada anterior
            if nome in porfam[fam] or v['label'] in fixos:
                nome = '%s #%d' % (nome, v['id'])
                if v['label'] not in fixos:
                    novos.append(v['label'])
            porfam[fam].add(nome)
            v['altium'] = nome
        if novos and reg is not None:
            reg['sufixados'] = sorted(fixos | set(novos))
    return simbolos


# ─── o registro do que foi apagado ────────────────────────────────────────────
# O usuário exclui um VALOR pelo hub (botão direito » Excluir, no modal "Trocar componente"
# e na aba Biblioteca). Isto aqui é o REGISTRO desse ato — não um filtro.
#
# O GERADOR NÃO LÊ ESTE ARQUIVO (mudou em 2026-09-17). Quem decide se o valor volta é o
# Odoo: excluir apaga do espelho, e a geração seguinte remonta do CSV o que ainda existe
# lá e deixa morto o que não existe mais. Ver `numera_valores`. Lê este arquivo só a tela,
# para mostrar o que foi apagado e quando, e para o `desfazer` tirar a linha da lista.
#
# Continua VERSIONADO (como Libs/almox-parts.json, e ao contrário dos espelhos
# `Libs/almox-*.js`) e continua em COMPARTILHADOS_ARQ do tools/deploy/deploy.sh: é o
# histórico da limpeza, e perdê-lo a cada deploy apagaria a única memória de quem mandou
# apagar o quê. Mas perdê-lo não ressuscita nada — ele não manda no gerador.
#
# A chave é (nome do símbolo, valores[].altium). O `altium` é o LibReference do componente
# dentro da .SchLib da família, e é ele que o `schematic.js` grava em `sym`; o `label` e a
# `familia` viajam junto só para a tela e para o diff do git fazerem sentido a olho nu.
EXCLUIDOS = 'almox-excluidos.json'
FORMATO_EXCLUIDOS = 'excluidos-v1'


def caminho_excluidos(raiz=None):
    """Libs/almox-excluidos.json — sem `raiz`, o Libs/ desta rodada (o teste repõe `LIBS`);
    com `raiz`, o workspace que o servidor está servindo (o symserver chama de fora)"""
    return os.path.join(LIBS if raiz is None else os.path.join(raiz, 'Libs'), EXCLUIDOS)


def carrega_excluidos(raiz=None):
    """A lista do disco, ou a lista vazia — é assim que ela nasce.

    Formato errado é ERRO, não lista vazia: seguir calado com uma lista vazia reporia no
    almoxarifado tudo que o usuário já tinha excluído, e ele só descobriria abrindo o
    Altium. Quem chama decide o que fazer (o gerador avisa e segue; a rota devolve 500)."""
    p = caminho_excluidos(raiz)
    if not os.path.exists(p):
        return {'format': FORMATO_EXCLUIDOS, 'atualizado': '', 'itens': []}
    with io.open(p, encoding='utf-8') as f:
        d = json.load(f)
    if not isinstance(d, dict) or d.get('format') != FORMATO_EXCLUIDOS:
        raise ValueError('%s nao e uma lista %s' % (p, FORMATO_EXCLUIDOS))
    if not isinstance(d.get('itens'), list):
        d['itens'] = []
    return d


def dumps_excluidos(d):
    """um item por linha, como o guardiao.dumps_ledger: o git diffa a EXCLUSÃO, não o arquivo"""
    itens = [x for x in (d.get('itens') or []) if isinstance(x, dict)]
    fora = ['{"format":%s,"atualizado":%s,"itens":[' % (
        json.dumps(d.get('format', FORMATO_EXCLUIDOS), ensure_ascii=False),
        json.dumps(d.get('atualizado', ''), ensure_ascii=False))]
    for i, it in enumerate(itens):
        fora.append(' %s%s' % (json.dumps(it, ensure_ascii=False, separators=(',', ':')),
                               ',' if i < len(itens) - 1 else ''))
    fora.append(']}')
    return '\n'.join(fora) + '\n'


def grava_excluidos(raiz, d):
    """atômico, e SEGUINDO O LINK antes de trocar (ver tools/symbols/guardiao.py >>
    grava_ledger): no servidor este arquivo é `Libs/almox-excluidos.json -> shared/…`, e
    `os.replace` sobre o symlink substituiria O LINK — a release ficaria com cópia própria,
    o shared/ congelaria e o deploy seguinte devolveria as exclusões de antes"""
    d['atualizado'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    p = caminho_excluidos(raiz)
    pasta = os.path.dirname(p)
    if pasta and not os.path.isdir(pasta):
        os.makedirs(pasta)
    tmp = p + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(dumps_excluidos(d))
    os.replace(tmp, os.path.realpath(p))
    return p


def chaves_excluidas(d):
    """{(símbolo, altium)} — só para a TELA saber o que já foi apagado.

    O gerador não chama mais isto (2026-09-17): quem manda em voltar ou não é o Odoo.
    Continua aqui porque o symserver e os testes usam a mesma chave para casar a linha
    do registro com o valor do espelho.
    """
    return {(it.get('simbolo') or '', it.get('altium') or '')
            for it in (d.get('itens') or []) if isinstance(it, dict) and it.get('altium')}


# ─── numeração estável dos valores ────────────────────────────────────────────
MAPA_IDS = 'almox-parts.json'
AGORA_ISO = ''      # carimbo desta geração, em ISO ordenável (definido no main)


def carrega_ids():
    p = os.path.join(LIBS, MAPA_IDS)
    if not os.path.exists(p):
        return {}
    try:
        with io.open(p, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def chave_do_valor(v):
    """a chave do valor no livro-razao — a mesma regra do `numera_valores`"""
    return v.get('chave') or v.get('label') or ''


def indice_odoo(mapa, antes):
    """{id do produto no Odoo: (simbolo, chave)} — onde cada produto estava na rodada anterior.

    Duas fontes, nesta ordem. O LIVRO-RAZAO (`odoo` dentro de cada simbolo) e a durável: ela
    e versionada e sobrevive a um clone novo. O espelho anterior e so o degradê para o
    primeiro sincronismo depois desta mudança, quando o livro-razao ainda nao tem o indice —
    e ele nao serve sozinho, porque `Libs/almox-*.js` esta no .gitignore e some no clone.
    """
    fora = {}
    for sym, s in (antes or {}).items():
        for v in s.get('valores') or []:
            for it in v.get('itens') or []:
                oid = str(it.get('odoo') or '').strip()
                if oid:
                    fora[oid] = (sym, chave_do_valor(v))
    for sym, reg in (mapa or {}).items():
        if not isinstance(reg, dict):
            continue
        for oid, chave in (reg.get('odoo') or {}).items():
            fora[str(oid)] = (sym, chave)
    return fora


def _reg_do_simbolo(mapa, nome):
    reg = mapa.get(nome)
    if not isinstance(reg, dict) or not isinstance(reg.get('ids'), dict):
        reg = mapa[nome] = {'prox': 1, 'ids': {}, 'desde': {}}
    reg.setdefault('desde', {})
    return reg


def segue_renomeacoes(simbolos, antes, mapa):
    """PRODUTO RENOMEADO NO ODOO CONTINUA SENDO O MESMO COMPONENTE.

    O livro-razao chaveia o valor pelo ROTULO, e o rotulo sai do nome do produto. Trocar o
    nome no Odoo, sem isto, faz duas coisas erradas ao mesmo tempo: nasce um componente novo
    (com numero novo, data de hoje e sem as escolhas de footprint) e o antigo fica na lista
    como zumbi `fora: true`, saldo zero, para sempre — porque `numera_valores` ressuscita do
    espelho tudo que esta em `ids` e nao veio no CSV. Era assim que uma faxina de nomes no
    cadastro dobrava a biblioteca.

    O `product_id` do Odoo nao muda quando o nome muda, entao e ele que diz "e o mesmo". Aqui
    o id e a data de entrada mudam de chave ANTES da numeracao, e a chave velha SAI do livro-
    razao — e a saida dela que impede a ressurreicao.

    O que NAO e renomeacao continua como era: produto que sumiu do Odoo de verdade nao
    aparece em `novo`, a chave dele fica em `ids` e ele vira `fora: true`, que e o
    comportamento pedido.

    Devolve [(de_simbolo, de_chave, para_simbolo, para_chave)], para o relatorio.
    """
    velho = indice_odoo(mapa, antes)
    if not velho:
        return []
    # {(simbolo, chave): [ids do Odoo]} desta rodada
    agora = collections.defaultdict(list)
    for nome, s in simbolos.items():
        for (rot, _enc), p in s['parts'].items():
            ch = p.get('chave') or rot
            for it in p['itens']:
                oid = str(it.get('odoo_id') or '').strip()
                if oid:
                    agora[(nome, ch)].append(oid)

    renomes = []
    for (sym, chave), oids in agora.items():
        # de onde estes produtos vinham, tirando o proprio lugar
        origens = {velho[o] for o in oids if o in velho}
        origens.discard((sym, chave))
        if not origens:
            continue
        # o id mais antigo entre as origens: quando duas linhas do Odoo viram um valor so,
        # o componente herda o numero do mais velho dos dois
        cand = []
        for (osym, ochave) in origens:
            oreg = mapa.get(osym)
            if isinstance(oreg, dict) and ochave in (oreg.get('ids') or {}):
                cand.append((oreg['ids'][ochave], osym, ochave))
        if not cand:
            continue
        cand.sort()
        vid, osym, ochave = cand[0]
        reg = _reg_do_simbolo(mapa, sym)
        # os numeros ja tomados AQUI DENTRO — tirando as chaves que estao de saida. Sem essa
        # exclusao, a renomeacao dentro da MESMA familia se auto-bloqueia: a chave velha
        # ainda esta em `ids`, entao o numero que ela vai doar aparece como "ja usado" e o
        # componente renomeado tira numero novo, que e exatamente o que isto evita.
        saindo = {oc for (osym, oc) in origens if osym == sym}
        usados = {n for k, n in reg['ids'].items() if k != chave and k not in saindo}
        if reg['ids'].get(chave) == vid or vid in usados:
            continue                     # o numero ja e dele, ou ja e de outro aqui dentro
        reg['ids'][chave] = vid
        reg['prox'] = max(reg.get('prox', 1), vid + 1)
        # TODAS as origens saem do livro-razao, inclusive as que nao doaram o numero: o que
        # as mantem vivas e justamente o que as ressuscitaria como zumbi
        for (osym2, ochave2) in origens:
            oreg = mapa.get(osym2)
            if not isinstance(oreg, dict):
                continue
            dt = (oreg.get('desde') or {}).pop(ochave2, None)
            if dt and chave not in reg['desde']:
                reg['desde'][chave] = dt
            (oreg.get('ids') or {}).pop(ochave2, None)
            renomes.append((osym2, ochave2, sym, chave))
    return renomes


def grava_indice_odoo(simbolos_montados, mapa):
    """Guarda no livro-razao de que produto do Odoo veio cada valor.

    E o que faz a renomeacao ser seguida na PROXIMA rodada. Fica aqui, e nao no espelho,
    porque `Libs/almox-parts.json` e versionado de proposito e os espelhos nao (.gitignore):
    num clone novo o espelho nao existe e este indice e a unica memoria de quem era quem.
    """
    for s in simbolos_montados:
        reg = _reg_do_simbolo(mapa, s['name'])
        ix = {}
        for v in s.get('valores') or []:
            ch = chave_do_valor(v)
            for it in v.get('itens') or []:
                oid = str(it.get('odoo') or '').strip()
                if oid:
                    ix[oid] = ch
        if ix:
            reg['odoo'] = ix
        else:
            reg.pop('odoo', None)


def numera_valores(nome, valores, mapa, antes, podar):
    """Uma vez dado, o `id` é daquele valor para sempre.

    O id é a chave do valor no .DbLib e no `schematic.js`: com ele estável, um esquema
    que aponta para "RESISTOR [SMD] #47" continua apontando para o mesmo resistor
    depois de qualquer sincronização. Valor novo entra na posição ordenada da LISTA mas
    leva o próximo id livre; valor que sai do Odoo não devolve o id — fica com saldo
    zero e `fora: true`. Recomeçar do zero é o `--podar`.

    É AQUI QUE "EXCLUIR" MORDE, e é por isso que excluir não precisa de lista nenhuma.
    O valor `fora: true` não vem do CSV: ele é ressuscitado do espelho da rodada anterior
    (`velhos`, abaixo), e só entra se estiver lá. Então:

      - valor que AINDA EXISTE no Odoo está em `atuais`, vem do CSV e é remontado nesta
        linha de qualquer jeito. Apagá-lo do espelho é um desfazer temporário: a próxima
        geração o traz de volta, com o mesmo id. É a rede de segurança de quem excluiu
        por engano;
      - valor que JÁ NÃO EXISTE no Odoo (o duplicado do tempo em que o cadastro não tinha
        padrão de nome) só existia porque estava no espelho. Tirá-lo de lá o mata de vez,
        porque `velhos.get(label)` passa a devolver None e nada mais o reconstrói.

    A biblioteca volta a ser função do Odoo, que é o que o dono pediu em 2026-09-17. O
    `id` continua reservado no livro-razão nos dois casos, então nada renumera.
    """
    if mapa is None:
        for i, p in enumerate(valores, 1):
            p['id'] = i
            p['desde'] = AGORA_ISO
        return

    reg = mapa.get(nome)
    if not isinstance(reg, dict) or not isinstance(reg.get('ids'), dict):
        reg = {'prox': 1, 'ids': {}, 'desde': {}}
    if podar:
        # podar renumera, mas NÃO reescreve a história: a data em que cada valor entrou
        # na lib é o que sustenta a marcação de "novo", e ela não tem nada a ver com o id
        reg = {'prox': 1, 'ids': {}, 'desde': dict(reg.get('desde') or {})}
    ids = reg['ids']
    desde = reg.setdefault('desde', {})

    # A CHAVE, e nao o rotulo. Desde que o valor se divide por encapsulamento (agrupar),
    # dois componentes podem ter o MESMO rotulo na mesma familia -- "1K 1/4W 1% 100ppm" em
    # 0603 e em 1206 -- e chavear pelo rotulo daria o mesmo id aos dois. Quem nao se
    # dividiu tem chave == rotulo, entao o arquivo de ontem continua valendo linha por linha
    # e ninguem e renumerado.
    def chave(v):
        return v.get('chave') or v['label']

    for p in valores:
        k = chave(p)
        vid = ids.get(k)
        if vid is None:
            vid = reg['prox']
            reg['prox'] = vid + 1
            ids[k] = vid
        # a data de ENTRADA na lib, gravada uma vez só. É o que faz "novo" sobreviver a
        # uma regeração que não mudou nada — antes a marcação era "diferente da geração
        # anterior", e um "só regerar do snapshot" apagava o que a puxada tinha trazido.
        p['desde'] = desde.setdefault(k, AGORA_ISO)
        p['id'] = vid

    # o que saiu do Odoo continua na lista, com o seu id, saldo zerado e marcado
    if not podar and valores:
        atuais = {chave(p) for p in valores}
        velhos = {(v.get('chave') or v['label']): v
                  for v in ((antes or {}).get(nome) or {}).get('valores', [])}
        for label, vid in ids.items():
            if label in atuais:
                continue
            # o espelho anterior e a UNICA fonte do valor que saiu do Odoo: sem ele aqui,
            # o valor simplesmente deixa de existir. E o que faz excluir ser definitivo
            # para o duplicado, sem lista nenhuma (ver o docstring).
            v = velhos.get(label)
            if not v:
                continue
            w = dict(v)
            w['id'] = vid
            w['estoque'] = 0
            w['fora'] = True
            w['desde'] = desde.setdefault(label, AGORA_ISO)
            w['params'] = [par('Comment', label), par('Value', v.get('value', label)),
                           par('Encapsulamento', ' / '.join(v.get('pkgs') or [])),
                           par('MPN', v.get('mpn', '')), par('Mouser', v.get('mouser', '')),
                           par('OdooId', ''), par('Estoque', '0'), par('Local', ''),
                           par('Custo', ''), par('Descricao', 'fora do almoxarifado')]
            valores.append(w)

    valores.sort(key=lambda p: ((0, p['ord']) if p.get('ord') is not None else (1, 0.0),
                                chave_natural(p['label'])))
    mapa[nome] = reg


def escreve_js(caminho, varname, obj):
    """`var X = {...};` — o formato que o hub carrega por <script src>"""
    io.open(caminho, 'w', encoding='utf-8', newline='\n').write(
        'var %s = %s;\n' % (varname, json.dumps(obj, ensure_ascii=False, indent=1)))


def escreve_espelho(caminho, varname, titulo, simbolos, quando):
    o = io.open(caminho, 'w', encoding='utf-8', newline='\n')
    o.write('var %s = {\n' % varname)
    o.write('"format":"schlib-v2",\n')
    o.write('"lib":%s,\n' % json.dumps(os.path.basename(caminho)[:-3], ensure_ascii=False))
    o.write('"title":%s,\n' % json.dumps(titulo, ensure_ascii=False))
    o.write('"generated":%s,\n' % json.dumps(quando, ensure_ascii=False))
    o.write('"source":"Odoo DI · tools/almox/componentes_odoo.csv",\n')
    o.write('"units":"mil",\n')
    o.write('"symbols":[\n')
    for i, s in enumerate(simbolos):
        o.write(('' if i == 0 else ',') + json.dumps(s, ensure_ascii=False, sort_keys=False) + '\n')
    o.write(']};\n')
    o.close()


def le_espelho(caminho):
    """Le um `var X = {...};` gerado aqui e devolve {nome_simbolo: simbolo}."""
    if not os.path.exists(caminho):
        return {}
    try:
        txt = io.open(caminho, encoding='utf-8').read()
        corpo = txt[txt.index('=') + 1:].strip().rstrip(';').strip()
        return {s['name']: s for s in json.loads(corpo).get('symbols', [])}
    except (OSError, ValueError, KeyError):
        return {}                      # espelho velho ou corrompido: tudo conta como novo


TETO = 400          # quanto do diff cabe no arquivo antes de virar so um contador


def _corta(lst):
    return lst[:TETO], max(0, len(lst) - TETO)


def compara(antes, agora):
    """Diff entre duas gerações, no nível que interessa a quem desenha: símbolo novo,
       valor novo dentro de um símbolo que já existia, valor que sumiu e saldo que mexeu."""
    novosSym = [n for n in agora if n not in antes]
    foramSym = [n for n in antes if n not in agora]
    novosVal, foramVal, mexeu = [], [], []
    novosPorSym = {}

    for nome, s in agora.items():
        velho = antes.get(nome)
        rotulosAntes = {p['label']: p for p in (velho or {}).get('valores', [])}
        for p in s['valores']:
            v = rotulosAntes.get(p['label'])
            if v is None:
                # num símbolo novo o valor não é "novo" de novo: já está no símbolo
                if nome not in antes:
                    continue
                novosVal.append({'sym': nome, 'label': p['label'], 'estoque': p['estoque'],
                                 'mouser': p.get('mouser', ''), 'mpn': p.get('mpn', ''),
                                 'pkgs': p.get('pkgs', [])})
                novosPorSym.setdefault(nome, []).append(p['label'])
            elif p.get('fora') and not v.get('fora'):
                # a part continua na lib, ocupando o seu número, mas o item saiu do Odoo
                foramVal.append({'sym': nome, 'label': p['label'], 'id': p['id'],
                                 'estoque': v.get('estoque') or 0})
            elif p.get('fora'):
                continue                    # já estava fora antes; nada mudou
            elif abs((p['estoque'] or 0) - (v.get('estoque') or 0)) > 1e-9:
                mexeu.append({'sym': nome, 'label': p['label'],
                              'de': v.get('estoque') or 0, 'para': p['estoque'] or 0,
                              'delta': (p['estoque'] or 0) - (v.get('estoque') or 0)})
        # símbolo inteiro que sumiu do Odoo: os valores dele vão junto
        atuais = {p['label'] for p in s['valores']}
        for p in (velho or {}).get('valores', []):
            if p['label'] not in atuais:
                foramVal.append({'sym': nome, 'label': p['label'],
                                 'estoque': p.get('estoque', 0)})

    mexeu.sort(key=lambda m: -abs(m['delta']))
    novosVal.sort(key=lambda v: (v['sym'], v['label']))
    foramVal.sort(key=lambda v: (v['sym'], v['label']))
    zerou = [m for m in mexeu if m['para'] == 0]
    voltou = [m for m in mexeu if m['de'] == 0 and m['para'] > 0]

    nv, nvMais = _corta(novosVal)
    fv, fvMais = _corta(foramVal)
    mx, mxMais = _corta(mexeu)
    return {
        'primeira': not antes,
        'simbolosNovos': [{'nome': n, 'valores': len(agora[n].get('valores') or []),
                           'estoque': agora[n].get('estoque', 0),
                           'familia': agora[n].get('familia', '')} for n in sorted(novosSym)],
        'simbolosSumiram': sorted(foramSym),
        'valoresNovos': nv, 'valoresNovosMais': nvMais,
        'valoresSumiram': fv, 'valoresSumiramMais': fvMais,
        'estoqueMudou': mx, 'estoqueMudouMais': mxMais,
        'novosPorSimbolo': novosPorSym,
        'resumo': {
            'simbolosNovos': len(novosSym), 'simbolosSumiram': len(foramSym),
            'valoresNovos': len(novosVal), 'valoresSumiram': len(foramVal),
            'estoqueMudou': len(mexeu), 'zerou': len(zerou), 'voltou': len(voltou),
            'entrou': round(sum(m['delta'] for m in mexeu if m['delta'] > 0), 3),
            'saiu': round(-sum(m['delta'] for m in mexeu if m['delta'] < 0), 3),
        },
    }


# ─── principal ────────────────────────────────────────────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser(description='Gera as bibliotecas do almoxarifado')
    ap.add_argument('--pull', action='store_true',
                    help='puxa o Odoo ao vivo (XML-RPC) antes de gerar')
    ap.add_argument('--full', action='store_true',
                    help='com --pull, rele o catalogo inteiro em vez do incremental')
    ap.add_argument('--podar', action='store_true',
                    help='renumera as parts do zero e descarta as que sairam do Odoo')
    ap.add_argument('--sem-schlib', action='store_true',
                    help='nao escreve as .SchLib nem o .DbLib (so o espelho do hub)')
    args = ap.parse_args(argv)

    fonte = 'snapshot em disco'
    stats = None
    if args.pull:
        import odoo_pull
        cfg = odoo_pull.le_config()
        # A url ANTES da senha, e as duas antes de conectar. Este pre-voo e o que a tela
        # do hub enxerga: o botao "Puxar do Odoo" roda ESTE arquivo, nao o odoo_pull, entao
        # a mensagem boa que o odoo_pull.main() tem no lugar dele nunca chega aqui. Sem
        # esta linha o usuario via "conectando em  (base odoo_db)..." -- com o buraco no
        # meio da frase -- e depois um traceback de SemUrl.
        if not cfg['url']:
            print('ERRO: sem url do Odoo — grave "url" em hub-almox.json (no servidor, '
                  '/srv/altiumhub/shared/hub-almox.json). Nao existe servidor padrao: a '
                  'bancada e a producao falam com Odoos diferentes')
            return 2
        if not cfg['senha']:
            print('ERRO: sem senha do Odoo — configure hub-almox.json ou ODOO_SENHA')
            return 2
        print('conectando em %s (base %s)...' % (cfg['url'], cfg['db']))
        anteriores = None if args.full else odoo_pull.le_csv(CSV_ODOO)
        linhas, stats = odoo_pull.puxa(cfg, anteriores)
        odoo_pull.grava(linhas, CSV_ODOO)
        fonte = 'Odoo %s · %s · %s' % ('incremental' if stats['incremental'] else 'completo',
                                       cfg['url'], cfg['db'])
        print('Odoo: %d produtos (%d novo(s), %d alterado(s), %d arquivado(s); '
              '%d ficha(s) baixada(s))'
              % (stats['total'], stats['novos'], stats['alterados'], stats['sumiram'],
                 stats['fichas']))

    agora = datetime.datetime.now()
    quando = agora.strftime('%d/%m/%Y %H:%M:%S')
    global AGORA_ISO
    AGORA_ISO = agora.strftime('%Y-%m-%d %H:%M')      # ordenavel: o hub compara como texto
    antes = {}
    for f in ('almox-basicos.js', 'almox-especiais.js'):
        antes.update(le_espelho(os.path.join(LIBS, f)))
    print('geracao anterior: %d simbolos' % len(antes))

    rows = list(csv.DictReader(io.open(CSV_ODOO, encoding='utf-8')))
    analisados, fora, sem_marca = [], [], []
    tem_coluna = bool(rows) and 'componente' in rows[0]
    for r in rows:
        a = F.analisar(r)
        if a:
            analisados.append(a)
        elif not F.marcado_componente(r):
            # SAIU PELA MARCA DO ODOO, nao por palavra no nome. Fica numa lista propria:
            # e o unico descarte que se conserta FORA daqui, marcando "e componente
            # eletronico" no cadastro -- e para isso e preciso saber QUEM saiu.
            sem_marca.append(r)
        else:
            fora.append(r)
    if not tem_coluna:
        print('AVISO: o dump nao tem a coluna `componente` -- o filtro de "e componente '
              'eletronico" NAO esta valendo. Rode uma puxada (--pull) para traze-la.')
    elif sem_marca:
        print('%d produto(s) fora da biblioteca por nao estarem marcados como '
              '"e componente eletronico" no Odoo (lista em relatorio.txt)' % len(sem_marca))

    # {nome normalizado: nome de verdade} - o valor e o que vai para a .SchLib
    fps_reais = {norm_fp(n): n for n in carrega_pcblib()}
    simbolos = agrupar(analisados)

    bas = sorted((s for s in simbolos.values() if s['grupo'] == 'b'),
                 key=lambda s: (s['familia'], s['nome']))
    esp = sorted((s for s in simbolos.values() if s['grupo'] == 'e'),
                 key=lambda s: (s['familia'], s['npin'] or 999))

    # o mapa de numeros e o que faz a lib acumular em vez de ser recriada: valor que ja
    # esta la mantem a sua part, valor novo entra no fim da fila de numeros
    mapa = {} if args.podar else carrega_ids()
    # ANTES de numerar: quem so trocou de nome no Odoo leva o numero e a data com ele, e a
    # chave velha sai do livro-razao para nao voltar como zumbi `fora: true`.
    renomes = [] if args.podar else segue_renomeacoes(simbolos, antes, mapa)
    if renomes:
        print('%d produto(s) renomeado(s) no Odoo: o componente manteve o numero e a data'
              % len(renomes))
        for de_s, de_c, pa_s, pa_c in renomes[:10]:
            print('   %s / %s  ->  %s / %s' % (de_s, de_c, pa_s, pa_c))
        if len(renomes) > 10:
            print('   ... e mais %d (a lista inteira em relatorio.txt)' % (len(renomes) - 10))
    comps_reais, ESC = carrega_reciclagem()
    recicl = {}
    if ESC is not None:
        for s in list(simbolos):
            fps = ESC.footprints_do_modelo(s, comps_reais)
            if fps:
                recicl[s] = fps
        print('reciclagem: %d simbolo(s) herdam footprint da biblioteca real' % len(recicl))
    # O FOOTPRINT ESCOLHIDO A MAO, do ledger. Ele vence a deducao deste gerador, do mesmo
    # jeito que o desenho protegido vence o simbolo padrao da categoria -- senao o
    # sincronismo desfaria em silencio o que alguem decidiu na tela. Ledger ilegivel nao
    # derruba a geracao: segue sem as escolhas e AVISA, porque o silencio aqui seria a
    # escolha do usuario sumindo sem uma linha.
    fpman = {}
    try:
        import guardiao as _G
        fpman = _G.footprints_manuais(_G.carrega_ledger(RAIZ))
        if fpman:
            print('%d footprint(s) escolhido(s) a mao no ledger — o gerador os preserva'
                  % len(fpman))
    except Exception as e:                                          # noqa: BLE001
        print('AVISO: nao li os footprints manuais do ledger (%s: %s) — uma escolha feita '
              'na tela pode ser desfeita nesta rodada' % (type(e).__name__, e))
    sb = [monta_simbolo(s, fps_reais, mapa, antes, args.podar, recicl, fpman) for s in bas]
    se = [monta_simbolo(s, fps_reais, mapa, antes, args.podar, recicl, fpman) for s in esp]

    # o nome de cada valor dentro da .SchLib em que ele vai morar (e o que o `sym` do
    # schematic.js guarda): unico, e estavel mesmo quando o homonimo some
    desempata_nomes(sb + se, mapa)

    # de que produto do Odoo veio cada valor — e o que a PROXIMA rodada usa para seguir uma
    # renomeacao no cadastro
    grava_indice_odoo(sb + se, mapa)

    if not os.path.isdir(LIBS):
        os.makedirs(LIBS)
    escreve_espelho(os.path.join(LIBS, 'almox-basicos.js'), 'almoxBasicos',
                    'Almoxarifado — Básicos', sb, quando)
    escreve_espelho(os.path.join(LIBS, 'almox-especiais.js'), 'almoxEspeciais',
                    'Almoxarifado — Especiais', se, quando)

    def resumo(lst):
        return {'symbols': len(lst),
                'parts': sum(len(s['valores']) for s in lst),
                'itens': sum(s['itens'] for s in lst),
                'estoque': round(sum(s['estoque'] for s in lst), 3),
                'semEstoque': sum(1 for s in lst for p in s['valores'] if not p['estoque'])}

    # o diff sai ANTES de o novo espelho ir para o disco: `antes` foi lido no comeco
    mudou = compara(antes, {s['name']: s for s in sb + se})
    mudou['generated'] = quando
    mudou['fonte'] = fonte
    mudou['odoo'] = stats or {}
    escreve_js(os.path.join(LIBS, 'almox-sync.js'), 'almoxSync', mudou)

    idx = {'generated': quando,
           'generatedIso': AGORA_ISO,
           'source': 'Odoo DI · tools/almox/componentes_odoo.csv',
           'fonte': fonte,
           'odooRows': len(rows), 'classificados': len(analisados), 'fora': len(fora),
           'ultimaSync': dict(mudou['resumo'], generated=quando, fonte=fonte,
                              primeira=mudou['primeira'], odoo=stats or {}),
           'libs': [
               dict(id='almox-basicos', var='almoxBasicos', file='Libs/almox-basicos.js',
                    schlib='ALMOX BASICOS.SchLib',
                    title='Almoxarifado — Básicos',
                    hint='mesmo símbolo, mesmos pinos, uma part por valor', **resumo(sb)),
               dict(id='almox-especiais', var='almoxEspeciais', file='Libs/almox-especiais.js',
                    schlib='ALMOX ESPECIAIS.SchLib',
                    title='Almoxarifado — Especiais',
                    hint='pinagem própria; footprint quase sempre manual', **resumo(se)),
           ]}
    escreve_js(os.path.join(LIBS, 'almox-index.js'), 'almoxIndex', idx)
    with io.open(os.path.join(LIBS, MAPA_IDS), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(mapa, f, ensure_ascii=False, indent=0, sort_keys=True)

    # ---- relatorio -----------------------------------------------------------
    rel = io.open(os.path.join(BASE, 'relatorio.txt'), 'w', encoding='utf-8', newline='\n')
    rel.write('almox2lib — %s\n' % quando)
    rel.write('linhas no dump do Odoo : %d\n' % len(rows))
    rel.write('classificadas          : %d\n' % len(analisados))
    rel.write('fora (nao e PCB)       : %d\n' % len(fora))
    rel.write('sem a marca do Odoo    : %d\n\n' % len(sem_marca))
    for titulo, lst in (('BASICOS', sb), ('ESPECIAIS', se)):
        r = resumo(lst)
        rel.write('=== %s: %d simbolos, %d valores, %d itens, %g em estoque ===\n'
                  % (titulo, r['symbols'], r['parts'], r['itens'], r['estoque']))
        for s in lst:
            rel.write('  %-42s %3d valores %4d itens  fp: %s\n'
                      % (s['name'], len(s['valores']), s['itens'],
                         ', '.join(m['name'] for m in s['footprints'][:8]) or '—'))
        rel.write('\n')
    # Duas listas, e nao uma: o que saiu pela MARCA se conserta marcando o produto no
    # cadastro; o que saiu pelo nome (LIXO) e decisao deste gerador. Misturadas, a que
    # tem conserto fica escondida no meio da que nao tem.
    rel.write('=== fora por nao estarem marcados "e componente eletronico" (%d) ===\n'
              % len(sem_marca))
    rel.write('    marque x_is_componente no produto e sincronize de novo\n')
    for r_ in sem_marca:
        rel.write('  [%s] %s\n' % (r_.get('product_id') or '?',
                                       (r_.get('nome') or '').strip()))
    rel.write('\n=== descartadas por nao serem componente de PCB (%d) ===\n' % len(fora))
    for r_ in fora:
        rel.write('  %s\n' % (r_.get('nome') or '').strip())
    rel.close()

    print('basicos  : %d simbolos, %d valores' % (len(sb), sum(len(s['valores']) for s in sb)))
    print('especiais: %d simbolos, %d valores' % (len(se), sum(len(s['valores']) for s in se)))
    print('classificados %d de %d · relatorio em tools/almox/relatorio.txt'
          % (len(analisados), len(rows)))
    r = mudou['resumo']
    if mudou['primeira']:
        print('primeira geracao: tudo e novo')
    else:
        print('novidades: %d simbolos, %d valores novos, %d valores fora, '
              '%d saldos mexeram (+%g / -%g)'
              % (r['simbolosNovos'], r['valoresNovos'], r['valoresSumiram'],
                 r['estoqueMudou'], r['entrou'], r['saiu']))
    print('numeros de part em uso: %d simbolo(s) no mapa'
          % sum(1 for v in mapa.values() if isinstance(v, dict)))

    # ---- as .SchLib, escritas direto (sem passar pelo Altium) -----------------
    # Falhar aqui nao pode derrubar a sincronizacao: o espelho do hub ja esta gravado, e
    # e ele que a aba Biblioteca le. Sem as .SchLib, o que falta e o lado do Altium.
    if not args.sem_schlib:
        try:
            import schlib_escritor, dblib
            schlib_escritor.gera()
            dblib.gera()
        except Exception as e:                              # noqa: BLE001
            print('ATENCAO: nao consegui escrever as .SchLib (%s: %s)' % (type(e).__name__, e))
            print('         o espelho do hub esta atualizado; as .SchLib de Libs/Almox '
                  'continuam as da geracao anterior')
    return 0


if __name__ == '__main__':
    sys.exit(main())
