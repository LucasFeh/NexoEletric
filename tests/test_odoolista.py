# -*- coding: utf-8 -*-
"""A lista de componentes que vai para o Odoo, sem sair da máquina.

    python tests/test_odoolista.py

O que este teste protege, em ordem de estrago:

1. **quantidade por componente, não por parte.** Componente multi-parte é vários itens
   `comp` com o MESMO designador — o CN1 de um projeto real tem 16. Contar itens manda a
   `mrp.bom` pedir 16 conectores depois da aprovação, e ninguém desconfia do número;
2. **valor ambíguo não manda `product_id`.** 62 dos 2511 valores do almoxarifado têm mais
   de um produto do Odoo sob o mesmo rótulo — peças de fabricantes diferentes. Escolher a
   primeira em silêncio é exatamente o que a spec proíbe;
3. **a senha nunca vem do hub-almox.json**, que o hubserver serve em texto claro para a LAN;
4. **o `uid_externo` é estável e não colide** — é ele que impede o mesmo projeto de abrir
   duas solicitações na fila de quem confere.
"""
import io, json, os, shutil, sys, tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

import odoolista as OL  # noqa: E402


def comp(ref, sym, **kw):
    it = {'t': 'comp', 'sheet': 'main', 'ref': ref, 'sym': sym, 'part': kw.pop('part', 1),
          'x': 0, 'y': 0, 'rot': 0, 'mirror': False,
          'footprint': kw.pop('footprint', ''), 'comment': kw.pop('comment', '')}
    it.update(kw)
    return it


def esquema(*itens):
    return {'format': 'schmirror-v2', 'project': 'X', 'units': 'mil',
            'items': [{'t': 'sheet', 'name': 'main', 'size': 'A4'}] + list(itens)}


ACERVO = {
    'SMD 0805 10K 1/8W': {
        'itens': [{'odoo': '1891', 'tmpl': '1889', 'nome': 'Resistor 10K 0805 SMD', 'pkg': '0805'}],
        'mpn': '', 'pkgs': ['0805'], 'footprint': 'R0805', 'label': '10K', 'familia': 'RESISTOR',
    },
    'CONVERSOR DC/DC 5V 1W': {   # o caso ambíguo: três produtos sob o mesmo rótulo
        'itens': [{'odoo': '875', 'nome': 'B0505S-1WR2', 'pkg': 'SIP4'},
                  {'odoo': '842', 'nome': 'E0505S-1WR3', 'pkg': 'SIP4'},
                  {'odoo': '860', 'nome': 'B0505LS-1WR3', 'pkg': 'SMD'}],
        'mpn': '', 'pkgs': ['SIP4', 'SMD'], 'footprint': '', 'label': '5V 1W', 'familia': 'CONVERSOR',
    },
}


def test_agrupa_por_designador():
    """44 itens comp = 21 componentes: o multi-parte não pode inflar a quantidade."""
    e = esquema(*([comp('CN1', 'CONECTOR PADRAO', part=p) for p in range(1, 17)]
                  + [comp('R1', 'SMD 0805 10K 1/8W'), comp('R2', 'SMD 0805 10K 1/8W')]))
    grupos, sobra = OL.agrupa(e)
    assert not sobra, sobra
    porsym = {g['sym']: g for g in grupos}
    assert len(porsym['CONECTOR PADRAO']['refs']) == 1, 'CN1 com 16 partes virou mais de 1 peça'
    assert porsym['SMD 0805 10K 1/8W']['refs'] == ['R1', 'R2']


def test_designadores_em_ordem_humana():
    e = esquema(*[comp(r, 'SMD 0805 10K 1/8W') for r in ('R10', 'R2', 'R1')])
    g = OL.agrupa(e)[0][0]
    assert g['refs'] == ['R1', 'R2', 'R10'], g['refs']
    assert OL.resolve(g, ACERVO)['designadores'] == 'R1, R2, R10'


def test_sem_designador_fica_de_fora():
    """Dois 'R?' diferentes virariam uma linha só, com a quantidade errada."""
    e = esquema(comp('R?', 'A1'), comp('C?', 'B2'), comp('R1', 'SMD 0805 10K 1/8W'))
    grupos, sobra = OL.agrupa(e)
    assert len(grupos) == 1 and grupos[0]['refs'] == ['R1']
    assert sobra == ['C?', 'R?'], sobra


def test_agrupa_por_sym_comment_footprint():
    e = esquema(comp('R1', 'RES', comment='10k', footprint='R0805'),
                comp('R2', 'RES', comment='10k', footprint='R0805'),
                comp('R3', 'RES', comment='4k7', footprint='R0805'))
    grupos, _ = OL.agrupa(e)
    assert len(grupos) == 2
    assert [len(g['refs']) for g in grupos] == [2, 1]


def test_comment_formula_nao_separa_nem_nomeia():
    """28% dos designadores reais têm '=Value + ...' no comment: não diz nada."""
    f = "=Value + ' - ' + Potencia"
    e = esquema(comp('R1', 'RES [SMD]', comment=f), comp('R2', 'RES [SMD]', comment=''))
    grupos, _ = OL.agrupa(e)
    assert len(grupos) == 1, 'a fórmula não resolvida virou um grupo próprio'
    assert 'Value +' not in OL.resolve(grupos[0], ACERVO)['nome_altium']


