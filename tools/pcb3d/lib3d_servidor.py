# -*- coding: utf-8 -*-
"""Os corpos 3D da PcbLib da casa servidos SOB DEMANDA pelo hubserver, sem gerar nada no repo.

O hub (pcbframe.js na vista 3D, o editor de footprint) pede `Libs/pcblib-3d.js` e
`Libs/3d/<checksum>.step`. Quando esses arquivos nao existem na raiz (o normal: 330 modelos,
~290 MB de STEP, que nao viajam no git nem no instalador), o hubserver chama este modulo:

  * na primeira vez le a PcbLib (tools/libpath.py » pcblib: a publicada em
    Libs/Almox/FOOTPRINTS ALMOX.PcbLib, ou a do acervo) com o pcbdoc3d.le_biblioteca3d -- ~9 s
    para a BIBLIOTECA DE FOOTPRINT da casa -- e grava o pcblib-3d.js e os STEP numa pasta de
    CACHE local (nunca no acervo, nunca no repo): <cache>/<assinatura>/;
  * a assinatura e caminho + tamanho + mtime da PcbLib (+ o rename-map.js e a versao deste
    gerador): trocou a biblioteca, gera de novo;
  * as chamadas seguintes so servem o que esta no cache.

O CACHE SE CONSERTA SOZINHO (1.92.1). Ate a 1.92.0 ele morava no %TEMP%, e o Windows (Sensor de
Armazenamento, Limpeza de Disco, programas de limpeza) apagou 328 dos 330 STEP da maquina do dono e
deixou o pcblib-3d.js: o cache continuava "pronto" (o js e a marca de pronto), o modelo dava 404 e o
corpo 3D sumia -- o ESP32-WROOM-32D do editor de footprint, com o STEP posto e posicionado, ficava
so com os pads (pedido do dono, 2026-11-10). Agora:
  * o cache mora em %LOCALAPPDATA%\\NexoEletric\\pcblib3d (fora do Temp); sem LOCALAPPDATA (o
    servidor Linux), no tempdir de antes;
  * na primeira vez em cada processo, confere se cada modelo que o pcblib-3d.js lista esta la; e o
    STEP listado que sumir com o hub aberto e extraido de novo da PcbLib no pedido;
  * o STEP que a PcbLib atual nao tem (o footprint do hub que copiou o corpo de outra PcbLib) e
    procurado nos caches das outras assinaturas (e no do %TEMP% antigo) antes do 404.

OS NOMES SAO OS DO pcblib.js (1.92.1). O pcblib.js (tools/pcblib/pcblib2js.py) le o nome em cp1252 e
troca o nome antigo pelo padronizado do Libs/rename-map.js; o pcblib-3d.js saia com o nome cru da
PcbLib, e 124 footprints com corpo na PcbLib nunca achavam o corpo pelo nome (123 renomeados, como
'BARRA 7 VIAS FEMEA' -> 'CONE BARRA 7 VIAS FEMEA', e o 'TO–220AB', com o travessao 0x96 lido como
caractere de controle). Agora a chave vale com o nome padronizado E com o cru (apelido).

A PcbLib so e LIDA. Variavel ALTIUMHUB_3D_CACHE troca a pasta do cache.
"""
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import threading
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
for p in (AQUI, os.path.join(os.path.dirname(AQUI), 'pcbdoc'), os.path.dirname(AQUI)):
    if p not in sys.path:
        sys.path.insert(0, p)

# muda quando o pcblib-3d.js muda de forma (entra na assinatura: o cache antigo e refeito)
GERADOR = 'lib3d-servidor/2'
_trava = threading.Lock()
_feito = {}       # assinatura -> pasta pronta (e conferida neste processo)
_refeito = {}     # assinatura -> time.time() da ultima reextracao por arquivo que sumiu
REFAZ_INTERVALO = 30.0   # s: dois pedidos do mesmo STEP sumido nao extraem a PcbLib duas vezes


def _cache_antigo():
    return os.path.join(tempfile.gettempdir(), 'eletrichub-pcblib3d')


def raiz_cache():
    v = os.environ.get('ALTIUMHUB_3D_CACHE')
    if v:
        return v
    base = os.environ.get('LOCALAPPDATA')
    if base and os.path.isdir(base):
        return os.path.join(base, 'NexoEletric', 'pcblib3d')
    return _cache_antigo()


def pcblib(raiz):
    import libpath as LP
    try:
        p = LP.pcblib(raiz)
    except Exception:
        p = None
    return p if p and os.path.isfile(p) else None


def _marca(caminho):
    try:
        st = os.stat(caminho)
        return '%d|%d' % (st.st_size, int(st.st_mtime))
    except OSError:
        return '-'


def assinatura(caminho, raiz=None):
    st = os.stat(caminho)
    base = '%s|%d|%d' % (os.path.abspath(caminho), st.st_size, int(st.st_mtime))
    if raiz is not None:
        base += '|%s|%s' % (GERADOR, _marca(os.path.join(raiz, 'Libs', 'rename-map.js')))
    return hashlib.sha1(base.encode('utf-8')).hexdigest()[:16]


# ─── os nomes do pcblib.js ────────────────────────────────────────────────────
def renomes(raiz):
    """Libs/rename-map.js -> (fpRename, mergeFp), como o tools/pcblib/pcblib2js.py le"""
    try:
        with io.open(os.path.join(raiz, 'Libs', 'rename-map.js'), encoding='utf-8') as f:
            t = f.read()
        m = json.loads(t[t.index('{'):t.rstrip().rstrip(';').rindex('}') + 1])
    except (OSError, ValueError):
        return {}, {}
    return m.get('fpRename') or {}, m.get('mergeFp') or {}


