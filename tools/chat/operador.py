# -*- coding: utf-8 -*-
"""As ferramentas que o Claude do chat pode chamar — e a cerca que o prende ao projeto aberto.

    import operador
    operador.FERRAMENTAS                        # o que vai no `tools` da API
    operador.executa('ler_esquema', {}, ctx)    # ctx = {'raiz', 'projeto', 'tela'}
    operador.aplica(raiz, proposta)             # o ÚNICO ponto deste arquivo que escreve

A promessa que o usuário ouviu foi "ele mexe apenas no projeto que está aberto na tela".
Promessa dessas não se pede no prompt do sistema: prompt é conselho, e modelo que erra o
caminho erra calado. Aqui ela é código — `_sob()` canoniza com `os.path.realpath` e confere
contra a raiz, e dentro de `Projects/` só a pasta do `ctx['projeto']` passa. Um
`..\\..\\Windows\\win.ini` não sai do workspace nem quando o pedido vem com jeitinho, e o
`schematic.js` do projeto do lado é recusado com o mesmo nome de erro do win.ini: ler o
projeto errado já é mexer no projeto errado, porque é dali que sai a próxima proposta.

Quatro decisões que este arquivo carrega:

  nada escreve      Toda ferramenta de escrita devolve `{'proposta': {...}}` com o arquivo
                    alvo, as linhas que saem, as que entram, um diff legível por humano e um
                    resumo de uma linha. Quem escreve é `aplica()`, e o hub só a chama depois
                    que o usuário clicou. O modelo propõe, o usuário decide — e o diff é a
                    coisa que ele lê para decidir.

  edição por LINHA  O AI-GUIDE manda um objeto JSON plano por linha (é assim que o parser
                    DelphiScript dos `.pas` lê, linha a linha). A proposta guarda o texto
                    EXATO da linha que sai e o da que entra; o resto do arquivo não é tocado
                    — nem os comentários do usuário, nem a ordem das chaves do que já estava
                    lá. Reserializar o arquivo inteiro deixaria o diff ilegível e apagaria
                    formatação alheia, que é justamente o que não se faz num arquivo de dois
                    escritores.

  dois escritores   O usuário edita o mesmo `schematic.js` pelo hub enquanto o chat conversa
                    (AI-GUIDE, Partes A e B). A proposta nasce com um carimbo do arquivo
                    (`mtime_ns` + `tamanho` + `sha1`) e `aplica()` confere os três antes de
                    escrever: se mudou, recusa e manda refazer. Recusar custa uma frase;
                    sobrescrever o que a pessoa acabou de desenhar custa a tarde dela. O sha1
                    vai junto porque mtime mente — dois saves no mesmo milissegundo saem com
                    o mesmo `st_mtime_ns` no NTFS, a mesma razão do `_bom_tag`
                    (hubserver.py:731) ter virado hash de conteúdo.

  o que não sabemos A validação de verdade do esquema (pino na ponta quente, No ERC preso ao
                    pino, footprint do modelo da lib) mora em `hub-core.js » validateSchematic`
                    e roda no navegador. `validar()` aqui é o subconjunto que se faz sem
                    geometria, e diz numa lista `nao_conferido` o que ficou de fora. Afirmar
                    menos e dizer o que não se conferiu é melhor que reimplementar meia
                    geometria em python e divergir da tela.

Sem rede, sem Odoo, sem Altium, sem dependência nova: só a biblioteca padrão.
"""
import hashlib
import io
import json
import os
import re
from collections import OrderedDict

# ─── nomes de arquivo do contrato (AI-GUIDE) ─────────────────────────────────
ARQ_ESQUEMA = 'schematic.js'
ARQ_CHANGES = 'changes.js'
ARQ_SINAL = 'annotations.js'
ARQ_PLACA = 'board.js'

# os três que o chat pode propor escrever. A lista é a mesma do `SAVE_BASENAMES` do
# hubserver: board.js é espelho exportado (verdade da placa) e projects.js é índice do
# workspace inteiro — nenhum dos dois é do projeto aberto para efeito de escrita.
ESCREVIVEIS = (ARQ_ESQUEMA, ARQ_CHANGES, ARQ_SINAL)

# ler_arquivo: o que é texto de projeto/código neste workspace. Binário (.SchLib, .PcbDoc,
# .zip) fica de fora porque não há o que fazer com ele numa janela de chat.
EXTENSOES = ('.js', '.json', '.txt', '.md', '.csv', '.pas', '.py', '.html', '.css',
             '.ps1', '.sh', '.yml', '.yaml', '.ini', '.cfg', '.lbrn', '.lbrn2')

# Arquivos que guardam segredo e que NINGUÉM lê por aqui, nem sendo texto e dentro da raiz.
# O `hub-almox.json` tem a senha do Odoo em texto claro (e já vaza por HTTP, que é bug
# aberto): mandá-la para a API da Anthropic seria transformar um vazamento local em um
# vazamento para fora da empresa.
#
# Esta lista é por NOME, e nome é lista negra: ela protege o que alguém lembrou de escrever
# aqui. O segundo segredo desta casa — o `.hub-odoo.json`, do envio da lista ao Odoo — não
# estava nela, e foi lido por esta ferramenta com a senha dentro (medido). O que o fecha de
# verdade é a regra de SEGMENTO COM PONTO em `ler_arquivo`, que é a mesma do hubserver
# (_serve, hubserver.py:120) e não depende de ninguém lembrar de nada.
SEGREDOS = ('hub-almox.json', 'senha.env', '.env', 'odoo-envio.json', 'hub-odoo.json')

TETO_LEITURA = 400 * 1024        # ler_arquivo: acima disso, só paginado
PAGINA = 200                     # itens por página quando quem chama não pede
PAGINA_MAX = 1000
ROT_OK = (0, 90, 180, 270)

# ─── tabelas de campos obrigatórios ──────────────────────────────────────────
# Espelho do `SCH_ITEM_REQUIRED` (hub-core.js:913) e do `CH_REQUIRED` (hub-core.js:826).
# Duplicadas de propósito: o navegador valida de novo na hora de salvar, e o que o chat
# propõe tem de passar nos DOIS. Divergir aqui para menos deixaria o usuário clicar em
# "aplicar" e a tela recusar depois — o pior momento para descobrir o erro.
# O `footprint` do comp saiu daqui junto com o do hub-core: a CHAVE continua obrigatoria, mas
# ela pode vir vazia (o hub grava assim o componente sem footprint conhecido, e o
# BuildSchematic o trata como [AVISO]). Quem confere a chave e o _valida_item_sch / validar.
SCH_OBRIG = {
    'sheet': ((), ('name', 'size')),
    'comp': (('x', 'y'), ('sheet', 'ref', 'sym')),
    'wire': ((), ('sheet',)),
    'netlabel': (('x', 'y'), ('sheet', 'net')),
    'power': (('x', 'y'), ('sheet', 'net', 'style')),
    'port': (('x', 'y'), ('sheet', 'net')),
    'junction': (('x', 'y'), ('sheet',)),
    'noerc': (('x', 'y'), ('sheet',)),
    'text': (('x', 'y'), ('sheet', 's')),
}

CH_OBRIG = {
    'comp_move': (('x', 'y', 'orig_x', 'orig_y', 'orig_rot'), ('ref', 'orig_layer')),
    'comp_attr': ((), ('ref', 'orig_designator')),
    'track_edit': (('orig_x1', 'orig_y1', 'orig_x2', 'orig_y2', 'orig_w'), ('id', 'orig_layer')),
    'track_add': (('x1', 'y1', 'x2', 'y2', 'w'), ('layer',)),
    'track_del': (('orig_x1', 'orig_y1', 'orig_x2', 'orig_y2', 'orig_w'), ('id', 'orig_layer')),
    'via_edit': (('orig_x', 'orig_y'), ('id',)),
    'via_add': (('x', 'y', 'size', 'drill'), ()),
    'via_del': (('orig_x', 'orig_y'), ('id',)),
    'arc_edit': (('orig_cx', 'orig_cy', 'orig_r', 'orig_sa', 'orig_ea'), ('id', 'orig_layer')),
    'arc_add': (('cx', 'cy', 'r', 'sa', 'ea', 'w'), ('layer',)),
    'arc_del': (('orig_cx', 'orig_cy', 'orig_r', 'orig_sa', 'orig_ea'), ('id', 'orig_layer')),
    'text_edit': (('orig_x', 'orig_y'), ('id', 'orig_text', 'orig_layer')),
    'designator_move': (('orig_x', 'orig_y'), ('ref',)),
    'outline_set': ((), ()),
}

# os pares de deslocamento de texto do `comp`: meio par é erro, e é erro nos dois lados
# (AI-GUIDE, Parte A). Quem escreveu `refdx` sem `refdy` quase sempre queria escrever os dois.
PARES_COMP = (('refdx', 'refdy'), ('comdx', 'comdy'))
DESLOC_MAX = 50000               # o mesmo teto do BuildSchematic


