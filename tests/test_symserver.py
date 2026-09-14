# -*- coding: utf-8 -*-
"""Os endpoints /api/symbols/* num workspace temporário, pelo test_client do hubserver.

    python tests/test_symserver.py

Monta em tmp um Libs/schlib.js de 3 símbolos, um Libs/pcblib.js mínimo e um
tools/symbols/config.json apontando para uma CÓPIA da biblioteca da casa publicada no
repo (Libs/BIBLIOTECA DE ESQUEMA.SchLib). Sem ela, o que depende
dela vira o caminho "SchLib ausente" (espelho:true, altium:false) e o resto roda igual.

Prova: config; save (o espelho muda SÓ a linha do símbolo e a do generated; altium grava a
SchLib com backup idêntico ao original; pino fora da grade de 10 mil — grade métrica — é
preservado com 3 casas no espelho e na SchLib, via PinFrac; hideNum/hideName do pino vão
para o espelho só quando true e chegam à SchLib; a resposta traz `parts` exatamente como
foram ao disco; `color`/`fill` só em #rrggbb minúsculo e `solid` só booleano — senão 400 —
e a cor válida vai ao espelho e à SchLib (Color/AreaColor) e volta na releitura; 404; 423
com a lib ocupada; 500 com a SchLib faltando; o nome novo do rename-map cai para o antigo);
lib add/rename/delete/409/404 (a cor fica no símbolo guardado, fora do fingerprint); extract 202+409 e
o stream de verdade (--limite 1) até o `event: done`; mirror regera o espelho inteiro com o
rename-map aplicado (`{rename:false}` desliga) e, com `{flags:true}`, só traz os
hideNum/hideName de volta — o arquivo volta byte a byte ao que o leitor gerou.
"""
import copy
import io
import os
import re
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

# A biblioteca da casa publicada dentro do repositorio (tools/libpath.py). Era um
# caminho de maquina (D:/ ou a UNC do PC do Lucas), entao este teste PULAVA em
# silencio em qualquer clone que nao fosse o da bancada -- inclusive no servidor.
LOCAL = os.path.join(RAIZ, 'Libs', 'BIBLIOTECA DE ESQUEMA.SchLib')
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


# ─── a suíte não pode escrever na biblioteca de verdade ──────────────────────
# Tudo aqui mora em tempdir; a Libs/ do repositório é só LEITURA (a .SchLib da casa é
# copiada de lá, nunca escrita). Teste que suja o acervo versionado é um bug de teste —
# quem roda a suíte depois não sabe mais o que é dele e o que é do teste —, então a
# invariante fica provada aqui, e não na memória de quem escreveu. A foto é (tamanho,
# mtime_ns): pega até a regravação de conteúdo idêntico, que comparar hash não pegaria.
def _foto_libs():
    fora = {}
    for raiz, _dirs, files in os.walk(os.path.join(RAIZ, 'Libs')):
        for f in files:
            p = os.path.join(raiz, f)
            try:
                st = os.stat(p)
            except OSError:                       # sumiu entre o walk e o stat: conta como mexido
                fora[p] = None
                continue
            fora[p] = (st.st_size, st.st_mtime_ns)
    return fora


def confere_libs(antes):
    depois = _foto_libs()
    mexidos = sorted(set(antes) ^ set(depois)) + sorted(p for p in set(antes) & set(depois)
                                                       if antes[p] != depois[p])
    assert not mexidos, ('a suite escreveu na Libs/ de verdade (tudo tem que ficar no tempdir): '
                         + ', '.join(os.path.relpath(p, RAIZ) for p in mexidos))


