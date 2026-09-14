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
    if dominante.get(fam) is None:
        a['mont'] = ''                       # familia sem split de montagem
    elif not a['mont']:
        a['mont'] = dominante[fam]
        a['mont_presumida'] = True

    if gr == 'b' and forma in ('conn', 'rede', 'dipsw') and not vias:
        # conector sem numero de vias no nome: a pinagem seria chute, entao
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
            }
        if a['pkg']:
            s['pkgs'][a['pkg']] += 1
        if a['categoria']:
            s['cats'][a['categoria']] += 1

        p = s['parts'].get(rotulo)
        if not p:
            p = s['parts'][rotulo] = {'rotulo': rotulo, 'valor': a['valor'],
                                      'valor_txt': a['valor_txt'], 'itens': []}
        if p['valor'] is None and a['valor'] is not None:
            p['valor'], p['valor_txt'] = a['valor'], a['valor_txt']
        p['itens'].append(a)
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


def monta_simbolo(s, reais, mapa=None, antes=None, podar=False, recicl=None):
    pins, gfx = SY.desenha(s['forma'], s['npin'], rotulo=s['familia'] if s['forma'] == 'box' else '')
    ps = ordena_parts(s)
    x1, y1, x2, y2 = SY.bbox(pins, gfx)

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
        valores.append({
            'id': 0,                        # numerado depois, por `numera_valores`
            'altium': re.sub(r'\s+', ' ', (enc + ' ' + p['rotulo'])).strip(),
            'label': p['rotulo'],
            # geometria propria: so aparece quando o valor discorda do desenho da familia
            **({'parts': parts_valor} if parts_valor else {}),
            'value': p['valor_txt'] or p['rotulo'],
            # a chave que ordenou este valor, em SI (ohm, farad, henry, volt, ampere,
            # hertz). null = o nome no Odoo nao trazia valor legivel; esses vao para o
            # fim da lista. Fica no arquivo para o hub e os testes conferirem a ordem
            # sem reinterpretar o rotulo.
            'ord': p['valor'],
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
        'partcount': 1,
        'estoque': estoque_total,
        'itens': sum(len(p['itens']) for p in valores),
        'bbox': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2},
        'categorias': [c for c, _ in s['cats'].most_common(6)],
        'footprints': modelos,
        'params': [par('Familia', s['familia']), par('Montagem', s['mont'] or '—'),
                   par('Designator', s['des']), par('Fonte', 'Odoo · Almoxarifado DI')],
        # a geometria, uma vez so - e o que o hub desenha e o que vira a .SchLib
        'parts': [{'part': 1, 'pins': pins, 'graphics': gfx}],
        'valores': valores,
    }


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


def numera_valores(nome, valores, mapa, antes, podar):
    """Uma vez dado, o `id` é daquele valor para sempre.

    O id é a chave do valor no .DbLib e no `schematic.js`: com ele estável, um esquema
    que aponta para "RESISTOR [SMD] #47" continua apontando para o mesmo resistor
    depois de qualquer sincronização. Valor novo entra na posição ordenada da LISTA mas
    leva o próximo id livre; valor que sai do Odoo não devolve o id — fica com saldo
    zero e `fora: true`. Recomeçar do zero é o `--podar`.
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

    for p in valores:
        vid = ids.get(p['label'])
        if vid is None:
            vid = reg['prox']
            reg['prox'] = vid + 1
            ids[p['label']] = vid
        # a data de ENTRADA na lib, gravada uma vez só. É o que faz "novo" sobreviver a
        # uma regeração que não mudou nada — antes a marcação era "diferente da geração
        # anterior", e um "só regerar do snapshot" apagava o que a puxada tinha trazido.
        p['desde'] = desde.setdefault(p['label'], AGORA_ISO)
        p['id'] = vid

    # o que saiu do Odoo continua na lista, com o seu id, saldo zerado e marcado
    if not podar and valores:
        atuais = {p['label'] for p in valores}
        velhos = {v['label']: v for v in ((antes or {}).get(nome) or {}).get('valores', [])}
        for label, vid in ids.items():
            if label in atuais:
                continue
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
    analisados, fora = [], []
    for r in rows:
        a = F.analisar(r)
        (analisados.append(a) if a else fora.append(r))

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
    comps_reais, ESC = carrega_reciclagem()
    recicl = {}
    if ESC is not None:
        for s in list(simbolos):
            fps = ESC.footprints_do_modelo(s, comps_reais)
            if fps:
                recicl[s] = fps
        print('reciclagem: %d simbolo(s) herdam footprint da biblioteca real' % len(recicl))
    sb = [monta_simbolo(s, fps_reais, mapa, antes, args.podar, recicl) for s in bas]
    se = [monta_simbolo(s, fps_reais, mapa, antes, args.podar, recicl) for s in esp]

    # Nome do componente unico DENTRO da sua biblioteca (uma por familia). Dois valores
    # de simbolos diferentes da mesma familia podem cair no mesmo nome — o id desempata.
    porfam = collections.defaultdict(set)
    for sim in sb + se:
        fam = sim['familia'] if sim['grupo'] == 'basicos' else 'ESPECIAIS'
        for v in sim['valores']:
            nome = v['altium'] or (sim['name'] + ' #' + str(v['id']))
            if nome in porfam[fam]:
                nome = '%s #%d' % (nome, v['id'])
            porfam[fam].add(nome)
            v['altium'] = nome

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
    rel.write('fora (nao e PCB)       : %d\n\n' % len(fora))
    for titulo, lst in (('BASICOS', sb), ('ESPECIAIS', se)):
        r = resumo(lst)
        rel.write('=== %s: %d simbolos, %d valores, %d itens, %g em estoque ===\n'
                  % (titulo, r['symbols'], r['parts'], r['itens'], r['estoque']))
        for s in lst:
            rel.write('  %-42s %3d valores %4d itens  fp: %s\n'
                      % (s['name'], len(s['valores']), s['itens'],
                         ', '.join(m['name'] for m in s['footprints'][:8]) or '—'))
        rel.write('\n')
    rel.write('=== descartadas ===\n')
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
