# -*- coding: utf-8 -*-
"""A tabela de familias e a analise linha-a-linha do dump do Odoo.

O contrato com o resto do gerador: `analisar(row)` devolve um dict achatado com
tudo que o simbolo e a part precisam, ou None quando a linha nao e componente de
PCB (parafuso, broca, cabo, caixa...).
"""
import re

import conectores as CN
from classificar import (sa, acha_pkg, pinos_do_pkg, montagem, valor_de, canon_si)


# ─── dobra 1:1 (tira acento e caixa SEM mudar o comprimento) ──────────────────
# Precisa ser 1:1 porque os regexes casam na versao dobrada e o m.end() e usado
# para recortar o nome ORIGINAL: com NFD, "ç" viraria dois caracteres e todo
# indice sairia deslocado.
import unicodedata

_DOBRA = {}


def fold1(s):
    out = []
    for ch in s:
        b = _DOBRA.get(ch)
        if b is None:
            d = unicodedata.normalize('NFD', ch)
            b = (d[0] if d else ch).lower()
            _DOBRA[ch] = b
        out.append(b)
    return ''.join(out)


# ─── tabela de familias ───────────────────────────────────────────────────────
# (regex de prefixo, familia, designador, forma do simbolo, unidade do valor, grupo)
# grupo: 'b' = basicos (mesmo simbolo, muitos valores) | 'e' = especiais (pinagem propria)
#
# A ordem importa: a primeira regra que casa vence, entao o especifico vem antes
# do generico ("capacitor eletrolitico" antes de "capacitor").
_REGRAS = [
    # ---- basicos ------------------------------------------------------------
    (r'redes? e matrizes de resistores|rede de resistores',
     'RESISTOR REDE', 'RN', 'rede', 'R', 'b'),
    (r'resistor(?:es)?(?: de| em)?(?: metal filme| filme espesso| filme fino'
     r'| fio enrolado(?: \(de potencia\))?| carbono| precisao| shunt| smd)?',
     'RESISTOR', 'R', 'res', 'R', 'b'),
    (r'(?:trimpot|potenciometros?)(?: multivoltas| helitrim| linear(?: de carbono)?| digital)?',
     'POTENCIOMETRO', 'RV', 'pot', 'R', 'b'),
    (r'varistor(?:es)?(?: \(mov\)| de oxido(?: metalico)?)?',
     'VARISTOR', 'RV', 'varis', 'V', 'b'),
    (r'termistor(?:es)?(?: ntc| ptc)?', 'TERMISTOR', 'RT', 'termi', 'R', 'b'),
    (r'supercapacitor(?:es)?|ultracapacitor(?:es)?',
     'SUPERCAPACITOR', 'C', 'cpol', 'F', 'b'),
    (r'capacitor(?:es)?(?: de)? ceramic[oa](?: metal frame| multicamada| disco| smd)?',
     'CAPACITOR CERAMICO', 'C', 'cap', 'F', 'b'),
    (r'capacitor(?:es)?(?: de)? eletrolitico(?:s)?(?: radial| axial| de aluminio| smd)?',
     'CAPACITOR ELETROLITICO', 'C', 'cpol', 'F', 'b'),
    (r'capacitor(?:es)?(?: de)? tantalo(?: solido| smd)?',
     'CAPACITOR TANTALO', 'C', 'cpol', 'F', 'b'),
    (r'capacitor(?:es)?(?: de)? (?:poliester|polipropileno|filme|papel)'
     r'(?: metalizado| caneca| box)?',
     'CAPACITOR POLIESTER', 'C', 'cap', 'F', 'b'),
    (r'capacitor(?:es)?(?: de)? seguranca(?: classe [xy]\d?)?',
     'CAPACITOR SEGURANCA', 'C', 'cap', 'F', 'b'),
    (r'capacitor(?:es)?(?: variavel| trimmer)',
     'CAPACITOR VARIAVEL', 'C', 'cvar', 'F', 'b'),
    (r'capacitor(?:es)?', 'CAPACITOR', 'C', 'cap', 'F', 'b'),
    (r'(?:indutor(?:es)?|bobina de choque)(?: de)?'
     r'(?: choque| potencia| fio| toroidal| radial| axial| smd)?',
     'INDUTOR', 'L', 'ind', 'H', 'b'),
    (r'(?:bead|filtro) de ferrite|ferrite',
     'FERRITE', 'FB', 'ferr', 'R', 'b'),
    (r'(?:cristal|oscilador|ressonador)(?: radial| smd| a cristal)?',
     'CRISTAL', 'Y', 'xtal', 'Hz', 'b'),
    (r'diodo(?:s)? (?:zener|zenner)', 'DIODO ZENER', 'D', 'zener', 'V', 'b'),
    (r'diodo(?:s)?(?: de)? schottky', 'DIODO SCHOTTKY', 'D', 'schot', 'V', 'b'),
    (r'diodo(?:s)? (?:supressor(?: de)?(?: transiente| tensao)?|tvs)'
     r'(?: bidirecional| unidirecional)?',
     'DIODO TVS', 'D', 'tvs', 'V', 'b'),
    (r'diodo(?:s)? diac(?: disparo)?(?: bidirecional)?', 'DIAC', 'D', 'diac', 'V', 'b'),
    (r'ponte(?:s)? retificadora(?:s)?', 'PONTE RETIFICADORA', 'D', 'ponte', 'V', 'b'),
    # A regra pega o diodo comum e tambem o de comutacao/sinal, e por isso vem DEPOIS de
    # zener, schottky, TVS e DIAC: o sufixo e opcional, entao ela casaria com todos eles.
    # O nome da familia e RETIFICADOR porque e o que o almoxarifado chama assim (43 dos 65
    # itens da categoria "Diodo Retificador" do Odoo caem aqui) — inclusive os de sinal,
    # que sao retificadores de pequeno porte.
    (r'diodo(?:s)?(?: de)?(?: retificador(?:a)?| comutacao(?: de sinais)?'
     r'| transicao de sinal| silicio| sinal| uso geral| rapido| regulador programavel)?',
     'DIODO RETIFICADOR', 'D', 'diodo', 'V', 'b'),
    (r'led(?:s)?(?: de cor)?(?: single color)?(?: smd)?', 'LED', 'DS', 'led', '', 'b'),
    (r'(?:transistor(?:es)?(?: de alta tensao)? )?mosfet(?:s)?(?: de canal [np])?',
     'MOSFET', 'Q', 'mosfet', 'V', 'b'),
    (r'(?:tiristor(?:es)?|scr|triac(?:s)?)', 'TIRISTOR', 'Q', 'scr', 'V', 'b'),
    (r'igbt(?:s)?', 'IGBT', 'Q', 'igbt', 'V', 'b'),
    (r'transistor(?:es|)(?: bipolar(?:es)?(?: de juncao)?| bjt| npn| pnp'
     r'| darlington| digital| de potencia| de juncao)*',
     'TRANSISTOR', 'Q', 'bjt', 'V', 'b'),
    (r'fusive(?:l|is)(?: eletronico(?:s)?)?\s*\(?ptc\)?|fusive(?:l|is) (?:eletronico|resetavel)',
     'FUSIVEL PTC', 'F', 'fusept', 'A', 'b'),
    (r'(?:porta.?)?fusive(?:l|is)(?: de montagem| axial| radial| smd| retardado| rapido)?',
     'FUSIVEL', 'F', 'fuse', 'A', 'b'),
    (r'(?:dip ?switch|chave dip)', 'DIP SWITCH', 'SW', 'dipsw', '', 'b'),
    (r'(?:chave|botao|push ?button|micro ?switch)(?: de)?'
     r'(?: contato momentaneo| push(?: button| switch)?| switch| tactil| seletora'
     r'| alavanca| gangorra| liga.?desliga| botao| optica| optoeletronica)?',
     'CHAVE', 'SW', 'sw', '', 'b'),
    (r'(?:barra(?:s)? de pinos|header)(?: simples| dupla| macho| femea)*',
     'BARRA DE PINOS', 'J', 'conn', '', 'b'),
    (r'(?:conector(?:es)?|borne(?:s)?|regua(?:s)? terminal|bloco terminal|soquete(?:s)?)'
     r'(?: de| para| bloco terminal| barra| circular| header| femea| macho| torneado)*',
     'CONECTOR', 'J', 'conn', '', 'b'),
    (r'bateria(?:s)?(?: / pilha)?(?: lithium| litio| cilindrica)?|pilha(?:s)?',
     'BATERIA', 'BT', 'bat', 'V', 'b'),
    # ---- especiais ----------------------------------------------------------
    (r'conversor(?:es)?(?: [a-z][a-z\-]*){0,2}? ?(?:dc ?/ ?dc|dcdc|cc ?/ ?cc)',
     'CONVERSOR DC/DC', 'U', 'box', '', 'e'),
    (r'conversor(?:es)?(?: [a-z][a-z\-]*){0,2}? ?(?:ac ?/ ?dc|ca ?/ ?cc)',
     'CONVERSOR AC/DC', 'U', 'box', '', 'e'),
    (r'conversor(?:es)?(?: [a-z][a-z\-]*){0,2}? ?(?:dc ?/ ?ac|cc ?/ ?ca)',
     'CONVERSOR DC/AC', 'U', 'box', '', 'e'),
    (r'conversor(?:es)?(?: analogico[ /-]*(?:para )?digital(?: adc)?'
     r'| analogicos? digitais?| analogico-digital| a/d| adc)',
     'CONVERSOR A/D', 'U', 'box', '', 'e'),
    (r'conversor(?:es)?(?: digital[ /-]*(?:para )?analogico(?: \(dac\))?| d/a| dac)',
     'CONVERSOR D/A', 'U', 'box', '', 'e'),
    (r'conversor(?:es)? tensao.?para.?frequencia(?: \(v/f\))?|conversor(?:es)? v/f',
     'CONVERSOR V/F', 'U', 'box', '', 'e'),
    (r'conversor(?:es)?', 'CONVERSOR', 'U', 'box', '', 'e'),
    (r'(?:microcontrolador(?:es)?|microprocessador(?:es)?|mcu|dsp|fpga)'
     r'(?: ci| de \d+ bits?| \d+ bits?| \d+ bit)?',
     'MICROCONTROLADOR', 'U', 'box', '', 'e'),
    (r'amplificador(?:es)?(?: operacional(?: \(amp\))?| isolado| de isolamento| linear'
     r'| de instrumentacao| diferencial| de potencia| logaritmico)?',
     'AMPLIFICADOR', 'U', 'box', '', 'e'),
    (r'regulador(?:es)?(?: de tensao)?(?: linear| de comutacao| ajustavel| step ?up| step ?down)?',
     'REGULADOR', 'U', 'box', '', 'e'),
    (r'(?:opto ?acoplador(?:es)?|opto ?aclopador(?:es)?|opto ?isolador(?:es)?|acoplador(?:es)?)'
     r'(?: quadruplo| duplo)?(?: [a-z]+)?(?: de saida)?'
     r'(?: transistorizada| fototransistor| triac| logico)?',
     'OPTOACOPLADOR', 'U', 'opto', '', 'e'),
    (r'(?:transceptor(?:es)?|transceiver)', 'TRANSCEPTOR', 'U', 'box', '', 'e'),
    (r'(?:memoria(?:s)?|eeprom|eprom|flash|nvram|sram|dram)',
     'MEMORIA', 'U', 'box', '', 'e'),
    (r'(?:real time clock|rtc)', 'RTC', 'U', 'box', '', 'e'),
    (r'(?:rele(?:s)?|relay)(?: de)?(?: estado solido| montagem pcb| eletronico| dpdt| spdt)?',
     'RELE', 'K', 'box', 'V', 'e'),
    (r'(?:sensor(?:es)?)(?: de| infravermelho| encoder| inclinometro)?(?: [a-z]+)?',
     'SENSOR', 'U', 'box', '', 'e'),
    (r'(?:gerenciador(?:es)? de energia|gerenciamento de bateria'
     r'|carregador(?:es)? de bateria|pmic|bms)',
     'GESTAO DE BATERIA', 'U', 'box', '', 'e'),
    (r'(?:display|lcd|oled|modulo(?:s)?)(?: [a-z]+)?', 'MODULO', 'U', 'box', '', 'e'),
    (r'controlador(?:es)?(?: de| para)?(?: [a-z]+){0,2}',
     'CONTROLADOR', 'U', 'box', '', 'e'),
    (r'driver(?:s)?(?: de| para)?(?: [a-z]+){0,2}', 'DRIVER', 'U', 'box', '', 'e'),
    (r'comparador(?:es)?(?: de| para| analogico(?:s)?| logico(?:s)?)?(?: [a-z]+){0,2}',
     'COMPARADOR', 'U', 'box', '', 'e'),
    (r'referencia(?:s)?(?: de tensao)?', 'REFERENCIA DE TENSAO', 'U', 'box', '', 'e'),
    (r'contador(?:es)?(?: de| para| digital(?:is)?| crescente)?(?: [a-z]+){0,2}',
     'CONTADOR', 'U', 'box', '', 'e'),
    (r'(?:circuito(?:s)? integrado(?:s)?|ci)(?: -)?(?: [a-z]+){0,3}',
     'CIRCUITO INTEGRADO', 'U', 'box', '', 'e'),
    # `circuito` sozinho vem DEPOIS de `circuito integrado`, senao engoliria o especifico.
    # E o que traz "Circuito de Interface RS-485 - SN65HVD75DR" e "Circuito WDT ..." — nomes
    # que descrevem a FUNCAO em vez do tipo, e que caiam fora por nao comecar por nenhuma
    # palavra conhecida. "Placa de circuito impresso" nao entra aqui: comeca por "placa".
    (r'circuito(?:s)?(?: de| para)?(?: [a-z]+){0,3}',
     'CIRCUITO INTEGRADO', 'U', 'box', '', 'e'),
    (r'(?:transformador(?:es)?|trafo)', 'TRANSFORMADOR', 'T', 'trafo', '', 'e'),
    (r'(?:timer(?:s)?|temporizador(?:es)?)', 'TIMER', 'U', 'box', '', 'e'),
]
REGRAS = [(re.compile(r'^(?:' + rx + r')\b'), fam, des, forma, un, gr)
          for rx, fam, des, forma, un, gr in _REGRAS]

