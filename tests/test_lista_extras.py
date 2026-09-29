# -*- coding: utf-8 -*-
"""Componentes fora do esquema na lista do Odoo (Projects/<p>/lista-extras.json).

    python tests/test_lista_extras.py

Pedido do dono (2026-09-28): na lista de envio para o Odoo, adicionar ou remover componentes
que nao estao no esquema, para completar a lista. O que este teste protege, em ordem de
estrago:

1. **o extra resolve igual a um componente do esquema.** Mesmo sym/params, mesmo product_id:
   uma segunda cascata so para os extras divergiria no dia em que uma das duas mudasse;
2. **arquivo torto e erro, nunca "lista sem extras".** Seguir sem eles mandaria para o Odoo
   uma lista que ninguem montou, e nada no envio mostraria a diferenca;
3. **o id nunca e reusado e a gravacao e serializada.** Duas abas mexendo ao mesmo tempo nao
   podem perder item nem dar o mesmo 'EXTRA n' a duas pecas;
4. **a assinatura.** O total_linhas nao ve a quantidade de um extra mudada noutra aba: o
   /envio precisa recusar a lista que nao e a conferida.

Nenhum teste aqui fala com o Odoo: o cliente e sempre falso, e tudo roda numa raiz de
tempfile (a raiz real tem um .hub-odoo.json com a senha de verdade).
"""
import io
import json
import os
import shutil
import sys
import tempfile
import threading

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

import odoolista as OL          # noqa: E402
import odoolista_server as OS   # noqa: E402

R10K = 'SMD 0805 10K 1/8W'
CONV = 'CONVERSOR DC/DC 5V 1W'

ACERVO = {
    R10K: {
        'itens': [{'odoo': '1891', 'tmpl': '1889', 'nome': 'Resistor 10K 0805 SMD', 'pkg': '0805'}],
        'mpn': '', 'pkgs': ['0805'], 'footprint': 'R0805', 'label': '10K', 'familia': 'RESISTOR',
        'acervo': 'almoxarifado - básicos',
    },
    CONV: {   # o caso ambiguo: tres produtos sob o mesmo rotulo
        'itens': [{'odoo': '875', 'nome': 'B0505S-1WR2', 'pkg': 'SIP4'},
                  {'odoo': '842', 'nome': 'E0505S-1WR3', 'pkg': 'SIP4'},
                  {'odoo': '860', 'nome': 'B0505LS-1WR3', 'pkg': 'SMD'}],
        'mpn': '', 'pkgs': ['SIP4', 'SMD'], 'footprint': '', 'label': '5V 1W', 'familia': 'CONVERSOR',
        'acervo': 'almoxarifado - especiais',
    },
}


def comp(ref, sym, **kw):
    it = {'t': 'comp', 'sheet': 'main', 'ref': ref, 'sym': sym, 'part': kw.pop('part', 1),
          'x': 0, 'y': 0, 'rot': 0, 'mirror': False,
          'footprint': kw.pop('footprint', ''), 'comment': kw.pop('comment', '')}
    it.update(kw)
    return it


def esquema(*itens):
    return {'format': 'schmirror-v2', 'project': 'X', 'units': 'mil',
            'items': [{'t': 'sheet', 'name': 'main', 'size': 'A4'}] + list(itens)}


def extra(n, sym, quantidade=1, **kw):
    return {'id': n, 'sym': sym, 'comment': kw.get('comment', ''),
            'footprint': kw.get('footprint', ''), 'params': kw.get('params', ''),
            'quantidade': quantidade}


def raiz_com(nome='P', *itens):
    """raiz temporaria com Projects/<nome>/schematic.js"""
    d = tempfile.mkdtemp(prefix='lista-extras-')
    os.makedirs(os.path.join(d, 'Projects', nome))
    with io.open(os.path.join(d, 'Projects', nome, 'schematic.js'), 'w', encoding='utf-8') as f:
        f.write('var schematic = ' + json.dumps(esquema(*itens), ensure_ascii=False) + ';\n')
    return d


def arq(d, nome='P'):
    return os.path.join(d, 'Projects', nome, OL.EXTRAS)


def escreve(d, conteudo, nome='P'):
    modo = 'wb' if isinstance(conteudo, bytes) else 'w'
    kw = {} if isinstance(conteudo, bytes) else {'encoding': 'utf-8'}
    with io.open(arq(d, nome), modo, **kw) as f:
        f.write(conteudo)


class _NuncaNaRede(object):
    """Se alguem construir o cliente de verdade durante o teste, o teste morre aqui."""

    def __init__(self, *a, **kw):
        raise AssertionError('o teste tentou falar com o Odoo de verdade')