class _Recusa(Exception):
    """Pedido que não se atende. Vira `{'erro': ...}` em `executa` — nunca sobe ao chatserver.

    Erro de ferramenta é resposta, não exceção: o modelo lê o texto, entende o que fez de
    errado e tenta de novo. Estourar a pilha do servidor por um caminho mal escrito seria
    derrubar a conversa inteira por um engano recuperável.
    """


# ═════════════════════════════ a cerca ═══════════════════════════════════════

def _sob(raiz, caminho):
    """`caminho` está dentro de `raiz` depois de resolver symlink e `..`?

    `realpath` nos dois lados é o que fecha a porta: sem ele, `Projects/x/../../Windows`
    passa pela comparação de texto. `normcase` porque no Windows `D:\\Mic...` e `d:\\mic...`
    são a mesma pasta e a comparação crua diria que não.
    """
    r = os.path.normcase(os.path.realpath(raiz))
    c = os.path.normcase(os.path.realpath(caminho))
    return c == r or c.startswith(r + os.sep)


def _raiz_de(ctx):
    raiz = (ctx or {}).get('raiz') or ''
    if not raiz or not os.path.isdir(raiz):
        raise _Recusa('o chat não recebeu a raiz do workspace (ctx["raiz"])')
    return os.path.realpath(raiz)


def _projeto_de(ctx):
    """O nome do projeto ABERTO NA TELA. É ele, e só ele, que as ferramentas alcançam."""
    nome = ((ctx or {}).get('projeto') or '').strip()
    if not nome:
        raise _Recusa('nenhum projeto aberto na tela — abra um projeto no hub e peça de novo')
    # nome de projeto é UM segmento de pasta: qualquer barra aqui é tentativa de subir, e
    # ponto na frente é pasta oculta (o hubserver nem serve — _serve, hubserver.py:120)
    if nome != os.path.basename(nome) or nome.startswith('.') or ':' in nome:
        raise _Recusa('nome de projeto inválido: %s' % nome)
    return nome


def _pasta_projeto(ctx):
    raiz, nome = _raiz_de(ctx), _projeto_de(ctx)
    d = os.path.join(raiz, 'Projects', nome)
    if not _sob(raiz, d) or not os.path.isdir(d):
        raise _Recusa('o projeto "%s" não existe em Projects/' % nome)
    return d


def _do_projeto(ctx, basename):
    """Caminho de um arquivo do projeto aberto, já conferido contra a raiz."""
    return os.path.join(_pasta_projeto(ctx), basename)


def _rel(raiz, caminho):
    """Caminho relativo à raiz, com barra normal — é assim que ele viaja na proposta."""
    return os.path.relpath(caminho, raiz).replace(os.sep, '/')


# ═════════════════════════ leitura dos espelhos ══════════════════════════════

def _le_var_js(caminho):
    """Lê um arquivo `var X = {...};` e devolve o valor.

    Terceira cópia da mesma receita no repositório (hubserver.py » load_var_file,
    odoolista.py:68 » le_var_js), e de propósito: o hubserver arrasta o Flask e o
    odoolista arrasta o xmlrpc e a configuração do Odoo. Nada disso tem o que fazer
    dentro de uma ferramenta de chat que precisa rodar num teste sem rede.
    """
    with io.open(caminho, encoding='utf-8', errors='replace') as f:
        s = f.read()
    s = re.sub(r'^\s*//[^\n]*\n', '', s, flags=re.M)
    s = s[s.find('=') + 1:].strip().rstrip(';').strip()
    s = re.sub(r',\s*([\]}])', r'\1', s)
    return json.loads(s, object_pairs_hook=OrderedDict)


_CACHE = {}


def _le_espelho(caminho):
    """`_le_var_js` com memória: o almox-basicos.js tem 1,6 MB e uma busca por texto o leria
    inteiro a cada pergunta do chat. A chave é (mtime_ns, tamanho) — o sincronismo reescreve
    o arquivo e o cache cai sozinho."""
    try:
        st = os.stat(caminho)
    except OSError:
        return None
    chave = (os.path.normcase(caminho), st.st_mtime_ns, st.st_size)
    guardado = _CACHE.get(os.path.normcase(caminho))
    if guardado and guardado[0] == chave:
        return guardado[1]
    try:
        dados = _le_var_js(caminho)
    except (OSError, ValueError):
        return None
    _CACHE[os.path.normcase(caminho)] = (chave, dados)
    return dados


def _esquema(ctx):
    cam = _do_projeto(ctx, ARQ_ESQUEMA)
    if not os.path.isfile(cam):
        raise _Recusa('o projeto "%s" não tem %s' % (_projeto_de(ctx), ARQ_ESQUEMA))
    try:
        sch = _le_var_js(cam)
    except (OSError, ValueError) as e:
        raise _Recusa('não consegui ler o %s: %s' % (ARQ_ESQUEMA, e))
    if not isinstance(sch, dict) or not isinstance(sch.get('items'), list):
        raise _Recusa('%s não está no formato schmirror-v2 (esperava um objeto com "items")'
                      % ARQ_ESQUEMA)
    return sch


def _placa(ctx):
    cam = _do_projeto(ctx, ARQ_PLACA)
    if not os.path.isfile(cam):
        raise _Recusa('o projeto "%s" ainda não tem %s — ele nasce do ExportProject, '
                      'depois que o ECO levou o esquema para a PCB' % (_projeto_de(ctx), ARQ_PLACA))
    try:
        b = _le_var_js(cam)
    except (OSError, ValueError) as e:
        raise _Recusa('não consegui ler o %s: %s' % (ARQ_PLACA, e))
    if not isinstance(b, dict):
        raise _Recusa('%s não está no formato pcbmirror-v1' % ARQ_PLACA)
    return b


# ═══════════════════════ serialização (linha a linha) ════════════════════════

def _jline(obj):
    """Uma linha do espelho, byte a byte como o hub a escreveria.

    Cópia fiel do `jline` (hub-core.js:820), inclusive o escape de tudo a partir de U+007E:
    os parsers DelphiScript dos `.pas` leem latin-1, e o `\\uXXXX` é o que faz um "180º"
    atravessar o Altium sem virar mojibake. Se esta função divergisse da do hub, todo item
    que o chat tocasse apareceria no `git diff` como linha mexida sem ter mudado nada.
    """
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    fora = []
    for c in s:
        o = ord(c)
        if o < 0x7e:
            fora.append(c)
        elif o > 0xffff:                       # fora do BMP: o JS escapa o par substituto
            o -= 0x10000
            fora.append('\\u%04x\\u%04x' % (0xd800 + (o >> 10), 0xdc00 + (o & 0x3ff)))
        else:
            fora.append('\\u%04x' % o)
    return ''.join(fora)


def _texto_ruim(v):
    """A sequência aspas-dois-pontos quebra o parser de linha dos `.pas` (AI-GUIDE)."""
    return isinstance(v, str) and '":' in v


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _le_linhas(caminho):
    """(texto, linhas) do arquivo. `linhas` sem o \\n — é nelas que a proposta mexe."""
    with io.open(caminho, encoding='utf-8', newline='') as f:
        bruto = f.read()
    return bruto, bruto.replace('\r\n', '\n').split('\n')


def _regiao(linhas, marca, arquivo):
    """(primeira, ultima) linha do array: a que abre e a que fecha, ambas fora da lista.

    A busca do fechamento é DE TRÁS PARA FRENTE porque o `]};` do schmirror-v2 é a última
    linha com conteúdo e um `]` no meio de um `pts` não pode ser confundido com ele.
    """
    ini = None
    for n, ln in enumerate(linhas):
        if marca(ln.strip()):
            ini = n
            break
    if ini is None:
        raise _Recusa('não achei o início do array em %s — o arquivo não está no formato '
                      'do espelho' % arquivo)
    for n in range(len(linhas) - 1, ini, -1):
        if linhas[n].strip().startswith(']'):
            return ini, n
    raise _Recusa('não achei o fechamento do array em %s' % arquivo)


def _itens_em_linhas(linhas, ini, fim, arquivo):
    """[(n_linha, item)] — a lista com o endereço de cada item no arquivo.

    Recusa arquivo que não esteja com um objeto por linha em vez de tentar adivinhar: é
    esse mapeamento item↔linha que permite trocar UMA linha e não encostar no resto. Sem
    ele a única saída seria reserializar o arquivo inteiro, e aí some a formatação de quem
    estava editando junto.
    """
    fora = []
    for n in range(ini + 1, fim):
        cru = linhas[n].strip()
        if not cru or cru.startswith('//'):
            continue
        if cru.endswith(','):
            cru = cru[:-1].rstrip()
        try:
            obj = json.loads(cru, object_pairs_hook=OrderedDict)
        except ValueError:
            raise _Recusa('%s, linha %d: não é um objeto JSON numa linha só. Abra o projeto '
                          'no hub e salve uma vez para normalizar o arquivo.' % (arquivo, n + 1))
        if not isinstance(obj, dict):
            raise _Recusa('%s, linha %d: esperava um objeto' % (arquivo, n + 1))
        fora.append((n, obj))
    return fora


# ═══════════════════════════ carimbo e proposta ══════════════════════════════

