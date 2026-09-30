# -*- coding: utf-8 -*-
"""Onde mora um componente do almoxarifado (symserver » _resolve_almox), pelos três nomes que
o hub manda como "família".

    python3 tests/test_almox_resolve.py

O índice, o ledger e a .SchLib falam a família do ARQUIVO ("ESPECIAIS", "RESISTOR"). O hub
manda o NOME do símbolo aberto (o editor) ou a `familia` DELE (o botão direito do painel de
valores manda `s.familia || s.name`). Nos básicos a `familia` do símbolo é a do arquivo; nos
especiais não é, e o "Excluir da biblioteca…" de um item de "MICROCONTROLADOR [PINAGEM A
DEFINIR]" voltava 404 — "não está no espelho do almoxarifado" — com o item ali na tela
(2026-09-30). Espelhos sintéticos em memória: nada encosta em disco.
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import hubserver as H            # noqa: E402,F401  (o blueprint tem que vir registrado daqui)
import symserver as S            # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MCU = 'MICROCONTROLADOR [PINAGEM A DEFINIR]'
ESPELHOS = [
    ('Libs/almox-basicos.js', 'almoxBasicos', {'symbols': [
        {'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'valores': [
            {'id': 1, 'altium': 'SMD 0603 1K'}, {'id': 2, 'altium': 'SMD 0603 10K'}]}]}),
    ('Libs/almox-especiais.js', 'almoxEspeciais', {'symbols': [
        {'name': 'MICROCONTROLADOR [40P]', 'familia': 'MICROCONTROLADOR', 'valores': [
            {'id': 1, 'altium': 'PIC16F877A-I/P'}]},
        {'name': MCU, 'familia': 'MICROCONTROLADOR', 'valores': [
            {'id': 8, 'altium': 'PTH MCU 3.5KB 224 RAM 16 I/O PIC16F628A-E/P', 'fora': True},
            {'id': 15, 'altium': 'PIC16F628A-E/P'}]},
        {'name': 'TRANSISTOR', 'familia': 'TRANSISTOR', 'valores': [{'id': 1, 'altium': 'BC807'}]}]}),
]
FORA = 'PTH MCU 3.5KB 224 RAM 16 I/O PIC16F628A-E/P'


def onde(fam, comp):
    _e, fam_arq, sim, k, i, j = S._resolve_almox(fam, comp, ESPELHOS)
    return fam_arq, sim, k, i, j


def recusa(fam, comp):
    try:
        S._resolve_almox(fam, comp, ESPELHOS)
    except S._ErroAlmox as e:
        assert e.status == 404, e.status
        return str(e)
    raise AssertionError('"%s / %s" deveria ser recusado' % (fam, comp))


# 1. o caso do print: a `familia` do símbolo, nos especiais
assert onde('MICROCONTROLADOR', FORA) == ('ESPECIAIS', MCU, 1, 1, 0), onde('MICROCONTROLADOR', FORA)
assert onde('MICROCONTROLADOR', 'PIC16F628A-E/P') == ('ESPECIAIS', MCU, 1, 1, 1)
assert onde('MICROCONTROLADOR', 'PIC16F877A-I/P') == ('ESPECIAIS', 'MICROCONTROLADOR [40P]', 1, 0, 0), \
    'a familia casa com os DOIS símbolos; quem desempata é o componente'
print('(1) a familia do símbolo resolve nos especiais (o "Excluir" do print) ok')

# 2. os dois caminhos que já funcionavam continuam iguais
assert onde(MCU, FORA) == ('ESPECIAIS', MCU, 1, 1, 0), 'pelo nome do símbolo (o editor)'
assert onde('ESPECIAIS', FORA) == ('ESPECIAIS', MCU, 1, 1, 0), 'pela família do arquivo'
assert onde('RESISTOR', 'SMD 0603 10K') == ('RESISTOR', 'RESISTOR [SMD]', 0, 0, 1), 'básicos: familia = arquivo'
assert onde('RESISTOR [SMD]', 'SMD 0603 1K') == ('RESISTOR', 'RESISTOR [SMD]', 0, 0, 0)
assert onde('TRANSISTOR', 'BC807') == ('ESPECIAIS', 'TRANSISTOR', 1, 2, 0), 'nome sem sufixo, como antes'
print('(2) nome do símbolo e família do arquivo continuam valendo ok')

# 3. a familia não atravessa família: o componente tem de estar num símbolo DELA
assert 'não está no espelho' in recusa('RESISTOR', FORA)
assert 'não está no espelho' in recusa('MICROCONTROLADOR', 'SMD 0603 1K')
assert 'não está no espelho' in recusa('MICROCONTROLADOR', 'NAO EXISTE')
print('(3) familia errada ou componente inexistente continuam recusados ok')

print('\ntest_almox_resolve OK')
