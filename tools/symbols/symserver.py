# -*- coding: utf-8 -*-
"""Blueprint Flask da sub-aba Símbolos: por aqui o hub fala com a SchLib real.

    GET  /api/symbols/config                 onde está a SchLib, se existe, backups, fontes
    POST /api/symbols/save                   grava um símbolo no espelho (Libs/schlib.js) e na SchLib
    POST /api/symbols/lib                    add/update/rename/delete na Biblioteca de símbolos (Libs/symbols-lib.js)
    GET  /api/symbols/lib-vinculos           que componentes (e categorias) usam cada símbolo da biblioteca
    POST /api/symbols/almox-aplicar          UM símbolo da biblioteca em VÁRIOS componentes do almoxarifado
    POST /api/symbols/extract                reserva uma extração; GET …/<runId>/stream roda e retransmite (SSE)
    POST /api/symbols/mirror                 regera o espelho inteiro a partir da SchLib real; {flags:true} só leva os flags
    POST /api/symbols/almox-sync             reserva a sincronização do almoxarifado pelo guardião; GET …/<runId>/stream roda (SSE)
    POST /api/symbols/almox-excluir          tira um VALOR do almoxarifado de vez (sem `confirmar`, só a prévia com os usos)
    GET  /api/symbols/almox-excluidos        a lista de valores excluídos
    POST /api/symbols/almox-excluir/desfazer devolve um item da lista ao almoxarifado
    GET  /api/symbols/almox-duplicados       o mesmo produto do Odoo em mais de um componente (o aviso da Biblioteca)
    POST /api/symbols/almox-duplicados       apaga os antigos (`fora` cujo produto vive noutro); sem `confirmar`, a prévia
    GET  /api/symbols/almox-fora             quantos componentes `fora` há, no total e por símbolo
    POST /api/symbols/almox-fora             apaga `fora`: {simbolo[, componentes]} ou {todos:true}; sem `confirmar`, a prévia

O trabalho pesado mora nos irmãos: `sch_leitor` lê, `schlib_patch` grava, `extrair` varre,
`guardiao` vigia as .SchLib do Altium e envolve o gerador do almoxarifado. Aqui só o HTTP e
três decisões de arquivo:

  espelho linha a linha    o Libs/schlib.js tem 685 KB, um símbolo por linha. O save troca SÓ a
                           linha do símbolo (e a do `generated`) em vez de reserializar tudo — o
                           diff mostra o que mudou e nenhum outro byte se move.
  espelho antes do Altium  grava-se o espelho primeiro e a SchLib depois. Se a SchLib falha (lib
                           aberta no Altium → 423), o hub já mostra o novo e a resposta traz
                           `espelho:true, altium:false`: o usuário sabe que o Altium ficou atrás.
                           Por isso o pedido é validado por inteiro ANTES de encostar no espelho,
                           e os pinos vão para o espelho nas 3 casas da API do Altium (o
                           schlib_patch leva a fração para o PinFrac da SchLib) — espelho e
                           Altium dizem o mesmo até 0,001 mil, e a grade métrica (2 mm =
                           78,74 mil) sobrevive ao save.
  nome antigo              o espelho saiu do RenameLibs e a SchLib real ainda tem os nomes de
                           antes. Quando o nome novo não está na SchLib, o save tenta o antigo
                           pelo Libs/rename-map.js (symRename ao contrário); e o mirror aplica
                           o mapa ao regerar, senão desfaria os 152 nomes do espelho.
  a resposta do save       devolve `parts` como foram ao disco (3 casas, chaves do vocabulário,
                           hideNum/hideName só quando true): o hub guarda ISSO em memória, não o
                           que mandou — senão o espelho na tela e o do arquivo divergem em silêncio.
                           Vem também no 423/500 (o espelho JÁ foi gravado com elas).
  cores                    `color`/`fill` dos gráficos entram só como '#rrggbb' minúsculo (o que o
                           leitor emite e o hub serializa); outra coisa é 400 antes de gravar. O
                           gráfico vai ao espelho com os valores que vieram (`solid` inclusive) nas
                           chaves do vocabulário, na ordem do leitor — a linha sai igual venha de
                           quem vier (o test_client do Flask manda as chaves em ordem alfabética);
                           o schlib_patch leva a cor para a SchLib; sem cor, a paleta do componente.
  o ledger                 tudo que escreve a SchLib da casa (/save) ou põe o espelho igual a ela
                           (/mirror, flags inclusive) registra mtime/size dela no Libs/lib-ledger.json
                           — o ledger continua sendo o registro de quem escreveu por último.

`registra(app, root)` é o único ponto de contato com o hubserver: guarda ROOT e registra o
blueprint. ROOT é lido em tempo de chamada — os testes trocam.
"""
import io
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from collections import OrderedDict
from datetime import date, datetime

from flask import Blueprint, Response, abort, request

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
sys.path.insert(0, BASE)

import sch_leitor as L                                 # noqa: E402
import schlib_patch as P                               # noqa: E402
import extrair as E                                    # noqa: E402
import guardiao as G                                   # noqa: E402
import libpath as LP                                   # noqa: E402
import almox2lib as A                                  # noqa: E402  (a lista de excluídos)

bp = Blueprint('symbols', __name__, url_prefix='/api/symbols')
ROOT = RAIZ                          # o workspace servido; registra() troca

ESPELHO = os.path.join('Libs', 'schlib.js')
SYMLIB = os.path.join('Libs', 'symbols-lib.js')
CONFIG = os.path.join('tools', 'symbols', 'config.json')
RENAME_MAP = os.path.join('Libs', 'rename-map.js')
RELATORIO = os.path.join('tools', 'symbols', 'relatorio.txt')
PROJETOS = 'Projects'                # onde o /almox-excluir procura o valor em uso
EXTRAIR = os.path.join(BASE, 'extrair.py')   # código, não dado: roda de onde o módulo mora
GUARDIAO = os.path.join(BASE, 'guardiao.py')
GUARDIAO_EXTRA = []                  # argumentos a mais para o guardião (o teste põe --sem-gerador)
ALMOX_CFG = 'hub-almox.json'         # as credenciais do Odoo, como o hubserver as lê
EXTRACT_TIMEOUT = 3600.0             # a varredura do Y: inteiro leva minutos, não horas
SYNC_TIMEOUT = 600.0                 # o mesmo teto do /api/almox/sync: Odoo mudo não prende o hub
RESERVA_TTL = 60.0                   # reserva sem stream aberto expira sozinha
FORMAS = ('line', 'rect', 'arc', 'ellipse', 'poly', 'polyline', 'label')
KINDS = ('generico', 'ci')
LOCAL_ADDRS = ('127.0.0.1', '::1', 'localhost')

_lock_espelho = threading.Lock()     # save e mirror escrevem o mesmo arquivo
_lock_schlib = threading.Lock()      # o patch reescreve a SchLib inteira: dois saves ao mesmo tempo perderiam um
_lock_symlib = threading.Lock()
_lock_almox = threading.Lock()       # grava_espelho_almox reescreve o espelho inteiro: um por vez
_lock_excluidos = threading.Lock()   # a lista de excluídos é reescrita inteira: idem
_extract_lock = threading.Lock()     # segurado enquanto o subprocesso roda
_reserva_lock = threading.Lock()
_extract_runs = {}                   # runId -> (quando, args extras)
_sync_lock = threading.Lock()        # o guardião reescreve Libs/Almox inteira: uma corrida por vez
_sync_runs = {}                      # runId -> (quando, pull)


def registra(app, root):
    """o hubserver chama uma vez: guarda o workspace e pendura as rotas"""
    global ROOT
    ROOT = root
    app.register_blueprint(bp)


# ─── auxiliares ───────────────────────────────────────────────────────────────
def _is_local(req):
    """cópia do hubserver._is_local (importar o hubserver daqui seria circular)"""
    addr = req.remote_addr
    if addr in LOCAL_ADDRS:
        return True
    try:
        return addr in set(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        return False


# ─── gravação do hub x corrida em subprocesso ─────────────────────────────────
# A sincronização (guardiao.py) e a extração (extrair.py) rodam em SUBPROCESSO: leem o
# ledger / o espelho / a symbols-lib no começo e gravam no fim o que leram. Os locks deste
# processo não os alcançam, então uma gravação do hub no meio de uma corrida era desfeita
# calada no fim dela — e a resposta tinha dito "protegido". Enquanto uma dessas gravações
# acontece, o lock da corrida fica com ela (o stream recusa começar); com uma corrida
# rodando ou reservada, a gravação é recusada com 409.
SYNC_OCUPADO = ('a sincronização do almoxarifado está rodando: no fim ela regrava o espelho, as .SchLib '
                'e o ledger, e desfaria esta gravação. Nada foi gravado — tente de novo quando ela terminar.')
EXTRACAO_OCUPADA = ('a extração da biblioteca de símbolos está rodando: no fim ela regrava a biblioteca '
                    'inteira e desfaria esta mudança. Nada foi gravado — tente de novo quando ela terminar.')


def _toma(lock, runs):
    """segura `lock` (o da sincronização ou o da extração) para uma gravação do hub.
    True = segurou (quem chamou solta); False = há uma corrida rodando ou reservada"""
    if not lock.acquire(blocking=False):
        return False
    with _reserva_lock:
        agora = time.time()
        reservada = any(agora - v[0] <= RESERVA_TTL for v in runs.values())
    if reservada:
        lock.release()
        return False
    return True


def _erro(msg, status, **extra):
    r = {'ok': False, 'error': msg}
    r.update(extra)
    return r, status


def _num(v):
    """número de verdade: bool não é, e NaN/Infinity (que o json.loads aceita) também não"""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


# o que cada forma precisa ter para ser desenhada e gravada (o resto é opcional)
CAMPOS = {'line': ('x1', 'y1', 'x2', 'y2'), 'rect': ('x1', 'y1', 'x2', 'y2'), 'arc': ('cx', 'cy', 'r'),
          'ellipse': ('cx', 'cy', 'rx', 'ry'), 'poly': (), 'polyline': (), 'label': ('x', 'y')}
OPCIONAIS = ('w', 'sa', 'ea', 'size', 'rot')
CORES = ('color', 'fill')
# a ordem das chaves de cada forma no espelho: a do sch_leitor (e do serializeSymbol do hub)
ORDEM = {'line': ('x1', 'y1', 'x2', 'y2', 'w'), 'rect': ('x1', 'y1', 'x2', 'y2', 'w', 'solid'),
         'arc': ('cx', 'cy', 'r', 'sa', 'ea', 'w'), 'ellipse': ('cx', 'cy', 'rx', 'ry', 'w', 'solid'),
         'poly': ('pts', 'w', 'solid'), 'polyline': ('pts', 'w'), 'label': ('x', 'y', 'text', 'rot', 'size')}


def _valida_grafico(g):
    """mensagem de erro ou None: forma conhecida, coordenadas numéricas, pts como pares,
    `solid` booleano, `color`/`fill` em '#rrggbb' minúsculo (o formato do schlib-v2 — a
    mesma regex do serializeSymbol do hub). Polígono aceita 2 pontos porque o espelho real
    tem um assim — recusar travaria o save."""
    if not isinstance(g, dict) or g.get('g') not in FORMAS:
        return 'gráfico desconhecido (%s)' % (g.get('g') if isinstance(g, dict) else g)
    k = g['g']
    for c in CAMPOS[k]:
        if not _num(g.get(c)):
            return '%s sem %s numérico' % (k, c)
    for c in OPCIONAIS:
        if g.get(c) is not None and not _num(g[c]):
            return '%s com %s que não é número' % (k, c)
    if g.get('solid') is not None and not isinstance(g['solid'], bool):
        return '%s com solid que não é booleano' % k
    for c in CORES:
        if g.get(c) is not None and not (isinstance(g[c], str) and L.RX_COR.match(g[c])):
            return '%s com %s que não é cor #rrggbb (%r)' % (k, c, g[c])
    if k in ('poly', 'polyline'):
        pts = g.get('pts')
        if not isinstance(pts, list) or len(pts) < 2:
            return '%s precisa de pts com 2 ou mais pontos' % k
        for p in pts:
            if not isinstance(p, list) or len(p) != 2 or not all(_num(v) for v in p):
                return '%s com ponto que não é [x, y] numérico' % k
    if k == 'label' and not isinstance(g.get('text'), str):
        return 'label sem text'
    return None


def _config():
    """tools/symbols/config.json do workspace; sem ele, os caminhos da casa"""
    try:
        cfg = E.le_config(os.path.join(ROOT, CONFIG))
    except (OSError, ValueError):
        cfg = {}
    if not isinstance(cfg, dict):
        cfg = {}
    cfg['schlib'] = LP.schlib(ROOT)
    cfg['backup_dir'] = _backup_dir(cfg)
    return cfg


def _backup_dir(cfg):
    """onde o schlib_patch guarda as 30 cópias datadas.

    O valor do config só vale se o PAI dele existir, e o pai é medido no valor CRU, antes
    de juntar com a raiz. No Linux do servidor o config declara
    `Y:\\Biblioteca\\...\\Backup-hub`, uma string sem barra nenhuma: `posixpath.dirname` dela
    é `''` e o gate recusa. Juntar com o ROOT primeiro daria
    `dirname('/srv/altiumhub/current/Y:\\...')` = `/srv/altiumhub/current`, que existe — o
    gate passaria e o `os.makedirs` do `faz_backup` criaria alegremente UM diretório cujo
    nome contém contrabarras, dentro da release e visível no share SMB.

    Na bancada nada muda: o pai (`Y:\\Biblioteca\\ALTIUM LIBRARY ------ LUCAS`) existe, e o
    `Backup-hub` em si nasce no primeiro save, como sempre."""
    bk = (cfg.get('backup_dir') or '').strip()
    if bk:
        pai = os.path.dirname(bk)
        if pai and os.path.isdir(pai if os.path.isabs(pai) else os.path.join(ROOT, pai)):
            return bk if os.path.isabs(bk) else os.path.join(ROOT, bk)
    return os.path.join(os.path.dirname(cfg['schlib']), 'Backup-hub')


def _grava_bytes(caminho, bruto):
    """tmp + os.replace, como o api_save do hubserver: nunca meio arquivo no disco"""
    tmp = caminho + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(bruto)
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(caminho))


