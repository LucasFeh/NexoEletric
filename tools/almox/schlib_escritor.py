# -*- coding: utf-8 -*-
"""Escreve as .SchLib do almoxarifado direto, sem passar pelo Altium.

Junta as três peças: `cfbf.py` (contêiner OLE2), `schlib_bin.py` (registros) e o espelho
`Libs/almox-*.js` (o conteúdo). E faz o que o usuário pediu: em vez de desenhar símbolo
novo, **recicla os símbolos da biblioteca real** — o `RES [ SMD ]` dele já vem com a
geometria da casa e, de brinde, com os footprints `RES 0805 / 1206 / 2512` associados.

Onde não há símbolo equivalente na lib real, cai para a geometria desenhada em
`simbolos.py`, convertida para registros.

Unidades: o espelho está em mil; o arquivo .SchLib guarda int16 em unidades de 10 mil.
"""
import io, json, os, re, struct, sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
LIBS = os.path.join(RAIZ, 'Libs')
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
sys.path.insert(0, BASE)

import cfbf                                            # noqa: E402
import schlib_bin as SB                                # noqa: E402
import libpath as LP                                   # noqa: E402

# O piso da ordem do `tools/libpath.py`: a cópia publicada dentro do repositório. Era o
# literal de uma máquina, que não existe no servidor e, aqui, estava três saves do
# Altium atrás da lib viva — os dois botões de sincronismo reciclavam de cópias diferentes.
# Constante de módulo NÃO resolve a ordem inteira (o passo do config faz `isfile` num
# caminho de rede, caro em tempo de import); quem chama `carrega_lib()`/`gera()` sem
# argumento cai na resolução completa, lá dentro.
LIB_REAL = LP.repo_schlib(RAIZ)

# ─── quais símbolos da lib real cada família do almoxarifado reaproveita ──────
# A chave é o nome do símbolo gerado; o valor, o LibReference na biblioteca do usuário.
# O que não estiver aqui é desenhado a partir do `simbolos.py`.
CATALOGO = {
    'RESISTOR [SMD]':               'RES [ SMD ]',
    'RESISTOR [PTH]':               'RES [ PTH ]',
    'RESISTOR REDE':                'RES [ PTH ]',
    'CAPACITOR CERAMICO [SMD]':     'CAP [  SMD  ]',
    'CAPACITOR CERAMICO [PTH]':     'CAP [  PTH  ]',
    'CAPACITOR ELETROLITICO [SMD]': 'CAP EL [ SMD  ]',
    'CAPACITOR ELETROLITICO [PTH]': 'CAP EL [  PTH  ]',
    'CAPACITOR POLIESTER [PTH]':    'CAP [  PTH  ]',
    'CAPACITOR SEGURANCA [PTH]':    'CAP [  PTH  ]',
    'CAPACITOR TANTALO [SMD]':      'CAP EL [ SMD  ]',
    'CAPACITOR':                    'CAP [  PTH  ]',
    'SUPERCAPACITOR':               'CAP EL [  PTH  ]',
    'DIODO [SMD]':                  'DIODO SMD',
    'DIODO [PTH]':                  'DIODO PTH',
    'DIODO ZENER [PTH]':            'DIODO [ ZENER ] PTH',
    'DIODO ZENER [SMD]':            'DIODO [ ZENER ] SMD',
    'DIODO SCHOTTKY':               'DIODO [ Schottky ] PTH',
    'DIODO TVS':                    'DIODO [ SUPRESSOR DE TRANSIENTE UNIDIRECIONAL ] PTH',
    'PONTE RETIFICADORA [PTH]':     'PONTE RETIFICADORA',
    'LED':                          'LED',
    'MOSFET':                       'MOSFET',
    'FUSIVEL':                      'FUSIVEL',
    'FUSIVEL PTC':                  'FUSIVEL',
    'CRISTAL [PTH]':                'Cristal',
    'VARISTOR':                     'Varistor',
    'POTENCIOMETRO':                'Potenciometro',
    'FERRITE':                      'FERRITE BEAD',
    'INDUTOR':                      'Indutor magnético',
    'BATERIA':                      'Bateria',
    'CHAVE':                        'Chave Contato Momentâneo',
    'TRANSISTOR':                   '2N3904',          # símbolo BJT padrão da casa
}
# conectores: a família traz o número de vias no nome, e a lib real tem barra por via
CONECTOR_RX = re.compile(r'^(CONECTOR|BARRA DE PINOS) (\d+)V')

# Os parametros que a escolha do valor preenche. Sao declarados uma vez, aqui, e
# qualquer homonimo herdado do simbolo reciclado e descartado.
CAMPOS_DO_VALOR = ('Comment', 'Value', 'Encapsulamento', 'MPN', 'Mouser', 'OdooId',
                   'Estoque', 'Local', 'Custo', 'ValorId')
# Qual parametro APARECE na folha. O Altium mostra o parametro que nao tem IsHidden; o resto
# vive no Parameter Manager. Aqui e o Value, e o Comment sai SUPRIMIDO: o Comment repete o
# nome do componente — que o designador e o footprint ja dizem — enquanto o Value e o que
# muda de peca para peca (10K, 100nF, 12V) e e o que se quer ler no esquema.
PARAM_VISIVEL = 'Value'
BARRA_FMT = 'BARRA TERMINAL %d VIAS'


