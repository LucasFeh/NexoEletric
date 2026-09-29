# -*- coding: utf-8 -*-
"""Um componente, UM footprint — a regra do dono, aplicada no servidor.

    python tests/test_footprint_vinculo.py

Regra de 2026-09-17: todo componente da biblioteca tem exatamente um footprint vinculado.
Ela mora no SERVIDOR e não na tela, porque tela é sugestão e servidor é garantia — qualquer
caminho que chegue na rota sai com no máximo um.

Até aqui não existia rota nenhuma que gravasse o vínculo: o /save preservava o campo
(symserver.py » _salva_espelho) e nada o escrevia. Estas são as duas rotas novas.

O que este teste prende:
  1. vincular grava UM footprint, com `current: true`;
  2. vincular de novo TROCA, não acumula — é aqui que a regra vive;
  3. footprint vazio DESVINCULA (lista vazia), que é diferente de não mexer;
  4. nome que a PcbLib não tem é RECUSADO: o footprint vem do Altium, e só de lá;
  5. a gravação é cirúrgica: nenhuma outra linha do espelho muda, e o desenho do símbolo
     (parts/partcount) sobrevive ao vínculo;
  6. GET /footprints lista os da PcbLib, com a contagem de usos.

Roda sem rede e sem Altium, num espelho sintético em workspace temporário.
"""
import io
import json
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import hubserver as H            # noqa: E402
import symserver as S            # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ALVO = 'DIODO SCHOTTKY [SMD]'
OUTRO = 'RES [ SMD ]'
FP_REAL = 'DO-214AC'             # existe na pcblib sintética
FP_NOVO = 'QFN-24 NAO DESENHADO'  # não existe na PcbLib: o caso que tem de ser recusado


def sym(nome, fps):
    """A linha como o `simbolo_json` a escreve: COMPACTA, sem espaço depois dos dois-pontos.
    Escrever com o `json.dumps` cru aqui (que põe ', ' e ': ') faria o fixture divergir do
    arquivo de verdade — e foi exatamente assim que a primeira versão deste teste acusou
    "0 usos" para um footprint que estava lá."""
    return ('{"name":%s,"description":"","partcount":1,'
            '"parts":[{"part":1,"pins":[{"num":"1","name":"A","x":0,"y":0,"len":100,'
            '"orient":0,"type":"Passive"}],"graphics":[]}],"footprints":%s}'
            % (json.dumps(nome), json.dumps(fps, separators=(',', ':'))))


