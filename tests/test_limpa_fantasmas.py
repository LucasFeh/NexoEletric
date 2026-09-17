# -*- coding: utf-8 -*-
"""A limpeza em lote dos FANTASMAS — e o que ela se recusa a apagar.

    python tests/test_limpa_fantasmas.py

Fantasma e o valor que o Odoo ja nao manda: ele sobrevive no espelho so porque
`almox2lib >> numera_valores` o repesca do espelho ANTERIOR (saldo zero, `fora: true`).
Apagar do espelho corta essa unica fonte, e por isso e definitivo. A biblioteca do servidor
tinha 1318 deles em 2026-09-17 — um terco do acervo, resto da epoca em que o cadastro do
Odoo nao tinha padrao de nome e o mesmo item nascia duas vezes.

O que este teste prende:
  1. sem --apagar e RELATORIO: nao escreve um byte;
  2. --apagar tira os fantasmas SEGUROS e nao encosta em valor que veio do Odoo;
  3. fantasma EM USO num projeto fica de fora sozinho (apagar deixaria o componente orfao
     na folha), e so entra com --em-uso-tambem;
  4. antes de escrever, faz backup dos espelhos — apagar fantasma nao tem desfazer;
  5. o apagado entra no registro (Libs/almox-excluidos.json), como na rota do hub;
  6. E O QUE IMPORTA: depois de apagado, o repesque do `numera_valores` nao o traz de
     volta, porque ele deixou de estar no espelho anterior;
  7. a protecao do desenho no ledger NAO e destruida (o desenho fica, orfao).

Roda sem rede, sem Odoo e sem Altium, num workspace temporario.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import almox2lib as A            # noqa: E402
import guardiao as G             # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

FERRAMENTA = os.path.join(RAIZ, 'tools', 'almox', 'limpa_fantasmas.py')
ESPELHO = os.path.join('Libs', 'almox-basicos.js')

VIVO = 'SMD 0603 1K'                 # veio do Odoo: nao pode ser tocado
MORTO1 = 'SMD 0603 2K2'              # fantasma seguro
MORTO2 = 'SMD 0603 3K3'              # fantasma seguro, com desenho protegido
USADO = 'SMD 0603 4K7'               # fantasma EM USO num projeto
DESENHO = [{'part': 1, 'pins': [], 'graphics': [{'g': 'rect', 'x1': -1, 'y1': -1,
                                                 'x2': 1, 'y2': 1, 'solid': False}]}]


def valor(altium, label, vid, fora):
    v = {'id': vid, 'altium': altium, 'label': label, 'value': label, 'ord': None,
         'estoque': 0 if fora else 10, 'pkgs': ['0603'], 'footprint': 'RES 0603',
         'mouser': '', 'mpn': '', 'local': '', 'custo': 0,
         'itens': [] if fora else [{'odoo': 100 + vid, 'nome': label, 'estoque': 10}],
         'params': [{'n': 'Comment', 'v': label}]}
    if fora:
        v['fora'] = True
    return v


def foto(raiz):
    fora = {}
    for base, _d, arqs in os.walk(raiz):
        for a in arqs:
            p = os.path.join(base, a)
            try:
                st = os.stat(p)
            except OSError:
                fora[p] = None
                continue
            fora[p] = (st.st_size, st.st_mtime_ns)
    return fora


def roda(tmp, *args):
    r = subprocess.run([sys.executable, FERRAMENTA, '--raiz', tmp] + list(args),
                       capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    assert r.returncode == 0, 'saiu %d\n%s\n%s' % (r.returncode, r.stdout, r.stderr)
    return r.stdout


def valores_do_espelho(tmp):
    _var, esp = G.le_espelho_almox(os.path.join(tmp, ESPELHO))
    sim = esp['symbols'][0]
    return [v['altium'] for v in sim['valores']]


tmp = tempfile.mkdtemp(prefix='limpa-fantasmas-')
try:
    os.makedirs(os.path.join(tmp, 'Libs'))
    os.makedirs(os.path.join(tmp, 'Projects', 'PRJ - TESTE'))

    sim = {'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'grupo': 'basicos',
           'partcount': 1, 'parts': DESENHO, 'valores': [
               valor(VIVO, '1K', 1, False),
               valor(MORTO1, '2K2', 2, True),
               valor(MORTO2, '3K3', 3, True),
               valor(USADO, '4K7', 4, True)]}
    A.escreve_espelho(os.path.join(tmp, ESPELHO), 'almoxBasicos', 'Almoxarifado — Básicos',
                      [sim], '01/01/2026 00:00:00')

    # um projeto que usa o fantasma USADO — pelo `sym`, que e o `valores[].altium`
    with io.open(os.path.join(tmp, 'Projects', 'PRJ - TESTE', 'schematic.js'), 'w',
                 encoding='utf-8', newline='\n') as f:
        f.write('var schematic = {\n"format":"schmirror-v2",\n"project":"PRJ - TESTE",\n'
                '"units":"mil",\n"items":[\n'
                '{"t":"comp","sheet":"main","ref":"R7","sym":"%s","part":1,"x":100,"y":100,'
                '"rot":0,"footprint":"RES 0603","comment":"4K7"}\n]};\n' % USADO)

    # o ledger com o desenho protegido de um fantasma
    led = G.ledger_vazio()
    G._poe_prot(led, 'RESISTOR', MORTO2, DESENHO, 'hub', 'RESISTOR [SMD]')
    G.grava_ledger(tmp, led)

    # ── 1. relatorio nao escreve nada ────────────────────────────────────────
    antes = foto(tmp)
    saida = roda(tmp)
    assert 'total ................. 3' in saida, saida
    assert 'seguros para apagar ... 2' in saida, saida
    assert 'EM USO num projeto .... 1' in saida, saida
    assert 'RELATORIO APENAS' in saida, saida
    mexidos = [p for p in set(antes) | set(foto(tmp))
               if antes.get(p) != foto(tmp).get(p)]
    assert not mexidos, 'o relatorio escreveu: %s' % mexidos
    print('(1) relatorio conta 3 fantasmas (2 seguros, 1 em uso) e nao escreve nada ok')

    # ── 2/3/4/5. apagar os seguros ───────────────────────────────────────────
    saida = roda(tmp, '--apagar')
    assert 'backup dos espelhos em' in saida, saida
    restam = valores_do_espelho(tmp)
    assert VIVO in restam, 'apagou um valor que veio do Odoo!'
    assert USADO in restam, 'o fantasma EM USO tinha que ficar'
    assert MORTO1 not in restam and MORTO2 not in restam, restam
    assert len(restam) == 2, restam
    print('(2) apagou so os seguros; o do Odoo e o em uso ficaram ok')

    backups = [d for d in os.listdir(os.path.join(tmp, 'Libs'))
               if d.startswith('.backup-fantasmas-')]
    assert len(backups) == 1, backups
    velho = os.path.join(tmp, 'Libs', backups[0], 'almox-basicos.js')
    assert MORTO1 in io.open(velho, encoding='utf-8').read(), 'o backup nao tem o apagado'
    print('(3) backup dos espelhos feito ANTES de escrever ok')

    itens = A.carrega_excluidos(tmp)['itens']
    assert sorted(i['altium'] for i in itens) == sorted([MORTO1, MORTO2]), itens
    assert all(i['motivo'].startswith('fantasma') for i in itens), itens
    print('(4) os apagados entraram no registro, com o motivo ok')

    # ── 7. a protecao do desenho sobreviveu ──────────────────────────────────
    led2 = G.carrega_ledger(tmp)
    assert MORTO2 in led2['protegidos'].get('RESISTOR', {}), \
        'a limpeza destruiu o desenho protegido — ela nao pode encostar no ledger'
    assert led2['protegidos']['RESISTOR'][MORTO2]['parts'], 'e com o desenho dentro'
    print('(5) o desenho protegido do apagado continua no ledger ok')

    # ── 6. o repesque nao traz de volta ──────────────────────────────────────
    # E a prova do contrato: `numera_valores` so ressuscita quem esta no espelho ANTERIOR.
    _var, esp = G.le_espelho_almox(os.path.join(tmp, ESPELHO))
    anterior = {s['name']: s for s in esp['symbols']}
    mapa = {'RESISTOR [SMD]': {'prox': 5, 'desde': {},
                               'ids': {'1K': 1, '2K2': 2, '3K3': 3, '4K7': 4}}}
    doodoo = [valor(VIVO, '1K', 0, False)]          # so o 1K vem do Odoo
    A.numera_valores('RESISTOR [SMD]', doodoo, mapa, anterior, False)
    nomes = [v['altium'] for v in doodoo]
    assert MORTO1 not in nomes and MORTO2 not in nomes, \
        'o fantasma apagado VOLTOU pelo repesque: %s' % nomes
    assert USADO in nomes, 'o fantasma que ficou no espelho tem que continuar sendo repescado'
    print('(6) apagado nao volta pelo repesque; o que ficou no espelho continua voltando ok')

    # ── 3b. --em-uso-tambem inclui o que estava segurado ─────────────────────
    saida = roda(tmp, '--apagar', '--em-uso-tambem')
    restam = valores_do_espelho(tmp)
    assert restam == [VIVO], restam
    print('(7) --em-uso-tambem apaga tambem o que estava em uso ok')

    # ── nada mais a fazer: a segunda passada e inofensiva ────────────────────
    saida = roda(tmp)
    assert 'nenhum fantasma' in saida, saida
    print('(8) sem fantasma sobrando, a ferramenta nao faz nada ok')

    print('test_limpa_fantasmas OK (apaga o fantasma, segura o em uso, e nao volta)')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