def footprints_do_modelo(nome_simbolo, comps):
    """Os footprints que o simbolo reciclado ja carrega (RES 0805, RES 1206...).

    O espelho do hub precisa listar OS MESMOS nomes que a .SchLib vai ter: se ele
    disser "0805" (o encapsulamento do Odoo) e o arquivo tiver "RES 0805", o
    BuildSchematic nao acha o modelo na hora de colocar o componente na folha."""
    modelo = comps.get(CATALOGO.get(nome_simbolo, ''))
    if modelo is None:
        m = CONECTOR_RX.match(nome_simbolo or '')
        if m:
            modelo = comps.get(BARRA_FMT % int(m.group(2)))
    if not modelo:
        return []
    fora = []
    for tipo, pl in modelo:
        if tipo != SB.TEXTO:
            continue
        d = SB.le_texto(pl)
        if d.get('RECORD') == '45' and d.get('ModelName'):
            fora.append((d['ModelName'], d.get('IsCurrent') == 'T'))
    return fora


def _uid(semente):
    """UniqueID de 8 letras, estável entre gerações (o Altium só quer unicidade)."""
    h = 0
    for c in str(semente):
        h = (h * 131 + ord(c)) & 0xFFFFFFFFFFFF
    letras = ''
    for _ in range(8):
        letras += chr(65 + (h % 26))
        h //= 26
    return letras


def u(v):
    """mil -> unidade do arquivo"""
    return int(round(v / 10.0))


# ─── leitura da biblioteca de origem ─────────────────────────────────────────
def carrega_lib(caminho=None):
    """-> (cabecalho, {LibReference: [(tipo, payload)]})

    Sem caminho, a ordem do `tools/libpath.py`: a lib viva do config enquanto ela
    existir, senão a publicada no repositório. Resolvido AQUI, não no default da
    assinatura — um default é avaliado uma vez, no import, e congelaria para a vida do
    processo o que a rede respondeu naquele instante."""
    caminho = caminho or LP.schlib(RAIZ)
    try:
        import olefile
    except ImportError:
        # o hub dispara os scripts com sys.executable; numa maquina com varios Pythons e
        # facil subir o servidor com um que nao tem a dependencia. O recado diz QUAL.
        raise RuntimeError(
            'falta o modulo olefile, que le os arquivos .SchLib do Altium.\n'
            'Instale no MESMO Python que roda o hub:\n'
            '    "%s" -m pip install olefile' % sys.executable)
    o = olefile.OleFileIO(caminho)
    cab = SB.le_texto(SB.desmonta(o.openstream('FileHeader').read())[0][1])
    comps = {}
    for s in o.listdir():
        if len(s) != 2 or s[1] != 'Data' or s[0] == 'FileHeader':
            continue
        regs = SB.desmonta(o.openstream('/'.join(s)).read())
        if not regs or regs[0][0] != SB.TEXTO:
            continue
        d = SB.le_texto(regs[0][1])
        if d.get('RECORD') == '1':
            comps[d.get('LibReference', s[0])] = regs
    o.close()
    return cab, comps


# ─── geometria desenhada -> registros (para quem não tem símbolo reciclado) ──
def _reg(d):
    return (SB.TEXTO, SB.escreve_texto(d))


# Paleta da casa, medida POR TIPO DE REGISTRO na BIBLIOTECA DE ESQUEMA.SchLib real.
# A cor NAO e uniforme, e generalizar de um tipo para os outros ja deu errado uma vez:
#   retangulo (14) Color=128       283 de 336   <- so ele e 128
#   polilinha (6)  Color=16711680 1497 de 1759
#   arco      (12) Color=16711680  845 de 887   (128: nenhum)
#   linha     (13) Color=16711680  775 de 830   (128: nenhum)
#   elipse    (11) Color=16711680   85 de  85   (128: nenhum)
#   rotulo    (4)  Color=8388608   111 de 155
# O corpo preenchido do retangulo: AreaColor=11599871 + IsSolid=T + Transparent=T
# (combinacao dominante, 190 de 336; AreaColor=11599871 em 300).
# Miolo de poligono (7): AreaColor=1938175, 343 de 405.
COR_LINHA = 16711680        # o azul padrao: polilinha, arco, linha, elipse
COR_BORDA_CORPO = 128       # SO o retangulo do corpo
COR_CORPO = 11599871
COR_POLI = 1938175
COR_TEXTO = 8388608


