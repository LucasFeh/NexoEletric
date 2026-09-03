# -*- coding: utf-8 -*-
"""Os endpoints /api/symbols/* num workspace temporário, pelo test_client do hubserver.

    python tests/test_symserver.py

Monta em tmp um Libs/schlib.js de 3 símbolos, um Libs/pcblib.js mínimo e um
tools/symbols/config.json apontando para uma CÓPIA da lib local
(D:\\ALTIUM LIBRARY ------ LUCAS\\BIBLIOTECA DE ESQUEMA.SchLib). Sem a cópia, o que depende
dela vira o caminho "SchLib ausente" (espelho:true, altium:false) e o resto roda igual.

Prova: config; save (o espelho muda SÓ a linha do símbolo e a do generated; altium grava a
SchLib com backup idêntico ao original; pino fora da grade de 10 mil — grade métrica — é
preservado com 3 casas no espelho e na SchLib, via PinFrac; 404; 423 com a lib ocupada; 500
com a SchLib faltando; o nome novo do rename-map cai para o antigo); lib add/rename/delete/409/404; extract 202+409 e
o stream de verdade (--limite 1) até o `event: done`; mirror regera o espelho inteiro.
"""
import copy
import io
import os
import shutil
import sys
import tempfile
import time
from datetime import date

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import hubserver as H            # noqa: E402  (o blueprint tem que vir registrado daqui)
import symserver as S            # noqa: E402
import sch_leitor as L           # noqa: E402
import schlib_patch as P         # noqa: E402
import extrair as E              # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

LOCAL = r'D:\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib'
RES, RES_NOVO, OUTRO = 'RES [ SMD ]', 'RES [SMD]', None

assert 'symbols' in H.app.blueprints, 'importar o hubserver tem que registrar o blueprint'
assert S.bp.url_prefix == '/api/symbols'


def pin(num, x, y, orient, name=None, ln=100):
    return {'num': num, 'name': name if name is not None else num, 'x': x, 'y': y,
            'len': ln, 'orient': orient, 'type': 'Passive'}


def sym(nome, pins, graphics, desc=''):
    return {'name': nome, 'description': desc, 'partcount': 1,
            'parts': [{'part': 1, 'pins': pins, 'graphics': graphics}], 'footprints': []}


def le_bytes(p):
    with open(p, 'rb') as f:
        return f.read()


def acha(lib_json, nome):
    return next(s for s in lib_json['symbols'] if s['name'] == nome)


# ─── workspace temporário ─────────────────────────────────────────────────────
tmp = tempfile.mkdtemp(prefix='symserver-')
for d in ('Libs', os.path.join('tools', 'symbols'), 'Projects', 'fontes', 'bk'):
    os.makedirs(os.path.join(tmp, d))
lib_copia = os.path.join(tmp, 'lib', 'BIBLIOTECA DE ESQUEMA.SchLib')
tem_lib = os.path.isfile(LOCAL)
if tem_lib:
    os.makedirs(os.path.dirname(lib_copia))
    shutil.copy2(LOCAL, lib_copia)
    shutil.copy2(LOCAL, os.path.join(tmp, 'fontes', 'BIBLIOTECA DE ESQUEMA.SchLib'))
    dados = L.le_schlib(lib_copia)
    res = acha(dados, RES)
    outro = next(s for s in dados['symbols'] if s['name'] != RES and s['partcount'] == 1)
    print('lib local copiada: %d símbolos' % len(dados['symbols']))
else:
    dados = None
    res = sym(RES, [pin('2', 50, 0, 0), pin('1', -150, 0, 180)],
              [{'g': 'rect', 'x1': -150, 'y1': -40, 'x2': 50, 'y2': 40, 'solid': False}], 'RESISTOR')
    outro = sym('CAP', [pin('1', 0, 100, 90), pin('2', 0, -100, 270)],
                [{'g': 'line', 'x1': -50, 'y1': 20, 'x2': 50, 'y2': 20, 'w': 10}], 'CAPACITOR')
    print('PULADO: sem a lib local em D:, o lado Altium vira "SchLib ausente"')
OUTRO = outro['name']
res_novo = copy.deepcopy(res)
res_novo['name'] = RES_NOVO                       # o nome que o RenameLibs deu no espelho
espelho = os.path.join(tmp, 'Libs', 'schlib.js')
with open(espelho, 'wb') as f:
    f.write(L.espelho({'generated': '01/01/2026 00:00:00', 'source': 'teste',
                       'symbols': [copy.deepcopy(outro), copy.deepcopy(res), res_novo]}).encode('ascii'))
