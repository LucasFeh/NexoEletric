# -*- coding: utf-8 -*-
"""Os corpos 3D da PcbLib da casa servidos SOB DEMANDA pelo hubserver, sem gerar nada no repo.

O hub (pcbframe.js na vista 3D, o editor de footprint) pede `Libs/pcblib-3d.js` e
`Libs/3d/<checksum>.step`. Quando esses arquivos nao existem na raiz (o normal: 330 modelos,
~290 MB de STEP, que nao viajam no git nem no instalador), o hubserver chama este modulo:

  * na primeira vez le a PcbLib (tools/libpath.py » pcblib: a publicada em
    Libs/Almox/FOOTPRINTS ALMOX.PcbLib, ou a do acervo) com o pcbdoc3d.le_biblioteca3d -- ~9 s
    para a BIBLIOTECA DE FOOTPRINT da casa -- e grava o pcblib-3d.js e os STEP numa pasta de
    CACHE local (nunca no acervo, nunca no repo): <tmp>/eletrichub-pcblib3d/<assinatura>/;
  * a assinatura e caminho + tamanho + mtime da PcbLib: trocou a biblioteca, gera de novo;
  * as chamadas seguintes so servem o que esta no cache.

A PcbLib so e LIDA. Variavel ALTIUMHUB_3D_CACHE troca a pasta do cache.
"""
import hashlib
import os
import sys
import tempfile
import threading

AQUI = os.path.dirname(os.path.abspath(__file__))
for p in (AQUI, os.path.join(os.path.dirname(AQUI), 'pcbdoc'), os.path.dirname(AQUI)):
    if p not in sys.path:
        sys.path.insert(0, p)

_trava = threading.Lock()
_feito = {}   # assinatura -> pasta pronta


def raiz_cache():
    return os.environ.get('ALTIUMHUB_3D_CACHE') or os.path.join(tempfile.gettempdir(), 'eletrichub-pcblib3d')


def pcblib(raiz):
    import libpath as LP
    try:
        p = LP.pcblib(raiz)
    except Exception:
        p = None
    return p if p and os.path.isfile(p) else None


def assinatura(caminho):
    st = os.stat(caminho)
    h = hashlib.sha1(('%s|%d|%d' % (os.path.abspath(caminho), st.st_size, int(st.st_mtime))).encode('utf-8'))
    return h.hexdigest()[:16]


def prepara(raiz):
    """garante o cache da PcbLib atual -> a pasta (com pcblib-3d.js e 3d/), ou None sem PcbLib"""
    fonte = pcblib(raiz)
    if not fonte:
        return None
    ass = assinatura(fonte)
    pasta = _feito.get(ass)
    if pasta and os.path.isfile(os.path.join(pasta, 'pcblib-3d.js')):
        return pasta
    with _trava:
        pasta = os.path.join(raiz_cache(), ass)
        js = os.path.join(pasta, 'pcblib-3d.js')
        if not os.path.isfile(js):
            import pcbdoc3d as D
            d, arquivos, _ = D.le_biblioteca3d(fonte)
            d['source'] = os.path.basename(fonte)
            os.makedirs(os.path.join(pasta, '3d'), exist_ok=True)
            for nome, dados in arquivos.items():
                alvo = os.path.join(pasta, '3d', nome)
                if not os.path.isfile(alvo):
                    tmp = alvo + '.tmp'
                    with open(tmp, 'wb') as f:
                        f.write(dados)
                    os.replace(tmp, alvo)
            tmp = js + '.tmp'
            with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
                f.write(D.pcblib3d_js(d))
            os.replace(tmp, js)   # por ultimo: o js pronto marca o cache inteiro como pronto
        _feito[ass] = pasta
        return pasta


def arquivo(raiz, rel):
    """'pcblib-3d.js' ou '3d/<nome>' -> (pasta, rel) para o send_from_directory, ou None"""
    rel = rel.replace('\\', '/')
    if rel != 'pcblib-3d.js':
        partes = rel.split('/')
        if len(partes) != 2 or partes[0] != '3d' or not partes[1] or partes[1].startswith('.'):
            return None
    pasta = prepara(raiz)
    if not pasta or not os.path.isfile(os.path.join(pasta, *rel.split('/'))):
        return None
    return pasta, rel
