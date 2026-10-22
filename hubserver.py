"""AltiumPCBMirror - hubserver.py
Servidor local OPCIONAL: serve o workspace (hub.html, Libs\\, Projects\\...) na rede
local e recarrega o browser sozinho quando um export do Altium grava arquivos.
Uso: python hubserver.py [--port 8000]
Aditivo: nao altera nenhum arquivo do hub; abrir hub.html por duplo clique segue igual.
"""
import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

from flask import Flask, Response, abort, request, send_from_directory
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import safe_join

ROOT = os.path.dirname(os.path.abspath(__file__))

# O send_from_directory tira o Content-Type do mimetypes, e no Windows o mimetypes le o registro
# (HKCR\.css\Content Type) POR CIMA do padrao. Numa maquina em que algum instalador registrou o
# .css como text/plain, o Chrome recusa a folha (checagem estrita de MIME) e o hub e as vistas
# abrem sem os tokens do tema (hub-tema.css): fundo transparente, texto preto. O .js vai junto
# pelo mesmo motivo -- e o defeito conhecido do registro do Windows.
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('text/javascript', '.js')
WATCH_INTERVAL = 1.0   # segundos entre varreduras de mtime
HEARTBEAT = 15.0       # keep-alive do SSE

# Estado do BOM, ao lado do projeto. Ficam FORA do _snapshot(): mudam a cada visto
# marcado, e o watcher dispararia reload em todas as paginas abertas -- exatamente no
# meio da montagem, que e quando ninguem pode perder a tela de vista.
BOM_VISTOS = 'bom-vistos.json'   # o que ja foi montado, COMPARTILHADO entre quem abre
BOM_OPTS = 'bom-opts.json'       # as opcoes com que a aba gerou, para o link abrir igual
BOM_STATE_FILES = (BOM_VISTOS, BOM_OPTS)
ODOO_LISTA = 'odoo-lista.json'  # recibo do envio ao Odoo; muda sem o projeto mudar
# componentes fora do esquema da lista do Odoo (odoolista.EXTRAS): o modal grava a cada
# quantidade mudada, e nenhuma aba precisa recarregar por isso -- a folha nao muda
ODOO_EXTRAS = 'lista-extras.json'
ESTADO_LOCAL = BOM_STATE_FILES + (ODOO_LISTA, ODOO_EXTRAS)
# a biblioteca de footprints do hub (Libs/pcblib-hub.js) e os STEP dela (Libs/3d-hub/): o editor de
# footprint grava de dentro do Esquema e da PCB, e quem usa relê na hora de abrir (hub-fplib.js »
# carrega). Vistos pelo vigia, gravar um footprint recarregaria a pagina onde o editor esta aberto.
FP_HUB = ("pcblib-hub.js",)
FP3D_PASTA = "3d-hub"
# O Gerber que a vista PCB grava (POST /api/gerber) mora em Projects/<nome>/Gerber/, e a pasta
# inteira fica FORA do _snapshot() pela mesma razao do estado acima: e saida gerada, nao
# projeto. Vista pelo vigia, gravar o Gerber recarregaria todas as paginas abertas -- inclusive
# a vista que acabou de gerar e ainda esta mostrando o conjunto. Nenhuma pagina desenha a
# partir dela.
GERBER_DIR = 'Gerber'
# o PDF de layout da vista PCB (/api/pdf): fora do vigia, como o Gerber
PDF_DIR = 'PDF'

app = Flask(__name__)
_version = 0           # incrementa a cada mudanca detectada
_version_lock = threading.Lock()

LIVE_JS = b"""/* hubserver: auto-reload via SSE (injetado; nao existe como arquivo) */
(function(){
  /* paginas de edicao definem __hubOnChange p/ nao perder trabalho nao salvo */
  function avisa(w){
    if (w.__hubOnChange) { w.__hubOnChange(); return; }
    w.location.reload();
  }
  /* UMA conexao por janela, e nao uma por documento. Este script entra em todo .html servido,
     inclusive nos iframes das vistas (Esquema, PCB, Neoden), e cada EventSource prende uma
     das 6 conexoes que o Chromium abre por host: hub + tres vistas + o stream de um
     sincronismo + o do chat ja sao 6, e o fetch seguinte fica na fila para sempre -- o hub
     parece travado. Agora o iframe se registra e quem escuta e a janela de cima, que repassa
     o aviso a cada iframe registrado, na mesma ordem de antes (cada um decide o seu). */
  function repassa(w){
    for (var i = 0; i < w.frames.length; i++) {
      try {
        var f = w.frames[i];
        if (f.__hubLiveFilho) { repassa(f); avisa(f); }
      } catch (e) {}
    }
  }
  var topo = null;
  try { if (window.top !== window && window.top.__hubLive) topo = window.top; } catch (e) {}
  if (topo) { window.__hubLiveFilho = true; return; }
  window.__hubLive = true;
  var es = new EventSource('/__events');
  es.addEventListener('change', function(){ repassa(window); avisa(window); });
  /* EventSource reconecta sozinho se o servidor cair/voltar */
})();
"""


def _snapshot():
    """mtimes de projects.js, Libs\\* e Projects\\** (arvore pequena)."""
    snap = {}

    def add(path):
        try:
            snap[path] = os.stat(path).st_mtime_ns
        except OSError:
            pass

    add(os.path.join(ROOT, 'projects.js'))
    for base in ('Libs', 'Projects'):
        topo = os.path.join(ROOT, base)
        for dirpath, dirnames, filenames in os.walk(topo):
            if base == 'Libs' and os.path.normcase(dirpath) == os.path.normcase(topo):
                dirnames[:] = [d for d in dirnames if d != FP3D_PASTA]
            if base == 'Projects' and os.path.dirname(dirpath) == topo:
                # dentro de Projects/<nome>/ (um projeto chamado "Gerber" continua visto):
                # nao desce na pasta do Gerber gerado; ver GERBER_DIR
                dirnames[:] = [d for d in dirnames
                               if os.path.normcase(d) not in (os.path.normcase(GERBER_DIR),
                                                              os.path.normcase(PDF_DIR))]
            for f in filenames:
                # o .tmp da gravacao atomica junto: uma varredura que o pegasse no meio da
                # escrita via um arquivo nascer e sumir, e isso tambem e "mudou"
                if base == 'Libs' and (f in FP_HUB or (f.endswith('.tmp') and f[:-4] in FP_HUB)):
                    continue
                if f in ESTADO_LOCAL or (f.endswith('.tmp') and f[:-4] in ESTADO_LOCAL):
                    continue      # visto marcado nao e mudanca de projeto; ver BOM_VISTOS
                add(os.path.join(dirpath, f))
    return snap


def _watcher():
    global _version
    prev = _snapshot()
    while True:
        time.sleep(WATCH_INTERVAL)
        try:
            cur = _snapshot()
        except Exception:
            continue
        if cur != prev:
            prev = cur
            with _version_lock:
                _version += 1


@app.after_request
def _no_store(resp):
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/__live.js')
def live_js():
    return Response(LIVE_JS, mimetype='text/javascript')


@app.route('/__events')
def events():
    def stream():
        with _version_lock:
            seen = _version
        last_beat = time.time()
        while True:
            time.sleep(0.5)
            with _version_lock:
                cur = _version
            if cur != seen:
                seen = cur
                yield 'event: change\ndata: %d\n\n' % cur
                last_beat = time.time()
            elif time.time() - last_beat >= HEARTBEAT:
                yield ': keep-alive\n\n'
                last_beat = time.time()

    return Response(stream(), mimetype='text/event-stream')


def _e_segredo(full):
    """E a credencial do Odoo (hub-almox.json) ou o temporario dela?

    O ponto no nome e o que tira um arquivo do HTTP (.hub-odoo.json, .chat/), e o
    hub-almox.json nao tem ponto: ate aqui GET /hub-almox.json entregava login e senha do
    Odoo a qualquer maquina da rede (tools/deploy/PENDENCIAS.md, 1.1). A comparacao e pelo
    caminho RESOLVIDO, e nao pelo nome: pega o symlink de shared/ no servidor e os apelidos
    que o Windows aceita para o mesmo arquivo (caixa, ponto ou espaco no fim).
    """
    alvo = os.path.normcase(os.path.realpath(full))
    return any(alvo == os.path.normcase(os.path.realpath(os.path.join(ROOT, n)))
               for n in (ALMOX_CFG_FILE, ALMOX_CFG_FILE + '.tmp'))


def _serve(path):
    if any(seg.startswith('.') for seg in path.replace('\\', '/').split('/')):
        abort(404)
    if os.name == 'nt' and ':' in path:   # fluxo alternativo do NTFS (hub-almox.json::$DATA)
        abort(404)
    full = safe_join(ROOT, path)
    if full is None or not os.path.isfile(full) or _e_segredo(full):
        abort(404)
    if full.lower().endswith('.html'):
        with open(full, 'rb') as f:
            body = f.read()
        i = body.rfind(b'</body>')
        tag = b'<script src="/__live.js"></script>\n'
        body = body[:i] + tag + body[i:] if i >= 0 else body + b'\n' + tag
        return Response(body, mimetype='text/html')
    return send_from_directory(ROOT, path)


@app.route('/')
def index():
    return _serve('hub.html')


@app.route('/<path:path>')
def files(path):
    p = path.replace('\\', '/')
    if (p == 'Libs/pcblib-3d.js' or p.startswith('Libs/3d/')) and not os.path.isfile(os.path.join(ROOT, *p.split('/'))):
        return _serve_lib3d(p[len('Libs/'):])
    return _serve(path)


