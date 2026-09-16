# -*- coding: utf-8 -*-
"""Excluir um VALOR do almoxarifado — e ele nao volta na proxima sincronizacao.

    python tests/test_almox_excluir.py

O usuario clica com o botao direito num valor (modal "Trocar componente", aba Biblioteca) e
manda excluir. Entre os tres desenhos possiveis, o escolhido foi a LISTA DE EXCLUIDOS
versionada (Libs/almox-excluidos.json), que o gerador pula em TODA rodada — inclusive na que
so regera do snapshot, que e a que mais roda.

O que este teste prende, nesta ordem:
  1. a PREVIA (sem `confirmar`) nao encosta em arquivo nenhum e ja diz onde o valor esta em
     uso — item em uso AVISA, nunca recusa calado;
  2. excluir poe na lista, tira do espelho, tira a protecao do ledger e NAO toca na .SchLib
     (ela e reescrita inteira no proximo sincronismo, e a resposta tem de dizer isso);
  3. o gerador pula o excluido numa rodada seguinte, de dois jeitos: no laco dos valores e
     na porta dos fundos do `numera_valores` (o "saiu do Odoo", que repescaria o valor do
     espelho anterior se a gravacao do espelho tivesse falhado no meio da exclusao);
  4. desfazer devolve o item, e o id dele continua reservado no livro-razao;
  5. o HOMONIMO: o nome que vai para a lista e o de DEPOIS do desempate ('PTH DIP8
     OP07CP #27'), e o gerador comparava o de antes — a exclusao parecia funcionar e o
     sincronismo seguinte devolvia o valor, calado. E excluir um homonimo nao pode
     RENOMEAR o outro: o `sym` de todo esquema ja desenhado aponta para esse texto;
  6. a gravacao SEGUE O SYMLINK — no servidor este arquivo e
     `Libs/almox-excluidos.json -> shared/…`, e `os.replace` sobre o link substituiria O
     LINK (a licao de 2026-09-16; ver tests/test_symlink_sobrevive.py). Essa parte pula com
     mensagem clara onde o SO recusa criar symlink: a bancada e Windows.

Roda sem rede, sem Odoo e sem Altium: linhas sinteticas no formato do componentes_odoo.csv,
tudo num workspace temporario.
"""
import copy
import io
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import hubserver as H            # noqa: E402  (o blueprint tem que vir registrado daqui)
import symserver as S            # noqa: E402
import guardiao as G             # noqa: E402
import almox2lib as A            # noqa: E402
import familias as F             # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ESPELHO = os.path.join('Libs', 'almox-basicos.js')
LISTA = os.path.join('Libs', A.EXCLUIDOS)
SIMBOLO = 'RESISTOR [SMD]'          # o NOME do simbolo: e o que o hub manda como "familia"
FAMILIA = 'RESISTOR'                # a familia do ARQUIVO: a chave do ledger e da .SchLib
ALVO = 'SMD 0603 1K'                # o valor que sai
IRMAOS = ('SMD 0603 0R', 'SMD 0603 10K')

# um desenho qualquer, so para haver protecao no ledger para tirar
DESENHO = [{'part': 1, 'pins': [], 'graphics': [{'g': 'rect', 'x1': -1, 'y1': -1,
                                                 'x2': 1, 'y2': 1, 'solid': False}]}]


def linha(nome, categoria, pid):
    return {'product_id': pid, 'template_id': pid, 'localizacao_codigo': 'G-1-1', 'nome': nome,
            'categoria': categoria, 'unidade': 'Unidades', 'qtd_almoxarifado': '10.0',
            'qtd_total_interna': '10.0', 'locais_estoque': 'DI/Almoxarifado', 'barcode': '',
            'custo': '1.0', 'preco_venda': '', 'fornecedor_partnumber': '', 'menor_preco_compra': '',
            'estocavel': 'true', 'tipo': 'consu', 'write_date': '2026-09-08 00:00:00'}


LINHAS = [linha('Resistor Metal Filme 0R SMD 0603', 'Resistores - 0603', '6'),
          linha('Resistor Metal Filme 1K SMD 0603', 'Resistores - 0603', '7'),
          linha('Resistor Metal Filme 10K SMD 0603', 'Resistores - 0603', '8')]


