# -*- coding: utf-8 -*-
"""As ferramentas do chat: a cerca do projeto aberto, e o fato de que propor não é gravar.

    python tests/test_chat_operador.py

O usuário vai conversar com um operador que mexe no projeto que está na tela. Duas promessas
sustentam isso, e nenhuma das duas pode morar no prompt do sistema — prompt é conselho, e
modelo que erra o caminho erra calado. As duas são código, e é isso que este teste prende:

  1. a CERCA: caminho para fora do workspace é recusado (`..\\..\\Windows\\win.ini` e caminho
     absoluto), arquivo de segredo é recusado mesmo sendo texto dentro da raiz, e o projeto
     do lado é recusado com o mesmo rigor que o win.ini — ler o projeto errado já é mexer no
     projeto errado, porque é dali que sai a próxima proposta. Dois buracos medidos nesta
     cerca, e por isso prendidos aqui: ARQUIVO OCULTO era lido (e o `.hub-odoo.json` devolveu
     a senha do Odoo do envio da lista), e "." / ".." em qualquer segmento faziam o `aplica()`
     escrever NA RAIZ do workspace, fora de Projects/;
  2. ESCRITA NÃO ESCREVE: as três ferramentas de escrita são chamadas com o disco
     fotografado antes (tamanho + mtime_ns de TODO arquivo, como em test_almox_excluir.py) e
     a foto tem de sair idêntica. Quem grava é `aplica()`, e só depois do clique do usuário.

E mais quatro coisas que já custaram caro neste repositório:

  3. a leitura PAGINA e diz quantos ficaram de fora. Cortar calado faz o modelo concluir
     sobre meia folha achando que viu a folha inteira;
  4. `aplica()` RECUSA depois que o arquivo muda por fora. São dois escritores (AI-GUIDE):
     o usuário edita pelo hub enquanto a conversa acontece, e a proposta que nasceu de uma
     foto velha não pode passar por cima do desenho dele;
  5. a linha gravada sai byte a byte no formato do espelho — objeto plano, `\\uXXXX` de
     U+007E para cima, como o `jline` do hub-core. Divergir aí faria todo item tocado pelo
     chat aparecer no `git diff` sem ter mudado nada;
  6. a gravação segue o SYMLINK (a lição de 2026-09-16: `os.replace` sobre o link substitui
     O LINK e o deploy seguinte come o trabalho). Essa parte pula com mensagem clara onde o
     SO não deixa criar symlink — a bancada é Windows.

Roda sem rede, sem Odoo e sem Altium, num workspace temporário: nada é escrito na Libs/ nem
em Projects/ de verdade.
"""
import io
import json
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'chat'))

import operador as O                                             # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ABERTO = 'PRJ - ABERTO'
FECHADO = 'PRJ - FECHADO'
# um nome com caractere fora do ASCII: é ele que prova o escape \uXXXX de ida e de volta
SYM_ACENTO = '5 vias 180\u00ba 2.54mm Macho'


# ─── foto do disco (mesma receita de tests/test_almox_excluir.py) ─────────────
def foto(raiz):
    """(tamanho, mtime_ns) de tudo que existe — pega até a regravação de conteúdo igual"""
    fora = {}
    for base, _dirs, arqs in os.walk(raiz):
        for a in arqs:
            p = os.path.join(base, a)
            try:
                st = os.stat(p)
            except OSError:
                fora[p] = None
                continue
            fora[p] = (st.st_size, st.st_mtime_ns)
    return fora


def confere_foto(antes, depois, quem):
    mexidos = sorted(set(antes) ^ set(depois)) + sorted(p for p in set(antes) & set(depois)
                                                        if antes[p] != depois[p])
    assert not mexidos, '%s mexeu em arquivo: %s' % (quem, ', '.join(mexidos))


def le(caminho):
    with io.open(caminho, encoding='utf-8') as f:
        return f.read()


def escreve(caminho, texto):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with io.open(caminho, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)


def jl(obj):
    """a linha como o hub a escreveria — o teste monta a fixture com a mesma régua"""
    return O._jline(obj)


# ─── workspace temporário ────────────────────────────────────────────────────
tmp = tempfile.mkdtemp(prefix='chat-operador-')
libs_antes = foto(os.path.join(RAIZ, 'Libs'))
projs_antes = foto(os.path.join(RAIZ, 'Projects'))

CTX = {'raiz': tmp, 'projeto': ABERTO, 'tela': {'vista': 'sch', 'folha': 'main'}}
P_ABERTO = os.path.join(tmp, 'Projects', ABERTO)
P_FECHADO = os.path.join(tmp, 'Projects', FECHADO)