def forma_para_registro(g, parte, seq):
    """um item `graphics` do espelho schlib-v2 -> registro ASCII do Altium"""
    base = [('RECORD', None), ('IsNotAccesible', 'T'), ('OwnerPartId', parte)]
    k = g['g']
    d = dict()

    def mk(rec, extra, cor=COR_LINHA, depois=None):
        # a ordem segue a da lib real: ... Color, AreaColor, IsSolid, Transparent, UniqueID
        o = [('RECORD', rec), ('IsNotAccesible', 'T'), ('OwnerPartId', parte)]
        o += extra
        o += [('Color', cor)]
        o += (depois or [])
        o += [('UniqueID', _uid(seq))]
        from collections import OrderedDict
        return OrderedDict(o)

    if k == 'rect':
        return _reg(mk(14, [('Location.X', u(g['x1'])), ('Location.Y', u(g['y1'])),
                            ('Corner.X', u(g['x2'])), ('Corner.Y', u(g['y2'])),
                            ('LineWidth', 1)], cor=COR_BORDA_CORPO,
                       depois=[('AreaColor', COR_CORPO), ('IsSolid', 'T'),
                               ('Transparent', 'T')]))
    if k == 'line':
        return _reg(mk(13, [('Location.X', u(g['x1'])), ('Location.Y', u(g['y1'])),
                            ('Corner.X', u(g['x2'])), ('Corner.Y', u(g['y2'])),
                            ('LineWidth', 1)]))
    if k in ('polyline', 'poly'):
        pts = g.get('pts') or []
        extra = [('LineWidth', 1), ('LocationCount', len(pts))]
        for i, (x, y) in enumerate(pts, 1):
            extra += [('X%d' % i, u(x)), ('Y%d' % i, u(y))]
        rec = 7 if k == 'poly' else 6
        if k == 'poly':
            extra = [('AreaColor', COR_POLI), ('IsSolid', 'T')] + extra
        return _reg(mk(rec, extra))
    if k == 'arc':
        return _reg(mk(12, [('Location.X', u(g['cx'])), ('Location.Y', u(g['cy'])),
                            ('Radius', u(g['r'])), ('LineWidth', 1),
                            ('StartAngle', '%.3f' % float(g.get('sa', 0))),
                            ('EndAngle', '%.3f' % float(g.get('ea', 360)))]))
    if k == 'ellipse':
        return _reg(mk(11, [('Location.X', u(g['cx'])), ('Location.Y', u(g['cy'])),
                            ('Radius', u(g['rx'])), ('SecondaryRadius', u(g['ry'])),
                            ('LineWidth', 1), ('EndAngle', '360.000')]))
    if k == 'label':
        return _reg(mk(4, [('Location.X', u(g['x'])), ('Location.Y', u(g['y'])),
                           ('FontID', 1), ('Text', g.get('text', ''))], cor=COR_TEXTO))
    _ = (base, d)
    return None


# ─── montagem de um componente ───────────────────────────────────────────────
def _classifica(regs):
    """separa o modelo reciclado em cabeçalho, nível-componente, nível-parte e footprints"""
    cab, comum, porparte, fps = None, [], [], []
    i, n = 0, len(regs)
    while i < n:
        tipo, pl = regs[i]
        if tipo == SB.BINARIO:
            porparte.append((tipo, pl)); i += 1; continue
        d = SB.le_texto(pl)
        r = d.get('RECORD')
        if r == '1':
            cab = d
        elif r == '44':
            fps.append((tipo, pl))
            j = i + 1
            while j < n and regs[j][0] == SB.TEXTO and \
                    SB.le_texto(regs[j][1]).get('RECORD') in ('45', '46', '48'):
                fps.append(regs[j]); j += 1
            i = j; continue
        elif d.get('OwnerPartId', '-1') == '-1':
            comum.append(d)
        else:
            porparte.append((tipo, pl))
        i += 1
    return cab, comum, porparte, fps


def _com_parte(reg, parte):
    """devolve o registro com OwnerPartId trocado (texto ou pino)"""
    tipo, pl = reg
    if tipo == SB.BINARIO:
        p = SB.le_pino(pl)
        p['ownerpartid'] = parte
        return (tipo, SB.escreve_pino(p))
    d = SB.le_texto(pl)
    d['OwnerPartId'] = parte
    if 'UniqueID' in d:
        d['UniqueID'] = _uid(str(d.get('UniqueID')) + '#' + str(parte))
    return _reg(d)


# Altura de uma linha de texto e respiro, em unidades do arquivo (1 = 10 mil).
# A ancora de um texto no Altium e o PE da linha: ele ocupa da ancora para CIMA.
# Ignorar isso foi o defeito: o designador do termistor foi para 40 mil acima do
# rotulo "t°" (ancorado em 70) e caiu bem no meio dele, que vai ate 170; e o Comment,
# ancorado 40 mil abaixo do desenho, subia por cima do corpo.
# Todo texto que este modulo grava sai com FontID=1 (a fonte 1 da lib da casa, tamanho
# 10), entao 100 mil cobre qualquer linha - forma_para_registro nem repassa o `size`
# do espelho.
ALTURA_TEXTO = 10
FOLGA_TEXTO = 5


def _ys(regs):
    """todos os Y (em unidades do arquivo) que o desenho da parte ocupa"""
    ys = []
    for tipo, pl in regs:
        if tipo == SB.BINARIO:
            ys.append(SB.le_pino(pl)['y'])
            continue
        d = SB.le_texto(pl)
        # RECORD 4/34/41 sao texto; o resto e traco e ocupa so a propria coordenada
        texto = d.get('RECORD') in ('4', '34', '41')
        for k, v in d.items():
            # comparacao exata: "Location.Y_Frac" NAO e coordenada, e a fracao da
            # unidade. Os simbolos reciclados da casa trazem esses campos, e deixar
            # um 93701 entrar aqui jogava o extremo para o espaco.
            if k in ('Location.Y', 'Corner.Y') or re.match(r'^Y\d+$', k):
                try:
                    y = int(float(v))
                except ValueError:
                    continue
                ys.append(y)
                if texto:
                    ys.append(y + ALTURA_TEXTO)
    return ys


# RECORD que existe no arquivo mas nao vira desenho na folha: cabecalho do
# componente e a lista de modelos/footprints.
SEM_DESENHO = ('1', '44', '45', '46', '47', '48')


def _visiveis(regs):
    """só o que o Altium pinta na folha — fora o cabeçalho, os modelos e o escondido"""
    fora = []
    for tipo, pl in regs:
        if tipo != SB.TEXTO:
            fora.append((tipo, pl))
            continue
        d = SB.le_texto(pl)
        if d.get('RECORD') in SEM_DESENHO or d.get('IsHidden') == 'T':
            continue
        fora.append((tipo, pl))
    return fora