class _ClienteFalso(object):
    """Odoo de mentira: anota o que recebeu e devolve o recibo da spec, secao 4."""

    def __init__(self):
        self.visto = []

    def confere(self, payload):
        self.visto.append(('confere', payload))
        return {'id': False, 'referencia': '', 'estado': 'ensaio',
                'total_linhas': len(payload['linhas']), 'linhas_pendentes': 0, 'pendencias': []}

    def envia(self, payload):
        self.visto.append(('envia', payload))
        return {'id': 11, 'referencia': 'LISTA/2026/0011', 'estado': 'recebida', 'gravou': True,
                'total_linhas': len(payload['linhas']), 'linhas_pendentes': 0, 'pendencias': []}


class _Bancada(object):
    """Flask so com o Blueprint, apontado para `d`, com o cliente do Odoo trocado por um falso
    e o acervo pela fixture. Desfaz tudo no fim, inclusive o ROOT do Blueprint."""

    def __init__(self, d):
        import flask
        self.d, self.falso = d, _ClienteFalso()
        self.velho = (OS.ROOT, OS._cliente, OL.ClienteLista, OL.carrega_acervo)
        app = flask.Flask(__name__)
        OS.registra(app, d)
        OS._cliente = lambda: (self.falso, None)
        OL.ClienteLista = _NuncaNaRede
        OL.carrega_acervo = lambda raiz=None: ACERVO
        self.cli = app.test_client()

    def fecha(self):
        OS.ROOT, OS._cliente, OL.ClienteLista, OL.carrega_acervo = self.velho
        shutil.rmtree(self.d, ignore_errors=True)

    def post(self, rota, corpo):
        r = self.cli.post('/api/lista' + rota, json=corpo)
        return r.status_code, r.get_json()

    def get(self, rota):
        r = self.cli.get('/api/lista' + rota)
        return r.status_code, r.get_json()


# ─────────────────────────── o arquivo ───────────────────────────

def test_arquivo_ausente_ou_vazio_e_sem_extras():
    d = raiz_com()
    try:
        assert OL.le_extras('P', d) == [], 'sem arquivo tem de ser lista vazia, nao erro'
        for bruto in (b'', b'  \n', bytes([0xEF, 0xBB, 0xBF])):
            escreve(d, bruto)
            assert OL.le_extras('P', d) == [], bruto
        # o BOM do Bloco de Notas nao pode derrubar um arquivo inteiro e correto
        escreve(d, bytes([0xEF, 0xBB, 0xBF]) + json.dumps(
            {'format': OL.EXTRAS_FORMATO, 'proximo': 3, 'itens': [extra(2, R10K, 4)]}).encode())
        assert [x['id'] for x in OL.le_extras('P', d)] == [2]
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_arquivo_torto_e_erro_claro():
    """Nunca 'lista sem extras' calada: a frase nomeia o arquivo e diz por que nao segue."""
    bom = {'format': OL.EXTRAS_FORMATO, 'proximo': 2, 'itens': [extra(1, R10K, 2)]}

    def com(**mexe):
        x = json.loads(json.dumps(bom))
        for k, v in mexe.items():
            if k.startswith('item_'):
                x['itens'][0][k[5:]] = v
            else:
                x[k] = v
        return json.dumps(x)

    def cru(**mexe):
        """com() sem os escapes \\uXXXX: o texto como um editor o grava no disco"""
        return json.dumps(json.loads(com(**mexe)), ensure_ascii=False)

    tortos = {
        # nao-UTF-8: o Set-Content do PowerShell 5.1 grava em ANSI, e basta um acento. Era 500
        # em HTML (UnicodeDecodeError e ValueError, e a leitura so pegava OSError)
        'ansi (cp1252)': cru(item_comment=u'Dissipador alumínio').encode('cp1252'),
        'utf-16 com BOM': cru(item_comment=u'Dissipador alumínio').encode('utf-16'),
        # o escape e JSON valido, mas o caractere nao existe em UTF-8: a gravacao seguinte estouraria
        'surrogate solto no sym': com(item_sym=u'R\ud800'),
        # o UTF-8 escreve, mas o XML 1.0 nao tem: o expat do Odoo recusava o corpo inteiro e
        # todo ensaio do projeto voltava 502 sem dizer que era este extra
        'nao-caractere no comment': cru(item_comment=u'10K\uffff'),
        'nao-caractere no sym': com(item_sym=u'R\ufffe'),
        'json quebrado': '{"itens": [',
        'lista no topo': '[]',
        'itens nao e lista': com(itens={'a': 1}),
        'item nao e objeto': com(itens=['R1']),
        'formato de outro': com(format='lista-extras-v9'),
        'id ausente': com(item_id=None),
        'id bool': com(item_id=True),
        'id texto': com(item_id='1'),
        'id zero': com(item_id=0),
        'sym vazio': com(item_sym='  '),
        'quantidade zero': com(item_quantidade=0),
        'quantidade demais': com(item_quantidade=OL.QTD_MAX + 1),
        'quantidade texto': com(item_quantidade='muitas'),
        'controle no comment': com(item_comment='10K\x07'),
        'params nao e texto': com(item_params={'OdooId': 1}),
        'proximo torto': com(proximo='dez'),
        'id repetido': json.dumps({'itens': [extra(1, R10K), extra(1, CONV)]}),
    }
    d = raiz_com()
    try:
        for caso, conteudo in tortos.items():
            escreve(d, conteudo)
            try:
                OL.le_extras('P', d)
            except OL.ErroOdoo as e:
                assert OL.EXTRAS in str(e) and 'nao sai sem ele' in str(e), (caso, str(e))
            else:
                raise AssertionError('leu um arquivo torto como se estivesse bom: ' + caso)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_proximo_nunca_fica_atras_do_maior_id():
    d = raiz_com()
    try:
        escreve(d, json.dumps({'itens': [extra(7, R10K)]}))           # sem 'proximo'
        OL.altera_extras('P', 'add', {'item': {'sym': CONV, 'quantidade': 1}}, d)
        assert [x['id'] for x in OL.le_extras('P', d)] == [7, 8]
        escreve(d, json.dumps({'proximo': 2, 'itens': [extra(7, R10K)]}))   # atrasado
        _, n = OL.altera_extras('P', 'add', {'item': {'sym': CONV, 'quantidade': 1}}, d)
        assert n == 8, n
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ─────────────────────────── o payload ───────────────────────────