def simbolo_de(linhas):
    """o dict que o `agrupar` monta para o RESISTOR [SMD] a partir de linhas do dump"""
    analisados = [a for a in (F.analisar(r) for r in linhas) if a]
    assert len(analisados) == len(linhas), 'linha sintetica nao classificada'
    return copy.deepcopy(next(s for s in A.agrupar(analisados).values() if s['nome'] == SIMBOLO))


def foto(raiz):
    """(tamanho, mtime_ns) de tudo que existe — pega ate a regravacao de conteudo igual"""
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


# ─── a suite nao pode escrever na Libs/ de verdade ───────────────────────────
libs_antes = foto(os.path.join(RAIZ, 'Libs'))

# ─── workspace temporario ────────────────────────────────────────────────────
tmp = tempfile.mkdtemp(prefix='almox-excluir-')
for d in ('Libs', os.path.join('Libs', 'Almox'), os.path.join('tools', 'symbols'),
          os.path.join('Projects', 'DMB - TESTE'), os.path.join('Projects', 'PRJ - TESTE'),
          os.path.join('Projects', 'SEM - ESQUEMA')):
    os.makedirs(os.path.join(tmp, d))

mapa = {}
sim0 = A.monta_simbolo(simbolo_de(LINHAS), set(), mapa, {}, False, None)
assert [v['altium'] for v in sim0['valores']] == [IRMAOS[0], ALVO, IRMAOS[1]], \
    [v['altium'] for v in sim0['valores']]
ID_ALVO = next(v['id'] for v in sim0['valores'] if v['altium'] == ALVO)
IDS_ANTES = {v['altium']: v['id'] for v in sim0['valores']}
A.escreve_espelho(os.path.join(tmp, ESPELHO), 'almoxBasicos', 'Almoxarifado — Básicos',
                  [copy.deepcopy(sim0)], '01/01/2026 00:00:00')

# a .SchLib da familia: um arquivo qualquer, so para provar que a exclusao NAO o toca
schlib = os.path.join(tmp, 'Libs', 'Almox', '%s ALMOX.SchLib' % FAMILIA)
with open(schlib, 'wb') as f:
    f.write(b'\xd0\xcf\x11\xe0 nao me toque')

# o ledger com a protecao do valor alvo (o desenho que o /save-almox deixaria)
led = G.ledger_vazio()
G._poe_prot(led, FAMILIA, ALVO, DESENHO, 'hub', SIMBOLO)
G._poe_prot(led, FAMILIA, IRMAOS[0], DESENHO, 'hub', SIMBOLO)
G.grava_ledger(tmp, led)

# ── dois projetos que usam o valor, pelos dois caminhos ──────────────────────
# DMB: o hub gravou `params` com ValorId (schframe.js » paramsDoValor) — e o R3 e
# multi-parte, dois itens comp com o mesmo designador, que nao pode contar duas vezes.
with io.open(os.path.join(tmp, 'Projects', 'DMB - TESTE', 'schematic.js'), 'w',
             encoding='utf-8', newline='\n') as f:
    f.write('var schematic = {\n"format":"schmirror-v2",\n"project":"DMB - TESTE",\n'
            '"units":"mil",\n"items":[\n'
            '{"t":"sheet","name":"main","size":"A4"},\n'
            '{"t":"comp","sheet":"main","ref":"R3","sym":"%s","part":1,"x":100,"y":100,"rot":0,'
            '"footprint":"RES 0603","comment":"1K","params":"Comment=1K;ValorId=%d"},\n'
            '{"t":"comp","sheet":"main","ref":"R3","sym":"%s","part":2,"x":100,"y":200,"rot":0,'
            '"footprint":"RES 0603","comment":"1K","params":"Comment=1K;ValorId=%d"},\n'
            '{"t":"comp","sheet":"main","ref":"R5","sym":"%s","part":1,"x":300,"y":100,"rot":0,'
            '"footprint":"RES 0603","comment":"outro texto","params":"Comment=1K;ValorId=%d"},\n'
            '{"t":"comp","sheet":"main","ref":"R9","sym":"%s","part":1,"x":500,"y":100,"rot":0,'
            '"footprint":"RES 0603","comment":"10K","params":"Comment=10K;ValorId=%d"},\n'
            # J1 e J2 sao a armadilha: o `ValorId` e numerado POR SIMBOLO, entao a barra
            # de pinos tem um valor com o mesmo id do resistor. Foi medido na bancada: a
            # previa acusava o J1 do _DemoKit (OdooId=1038, uma barra de pinos) como uso
            # de uma BATERIA. Quem manda e o OdooId, o id da variante no catalogo
            # inteiro; o ValorId so vale corroborado pelo `sym` ou pelo `comment`.
            '{"t":"comp","sheet":"main","ref":"J1","sym":"5 vias 180 2.54mm Macho","part":1,'
            '"x":700,"y":100,"rot":0,"footprint":"M7","comment":"5 vias 180 2.54mm Macho",'
            '"params":"Comment=5 vias;OdooId=1038;ValorId=%d"},\n'
            '{"t":"comp","sheet":"main","ref":"J2","sym":"5 vias 180 2.54mm Macho","part":1,'
            '"x":900,"y":100,"rot":0,"footprint":"M7","comment":"5 vias 180 2.54mm Macho",'
            '"params":"Comment=5 vias;ValorId=%d"}\n'
            ']};\n' % (ALVO, ID_ALVO, ALVO, ID_ALVO, ALVO, ID_ALVO, IRMAOS[1],
                       IDS_ANTES[IRMAOS[1]], ID_ALVO, ID_ALVO))