def _carimbo(caminho):
    """A foto do arquivo no instante em que a proposta nasceu — `None` se ele não existe.

    mtime_ns + tamanho é o que o pedido especifica; o sha1 entra porque os outros dois
    mentem quando dois saves caem no mesmo milissegundo do NTFS. Conferir os três custa
    uma leitura de arquivo que já vai ser lido de qualquer jeito.
    """
    try:
        st = os.stat(caminho)
    except OSError:
        return None
    with io.open(caminho, 'rb') as f:
        sha = hashlib.sha1(f.read()).hexdigest()
    return OrderedDict((('mtime_ns', st.st_mtime_ns), ('tamanho', st.st_size), ('sha1', sha)))


def _diff(rel, edicoes):
    """O diff que o usuário lê antes de clicar. Sem biblioteca: são poucas linhas e
    contíguas, e o formato do difflib esconderia justamente o número da linha."""
    L = ['--- %s' % rel]
    for e in edicoes:
        n, sai, entra = e['linha'], e.get('sai'), e.get('entra')
        if sai is not None and entra is not None:
            L.append('@@ linha %d' % (n + 1))
            L.append('- ' + sai)
            L.append('+ ' + entra)
        elif sai is not None:
            L.append('@@ linha %d (sai)' % (n + 1))
            L.append('- ' + sai)
        else:
            L.append('@@ linha %d (entra)' % (n + 1))
            L.append('+ ' + entra)
    return '\n'.join(L)


def _monta(raiz, caminho, projeto, edicoes, resumo):
    """A resposta padrão de toda ferramenta de escrita: uma proposta, e nada no disco."""
    if not edicoes:
        return {'proposta': None, 'resumo': 'nada a mudar',
                'nota': 'as operações pedidas não mudariam nada no arquivo'}
    rel = _rel(raiz, caminho)
    texto = _diff(rel, edicoes)
    proposta = OrderedDict((
        ('arquivo', rel),
        ('projeto', projeto),
        ('carimbo', _carimbo(caminho)),
        ('resumo', resumo),
        ('diff', texto),
        ('edicoes', edicoes),
    ))
    return {'proposta': proposta, 'resumo': resumo, 'diff': texto, 'aplicado': False,
            'nota': 'NADA foi gravado. O usuário precisa aprovar esta proposta no hub; '
                    'só então o arquivo muda.'}


# ═══════════════════════════ ferramentas de leitura ══════════════════════════

def _fatia(seq, entrada, padrao=PAGINA):
    """Paginação honesta: devolve a fatia E quantos ficaram de fora.

    Despejar 5000 itens numa resposta de ferramenta queima a janela de contexto inteira e
    o modelo passa o resto da conversa sem espaço para pensar. Cortar calado é pior: ele
    conclui sobre metade da folha achando que viu tudo.
    """
    inicio = entrada.get('inicio') or 0
    quantos = entrada.get('quantos') or padrao
    if not isinstance(inicio, int) or inicio < 0:
        raise _Recusa('"inicio" tem de ser um inteiro >= 0')
    if not isinstance(quantos, int) or quantos < 1:
        raise _Recusa('"quantos" tem de ser um inteiro >= 1')
    quantos = min(quantos, PAGINA_MAX)
    pedaco = seq[inicio:inicio + quantos]
    restam = max(0, len(seq) - inicio - len(pedaco))
    fora = {'total': len(seq), 'inicio': inicio, 'mostrados': len(pedaco), 'restam': restam}
    if restam:
        fora['nota'] = ('%d de %d ficaram de fora — chame de novo com inicio=%d'
                        % (restam, len(seq), inicio + len(pedaco)))
    return pedaco, fora


def ver_projeto(entrada, ctx):
    """Nome, folhas, contagem por tipo de item e que arquivos o projeto tem."""
    raiz, nome, d = _raiz_de(ctx), _projeto_de(ctx), _pasta_projeto(ctx)
    fora = OrderedDict((('projeto', nome), ('pasta', _rel(raiz, d))))

    arquivos = OrderedDict()
    for base in (ARQ_ESQUEMA, ARQ_PLACA, ARQ_CHANGES, ARQ_SINAL):
        cam = os.path.join(d, base)
        arquivos[base] = os.path.getsize(cam) if os.path.isfile(cam) else None
    fora['arquivos'] = arquivos

    if arquivos[ARQ_ESQUEMA] is not None:
        sch = _esquema(ctx)
        tipos, folhas = OrderedDict(), OrderedDict()
        for it in sch['items']:
            t = (it or {}).get('t') or '?'
            tipos[t] = tipos.get(t, 0) + 1
            if t == 'sheet':
                folhas.setdefault(it.get('name'), OrderedDict(
                    (('nome', it.get('name')), ('size', it.get('size')), ('itens', 0))))
        for it in sch['items']:
            f = (it or {}).get('sheet')
            if f in folhas:
                folhas[f]['itens'] += 1
        fora['formato'] = sch.get('format')
        fora['folhas'] = list(folhas.values())
        fora['itens'] = sum(tipos.values())
        fora['por_tipo'] = tipos

    if arquivos[ARQ_PLACA] is not None:
        fora['placa'] = _placa(ctx).get('stats')
    if arquivos[ARQ_CHANGES] is not None:
        fora['changes'] = len(_lista_simples(ctx, ARQ_CHANGES, 'changes'))
    if arquivos[ARQ_SINAL] is not None:
        sinais = _lista_simples(ctx, ARQ_SINAL, 'annotations')
        fora['sinalizadores'] = OrderedDict((
            ('total', len(sinais)),
            ('abertos', sum(1 for a in sinais if (a.get('status') or 'open') == 'open'))))

    tela = (ctx or {}).get('tela')
    if tela:
        fora['tela'] = tela            # o que o usuário está olhando agora, como o hub mandou
    return fora


def _lista_simples(ctx, basename, var):
    """changes.js / annotations.js: `var X = [ ... ];` — devolve a lista (vazia se não há)."""
    cam = _do_projeto(ctx, basename)
    if not os.path.isfile(cam):
        return []
    try:
        dados = _le_var_js(cam)
    except (OSError, ValueError) as e:
        raise _Recusa('não consegui ler o %s: %s' % (basename, e))
    if not isinstance(dados, list):
        raise _Recusa('%s não é uma lista (esperava var %s = [...])' % (basename, var))
    return dados


def ler_esquema(entrada, ctx):
    """Itens do schematic.js, paginados, com o índice de cada um (é por ele que se edita)."""
    sch = _esquema(ctx)
    itens = sch['items']
    folha = entrada.get('folha')
    tipo = entrada.get('tipo')
    ref = entrada.get('ref')

    escolhidos = []
    for i, it in enumerate(itens):
        it = it or {}
        if folha and it.get('t') != 'sheet' and it.get('sheet') != folha:
            continue
        if tipo and it.get('t') != tipo:
            continue
        if ref and it.get('ref') != ref:
            continue
        linha = OrderedDict((('indice', i),))
        linha.update(it)
        escolhidos.append(linha)

    pedaco, info = _fatia(escolhidos, entrada)
    fora = OrderedDict((('projeto', sch.get('project')), ('units', sch.get('units') or 'mil')))
    fora.update(info)
    if folha or tipo or ref:
        fora['filtro'] = OrderedDict((('folha', folha), ('tipo', tipo), ('ref', ref)))
    fora['itens'] = pedaco
    fora['como_editar'] = ('o "indice" de cada item é o endereço dele em editar_esquema; '
                           'ele não muda enquanto o arquivo não for gravado')
    return fora


_PLACA_PARTES = {'resumo': None, 'componentes': 'components', 'trilhas': 'tracks',
                 'vias': 'vias', 'arcos': 'arcs', 'textos': 'texts', 'nets': 'nets',
                 'contorno': None, 'furos': 'cutouts', 'pads_soltos': 'freepads',
                 'silk': 'silk', 'regioes': 'regions'}


def ler_placa(entrada, ctx):
    """board.js — o espelho da placa. SÓ LEITURA: quem muda a PCB é o changes.js."""
    o_que = (entrada.get('o_que') or 'resumo').strip()
    if o_que not in _PLACA_PARTES:
        raise _Recusa('"o_que" deve ser um de: %s' % ', '.join(sorted(_PLACA_PARTES)))
    b = _placa(ctx)

    if o_que == 'resumo':
        return OrderedDict((
            ('formato', b.get('format')), ('fonte', b.get('source')),
            ('units', b.get('units')), ('axis', b.get('axis')),
            ('bbox', (b.get('board') or {}).get('bbox')),
            ('nets', len(b.get('nets') or [])),
            ('stats', b.get('stats')),
            ('lembrete', 'NUNCA edite o board.js — ele é a verdade exportada da placa. '
                         'As mudanças vão para o changes.js, com os campos orig_* copiados '
                         'exatamente daqui.')))
    if o_que == 'contorno':
        return OrderedDict((('bbox', (b.get('board') or {}).get('bbox')),
                            ('outline', (b.get('board') or {}).get('outline') or []),
                            ('cutouts', b.get('cutouts') or [])))

    lista = b.get(_PLACA_PARTES[o_que]) or []
    filtro = entrada.get('filtro')
    if filtro:
        alvo = str(filtro).lower()
        lista = [x for x in lista
                 if alvo in str((x or {}).get('ref') or '').lower()
                 or alvo in str((x or {}).get('net') or '').lower()
                 or alvo in str((x or {}).get('owner') or '').lower()
                 or alvo == str(x).lower()]

    # os pads de um componente são metade do board.js: só saem quando se pergunta por um
    # componente em particular, senão a primeira leitura da placa já estoura a resposta
    if o_que == 'componentes' and not filtro:
        lista = [OrderedDict((k, v) for k, v in (c or {}).items() if k != 'pads') for c in lista]

    pedaco, info = _fatia(lista, entrada)
    fora = OrderedDict((('o_que', o_que), ('units', b.get('units') or 'mm')))
    fora.update(info)
    fora['itens'] = pedaco
    return fora