# o que nao e componente de PCB: sai antes de qualquer regra
LIXO = re.compile(
    r'parafuso|porca|arruela|rebite|broca|fresa|macho manual|helicoil|bucha|retentor|'
    r'rolamento|fibra|mecanic|ferramenta|chave allen|chaveta|chave de fenda|alicate|'
    r'equipamento|jateadeira|embalagem|etiqueta|limpeza|\bepi\b|servico|lubrific|tinta|'
    r'adesivo|abracadeira|pincel|estanho|fluxo de solda|^solda|^fita |papel|caixa|'
    r'escritorio|espacador|suporte|dissipador|manual|caneta|caneca|caderno|tarugo|'
    r'^ima |vidro|borracha|mangueira|cabo de aco|placa de circuito|placa circuito impresso|'
    r'impressao 3d|trilho din|garra de jacare|terminal olhal|ponta de solda|cooler|'
    r'lampada|valvula|disjuntor|filtro emi|fonte de alimentacao|^nucleo |coluna|maminha|'
    r'plastico bolha|^cabo |^fio |^tubo|conversor (?:av|hdmi)|camera|modem|multimetro|'
    r'osciloscopio|amperimetro|^rede\b|^conexoes|^regua linear|^pilha para|calculadora|'
    # "Conector de Reducao - 1\" x 15mm" e reducao de TUBO, cadastrada em Producao
    # Mecanica. Era o unico item de conector que nenhum subtipo reconhecia, e sozinho
    # sustentava uma familia "CONECTOR" sem subtipo na lista da esquerda.
    r'conector de reducao')


