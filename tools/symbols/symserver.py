# -*- coding: utf-8 -*-
"""Blueprint Flask da sub-aba Símbolos: por aqui o hub fala com a SchLib real.

    GET  /api/symbols/config                 onde está a SchLib, se existe, backups, fontes
    POST /api/symbols/save                   grava um símbolo no espelho (Libs/schlib.js) e na SchLib
    POST /api/symbols/lib                    add/rename/delete na Biblioteca de símbolos (Libs/symbols-lib.js)
    POST /api/symbols/extract                reserva uma extração; GET …/<runId>/stream roda e retransmite (SSE)
    POST /api/symbols/mirror                 regera o espelho inteiro a partir da SchLib real; {flags:true} só leva os flags
    GET  /api/symbols/altium-changes[?deep=1] o que mudou nas .SchLib do Altium desde o ledger (e os itens, com deep)
    POST /api/symbols/altium-apply           RECUSA (409): o desenho é do hub; adotar o do Altium é comando manual
    POST /api/symbols/almox-sync             reserva a sincronização do almoxarifado pelo guardião; GET …/<runId>/stream roda (SSE)

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
                           — senão o próprio hub apareceria em /altium-changes como "mudou no Altium".

`registra(app, root)` é o único ponto de contato com o hubserver: guarda ROOT e registra o
blueprint. ROOT é lido em tempo de chamada — os testes trocam.
"""
import json
import math
import os
import re
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

bp = Blueprint('symbols', __name__, url_prefix='/api/symbols')
ROOT = RAIZ                          # o workspace servido; registra() troca

ESPELHO = os.path.join('Libs', 'schlib.js')
SYMLIB = os.path.join('Libs', 'symbols-lib.js')
CONFIG = os.path.join('tools', 'symbols', 'config.json')
RENAME_MAP = os.path.join('Libs', 'rename-map.js')
RELATORIO = os.path.join('tools', 'symbols', 'relatorio.txt')
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
    os.replace(tmp, caminho)


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


@bp.route('/save-almox', methods=['POST'])
def api_save_almox():
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
        espelhos = G.carrega_espelhos_almox(ROOT)
    except (OSError, ValueError) as e:
        return _erro('não li os espelhos do almoxarifado: %s' % e, 500)
    if not espelhos:
        return _erro('nenhum espelho do almoxarifado em Libs/ (rode o sincronismo)', 404)
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
        return _erro('"%s / %s" não está no espelho do almoxarifado (a família pode ser a do '
                     'arquivo, "ESPECIAIS", ou o nome do símbolo)' % (fam, comp), 404)
    sim_nome, k, i = achado
    cam_esp, var, esp = espelhos[k]
    j = _acha_valor(esp, i, comp)
    if j is None:
        return _erro('"%s" não é um valor de "%s"' % (comp, sim_nome), 404)
    cam, _hoje = G._acha_componente(ROOT, fam, comp, {})
    # Componente que está no espelho mas ainda não na .SchLib: entrou no Odoo depois do último
    # sincronismo (o espelho é regerado do snapshot; o arquivo, só pelo sincronismo inteiro).
    # Recusar aqui deixava o usuário sem caminho: o desenho vai para o espelho e para o ledger
    # (protegido, origem hub), e o guardião o repõe na .SchLib assim que o gerador criar o
    # componente — é o mesmo mecanismo que faz qualquer desenho sobreviver ao sincronismo.
    sem_arquivo = cam is None

    # 2. espelho primeiro: se a SchLib falhar, o hub já mostra o desenho novo
    with _lock_almox:
        try:
            esp['symbols'][i]['valores'][j]['parts'] = partes
            G.grava_espelho_almox(cam_esp, var, esp)
        except OSError as e:
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
            G._poe_prot(led, fam, comp, partes, 'hub', sim_nome)
            if altium and not sem_arquivo:
                G.registra_arquivo(ROOT, cam, led, gravar=False)   # senão o próprio save
                                                                   # aparece como "mudou no Altium"
            G.grava_ledger(ROOT, led)
        resp['protegido'] = True
    except Exception as e:                                          # noqa: BLE001
        resp['avisos'] = list(resp['avisos']) + [
            'não protegi no ledger (%s): o próximo sincronismo pode repor o símbolo padrão' % e]
    return resp