def test_payload_poe_os_extras_depois_do_esquema():
    e = esquema(comp('R1', R10K), comp('R2', R10K))
    extras = [extra(2, R10K, 4), extra(1, CONV, 3, footprint='SMD')]       # fora de ordem
    p = OL.monta_payload('P', 'B', e, ACERVO, 'lucas', '', extras=extras)
    des = [l['designadores'] for l in p['linhas']]
    assert des == ['R1, R2', 'EXTRA 1', 'EXTRA 2'], des
    ex1, ex2 = p['linhas'][1], p['linhas'][2]
    assert ex1['quantidade'] == 3 and ex2['quantidade'] == 4, 'a quantidade e a digitada'
    assert ex1['product_id'] == 860, 'o footprint desempata o ambiguo, como no esquema'
    assert ex2['product_id'] == 1891
    assert ex1['_extra'] == 1 and ex2['_extra'] == 2 and '_extra' not in p['linhas'][0]
    assert p['_extras'] == 2
    limpo = OL.payload_limpo(p)
    assert not [k for ln in limpo['linhas'] for k in ln if k.startswith('_')], limpo
    assert '_extras' not in limpo
    import xmlrpc.client
    xmlrpc.client.dumps((limpo,), allow_none=True)      # atravessa o XML-RPC
    # sem extras, nada muda para quem ja chamava
    assert OL.monta_payload('P', 'B', e, ACERVO)['_extras'] == 0


def test_extra_resolve_igual_a_um_componente_do_esquema():
    """A MESMA cascata: so designadores, quantidade e _extra podem diferir."""
    f = "=Value + ' - ' + Potencia"
    casos = [
        dict(sym='QUALQUER COISA', params='MPN=X;OdooId=4520;ValorId=43'),   # OdooId
        dict(sym=R10K),                                                     # almoxarifado
        dict(sym=CONV),                                                     # ambiguo
        dict(sym=CONV, footprint='SMD'),                                    # desempate
        dict(sym='BC337', comment='BC337'),                                 # MPN pelo nome
        dict(sym='SB160xx', params='MPN=SB160;Encapsulamento=DO-41'),       # MPN do params
        dict(sym='CONECTOR PADRAO', comment=f),                             # nada resolve
        dict(sym=R10K, params='OdooId=0'),                                  # id fora da faixa
    ]
    for c in casos:
        kw = {k: v for k, v in c.items() if k != 'sym'}
        do_esquema = OL.resolve(OL.agrupa(esquema(comp('U1', c['sym'], **kw)))[0][0], ACERVO)
        de_fora = OL.linhas_extras([extra(5, c['sym'], 2, **kw)], ACERVO)[0]
        for k in ('designadores', 'quantidade'):
            do_esquema.pop(k)
        assert de_fora.pop('designadores') == 'EXTRA 5'
        assert de_fora.pop('quantidade') == 2
        assert de_fora.pop('_extra') == 5
        assert de_fora == do_esquema, (c, de_fora, do_esquema)