# os corpos 3D da PcbLib da casa (Libs/pcblib-3d.js e Libs/3d/*.step): quando nao foram gerados
# na raiz, saem da propria PcbLib, extraidos uma vez para um cache local (tools/pcb3d/lib3d_servidor.py)
def _serve_lib3d(rel):
    try:
        pasta = os.path.join(ROOT, 'tools', 'pcb3d')
        if pasta not in sys.path:
            sys.path.insert(0, pasta)
        import lib3d_servidor
        r = lib3d_servidor.arquivo(ROOT, rel)
    except Exception as e:   # PcbLib ilegivel: o hub segue sem 3D (as caixas de placeholder)
        print('[lib3d] %s: %s' % (rel, e), file=sys.stderr)
        r = None
    if not r:
        abort(404)
    resp = send_from_directory(r[0], r[1])
    resp.headers['Cache-Control'] = 'max-age=86400' if rel.startswith('3d/') else 'no-cache'
    return resp


# rules.js: as regras de projeto da vista PCB (hub-pcbregras.js), o Rules and Constraints Editor
SAVE_BASENAMES = ('changes.js', 'schematic.js', 'annotations.js', 'rules.js')

# Libs/ e da biblioteca: o symserver (/api/symbols/*) e o guardiao do almoxarifado reescrevem
# schlib.js, symbols-lib.js e os espelhos inteiros, cada um sob a sua trava. A substituicao de
# nomes mora num arquivo SEPARADO, o unico de Libs/ que o browser grava direto por aqui. (No
# app desktop em modo biblioteca remota, este POST vai para o servidor: ver libremota.py.)
# sch-templates-casa.js: os templates de folha criados no hub (hub-schtemplate-ui.js); os do
# Altium ficam no Libs/sch-templates.js, que e codigo e nao se grava daqui
# pcblib-hub.js: os footprints criados/alterados no editor de footprint do hub (hub-fplib.js); o
# espelho do Altium (Libs/pcblib.js) continua so leitura
SAVE_LIB_FILES = ('lib-subs.js', 'sch-templates-casa.js', 'pcblib-hub.js')


@app.route('/api/save', methods=['POST'])
def api_save():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'path' not in data or 'content' not in data:
        return {'ok': False, 'error': 'JSON {path, content} obrigatorio'}, 400
    parts = [seg for seg in str(data['path']).replace('\\', '/').split('/') if seg]
    if any(seg.startswith('.') for seg in parts):
        return {'ok': False, 'error': 'path invalido'}, 403
    ok_proj = len(parts) == 3 and parts[0] == 'Projects' and parts[2] in SAVE_BASENAMES
    ok_lib = len(parts) == 2 and parts[0] == 'Libs' and parts[1] in SAVE_LIB_FILES
    if not (ok_proj or ok_lib):
        return {'ok': False,
                'error': 'so Projects/<nome>/{changes,schematic,annotations,rules}.js ou '
                         'Libs/{lib-subs,sch-templates-casa}.js'}, 403
    full = safe_join(ROOT, *parts)
    if full is None or not os.path.isdir(os.path.dirname(full)):
        return {'ok': False, 'error': 'pasta inexistente'}, 404
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(str(data['content']))
        # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
        os.replace(tmp, os.path.realpath(full))
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    return {'ok': True}


# ── o STEP dos corpos 3D do editor de footprint (hub-fplib.js » sobeStep) ──
# O corpo do POST e o arquivo cru; o nome no disco e o sha1 do conteudo (o mesmo modelo subido
# duas vezes nao duplica) em Libs/3d-hub/, que o hub serve como arquivo estatico.
FP3D_DIR = os.path.join('Libs', '3d-hub')
FP3D_MAX = 120 * 1024 * 1024


@app.route('/api/fp3d', methods=['POST'])
def api_fp3d():
    from urllib.parse import unquote
    request.max_content_length = FP3D_MAX
    try:
        dados = request.get_data(cache=False)
    except RequestEntityTooLarge:
        return {'ok': False, 'error': 'STEP maior que %d MB' % (FP3D_MAX // (1024 * 1024))}, 413
    if not dados or not dados[:64].lstrip().startswith(b'ISO-10303-21'):
        return {'ok': False, 'error': 'o arquivo nao e STEP (nao comeca com ISO-10303-21)'}, 400
    sha = hashlib.sha1(dados).hexdigest()
    nome = os.path.basename(unquote(request.headers.get('X-Nome', '')).replace('\\', '/'))[:120] or 'modelo.step'
    pasta = os.path.join(ROOT, FP3D_DIR)
    alvo = os.path.join(pasta, sha + '.step')
    try:
        os.makedirs(pasta, exist_ok=True)
        if not os.path.isfile(alvo):
            tmp = alvo + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(dados)
            os.replace(tmp, alvo)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    return {'ok': True, 'id': sha, 'file': '3d-hub/' + sha + '.step', 'name': nome, 'bytes': len(dados)}


# ── abrir documento do Altium (.SchDoc / .PcbDoc / .PrjPcb) direto no hub ──
# O hub manda os arquivos (base64 no JSON: o .PrjPcb, as folhas e a placa, soltos) ou, so do
# proprio PC, os caminhos no disco (o app desktop, com o arquivo arrastado para a janela): com o
# caminho do .PrjPcb, as folhas e o .PcbDoc sao achados pelo proprio projeto. Sai o projeto como o
# ExportProject + ExportBoard o deixariam: schematic.js (tools/schdoc/schdoc2sch.py), board.js,
# rules.js e o 3D (tools/pcbdoc/abrir_placa.py), e o changes.js/annotations.js vazios. O Altium so
# e LIDO. Projeto que ja tem schematic.js ou board.js so com "substituir" (o anterior vira .bak).
ALTIUM_MAX = 400 * 1024 * 1024
ALTIUM_EXT = ('.schdoc', '.prjpcb', '.pcbdoc')
_NOME_RUIM = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _nome_projeto_ok(nome):
    if not isinstance(nome, str) or not nome.strip() or nome != nome.strip() or nome.endswith('.') or nome.startswith('.'):
        return False
    if len(nome) > 120 or _NOME_RUIM.search(nome) or '":' in nome:
        return False
    return not re.match(r'^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$', nome, re.I)


@app.route('/api/altium/abrir', methods=['POST'])
def api_altium_abrir():
    import tempfile
    request.max_content_length = ALTIUM_MAX * 2
    try:
        data = request.get_json(silent=True) or {}
    except RequestEntityTooLarge:
        return {'ok': False, 'error': 'arquivos grandes demais'}, 413
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'schdoc'))
    import schdoc2sch as SD
    tmp = None
    try:
        entradas = []
        if data.get('caminhos'):
            if not _is_local(request):
                return {'ok': False, 'error': 'caminho no disco so do proprio PC; mande os arquivos'}, 403
            for c in data['caminhos']:
                if not isinstance(c, str) or not c.lower().endswith(ALTIUM_EXT) or not os.path.isfile(c):
                    return {'ok': False, 'error': 'arquivo invalido: %s' % c}, 400
                entradas.append(c)
        else:
            tmp = tempfile.mkdtemp(prefix='altium-abrir-')
            total = 0
            for a in data.get('arquivos') or []:
                nome = os.path.basename(str(a.get('nome') or '').replace('\\', '/'))
                if not nome.lower().endswith(ALTIUM_EXT) or nome.startswith('.'):
                    return {'ok': False, 'error': 'so .SchDoc, .PcbDoc e .PrjPcb: %s' % nome}, 400
                try:
                    dados = base64.b64decode(a.get('b64') or '', validate=True)
                except (ValueError, TypeError):
                    return {'ok': False, 'error': 'arquivo corrompido no envio: %s' % nome}, 400
                total += len(dados)
                if total > ALTIUM_MAX:
                    return {'ok': False, 'error': 'arquivos grandes demais'}, 413
                with open(os.path.join(tmp, nome), 'wb') as f:
                    f.write(dados)
                entradas.append(os.path.join(tmp, nome))
        if not entradas:
            return {'ok': False, 'error': 'nenhum arquivo'}, 400
        # o .PrjPcb manda na ordem das folhas e diz qual e a placa; sem ele, o que veio
        sys.path.insert(0, os.path.join(ROOT, 'tools', 'pcbdoc'))
        import abrir_placa as AP
        prj = [e for e in entradas if e.lower().endswith('.prjpcb')]
        folhas = [e for e in entradas if e.lower().endswith('.schdoc')]
        placas = [e for e in entradas if e.lower().endswith('.pcbdoc')]
        if prj and not placas:
            placas = AP.placas_do_prjpcb(prj[0])
        tem_folhas = bool(folhas) or bool(prj and SD.folhas_do_prjpcb(prj[0]))
        usar = prj[:1] if prj else folhas
        projeto = data.get('projeto') or os.path.splitext(os.path.basename((usar or placas)[0]))[0]
        if not _nome_projeto_ok(projeto):
            return {'ok': False, 'error': 'nome de projeto invalido: %s' % projeto}, 400
        if not tem_folhas and not placas:
            return {'ok': False, 'error': 'nenhuma folha (.SchDoc) nem placa (.PcbDoc) no que veio'}, 400
        pasta = os.path.join(ROOT, 'Projects', projeto)
        saida = os.path.join(pasta, 'schematic.js')
        ja = [n for n in ('schematic.js', 'board.js') if os.path.exists(os.path.join(pasta, n))]
        if ja and not data.get('substituir'):
            return {'ok': False, 'existe': True, 'projeto': projeto,
                    'error': 'o projeto "%s" ja tem %s' % (projeto, ' e '.join(ja))}, 409
        avisos = []
        resumo = {}
        texto = None
        if tem_folhas:
            try:
                texto, resumo = SD.converte(usar, projeto, True, avisos)
            except SD.SchDocErro as e:
                return {'ok': False, 'error': str(e)}, 422
        placa = None
        if placas:
            if len(placas) > 1:
                avisos.append('o projeto tem %d placas; abri a primeira (%s)' % (len(placas), os.path.basename(placas[0])))
            try:
                placa = AP.abre_placa(placas[0], pasta, prj[0] if prj else None, avisos)
            except AP.ErroPlaca as e:
                if texto is None:
                    return {'ok': False, 'error': 'PCB: %s' % e}, 422
                avisos.append('PCB nao aberta: %s' % e)
        if texto is not None:
            try:
                SD.grava(saida, texto, forcar=True, permite_rede=True)
            except OSError as e:
                return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
        resumo['avisos'] = avisos
        resumo['faltam'] = [os.path.basename(x) for x in resumo.get('faltam') or []]
        build_index(ROOT)
        return {'ok': True, 'projeto': projeto, 'resumo': resumo, 'esquema': texto is not None, 'placa': placa}
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