tmp = tempfile.mkdtemp(prefix='fp-vinculo-')
try:
    os.makedirs(os.path.join(tmp, 'Libs'))
    espelho = os.path.join(tmp, 'Libs', 'schlib.js')
    with io.open(espelho, 'w', encoding='latin-1', newline='\n') as f:
        f.write('var schlib = {\n"format":"schmirror-lib-v1",\n'
                '"generated":"01/01/2026 00:00:00",\n"symbols":[\n')
        # o alvo comeca com DOIS footprints: o estado que a regra veio proibir
        f.write(sym(ALVO, [{'name': 'DO-214AC', 'incurrentlib': True, 'current': True},
                           {'name': 'DO-214AB', 'incurrentlib': True, 'current': False}]) + '\n')
        f.write(',' + sym(OUTRO, [{'name': 'RES 0805', 'incurrentlib': True,
                                   'current': True}]) + '\n')
        f.write(']};\n')
    # UM footprint por linha, COM pads que tambem tem `name` — e a forma do arquivo real
    # (Libs/pcblib.js: 627 linhas, 618 footprints, 5816 ocorrencias de {"name":). Um findall
    # solto no arquivo inteiro colhia os nomes dos PADS junto e a galeria enchia de "1",
    # "2", "A" — cada um virando um tile vazio. O fixture so prende isso se tiver pads.
    with io.open(os.path.join(tmp, 'Libs', 'pcblib.js'), 'w', encoding='utf-8') as f:
        f.write('var pcblib = {\n"format":"pcblib-v2",\n"footprints":[\n')
        f.write('{"name":"DO-214AC","pads":[{"name":"1","type":"smd"},{"name":"2","type":"smd"}]}\n')
        f.write(',{"name":"DO-214AB","pads":[{"name":"A","type":"smd"},{"name":"K","type":"smd"}]}\n')
        f.write(',{"name":"RES 0805","pads":[{"name":"1","type":"smd"}]}\n')
        f.write(']};\n')

    real_root = H.ROOT
    H.ROOT = S.ROOT = tmp
    S._pcblib_cache['mtime'] = 0          # o cache é por mtime; a raiz mudou
    cli = H.app.test_client()

    def le_sym(nome):
        txt = io.open(espelho, encoding='latin-1').read()
        for ln in txt.splitlines():
            corpo = ln[1:] if ln.startswith(',') else ln
            if corpo.startswith('{"name":' + json.dumps(nome) + ','):
                return json.loads(corpo)
        return None

    # ── 1. vincular grava UM, e TROCA os dois que estavam lá ─────────────────
    antes_outro = le_sym(OUTRO)
    r = cli.post('/api/symbols/footprint', json={'simbolo': ALVO, 'footprint': FP_REAL})
    j = r.get_json()
    assert r.status_code == 200 and j['ok'], j
    fps = le_sym(ALVO)['footprints']
    assert len(fps) == 1, 'a regra é UM footprint, ficaram %d: %s' % (len(fps), fps)
    assert fps[0]['name'] == FP_REAL and fps[0]['current'] is True, fps
    assert fps[0]['incurrentlib'] is True, fps
    assert j['desenhado'] is True and not j['avisos'], j
    print('(1) vincular grava UM footprint e substitui os dois que existiam ok')

    # ── 2. vincular de novo troca, nunca acumula ─────────────────────────────
    cli.post('/api/symbols/footprint', json={'simbolo': ALVO, 'footprint': 'DO-214AB'})
    fps = le_sym(ALVO)['footprints']
    assert len(fps) == 1 and fps[0]['name'] == 'DO-214AB', fps
    print('(2) vincular de novo troca, não acumula ok')

    # ── 3. o desenho sobrevive, e o vizinho não é tocado ─────────────────────
    s = le_sym(ALVO)
    assert s['partcount'] == 1 and len(s['parts'][0]['pins']) == 1, \
        'o vínculo comeu o desenho do símbolo: %s' % s
    assert le_sym(OUTRO) == antes_outro, 'mexeu no símbolo vizinho'
    print('(3) o desenho do símbolo e o vizinho ficam intactos ok')

    # ── 4. vazio DESVINCULA ──────────────────────────────────────────────────
    j = cli.post('/api/symbols/footprint', json={'simbolo': ALVO, 'footprint': ''}).get_json()
    assert j['ok'] and le_sym(ALVO)['footprints'] == [], le_sym(ALVO)['footprints']
    print('(4) footprint vazio desvincula ok')

    # ── 5. nome fora da PcbLib é RECUSADO ────────────────────────────────────
    # O footprint vem do Altium, e só de lá — é a única exceção ao fluxo do projeto (todo o
    # resto nasce no hub e vai PARA o Altium). Até 2026-09-17 esta rota aceitava um nome
    # qualquer "para desenhar depois": isso fazia um footprint nascer no hub, e o componente
    # ia para o Altium apontando para nada.
    r = cli.post('/api/symbols/footprint', json={'simbolo': ALVO, 'footprint': FP_NOVO})
    assert r.status_code == 400, r.get_json()
    assert 'Altium' in r.get_json()['error'], r.get_json()
    assert le_sym(ALVO)['footprints'] == [], 'recusou mas mexeu no espelho'
    print('(5) footprint fora da biblioteca do Altium é recusado, e nada é gravado ok')

    # ── 6. recusas ───────────────────────────────────────────────────────────
    assert cli.post('/api/symbols/footprint', json={'footprint': 'X'}).status_code == 400
    assert cli.post('/api/symbols/footprint',
                    json={'simbolo': 'NAO EXISTE', 'footprint': FP_REAL}).status_code == 404
    assert cli.post('/api/symbols/footprint',
                    json={'simbolo': ALVO, 'footprint': 'X',
                          'footprints': [1, 2]}).status_code == 400, \
        'mandar dois footprints tem de ser recusado: a regra é do servidor'
    print('(6) 400 sem símbolo, 404 no que não existe, 400 em mais de um footprint ok')

    # ── 7. a lista para a tela ───────────────────────────────────────────────
    j = cli.get('/api/symbols/footprints').get_json()
    assert j['ok'], j
    porn = {f['name']: f for f in j['footprints']}
    assert porn['DO-214AC']['desenhado'] is True
    assert FP_NOVO not in porn, 'nada fora da PcbLib pode ter sido gravado: %s' % FP_NOVO
    assert porn['RES 0805']['usos'] == 1, porn['RES 0805']
    assert porn['DO-214AB']['usos'] == 0, 'ninguém usa mais o DO-214AB: %s' % porn['DO-214AB']
    # e NENHUM nome de pad entrou na lista: o arquivo real tem 5816 `{"name":` para 618
    # footprints, e colher todos enchia a galeria de "1", "2", "A" — tiles vazios
    for pad in ('1', '2', 'A', 'K'):
        assert pad not in porn, 'nome de PAD virou footprint na lista: %r' % pad
    assert len(j['footprints']) == 3, \
        'os 3 da pcblib, e nada mais; vieram %d: %s' % (len(j['footprints']), sorted(porn))
    print('(7) GET /footprints lista os da PcbLib, sem colher nome de pad ok')

    print('test_footprint_vinculo OK (um componente, um footprint — garantido no servidor)')