# PRJ: esquema antigo, anterior ao `params` — so o sym e o comment
with io.open(os.path.join(tmp, 'Projects', 'PRJ - TESTE', 'schematic.js'), 'w',
             encoding='utf-8', newline='\n') as f:
    f.write('var schematic = {\n"format":"schmirror-v2",\n"project":"PRJ - TESTE",\n'
            '"units":"mil",\n"items":[\n'
            '{"t":"comp","sheet":"main","ref":"R1","sym":"%s","part":1,"x":100,"y":100,"rot":0,'
            '"footprint":"RES 0603","comment":"1K"},\n'
            '{"t":"comp","sheet":"main","ref":"R2","sym":"%s","part":1,"x":300,"y":100,"rot":0,'
            '"footprint":"RES 0603","comment":"0R"}\n'
            ']};\n' % (ALVO, IRMAOS[0]))

real_root = H.ROOT
H.ROOT = S.ROOT = tmp
cli = H.app.test_client()
try:
    # ── 1. a previa nao muda arquivo nenhum ──────────────────────────────────
    antes = foto(tmp)
    r = cli.post('/api/symbols/almox-excluir', json={'familia': SIMBOLO, 'componente': ALVO})
    j = r.get_json()
    assert r.status_code == 200 and j['ok'] and j['previa'] is True, j
    assert (j['simbolo'], j['familia'], j['componente'], j['label']) == (SIMBOLO, FAMILIA, ALVO, '1K'), j
    assert j['usos'] == [{'projeto': 'DMB - TESTE', 'refs': ['R3', 'R5']},
                         {'projeto': 'PRJ - TESTE', 'refs': ['R1']}], j['usos']
    assert j['total'] == 3, j
    # e o J1/J2 (outra familia, mesmo ValorId) ficam de fora: aviso errado ou assusta quem
    # ia excluir com razao, ou ensina a ignorar o aviso que um dia estara certo
    assert not any('J1' in u['refs'] or 'J2' in u['refs'] for u in j['usos']), j['usos']
    assert 'excluido' not in j and 'avisos' not in j, j
    confere_foto(antes, foto(tmp), 'a previa')
    assert not os.path.exists(os.path.join(tmp, LISTA)), 'a previa criou a lista'
    print('(1) previa: diz onde o valor esta em uso e nao escreve nada ok')

    # recusas, antes de qualquer arquivo
    assert cli.post('/api/symbols/almox-excluir', json={'componente': ALVO}).status_code == 400
    assert cli.post('/api/symbols/almox-excluir', json={'familia': SIMBOLO}).status_code == 400
    assert cli.post('/api/symbols/almox-excluir',
                    json={'familia': SIMBOLO, 'componente': 'NAO EXISTE'}).status_code == 404
    assert cli.post('/api/symbols/almox-excluir',
                    json={'familia': 'NAO EXISTE', 'componente': ALVO}).status_code == 404
    confere_foto(antes, foto(tmp), 'um pedido recusado')
    print('(1b) 400 sem familia/componente e 404 no valor que nao existe ok')

    # ── 2. excluir: lista, espelho, ledger — e a .SchLib intacta ─────────────
    schlib_antes = (open(schlib, 'rb').read(), os.stat(schlib).st_mtime_ns)
    r = cli.post('/api/symbols/almox-excluir',
                 json={'familia': SIMBOLO, 'componente': ALVO, 'confirmar': True})
    j = r.get_json()
    assert r.status_code == 200 and j['ok'] and j['excluido'] and j['espelho'], j
    assert j['usos'] and j['total'] == 3, j
    assert any('próximo sincronismo' in a for a in j['avisos']), j['avisos']
    assert any('DMB - TESTE' in a for a in j['avisos']), 'o uso tem que sair avisado'

    itens = A.carrega_excluidos(tmp)['itens']
    assert len(itens) == 1, itens
    it = itens[0]
    assert (it['simbolo'], it['familia'], it['altium'], it['label']) == (SIMBOLO, FAMILIA, ALVO, '1K'), it
    assert len(it['quando']) == 16, it          # 'YYYY-MM-DD HH:MM'
    # um item por linha, como o dumps_ledger: o git diffa a exclusao, nao o arquivo
    linhas_lista = le(os.path.join(tmp, LISTA)).strip().split('\n')
    assert len(linhas_lista) == 3 and linhas_lista[1].startswith(' {'), linhas_lista

    _var, esp = G.le_espelho_almox(os.path.join(tmp, ESPELHO))
    sim = next(s for s in esp['symbols'] if s['name'] == SIMBOLO)
    assert [v['altium'] for v in sim['valores']] == list(IRMAOS), [v['altium'] for v in sim['valores']]
    assert {v['altium']: v['id'] for v in sim['valores']} == {c: IDS_ANTES[c] for c in IRMAOS}, \
        'o id dos irmaos nao pode se mexer'

    led = G.carrega_ledger(tmp)
    assert ALVO not in led['protegidos'].get(FAMILIA, {}), 'a protecao do excluido tem que sair'
    assert IRMAOS[0] in led['protegidos'][FAMILIA], 'a do irmao tem que ficar'

    assert (open(schlib, 'rb').read(), os.stat(schlib).st_mtime_ns) == schlib_antes, \
        'a exclusao nao pode escrever na .SchLib — ela e reescrita pelo sincronismo'
    print('(2) excluir: entra na lista, sai do espelho e do ledger, .SchLib intacta ok')

    # excluir de novo e inofensivo: a lista nao ganha item repetido (o valor ja saiu do
    # espelho, entao a resolucao devolve 404 — que e a resposta honesta)
    assert cli.post('/api/symbols/almox-excluir',
                    json={'familia': SIMBOLO, 'componente': ALVO, 'confirmar': True}).status_code == 404

    j = cli.get('/api/symbols/almox-excluidos').get_json()
    assert j['ok'] and [x['altium'] for x in j['itens']] == [ALVO], j
    print('(2b) GET /almox-excluidos lista o que saiu ok')

    # ── 3. o gerador pula o excluido na rodada seguinte ──────────────────────
    chaves = A.chaves_excluidas(A.carrega_excluidos(tmp))
    assert chaves == {(SIMBOLO, ALVO)}, chaves
    _var, esp = G.le_espelho_almox(os.path.join(tmp, ESPELHO))
    anterior = {s['name']: s for s in esp['symbols']}

    A.PULADOS = 0
    sim1 = A.monta_simbolo(simbolo_de(LINHAS), set(), mapa, anterior, False, None, chaves)
    assert [v['altium'] for v in sim1['valores']] == list(IRMAOS), [v['altium'] for v in sim1['valores']]
    assert A.PULADOS == 1, A.PULADOS
    assert {v['altium']: v['id'] for v in sim1['valores']} == {c: IDS_ANTES[c] for c in IRMAOS}
    assert mapa[SIMBOLO]['ids']['1K'] == ID_ALVO, 'o id do excluido continua reservado'
    # sem a lista, o Odoo o traria de volta: e isso que a lista impede
    sim_sem = A.monta_simbolo(simbolo_de(LINHAS), set(), dict(mapa), anterior, False, None)
    assert ALVO in [v['altium'] for v in sim_sem['valores']], 'o teste tem que provar algo'
    print('(3) o gerador pula o excluido na rodada seguinte ok')

    # a porta dos fundos: espelho que AINDA tem o valor (a gravacao do espelho falhou depois
    # da lista) + Odoo que nao o manda mais -> o `numera_valores` o repescaria como
    # "saiu do Odoo", com saldo zero, de volta na biblioteca que o usuario mandou limpar
    sem_1k = [LINHAS[0], LINHAS[2]]
    com_o_valor = {SIMBOLO: copy.deepcopy(sim0)}
    volta = A.monta_simbolo(simbolo_de(sem_1k), set(), dict(mapa), com_o_valor, False, None)
    assert ALVO in [v['altium'] for v in volta['valores']], 'o repesque tem que existir'
    guardado = A.monta_simbolo(simbolo_de(sem_1k), set(), dict(mapa), com_o_valor, False, None, chaves)
    assert ALVO not in [v['altium'] for v in guardado['valores']], \
        'o excluido voltou pela porta dos fundos do numera_valores'
    print('(3b) nem pelo repesque de "saiu do Odoo" o excluido volta ok')

    # ── 4. desfazer devolve ──────────────────────────────────────────────────
    r = cli.post('/api/symbols/almox-excluir/desfazer', json={'simbolo': SIMBOLO, 'altium': ALVO})
    j = r.get_json()
    assert r.status_code == 200 and j['ok'] and j['desfeito'], j
    assert j['item']['altium'] == ALVO and j['item']['familia'] == FAMILIA, j
    assert A.carrega_excluidos(tmp)['itens'] == [], A.carrega_excluidos(tmp)
    assert A.chaves_excluidas(A.carrega_excluidos(tmp)) == set()
    # e agora o gerador o traz de volta, com o MESMO id
    devolvido = A.monta_simbolo(simbolo_de(LINHAS), set(), mapa, anterior, False, None,
                                A.chaves_excluidas(A.carrega_excluidos(tmp)))
    assert next(v['id'] for v in devolvido['valores'] if v['altium'] == ALVO) == ID_ALVO, \
        'o valor tem que voltar com o mesmo id — senao um esquema ja desenhado muda de peca'
    r = cli.post('/api/symbols/almox-excluir/desfazer', json={'simbolo': SIMBOLO, 'altium': ALVO})
    assert r.status_code == 404, r.get_json()
    assert cli.post('/api/symbols/almox-excluir/desfazer', json={'simbolo': SIMBOLO}).status_code == 400
    print('(4) desfazer devolve o item (e o id volta igual); 404 no que nao esta la ok')

    # ── 5. a gravacao segue o symlink ────────────────────────────────────────
    def pode_symlink():
        try:
            a, b = os.path.join(tmp, '_probe'), os.path.join(tmp, '_probe.lnk')
            with open(a, 'wb') as f:
                f.write(b'x')
            os.symlink(a, b)
            os.remove(b)
            return True
        except (OSError, NotImplementedError, AttributeError):
            return False

    if not pode_symlink():
        print('  --  este sistema nao deixa criar symlink (Windows sem privilegio): a prova')
        print('      de que a lista e gravada ATRAVES do link fica para o servidor (Linux).')
        print('      tests/test_symlink_sobrevive.py varre o repositorio inteiro atras de')
        print('      os.replace(tmp, ...) sem realpath, e cobre este escritor junto.')
    else:
        os.remove(os.path.join(tmp, LISTA))
        shared = os.path.join(tmp, 'shared')
        os.makedirs(shared, exist_ok=True)
        alvo_real = os.path.join(shared, A.EXCLUIDOS)
        with io.open(alvo_real, 'w', encoding='utf-8', newline='\n') as f:
            f.write('{"format":"excluidos-v1","atualizado":"","itens":[\n]}\n')
        link = os.path.join(tmp, LISTA)
        os.symlink(alvo_real, link)              # como o deploy monta a release
        r = cli.post('/api/symbols/almox-excluir',
                     json={'familia': SIMBOLO, 'componente': IRMAOS[1], 'confirmar': True})
        assert r.status_code == 200 and r.get_json()['excluido'], r.get_json()
        assert os.path.islink(link), \
            'o symlink virou arquivo real — a release passaria a ter copia propria e o ' \
            'proximo deploy devolveria as exclusoes de antes'
        assert IRMAOS[1] in le(alvo_real), 'escreveu, mas nao no arquivo apontado pelo link'
        assert not os.path.exists(link + '.tmp'), 'deixou o .tmp para tras'
        assert [x['altium'] for x in cli.get('/api/symbols/almox-excluidos').get_json()['itens']] \
            == [IRMAOS[1]], 'e a leitura tem que enxergar o que foi gravado no shared/'
        print('(5) a lista e gravada ATRAVES do symlink ok')

    # ── 6. o homonimo ──
    # A lista guarda o `valores[].altium` do espelho, que e o nome DEPOIS do desempate; o
    # gerador so conhecia o nome cru, porque o desempate acontece la no fim, quando todas
    # as familias ja estao montadas. Na biblioteca real isso e exatamente um valor hoje
    # (CIRCUITO INTEGRADO [8P] / "PTH DIP8 OP07CP #27"), e excluir esse valor gravava a
    # lista, sumia do espelho, dizia "saiu da biblioteca" — e voltava na sincronizacao
    # seguinte, sem uma linha de aviso.
    A.PULADOS = 0
    com_sufixo = {(SIMBOLO, '%s #%d' % (ALVO, ID_ALVO))}
    sim6 = A.monta_simbolo(simbolo_de(LINHAS), set(), mapa, anterior, False, None, com_sufixo)
    assert [v['altium'] for v in sim6['valores']] == list(IRMAOS),         'o gerador nao achou o excluido pelo nome com sufixo: %s' % [v['altium'] for v in sim6['valores']]
    assert A.PULADOS == 1, A.PULADOS
    # o sufixo previsto vem do id que o livro-razao ja deu aquele label: id de outro valor
    # nao pode levar este junto (o contrario do defeito seria excluir o que ninguem mandou)
    A.PULADOS = 0
    sim6b = A.monta_simbolo(simbolo_de(LINHAS), set(), mapa, anterior, False, None,
                            {(SIMBOLO, '%s #%d' % (ALVO, ID_ALVO + 99))})
    assert ALVO in [v['altium'] for v in sim6b['valores']] and A.PULADOS == 0,         'sufixo com outro id nao pode excluir este valor'
    print('(6) a exclusao encontra o valor pelo nome COM o sufixo do desempate ok')

    # a outra metade: o desempate em si. Excluir um homonimo nao pode renomear o outro.
    def par():
        """o par de verdade da biblioteca: mesmo nome cru, mesma .SchLib (ESPECIAIS)"""
        return [{'name': 'AMPLIFICADOR [8P]', 'familia': 'AMPLIFICADOR', 'grupo': 'especiais',
                 'valores': [{'altium': 'PTH DIP8 OP07CP', 'id': 26}]},
                {'name': 'CIRCUITO INTEGRADO [8P]', 'familia': 'CIRCUITO INTEGRADO',
                 'grupo': 'especiais', 'valores': [{'altium': 'PTH DIP8 OP07CP', 'id': 27}]}]

    def nomes(sims):
        return [v['altium'] for sim in sims for v in sim['valores']]

    assert nomes(A.desempata_nomes(par())) == ['PTH DIP8 OP07CP', 'PTH DIP8 OP07CP #27'],         'o desempate de sempre mudou'
    # agora o AMPLIFICADOR teve o valor excluido: o simbolo continua na rodada, sem valores
    depois = par()
    depois[0]['valores'] = []
    assert nomes(A.desempata_nomes(depois, {('AMPLIFICADOR [8P]', 'PTH DIP8 OP07CP')}))         == ['PTH DIP8 OP07CP #27'],         'excluir o homonimo RENOMEOU o outro — todo `sym` que aponta para "PTH DIP8 '         'OP07CP" passaria a valer para outra peca'
    # sem a reserva o defeito aparece: e a prova de que o teste testa algo
    solto = par()
    solto[0]['valores'] = []
    assert nomes(A.desempata_nomes(solto)) == ['PTH DIP8 OP07CP'], 'o teste nao prova nada'
    # basicos: o balde e a familia, entao homonimo de OUTRA familia nao desempata nada
    duas = [{'name': 'RESISTOR [SMD]', 'familia': 'RESISTOR', 'grupo': 'basicos',
             'valores': [{'altium': 'SMD 0603 1K', 'id': 3}]},
            {'name': 'CAPACITOR [SMD]', 'familia': 'CAPACITOR', 'grupo': 'basicos',
             'valores': [{'altium': 'SMD 0603 1K', 'id': 4}]}]
    assert nomes(A.desempata_nomes(duas)) == ['SMD 0603 1K', 'SMD 0603 1K'],         'familias diferentes sao .SchLib diferentes: nao ha colisao para desempatar'
    print('(6b) excluir um homonimo nao renomeia o outro ok')

    print('test_almox_excluir OK (o valor excluido sai da biblioteca e nao volta sozinho)')
finally:
    H.ROOT = real_root
    S.ROOT = real_root
    shutil.rmtree(tmp, ignore_errors=True)

confere_foto(libs_antes, foto(os.path.join(RAIZ, 'Libs')), 'a suite (na Libs/ de verdade)')