LASER_DIR = 'Laser'


@app.route('/api/laser-open', methods=['POST'])
def api_laser_open():
    """Grava o .lbrn em Laser\\ e manda o Windows abrir com o app associado.

    O navegador nao lanca aplicativo, entao quem abre e o servidor. Consequencia
    honesta: o LightBurn abre na MAQUINA DO SERVIDOR. Acessando o hub de outro PC da
    rede, o arquivo abre la, nao no seu.

    So aceita de localhost: o servidor escuta na rede toda (0.0.0.0), e um endpoint
    que lanca aplicativo nao pode ficar exposto ao resto da LAN.
    """
    if not _is_local(request):
        return {'ok': False,
                'error': 'abrir direto so funciona no PC do servidor; use "Baixar .lbrn"'}, 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'name' not in data or 'content' not in data:
        return {'ok': False, 'error': 'JSON {name, content} obrigatorio'}, 400
    name = os.path.basename(str(data['name']))
    if not name.endswith(('.lbrn', '.lbrn2')) or name.startswith('.'):
        return {'ok': False, 'error': 'so .lbrn/.lbrn2'}, 403
    outdir = os.path.join(ROOT, LASER_DIR)
    try:
        os.makedirs(outdir, exist_ok=True)
        full = os.path.join(outdir, name)
        with open(full, 'w', encoding='utf-8', newline='\n') as f:
            f.write(str(data['content']))
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    try:
        os.startfile(full)                      # Windows: abre com o app associado
    except AttributeError:
        return {'ok': False, 'error': 'abrir direto so no Windows; o arquivo ficou em '
                                      + os.path.join(LASER_DIR, name)}, 501
    except OSError as e:
        return {'ok': False, 'error': 'arquivo gravado, mas nada associado a .lbrn: %s' % e}, 500
    return {'ok': True, 'path': os.path.join(LASER_DIR, name)}


# ─────────────────────── Gerber gerado pela vista PCB ───────────────────────
# A vista PCB gera o Gerber no navegador (hub-gerber.js, sobre o board.js com as mudancas ja
# aplicadas) e o "Salvar no projeto" manda o conjunto para ca. Ele vai para
# Projects/<nome>/Gerber/ (GERBER_DIR, fora do vigia), e a pasta e o ULTIMO conjunto gerado, nao
# um arquivo morto: o que nao veio no conjunto novo sai, para ninguem mandar a fabrica uma
# camada que sobrou de outra geracao. O gerber.json ao lado diz quando saiu, com que opcoes e o
# md5 de cada arquivo. A pasta e servida como qualquer arquivo do projeto
# (/Projects/<nome>/Gerber/...) e, no servidor, aparece no compartilhamento de rede.
GERBER_MANIFESTO = 'gerber.json'
GERBER_EXTS = ('.gbr', '.gtl', '.gbl', '.gto', '.gbo', '.gts', '.gbs', '.gtp', '.gbp', '.gko',
               '.gm1', '.drl', '.txt')
# Sai da pasta mesmo sem estar no gerber.json anterior: camada e furacao. Um .txt pode ser
# anotacao de alguem, e so sai se foi o hub que o gravou.
GERBER_SEMPRE_SAI = ('.gbr', '.drl')
GERBER_MAX_BYTES = 30 * 1024 * 1024     # soma dos arquivos; o X2 do DMB tem ~650 KB
# O corpo do POST e maior que os arquivos (o JSON escapa o CRLF de cada linha). Este limite so
# impede ler para a memoria um corpo sem fim; quem decide e o de cima.
GERBER_MAX_CORPO = 2 * GERBER_MAX_BYTES + 1024 * 1024
GERBER_MAX_ARQUIVOS = 100               # o do Altium tem 13; 30 Mid e as mecanicas cabem
GERBER_MAX_MANIFESTO = 64 * 1024
_GERBER_NOME = re.compile(r'[A-Za-z0-9 _.()+-]+')
# CON, NUL, COM1...: no Windows o nome e o DISPOSITIVO, com extensao ou sem (gravar CON.gbr
# escreve no console). A bancada e o app desktop sao Windows.
_NOME_RESERVADO = re.compile(r'(con|prn|aux|nul|com[0-9]|lpt[0-9]) *\.', re.I)
_gerber_lock = threading.Lock()         # duas abas salvando juntas nao misturam dois conjuntos


def _gerber_nome_ruim(nome):
    """Por que este nome nao pode virar arquivo em Gerber/, ou '' se pode. O nome vem do
    navegador e vira caminho no disco do servidor: so basename, e nada que o Windows ou o Linux
    leiam como outra coisa."""
    if not isinstance(nome, str) or not nome:
        return 'falta o nome do arquivo'
    if len(nome) > 150:
        return 'nome comprido demais'
    if nome.startswith('.') or nome != nome.strip() or not _GERBER_NOME.fullmatch(nome):
        return 'nome invalido: so letras sem acento, numeros, espaco e _ . ( ) + -'
    if os.path.splitext(nome)[1].lower() not in GERBER_EXTS:
        return 'extensao nao aceita (so %s)' % ' '.join(GERBER_EXTS)
    if _NOME_RESERVADO.match(nome):
        return 'nome reservado do Windows'
    return ''


def _gerber_projeto(proj):
    """(pasta do projeto, '') ou (None, motivo).

    O nome tem de ser EXATAMENTE o de uma pasta de Projects/ -- comparado com o listdir, nunca
    montado com o que veio do cliente (o cuidado do _proj_dir_by_id): nao passa '..', nem o
    apelido que o Windows aceita para a mesma pasta (caixa, ponto ou espaco no fim), nem fluxo
    alternativo do NTFS.
    """
    pdir = os.path.join(ROOT, 'Projects')
    try:
        achou = isinstance(proj, str) and not proj.startswith('.') and proj in os.listdir(pdir)
    except OSError:
        achou = False
    d = os.path.join(pdir, proj) if achou else None
    if d is None or not os.path.isdir(d):
        return None, 'projeto nao encontrado'
    if not os.path.isfile(os.path.join(d, 'board.js')):
        return None, 'o projeto ainda nao tem board.js -- rode o ExportPcb no Altium'
    return d, ''


def _gerber_anteriores(gdir):
    """Os nomes que o hub gravou da ultima vez, pelo gerber.json. Validados de novo: o arquivo
    vem do disco, e cada nome dele vira caminho de os.remove."""
    try:
        with open(os.path.join(gdir, GERBER_MANIFESTO), encoding='utf-8') as f:
            lista = json.load(f).get('arquivos')
    except (OSError, ValueError, AttributeError):
        return set()
    if not isinstance(lista, list):
        return set()
    return {a['nome'] for a in lista
            if isinstance(a, dict) and not _gerber_nome_ruim(a.get('nome'))}


def _gerber_troca(gdir, novos, anteriores):
    """Poe o conjunto novo no lugar do anterior e devolve os nomes que sairam da pasta.

    Primeiro TODOS os .tmp, so depois as trocas: disco cheio no meio da escrita deixa o
    conjunto anterior inteiro, em vez de meia placa nova com meia velha.
    """
    pares = [(os.path.join(gdir, nome) + '.tmp', os.path.join(gdir, nome)) for nome, _c in novos]
    try:
        for (tmp, _full), (_nome, corpo) in zip(pares, novos):
            with open(tmp, 'wb') as f:          # binario: o CRLF do gerador chega intacto
                f.write(corpo)
        for tmp, full in pares:
            # Segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger), mas
            # so quando o destino E link: no Windows o realpath devolve tambem a caixa do arquivo
            # que ja existe, e trocar so a caixa (a.gbr -> A.GBR) deixaria o nome velho na pasta.
            os.replace(tmp, os.path.realpath(full) if os.path.islink(full) else full)
    finally:
        for tmp, _full in pares:                # so sobra .tmp quando algo falhou no meio
            try:
                os.remove(tmp)
            except OSError:
                pass
    # Sai a camada e a furacao (.gbr/.drl) que nao vieram agora, e tudo o que o proprio hub
    # gravou da outra vez (gerber.json anterior) -- e isso que pega a legenda .gto/.gbo de
    # quando a opcao estava ligada. Anotacao de alguem e subpasta ficam. normcase: no Windows a
    # caixa nao separa arquivo (o pdmb_x.gbr novo E o PDMB_X.gbr de antes, ja trocado); no Linux
    # separa, e o de outra caixa e sobra.
    ficam = {os.path.normcase(nome) for nome, _c in novos}
    feitos = {os.path.normcase(nome) for nome in anteriores}
    removidos = []
    for f in sorted(os.listdir(gdir)):
        chave = os.path.normcase(f)
        if chave in ficam or not os.path.isfile(os.path.join(gdir, f)):
            continue
        if os.path.splitext(f)[1].lower() in GERBER_SEMPRE_SAI or chave in feitos:
            os.remove(os.path.join(gdir, f))
            removidos.append(f)
    return removidos


