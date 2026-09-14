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
 (2) INVERSÃO DE AUTORIDADE (2026-09-14): edição por fora (retângulo a mais no DIAC, via
     schlib_patch sem raiz) + sincronização NÃO sobe para o hub. Vira `divergentes` no
     resumo, o ledger não ganha proteção nenhuma, o espelho sai byte a byte igual e a
     regeração desfaz a edição na .SchLib. Só o comando MANUAL (`protege`) adota o desenho
     — e aí sim o espelho ganha a geometria, `origem: altium` e `protegidos: 1`.
 (3) segunda sincronização sem mudança mantém tudo (proteção, fp, desde, linha do espelho).
 (4) `libera` faz o gerador vencer na próxima; e o componente que volta ao desenho do gerador
     NO ALTIUM **continua protegido** — quem tira a proteção é o hub, não o Altium.
 (5) `detecta` só acusa depois de um patch por fora; `deep` lista o item; `aplica` protege e o
     espelho anda junto; arquivo tocado sem diferença é absorvido; componente que voltou ao
     gerador é liberado pelo `aplica` e o espelho fica com o que o Altium tem. CLI:
     --proteger, --status (código 3 quando há pendência), --liberar, --raiz sem --sem-gerador
     recusado, --sem-gerador de ponta a ponta.
 (7) casa (cópia da lib local em D:; PULA se ausente): `detecta` adota a SchLib; deep acusa SÓ
     o símbolo cuja geometria mudou; `aplica` troca só aquela linha do Libs/schlib.js (o
     resto byte a byte, fora o generated); descrição mudada é 'descricao'; um espelho do
     ExportLibs (sem cor, sem flag, sem RECORD 5/10/11) NÃO é acusado; símbolo apagado do
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
SEM_MARCA = re.compile(rb', "origem": "altium", "protegidos": \d+\}$', re.M)
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
    assert r['protegidos'] == [] and r['divergentes'] == [] and r['repostos'] == [] \
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
    assert '\n"protegidos":{\n}}' in txt
    resumo = G.le_resumo(raiz)
    assert resumo and resumo['ok'] and resumo['gerados'] == 2 and resumo['protegidos'] == []
    assert le_bytes(os.path.join(tmp, 'Libs', 'almox-basicos.js')) == pristine['almox-basicos.js']
    print('(1) primeira sincronização: ledger criado, nada protegido ok')

    # ── (2) edição no "Altium" NÃO sobe: vira aviso, e a regeração a desfaz ──
    # A inversão de autoridade em uma asserção: o desenho é do HTML. O que mudar na .SchLib
    # sem passar pelo hub aparece em `divergentes` e nada mais — nem proteção no ledger, nem
    # um byte no espelho. Antes disto, a mesma edição virava `origem: altium` e a biblioteca
    # do hub mudava sozinha por causa de um save no Altium.
    mod = com_rect(padrao[cam_diac][comp])
    P.patch(cam_diac, {'name': comp, 'parts': mod}, backup=False)          # sem raiz: é o Altium
    assert G.mudou(G.carrega_ledger(raiz), raiz, cam_diac)[0], 'mtime/size acusam a edição'
    antes = linhas_espelho()
    r = G.sincroniza([], log, raiz, gerador)
    assert r['ok'] and chamadas[-1] == []
    assert [(d['familia'], d['componente'], d['simbolo'], d['referencia'], d['reposto'])
            for d in r['divergentes']] == [('DIAC', comp, 'DIAC [PTH]', 'gerado', False)], r['divergentes']
    assert r['protegidos'] == [] and r['repostos'] == [] and r['espelhos'] == [] and r['orfaos'] == []
    led = G.carrega_ledger(raiz)
    assert led['protegidos'] == {}, 'o Altium não protege mais nada sozinho'
    assert dict(led['gerado']) == gerado_1
    assert linhas_espelho() == antes, 'o espelho não muda por edição no Altium'
    assert le_bytes(os.path.join(tmp, 'Libs', 'almox-basicos.js')) == pristine['almox-basicos.js']
    assert G.fp_parts(G.le_familia(cam_diac)[comp]) == gerado_1['DIAC [PTH]'], \
        'a regeração desfaz a edição na .SchLib — é o que o aviso serve para contar'
    print('(2) edição no Altium não sobe: sai em divergentes e o espelho não muda ok')

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
    assert r['divergentes'] == [], 'a .SchLib está com o desenho do hub: nada a avisar'
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
    assert [(d['componente'], d['referencia'], d['reposto']) for d in r['divergentes']] == \
        [(comp, 'protegido', True)], r['divergentes']
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
    assert r['divergentes'] == [] and r['orfaos'] == [] and len(r['repostos']) == 1
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
    assert [(d['componente'], d['referencia']) for d in r['divergentes']] == [(comp, 'protegido')], r['divergentes']
    assert G.carrega_ledger(raiz)['protegidos']['DIAC'][comp], 'a proteção sobrevive ao Altium'
    assert [(x['familia'], x['componente']) for x in r['repostos']] == [('DIAC', comp)]
    assert G.libera(raiz, 'DIAC', comp, log)
    G.sincroniza([], log, raiz, gerador)
    assert 'DIAC' not in G.carrega_ledger(raiz)['protegidos']
    print('(4) liberar faz o gerador vencer; voltar ao gerador no Altium NÃO libera mais ok')

    # ── (5) detecta / aplica no almoxarifado ────────────────────────────────
    d = G.detecta(raiz)
    assert not d['pendente'] and not d['deep'] and d['itens'] == []
    alm = {a['familia']: a for a in d['arquivos'] if a['acervo'] == 'almox'}
    assert set(alm) == {'DIAC', 'CAPACITOR'} and all(a['conhecido'] and not a['mudou'] and a['existe'] for a in alm.values())
    ca = next(a for a in d['arquivos'] if a['acervo'] == 'altium')
    chave_casa = G.chave_arquivo(raiz, casa)               # dentro do workspace: relativa
    assert chave_casa == 'casa/BIBLIOTECA DE ESQUEMA.SchLib' and ca['arquivo'] == chave_casa and ca['caminho'] == casa
    assert not ca['existe'] and not ca['mudou']
    assert G.chave_arquivo(raiz, r'Y:\x\y.SchLib') == r'Y:\x\y.SchLib', 'fora do workspace: absoluta'
    assert d['ledger']['protegidos'] == 0 and d['ledger']['gerado'] == 2
    P.patch(cam_diac, {'name': comp, 'parts': mod}, backup=False)
    d = G.detecta(raiz)
    assert d['pendente'] and d['itens'] == []
    alm = {a['familia']: a for a in d['arquivos'] if a['acervo'] == 'almox'}
    assert alm['DIAC']['mudou'] and not alm['CAPACITOR']['mudou']
    d = G.detecta(raiz, deep=True)
    assert d['pendente'] and len(d['itens']) == 1, d['itens']
    it = d['itens'][0]
    assert (it['acervo'], it['familia'], it['componente'], it['simbolo'], it['mudou'], it['estado'], it['protegido']) == \
        ('almox', 'DIAC', comp, 'DIAC [PTH]', ['geometria'], 'editado', False), it
    assert it['arquivo'] == 'Libs/Almox/DIAC ALMOX.SchLib'
    antes = linhas_espelho()
    r = G.aplica(raiz, d['itens'], log)
    assert r['aplicados'] == 1 and r['itens'][0]['ok'] and r['itens'][0]['acao'] == 'protegido', r
    led = G.carrega_ledger(raiz)
    assert led['protegidos']['DIAC'][comp]['origem'] == 'altium' and led['protegidos']['DIAC'][comp]['fp'] == G.fp_parts(mod)
    sim = espelho_sim('DIAC [PTH]')[2]
    assert sim['origem'] == 'altium' and sim['protegidos'] == 1 and G.fp_parts(sim['parts']) == G.fp_parts(mod)
    so_a_linha_mudou(antes, linhas_espelho(), 'DIAC [PTH]')
    d = G.detecta(raiz, deep=True)
    assert not d['pendente'] and d['itens'] == [], d
    # tocado sem diferença: o deep absorve e o aviso some
    st = os.stat(cam_diac)
    os.utime(cam_diac, (st.st_atime + 30, st.st_mtime + 30))
    d = G.detecta(raiz)
    assert d['pendente']
    d = G.detecta(raiz, deep=True)
    assert not d['pendente'] and d['absorvidos'] == ['Libs/Almox/DIAC ALMOX.SchLib'] and d['itens'] == []
    assert not G.detecta(raiz)['pendente']
    # voltou ao gerador no Altium: o deep diz 'gerador', o aplica libera e o espelho fica com o que o Altium tem
    P.patch(cam_diac, {'name': comp, 'parts': padrao[cam_diac][comp]}, backup=False)
    d = G.detecta(raiz, deep=True)
    assert len(d['itens']) == 1 and d['itens'][0]['estado'] == 'gerador' and d['itens'][0]['protegido']
    r = G.aplica(raiz, d['itens'], log)
    assert r['itens'][0]['acao'] == 'liberado' and 'DIAC' not in G.carrega_ledger(raiz)['protegidos']
    sim = espelho_sim('DIAC [PTH]')[2]
    assert 'origem' not in sim and G.fp_parts(sim['parts']) == gerado_1['DIAC [PTH]']
    assert not G.detecta(raiz, deep=True)['pendente']
    # item que não existe
    r = G.aplica(raiz, [{'acervo': 'almox', 'familia': 'DIAC', 'componente': 'nada'}], log)
    assert r['aplicados'] == 0 and not r['itens'][0]['ok'] and 'não está' in r['itens'][0]['erro']
    print('(5) detecta/deep/aplica no almoxarifado (proteger, absorver, liberar) ok')

    # ── CLI ─────────────────────────────────────────────────────────────────
    code, out = cli('--raiz', tmp, '--proteger', 'DIAC/' + comp)
    assert code == 0 and 'protegido (hub)' in out, out
    led = G.carrega_ledger(raiz)
    assert led['protegidos']['DIAC'][comp]['origem'] == 'hub' and espelho_sim('DIAC [PTH]')[2].get('protegidos') == 1
    code, out = cli('--raiz', tmp, '--status')
    assert code == 0 and 'protegidos (1)' in out and ('DIAC / %s  hub' % comp) in out and 'nada mudou' in out, out
    P.patch(cam_cap, {'name': next(iter(padrao[cam_cap])), 'parts': com_rect(next(iter(padrao[cam_cap].values())))}, backup=False)
    code, out = cli('--raiz', tmp, '--status')
    assert code == 3 and 'mudou no Altium desde o ledger (1)' in out and 'CAPACITOR ALMOX.SchLib' in out, out
    code, out = cli('--raiz', tmp, '--status', '--deep')
    assert code == 3 and 'itens (1):' in out and '[almox]  CAPACITOR /' in out and '(editado): geometria' in out, out
    code, out = cli('--raiz', tmp, '--liberar', 'DIAC/' + comp, '--liberar', 'DIAC/nada')
    assert code == 1 and 'liberado: DIAC' in out and 'não estava protegido: DIAC / nada' in out, out   # 1: um não se aplicou
    assert cli('--raiz', tmp, '--liberar', 'DIAC/' + comp)[0] == 1, 'já estava liberado: 1'
    assert cli('--raiz', tmp, '--proteger', 'DIAC/' + comp)[0] == 0 and cli('--raiz', tmp, '--liberar', 'DIAC/' + comp)[0] == 0
    assert 'DIAC' not in G.carrega_ledger(raiz)['protegidos']
    code, out = cli('--raiz', tmp)
    assert code == 1 and '--sem-gerador' in out, out
    code, out = cli('--raiz', tmp, '--sem-gerador')
    assert code == 0 and 'gerador pulado' in out and 'mudou no Altium (gerado): CAPACITOR' in out, out
    assert G.carrega_ledger(raiz)['protegidos'] == {}, 'nem com --sem-gerador o Altium protege'
    resumo = G.le_resumo(raiz)
    assert resumo['ok'] and resumo['protegidos'] == []
    assert [d['familia'] for d in resumo['divergentes']] == ['CAPACITOR'], resumo['divergentes']
    G.sincroniza([], log, raiz, gerador)
    assert G.carrega_ledger(raiz)['protegidos'] == {}
    print('CLI --proteger/--status/--liberar/--sem-gerador ok')

    # ── (7) a casa: só a linha do símbolo que mudou ─────────────────────────
    if os.path.isfile(LOCAL):
        shutil.copy2(LOCAL, casa)
        # O `libpath` guarda por 30 s o `isfile` que deu False num caminho de rede, e as
        # seções anteriores já perguntaram por esta `casa` quando ela ainda não existia. Sem
        # zerar o cache, `resolve_schlib` cai na cópia publicada — que numa raiz de tmp não
        # existe — e o `aplica` falha com ENOENT em vez de editar a lib da casa. Criar
        # arquivo por fora é privilégio de teste; na bancada quem cria é o Altium, e 30 s de
        # atraso é o preço combinado por não pagar 1054 ms de stat em share caído.
        LP.esquece_ausentes()
        esp_cam = os.path.join(tmp, 'Libs', 'schlib.js')
        nomes = L.nomes_pcblib(os.path.join(tmp, 'Libs', 'pcblib.js'))
        dados = L.le_schlib(casa, pcblib_names=nomes)
        with open(esp_cam, 'wb') as f:
            f.write(L.espelho(dados, nomes).encode('ascii'))
        RES = 'RES [ SMD ]'
        res = next(s for s in dados['symbols'] if s['name'] == RES)
        outro = next(s for s in dados['symbols'] if s['name'] != RES and s['partcount'] == 1 and s['parts'][0]['graphics'])
        d = G.detecta(raiz)
        ca = next(a for a in d['arquivos'] if a['acervo'] == 'altium')
        assert ca['existe'] and ca['adotado'] and not ca['mudou'] and not d['pendente']
        mod = copy.deepcopy(res['parts'])
        next(g for g in mod[0]['graphics'] if g['g'] == 'rect')['x2'] += 50
        P.patch(casa, {'name': RES, 'parts': mod}, backup=False)
        d = G.detecta(raiz)
        assert d['pendente'] and next(a for a in d['arquivos'] if a['acervo'] == 'altium')['mudou'] and d['itens'] == []
        t0 = time.time()
        d = G.detecta(raiz, deep=True)
        assert d['itens'] == [{'acervo': 'altium', 'name': RES, 'mudou': ['geometria']}], d['itens']
        antes = le_bytes(esp_cam).split(b'\r\n')
        r = G.aplica(raiz, d['itens'], log)
        assert r['aplicados'] == 1 and r['itens'][0]['acao'] == 'trocado'
        depois = le_bytes(esp_cam).split(b'\r\n')
        assert len(antes) == len(depois)
        pref = b'{"name":' + L._js(RES).encode() + b','
        for i, (a, b) in enumerate(zip(antes, depois)):
            if b.lstrip(b',').startswith(pref):
                assert a != b
            elif i == 2:
                assert a.startswith(b'"generated":') and b.startswith(b'"generated":')
            else:
                assert a == b, 'linha %d mudou: %r' % (i, b[:60])
        esp_txt, esp_syms = G._le_espelho_casa(esp_cam)
        assert igual(mod, esp_syms[RES]['parts'])
        d = G.detecta(raiz, deep=True)
        assert not d['pendente'] and d['itens'] == [], d['itens']
        # descrição
        P.patch(casa, {'name': RES, 'parts': mod, 'description': 'RESISTOR SMD (teste)'}, backup=False)
        d = G.detecta(raiz, deep=True)
        assert d['itens'] == [{'acervo': 'altium', 'name': RES, 'mudou': ['descricao']}], d['itens']
        G.aplica(raiz, d['itens'], log)
        assert G._le_espelho_casa(esp_cam)[1][RES]['description'] == 'RESISTOR SMD (teste)'
        print('(7) casa: deep acusa só o símbolo editado (%.1f s), aplica troca só a linha ok' % (time.time() - t0))
        # espelho do ExportLibs: sem cor, sem flag, sem as conversões extras -> nada a acusar
        ds = L.le_schlib(casa, pcblib_names=nomes, extras=False)
        velho = L.espelho(ds, nomes).encode('ascii')
        velho = re.sub(rb',"(?:color|fill)":"#[0-9a-f]{6}"', b'', velho)
        velho = re.sub(rb',"hide(?:Num|Name)":true', b'', velho)
        assert b'"color"' not in velho and b'"hideNum"' not in velho
        with open(esp_cam, 'wb') as f:
            f.write(velho)
        G.registra_arquivo(raiz, casa)
        st = os.stat(casa)
        os.utime(casa, (st.st_atime + 30, st.st_mtime + 30))
        assert G.detecta(raiz)['pendente']
        d = G.detecta(raiz, deep=True)
        assert d['itens'] == [] and not d['pendente'] and d['absorvidos'] == [chave_casa], d['itens'][:3]
        mod_o = copy.deepcopy(outro['parts'])
        mod_o[0]['graphics'].append(dict(RECT))
        P.patch(casa, {'name': outro['name'], 'parts': mod_o}, backup=False)
        d = G.detecta(raiz, deep=True)
        assert d['itens'] == [{'acervo': 'altium', 'name': outro['name'], 'mudou': ['geometria']}], d['itens'][:3]
        G.aplica(raiz, d['itens'], log)
        assert not G.detecta(raiz, deep=True)['pendente']
        print('(7) espelho do ExportLibs (sem cor/flag/extras) não é acusado; edição real é ok')
        # símbolo novo no Altium (apagado do espelho): entra no fim, stats acompanha
        with open(esp_cam, 'rb') as f:
            linhas = f.read().decode('latin-1').splitlines(True)
        ultimo = max(i for i, ln in enumerate(linhas) if ln.lstrip(',').startswith('{"name":'))
        nome_novo = json.loads(linhas[ultimo].lstrip(',').rstrip('\r\n'))['name']
        del linhas[ultimo]
        n_syms = sum(1 for ln in linhas if ln.lstrip(',').startswith('{"name":'))
        with open(esp_cam, 'wb') as f:
            f.write(''.join(linhas).encode('latin-1'))
        st = os.stat(casa)
        os.utime(casa, (st.st_atime + 60, st.st_mtime + 60))
        d = G.detecta(raiz, deep=True)
        assert d['itens'] == [{'acervo': 'altium', 'name': nome_novo, 'mudou': ['novo']}], d['itens'][:3]
        r = G.aplica(raiz, d['itens'], log)
        assert r['itens'][0]['acao'] == 'novo'
        with open(esp_cam, 'rb') as f:
            depois = f.read().decode('latin-1').splitlines(True)
        assert len(depois) == len(linhas) + 1
        assert depois[ultimo].startswith(',{"name":' + L._js(nome_novo) + ',')
        assert any(ln.startswith('"stats":{"symbols":%d,' % (n_syms + 1)) for ln in depois), [ln for ln in depois if ln.startswith('"stats"')]
        txt2, syms2 = G._le_espelho_casa(esp_cam)
        assert nome_novo in syms2 and len(syms2) == n_syms + 1
        assert not G.detecta(raiz, deep=True)['pendente']
        print('(7) símbolo novo no Altium entra no fim do espelho ok')
    else:
        print('(7) PULADO: sem a lib local em D: para a cópia da casa')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('test_guardiao OK')