def test_homonimos_saem_com_o_nome_do_produto_que_vai():
    """Dois valores com o MESMO nome em familias diferentes (o par real do almoxarifado:
    'Cartão Micro SD' do CONECTOR CARTAO SD e do CONECTOR SOQUETE). O product_id sempre foi o
    do OdooId; o nome, o acervo e o encapsulamento vinham do PRIMEIRO homonimo -- a linha ia
    ao Odoo com o produto do soquete e o nome do conector, e quem confere 'corrigiria' para o
    produto errado. Vale igual para o componente do esquema (paridade)."""
    def lib(var, fams):
        return 'var %s = %s;\n' % (var, json.dumps({'symbols': [
            {'familia': fam, 'valores': [v]} for fam, v in fams]}, ensure_ascii=False))
    sd = u'Cartão Micro SD'
    d = tempfile.mkdtemp(prefix='lista-extras-')
    try:
        os.makedirs(os.path.join(d, 'Libs'))
        with io.open(os.path.join(d, 'Libs', 'almox-basicos.js'), 'w', encoding='utf-8') as f:
            f.write(lib('almoxBasicos', [
                ('CONECTOR CARTAO SD', {'id': 20, 'altium': sd, 'label': sd, 'pkgs': ['SMD'],
                                        'itens': [{'odoo': '910', 'nome': u'Conector de Cartão Micro SD'}]}),
                ('CONECTOR SOQUETE', {'id': 80, 'altium': sd, 'label': sd, 'pkgs': ['PUSH'],
                                      'itens': [{'odoo': '149', 'nome': u'Soquete para Cartão Micro SD'}]}),
            ]))
        acervo = OL.carrega_acervo(d)
        assert set(acervo) == {sd}, 'o indice continua por nome'
        casos = [('OdooId=910;ValorId=20', 910, u'Conector'), ('OdooId=149;ValorId=80', 149, u'Soquete'),
                 ('ValorId=80', 149, u'Soquete'),    # sem OdooId: o ValorId desempata
                 ('', 910, u'Conector')]             # sem nada: o primeiro, como sempre foi
        for params, pid, nome in casos:
            de_fora = OL.linhas_extras([extra(1, sd, 2, params=params)], acervo)[0]
            do_esquema = OL.resolve(OL.agrupa(esquema(comp('J1', sd, params=params)))[0][0], acervo)
            for ln in (de_fora, do_esquema):
                assert ln.get('product_id') == pid and ln['nome_altium'].startswith(nome), (params, ln)
            if params:
                assert ln['_encapsulamento'] == ('SMD' if pid == 910 else 'PUSH'), ln
        # o que so tem um nome continua exatamente como era
        assert OL._ficha_do_params(ACERVO[R10K], 1891, {}) is ACERVO[R10K]
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_o_que_vai_ao_odoo_sempre_atravessa_o_xml():
    """O extra recusa o que o XML nao tem (_texto), mas a observacao e os textos do ESQUEMA
    chegam por outro caminho: um VT colado do Word na observacao, ou um controle no comment
    de um componente do Altium, derrubava o corpo XML-RPC inteiro no expat do Odoo."""
    import xmlrpc.client
    e = esquema(comp('R1', R10K, comment=u'10K\x07'), comp('U1', u'CI\uffff', comment='x'))
    p = OL.monta_payload('P', 'A', e, ACERVO, 'lucas', u'confere\x0bisso', extras=[extra(1, R10K, 2)])
    limpo = OL.payload_limpo(p)
    corpo = xmlrpc.client.dumps((limpo,), 'di_confere_lista', allow_none=True)
    xmlrpc.client.loads(corpo.encode('utf-8'))           # o expat do outro lado aceita
    assert limpo['observacao'] == 'confere isso', limpo['observacao']
    assert OL.payload_limpo(limpo) == limpo, 'idempotente: a assinatura aceita o cheio ou o limpo'
    assert OL.assinatura(p) == OL.assinatura(limpo)
    # tab, LF e CR sao XML valido e passam intactos
    assert OL._xml_seguro(u'a\tb\nc\rd') == u'a\tb\nc\rd'


def test_nome_da_linha_e_o_do_produto_que_vai():
    """Valor ambiguo com o OdooId dizendo qual: o nome e o do item escolhido, nao o primeiro."""
    ln = OL.linhas_extras([extra(1, CONV, 1, params='OdooId=860')], ACERVO)[0]
    assert ln['product_id'] == 860 and ln['nome_altium'] == 'B0505LS-1WR3', ln