# ─── extracao de campos do nome ───────────────────────────────────────────────
MPN_COLCHETE = re.compile(r'\[([^\]]{3,})\]')
_SEG = re.compile(r'\s[-–]\s|\s{2,}')
_PKG_SOZINHO = re.compile(
    r'(?i)^(?:dip|pdip|soic|so|ssop|tssop|msop|vssop|qfn|tqfp|lqfp|qfp|plcc|sip|can|'
    r'sot|sod|to|do|hc)-?\d+[a-z]*(?:-\d+)?$')


def mpn_de(nome):
    """O part number do fabricante: entre colchetes, ou o ultimo trecho ' - XXX '
       que pareca part number (e nao seja so o encapsulamento)."""
    m = MPN_COLCHETE.search(nome)
    if m:
        return m.group(1).strip()
    for parte in reversed(_SEG.split(nome)):
        p = parte.strip().strip('()')
        if not p or _PKG_SOZINHO.match(p):
            continue
        if len(p) < 4 or ' ' in p:
            continue
        if re.search(r'\d', p) and re.search(r'[A-Za-z]', p) and re.match(r'^[A-Za-z0-9]', p):
            if not re.fullmatch(r'(?i)\d+[a-z]{0,2}', p):
                return p
    return ''


def mouser_de(forn):
    """'MOUSER ELETRONICS:595-XXX | DIGIKEY:YYY' -> ('595-XXX', 'DIGIKEY:YYY')"""
    mouser, outros = '', []
    for parte in (forn or '').split(' | '):
        if ':' not in parte:
            continue
        quem, cod = parte.split(':', 1)
        if 'mouser' in quem.lower():
            mouser = mouser or cod.strip()
        else:
            outros.append(parte.strip())
    return mouser, ' | '.join(outros)