def _fundo(regs):
    """menor Y (em unidades do arquivo) dos registros, para pôr o rótulo embaixo"""
    ys = _ys(regs)
    return min(ys) if ys else 0


def _topo(regs):
    """maior Y (em unidades do arquivo), para pôr o designador em cima do desenho"""
    ys = _ys(regs)
    return max(ys) if ys else 0


def _acima_do_desenho(d, porparte, nivel=0):
    """Sobe um registro de texto para fora do desenho, empilhando uma linha por nível.

    Vale TAMBEM para o texto herdado de um simbolo reciclado. A biblioteca da casa
    escreve o designador por cima do desenho em 148 dos 245 componentes dela, e 386
    componentes gerados saiam assim - o "C?" atravessando as placas do capacitor.
    Copiar a construcao da casa nao inclui copiar isso: aqui o gerador padroniza, e
    como ele roda a cada sincronizacao, simbolo novo ja nasce certo e simbolo velho
    se conserta sozinho na proxima passada.

    A coordenada X fica como estava: o que incomoda e a sobreposicao vertical, e
    manter o X preserva o alinhamento que a casa escolheu.
    """
    d['Location.Y'] = _topo(porparte) + FOLGA_TEXTO + nivel * ALTURA_TEXTO
    # a fracao herdada somaria por cima da coordenada nova
    d.pop('Location.Y_Frac', None)
    # posicao automatica do Altium reescreveria o que acabamos de decidir
    d.pop('NotAutoPosition', None)
    d.pop('OverrideNotAutoPosition', None)