@app.route('/api/gerber', methods=['POST'])
def api_gerber():
    """Grava o conjunto Gerber da vista PCB em Projects/<proj>/Gerber/.

    Corpo: {proj, arquivos:[{nome, texto}], manifesto?:{base, opcoes, ...}}; proj e o nome da
    pasta (o ?p= da vista). Resposta: {ok, pasta, arquivos:[{nome, bytes, md5}], removidos}.
    A validacao e tudo ou nada: um nome recusado nao deixa gravar os outros. Como o /api/save,
    nao e so-localhost -- a vista PCB abre de qualquer maquina da rede, e o que entra aqui fica
    preso a pasta Gerber/ de um projeto que ja existe.
    """
    grande = ({'ok': False, 'error': 'conjunto grande demais (o limite e %d MB)'
               % (GERBER_MAX_BYTES // (1024 * 1024))}, 413)
    # Vale tambem para corpo sem Content-Length (chunked): desde o Flask 3.1 o limite e por
    # requisicao, e passar dele levanta 413 em vez de ler tudo para a memoria.
    request.max_content_length = GERBER_MAX_CORPO
    try:
        data = request.get_json(silent=True)
    except RequestEntityTooLarge:
        return grande
    if not isinstance(data, dict) or not isinstance(data.get('arquivos'), list):
        return {'ok': False, 'error': 'JSON {proj, arquivos:[{nome, texto}]} obrigatorio'}, 400
    d, motivo = _gerber_projeto(data.get('proj'))
    if d is None:
        return {'ok': False, 'error': motivo}, 404
    manifesto = data.get('manifesto')
    if manifesto is None:
        manifesto = {}
    if not isinstance(manifesto, dict) or len(json.dumps(manifesto)) > GERBER_MAX_MANIFESTO:
        return {'ok': False, 'error': 'manifesto tem que ser um objeto pequeno'}, 400
    if not data['arquivos'] or len(data['arquivos']) > GERBER_MAX_ARQUIVOS:
        return {'ok': False, 'error': 'o conjunto tem de ter de 1 a %d arquivos'
                % GERBER_MAX_ARQUIVOS}, 400
    novos, vistos, total = [], set(), 0
    for a in data['arquivos']:
        if not isinstance(a, dict) or not isinstance(a.get('texto'), str):
            return {'ok': False, 'error': 'cada arquivo e {nome, texto}, com o texto em string'}, 400
        nome = a.get('nome')
        motivo = _gerber_nome_ruim(nome)
        if motivo:
            return {'ok': False, 'error': '%s: %s' % (repr(nome)[:120], motivo)}, 403
        # A caixa nao separa arquivo no Windows: A.gbr e a.gbr seriam um so, e o segundo
        # apagaria o primeiro calado.
        if nome.lower() in vistos:
            return {'ok': False, 'error': 'nome repetido no conjunto: %s' % nome}, 400
        vistos.add(nome.lower())
        try:
            corpo = a['texto'].encode('utf-8')
        except UnicodeEncodeError:
            return {'ok': False, 'error': '%s: o texto tem caractere invalido' % nome}, 400
        total += len(corpo)
        if total > GERBER_MAX_BYTES:
            return grande
        novos.append((nome, corpo))
    lista = [{'nome': n, 'bytes': len(c), 'md5': hashlib.md5(c).hexdigest()} for n, c in novos]
    # O que a vista mandou alem disso (avisos do gerador, resumo...) vai junto. arquivos e gerado
    # sao sempre do servidor: o md5 e o do que foi para o disco, e a hora e a do relogio que data
    # os outros arquivos do projeto.
    man = dict(manifesto)
    man.update({
        'gerado': time.strftime('%Y-%m-%d %H:%M:%S'),
        'base': manifesto['base'] if isinstance(manifesto.get('base'), str) else '',
        'opcoes': manifesto['opcoes'] if isinstance(manifesto.get('opcoes'), dict) else {},
        'arquivos': lista,
    })
    gdir = os.path.join(d, GERBER_DIR)
    with _gerber_lock:
        try:
            os.makedirs(gdir, exist_ok=True)
            removidos = _gerber_troca(gdir, novos, _gerber_anteriores(gdir))
            _bom_json_write(gdir, GERBER_MANIFESTO, man)     # o mesmo gravador atomico do BOM
        except OSError as e:
            return {'ok': False, 'error': 'falha ao gravar o Gerber: %s' % e}, 500
    return {'ok': True, 'pasta': 'Projects/%s/%s' % (os.path.basename(d), GERBER_DIR),
            'arquivos': lista, 'removidos': removidos}


PDF_MAX_BYTES = 40 * 1024 * 1024        # a pagina realista leva imagem; o vetorial tem ~200 KB
_PDF_NOME = re.compile(r'[A-Za-z0-9 _.()+,-]+')


@app.route('/api/pdf', methods=['POST'])
def api_pdf():
    """Grava o PDF de layout da vista PCB (hub-pcbpdf.js) em Projects/<proj>/PDF/<nome>.pdf.

    Corpo: {proj, nome, base64}. O nome e so o arquivo (sem pasta), com ou sem .pdf; o conteudo
    tem de comecar com %PDF-. Mesma regra do /api/gerber para o projeto: so pasta que ja existe
    em Projects/ e que tem board.js. Grava por cima do PDF de mesmo nome (o LO - da revisao).
    """
    request.max_content_length = PDF_MAX_BYTES * 2 + 1024 * 1024
    try:
        data = request.get_json(silent=True)
    except RequestEntityTooLarge:
        return {'ok': False, 'error': 'PDF grande demais'}, 413
    if not isinstance(data, dict) or not isinstance(data.get('base64'), str):
        return {'ok': False, 'error': 'JSON {proj, nome, base64} obrigatorio'}, 400
    d, motivo = _gerber_projeto(data.get('proj'))
    if d is None:
        return {'ok': False, 'error': motivo}, 404
    nome = data.get('nome')
    if not isinstance(nome, str):
        return {'ok': False, 'error': 'nome obrigatorio'}, 400
    nome = nome.strip()
    if nome.lower().endswith('.pdf'):
        nome = nome[:-4].rstrip()
    if (not nome or len(nome) > 150 or nome.startswith('.') or nome.endswith('.')
            or not _PDF_NOME.fullmatch(nome)):
        return {'ok': False, 'error': 'nome de arquivo invalido'}, 403
    try:
        corpo = base64.b64decode(data['base64'], validate=True)
    except ValueError:
        return {'ok': False, 'error': 'base64 invalido'}, 400
    if not corpo.startswith(b'%PDF-'):
        return {'ok': False, 'error': 'o conteudo nao e um PDF'}, 400
    if len(corpo) > PDF_MAX_BYTES:
        return {'ok': False, 'error': 'PDF grande demais'}, 413
    pdir = os.path.join(d, PDF_DIR)
    full = os.path.join(pdir, nome + '.pdf')
    try:
        os.makedirs(pdir, exist_ok=True)
        tmp = full + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(corpo)
        os.replace(tmp, os.path.realpath(full))
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar o PDF: %s' % e}, 500
    return {'ok': True, 'arquivo': 'Projects/%s/%s/%s.pdf' % (os.path.basename(d), PDF_DIR, nome),
            'bytes': len(corpo)}


# ─────────────────────────── configuracao do hub ───────────────────────────
# Um arquivo so, na raiz, com o punhado de coisas que sao da MAQUINA e nao do projeto -
# hoje so a pasta padrao do BOM. Nao vai para o localStorage porque o caminho e do disco do
# SERVIDOR: gravado no browser, cada PC da LAN teria a sua versao de um caminho que so o
# servidor usa.
LOCAL_ADDRS = ('127.0.0.1', '::1', 'localhost')
# O hub escuta na rede? Reescrito pelo __main__ a partir do --host. Importado por teste ou
# WSGI, vale o padrao de sempre (rede toda).
_ESCUTA_REDE = True


def _is_local(req):
    """A chamada partiu do PROPRIO PC do servidor?

    Nao basta olhar 127.0.0.1: o banner imprime tambem a URL de LAN (e e ela que fica
    favoritada, porque e a mesma que funciona no tablet da bancada). Aberta no proprio PC,
    ela chega com o IP da maquina como remote_addr e cairia no 403. Comparar com os enderecos
    da propria maquina resolve sem afrouxar nada: o remote_addr e o IP real do outro lado do
    TCP, e o de outra maquina da LAN nunca e um dos nossos.
    """
    addr = req.remote_addr
    if addr in LOCAL_ADDRS:
        return True
    try:
        return addr in set(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        return False


_PROJ_CACHE = {}


def load_var_file(path):
    """Le um arquivo 'var X = ...;' e devolve o valor (os arquivos sao JSON gerado)."""
    with open(path, encoding='utf-8', errors='replace') as f:
        s = f.read()
    s = re.sub(r'^\s*//[^\n]*\n', '', s, flags=re.M)
    s = s[s.find('=') + 1:].strip().rstrip(';').strip()
    s = re.sub(r',\s*([\]}])', r'\1', s)
    return json.loads(s)


def _proj_id(name):
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return slug or 'proj'


def _mtime(path):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return 0


def _count_ops(changes):
    return sum(1 for c in changes if isinstance(c, dict) and c.get('op'))


def build_index(root):
    projects = []
    pdir = os.path.join(root, 'Projects')
    names = sorted(d for d in os.listdir(pdir) if os.path.isdir(os.path.join(pdir, d))) if os.path.isdir(pdir) else []
    for name in names:
        d = os.path.join(pdir, name)
        has_sch = os.path.isfile(os.path.join(d, 'schematic.js'))
        has_board = os.path.isfile(os.path.join(d, 'board.js'))
        board = None
        if has_board:
            try:
                board = load_var_file(os.path.join(d, 'board.js'))
            except Exception:
                board = None
        stats = {'sheets': 0, 'comps': 0, 'nets': 0, 'tracks': 0, 'vias': 0}
        if board:
            stats['comps'] = len(board.get('components', []))
            stats['nets'] = len(board.get('nets', []))
            stats['tracks'] = len(board.get('tracks', []))
            stats['vias'] = len(board.get('vias', []))
        if has_sch and not board:
            try:
                sch = load_var_file(os.path.join(d, 'schematic.js'))
                items = sch.get('items', [])
                stats['sheets'] = sum(1 for i in items if i.get('t') == 'sheet')
                stats['comps'] = sum(1 for i in items if i.get('t') == 'comp')
            except Exception:
                pass
        elif has_sch:
            try:
                sch = load_var_file(os.path.join(d, 'schematic.js'))
                stats['sheets'] = sum(1 for i in sch.get('items', []) if i.get('t') == 'sheet')
            except Exception:
                pass
        pending = 0
        ch_path = os.path.join(d, 'changes.js')
        applied_at = _mtime(os.path.join(d, 'apply-report.txt'))
        if os.path.isfile(ch_path) and _mtime(ch_path) > applied_at:
            try:
                pending = _count_ops(load_var_file(ch_path))
            except Exception:
                pending = 0
        done = [has_sch or has_board, has_board, stats['tracks'] > 0, applied_at > 0 and applied_at >= _mtime(ch_path)]
        stages = [1 if v else 0 for v in done]
        for i, v in enumerate(stages):
            if not v:
                stages[i] = 2
                break
        projects.append({
            'id': _proj_id(name), 'name': name, 'path': 'Projects\\' + name,
            'demo': name.startswith('_'), 'noSchematic': not has_sch,
            'stages': stages, 'pending': pending, 'stats': stats,
        })
    _PROJ_CACHE.clear()
    for p in projects:
        _PROJ_CACHE[p['id']] = p['name']
    return {'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'projects': projects}


def _fmt_when(ts):
    return time.strftime('%Y-%m-%d %H:%M', time.localtime(ts)) if ts else ''


def build_detail(root, proj_id):
    if proj_id not in _PROJ_CACHE:
        build_index(root)
    name = _PROJ_CACHE.get(proj_id)
    if not name:
        return None
    d = os.path.join(root, 'Projects', name)
    board = sch = None
    try:
        board = load_var_file(os.path.join(d, 'board.js'))
    except Exception:
        pass
    try:
        sch = load_var_file(os.path.join(d, 'schematic.js'))
    except Exception:
        pass
    try:
        fplib = load_var_file(os.path.join(root, 'Libs', 'pcblib.js'))
        fp_by_name = {f.get('name'): f for f in fplib.get('footprints', [])}
    except Exception:
        fp_by_name = {}

    components = []
    if board:
        for c in board.get('components', []):
            nets = sorted({p.get('net') for p in c.get('pads', []) if p.get('net')})
            components.append({
                'des': c.get('ref', ''), 'value': c.get('comment', ''),
                'footprint': c.get('footprint', ''), 'lib': '',
                'pins': len(c.get('pads', [])), 'layer': c.get('layer', ''),
                'pos': '%.2f, %.2f mm' % (c.get('x', 0), c.get('y', 0)),
                'rot': '%g°' % c.get('rot', 0), 'nets': nets,
            })
    elif sch:
        for it in sch.get('items', []):
            if it.get('t') != 'comp':
                continue
            fp = fp_by_name.get(it.get('footprint', ''), {})
            components.append({
                'des': it.get('ref', ''), 'value': it.get('comment', ''),
                'footprint': it.get('footprint', ''), 'lib': '',
                'pins': len(fp.get('pads', [])), 'layer': '',
                'pos': '%g, %g mil' % (it.get('x', 0), it.get('y', 0)),
                'rot': '%g°' % it.get('rot', 0), 'nets': [],
            })

    nets = []
    if board:
        pads_by_net, tracks_by_net, widths = {}, {}, {}
        for c in board.get('components', []):
            for p in c.get('pads', []):
                if p.get('net'):
                    pads_by_net[p['net']] = pads_by_net.get(p['net'], 0) + 1
        for t in board.get('tracks', []):
            if t.get('net'):
                tracks_by_net[t['net']] = tracks_by_net.get(t['net'], 0) + 1
                widths.setdefault(t['net'], t.get('w', 0))
        for n in board.get('nets', []):
            nets.append({'name': n, 'cls': '—', 'nodes': pads_by_net.get(n, 0),
                         'tracks': tracks_by_net.get(n, 0),
                         'width': ('%g mm' % widths[n]) if n in widths else '—'})

    fp_usage = {}
    for c in components:
        if c['footprint']:
            fp_usage[c['footprint']] = fp_usage.get(c['footprint'], 0) + 1
    footprints = []
    for fname, count in sorted(fp_usage.items()):
        f = fp_by_name.get(fname, {})
        footprints.append({'name': fname, 'lib': 'pcblib',
                           'desc': f.get('desc', f.get('description', '')) or '—',
                           'usage': '%d componente%s' % (count, 's' if count != 1 else ''),
                           'pads': '%d pads' % len(f.get('pads', []))})

    history = []
    hist_path = os.path.join(d, 'history.jsonl')
    if os.path.isfile(hist_path):
        with open(hist_path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        history.append(json.loads(line))
                    except Exception:
                        pass
    for fname, title in [('apply-report.txt', 'ApplyChanges executado'),
                         ('build-report.txt', 'BuildSchematic executado')]:
        ts = _mtime(os.path.join(d, fname))
        if ts:
            history.append({'when': _fmt_when(ts), 'kind': 'ok', 'title': title,
                            'detail': 'Projects\\' + name + '\\' + fname, 'ts': ts})
    if board and board.get('generated'):
        history.append({'when': str(board['generated']), 'kind': 'ok',
                        'title': 'ExportBoard concluído', 'detail': 'board.js atualizado', 'ts': _mtime(os.path.join(d, 'board.js'))})
    if sch and sch.get('generated'):
        history.append({'when': str(sch['generated']), 'kind': 'ok',
                        'title': 'schematic.js atualizado', 'detail': 'Projects\\' + name + '\\schematic.js', 'ts': _mtime(os.path.join(d, 'schematic.js'))})
    history.sort(key=lambda h: h.get('ts', 0), reverse=True)
    for h in history:
        h.pop('ts', None)

    return {'name': name, 'components': components, 'nets': nets, 'footprints': footprints,
            'history': history, 'schematic': sch or {}, 'board': board or {}}


RUN_ACTIONS = ('BuildSchematic', 'ExportBoard', 'ApplyChanges', 'DRC', 'Rescan')
ALTIUM_HINT = {
    'BuildSchematic': 'No Altium: DXP » Run Script » BuildSchematic (cria os .SchDoc)',
    'ExportBoard': 'No Altium: DXP » Run Script » ExportPcb',
    'ApplyChanges': 'No Altium: DXP » Run Script » ApplyProject',
    'DRC': 'No Altium: Tools » Design Rule Check',
}
_runs = {}


@app.route('/api/index.json')
def api_index():
    return build_index(ROOT)


@app.route('/api/project/<proj_id>.json')
def api_project(proj_id):
    det = build_detail(ROOT, proj_id)
    if det is None:
        return {'error': 'projeto desconhecido'}, 404
    return det


# ─────────────────────────── exclusao de projeto ───────────────────────────
# Senha mestre do hub, em texto aqui de proposito: o que ela protege e o clique errado
# no menu, nao um invasor - quem le este arquivo tambem apaga a pasta a mao. Trocar sem
# mexer no codigo: variavel de ambiente ALTIUMHUB_MASTER antes de subir o servidor.
MASTER_PASSWORD = os.environ.get('ALTIUMHUB_MASTER') or 'LucasGatao'
TRASH_DIR = 'Trash'


@app.route('/api/project/<proj_id>/delete', methods=['POST'])
def api_project_delete(proj_id):
    """Tira o projeto de Projects\\ e move a pasta inteira para Trash\\<nome>-<data>.

    Nao apaga nada. Para o hub da no mesmo - o indice so enxerga Projects\\ -, mas
    mover e reversivel e apagar nao: um clique com a senha certa nao pode custar o
    historico de uma placa. Quem quiser sumir de vez esvazia o Trash\\ a mao.

    Diferente do laser-open, este endpoint NAO e so-localhost: o hub e
    usado do tablet da bancada, e quem manda aqui e a senha mestre.
    """
    data = request.get_json(silent=True) or {}
    senha = data.get('password')
    if not isinstance(senha, str) or not hmac.compare_digest(
            senha.encode('utf-8'), MASTER_PASSWORD.encode('utf-8')):
        return {'ok': False, 'error': 'senha mestre incorreta'}, 403
    if proj_id not in _PROJ_CACHE:
        build_index(ROOT)
    name = _PROJ_CACHE.get(proj_id)
    if not name:
        return {'ok': False, 'error': 'projeto desconhecido'}, 404
    src = os.path.join(ROOT, 'Projects', name)
    if not os.path.isdir(src):
        return {'ok': False, 'error': 'a pasta do projeto ja nao existe'}, 404
    stamp = time.strftime('%Y%m%d-%H%M%S')
    dst = os.path.join(ROOT, TRASH_DIR, '%s-%s' % (name, stamp))
    n = 1
    while os.path.exists(dst):          # dois envios no mesmo segundo
        n += 1
        dst = os.path.join(ROOT, TRASH_DIR, '%s-%s-%d' % (name, stamp, n))
    try:
        os.makedirs(os.path.join(ROOT, TRASH_DIR), exist_ok=True)
        shutil.move(src, dst)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao mover para o Trash: %s' % e}, 500
    build_index(ROOT)                   # o cache id->nome nao pode apontar para o que saiu
    _anota_apagar_nexobd(name)
    return {'ok': True, 'trash': os.path.relpath(dst, ROOT)}


def _anota_apagar_nexobd(name):
    """No app desktop (ALTIUMHUB_NEXOBD=1) o projeto mora no NexoBD e Projects\\ e so a copia:
    sem esta nota, a proxima rodada do electron/lib/armazem.js o baixaria de volta. Ela le a
    lista, apaga o item no NexoBD e tira o nome daqui."""
    if os.environ.get('ALTIUMHUB_NEXOBD') != '1':
        return
    arq = os.path.join(ROOT, '.altiumhub', 'nexobd-apagar.json')
    try:
        with open(arq, encoding='utf-8') as f:
            lista = json.load(f)
        if not isinstance(lista, list):
            lista = []
    except (OSError, ValueError):
        lista = []
    if name not in lista:
        lista.append(name)
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(lista, f)
    os.replace(tmp, arq)


@app.route('/api/run', methods=['POST'])
def api_run():
    data = request.get_json(silent=True) or {}
    action = data.get('action')
    if action not in RUN_ACTIONS:
        return {'ok': False, 'error': 'acao desconhecida'}, 400
    if action != 'Rescan':
        return {'ok': False, 'error': 'esta acao roda dentro do Altium', 'hint': ALTIUM_HINT[action]}, 400
    run_id = 'r_%04x' % (int(time.time() * 1000) & 0xffff)
    _runs[run_id] = data.get('project') or ''
    return {'runId': run_id}, 202


@app.route('/api/run/<run_id>/stream')
def api_run_stream(run_id):
    if run_id not in _runs:
        abort(404)

    def stream():
        yield 'data: reindexando Projects...\n\n'
        try:
            idx = build_index(ROOT)
            yield 'data: %d projetos indexados\n\n' % len(idx['projects'])
            yield 'event: done\ndata: {"ok":true}\n\n'
        except Exception as e:
            yield 'event: error\ndata: %s\n\n' % json.dumps(str(e))
        _runs.pop(run_id, None)

    return Response(stream(), mimetype='text/event-stream')


# ─────────────────── almoxarifado: sincronizacao com o Odoo ───────────────────
# O trabalho pesado mora em tools/almox/almox2lib.py; aqui so o disparo, o stdout dele
# virando SSE e o arquivo de credenciais.
#
# hub-almox.json fica FORA do git e nunca sai por HTTP: o GET responde se ha senha
# gravada, nunca qual e. Gravar so de localhost, pela mesma regra do /api/config -
# quem escolhe as credenciais que o servidor usa tem que estar sentado nele.
ALMOX_CFG_FILE = 'hub-almox.json'
ALMOX_KEYS = ('url', 'db', 'login', 'senha')
ALMOX_SCRIPT = os.path.join('tools', 'almox', 'almox2lib.py')
ALMOX_TIMEOUT = 600.0          # segundos: Odoo mudo nao pode prender o hub para sempre

_almox_runs = {}
_almox_lock = threading.Lock()


def _almox_cfg_read():
    try:
        with open(os.path.join(ROOT, ALMOX_CFG_FILE), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: data[k] for k in ALMOX_KEYS if isinstance(data.get(k), str)}


@app.route('/api/almox/config', methods=['GET'])
def api_almox_config_get():
    cfg = _almox_cfg_read()
    return {'ok': True, 'config': {
        'url': cfg.get('url', ''), 'db': cfg.get('db', ''), 'login': cfg.get('login', ''),
        # a senha nunca atravessa a rede de volta; o hub so precisa saber se existe
        'temSenha': bool(cfg.get('senha') or os.environ.get('ODOO_SENHA')),
    }, 'local': _is_local(request), 'script': os.path.isfile(os.path.join(ROOT, ALMOX_SCRIPT))}


@app.route('/api/almox/config', methods=['POST'])
def api_almox_config_set():
    if not _is_local(request):
        return {'ok': False, 'error': 'as credenciais do Odoo so mudam no PC do servidor'}, 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON obrigatorio'}, 400
    cfg = _almox_cfg_read()
    for k in ALMOX_KEYS:
        if k in data:
            if not isinstance(data[k], str):
                return {'ok': False, 'error': '%s tem que ser texto' % k}, 400
            v = data[k].strip()
            # Campo em branco no formulario significa "nao mexe", nao "apaga". Valia so
            # para a senha; passou a valer para todos. Gravar "" por cima de uma url
            # valida nao limpa a configuracao: troca o Odoo com que a maquina fala --
            # antes, calado, pelo default cravado; hoje, virando erro no proximo
            # sincronismo. Quem quiser mesmo zerar apaga o hub-almox.json.
            if not v:
                continue
            cfg[k] = v
    full = os.path.join(ROOT, ALMOX_CFG_FILE)
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
        os.replace(tmp, os.path.realpath(full))
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar as credenciais: %s' % e}, 500
    return api_almox_config_get()


@app.route('/api/almox/sync', methods=['POST'])
def api_almox_sync():
    """Reserva a corrida. Quem executa e o stream, igual ao /api/run."""
    if not os.path.isfile(os.path.join(ROOT, ALMOX_SCRIPT)):
        return {'ok': False, 'error': 'tools/almox/almox2lib.py nao esta neste workspace'}, 404
    data = request.get_json(silent=True) or {}
    pull = bool(data.get('pull'))
    if pull and not (_almox_cfg_read().get('senha') or os.environ.get('ODOO_SENHA')):
        return {'ok': False, 'error': 'sem senha do Odoo gravada — configure antes de puxar '
                                      'ao vivo, ou sincronize a partir do snapshot'}, 400
    if _almox_lock.locked():
        return {'ok': False, 'error': 'ja tem uma sincronizacao rodando'}, 409
    run_id = 'a_%04x' % (int(time.time() * 1000) & 0xffff)
    if len(_almox_runs) > 8:            # corridas reservadas e nunca abertas
        _almox_runs.clear()
    _almox_runs[run_id] = pull
    return {'runId': run_id}, 202


@app.route('/api/almox/sync/<run_id>/stream')
def api_almox_sync_stream(run_id):
    if run_id not in _almox_runs:
        abort(404)
    pull = _almox_runs.pop(run_id)

    def stream():
        if not _almox_lock.acquire(blocking=False):
            yield 'event: error\ndata: %s\n\n' % json.dumps('ja tem uma sincronizacao rodando')
            return
        proc = None
        try:
            cmd = [sys.executable, os.path.join(ROOT, ALMOX_SCRIPT)] + (['--pull'] if pull else [])
            yield 'data: %s\n\n' % ('puxando o Odoo e regerando…' if pull
                                    else 'regerando do snapshot em disco…')
            env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
            proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT)
            limite = time.time() + ALMOX_TIMEOUT
            for raw in iter(proc.stdout.readline, b''):
                linha = raw.decode('utf-8', 'replace').rstrip()
                if linha:
                    yield 'data: %s\n\n' % linha.replace('\r', '')
                if time.time() > limite:
                    proc.kill()
                    yield 'event: error\ndata: %s\n\n' % json.dumps(
                        'passou de %d s e foi interrompida' % int(ALMOX_TIMEOUT))
                    return
            code = proc.wait()
            if code != 0:
                yield 'event: error\ndata: %s\n\n' % json.dumps(
                    'o gerador terminou com codigo %d — veja o log acima' % code)
                return
            yield 'event: done\ndata: {"ok":true}\n\n'
        except Exception as e:                                  # noqa: BLE001
            yield 'event: error\ndata: %s\n\n' % json.dumps(str(e))
        finally:
            if proc is not None and proc.poll() is None:
                proc.kill()
            _almox_lock.release()

    return Response(stream(), mimetype='text/event-stream')


# ------------------------------- o BOM servido por link -------------------------------
#
# O BOM nao e mais um arquivo que se baixa: e a URL /bom/<proj_id>. Nada fica gravado em
# lugar nenhum. A rota devolve um bootstrap curto que carrega o hub-bom.js ATUAL, o
# os espelhos do projeto e o estado da bancada, e monta o documento no navegador de quem
# abriu. E dai que vem a propriedade que se queria: mexer no gerador melhora o BOM de
# TODOS os projetos no mesmo instante, porque nao existe copia velha para regerar.
#
# O preco e depender do servidor no ar. Foi uma troca deliberada: o link tem que abrir do
# tablet da bancada e de qualquer maquina da rede, e amanha de um servidor de verdade --
# nada disso um arquivo na pasta de Downloads de alguem faz.

_bom_lock = threading.Lock()   # os vistos chegam de varias maquinas ao mesmo tempo


def _proj_dir_by_id(proj_id):
    """A pasta de Projects/ cujo slug bate com proj_id, ou None.

    Usa o MESMO _proj_id do indice: o link /bom/<id> carrega o id que o resto da API ja
    usa, em vez de inventar um segundo esquema de nomes para o mesmo projeto.
    """
    pdir = os.path.join(ROOT, 'Projects')
    if not os.path.isdir(pdir):
        return None
    for name in sorted(os.listdir(pdir)):
        d = os.path.join(pdir, name)
        if os.path.isdir(d) and _proj_id(name) == proj_id:
            return d
    return None


def _bom_json_read(d, fname):
    """Estado ilegivel vira estado VAZIO, nunca erro: um bom-vistos.json corrompido nao
    pode derrubar a pagina que serve para montar a placa."""
    try:
        with open(os.path.join(d, fname), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _bom_json_write(d, fname, data):
    """Grava atomico: dois tablets marcando junto nunca deixam meio arquivo no disco."""
    full = os.path.join(d, fname)
    tmp = full + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(full))


def _bom_tag(data):
    """Token de versao do estado: hash do CONTEUDO, nao mtime.

    O mtime nao serve aqui. Dois vistos marcados no mesmo milissegundo saem com o mesmo
    st_mtime_ns no NTFS, e a outra maquina perderia o segundo -- justamente o caso de duas
    pessoas montando a mesma placa. O hash muda exatamente quando o conteudo muda, que e a
    unica pergunta que a pagina faz, e sobrevive a reinicio do servidor.
    """
    bruto = json.dumps(data, sort_keys=True, ensure_ascii=False).encode('utf-8')
    return hashlib.md5(bruto).hexdigest()[:12]


def _bom_source_rev(d):
    """Revisao dos dois espelhos: o BOM muda com a PCB ou com o esquema."""
    stamps = []
    for fname in ('board.js', 'schematic.js'):
        try:
            st = os.stat(os.path.join(d, fname))
            stamps.append((st.st_mtime_ns, st.st_size))
        except OSError:
            stamps.append(None)
    return _bom_tag(stamps)


def _bom_source(d):
    """Geometria da PCB com os dados de compra do espelho mais recente.

    Um comment alterado no esquema deve chegar a bancada antes do proximo ECO/ExportBoard.
    Quando a PCB for exportada depois, os dados dela passam a prevalecer. A geometria e a
    presenca fisica de componentes continuam vindo da PCB.
    """
    board_path = os.path.join(d, 'board.js')
    sch_path = os.path.join(d, 'schematic.js')
    board = load_var_file(board_path)
    if os.path.isfile(sch_path) and os.stat(sch_path).st_mtime_ns >= os.stat(board_path).st_mtime_ns:
        sch = load_var_file(sch_path)
        por_ref = {it.get('ref'): it for it in sch.get('items', [])
                   if isinstance(it, dict) and it.get('t') == 'comp' and it.get('ref')}
        for comp in board.get('components', []):
            origem = por_ref.get(comp.get('ref'))
            if origem:
                for campo in ('comment', 'footprint'):
                    if campo not in origem:
                        continue
                    # footprint VAZIO no esquema e "sem vinculo, defina no Altium" (o hub grava
                    # assim o componente sem footprint conhecido; ver AI-GUIDE), e nao "a placa
                    # nao tem footprint": o da placa, que e o que o Altium definiu, fica
                    if campo == 'footprint' and not origem[campo]:
                        continue
                    comp[campo] = origem[campo]
    return board


@app.route('/api/bom/<proj_id>/source')
def api_bom_source(proj_id):
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    if not os.path.isfile(os.path.join(d, 'board.js')):
        return {'ok': False, 'error': 'board.js ausente'}, 404
    try:
        for _ in range(3):
            antes = _bom_source_rev(d)
            board = _bom_source(d)
            rev = _bom_source_rev(d)
            if antes == rev:
                return {'ok': True, 'board': board, 'sourceRev': rev}
    except (OSError, ValueError) as e:
        return {'ok': False, 'error': 'nao consegui ler os espelhos: ' + str(e)}, 500
    return {'ok': False, 'error': 'espelhos mudaram durante a leitura; tente Refresh'}, 503


BOM_BOOTSTRAP = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOM — %(projEsc)s</title>
<style>html,body{margin:0;height:100%%;background:#14161a;color:#e8e8ea;
  font:14px system-ui,Segoe UI,sans-serif}
#av{padding:24px;line-height:1.5}#av b{color:#ff9a9a}</style></head><body>
<div id="av">montando o BOM…</div>
<!-- A ORDEM importa: no browser o hub-bom.js le root.HubFont e root.HubLaser, que sao os
     dois arquivos acima. Fora do CommonJS ninguem resolve isso sozinho, e sem eles a
     pagina abre com "Cannot read properties of undefined (reading 'padPrim')". -->
<script src="/hub-font.js"></script>
<script src="/hub-laser.js"></script>
<script src="/hub-bom.js"></script>
<script>
(function(){
  var API = %(api)s, PROJ = %(projJson)s;
  function falha(m){ document.getElementById('av').innerHTML = '<b>' + m + '</b>'; }
  function pega(u){
    return fetch(u, { cache: 'no-store' })
      .then(function (r){ return r.ok ? r.json() : {}; })
      .catch(function (){ return {}; });
  }
  if (typeof HubFont === 'undefined' || typeof HubLaser === 'undefined')
    return falha('nao consegui carregar hub-font.js / hub-laser.js, de que o gerador depende');
  if (typeof HubBom === 'undefined') return falha('nao consegui carregar hub-bom.js');
  Promise.all([pega(API + '/source'), pega(API + '/opts'), pega(API + '/vistos')]).then(function (res){
    var r;
    if (!res[0] || !res[0].ok || !res[0].board)
      return falha((res[0] && res[0].error) || 'nao consegui carregar os dados do BOM');
    try {
      r = HubBom.gerar(res[0].board, (res[1] && res[1].opts) || null, {
        proj: PROJ,
        generated: res[0].board.generated || '',
        api: API,
        vistos: (res[2] && res[2].vistos) || {},
        rev: (res[2] && res[2].rev) || 0,
        sourceRev: res[0].sourceRev
      });
    } catch (e) { return falha('o gerador falhou: ' + (e && e.message)); }
    /* Troca o documento inteiro em vez de embutir num iframe: a URL continua sendo a do
       link, e Ctrl+F, impressao e o zoom do tablet funcionam como em pagina normal. Num
       iframe cada um desses vira um caso especial, e essa pagina vive na bancada. */
    document.open(); document.write(r.html); document.close();
  });
})();
</script>
</body></html>
"""


@app.route('/bom/<proj_id>')
def bom_page(proj_id):
    """A pagina do BOM do projeto, montada na hora pelo gerador atual."""
    d = _proj_dir_by_id(proj_id)
    if d is None:
        abort(404)
    name = os.path.basename(d)
    if not os.path.isfile(os.path.join(d, 'board.js')):
        return Response(
            '<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;padding:24px">'
            'O projeto <b>%s</b> ainda nao tem <code>board.js</code> — '
            'rode ExportPcb no Altium.' % name.replace('<', '&lt;'),
            mimetype='text/html', status=404)
    body = BOM_BOOTSTRAP % {
        'projEsc': name.replace('&', '&amp;').replace('<', '&lt;'),
        'projJson': json.dumps(name),
        'api': json.dumps('/api/bom/' + proj_id),
    }
    return Response(body, mimetype='text/html')


@app.route('/api/bom/<proj_id>/vistos', methods=['GET'])
def api_bom_vistos_get(proj_id):
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    vistos = _bom_json_read(d, BOM_VISTOS)
    return {'ok': True,
            'vistos': vistos,
            'rev': _bom_tag(vistos),
            'sourceRev': _bom_source_rev(d)}


@app.route('/api/bom/<proj_id>/vistos', methods=['POST'])
def api_bom_vistos_set(proj_id):
    """Marca e desmarca vistos da bancada.

    NAO e so-localhost, de proposito: quem monta a placa esta no tablet, e e ele que
    marca. Escreve um arquivo unico dentro da pasta do projeto, e o nome da pasta vem de
    _proj_dir_by_id (nada de caminho vindo do cliente).

    O corpo e um DELTA ({set:{chave:bool}}), nao o mapa inteiro: dois tablets marcando
    pecas diferentes ao mesmo tempo se somam, em vez de o ultimo apagar o do outro.
    """
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON {set:{...}} ou {clear:true} obrigatorio'}, 400
    mudar = data.get('set')
    if mudar is not None and not isinstance(mudar, dict):
        return {'ok': False, 'error': 'set tem que ser objeto'}, 400
    with _bom_lock:
        atual = {} if data.get('clear') else _bom_json_read(d, BOM_VISTOS)
        for k, v in (mudar or {}).items():
            if not isinstance(k, str) or not k or len(k) > 300:
                return {'ok': False, 'error': 'chave de visto invalida'}, 400
            if v:
                atual[k] = True
            else:
                atual.pop(k, None)   # desmarcar APAGA: o arquivo guarda o que foi feito, so
        if len(atual) > 20000:
            return {'ok': False, 'error': 'vistos demais para uma placa'}, 400
        try:
            _bom_json_write(d, BOM_VISTOS, atual)
        except OSError as e:
            return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
        return {'ok': True, 'vistos': atual, 'rev': _bom_tag(atual)}


@app.route('/api/bom/<proj_id>/opts', methods=['GET'])
def api_bom_opts_get(proj_id):
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    return {'ok': True, 'opts': _bom_json_read(d, BOM_OPTS) or None}


@app.route('/api/bom/<proj_id>/opts', methods=['POST'])
def api_bom_opts_set(proj_id):
    """As opcoes com que a aba gerou, para o link abrir do jeito que quem gerou escolheu.

    Sao preferencia de exibicao (tema, lados, o que aparece), nao dado de projeto -- por
    isso ficam em arquivo separado do board.js e podem ser reescritas a vontade.
    """
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    data = request.get_json(silent=True)
    opts = data.get('opts') if isinstance(data, dict) else None
    if not isinstance(opts, dict):
        return {'ok': False, 'error': 'JSON {opts:{...}} obrigatorio'}, 400
    if len(json.dumps(opts)) > 8000:
        return {'ok': False, 'error': 'opcoes grandes demais'}, 400
    try:
        _bom_json_write(d, BOM_OPTS, opts)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    return {'ok': True}


# O BOM que vale para a bancada pode morar noutro hub. O app desktop (electron/) roda um hub
# por PC, mas a referencia -- o projeto que a producao usa e os vistos que os tablets
# compartilham -- e o hub do servidor: com ALTIUMHUB_BOM_LINK=http://192.168.15.192:8100 o
# link copiado e o "abrir" apontam para la. Sem a variavel (o proprio servidor), nada muda.
BOM_LINK_BASE = (os.environ.get('ALTIUMHUB_BOM_LINK') or '').strip().rstrip('/')


def _bom_na_referencia(proj_id):
    """O hub de referencia tem o BOM deste projeto? True/False, ou None se nao respondeu.

    HEAD em /bom/<id>: la ele e 404 para projeto desconhecido E para projeto sem board.js,
    que sao exatamente os dois casos em que o link copiado abriria um erro no tablet.
    """
    import urllib.error
    import urllib.request
    try:
        req = urllib.request.Request(BOM_LINK_BASE + '/bom/' + proj_id, method='HEAD')
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        return False if e.code == 404 else None
    except Exception:                                    # noqa: BLE001 (rede, DNS, timeout)
        return None


def _bom_opts_para_referencia(d, proj_id):
    """Leva as opcoes do BOM gravadas aqui para o hub de referencia. Falhar e silencioso: o
    link abre do mesmo jeito, so com as opcoes de la."""
    import urllib.request
    opts = _bom_json_read(d, BOM_OPTS) if d else {}
    if not opts:
        return
    try:
        req = urllib.request.Request(BOM_LINK_BASE + '/api/bom/' + proj_id + '/opts',
                                     data=json.dumps({'opts': opts}).encode('utf-8'),
                                     headers={'Content-Type': 'application/json'}, method='POST')
        urllib.request.urlopen(req, timeout=3).close()
    except Exception:                                    # noqa: BLE001
        pass


@app.route('/api/bom/<proj_id>/link')
def api_bom_link(proj_id):
    """A URL do BOM deste projeto, no endereco que serve para OUTRA maquina.

    Quem abre o hub em 127.0.0.1 copiaria um link que so funciona no proprio PC -- e o
    ponto do link e justamente mandar para o tablet. Se o host do request ja e um
    nome/IP de rede (o caso do dia em que isso virar um servidor de verdade), fica como
    veio: o proprio Host: do request e a melhor pista de como se chega aqui.
    """
    if _proj_dir_by_id(proj_id) is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    if BOM_LINK_BASE:
        # O BOM de referencia e o do OUTRO hub (o do servidor): e la que a bancada inteira
        # abre e marca os vistos. O slug e o mesmo dos dois lados (_proj_id).
        r = {'ok': True, 'url': BOM_LINK_BASE + '/bom/' + proj_id, 'lan': True, 'trocado': False,
             'externo': True}
        if request.args.get('verificar') != '0':
            tem = _bom_na_referencia(proj_id)
            if tem:
                # As opcoes da aba (tema, lados, colunas) acabaram de ser gravadas AQUI pelo
                # copiarLink; o link abre LA. Repassa, como faria quem copiasse no servidor.
                _bom_opts_para_referencia(_proj_dir_by_id(proj_id), proj_id)
            if tem is False:
                r['aviso'] = ('o servidor nao tem este projeto (ou ele esta sem board.js): o link '
                              'abre um erro la ate o projeto chegar ao servidor')
            elif tem is None:
                r['aviso'] = 'o servidor nao respondeu agora; o link e o dele, confira quando ele voltar'
        return r
    host, _, porta = request.host.partition(':')
    trocado = False
    # Escutando so em 127.0.0.1 (app desktop sem "compartilhar na rede"), o IP de rede
    # daria um link morto: melhor o de loopback, que ao menos abre neste PC.
    if host in LOCAL_ADDRS and _ESCUTA_REDE:
        ip = _lan_ip()
        if ip:
            host, trocado = ip, True
    return {'ok': True,
            'url': 'http://' + host + (':' + porta if porta else '') + '/bom/' + proj_id,
            'lan': host not in LOCAL_ADDRS,
            'trocado': trocado}


# ─────────────────── biblioteca de símbolos (tools/symbols) ───────────────────
sys.path.insert(0, os.path.join(ROOT, 'tools', 'symbols'))
import symserver                     # noqa: E402
symserver.registra(app, ROOT)

# ─────────────── biblioteca remota (app desktop) ───────────────
# Com ALTIUMHUB_LIB_REMOTA=<hub central> a biblioteca e a do SERVIDOR: /api/symbols/*,
# /api/almox/config e o lib-subs.js vao para la, e Libs/ vira espelho dele para quem le do
# disco. Sem a variavel (o proprio servidor, a bancada) so existe o status dizendo "local".
# Fora do try de proposito: sem o modulo, o app subiria local calado -- e a biblioteca
# voltaria a divergir do servidor, que e o que o modo existe para impedir.
import libremota                     # noqa: E402
libremota.registra(app, ROOT, os.environ.get('ALTIUMHUB_LIB_REMOTA'))

# ─────────────────── placa nova (vista PCB » Placa nova) ───────────────────
# POST /api/board-novo: cria Projects/<nome>/ com o board.js MESTRE do hub-pcbnova.js. Nunca
# sobrescreve espelho do Altium (409). Sob try pelo mesmo motivo do Odoo abaixo.
try:
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'rotas'))
    import board_novo              # noqa: E402
    board_novo.registra(app, lambda: ROOT)
except Exception as _e:            # noqa: BLE001
    print('AVISO: placa nova desligada (%s) — falta tools/rotas/board_novo.py.' % _e)

# ─────────────────── Nexo Hub e NexoCAD: a biblioteca da rede e o CAD (tools/rotas/nexocad.py) ───────────────────
# /api/nexo/{estado,revisao,biblioteca,arquivo/<id>/<papel>} leem a biblioteca do Nexo Hub (o banco da rede);
# POST /api/nexo/{editar,placa} publicam no Nexo Hub e pedem ao NexoCAD (so desta maquina). Contrato: docs/INTEGRACAO-NEXOCAD.md.
try:
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'rotas'))
    import nexocad as _nexocad     # noqa: E402
    _nexocad.registra(app, ROOT, _is_local)
except Exception as _e:            # noqa: BLE001
    print('AVISO: integracao com o NexoCAD desligada (%s) — falta tools/rotas/nexocad.py.' % _e)

# ─────────────────── MCP: o canal da IA com a vista aberta (mcp/) ───────────────────
# /api/mcp/{status,pedido,pedidos,resposta/<id>}: o servidor MCP (mcp/eletrichub-mcp.js) pede
# screenshot/foco/comando a vista aberta; fila em memoria, nada em disco.
try:
    sys.path.insert(0, os.path.join(ROOT, 'mcp'))
    import rotas_hub as _mcp_rotas  # noqa: E402
    _mcp_rotas.registra(app, ROOT)
except Exception as _e:            # noqa: BLE001
    print('AVISO: rotas do MCP desligadas (%s) — falta mcp/rotas_hub.py.' % _e)

# ─────────────────── lista de componentes para o Odoo ───────────────────
# Sob try: o hub inteiro (laser, BOM, PCB) nao pode deixar de subir porque UM arquivo novo
# nao viajou no merge -- e o acidente que o CLAUDE.md descreve, e o hubserver.py e o unico
# arquivo aqui que e de outro dono. O aviso e alto de proposito: botao mudo e pior que erro.
try:
    import odoolista_server        # noqa: E402
    odoolista_server.registra(app, ROOT)
except Exception as _e:            # noqa: BLE001
    print('AVISO: envio da lista ao Odoo desligado (%s) — falta odoolista_server.py '
          'ou odoolista.py na raiz do workspace.' % _e)

# ─────────────────── chat do Claude dentro do hub (tools/chat) ──────────────────
# A senha mestre e a MESMA do "Excluir projeto" — e a unica que este hub tem, e o chat
# precisa de uma porque gasta dinheiro da conta do usuario a cada mensagem. No servidor ela
# vem do /etc/altiumhub/senha.env (o compose ja monta o arquivo); aqui na bancada cai no
# padrao que esta neste arquivo, e por isso o aviso abaixo existe: senha que esta no git nao
# tranca nada contra quem alcanca a maquina pela rede.
#
# Sob try pela mesma razao dos dois de cima: o hub inteiro nao pode deixar de subir porque um
# arquivo novo nao viajou num merge. Botao mudo e pior que erro — o aviso e alto de proposito.
try:
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'chat'))
    import chatserver                # noqa: E402
    chatserver.registra(app, ROOT, MASTER_PASSWORD)
    if not os.environ.get('ALTIUMHUB_MASTER'):
        print('AVISO: o chat esta usando a senha mestre PADRAO (a que esta no git). Numa '
              'maquina que outras pessoas alcancam, defina ALTIUMHUB_MASTER antes de subir.')
except Exception as _e:            # noqa: BLE001
    print('AVISO: chat do Claude desligado (%s) — falta tools/chat/chatserver.py.' % _e)

# ─────────────── lista de materiais do Odoo sobre o esquema (so leitura) ───────────────
# O caminho de volta do de cima: a BoM da PCB no Odoo vira vinculo para os componentes do
# projeto. Sob try pela mesma razao — um arquivo novo que nao viajou no merge nao pode
# impedir o hub inteiro de subir.


def configura_escuta(host):
    """O que muda quando o hub escuta so nesta maquina (--host 127.0.0.1).

    - o link do BOM nao troca o loopback pelo IP da rede (api_bom_link): la nada responde;
    - o Host: legitimo so pode ser o loopback. Sem isto uma pagina qualquer aberta no
      navegador do usuario, com um dominio que resolve para 127.0.0.1 (DNS rebinding), vira
      "mesma origem" do hub: le o hub-almox.json com a senha do Odoo e fala com o chat. Host
      fora da lista = 400, antes de qualquer rota.
    """
    global _ESCUTA_REDE
    _ESCUTA_REDE = host not in LOCAL_ADDRS
    app.config['TRUSTED_HOSTS'] = None if _ESCUTA_REDE else ['127.0.0.1', 'localhost', '::1', '[::1]']
    return _ESCUTA_REDE


def _lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))  # nao envia nada; so escolhe a interface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Servidor local do NexoEletric (AltiumPCBMirror)')
    ap.add_argument('--port', type=int, default=8000)
    # O padrao continua sendo a rede toda: e o que o servidor e a bancada usam. O app desktop
    # (electron/) passa 127.0.0.1 quando o usuario nao liga "compartilhar na rede".
    ap.add_argument('--host', default='0.0.0.0')
    args = ap.parse_args()
    configura_escuta(args.host)
    threading.Thread(target=_watcher, daemon=True).start()
    libremota.inicia()           # so faz algo com ALTIUMHUB_LIB_REMOTA
    print('NexoEletric:')
    print('  http://127.0.0.1:%d' % args.port)
    ip = _lan_ip() if _ESCUTA_REDE else None
    if ip:
        print('  http://%s:%d  (rede local; o Windows pode pedir firewall)' % (ip, args.port))
    app.run(host=args.host, port=args.port, threaded=True, debug=False)
