# -*- coding: utf-8 -*-
"""A ordem única de resolução da biblioteca da casa e a publicação.

    python tests/test_libpath.py

Cobre o caminho que só existe NO SERVIDOR e que nenhum outro teste exercita: o
`tools/symbols/config.json` declarando um `Y:\\...` que aquele sistema não alcança, a
queda para a cópia publicada, a recusa de escrita e o `publica()`. A suíte inteira até
aqui só passava pelo ramo VIVA — o config dos outros testes aponta para uma cópia que
existe —, e é justamente no ramo do servidor que os defeitos moram.

Tudo em `tempfile.mkdtemp()`: nada toca a biblioteca versionada nem o `Y:`.
"""
import io
import json
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))

import libpath as LP                                   # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REAL = os.path.join(RAIZ, 'Libs', 'BIBLIOTECA DE ESQUEMA.SchLib')
# um caminho absoluto do Windows, como o config congelado em shared/ no servidor o declara
WIN = 'Y:' + chr(92) + 'Biblioteca' + chr(92) + 'ALTIUM LIBRARY ------ LUCAS' \
      + chr(92) + 'BIBLIOTECA DE ESQUEMA.SchLib'
# um caminho que ESTA maquina trata como absoluto, e que nao existe
SUMIDA = os.path.join(tempfile.gettempdir(), 'nao-existe-nunca', 'BIBLIOTECA DE ESQUEMA.SchLib')


def monta(cfg=None, com_lib=True):
    """uma raiz de mentira: Libs/ com (ou sem) a cópia publicada, e o config pedido"""
    raiz = tempfile.mkdtemp(prefix='libpath-')
    os.makedirs(os.path.join(raiz, 'Libs', 'Almox'))
    os.makedirs(os.path.join(raiz, 'tools', 'symbols'))
    if com_lib:
        shutil.copy2(REAL, os.path.join(raiz, 'Libs', 'BIBLIOTECA DE ESQUEMA.SchLib'))
    if cfg is not None:
        with io.open(os.path.join(raiz, 'tools', 'symbols', 'config.json'), 'w', encoding='utf-8') as f:
            f.write(json.dumps(cfg))
    LP.esquece_ausentes()
    return raiz