def monta_componente(sim, valor, modelo=None):
    """um VALOR do espelho -> um componente completo da .SchLib.

    Cada valor do almoxarifado vira um componente proprio, com nome
    "SMD 0805 10K 1/8W 1% 100ppm", o footprint daquele encapsulamento como modelo atual
    e os parametros ja preenchidos. A geometria vem da familia (o `sim`)."""
    from collections import OrderedDict
    nome = valor['altium']
    # a geometria e a da familia, a nao ser que o VALOR traga a dele: e o caso do BJT, em que
    # a seta separa NPN de PNP e a familia sozinha afirmaria que todos sao NPN
    partes = valor.get('parts') or sim['parts']
    npart = sim['partcount']

    if modelo:
        cab_m, comum, porparte, fps = _classifica(modelo)
    else:
        cab_m, comum, fps = None, [], []
        porparte = []
        base = partes[0]
        for i, pin in enumerate(base['pins']):
            # o olho do pino viaja com ele: `hideName`/`hideNum` do espelho apagam os bits
            # 0x08/0x10 do conglomerado. O pino gerado nasce com hideName (simbolos._pin) e
            # sai 0x30|rot — so o numero a vista; o que o usuario acendeu no hub sai aceso.
            porparte.append((SB.BINARIO, SB.escreve_pino(SB.pino(
                pin['num'], pin['name'], pin['x'], pin['y'], pin['len'], pin['orient'],
                pin.get('type', 'Passive'), 1,
                mostra_nome=not pin.get('hideName'), mostra_desig=not pin.get('hideNum')))))
        for i, g in enumerate(base['graphics']):
            r = forma_para_registro(g, 1, nome + '/g%d' % i)
            if r:
                porparte.append(r)

    fora = []
    # 1. cabeçalho do componente
    h = OrderedDict(cab_m or [])
    h['RECORD'] = '1'
    h.move_to_end('RECORD', last=False)
    h['LibReference'] = nome
    h['ComponentDescription'] = ((valor.get('itens') or [{}])[0].get('nome')
                                 or valor.get('label') or sim.get('description', ''))
    h['PartCount'] = npart + 1          # o ARQUIVO grava partes+1 (aqui sempre 2)
    h['DisplayModeCount'] = 1
    h['IndexInSheet'] = -1
    h['OwnerPartId'] = -1
    h['CurrentPartId'] = 1
    h.setdefault('LibraryPath', '*')
    h.setdefault('SourceLibraryName', '*')
    h.setdefault('SheetPartFileName', '*')
    h.setdefault('TargetFileName', '*')
    h['UniqueID'] = _uid(nome)
    h.setdefault('AreaColor', 11599871)
    h.setdefault('Color', 128)
    h['PartIDLocked'] = 'F'
    h['DesignItemId'] = nome
    h['AllPinCount'] = len(partes[0]['pins'])
    fora.append(_reg(h))

    # 2. parâmetros e designador do componente inteiro.
    #    Os campos que a escolha do valor preenche são declarados adiante; se o símbolo
    #    reciclado já trouxer um deles (o RES [ SMD ] da casa tem "Value" e um "Comment"
    #    que é expressão), ele sai daqui — dois parâmetros com o mesmo nome confundem o
    #    BOM e a atualização pelo DbLib.
    nivel = 0
    for d in comum:
        d = OrderedDict(d)
        if d.get('RECORD') == '41' and d.get('Name') in CAMPOS_DO_VALOR:
            continue
        if d.get('RECORD') == '34':
            d['Text'] = (sim.get('designator') or 'U') + '?'
        # Todo texto que APARECE sobe para cima do desenho, inclusive o que veio
        # herdado do simbolo reciclado. Um por linha, para nao se cobrirem.
        if d.get('RECORD') in ('34', '41') and d.get('IsHidden') != 'T':
            _acima_do_desenho(d, porparte, nivel)
            nivel += 1
        if 'UniqueID' in d:
            d['UniqueID'] = _uid(nome + '#' + str(d.get('Name', d.get('Text', ''))))
        fora.append(_reg(d))
    if not any(SB.le_texto(p).get('RECORD') == '34' for t, p in
               [(SB.TEXTO, SB.escreve_texto(d)) for d in comum] if t == SB.TEXTO):
        fora.append(_reg(OrderedDict([
            ('RECORD', 34), ('IndexInSheet', -1), ('OwnerPartId', -1),
            # Acima de TUDO que o desenho ocupa, inclusive a altura dos rotulos.
            # Era u(200) fixo, que caia DENTRO do corpo em 460 dos 460 componentes.
            ('Location.X', 0),
            ('Location.Y', _topo(porparte) + FOLGA_TEXTO + nivel * ALTURA_TEXTO),
            ('Color', 8388608), ('FontID', 1),
            ('Text', (sim.get('designator') or 'U') + '?'), ('Name', 'Designator'),
            ('ReadOnlyState', 1), ('UniqueID', _uid(nome + '#desig'))])))

    # 3. corpo e pinos — uma parte só. O valor NAO mora mais aqui: ele e um conjunto de
    #    parametros preenchido na hora de colocar (pelo hub) ou escolhido no .DbLib.
    # O Comment cresce para cima a partir daqui, entao desce a altura da linha INTEIRA
    # mais o respiro - senao ele sobe por cima do corpo, que era o caso do "MF-250".
    # A conta olha TUDO que ja foi emitido e aparece na folha, nao so o desenho da
    # parte: num simbolo reciclado o designador vem da lib da casa e as vezes mora
    # embaixo do corpo, e o Comment caia bem em cima dele.
    ybase = _fundo(_visiveis(fora) + _visiveis(porparte)) - FOLGA_TEXTO - ALTURA_TEXTO
    for reg in porparte:
        fora.append(_com_parte(reg, 1))

    # os parametros do valor, ja PREENCHIDOS — o componente sai da lib pronto
    vals = {q['n']: q['v'] for q in (valor.get('params') or [])}
    vals.setdefault('Comment', valor.get('label', ''))
    vals['ValorId'] = valor.get('id', '')
    vals['Familia'] = sim.get('familia', '')
    for i, campo in enumerate(CAMPOS_DO_VALOR + ('Familia',)):
        texto = vals.get(campo, '')
        # o visivel e o Comment saem SEMPRE, mesmo vazios: o visivel porque sem ele o
        # componente ficaria mudo na folha, e o Comment porque o Altium conta com o campo
        # existindo. Os outros vazios so poluiriam o Parameter Manager.
        if campo not in ('Comment', PARAM_VISIVEL) and not texto:
            continue
        d = OrderedDict([
            ('RECORD', 41), ('IndexInSheet', -1), ('OwnerPartId', -1),
            # o visivel fica na linha de cima (a boa); os suprimidos empilham abaixo
            ('Location.X', 0), ('Location.Y', ybase - (0 if campo == PARAM_VISIVEL else 2 + i)),
            ('Color', 8388608), ('FontID', 1)])
        if campo != PARAM_VISIVEL:
            d['IsHidden'] = 'T'
        d['Text'] = texto
        d['Name'] = campo
        d['UniqueID'] = _uid(nome + '#' + campo)
        fora.append(_reg(d))

    # 4. footprints. Antes só saíam os do símbolo reciclado, e 110 dos 134 componentes
    #    ficavam com a aba Models vazia no Altium. Agora a lista é sintetizada sempre:
    #    os da casa (herdados do símbolo original) na frente, e os encapsulamentos que
    #    vieram do Odoo atrás, para nenhum componente nascer sem nada em Models.
    modelos = []
    vistos = set()
    for tipo, pl in fps:
        d = SB.le_texto(pl)
        if d.get('RECORD') == '45' and d.get('ModelName'):
            n = d['ModelName']
            if n not in vistos:
                vistos.add(n)
                modelos.append((n, d.get('IsCurrent') == 'T'))
    for m in (sim.get('footprints') or []):
        n = m.get('name')
        if n and n not in vistos:
            vistos.add(n)
            modelos.append((n, False))
    # O footprint DESTE valor e o atual; se nem estava na lista, entra na frente.
    # Valor sem encapsulamento nenhum fica SEM footprint atual, de proposito: eleger o
    # primeiro da familia colocaria um DIP14 num componente que ninguem sabe qual e —
    # errado e silencioso. Os modelos continuam la, para escolher a mao.
    alvo = valor.get('footprint') or ''
    modelos = [(n, n == alvo) for n, _a in modelos]
    if alvo and alvo not in vistos:
        modelos.insert(0, (alvo, True))

    if modelos:
        idx_lista = len(fora)
        fora.append(_reg(OrderedDict([('RECORD', 44)])))
        for n, atual in modelos:
            idx_modelo = len(fora)
            d = OrderedDict([
                ('RECORD', 45), ('OwnerIndex', idx_lista), ('IndexInSheet', -1),
                ('ModelName', n), ('ModelType', 'PCBLIB'), ('DatafileCount', 1),
                ('ModelDatafileEntity0', n), ('ModelDatafileKind0', 'PCBLib')])
            if atual:
                d['IsCurrent'] = 'T'
            d['UniqueID'] = _uid(nome + '#fp' + n)
            fora.append(_reg(d))
            fora.append(_reg(OrderedDict([('RECORD', 46), ('OwnerIndex', idx_modelo)])))
            fora.append(_reg(OrderedDict([('RECORD', 48), ('OwnerIndex', idx_modelo)])))
    return fora