def test_lista_so_com_extras_e_lista():
    """Esquema sem componente nenhum ainda manda as pecas avulsas; sem linha nenhuma, nao."""
    b = _Bancada(raiz_com('P'))
    try:
        st, j = b.post('/previa', {'projeto': 'P', 'revisao': 'A'})
        assert st == 400 and 'fora do esquema' in j['error'], (st, j)
        OL.altera_extras('P', 'add', {'item': {'sym': R10K, 'quantidade': 5}}, b.d)
        st, j = b.post('/previa', {'projeto': 'P', 'revisao': 'A'})
        assert st == 200 and j['ok'], j
        assert [l['designadores'] for l in j['payload']['linhas']] == ['EXTRA 1']
        assert j['payload']['linhas'][0]['quantidade'] == 5
    finally:
        b.fecha()


def test_arquivo_torto_trava_previa_ensaio_e_envio():
    b = _Bancada(raiz_com('P', comp('R1', R10K)))
    try:
        escreve(b.d, '{"itens": [')
        for rota, corpo in (('/previa', {}), ('/ensaio', {}),
                            ('/envio', {'confirmado': True, 'uid_externo': 'altium:P:A',
                                        'total_linhas': 1})):
            st, j = b.post(rota, dict(corpo, projeto='P', revisao='A'))
            assert st == 400 and OL.EXTRAS in j['error'], (rota, st, j)
        assert not b.falso.visto, 'com o arquivo torto nada pode chegar ao Odoo'
    finally:
        b.fecha()


# ─────────────────────────── as rotas ───────────────────────────

def test_rotas_add_update_remove():
    b = _Bancada(raiz_com('P', comp('R1', R10K)))
    try:
        st, j = b.get('/extras?projeto=P')
        assert st == 200 and j == {'ok': True, 'itens': []}, j

        ids = []
        for sym, q in ((R10K, 4), (CONV, 1), ('BC337', 2)):
            st, j = b.post('/extras', {'projeto': 'P', 'op': 'add',
                                       'item': {'sym': sym, 'comment': ' 10K ', 'footprint': '',
                                                'params': 'OdooId=1891', 'quantidade': q}})
            assert st == 200 and j['ok'], j
            ids.append(j['id'])
        assert ids == [1, 2, 3], ids
        assert j['itens'][0]['comment'] == '10K', 'texto chega aparado'

        # quantidade
        st, j = b.post('/extras', {'projeto': 'P', 'op': 'update', 'id': 2, 'quantidade': 7})
        assert st == 200 and 'id' not in j and \
            [x['quantidade'] for x in j['itens']] == [4, 7, 2], j

        # trocar a peca: os quatro campos juntos -- o que nao veio fica vazio, nunca o velho
        st, j = b.post('/extras', {'projeto': 'P', 'op': 'update', 'id': 1, 'sym': CONV,
                                   'footprint': 'SMD'})
        um = j['itens'][0]
        assert st == 200 and um['sym'] == CONV and um['footprint'] == 'SMD', j
        assert um['params'] == '' and um['comment'] == '', \
            'o OdooId da peca velha ficou mandando na peca nova: %r' % um
        assert um['quantidade'] == 4, 'trocar a peca nao mexe na quantidade'

        # remover, e o id nunca volta
        st, j = b.post('/extras', {'projeto': 'P', 'op': 'remove', 'id': 3})
        assert st == 200 and [x['id'] for x in j['itens']] == [1, 2], j
        st, j = b.post('/extras', {'projeto': 'P', 'op': 'add',
                                   'item': {'sym': R10K, 'quantidade': 1}})
        assert j['id'] == 4, 'o id 3 foi reusado: %r' % j['id']
        disco = json.load(io.open(arq(b.d), encoding='utf-8'))
        assert disco['format'] == OL.EXTRAS_FORMATO and disco['proximo'] == 5, disco
        assert set(disco['itens'][0]) == {'id', 'sym', 'comment', 'footprint', 'params',
                                          'quantidade'}, disco['itens'][0]
        assert not os.path.exists(arq(b.d) + '.tmp'), 'sobrou o temporario'

        st, j = b.get('/extras?projeto=P')
        assert [x['id'] for x in j['itens']] == [1, 2, 4], j

        # e a lista montada enxerga tudo isso
        st, j = b.post('/previa', {'projeto': 'P', 'revisao': 'A'})
        assert [l['designadores'] for l in j['payload']['linhas']] == \
            ['R1', 'EXTRA 1', 'EXTRA 2', 'EXTRA 4'], j['payload']['linhas']
    finally:
        b.fecha()


