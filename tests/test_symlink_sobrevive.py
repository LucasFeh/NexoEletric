# -*- coding: utf-8 -*-
"""Gravação atômica não pode comer o symlink.

    python tests/test_symlink_sobrevive.py

No servidor, cada release do deploy é montada com o estado apontando para fora dela:

    /srv/altiumhub/releases/<hash>/Libs/lib-ledger.json -> /srv/altiumhub/shared/Libs/lib-ledger.json

É assim que o que o servidor escreve sobrevive ao `git push` (tools/deploy/deploy.sh »
COMPARTILHADOS_ARQ). Só que `os.replace(tmp, alvo)` sobre um symlink substitui **o link**, e
não o arquivo apontado: a release passa a ter uma cópia própria, o `shared/` congela no dia
em que o link quebrou, e o **deploy seguinte devolve aquele estado** — o trabalho feito desde
então some sem uma linha de erro.

Foi medido em 2026-09-16: o `shared/Libs/lib-ledger.json` do servidor estava parado em
08/09 17:17 com 1374 protegidos, enquanto a release no ar tinha 1380 numa cópia própria.
Quatro arquivos estavam assim — o ledger, os dois espelhos do almoxarifado e o resumo do
guardião —, ou seja exatamente o que a sincronização escreve.

O conserto é `os.replace(tmp, os.path.realpath(alvo))` em todos os 17 pontos que gravam desse
jeito: com link ele resolve, sem link não faz nada. Este teste prova o contrato nos três
escritores que mais doem, e serve de rede para os outros catorze.
"""
import json
import os
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import guardiao as G           # noqa: E402
import sch_leitor as L         # noqa: E402
import symserver as S          # noqa: E402


def monta(tmpdir, nome, conteudo=b'{}'):
    """cria shared/<nome> e release/<nome> -> shared/<nome>, como o deploy monta"""
    shared = os.path.join(tmpdir, 'shared')
    release = os.path.join(tmpdir, 'release')
    for d in (shared, release):
        if not os.path.isdir(d):
            os.makedirs(d)
    alvo = os.path.join(shared, nome)
    with open(alvo, 'wb') as f:
        f.write(conteudo)
    link = os.path.join(release, nome)
    os.symlink(alvo, link)
    return alvo, link


def confere(alvo, link, esperado_tem, quem):
    assert os.path.islink(link), \
        '%s: o symlink virou arquivo real — a release passou a ter cópia própria e o ' \
        'shared/ congelou (é exatamente o que fazia o deploy "voltar tudo")' % quem
    with open(alvo, 'rb') as f:
        bruto = f.read()
    assert esperado_tem in bruto, \
        '%s: escreveu, mas não no arquivo apontado pelo link' % quem
    assert not os.path.exists(link + '.tmp'), '%s: deixou o .tmp para trás' % quem


tmpdir = tempfile.mkdtemp(prefix='symlink-sobrevive-')

# O WINDOWS RECUSA symlink sem privilégio (WinError 1314), e a bancada é Windows. As seções
# de comportamento ficam para onde o deploy roda de verdade (o servidor, Linux); a varredura
# do fim roda em toda parte e é ela que protege os dezessete pontos de uma vez. Pular calado
# seria pior do que não ter teste: a linha abaixo diz, toda vez, o que não foi provado aqui.
def pode_symlink():
    try:
        a = os.path.join(tmpdir, '_probe')
        b = os.path.join(tmpdir, '_probe.lnk')
        with open(a, 'wb') as f:
            f.write(b'x')
        os.symlink(a, b)
        os.remove(b)
        return True
    except (OSError, NotImplementedError, AttributeError):
        return False


COM_LINK = pode_symlink()

if not COM_LINK:
    print('  --  este sistema não deixa criar symlink (Windows sem privilégio):')
    print('      as três provas de comportamento ficam para o servidor; a varredura roda.')

# ── 1. o ledger do guardião: o escritor que causou o incidente ────────────────
if COM_LINK:
    # grava_ledger recebe a RAIZ e monta Libs/lib-ledger.json dentro dela, então o
    # workspace de mentira precisa ter essa forma.
    raiz = os.path.join(tmpdir, 'ws')
    os.makedirs(os.path.join(raiz, 'Libs'))
    shared_led = os.path.join(tmpdir, 'shared-led.json')
    with open(shared_led, 'w', encoding='utf-8') as f:
        f.write('{}')
    link_led = os.path.join(raiz, 'Libs', 'lib-ledger.json')
    os.symlink(shared_led, link_led)

    led = G.ledger_vazio()
    led['protegidos'] = {'FAMILIA DE TESTE': {'COMPONENTE': {'origem': 'hub', 'parts': []}}}
    G.grava_ledger(raiz, led)
    confere(shared_led, link_led, b'FAMILIA DE TESTE', 'guardiao.grava_ledger')
    # e o que foi gravado continua legível pelo próprio guardião, pelo caminho do link
    assert sum(len(v) for v in G.carrega_ledger(raiz)['protegidos'].values()) == 1
    print('  ok  guardiao.grava_ledger grava ATRAVÉS do link')

    # ── 2. o gravador de bytes do symserver (schlib.js, .SchLib, symbols-lib.js) ──
    alvo2, link2 = monta(tmpdir, 'schlib.js', b'var schlib = {};')
    S._grava_bytes(link2, b'var schlib = {"marca": 1};')
    confere(alvo2, link2, b'marca', 'symserver._grava_bytes')
    print('  ok  symserver._grava_bytes grava ATRAVÉS do link')

    # ── 3. o gravador de texto do sch_leitor ──────────────────────────────────────
    alvo3, link3 = monta(tmpdir, 'symbols-lib.js', b'var symlib = {};')
    L._grava(link3, 'var symlib = {"marca": 2};')
    confere(alvo3, link3, b'marca', 'sch_leitor._grava')
    print('  ok  sch_leitor._grava grava ATRAVÉS do link')

    # ── 4. sem link nenhum (a bancada), nada muda ─────────────────────────────────
    solto = os.path.join(tmpdir, 'solto.js')
    with open(solto, 'wb') as f:
        f.write(b'antes')
    S._grava_bytes(solto, b'depois')
    with open(solto, 'rb') as f:
        assert f.read() == b'depois', 'arquivo comum tem de continuar sendo gravado normalmente'
    assert not os.path.islink(solto), 'não era link e não pode virar um'
    print('  ok  arquivo sem link continua igual (realpath é inofensivo na bancada)')

# ── 5. a varredura: nenhum os.replace(tmp, ...) sem realpath no código ────────
# É a parte que protege os catorze pontos que este teste não exercita um a um.
import re                                                            # noqa: E402
faltando = []
for base, _dirs, arqs in os.walk(RAIZ):
    if any(p in base for p in ('__pycache__', os.sep + '.git', os.sep + 'tests')):
        continue
    for a in arqs:
        if not a.endswith('.py'):
            continue
        cam = os.path.join(base, a)
        with open(cam, encoding='utf-8', errors='replace') as f:
            for n, linha in enumerate(f, 1):
                if re.search(r'os\.replace\(\s*tmp\s*,', linha) and 'realpath' not in linha:
                    faltando.append('%s:%d' % (os.path.relpath(cam, RAIZ), n))
assert not faltando, \
    'gravação atômica sem realpath (come o symlink do deploy): ' + ', '.join(faltando)
print('  ok  nenhum os.replace(tmp, ...) sem realpath em todo o repositório')

print('test_symlink_sobrevive OK')
