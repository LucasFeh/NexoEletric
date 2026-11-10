# -*- coding: utf-8 -*-
"""O 3D da PcbLib servido sob demanda (tools/pcb3d/lib3d_servidor.py) quando o cache estraga e quando o
nome do footprint tem caractere especial.

    python tests/test_lib3d_servidor.py

O caso do dono (2026-11-10): o FP-ESP32-WROOM-32D-MFG ("ESP32-WROOM-32D - pads 1-38 com expansao de
mascara 0,05 mm (ponte de mascara 0,27 mm no passo 1,27)") com o STEP posicionado mostrava so os pads. O
cache dos STEP morava no %TEMP%; a limpeza do Windows apagou 328 dos 330 arquivos e deixou o
pcblib-3d.js, que era a marca de "pronto": o modelo dava 404 para sempre. E o pcblib-3d.js saia com o
nome cru da PcbLib, nao o do pcblib.js (rename-map e cp1252): 124 footprints nunca achavam o corpo.

Sem a PcbLib de verdade: o pcbdoc3d.le_biblioteca3d e trocado por um falso que conta as extracoes.
Tudo em tempfile.mkdtemp(); nada toca o cache do app.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import types

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'pcb3d'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'pcbdoc'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import pcbdoc3d as D_real                                   # noqa: E402
import lib3d_servidor as S                                  # noqa: E402

ESP32 = 'ESP32-WROOM-32D - pads 1-38 com expansao de mascara 0,05 mm (ponte de mascara 0,27 mm no passo 1,27)'
# o nome cru como o props() le (latin-1): o travessao 0x96 do Windows vira U+0096
TO220_CRU = 'TO\x96220AB'
ESPECIAIS = ['CONE MKDS 1,5/ 4-5,08', 'TSSOP-14_P0.65 (PW)', 'BOBINA POLARIZAÇAO', 'RES 5W 10Ω ±5% (°C) #1 & 2+3;x',
             'DISPLAY OLED 256X64 3.2"']
EXTRACOES = []


def corpo(mid):
    return {'owner': '', 'side': 'top', 'kind': 'step', 'layer': 'Mech1', 'color': '#808080', 'opacity': 1.0,
            'model': mid, 'name': mid + '.step', 'raw': {'x2d': 0, 'y2d': 0, 'rot2d': 0, 'rotx': 0, 'roty': 0, 'rotz': 0, 'dz': 0}}


def falso_le_biblioteca3d(fonte):
    from collections import OrderedDict
    EXTRACOES.append(fonte)
    nomes = [ESP32, D_real.cp1252(TO220_CRU), 'BARRA 7 VIAS FEMEA', 'LED 3MM - BLUE', 'LED 3MM - RED'] + ESPECIAIS
    fps = OrderedDict()
    arquivos = OrderedDict()
    models = OrderedDict()
    for i, n in enumerate(nomes):
        mid = '{M%d}' % i
        fps[n] = OrderedDict([('bodies', [corpo(mid)])])
        arq = '%d.step' % (1000 + i)
        models[mid] = {'file': '3d/' + arq, 'name': n + '.step', 'checksum': 1000 + i, 'bytes': 20}
        arquivos[arq] = b'ISO-10303-21; ' + n.encode('utf-8')
    d = OrderedDict([('format', 'pcblib3d-v1'), ('generator', 'teste'), ('source', fonte), ('units', 'mm'),
                     ('footprints', fps), ('models', models)])
    return d, arquivos, {}


def monta():
    raiz = tempfile.mkdtemp(prefix='lib3d-raiz-')
    os.makedirs(os.path.join(raiz, 'Libs', 'Almox'))
    lib = os.path.join(raiz, 'Libs', 'Almox', 'FOOTPRINTS ALMOX.PcbLib')
    with open(lib, 'wb') as f:
        f.write(b'\xd0\xcf\x11\xe0 falsa')
    with io.open(os.path.join(raiz, 'Libs', 'rename-map.js'), 'w', encoding='utf-8') as f:
        f.write('var renameMap = ' + json.dumps({'format': 'renamemap-v1', 'fpRename': {
            'BARRA 7 VIAS FEMEA': 'CONE BARRA 7 VIAS FEMEA', 'LED 3MM - RED': 'LED 3MM - BLUE'},
            'mergeFp': {'LED 3MM - BLUE': 'LED 3MM - RED'}}, ensure_ascii=False) + ';\n')
    return raiz, lib


def le_js(pasta):
    t = io.open(os.path.join(pasta, 'pcblib-3d.js'), encoding='utf-8').read()
    return json.loads(t[t.index('{'):t.rindex('}') + 1])


def main():
    feitos = []
    falso = types.ModuleType('pcbdoc3d')
    falso.le_biblioteca3d = falso_le_biblioteca3d
    falso.pcblib3d_js = D_real.pcblib3d_js
    sys.modules['pcbdoc3d'] = falso
    cache = tempfile.mkdtemp(prefix='lib3d-cache-')
    os.environ['ALTIUMHUB_3D_CACHE'] = cache
    raiz, lib = monta()
    pcblib_antes = S.pcblib
    S.pcblib = lambda r: lib if r == raiz else None
    try:
        # ── (1) cp1252: o travessao 0x96 lido em latin-1 volta ao '–' do pcblib.js ─────────────
        assert D_real.cp1252(TO220_CRU) == 'TO–220AB', repr(D_real.cp1252(TO220_CRU))
        assert D_real.cp1252('Peça (1,5) °µΩ') == 'Peça (1,5) °µΩ'      # sem byte 0x80-0x9F: igual
        assert D_real.cp1252('') == ''
        feitos.append('(1) nome cp1252 (TO–220AB) igual ao do pcblib.js')

        # ── (2) a primeira extracao: nomes com caractere especial intactos + o padronizado ──────
        pasta = S.prepara(raiz)
        assert len(EXTRACOES) == 1
        d = le_js(pasta)
        fps = d['footprints']
        for n in [ESP32, 'TO–220AB'] + ESPECIAIS:
            assert n in fps, 'faltou a chave %r' % n
        assert 'CONE BARRA 7 VIAS FEMEA' in fps and 'BARRA 7 VIAS FEMEA' in fps, 'o padronizado e o cru (apelido)'
        assert fps['CONE BARRA 7 VIAS FEMEA'] == fps['BARRA 7 VIAS FEMEA']
        assert 'LED 3MM - BLUE' in fps and fps['LED 3MM - BLUE']['bodies'][0]['model'] == '{M3}', 'nome novo que ja existe nao e trocado'
        assert len(S.listados(pasta)) == len(ESPECIAIS) + 5
        assert S.faltando(pasta) == []
        feitos.append('(2) pcblib-3d.js com o nome do pcblib.js (rename-map) e os especiais intactos')

        # ── (3) a limpeza do Windows apaga STEP com o hub aberto: o pedido extrai de novo ───────
        esp = d['models']['{M0}']['file'].split('/')[1]
        for n in os.listdir(os.path.join(pasta, '3d')):
            if n != '1001.step':
                os.remove(os.path.join(pasta, '3d', n))
        r = S.arquivo(raiz, '3d/' + esp)
        assert r and r[0] == pasta and os.path.isfile(os.path.join(pasta, '3d', esp)), r
        assert len(EXTRACOES) == 2 and S.faltando(pasta) == []
        # dois pedidos seguidos do mesmo arquivo sumido nao extraem a PcbLib duas vezes
        os.remove(os.path.join(pasta, '3d', esp))
        S._refeito[os.path.basename(pasta)] = __import__('time').time()
        assert S.arquivo(raiz, '3d/' + esp) is None and len(EXTRACOES) == 2
        S._refeito.clear()
        feitos.append('(3) STEP apagado com o hub aberto: extraido de novo no pedido (o caso do ESP32-WROOM-32D)')

        # ── (4) o hub reabre com o cache estragado (o js ficou, os STEP nao): prepara conserta ──
        S._feito.clear()
        for n in os.listdir(os.path.join(pasta, '3d')):
            os.remove(os.path.join(pasta, '3d', n))
        assert S.prepara(raiz) == pasta and len(EXTRACOES) == 3 and S.faltando(pasta) == []
        assert S.arquivo(raiz, '3d/' + esp) == (pasta, '3d/' + esp)
        assert len(EXTRACOES) == 3, 'arquivo presente: nada a extrair'
        feitos.append('(4) cache com o js e sem os STEP: refeito ao abrir')

        # ── (5) STEP de outra PcbLib (o footprint do hub copiou o corpo dela): outro cache ─────
        outra = os.path.join(cache, '0000outra')
        os.makedirs(os.path.join(outra, '3d'))
        with open(os.path.join(outra, '3d', '2475317612.step'), 'wb') as f:
            f.write(b'ISO-10303-21; outra')
        assert S.arquivo(raiz, '3d/2475317612.step') == (outra, '3d/2475317612.step')
        assert S.arquivo(raiz, '3d/123.step') is None and len(EXTRACOES) == 3, 'nao listado e sem copia: 404 sem extrair'
        assert S.arquivo(raiz, '3d/../x.step') is None and S.arquivo(raiz, '3d/.oculto') is None
        feitos.append('(5) modelo de outra PcbLib achado nos caches de outra assinatura')

        # ── (6) o rename-map (ou o gerador) mudou: outra assinatura, extracao nova ─────────────
        a1 = S.assinatura(lib, raiz)
        with io.open(os.path.join(raiz, 'Libs', 'rename-map.js'), 'a', encoding='utf-8') as f:
            f.write('// mudou\n')
        assert S.assinatura(lib, raiz) != a1
        feitos.append('(6) a assinatura leva o rename-map.js')

        # ── (7) o cache fora do %TEMP% ──────────────────────────────────────────────────────────
        del os.environ['ALTIUMHUB_3D_CACHE']
        loc = os.environ.get('LOCALAPPDATA')
        try:
            os.environ['LOCALAPPDATA'] = cache
            assert S.raiz_cache() == os.path.join(cache, 'NexoEletric', 'pcblib3d'), S.raiz_cache()
            os.environ.pop('LOCALAPPDATA')
            assert S.raiz_cache() == os.path.join(tempfile.gettempdir(), 'eletrichub-pcblib3d')
        finally:
            if loc is not None:
                os.environ['LOCALAPPDATA'] = loc
            os.environ['ALTIUMHUB_3D_CACHE'] = cache
        feitos.append('(7) cache em %LOCALAPPDATA%\\NexoEletric\\pcblib3d (o Temp so sem ele)')
    finally:
        S.pcblib = pcblib_antes
        sys.modules['pcbdoc3d'] = D_real
        os.environ.pop('ALTIUMHUB_3D_CACHE', None)
        S._feito.clear()
        shutil.rmtree(raiz, ignore_errors=True)
        shutil.rmtree(cache, ignore_errors=True)

    for f in feitos:
        print('  ' + f)
    print('test_lib3d_servidor OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