def test_rotas_recusam_o_que_nao_presta():
    b = _Bancada(raiz_com('P', comp('R1', R10K)))
    try:
        OL.altera_extras('P', 'add', {'item': {'sym': R10K, 'quantidade': 1}}, b.d)
        antes = io.open(arq(b.d), 'rb').read()

        def add(**item):
            return b.post('/extras', {'projeto': 'P', 'op': 'add', 'item': item})

        maus = [
            add(sym=R10K, quantidade=0), add(sym=R10K, quantidade=OL.QTD_MAX + 1),
            add(sym=R10K, quantidade='abc'), add(sym=R10K, quantidade=True),
            add(sym=R10K, quantidade=1.5), add(sym=R10K),
            add(sym='', quantidade=1), add(quantidade=1), add(sym='x' * 201, quantidade=1),
            add(sym=R10K, comment='a\nb', quantidade=1), add(sym=R10K, params=5, quantidade=1),
            add(sym=R10K, params='y' * 2001, quantidade=1),
            add(sym='DISSIPADOR', comment=u'aluminio\uffff', quantidade=2),
            add(sym=u'R\ufffe', quantidade=1),
            b.post('/extras', {'projeto': 'P', 'op': 'add'}),
            b.post('/extras', {'projeto': 'P', 'op': 'apaga', 'id': 1}),
            b.post('/extras', {'projeto': 'P', 'op': 'update', 'id': 1}),
            b.post('/extras', {'projeto': 'P', 'op': 'update', 'id': 'um', 'quantidade': 2}),
            b.post('/extras', {'projeto': 'P', 'op': 'update', 'id': 1, 'quantidade': -3}),
        ]
        for st, j in maus:
            assert st == 400 and j['ok'] is False and j['error'], (st, j)
        assert io.open(arq(b.d), 'rb').read() == antes, 'recusou mas mexeu no arquivo'

        # id que nao existe: 404, e nao 400 -- a outra aba ja tirou
        for op in ('update', 'remove'):
            st, j = b.post('/extras', {'projeto': 'P', 'op': op, 'id': 99, 'quantidade': 2})
            assert st == 404 and 'EXTRA 99' in j['error'], (op, st, j)

        # projeto: sempre pelo _pasta(), nunca caminho do cliente
        for mau in ('Q', '..', 'D:..', '../P', ''):
            st, _ = b.post('/extras', {'projeto': mau, 'op': 'add',
                                       'item': {'sym': R10K, 'quantidade': 1}})
            assert st == 404, mau
            assert b.get('/extras?projeto=' + mau)[0] == 404, mau
        assert b.post('/extras', ['nao', 'e', 'objeto'])[0] == 400

        # arquivo torto: nada de gravar por cima (apagaria os outros extras)
        escreve(b.d, '{"itens": [')
        st, j = add(sym=R10K, quantidade=1)
        assert st == 400 and OL.EXTRAS in j['error'], j
        assert io.open(arq(b.d), encoding='utf-8').read() == '{"itens": ['
        st, j = b.get('/extras?projeto=P')
        assert st == 400 and OL.EXTRAS in j['error'], j
    finally:
        b.fecha()


def test_texto_que_o_utf8_nao_escreve_e_400_e_nao_deixa_tmp():
    """Surrogate solto e arquivo fora do UTF-8: frase em JSON (400), nunca 500 em HTML, e
    nenhum lista-extras.json.tmp largado na pasta do projeto."""
    b = _Bancada(raiz_com('P', comp('R1', R10K)))
    try:
        pasta = os.path.dirname(arq(b.d))
        OL.altera_extras('P', 'add', {'item': {'sym': R10K, 'quantidade': 1}}, b.d)
        antes = io.open(arq(b.d), 'rb').read()
        for corpo in ({'projeto': 'P', 'op': 'add', 'item': {'sym': u'R\ud800', 'quantidade': 1}},
                      {'projeto': 'P', 'op': 'add',
                       'item': {'sym': R10K, 'params': u'OdooId=1;Nota=\udfff', 'quantidade': 1}},
                      {'projeto': 'P', 'op': 'update', 'id': 1, 'sym': u'\ud83d'}):
            st, j = b.post('/extras', corpo)
            assert st == 400 and j and j['ok'] is False and 'surrogate' in j['error'], (st, j)
        assert io.open(arq(b.d), 'rb').read() == antes, 'recusou mas mexeu no arquivo'
        assert sorted(os.listdir(pasta)) == [OL.EXTRAS, 'schematic.js'], os.listdir(pasta)

        # quem chamar a gravacao sem a validacao: o erro sobe, mas o temporario nao fica
        try:
            OL._grava_extras('P', 3, [{'id': 1, 'sym': u'R\ud800', 'comment': '', 'footprint': '',
                                       'params': '', 'quantidade': 1}], b.d)
        except ValueError:
            pass
        else:
            raise AssertionError('gravou um surrogate solto')
        assert not os.path.exists(arq(b.d) + '.tmp'), 'sobrou o .tmp de 0 byte'
        assert io.open(arq(b.d), 'rb').read() == antes

        # o arquivo gravado em ANSI: todas as rotas dizem qual arquivo e, em JSON
        escreve(b.d, json.dumps({'format': OL.EXTRAS_FORMATO, 'proximo': 2,
                                 'itens': [extra(1, R10K, 2, comment=u'alumínio')]},
                                ensure_ascii=False).encode('cp1252'))
        ansi = io.open(arq(b.d), 'rb').read()
        for st, j in (b.get('/extras?projeto=P'),
                      b.post('/previa', {'projeto': 'P', 'revisao': 'A'}),
                      b.post('/ensaio', {'projeto': 'P', 'revisao': 'A'}),
                      b.post('/extras', {'projeto': 'P', 'op': 'add',
                                         'item': {'sym': R10K, 'quantidade': 1}})):
            assert st == 400 and j and OL.EXTRAS in j['error'] and 'UTF-8' in j['error'], (st, j)
        assert io.open(arq(b.d), 'rb').read() == ansi, 'gravou por cima do arquivo que nao leu'
        assert not b.falso.visto, 'com o arquivo ilegivel nada pode chegar ao Odoo'
    finally:
        b.fecha()