# ─── a biblioteca inteira ────────────────────────────────────────────────────
def _modelo_de(sim, comps):
    """o simbolo da biblioteca da casa que esta familia recicla, se houver"""
    modelo = comps.get(CATALOGO.get(sim['name'], ''))
    if modelo is None:
        m = CONECTOR_RX.match(sim['name'])
        if m:
            modelo = comps.get(BARRA_FMT % int(m.group(2)))
    return modelo


PROIBIDOS = re.compile(r'[\\/:*?"<>|]')


def nome_storage(nome, usados):
    """O nome do storage de um componente, na convencao do proprio Altium.

    Ele NAO varre o arquivo procurando o LibReference: deriva o nome do storage a partir
    dele e abre direto. Errar a derivacao da "Cannot find item [...] within the current
    storage" na hora de abrir o componente.

    A regra, lida da biblioteca da casa (403 componentes):
      · caractere proibido vira '_'   ("24LC512-I/SM" -> "24LC512-I_SM")
      · corta em 31 caracteres
      · nao termina em '.' nem em espaco
      · na colisao, o ULTIMO caractere vira um digito, e nao um sufixo:
        "DIODO [ SUPRESSOR DE TRANSIENTE", depois "...TRANSIENT1", "...TRANSIENT2"
    A comparacao e sem caixa porque o diretorio do CFBF ordena em maiusculo.
    """
    base = PROIBIDOS.sub('_', nome or '')[:31].rstrip(' .')
    if not base:
        base = 'COMPONENTE'
    st, n = base, 0
    while st.upper() in usados:
        n += 1
        st = (base[:31 - len(str(n))].rstrip(' .') + str(n))
    usados.add(st.upper())
    return st


# ─── como o documento ABRE no Altium ─────────────────────────────────────────
# O FileHeader nao guarda so o indice: guarda tambem a cor da folha, a moldura, a grade,
# a unidade e a tabela de fontes. Isso vinha inteiro de carona no cabecalho modelo (a
# BIBLIOTECA DE ESQUEMA.SchLib da casa) — e no dia em que a lib da casa ficou fora de
# alcance, `carrega_lib()` devolveu {} e as 32 bibliotecas sairam com TRES campos de
# documento. O hub nao percebeu (ele le os registros, nao o cabecalho), mas o Altium abriu
# todas com a FOLHA PRETA, porque sem AreaColor ele nao tem cor para pintar.
#
# Agora estes valores sao o piso: o modelo, quando existe, escreve por cima. Sao os da lib
# da casa, para a biblioteca gerada abrir igual as outras.
CABECALHO_PADRAO = (
    ('AreaColor', 16317695),           # rgb(255,252,248) — a folha creme do Altium
    ('BorderOn', 'T'),
    ('SheetStyle', 9),
    ('UseCustomSheet', 'T'),
    ('CustomX', 18000), ('CustomY', 18000),
    ('Display_Unit', 1),
    ('SnapGridOn', 'T'), ('SnapGridSize', 1),
    ('VisibleGridOn', 'T'), ('VisibleGridSize', 3), ('VisibleGridSize_Frac', 93701),
    ('ReferenceZonesOn', 'T'), ('AlwaysShowCD', 'T'), ('IsBOC', 'T'), ('UseMBCS', 'T'),
    ('SheetNumberSpaceSize', 12),
    # os nossos registros referenciam FontID=1 e mais nenhum; sem a declaracao o Altium
    # cai numa fonte qualquer
    ('FontIdCount', 1), ('FontName1', 'Times New Roman'), ('Size1', 10),
)


def _cabecalho(itens, cab_modelo):
    """o registro unico do stream FileHeader: o indice da biblioteca.

    Separado do `monta_lib` porque o `gera` precisa MEDIR este registro antes de
    montar a biblioteca inteira - e ele que tem teto de tamanho (SB.MAX_REGISTRO) e
    que decide em quantos pedacos a familia vai sair.
    """
    from collections import OrderedDict
    cab = OrderedDict(CABECALHO_PADRAO)
    for k, v in (cab_modelo or {}).items():
        # tudo que e indexado POR COMPONENTE da lib modelo tem que sair: os indices
        # nao valem nada aqui. Comp<N>Alias<M> ficava para tras enquanto AliasCount<N>
        # saia - as 32 libs geradas carregavam 21 apelidos orfaos, herdados da lib da
        # casa, apontando para componentes que nao existem nelas.
        if re.match(r'^(LibRef|CompDescr|PartCount|AliasCount)\d+$', k):
            continue
        if re.match(r'^Comp\d+Alias\d+$', k):
            continue
        cab[k] = v
    cab['HEADER'] = 'Protel for Windows - Schematic Library Editor Binary File Version 5.0'
    cab['MinorVersion'] = 2
    for i, (_sim, valor) in enumerate(itens):
        cab['LibRef%d' % i] = valor['altium']
        # o indice do cabecalho fica com o rotulo curto; a descricao completa do Odoo
        # vive no proprio componente. Um cabecalho enxuto abre mais rapido no Altium.
        cab['CompDescr%d' % i] = valor.get('label', '')
        cab['PartCount%d' % i] = 2          # 1 parte, e o arquivo grava partes+1
    # CompCount vinha do cabecalho modelo e saia 403 nas 32 bibliotecas — o numero de
    # componentes da lib da CASA, nao o desta. Na lib real ele bate exato: 404 para
    # 404 componentes. (Weight nao e contagem: la sao 11.960 para os mesmos 404.)
    cab['CompCount'] = len(itens)
    cab['Weight'] = len(itens)
    return cab


