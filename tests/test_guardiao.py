# -*- coding: utf-8 -*-
"""O guardião da sincronização, provado em CÓPIAS num workspace temporário.

    python tests/test_guardiao.py

Monta um workspace de mentira com `DIAC ALMOX.SchLib` (1 componente) e `CAPACITOR
ALMOX.SchLib` (2), copiadas de Libs/Almox, mais os espelhos `almox-*.js`, e um gerador
INJETADO que faz o que o almox2lib faz: reescreve as libs com a geometria "do gerador" (a
que estava nelas) e repõe os espelhos como saíram dele. Prova, nesta ordem:

 (1) a primeira sincronização não protege nada e cria o ledger: `arquivos` com as duas libs,
     `gerado` POR SÍMBOLO do espelho, `protegidos` vazio; uma entrada por linha; o argv vai
     ao gerador; `Libs/almox-guardiao.js` nasce.
 (2) O ALTIUM NÃO SOBE (2026-09-14, e o aviso saiu em 2026-09-15): edição por fora
     (retângulo a mais no DIAC, via schlib_patch sem raiz) + sincronização não muda nada no
     hub — o ledger não ganha proteção nenhuma, o espelho sai byte a byte igual e a
     regeração desfaz a edição na .SchLib, sem avisar. Esta seção é a única prova de que o
     apagar é DE PROPÓSITO e não acidente. Só o comando MANUAL (`protege`) adota o desenho
     — e aí sim o espelho ganha a geometria, `origem: altium` e `protegidos: 1`.
 (3) segunda sincronização sem mudança mantém tudo (proteção, fp, desde, linha do espelho).
 (4) `libera` faz o gerador vencer na próxima; e o componente que volta ao desenho do gerador
     NO ALTIUM **continua protegido** — quem tira a proteção é o hub, não o Altium.

     espelho volta como 'novo' no fim do arquivo, com o stats acompanhando.
 (6) — o /save do hub não gerar "mudança do Altium" — está no tests/test_symserver.py.
"""
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import guardiao as G             # noqa: E402
import schlib_patch as P         # noqa: E402
import sch_leitor as L           # noqa: E402

sys.path.insert(0, os.path.join(RAIZ, 'tools'))
import libpath as LP             # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

FIXTURES = (r'D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\Libs\Almox', os.path.join(RAIZ, 'Libs', 'Almox'))
# A biblioteca da casa publicada dentro do repositorio (tools/libpath.py). Era um
# caminho de maquina (D:/ ou a UNC do PC do Lucas), entao este teste PULAVA em
# silencio em qualquer clone que nao fosse o da bancada -- inclusive no servidor.
LOCAL = os.path.join(RAIZ, 'Libs', 'BIBLIOTECA DE ESQUEMA.SchLib')
LIBS = ('DIAC ALMOX.SchLib', 'CAPACITOR ALMOX.SchLib')
GUARDIAO = os.path.join(RAIZ, 'tools', 'symbols', 'guardiao.py')
RECT = {'g': 'rect', 'x1': -120, 'y1': -90, 'x2': 120, 'y2': 90, 'solid': False}


def log(*a):
    print('   |', *a)


def le_bytes(p):
    with open(p, 'rb') as f:
        return f.read()


def igual(a, b):
    return not P.compara(P.esperado({'name': '', 'parts': a}), b)


def com_rect(parts, dx=0):
    mod = copy.deepcopy(parts)
    mod[0]['graphics'].append(dict(RECT, x2=RECT['x2'] + dx))
    return mod