def test_trava_serializa_quem_mexe_ao_mesmo_tempo():
    """8 abas x 10 cliques: nenhum item perdido, nenhum id dado duas vezes."""
    b = _Bancada(raiz_com('P'))
    try:
        erros, ids = [], []
        guarda = threading.Lock()

        def aba(k):
            for i in range(10):
                st, j = b.post('/extras', {'projeto': 'P', 'op': 'add',
                                           'item': {'sym': R10K, 'quantidade': k * 100 + i + 1}})
                with guarda:
                    (ids if st == 200 else erros).append(j.get('id') if st == 200 else (st, j))

        fios = [threading.Thread(target=aba, args=(k,)) for k in range(8)]
        for t in fios:
            t.start()
        for t in fios:
            t.join()
        assert not erros, erros[:3]
        assert sorted(ids) == list(range(1, 81)), sorted(ids)
        itens = OL.le_extras('P', b.d)
        assert len(itens) == 80 and len({x['quantidade'] for x in itens}) == 80, \
            'uma gravacao apagou a outra'
    finally:
        b.fecha()


# ─────────────────────────── a assinatura ───────────────────────────

def test_assinatura_pega_o_que_a_contagem_nao_ve():
    b = _Bancada(raiz_com('P', comp('R1', R10K), comp('R2', R10K)))
    try:
        OL.altera_extras('P', 'add', {'item': {'sym': CONV, 'footprint': 'SMD',
                                               'quantidade': 2}}, b.d)
        corpo = {'projeto': 'P', 'revisao': 'A', 'observacao': 'primeira'}
        st, ens = b.post('/ensaio', corpo)
        assert st == 200 and ens['assinatura'] == OL.assinatura(ens['payload']), ens
        assert len(ens['assinatura']) == 40
        n = len(ens['payload']['linhas'])
        confirma = dict(corpo, confirmado=True, uid_externo=ens['uid_externo'], total_linhas=n)

        # a quantidade do extra muda noutra aba: MESMA contagem de linhas
        OL.altera_extras('P', 'update', {'id': 1, 'quantidade': 9}, b.d)
        st, j = b.post('/envio', dict(confirma, assinatura=ens['assinatura']))
        assert st == 409 and j.get('confiraDeNovo') and 'a lista mudou' in j['error'], (st, j)
        assert not [v for v in b.falso.visto if v[0] == 'envia'], 'mandou a lista nao conferida'

        # assinatura vazia tambem e recusa: quem mandou o campo pediu a conferencia
        st, j = b.post('/envio', dict(confirma, assinatura=''))
        assert st == 409 and j.get('confiraDeNovo'), (st, j)

        # sem o campo, o comportamento de antes: uid + total_linhas (e a quantidade passa)
        st, j = b.post('/envio', confirma)
        assert st == 200 and j['ok'], (st, j)

        # conferido de novo, vai -- e a observacao mudada depois NAO invalida a conferencia
        st, ens = b.post('/ensaio', corpo)
        st, j = b.post('/envio', dict(confirma, observacao='outra nota',
                                      assinatura=ens['assinatura']))
        assert st == 200 and j['ok'], (st, j)
        enviado = [v[1] for v in b.falso.visto if v[0] == 'envia'][-1]
        assert enviado['observacao'] == 'outra nota'
        assert [l['quantidade'] for l in enviado['linhas']] == [2, 9], enviado['linhas']
        assert enviado['linhas'][1]['designadores'] == 'EXTRA 1'
    finally:
        b.fecha()