def tamanho_cabecalho(itens, cab_modelo):
    """bytes que o registro do FileHeader vai ocupar para esta lista de itens"""
    return len(SB.escreve_texto(_cabecalho(itens, cab_modelo)))


def monta_lib(itens, cab_modelo, comps_modelo):
    """[(simbolo, valor)] -> arvore para o cfbf.escreve, um componente por valor"""
    arvore = {}
    usados = set()
    for sim, valor in itens:
        regs = monta_componente(sim, valor, _modelo_de(sim, comps_modelo))
        arvore[nome_storage(valor['altium'], usados)] = {'Data': SB.monta(regs)}
    arvore['FileHeader'] = SB.monta([_reg(_cabecalho(itens, cab_modelo))])
    return arvore


# A PcbLib da casa. Ela e COPIADA para a pasta das libs geradas, para o conjunto andar
# junto: o .LibPkg entao aponta para o arquivo ao lado, por nome, e o pacote fica
# autocontido — abre e compila em qualquer maquina que enxergue a pasta.
PCBLIB_NOME = 'FOOTPRINTS ALMOX.PcbLib'


def copia_pcblib(destino_dir, origem=None, log=print):
    """Traz a PcbLib para junto das SchLib. So copia se faltar ou se a de la mudou —
       sao 60 MB, e refazer isso a cada sincronizacao seria desperdicio.

       Sem origem, a ordem do `tools/libpath.py` para a chave `pcblib`. Diferente da
       SchLib, a PcbLib NAO e versionada (63 MB por versao no pack, e a release do
       servidor passaria de 14 para 77 MB dentro do share do ERP): o piso e o proprio
       alvo, `Libs/Almox/FOOTPRINTS ALMOX.PcbLib`, que ja chega ao servidor como
       diretorio compartilhado do deploy. Com origem == alvo o tamanho e o mtime batem
       consigo mesmos e a funcao devolve o alvo sem copiar nada."""
    alvo = os.path.join(destino_dir, PCBLIB_NOME)
    origem = origem or LP.pcblib(RAIZ)
    if not os.path.exists(origem):
        if os.path.exists(alvo):
            log('   PcbLib de origem fora de alcance; a copia ao lado continua valendo')
            return alvo
        log('   ATENCAO: nao alcancei a PcbLib da casa — as libs vao sem footprint ao lado')
        return None
    fonte = os.stat(origem)
    if os.path.exists(alvo):
        atual = os.stat(alvo)
        if atual.st_size == fonte.st_size and atual.st_mtime >= fonte.st_mtime:
            return alvo
    import shutil
    # O aviso vem ANTES da copia: sao 63 MB pela rede no meio de uma rodada que normalmente
    # leva 19 s. Depois da copia, a linha so explica um travamento que ja passou.
    log('   copiando %s (%.1f MB) de %s...' % (PCBLIB_NOME, fonte.st_size / 1048576.0, origem))
    tmp = alvo + '.tmp'
    shutil.copy2(origem, tmp)
    if os.path.exists(alvo):
        os.remove(alvo)
    os.replace(tmp, alvo)
    log('   %s copiada (%.1f MB)' % (PCBLIB_NOME, fonte.st_size / 1048576.0))
    return alvo


def escreve_libpkg(caminho, schlib, pcblib=PCBLIB_NOME):
    """O projeto de biblioteca integrada.

    A .IntLib em si quem produz e o Altium: ela embute a SchLib E a PcbLib inteiras,
    compactadas (conferido abrindo uma real — sao cinco streams, e o PCBLib/0.pcblib e
    a PcbLib zlib). Montar a PcbLib daqui exigiria escrever o formato binario de PCB, e
    embutir a da casa (60 MB) em cada uma das 31 libs daria mais de 1,5 GB. Entao sai o
    pacote pronto: Project >> Compile Integrated Library, um clique."""
    def doc(n, caminho_doc):
        return ['', '[Document%d]' % n, 'DocumentPath=%s' % caminho_doc,
                'AnnotationEnabled=1', 'AnnotateStartValue=1',
                'AnnotationIndexControlEnabled=0', 'AnnotateSuffix=', 'AnnotateScope=All',
                'AnnotateOrder=-1', 'DoLibraryUpdate=1', 'DoDatabaseUpdate=1',
                'ClassGenCCAutoEnabled=1', 'ClassGenCCAutoRoomEnabled=0',
                'ClassGenNCAutoScope=None', 'DItemRevisionGUID=',
                'GenerateClassCluster=0', 'DocumentUniqueId=']
    L = ['[Design]', 'Version=1.0', 'HierarchyMode=0', 'ArchiveProject=0',
         'OutputPath=', 'LogFolderPath=']
    L += doc(1, os.path.basename(schlib))
    if pcblib:
        L += doc(2, os.path.basename(pcblib))
    L.append('')
    io.open(caminho, 'w', encoding='utf-8', newline='\r\n').write('\n'.join(L))


def le_espelho(caminho):
    txt = io.open(caminho, encoding='utf-8').read()
    return json.loads(txt[txt.index('=') + 1:].strip().rstrip(';'))


def nome_arquivo(fam):
    """RESISTOR ALMOX, CAPACITOR CERAMICO ALMOX... — o sufixo vem DEPOIS do nome, para
       as famílias ficarem em ordem alfabética no painel de bibliotecas."""
    return re.sub(r'[\\/:*?"<>|]', '-', fam) + ' ALMOX'