# ─── workspace temporário ─────────────────────────────────────────────────────
libs_antes = _foto_libs()
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
    # cor só em '#rrggbb' minúsculo (a regex do serializeSymbol do hub); solid só booleano
    for campo, valor in (('color', 'red'), ('color', '#FF0000'), ('fill', '#12345'), ('fill', 255), ('color', '#ggeeff'),
                         ('solid', 'sim'), ('solid', 1)):
        ruim = copy.deepcopy(res['parts'])
        ruim[0]['graphics'].append({'g': 'rect', 'x1': 0, 'y1': 0, 'x2': 1, 'y2': 1, 'solid': True, campo: valor})
        r = cli.post('/api/symbols/save', json={'name': RES, 'parts': ruim})
        assert r.status_code == 400 and campo in r.get_json()['error'], (campo, valor, r.get_json())
    assert le_bytes(espelho) == antes, 'pedido recusado não pode mexer no espelho'

    # ── save: o espelho muda SÓ a linha do símbolo (e o generated) ──────────
    mod = copy.deepcopy(res['parts'])
    rect = next(g for g in mod[0]['graphics'] if g['g'] == 'rect')
    rect['x2'] += 50
    mod[0]['pins'].append(pin('9', 0, 200, 90, 'NOVO'))
    lib_antes = le_bytes(lib_copia) if tem_lib else None
    r = cli.post('/api/symbols/save', json={'name': RES, 'parts': mod, 'altium': True})
    j = r.get_json()
    assert j['parts'] == acha(H.load_var_file(espelho), RES)['parts'], 'a resposta traz as parts como foram ao disco'
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
    # e a resposta traz o pino NORMALIZADO (3 casas), não o que foi mandado (79.0004)
    q0 = j['parts'][0]['pins'][0]
    assert (q0['x'], q0['y'], q0['len']) == (105.5, -78.74, 79) and j['parts'] == acha(H.load_var_file(espelho), OUTRO)['parts'], q0
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

    # olho do pino: hideNum/hideName entram no espelho só quando true (false não é gravado —
    # ausente é visível) e chegam à SchLib; qualquer outra coisa que não seja booleano é 400
    olho = copy.deepcopy(outro['parts'])
    olho[0]['pins'][0].update(hideNum=True, hideName=False)
    if len(olho[0]['pins']) > 1:
        olho[0]['pins'][-1].update(hideNum=False, hideName=True)
    r = cli.post('/api/symbols/save', json={'name': OUTRO, 'parts': olho, 'altium': tem_lib})
    assert r.status_code == 200, r.get_json()
    pp = acha(H.load_var_file(espelho), OUTRO)['parts'][0]['pins']
    assert list(pp[0].keys()) == ['num', 'name', 'x', 'y', 'len', 'orient', 'type', 'hideNum'], list(pp[0].keys())
    assert pp[0]['hideNum'] is True and 'hideName' not in pp[0]
    if len(pp) > 1:
        assert pp[-1].get('hideName') is True and 'hideNum' not in pp[-1], pp[-1]
    if tem_lib:
        lidos = {q['num']: q for q in acha(L.le_schlib(lib_copia), OUTRO)['parts'][0]['pins']}
        assert lidos[pp[0]['num']].get('hideNum') is True and 'hideName' not in lidos[pp[0]['num']], lidos[pp[0]['num']]
        if len(pp) > 1:
            assert lidos[pp[-1]['num']].get('hideName') is True and 'hideNum' not in lidos[pp[-1]['num']]
    assert 'hideName' not in r.get_json()['parts'][0]['pins'][0] and r.get_json()['parts'][0]['pins'][0]['hideNum'] is True, \
        'a resposta traz os flags como o espelho: só o true'
    ruim = copy.deepcopy(outro['parts'])
    ruim[0]['pins'][0]['hideNum'] = 'sim'
    r = cli.post('/api/symbols/save', json={'name': OUTRO, 'parts': ruim})
    assert r.status_code == 400 and 'hideNum' in r.get_json()['error'], r.get_json()
    r = cli.post('/api/symbols/save', json={'name': OUTRO, 'parts': outro['parts'], 'altium': tem_lib})
    assert r.status_code == 200
    if tem_lib:
        assert not P.compara(P.esperado({'name': OUTRO, 'parts': outro['parts']}),
                             acha(L.le_schlib(lib_copia), OUTRO)['parts']), 'voltou ao original, flags inclusive'
    print('save com hideNum/hideName -> espelho so com true, SchLib com os bits ok')

    # cores: color/fill válidos vão ao espelho como vieram (depois do solid), chegam à SchLib
    # como Color/AreaColor e voltam na releitura; sem eles a SchLib fica com a paleta
    cor = copy.deepcopy(res['parts'])
    rc = next(g for g in cor[0]['graphics'] if g['g'] == 'rect')
    rc.pop('color', None); rc.pop('fill', None)
    rc.update(solid=True, color='#ff0000', fill='#00ff00')
    r = cli.post('/api/symbols/save', json={'name': RES, 'parts': cor, 'altium': tem_lib})
    j = r.get_json()
    assert r.status_code == 200, j
    linha = next(ln for ln in le_bytes(espelho).split(b'\r\n') if ln.lstrip(b',').startswith(pref))
    assert b'"solid":true,"color":"#ff0000","fill":"#00ff00"}' in linha, linha[:300]
    assert j['parts'] == acha(H.load_var_file(espelho), RES)['parts'] and \
        next(g for g in j['parts'][0]['graphics'] if g['g'] == 'rect')['fill'] == '#00ff00'
    if tem_lib:
        rr = next(g for g in acha(L.le_schlib(lib_copia), RES)['parts'][0]['graphics'] if g['g'] == 'rect')
        assert (rr['color'], rr['fill'], rr['solid']) == ('#ff0000', '#00ff00', True), rr
    r = cli.post('/api/symbols/save', json={'name': RES, 'parts': res['parts'], 'altium': tem_lib})
    assert r.status_code == 200, r.get_json()
    if tem_lib:
        assert not P.compara(P.esperado({'name': RES, 'parts': res['parts']}),
                             acha(L.le_schlib(lib_copia), RES)['parts']), 'voltou ao original, cores inclusive'
    print('save com color/fill -> espelho, SchLib (Color/AreaColor) e releitura ok')

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
    assert cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': dict(
        resistor, graphics=[dict(resistor['graphics'][0], color='red')])}).status_code == 400, 'cor inválida no add'
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
    # mesma geometria, outro nome: 409 devolvendo quem já está lá — com outra cor também
    r = cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': dict(resistor, name='Res de novo')})
    assert r.status_code == 409 and r.get_json()['symbol']['id'] == 's0001', r.get_json()
    r = cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': dict(
        resistor, name='Res azul', graphics=[dict(resistor['graphics'][0], color='#0000ff', fill='#ffffb0')])})
    assert r.status_code == 409 and r.get_json()['symbol']['id'] == 's0001', 'a cor não é identidade'
    # mesmo nome, outra geometria: 409
    maior = copy.deepcopy(resistor)
    maior['graphics'][0]['x2'] = 150
    assert cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': maior}).status_code == 409
    # kind ausente: pelo número de pinos
    maior['graphics'][0].update(color='#800000', fill='#ffffb0', solid=True)
    r = cli.post('/api/symbols/lib', json={'op': 'add', 'symbol': dict(maior, name='Resistor largo', kind=None)})
    s2 = r.get_json()['symbol']
    assert r.status_code == 200 and s2['id'] == 's0002' and s2['kind'] == 'generico'
    assert (s2['graphics'][0]['color'], s2['graphics'][0]['fill']) == ('#800000', '#ffffb0'), 'a cor fica no símbolo guardado'
    assert E.le_symlib(symlib)['symbols'][1]['graphics'][0]['fill'] == '#ffffb0'
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
        # o rename-map foi aplicado: o espelho sai com o nome novo, não com o da SchLib
        assert j['rename'] == {'renomeados': 1, 'fundidos': 0, 'footprints': 0}, j['rename']
        assert acha(novo, RES_NOVO) and not any(s['name'] == RES for s in novo['symbols'])
        # e o save funciona sobre o espelho regerado
        r = cli.post('/api/symbols/save', json={'name': RES_NOVO, 'parts': res['parts'], 'altium': False})
        assert r.status_code == 200, r.get_json()
        assert acha(H.load_var_file(espelho), RES_NOVO)['parts'] == acha(novo, RES_NOVO)['parts']
        print('mirror ok: %d símbolos, %d sem footprint, %d nome(s) do rename-map' % (
            j['symbols'], j['nofootprint'], j['rename']['renomeados']))

        # {rename:false}: o espelho fica com os nomes que a SchLib real tem
        j = cli.post('/api/symbols/mirror', json={'rename': False}).get_json()
        assert j['rename'] == {'renomeados': 0, 'fundidos': 0, 'footprints': 0}, j
        cru = H.load_var_file(espelho)
        assert acha(cru, RES) and not any(s['name'] == RES_NOVO for s in cru['symbols'])

        # {flags:true}: tirados os hideNum/hideName do espelho, o mirror só os traz de volta —
        # o arquivo volta byte a byte ao que o leitor gerou, linha do generated inclusive
        base = le_bytes(espelho)
        sem = re.sub(rb',"hide(?:Num|Name)":true', b'', base)
        assert sem != base, 'a lib de teste tinha que ter pino escondido'
        with open(espelho, 'wb') as f:
            f.write(sem)
        j = cli.post('/api/symbols/mirror', json={'flags': True}).get_json()
        assert j['ok'] and j['flags'] and j['symbols'] == len(cru['symbols']), j
        assert j['mudaram'] and j['comFlag'] and not j['semPar'] and not j['pinosSemPar'], j
        assert not j['avisos'] and le_bytes(espelho) == base, 'o passo dos flags mudou algo alem dos flags'
        print('mirror flags ok: %d linhas de volta, %d com pino escondido' % (j['mudaram'], j['comFlag']))
    else:
        assert r.status_code == 404 and 'SchLib' in j['error'], j
        print('mirror sem SchLib -> 404 ok')

    # ── guardião: altium-changes / altium-apply / almox-sync ────────────────
    import guardiao as G
    ledger = os.path.join(tmp, 'Libs', 'lib-ledger.json')
    if tem_lib:
        assert cli.post('/api/symbols/mirror', json={}).status_code == 200      # espelho = SchLib, ledger sabe
        assert os.path.isfile(ledger), 'o /mirror registra a SchLib no ledger'
    # (6) o que o hub escreveu não é "mudança do Altium"
    j = cli.get('/api/symbols/altium-changes').get_json()
    assert j['ok'] and j['pendente'] is False and j['deep'] is False and j['itens'] == [], j
    casa = next(a for a in j['arquivos'] if a['acervo'] == 'altium')
    assert casa['arquivo'] == G.chave_arquivo(tmp, lib_copia) == 'lib/BIBLIOTECA DE ESQUEMA.SchLib', casa
    assert casa['caminho'] == lib_copia and casa['existe'] == tem_lib and not casa['mudou']
    if tem_lib:
        assert casa['conhecido'] and 'adotado' not in casa
        r = cli.post('/api/symbols/save', json={'name': RES_NOVO, 'parts': mod, 'altium': True})
        assert r.status_code == 200 and r.get_json()['altium'], r.get_json()
        j = cli.get('/api/symbols/altium-changes').get_json()
        assert not j['pendente'] and not next(a for a in j['arquivos'] if a['acervo'] == 'altium')['mudou']
        print('save do hub nao vira "mudou no Altium" ok')
        # (7) edição por fora (sem raiz: é o Altium) -> pendente; deep lista; apply troca só a linha
        mod2 = copy.deepcopy(res['parts'])
        next(g for g in mod2[0]['graphics'] if g['g'] == 'rect')['x2'] += 120
        P.patch(lib_copia, {'name': RES, 'parts': mod2}, backup=False)
        j = cli.get('/api/symbols/altium-changes').get_json()
        assert j['pendente'] and next(a for a in j['arquivos'] if a['acervo'] == 'altium')['mudou'] and j['itens'] == []
        j = cli.get('/api/symbols/altium-changes?deep=1').get_json()
        assert j['deep'] and j['itens'] == [{'acervo': 'altium', 'name': RES_NOVO, 'nomeAltium': RES, 'mudou': ['geometria']}], j['itens']
        antes = le_bytes(espelho)
        r = cli.post('/api/symbols/altium-apply', json={'itens': j['itens']})
        jj = r.get_json()
        assert r.status_code == 200 and jj['ok'] and jj['aplicados'] == 1 and jj['itens'][0]['acao'] == 'trocado', jj
        linhas_a, linhas_d = antes.split(b'\r\n'), le_bytes(espelho).split(b'\r\n')
        assert len(linhas_a) == len(linhas_d)
        pref = b'{"name":' + L._js(RES_NOVO).encode() + b','
        for i, (a, d) in enumerate(zip(linhas_a, linhas_d)):
            if d.lstrip(b',').startswith(pref):
                assert a != d
            elif i == 2:
                assert a.startswith(b'"generated":') and d.startswith(b'"generated":')
            else:
                assert a == d, 'linha %d mudou: %r' % (i, d[:60])
        assert not P.compara(P.esperado({'name': RES_NOVO, 'parts': mod2}), acha(H.load_var_file(espelho), RES_NOVO)['parts'])
        j = cli.get('/api/symbols/altium-changes?deep=1').get_json()
        assert not j['pendente'] and j['itens'] == [], j
        assert cli.post('/api/symbols/altium-apply', json={'itens': []}).status_code == 400
        assert cli.post('/api/symbols/altium-apply', json={'itens': [{'acervo': 'x'}]}).status_code == 400
        assert cli.post('/api/symbols/altium-apply', json={'itens': [{'acervo': 'almox', 'familia': 'A'}]}).status_code == 400
        r = cli.post('/api/symbols/altium-apply', json={'itens': [{'acervo': 'altium', 'name': 'NAO EXISTE'}]})
        assert r.status_code == 200 and r.get_json()['aplicados'] == 0 and not r.get_json()['itens'][0]['ok']
        print('altium-changes/altium-apply (casa) ok')

    almox_src = next((d for d in (r'D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\Libs\Almox', os.path.join(RAIZ, 'Libs', 'Almox'))
                      if os.path.isfile(os.path.join(d, 'DIAC ALMOX.SchLib'))), None)
    tem_almox = almox_src is not None and all(os.path.isfile(os.path.join(RAIZ, 'Libs', f)) for f in G.ESPELHOS_ALMOX)
    if tem_almox:
        os.makedirs(os.path.join(tmp, 'Libs', 'Almox'))
        for f in ('DIAC ALMOX.SchLib', 'CAPACITOR ALMOX.SchLib'):
            shutil.copy2(os.path.join(almox_src, f), os.path.join(tmp, 'Libs', 'Almox', f))
        for f in G.ESPELHOS_ALMOX:
            shutil.copy2(os.path.join(RAIZ, 'Libs', f), os.path.join(tmp, 'Libs', f))
        j = cli.get('/api/symbols/altium-changes').get_json()            # adota as libs nunca vistas
        alm = [a for a in j['arquivos'] if a['acervo'] == 'almox']
        assert len(alm) == 2 and all(a['adotado'] and not a['mudou'] for a in alm) and not j['pendente'], alm
        assert j['ledger']['gerado'] == 2 and j['ledger']['protegidos'] == 0
        cam = os.path.join(tmp, 'Libs', 'Almox', 'DIAC ALMOX.SchLib')
        comp, parts = next(iter(G.le_familia(cam).items()))
        mod3 = copy.deepcopy(parts)
        mod3[0]['graphics'].append({'g': 'rect', 'x1': -120, 'y1': -90, 'x2': 120, 'y2': 90, 'solid': False})
        P.patch(cam, {'name': comp, 'parts': mod3}, backup=False)
        j = cli.get('/api/symbols/altium-changes').get_json()
        assert j['pendente'] and next(a for a in j['arquivos'] if a['familia'] == 'DIAC')['mudou']
        j = cli.get('/api/symbols/altium-changes?deep=1').get_json()
        it = j['itens']
        assert len(it) == 1 and (it[0]['acervo'], it[0]['familia'], it[0]['componente'], it[0]['mudou']) == \
            ('almox', 'DIAC', comp, ['geometria']), it
        r = cli.post('/api/symbols/altium-apply', json={'itens': it})
        assert r.status_code == 200 and r.get_json()['aplicados'] == 1 and r.get_json()['itens'][0]['acao'] == 'protegido'
        led = G.carrega_ledger(tmp)
        assert led['protegidos']['DIAC'][comp]['origem'] == 'altium'
        _var, esp = G.le_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'))
        sim = next(s for s in esp['symbols'] if s['name'] == 'DIAC [PTH]')
        assert sim['origem'] == 'altium' and sim['protegidos'] == 1 and G.fp_parts(sim['parts']) == G.fp_parts(mod3)
        j = cli.get('/api/symbols/altium-changes?deep=1').get_json()
        assert not j['pendente'] and j['itens'] == []
        print('altium-changes/altium-apply (almoxarifado) ok')

        # ── /save-almox: o desenho de UM componente vai para os TRES destinos ──────────
        # O que se prova aqui e o que o usuario pediu: mexer no simbolo de um componente
        # nao pode mexer nos irmaos dele nem no desenho da familia, e tem que sobreviver ao
        # proximo sincronismo (por isso o ledger).
        alvo_fam, alvo_comp = 'DIAC', comp
        _v0, esp0 = G.le_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'))
        sim0 = next(x for x in esp0['symbols'] if x['name'] == 'DIAC [PTH]')
        fam_parts_antes = G.fp_parts(sim0['parts'])
        irmaos_antes = {v['altium']: G.fp_parts(v.get('parts')) if v.get('parts') else None
                        for v in sim0['valores'] if v.get('altium') != alvo_comp}

        novo_desenho = copy.deepcopy(parts)
        novo_desenho[0]['graphics'].append({'g': 'ellipse', 'cx': 0, 'cy': 0, 'rx': 40, 'ry': 40})
        r = cli.post('/api/symbols/save-almox', json={
            'familia': alvo_fam, 'componente': alvo_comp,
            'parts': novo_desenho, 'altium': True})
        j = r.get_json()
        assert r.status_code == 200 and j['ok'], j
        assert j['espelho'] and j['altium'] and j['protegido'], j
        assert (j['familia'], j['componente']) == (alvo_fam, alvo_comp), j

        # (a) o VALOR ganhou geometria propria no espelho
        _v1, esp1 = G.le_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'))
        sim1 = next(x for x in esp1['symbols'] if x['name'] == 'DIAC [PTH]')
        val = next(v for v in sim1['valores'] if v['altium'] == alvo_comp)
        assert G.fp_parts(val['parts']) == G.fp_parts(j['parts']), 'o valor tem que ficar com o desenho novo'
        # (b) a FAMILIA nao foi tocada
        assert G.fp_parts(sim1['parts']) == fam_parts_antes, 'o desenho da familia nao pode mudar'
        # (c) os IRMAOS nao foram tocados
        for v in sim1['valores']:
            if v['altium'] == alvo_comp:
                continue
            agora = G.fp_parts(v.get('parts')) if v.get('parts') else None
            assert agora == irmaos_antes.get(v['altium']), 'o componente %s mudou sem ninguem pedir' % v['altium']
        # (d) a .SchLib do Altium recebeu, so naquele componente
        lido = G.le_familia(cam)
        assert G.fp_parts(lido[alvo_comp]) == G.fp_parts(j['parts']), 'a SchLib tem que ter o desenho novo'
        # (e) protegido como 'hub' — e o que faz sobreviver ao sync
        led = G.carrega_ledger(tmp)
        prot = led['protegidos'][alvo_fam][alvo_comp]
        assert prot['origem'] == 'hub' and G.fp_parts(prot['parts']) == G.fp_parts(j['parts']), prot
        # (f) o proprio save nao pode aparecer como "mudou no Altium"
        j2 = cli.get('/api/symbols/altium-changes?deep=1').get_json()
        assert not j2['pendente'] and j2['itens'] == [], j2

        # recusas
        assert cli.post('/api/symbols/save-almox', json={
            'familia': alvo_fam, 'componente': 'NAO EXISTE', 'parts': novo_desenho}).status_code == 404
        assert cli.post('/api/symbols/save-almox', json={
            'familia': 'NAO EXISTE', 'componente': alvo_comp, 'parts': novo_desenho}).status_code == 404
        assert cli.post('/api/symbols/save-almox', json={
            'familia': alvo_fam, 'componente': alvo_comp, 'parts': []}).status_code == 400
        assert cli.post('/api/symbols/save-almox', json={'parts': novo_desenho}).status_code == 400

        # a família pode vir como o NOME do símbolo aberto no hub ("DIAC [PTH]", que é o que o
        # editor manda): resolve para a família do arquivo, e o ledger continua chaveado por ela
        r = cli.post('/api/symbols/save-almox', json={
            'familia': 'DIAC [PTH]', 'componente': alvo_comp, 'parts': novo_desenho, 'altium': False})
        j = r.get_json()
        assert r.status_code == 200 and j['ok'] and j['familia'] == 'DIAC' and j['espelho'] and not j['altium'], j
        assert G.carrega_ledger(tmp)['protegidos']['DIAC'][alvo_comp]['origem'] == 'hub'
        # componente que está no espelho mas ainda não na .SchLib (entrou no Odoo depois do último
        # sincronismo): salva no espelho e no ledger, avisa, e o arquivo fica para o sincronismo
        _vn, espn = G.le_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'))
        simn = next(x for x in espn['symbols'] if x['name'] == 'DIAC [PTH]')
        novo_val = copy.deepcopy(simn['valores'][0])
        novo_val.update(altium='PTH NOVO-DO-ODOO', label='NOVO-DO-ODOO', id=999)
        novo_val.pop('parts', None)
        simn['valores'].append(novo_val)
        G.grava_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'), _vn, espn)
        r = cli.post('/api/symbols/save-almox', json={
            'familia': 'DIAC [PTH]', 'componente': 'PTH NOVO-DO-ODOO', 'parts': novo_desenho, 'altium': True})
        j = r.get_json()
        assert r.status_code == 200 and j['ok'] and j['espelho'] and j['protegido'] and not j['altium'], j
        assert any('próximo sincronismo' in a for a in j['avisos']), j['avisos']
        assert G.carrega_ledger(tmp)['protegidos']['DIAC']['PTH NOVO-DO-ODOO']['origem'] == 'hub'
        assert 'PTH NOVO-DO-ODOO' not in G.le_familia(cam), 'a SchLib não pode ter sido tocada'
        _vn2, espn2 = G.le_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'))
        vn = next(v for x in espn2['symbols'] if x['name'] == 'DIAC [PTH]' for v in x['valores'] if v['altium'] == 'PTH NOVO-DO-ODOO')
        assert G.fp_parts(vn['parts']) == G.fp_parts(j['parts']), 'o valor novo ficou com o desenho no espelho'
        # limpa o valor sintético: o teste do almox-sync, logo abaixo, conta os protegidos da fixture
        with G._lock:
            led = G.carrega_ledger(tmp)
            assert G._tira_prot(led, 'DIAC', 'PTH NOVO-DO-ODOO')
            G.grava_ledger(tmp, led)
        simn2 = next(x for x in espn2['symbols'] if x['name'] == 'DIAC [PTH]')
        simn2['valores'] = [v for v in simn2['valores'] if v['altium'] != 'PTH NOVO-DO-ODOO']
        G.grava_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'), _vn2, espn2)
        print('save-almox ok (familia pelo nome do simbolo; componente que ainda nao esta na SchLib)')

        # ── atualiza_espelhos: o desenho PROPRIO do componente volta ao valor depois do sync ──
        # O gerador refaz os valores do snapshot e apaga valores[].parts; o guardiao poe de volta
        # o do componente protegido cuja geometria NAO e a do simbolo (a mais frequente). Sem
        # isso o desenho de um componente sumia do hub no sincronismo seguinte. Nao precisa da
        # .SchLib: e so espelho + ledger, num simbolo qualquer com 3+ valores e sem protecao.
        led = G.carrega_ledger(tmp)
        _vg, espg = G.le_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'))
        ja_prot = {q.get('simbolo') for f_ in led['protegidos'].values() for q in f_.values()}
        simg = next(x for x in espg['symbols']
                    if len(x.get('valores') or []) >= 3 and x['name'] not in ja_prot and 'origem' not in x)
        fam_g, nome_g = simg['familia'], simg['name']
        minoria, maioria = simg['valores'][0]['altium'], [v['altium'] for v in simg['valores'][1:3]]
        for c in maioria:
            G._poe_prot(led, fam_g, c, mod3, 'hub', nome_g)                # a maioria: mod3
        G._poe_prot(led, fam_g, minoria, novo_desenho, 'hub', nome_g)      # a minoria: outro desenho
        for v in simg['valores']:
            v.pop('parts', None)                                           # como o gerador deixa
        G.grava_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'), _vg, espg)
        tocados = G.atualiza_espelhos(tmp, led, log=lambda *a: None)
        assert nome_g in tocados, tocados
        _vg2, espg2 = G.le_espelho_almox(os.path.join(tmp, 'Libs', 'almox-basicos.js'))
        simg2 = next(x for x in espg2['symbols'] if x['name'] == nome_g)
        assert G.fp_parts(simg2['parts']) == G.fp_parts(mod3) and simg2['protegidos'] == 3, 'o simbolo fica com a geometria da maioria'
        vg = {v['altium']: v for v in simg2['valores']}
        assert G.fp_parts(vg[minoria]['parts']) == G.fp_parts(novo_desenho), 'a minoria volta para o proprio valor'
        assert all('parts' not in vg[c] for c in maioria), 'quem tem a geometria do simbolo nao precisa de parts proprio'
        assert G.atualiza_espelhos(tmp, led, log=lambda *a: None) == [], 'segunda passada tem que ser vazia'
        # o ledger em disco nao tem essas protecoes: nada foi gravado nele, e o resto do teste segue
        G.atualiza_espelhos(tmp, G.carrega_ledger(tmp), log=lambda *a: None)
        print('atualiza_espelhos devolve o desenho proprio do componente ao espelho ok (%s)' % nome_g)

        # almox-sync: reserva, 409, 400 sem senha, e o stream de verdade (sem o gerador)
        S._sync_runs.clear()
        S.GUARDIAO_EXTRA[:] = ['--sem-gerador']
        try:
            if not os.environ.get('ODOO_SENHA'):
                assert cli.post('/api/symbols/almox-sync', json={'pull': True}).status_code == 400, 'pull sem senha'
            r = cli.post('/api/symbols/almox-sync', json={})
            assert r.status_code == 202 and r.get_json()['runId'].startswith('g_'), r.get_json()
            run = r.get_json()['runId']
            assert cli.post('/api/symbols/almox-sync', json={}).status_code == 409
            assert cli.get('/api/symbols/almox-sync/nao-existe/stream').status_code == 404
            r = cli.get('/api/symbols/almox-sync/%s/stream' % run)
            corpo = r.get_data(as_text=True)
            assert r.mimetype == 'text/event-stream'
            assert 'event: done' in corpo and 'event: error' not in corpo, corpo[-800:]
            assert 'data: gerador pulado' in corpo and 'data: guardião:' in corpo, corpo[:600]
            done = S.json.loads(corpo.split('event: done\ndata: ', 1)[1].split('\n', 1)[0])
            assert done['ok'] and done['resumo']['ok'] and done['resumo']['gerados'] == 2
            assert [p['componente'] for p in done['resumo']['protegidos']] == [comp] and done['resumo']['repostos']
            assert cli.get('/api/symbols/almox-sync/%s/stream' % run).status_code == 404, 'reserva consumida'
            assert cli.post('/api/symbols/almox-sync', json={}).status_code == 202, 'depois do done, libera'
        finally:
            S.GUARDIAO_EXTRA[:] = []
            S._sync_runs.clear()
        print('almox-sync 202/409/400 + stream do guardião ok')
    else:
        print('PULADO: sem DIAC/CAPACITOR ALMOX.SchLib ou sem os espelhos almox-*.js')
finally:
    H.ROOT, S.ROOT = real_root, real_root
    shutil.rmtree(tmp, ignore_errors=True)

confere_libs(libs_antes)
print('test_symserver OK')