try:
    # ── bibliotecas de mentira ───────────────────────────────────────────────
    escreve(os.path.join(tmp, 'Libs', 'schlib.js'), 'var schlib = ' + json.dumps({
        'format': 'schlib-v2', 'units': 'mil', 'symbols': [
            {'name': 'RES', 'description': 'resistor da casa', 'partcount': 1,
             'footprints': [{'name': 'R0805', 'current': True, 'incurrentlib': True}],
             'parts': [{'part': 1, 'pins': [{'num': '1', 'name': '1'},
                                            {'num': '2', 'name': '2'}]}]},
            {'name': 'LED', 'description': 'led da casa', 'partcount': 1, 'footprints': [],
             'parts': [{'part': 1, 'pins': [{'num': 'A', 'name': 'A'},
                                            {'num': 'K', 'name': 'K'}]}]}]}) + ';\n')

    escreve(os.path.join(tmp, 'Libs', 'pcblib.js'), 'var pcblib = ' + json.dumps({
        'format': 'pcblib-v1', 'units': 'mm', 'footprints': [
            {'name': 'R0805', 'pads': [{'name': '1'}, {'name': '2'}]},
            {'name': 'CAP 0603', 'pads': [{'name': '1'}, {'name': '2'}]},
            {'name': 'M7', 'pads': [{'name': str(n)} for n in range(1, 6)]}]}) + ';\n')

    escreve(os.path.join(tmp, 'Libs', 'almox-basicos.js'), 'var almoxBasicos = ' + json.dumps({
        'format': 'schlib-v2', 'lib': 'almox-basicos', 'symbols': [
            {'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'designator': 'R',
             'parts': [{'part': 1, 'pins': [{'num': '1'}, {'num': '2'}]}],
             'valores': [{'id': 7, 'altium': 'SMD 0603 1K', 'label': '1K', 'value': '1K',
                          'estoque': 42.0, 'local': 'G-1-1', 'custo': 0.02,
                          'mpn': 'RC0603FR-071KL', 'footprint': 'R0805',
                          'itens': [{'odoo': '777', 'nome': 'Resistor Metal Filme 1K SMD 0603'}]},
                         {'id': 8, 'altium': 'SMD 0603 10K', 'label': '10K', 'estoque': 0.0,
                          'footprint': 'R0805', 'itens': [{'odoo': '778', 'nome': 'Resistor 10K'}]}]},
            {'name': 'BARRA DE PINOS 5V', 'familia': 'BARRA DE PINOS', 'designator': 'J',
             'parts': [{'part': 1, 'pins': [{'num': str(n)} for n in range(1, 6)]}],
             'valores': [{'id': 1, 'altium': SYM_ACENTO, 'label': SYM_ACENTO, 'estoque': 95.0,
                          'footprint': 'M7', 'itens': [{'odoo': '1038', 'nome': 'Barra de pinos'}]}]}],
    }, ensure_ascii=False) + ';\n')

    # o arquivo de segredo do workspace: existe, é texto, é .json — e não se lê
    escreve(os.path.join(tmp, 'hub-almox.json'),
            '{"url":"http://192.168.15.192:8070","db":"odoo_db","login":"x","senha":"NAO_VAZE"}')

    # O SEGUNDO segredo desta casa, o que a lista de nomes NÃO pegava: a credencial do envio
    # da lista ao Odoo. O ponto na frente do nome não é enfeite — é o que faz o hubserver
    # recusar servi-lo por HTTP (_serve, hubserver.py:120) e é por isso que ele se chama
    # assim (.gitignore:50-56). A ferramenta de leitura devolveu a senha daqui, medido.
    escreve(os.path.join(tmp, '.hub-odoo.json'),
            '{"url":"http://192.168.15.192:8070","db":"odoo_db","login":"envio",'
            '"senha":"SENHA_DO_ENVIO_NAO_VAZE"}')
    escreve(os.path.join(tmp, '.chat', 'c1.json'),
            '{"titulo":"conversa do usuario","mensagens":[]}')
    escreve(os.path.join(tmp, 'Libs', '.rascunho.js'), 'var rascunho = 1;')

    # ── o projeto ABERTO: 1 folha + 250 comps + fios e um nomeador ───────────
    linhas = ['var schematic = {', '"format":"schmirror-v2",', '"project":"%s",' % ABERTO,
              '"generated":"fixture",', '"units":"mil",', '"items":[',
              jl({'t': 'sheet', 'name': 'main', 'size': 'A4'}) + ',']
    for n in range(1, 251):
        linhas.append(jl({'t': 'comp', 'sheet': 'main', 'ref': 'R%d' % n, 'sym': 'RES',
                          'part': 1, 'x': 1000 + 100 * n, 'y': 3400, 'rot': 0,
                          'footprint': 'R0805', 'comment': '1K'}) + ',')
    linhas.append(jl({'t': 'comp', 'sheet': 'main', 'ref': 'J1', 'sym': SYM_ACENTO, 'part': 1,
                      'x': 2400, 'y': 5700, 'rot': 0, 'footprint': 'M7',
                      'comment': SYM_ACENTO, 'params': 'OdooId=1038;ValorId=1'}) + ',')
    linhas.append(jl({'t': 'comp', 'sheet': 'main', 'ref': 'D1', 'sym': 'LED', 'part': 1,
                      'x': 3400, 'y': 5700, 'rot': 90, 'footprint': 'R0805'}) + ',')
    linhas.append(jl({'t': 'wire', 'sheet': 'main', 'pts': [[1100, 3400], [1500, 3400]]}) + ',')
    linhas.append(jl({'t': 'netlabel', 'sheet': 'main', 'net': 'VCC', 'x': 1500, 'y': 3400}) + ',')
    linhas += [']};', '']
    escreve(os.path.join(P_ABERTO, 'schematic.js'), '\n'.join(linhas))
    TOTAL_ITENS = 255

    escreve(os.path.join(P_ABERTO, 'board.js'), 'var pcbmirror = ' + json.dumps({
        'format': 'pcbmirror-v1', 'units': 'mm', 'axis': 'y-up', 'source': 'ABERTO.PcbDoc',
        'board': {'bbox': {'x1': 0, 'y1': 0, 'x2': 30, 'y2': 20},
                  'outline': [{'kind': 'line', 'x1': 0, 'y1': 0, 'x2': 30, 'y2': 0}]},
        'nets': ['', 'GND', 'VCC'],
        'components': [{'id': 'c1', 'ref': 'R1', 'footprint': 'R0805', 'layer': 'Top',
                        'x': 10, 'y': 14, 'rot': 0,
                        'pads': [{'id': 'c1p1', 'name': '1', 'x': 9.05, 'y': 14, 'net': 'VCC'},
                                 {'id': 'c1p2', 'name': '2', 'x': 10.95, 'y': 14, 'net': 'GND'}]}],
        'tracks': [{'id': 't%d' % n, 'layer': 'Top', 'x1': n, 'y1': 2, 'x2': n + 1, 'y2': 2,
                    'w': 0.3, 'net': 'GND'} for n in range(1, 31)],
        'vias': [], 'arcs': [], 'texts': [], 'silk': [], 'regions': [], 'cutouts': [],
        'freepads': [], 'stats': {'components': 1, 'tracks': 30, 'vias': 0}}) + ';\n')

    escreve(os.path.join(P_ABERTO, 'annotations.js'),
            '// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.\n'
            'var annotations = [\n'
            + jl({'id': 'n1', 'view': 'pcb', 'x': 9.0, 'y': 6.0, 'layer': 'Top',
                  'severity': 'err', 'msg': 'trilha muito proxima do pad', 'ref': '',
                  'status': 'open', 'created': '2026-09-16 09:00', 'reply': ''}) + ',\n'
            + jl({'id': 'n2', 'view': 'sch', 'sheet': 'main', 'x': 2400, 'y': 3400,
                  'severity': 'info', 'msg': 'conferir pull-up', 'ref': 'R3',
                  'status': 'resolved', 'created': '2026-09-16 09:01',
                  'reply': 'trocado para 10k'}) + ',\n'
            '];\n')

    # ── o projeto do lado: existe, e nunca é alcançado ───────────────────────
    escreve(os.path.join(P_FECHADO, 'schematic.js'),
            'var schematic = {\n"format":"schmirror-v2",\n"project":"%s",\n"units":"mil",\n'
            '"items":[\n%s,\n]};\n'
            % (FECHADO, jl({'t': 'sheet', 'name': 'main', 'size': 'A4'})))

    # ══════════════════════════════════════════════════════════════════════════
    # 1. a interface que os outros agentes estão escrevendo contra
    # ══════════════════════════════════════════════════════════════════════════
    nomes = [f['name'] for f in O.FERRAMENTAS]
    assert len(nomes) == len(set(nomes)), 'ferramenta repetida: %s' % nomes
    assert set(nomes) == set(O._EXECUTORES), \
        'FERRAMENTAS e _EXECUTORES divergem: %s' % (set(nomes) ^ set(O._EXECUTORES))
    for f in O.FERRAMENTAS:
        assert f['description'].strip(), f['name']
        esq = f['input_schema']
        assert esq['type'] == 'object' and isinstance(esq['properties'], dict), f['name']
        for k in esq['required']:
            assert k in esq['properties'], '%s: required "%s" não está em properties' % (f['name'], k)
        json.dumps(f)                       # tem de atravessar a API como JSON
    assert set(O.ESCRITAS) <= set(nomes)
    assert O.executa('nao_existe', {}, CTX)['erro'].startswith('ferramenta desconhecida')
    assert 'erro' in O.executa('ver_projeto', {}, {'raiz': tmp}), 'sem projeto tem de recusar'
    assert 'erro' in O.executa('ver_projeto', {}, {'projeto': ABERTO}), 'sem raiz tem de recusar'
    print('(1) FERRAMENTAS x _EXECUTORES batem e executa() nunca levanta ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 2. leitura: pagina e DIZ quantos ficaram de fora
    # ══════════════════════════════════════════════════════════════════════════
    vp = O.executa('ver_projeto', {}, CTX)
    assert vp['projeto'] == ABERTO and vp['itens'] == TOTAL_ITENS, vp
    assert vp['por_tipo']['comp'] == 252 and vp['por_tipo']['wire'] == 1, vp['por_tipo']
    assert vp['folhas'] == [{'nome': 'main', 'size': 'A4', 'itens': TOTAL_ITENS - 1}], vp['folhas']
    assert vp['arquivos']['changes.js'] is None, 'o projeto não tem changes.js ainda'
    assert vp['sinalizadores'] == {'total': 2, 'abertos': 1}, vp['sinalizadores']
    assert vp['tela']['vista'] == 'sch', 'o que o usuário está olhando tem de chegar'

    pag = O.executa('ler_esquema', {}, CTX)
    assert pag['total'] == TOTAL_ITENS and pag['mostrados'] == O.PAGINA, pag['mostrados']
    assert pag['restam'] == TOTAL_ITENS - O.PAGINA, pag['restam']
    assert 'ficaram de fora' in pag['nota'] and 'inicio=%d' % O.PAGINA in pag['nota'], pag['nota']
    assert pag['itens'][0]['indice'] == 0 and pag['itens'][1]['indice'] == 1
    resto = O.executa('ler_esquema', {'inicio': O.PAGINA}, CTX)
    assert resto['restam'] == 0 and 'nota' not in resto, resto
    assert resto['itens'][-1]['t'] == 'netlabel', resto['itens'][-1]

    so_j = O.executa('ler_esquema', {'ref': 'J1'}, CTX)
    assert so_j['total'] == 1 and so_j['itens'][0]['sym'] == SYM_ACENTO, so_j
    assert O.executa('ler_esquema', {'tipo': 'wire'}, CTX)['total'] == 1
    assert 'erro' in O.executa('ler_esquema', {'inicio': -1}, CTX)
    assert O.executa('ler_esquema', {'quantos': 99999}, CTX)['mostrados'] <= O.PAGINA_MAX

    pl = O.executa('ler_placa', {'o_que': 'resumo'}, CTX)
    assert pl['stats']['tracks'] == 30 and 'NUNCA edite o board.js' in pl['lembrete'], pl
    tr = O.executa('ler_placa', {'o_que': 'trilhas', 'quantos': 10}, CTX)
    assert tr['total'] == 30 and tr['mostrados'] == 10 and tr['restam'] == 20, tr
    assert 'ficaram de fora' in tr['nota']
    comps = O.executa('ler_placa', {'o_que': 'componentes'}, CTX)
    assert 'pads' not in comps['itens'][0], 'os pads só saem quando se pergunta por um comp'
    um = O.executa('ler_placa', {'o_que': 'componentes', 'filtro': 'R1'}, CTX)
    assert len(um['itens'][0]['pads']) == 2, um
    assert 'erro' in O.executa('ler_placa', {'o_que': 'inventado'}, CTX)

    sinais = O.executa('ler_sinalizadores', {'abertos': True}, CTX)
    assert sinais['total'] == 1 and sinais['itens'][0]['id'] == 'n1', sinais
    assert sinais['abertos'] == 1
    print('(2) leitura pagina, filtra e diz quantos ficaram de fora ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 3. a cerca: fora do workspace, segredo e projeto do lado
    # ══════════════════════════════════════════════════════════════════════════
    for ruim in ('..\\..\\Windows\\win.ini', '../../Windows/win.ini',
                 'Projects/../../segredo.txt', 'Libs/../../fora.js'):
        r = O.executa('ler_arquivo', {'caminho': ruim}, CTX)
        assert 'erro' in r and '..' in r['erro'], (ruim, r)
    for absoluto in ('C:\\Windows\\win.ini', '/etc/passwd', 'D:/qualquer/coisa.js',
                     '//LUCAS-PC/D/x.js'):
        r = O.executa('ler_arquivo', {'caminho': absoluto}, CTX)
        assert 'erro' in r and 'RELATIVO' in r['erro'], (absoluto, r)
    # e o realpath é a última cerca: um symlink apontando para fora não abre buraco
    r = O.executa('ler_arquivo', {'caminho': 'hub-almox.json'}, CTX)
    assert 'erro' in r and 'segredo' in r['erro'], r
    assert 'NAO_VAZE' not in json.dumps(r, ensure_ascii=False), 'a senha vazou na resposta'
    r = O.executa('ler_arquivo', {'caminho': 'Libs/lib.SchLib'}, CTX)
    assert 'erro' in r and 'extens' in r['erro'], r

    # o projeto do lado: recusado na leitura de arquivo…
    r = O.executa('ler_arquivo', {'caminho': 'Projects/%s/schematic.js' % FECHADO}, CTX)
    assert 'erro' in r and ABERTO in r['erro'], r
    assert 'linhas' not in r, 'a recusa veio acompanhada do conteúdo do projeto do lado'
    # …e o aberto passa, pelo mesmo caminho
    ok = O.executa('ler_arquivo', {'caminho': 'Projects/%s/schematic.js' % ABERTO,
                                   'quantos': 8}, CTX)
    assert ok['mostrados'] == 8 and ok['restam'] > 0 and 'schmirror-v2' in ok['linhas'], ok
    assert O.executa('ler_arquivo', {'caminho': 'Libs/schlib.js'}, CTX)['bytes'] > 0
    # ctx apontando para um projeto que não existe não vira leitura de nada
    assert 'erro' in O.executa('ver_projeto', {}, dict(CTX, projeto='NAO EXISTE'))
    assert 'erro' in O.executa('ver_projeto', {}, dict(CTX, projeto='../%s' % FECHADO))
    print('(3) fora do workspace, segredo e projeto do lado: todos recusados ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 3b. ARQUIVO OCULTO NÃO SE LÊ — é atrás do ponto que esta casa guarda segredo
    # ══════════════════════════════════════════════════════════════════════════
    # `ler_arquivo` devolveu a senha do Odoo do envio da lista: a lista SEGREDOS blinda
    # "hub-almox.json" e o arquivo de verdade se chama ".hub-odoo.json". Lista de nomes
    # protege o que alguém lembrou de escrever nela. A regra que fecha isso é a mesma do
    # hubserver (_serve, hubserver.py:120): segmento que começa com ponto não passa — e de
    # graça ela fecha também o .env, o .git/config, o depósito .chat/ das conversas e o
    # .hub-odoo.json.tmp que sobra de uma gravação que falhou.
    for oculto in ('.hub-odoo.json', './.hub-odoo.json', '.\\.hub-odoo.json',
                   'Libs/.rascunho.js', '.chat/c1.json', '.git/config'):
        r = O.executa('ler_arquivo', {'caminho': oculto}, CTX)
        assert 'erro' in r and 'ponto' in r['erro'], (oculto, r)
        assert 'linhas' not in r, ('a recusa veio com o conteúdo junto', oculto, r)
        assert 'SENHA_DO_ENVIO_NAO_VAZE' not in json.dumps(r, ensure_ascii=False), \
            'a senha do Odoo VAZOU pela ferramenta de leitura: %s' % oculto
    print('(3b) arquivo e pasta começando com ponto: recusados, e a senha do Odoo não sai ok')

    # E a cerca de caminho absoluto é do CÓDIGO, não da versão do Python: o ntpath do 3.13
    # deixou de chamar "/etc/passwd" de absoluto (é enraizado, e não absoluto: falta o
    # drive). Quem dependia só do os.path.isabs passou a DEIXAR ENTRAR o que a cerca existe
    # para recusar — e num Windows 3.11 o teste continuaria verde. Aqui o isabs é trocado
    # pelo do 3.13 de propósito, para a pergunta ser sobre o código.
    isabs_real = O.os.path.isabs

    def isabs_do_313(p):
        """o ntpath do 3.13: enraizado (\\ ou /) não é absoluto sem a letra do drive"""
        p = str(p).replace('/', '\\')
        return p[1:2] == ':' and p[2:3] == '\\'

    O.os.path.isabs = isabs_do_313
    try:
        for absoluto in ('/etc/passwd', '\\\\LUCAS-PC\\D\\x.js', '/Libs/schlib.js'):
            r = O.executa('ler_arquivo', {'caminho': absoluto}, CTX)
            assert 'erro' in r and 'RELATIVO' in r['erro'], (absoluto, r)
    finally:
        O.os.path.isabs = isabs_real
    print('(3c) caminho começando com barra é recusado pelo código, não pelo os.path.isabs ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 4. ESCRITA NÃO ESCREVE
    # ══════════════════════════════════════════════════════════════════════════
    antes = foto(tmp)

    p_sch = O.executa('editar_esquema', {'ops': [
        {'acao': 'adicionar', 'item': {'t': 'comp', 'sheet': 'main', 'ref': 'R900',
                                       'sym': 'RES', 'part': 1, 'x': 2000, 'y': 4000,
                                       'rot': 0, 'footprint': 'R0805', 'comment': '10K'}},
        {'acao': 'mover', 'ref': 'R1', 'x': 1500, 'y': 3600},
        {'acao': 'trocar', 'ref': 'J1', 'campos': {'comment': 'conector de alimenta\u00e7\u00e3o'}},
        {'acao': 'remover', 'ref': 'R2'},
    ]}, CTX)
    assert p_sch['aplicado'] is False and p_sch['proposta']['arquivo'] == \
        'Projects/%s/schematic.js' % ABERTO, p_sch.get('erro') or p_sch
    assert p_sch['resumo'] == 'schematic.js: +1 item(ns), ~2 item(ns), -1 item(ns)', p_sch['resumo']
    assert p_sch['diff'].count('\n- ') + p_sch['diff'].count('\n+ ') == 6, p_sch['diff']
    assert 'R900' in p_sch['diff'] and 'NADA foi gravado' in p_sch['nota']

    p_chg = O.executa('editar_changes', {'ops': [
        {'acao': 'adicionar', 'item': {'op': 'comp_move', 'ref': 'R1', 'x': 12.7, 'y': 8.4,
                                       'rot': 90, 'layer': 'Top', 'orig_x': 10.0,
                                       'orig_y': 14.0, 'orig_rot': 0, 'orig_layer': 'Top',
                                       'note': 'n1: afastar do pad'}}]}, CTX)
    assert p_chg['proposta']['carimbo'] is None, 'changes.js ainda não existe'

    p_ann = O.executa('responder_sinalizador',
                      {'id': 'n1', 'reply': 'trilha afastada 0.4mm no changes.js'}, CTX)
    assert p_ann['proposta']['arquivo'].endswith('annotations.js'), p_ann

    # trocar um campo pelo valor que ele já tinha não é mudança: sem edição, sem diff — e o
    # usuário não é chamado para aprovar um arquivo que sairia idêntico
    igual = O.executa('editar_esquema', {'ops': [
        {'acao': 'trocar', 'ref': 'R5', 'campos': {'comment': '1K'}}]}, CTX)
    assert igual['proposta'] is None and igual['resumo'] == 'nada a mudar', igual
    # e null APAGA o campo (é como se tira um opcional que não devia estar lá)
    sem = O.executa('editar_esquema', {'ops': [
        {'acao': 'trocar', 'ref': 'R6', 'campos': {'comment': None}}]}, CTX)
    entra = [x for x in sem['diff'].split('\n') if x.startswith('+ ')][0]
    assert '"comment"' not in entra and '"ref":"R6"' in entra, entra

    confere_foto(antes, foto(tmp), 'uma ferramenta de escrita')
    assert not os.path.exists(os.path.join(P_ABERTO, 'changes.js')), \
        'propor um changes.js criou o arquivo'
    print('(4) as três ferramentas de escrita devolvem proposta e NÃO tocam o disco ok')

    # as recusas de formato, também sem tocar em nada
    ruins = [
        ({'ops': [{'acao': 'adicionar', 'item': {'t': 'comp', 'sheet': 'main', 'ref': 'R901',
                                                 'sym': 'RES', 'x': 100, 'y': 100, 'rot': 0}}]},
         'footprint'),
        ({'ops': [{'acao': 'adicionar', 'item': {'t': 'comp', 'sheet': 'main', 'ref': 'R902',
                                                 'sym': 'RES', 'x': 100, 'y': 100, 'rot': 45,
                                                 'footprint': 'R0805'}}]}, 'rot'),
        ({'ops': [{'acao': 'adicionar', 'item': {'t': 'comp', 'sheet': 'main', 'ref': 'R903',
                                                 'sym': 'RES', 'x': 100, 'y': 100, 'rot': 0,
                                                 'footprint': 'R0805', 'refdx': 20}}]}, 'par'),
        ({'ops': [{'acao': 'adicionar', 'item': {'t': 'wire', 'sheet': 'main',
                                                 'pts': [[0, 0]]}}]}, 'pts'),
        ({'ops': [{'acao': 'adicionar', 'item': {'t': 'inventado', 'sheet': 'main'}}]},
         'desconhecido'),
        ({'ops': [{'acao': 'adicionar', 'item': {'t': 'text', 'sheet': 'main', 'x': 0, 'y': 0,
                                                 's': 'quebra o parser": aqui'}}]}, 'aspas'),
        ({'ops': [{'acao': 'adicionar', 'item': {'t': 'comp', 'sheet': 'main', 'ref': 'R904',
                                                 'sym': 'RES', 'x': 0, 'y': 0, 'rot': 0,
                                                 'footprint': 'R0805',
                                                 'params': {'ValorId': 7}}}]}, 'aninhado'),
        ({'ops': [{'acao': 'mover', 'ref': 'NAO_EXISTE', 'x': 1}]}, 'não achei'),
        ({'ops': [{'acao': 'voar', 'ref': 'R1'}]}, 'desconhecida'),
        ({'ops': []}, 'lista'),
    ]
    for pedido, esperado in ruins:
        r = O.executa('editar_esquema', pedido, CTX)
        assert 'erro' in r and esperado in r['erro'], (pedido, r)
    r = O.executa('editar_changes', {'ops': [{'acao': 'adicionar', 'item': {
        'op': 'track_add', 'layer': 'Top', 'x1': 1, 'y1': 2, 'x2': 3}}]}, CTX)
    assert 'erro' in r and 'y2' in r['erro'], r
    r = O.executa('responder_sinalizador', {'id': 'n9', 'reply': 'x'}, CTX)
    assert 'erro' in r and 'não existe sinalizador' in r['erro'], r
    assert 'erro' in O.executa('responder_sinalizador', {'id': 'n1', 'reply': '  '}, CTX)
    confere_foto(antes, foto(tmp), 'uma escrita recusada')
    print('(4b) pedido mal formado é recusado com o motivo, e também não escreve ok')

    # FOOTPRINT VAZIO: e o que o hub grava para o componente do almoxarifado sem footprint
    # conhecido, e o Salvar da vista aceita (hub-core » SCH_ITEM_REQUIRED). O chat tem de poder
    # mover/girar esse componente — antes ele recusava dizendo que o BuildSchematic recusaria o
    # projeto, o que e falso (vai sem vinculo, [AVISO]). Escrever vazio ele mesmo, nao.
    assert 'footprint' not in O.SCH_OBRIG['comp'][1], 'espelho do hub-core: a chave vai a parte'
    bt = {'t': 'comp', 'sheet': 'main', 'ref': 'BT1', 'sym': 'RES', 'x': 0, 'y': 0, 'rot': 0,
          'footprint': ''}
    O._valida_item_sch(dict(bt), 'mover BT1')                       # ja estava assim: passa
    for caso, item, escreve_fp in (('comp novo com footprint vazio', dict(bt), True),
                                   ('sem a chave', {k: v for k, v in bt.items() if k != 'footprint'}, False)):
        try:
            O._valida_item_sch(item, caso, escreve_fp)
        except O._Recusa as e:
            assert 'footprint' in str(e) and 'recusa o projeto' not in str(e), (caso, str(e))
        else:
            raise AssertionError('passou: ' + caso)
    print('(4c) footprint vazio: move e troca o que ja estava assim; o chat nao escreve vazio ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 5. aplica() escreve — e só ela
    # ══════════════════════════════════════════════════════════════════════════
    sch_antes = le(os.path.join(P_ABERTO, 'schematic.js'))
    r = O.aplica(tmp, p_sch['proposta'])
    assert r['ok'], r
    depois = le(os.path.join(P_ABERTO, 'schematic.js'))
    itens = O._le_var_js(os.path.join(P_ABERTO, 'schematic.js'))['items']
    refs = [i.get('ref') for i in itens if i.get('t') == 'comp']
    assert 'R900' in refs and 'R2' not in refs and refs.count('R1') == 1, refs[:6]
    r1 = next(i for i in itens if i.get('ref') == 'R1')
    assert (r1['x'], r1['y']) == (1500, 3600), r1
    j1 = next(i for i in itens if i.get('ref') == 'J1')
    assert j1['comment'] == 'conector de alimenta\u00e7\u00e3o' and j1['sym'] == SYM_ACENTO, j1
    assert len(itens) == TOTAL_ITENS, 'entrou 1 e saiu 1: o total tem de bater'
    # o resto do arquivo não se mexeu: o cabeçalho e as 248 linhas não tocadas saem iguais
    # (comparar linha a linha por posição não serve: a remoção desloca tudo abaixo dela.
    #  O que se prende aqui é o CONJUNTO — só as linhas da proposta entraram e saíram)
    a, b = sch_antes.split('\n'), depois.split('\n')
    assert a[:6] == b[:6], 'o cabeçalho mudou'
    assert len(a) == len(b), 'entrou uma linha e saiu uma: o arquivo tem de manter o tamanho'
    entrou, saiu = [x for x in b if x not in a], [x for x in a if x not in b]
    assert len(entrou) == 3 and len(saiu) == 3, (entrou, saiu)
    assert all('"R900"' in x or '"R1"' in x or '"J1"' in x for x in entrou), entrou
    assert all('"R2"' in x or '"R1"' in x or '"J1"' in x for x in saiu), saiu
    # e a linha gravada está no formato do espelho: plana, \uXXXX de U+007E para cima
    linha_j1 = next(x for x in b if '"ref":"J1"' in x)
    assert '\\u00ba' in linha_j1 and '\\u00e7' in linha_j1, linha_j1
    assert all(ord(c) < 0x7e for c in linha_j1), 'saiu caractere cru onde o .pas espera escape'
    assert linha_j1.endswith(','), 'a vírgula de fim de linha se perdeu'
    assert not os.path.exists(os.path.join(P_ABERTO, 'schematic.js.tmp')), 'deixou o .tmp'

    r = O.aplica(tmp, p_chg['proposta'])
    assert r['ok'], r
    chg = O._le_var_js(os.path.join(P_ABERTO, 'changes.js'))
    assert len(chg) == 1 and chg[0]['op'] == 'comp_move' and chg[0]['orig_x'] == 10.0, chg
    assert le(os.path.join(P_ABERTO, 'changes.js')).startswith('// AltiumPCBMirror'), \
        'o changes.js novo nasce com o cabeçalho que o hub escreve'

    r = O.aplica(tmp, p_ann['proposta'])
    assert r['ok'], r
    anns = O._le_var_js(os.path.join(P_ABERTO, 'annotations.js'))
    assert len(anns) == 2, 'responder sinalizador não pode APAGAR nenhum (contrato Parte C)'
    n1 = next(a for a in anns if a['id'] == 'n1')
    assert n1['status'] == 'resolved' and n1['reply'].startswith('trilha afastada'), n1
    assert n1['msg'] == 'trilha muito proxima do pad' and n1['created'] == '2026-09-16 09:00', \
        'o texto e a data do usuário têm de voltar intactos'
    assert next(a for a in anns if a['id'] == 'n2')['reply'] == 'trocado para 10k', \
        'mexeu no sinalizador que ninguém pediu'
    assert le(os.path.join(P_ABERTO, 'annotations.js')).startswith('// AltiumPCBMirror'), \
        'o comentário de topo do usuário sumiu'
    print('(5) aplica() escreve: o item entra, o outro sai e o resto do arquivo não se move ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 6. dois escritores: aplica() RECUSA depois que o arquivo muda por fora
    # ══════════════════════════════════════════════════════════════════════════
    r = O.aplica(tmp, p_sch['proposta'])
    assert not r['ok'] and r.get('mudou') and 'refaça' in r['erro'], r
    print('(6) a mesma proposta duas vezes: a segunda é recusada ok')

    nova = O.executa('editar_esquema',
                     {'ops': [{'acao': 'mover', 'ref': 'R3', 'x': 9900, 'y': 9900}]}, CTX)
    assert nova['proposta'], nova
    # Agora o usuário salva pelo hub, no meio da conversa. A linha nova entra DEPOIS da que
    # a proposta mexe, de propósito: assim o texto da linha que sai continua batendo, e a
    # única coisa entre a proposta velha e o desenho dele é o carimbo. Se a linha entrasse
    # antes, tudo escorregaria e a conferência de linha acusaria sozinha — e o carimbo
    # passaria o resto da vida sem nunca ter sido testado de verdade.
    cam_sch = os.path.join(P_ABERTO, 'schematic.js')
    texto = le(cam_sch).split('\n')
    fecha = max(n for n, x in enumerate(texto) if x.strip().startswith(']'))
    texto.insert(fecha, O._jline({'t': 'text', 'sheet': 'main', 's': 'desenhado pelo usuario',
                                  'x': 100, 'y': 100}) + ',')
    escreve(cam_sch, '\n'.join(texto))
    guardado = le(cam_sch)

    r = O.aplica(tmp, nova['proposta'])
    assert not r['ok'] and r.get('mudou'), r
    assert 'mudou desde que a proposta nasceu' in r['erro'], r['erro']
    assert le(cam_sch) == guardado, 'a recusa não pode ter escrito nada'
    assert 'desenhado pelo usuario' in guardado, 'o trabalho do usuário sobreviveu'
    # refazer a proposta contra o arquivo NOVO funciona — a saída é refazer, não forçar
    outra = O.executa('editar_esquema',
                      {'ops': [{'acao': 'mover', 'ref': 'R3', 'x': 9900, 'y': 9900}]}, CTX)
    assert O.aplica(tmp, outra['proposta'])['ok']
    r3 = next(i for i in O._le_var_js(cam_sch)['items'] if i.get('ref') == 'R3')
    assert (r3['x'], r3['y']) == (9900, 9900), r3
    assert 'desenhado pelo usuario' in le(cam_sch), 'a linha do usuário tem de continuar lá'
    print('(6b) arquivo mudado por fora: recusa, não sobrescreve — e refazer resolve ok')

    # a cerca também vale para aplica(): proposta apontando para outro projeto não passa
    falsa = dict(outra['proposta'])
    falsa['arquivo'] = 'Projects/%s/schematic.js' % FECHADO
    assert not O.aplica(tmp, falsa)['ok']
    falsa2 = dict(outra['proposta'])
    falsa2['arquivo'] = 'Projects/%s/board.js' % ABERTO
    assert not O.aplica(tmp, falsa2)['ok'], 'board.js NUNCA é escrito'
    falsa3 = dict(outra['proposta'])
    falsa3['arquivo'] = '../fora.js'
    assert not O.aplica(tmp, falsa3)['ok']
    assert not O.aplica(tmp, {})['ok'] and not O.aplica(tmp, None)['ok']
    print('(6c) aplica() recusa proposta para outro projeto, para o board.js e para fora ok')

    # ── 6d. "." e ".." não são nome de pasta: a proposta que escreveu NA RAIZ ──
    # Medido: `{"arquivo":"Projects/../schematic.js","projeto":".."}` passou pelas quatro
    # conferências de `aplica()` e gravou na raiz do workspace, FORA de Projects/. Cada
    # conferência respondia "sim" a uma pergunta certa — são três segmentos, o primeiro é
    # Projects, o terceiro é escrevível, e o segundo bate com o campo "projeto" da própria
    # proposta — e o `_sob` concordava, porque a raiz está dentro da raiz.
    # O carimbo é `None` DE PROPÓSITO: é a proposta de um arquivo que ainda não existe (o
    # changes.js de um projeto que nunca teve um), e é ela que chega no disco. Com carimbo
    # de arquivo existente, a fuga morre no carimbo — pelo motivo errado — e a cerca
    # continuaria sem nunca ter sido conferida.
    for caminho, projeto in (('Projects/../schematic.js', '..'),
                             ('Projects/../changes.js', '..'),
                             ('Projects/./changes.js', '.')):
        fuga = {'arquivo': caminho, 'projeto': projeto, 'carimbo': None,
                'resumo': 'fuga', 'diff': '',
                'edicoes': [{'linha': 0, 'sai': None, 'entra': 'var changes = [];'}]}
        r = O.aplica(tmp, fuga)
        assert not r['ok'], (caminho, r)
        assert 'ponto' in r['erro'] or 'segmento' in r['erro'], (caminho, r)
    for fora_de_projects in ('schematic.js', 'changes.js'):
        assert not os.path.exists(os.path.join(tmp, fora_de_projects)), \
            'aplica() escreveu %s na RAIZ do workspace, fora de Projects/' % fora_de_projects
    # e a mesma regra na ida: ctx com projeto oculto/relativo não alcança nada
    for nome in ('..', '.', '.chat', '.git'):
        assert 'erro' in O.executa('ver_projeto', {}, dict(CTX, projeto=nome)), nome
    print('(6d) "." e ".." em qualquer segmento: recusados no aplica e no executa ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 7. procurar_componente e validar
    # ══════════════════════════════════════════════════════════════════════════
    b = O.executa('procurar_componente', {'texto': '1k'}, CTX)
    achado = next(x for x in b['itens'] if x['sym'] == 'SMD 0603 1K')
    assert (achado['valor_id'], achado['saldo'], achado['odoo_id']) == (7, 42.0, '777'), achado
    assert achado['footprint'] == 'R0805' and achado['local'] == 'G-1-1', achado
    assert 'Libs/almox-basicos.js' in b['acervos_lidos'], b['acervos_lidos']
    acento = O.executa('procurar_componente', {'texto': '2.54mm'}, CTX)
    assert acento['itens'][0]['sym'] == SYM_ACENTO, acento['itens'][0]
    casa = O.executa('procurar_componente', {'texto': 'resistor da casa'}, CTX)
    assert any(x['acervo'] == 'biblioteca da casa' for x in casa['itens']), casa
    assert 'erro' in O.executa('procurar_componente', {'texto': '  '}, CTX)

    v = O.executa('validar', {}, CTX)
    assert v['erros'] == [], v['erros']
    # o D1 é um LED num footprint de resistor: pinos A/K contra pads 1/2
    assert sum(1 for a in v['avisos'] if 'sem pad' in a) == 2, v['avisos']
    assert any('não foram conferidos' in n or 'ponta quente' in n for n in v['nao_conferido']), \
        v['nao_conferido']
    assert 'hub-core.js' in ' '.join(v['nao_conferido']) + v['fonte'], \
        'o validador tem de dizer onde mora a validação de verdade'

    # um esquema quebrado: os erros que dá para achar sem geometria
    escreve(os.path.join(P_FECHADO, 'quebrado.js'), '')
    ctx2 = dict(CTX, projeto=FECHADO)
    escreve(os.path.join(P_FECHADO, 'schematic.js'),
            'var schematic = {\n"format":"schmirror-v2",\n"project":"%s",\n"units":"mil",\n'
            '"items":[\n%s,\n%s,\n%s,\n%s,\n]};\n' % (
                FECHADO,
                jl({'t': 'sheet', 'name': 'main', 'size': 'A4'}),
                jl({'t': 'comp', 'sheet': 'main', 'ref': 'R1', 'sym': 'NAO_EXISTE', 'part': 1,
                    'x': 100, 'y': 100, 'rot': 0, 'footprint': 'TAMBEM_NAO'}),
                jl({'t': 'comp', 'sheet': 'main', 'ref': 'R1', 'sym': 'RES', 'part': 1,
                    'x': 105, 'y': 100, 'rot': 45, 'footprint': 'R0805'}),
                jl({'t': 'netlabel', 'sheet': 'outra', 'net': 'VCC', 'x': 100, 'y': 100})))
    v2 = O.executa('validar', {}, ctx2)
    junto = ' | '.join(v2['erros'])
    for esperado in ('NAO_EXISTE', 'TAMBEM_NAO', 'duplicado', 'rot deve ser'):
        assert esperado in junto, (esperado, junto)
    assert 'folha "outra" não existe' in junto, junto
    assert sum(1 for a in v2['avisos'] if 'grade de 100 mil' in a) == 1, \
        'o aviso de grade tem de sair UMA vez, com a contagem — 86%% dos avisos eram ele'
    print('(7) procurar_componente acha no almoxarifado e validar acusa o que dá para ver ok')

    # ══════════════════════════════════════════════════════════════════════════
    # 8. a gravação segue o symlink
    # ══════════════════════════════════════════════════════════════════════════
    def pode_symlink():
        try:
            a, b2 = os.path.join(tmp, '_probe'), os.path.join(tmp, '_probe.lnk')
            with open(a, 'wb') as f:
                f.write(b'x')
            os.symlink(a, b2)
            os.remove(b2)
            os.remove(a)
            return True
        except (OSError, NotImplementedError, AttributeError):
            return False

    if not pode_symlink():
        # Windows sem privilégio não cria symlink, mas a pergunta ainda tem resposta: o
        # destino do os.replace é o que o realpath devolveu, ou o caminho cru? Troca-se o
        # realpath por um que finge o link do servidor e vê-se onde o byte cai. É prova
        # menor que a de verdade (não exercita o SO), e por isso vem acompanhada da
        # varredura do tests/test_symlink_sobrevive.py, que pega os outros escritores.
        shared = os.path.join(tmp, 'shared')
        os.makedirs(shared, exist_ok=True)
        cam_ann = os.path.join(P_ABERTO, 'annotations.js')
        fingido = os.path.join(shared, 'annotations.js')
        antes_do_link = le(cam_ann)
        prop = O.executa('responder_sinalizador',
                         {'id': 'n2', 'reply': 'conferido na bancada'}, CTX)
        real_realpath = os.path.realpath

        def realpath_do_link(p, *a, **kw):
            if os.path.normcase(os.path.abspath(p)) == os.path.normcase(cam_ann):
                return fingido                     # como se Projects/…/annotations.js -> shared/
            return real_realpath(p, *a, **kw)

        os.path.realpath = realpath_do_link
        try:
            assert O.aplica(tmp, prop['proposta'])['ok'], prop
        finally:
            os.path.realpath = real_realpath
        assert le(cam_ann) == antes_do_link, \
            'gravou no caminho cru — no servidor isso substituiria O LINK por um arquivo real'
        assert 'conferido na bancada' in le(fingido), 'não gravou no alvo do link'
        assert not os.path.exists(cam_ann + '.tmp'), 'deixou o .tmp para trás'
        os.remove(fingido)
        print('(8) o destino do os.replace é o realpath do alvo — o link sobrevive ok')
        print('      (o symlink de verdade não cabe nesta bancada; a varredura de')
        print('       tests/test_symlink_sobrevive.py cobre o resto do repositório)')
    else:
        shared = os.path.join(tmp, 'shared')
        os.makedirs(shared, exist_ok=True)
        alvo_real = os.path.join(shared, 'annotations.js')
        cam_ann = os.path.join(P_ABERTO, 'annotations.js')
        shutil.move(cam_ann, alvo_real)
        os.symlink(alvo_real, cam_ann)           # como o deploy monta a release
        prop = O.executa('responder_sinalizador',
                         {'id': 'n2', 'reply': 'conferido na bancada'}, CTX)
        assert O.aplica(tmp, prop['proposta'])['ok'], prop
        assert os.path.islink(cam_ann), \
            'o symlink virou arquivo real — o próximo deploy devolveria os sinalizadores velhos'
        assert 'conferido na bancada' in le(alvo_real), 'escreveu, mas não no arquivo do link'
        assert not os.path.exists(cam_ann + '.tmp'), 'deixou o .tmp para trás'
        print('(8) a proposta aplicada é gravada ATRAVÉS do symlink ok')

    print('test_chat_operador OK (o chat só alcança o projeto aberto, e propor não é gravar)')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

confere_foto(libs_antes, foto(os.path.join(RAIZ, 'Libs')), 'a suite (na Libs/ de verdade)')
confere_foto(projs_antes, foto(os.path.join(RAIZ, 'Projects')), 'a suite (em Projects/)')