def _fatia(itens, n):
    """Divide em ~n pedacos contiguos, sem partir um simbolo ao meio quando da.

    O corte cru por contagem separava 'CONECTOR [PINAGEM A DEFINIR]' entre as duas
    ESPECIAIS: metade dos conectores de pinagem a definir numa biblioteca, metade na
    outra. Nao quebrava nada - cada valor e um componente independente -, mas quem
    procura no painel acha so metade. Aqui o corte espera o simbolo acabar.
    Pode devolver menos ou mais que n pedacos; quem chama confere pedaco a pedaco.
    """
    if n <= 1 or not itens:
        return [itens]
    alvo = -(-len(itens) // n)
    pedacos, atual = [], []
    for par in itens:
        if atual and len(atual) >= alvo and atual[-1][0] is not par[0]:
            pedacos.append(atual)
            atual = []
        atual.append(par)
    if atual:
        pedacos.append(atual)
    return pedacos


def fatias_que_cabem(itens, cab_modelo):
    """Quebra a familia ate o FileHeader de CADA pedaco caber num registro.

    Uma familia grande estoura o teto de 65.535 bytes do enquadramento (ver
    SB.MAX_REGISTRO): a ESPECIAIS, com 919 componentes, pedia 81.617 e o Altium
    devolvia a folha em preto. O peso vem do indice - LibRef, CompDescr e PartCount
    por componente, uns 89 bytes cada -, entao quem manda e a soma dos NOMES, nao a
    contagem. Por isso a conta e medida a cada tentativa em vez de um teto fixo de
    componentes: uma familia de nomes curtos cabe inteira onde outra nao caberia.
    """
    n = 1
    while True:
        pedacos = _fatia(itens, n)
        if all(tamanho_cabecalho(p, cab_modelo) <= SB.MAX_REGISTRO for p in pedacos):
            return pedacos
        if n >= len(itens):
            return pedacos          # um componente por lib ja nao cabe: deixa estourar
        n += 1


def gera(destino_dir=None, origem=None, log=print):
    """Uma biblioteca por familia nos basicos, mais uma unica para os especiais.

    Familia que nao caiba num registro de cabecalho sai numerada - "ESPECIAIS 1
    ALMOX", "ESPECIAIS 2 ALMOX" -, com o sufixo ALMOX no fim para os pedacos
    ficarem lado a lado no painel de bibliotecas.
    """
    import collections
    destino_dir = destino_dir or os.path.join(LIBS, 'Almox')
    origem = origem or LP.schlib(RAIZ)
    if not os.path.isdir(destino_dir):
        os.makedirs(destino_dir)
    try:
        cab_modelo, comps = carrega_lib(origem)
        log('reciclando simbolos de %s (%d componentes)'
            % (os.path.basename(origem), len(comps)))
    except Exception as e:                                   # noqa: BLE001
        cab_modelo, comps = None, {}
        log('sem a biblioteca de origem (%s) — desenhando tudo do simbolos.py' % e)

    # agrupa: nos basicos, por familia; os especiais, todos juntos
    grupos = collections.OrderedDict()
    for arq, unica in (('almox-basicos.js', None), ('almox-especiais.js', 'ESPECIAIS')):
        esp = le_espelho(os.path.join(LIBS, arq))
        for sim in esp['symbols']:
            fam = unica or sim['familia']
            for v in sim.get('valores') or []:
                grupos.setdefault(fam, []).append((sim, v))

    # plano: familia -> um ou mais pedacos, cada um com o nome de arquivo dele.
    # Tem que vir ANTES da faxina, senao os pedacos numerados de uma geracao boa
    # seriam apagados por nao estarem na lista de esperados.
    plano = []
    for fam in sorted(grupos, key=lambda f: -len(grupos[f])):
        pedacos = fatias_que_cabem(grupos[fam], cab_modelo)
        for k, itens in enumerate(pedacos, 1):
            rotulo = fam if len(pedacos) == 1 else '%s %d' % (fam, k)
            plano.append((nome_arquivo(rotulo), itens))
        if len(pedacos) > 1:
            log('   %s nao cabe num cabecalho so: sai em %d bibliotecas'
                % (fam, len(pedacos)))

    # apaga as libs de uma geracao anterior que nao existem mais
    esperados = {base + '.SchLib' for base, _ in plano}
    for f in os.listdir(destino_dir):
        # pega tambem o padrao antigo ("ALMOX RESISTOR"), que saiu de circulacao
        if not f.endswith('.SchLib') or f in esperados:
            continue
        if f.endswith(' ALMOX.SchLib') or f.startswith('ALMOX '):
            os.remove(os.path.join(destino_dir, f))
            lp = os.path.join(destino_dir, f[:-7] + '.LibPkg')
            if os.path.exists(lp):
                os.remove(lp)

    pcb = copia_pcblib(destino_dir, log=log)

    feitos, total, bytes_tot = [], 0, 0
    for base, itens in plano:
        bruto = cfbf.escreve(monta_lib(itens, cab_modelo, comps))
        alvo = os.path.join(destino_dir, base + '.SchLib')
        with io.open(alvo, 'wb') as f:
            f.write(bruto)
        escreve_libpkg(os.path.join(destino_dir, base + '.LibPkg'), alvo, pcb)
        feitos.append(alvo)
        total += len(itens)
        bytes_tot += len(bruto)
        if len(itens) >= 40:
            log('   %-34s %4d componentes  %6.1f KB' % (base, len(itens), len(bruto) / 1024.0))
    log('%d bibliotecas, %d componentes, %.1f MB no total (+ um .LibPkg por lib)'
        % (len(feitos), total, bytes_tot / 1024.0 / 1024.0))
    return feitos


if __name__ == '__main__':
    gera()