def ler_sinalizadores(entrada, ctx):
    """annotations.js — as bandeirinhas que o usuário deixou (AI-GUIDE, Parte C)."""
    sinais = _lista_simples(ctx, ARQ_SINAL, 'annotations')
    so_abertos = entrada.get('abertos')
    lista = [a for a in sinais if (a.get('status') or 'open') == 'open'] if so_abertos else sinais
    pedaco, info = _fatia(lista, entrada)
    fora = OrderedDict((('abertos', sum(1 for a in sinais
                                        if (a.get('status') or 'open') == 'open')),))
    fora.update(info)
    fora['itens'] = pedaco
    fora['contrato'] = ('sinalizador aberto é pendência do usuário: corrija, e só então use '
                        'responder_sinalizador. Nunca apague nem reescreva o texto dele.')
    return fora


_ACERVOS = (('Libs/almox-basicos.js', 'almoxarifado · básicos'),
            ('Libs/almox-especiais.js', 'almoxarifado · especiais'),
            ('Libs/almox-todos.js', 'almoxarifado · todos'))


def procurar_componente(entrada, ctx):
    """Busca por texto no almoxarifado (Libs/almox-*.js) e na Libs/schlib.js.

    Devolve o que o esquema precisa para colocar a peça: o `sym` (que é o
    `valores[].altium`), o footprint, o id do valor e o saldo. Saldo é fotografia: ele muda
    sozinho no Odoo e não entra no schematic.js — por isso vem aqui, na hora de escolher, e
    não gravado no projeto.
    """
    txt = (entrada.get('texto') or '').strip()
    if not txt:
        raise _Recusa('"texto" vazio — diga o que procurar (parte do nome, valor, MPN…)')
    alvo = txt.lower()
    raiz = _raiz_de(ctx)
    achados, vistos, lidos = [], set(), []

    for rel, titulo in _ACERVOS:
        cam = os.path.join(raiz, rel.replace('/', os.sep))
        lib = _le_espelho(cam)
        if not lib:
            continue
        lidos.append(rel)
        for sy in lib.get('symbols') or []:
            for v in sy.get('valores') or []:
                nome = (v.get('altium') or '').strip()
                if not nome:
                    continue
                campos = [nome, v.get('label') or '', v.get('value') or '', v.get('mpn') or '',
                          sy.get('name') or '', sy.get('familia') or '']
                campos += [(it or {}).get('nome') or '' for it in (v.get('itens') or [])]
                if not any(alvo in str(c).lower() for c in campos):
                    continue
                chave = (sy.get('name'), nome)
                if chave in vistos:
                    continue
                vistos.add(chave)
                achados.append(OrderedDict((
                    ('acervo', titulo),
                    ('simbolo_familia', sy.get('name')),
                    ('sym', nome),                  # é ISTO que vai no comp.sym
                    ('label', v.get('label')),
                    ('valor_id', v.get('id')),
                    ('footprint', v.get('footprint') or ''),
                    ('saldo', v.get('estoque')),
                    ('local', v.get('local') or ''),
                    ('custo', v.get('custo')),
                    ('mpn', v.get('mpn') or ''),
                    ('odoo_id', next((str((it or {}).get('odoo') or '')
                                      for it in (v.get('itens') or []) if (it or {}).get('odoo')), '')),
                    ('designator', sy.get('designator') or ''),
                )))

    da_casa = []
    slib = _le_espelho(os.path.join(raiz, 'Libs', 'schlib.js'))
    if slib:
        lidos.append('Libs/schlib.js')
        for sy in slib.get('symbols') or []:
            nome = sy.get('name') or ''
            if alvo not in nome.lower() and alvo not in str(sy.get('description') or '').lower():
                continue
            atual = next((f.get('name') for f in (sy.get('footprints') or []) if f.get('current')), '')
            da_casa.append(OrderedDict((
                ('acervo', 'biblioteca da casa'), ('sym', nome),
                ('descricao', sy.get('description') or ''),
                ('partes', sy.get('partcount')),
                ('footprint_do_modelo', atual),
                ('footprints', [f.get('name') for f in (sy.get('footprints') or [])]))))

    tudo = achados + da_casa
    pedaco, info = _fatia(tudo, entrada, padrao=20)
    fora = OrderedDict((('busca', txt),))
    fora.update(info)
    fora['itens'] = pedaco
    fora['acervos_lidos'] = lidos
    if not lidos:
        fora['aviso'] = ('nenhum espelho de biblioteca existe neste workspace (Libs/almox-*.js '
                         'e Libs/schlib.js são saída gerada e gitignorada) — rode o sincronismo '
                         'do almoxarifado antes de escolher componente')
    if achados:
        fora['nota'] = ('o "sym" é o que vai no item comp do schematic.js; o "valor_id" é o '
                        'ValorId do campo params')
    return fora


def validar(entrada, ctx):
    """O que dá para conferir em python, sem geometria — e a lista do que NÃO foi conferido.

    A validação que a vista Esquema mostra é `hub-core.js » validateSchematic`, e ela roda no
    navegador: além dos campos, ela transforma cada pino pelo `rot`/`mirror` do componente
    para saber se o fio encosta na ponta quente e se o No ERC está preso a um pino. Refazer
    essa transformada aqui seria manter duas contas geométricas que divergem no dia em que
    uma for corrigida — e o usuário acreditaria na errada. Então aqui ficam os campos, as
    tabelas e os cruzamentos de nome; o resto sai nomeado em `nao_conferido`.
    """
    raiz = _raiz_de(ctx)
    sch = _esquema(ctx)
    erros, avisos, nao = [], [], []

    if sch.get('format') != 'schmirror-v2':
        avisos.append('format esperado "schmirror-v2", veio "%s"' % sch.get('format'))
    if not sch.get('project'):
        erros.append('header: falta "project"')

    # os acervos: sem eles não se afirma que um símbolo não existe — só que não deu para ver
    simbolos, footprints = {}, {}
    for rel, _t in _ACERVOS:
        lib = _le_espelho(os.path.join(raiz, rel.replace('/', os.sep)))
        for sy in (lib or {}).get('symbols') or []:
            for v in sy.get('valores') or []:
                if v.get('altium'):
                    simbolos.setdefault(v['altium'], sy)
    slib = _le_espelho(os.path.join(raiz, 'Libs', 'schlib.js'))
    for sy in (slib or {}).get('symbols') or []:
        if sy.get('name'):
            simbolos.setdefault(sy['name'], sy)
    plib = _le_espelho(os.path.join(raiz, 'Libs', 'pcblib.js'))
    for fp in (plib or {}).get('footprints') or []:
        if fp.get('name'):
            footprints.setdefault(fp['name'], fp)
    if not simbolos:
        nao.append('existência dos símbolos: nenhum espelho de biblioteca neste workspace')
    if not footprints:
        nao.append('existência dos footprints: Libs/pcblib.js não está neste workspace')

    folhas = set()
    for it in sch['items']:
        if (it or {}).get('t') == 'sheet':
            folhas.add(it.get('name'))
    if not folhas:
        erros.append('nenhuma folha ({"t":"sheet",...})')

    vistos, fora_da_grade = {}, 0
    for i, it in enumerate(sch['items']):
        it = it or {}
        t = it.get('t')
        if t not in SCH_OBRIG:
            erros.append('item %d: tipo "%s" desconhecido' % (i, t))
            continue
        for e in _confere_campos(it, SCH_OBRIG[t], 'item %d (%s)' % (i, t)):
            erros.append(e)
        if t != 'sheet' and it.get('sheet') and it['sheet'] not in folhas:
            erros.append('item %d (%s): folha "%s" não existe' % (i, t, it.get('sheet')))
        if t == 'wire':
            pts = it.get('pts')
            if not isinstance(pts, list) or len(pts) < 2:
                erros.append('item %d (wire): pts precisa de >= 2 pontos' % i)
            continue
        if t != 'comp':
            continue

        onde = 'comp %s' % (it.get('ref') or '?')
        chave = '%s/%s' % (it.get('ref'), it.get('part') or 1)
        if chave in vistos:
            erros.append('%s: ref duplicado (parte %s)' % (onde, it.get('part') or 1))
        vistos[chave] = True
        rot = it.get('rot') or 0
        if _num(rot) and int(rot) % 360 not in ROT_OK:
            erros.append('%s: rot deve ser 0/90/180/270 (veio %s)' % (onde, rot))
        # a chave e obrigatoria; vazia e o componente sem vinculo, que o BuildSchematic avisa
        # e se resolve no Altium — aviso, como na vista Esquema (hub-core » validateSchematic)
        if not isinstance(it.get('footprint'), str):
            erros.append('%s: falta "footprint"' % onde)
        elif not it['footprint']:
            avisos.append('%s: sem footprint — vai sem vínculo, defina no Altium' % onde)
        for a, b in PARES_COMP:
            if (a in it) != (b in it):
                erros.append('%s: %s/%s é um par — escreva os dois ou nenhum' % (onde, a, b))
        if _num(it.get('x')) and _num(it.get('y')) and (it['x'] % 100 or it['y'] % 100):
            fora_da_grade += 1

        sym = simbolos.get(it.get('sym')) if simbolos else None
        if simbolos and not sym:
            erros.append('%s: símbolo "%s" não existe em nenhum acervo' % (onde, it.get('sym')))
        fp = footprints.get(it.get('footprint')) if footprints else None
        if footprints and it.get('footprint') and not fp:
            erros.append('%s: footprint "%s" não existe na pcblib' % (onde, it.get('footprint')))
        if sym and fp:
            parte = next((p for p in (sym.get('parts') or [])
                          if (p or {}).get('part') == (it.get('part') or 1)), None)
            if parte:
                pads = set(str((p or {}).get('name')) for p in (fp.get('pads') or []))
                for pino in (parte.get('pins') or []):
                    if str((pino or {}).get('num')) not in pads:
                        avisos.append('%s: pino "%s" sem pad correspondente no footprint %s'
                                      % (onde, pino.get('num'), it.get('footprint')))

    # A GRADE DE 100 MIL É FICÇÃO NESTA CASA: as folhas do usuário são métricas, e num
    # projeto real este aviso sozinho responde por ~86% da lista — quem o lê aprende a
    # ignorar a lista inteira. Vai como UMA linha, com a contagem; quem quiser os nomes
    # abre a vista Esquema, que marca cada um no desenho.
    if fora_da_grade:
        avisos.append('%d componente(s) fora da grade de 100 mil — nas folhas métricas desta '
                      'casa isso é normal, não é erro' % fora_da_grade)

    nao.append('fio na ponta quente do pino, No ERC preso a pino e nomeador solto: '
               'precisam da transformada rot/mirror de cada pino; quem confere é '
               'hub-core.js » validateSchematic, na vista Esquema do hub')
    return OrderedDict((('erros', erros), ('avisos', avisos), ('nao_conferido', nao),
                        ('fonte', 'checagem estrutural em python (subconjunto honesto); a '
                                  'validação completa roda no navegador, na vista Esquema')))