def _le_var(caminho):
    """'var X = {...};' -> dict (o load_var_file do hubserver, sem importá-lo)"""
    with open(caminho, encoding='utf-8', errors='replace') as f:
        s = f.read()
    s = re.sub(r'^\s*//[^\n]*\n', '', s, flags=re.M)
    s = s[s.find('=') + 1:].strip().rstrip(';').strip()
    return json.loads(re.sub(r',\s*([\]}])', r'\1', s))


def _nome_antigo(nome):
    """o LibReference que a SchLib real ainda usa para `nome`, ou None"""
    try:
        mapa = _le_var(os.path.join(ROOT, RENAME_MAP)).get('symRename') or {}
    except (OSError, ValueError, AttributeError):
        return None
    for antigo, novo in mapa.items():
        if novo == nome and antigo != nome:
            return antigo
    return None


def _valida_parts(parts):
    """mensagem de erro ou None — só o que faria o espelho/patch gravar lixo"""
    if not isinstance(parts, list) or not parts:
        return 'parts tem que ser uma lista com ao menos uma parte'
    for i, p in enumerate(parts):
        onde = 'parte %d' % (i + 1)
        if not isinstance(p, dict) or not isinstance(p.get('pins'), list) \
                or not isinstance(p.get('graphics'), list):
            return onde + ': precisa de pins[] e graphics[]'
        if p.get('part') is not None and not (isinstance(p['part'], int) and not isinstance(p['part'], bool)):
            return onde + ': part tem que ser inteiro'
        for q in p['pins']:
            if not isinstance(q, dict) or not all(_num(q.get(k)) for k in ('x', 'y', 'len')):
                return onde + ': pino sem x/y/len numéricos'
            if not isinstance(q.get('num'), str) or not isinstance(q.get('name'), str):
                return onde + ': pino com num/name que não são texto'
            if q.get('orient') not in (0, 90, 180, 270):
                return onde + ': pino %s com orient fora de 0/90/180/270' % q['num']
            if q.get('type') not in L.TIPOS:
                return onde + ': pino %s com type desconhecido (%s)' % (q['num'], q.get('type'))
            for k in ('hideNum', 'hideName'):
                if q.get(k) is not None and not isinstance(q[k], bool):
                    return onde + ': pino %s com %s que não é booleano' % (q['num'], k)
        for j, g in enumerate(p['graphics']):
            erro = _valida_grafico(g)
            if erro:
                return '%s, gráfico %d: %s' % (onde, j + 1, erro)
    return None


def _grafico(g):
    """o gráfico nas chaves do vocabulário, na ordem do leitor (color/fill no fim); chave
    estranha e null caem, valores ficam como vieram"""
    r = OrderedDict([('g', g['g'])])
    for k in ORDEM[g['g']] + CORES:
        if g.get(k) is not None:
            r[k] = g[k]
    return r


def _partes(parts):
    """só part/pins/graphics, numeradas, com o pino no vocabulário do espelho (chaves na
    ordem do ExportLibs) e x/y/len em 3 casas — as que a API do Altium (e o leitor)
    devolvem; a 4ª casa cairia na releitura de qualquer jeito, e assim espelho e SchLib
    dizem exatamente o mesmo número. hideNum/hideName só saem quando true: ausente é
    visível, e o espelho não ganha "false" que o leitor nunca escreveria. Os gráficos
    passam pelo `_grafico` (ordem das chaves), sem mexer em valor."""
    fora = []
    for i, p in enumerate(parts):
        pins = []
        for q in p['pins']:
            r = OrderedDict([('num', q['num']), ('name', q['name'])])
            for k in ('x', 'y', 'len'):
                r[k] = L._n(round(float(q[k]), 3))
            r['orient'], r['type'] = q['orient'], q['type']
            for k in ('hideNum', 'hideName'):
                if q.get(k):
                    r[k] = True
            pins.append(r)
        fora.append(OrderedDict([('part', int(p.get('part') or i + 1)), ('pins', pins),
                                 ('graphics', [_grafico(g) for g in p['graphics']])]))
    return fora


# ─── o espelho, linha a linha ─────────────────────────────────────────────────
def _salva_espelho(caminho, nome, parts, description=None):
    """troca a linha do símbolo `nome` no schlib.js (e a do generated); -> símbolo novo ou
    None se o nome não está lá. `parts` já passou por `_partes`. Latin-1 nos dois sentidos:
    o arquivo é ASCII (o _js escapa tudo acima de 126) e assim nenhum byte que não seja da
    linha trocada muda."""
    with open(caminho, 'rb') as f:
        linhas = f.read().decode('latin-1').splitlines(True)
    prefixo = '{"name":' + L._js(nome) + ','
    alvo = None
    for i, ln in enumerate(linhas):
        corpo = ln[1:] if ln.startswith(',') else ln
        if corpo.startswith(prefixo):
            alvo = i
            break
    if alvo is None:
        return None
    ln = linhas[alvo]
    virgula = ln.startswith(',')
    fim = ln[len(ln.rstrip('\r\n')):]
    velho = json.loads(ln.rstrip('\r\n')[1 if virgula else 0:])
    novo = OrderedDict([
        ('name', velho.get('name', nome)),
        ('description', description if description is not None else velho.get('description', '')),
        ('partcount', len(parts)),
        ('parts', parts),
        ('footprints', velho.get('footprints') or []),
    ])
    linhas[alvo] = (',' if virgula else '') + L.simbolo_json(novo) + fim
    for i in range(min(alvo, 8)):                       # o cabeçalho fica antes dos símbolos
        if linhas[i].startswith('"generated":'):
            fim = linhas[i][len(linhas[i].rstrip('\r\n')):]
            linhas[i] = '"generated":' + L._js(L.agora()) + ',' + fim
            break
    _grava_bytes(caminho, ''.join(linhas).encode('latin-1'))
    return novo


class SoLeitura(Exception):
    """a lib resolvida é a cópia publicada, que não se escreve.

    Exceção própria, e não `PermissionError`: o `schlib_patch` abre a .SchLib direto
    (`_le_ole`) e, no Windows, uma lib aberta em modo exclusivo pelo Altium levanta
    `PermissionError` PELADO — só o `copy2` do backup o converte em `LibOcupada`.
    Capturar `PermissionError` aqui trocaria "a lib está aberta no Altium" por "edite na
    bancada" dito a quem já está na bancada, e esconderia o erro verdadeiro."""


SO_LEITURA = ('a biblioteca da casa aqui é a cópia publicada (%s), que é somente leitura: '
              'ela viaja no push para o hub poder ler, e uma escrita nela morre no próximo '
              'deploy. Edite o símbolo na bancada, onde a lib viva está montada — de lá o '
              'sincronismo publica a cópia nova.')


def _so_leitura(schlib):
    """a lib resolvida é a cópia publicada dentro do repositório?

    Enquanto o caminho da casa era `Y:\\...`, este caso não existia: no Linux o arquivo não
    existe e toda rota de escrita morria num 404 inofensivo. Com a cópia dentro do
    repositório o `isfile` passa a valer, e o mesmo clique passaria a gravar de verdade
    dentro de `releases/<hash>/` — que o deploy seguinte apaga com um `rm -rf`, sem aviso.
    A caixa "Altium" do editor vem marcada por padrão, então isso não é hipótese remota."""
    return LP.e_publicada(ROOT, schlib)


def _patch_altium(cfg, sym):
    """schlib_patch.patch na SchLib do config; nome novo ausente -> tenta o antigo do rename-map"""
    schlib = cfg['schlib']
    if not os.path.isfile(schlib):
        # Antes da trava: um arquivo que não está lá merece "não encontrada", não
        # "somente leitura" — a trava compara CAMINHO, não existência.
        raise FileNotFoundError('SchLib não encontrada: %s' % schlib)
    if _so_leitura(schlib):
        # Um único `isfile` False num share com soluço marca o caminho ausente por 30 s
        # (libpath._ausentes) e faria a bancada cair aqui. Antes de recusar, esquece o
        # cache e pergunta de novo: recusa tem que ser dita com certeza.
        LP.esquece_ausentes()
        cfg = _config()
        schlib = cfg['schlib']
        if _so_leitura(schlib):
            raise SoLeitura(SO_LEITURA % os.path.relpath(schlib, ROOT).replace('\\', '/'))
        if not os.path.isfile(schlib):
            raise FileNotFoundError('SchLib não encontrada: %s' % schlib)
    try:
        return P.patch(schlib, sym, cfg['backup_dir'], raiz=ROOT)
    except ValueError:
        antigo = _nome_antigo(sym['name'])
        if not antigo:
            raise
        r = P.patch(schlib, dict(sym, name=antigo), cfg['backup_dir'], raiz=ROOT)
        r['nomeAltium'] = antigo
        return r


# ─── rotas ────────────────────────────────────────────────────────────────────
@bp.route('/config', methods=['GET'])
def api_config():
    cfg = _config()
    schlib = cfg['schlib']
    try:
        st = os.stat(schlib)
        existe, tamanho, mtime = True, st.st_size, st.st_mtime
    except OSError:
        existe, tamanho, mtime = False, 0, 0
    return {'ok': True, 'schlib': schlib, 'existe': existe, 'tamanho': tamanho, 'mtime': mtime,
            'quando': time.strftime('%Y-%m-%d %H:%M', time.localtime(mtime)) if mtime else '',
            'backup_dir': cfg['backup_dir'],
            'fontes': [str(f) for f in cfg.get('fontes') or []],
            'ignorar': [str(f) for f in cfg.get('ignorar') or []],
            'symlib': SYMLIB.replace('\\', '/'),
            'symlibExiste': os.path.isfile(os.path.join(ROOT, SYMLIB)),
            'espelhoExiste': os.path.isfile(os.path.join(ROOT, ESPELHO)),
            'configExiste': os.path.isfile(os.path.join(ROOT, CONFIG)),
            # A tela AINDA não lê estes campos — o `hub-symed.js` deixa a caixa "Altium"
            # marcada por padrão e mostra o 409 como erro vermelho depois do clique. Estão
            # expostos para quem cuidar do painel poder desmarcá-la antes: `soLeitura` diz
            # que a escrita será recusada, `viva` para onde o config aponta (vazio quando
            # não há lib viva declarada) e `procedencia` por qual passo da ordem se chegou.
            'soLeitura': _so_leitura(schlib), 'viva': LP.viva(ROOT),
            'procedencia': LP.resolve_schlib(ROOT)[1],
            'local': _is_local(request)}