finally:
    H.ROOT = real_root
    S.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)

# ─────────── o footprint de um COMPONENTE do almoxarifado ───────────
# A categoria ("CAPACITOR CERAMICO [SMD]") e o agrupador; quem recebe footprint e a PECA
# ("SMD 1206 4.7pF 50V C0G"). E, diferente da lib da casa, aqui o footprint e CALCULADO pelo
# gerador a cada rodada — entao a escolha so vale se sobreviver ao sincronismo.


def test_almox_footprint_sobrevive_ao_sync():
    import copy
    import guardiao as G2
    import almox2lib as A2

    led = G2.ledger_vazio()
    G2.poe_footprint(led, 'CAPACITOR CERAMICO', 'SMD 1206 4.7pF 50V C0G', 'CAP 0805')
    man = G2.footprints_manuais(led)
    assert man == {('CAPACITOR CERAMICO', 'SMD 1206 4.7pF 50V C0G'): 'CAP 0805'}, man

    # A SECAO TEM DE CHEGAR AO DISCO. `dumps_ledger` e uma lista FECHADA de secoes: a
    # primeira versao desta funcionalidade gravava no dict e o arquivo saia sem ela, sem
    # erro nenhum — a escolha do usuario sumia em silencio.
    txt = G2.dumps_ledger(led)
    assert '"footprints"' in txt, 'a secao nao foi serializada: ' + txt
    volta = json.loads(txt)
    assert volta['footprints']['CAPACITOR CERAMICO']['SMD 1206 4.7pF 50V C0G']['nome'] == 'CAP 0805'

    # e o GERADOR tem de preferi-la ao que ele deduz
    sim = {'nome': 'X [SMD]', 'familia': 'CAPACITOR CERAMICO', 'grupo': 'b', 'forma': 'box',
           'npin': 2, 'mont': 'SMD', 'pkgs': __import__('collections').Counter({'1206': 1}),
           'partes': None}
    assert A2.monta_simbolo.__defaults__ is not None
    import inspect
    ps = list(inspect.signature(A2.monta_simbolo).parameters)
    # pelo nome (fpman) e pelo id do produto no Odoo (fpodoo) — o comportamento das duas
    # chaves, com renomeacao no meio, esta em tests/test_almox_renome.py
    assert 'fpman' in ps and 'fpodoo' in ps, 'monta_simbolo precisa receber as escolhas manuais: %s' % ps

    # desvincular apaga a linha, e a familia vazia nao fica sobrando no arquivo
    G2.poe_footprint(led, 'CAPACITOR CERAMICO', 'SMD 1206 4.7pF 50V C0G', '')
    assert G2.footprints_manuais(led) == {}
    assert 'CAPACITOR CERAMICO' not in (led.get('footprints') or {}), led.get('footprints')
    print('(8) footprint manual: vai ao ledger, chega ao disco e o gerador o respeita ok')


test_almox_footprint_sobrevive_ao_sync()