def main():
    if not os.path.isfile(REAL):
        print('test_libpath PULADO (nao achei %s)' % REAL)
        return 0
    feitos = []

    # ── (1) sem config nenhum: a cópia publicada, em silêncio ────────────────
    raiz = monta(cfg=None)
    try:
        cam, proc = LP.resolve_schlib(raiz)
        assert proc == LP.PUBLICADA, proc
        assert cam == LP.repo_schlib(raiz) and os.path.isfile(cam), cam
        assert LP.viva(raiz) == '', LP.viva(raiz)
        assert LP.e_publicada(raiz, cam)
        r = LP.publica(raiz, lambda *a: None)
        assert not r['publicou'] and 'nao declara' in r['motivo'], r
        feitos.append('(1) sem config -> cópia publicada, silenciosa')
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    # ── (2) config do Windows lido de outro sistema: cai no piso SEM ALARME ──
    # É o estado normal e eterno do servidor. Um ATENÇÃO aqui tocaria em toda rodada e
    # deixaria de servir para o caso que importa, o share caindo na bancada.
    raiz = monta(cfg={'schlib': WIN, 'backup_dir': WIN})
    try:
        cam, proc = LP.resolve_schlib(raiz)
        if os.name == 'nt':
            # No Windows o Y: e desta maquina, entao este ramo nao roda de verdade. Mas o
            # mecanismo que o decide e testavel aqui, e e o que precisa ficar amarrado: um
            # Y:\... NAO e absoluto para o posixpath, e o reconhecedor o pega mesmo assim.
            import posixpath
            assert not posixpath.isabs(WIN), 'se um dia virar absoluto, a ordem muda'
            assert LP._RX_WIN_ABS.match(WIN), 'o reconhecedor tem que pegar Y:'
            assert LP._RX_WIN_ABS.match(chr(92) * 2 + 'SERVIDOR'), 'e a UNC tambem'
            assert not LP._RX_WIN_ABS.match('Libs/BIBLIOTECA DE ESQUEMA.SchLib'), 'relativo nao'
            assert proc in (LP.VIVA, LP.SEM_VIVA), proc
            feitos.append('(2) no Windows o Y: e desta maquina; o reconhecedor do caminho '
                          'de outra maquina fica provado a parte')
        else:
            assert proc == LP.PUBLICADA, proc
            assert cam == LP.repo_schlib(raiz), cam
            # e o caminho declarado volta CRU, sem virar /raiz/Y:\Biblioteca\...
            assert LP.viva(raiz) == WIN, LP.viva(raiz)
            feitos.append('(2) config de outra máquina -> piso, sem alarme, caminho cru')
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    # ── (3) config desta máquina apontando para o vazio: SEM_VIVA (alarme) ──
    raiz = monta(cfg={'schlib': SUMIDA})
    try:
        cam, proc = LP.resolve_schlib(raiz)
        assert proc == LP.SEM_VIVA, proc
        assert cam == LP.repo_schlib(raiz), cam
        assert LP.viva(raiz) == SUMIDA, LP.viva(raiz)
        r = LP.publica(raiz, lambda *a: None)
        assert not r['publicou'] and r['motivo'] == 'lib viva fora de alcance', r
        feitos.append('(3) lib viva declarada e ausente -> SEM_VIVA, publica recusa com o motivo certo')
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    # ── (4) config apontando para uma lib viva que existe: ela ganha, e publica ──
    raiz = monta(cfg=None, com_lib=False)
    try:
        viva = os.path.join(raiz, 'fora', 'BIBLIOTECA DE ESQUEMA.SchLib')
        os.makedirs(os.path.dirname(viva))
        shutil.copy2(REAL, viva)
        with io.open(os.path.join(raiz, 'tools', 'symbols', 'config.json'), 'w', encoding='utf-8') as f:
            f.write(json.dumps({'schlib': viva}))
        LP.esquece_ausentes()
        cam, proc = LP.resolve_schlib(raiz)
        assert proc == LP.VIVA and cam == viva, (proc, cam)
        assert not LP.e_publicada(raiz, cam), 'a lib viva não é a publicada'

        assert not os.path.isfile(LP.repo_schlib(raiz)), 'a publicação ainda não existe'
        r = LP.publica(raiz, lambda *a: None)
        assert r['publicou'] and r['bytes'] == os.path.getsize(REAL), r
        with open(LP.repo_schlib(raiz), 'rb') as f1, open(REAL, 'rb') as f2:
            assert f1.read() == f2.read(), 'a publicação tem que ser byte a byte a lib viva'
        # segunda rodada: nada a fazer, e o arquivo não é reescrito
        antes = os.stat(LP.repo_schlib(raiz)).st_mtime_ns
        r = LP.publica(raiz, lambda *a: None)
        assert not r['publicou'] and r['motivo'] == 'ja publicada', r
        assert os.stat(LP.repo_schlib(raiz)).st_mtime_ns == antes, 'reescreveu sem precisar'
        feitos.append('(4) lib viva alcançável -> ganha, publica byte a byte, segunda rodada é no-op')
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    # ── (5) origem que não é CFBF: a publicação é recusada e o alvo não é tocado ──
    raiz = monta(cfg=None, com_lib=True)
    try:
        viva = os.path.join(raiz, 'fora', 'BIBLIOTECA DE ESQUEMA.SchLib')
        os.makedirs(os.path.dirname(viva))
        with open(viva, 'wb') as f:
            f.write(b'nao sou um conteiner OLE2' * 100)
        with io.open(os.path.join(raiz, 'tools', 'symbols', 'config.json'), 'w', encoding='utf-8') as f:
            f.write(json.dumps({'schlib': viva}))
        LP.esquece_ausentes()
        bom = open(LP.repo_schlib(raiz), 'rb').read()
        r = LP.publica(raiz, lambda *a: None)
        assert not r['publicou'] and r['motivo'] == 'copia inconsistente', r
        assert open(LP.repo_schlib(raiz), 'rb').read() == bom, 'a publicação boa foi destruída'
        assert not [f for f in os.listdir(os.path.join(raiz, 'Libs')) if f.endswith('.tmp')], 'tmp órfão'
        feitos.append('(5) origem que não é CFBF -> recusa, publicação anterior intacta, sem tmp órfão')
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    # ── (6) o explícito manda, e nem precisa existir (os testes contam com isso) ──
    raiz = monta(cfg={'schlib': WIN})
    try:
        cam, proc = LP.resolve_schlib(raiz, explicito=SUMIDA)
        assert (cam, proc) == (SUMIDA, LP.EXPLICITO), (cam, proc)
        os.environ[LP.ENV_SCHLIB] = REAL
        try:
            LP.esquece_ausentes()
            cam, proc = LP.resolve_schlib(raiz)
            assert (cam, proc) == (REAL, LP.ENV), (cam, proc)
        finally:
            del os.environ[LP.ENV_SCHLIB]
        feitos.append('(6) explícito > env > config > piso')
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    # ── (7) e_publicada não confunde raiz de teste com a cópia publicada ─────
    raiz = monta(cfg=None)
    try:
        dentro = os.path.join(raiz, 'lib', 'BIBLIOTECA DE ESQUEMA.SchLib')
        assert not LP.e_publicada(raiz, dentro), 'estar dentro da raiz não é ser a publicada'
        assert LP.e_publicada(raiz, LP.repo_schlib(raiz))
        assert LP.e_publicada(raiz, LP.repo_schlib(raiz).replace(os.sep, '/'))
        assert not LP.e_publicada(raiz, '')
        feitos.append('(7) e_publicada é o arquivo, não a árvore')
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    for f in feitos:
        print('  ' + f)
    print('test_libpath OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