VIAS = re.compile(r'(\d+)\s*(?:vias?|pinos?|bornes?|polos?|posicoes|terminais|contatos|pos\b|p\b)')


def vias_de(nome_folded):
    m = VIAS.search(nome_folded)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 80:
            return n
    return 0


# conversor: "24Vcc/5Vcc", "18~36Vdc / 12Vdc", "5VDC p/ ±15VDC", "100~240Vac / 12Vdc"
_V = r'[±\+\-]?\s*\d+(?:[.,]\d+)?(?:\s*~\s*[±\+\-]?\d+(?:[.,]\d+)?)?'
CONV = re.compile(r'(' + _V + r')\s*v(?:dc|cc|ac|ca)?\s*(?:/|p/|para|->)\s*(' + _V + r')\s*v(?:dc|cc|ac|ca)?',
                  re.I)
CONV2 = re.compile(r'(\d+(?:[.,]\d+)?)\s*v\s*~\s*(\d+(?:[.,]\d+)?)\s*v', re.I)
POT_W = re.compile(r'(\d+(?:[.,]\d+)?)\s*w\b', re.I)


def _lv(s):
    return re.sub(r'\s+', '', s).replace(',', '.')


def conversor_io(nome):
    """('24', '5') para um 24V->5V; ('', '') quando o nome nao diz."""
    m = CONV.search(nome)
    if m:
        return _lv(m.group(1)), _lv(m.group(2))
    m = CONV2.search(nome)
    if m:
        return _lv(m.group(1)), _lv(m.group(2))
    return '', ''