def test_assinatura_e_da_lista_nao_da_mensagem():
    e = esquema(comp('R1', R10K))
    a = OL.monta_payload('P', 'A', e, ACERVO, 'lucas', 'nota', extras=[extra(1, R10K, 2)])
    b = OL.monta_payload('P', 'A', e, ACERVO, 'outro', 'outra', extras=[extra(1, R10K, 2)])
    assert OL.assinatura(a) == OL.assinatura(b) == OL.assinatura(OL.payload_limpo(a))
    for mexe in (dict(revisao='B'), dict(extras=[extra(1, R10K, 3)]),
                 dict(extras=[extra(1, CONV, 2)]), dict(extras=[])):
        kw = dict(revisao='A', extras=[extra(1, R10K, 2)])
        kw.update(mexe)
        c = OL.monta_payload('P', kw['revisao'], e, ACERVO, 'lucas', 'nota', extras=kw['extras'])
        assert OL.assinatura(c) != OL.assinatura(a), mexe


def test_confere_ensaio_sem_assinatura_e_o_de_antes():
    p = {'uid_externo': 'altium:P:B', 'revisao': 'B',
         'linhas': [{'designadores': 'R%d' % i, 'quantidade': 1} for i in (1, 2, 3)]}
    assert OS._confere_ensaio(p, {'uid_externo': 'altium:P:B', 'total_linhas': 3}) is None
    assert 'confira' in OS._confere_ensaio(p, {'uid_externo': 'altium:P:B'}).lower()
    # com a assinatura, a contagem continua dando a frase melhor quando mudou
    msg = OS._confere_ensaio(p, {'uid_externo': 'altium:P:B', 'total_linhas': 5,
                                 'assinatura': OL.assinatura(p)})
    assert 'esquema mudou' in msg, msg
    assert OS._confere_ensaio(p, {'uid_externo': 'altium:P:B',
                                  'assinatura': OL.assinatura(p)}) is None


# ─────────────────────────── o resto do sistema ───────────────────────────

def test_extras_nao_disparam_recarga_nas_abas():
    """O hubserver avisa toda aba a cada mtime novo em Projects/: um extra mudado nao e
    mudanca de desenho, e recarregar a vista Esquema no meio da conferencia derrubaria o
    modal. O .tmp da gravacao atomica tambem nao pode contar."""
    import hubserver as H
    assert OL.EXTRAS in H.ESTADO_LOCAL and H.ODOO_EXTRAS == OL.EXTRAS
    d = raiz_com('P')
    velho = H.ROOT
    try:
        escreve(d, '{"itens": []}')
        with io.open(arq(d) + '.tmp', 'w') as f:
            f.write('{}')
        H.ROOT = d
        nomes = {os.path.basename(k) for k in H._snapshot()}
        assert 'schematic.js' in nomes, 'o watcher parou de ver o projeto'
        assert OL.EXTRAS not in nomes and OL.EXTRAS + '.tmp' not in nomes, nomes
    finally:
        H.ROOT = velho
        shutil.rmtree(d, ignore_errors=True)


def test_cli_manda_os_extras_tambem():
    visto = {}

    class ClienteFalso(object):
        def __init__(self, *a, **kw):
            pass

        def confere(self, payload):
            visto['payload'] = payload
            return {'estado': 'ensaio', 'total_linhas': len(payload['linhas']),
                    'linhas_pendentes': 0, 'pendencias': []}

    velho = (OL.ClienteLista, OL.le_schematic, OL.carrega_acervo, OL.le_extras)
    try:
        OL.ClienteLista = ClienteFalso
        OL.le_schematic = lambda nome, raiz=None: esquema(comp('R1', R10K))
        OL.carrega_acervo = lambda raiz=None: ACERVO
        OL.le_extras = lambda nome, raiz=None: [extra(3, CONV, 6, footprint='SMD')]
        assert OL.main(['--projeto', 'P', '--revisao', 'A']) == 0
        lns = visto['payload']['linhas']
        assert [l['designadores'] for l in lns] == ['R1', 'EXTRA 3'], lns
        assert lns[1]['quantidade'] == 6 and lns[1]['product_id'] == 860, lns[1]
        # e so extras, sem esquema, tambem e lista para o CLI
        OL.le_schematic = lambda nome, raiz=None: esquema()
        assert OL.main(['--projeto', 'P']) == 0
        OL.le_extras = lambda nome, raiz=None: []
        assert OL.main(['--projeto', 'P']) == 1, 'lista vazia tinha de falhar'
    finally:
        OL.ClienteLista, OL.le_schematic, OL.carrega_acervo, OL.le_extras = velho


def main():
    n = 0
    for nome, fn in sorted(globals().items()):
        if nome.startswith('test_') and callable(fn):
            fn()
            n += 1
    print('test_lista_extras OK (%d casos: resolve igual ao esquema, arquivo torto e erro, '
          'id nunca reusado, trava, assinatura)' % n)


if __name__ == '__main__':
    main()