@bp.route('/save', methods=['POST'])
def api_save():
    """espelho primeiro, SchLib depois. Falha na SchLib devolve espelho:true, altium:false."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {name, parts, altium} obrigatório', 400)
    nome, parts = data.get('name'), data.get('parts')
    if not isinstance(nome, str) or not nome.strip():
        return _erro('name obrigatório', 400)
    erro = _valida_parts(parts)
    if erro:
        return _erro(erro, 400)
    desc = data.get('description') if isinstance(data.get('description'), str) else None
    altium = bool(data.get('altium'))
    partes = _partes(parts)

    with _lock_espelho:
        caminho = os.path.join(ROOT, ESPELHO)
        if not os.path.isfile(caminho):
            return _erro('Libs/schlib.js não existe neste workspace', 404)
        try:
            sym = _salva_espelho(caminho, nome, partes, desc)
        except OSError as e:
            return _erro('falha ao gravar o espelho: %s' % e, 500)
        except ValueError as e:
            return _erro('a linha do símbolo no espelho não parseia: %s' % e, 500)
    if sym is None:
        return _erro('símbolo "%s" não está no espelho Libs/schlib.js' % nome, 404)

    resp = {'ok': True, 'espelho': True, 'altium': False, 'backup': None, 'avisos': [], 'parts': sym['parts']}
    if not altium:
        return resp
    alvo = {'name': nome, 'parts': sym['parts']}
    if desc is not None:
        alvo['description'] = desc
    try:
        with _lock_schlib:
            r = _patch_altium(_config(), alvo)
    except P.LibOcupada as e:
        return _erro(str(e), 423, espelho=True, altium=False, backup=None, avisos=[], parts=sym['parts'])
    except SoLeitura as e:
        # 409, não 500: o espelho FOI gravado e vale. Só a .SchLib ficou de fora, e de
        # propósito — a resposta diz por quê, com `soLeitura` para a tela distinguir isso
        # de uma falha de verdade.
        return _erro(str(e), 409, espelho=True, altium=False, soLeitura=True,
                     backup=None, avisos=[], parts=sym['parts'])
    except Exception as e:                                          # noqa: BLE001
        return _erro('espelho gravado, mas a SchLib não: %s' % e, 500,
                     espelho=True, altium=False, backup=None, avisos=[], parts=sym['parts'])
    resp.update(altium=True, backup=r.get('backup'), avisos=r.get('avisos') or [],
                storage=r.get('storage'), verificado=bool(r.get('verificado')),
                nomeAltium=r.get('nomeAltium') or nome)
    return resp


def _acha_valor(esp, i, componente):
    """índice do valor dentro de symbols[i]['valores'] — o indice_almox não o guarda"""
    vals = (esp.get('symbols') or [])[i].get('valores') or []
    for j, v in enumerate(vals):
        if v.get('altium') == componente:
            return j
    return None


class _ErroAlmox(Exception):
    """recusa já com o código HTTP: quem chama devolve `_erro(str(e), e.status)`"""

    def __init__(self, msg, status):
        Exception.__init__(self, msg)
        self.status = status


def _carrega_almox():
    """(espelhos, índice) do almoxarifado, ou _ErroAlmox"""
    try:
        espelhos = G.carrega_espelhos_almox(ROOT)
    except (OSError, ValueError) as e:
        raise _ErroAlmox('não li os espelhos do almoxarifado: %s' % e, 500)
    if not espelhos:
        raise _ErroAlmox('nenhum espelho do almoxarifado em Libs/ (rode o sincronismo)', 404)
    return espelhos, G.indice_almox(espelhos)


def _resolve_almox(fam, comp, espelhos=None, idx=None):
    """Onde mora o valor `comp` da família `fam`: (espelhos, família do ARQUIVO, símbolo,
    k do espelho, i do símbolo, j do valor).

    Saiu de dentro do /save-almox quando o /almox-excluir passou a precisar do MESMO
    caminho — inclusive do desvio pelo nome do símbolo. Duas cópias da resolução seriam
    duas regras: uma rota acharia o componente e a outra não, no mesmo clique.
    `espelhos`/`idx` já carregados: o /almox-aplicar resolve dezenas de componentes, e ler
    3 MB de espelho por componente é o que não pode."""
    if espelhos is None:
        espelhos, idx = _carrega_almox()
    elif idx is None:
        idx = G.indice_almox(espelhos)
    achado = idx.get((fam, comp))
    if not achado:
        # O hub manda como família o NOME do símbolo aberto ("CIRCUITO INTEGRADO [PINAGEM A
        # DEFINIR]", "RESISTOR [SMD]"); o índice, o ledger e o arquivo falam a família do
        # ARQUIVO ("ESPECIAIS", "RESISTOR"). Os dois só coincidem quando o nome não tem sufixo
        # (DIODO TVS, TRANSISTOR) — e só esses salvavam. Resolve pelo nome do símbolo e segue
        # com a família do arquivo, que é a chave de tudo daqui para a frente.
        por_nome = next(((f_, v) for (f_, c_), v in idx.items() if c_ == comp and v[0] == fam), None)
        if por_nome:
            fam, achado = por_nome
    if not achado:
        raise _ErroAlmox('"%s / %s" não está no espelho do almoxarifado (a família pode ser a do '
                         'arquivo, "ESPECIAIS", ou o nome do símbolo)' % (fam, comp), 404)
    sim_nome, k, i = achado
    j = _acha_valor(espelhos[k][2], i, comp)
    if j is None:
        raise _ErroAlmox('"%s" não é um valor de "%s"' % (comp, sim_nome), 404)
    return espelhos, fam, sim_nome, k, i, j


@bp.route('/save-almox', methods=['POST'])
def api_save_almox():
    """(a trava da sincronização em volta do _save_almox — ver _toma)"""
    if not _toma(_sync_lock, _sync_runs):
        return _erro(SYNC_OCUPADO, 409)
    try:
        return _save_almox()
    finally:
        _sync_lock.release()


def _save_almox():
    """A geometria de UM componente do almoxarifado: espelho, .SchLib da família e ledger.

    Diferente do /save, que mexe num símbolo da biblioteca da casa, aqui o alvo é um
    `valores[].altium` — um dos 25 componentes de DIODO TVS, por exemplo — e cada um é um
    componente próprio dentro de Libs/Almox/<FAMÍLIA> ALMOX.SchLib.

    Os três destinos não são redundância; cada um responde por uma coisa:
      espelho  Libs/almox-*.js  → é o que o hub desenha na tela (mas é saída gerada: o
                                  próximo sync o reescreve do zero a partir do Odoo);
      .SchLib  Libs/Almox/…     → é o que o Altium abre. A verdade da geometria;
      ledger   protegidos[f][c] → é o que faz o desenho SOBREVIVER ao sync. Sem ele o
                                  gerador repõe o símbolo default da categoria e o
                                  trabalho some sem avisar.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {familia, componente, parts, altium} obrigatório', 400)
    fam = data.get('familia')
    comp = data.get('componente')
    if not (isinstance(fam, str) and fam.strip()) or not (isinstance(comp, str) and comp.strip()):
        return _erro('familia e componente obrigatórios', 400)
    fam, comp = fam.strip(), comp.strip()
    erro = _valida_parts(data.get('parts'))
    if erro:
        return _erro(erro, 400)
    desc = data.get('description') if isinstance(data.get('description'), str) else None
    altium = bool(data.get('altium'))
    partes = _partes(data['parts'])

    # 1. onde este componente mora — espelho e arquivo
    try:
        espelhos, fam, sim_nome, k, i, j = _resolve_almox(fam, comp)
    except _ErroAlmox as e:
        return _erro(str(e), e.status)
    cam_esp, var, esp = espelhos[k]
    cam, _hoje = G._acha_componente(ROOT, fam, comp, {})
    # Componente que está no espelho mas ainda não na .SchLib: entrou no Odoo depois do último
    # sincronismo (o espelho é regerado do snapshot; o arquivo, só pelo sincronismo inteiro).
    # Recusar aqui deixava o usuário sem caminho: o desenho vai para o espelho e para o ledger
    # (protegido, origem hub), e o guardião o repõe na .SchLib assim que o gerador criar o
    # componente — é o mesmo mecanismo que faz qualquer desenho sobreviver ao sincronismo.
    sem_arquivo = cam is None

    # 2. espelho primeiro: se a SchLib falhar, o hub já mostra o desenho novo
    # RELIDO DENTRO DO LOCK: o `esp` de cima foi lido antes do _acha_componente (centenas de
    # ms parseando .SchLib), e gravá-lo inteiro desfazia o que outro save ou um lote do
    # /almox-aplicar gravasse nessa janela
    with _lock_almox:
        try:
            var, esp = G.le_espelho_almox(cam_esp)
            i2, j2 = _acha_no_espelho(esp, sim_nome, comp)
            if i2 is None:
                return _erro('o espelho mudou enquanto salvava ("%s" não está mais lá): recarregue e salve '
                             'de novo' % comp, 409)
            esp['symbols'][i2]['valores'][j2]['parts'] = partes
            # o id do produto vai para a proteção já na criação: é por ele que o desenho acha o
            # componente quando o nome muda no Odoo antes do próximo sincronismo
            oids = G.ids_odoo_do_valor(esp['symbols'][i2]['valores'][j2]) or None
            G.grava_espelho_almox(cam_esp, var, esp)
        except (OSError, ValueError) as e:
            return _erro('falha ao gravar o espelho do almoxarifado: %s' % e, 500)

    resp = {'ok': True, 'espelho': True, 'altium': False, 'protegido': False,
            'backup': None, 'avisos': [], 'parts': partes,
            'familia': fam, 'componente': comp, 'simbolo': sim_nome}
    alvo = {'name': comp, 'parts': partes}
    if desc is not None:
        alvo['description'] = desc

    # 3. a .SchLib da família. backup_dir=None -> Libs/Almox/Backup-hub, LOCAL: apontar
    #    para a rede faria o save inteiro morrer quando o compartilhamento cai.
    if sem_arquivo:
        resp['avisos'].append(
            '"%s" ainda não existe em Libs/Almox (entrou no Odoo depois do último sincronismo): '
            'o desenho ficou no espelho e protegido no ledger, e entra na .SchLib da família '
            'no próximo sincronismo' % comp)
    if altium and not sem_arquivo:
        try:
            with _lock_schlib:
                r = P.patch(cam, alvo, None, raiz=ROOT)
        except P.LibOcupada as e:
            return _erro(str(e), 423, **resp)
        except Exception as e:                                      # noqa: BLE001
            return _erro('espelho gravado, mas a SchLib não: %s' % e, 500, **resp)
        resp.update(altium=True, backup=r.get('backup'), avisos=r.get('avisos') or [],
                    verificado=bool(r.get('verificado')), arquivo=G.chave_arquivo(ROOT, cam))

    # 4. a proteção no ledger — o único lugar durável. NÃO usar G.protege(): ela lê a
    #    geometria de hoje na .SchLib (não aceita `parts`) e ainda chama atualiza_espelhos,
    #    que escolhe UMA geometria por símbolo e achataria os 25 componentes num só.
    try:
        with G._lock:
            led = G.carrega_ledger(ROOT)
            G._poe_prot(led, fam, comp, partes, 'hub', sim_nome, odoo=oids)
            if altium and not sem_arquivo:
                G.registra_arquivo(ROOT, cam, led, gravar=False)   # senão o próprio save
                                                                   # aparece como "mudou no Altium"
            G.grava_ledger(ROOT, led)
        resp['protegido'] = True
    except Exception as e:                                          # noqa: BLE001
        resp['avisos'] = list(resp['avisos']) + [
            'não protegi no ledger (%s): o próximo sincronismo pode repor o símbolo padrão' % e]
    return resp


# ─── um símbolo da biblioteca aplicado a um componente ────────────────────────
# (a regra de casar os pinos mora no guardiao.aplica_simbolo: ele também a usa, ao dar o
# padrão da categoria a quem entra no almoxarifado depois)
def _simbolo_da_lib(sid):
    """o símbolo `sid` do Libs/symbols-lib.js, ou _ErroAlmox"""
    lib = E.le_symlib(os.path.join(ROOT, SYMLIB))
    sym = next((s for s in ((lib or {}).get('symbols') or []) if s.get('id') == sid), None)
    if sym is None:
        raise _ErroAlmox('o símbolo %s não está na biblioteca de símbolos' % sid, 404)
    if not (sym.get('pins') or sym.get('graphics')):
        raise _ErroAlmox('o símbolo "%s" está vazio: desenhe-o antes de aplicar' % sym.get('name'), 400)
    return sym


@bp.route('/almox-aplicar', methods=['POST'])
def api_almox_aplicar():
    """(a trava da sincronização em volta do _almox_aplicar — ver _toma)"""
    if not _toma(_sync_lock, _sync_runs):
        return _erro(SYNC_OCUPADO, 409)
    try:
        return _almox_aplicar()
    finally:
        _sync_lock.release()