def _confere_campos(obj, obrig, onde):
    """Os campos obrigatórios de um item/op, no molde do `checkFields` do hub-core."""
    fora = []
    nums, strs = obrig
    for k in nums:
        if not _num(obj.get(k)):
            fora.append('%s: campo "%s" ausente ou não numérico' % (onde, k))
    for k in strs:
        if not isinstance(obj.get(k), str) or not obj.get(k):
            fora.append('%s: campo "%s" ausente' % (onde, k))
    for k, v in obj.items():
        if _texto_ruim(v):
            fora.append('%s: o texto de "%s" não pode conter aspas-dois-pontos (quebra o '
                        'parser de linha do Altium)' % (onde, k))
        if isinstance(v, (dict, list)) and k != 'pts':
            fora.append('%s: "%s" é aninhado — o formato só aceita objeto plano, com "pts" '
                        'como única exceção' % (onde, k))
    return fora


def ler_arquivo(entrada, ctx):
    """Qualquer texto do workspace, só leitura, paginado por linha.

    Quatro cercas, nesta ordem: o caminho é relativo (absoluto é recusado antes de qualquer
    coisa — pedir `C:\\Windows\\win.ini` é pedir fora do workspace por definição), nenhum
    segmento começa com ponto, a extensão está na lista branca, e o realpath cai dentro da
    raiz. Dentro de `Projects/` vale mais uma: só o projeto aberto. E arquivo de segredo não
    passa nem sendo texto — a senha do Odoo mora num .json que já vaza por HTTP nesta LAN, e
    mandá-la para a API seria levar o vazamento para fora da empresa.
    """
    raiz = _raiz_de(ctx)
    cam = (entrada.get('caminho') or '').strip().replace('\\', '/')
    if not cam:
        raise _Recusa('"caminho" vazio')
    # `os.path.isabs` sozinho NÃO responde isto: no Python 3.13 o ntpath deixou de chamar
    # "/etc/passwd" de absoluto (é enraizado, não absoluto — falta a letra do drive), e a
    # cerca que dependia dele passou a deixar entrar o que ela existe para recusar. A cerca
    # é do CÓDIGO, e não da versão do interpretador: barra ou contrabarra na frente é pedido
    # fora do workspace em qualquer SO e em qualquer versão.
    if cam.startswith('/') or os.path.isabs(cam) or re.match(r'^[A-Za-z]:', cam):
        raise _Recusa('use caminho RELATIVO à raiz do workspace (ex.: Libs/schlib.js) — '
                      'caminho absoluto é recusado')
    partes = [p for p in cam.split('/') if p]
    if any(p == '..' for p in partes):
        raise _Recusa('".." não é aceito no caminho')
    if not partes:
        raise _Recusa('"caminho" vazio')
    # SEGMENTO COM PONTO NÃO PASSA — a mesma regra do hubserver (_serve, hubserver.py:120),
    # e pela mesma razão. O ponto na frente do nome não é enfeite nesta casa: é o que faz o
    # servidor recusar servir um arquivo por HTTP, e por isso é onde o segredo mora. O
    # `.hub-odoo.json` (a credencial do envio da lista ao Odoo, .gitignore:50-56) foi LIDO
    # por esta ferramenta com a senha dentro, porque a lista `SEGREDOS` só blindava o
    # `hub-almox.json`. Lista de nomes protege o que alguém lembrou de escrever nela; esta
    # regra protege também o que ninguém lembrou — `.env`, `.git/config`, o `.chat/` das
    # conversas e o `.hub-odoo.json.tmp` que sobra de uma gravação que falhou.
    oculto = next((p for p in partes if p.startswith('.')), None)
    if oculto:
        raise _Recusa('"%s" começa com ponto: arquivo e pasta ocultos não são lidos pelo chat '
                      '(é onde esta casa guarda credencial, e é o que o hubserver também '
                      'recusa servir)' % oculto)
    if partes[-1].lower() in SEGREDOS or partes[-1].lower().endswith('.env'):
        raise _Recusa('%s guarda segredo e não é lido pelo chat' % partes[-1])
    ext = os.path.splitext(partes[-1])[1].lower()
    if ext not in EXTENSOES:
        raise _Recusa('extensão "%s" não é lida aqui; as permitidas são: %s'
                      % (ext or '(nenhuma)', ', '.join(EXTENSOES)))

    alvo = os.path.join(raiz, *partes)
    if not _sob(raiz, alvo):
        raise _Recusa('fora do workspace: %s' % cam)
    if partes[0].lower() == 'projects':
        aberto = _projeto_de(ctx)
        if len(partes) < 2 or os.path.normcase(partes[1]) != os.path.normcase(aberto):
            raise _Recusa('o projeto aberto é "%s" — este chat não lê nem escreve em outro '
                          'projeto' % aberto)
    if not os.path.isfile(alvo):
        raise _Recusa('não existe: %s' % cam)

    tamanho = os.path.getsize(alvo)
    with io.open(alvo, encoding='utf-8', errors='replace') as f:
        linhas = f.read().split('\n')
    pedaco, info = _fatia(linhas, entrada, padrao=400)
    corpo = '\n'.join(pedaco)
    if len(corpo) > TETO_LEITURA:
        corpo = corpo[:TETO_LEITURA]
        info['nota'] = ('cortado em %d bytes; peça um trecho menor com inicio/quantos'
                        % TETO_LEITURA)
    fora = OrderedDict((('caminho', '/'.join(partes)), ('bytes', tamanho)))
    fora.update(info)
    fora['linhas'] = corpo
    return fora


# ═══════════════════════════ ferramentas de escrita ══════════════════════════
# Nenhuma delas escreve. Todas devolvem uma proposta; quem grava é `aplica()`.