@bp.route('/lib', methods=['POST'])
def api_lib():
    """Biblioteca de símbolos: add / rename / delete, sempre regravando o arquivo inteiro
    (é pequeno e o formato é o do extrair.escreve_symlib — um símbolo por linha, atômico)."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('op') not in ('add', 'rename', 'delete'):
        return _erro('JSON {op: add|rename|delete, ...} obrigatório', 400)
    op = data['op']
    with _lock_symlib:
        caminho = os.path.join(ROOT, SYMLIB)
        lib = E.le_symlib(caminho) or E._lib_vazia()
        syms = lib['symbols']
        nomes = {s.get('name') for s in syms}

        if op == 'add':
            s = data.get('symbol')
            if not isinstance(s, dict):
                return _erro('symbol {name, kind, pins, graphics} obrigatório', 400)
            nome = s.get('name')
            if not isinstance(nome, str) or not nome.strip():
                return _erro('name obrigatório', 400)
            nome = nome.strip()
            erro = _valida_parts([{'pins': s.get('pins'), 'graphics': s.get('graphics')}])
            if erro:
                return _erro(erro, 400)
            kind = s.get('kind') or ('generico' if len(s['pins']) <= 4 else 'ci')
            if kind not in KINDS:
                return _erro('kind tem que ser generico ou ci', 400)
            pins, graphics = E.normaliza(s['pins'], s['graphics'])
            fp = E.fingerprint(pins, graphics, kind)
            for e in syms:
                if e.get('fp') == fp:
                    return _erro('essa geometria já está na biblioteca como "%s"' % e.get('name'),
                                 409, symbol=e)
            if nome in nomes:
                return _erro('já existe um símbolo chamado "%s"' % nome, 409)
            alvo = OrderedDict([
                ('id', 's%04d' % (max([E._num_id(e) for e in syms] or [0]) + 1)),
                ('name', nome), ('kind', kind), ('fp', fp), ('aliases', []), ('fontes', ['hub']),
                ('usos', 1), ('desde', date.today().isoformat()), ('pins', pins), ('graphics', graphics)])
            syms.append(alvo)
        else:
            sid = data.get('id')
            alvo = next((e for e in syms if e.get('id') == sid), None)
            if alvo is None:
                return _erro('símbolo %s não está na biblioteca' % sid, 404)
            if op == 'rename':
                nome = data.get('name')
                if not isinstance(nome, str) or not nome.strip():
                    return _erro('name obrigatório', 400)
                nome = nome.strip()
                if nome != alvo.get('name') and nome in nomes:
                    return _erro('já existe um símbolo chamado "%s"' % nome, 409)
                alvo['name'] = nome
            else:
                syms.remove(alvo)

        lib['generated'] = datetime.now().strftime('%Y-%m-%d %H:%M')
        try:
            E.escreve_symlib(lib, caminho)
        except OSError as e:
            return _erro('falha ao gravar a biblioteca: %s' % e, 500)
    return {'ok': True, 'symbol': alvo, 'total': len(syms)}


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


# ─── o Altium mudou? ──────────────────────────────────────────────────────────
@bp.route('/altium-changes', methods=['GET'])
def api_altium_changes():
    """Sem `deep`: só mtime/size das .SchLib (a da casa e as de Libs/Almox) contra o ledger —
    barato, é o que a aba Biblioteca pergunta ao abrir. Com `deep=1`: lê os arquivos que
    mudaram e lista os itens (símbolo da casa com o que mudou; componente do almoxarifado
    com geometria fora do gerador). Arquivo nunca visto é adotado como está; arquivo que
    mudou sem diferença nenhuma é absorvido no deep — o aviso some sozinho."""
    deep = (request.args.get('deep') or '').lower() in ('1', 'true', 'sim')
    try:
        with _lock_espelho, _lock_schlib:
            r = G.detecta(ROOT, deep=deep)
    except Exception as e:                                      # noqa: BLE001
        return _erro('falha ao apurar as mudanças: %s' % e, 500)
    r['ok'] = True
    return r


def _valida_itens(itens):
    if not isinstance(itens, list) or not itens:
        return 'itens tem que ser uma lista com ao menos um item'
    for i, it in enumerate(itens):
        onde = 'item %d' % (i + 1)
        if not isinstance(it, dict) or it.get('acervo') not in ('altium', 'almox'):
            return onde + ': acervo tem que ser altium ou almox'
        if it['acervo'] == 'altium' and not (isinstance(it.get('name'), str) and it['name'].strip()):
            return onde + ': símbolo da casa precisa de name'
        if it['acervo'] == 'almox' and not all(isinstance(it.get(k), str) and it[k].strip()
                                               for k in ('familia', 'componente')):
            return onde + ': componente do almoxarifado precisa de familia e componente'
    return None


RECUSA_APPLY = (
    'o desenho é da biblioteca do hub: mudança feita direto no Altium não entra por aqui. '
    'Esta rota aplicava, e era por ela que a .SchLib mandava no espelho; desde 2026-09-14 a '
    'autoridade é do hub e o que vem do Altium é AVISO (GET /api/symbols/altium-changes). '
    'Para adotar um desenho do Altium, é comando manual na raiz do workspace: '
    'python tools/symbols/guardiao.py --proteger "FAMILIA/COMPONENTE" '
    '(ou --liberar, para devolver o símbolo ao gerador).'
)


@bp.route('/altium-apply', methods=['POST'])
def api_altium_apply():
    """RECUSA, sempre — 409 com o motivo e o comando que faz o que se queria.

    A rota FICA de pé em vez de sair por três razões, nesta ordem de importância:
      - 404/405 não explica nada. Um hub de uma aba que ficou aberta desde antes da
        inversão apertaria o botão e veria "HTTP 404"; assim ele vê a regra e o comando.
      - remover a rota é a mesma armadilha do fallback do /api/almox/sync: quem chamasse
        cairia num caminho genérico, e a perda de garantia não teria nome.
      - o dia em que houver um "adotar" com dono e confirmação, o lugar dele é aqui.

    O corpo continua sendo validado antes da recusa: pedido malformado é 400, e um cliente
    que mande lixo descobre isso mesmo agora que a rota não faz nada."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _erro('JSON {itens:[…]} obrigatório', 400)
    erro = _valida_itens(data.get('itens'))
    if erro:
        return _erro(erro, 400)
    return _erro(RECUSA_APPLY, 409)


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