with open(os.path.join(tmp, 'Libs', 'pcblib.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('var pcblib = {\n"format":"pcblib-v2",\n"footprints":[\n{"name":"RES 0805","pads":[]}\n]};\n')
with open(os.path.join(tmp, 'Libs', 'rename-map.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('var renameMap = {\n"format":"renamemap-v1",\n"symRename":{\n%s:%s\n}\n};\n'
            % (S.json.dumps(RES), S.json.dumps(RES_NOVO)))
with open(os.path.join(tmp, 'tools', 'symbols', 'config.json'), 'w', encoding='utf-8') as f:
    S.json.dump({'schlib': lib_copia, 'backup_dir': os.path.join(tmp, 'bk'),
                 'fontes': [os.path.join(tmp, 'fontes')], 'ignorar': ['History']}, f)

real_root = H.ROOT
H.ROOT = S.ROOT = tmp
cli = H.app.test_client()
try:
    # ── config ──────────────────────────────────────────────────────────────
    j = cli.get('/api/symbols/config').get_json()
    assert j['ok'] and j['schlib'] == lib_copia and j['existe'] == tem_lib, j
    assert j['backup_dir'] == os.path.join(tmp, 'bk') and j['fontes'] == [os.path.join(tmp, 'fontes')]
    assert j['symlib'] == 'Libs/symbols-lib.js' and j['symlibExiste'] is False and j['espelhoExiste']
    assert j['local'] is True and (j['tamanho'] > 0) == tem_lib
    print('config ok')

    # ── save: validação e 404 antes de encostar em qualquer arquivo ─────────
    antes = le_bytes(espelho)
    assert cli.post('/api/symbols/save', json=[]).status_code == 400
    assert cli.post('/api/symbols/save', json={'name': RES, 'parts': []}).status_code == 400
    ruim = copy.deepcopy(res['parts'])
    ruim[0]['pins'][0]['orient'] = 45
    assert cli.post('/api/symbols/save', json={'name': RES, 'parts': ruim}).status_code == 400
    ruim = copy.deepcopy(res['parts'])
    ruim[0]['graphics'].append({'g': 'nada'})
    assert cli.post('/api/symbols/save', json={'name': RES, 'parts': ruim}).status_code == 400
    r = cli.post('/api/symbols/save', json={'name': 'NAO EXISTE', 'parts': res['parts']})
    assert r.status_code == 404 and 'NAO EXISTE' in r.get_json()['error']
    # gráfico sem coordenada, texto no lugar de número, pts torto, label sem texto: 400 ANTES do espelho
    for g in ({'g': 'line'}, {'g': 'rect', 'x1': 'abc', 'y1': 0, 'x2': 1, 'y2': 1}, {'g': 'poly', 'pts': [[0, 0]]},
              {'g': 'polyline', 'pts': [[0, 0], [1]]}, {'g': 'label', 'x': 0, 'y': 0},
              {'g': 'arc', 'cx': 0, 'cy': 0, 'r': 10, 'sa': 'x'}, {'g': 'ellipse', 'cx': 0, 'cy': 0, 'rx': 5}):
        ruim = copy.deepcopy(res['parts'])
        ruim[0]['graphics'].append(g)
        r = cli.post('/api/symbols/save', json={'name': RES, 'parts': ruim})
        assert r.status_code == 400 and 'gráfico' in r.get_json()['error'], (g, r.get_json())
    r = cli.post('/api/symbols/save', content_type='application/json', data=(
        '{"name":%s,"parts":[{"pins":[{"num":"1","name":"1","x":NaN,"y":0,"len":100,"orient":0,"type":"Passive"}],'
        '"graphics":[]}]}' % S.json.dumps(RES)))
    assert r.status_code == 400, 'NaN não é coordenada'
    assert le_bytes(espelho) == antes, 'pedido recusado não pode mexer no espelho'

    # ── save: o espelho muda SÓ a linha do símbolo (e o generated) ──────────
    mod = copy.deepcopy(res['parts'])
    rect = next(g for g in mod[0]['graphics'] if g['g'] == 'rect')
    rect['x2'] += 50
    mod[0]['pins'].append(pin('9', 0, 200, 90, 'NOVO'))
    lib_antes = le_bytes(lib_copia) if tem_lib else None
    r = cli.post('/api/symbols/save', json={'name': RES, 'parts': mod, 'altium': True})
    j = r.get_json()
    linhas_a, linhas_d = antes.split(b'\r\n'), le_bytes(espelho).split(b'\r\n')
    # 6 de cabeçalho + 3 símbolos + 3 de rodapé, e o vazio depois do CRLF final
    assert len(linhas_a) == len(linhas_d) == 13, len(linhas_d)
    pref = b'{"name":' + L._js(RES).encode() + b','
    for i, (a, d) in enumerate(zip(linhas_a, linhas_d)):
        if i == 2:
            assert a.startswith(b'"generated":') and d.startswith(b'"generated":') and a != d, 'generated'
        elif d.lstrip(b',').startswith(pref):
            assert a != d and a.lstrip(b',').startswith(pref)
        else:
            assert a == d, 'linha %d mudou: %r' % (i, d[:60])
    novo = H.load_var_file(espelho)
    assert [s['name'] for s in novo['symbols']] == [OUTRO, RES, RES_NOVO], 'ordem preservada'
    s = acha(novo, RES)
    assert s['description'] == res['description'] and s['footprints'] == res['footprints'], 'description/footprints preservados'
    assert len(s['parts'][0]['pins']) == len(res['parts'][0]['pins']) + 1 and s['partcount'] == 1
    assert next(g for g in s['parts'][0]['graphics'] if g['g'] == 'rect')['x2'] == rect['x2']
    assert acha(novo, OUTRO) == outro, 'o vizinho saiu igual'
    if tem_lib:
        assert r.status_code == 200 and j['espelho'] and j['altium'] and j['verificado'], j
        assert j['backup'] and os.path.isfile(j['backup']) and le_bytes(j['backup']) == lib_antes, 'backup = original'
        assert os.path.dirname(j['backup']) == os.path.join(tmp, 'bk')
        lido = acha(L.le_schlib(lib_copia), RES)
        assert not P.compara(P.esperado({'name': RES, 'parts': mod}), lido['parts']), 'a SchLib reflete'
        print('save (espelho + Altium) ok: backup %s' % os.path.basename(j['backup']))
    else:
        assert r.status_code == 500 and j['espelho'] is True and j['altium'] is False and 'SchLib' in j['error'], j
        print('save: espelho gravado, SchLib ausente -> 500 espelho:true altium:false ok')

    # só espelho: a SchLib não é tocada
    lib_meio = le_bytes(lib_copia) if tem_lib else None
    r = cli.post('/api/symbols/save', json={'name': OUTRO, 'parts': outro['parts'], 'altium': False})
    assert r.status_code == 200 and r.get_json()['altium'] is False and r.get_json()['backup'] is None
    if tem_lib:
        assert le_bytes(lib_copia) == lib_meio, 'altium:false não pode encostar na SchLib'

    # pino fora da grade de 10 mil (grade métrica): preservado com 3 casas nos dois lados —
    # o espelho guarda o número e a SchLib leva a fração para o PinFrac; só a 4ª casa cai
    torto = copy.deepcopy(outro['parts'])
    torto[0]['pins'][0].update(x=105.5, y=-78.74, len=79.0004)
    r = cli.post('/api/symbols/save', json={'name': OUTRO, 'parts': torto, 'altium': tem_lib})
    j = r.get_json()
    assert r.status_code == 200 and not any('arredond' in a for a in j['avisos']), j
    p0 = acha(H.load_var_file(espelho), OUTRO)['parts'][0]['pins'][0]
    assert (p0['x'], p0['y'], p0['len']) == (105.5, -78.74, 79), p0
    if tem_lib:
        q0 = next(q for q in acha(L.le_schlib(lib_copia), OUTRO)['parts'][0]['pins'] if q['num'] == p0['num'])
        assert (q0['x'], q0['y'], q0['len']) == (105.5, -78.74, 79), 'espelho e SchLib dizem o mesmo'
        import olefile
        st_o = P.acha(P.carrega(lib_copia), OUTRO)
        o = olefile.OleFileIO(lib_copia)
        try:
            fr = L._le_pinfrac(o.openstream(st_o + '/PinFrac').read(), [], st_o)
        finally:
            o.close()
        assert fr[0] == (55000, -87400, 90000), fr            # o 1º pino é o ordinal 0; truncado, com sinal
    r = cli.post('/api/symbols/save', json={'name': OUTRO, 'parts': outro['parts'], 'altium': tem_lib})
    assert r.status_code == 200 and not any('arredond' in a for a in r.get_json()['avisos']), r.get_json()
    print('save com pino fora da grade de 10 mil -> preservado com 3 casas nos dois lados ok')

    # lib aberta no Altium -> 423, e o espelho JÁ foi gravado
    def ocupada(cfg, sym):
        raise P.LibOcupada('feche a biblioteca no Altium e tente de novo (teste)')
    S._patch_altium, orig = ocupada, S._patch_altium
    try:
        r = cli.post('/api/symbols/save', json={'name': OUTRO, 'parts': outro['parts'], 'altium': True})
    finally:
        S._patch_altium = orig
    j = r.get_json()
    assert r.status_code == 423 and j['ok'] is False and j['espelho'] is True and j['altium'] is False
    assert 'Altium' in j['error'], j
    print('save com a lib ocupada -> 423 ok')

    # nome do espelho (renomeado) que a SchLib real não tem: cai para o antigo do rename-map
    assert S._nome_antigo(RES_NOVO) == RES and S._nome_antigo('XYZ') is None
    if tem_lib:
        r = cli.post('/api/symbols/save', json={'name': RES_NOVO, 'parts': res['parts'], 'altium': True})
        j = r.get_json()
        assert r.status_code == 200 and j['altium'] and j['nomeAltium'] == RES, j
        lido = acha(L.le_schlib(lib_copia), RES)
        assert not P.compara(P.esperado({'name': RES, 'parts': res['parts']}), lido['parts']), 'voltou ao original'
        print('save pelo nome novo do rename-map -> gravou no antigo ok')

    # ── lib: add / rename / delete ──────────────────────────────────────────
    symlib = os.path.join(tmp, 'Libs', 'symbols-lib.js')
    resistor = {'name': 'Resistor', 'kind': 'generico', 'pins': [pin('2', 50, 0, 0), pin('1', -150, 0, 180)],
                'graphics': [{'g': 'rect', 'x1': -150, 'y1': -40, 'x2': 50, 'y2': 40, 'solid': False}]}
    assert cli.post('/api/symbols/lib', json={'op': 'nada'}).status_code == 400
    assert cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': {'name': '', 'pins': [], 'graphics': []}}).status_code == 400
    assert cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': dict(resistor, kind='x')}).status_code == 400
    assert not os.path.exists(symlib), 'pedido recusado não cria arquivo'
    j = cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': resistor}).get_json()
    s1 = j['symbol']
    assert j['ok'] and s1['id'] == 's0001' and s1['name'] == 'Resistor' and s1['kind'] == 'generico'
    assert s1['fontes'] == ['hub'] and s1['usos'] == 1 and s1['desde'] == date.today().isoformat()
    assert s1['fp'] == E.fingerprint(resistor['pins'], resistor['graphics'], 'generico')
    assert set(s1.keys()) == set(E.CHAVES), list(s1.keys())     # o Flask ordena as chaves do JSON
    with open(symlib, encoding='utf-8') as f:
        txt = f.read()
    assert txt.startswith('var symbolsLib = {\n"format":"symlib-v1",\n') and '\n{"id":"s0001"' in txt and txt.endswith(']};\n')
    linha = next(ln for ln in txt.split('\n') if ln.startswith('{"id":"s0001"'))
    assert [k for k in E.CHAVES if ('"%s":' % k) in linha] == list(E.CHAVES) and \
        all(linha.index('"%s":' % a) < linha.index('"%s":' % b) for a, b in zip(E.CHAVES, E.CHAVES[1:])), \
        'no arquivo as chaves saem na ordem do symlib-v1'
    # mesma geometria, outro nome: 409 devolvendo quem já está lá
    r = cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': dict(resistor, name='Res de novo')})
    assert r.status_code == 409 and r.get_json()['symbol']['id'] == 's0001', r.get_json()
    # mesmo nome, outra geometria: 409
    maior = copy.deepcopy(resistor)
    maior['graphics'][0]['x2'] = 150
    assert cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': maior}).status_code == 409
    # kind ausente: pelo número de pinos
    r = cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': dict(maior, name='Resistor largo', kind=None)})
    s2 = r.get_json()['symbol']
    assert r.status_code == 200 and s2['id'] == 's0002' and s2['kind'] == 'generico'
    assert cli.post('/api/symbols/lib', json={'op': 'rename', 'id': 's0002', 'name': 'Resistor'}).status_code == 409
    assert cli.post('/api/symbols/lib', json={'op': 'rename', 'id': 'zzz', 'name': 'x'}).status_code == 404
    j = cli.post('/api/symbols/lib', json={'op': 'rename', 'id': 's0002', 'name': ' Resistor 2 '}).get_json()
    assert j['ok'] and j['symbol']['name'] == 'Resistor 2'
    assert [s['name'] for s in E.le_symlib(symlib)['symbols']] == ['Resistor', 'Resistor 2']
    assert cli.post('/api/symbols/lib', json={'op': 'delete', 'id': 'zzz'}).status_code == 404
    j = cli.post('/api/symbols/lib', json={'op': 'delete', 'id': 's0002'}).get_json()
    assert j['ok'] and j['symbol']['id'] == 's0002' and j['total'] == 1
    assert [s['id'] for s in E.le_symlib(symlib)['symbols']] == ['s0001']
    assert cli.get('/api/symbols/config').get_json()['symlibExiste'] is True
    print('lib add/rename/delete ok')

    # ── extract: reserva, 409, e o stream de verdade ────────────────────────
    S._extract_runs.clear()
    r = cli.post('/api/symbols/extract', json={'limite': 1})
    assert r.status_code == 202 and r.get_json()['runId'].startswith('x_'), r.get_json()
    run = r.get_json()['runId']
    assert cli.post('/api/symbols/extract', json={}).status_code == 409, 'segunda reserva tem que dar 409'
    assert cli.get('/api/symbols/extract/nao-existe/stream').status_code == 404
    t0 = time.time()
    r = cli.get('/api/symbols/extract/%s/stream' % run)
    corpo = r.get_data(as_text=True)
    assert r.mimetype == 'text/event-stream'
    assert 'event: done' in corpo and 'event: error' not in corpo, corpo[-800:]
    assert 'data: fontes:' in corpo, 'o stdout do extrair tem que virar data:'
    assert cli.get('/api/symbols/extract/%s/stream' % run).status_code == 404, 'reserva consumida'
    lib = E.le_symlib(symlib)
    assert lib and lib['symbols'][0]['id'] == 's0001' and lib['symbols'][0]['name'] == 'Resistor', 'mescla preserva'
    assert os.path.isfile(os.path.join(tmp, 'tools', 'symbols', 'relatorio.txt')), 'relatório no workspace'
    if tem_lib:
        assert len(lib['symbols']) > 1, 'a lib copiada em fontes/ tinha que render símbolos'
        print('extract ok: %d símbolos em %.1f s; aliases do s0001: %s' % (
            len(lib['symbols']), time.time() - t0, lib['symbols'][0]['aliases']))
    else:
        print('extract ok (fonte vazia): %.1f s' % (time.time() - t0))
    assert cli.post('/api/symbols/extract', json={}).status_code == 202, 'depois do done, libera'
    S._extract_runs.clear()

    # ── mirror: o espelho inteiro a partir da SchLib ────────────────────────
    r = cli.post('/api/symbols/mirror', json={})
    j = r.get_json()
    if tem_lib:
        assert r.status_code == 200 and j['symbols'] == len(dados['symbols']), j
        novo = H.load_var_file(espelho)
        assert len(novo['symbols']) == j['symbols'] and novo['stats']['nofootprint'] == j['nofootprint']
        assert novo['source'] == lib_copia and le_bytes(espelho).count(b'\r\n') == j['symbols'] + 9
        assert os.path.isfile(os.path.join(tmp, 'Libs', 'libs-report.txt'))
        # e o save funciona sobre o espelho regerado
        r = cli.post('/api/symbols/save', json={'name': RES, 'parts': res['parts'], 'altium': False})
        assert r.status_code == 200
        assert acha(H.load_var_file(espelho), RES)['parts'] == acha(novo, RES)['parts']
        print('mirror ok: %d símbolos, %d sem footprint' % (j['symbols'], j['nofootprint']))
    else:
        assert r.status_code == 404 and 'SchLib' in j['error'], j
        print('mirror sem SchLib -> 404 ok')
finally:
    H.ROOT, S.ROOT = real_root, real_root
    shutil.rmtree(tmp, ignore_errors=True)

print('test_symserver OK')