def _valida_item_sch(item, onde, escreve_fp=False):
    """`escreve_fp`: o CHAT esta escrevendo o footprint deste item (comp novo, ou trocar com
    "footprint" nos campos). Ai vazio e recusado — a regra do AI-GUIDE para quem escreve e
    "escreva sempre um footprint". Um item que ja estava no arquivo com footprint vazio (o hub
    grava assim o componente sem footprint conhecido) pode ser movido ou girado."""
    t = (item or {}).get('t')
    if t not in SCH_OBRIG:
        raise _Recusa('%s: tipo "%s" desconhecido — os aceitos são %s'
                      % (onde, t, ', '.join(sorted(SCH_OBRIG))))
    problemas = _confere_campos(item, SCH_OBRIG[t], onde)
    if t == 'wire':
        pts = item.get('pts')
        if not isinstance(pts, list) or len(pts) < 2:
            problemas.append('%s: pts precisa de >= 2 pontos' % onde)
        elif any(not (isinstance(p, list) and len(p) == 2 and _num(p[0]) and _num(p[1]))
                 for p in pts):
            problemas.append('%s: cada ponto de pts é [x,y] numérico' % onde)
    if t == 'comp':
        rot = item.get('rot')
        if rot is None:
            problemas.append('%s: falta "rot" (0/90/180/270)' % onde)
        elif not _num(rot) or int(rot) % 360 not in ROT_OK:
            problemas.append('%s: rot deve ser 0/90/180/270 (veio %s)' % (onde, rot))
        fp = item.get('footprint')
        if not isinstance(fp, str):
            problemas.append('%s: falta "footprint" — a chave é obrigatória em todo comp' % onde)
        elif not fp and escreve_fp:
            problemas.append('%s: escreva um "footprint" — todo comp que você escreve leva um '
                             '(AI-GUIDE). Vazio, o componente vai sem vínculo e o BuildSchematic '
                             'só avisa: é trabalho manual para alguém no Altium' % onde)
        for a, b in PARES_COMP:
            if (a in item) != (b in item):
                problemas.append('%s: %s/%s é um par — escreva os dois ou nenhum' % (onde, a, b))
            for k in (a, b):
                if k in item and (not _num(item[k]) or abs(item[k]) > DESLOC_MAX):
                    problemas.append('%s: %s fora do razoável (o BuildSchematic recusa acima '
                                     'de %d mil)' % (onde, k, DESLOC_MAX))
    if problemas:
        raise _Recusa('; '.join(problemas))
    return item


def _alvo_op(op, itens, onde, tipo_esperado=None):
    """Resolve o item que a op endereça: por `indice` ou por `ref` (+ `part`).

    Os índices são sempre os do arquivo COMO FOI LIDO — planejar todas as ops contra a
    mesma foto é o que deixa remover o item 3 e trocar o 4 no mesmo pedido sem que o
    segundo endereço escorregue.
    """
    if 'indice' in op and op['indice'] is not None:
        i = op['indice']
        if not isinstance(i, int) or not (0 <= i < len(itens)):
            raise _Recusa('%s: índice %s não existe (o arquivo tem %d itens)'
                          % (onde, i, len(itens)))
        return i
    ref = op.get('ref')
    if not ref:
        raise _Recusa('%s: diga "indice" ou "ref"' % onde)
    cands = [i for i, (_n, it) in enumerate(itens)
             if it.get('ref') == ref and (tipo_esperado is None or it.get('t') == tipo_esperado
                                          or it.get('op') == tipo_esperado)]
    if 'part' in op and op['part'] is not None:
        cands = [i for i in cands if (itens[i][1].get('part') or 1) == op['part']]
    if not cands:
        raise _Recusa('%s: não achei "%s" no arquivo' % (onde, ref))
    if len(cands) > 1:
        partes = [itens[i][1].get('part') or 1 for i in cands]
        raise _Recusa('%s: "%s" aparece em %d partes (%s) — diga "part" ou "indice"'
                      % (onde, ref, len(cands), ', '.join(str(p) for p in partes)))
    return cands[0]


def _planeja(ops, itens, valida, onde_de):
    """(trocas, remocoes, novos) a partir da lista de ops. Não toca em arquivo."""
    trocas, remocoes, novos = OrderedDict(), [], []
    for k, op in enumerate(ops):
        if not isinstance(op, dict):
            raise _Recusa('op %d não é um objeto' % k)
        acao = (op.get('acao') or '').strip()
        onde = 'op %d (%s)' % (k, acao or '?')
        if acao == 'adicionar':
            item = op.get('item')
            if not isinstance(item, dict):
                raise _Recusa('%s: falta "item"' % onde)
            novos.append(valida(OrderedDict(item), onde, True))
        elif acao == 'remover':
            remocoes.append(_alvo_op(op, itens, onde))
        elif acao in ('mover', 'trocar'):
            i = _alvo_op(op, itens, onde)
            base = trocas.get(i)
            if base is None:
                base = OrderedDict(itens[i][1])
            campos = op.get('campos') if acao == 'trocar' else {
                k2: op[k2] for k2 in ('x', 'y', 'rot', 'mirror', 'sheet') if k2 in op}
            if not isinstance(campos, dict) or not campos:
                raise _Recusa('%s: nada a mudar (mover quer x/y/rot; trocar quer "campos")'
                              % onde)
            for k2, v in campos.items():
                if v is None:
                    base.pop(k2, None)      # null apaga o campo: é como se tira um opcional
                else:
                    base[k2] = v
            # o footprint so e "escrito pelo chat" se veio nos campos; mover nao o toca
            trocas[i] = valida(base, '%s → %s' % (onde, onde_de(itens[i][1])),
                               'footprint' in campos)
        else:
            raise _Recusa('%s: ação desconhecida — use adicionar, mover, remover ou trocar'
                          % onde)
    for i in remocoes:
        trocas.pop(i, None)                 # remover ganha de trocar no mesmo item
    return trocas, sorted(set(remocoes)), novos


def _edicoes(itens, fim, trocas, remocoes, novos, linhas):
    """As edições de linha, na ordem do arquivo. `fim` é a linha que fecha o array."""
    saida = []
    for i, (n, _it) in enumerate(itens):
        if i in remocoes:
            saida.append(OrderedDict((('linha', n), ('sai', linhas[n]), ('entra', None))))
        elif i in trocas:
            virgula = ',' if linhas[n].rstrip().endswith(',') else ''
            nova = _jline(trocas[i]) + virgula
            if nova == linhas[n]:
                continue          # trocar um campo pelo mesmo valor não é mudança nenhuma
            saida.append(OrderedDict((('linha', n), ('sai', linhas[n]), ('entra', nova))))
    for item in novos:
        saida.append(OrderedDict((('linha', fim), ('sai', None), ('entra', _jline(item) + ','))))
    return saida


def _conta(ed):
    """(entraram, trocaram, sairam) contados nas EDIcoes, nao nas ops.

    Nao e a mesma conta: trocar um campo pelo valor que ele ja tinha e uma op que nao vira
    edicao nenhuma, e o resumo que o usuario le tem de contar o que vai mudar no arquivo.
    """
    novos = sum(1 for e in ed if e['sai'] is None)
    fora = sum(1 for e in ed if e['entra'] is None)
    return novos, len(ed) - novos - fora, fora


def editar_esquema(entrada, ctx):
    """Propõe mudanças no schematic.js. NÃO escreve: devolve a proposta e o diff."""
    ops = entrada.get('ops')
    if not isinstance(ops, list) or not ops:
        raise _Recusa('"ops" precisa ser uma lista com pelo menos uma operação')
    raiz, projeto = _raiz_de(ctx), _projeto_de(ctx)
    cam = _do_projeto(ctx, ARQ_ESQUEMA)
    if not os.path.isfile(cam):
        raise _Recusa('o projeto "%s" ainda não tem %s — crie o esquema pelo hub primeiro'
                      % (projeto, ARQ_ESQUEMA))
    _bruto, linhas = _le_linhas(cam)
    ini, fim = _regiao(linhas, lambda s: s.startswith('"items"') and s.endswith('['), ARQ_ESQUEMA)
    itens = _itens_em_linhas(linhas, ini, fim, ARQ_ESQUEMA)

    trocas, remocoes, novos = _planeja(
        ops, itens, _valida_item_sch,
        lambda it: '%s %s' % (it.get('t'), it.get('ref') or ''))
    ed = _edicoes(itens, fim, trocas, remocoes, novos, linhas)
    resumo = '%s: %s' % (ARQ_ESQUEMA, _resumo(*_conta(ed), 'item'))
    return _monta(raiz, cam, projeto, ed, resumo)


def _valida_op_changes(op, onde, _escreve_fp=False):
    # _escreve_fp: a mesma assinatura do _valida_item_sch (o _planeja chama os dois); o
    # changes.js nao tem footprint de componente
    o = (op or {}).get('op')
    if o not in CH_OBRIG:
        raise _Recusa('%s: op "%s" desconhecida — as aceitas são %s'
                      % (onde, o, ', '.join(sorted(CH_OBRIG))))
    problemas = _confere_campos(op, CH_OBRIG[o], onde)
    if o == 'outline_set':
        pts = op.get('pts')
        if not isinstance(pts, list) or len(pts) < 3:
            problemas.append('%s: outline_set quer pts com >= 3 pontos' % onde)
    if o == 'via_add' and _num(op.get('drill')) and _num(op.get('size')) \
            and op['drill'] >= op['size']:
        problemas.append('%s: drill tem de ser menor que size' % onde)
    if 'id' in op and not str(op.get('id') or '').strip():
        problemas.append('%s: "id" vazio — use um id que existe no board.js (t1, v2, a1…)' % onde)
    if problemas:
        raise _Recusa('; '.join(problemas))
    return op