def _almox_aplicar():
    """UM símbolo da biblioteca em VÁRIOS componentes do almoxarifado, de uma vez.

    É o "trocar todos os CAPACITOR ELETROLITICO pelo mesmo símbolo" (pedido do dono,
    2026-09-25). Cada componente recebe o desenho pelo mesmo caminho do /save-almox —
    espelho, .SchLib da família e `protegidos` no ledger, que é o que o faz sobreviver ao
    sincronismo —, mas numa passada só: o espelho é gravado uma vez, cada .SchLib é
    carregada e gravada uma vez com todos os seus componentes, e o ledger uma vez. Chamar o
    /save-almox 40 vezes regravaria a .SchLib 40 vezes, com 40 backups.

    Corpo: {lib: sNNNN, alvos: [{familia, componente, trocaPinagem?}], padroes: [nome do
    símbolo do espelho], altium}. A PINAGEM NÃO MUDA calada: componente com outra contagem
    de pinos que o símbolo vai para `falhas`, a menos que o alvo traga `trocaPinagem: true`
    (o modal manda quando o usuário marca à mão uma linha que não cabe). `padroes` troca também o desenho PADRÃO da categoria — o `parts` da
    família no espelho, que o componente sem desenho próprio herda (inclusive o que entrar
    no Odoo depois).

    O componente fica LIGADO ao símbolo (`protegidos[f][c].lib`, e `padroes[símbolo]` para a
    categoria): é o que deixa editar o símbolo depois e levar o desenho novo a quem o usa.
    Quem já falhou (não achado, desenho inválido) vai em `falhas` e não impede os outros;
    .SchLib aberta no Altium vai em `ocupadas` — o espelho e o ledger já foram, e o
    guardião repõe o desenho na .SchLib no próximo sincronismo."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {lib, alvos, padroes, altium} obrigatório', 400)
    sid = data.get('lib')
    alvos, padroes = data.get('alvos') or [], data.get('padroes') or []
    if not isinstance(sid, str) or not sid.strip():
        return _erro('lib (o id do símbolo) obrigatório', 400)
    if not isinstance(alvos, list) or not isinstance(padroes, list):
        return _erro('alvos e padroes têm que ser listas', 400)
    if not alvos and not padroes:
        return _erro('nada para aplicar: alvos e padroes vazios', 400)
    for a in alvos:
        if not isinstance(a, dict) or not all(isinstance(a.get(k), str) and a[k].strip()
                                               for k in ('familia', 'componente')):
            return _erro('cada alvo é {familia, componente}', 400)
    if not all(isinstance(p, str) and p.strip() for p in padroes):
        return _erro('padroes é uma lista de nomes de símbolo', 400)
    sid, altium = sid.strip(), bool(data.get('altium'))
    try:
        sym = _simbolo_da_lib(sid)
    except _ErroAlmox as e:
        return _erro(str(e), e.status)

    feitos, pads, falhas, avisos, ocupadas = [], [], [], [], []
    # resolução e espelho no MESMO lock: entre ler e gravar, outro save poderia reescrever
    # o espelho, e a gravação daqui levaria a versão velha de volta
    with _lock_almox:
        try:
            espelhos, idx = _carrega_almox()
        except _ErroAlmox as e:
            return _erro(str(e), e.status)
        vistos = set()
        for a in alvos:
            fam, comp = a['familia'].strip(), a['componente'].strip()
            troca_pinagem = a.get('trocaPinagem') is True
            try:
                _e, fam_arq, sim_nome, k, i, j = _resolve_almox(fam, comp, espelhos, idx)
            except _ErroAlmox as e:
                falhas.append(OrderedDict([('familia', fam), ('componente', comp), ('erro', str(e))]))
                continue
            if (fam_arq, comp) in vistos:
                continue
            vistos.add((fam_arq, comp))
            s = espelhos[k][2]['symbols'][i]
            v = s['valores'][j]
            atual = v.get('parts') or s.get('parts')
            novas, modo = G.aplica_simbolo(atual, sym)
            npin = len(((atual or [{}])[0] or {}).get('pins') or [])
            if modo == 'simbolo' and npin and not troca_pinagem:
                falhas.append(OrderedDict([('familia', fam_arq), ('componente', comp), ('erro',
                    '%d pino(s) contra %d do símbolo: a pinagem do componente seria trocada pela do símbolo'
                    % (npin, len(sym.get('pins') or [])))]))
                continue
            erro = _valida_parts(novas)
            if erro:
                falhas.append(OrderedDict([('familia', fam_arq), ('componente', comp), ('erro', erro)]))
                continue
            # o id do produto vai junto para a proteção: é por ele que ela acha o componente
            # que for renomeado no Odoo antes do próximo sincronismo
            oids = ' '.join(str(it.get('odoo')).strip() for it in (v.get('itens') or []) if it.get('odoo'))
            feitos.append({'familia': fam_arq, 'componente': comp, 'simbolo': sim_nome, 'k': k,
                           'i': i, 'j': j, 'parts': _partes(novas), 'pinagem': modo, 'altium': False,
                           'odoo': oids})
        for nome in padroes:
            nome = nome.strip()
            onde = next(((k, i) for k, (_c, _v, esp) in enumerate(espelhos)
                         for i, s in enumerate(esp.get('symbols') or []) if s.get('name') == nome), None)
            if onde is None:
                falhas.append(OrderedDict([('simbolo', nome), ('erro', 'a categoria "%s" não está no espelho' % nome)]))
                continue
            k, i = onde
            if G.e_placeholder(nome):
                falhas.append(OrderedDict([('simbolo', nome), ('erro', 'categoria de pinagem a definir não '
                    'recebe desenho padrão: o componente muda de símbolo quando o Odoo informar o encapsulamento')]))
                continue
            atual = espelhos[k][2]['symbols'][i].get('parts')
            novas, modo = G.aplica_simbolo(atual, sym)
            if modo == 'simbolo' and ((atual or [{}])[0] or {}).get('pins'):
                falhas.append(OrderedDict([('simbolo', nome), ('erro', 'o desenho padrão da categoria tem outra '
                    'contagem de pinos: a pinagem dela seria trocada pela do símbolo')]))
                continue
            erro = _valida_parts(novas)
            if erro:
                falhas.append(OrderedDict([('simbolo', nome), ('erro', erro)]))
                continue
            pads.append({'simbolo': nome, 'k': k, 'i': i, 'parts': _partes(novas), 'pinagem': modo})
        if not feitos and not pads:
            return _erro('nada foi aplicado', 404, falhas=falhas)
        tocados = set()
        for f in feitos:
            espelhos[f['k']][2]['symbols'][f['i']]['valores'][f['j']]['parts'] = f['parts']
            tocados.add(f['k'])
        for p in pads:
            s = espelhos[p['k']][2]['symbols'][p['i']]
            s['parts'], s['partcount'] = p['parts'], len(p['parts'])
            bb = G._bbox(p['parts'])
            if bb:
                s['bbox'] = bb
            tocados.add(p['k'])
        try:
            for k in sorted(tocados):
                cam_esp, var, esp = espelhos[k]
                G.grava_espelho_almox(cam_esp, var, esp)
        except OSError as e:
            return _erro('falha ao gravar o espelho do almoxarifado: %s' % e, 500)

    # a .SchLib: uma carga e uma gravação por arquivo, com todos os componentes dele
    gravados = []
    if altium and feitos:
        cache, por_arquivo = {}, OrderedDict()
        nao_achei = set()
        for f in feitos:
            # o espelho JÁ foi gravado: uma .SchLib ilegível aqui não pode virar 500 e deixar
            # o espelho mudado sem a proteção no ledger (que vem logo abaixo)
            try:
                cam, _hoje = G._acha_componente(ROOT, f['familia'], f['componente'], cache)
            except Exception as e:                                  # noqa: BLE001
                nao_achei.add(f['componente'])
                avisos.append('não localizei "%s" nas .SchLib (%s): o desenho ficou no espelho e no '
                              'ledger, e entra na .SchLib no próximo sincronismo' % (f['componente'], e))
                continue
            if cam is None:
                continue
            por_arquivo.setdefault(cam, []).append(f)
        sem = [f['componente'] for f in feitos if not any(f in fs for fs in por_arquivo.values())
               and f['componente'] not in nao_achei]
        if sem:
            avisos.append('%d componente(s) ainda não existe(m) em Libs/Almox (entraram no Odoo depois do '
                          'último sincronismo): o desenho ficou no espelho e no ledger, e entra na .SchLib '
                          'no próximo sincronismo' % len(sem))
        for cam, fs in por_arquivo.items():
            base = os.path.basename(cam)
            try:
                with _lock_schlib:
                    lb = P.carrega(cam)
                    for f in fs:
                        avisos.extend(P.aplica(lb, {'name': f['componente'], 'parts': f['parts']}) or [])
                    r = P.grava(lb, cam, None, backup=True)
                    with open(cam, 'rb') as fh:
                        bruto = fh.read()
                    difs = P.verifica_varios(bruto, [{'name': f['componente'], 'parts': f['parts']} for f in fs])
                    if difs:
                        if r.get('backup'):
                            shutil.copy2(r['backup'], cam)
                        raise RuntimeError('a releitura não bate com o que foi gravado%s: %s' % (
                            ' (backup restaurado)' if r.get('backup') else '', difs[0]))
            except P.LibOcupada:
                ocupadas.append(base)
                continue
            except Exception as e:                                  # noqa: BLE001
                avisos.append('%s não foi gravada: %s' % (base, e))
                continue
            gravados.append(cam)
            for f in fs:
                f['altium'] = True

    # o ledger: a proteção (sobreviver ao sincronismo) e o vínculo com o símbolo
    protegido = False
    try:
        with G._lock:
            led = G.carrega_ledger(ROOT)
            for f in feitos:
                G._poe_prot(led, f['familia'], f['componente'], f['parts'], 'hub', f['simbolo'], lib=sid,
                            odoo=f.get('odoo') or None)
            for p in pads:
                G.poe_padrao(led, p['simbolo'], sid)
            for cam in gravados:
                G.registra_arquivo(ROOT, cam, led, gravar=False)
            G.grava_ledger(ROOT, led)
        protegido = True
    except Exception as e:                                          # noqa: BLE001
        avisos.append('não protegi no ledger (%s): o próximo sincronismo pode repor o desenho antigo' % e)

    limpa = lambda d: OrderedDict((k, v) for k, v in d.items() if k not in ('k', 'i', 'j', 'odoo'))   # noqa: E731
    return {'ok': True, 'lib': {'id': sid, 'name': sym.get('name', '')}, 'altium': altium,
            'protegido': protegido, 'feitos': [limpa(f) for f in feitos], 'padroes': [limpa(p) for p in pads],
            'falhas': falhas, 'ocupadas': ocupadas, 'avisos': avisos}


def _quem_ficou_para_tras(sym):
    """Quem usa o símbolo e ainda NÃO tem o desenho que ele dá hoje — é a lista que o editor
    oferece atualizar depois de um Salvar símbolo. Salvar só a descrição não deixa ninguém
    para trás (e não pergunta nada); uma edição recusada antes continua na lista.
      vinculados / padroes            os que o /almox-aplicar pode atualizar
      naoCabem / padroesNaoCabem      os que teriam a PINAGEM trocada (a contagem mudou): o
                                      editor os deixa de fora e diz quantos são
      emDia                           quantos já estão com o desenho de hoje"""
    fora = OrderedDict([('vinculados', []), ('naoCabem', []), ('padroes', []), ('padroesNaoCabem', []),
                        ('emDia', 0)])
    led = G.carrega_ledger(ROOT)
    comps, pads = G.vinculos(led, sym.get('id'))
    npin = lambda parts: len((((parts or [{}])[0]) or {}).get('pins') or [])       # noqa: E731
    for c in comps:
        p = led['protegidos'][c['familia']][c['componente']]
        novas, modo = G.aplica_simbolo(p.get('parts'), sym)
        if modo == 'simbolo' and npin(p.get('parts')):
            fora['naoCabem'].append(c)
        elif G.fp_parts(_partes(novas)) == G.fp_parts(p.get('parts')):
            fora['emDia'] += 1
        else:
            fora['vinculados'].append(OrderedDict(c, pinagem=modo))
    if pads:
        try:
            espelhos = G.carrega_espelhos_almox(ROOT)
        except (OSError, ValueError):
            espelhos = []
        por_nome = {s.get('name'): s for _c, _v, e in espelhos for s in (e.get('symbols') or [])}
        for nome in pads:
            s = por_nome.get(nome)
            if s is None:
                continue
            novas, modo = G.aplica_simbolo(s.get('parts'), sym)
            if modo == 'simbolo' and npin(s.get('parts')):
                fora['padroesNaoCabem'].append(nome)
            elif G.fp_parts(_partes(novas)) != G.fp_parts(s.get('parts')):
                fora['padroes'].append(nome)
    return fora


@bp.route('/lib-vinculos', methods=['GET'])
def api_lib_vinculos():
    """quem usa cada símbolo da biblioteca, pelo ledger: os componentes e as categorias
    (`?lib=sNNNN` filtra um só). Só leitura."""
    try:
        led = G.carrega_ledger(ROOT)
    except (OSError, ValueError) as e:
        return _erro('não li o ledger: %s' % e, 500)
    comps, pads = G.vinculos(led, (request.args.get('lib') or '').strip() or None)
    return {'ok': True, 'componentes': comps, 'padroes': pads}


def _acha_no_espelho(esp, simbolo, componente):
    """(i, j) do valor dentro do espelho, achados pelo NOME.

    O /save-almox reusa os índices que a resolução devolveu; aqui não dá: quem erra o índice
    numa exclusão REMOVE o valor errado, e entre a resolução e o lock uma sincronização pode
    ter reescrito o espelho inteiro (símbolo novo no meio da lista, valor que saiu do Odoo).
    Custa uma releitura e vale o preço."""
    for i, sim in enumerate(esp.get('symbols') or []):
        if sim.get('name') != simbolo:
            continue
        for j, v in enumerate(sim.get('valores') or []):
            if v.get('altium') == componente:
                return i, j
    return None, None


def _usos_do_valor(valor, altium):
    """Onde este valor já foi colocado: [{'projeto', 'refs':[…]}] varrendo Projects/*/schematic.js.

    Serve para AVISAR, nunca para recusar: a decisão de excluir é do usuário, e um
    componente já desenhado não deixa de existir na folha porque saiu da biblioteca (o
    `.SchDoc` real guarda a geometria dele). O que ele perde é a volta ao almoxarifado —
    trocar o valor, refazer a lista de materiais.

    Três marcas, nesta ordem:
      `OdooId=<id>` no `params`    o id da variante `product.product` — Único no catálogo
                                   inteiro, e por isso a marca que manda quando existe. É o
                                   que o AI-GUIDE chama de identidade da peça: liga componente
                                   e produto sem depender de texto nenhum.
      `ValorId=<id>` + símbolo     o `valores[].id` é por SÍMBOLO: a bateria e a barra de
                                   pinos têm, as duas, um valor de id 1. Sozinho ele acusou o
                                   J1 do _DemoKit (uma barra de pinos, OdooId=1038) como uso
                                   de uma BATERIA — medido, não suposto. Então só vale
                                   corroborado pelo `sym` ou pelo `comment`. Aviso errado não
                                   é "um aviso a mais": ou assusta quem ia excluir com razão,
                                   ou ensina a ignorar o aviso que um dia estará certo.
      `sym` / `comment`            o esquema anterior ao params só tem isto. `sym` é o
                                   LibReference na .SchLib da família, exatamente o
                                   `valores[].altium` (odoolista.py » carrega_acervo);
                                   `comment` igual ao `label` é o último recurso.
    """
    vid = valor.get('id')
    label = (valor.get('label') or '').strip()
    odoo = ''
    for p in (valor.get('params') or []):
        if isinstance(p, dict) and str(p.get('n') or '').strip() == 'OdooId':
            odoo = str(p.get('v') or '').strip()
    alvo_odoo = ('OdooId=%s' % odoo) if odoo else None
    alvo_val = ('ValorId=%s' % vid) if vid not in (None, '', 0) else None
    fora = []
    base = os.path.join(ROOT, PROJETOS)
    try:
        nomes = sorted(os.listdir(base))
    except OSError:
        return fora
    for nome in nomes:
        cam = os.path.join(base, nome, 'schematic.js')
        if not os.path.isfile(cam):
            continue
        try:
            sch = _le_var(cam)
        except (OSError, ValueError):
            continue            # projeto com o schematic.js quebrado não cala a exclusão
        if not isinstance(sch, dict):
            continue
        refs = []
        for it in (sch.get('items') or []):
            if not isinstance(it, dict) or it.get('t') != 'comp':
                continue
            params = it.get('params') if isinstance(it.get('params'), str) else ''
            pares = [t.strip() for t in params.split(';')] if params else []
            # o texto do desenho, que vale sozinho só quando não há identidade no params
            texto = ((it.get('sym') or '').strip() == altium
                     or (bool(label) and (it.get('comment') or '').strip() == label))
            if any(t.startswith('OdooId=') for t in pares) and alvo_odoo:
                bate = alvo_odoo in pares
            elif any(t.startswith('ValorId=') for t in pares):
                bate = alvo_val is not None and alvo_val in pares and texto
            else:
                bate = texto
            ref = str(it.get('ref') or '').strip()
            # multi-parte é vários `comp` com o MESMO designador: contar duas vezes faria o
            # aviso pedir mais componentes do que existem na folha
            if bate and ref and ref not in refs:
                refs.append(ref)
        if refs:
            fora.append({'projeto': nome, 'refs': refs})
    return fora


@bp.route('/almox-excluidos', methods=['GET'])
def api_almox_excluidos():
    """A lista inteira — é dela que a tela monta o "Excluídos" e oferece o desfazer."""
    try:
        return {'ok': True, 'itens': A.carrega_excluidos(ROOT).get('itens') or []}
    except (OSError, ValueError) as e:
        return _erro('não li a lista de excluídos: %s' % e, 500)


@bp.route('/almox-excluir', methods=['POST'])
def api_almox_excluir():
    """APAGA um VALOR da biblioteca. Quem decide se ele volta é o Odoo, não esta rota.

    Desde 2026-09-17 a exclusão deixou de ser um veto permanente e passou a ser o que o
    nome diz. O gerador não consulta lista nenhuma (almox2lib » numera_valores), então o
    destino do valor apagado é decidido pela próxima geração:

      - AINDA EXISTE no Odoo -> é remontado do CSV, com o mesmo id. É a rede de segurança
        de quem apagou por engano: puxar de novo resolve;
      - JÁ NÃO EXISTE no Odoo -> era o duplicado do tempo em que o cadastro não tinha
        padrão de nome, e só sobrevivia por estar no espelho. Sai daqui e morre de vez.

    Só valores. Símbolo é família inteira e sai do Odoo junto com o último produto dela; o
    que o usuário apaga à mão é o item, o "PTH 10uF 16V O5 2mm" duplicado.

    Sem `confirmar` isto é uma PRÉVIA: não encosta em arquivo nenhum e devolve `usos`, para
    a tela dizer onde o item já está antes de perguntar. Item em uso não é recusa — a
    decisão é do usuário; recusar calado seria pior que avisar.

    Com `confirmar`, nesta ordem:
      1. sai do espelho (Libs/almox-*.js). É ESTE o passo que apaga — e, para o valor que
         não vem mais do Odoo, é o passo que o mata de vez, porque o espelho anterior era
         a única fonte dele;
      2. entra em Libs/almox-excluidos.json como REGISTRO (o que foi apagado e quando).
         Não é filtro: perder este arquivo não ressuscita nada;
      3. a proteção do desenho no ledger é PRESERVADA. Era apagada até 2026-09-17, e isso
         destruía a única cópia durável do desenho feito à mão — se o valor voltasse pelo
         Odoo, voltava genérico e calado. O guardião já sabe lidar com protegido cujo
         componente sumiu: marca `orfao` guardando o `parts` e desmarca sozinho quando ele
         reaparece (guardiao.py » depois);
      4. a .SchLib NÃO é tocada. O schlib_escritor reescreve as .SchLib inteiras a cada
         sincronismo a partir do espelho, então o componente sai de lá sozinho — e escrever
         remoção no binário seria código novo por cima da biblioteca do usuário. Até o
         próximo sincronismo o componente continua existindo dentro do Altium, e a resposta
         diz isso em `avisos` (o usuário precisa saber, não descobrir).
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {familia, componente, confirmar} obrigatório', 400)
    fam, comp = data.get('familia'), data.get('componente')
    if not (isinstance(fam, str) and fam.strip()) or not (isinstance(comp, str) and comp.strip()):
        return _erro('familia e componente obrigatórios', 400)
    fam, comp = fam.strip(), comp.strip()
    try:
        espelhos, fam, sim_nome, k, i, j = _resolve_almox(fam, comp)
    except _ErroAlmox as e:
        return _erro(str(e), e.status)
    cam_esp, _var, esp = espelhos[k]     # o varname vem da releitura, dentro do lock
    valor = (esp['symbols'][i].get('valores') or [])[j]
    label = (valor.get('label') or '').strip()
    usos = _usos_do_valor(valor, comp)
    total = sum(len(u['refs']) for u in usos)
    resp = {'ok': True, 'simbolo': sim_nome, 'familia': fam, 'componente': comp,
            'label': label, 'usos': usos, 'total': total}
    if not data.get('confirmar'):
        return dict(resp, previa=True)

    avisos = []
    if usos:
        avisos.append('"%s" está em %d componente(s) de %d projeto(s) (%s): o esquema '
                      'continua como está, mas o componente sai da biblioteca'
                      % (comp, total, len(usos), ', '.join(u['projeto'] for u in usos)))

    # 1. O ESPELHO PRIMEIRO: é o passo que apaga de verdade. Para o valor que não vem mais
    #    do Odoo, o espelho anterior era a única fonte dele (almox2lib » numera_valores),
    #    então tirá-lo daqui é o que o mata. Se este passo falhar, nada foi apagado — e o
    #    registro abaixo não é escrito, para a tela não mentir dizendo que apagou.
    with _lock_almox:
        try:
            var2, esp2 = G.le_espelho_almox(cam_esp)
            i2, j2 = _acha_no_espelho(esp2, sim_nome, comp)
            if i2 is None:
                avisos.append('o valor já não estava no espelho — nada a remover ali')
            else:
                esp2['symbols'][i2]['valores'].pop(j2)
                G.grava_espelho_almox(cam_esp, var2, esp2)
        except (OSError, ValueError) as e:
            return _erro('não consegui apagar do espelho (%s): nada foi alterado' % e, 500)

    # 2. o REGISTRO do que foi apagado. Não é filtro (o gerador não lê): serve para a tela
    #    mostrar o histórico da limpeza e para o desfazer saber o que tirar da lista. Falhar
    #    aqui não desfaz o passo 1, então é aviso e não erro.
    with _lock_excluidos:
        try:
            lista = A.carrega_excluidos(ROOT)
            if not any(it.get('simbolo') == sim_nome and it.get('altium') == comp
                       for it in lista['itens']):
                lista['itens'].append(OrderedDict([
                    ('simbolo', sim_nome), ('familia', fam), ('altium', comp), ('label', label),
                    ('quando', datetime.now().strftime('%Y-%m-%d %H:%M'))]))
            A.grava_excluidos(ROOT, lista)
        except (OSError, ValueError) as e:
            avisos.append('apaguei da biblioteca, mas não registrei em %s (%s): só o '
                          'histórico se perde' % (A.EXCLUIDOS, e))

    # 3. A PROTEÇÃO DO DESENHO FICA. Ela era apagada aqui até 2026-09-17, e isso destruía a
    #    única cópia durável do desenho feito à mão: se o valor voltasse pelo Odoo, voltava
    #    genérico e calado. O guardião já trata protegido cujo componente sumiu — marca
    #    `orfao` guardando o `parts` e desmarca sozinho quando ele reaparece.

    # 4. o Altium só sente no próximo sincronismo — e isso tem de sair dito
    avisos.append('o componente sai das .SchLib de Libs/Almox no próximo sincronismo do '
                  'almoxarifado (elas são reescritas inteiras a partir do espelho); até lá '
                  'ele continua aparecendo dentro do Altium')
    avisos.append('se este item ainda existir no Odoo, a próxima sincronização o traz de '
                  'volta com o mesmo número — é assim que se desfaz um engano. Some de vez '
                  'só o que já não está mais no Odoo')
    return dict(resp, excluido=True, espelho=True, avisos=avisos)


@bp.route('/almox-excluir/desfazer', methods=['POST'])
def api_almox_excluir_desfazer():
    """Tira a linha do REGISTRO. Não é isto que traz o valor de volta — quem traz é o Odoo.

    Desde 2026-09-17 o gerador não lê a lista, então tirar daqui só limpa o histórico. Se o
    produto ainda existir no Odoo, o valor volta na próxima sincronização de qualquer jeito
    (com o MESMO id, porque Libs/almox-parts.json nunca devolveu o número) — inclusive sem
    passar por aqui. Se não existir mais, não há desfazer: ele foi apagado de vez.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {simbolo, altium} obrigatório', 400)
    sim, alt = data.get('simbolo'), data.get('altium')
    if not (isinstance(sim, str) and sim.strip()) or not (isinstance(alt, str) and alt.strip()):
        return _erro('simbolo e altium obrigatórios', 400)
    sim, alt = sim.strip(), alt.strip()
    with _lock_excluidos:
        try:
            lista = A.carrega_excluidos(ROOT)
        except (OSError, ValueError) as e:
            return _erro('não li a lista de excluídos: %s' % e, 500)
        achado = next((it for it in lista['itens']
                       if it.get('simbolo') == sim and it.get('altium') == alt), None)
        if achado is None:
            return _erro('"%s / %s" não está na lista de excluídos' % (sim, alt), 404)
        lista['itens'] = [it for it in lista['itens'] if it is not achado]
        try:
            A.grava_excluidos(ROOT, lista)
        except OSError as e:
            return _erro('não gravei a lista de excluídos: %s' % e, 500)
    return {'ok': True, 'desfeito': True, 'item': achado,
            'avisos': ['tirei do registro. O valor volta ao espelho e ao Altium no próximo '
                       'sincronismo SE o produto ainda existir no Odoo; se não existir, ele '
                       'já foi apagado de vez e isto só limpou o histórico']}


# ─── o mesmo produto do Odoo em mais de um componente ─────────────────────────
# Pedido do dono (2026-09-29): "tudo é vinculado pelo ID do Odoo", e "o sistema deve reconhecer
# componentes com o ID do Odoo duplicado e avisar". O duplicado que existe é o ZUMBI de uma
# renomeação feita antes de o gerador seguir o id: o nome velho ficou `fora: true` carregando
# os `itens` do produto que hoje mora com o nome novo (o TMAG5131A1: nº 4 fora, nº 46 vivo).
# Medido no servidor nesse dia: 741 produtos, 777 componentes antigos. O gerador não produz
# mais isso e nunca apaga sozinho (almox2lib » duplicados_odoo); o guardião já leva o desenho
# e o vínculo com o símbolo do antigo para o vivo. Apagar o antigo é decisão do usuário, e em
# lote, porque ninguém apaga 777 à mão.
def _duplicados(espelhos):
    """(grupos, antigos). `grupos` é o almox2lib.duplicados_odoo do acervo inteiro; `antigos`
    são os componentes que o "apagar os antigos" leva: `fora`, e com TODO produto que carregam
    vivo noutro componente — o `fora` que é a última lembrança de um produto que saiu do Odoo
    não é antigo de ninguém, e fica."""
    syms = [s for _c, _v, esp in espelhos for s in (esp.get('symbols') or [])]
    grupos = A.duplicados_odoo(syms)
    vivos = {oid for s in syms for v in (s.get('valores') or []) if not v.get('fora')
             for oid in A.ids_odoo(v)}
    antigos, vistos = [], set()
    for s in syms:
        for v in s.get('valores') or []:
            oids = A.ids_odoo(v)
            chave = (s.get('name', ''), v.get('altium', ''))
            if not v.get('fora') or not oids or chave in vistos or not all(o in vivos for o in oids):
                continue
            vistos.add(chave)
            antigos.append(OrderedDict([('simbolo', chave[0]), ('altium', chave[1]),
                                        ('label', v.get('label', '')), ('id', v.get('id')),
                                        ('odoo', ' '.join(oids))]))
    return grupos, antigos


def _vivos(espelhos):
    """os ids do Odoo que vivem em algum componente que NÃO está `fora`"""
    return {oid for _c, _v, esp in espelhos for s in (esp.get('symbols') or [])
            for v in (s.get('valores') or []) if not v.get('fora') for oid in A.ids_odoo(v)}


def _usos_por_nome(nomes, vivos):
    """[{'projeto', 'refs', 'orfaos'}] dos componentes de Projects/*/schematic.js cujo `sym` é um
    dos `nomes`. Uma leitura de cada projeto para o lote inteiro — o `_usos_do_valor` relê
    todos por valor, e 777 valores seriam 10 mil leituras. `orfaos` são os que a folha NÃO leva
    para outro componente sozinha (schframe.js » seguePeloOdoo): sem OdooId no params, ou com
    um id que não vive em componente nenhum — esses viram quadrado vermelho até alguém trocar."""
    fora, nomes = [], set(nomes)
    base = os.path.join(ROOT, PROJETOS)
    try:
        pastas = sorted(os.listdir(base))
    except OSError:
        return fora
    for nome in pastas:
        cam = os.path.join(base, nome, 'schematic.js')
        if not os.path.isfile(cam):
            continue
        try:
            sch = _le_var(cam)
        except (OSError, ValueError):
            continue
        refs, sem = [], []
        for it in ((sch or {}).get('items') or []) if isinstance(sch, dict) else []:
            if not isinstance(it, dict) or it.get('t') != 'comp' or (it.get('sym') or '') not in nomes:
                continue
            ref = str(it.get('ref') or '').strip()
            if ref and ref not in refs:
                refs.append(ref)
                params = it.get('params') if isinstance(it.get('params'), str) else ''
                m = re.search(r'(?:^|;)\s*OdooId=([^;]*)', params)
                if not any(o in vivos for o in (m.group(1).split() if m else [])):
                    sem.append(ref)
        if refs:
            fora.append({'projeto': nome, 'refs': refs, 'orfaos': sem})
    return fora


def _apaga_do_espelho(espelhos, alvo):
    """tira do espelho os valores `alvo` {(símbolo, altium)} e grava cada espelho tocado UMA
    vez. -> [{simbolo, familia, altium, label}]. Quem chama segura o _lock_almox e releu os
    espelhos dentro dele."""
    apagados = []
    for cam, var, esp in espelhos:
        mudou = False
        for s in esp.get('symbols') or []:
            fica = []
            for v in s.get('valores') or []:
                if (s.get('name', ''), v.get('altium', '')) in alvo:
                    apagados.append(OrderedDict([
                        ('simbolo', s.get('name', '')), ('familia', s.get('familia', '')),
                        ('altium', v.get('altium', '')), ('label', v.get('label', ''))]))
                    mudou = True
                else:
                    fica.append(v)
            s['valores'] = fica
        if mudou:
            G.grava_espelho_almox(cam, var, esp)
    return apagados


def _registra_apagados(apagados):
    """o REGISTRO em Libs/almox-excluidos.json (o que foi apagado e quando). -> avisos: falhar
    aqui não desfaz o que já saiu do espelho, só perde o histórico."""
    avisos = []
    with _lock_excluidos:
        try:
            lista = A.carrega_excluidos(ROOT)
            ja = {(it.get('simbolo'), it.get('altium')) for it in lista['itens']}
            quando = datetime.now().strftime('%Y-%m-%d %H:%M')
            for a in apagados:
                if (a['simbolo'], a['altium']) not in ja:
                    lista['itens'].append(OrderedDict(list(a.items()) + [('quando', quando)]))
            A.grava_excluidos(ROOT, lista)
        except (OSError, ValueError) as e:
            avisos.append('apaguei da biblioteca, mas não registrei em %s (%s): só o histórico '
                          'se perde' % (A.EXCLUIDOS, e))
    avisos.append('eles saem das .SchLib de Libs/Almox no próximo sincronismo do almoxarifado; '
                  'até lá continuam aparecendo dentro do Altium')
    return avisos


@bp.route('/almox-duplicados', methods=['GET'])
def api_almox_duplicados():
    """a lista, para o aviso da Biblioteca. Só leitura."""
    try:
        espelhos, _idx = _carrega_almox()
    except _ErroAlmox as e:
        return _erro(str(e), e.status)
    grupos, antigos = _duplicados(espelhos)
    lote = {(a['simbolo'], a['altium']) for a in antigos}
    return {'ok': True, 'grupos': grupos, 'antigos': antigos,
            'soFora': sum(1 for g in grupos if all(v['fora'] for v in g['valores'])),
            # tem um vivo, mas o antigo carrega TAMBEM um produto que saiu do Odoo: e a
            # ultima lembranca dele, e fica fora do lote (a tela diz por que o grupo sobrou)
            'misturados': sum(1 for g in grupos
                              if any(not v['fora'] for v in g['valores'])
                              and any(v['fora'] and (v['simbolo'], v['altium']) not in lote
                                      for v in g['valores']))}


@bp.route('/almox-duplicados', methods=['POST'])
def api_almox_duplicados_apaga():
    """(a trava da sincronização em volta do _apaga_duplicados — ver _toma)"""
    if not _toma(_sync_lock, _sync_runs):
        return _erro(SYNC_OCUPADO, 409)
    try:
        return _apaga_duplicados()
    finally:
        _sync_lock.release()


def _apaga_duplicados():
    """APAGA OS ANTIGOS: os `fora` cujo produto vive noutro componente (`_duplicados`).

    Sem `confirmar` é a PRÉVIA, que não encosta em arquivo: quantos são e onde são usados.
    Com `confirmar`, o mesmo que o /almox-excluir faz com um, feito com todos de uma vez:
      1. saem do espelho — é o passo que apaga, e para o `fora` é definitivo (o espelho
         anterior era a única fonte dele: almox2lib » numera_valores). O número continua
         reservado no livro-razão; nada renumera;
      2. entram em Libs/almox-excluidos.json como registro;
      3. o ledger NÃO é tocado: a proteção de um antigo cujo vivo não tinha nenhuma já foi para
         o vivo (guardiao » segue_renomeacoes), e a que sobrou vira órfã guardada, como no
         excluir de um só;
      4. as .SchLib só sentem no próximo sincronismo, que as reescreve do espelho."""
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    with _lock_almox:
        try:
            espelhos = G.carrega_espelhos_almox(ROOT)
        except (OSError, ValueError) as e:
            return _erro('não li os espelhos do almoxarifado: %s' % e, 500)
        _grupos, antigos = _duplicados(espelhos)
        alvo = {(a['simbolo'], a['altium']) for a in antigos}
        if not data.get('confirmar'):
            usos = _usos_por_nome({a['altium'] for a in antigos}, _vivos(espelhos))
            return {'ok': True, 'previa': True, 'antigos': antigos, 'usos': usos,
                    'total': sum(len(u['refs']) for u in usos),
                    'orfaos': sum(len(u['orfaos']) for u in usos)}
        try:
            apagados = _apaga_do_espelho(espelhos, alvo)
        except (OSError, ValueError) as e:
            return _erro('não consegui apagar do espelho (%s)' % e, 500)
    return {'ok': True, 'apagados': len(apagados), 'avisos': _registra_apagados(apagados)}


# ─── os `fora`: por categoria, por seleção ou a biblioteca inteira ─────────────
# Pedido do dono (2026-09-29): um botão na categoria que seleciona todos os componentes `fora`,
# e poder apagar os `fora` da biblioteca. Esta rota só apaga `fora` — componente que ainda vem
# do Odoo voltaria no sincronismo seguinte, e misturar os dois num lote faria o "apagar" mentir.
# Apagar um `fora` é definitivo para a biblioteca, mas não para o produto: se ele voltar ao
# Odoo (ou ganhar de novo a marca "é componente eletrônico"), volta com o MESMO número, porque
# o livro-razão nunca o devolveu (almox2lib » numera_valores).
@bp.route('/almox-fora', methods=['GET'])
def api_almox_fora():
    """quantos `fora` há, no total e por símbolo. Só leitura."""
    try:
        espelhos, _idx = _carrega_almox()
    except _ErroAlmox as e:
        return _erro(str(e), e.status)
    por = OrderedDict()
    for _c, _v, esp in espelhos:
        for s in esp.get('symbols') or []:
            n = sum(1 for v in (s.get('valores') or []) if v.get('fora'))
            if n:
                por[s.get('name', '')] = n
    return {'ok': True, 'total': sum(por.values()), 'porSimbolo': por}


@bp.route('/almox-fora', methods=['POST'])
def api_almox_fora_apaga():
    """(a trava da sincronização em volta do _apaga_fora — ver _toma)"""
    if not _toma(_sync_lock, _sync_runs):
        return _erro(SYNC_OCUPADO, 409)
    try:
        return _apaga_fora()
    finally:
        _sync_lock.release()


def _apaga_fora():
    """{simbolo, componentes?} apaga os `fora` escolhidos daquele símbolo (a seleção da tela) ou,
    sem `componentes`, todos os `fora` dele; {todos: true} apaga todos os `fora` da biblioteca.
    Pedido sem nenhum dos dois é 400 — apagar tudo tem de ser dito com todas as letras.

    Componente pedido que NÃO está `fora` (voltou ao Odoo desde que a tela carregou) ou que não
    existe mais não é apagado: volta em `ignorados`, com o porquê. Sem `confirmar` é a PRÉVIA
    (quantos e onde são usados); com `confirmar`, o mesmo caminho do "apagar os antigos"."""
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    simbolo, comps, todos = data.get('simbolo'), data.get('componentes'), data.get('todos') is True
    if simbolo is not None and not (isinstance(simbolo, str) and simbolo.strip()):
        return _erro('simbolo tem de ser o nome de um símbolo', 400)
    if comps is not None and not (isinstance(comps, list) and all(isinstance(c, str) and c.strip() for c in comps)):
        return _erro('componentes é uma lista de nomes (valores[].altium)', 400)
    if comps is not None and not simbolo:
        return _erro('componentes vêm com o simbolo: o mesmo nome pode existir em outra família', 400)
    if not simbolo and not todos:
        return _erro('diga o que apagar: {simbolo[, componentes]} ou {todos: true}', 400)
    simbolo = simbolo.strip() if simbolo else None
    pedidos = {c.strip() for c in comps} if comps is not None else None
    with _lock_almox:
        try:
            espelhos = G.carrega_espelhos_almox(ROOT)
        except (OSError, ValueError) as e:
            return _erro('não li os espelhos do almoxarifado: %s' % e, 500)
        alvos, ignorados, achados = [], [], set()
        for _c, _v, esp in espelhos:
            for s in esp.get('symbols') or []:
                if simbolo and s.get('name') != simbolo:
                    continue
                for v in s.get('valores') or []:
                    alt = v.get('altium', '')
                    if pedidos is not None:
                        if alt not in pedidos:
                            continue
                        achados.add(alt)
                    if not v.get('fora'):
                        if pedidos is not None:
                            ignorados.append({'altium': alt, 'porque': 'não está fora: voltou ao Odoo'})
                        continue
                    alvos.append(OrderedDict([('simbolo', s.get('name', '')), ('altium', alt),
                                              ('label', v.get('label', '')), ('id', v.get('id'))]))
        for alt in sorted((pedidos or set()) - achados):
            ignorados.append({'altium': alt, 'porque': 'não está mais na biblioteca'})
        if not data.get('confirmar'):
            usos = _usos_por_nome({a['altium'] for a in alvos}, _vivos(espelhos))
            return {'ok': True, 'previa': True, 'alvos': alvos, 'ignorados': ignorados, 'usos': usos,
                    'total': sum(len(u['refs']) for u in usos),
                    'orfaos': sum(len(u['orfaos']) for u in usos)}
        try:
            apagados = _apaga_do_espelho(espelhos, {(a['simbolo'], a['altium']) for a in alvos})
        except (OSError, ValueError) as e:
            return _erro('não consegui apagar do espelho (%s)' % e, 500)
    avisos = _registra_apagados(apagados)
    avisos.append('se algum produto voltar ao Odoo, a próxima sincronização o traz de volta com o '
                  'mesmo número')
    return {'ok': True, 'apagados': len(apagados), 'ignorados': ignorados, 'avisos': avisos}


def _salva_footprint(caminho, nome, footprint):
    """Troca a linha do símbolo `nome` no schlib.js pondo UM footprint — ou nenhum.

    Mesma técnica cirúrgica do `_salva_espelho` acima (latin-1 nos dois sentidos, uma linha
    trocada e o `generated`), e pelo mesmo motivo: o arquivo tem 700 KB e reserializá-lo
    inteiro moveria bytes que ninguém pediu para mover.

    UM footprint, nunca dois. Regra do dono, 2026-09-17: todo componente da biblioteca tem
    exatamente um footprint vinculado. `footprint` vazio DESVINCULA (lista vazia), que é
    diferente de "não mexer" — quem não quer mexer não chama esta rota.

    Devolve (símbolo novo, erro). O `incurrentlib` diz se o nome existe na PcbLib espelhada:
    é o mesmo crosscheck que a vista Libs já mostra, e ele viaja com o vínculo para a tela
    poder marcar "ainda não desenhado" sem consultar a PcbLib de novo.
    """
    with open(caminho, 'rb') as f:
        linhas = f.read().decode('latin-1').splitlines(True)
    prefixo = '{"name":' + L._js(nome) + ','
    alvo = None
    for i, ln in enumerate(linhas):
        corpo = ln[1:] if ln.startswith(',') else ln
        if corpo.startswith(prefixo):
            alvo = i
            break
    if alvo is None:
        return None, 'símbolo "%s" não está em %s' % (nome, os.path.basename(caminho))
    ln = linhas[alvo]
    virgula = ln.startswith(',')
    fim = ln[len(ln.rstrip('\r\n')):]
    velho = json.loads(ln.rstrip('\r\n')[1 if virgula else 0:])
    fps = []
    if footprint:
        fps = [OrderedDict([('name', footprint),
                            ('incurrentlib', footprint in _nomes_pcblib()),
                            ('current', True)])]
    novo = OrderedDict([
        ('name', velho.get('name', nome)),
        ('description', velho.get('description', '')),
        ('partcount', velho.get('partcount', 1)),
        ('parts', velho.get('parts') or []),
        ('footprints', fps),
    ])
    linhas[alvo] = (',' if virgula else '') + L.simbolo_json(novo) + fim
    for i in range(min(alvo, 8)):
        if linhas[i].startswith('"generated":'):
            f2 = linhas[i][len(linhas[i].rstrip('\r\n')):]
            linhas[i] = '"generated":' + L._js(L.agora()) + ',' + f2
            break
    _grava_bytes(caminho, ''.join(linhas).encode('latin-1'))
    return novo, None


_pcblib_cache = {'mtime': 0, 'nomes': frozenset()}


def _nomes_pcblib():
    """Os nomes de footprint que a PcbLib espelhada tem. Em cache pelo mtime: o arquivo tem
    3,2 MB e esta rota pode ser chamada uma vez por vínculo."""
    p = os.path.join(ROOT, 'Libs', 'pcblib.js')
    try:
        st = os.stat(p)
    except OSError:
        return frozenset()
    if _pcblib_cache['mtime'] != st.st_mtime_ns:
        try:
            txt = io.open(p, encoding='utf-8', errors='replace').read()
        except OSError:
            return frozenset()
        # UM FOOTPRINT POR LINHA, e o nome dele é o PRIMEIRO `{"name":` da linha — os
        # outros são os PADS. Varrer o arquivo inteiro com um findall solto dava 5816
        # nomes em vez de 618: a galeria enchia de "+", "14L", "15U", que são nomes de pad,
        # e cada um virava um tile vazio. Mesma disciplina de leitura do resto do projeto.
        nomes = set()
        for ln in txt.splitlines():
            corpo = ln[1:] if ln.startswith(',') else ln
            m = re.match(r'\{\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"', corpo)
            if m:
                nomes.add(m.group(1))
        _pcblib_cache['nomes'] = frozenset(nomes)
        _pcblib_cache['mtime'] = st.st_mtime_ns
    return _pcblib_cache['nomes']


@bp.route('/footprints', methods=['GET'])
def api_footprints():
    """A lista de footprints para a aba Footprints escolher — nome e se está desenhado.

    Sai daqui, e não do `Libs/pcblib.js` cru pelo navegador, porque a tela precisa de duas
    coisas que o espelho não junta: quantos símbolos usam cada footprint hoje, e os nomes
    que alguém já vinculou mas que a PcbLib ainda não tem (cadastrados para desenhar depois).
    """
    reais = sorted(_nomes_pcblib())
    usos = {}
    try:
        caminho = os.path.join(ROOT, ESPELHO)
        txt = io.open(caminho, encoding='latin-1').read()
        # tolerante a espaco depois dos dois-pontos: o arquivo de verdade sai compacto do
        # `simbolo_json`, mas um espelho escrito por outra ferramenta (ou por um teste com
        # json.dumps cru) tem espacos, e uma contagem que zera em silencio nesse caso e pior
        # que um regex um pouco mais largo.
        for nome_sym, bloco in re.findall(
                r'\{\s*"name"\s*:\s*("(?:[^"\\]|\\.)*").*?"footprints"\s*:\s*(\[.*?\])', txt):
            for fp in re.findall(r'\{\s*"name"\s*:\s*"([^"]+)"', bloco):
                usos.setdefault(fp, 0)
                usos[fp] += 1
    except (OSError, ValueError):
        pass
    nomes = sorted(set(reais) | set(usos))
    return {'ok': True, 'total': len(nomes),
            'footprints': [{'name': n, 'desenhado': n in reais, 'usos': usos.get(n, 0)}
                           for n in nomes]}


@bp.route('/footprint', methods=['POST'])
def api_footprint():
    """Vincula UM footprint a um símbolo do espelho da casa (Libs/schlib.js).

    {simbolo, footprint} — `footprint` vazio desvincula. A regra de um-só é do servidor, e
    não da tela: qualquer caminho que chegue aqui sai com no máximo um.

    Só aceita nome que a PcbLib já tem: o footprint vem do Altium, e só de lá. Ver o
    comentário longo mais abaixo, junto da recusa.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {simbolo, footprint} obrigatório', 400)
    sim = data.get('simbolo')
    if not (isinstance(sim, str) and sim.strip()):
        return _erro('simbolo obrigatório', 400)
    fp = data.get('footprint')
    if fp is not None and not isinstance(fp, str):
        return _erro('footprint tem de ser texto (vazio desvincula)', 400)
    sim, fp = sim.strip(), (fp or '').strip()
    if isinstance(data.get('footprints'), list) and len(data['footprints']) > 1:
        return _erro('um componente tem exatamente um footprint: vieram %d'
                     % len(data['footprints']), 400)

    # O FOOTPRINT VEM DO ALTIUM, E SO DE LA. Essa e a unica excecao ao fluxo do projeto:
    # simbolo, valores, parametros e nomes nascem aqui e vao para o Altium; o footprint faz
    # o caminho inverso, e por isso o hub so pode ESCOLHER entre os que a .PcbLib ja tem
    # (espelhada em Libs/pcblib.js). Aceitar um nome que ela nao tem era fazer um footprint
    # nascer no hub -- e o componente iria para o Altium apontando para nada.
    # Vazio continua valendo: e desvincular, nao criar.
    if fp and fp not in _nomes_pcblib():
        return _erro('"%s" nao esta na biblioteca de footprints do Altium. O footprint vem '
                     'de la: desenhe na PcbLib e sincronize. (Vazio desvincula.)' % fp, 400)
    caminho = os.path.join(ROOT, ESPELHO)
    if not os.path.isfile(caminho):
        return _erro('%s não existe neste workspace' % ESPELHO, 404)
    with _lock_espelho:
        try:
            novo, erro = _salva_footprint(caminho, sim, fp)
        except (OSError, ValueError) as e:
            return _erro('não gravei o vínculo: %s' % e, 500)
    if erro:
        return _erro(erro, 404)
    return {'ok': True, 'simbolo': sim, 'footprint': fp,
            'desenhado': bool(fp) and fp in _nomes_pcblib(),
            'footprints': novo.get('footprints') or [],
            'avisos': []}