def test_odooid_do_componente_ganha():
    """O parâmetro que o Altium carrega é o único casamento que não depende de texto."""
    e = esquema(comp('U1', 'QUALQUER COISA', params='MPN=X;OdooId=4520;ValorId=43'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert ln['product_id'] == 4520 and isinstance(ln['product_id'], int)
    assert 'mpn' not in ln


def test_odooid_com_mais_de_um_id_nao_resolve():
    e = esquema(comp('U1', 'QUALQUER COISA', params='OdooId=875 842'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert 'product_id' not in ln


def test_product_id_do_almoxarifado():
    e = esquema(comp('R1', 'SMD 0805 10K 1/8W'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert ln['product_id'] == 1891, ln
    assert ln['nome_altium'] == 'Resistor 10K 0805 SMD'
    assert ln['quantidade'] == 1


def test_valor_ambiguo_nao_escolhe_sozinho():
    e = esquema(comp('U1', 'CONVERSOR DC/DC 5V 1W'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert 'product_id' not in ln, 'escolheu um dos três produtos em silêncio'
    assert 'ambiguo' in ln['_como']


def test_footprint_desempata_o_ambiguo():
    e = esquema(comp('U1', 'CONVERSOR DC/DC 5V 1W', footprint='SMD'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert ln['product_id'] == 860, ln


def test_mpn_pelo_nome_do_simbolo():
    """A biblioteca antiga da casa traz o part number como nome do símbolo."""
    e = esquema(comp('Q1', 'BC337', comment='BC337'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert ln['mpn'] == 'BC337' and 'product_id' not in ln
    assert 'simbolo' in ln['_como']


def test_valor_no_comment_nunca_vira_mpn():
    """'100n' e '330R' são o valor da peça, não código de fabricante.

    MPN que não existe volta como pendência e não custa nada; MPN palpitado que casa por
    acaso põe a peça errada na placa e ninguém desconfia.
    """
    for sym, cm in (('CAP', '100n'), ('RES', '330R'), ('CONN2', 'ALIM 5V'), ('LED', 'VERMELHO')):
        ln = OL.resolve(OL.agrupa(esquema(comp('X1', sym, comment=cm)))[0][0], ACERVO)
        assert 'mpn' not in ln, (sym, cm, ln.get('mpn'))


def test_nome_generico_nao_vira_mpn():
    for sym in ('RES', 'CAP', 'GND', '0805', '330R', '100n', 'CONN2', 'M7', 'ESP32 30pin',
                '1d6ec82d83fb6aee721767c19dac4b9'):   # hash virado nome de símbolo
        assert not OL._parece_mpn(sym), sym
    for sym in ('BC337', '1N4007', 'MMBD4148SE', 'INA219BIDR', 'XTR300AIRGWT'):
        assert OL._parece_mpn(sym), sym


def test_linha_sem_vinculo_ainda_vai():
    """Linha que não resolve não é erro: vai marcada, e quem confere aponta na mão."""
    e = esquema(comp('J1', 'CONECTOR PADRAO'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert 'product_id' not in ln and 'mpn' not in ln
    assert ln['_resolvida'] is False and ln['designadores'] == 'J1'


def test_payload_limpo_nao_leva_campo_de_diagnostico():
    e = esquema(comp('R1', 'SMD 0805 10K 1/8W'), comp('R?', 'X'))
    p = OL.monta_payload('Proj', 'b', e, ACERVO, 'lucas', 'nota')
    assert p['_sem_designador'] == ['R?']
    limpo = OL.payload_limpo(p)
    assert not [k for k in limpo if k.startswith('_')]
    assert not [k for k in limpo['linhas'][0] if k.startswith('_')]
    assert limpo['revisao'] == 'B' and limpo['origem'] == 'AltiumPCBMirror'
    assert limpo['uid_externo'] == 'altium:PROJ:B'
    # o payload tem que sobreviver ao marshalling do XML-RPC
    import xmlrpc.client
    xmlrpc.client.dumps((limpo,), allow_none=True)


def test_default_code_nunca_vai():
    """No acervo da casa o default_code é o ENDEREÇO da gaveta, não part number."""
    e = esquema(comp('R1', 'SMD 0805 10K 1/8W'))
    p = OL.payload_limpo(OL.monta_payload('P', 'A', e, ACERVO))
    assert 'default_code' not in json.dumps(p)


def test_norm_rev_e_parse_revisao():
    assert OL.norm_rev(' rev b ') == 'B'
    assert OL.norm_rev('Rev. 1.0') == '1.0'
    assert OL.norm_rev('') == '' and OL.norm_rev(None) == ''
    assert OL.parse_revisao('DMB - DI231765_P2') == 'P2'
    assert OL.parse_revisao('PRJ-DI221694D') == 'D'
    assert OL.parse_revisao('TCMS_Reader_V2') == 'V2'
    assert OL.parse_revisao('PESDA - DI241790') == ''


def test_uid_externo_estavel_e_sem_colisao():
    nomes = ['DMB - DI231765_P2', 'LM555 astável', 'MID - DI261897 - Cartão Allen Bradley 1492',
             'MIF - DI261898 - Cartão Allen Bradley 1492', 'PACI-DI221687',
             'PDCD-DI261939 (PTYPE)', 'PESDA - DI241790', 'PRJ - IT - DI221705 (Alimentação)',
             'PRJ-DI221694D', 'PRJ-UR-DI261924', 'SD - DI251838', 'TCMS_Reader',
             'TCMS_Reader_V2', 'VDCB - DI251879', '_DemoKit', 'prototipo']
    uids = [OL.uid_externo(n, r) for n in nomes for r in ('A', 'B', 'C', 'P2', 'V2', '1.0')]
    assert len(set(uids)) == len(uids) == 96, len(set(uids))
    assert all(u.count(':') == 2 for u in uids), 'slug ou revisão com ":" torna a chave ambígua'
    assert OL.uid_externo('LM555 astável', 'a') == 'altium:LM555-ASTAVEL:A'
    assert OL.uid_externo('LM555 astavel', 'A') == OL.uid_externo('LM555 astável', 'A'), \
        'tirar o acento do nome da pasta não pode abrir uma solicitação nova'


def test_carrega_acervo_de_lib_gerada():
    d = tempfile.mkdtemp()
    try:
        libs = os.path.join(d, 'Libs')
        os.makedirs(libs)
        lib = {'format': 'schlib-v2', 'symbols': [{
            'name': 'RESISTOR', 'familia': 'RESISTOR', 'valores': [
                {'id': 1, 'altium': 'SMD 0805 10K', 'label': '10K', 'mpn': '', 'pkgs': ['0805'],
                 'itens': [{'odoo': '1891', 'tmpl': '1889', 'nome': 'Resistor 10K', 'pkg': '0805'}]},
                {'id': 2, 'altium': 'SEM ODOO', 'label': 'x', 'itens': [{'nome': 'órfão'}]}]}]}
        with io.open(os.path.join(libs, 'almox-basicos.js'), 'w', encoding='utf-8') as f:
            f.write('var almoxBasicos = ' + json.dumps(lib, ensure_ascii=False) + ';\n')
        idx = OL.carrega_acervo(d)
        assert 'SMD 0805 10K' in idx and idx['SMD 0805 10K']['itens'][0]['odoo'] == '1891'
        assert idx['SEM ODOO']['itens'] == [], 'item sem id do Odoo não pode contar como produto'
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_acervo_ausente_nao_quebra():
    """As libs do almoxarifado são saída gerada e gitignorada: podem não existir."""
    d = tempfile.mkdtemp()
    try:
        assert OL.carrega_acervo(d) == {}
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_senha_nunca_vem_do_hub_almox():
    """hub-almox.json responde 200 em texto claro para a LAN (hubserver.py:120/141)."""
    d = tempfile.mkdtemp()
    velho = {k: os.environ.pop(k, None) for k in ('ODOO_SENHA', 'ODOO_LISTA_SENHA',
                                                  'ODOO_LISTA_URL', 'ODOO_LISTA_DB',
                                                  'ODOO_LISTA_LOGIN')}
    try:
        with io.open(os.path.join(d, OL.CFG_ALMOX), 'w', encoding='utf-8') as f:
            json.dump({'url': 'http://alvo:8070/', 'db': 'base', 'login': 'a@b.c',
                       'senha': 'ESTA-SENHA-VAZA'}, f)
        cfg = OL.destino(d)
        assert cfg['senha'] == '', 'pegou a senha do arquivo que o hub serve por HTTP'
        assert cfg['url'] == 'http://alvo:8070' and cfg['db'] == 'base', cfg
        assert 'ESTA-SENHA-VAZA' not in json.dumps(cfg)

        # o dotfile é o que protege: _serve recusa qualquer segmento começado por ponto
        assert OL.CFG_LISTA.startswith('.')
        with io.open(os.path.join(d, OL.CFG_LISTA), 'w', encoding='utf-8') as f:
            json.dump({'senha': 'ok'}, f)
        assert OL.destino(d)['senha'] == 'ok'

        os.environ['ODOO_SENHA'] = 'do-ambiente'
        assert OL.destino(d)['senha'] == 'do-ambiente', 'a variável de ambiente tem que ganhar'
        assert OL.destino(d)['fonteSenha'] == 'ODOO_SENHA'
    finally:
        for k, v in velho.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
        shutil.rmtree(d, ignore_errors=True)


def test_sem_senha_nao_tenta_a_rede():
    d = tempfile.mkdtemp()
    velho = {k: os.environ.pop(k, None) for k in ('ODOO_SENHA', 'ODOO_LISTA_SENHA')}
    try:
        try:
            OL.ClienteLista(raiz=d)
        except OL.ErroOdoo as e:
            assert 'ODOO_SENHA' in str(e), e
        else:
            assert False, 'subiu um cliente sem senha'
    finally:
        for k, v in velho.items():
            if v is not None:
                os.environ[k] = v
        shutil.rmtree(d, ignore_errors=True)


def test_erro_do_odoo_vira_erro_odoo():
    """SystemExit (odoo_pull.py:82) atravessa except Exception; aqui não pode acontecer."""
    import xmlrpc.client

    class Models(object):
        def execute_kw(self, *a):
            raise xmlrpc.client.Fault(1, 'Traceback...\nValidationError: projeto e obrigatorio')

    c = OL.ClienteLista.__new__(OL.ClienteLista)
    c.db, c.uid, c.senha, c.models, c.modelo = 'b', 1, 's', Models(), OL.MODELO
    try:
        c.envia({})
    except OL.ErroOdoo as e:
        assert str(e) == 'ValidationError: projeto e obrigatorio', e
    else:
        assert False, 'o Fault do Odoo não virou ErroOdoo'


def test_recibo_no_disco_nao_leva_credencial():
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, 'Projects', 'P'))
        payload = OL.payload_limpo(OL.monta_payload('P', 'B', esquema(comp('R1', 'X')), {}, 'lucas'))
        recibo = {'id': 11, 'referencia': 'LISTA/2026/0011', 'estado': 'recebida',
                  'total_linhas': 1, 'linhas_pendentes': 1,
                  'pendencias': [{'designadores': 'R1', 'motivo': 'nao existe no acervo'}]}
        OL.grava_recibo('P', OL.recibo_para_disco(payload, recibo, '2026-09-11 14:22'), d)
        lido = OL.le_recibo('P', d)
        assert lido['referencia'] == 'LISTA/2026/0011' and lido['uid_externo'] == 'altium:P:B'
        bruto = io.open(os.path.join(d, 'Projects', 'P', OL.RECIBO), encoding='utf-8').read()
        assert 'senha' not in bruto.lower(), 'o recibo é servido por HTTP dentro de Projects/'
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_fluxo_completo_com_odoo_de_mentira():
    """Ensaio não grava; envio grava. É a regra que a spec pede na seção 8.1."""
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, 'Projects', 'P'))
        with io.open(os.path.join(d, 'Projects', 'P', 'schematic.js'), 'w', encoding='utf-8') as f:
            f.write('var schematic = ' + json.dumps(
                esquema(comp('R1', 'SMD 0805 10K 1/8W'), comp('R2', 'SMD 0805 10K 1/8W'),
                        comp('U1', 'CONVERSOR DC/DC 5V 1W'))) + ';\n')
        p = OL.monta_payload('P', 'B', OL.le_schematic('P', d), ACERVO, 'lucas')
        limpo = OL.payload_limpo(p)
        assert len(limpo['linhas']) == 2
        r = {l['designadores']: l for l in limpo['linhas']}
        assert r['R1, R2']['quantidade'] == 2 and r['R1, R2']['product_id'] == 1891
        assert 'product_id' not in r['U1']
        assert not os.path.exists(os.path.join(d, 'Projects', 'P', OL.RECIBO)), \
            'o ensaio não pode deixar rastro no disco'
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ─────────── o que a revisão adversarial encontrou, medido contra o Odoo real ───────────

def test_encapsulamento_nunca_vem_do_footprint_do_altium():
    """Medido contra o Odoo do .182: mandar o footprint como encapsulamento derrubava 18 das
    48 linhas que resolveriam sem ele — e o motivo que volta ("MPN X não existe") culpa o
    MPN, então o projetista pede o cadastro de uma peça que já está cadastrada.

    O footprint do Altium é nome de biblioteca de PCB (`DIODO SB160 DO-41`, `FP-SOT23-MFG`);
    encapsulamento do Odoo é `DO-41`, `SOT-23`. O casamento lá é exato.
    """
    e = esquema(comp('D1', 'SB160xx', footprint='DIODO SB160 DO-41'))
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert ln['mpn'] == 'SB160xx'
    assert 'encapsulamento' not in ln, ln.get('encapsulamento')

    # do vocabulário do Odoo, sim: o parâmetro que o Altium carrega
    e = esquema(comp('D1', 'SB160xx', footprint='DIODO SB160 DO-41',
                     params='MPN=SB160;Encapsulamento=DO-41'))
    assert OL.resolve(OL.agrupa(e)[0][0], ACERVO)['encapsulamento'] == 'DO-41'

    # e o pkg do acervo quando é um só
    idx = {'X': {'itens': [], 'mpn': 'ABC123', 'pkgs': ['0805'], 'footprint': '', 'label': ''}}
    ln = OL.resolve(OL.agrupa(esquema(comp('R1', 'X', footprint='RES 1206')))[0][0], idx)
    assert ln['encapsulamento'] == '0805', ln


def test_params_diferentes_nao_viram_uma_linha_so():
    """Três resistores com o mesmo símbolo e OdooId diferente são três peças.

    Sem `params` na chave, o grupo levava o produto do R1 com a quantidade dos três — e
    verde na tela, sem aviso nenhum.
    """
    f = "=Value + ' - ' + Potencia"
    e = esquema(comp('R1', 'RES [SMD]', comment=f, footprint='0805', params='OdooId=1891'),
                comp('R2', 'RES [SMD]', comment=f, footprint='0805', params='OdooId=1905'),
                comp('R3', 'RES [SMD]', comment=f, footprint='0805', params='OdooId=1905'))
    grupos, _ = OL.agrupa(e)
    assert len(grupos) == 2, [g['refs'] for g in grupos]
    lns = {l['designadores']: l for l in (OL.resolve(g, ACERVO) for g in grupos)}
    assert lns['R1']['product_id'] == 1891 and lns['R1']['quantidade'] == 1
    assert lns['R2, R3']['product_id'] == 1905 and lns['R2, R3']['quantidade'] == 2


def test_linha_sem_valor_conhecido_e_marcada():
    """Medido em 6 dos 14 projetos: um `RES [SMD]` de quantidade 24 é quatro resistores
    diferentes, porque o valor só existia no comment e o comment é fórmula não resolvida."""
    f = "=Value + ' - ' + Potencia"
    e = esquema(*[comp('R%d' % i, 'RES [SMD]', comment=f, footprint='0805') for i in (1, 2, 3)])
    ln = OL.resolve(OL.agrupa(e)[0][0], ACERVO)
    assert ln['_semValor'] is True and ln['quantidade'] == 3
    assert 'juntar pecas diferentes' in ln['_como']
    assert OL.monta_payload('P', 'A', e, ACERVO)['_sem_valor'] == 1

    # um componente só não junta nada, então não é perigoso
    ln = OL.resolve(OL.agrupa(esquema(comp('R1', 'RES [SMD]', comment=f)))[0][0], ACERVO)
    assert '_semValor' not in ln

    # e com params o valor está no espelho: nada a avisar
    e = esquema(comp('R1', 'RES [SMD]', comment=f, params='OdooId=1891;Value=10K'),
                comp('R2', 'RES [SMD]', comment=f, params='OdooId=1891;Value=10K'))
    assert '_semValor' not in OL.resolve(OL.agrupa(e)[0][0], ACERVO)


def test_odooid_fora_da_faixa_nao_e_id():
    """0 e negativo não existem no Odoo; >= 2**31 nem atravessa o XML-RPC."""
    for mau in ('0', '999999999999', '-5'):
        ln = OL.resolve(OL.agrupa(esquema(comp('R1', 'SMD 0805 10K 1/8W',
                                               params='OdooId=' + mau)))[0][0], ACERVO)
        assert ln['product_id'] == 1891, (mau, ln)   # caiu para o degrau do almoxarifado


def test_schematic_torto_vira_erro_legivel():
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, 'Projects', 'P'))
        for conteudo in ('var schematic = [];', 'var schematic = "oi";',
                         'var schematic = {"items":"nao e lista"};'):
            with io.open(os.path.join(d, 'Projects', 'P', 'schematic.js'), 'w',
                         encoding='utf-8') as f:
                f.write(conteudo)
            try:
                OL.le_schematic('P', d)
            except OL.ErroOdoo as e:
                assert 'schmirror-v2' in str(e), e
            else:
                assert False, 'passou um schematic.js torto: ' + conteudo
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_protocol_error_vira_erro_odoo():
    """ProtocolError (proxy no caminho, 404, 500 do Odoo) não herda de OSError nem de Fault:
    sem isso ele subia como erro 500 do Flask, com página HTML onde a tela espera a frase."""
    import xmlrpc.client

    class Models(object):
        def execute_kw(self, *a):
            raise xmlrpc.client.ProtocolError('h/x', 500, 'Internal Server Error', {})

    c = OL.ClienteLista.__new__(OL.ClienteLista)
    c.db, c.uid, c.senha, c.models, c.modelo = 'b', 1, 's', Models(), OL.MODELO
    try:
        c.confere({})
    except OL.ErroOdoo as e:
        assert 'nao respondeu' in str(e), e
    else:
        assert False, 'ProtocolError escapou'


def test_pasta_do_projeto_nao_escapa_de_projects():
    """No Windows `D:..` é relativo ao DRIVE: os.path.join o deixava sair da árvore, e foi
    medido lendo arquivo fora de Projects/."""
    import odoolista_server as OS
    d = tempfile.mkdtemp()
    velho = OS.ROOT
    try:
        os.makedirs(os.path.join(d, 'Projects', 'Bom'))
        OS.ROOT = d
        assert OS._pasta('Bom')
        for mau in ('D:..', 'C:', 'C:Users', '..', '../..', '.oculto', '', '   ',
                    'Bom/../..', 'bom'):
            assert OS._pasta(mau) is None, mau
    finally:
        OS.ROOT = velho
        shutil.rmtree(d, ignore_errors=True)


def test_envio_recusa_lista_que_nao_passou_pelo_ensaio():
    """Medido: ensaio de 54 linhas, envio de 39, sem aviso — porque o servidor relê o disco
    nos dois passos e nada do ensaio viajava de volta."""
    import odoolista_server as OS
    p = {'uid_externo': 'altium:P:B', 'revisao': 'B', 'linhas': [1, 2, 3]}
    assert OS._confere_ensaio(p, {'uid_externo': 'altium:P:B', 'total_linhas': 3}) is None
    assert 'confira' in OS._confere_ensaio(p, {}).lower()
    assert 'revisao mudou' in OS._confere_ensaio(
        p, {'uid_externo': 'altium:P:C', 'total_linhas': 3})
    assert 'esquema mudou' in OS._confere_ensaio(
        p, {'uid_externo': 'altium:P:B', 'total_linhas': 5})


# ─────────────── o destino do envio, configurado pela tela ───────────────
# Tudo aqui roda numa raiz de tempfile. A raiz REAL do workspace tem um .hub-odoo.json com
# a senha de verdade, e um teste que a usasse leria (e reescreveria) a senha do usuário.


def _sem_ambiente():
    """Tira do ambiente tudo que ganha do arquivo. Devolve o que tirou, para repor."""
    return {k: os.environ.pop(k, None) for k in
            ('ODOO_SENHA', 'ODOO_LISTA_SENHA', 'ODOO_LISTA_URL', 'ODOO_LISTA_DB',
             'ODOO_LISTA_LOGIN', 'ODOO_LISTA_MODELO')}


def _repoe(velho):
    for k, v in velho.items():
        os.environ.pop(k, None)
        if v is not None:
            os.environ[k] = v


def _app(raiz):
    """Um Flask só com o Blueprint da lista, apontado para `raiz`."""
    import flask
    import odoolista_server as OS
    app = flask.Flask(__name__)
    OS.registra(app, raiz)
    return app.test_client()


def _grava(raiz, nome, dados):
    with io.open(os.path.join(raiz, nome), 'w', encoding='utf-8') as f:
        json.dump(dados, f)


def test_modelo_atravessa_destino():
    """O modelo é configuração (base de teste pode ter outro nome); os métodos, não."""
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    try:
        assert OL.destino(d)['modelo'] == OL.MODELO, 'sem nada configurado vale a constante'
        _grava(d, OL.CFG_ALMOX, {'modelo': 'do.almox'})
        assert OL.destino(d)['modelo'] == 'do.almox'
        _grava(d, OL.CFG_LISTA, {'modelo': 'do.dotfile'})
        assert OL.destino(d)['modelo'] == 'do.dotfile', 'o .hub-odoo.json ganha do almox'
        os.environ['ODOO_LISTA_MODELO'] = 'do.ambiente'
        assert OL.destino(d)['modelo'] == 'do.ambiente', 'o ambiente ganha de tudo'
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


class _ProxyFalso(object):
    """ServerProxy de mentira: autentica sem rede e anota tudo que passou pelo execute_kw."""

    def __init__(self, url, visto):
        self.url, self.visto = url, visto

    def authenticate(self, db, login, senha, kw):
        self.visto.append(('authenticate', db, login, senha))
        return 7

    def execute_kw(self, db, uid, senha, modelo, metodo, args):
        self.visto.append(('execute_kw', modelo, metodo))
        return {}


def test_modelo_configurado_chega_no_execute_kw():
    """Não adianta o destino() saber o modelo se o _chama continua com a constante.

    Passa pelo __init__ DE VERDADE (arquivo → destino() → ClienteLista → execute_kw), e não
    por __new__ com `c.modelo` cravado na mão: cravar o atributo testa o _chama e só ele, e
    o seam que esta frente existe para criar é justamente a costura do meio. Com
    `self.modelo = MODELO` no lugar de `cfg.get('modelo') or MODELO` (odoolista.py) a versão
    antiga deste teste continuava VERDE; esta falha.
    """
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    visto = []
    real = OL.xmlrpc.client.ServerProxy
    OL.xmlrpc.client.ServerProxy = lambda url, **kw: _ProxyFalso(url, visto)
    try:
        _grava(d, OL.CFG_LISTA, {'url': 'http://alvo:8070', 'db': 'base', 'login': 'a@b.c',
                                 'senha': 'SEGREDO', 'modelo': 'di.lista.ensaio'})
        c = OL.ClienteLista(raiz=d)
        c.confere({})
        c.envia({})
        c.estado('altium:P:B')
    finally:
        OL.xmlrpc.client.ServerProxy = real
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)

    assert ('authenticate', 'base', 'a@b.c', 'SEGREDO') in visto, visto
    chamadas = [x for x in visto if x[0] == 'execute_kw']
    assert [m for _, m, _ in chamadas] == ['di.lista.ensaio'] * 3, visto
    # os três métodos continuam cravados: eles são o contrato, não configuração
    assert [k for _, _, k in chamadas] == ['di_confere_lista', 'di_recebe_lista',
                                           'di_estado_lista'], visto


def test_config_grava_a_senha_so_no_dotfile():
    """hub-almox.json responde 200 em texto claro para a LAN: a senha do envio não vai lá."""
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    try:
        _grava(d, OL.CFG_ALMOX, {'url': 'http://almox:8070', 'db': 'almox', 'login': 'a@b.c'})
        r = _app(d).post('/api/lista/config', json={
            'url': 'http://alvo:8070/', 'db': 'base', 'login': 'lista@dieletrons.com',
            'modelo': 'di.lista.altium', 'senha': 'SEGREDO-DO-ENVIO'})
        assert r.status_code == 200, r.status_code

        bruto = io.open(os.path.join(d, OL.CFG_ALMOX), encoding='utf-8').read()
        assert 'SEGREDO-DO-ENVIO' not in bruto, 'a senha foi parar no arquivo servido por HTTP'
        dot = json.load(io.open(os.path.join(d, OL.CFG_LISTA), encoding='utf-8'))
        assert dot['senha'] == 'SEGREDO-DO-ENVIO'
        assert dot['url'] == 'http://alvo:8070', 'a barra do fim tem que cair'
        assert OL.destino(d)['login'] == 'lista@dieletrons.com'
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


def test_config_nunca_devolve_a_senha():
    """Nem no GET nem na resposta do POST que acabou de gravá-la."""
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    try:
        cli = _app(d)
        depois = cli.post('/api/lista/config', json={'senha': 'NAO-PODE-VOLTAR',
                                                     'url': 'http://alvo:8070'})
        assert 'NAO-PODE-VOLTAR' not in depois.get_data(as_text=True)
        r = cli.get('/api/lista/config')
        assert 'NAO-PODE-VOLTAR' not in r.get_data(as_text=True), 'a senha voltou pela rede'
        cfg = r.get_json()['config']
        assert cfg['temSenha'] is True and cfg['fonteSenha'] == OL.CFG_LISTA
        assert cfg['senhaNoArquivo'] is True
        assert 'senha' not in cfg

        # a armadilha do lado do almoxarifado (hubserver.py:579): com a senha vindo do
        # ambiente e o arquivo vazio, `temSenha` sozinho faria a tela anunciar senha
        # gravada sobre arquivo nenhum. Quem desfaz isso é o fonteSenha.
        vazio = tempfile.mkdtemp()
        os.environ['ODOO_SENHA'] = 'do-ambiente'
        try:
            cfg = _app(vazio).get('/api/lista/config').get_json()['config']
            assert cfg['temSenha'] is True and cfg['fonteSenha'] == 'ODOO_SENHA'
            assert cfg['senhaNoArquivo'] is False, 'anunciou senha gravada sobre arquivo nenhum'
        finally:
            shutil.rmtree(vazio, ignore_errors=True)
        # e com a senha nos DOIS lugares o arquivo continua sendo denunciado: e ele que o
        # botao de apagar alcanca (a variavel e do systemd, nao do hub)
        cfg = _app(d).get('/api/lista/config').get_json()['config']
        assert cfg['fonteSenha'] == 'ODOO_SENHA' and cfg['senhaNoArquivo'] is True
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


def test_senha_vazia_nao_apaga_a_gravada():
    """É o caso normal: a tela abre com a senha em branco e alguém vai só trocar a url."""
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    try:
        _grava(d, OL.CFG_LISTA, {'url': 'http://velho:8070', 'senha': 'FICA'})
        cli = _app(d)
        assert cli.post('/api/lista/config',
                        json={'url': 'http://novo:8070', 'senha': ''}).status_code == 200
        assert OL.destino(d)['senha'] == 'FICA', 'o campo em branco apagou a senha'
        assert OL.destino(d)['url'] == 'http://novo:8070'
        # senha ausente do corpo é o mesmo caso
        assert cli.post('/api/lista/config', json={'db': 'outra'}).status_code == 200
        assert OL.destino(d)['senha'] == 'FICA'
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


def test_apagar_senha_precisa_de_pedido_explicito():
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    try:
        _grava(d, OL.CFG_LISTA, {'url': 'http://alvo:8070', 'senha': 'SAI'})
        cli = _app(d)
        assert cli.post('/api/lista/config', json={'apagarSenha': False}).status_code == 200
        assert OL.destino(d)['senha'] == 'SAI', 'apagarSenha falso não pode apagar'
        assert cli.post('/api/lista/config', json={'apagarSenha': True}).status_code == 200
        cfg = OL.destino(d)
        assert cfg['senha'] == '' and cfg['fonteSenha'] == ''
        assert cfg['url'] == 'http://alvo:8070', 'apagar a senha não mexe no resto'
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


def test_campo_vazio_nao_apaga_valor_valido():
    """O bug 1.8 do almoxarifado (PENDENCIAS): url em branco gravada por cima da boa."""
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    try:
        _grava(d, OL.CFG_LISTA, {'url': 'http://alvo:8070', 'db': 'base', 'login': 'a@b.c',
                                 'modelo': 'di.lista.altium'})
        assert _app(d).post('/api/lista/config', json={
            'url': '', 'db': '   ', 'login': '', 'modelo': ''}).status_code == 200
        cfg = OL.destino(d)
        assert cfg['url'] == 'http://alvo:8070' and cfg['db'] == 'base', cfg
        assert cfg['login'] == 'a@b.c' and cfg['modelo'] == 'di.lista.altium', cfg
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


def test_config_de_fora_do_servidor_recusa():
    """Quem escolhe a credencial que o servidor usa tem que estar sentado nele."""
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    fora = {'REMOTE_ADDR': '10.1.2.3'}
    try:
        _grava(d, OL.CFG_LISTA, {'senha': 'FICA'})
        r = _app(d).post('/api/lista/config', json={'senha': 'DE-FORA'}, environ_base=fora)
        assert r.status_code == 403, r.status_code
        assert 'PC do servidor' in r.get_json()['error']
        assert OL.destino(d)['senha'] == 'FICA'
        # o GET continua respondendo, e diz que dali não dá para gravar
        g = _app(d).get('/api/lista/config', environ_base=fora).get_json()
        assert g['local'] is False and 'senha' not in g['config']
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


def test_temporario_da_gravacao_tambem_comeca_por_ponto():
    """`.tmp` sem ponto no nome fica baixável por HTTP durante a escrita — medido com 200.

    O _serve (hubserver.py:122) recusa por SEGMENTO começado por ponto, então é o nome
    inteiro do temporário que precisa começar assim, não só a extensão.
    """
    assert OL.CFG_LISTA.startswith('.')
    visto = []
    real = os.replace

    def espia(src, dst):
        visto.append(os.path.basename(src))
        return real(src, dst)

    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    os.replace = espia
    try:
        OL.grava_destino({'senha': 'x'}, d)
        assert visto and all(n.startswith('.') for n in visto), visto
    finally:
        os.replace = real
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


# ─────── o que a segunda revisão encontrou: o POST que apagava a senha ───────
# Três jeitos reais de o arquivo ficar ilegivel, todos do Bloco de Notas (que é o que a
# instrução antiga mandava usar). Antes da correção os três mediam o mesmo:
# 'senha antes=True depois=False PERDIDA'.
TORTOS = (
    ('BOM do Bloco de Notas', u'\ufeff{"url": "http://alvo:8070", "senha": "FICA"}', True),
    ('virgula sobrando', u'{"url": "http://alvo:8070", "senha": "FICA",}', False),
    ('aspas simples', u"{\'url\': \'http://alvo:8070\', \'senha\': \'FICA\'}", False),
)


def test_arquivo_ilegivel_nunca_apaga_a_senha():
    """O caso mais caro: POST inocente sobre arquivo torto reescrevia o arquivo sem a senha.

    A leitura pode ser tolerante; a ESCRITA não pode usar o mesmo _le_json, que devolve {}
    e faz o formulário gravar por cima. O BOM saiu da lista dos ilegiveis (a leitura virou
    utf-8-sig e o arquivo passou a valer inteiro); os outros dois não têm leitura possível
    e a resposta é recusar a gravação inteira, com a frase que a tela mostra.
    """
    velho = _sem_ambiente()
    try:
        for nome, bruto, legivel in TORTOS:
            d = tempfile.mkdtemp()
            full = os.path.join(d, OL.CFG_LISTA)
            with io.open(full, 'w', encoding='utf-8') as f:
                f.write(bruto)
            antes = io.open(full, 'rb').read()
            r = _app(d).post('/api/lista/config', json={'url': 'http://novo:8070'})
            depois = io.open(full, 'rb').read()
            assert b'FICA' in depois, '%s: a senha sumiu do arquivo' % nome

            if legivel:
                assert r.status_code == 200, (nome, r.status_code)
                assert OL.destino(d)['senha'] == 'FICA', nome
                assert OL.destino(d)['url'] == 'http://novo:8070', nome
                assert OL.senha_no_arquivo(d) is True, nome
            else:
                assert r.status_code == 400, (nome, r.status_code)
                erro = r.get_json()['error']
                assert 'corrompido' in erro and OL.CFG_LISTA in erro, (nome, erro)
                assert depois == antes, '%s: recusou e mexeu no arquivo assim mesmo' % nome
                # e a tela avisa ANTES do clique, em vez de só no erro depois dele
                cfg = _app(d).get('/api/lista/config').get_json()['config']
                assert cfg['arquivoIlegivel'] is True, nome
            shutil.rmtree(d, ignore_errors=True)
    finally:
        _repoe(velho)


def test_url_so_de_barras_nao_apaga_a_url():
    """'/' passava pelo guard de "campo em branco não apaga" e gravava url VAZIA.

    E url vazia não é inócua: o destino() cai no PADRAO. Quando o PADRAO era o ERP de
    TESTE, isso mandava a lista para o lugar errado calado; hoje o PADRAO é o Odoo de
    produção da casa, mas o estrago continua sendo perder a url que estava configurada —
    numa bancada apontada para outro servidor, ela volta para produção sem aviso. O guard
    segue valendo.
    """
    velho = _sem_ambiente()
    try:
        for u in ('/', '//', '   /   ', '///'):
            d = tempfile.mkdtemp()
            _grava(d, OL.CFG_LISTA, {'url': 'http://alvo:8070', 'db': 'base', 'login': 'a@b.c'})
            assert _app(d).post('/api/lista/config', json={'url': u}).status_code == 200
            cfg = OL.destino(d)
            assert cfg['url'] == 'http://alvo:8070', (u, cfg['url'])
            assert '182' not in OL.PADRAO['url'], 'o PADRAO voltou a apontar para o ERP de teste'
            shutil.rmtree(d, ignore_errors=True)

        # a barra do fim continua caindo quando há url de verdade na frente dela
        d = tempfile.mkdtemp()
        assert _app(d).post('/api/lista/config',
                            json={'url': 'http://novo:8070//'}).status_code == 200
        assert OL.destino(d)['url'] == 'http://novo:8070'
        shutil.rmtree(d, ignore_errors=True)

        # e a mesma regra vale na cadeia de fontes: variável de ambiente que é só barra
        # não "vence" com valor vazio, deixa a próxima fonte responder
        d = tempfile.mkdtemp()
        _grava(d, OL.CFG_LISTA, {'url': 'http://alvo:8070'})
        os.environ['ODOO_LISTA_URL'] = '/'
        assert OL.destino(d)['url'] == 'http://alvo:8070'
        shutil.rmtree(d, ignore_errors=True)
    finally:
        _repoe(velho)


def test_apagar_senha_so_aceita_booleano():
    """`apagarSenha: 1` respondia 200 e não apagava nada — no-op silencioso no destrutivo."""
    velho = _sem_ambiente()
    try:
        for v in (True, 1, 'true', 'sim', ' TRUE '):
            d = tempfile.mkdtemp()
            _grava(d, OL.CFG_LISTA, {'url': 'http://alvo:8070', 'senha': 'SAI'})
            assert _app(d).post('/api/lista/config',
                                json={'apagarSenha': v}).status_code == 200, v
            assert OL.destino(d)['senha'] == '', ('nao apagou com %r' % (v,))
            assert OL.destino(d)['url'] == 'http://alvo:8070', v
            shutil.rmtree(d, ignore_errors=True)

        for v in (False, 0, 'false', 'nao', ''):
            d = tempfile.mkdtemp()
            _grava(d, OL.CFG_LISTA, {'senha': 'FICA'})
            assert _app(d).post('/api/lista/config',
                                json={'apagarSenha': v}).status_code == 200, v
            assert OL.destino(d)['senha'] == 'FICA', ('apagou com %r' % (v,))
            shutil.rmtree(d, ignore_errors=True)

        # o que não dá para ler como sim nem como não é recusado, e o POST INTEIRO não
        # grava: metade de um pedido destrutivo é pior do que nenhum
        for v in ('talvez', 2, [], {'x': 1}):
            d = tempfile.mkdtemp()
            _grava(d, OL.CFG_LISTA, {'url': 'http://alvo:8070', 'senha': 'FICA'})
            r = _app(d).post('/api/lista/config',
                             json={'apagarSenha': v, 'url': 'http://novo:8070'})
            assert r.status_code == 400, (v, r.status_code)
            assert 'apagarSenha' in r.get_json()['error'], v
            cfg = OL.destino(d)
            assert cfg['senha'] == 'FICA' and cfg['url'] == 'http://alvo:8070', (v, cfg)
            shutil.rmtree(d, ignore_errors=True)
    finally:
        _repoe(velho)


def test_senha_que_nao_e_texto_conta_a_mesma_historia():
    """{"senha": 12345}: `temSenha` dizia Não e `senhaNoArquivo` dizia Sim, na mesma tela.

    O painel anunciava "Senha gravada" enquanto o envio, ao lado, recusava por falta de
    senha. A regra que vale é a do destino(), que é quem usaria o valor: não é texto, não é
    senha — e aí a tela diz que não há senha e o botão de apagar fica desligado.
    """
    velho = _sem_ambiente()
    try:
        for v in (12345, None, True, ['x'], {'a': 1}, '   '):
            d = tempfile.mkdtemp()
            _grava(d, OL.CFG_LISTA, {'senha': v})
            cfg = _app(d).get('/api/lista/config').get_json()['config']
            assert cfg['temSenha'] == cfg['senhaNoArquivo'], (v, cfg)
            assert cfg['temSenha'] is False, (v, cfg)
            assert OL.destino(d)['senha'] == '', v
            shutil.rmtree(d, ignore_errors=True)

        # e senha de verdade continua contando como gravada dos dois lados
        d = tempfile.mkdtemp()
        _grava(d, OL.CFG_LISTA, {'senha': 'DE-VERDADE'})
        cfg = _app(d).get('/api/lista/config').get_json()['config']
        assert cfg['temSenha'] is True and cfg['senhaNoArquivo'] is True, cfg
        shutil.rmtree(d, ignore_errors=True)
    finally:
        _repoe(velho)


def test_frase_de_falta_de_senha_aponta_para_a_tela():
    """A frase que o usuário realmente vê mandava editar .hub-odoo.json à mão — e só isso.

    Ela nasce no ClienteLista e sobe crua por /ensaio, /envio e /estado. Agora que a aba
    existe, ela vem primeiro: é a única das três saídas que o projetista da bancada
    consegue executar sozinho.
    """
    import odoolista_server as OS
    d = tempfile.mkdtemp()
    velho = _sem_ambiente()
    try:
        try:
            OL.ClienteLista(raiz=d)
            raise AssertionError('sem senha nenhuma o cliente não pode nascer')
        except OL.ErroOdoo as e:
            frase = str(e)
        for pedaco in ('Configuracao', 'Projeto', 'Envio da lista para o Odoo',
                       'ODOO_SENHA', OL.CFG_LISTA):
            assert pedaco in frase, (pedaco, frase)
        assert frase.index('Configuracao') < frase.index('ODOO_SENHA'), frase

        # e ela chega inteira na camada que a tela consome
        _app(d)                                   # registra o Blueprint apontado para `d`
        cliente, erro = OS._cliente()
        assert cliente is None and erro == frase, erro
    finally:
        _repoe(velho)
        shutil.rmtree(d, ignore_errors=True)


def test_painel_repoe_o_apagar_pelo_estado_real():
    """hub-odoocfg.js: depois de um POST que FALHA o "Apagar senha" voltava habilitado.

    Sem senha no arquivo isso dava dois cliques e o toast "senha do Odoo apagada" sobre
    arquivo nenhum. O teste é no FONTE porque o painel só existe dentro do navegador; o que
    dá para travar daqui é o caminho de falha não voltar a mentir.
    """
    src = io.open(os.path.join(RAIZ, 'hub-odoocfg.js'), encoding='utf-8').read()
    i = src.index('const grava = async')
    falha = src[i:src.index('aviso(okMsg', i)]
    assert 'apagar.disabled = !cfg.senhaNoArquivo;' in falha, falha
    assert 'apagar.disabled = false' not in falha, falha
    # o painel também tem que consumir o aviso de arquivo ilegivel que o GET passou a dar
    assert 'arquivoIlegivel' in src



def test_arquivo_vazio_nao_trava_a_gravacao():
    """Recusar a gravacao so se justifica quando ha senha a perder.

    A trava do arquivo ilegivel (que impede o POST de apagar a senha em silencio) pegava junto
    o arquivo VAZIO -- 0 byte, so espaco, ou so o BOM que o Bloco de Notas deixa ao salvar um
    arquivo em branco. Nenhum deles guarda senha, e o 400 travava exatamente quem estava
    comecando do zero. Corrompido de verdade continua recusando, sem tocar no arquivo.
    """
    BOM = bytes([0xEF, 0xBB, 0xBF])
    ESPACO = b'  ' + bytes([10, 9]) + b' '
    for nome, bruto in (('vazio', b''), ('espaco', ESPACO), ('so BOM', BOM)):
        d = tempfile.mkdtemp()
        try:
            with io.open(os.path.join(d, OL.CFG_LISTA), 'wb') as f:
                f.write(bruto)
            OL.grava_destino({'url': 'http://novo:8070'}, raiz=d)
            assert OL._le_json(os.path.join(d, OL.CFG_LISTA))['url'] == 'http://novo:8070', nome
        finally:
            shutil.rmtree(d, ignore_errors=True)

    # BOM + JSON valido grava E preserva a senha -- era o bug que criou a trava
    d = tempfile.mkdtemp()
    try:
        with io.open(os.path.join(d, OL.CFG_LISTA), 'wb') as f:
            f.write(BOM + b'{"senha": "guardada", "url": "http://velho:8070"}')
        OL.grava_destino({'url': 'http://novo:8070'}, raiz=d)
        cfg = OL._le_json(os.path.join(d, OL.CFG_LISTA))
        assert cfg.get('senha') == 'guardada', 'BOM nao pode custar a senha'
        assert cfg.get('url') == 'http://novo:8070'
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # o que nao tem leitura possivel continua recusado, e o arquivo fica intacto
    for bruto in (b'{"senha":"X",}', b"{'senha':'X'}"):
        d = tempfile.mkdtemp()
        try:
            alvo = os.path.join(d, OL.CFG_LISTA)
            with io.open(alvo, 'wb') as f:
                f.write(bruto)
            antes = io.open(alvo, 'rb').read()
            try:
                OL.grava_destino({'url': 'http://novo:8070'}, raiz=d)
                assert False, 'gravou por cima de arquivo ilegivel: %r' % bruto
            except OL.ErroOdoo:
                pass
            assert io.open(alvo, 'rb').read() == antes, 'recusou mas mexeu no arquivo'
        finally:
            shutil.rmtree(d, ignore_errors=True)


def main():
    n = 0
    for nome, fn in sorted(globals().items()):
        if nome.startswith('test_') and callable(fn):
            fn()
            n += 1
    print('test_odoolista OK (%d casos: multi-parte conta 1, ambíguo não escolhe, '
          'senha nunca sai do hub-almox.json)' % n)


if __name__ == '__main__':
    main()