CAB_CHANGES = ('// AltiumPCBMirror - arquivo de mudancas.',
               '// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. '
               'Consulte AI-GUIDE.md.',
               'var changes = [')


def editar_changes(entrada, ctx):
    """Propõe mudanças no changes.js (PCB). NÃO escreve.

    Os `orig_*` não são conferidos contra o board.js aqui de propósito: quem confere de
    verdade é o ApplyChanges dentro do Altium, com tolerância de 0,001 mm e contra a placa
    REAL — que é a única que importa e que pode ter andado desde o último export. Conferir
    contra o espelho daria um "ok" que não vale nada no momento em que vale.
    """
    ops = entrada.get('ops')
    if not isinstance(ops, list) or not ops:
        raise _Recusa('"ops" precisa ser uma lista com pelo menos uma operação')
    raiz, projeto = _raiz_de(ctx), _projeto_de(ctx)
    cam = _do_projeto(ctx, ARQ_CHANGES)

    if not os.path.isfile(cam):
        # arquivo novo: o cabeçalho entra junto, e o carimbo nasce None (= "não pode existir")
        for k, op in enumerate(ops):
            if (op or {}).get('acao', 'adicionar') != 'adicionar':
                raise _Recusa('op %d: o projeto ainda não tem %s, então só "adicionar"'
                              % (k, ARQ_CHANGES))
            _valida_op_changes(op.get('item') or op, 'op %d' % k)
        ed = []
        for n, texto in enumerate(CAB_CHANGES):
            ed.append(OrderedDict((('linha', 0), ('sai', None), ('entra', texto))))
        for op in ops:
            ed.append(OrderedDict((('linha', 0), ('sai', None),
                                   ('entra', _jline(op.get('item') or op) + ','))))
        ed.append(OrderedDict((('linha', 0), ('sai', None), ('entra', '];'))))
        ed.append(OrderedDict((('linha', 0), ('sai', None), ('entra', ''))))
        return _monta(raiz, cam, projeto, ed,
                      '%s: arquivo novo com %d mudança(s)' % (ARQ_CHANGES, len(ops)))

    _bruto, linhas = _le_linhas(cam)
    ini, fim = _regiao(linhas, lambda s: s.startswith('var changes'), ARQ_CHANGES)
    itens = _itens_em_linhas(linhas, ini, fim, ARQ_CHANGES)
    trocas, remocoes, novos = _planeja(
        ops, itens, _valida_op_changes, lambda it: '%s %s' % (it.get('op'), it.get('ref') or ''))
    ed = _edicoes(itens, fim, trocas, remocoes, novos, linhas)
    resumo = '%s: %s' % (ARQ_CHANGES, _resumo(*_conta(ed), 'mudança'))
    return _monta(raiz, cam, projeto, ed, resumo)


def responder_sinalizador(entrada, ctx):
    """Marca um sinalizador como resolvido e escreve a resposta. NÃO escreve em disco.

    Só `status` e `reply` mudam — o resto da linha volta byte a byte como estava. O AI-GUIDE
    é explícito: quem apaga ou reabre sinalizador é o usuário, pelo hub. Apagar aqui seria
    sumir com a pergunta dele junto com a resposta.
    """
    ident = (entrada.get('id') or '').strip()
    reply = entrada.get('reply')
    if not ident:
        raise _Recusa('"id" vazio — diga qual sinalizador (n1, n2…)')
    if not isinstance(reply, str) or not reply.strip():
        raise _Recusa('"reply" vazio — escreva o que foi feito')
    if _texto_ruim(reply):
        raise _Recusa('a resposta não pode conter aspas-dois-pontos (quebra o parser de linha)')
    raiz, projeto = _raiz_de(ctx), _projeto_de(ctx)
    cam = _do_projeto(ctx, ARQ_SINAL)
    if not os.path.isfile(cam):
        raise _Recusa('o projeto "%s" não tem %s' % (projeto, ARQ_SINAL))
    _bruto, linhas = _le_linhas(cam)
    ini, fim = _regiao(linhas, lambda s: s.startswith('var annotations'), ARQ_SINAL)
    itens = _itens_em_linhas(linhas, ini, fim, ARQ_SINAL)

    achado = next(((n, it) for n, it in itens if it.get('id') == ident), None)
    if achado is None:
        raise _Recusa('não existe sinalizador "%s" neste projeto (tem: %s)'
                      % (ident, ', '.join(str(it.get('id')) for _n, it in itens) or 'nenhum'))
    n, it = achado
    novo = OrderedDict(it)
    novo['status'] = 'resolved'
    novo['reply'] = reply
    virgula = ',' if linhas[n].rstrip().endswith(',') else ''
    ed = [OrderedDict((('linha', n), ('sai', linhas[n]),
                       ('entra', _jline(novo) + virgula)))]
    return _monta(raiz, cam, projeto, ed,
                  '%s: %s marcado como resolvido' % (ARQ_SINAL, ident))


def _resumo(novos, trocados, removidos, unidade):
    partes = []
    if novos:
        partes.append('+%d %s(ns)' % (novos, unidade))
    if trocados:
        partes.append('~%d %s(ns)' % (trocados, unidade))
    if removidos:
        partes.append('-%d %s(ns)' % (removidos, unidade))
    return ', '.join(partes) or 'nada'


# ════════════════════════════ o único que escreve ════════════════════════════

def aplica(raiz, proposta):
    """Grava a proposta aprovada. É o único ponto deste arquivo que toca o disco.

    Confere, nesta ordem: o formato da proposta, a cerca (o arquivo é um dos três
    escrevíveis, dentro do projeto da proposta, dentro da raiz), o carimbo (o arquivo é o
    mesmo que a proposta viu) e cada linha que sai (é o texto que a proposta viu). Só então
    escreve, atômico e ATRAVÉS do symlink — no servidor os arquivos de estado são link para
    `shared/`, e `os.replace` sobre o link substituiria O LINK, que foi como um deploy comeu
    o trabalho do usuário.
    """
    if not isinstance(proposta, dict):
        return {'ok': False, 'erro': 'proposta ausente'}
    rel = (proposta.get('arquivo') or '').replace('\\', '/')
    projeto = (proposta.get('projeto') or '').strip()
    edicoes = proposta.get('edicoes')
    if not rel or not projeto or not isinstance(edicoes, list) or not edicoes:
        return {'ok': False, 'erro': 'proposta incompleta (arquivo/projeto/edicoes)'}

    partes = [p for p in rel.split('/') if p]
    if len(partes) != 3 or partes[0] != 'Projects' or partes[2] not in ESCREVIVEIS:
        return {'ok': False, 'erro': 'só Projects/<projeto>/{%s}' % ','.join(ESCREVIVEIS)}
    # `Projects/../schematic.js` com `"projeto":".."` ESCREVEU NA RAIZ do workspace (medido).
    # Ele passava pelas quatro conferências desta função porque cada uma respondia "sim" a
    # uma pergunta certa: são três segmentos, o primeiro é Projects, o terceiro é escrevível,
    # e o segundo bate com o campo "projeto" da proposta — que o próprio pedido escolheu. E o
    # `_sob` abaixo concordava, porque a raiz do workspace está dentro da raiz do workspace.
    # Segmento é NOME DE PASTA, nunca movimento: "." e ".." (e qualquer coisa começando com
    # ponto, como o hubserver faz em _serve, hubserver.py:120) não são nome de projeto nem de
    # arquivo do contrato.
    ruim = next((p for p in partes if p.startswith('.')), None)
    if ruim:
        return {'ok': False, 'erro': 'o caminho tem o segmento "%s" — "." e ".." não são nome '
                                     'de pasta, e nada que comece com ponto é escrito pelo '
                                     'chat (nada foi gravado)' % ruim}
    if os.path.normcase(partes[1]) != os.path.normcase(projeto):
        return {'ok': False, 'erro': 'a proposta é do projeto "%s" e aponta para "%s"'
                                     % (projeto, partes[1])}
    raiz = os.path.realpath(raiz or '')
    alvo = os.path.join(raiz, *partes)
    if not _sob(raiz, alvo):
        return {'ok': False, 'erro': 'fora do workspace: %s' % rel}
    if not os.path.isdir(os.path.dirname(alvo)):
        return {'ok': False, 'erro': 'o projeto "%s" não existe' % projeto}

    agora = _carimbo(alvo)
    antes = proposta.get('carimbo')
    if bool(agora) != bool(antes) or (agora and antes and dict(agora) != dict(antes)):
        return {'ok': False, 'mudou': True,
                'erro': 'o arquivo mudou desde que a proposta nasceu — releia o %s e refaça '
                        'a proposta (nada foi gravado)' % partes[2]}

    # arquivo que ainda não existe nasce de uma lista vazia: as inserções da proposta são o
    # arquivo inteiro (é assim que um changes.js aparece num projeto que nunca teve um)
    linhas = _le_linhas(alvo)[1] if agora else []

    insere, troca = {}, {}
    for e in edicoes:
        n, sai, entra = e.get('linha'), e.get('sai'), e.get('entra')
        if not isinstance(n, int) or n < 0 or n > len(linhas):
            return {'ok': False, 'erro': 'edição aponta para a linha %s, que não existe' % n}
        if sai is None:
            insere.setdefault(n, []).append(entra)
            continue
        if n >= len(linhas) or linhas[n] != sai:
            return {'ok': False, 'mudou': True,
                    'erro': 'a linha %d não é mais a que a proposta viu — refaça a proposta '
                            '(nada foi gravado)' % (n + 1)}
        troca[n] = entra

    saida = []
    for n, ln in enumerate(linhas):
        saida.extend(insere.get(n, []))
        if n in troca:
            if troca[n] is not None:
                saida.append(troca[n])
        else:
            saida.append(ln)
    saida.extend(insere.get(len(linhas), []))

    texto = '\n'.join(saida)
    tmp = alvo + '.tmp'
    try:
        with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(texto)
        # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
        os.replace(tmp, os.path.realpath(alvo))
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return {'ok': False, 'erro': 'falha ao gravar: %s' % e}
    return {'ok': True, 'arquivo': rel, 'linhas': len(saida), 'carimbo': _carimbo(alvo),
            'resumo': proposta.get('resumo') or ''}