# ─── limpeza do rotulo da part ────────────────────────────────────────────────
_MONTAGEM_TOK = re.compile(r'(?i)\b(smd|smt|pth|through hole|furo passante)\b')
_LIXO_BORDA = re.compile(r'^[\s\-–:,;/\.]+|[\s\-–:,;/\.]+$')


def limpa_rotulo(txt, pkg):
    """Tira do rotulo o que ja esta em outro campo: encapsulamento, montagem,
       colchetes de MPN e a pontuacao solta que sobra do recorte.

    Troca tambem a barra vertical por '/': ela e o SEPARADOR DE CAMPOS do formato
    .SchLib, entao um nome do Odoo como "0.47uF|470nf 50V" cortaria o registro ao meio
    na hora de gravar a biblioteca."""
    t = txt.replace('|', '/')
    t = MPN_COLCHETE.sub(' ', t)
    if pkg:
        t = re.sub(r'(?i)\b' + re.escape(pkg) + r'\b', ' ', t)
        t = re.sub(r'(?i)\b' + re.escape(pkg.replace('-', '')) + r'\b', ' ', t)
    t = _MONTAGEM_TOK.sub(' ', t)
    t = re.sub(r'\(\s*\)', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    t = _LIXO_BORDA.sub('', t)
    return t.strip()


# ─── polaridade do BJT ────────────────────────────────────────────────────────
# A regra de TRANSISTOR engole os tokens "npn"/"pnp" para formar o rotulo, entao a
# polaridade tem de ser lida do nome INTEIRO, antes de qualquer corte. Quando o nome cala, o
# prefixo do part number resolve a maioria — sao familias de polaridade fixa. O que nao se
# decide por nenhum dos dois fica em branco DE PROPOSITO: chutar a seta e pior que omitir,
# porque um desenho errado e uma afirmacao errada no esquema.
_POL_TXT = re.compile(r'\b(npn|pnp)\b')
_POL_MPN = [
    ('pnp', re.compile(r'^(?:bc(?:32[0-9]|807|85[67]|860)|2n(?:2905|3906|4403|5401)'
                       r'|mmbt(?:3906|4403|5401)|bd(?:136|138|140|238|678|680)'
                       r'|tip(?:32|42|127|147)|mjd(?:32|127|210)|s8550|a1015|bcp5[23])', re.I)),
    ('npn', re.compile(r'^(?:bc(?:33[7-9]|54[6-8]|81[7-9]|846|84[78]|850)'
                       r'|2n(?:2222|3055|3904|5551)|mmbt(?:3904|2222|5551)'
                       r'|bd(?:135|137|139|237|239|677|679)|tip(?:31|41|122|142)'
                       r'|mjd(?:31|122|44)|s8050|c1815|bcp5[456])', re.I)),
]


def polaridade_bjt(fam, folded, mpn):
    """'npn', 'pnp' ou '' — nunca um chute."""
    if fam != 'TRANSISTOR':
        return ''
    # o dump raramente isola o part number num campo proprio: os codigos aparecem soltos no
    # meio do nome ("Transistor BC327-25"), entao a busca e por PALAVRA no nome inteiro
    alvos = [(mpn or '').strip()] + re.findall(r'[a-z]{1,4}\d[\w-]*', folded or '')
    por_mpn = ''
    for pol, rx in _POL_MPN:
        if any(a and rx.match(a) for a in alvos):
            por_mpn = pol
            break
    m = _POL_TXT.search(folded or '')
    # o part number tem a palavra final quando os dois discordam: ele e a peca, a descricao
    # e texto digitado por gente. No dump de hoje isso salva o MMBT5551, que e NPN e esta
    # descrito como PNP.
    return por_mpn or (m.group(1) if m else '')


# ─── analise de uma linha do dump ─────────────────────────────────────────────
def analisar(row):
    nome = re.sub(r'\s+', ' ', (row.get('nome') or '')).strip()
    if not nome:
        return None
    f = fold1(nome)
    if LIXO.search(f):
        return None

    for rx, fam, des, forma, un, gr in REGRAS:
        m = rx.match(f)
        if not m:
            continue

        pkg = acha_pkg(sa(nome))
        mpn = mpn_de(nome)
        mouser, outros = mouser_de(row.get('fornecedor_partnumber'))
        rotulo = limpa_rotulo(nome[m.end():], pkg)
        if mpn:
            rotulo = limpa_rotulo(rotulo.replace(mpn, ' '), pkg)

        valor, valor_txt = valor_de(nome, un) if un else (None, '')

        # O SUBTIPO DO CONECTOR entra DEPOIS de a regra ter casado, e lendo o nome INTEIRO.
        # A ordem nao e detalhe: `rotulo` acima foi recortado por `m.end()`, entao alargar o
        # prefixo consumido para caber o subtipo mudaria o rotulo de todo conector -- e o
        # rotulo e a chave do livro-razao (Libs/almox-parts.json) e metade da identidade do
        # valor, que se funde com o homonimo. O subtipo troca a FAMILIA e mais nada.
        conn = CN.campos(nome, fam)
        if conn:
            fam = CN.familia_com_subtipo(fam, nome)

        def _f(k):
            try:
                return float(row.get(k) or 0)
            except ValueError:
                return 0.0

        return {
            'familia': fam, 'des': des, 'forma': forma, 'grupo': gr, 'unidade': un,
            # os campos do conector, soltos: e a tela que os junta numa linha (ver o
            # cabecalho de conectores.py). None para tudo que nao e conector.
            'conn': conn,
            # a polaridade nao cabe na FAMILIA: dividir TRANSISTOR em duas renumeraria o
            # almoxarifado inteiro (a chave do livro-razao e o nome do simbolo). Ela viaja
            # por VALOR e so troca o desenho daquele valor.
            'polaridade': polaridade_bjt(fam, f, mpn),
            'nome': nome, 'rotulo': rotulo, 'pkg': pkg, 'mont': montagem(f, pkg),
            # o extrator novo SO para conector. As outras familias que usam `vias`
            # (DIP SWITCH, CHAVE, RESISTOR REDE) continuam no vias_de de sempre: trocar o
            # numero de vias troca a PINAGEM DO SIMBOLO, e mexer nelas de carona seria
            # renomear simbolo que ninguem pediu para renomear.
            'pinos_pkg': pinos_do_pkg(pkg),
            'vias': conn['vias'] if conn else vias_de(f),
            'valor': valor, 'valor_txt': valor_txt,
            'mpn': mpn, 'mouser': mouser, 'fornecedores': outros,
            # so o colchete: o palpite do ultimo trecho e fraco demais para separar peca
            'mpn_expl': (MPN_COLCHETE.search(nome).group(1).strip()
                         if MPN_COLCHETE.search(nome) else ''),
            'categoria': (row.get('categoria') or '').strip(),
            'odoo_id': row.get('product_id'), 'tmpl_id': row.get('template_id'),
            'estoque': _f('qtd_almoxarifado'), 'unidade_estoque': (row.get('unidade') or '').strip(),
            'local': (row.get('localizacao_codigo') or '').strip(),
            'locais': (row.get('locais_estoque') or '').strip(),
            'custo': _f('custo'),
        }
    return None