def cli(*args):
    p = subprocess.run([sys.executable, GUARDIAO] + list(args), capture_output=True, text=True,
                       encoding='utf-8', errors='replace', env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    return p.returncode, (p.stdout or '') + (p.stderr or '')


src = next((d for d in FIXTURES if all(os.path.isfile(os.path.join(d, f)) for f in LIBS)), None)
espelhos_ok = all(os.path.isfile(os.path.join(RAIZ, 'Libs', f)) for f in G.ESPELHOS_ALMOX)
if not src or not espelhos_ok:
    print('test_guardiao PULADO (faltam DIAC/CAPACITOR ALMOX.SchLib ou os espelhos almox-*.js)')
    sys.exit(0)

tmp = tempfile.mkdtemp(prefix='guardiao-')
raiz = tmp
for d in (os.path.join('Libs', 'Almox'), os.path.join('tools', 'symbols'), 'casa'):
    os.makedirs(os.path.join(tmp, d))
for f in LIBS:
    shutil.copy2(os.path.join(src, f), os.path.join(tmp, 'Libs', 'Almox', f))
# O espelho copiado entra SEM as marcas do guardião. Ele é a saída do GERADOR neste teste
# (o `gerador` de mentira o repõe byte a byte a cada rodada), e o gerador nunca escreve
# `origem`/`protegidos`: quem as escreve é o `atualiza_espelhos`, depois. Copiar o espelho
# vivo com as marcas que rodadas reais deixaram nele fazia a primeira sincronização — a que
# começa com o ledger vazio — "tocar" os 39 símbolos marcados só para tirá-las, e a asserção
# de que nada é tocado quando nada está protegido quebrava por dado, não por código.
# O corte é no fim da linha e só das duas chaves; o resto do símbolo sai byte a byte igual.
# A origem NAO e mais so "altium": desde a inversao de 2026-09-14 quem grava protecao
# grava "hub", e em 2026-09-16 o lote historico de "altium" foi podado do ledger. Com o
# valor cravado aqui, as marcas "hub" passavam pelo filtro, entravam no espelho de
# partida e a primeira sincronizacao as tirava — quebrando por dado a asserção de que
# nada e tocado quando nada esta protegido, que e justamente o que esta secao prova.
SEM_MARCA = re.compile(rb', "origem": "[^"]*", "protegidos": \d+\}$', re.M)
pristine = {}
for f in G.ESPELHOS_ALMOX:
    with open(os.path.join(tmp, 'Libs', f), 'wb') as fh:
        fh.write(SEM_MARCA.sub(b'}', le_bytes(os.path.join(RAIZ, 'Libs', f))))
    pristine[f] = le_bytes(os.path.join(tmp, 'Libs', f))
casa = os.path.join(tmp, 'casa', 'BIBLIOTECA DE ESQUEMA.SchLib')
with open(os.path.join(tmp, 'tools', 'symbols', 'config.json'), 'w', encoding='utf-8') as f:
    json.dump({'schlib': casa, 'backup_dir': os.path.join(tmp, 'bk'), 'fontes': [], 'ignorar': []}, f)
with open(os.path.join(tmp, 'Libs', 'pcblib.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('var pcblib = {\n"format":"pcblib-v2",\n"footprints":[\n{"name":"RES 0805","pads":[]}\n]};\n')

arqs = dict(G.arquivos_almox(raiz))                      # familia -> caminho
cam_diac, cam_cap = arqs['DIAC'], arqs['CAPACITOR']
padrao = {cam: G.le_familia(cam) for cam in (cam_diac, cam_cap)}      # a geometria "do gerador"
comp = next(iter(padrao[cam_diac]))
chamadas = []


def gerador(argv, log_):
    """o almox2lib de mentira: reescreve as libs com a geometria do gerador e repõe os espelhos"""
    chamadas.append(list(argv))
    for cam, comps in padrao.items():
        lib = P.carrega(cam)
        for c, parts in comps.items():
            P.aplica(lib, {'name': c, 'parts': parts})
        P.grava(lib, cam, backup=False)
    for f, b in pristine.items():
        with open(os.path.join(tmp, 'Libs', f), 'wb') as fh:
            fh.write(b)
    log_('  (gerador de mentira: %d libs e %d espelhos reescritos)' % (len(padrao), len(pristine)))
    return 0


def espelho_sim(nome, arq='almox-basicos.js'):
    var, esp = G.le_espelho_almox(os.path.join(tmp, 'Libs', arq))
    return var, esp, next(s for s in esp['symbols'] if s['name'] == nome)


def linhas_espelho(arq='almox-basicos.js'):
    return le_bytes(os.path.join(tmp, 'Libs', arq)).split(b'\n')


def so_a_linha_mudou(antes, depois, prefixo):
    """as linhas iguais fora a do símbolo `prefixo` (json.dumps com espaço depois do ':')"""
    assert len(antes) == len(depois), '%d linhas antes, %d depois' % (len(antes), len(depois))
    alvo = b'{"name": ' + json.dumps(prefixo).encode() + b','
    for i, (a, d) in enumerate(zip(antes, depois)):
        if d.lstrip(b',').startswith(alvo):
            assert a != d, 'a linha de %s tinha que mudar' % prefixo
        else:
            assert a == d, 'linha %d mudou sem ser a de %s: %r' % (i, prefixo, d[:80])


try:
    # ── (1) primeira sincronização: nada protegido, o ledger nasce ──────────
    assert not os.path.isfile(G.caminho_ledger(raiz))
    r = G.sincroniza(['--pull', '--full'], log, raiz, gerador)
    assert r['ok'] and r['erro'] is None and r['gerados'] == 2 and r['arquivos'] == 2, r
    assert r['protegidos'] == [] and r['repostos'] == [] \
        and r['orfaos'] == [] and r['espelhos'] == []
    assert 'novos' not in r and 'liberados' not in r, 'saíram do resumo com a inversão'
    assert chamadas == [['--pull', '--full']], 'o argv vai ao gerador'
    assert r['recicladoDe'], 'de onde o gerador reciclaria'
    led = G.carrega_ledger(raiz)
    assert led['format'] == 'ledger-v1' and led['atualizado']
    assert set(led['arquivos']) == {'Libs/Almox/CAPACITOR ALMOX.SchLib', 'Libs/Almox/DIAC ALMOX.SchLib'}, list(led['arquivos'])
    gerado_1 = {'CAPACITOR': G.fp_parts(next(iter(padrao[cam_cap].values()))), 'DIAC [PTH]': G.fp_parts(padrao[cam_diac][comp])}
    assert dict(led['gerado']) == gerado_1, led['gerado']
    assert led['protegidos'] == {}
    for cam in (cam_diac, cam_cap):
        m, conhecido, st = G.mudou(led, raiz, cam)
        assert conhecido and not m and st['size'] == led['arquivos'][G.chave_arquivo(raiz, cam)]['size']
    txt = open(G.caminho_ledger(raiz), encoding='utf-8').read()
    assert txt.startswith('{"format":"ledger-v1","atualizado":"') and txt.endswith('}}\n')
    assert '\n "Libs/Almox/DIAC ALMOX.SchLib":{"mtime":' in txt and '\n "DIAC [PTH]":"%s"' % gerado_1['DIAC [PTH]'] in txt
    # as TRÊS seções de decisão humana, vazias e uma por linha. `footprints` entrou em
    # 2026-09-17 (o footprint escolhido à mão, que o gerador tem de preservar) e `padroes` em
    # 2026-09-25 (o símbolo da biblioteca que é o desenho padrão da categoria); elas precisam
    # aparecer AQUI porque `dumps_ledger` é uma lista fechada de seções — o que ela não
    # escrever some do disco em silêncio, e foi assim que a primeira versão se perdeu.
    assert '\n"protegidos":{\n},\n"footprints":{\n},\n"padroes":{\n}}' in txt, txt[-120:]
    resumo = G.le_resumo(raiz)
    assert resumo and resumo['ok'] and resumo['gerados'] == 2 and resumo['protegidos'] == []
    assert le_bytes(os.path.join(tmp, 'Libs', 'almox-basicos.js')) == pristine['almox-basicos.js']
    print('(1) primeira sincronização: ledger criado, nada protegido ok')

    # ── (2) edição no "Altium" NÃO sobe: vira aviso, e a regeração a desfaz ──
    # A inversão de autoridade em uma asserção: o desenho é do HTML. O que mudar na .SchLib
    # sem passar pelo hub não deixa rastro nenhum — nem proteção no ledger, nem um byte no
    # espelho — e a regeração o desfaz. Antes disto, a mesma edição virava `origem: altium` e
    # a biblioteca do hub mudava sozinha por causa de um save no Altium; entre 09-14 e 09-15
    # ela virava um aviso na tela. Hoje é silêncio, e por isso o resto desta seção importa.
    mod = com_rect(padrao[cam_diac][comp])
    P.patch(cam_diac, {'name': comp, 'parts': mod}, backup=False)          # sem raiz: é o Altium
    assert G.mudou(G.carrega_ledger(raiz), raiz, cam_diac)[0], 'mtime/size acusam a edição'
    antes = linhas_espelho()
    r = G.sincroniza([], log, raiz, gerador)
    assert r['ok'] and chamadas[-1] == []
    assert r['protegidos'] == [] and r['repostos'] == [] and r['espelhos'] == [] and r['orfaos'] == []
    led = G.carrega_ledger(raiz)
    assert led['protegidos'] == {}, 'o Altium não protege mais nada sozinho'
    assert dict(led['gerado']) == gerado_1
    assert linhas_espelho() == antes, 'o espelho não muda por edição no Altium'
    assert le_bytes(os.path.join(tmp, 'Libs', 'almox-basicos.js')) == pristine['almox-basicos.js']
    assert G.fp_parts(G.le_familia(cam_diac)[comp]) == gerado_1['DIAC [PTH]'], \
        'a regeração desfaz a edição na .SchLib — é o que o aviso serve para contar'
    print('(2) edição no Altium não sobe: o espelho não muda e a regeração desfaz ok')

    # (2b) o caminho MANUAL adota o desenho do Altium — e só ele
    mod2 = com_rect(padrao[cam_diac][comp], dx=60)
    P.patch(cam_diac, {'name': comp, 'parts': mod2}, backup=False)
    antes = linhas_espelho()
    assert G.protege(raiz, 'DIAC', comp, 'altium', log)
    led = G.carrega_ledger(raiz)
    p = led['protegidos']['DIAC'][comp]
    assert p['origem'] == 'altium' and p['simbolo'] == 'DIAC [PTH]' and p['fp'] == G.fp_parts(mod2)
    assert p['desde'] and not p.get('orfao') and igual(mod2, p['parts'])
    var, esp, sim = espelho_sim('DIAC [PTH]')
    assert var == 'almoxBasicos' and sim['origem'] == 'altium' and sim['protegidos'] == 1
    assert G.fp_parts(sim['parts']) == G.fp_parts(mod2) and sim['partcount'] == 1
    assert sim['bbox']['y2'] >= 90 and sim['bbox']['y1'] <= -90, sim['bbox']
    assert list(sim.keys())[-2:] == ['origem', 'protegidos']
    so_a_linha_mudou(antes, linhas_espelho(), 'DIAC [PTH]')
    assert 'origem' not in espelho_sim('CAPACITOR')[2]
    assert le_bytes(os.path.join(tmp, 'Libs', 'almox-especiais.js')) == pristine['almox-especiais.js']
    desde = p['desde']
    # agora protegido, a sincronização o REPÕE na .SchLib: HTML -> Altium
    r = G.sincroniza([], log, raiz, gerador)
    assert [(x['familia'], x['componente']) for x in r['repostos']] == [('DIAC', comp)]
    assert igual(mod2, G.le_familia(cam_diac)[comp])
    lido_cap = G.le_familia(cam_cap)
    for c, parts in padrao[cam_cap].items():
        assert igual(parts, lido_cap[c]), 'os outros com a geometria do gerador'
    led = G.carrega_ledger(raiz)
    for cam in (cam_diac, cam_cap):
        assert G.mudou(led, raiz, cam)[:2] == (False, True), 'o ledger conhece o que acabou de escrever'
    print('(2b) só o comando manual adota o desenho do Altium; depois disso ele é reposto ok')

    # (2c) protegido e mexido no Altium DE NOVO: avisa que a regeração vai desfazer
    P.patch(cam_diac, {'name': comp, 'parts': mod}, backup=False)
    antes = linhas_espelho()
    r = G.sincroniza([], log, raiz, gerador)
    p = G.carrega_ledger(raiz)['protegidos']['DIAC'][comp]
    assert p['fp'] == G.fp_parts(mod2) and p['desde'] == desde, 'a proteção não se mexeu'
    assert igual(mod2, G.le_familia(cam_diac)[comp]), 'e o desenho do hub voltou para a .SchLib'
    assert linhas_espelho() == antes
    print('(2c) Altium mexendo em componente protegido: avisa e a regeração repõe o do hub ok')

    # ── (3) sincronização sem mudança: tudo igual ────────────────────────────
    def sem_carimbos(txt):      # o gerador reescreve as libs: mtime e carimbos mudam, o resto não pode
        return re.sub(r'"mtime":[0-9.]+', '', re.sub(r'"(atualizado|visto)":"[^"]*"', '', txt))
    led_txt = sem_carimbos(open(G.caminho_ledger(raiz), encoding='utf-8').read())
    antes = linhas_espelho()
    r = G.sincroniza([], log, raiz, gerador)
    assert r['orfaos'] == [] and len(r['repostos']) == 1
    assert sem_carimbos(open(G.caminho_ledger(raiz), encoding='utf-8').read()) == led_txt
    assert linhas_espelho() == antes, 'o espelho não muda sem mudança'
    assert igual(mod2, G.le_familia(cam_diac)[comp])
    print('(3) segunda sincronização sem mudanças mantém tudo ok')

    # ── (4) liberar: o gerador vence na próxima ─────────────────────────────
    assert G.libera(raiz, 'DIAC', comp, log) and not G.libera(raiz, 'DIAC', comp, log)
    led = G.carrega_ledger(raiz)
    assert 'DIAC' not in led['protegidos'] and dict(led['gerado']) == gerado_1
    assert 'origem' not in espelho_sim('DIAC [PTH]')[2], 'a marca sai na hora'
    r = G.sincroniza([], log, raiz, gerador)
    assert r['protegidos'] == [] and r['repostos'] == [] and r['espelhos'] == []
    assert G.fp_parts(G.le_familia(cam_diac)[comp]) == gerado_1['DIAC [PTH]'], 'o gerador venceu'
    assert linhas_espelho() == pristine['almox-basicos.js'].split(b'\n'), 'espelho como o gerador deixou'
    # (4b) o Altium põe de volta o desenho do gerador: a proteção CONTINUA.
    # Era aqui que o Altium tirava a proteção sozinho — "o Altium é a verdade". Não é mais:
    # quem protege e quem libera é o hub, e o desenho do hub continua indo para a .SchLib.
    P.patch(cam_diac, {'name': comp, 'parts': mod}, backup=False)   # o desenho que o hub quer
    assert G.protege(raiz, 'DIAC', comp, 'hub', log)
    assert espelho_sim('DIAC [PTH]')[2]['origem'] == 'hub', 'a marca diz de onde veio o desenho'
    P.patch(cam_diac, {'name': comp, 'parts': padrao[cam_diac][comp]}, backup=False)  # o Altium desfaz
    r = G.sincroniza([], log, raiz, gerador)
    assert G.carrega_ledger(raiz)['protegidos']['DIAC'][comp], 'a proteção sobrevive ao Altium'
    assert [(x['familia'], x['componente']) for x in r['repostos']] == [('DIAC', comp)]
    assert G.libera(raiz, 'DIAC', comp, log)
    G.sincroniza([], log, raiz, gerador)
    assert 'DIAC' not in G.carrega_ledger(raiz)['protegidos']
    print('(4) liberar faz o gerador vencer; voltar ao gerador no Altium NÃO libera mais ok')


    # ── CLI ─────────────────────────────────────────────────────────────────
    code, out = cli('--raiz', tmp, '--proteger', 'DIAC/' + comp)
    assert code == 0 and 'protegido (hub)' in out, out
    led = G.carrega_ledger(raiz)
    assert led['protegidos']['DIAC'][comp]['origem'] == 'hub' and espelho_sim('DIAC [PTH]')[2].get('protegidos') == 1
    # a edição por fora continua acontecendo aqui: é ela que o --sem-gerador, mais abaixo,
    # tem de atravessar sem proteger nada
    P.patch(cam_cap, {'name': next(iter(padrao[cam_cap])), 'parts': com_rect(next(iter(padrao[cam_cap].values())))}, backup=False)
    code, out = cli('--raiz', tmp, '--liberar', 'DIAC/' + comp, '--liberar', 'DIAC/nada')
    assert code == 1 and 'liberado: DIAC' in out and 'não estava protegido: DIAC / nada' in out, out   # 1: um não se aplicou
    assert cli('--raiz', tmp, '--liberar', 'DIAC/' + comp)[0] == 1, 'já estava liberado: 1'
    assert cli('--raiz', tmp, '--proteger', 'DIAC/' + comp)[0] == 0 and cli('--raiz', tmp, '--liberar', 'DIAC/' + comp)[0] == 0
    assert 'DIAC' not in G.carrega_ledger(raiz)['protegidos']
    code, out = cli('--raiz', tmp)
    assert code == 1 and '--sem-gerador' in out, out
    code, out = cli('--raiz', tmp, '--sem-gerador')
    assert code == 0 and 'gerador pulado' in out, out
    assert G.carrega_ledger(raiz)['protegidos'] == {}, 'nem com --sem-gerador o Altium protege'
    resumo = G.le_resumo(raiz)
    assert resumo['ok'] and resumo['protegidos'] == []
    G.sincroniza([], log, raiz, gerador)
    assert G.carrega_ledger(raiz)['protegidos'] == {}
    print('CLI --proteger/--liberar/--sem-gerador ok')

finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('test_guardiao OK')