def padroniza(footprints, fp_rename, fundidos=None):
    """{nome cru: corpo} -> o mesmo dict com o nome do pcblib.js tambem (o padronizado do rename-map,
    a regra do pcblib2js.padroniza: nome novo que ja existe na PcbLib nao e trocado). O nome cru
    fica como apelido (o board.js de uma placa antiga ainda o usa). Devolve {cru: padronizado}."""
    from collections import OrderedDict
    crus = set(footprints)
    feitos = {}
    extra = OrderedDict()
    for n, v in footprints.items():
        if fundidos and n in fundidos and fundidos[n] in crus:
            continue
        novo = fp_rename.get(n)
        if novo and novo != n and novo not in crus and novo not in extra:
            extra[novo] = v
            feitos[n] = novo
    footprints.update(extra)
    return feitos


# ─── o cache ──────────────────────────────────────────────────────────────────
_RX_FILE = re.compile(r'"file":"3d/([^"/\\]+)"')
_listados = {}    # caminho do js -> (mtime, set de nomes)


def listados(pasta):
    """os arquivos 3d/<nome> que o pcblib-3d.js da pasta referencia"""
    js = os.path.join(pasta, 'pcblib-3d.js')
    try:
        mt = os.stat(js).st_mtime
    except OSError:
        return set()
    c = _listados.get(js)
    if c and c[0] == mt:
        return c[1]
    try:
        with io.open(js, encoding='utf-8') as f:
            nomes = set(_RX_FILE.findall(f.read()))
    except OSError:
        nomes = set()
    _listados[js] = (mt, nomes)
    return nomes


def faltando(pasta):
    return sorted(n for n in listados(pasta) if not os.path.isfile(os.path.join(pasta, '3d', n)))


def _extrai(fonte, raiz, pasta, so_faltando=False):
    """le a PcbLib e grava o pcblib-3d.js + os STEP que faltam na pasta (com a trava pega)"""
    import pcbdoc3d as D
    d, arquivos, _ = D.le_biblioteca3d(fonte)
    d['source'] = os.path.basename(fonte)
    fp_rename, fundidos = renomes(raiz)
    padroniza(d['footprints'], fp_rename, fundidos)
    os.makedirs(os.path.join(pasta, '3d'), exist_ok=True)
    for nome, dados in arquivos.items():
        alvo = os.path.join(pasta, '3d', nome)
        if not os.path.isfile(alvo):
            tmp = alvo + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(dados)
            os.replace(tmp, alvo)
    js = os.path.join(pasta, 'pcblib-3d.js')
    if not (so_faltando and os.path.isfile(js)):
        tmp = js + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(D.pcblib3d_js(d))
        os.replace(tmp, js)   # por ultimo: o js pronto marca o cache inteiro como pronto


def prepara(raiz):
    """garante o cache da PcbLib atual -> a pasta (com pcblib-3d.js e 3d/), ou None sem PcbLib"""
    fonte = pcblib(raiz)
    if not fonte:
        return None
    ass = assinatura(fonte, raiz)
    pasta = _feito.get(ass)
    if pasta and os.path.isfile(os.path.join(pasta, 'pcblib-3d.js')):
        return pasta
    with _trava:
        pasta = os.path.join(raiz_cache(), ass)
        js = os.path.join(pasta, 'pcblib-3d.js')
        if not os.path.isfile(js):
            _extrai(fonte, raiz, pasta)
        elif faltando(pasta):
            # o js ficou e STEP sumiu (limpeza do Windows): extrai de novo so o que falta
            _extrai(fonte, raiz, pasta, so_faltando=True)
        _feito[ass] = pasta
        return pasta


def _refaz(raiz, pasta, nome):
    """o STEP listado no pcblib-3d.js sumiu com o hub aberto: extrai da PcbLib de novo"""
    fonte = pcblib(raiz)
    if not fonte:
        return
    ass = os.path.basename(pasta)
    with _trava:
        if os.path.isfile(os.path.join(pasta, '3d', nome)):
            return      # outro pedido ja refez
        if time.time() - _refeito.get(ass, 0) < REFAZ_INTERVALO:
            return
        _refeito[ass] = time.time()
        _extrai(fonte, raiz, pasta, so_faltando=True)


def _em_outro_cache(nome, pasta_atual):
    """o mesmo 3d/<nome> no cache de outra assinatura (outra PcbLib, ou a de antes), ou no do %TEMP%"""
    chave = lambda p: os.path.normcase(os.path.abspath(p))
    vistos = {chave(pasta_atual)} if pasta_atual else set()
    for r in (raiz_cache(), _cache_antigo()):
        try:
            subs = sorted(os.listdir(r))
        except OSError:
            continue
        for s in subs:
            p = os.path.join(r, s)
            if chave(p) in vistos:
                continue
            vistos.add(chave(p))
            if os.path.isfile(os.path.join(p, '3d', nome)):
                return p
    return None


def arquivo(raiz, rel):
    """'pcblib-3d.js' ou '3d/<nome>' -> (pasta, rel) para o send_from_directory, ou None"""
    rel = rel.replace('\\', '/')
    nome = None
    if rel != 'pcblib-3d.js':
        partes = rel.split('/')
        if len(partes) != 2 or partes[0] != '3d' or not partes[1] or partes[1].startswith('.'):
            return None
        nome = partes[1]
    pasta = prepara(raiz)
    if pasta and os.path.isfile(os.path.join(pasta, *rel.split('/'))):
        return pasta, rel
    if nome is None:
        return None
    if pasta and nome in listados(pasta):
        _refaz(raiz, pasta, nome)
        if os.path.isfile(os.path.join(pasta, '3d', nome)):
            return pasta, rel
    outra = _em_outro_cache(nome, pasta)
    return (outra, rel) if outra else None