@bp.route('/almox-footprint', methods=['POST'])
def api_almox_footprint():
    """Vincula UM footprint a um COMPONENTE do almoxarifado (um `valores[].altium`).

    A categoria — "CAPACITOR CERAMICO [SMD]" — é o agrupador; quem recebe footprint é a
    peça, "SMD 1206 4.7pF 50V C0G". A rota irmã (/footprint) serve a biblioteca da CASA,
    onde o símbolo é o próprio componente e não há valores.

    DOIS DESTINOS, e nenhum é redundância:
      espelho  Libs/almox-*.js » valores[].footprint  → é o que a tela desenha agora. Mas é
                                                        saída gerada: o sync o reescreve;
      ledger   footprints[familia][componente]        → é o que faz a escolha SOBREVIVER ao
                                                        sync. Sem ele o gerador recalcula o
                                                        footprint dos encapsulamentos do
                                                        Odoo e a escolha some em silêncio —
                                                        exatamente o que `protegidos` já
                                                        resolve para o desenho.
    Escrever só no espelho seria pior que recusar: a tela diria "pronto" e a próxima
    sincronização desfaria, sem uma linha de aviso.

    A .SchLib não é tocada: ela é reescrita inteira a partir do espelho no próximo
    sincronismo, e é lá que o Altium passa a ver o footprint novo. A resposta diz isso.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {familia, componente, footprint} obrigatório', 400)
    fam, comp = data.get('familia'), data.get('componente')
    if not (isinstance(fam, str) and fam.strip()) or not (isinstance(comp, str) and comp.strip()):
        return _erro('familia e componente obrigatórios', 400)
    fp = data.get('footprint')
    if fp is not None and not isinstance(fp, str):
        return _erro('footprint tem de ser texto (vazio desvincula)', 400)
    fam, comp, fp = fam.strip(), comp.strip(), (fp or '').strip()


    # O FOOTPRINT VEM DO ALTIUM, E SO DE LA. Essa e a unica excecao ao fluxo do projeto:
    # simbolo, valores, parametros e nomes nascem aqui e vao para o Altium; o footprint faz
    # o caminho inverso, e por isso o hub so pode ESCOLHER entre os que a .PcbLib ja tem
    # (espelhada em Libs/pcblib.js). Aceitar um nome que ela nao tem era fazer um footprint
    # nascer no hub -- e o componente iria para o Altium apontando para nada.
    # Vazio continua valendo: e desvincular, nao criar.
    if fp and fp not in _nomes_pcblib():
        return _erro('"%s" nao esta na biblioteca de footprints do Altium. O footprint vem '
                     'de la: desenhe na PcbLib e sincronize. (Vazio desvincula.)' % fp, 400)
    try:
        espelhos, fam_arq, sim_nome, k, i, j = _resolve_almox(fam, comp)
    except _ErroAlmox as e:
        return _erro(str(e), e.status)
    cam_esp, _var, _esp = espelhos[k]

    avisos = []
    # 1. o espelho, relido dentro do lock (mesma disciplina do /almox-excluir)
    with _lock_almox:
        try:
            var2, esp2 = G.le_espelho_almox(cam_esp)
            i2, j2 = _acha_no_espelho(esp2, sim_nome, comp)
            if i2 is None:
                return _erro('"%s" não está mais no espelho' % comp, 404)
            if fp:
                esp2['symbols'][i2]['valores'][j2]['footprint'] = fp
            else:
                esp2['symbols'][i2]['valores'][j2]['footprint'] = ''
            # a escolha é da PEÇA: o id do produto vai junto, e é por ele que o gerador a acha
            # quando o nome muda no Odoo (guardiao » footprints_manuais_por_odoo)
            oids = G.ids_odoo_do_valor(esp2['symbols'][i2]['valores'][j2]) or None
            G.grava_espelho_almox(cam_esp, var2, esp2)
        except (OSError, ValueError) as e:
            return _erro('não gravei no espelho (%s): nada foi alterado' % e, 500)

    # 2. o ledger — o passo que faz durar
    try:
        with G._lock:
            led = G.carrega_ledger(ROOT)
            G.poe_footprint(led, fam_arq, comp, fp, odoo=oids)
            G.grava_ledger(ROOT, led)
    except Exception as e:                                          # noqa: BLE001
        avisos.append('a escolha está no espelho mas NÃO no ledger (%s): a próxima '
                      'sincronização vai desfazê-la' % e)

    avisos.append('o Altium só vê o footprint novo no próximo sincronismo do almoxarifado '
                  '(as .SchLib são reescritas inteiras a partir do espelho)')
    return {'ok': True, 'familia': fam_arq, 'simbolo': sim_nome, 'componente': comp,
            'footprint': fp, 'desenhado': bool(fp) and fp in _nomes_pcblib(),
            'avisos': avisos}


@bp.route('/lib', methods=['POST'])
def api_lib():
    """(a trava da extração em volta do _lib — ver _toma)"""
    if not _toma(_extract_lock, _extract_runs):
        return _erro(EXTRACAO_OCUPADA, 409)
    try:
        return _lib()
    finally:
        _extract_lock.release()


def _lib():
    """Biblioteca de símbolos: add / update / rename / delete, sempre regravando o arquivo
    inteiro (o formato é o do extrair.escreve_symlib — um símbolo por linha, atômico).

      add     {symbol: {name, kind?, desc?, pins, graphics}}   símbolo novo (o "+ Novo
              símbolo" do editor e o "+ corpo atual")
      update  {id, pins, graphics, name?, kind?, desc?}         o desenho EDITADO de um
              símbolo que já existe. A geometria velha vai para `excluidos`: sem isso a
              próxima extração a acharia num .SchDoc antigo e a devolveria como símbolo novo.
              A resposta traz `vinculados`/`padroes` — quem usa o símbolo (ledger) — para o
              editor oferecer levar o desenho novo a eles (/almox-aplicar)
      rename  {id, name}
      delete  {id}      o símbolo sai, o fingerprint vai para `excluidos` (a extração não o
              traz de volta) e os componentes que o usavam ficam com o desenho — é cópia —,
              só perdem o vínculo no ledger

    Símbolo não é componente: nada aqui mexe no almoxarifado nem na .SchLib."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('op') not in ('add', 'update', 'rename', 'delete'):
        return _erro('JSON {op: add|update|rename|delete, ...} obrigatório', 400)
    op = data['op']
    esquecer = None
    with _lock_symlib:
        caminho = os.path.join(ROOT, SYMLIB)
        lib = E.le_symlib(caminho)
        if lib is None and os.path.isfile(caminho):
            # arquivo que existe e não parseou: seguir com a lib vazia GRAVARIA POR CIMA de tudo
            return _erro('não consegui ler %s — nada foi gravado' % SYMLIB, 500)
        lib = lib or E._lib_vazia()
        syms = lib['symbols']
        nomes = {s.get('name') for s in syms}
        # id nunca volta a ser usado, nem o de um símbolo excluído: o ledger pode lembrar dele
        maior = max([E._num_id(e) for e in syms] + [E._num_id(e) for e in E.excluidos_de(lib)] + [0])

        def desc_de(s):
            d = s.get('desc', s.get('description'))
            return d.strip() if isinstance(d, str) else None

        def geometria(s, kind_padrao=None):
            """{pins, graphics, kind, fp} normalizados, ou a resposta de erro (que é uma TUPLA
            (corpo, status) — por isso o sucesso é um dict)"""
            erro = _valida_parts([{'pins': s.get('pins'), 'graphics': s.get('graphics')}])
            if erro:
                return _erro(erro, 400)
            if not s['pins'] and not s['graphics']:
                return _erro('o símbolo está vazio: desenhe alguma coisa antes de salvar', 400)
            kind = s.get('kind') or kind_padrao or ('generico' if len(s['pins']) <= 4 else 'ci')
            if kind not in KINDS:
                return _erro('kind tem que ser generico ou ci', 400)
            pins, graphics = E.normaliza(s['pins'], s['graphics'])
            return {'pins': pins, 'graphics': graphics, 'kind': kind, 'fp': E.fingerprint(pins, graphics, kind)}

        if op == 'add':
            s = data.get('symbol')
            if not isinstance(s, dict):
                return _erro('symbol {name, kind, pins, graphics} obrigatório', 400)
            nome = s.get('name')
            if not isinstance(nome, str) or not nome.strip():
                return _erro('name obrigatório', 400)
            nome = nome.strip()
            g = geometria(s)
            if not isinstance(g, dict):
                return g
            pins, graphics, kind, fp = g['pins'], g['graphics'], g['kind'], g['fp']
            for e in syms:
                if e.get('fp') == fp:
                    return _erro('essa geometria já está na biblioteca como "%s"' % e.get('name'),
                                 409, symbol=e)
            if nome in nomes:
                return _erro('já existe um símbolo chamado "%s"' % nome, 409)
            alvo = OrderedDict([
                ('id', 's%04d' % (maior + 1)),
                ('name', nome), ('kind', kind), ('fp', fp), ('aliases', []),
                ('fontes', ['hub']), ('usos', 1), ('desde', date.today().isoformat()), ('pins', pins),
                ('graphics', graphics)])
            if desc_de(s):
                alvo['desc'] = desc_de(s)
            syms.append(alvo)
            E.reabilita_fp(lib, fp)          # desenhou de novo, à mão, uma forma excluída
        else:
            sid = data.get('id')
            alvo = next((e for e in syms if e.get('id') == sid), None)
            if alvo is None:
                return _erro('símbolo %s não está na biblioteca' % sid, 404)
            renomeia = op == 'rename' or (op == 'update' and 'name' in data)
            if renomeia:
                nome = data.get('name')
                if not isinstance(nome, str) or not nome.strip():
                    return _erro('name obrigatório', 400)
                nome = nome.strip()
                if nome != alvo.get('name') and nome in nomes:
                    return _erro('já existe um símbolo chamado "%s"' % nome, 409)
            if op == 'update':
                g = geometria(data, alvo.get('kind'))
                if not isinstance(g, dict):
                    return g
                pins, graphics, kind, fp = g['pins'], g['graphics'], g['kind'], g['fp']
                outro = next((e for e in syms if e is not alvo and e.get('fp') == fp), None)
                if outro is not None:
                    return _erro('essa geometria já está na biblioteca como "%s"' % outro.get('name'),
                                 409, symbol=outro)
                if fp != alvo.get('fp'):
                    E.exclui_fp(lib, alvo.get('fp'), alvo.get('name'), 'editado', alvo.get('id'))
                    E.reabilita_fp(lib, fp)
                alvo['pins'], alvo['graphics'], alvo['kind'], alvo['fp'] = pins, graphics, kind, fp
                if desc_de(data) is not None:
                    alvo['desc'] = desc_de(data)
                # desenhado no hub: nenhuma varredura "cobre" esta fonte, então a extração não
                # redecide a descrição nem o olho dos pinos por cima da edição (extrair._cobre)
                if 'hub' not in (alvo.get('fontes') or []):
                    alvo['fontes'] = list(alvo.get('fontes') or []) + ['hub']
            if renomeia:
                alvo['name'] = nome
            if op == 'delete':
                syms.remove(alvo)
                E.exclui_fp(lib, alvo.get('fp'), alvo.get('name'), 'excluido', alvo.get('id'))
                esquecer = alvo.get('id')

        lib['generated'] = datetime.now().strftime('%Y-%m-%d %H:%M')
        try:
            E.escreve_symlib(lib, caminho)
        except OSError as e:
            return _erro('falha ao gravar a biblioteca: %s' % e, 500)
    resp = {'ok': True, 'symbol': alvo, 'total': len(syms)}
    # quem usa este símbolo — fora do lock da biblioteca: o ledger tem o dele
    try:
        if esquecer:
            with G._lock:
                led = G.carrega_ledger(ROOT)
                resp['desvinculados'] = G.esquece_lib(led, esquecer)
                if resp['desvinculados']:
                    G.grava_ledger(ROOT, led)
        elif op == 'update':
            resp.update(_quem_ficou_para_tras(alvo))
    except (OSError, ValueError) as e:
        resp['avisos'] = ['não li o ledger: %s' % e]
    return resp


@bp.route('/extract', methods=['POST'])
def api_extract():
    """Reserva a corrida; quem executa é o stream (padrão do /api/almox/sync). A reserva
    vale 60 s: dois cliques seguidos dão 409 mesmo antes de o stream abrir, e uma reserva
    de um browser que fechou não prende a extração para sempre."""
    if not os.path.isfile(EXTRAIR):
        return _erro('tools/symbols/extrair.py não está neste workspace', 404)
    data = request.get_json(silent=True) or {}
    args = []
    if data.get('so') in ('schlib', 'schdoc', 'intlib'):
        args += ['--so', data['so']]
    if isinstance(data.get('limite'), int) and not isinstance(data.get('limite'), bool) and data['limite'] > 0:
        args += ['--limite', str(data['limite'])]
    fontes = data.get('fonte')
    if isinstance(fontes, list) and fontes and all(isinstance(f, str) and f for f in fontes):
        args += ['--fonte'] + fontes
    with _reserva_lock:
        agora = time.time()
        for k in [k for k, (ts, _a) in _extract_runs.items() if agora - ts > RESERVA_TTL]:
            del _extract_runs[k]
        if _extract_lock.locked() or _extract_runs:
            return _erro('já tem uma extração rodando', 409)
        run_id = 'x_%04x' % (int(agora * 1000) & 0xffff)
        _extract_runs[run_id] = (agora, args)
    return {'runId': run_id}, 202


@bp.route('/extract/<run_id>/stream')
def api_extract_stream(run_id):
    with _reserva_lock:
        if run_id not in _extract_runs:
            abort(404)
        _ts, args = _extract_runs.pop(run_id)
    root = ROOT

    def stream():
        if not _extract_lock.acquire(blocking=False):
            yield 'event: error\ndata: %s\n\n' % json.dumps('já tem uma extração rodando')
            return
        proc = None
        try:
            cmd = [sys.executable, EXTRAIR, '--config', os.path.join(root, CONFIG),
                   '--saida', os.path.join(root, SYMLIB), '--relatorio', os.path.join(root, RELATORIO)] + args
            yield 'data: varrendo as fontes…\n\n'
            env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
            proc = subprocess.Popen(cmd, cwd=root, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT)
            limite = time.time() + EXTRACT_TIMEOUT
            for raw in iter(proc.stdout.readline, b''):
                linha = raw.decode('utf-8', 'replace').rstrip()
                if linha:
                    yield 'data: %s\n\n' % linha.replace('\r', '')
                if time.time() > limite:
                    proc.kill()
                    yield 'event: error\ndata: %s\n\n' % json.dumps(
                        'passou de %d s e foi interrompida' % int(EXTRACT_TIMEOUT))
                    return
            code = proc.wait()
            if code != 0:
                yield 'event: error\ndata: %s\n\n' % json.dumps(
                    'a extração terminou com código %d — veja o log acima' % code)
                return
            yield 'event: done\ndata: {"ok":true}\n\n'
        except Exception as e:                                  # noqa: BLE001
            yield 'event: error\ndata: %s\n\n' % json.dumps(str(e))
        finally:
            if proc is not None and proc.poll() is None:
                proc.kill()
            _extract_lock.release()

    return Response(stream(), mimetype='text/event-stream')


@bp.route('/mirror', methods=['POST'])
def api_mirror():
    """`{}` regera Libs/schlib.js (e o libs-report.txt ao lado) a partir da SchLib real, com
    o Libs/rename-map.js aplicado (`{rename:false}` desliga) — o --espelho do sch_leitor,
    síncrono (~2 s). Regerar NÃO é só ganhar os flags: o leitor converte o que o ExportLibs
    ignorava (RECORD 5/10/11) e lê o IsSolid real do polígono, então dezenas de linhas
    mudam de geometria — a resposta diz quantos nomes o mapa trocou.

    `{flags:true}` faz só o passo dos flags: leva hideNum/hideName da SchLib para o espelho
    que já existe, linha a linha, e nada mais muda (nem nomes, nem geometria, nem o
    `generated`)."""
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    cfg = _config()
    schlib = cfg['schlib']
    if not os.path.isfile(schlib):
        return _erro('SchLib não encontrada: %s' % schlib, 404)
    # Regerar o espelho a partir da cópia publicada APAGA tudo que foi salvo por aqui: no
    # servidor o `Libs/schlib.js` é o arquivo compartilhado onde vivem os saves feitos no
    # hub (o passo do Altium não roda lá), e o mirror o reescreve inteiro, sem diff. Antes
    # da lib viajar isso era impossível — a rota morria em 404. Agora tem que ser pedido.
    if _so_leitura(schlib) and not data.get('confirmar'):
        efeito = ('Levar os flags dela para o espelho traz o que a última publicação tinha, '
                  'que pode estar atrás do que foi salvo aqui'
                  if data.get('flags') else
                  'Regerar o espelho a partir dela sobrescreve o Libs/schlib.js inteiro')
        return _erro((SO_LEITURA % os.path.relpath(schlib, ROOT).replace('\\', '/'))
                     + ' ' + efeito + '; se é isso mesmo, repita com {"confirmar":true}.',
                     409, soLeitura=True)
    mapa = L.le_rename_map(os.path.join(ROOT, RENAME_MAP))
    caminho = os.path.join(ROOT, ESPELHO)
    with _lock_espelho:
        try:
            if data.get('flags'):
                if not os.path.isfile(caminho):
                    return _erro('Libs/schlib.js não existe neste workspace', 404)
                with open(caminho, 'rb') as f:
                    texto = f.read().decode('latin-1')      # ASCII: nenhum byte muda fora dos flags
                with _lock_schlib:                          # não ler no meio de um patch
                    dados = L.le_schlib(schlib, com_footprints=False)
                novo, r = L.aplica_flags(texto, dados['symbols'], mapa)
                if novo != texto:
                    _grava_bytes(caminho, novo.encode('latin-1'))
                G.registra_arquivo(ROOT, schlib)
                return {'ok': True, 'flags': True, 'symbols': r['simbolos'], 'mudaram': r['mudaram'],
                        'comFlag': r['com_flag'], 'semPar': r['sem_par'], 'pinosSemPar': r['pinos_sem_par'],
                        'avisos': r['avisos'] + (dados.get('avisos') or []), 'source': schlib}
            nomes = L.nomes_pcblib(os.path.join(ROOT, 'Libs', 'pcblib.js'))
            with _lock_schlib:
                dados = L.le_schlib(schlib, pcblib_names=nomes)
            ren = {'renomeados': 0, 'fundidos': 0, 'footprints': 0}
            if data.get('rename', True):
                ren = L.aplica_rename(dados, mapa)
            _grava_bytes(caminho, L.espelho(dados, nomes).encode('utf-8'))
            _grava_bytes(os.path.join(ROOT, 'Libs', 'libs-report.txt'),
                         L.relatorio(dados, nomes).encode('utf-8'))
            G.registra_arquivo(ROOT, schlib)
        except OSError as e:
            return _erro('falha ao gravar o espelho: %s' % e, 500)
        except Exception as e:                                  # noqa: BLE001
            return _erro('falha ao ler a SchLib: %s' % e, 500)
    syms = dados['symbols']
    return {'ok': True, 'symbols': len(syms),
            'nofootprint': sum(1 for s in syms if L._sem_footprint(s)),
            'avisos': dados.get('avisos') or [], 'source': schlib, 'rename': ren}


# ─── sincronização do almoxarifado pelo guardião ──────────────────────────────
def _senha_odoo():
    try:
        with open(os.path.join(ROOT, ALMOX_CFG), encoding='utf-8') as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    return bool((isinstance(cfg, dict) and cfg.get('senha')) or os.environ.get('ODOO_SENHA'))


@bp.route('/almox-sync', methods=['POST'])
def api_almox_sync():
    """Reserva a corrida; quem executa é o stream (o padrão do /api/almox/sync do hubserver,
    que este endpoint substitui no diálogo do hub). `{pull:true}` puxa o Odoo antes."""
    if not os.path.isfile(GUARDIAO):
        return _erro('tools/symbols/guardiao.py não está neste workspace', 404)
    data = request.get_json(silent=True) or {}
    pull = bool(data.get('pull'))
    if pull and not _senha_odoo():
        return _erro('sem senha do Odoo gravada — configure antes de puxar ao vivo, '
                     'ou sincronize a partir do snapshot', 400)
    with _reserva_lock:
        agora = time.time()
        for k in [k for k, (ts, _p) in _sync_runs.items() if agora - ts > RESERVA_TTL]:
            del _sync_runs[k]
        if _sync_lock.locked() or _sync_runs:
            return _erro('já tem uma sincronização rodando', 409)
        run_id = 'g_%04x' % (int(agora * 1000) & 0xffff)
        _sync_runs[run_id] = (agora, pull)
    return {'runId': run_id}, 202


@bp.route('/almox-sync/<run_id>/stream')
def api_almox_sync_stream(run_id):
    with _reserva_lock:
        if run_id not in _sync_runs:
            abort(404)
        _ts, pull = _sync_runs.pop(run_id)
    root = ROOT

    def stream():
        if not _sync_lock.acquire(blocking=False):
            yield 'event: error\ndata: %s\n\n' % json.dumps('já tem uma sincronização rodando')
            return
        proc = None
        try:
            cmd = [sys.executable, GUARDIAO, '--raiz', root] + (['--pull'] if pull else []) + list(GUARDIAO_EXTRA)
            yield 'data: %s\n\n' % ('puxando o Odoo e regerando, com o guardião…' if pull
                                    else 'regerando do snapshot em disco, com o guardião…')
            env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
            proc = subprocess.Popen(cmd, cwd=root, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT)
            limite = time.time() + SYNC_TIMEOUT
            for raw in iter(proc.stdout.readline, b''):
                linha = raw.decode('utf-8', 'replace').rstrip()
                if linha:
                    yield 'data: %s\n\n' % linha.replace('\r', '')
                if time.time() > limite:
                    proc.kill()
                    yield 'event: error\ndata: %s\n\n' % json.dumps(
                        'passou de %d s e foi interrompida' % int(SYNC_TIMEOUT))
                    return
            code = proc.wait()
            resumo = G.le_resumo(root)
            if code != 0:
                yield 'event: error\ndata: %s\n\n' % json.dumps(
                    (resumo or {}).get('erro') or 'o guardião terminou com código %d — veja o log acima' % code)
                return
            yield 'event: done\ndata: %s\n\n' % json.dumps({'ok': True, 'resumo': resumo}, ensure_ascii=False)
        except Exception as e:                                  # noqa: BLE001
            yield 'event: error\ndata: %s\n\n' % json.dumps(str(e))
        finally:
            if proc is not None and proc.poll() is None:
                proc.kill()
            _sync_lock.release()

    return Response(stream(), mimetype='text/event-stream')
