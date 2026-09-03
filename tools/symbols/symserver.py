# -*- coding: utf-8 -*-
"""Blueprint Flask da sub-aba Símbolos: por aqui o hub fala com a SchLib real.

    GET  /api/symbols/config                 onde está a SchLib, se existe, backups, fontes
    POST /api/symbols/save                   grava um símbolo no espelho (Libs/schlib.js) e na SchLib
    POST /api/symbols/lib                    add/rename/delete na Biblioteca de símbolos (Libs/symbols-lib.js)
    POST /api/symbols/extract                reserva uma extração; GET …/<runId>/stream roda e retransmite (SSE)
    POST /api/symbols/mirror                 regera o espelho inteiro a partir da SchLib real

O trabalho pesado mora nos irmãos: `sch_leitor` lê, `schlib_patch` grava, `extrair` varre.
Aqui só o HTTP e três decisões de arquivo:

  espelho linha a linha    o Libs/schlib.js tem 685 KB, um símbolo por linha. O save troca SÓ a
                           linha do símbolo (e a do `generated`) em vez de reserializar tudo — o
                           diff mostra o que mudou e nenhum outro byte se move.
  espelho antes do Altium  grava-se o espelho primeiro e a SchLib depois. Se a SchLib falha (lib
                           aberta no Altium → 423), o hub já mostra o novo e a resposta traz
                           `espelho:true, altium:false`: o usuário sabe que o Altium ficou atrás.
                           Por isso o pedido é validado por inteiro ANTES de encostar no espelho,
                           e os pinos vão para o espelho já arredondados a 10 mil — é o que o
                           registro binário da SchLib comporta; espelho e Altium não divergem.
  nome antigo              o espelho saiu do RenameLibs e a SchLib real ainda tem os nomes de
                           antes. Quando o nome novo não está na SchLib, o save tenta o antigo
                           pelo Libs/rename-map.js (symRename ao contrário).

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
sys.path.insert(0, BASE)

import sch_leitor as L                                 # noqa: E402
import schlib_patch as P                               # noqa: E402
import extrair as E                                    # noqa: E402

bp = Blueprint('symbols', __name__, url_prefix='/api/symbols')
ROOT = RAIZ                          # o workspace servido; registra() troca

ESPELHO = os.path.join('Libs', 'schlib.js')
SYMLIB = os.path.join('Libs', 'symbols-lib.js')
CONFIG = os.path.join('tools', 'symbols', 'config.json')
RENAME_MAP = os.path.join('Libs', 'rename-map.js')
RELATORIO = os.path.join('tools', 'symbols', 'relatorio.txt')
EXTRAIR = os.path.join(BASE, 'extrair.py')   # código, não dado: roda de onde o módulo mora
EXTRACT_TIMEOUT = 3600.0             # a varredura do Y: inteiro leva minutos, não horas
RESERVA_TTL = 60.0                   # reserva sem stream aberto expira sozinha
FORMAS = ('line', 'rect', 'arc', 'ellipse', 'poly', 'polyline', 'label')
KINDS = ('generico', 'ci')
LOCAL_ADDRS = ('127.0.0.1', '::1', 'localhost')

_lock_espelho = threading.Lock()     # save e mirror escrevem o mesmo arquivo
_lock_schlib = threading.Lock()      # o patch reescreve a SchLib inteira: dois saves ao mesmo tempo perderiam um
_lock_symlib = threading.Lock()
_extract_lock = threading.Lock()     # segurado enquanto o subprocesso roda
_reserva_lock = threading.Lock()
_extract_runs = {}                   # runId -> (quando, args extras)


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


def _valida_grafico(g):
    """mensagem de erro ou None: forma conhecida, coordenadas numéricas, pts como pares.
    Polígono aceita 2 pontos porque o espelho real tem um assim — recusar travaria o save."""
    if not isinstance(g, dict) or g.get('g') not in FORMAS:
        return 'gráfico desconhecido (%s)' % (g.get('g') if isinstance(g, dict) else g)
    k = g['g']
    for c in CAMPOS[k]:
        if not _num(g.get(c)):
            return '%s sem %s numérico' % (k, c)
    for c in OPCIONAIS:
        if g.get(c) is not None and not _num(g[c]):
            return '%s com %s que não é número' % (k, c)
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
    cfg['schlib'] = cfg.get('schlib') or L.LIB_PADRAO
    cfg['backup_dir'] = cfg.get('backup_dir') or os.path.join(os.path.dirname(cfg['schlib']), 'Backup-hub')
    return cfg


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
        for j, g in enumerate(p['graphics']):
            erro = _valida_grafico(g)
            if erro:
                return '%s, gráfico %d: %s' % (onde, j + 1, erro)
    return None


def _partes(parts):
    """-> (partes, avisos): só part/pins/graphics, numeradas, com x/y/len dos pinos em
    múltiplos de 10 mil — o pino binário da SchLib não guarda mais fino que isso, e o
    espelho tem que dizer o mesmo que o Altium. O aviso é por pino que mudou."""
    fora, avisos = [], []
    for i, p in enumerate(parts):
        pins = []
        for q in p['pins']:
            q = OrderedDict(q)
            for k in ('x', 'y', 'len'):
                v = P._mil10(q[k])
                if abs(v - q[k]) > 1e-6:
                    avisos.append('pino %s: %s=%s arredondado para %d mil' % (q.get('num'), k, q[k], v))
                q[k] = v
            pins.append(q)
        fora.append(OrderedDict([('part', int(p.get('part') or i + 1)), ('pins', pins),
                                 ('graphics', p['graphics'])]))
    return fora, avisos


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


def _patch_altium(cfg, sym):
    """schlib_patch.patch na SchLib do config; nome novo ausente -> tenta o antigo do rename-map"""
    schlib = cfg['schlib']
    if not os.path.isfile(schlib):
        raise FileNotFoundError('SchLib não encontrada: %s' % schlib)
    try:
        return P.patch(schlib, sym, cfg['backup_dir'])
    except ValueError:
        antigo = _nome_antigo(sym['name'])
        if not antigo:
            raise
        r = P.patch(schlib, dict(sym, name=antigo), cfg['backup_dir'])
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
    partes, avisos = _partes(parts)

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

    resp = {'ok': True, 'espelho': True, 'altium': False, 'backup': None, 'avisos': avisos}
    if not altium:
        return resp
    alvo = {'name': nome, 'parts': sym['parts']}
    if desc is not None:
        alvo['description'] = desc
    try:
        with _lock_schlib:
            r = _patch_altium(_config(), alvo)
    except P.LibOcupada as e:
        return _erro(str(e), 423, espelho=True, altium=False, backup=None, avisos=avisos)
    except Exception as e:                                          # noqa: BLE001
        return _erro('espelho gravado, mas a SchLib não: %s' % e, 500,
                     espelho=True, altium=False, backup=None, avisos=avisos)
    resp.update(altium=True, backup=r.get('backup'), avisos=avisos + (r.get('avisos') or []),
                storage=r.get('storage'), verificado=bool(r.get('verificado')),
                nomeAltium=r.get('nomeAltium') or nome)
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
    """regera Libs/schlib.js (e o libs-report.txt ao lado) a partir da SchLib real — o
    --espelho do sch_leitor, síncrono (~2 s)"""
    cfg = _config()
    schlib = cfg['schlib']
    if not os.path.isfile(schlib):
        return _erro('SchLib não encontrada: %s' % schlib, 404)
    with _lock_espelho:
        try:
            nomes = L.nomes_pcblib(os.path.join(ROOT, 'Libs', 'pcblib.js'))
            with _lock_schlib:                      # não ler no meio de um patch
                dados = L.le_schlib(schlib, pcblib_names=nomes)
            _grava_bytes(os.path.join(ROOT, ESPELHO), L.espelho(dados, nomes).encode('utf-8'))
            _grava_bytes(os.path.join(ROOT, 'Libs', 'libs-report.txt'),
                         L.relatorio(dados, nomes).encode('utf-8'))
        except OSError as e:
            return _erro('falha ao gravar o espelho: %s' % e, 500)
        except Exception as e:                                  # noqa: BLE001
            return _erro('falha ao ler a SchLib: %s' % e, 500)
    syms = dados['symbols']
    return {'ok': True, 'symbols': len(syms),
            'nofootprint': sum(1 for s in syms if L._sem_footprint(s)),
            'avisos': dados.get('avisos') or [], 'source': schlib}
