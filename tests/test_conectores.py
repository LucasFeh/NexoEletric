# -*- coding: utf-8 -*-
"""O conector lido em campos: subtipo, vias, passo, angulo, genero, matriz e tipo.

Os casos abaixo sao NOMES REAIS do dump do Odoo, um por armadilha medida em 2026-09-22
sobre as 327 linhas de conector. Nao sao exemplos inventados: cada `assert` aqui
corresponde a um erro que o extrator cometeu antes de existir a linha que o conserta, e
e por isso que o nome feio do Odoo fica inteiro em vez de ser reduzido a um caso limpo.

Roda sem rede e sem Odoo: `python3 tests/test_conectores.py`.
"""
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import conectores as C                                  # noqa: E402

falhas = []


def eq(achado, esperado, porque):
    if achado != esperado:
        falhas.append('%s\n     esperado %r, veio %r' % (porque, esperado, achado))


def main():
    # ── subtipo ───────────────────────────────────────────────────────────────
    eq(C.subtipo('Conector Header C/Trava 26 vias (2x13) Passo 2.54mm 180'),
       'HEADER COM TRAVA', 'com trava vem antes do header generico')
    eq(C.subtipo('Conector Header S/ trava 10 vias (2x5) 180 Passo 2,54mm'),
       'HEADER SEM TRAVA', 'sem trava vem antes do header generico')
    eq(C.subtipo('Conector Macho MSTB 2,5/ 8-GF-5,08 (1776566)'), 'BLOCO TERMINAL',
       'metade dos blocos terminais nao tem a palavra: so a serie Phoenix identifica')
    eq(C.subtipo('Conector AKZ 602 04 3,81 V Macho'), 'BLOCO TERMINAL',
       'o clone AKZ tambem e bloco terminal')
    eq(C.subtipo('Carcaca De Conector Inserto - [HC-D 15-ESTC 1772324]'), 'ACESSORIO',
       'carcaca e PARTE de conector: o acessorio vem antes de todos')
    eq(C.subtipo('Regua Terminal Nylon C/Fix. BBPTC-12 [12 vias]'), 'REGUA TERMINAL',
       'a regua tem "terminal" no nome e nao pode cair em BLOCO TERMINAL')
    eq(C.subtipo('Conector 2 pinos CA06A10-4 (Shell 10) Baioneta Maojwei'), 'BAIONETA', '')
    eq(C.subtipo('Conector Alojamento [KK] - 2 vias 180 2.54mm Femea (2510)'), 'KK', '')
    eq(C.subtipo('Barra de Pinos Macho 1x40 2.54mm 90 (BPSN-40)'), 'BARRA DE PINOS', '')
    eq(C.subtipo('Conector Circular MIL Spec Amphenol - Macho 10 Pinos (MS3106A18-1P)'),
       'CIRCULAR MIL', '')
    eq(C.subtipo('Resistor 10K 1/4W'), '', 'o que nao e conector nao ganha subtipo')

    eq(C.familia_com_subtipo('CONECTOR', 'Conector Latch 10 vias (2x5) passo 2.54mm 180'),
       'CONECTOR LATCH', 'a familia e o que vira nome de .SchLib e linha da lista')
    eq(C.familia_com_subtipo('BARRA DE PINOS', 'Barra De Pinos Simples - 5 vias 2.54mm'),
       'CONECTOR BARRA DE PINOS', 'BARRA DE PINOS deixa de ser familia e vira subtipo')
    eq(C.familia_com_subtipo('RESISTOR', 'Resistor 10K'), 'RESISTOR',
       'familia que nao e de conector passa intacta')
    eq(C.familia_com_subtipo('CONECTOR', 'Conector Xpto Que Ninguem Cadastrou Ainda'),
       'CONECTOR', 'sem subtipo o degrade e a familia crua, nao um balde OUTROS')

    # ── vias ──────────────────────────────────────────────────────────────────
    eq(C.vias('Conector Bloco Terminal - MC 1.5/ 4-STF-3.81 (1827729)'), 4,
       'Phoenix: o numero DEPOIS da barra e a via; o 1.5 antes e bitola em mm2')
    eq(C.vias('Conector Macho MSTB 2,5/10-GF-5,08 (1776582)'), 10,
       'a bitola 2,5 nao pode ser lida como contagem')
    eq(C.vias('Conector Femea MSTB 2,5 HC/ 4-STF (1912090)'), 4,
       'a serie de alta corrente mete um HC entre a bitola e a barra')
    eq(C.vias('Conector de Bloco MKDSO 2,5HV/ 2L-7.5 KMGY - lado esquerdo (2199676)'), 2,
       'e a de alta tensao mete um HV colado')
    eq(C.vias('Conector Latch 26 vias (2x13) passo 2.54mm 180'), 26, 'a palavra ganha da matriz')
    eq(C.vias('Conector Header C/Trava 32 vias (4x8) Passo 1.27mm 180'), 32, '')
    eq(C.vias('Barra de Pinos Macho 1x40 2.54mm 90 (BPSN-40)'), 40, 'a matriz 1x40 e a fonte')
    eq(C.vias('Conector Header C/Trava 100 vias (4x25) Passo 1.27mm 180'), 100,
       'o teto de 80 cortava peca que existe: o header de 100 vias')
    eq(C.vias('Conector AKZ 602 04 3,81 V Macho'), 4, 'AKZ escreve os grupos soltos')
    eq(C.vias('Conector Bloco Terminal EK508V-02P'), 2, 'o clone escreve -NNP no fim')
    eq(C.vias('Conector DB25 Trapezoidal Femea PCB TE (1-5745967-0)'), 25, 'DB25 diz 25')
    eq(C.vias('Soquete Torneado Para CI  - DIP 40'), 40, '')
    eq(C.vias('Conector WEIPU SA2810 + SA2813 16 Pin (Set Header+Conector)'), 16,
       '"16 Pin", no singular ingles, tambem e contagem')
    eq(C.vias('Borne PCB de para PCB push-button 1.5 mm 2-polos Push-in WAGO (250-502)'), 2,
       '"2-polos", com hifen')
    eq(C.vias('Conector modular Ethernet Jack RJ45 P/ PCB'), 8,
       'o "P/" nao e contagem — era daqui que vinha o simbolo fantasma CONECTOR 45V')
    eq(C.vias('Conector jack painel 5.5 x 2.5mm femea'), 3,
       'o "5.5 x 2.5mm" e medida, nao matriz: sem recusar decimal isto virava 10 vias')
    eq(C.vias('Conector Bloco Terminal GMKDS-1,5/-2 (1717020)'), 2, '')
    eq(C.vias('Conector de Reducao - 1" x 15mm'), 0, 'o que o nome nao diz volta 0, nao chute')

    eq(C.matriz('Conector Latch 26 vias (2x13) passo 2.54mm 180'), '2x13', '')
    eq(C.matriz('Barra de Pinos Femea 2X4 2.54mm 180'), '2x4',
       '1x8 e 2x4 tem 8 vias os dois e footprints diferentes: a matriz nao pode sumir')
    eq(C.matriz('Conector jack painel 5.5 x 2.5mm femea'), '', 'medida decimal nao e matriz')

    # ── passo ─────────────────────────────────────────────────────────────────
    eq(C.passo('Conector Latch 26 vias (2x13) passo 2.54mm 180'), 2.54,
       '2,54 NAO pode encaixar em 2,5: sao os dois passos de catalogo, polegada e metrico')
    eq(C.passo('Conector Latch 10 vias (2x5) passo 1.27mm 180'), 1.27, 'idem 1,27 contra 1,25')
    eq(C.passo('Conector Bloco Terminal - MC 1,5/2-STF-3,81 (1827703)'), 3.81,
       'o sufixo do part number e a pista, e o 1,5 da frente e bitola')
    eq(C.passo('Conector Bloco Terminal MSTB 2,5/ 3-GF-5,0 (1776702)'), 5.08,
       '"5,0" e digitacao de 5,08 — encaixa porque 5,0 nao e passo de catalogo nenhum')
    eq(C.passo('Conector Bloco Terminal MSTB 2,5/17-STF-5,8 (1778137)'), None,
       '"5,8" fica de fora: a 0,72 mm ja nao da para afirmar qual era')
    eq(C.passo('Conector Macho MSTBV 5.08/10P GF (1777154)'), 5.08,
       'nesta serie o numero ANTES da barra e mesmo o passo (3 linhas em 113)')
    eq(C.passo('Conector Bloco Terminal Macho KF350-3,50-2P'), 3.5, 'o codigo do clone crava')
    eq(C.passo('Borne Branco Com Rosca Para Pino 2mm 116779 BO506'), None,
       'o "2mm" do borne banana e o DIAMETRO DO PINO, nao passo')
    eq(C.passo('Conector Circular MIL Spec Amphenol - Macho 10 Pinos (MS3106A18-1P)'), None,
       'em circular MIL o passo nao existe como propriedade: vazio e resposta')
    eq(C.passo_txt(5.08), '5.08', '')
    eq(C.passo_txt(3.5), '3.5', 'sem zero a direita')
    eq(C.passo_txt(None), '', '')

    # ── angulo ────────────────────────────────────────────────────────────────
    eq(C.angulo('Conector Latch 26 vias (2x13) passo 2.54mm 180'), 180, '')
    eq(C.angulo('Conector Header c/ trava 16 vias (2x8) 90 Passo 2,54mm'), 90, '')
    eq(C.angulo('Conector Bloco Terminal Macho MC 1,5/ 2-G-3,81 90 (1803277)'), 90,
       'o 180 do numero de pedido entre parenteses nao e angulo')
    eq(C.angulo('Conector Bloco Terminal - MC 1,5/ 8-STF-3,81 (1827761)'), 0,
       'o Odoo nao diz o angulo em 227 das 327 linhas, e ai nao se afirma nada')
    eq(C.angulo('Conector AKZ 700 02 5.08mm Vertical'), 180,
       'a palavra "Vertical" e do proprio catalogo, e a alternativa dele e escrita "90"')

    # ── genero ────────────────────────────────────────────────────────────────
    eq(C.genero('Conector Kk 4 vias macho, passo 3.96mm, 180 PTH'), 'macho', '')
    eq(C.genero('Conector Femea MSTB 2,5/ 5-STF-5,08 (1778014)'), 'femea', '')
    eq(C.genero('Conector Macho MSTB 2,5/ 3-GF-5,08 (1776511)'), 'macho', '')
    eq(C.genero('Conector Bloco Terminal - MC 1,5/2-STF-3,81 (1827703)'), 'femea',
       'Phoenix: ST/STF e plugue (femea), sem a palavra aparecer')
    eq(C.genero('Conector Bloco Terminal MC 1,5/3-GF-3,81 (1827871)'), 'macho',
       'Phoenix: G/GF e base (macho)')
    eq(C.genero('Conector Circular Mike 5 Vias Macho/Femea (par) [LS-3004-3011]'), '',
       'kit com os dois nao e nem um nem outro')

    # ── tipo (o codigo do fabricante) ─────────────────────────────────────────
    eq(C.tipo('Conector Bloco Terminal - MC 1,5/2-STF-3,81 (1827703)'), 'MC 1,5/2-STF-3,81',
       'o padrao Phoenix inteiro; o (1827703) e numero de PEDIDO, nao tipo')
    eq(C.tipo('Conector Alojamento [KK] -  2 vias 180 2.54mm Femea (2510)'), '2510',
       'o colchete [KK] e o nome do subtipo; a serie de verdade esta no parentese')
    eq(C.tipo('Conector Latch 10 vias (2x5) passo 2.54mm 180'), '',
       'o (2x5) e a matriz, que a linha ja mostra — devolve-la seria repetir')
    eq(C.tipo('Regua Terminal Nylon C/Fix. BBPTC-4 [4 vias]'), 'BBPTC-4',
       'o colchete aqui e a CONTAGEM: tres reguas de series diferentes ficavam iguais')
    eq(C.tipo('Conector AKZ 602 04 3,81 V Macho'), 'AKZ 602 04 3,81',
       'AKZ separa a serie por espaco, que o padrao geral nao atravessa')
    eq(C.tipo('Barra De Pinos Simples -  5 vias 180 2.54mm Macho'), '',
       'a barra simples nao tem codigo, e as vias/passo/angulo ja a separam')

    # ── o PADRAO NOVO do cadastro (2026-09-22) ────────────────────────────────
    # Nomes reais do Odoo de producao, colhidos enquanto a faxina de nomes acontecia. O
    # cadastro novo escreve o passo como "P2.54mm", o angulo como "180g"/"90g" (graus) e a
    # trava sem o "c/". Medido nos 618 conectores de producao: 96 ja estavam no padrao novo
    # e o extrator lia ZERO angulos deles.
    eq(C.angulo('Barra de Pinos Simples 3 vias P2.54mm Macho 180g'), 180,
       '"180g" e graus; entre o 0 e o g nao ha fronteira de palavra, e era por isso que '
       'a alternativa solta do regex nao casava')
    eq(C.angulo('Barra de Pinos 10 vias P2.54mm Macho 90g'), 90, '')
    eq(C.passo('Barra de Pinos Simples 3 vias P2.54mm Macho 180g'), 2.54,
       'o "P" colado no numero nao atrapalha')
    eq(C.vias('Barra de Pinos Simples 3 vias P2.54mm Macho 180g'), 3, '')
    eq(C.genero('Barra de Pinos Simples 3 vias P2.54mm Macho 180g'), 'macho', '')

    eq(C.subtipo('Conector Header trava 2x5 10 vias P2.54mm 180g'), 'HEADER COM TRAVA',
       'o cadastro novo escreve so "Header trava", sem o "c/"')
    eq(C.subtipo('Conector Header sem trava 2x5 10 vias P2.54mm 180g'), 'HEADER SEM TRAVA',
       'e a regra afrouxada NAO pode engolir a peca oposta')
    eq(C.subtipo('Conector Header S/ trava 10 vias (2x5) 180 Passo 2,54mm'),
       'HEADER SEM TRAVA', 'nem a forma antiga dela')

    eq(C.passo('Barra de Pinos 5.08 linhas 10 vias Macho 180g'), 5.08,
       'passo escrito solto, sem o "mm"')
    eq(C.passo('Conector Femea MSTB 2,5 HC/ 4-STF (1912090)'), None,
       'mas o decimal solto de uma serie Phoenix e BITOLA, nao passo: 54 blocos terminais '
       'passariam a anunciar 2,5 mm se esta trava nao existisse')
    eq(C.passo('Conector Bloco Terminal MSTB 2,5/10-GF-5,08 (1776582)'), 5.08,
       'e o passo de verdade continua saindo do sufixo')

    # ── a linha que a tela monta ──────────────────────────────────────────────
    c = C.campos('Conector Bloco Terminal - MC 1.5/ 4-STF-3.81 (1827729)', 'CONECTOR')
    eq(C.rotulo_curto(c), '4 vias 3.81 femea', 'o pedido do usuario, sem inventar o angulo')
    c = C.campos('Conector Latch 26 vias (2x13) passo 2.54mm 180', 'CONECTOR')
    eq(C.rotulo_curto(c), '26 vias (2x13) 2.54 180', '')
    eq(C.campos('Resistor 10K', 'RESISTOR'), None, 'familia que nao e conector devolve None')

    if falhas:
        print('test_conectores FALHOU em %d caso(s):\n' % len(falhas))
        for f in falhas:
            print('  - %s\n' % f)
        return 1
    print('test_conectores OK (subtipo, vias, matriz, passo, angulo, genero, tipo, rotulo)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