# ═════════════════════════ o que a API enxerga ═══════════════════════════════
# As descrições são o manual do operador: elas é que dizem ao modelo que escrita não grava,
# que o projeto é um só e que comp novo leva footprint. Texto vago aqui vira ferramenta usada
# errada lá.

_PAG = {'inicio': {'type': 'integer',
                   'description': 'a partir de qual item (0 = o primeiro)'},
        'quantos': {'type': 'integer',
                    'description': 'quantos trazer (teto %d)' % PAGINA_MAX}}


def _ferramenta(nome, desc, props=None, obrig=()):
    return {'name': nome, 'description': desc,
            'input_schema': {'type': 'object', 'properties': props or {},
                             'required': list(obrig)}}


FERRAMENTAS = [
    _ferramenta(
        'ver_projeto',
        'O projeto ABERTO na tela: nome, folhas, quantos itens de cada tipo, e se ele já '
        'tem board.js, changes.js e sinalizadores. Comece por aqui.'),
    _ferramenta(
        'ler_esquema',
        'Os itens do schematic.js (formato schmirror-v2, coordenadas em mil, Y para cima). '
        'Vem paginado e cada item traz o "indice", que é o endereço dele em editar_esquema.',
        dict(_PAG, folha={'type': 'string', 'description': 'só desta folha'},
             tipo={'type': 'string',
                   'description': 'só deste tipo: comp, wire, netlabel, power, port, '
                                  'junction, noerc, text, sheet'},
             ref={'type': 'string', 'description': 'só este designador (R1, C3…)'})),
    _ferramenta(
        'ler_placa',
        'O board.js — o espelho exportado da placa, em mm, Y para cima. SÓ LEITURA: a placa '
        'muda pelo changes.js, com os campos orig_* copiados exatamente daqui.',
        dict(_PAG,
             o_que={'type': 'string', 'enum': sorted(_PLACA_PARTES),
                    'description': 'que parte da placa ler'},
             filtro={'type': 'string',
                     'description': 'texto para filtrar por ref, net ou owner; em '
                                    '"componentes" é ele que faz os pads virem junto'}),
        ('o_que',)),
    _ferramenta(
        'ler_sinalizadores',
        'As bandeirinhas que o usuário deixou no projeto (annotations.js). Sinalizador '
        '"open" é pendência dele para você.',
        dict(_PAG, abertos={'type': 'boolean', 'description': 'só os que estão open'})),
    _ferramenta(
        'procurar_componente',
        'Procura uma peça no almoxarifado e na biblioteca da casa. Devolve o "sym" (que é o '
        'que vai no item comp do esquema), o footprint, o id do valor e o saldo.',
        dict(_PAG, texto={'type': 'string',
                          'description': 'parte do nome, do valor, do MPN ou da família'}),
        ('texto',)),
    _ferramenta(
        'validar',
        'Confere o schematic.js: campos obrigatórios, ref duplicado, rot, símbolo e '
        'footprint que existem, pino sem pad. Diz também o que NÃO foi conferido — a '
        'validação geométrica completa roda na vista Esquema do hub.'),
    _ferramenta(
        'ler_arquivo',
        'Lê um arquivo de texto do workspace, por caminho RELATIVO à raiz (ex.: '
        'Libs/schlib.js, AI-GUIDE.md). Só leitura. Dentro de Projects/ só o projeto aberto.',
        dict(_PAG, caminho={'type': 'string', 'description': 'caminho relativo à raiz'}),
        ('caminho',)),
    _ferramenta(
        'editar_esquema',
        'PROPÕE mudanças no schematic.js. NÃO grava nada: devolve uma proposta com o diff, '
        'que o usuário aprova no hub. Item comp precisa de sheet, ref, sym, x, y, rot '
        '(0/90/180/270) e footprint — escreva sempre um footprint no comp que você cria: '
        'sem ele o componente vai sem vínculo e alguém tem de resolver no Altium. Comp que já '
        'está no arquivo com footprint "" pode ser movido e trocado. Coordenadas em mil, Y para '
        'cima.',
        {'ops': {'type': 'array', 'description': 'as operações, na ordem',
                 'items': {'type': 'object', 'properties': {
                     'acao': {'type': 'string',
                              'enum': ['adicionar', 'mover', 'remover', 'trocar']},
                     'item': {'type': 'object',
                              'description': 'para "adicionar": o item inteiro, plano, '
                                             'com "t"'},
                     'indice': {'type': 'integer',
                                'description': 'o "indice" que ler_esquema devolveu'},
                     'ref': {'type': 'string', 'description': 'ou endereçe pelo designador'},
                     'part': {'type': 'integer',
                              'description': 'a parte, quando o ref tem mais de uma'},
                     'x': {'type': 'number'}, 'y': {'type': 'number'},
                     'rot': {'type': 'number'},
                     'campos': {'type': 'object',
                                'description': 'para "trocar": campos a mudar; null apaga '
                                               'o campo'}},
                     'required': ['acao']}}},
        ('ops',)),
    _ferramenta(
        'editar_changes',
        'PROPÕE mudanças no changes.js (a PCB). NÃO grava nada. Toda edição ou remoção '
        'carrega os campos orig_* copiados EXATAMENTE do board.js — é a trava que o '
        'ApplyChanges confere contra a placa real, com tolerância de 0,001 mm.',
        {'ops': {'type': 'array', 'description': 'as operações, na ordem',
                 'items': {'type': 'object', 'properties': {
                     'acao': {'type': 'string',
                              'enum': ['adicionar', 'mover', 'remover', 'trocar']},
                     'item': {'type': 'object',
                              'description': 'para "adicionar": a mudança inteira, plana, '
                                             'com "op" (comp_move, track_add, via_add…)'},
                     'indice': {'type': 'integer'},
                     'ref': {'type': 'string'},
                     'campos': {'type': 'object'}},
                     'required': ['acao']}}},
        ('ops',)),
    _ferramenta(
        'responder_sinalizador',
        'PROPÕE marcar um sinalizador como resolvido, com a sua resposta. NÃO grava nada. '
        'Só status e reply mudam — o texto do usuário nunca é apagado nem reescrito. '
        'Responda depois de corrigir, não antes.',
        {'id': {'type': 'string', 'description': 'o id do sinalizador (n1, n2…)'},
         'reply': {'type': 'string', 'description': 'o que foi feito'}},
        ('id', 'reply')),
]

_EXECUTORES = {
    'ver_projeto': ver_projeto,
    'ler_esquema': ler_esquema,
    'ler_placa': ler_placa,
    'ler_sinalizadores': ler_sinalizadores,
    'procurar_componente': procurar_componente,
    'validar': validar,
    'ler_arquivo': ler_arquivo,
    'editar_esquema': editar_esquema,
    'editar_changes': editar_changes,
    'responder_sinalizador': responder_sinalizador,
}

ESCRITAS = ('editar_esquema', 'editar_changes', 'responder_sinalizador')


def executa(nome, entrada, ctx):
    """Roda uma ferramenta e devolve o dict que volta para a API como resultado.

    Nunca levanta: erro de ferramenta vira `{'erro': ...}` e o modelo o lê como resposta.
    Um caminho mal escrito não pode derrubar a conversa, e um `except` largo aqui é o que
    impede que um espelho corrompido no disco vire 500 no chatserver.
    """
    fn = _EXECUTORES.get(nome)
    if fn is None:
        return {'erro': 'ferramenta desconhecida: %s' % nome}
    if entrada is None:
        entrada = {}
    if not isinstance(entrada, dict):
        return {'erro': 'a entrada da ferramenta tem de ser um objeto'}
    try:
        return fn(entrada, ctx or {})
    except _Recusa as e:
        return {'erro': str(e)}
    except (OSError, ValueError, KeyError, TypeError) as e:
        return {'erro': '%s falhou: %s' % (nome, e)}
