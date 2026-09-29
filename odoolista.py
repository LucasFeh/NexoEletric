# -*- coding: utf-8 -*-
"""Monta a lista de componentes de um projeto e a manda para o Odoo (di.lista.altium).

    python odoolista.py --projeto "DMB - DI231765_P2" --revisao B             # ensaio
    python odoolista.py --projeto "DMB - DI231765_P2" --revisao B --aplicar   # envia
    python odoolista.py --projeto "DMB - DI231765_P2" --revisao B --estado    # consulta

**Ensaio por padrao.** `di_confere_lista` resolve as linhas e diz o que resolveria sem
gravar nada; so `--aplicar` chama `di_recebe_lista`. A lista nao entra no inventario
quando chega: cai numa fila de aprovacao e alguem do estoque decide. O contrato completo
do lado do Odoo esta em docs/prompt-altium-envio-de-lista.md.

A lista e o esquema MAIS o que o projetista juntou por fora dele pelo hub (Projects/<p>/
lista-extras.json): cada peca avulsa vira uma linha 'EXTRA n' depois das do esquema, pela
mesma cascata de resolucao. Ver linhas_extras e altera_extras.

Credenciais (secao 6 da spec):
  senha  ODOO_LISTA_SENHA -> ODOO_SENHA -> .hub-odoo.json
         NUNCA de hub-almox.json: ate 2026-09-24 o hubserver servia qualquer arquivo da
         raiz que nao comecasse por ponto, e aquele respondia 200 em texto claro para a
         LAN inteira. Hoje o _serve o recusa (hubserver.py » _e_segredo), mas a senha do
         envio continua so em .hub-odoo.json, que o ponto no nome sempre protegeu.
  resto  ODOO_LISTA_URL/DB/LOGIN/MODELO -> .hub-odoo.json -> hub-almox.json -> PADRAO
         (url/db/login nao sao segredo; herda-los do almoxarifado poupa uma configuracao)
         O PADRAO aponta para o Odoo da casa (192.168.15.192:8070, base odoo_db). Ele ja
         apontou para o servidor de TESTE, e ai uma maquina sem configuracao mandava a
         lista para o lugar errado calada; agora errar a configuracao leva ao servidor
         certo, e o guarda de url vazia continua de pe para quem sobrescreve com nada.

O modelo entra nessa mesma cadeia porque a base do Odoo que recebe a lista nem sempre e a
de producao: apontar o hub para uma copia de teste so muda a url se o modelo la se chamar
igual. Os tres METODOS continuam cravados no codigo -- eles sao o contrato da spec, nao
configuracao, e um metodo errado so aparece no 500 do Odoo.
"""
import hashlib
import io
import json
import os
import re
import socket
import sys
import threading
import xmlrpc.client

RAIZ = os.path.dirname(os.path.abspath(__file__))
CFG_LISTA = '.hub-odoo.json'     # o ponto no nome e a protecao: _serve recusa (hubserver.py » _serve)
CFG_ALMOX = 'hub-almox.json'     # so url/db/login; a senha do envio nunca vem daqui, ver docstring
RECIBO = 'odoo-lista.json'       # ao lado do projeto, no molde de bom-opts.json
EXTRAS = 'lista-extras.json'     # componentes FORA do esquema que tambem vao na lista; do hub
EXTRAS_FORMATO = 'lista-extras-v1'

MODELO = 'di.lista.altium'
TIMEOUT = 30.0                   # por conexao; nunca socket.setdefaulttimeout (global)

# Mesmo endereco unico do almoxarifado (tools/almox/odoo_pull.py): o Odoo da casa e
# 192.168.15.192:8070, base odoo_db, modelo di.lista.altium. So a credencial varia.
PADRAO = {'url': 'http://192.168.15.192:8070', 'db': 'odoo_db',
          'login': 'lucas.ferreira@dieletrons.com', 'modelo': MODELO}

# O TITULO entra no indice e viaja ate a tela: e ele que responde "de qual lib esta
# vindo". Linha sem acervo nenhum aqui e a que a tela pinta de vermelho -- nao esta em
# nenhum dos dois almoxarifados, e por isso nao tem como resolver sozinha.
ACERVOS = (('Libs/almox-basicos.js', 'almoxBasicos', 'almoxarifado - básicos'),
           ('Libs/almox-especiais.js', 'almoxEspeciais', 'almoxarifado - especiais'))


class ErroOdoo(RuntimeError):
    """Falha de configuracao, de rede ou do proprio Odoo.

    Exceção normal de proposito: odoo_pull.py:82 levanta SystemExit no login recusado, que
    atravessa `except Exception` e derruba quem chamou sem passar pelo tratamento.
    """


# ───────────────────────────── leitura do espelho ─────────────────────────────

def le_var_js(caminho):
    """Le um arquivo 'var X = ...;' e devolve o valor.

    Mesma receita de hubserver.py:249 (load_var_file) — os arquivos do espelho sao JSON
    gerado com uma atribuicao na frente. Duplicada aqui de proposito: importar o hubserver
    para ler um arquivo criaria dependencia circular com o Blueprint.
    """
    with io.open(caminho, encoding='utf-8', errors='replace') as f:
        s = f.read()
    s = re.sub(r'^\s*//[^\n]*\n', '', s, flags=re.M)
    s = s[s.find('=') + 1:].strip().rstrip(';').strip()
    s = re.sub(r',\s*([\]}])', r'\1', s)
    return json.loads(s)


def carrega_acervo(raiz=RAIZ):
    """Indice nome-do-valor-no-Altium -> ficha do almoxarifado.

    Na conversao para o Altium cada VALOR virou um componente proprio na .SchLib, com
    LibReference = valores[].altium (schlib_escritor.py:371/401). E esse nome que o
    schematic.js grava em `sym` — por isso ele e a chave do indice.

    As libs sao saida gerada e gitignorada: num workspace que nunca sincronizou elas nao
    existem, e o indice sai vazio. Isso nao e erro; as linhas so caem para MPN.

    HOMONIMOS. O nome nao e unico: 'Cartão Micro SD' e um valor da familia CONECTOR CARTAO
    SD (OdooId 910) e outro da CONECTOR SOQUETE (OdooId 149). Pelo nome vale o primeiro,
    como sempre; os seguintes ficam em `homonimos` na ficha dele, para o resolve() trocar de
    ficha quando o params do componente disser QUAL dos dois e (ver _ficha_do_params). Sem
    isso a linha ia com o product_id do soquete e o nome do conector.
    """
    idx = {}
    for rel, _var, titulo in ACERVOS:
        caminho = os.path.join(raiz, rel.replace('/', os.sep))
        if not os.path.isfile(caminho):
            continue
        try:
            lib = le_var_js(caminho)
        except (OSError, ValueError):
            continue
        for sy in lib.get('symbols') or []:
            for v in sy.get('valores') or []:
                nome = (v.get('altium') or '').strip()
                if not nome:
                    continue
                itens = [it for it in (v.get('itens') or []) if it.get('odoo')]
                ficha = {
                    'itens': itens,
                    'mpn': (v.get('mpn') or '').strip(),
                    'pkgs': [p for p in (v.get('pkgs') or []) if p],
                    'footprint': (v.get('footprint') or '').strip(),
                    'label': (v.get('label') or '').strip(),
                    'familia': (sy.get('familia') or sy.get('name') or '').strip(),
                    'acervo': titulo,
                    # o ValorId que o paramsDoValor do hub grava: numera por SIMBOLO (o
                    # livro-razao do almoxarifado), entao se repete entre familias -- so
                    # desempata entre os homonimos de um mesmo nome, e so se sobrar um
                    'valor_id': str(v.get('id') or ''),
                }
                if nome in idx:
                    idx[nome].setdefault('homonimos', [idx[nome]]).append(ficha)
                    continue
                idx[nome] = ficha
    return idx


def _ficha_do_params(ficha, product_id, par):
    """A ficha do homonimo que o componente e, quando o nome sozinho nao diz.

    Primeiro pelo produto (o OdooId e a verdade da peca: a ficha certa e a unica que o tem
    entre os itens), depois pelo ValorId. Nenhum dos dois desempata = fica a do nome, como
    antes. Sem homonimo a ficha volta intacta -- e o caso de 2544 dos 2545 valores."""
    homs = ficha.get('homonimos')
    if not homs:
        return ficha
    if product_id is not None:
        certa = [f for f in homs
                 if any(str(x.get('odoo')) == str(product_id) for x in f.get('itens') or [])]
        if len(certa) == 1:
            return certa[0]
    vid = (par.get('ValorId') or '').strip()
    if vid:
        certa = [f for f in homs if f.get('valor_id') == vid]
        if len(certa) == 1:
            return certa[0]
    return ficha


# ───────────────────────────── identidade do envio ─────────────────────────────

def slug_projeto(nome):
    """Slug canonico da casa (_proj_id, hubserver.py:259) com o acento dobrado antes.

    A dobra e o unico desvio, e e estritamente melhor: 'Cartao' em vez de 'Cart-o' para
    quem le a fila no Odoo, e o slug sobrevive a um rename que so tira o acento.
    """
    import unicodedata
    s = unicodedata.normalize('NFKD', nome or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s.upper() or 'PROJ'


def norm_rev(rev):
    """'rev B' / ' b ' -> 'B'. Nunca inventa um default: revisao vazia e vazia."""
    s = re.sub(r'^\s*rev\.?\s*', '', str(rev or ''), flags=re.I)
    s = re.sub(r'[^A-Za-z0-9.\-]+', '-', s)
    return s.strip('-.').upper()


def uid_externo(projeto, revisao):
    """Chave de idempotencia estavel por projeto+revisao (spec, secao 3).

    Nem o slug nem a revisao normalizada podem conter ':', entao a chave nunca e ambigua.
    """
    return 'altium:%s:%s' % (slug_projeto(projeto), norm_rev(revisao))


def parse_revisao(pasta):
    """Palpite de revisao a partir do nome da pasta. So SUGERE — nunca decide.

    Medido nas 16 pastas reais: acha codigo DI em 11 e revisao em 3 (P2, D, V2). O resto
    fica vazio, e ai quem digita e o projetista.
    """
    m = re.search(r'DI(\d{6})([A-Za-z])?(?![0-9])', pasta or '')
    letra = (m.group(2) or '').upper() if m else ''
    resto = pasta[m.end():] if m else (pasta or '')
    s = re.search(r'[_\-\s]([PVR]\d{1,2})(?![0-9A-Za-z])', resto, re.I)
    return (s.group(1).upper() if s else '') or letra


# ───────────────────────────── montagem das linhas ─────────────────────────────

def _par(texto):
    """'K=V;K=V' -> dict. Mesmo formato plano que o BuildSchematic le (schframe.js:975)."""
    out = {}
    for campo in str(texto or '').split(';'):
        i = campo.find('=')
        if i > 0 and campo[:i].strip():
            out[campo[:i].strip()] = campo[i + 1:].strip()
    return out


def _natural(ref):
    """Ordem humana: R2 antes de R10."""
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r'(\d+)', ref or '')]


def _formula(texto):
    """Comment que e formula nao resolvida do Altium ('=Value + ...') nao diz nada.

    Medido: 156 de 552 designadores (28,3%) em 8 projetos tem o comment nesse estado.
    """
    return str(texto or '').strip().startswith('=')


def _limpo(texto):
    return '' if _formula(texto) else str(texto or '').strip()


def _parece_mpn(texto):
    """Tem cara de part number de verdade: BC337, 1N4007, MMBD4148SE, XTR300AIRGWT.

    Deliberadamente severo, e o motivo e o mesmo da spec ("o Odoo nao escolhe por voce"):
    MPN que nao existe volta como pendencia e nao custa nada, mas MPN palpitado que CASA
    por acaso poe a peca errada na placa sem ninguem desconfiar. Entao ficam de fora:

      'RES', 'CAP', 'LED'   sem digito       — casariam com qualquer coisa
      '0805', '330R', '100n' sem letra, ou   — valor do componente nao e part number
      'CONN2', 'M7'         so um digito     — curto demais para ser codigo de fabricante
      'ESP32 30pin'         com espaco       — e descricao, nao codigo
      '1d6ec82d83fb…'       hexadecimal      — hash que virou nome de simbolo na lib antiga
    """
    t = str(texto or '').strip()
    if len(t) >= 16 and re.match(r'^[0-9a-f]+$', t):
        return False
    return bool(5 <= len(t) <= 40
                and re.match(r'^[A-Za-z0-9][A-Za-z0-9\-/._#+]*$', t)
                and len(re.findall(r'\d', t)) >= 2 and re.search(r'[A-Za-z]', t))


def agrupa(schematic):
    """Os itens comp do schematic.js viram linhas de BoM.

    Dois agrupamentos, nesta ordem, e a ordem importa:

    1. por `ref` — componente multi-parte e VARIOS itens comp com o MESMO designador. No
       DMB sao 44 itens para 21 componentes, e o CN1 sozinho tem 16 partes. Contar itens
       mandaria a BoM pedir 16 conectores;
    2. por (sym, comment, footprint) — e a linha que a spec quer: 'R1, R2, R5' com
       quantidade 3, nao tres linhas de 1.

    Designador nao anotado ('R?') sai de fora e volta em `sem_designador`: dois
    componentes diferentes com o mesmo 'R?' virariam uma linha so, com a quantidade errada.
    """
    porref, ordem, sem_designador = {}, [], []
    for it in (schematic.get('items') or []):
        if it.get('t') != 'comp':
            continue
        ref = str(it.get('ref') or '').strip()
        if not ref or ref.endswith('?'):
            sem_designador.append(ref or '(sem designador)')
            continue
        parte = it.get('part') or 1
        if ref not in porref:
            porref[ref] = it
            ordem.append(ref)
        elif parte < (porref[ref].get('part') or 1):
            porref[ref] = it              # a parte 1 carrega a identidade do componente

    grupos, chaves = {}, []
    for ref in ordem:
        c = porref[ref]
        # `params` entra na CHAVE, nao so no grupo: tres resistores com o mesmo simbolo e o
        # mesmo comment mas OdooId diferente sao tres pecas. Agrupar sem ele e carregar o
        # params do primeiro mandaria o produto do R1 com a quantidade dos tres.
        k = (str(c.get('sym') or ''), _limpo(c.get('comment')),
             str(c.get('footprint') or ''), str(c.get('params') or ''))
        if k not in grupos:
            grupos[k] = {'sym': k[0], 'comment': k[1], 'footprint': k[2], 'params': k[3],
                         'refs': [], 'semValor': _formula(c.get('comment'))}
            chaves.append(k)
        grupos[k]['refs'].append(ref)

    saida = []
    for k in chaves:
        g = grupos[k]
        g['refs'].sort(key=_natural)
        # Valor desconhecido so e PERIGOSO quando junta mais de um componente: o comment era
        # formula nao resolvida e nao ha params, entao nada no espelho separa um 10K de um
        # 1K. Medido: em 6 dos 14 projetos isso junta valores realmente diferentes.
        g['semValor'] = bool(g['semValor'] and not g['params'] and len(g['refs']) > 1)
        saida.append(g)
    saida.sort(key=lambda g: _natural(g['refs'][0]))
    return saida, sorted(set(sem_designador))


def resolve(grupo, acervo):
    """Descobre como esta linha aponta para um produto do Odoo. Cascata da spec, secao 2.

    1. `product_id` vindo do parametro OdooId que o Altium carrega no componente;
    2. `product_id` do espelho do almoxarifado, pelo nome do simbolo;
    3. `mpn` (+ encapsulamento, sem o qual 1N4007 casa com DO-41 E com M7);
    4. nada — a linha vai assim mesmo, marcada, e quem confere aponta na mao.

    `hub_uid` (degrau 2 da spec) NAO existe neste espelho: nenhum codigo gera x_hub_uid.
    O degrau e pulado de proposito, nao esquecido.

    Valor com mais de um item do Odoo e AMBIGUO e nao manda product_id: sao pecas
    diferentes fundidas pelo rotulo (medido: 62 dos 2511 valores), e escolher a primeira
    poria a peca errada na placa. O footprint desempata quando so um item casa com ele.
    """
    par = _par(grupo.get('params'))
    linha, como = {}, ''

    # id fora da faixa nao e id: 0 e negativo nao existem no Odoo, e >= 2**31 nem atravessa
    # o XML-RPC. Cair fora daqui deixa os degraus seguintes da cascata tentarem.
    odoo_ids = [int(x) for x in re.split(r'[\s,]+', par.get('OdooId', ''))
                if x.isdigit() and 0 < int(x) < 2 ** 31]
    if len(odoo_ids) == 1:
        linha['product_id'] = odoo_ids[0]
        como = 'OdooId do componente'

    ficha = _ficha_do_params(acervo.get(grupo['sym']) or {}, linha.get('product_id'), par)
    itens = ficha.get('itens') or []
    if 'product_id' not in linha and itens:
        escolha = itens
        fp = (grupo.get('footprint') or '').strip().lower()
        if len(itens) > 1 and fp:
            casam = [x for x in itens if (x.get('pkg') or '').strip().lower() == fp]
            if len(casam) == 1:
                escolha = casam
        if len(escolha) == 1 and str(escolha[0].get('odoo') or '').isdigit():
            linha['product_id'] = int(escolha[0]['odoo'])
            como = 'almoxarifado' + (' (pelo footprint)' if escolha is not itens else '')
        else:
            como = 'ambiguo: %d produtos com este rotulo' % len(itens)

    if 'product_id' not in linha:
        mpn, palpite = par.get('MPN') or ficha.get('mpn') or '', False
        if not mpn and _parece_mpn(grupo['sym']):
            # Boa parte da biblioteca antiga da casa tem o proprio part number como nome do
            # simbolo (BC337, MMBD4148SE, XTR300AIRGWT). So o NOME DO SIMBOLO entra nesse
            # palpite: o comment guarda o valor da peca ('100n', '330R'), que nao e codigo
            # de fabricante — e o palpite e anunciado como palpite na coluna de resolucao.
            mpn, palpite = grupo['sym'].strip(), True
        if mpn:
            linha['mpn'] = mpn
            # SO o vocabulario do Odoo. O footprint do Altium e nome de biblioteca de PCB
            # (FP-SOT23-MFG, DIODO SB160 DO-41), nao encapsulamento (SOT-23, DO-41), e o Odoo
            # casa MPN+encapsulamento por igualdade exata: medido contra o .182, mandar o
            # footprint como encapsulamento derruba 18 das 48 linhas que resolveriam sem ele
            # -- e o motivo que volta (MPN X nao existe) culpa o campo errado, e o projetista
            # vai pedir o cadastro de uma peca que ja esta cadastrada.
            enc = par.get('Encapsulamento') or ''
            if not enc and len(ficha.get('pkgs') or []) == 1:
                enc = ficha['pkgs'][0]
            if enc:
                linha['encapsulamento'] = enc
            if not como:
                como = 'MPN pelo nome do simbolo' if palpite else 'MPN'
                if not enc:
                    # sem o encapsulamento, 1N4007 casa com DO-41 E com M7 e o Odoo nao
                    # escolhe por voce: a linha volta como ambigua (spec, secao 2)
                    como += ' (sem encapsulamento)'

    # o nome e o do item que vai: com o product_id decidido, o item dele, e nao o primeiro --
    # num valor ambiguo o primeiro e outra peca
    item = next((x for x in itens if str(x.get('odoo')) == str(linha.get('product_id'))),
                itens[0] if itens else {})
    nome = item.get('nome') or ficha.get('label') or ''
    if not nome:
        nome = grupo['sym']
        if grupo['comment'] and grupo['comment'] != grupo['sym']:
            nome = nome + ' · ' + grupo['comment']
    linha['nome_altium'] = nome[:200]
    if grupo.get('footprint'):
        linha['footprint'] = grupo['footprint']
    linha['designadores'] = ', '.join(grupo['refs'])
    linha['quantidade'] = len(grupo['refs'])
    # ── o que a TELA mostra, e que o payload_limpo tira antes de enviar ──
    # Encapsulamento, valor e acervo saem SEMPRE que se souber, e nao so no degrau que
    # por acaso os usou: quem confere a lista precisa ver os tres em toda linha para
    # decidir, inclusive nas que nao resolveram -- sao elas que mais precisam ser vistas.
    enc_tela = par.get('Encapsulamento') or linha.get('encapsulamento') or ''
    if not enc_tela and len(ficha.get('pkgs') or []) == 1:
        enc_tela = ficha['pkgs'][0]
    if enc_tela:
        linha['_encapsulamento'] = enc_tela
    # o Value do parametro de identidade e a verdade da peca; o label do almoxarifado
    # vem depois; o comment do Altium e o ultimo recurso (pode ser formula nao resolvida)
    val = (par.get('Value') or ficha.get('label') or grupo.get('comment') or '').strip()
    if val and val != grupo['sym']:
        linha['_valor'] = val
    if ficha.get('acervo'):
        linha['_acervo'] = ficha['acervo']
    linha['_como'] = como or 'sem vinculo com o cadastro'
    linha['_resolvida'] = 'product_id' in linha or 'mpn' in linha
    if grupo.get('semValor'):
        linha['_semValor'] = True
        linha['_como'] = 'valor nao esta no espelho - pode juntar pecas diferentes'
    return linha


def designador_extra(n):
    """'EXTRA 3'. A tela casa as pendencias que o Odoo devolve pelos designadores da linha,
    entao o nome nao pode ser o de um componente de verdade: medido nos 16 projetos (1428
    componentes), nenhum designador comeca por EXTRA. O numero e o id do item, que nunca
    e reusado -- 'EXTRA 3' removido nao volta como outra peca na lista seguinte."""
    return 'EXTRA %d' % n


def linhas_extras(extras, acervo):
    """Uma linha por componente fora do esquema, na ordem do id.

    O item tem o MESMO shape de um componente do esquema (sym/comment/footprint/params), e
    por isso passa pela MESMA cascata: o resolve() nao sabe que a linha e extra. Duas coisas
    so mudam depois dele -- a quantidade, que e a digitada e nao a contagem de designadores,
    e o `_extra`, que e o id e so a tela usa (o payload_limpo o tira).
    """
    linhas = []
    for it in sorted(extras or [], key=lambda x: x['id']):
        grupo = {'sym': str(it.get('sym') or ''), 'comment': _limpo(it.get('comment')),
                 'footprint': str(it.get('footprint') or ''), 'params': str(it.get('params') or ''),
                 'refs': [designador_extra(it['id'])], 'semValor': False}
        ln = resolve(grupo, acervo)
        ln['quantidade'] = int(it['quantidade'])
        ln['_extra'] = it['id']
        linhas.append(ln)
    return linhas


def monta_payload(projeto, revisao, schematic, acervo, enviado_por='', observacao='',
                  extras=None):
    """O payload da spec, secao 2, mais o que a tela precisa saber (campos com _).

    `extras` sao os itens de lista-extras.json (le_extras): entram DEPOIS das linhas do
    esquema, uma linha cada. Lista so com extras e lista -- esquema sem componente nenhum
    ainda pode mandar as pecas avulsas; o que nao pode e nao haver linha nenhuma.
    """
    grupos, sem_designador = agrupa(schematic)
    linhas = [resolve(g, acervo) for g in grupos]
    de_fora = linhas_extras(extras, acervo)
    linhas += de_fora
    return {
        'uid_externo': uid_externo(projeto, revisao),
        'projeto': projeto,
        'revisao': norm_rev(revisao),
        'origem': 'AltiumPCBMirror',
        'enviado_por': enviado_por or '',
        'observacao': observacao or '',
        'linhas': linhas,
        '_sem_designador': sem_designador,
        '_sem_valor': sum(1 for l in linhas if l.get('_semValor')),
        '_extras': len(de_fora),
    }


# O que o XML 1.0 nao tem: os controles C0 (menos tab, LF e CR), as metades de surrogate
# soltas e U+FFFE/U+FFFF. O xmlrpc.client.dumps os passa crus e o expat do Odoo recusa o corpo
# INTEIRO -- um VT colado do Word na observacao, ou um controle no comment de um componente
# vindo do Altium, derrubava todo ensaio e todo envio num 502 que nao dizia o campo.
_FORA_DO_XML = re.compile(u'[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]')


def _xml_seguro(v):
    """O texto sem o que o XML 1.0 recusa (vira espaco); o resto passa intacto."""
    return _FORA_DO_XML.sub(' ', v) if isinstance(v, str) else v


def payload_limpo(payload):
    """So o que o Odoo entende: os campos de diagnostico com _ ficam deste lado, e todo texto
    passa pelo _xml_seguro. E o que o Odoo recebe E o que a assinatura assina, entao o ensaio
    e o envio concordam sobre ele. Idempotente."""
    linhas = []
    for ln in payload.get('linhas') or []:
        linhas.append({k: _xml_seguro(v) for k, v in ln.items() if not k.startswith('_')})
    fora = {k: _xml_seguro(v) for k, v in payload.items() if not k.startswith('_') and k != 'linhas'}
    fora['linhas'] = linhas
    return fora


# Quem envia e a observacao ficam FORA da assinatura: sao da MENSAGEM, nao da LISTA. A
# observacao se digita no modal depois que a conferencia ja voltou (nada a invalida, e nem
# deve: ela nao muda linha nenhuma), e o enviado_por sai do login configurado. Assinar os
# dois faria o /envio recusar com "a lista mudou" uma lista que nao mudou -- e o alarme que
# dispara sem motivo e o que ensina a clicar sem ler.
FORA_DA_ASSINATURA = ('enviado_por', 'observacao')


def assinatura(payload):
    """sha1 do que o Odoo vai receber, em forma canonica (chaves ordenadas).

    E a conferencia completa de "o que vai e o que foi visto": o total_linhas pega linha que
    sumiu ou nasceu, mas nao pega a QUANTIDADE de um extra que mudou em outra aba, nem uma
    peca trocada com a mesma contagem. Aceita o payload cheio ou o limpo -- o payload_limpo
    e idempotente, e os campos de tela (_) nunca entram.
    """
    limpo = payload_limpo(payload)
    base = {k: v for k, v in limpo.items() if k not in FORA_DA_ASSINATURA}
    bruto = json.dumps(base, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha1(bruto.encode('utf-8')).hexdigest()


# ───────────────────────────── credenciais e cliente ─────────────────────────────

def _le_json(caminho):
    """Tolerante DE PROPOSITO, e so para LER: arquivo torto faz a configuracao sumir da
    tela, o que e chato mas reversivel. Para ESCREVER existe o _le_json_estrito -- e a
    diferenca entre os dois e o que impede o POST de apagar a senha (ver grava_destino).

    utf-8-sig e nao utf-8: o Bloco de Notas grava BOM, e com `utf-8` o json.load estoura no
    primeiro caractere. Um .hub-odoo.json inteiro e correto, so salvo pelo Bloco de Notas,
    virava {} aqui -- e ai destino() cai no PADRAO, que aponta para o servidor de TESTE.
    """
    try:
        with io.open(caminho, encoding='utf-8-sig') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _le_json_estrito(caminho):
    """O mesmo arquivo, mas para quem vai GRAVAR por cima: o que nao parseia vira ErroOdoo.

    `cfg = _le_json(full)` devolvendo {} num arquivo ilegivel, mais os campos do formulario,
    grava um .hub-odoo.json novo POR CIMA da senha que estava la -- sem erro, sem aviso, e a
    senha nao volta. Medido nos tres jeitos de o arquivo ficar ilegivel (BOM, virgula
    sobrando, aspas simples): 'senha antes=True depois=False'. O BOM saiu da lista quando a
    leitura virou utf-8-sig; os outros dois nao tem leitura possivel, e para esses a unica
    resposta honesta e recusar a gravacao inteira.
    """
    if not os.path.exists(caminho):
        return {}
    nome = os.path.basename(caminho)
    try:
        with io.open(caminho, encoding='utf-8-sig') as f:
            bruto = f.read()
    except OSError as e:
        raise ErroOdoo('nao consegui ler %s: %s' % (nome, e))
    # ARQUIVO VAZIO NAO E ARQUIVO CORROMPIDO. Recusar a gravacao so se justifica quando ha o
    # que perder; arquivo de 0 byte -- ou so espaco, ou so o BOM que o Bloco de Notas deixa ao
    # salvar um arquivo vazio -- nao guarda senha nenhuma. Travar a configuracao inteira com
    # 400 nele impedia justamente quem estava comecando do zero de sair do lugar.
    if not bruto.strip():
        return {}
    try:
        d = json.loads(bruto)
    except ValueError as e:
        raise ErroOdoo('%s esta corrompido e nao da para gravar por cima: %s. Arrume o JSON '
                       'do arquivo (ou apague o arquivo, se nao souber o que ha nele) no PC '
                       'do servidor e tente de novo -- gravar assim apagaria a senha que '
                       'estiver guardada la.' % (nome, e))
    if not isinstance(d, dict):
        raise ErroOdoo('%s nao tem um objeto JSON dentro (achei %s). Arrume o arquivo, ou '
                       'apague-o, antes de gravar por cima.' % (nome, type(d).__name__))
    return d


def config_ilegivel(raiz=RAIZ):
    """O arquivo existe e nao parseia? A tela pergunta isso ANTES de alguem tentar gravar.

    Sem isso o unico sinal seria o 400 depois do clique em Gravar -- e ate la a configuracao
    aparece em branco na tela, como se nunca tivesse sido preenchida.
    """
    try:
        _le_json_estrito(os.path.join(raiz, CFG_LISTA))
        return False
    except ErroOdoo:
        return True


def _norm_campo(chave, valor):
    """O valor FINAL do campo -- e e ele, nao o intermediario, que diz se o campo esta vazio.

    A url perde a barra do fim; uma url que era SO barras ('/', '//') fica VAZIA. Testar
    `v.strip()` e gravar `v.strip().rstrip('/')` fazia '/' passar pelo guard de "campo em
    branco nao apaga" e gravar url vazia -- e url vazia joga destino() no PADRAO, que e o
    servidor de TESTE 192.168.15.182. Medido: POST {"url": "/"} e a lista ia para o .182.
    """
    v = str(valor or '').strip()
    return v.rstrip('/') if chave == 'url' else v


def _booleano(v, nome):
    """As formas obvias de booleano; o resto e ErroOdoo, nunca um no-op silencioso.

    `apagarSenha: 1` respondia 200 e nao apagava nada: quem pediu a coisa destrutiva sai
    achando que ela aconteceu. Entre aceitar e recusar, o que nao pode e fingir.
    """
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    if isinstance(v, int) and v in (0, 1):
        return bool(v)
    if isinstance(v, str):
        t = v.strip().lower()
        if t in ('true', '1', 'sim', 'yes', 'on'):
            return True
        if t in ('', 'false', '0', 'nao', u'n\xe3o', 'no', 'off'):
            return False
    raise ErroOdoo('%s tem que ser verdadeiro ou falso (recebi %r)' % (nome, v))


def destino(raiz=RAIZ):
    """De onde sai cada pedaco da conexao. Ver a docstring do modulo."""
    lista = _le_json(os.path.join(raiz, CFG_LISTA))
    almox = _le_json(os.path.join(raiz, CFG_ALMOX))

    def campo(chave, env):
        for v in (os.environ.get(env), lista.get(chave), almox.get(chave), PADRAO.get(chave)):
            if not isinstance(v, str):
                continue
            v = _norm_campo(chave, v)      # o valor FINAL decide, ver _norm_campo
            if v:
                return v
        return ''

    senha, fonte = '', ''
    for v, f in ((os.environ.get('ODOO_LISTA_SENHA'), 'ODOO_LISTA_SENHA'),
                 (os.environ.get('ODOO_SENHA'), 'ODOO_SENHA'),
                 (lista.get('senha'), CFG_LISTA)):
        if isinstance(v, str) and v.strip():
            senha, fonte = v.strip(), f
            break
    return {'url': campo('url', 'ODOO_LISTA_URL'), 'db': campo('db', 'ODOO_LISTA_DB'),
            'login': campo('login', 'ODOO_LISTA_LOGIN'), 'modelo': campo('modelo', 'ODOO_LISTA_MODELO'),
            'senha': senha, 'fonteSenha': fonte}


def senha_no_arquivo(raiz=RAIZ):
    """Ha senha gravada em .hub-odoo.json? So isso — o valor nunca sai daqui.

    `fonteSenha` nao responde a pergunta quando o ambiente ganha: ele diz qual fonte VENCEU,
    e uma senha velha pode continuar no arquivo atras dela. A tela precisa da diferenca para
    nao oferecer um "apagar" que nao tem o que apagar, nem esconder um que teria.
    """
    v = _le_json(os.path.join(raiz, CFG_LISTA)).get('senha')
    # isinstance(str) e a MESMA regra do destino() logo acima, e tem que ser: com
    # {"senha": 12345} no arquivo, o str() daqui dizia senhaNoArquivo=True enquanto o
    # destino() dizia temSenha=False -- a tela anunciava "Senha gravada" e o envio recusava
    # por falta de senha, na mesma tela, ao mesmo tempo.
    return isinstance(v, str) and bool(v.strip())


def grava_destino(dados, raiz=RAIZ):
    """Escreve url/db/login/modelo/senha em .hub-odoo.json. So este arquivo recebe a senha.

    Campo ausente ou vazio NAO apaga o que ja estava: a tela abre com a senha em branco (ela
    nunca volta pela rede) e quem foi la so trocar a url nao pode perder a senha por isso. O
    mesmo vale para os outros campos -- apagar por string vazia e o bug 1.8 do almoxarifado
    (hubserver.py:596), e repeti-lo aqui custaria a senha. Para apagar de verdade existe
    `apagarSenha`, que e um pedido explicito e nao um descuido de formulario -- e que so
    aceita booleano (ou as formas obvias dele): `apagarSenha: 1` respondendo 200 sem apagar
    nada e um no-op silencioso sobre um pedido destrutivo.

    Arquivo ilegivel FAZ A GRAVACAO INTEIRA FALHAR (ErroOdoo, e nada e escrito). E a trava
    do caso mais caro desta frente: ler tolerante e escrever por cima apagava a senha em
    silencio, e a instrucao que o usuario recebia ate agora era justamente "grave o arquivo
    a mao" -- ou seja, o caminho provavel, nao o exotico.

    O temporario herda o ponto de CFG_LISTA (`.hub-odoo.json.tmp`) e isso NAO e detalhe: o
    _serve (hubserver.py:122) recusa por segmento comecado por ponto, e um `.tmp` sem ponto
    ficaria baixavel durante a escrita -- medido respondendo 200.
    """
    full = os.path.join(raiz, CFG_LISTA)
    cfg = _le_json_estrito(full)          # NAO o _le_json tolerante: ver a docstring acima
    apaga = _booleano(dados.get('apagarSenha'), 'apagarSenha')   # antes de escrever nada
    for k in ('url', 'db', 'login', 'modelo', 'senha'):
        v = dados.get(k)
        if not isinstance(v, str):
            continue
        v = _norm_campo(k, v)             # o guard testa o valor FINAL, ver _norm_campo
        if v:
            cfg[k] = v
    if apaga:
        cfg.pop('senha', None)
    tmp = full + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(cfg, ensure_ascii=False, indent=1))
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(full))
    return full


class _Transport(xmlrpc.client.Transport):
    """Timeout por conexao.

    odoo_pull.py:79 usa socket.setdefaulttimeout, que e global do PROCESSO: dentro do
    Flask do hubserver todo socket criado depois (inclusive os aceitos) herdaria o valor.
    """

    def __init__(self, timeout=TIMEOUT, **kw):
        xmlrpc.client.Transport.__init__(self, **kw)
        self._timeout = timeout

    def make_connection(self, host):
        c = xmlrpc.client.Transport.make_connection(self, host)
        c.timeout = self._timeout
        return c


class ClienteLista(object):
    """Os tres metodos de di.lista.altium. Nada mais — aprovar e ato humano (spec, 7.1)."""

    def __init__(self, cfg=None, timeout=TIMEOUT, raiz=RAIZ):
        cfg = cfg or destino(raiz)
        if not cfg.get('senha'):
            # a tela vem PRIMEIRO: e a unica das tres saidas que o projetista da bancada
            # consegue executar. Mandar editar %s a mao era o unico conselho aqui ate a aba
            # existir -- e, com a leitura tolerante de antes, era tambem como se perdia a
            # senha (ver _le_json_estrito).
            raise ErroOdoo('sem senha do Odoo: configure em Configuracao > Projeto > Envio '
                           'da lista para o Odoo (no PC do servidor), ou defina ODOO_SENHA '
                           'no ambiente do hub (no servidor, uma linha em '
                           '/etc/altiumhub/senha.env), ou grave %s na raiz do workspace'
                           % CFG_LISTA)
        if not cfg.get('url'):
            raise ErroOdoo('sem url do Odoo: defina ODOO_LISTA_URL no ambiente do hub, ou '
                           'grave "url" em %s (ou em hub-almox.json, de onde este envio a '
                           'herda). Nao existe servidor padrao de proposito — a bancada e a '
                           'producao falam com Odoos diferentes' % CFG_LISTA)
        if not (cfg.get('db') and cfg.get('login')):
            raise ErroOdoo('db e login do Odoo nao configurados')
        self.url, self.db, self.senha = cfg['url'], cfg['db'], cfg['senha']
        # o modelo vem da configuracao (base de teste pode ter outro nome); os METODOS nao
        self.modelo = cfg.get('modelo') or MODELO
        comum = xmlrpc.client.ServerProxy(self.url + '/xmlrpc/2/common',
                                          transport=_Transport(timeout), allow_none=True)
        try:
            self.uid = comum.authenticate(self.db, cfg['login'], self.senha, {})
        except (xmlrpc.client.Error, OSError, socket.timeout) as e:
            # xmlrpc.client.Error, e nao Fault: ProtocolError (um proxy no caminho, um 404, um
            # 500 do Odoo) NAO herda de OSError nem de Fault e subiria como erro 500 do Flask,
            # com pagina HTML onde a tela espera a frase do erro.
            raise ErroOdoo('nao consegui falar com %s: %s' % (self.url, e))
        if not self.uid:
            raise ErroOdoo('login recusado por %s (base %s, usuario %s)'
                           % (self.url, self.db, cfg['login']))
        self.models = xmlrpc.client.ServerProxy(self.url + '/xmlrpc/2/object',
                                                transport=_Transport(timeout), allow_none=True)

    def _chama(self, metodo, *args):
        try:
            return self.models.execute_kw(self.db, self.uid, self.senha, self.modelo,
                                          metodo, list(args))
        except xmlrpc.client.Fault as f:
            # O ValidationError do Odoo chega com o traceback inteiro; a ultima linha e a frase.
            msg = (f.faultString or '').strip().splitlines()
            raise ErroOdoo(msg[-1] if msg else 'o Odoo recusou a chamada')
        except (xmlrpc.client.Error, OSError, socket.timeout) as e:
            raise ErroOdoo('o Odoo nao respondeu: %s' % e)

    def confere(self, payload):
        return self._chama('di_confere_lista', payload)

    def envia(self, payload):
        return self._chama('di_recebe_lista', payload)

    def estado(self, uid):
        return self._chama('di_estado_lista', uid)


# ───────────────────────────── projeto no disco ─────────────────────────────

def pasta_projeto(nome, raiz=RAIZ):
    d = os.path.join(raiz, 'Projects', nome)
    if not os.path.isdir(d):
        raise ErroOdoo('projeto nao encontrado: %s' % nome)
    return d


def le_schematic(nome, raiz=RAIZ):
    caminho = os.path.join(pasta_projeto(nome, raiz), 'schematic.js')
    if not os.path.isfile(caminho):
        raise ErroOdoo('o projeto %s nao tem schematic.js' % nome)
    try:
        sch = le_var_js(caminho)
    except (OSError, ValueError) as e:
        raise ErroOdoo('nao consegui ler o schematic.js de %s: %s' % (nome, e))
    if not isinstance(sch, dict) or not isinstance(sch.get('items'), list):
        raise ErroOdoo('o schematic.js de %s nao esta no formato schmirror-v2 '
                       '(esperava um objeto com "items")' % nome)
    return sch


def le_recibo(nome, raiz=RAIZ):
    return _le_json(os.path.join(raiz, 'Projects', nome, RECIBO))


def grava_recibo(nome, dados, raiz=RAIZ):
    """Atomico, no molde de _bom_json_write (hubserver.py:714).

    Nenhuma credencial entra aqui: o arquivo fica dentro de Projects/ e o hubserver serve
    essa arvore por HTTP.
    """
    full = os.path.join(pasta_projeto(nome, raiz), RECIBO)
    tmp = full + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(dados, ensure_ascii=False, indent=1))
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(full))
    return full


# ───────────────────────────── componentes fora do esquema ─────────────────────────────
#
# Projects/<p>/lista-extras.json: pecas que vao na lista do Odoo sem estar no desenho (a
# cola, o dissipador, o parafuso, o conector que vem no chicote). Quem escreve e o hub, pelo
# modal "Enviar para o Odoo" (odoolista_server » /api/lista/extras); a IA nao edita.
#
#   {"format":"lista-extras-v1","atualizado":"AAAA-MM-DD HH:MM","proximo":N,"itens":[
#     {"id":1,"sym":..,"comment":..,"footprint":..,"params":..,"quantidade":4}]}
#
# O item tem o shape de um componente do schematic.js (mais a quantidade) para cair na MESMA
# cascata do resolve(); `id` e estavel e nunca reusado -- `proximo` so cresce, e e ele que da
# o 'EXTRA n' da linha.

QTD_MAX = 100000
TETO = {'sym': 200, 'comment': 200, 'footprint': 200, 'params': 2000}
CAMPOS_PECA = ('sym', 'comment', 'footprint', 'params')
_CONTROLE = re.compile(r'[\x00-\x1f\x7f]')
# Metade de um par surrogate, sozinha. O json.loads aceita o escape "\ud800", mas nenhum
# UTF-8 o escreve: passava pela validacao e estourava na GRAVACAO (UnicodeEncodeError), com
# 500 em HTML e o .tmp de 0 byte largado na pasta do projeto.
_SURROGATE = re.compile(u'[\ud800-\udfff]')
# Os dois nao-caracteres que o XML 1.0 recusa e o UTF-8 escreve sem reclamar. O
# xmlrpc.client.dumps os passa crus, e o expat do Odoo recusa o corpo INTEIRO: um extra com
# um deles derrubava todo ensaio e todo envio do projeto num 502 que nao nomeava a peca.
# Medido: de U+0080 a U+10FFFF, so estes dois quebram o ida-e-volta do xmlrpc.
_NAO_XML = re.compile(u'[\ufffe\uffff]')

# Ler-alterar-gravar de um arquivo so, que duas abas (ou dois cliques) mexem ao mesmo tempo.
# Sem a trava, as duas leem a mesma versao e a segunda gravacao apaga a primeira -- e, pior,
# as duas dao o MESMO id ao item novo. Mora aqui, e nao no Blueprint, para valer para
# qualquer um que chame altera_extras.
_EXTRAS_LOCK = threading.Lock()


class ExtraAusente(ErroOdoo):
    """O id pedido nao esta na lista: outra aba ja o tirou, ou nunca existiu. Vira 404."""


def _inteiro(v):
    """int de verdade: bool fora (True seria '1' sem ninguem ter digitado), float so se
    for inteiro (o JSON do navegador manda 4.0), texto so se for so digito."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and re.match(r'^\s*\d{1,9}\s*$', v):
        return int(v)
    return None


def valida_quantidade(v):
    q = _inteiro(v)
    if q is None:
        raise ErroOdoo('quantidade tem que ser um numero inteiro (recebi %r)' % (v,))
    if not 1 <= q <= QTD_MAX:
        raise ErroOdoo('quantidade tem que ir de 1 a %d (recebi %d)' % (QTD_MAX, q))
    return q


def _texto(campo, v, obrigatorio=False):
    if v is None:
        v = ''
    if not isinstance(v, str):
        raise ErroOdoo('%s tem que ser texto' % campo)
    v = v.strip()
    if obrigatorio and not v:
        raise ErroOdoo('%s nao pode ficar vazio' % campo)
    if len(v) > TETO[campo]:
        raise ErroOdoo('%s passa de %d caracteres' % (campo, TETO[campo]))
    if _CONTROLE.search(v):
        raise ErroOdoo('%s tem caractere de controle' % campo)
    if _SURROGATE.search(v):
        raise ErroOdoo('%s tem caractere que nao existe em UTF-8 (surrogate solto)' % campo)
    if _NAO_XML.search(v):
        raise ErroOdoo('%s tem caractere que o XML do Odoo nao aceita (U+FFFE/U+FFFF)' % campo)
    return v


def valida_peca(dados):
    """Os quatro campos da peca, SEMPRE juntos. `sym` e obrigatorio; os outros podem vir vazios.

    Juntos de proposito: a peca e um conjunto. Trocar so o `sym` de um extra e manter o
    `params` antigo deixaria o OdooId da peca velha decidindo o product_id (e o degrau 1 do
    resolve), com o nome da peca nova na tela -- uma quimera que resolve verde.
    """
    return {'sym': _texto('sym', dados.get('sym'), obrigatorio=True),
            'comment': _texto('comment', dados.get('comment')),
            'footprint': _texto('footprint', dados.get('footprint')),
            'params': _texto('params', dados.get('params'))}


def _defeito(nome, porque):
    """A frase do arquivo que nao da para ler. Nunca 'lista sem extras' calada: mandar sem as
    pecas avulsas seria mandar OUTRA lista, e ninguem veria a diferenca no envio."""
    return ('%s de %s esta com defeito (%s). A lista nao sai sem ele -- sem os componentes '
            'fora do esquema ela seria outra lista. Arrume o arquivo (ou apague-o, se esses '
            'componentes nao valem mais) e tente de novo.' % (EXTRAS, nome, porque))


def _carrega_extras(caminho, nome):
    """(proximo, itens) do disco. Ausente e vazio = nada, e nao e erro; o resto e estrito.

    Estrito como o _le_json_estrito, e pelo mesmo motivo: este arquivo e lido tambem por quem
    vai GRAVAR por cima (altera_extras). Ler um arquivo torto como vazio e gravar o item novo
    apagaria todos os outros -- e o envio seguinte mandaria a lista sem eles, calado.
    """
    if not os.path.isfile(caminho):
        return 1, []
    try:
        with io.open(caminho, encoding='utf-8-sig') as f:
            bruto = f.read()
    except UnicodeError as e:
        # gravado em ANSI (Set-Content do PowerShell 5.1, Bloco de Notas) ou em UTF-16: basta
        # um acento. UnicodeDecodeError e ValueError, nao OSError -- sem este ramo ele passava
        # direto e as rotas respondiam 500 em HTML, sem a frase que diz qual arquivo consertar
        raise ErroOdoo(_defeito(nome, 'o arquivo nao esta em UTF-8: %s' % e))
    except OSError as e:
        raise ErroOdoo('nao consegui ler %s de %s: %s' % (EXTRAS, nome, e))
    if not bruto.strip():
        return 1, []              # vazio nao guarda nada que se perca; ver _le_json_estrito
    try:
        d = json.loads(bruto)
    except ValueError as e:
        raise ErroOdoo(_defeito(nome, 'o JSON nao parseia: %s' % e))
    if not isinstance(d, dict) or not isinstance(d.get('itens'), list):
        raise ErroOdoo(_defeito(nome, 'esperava um objeto com "itens" em lista'))
    if d.get('format') not in (None, EXTRAS_FORMATO):
        raise ErroOdoo(_defeito(nome, 'formato %r, e este hub le %s'
                                % (d.get('format'), EXTRAS_FORMATO)))
    itens, vistos = [], set()
    for pos, it in enumerate(d['itens'], 1):
        if not isinstance(it, dict):
            raise ErroOdoo(_defeito(nome, 'o item %d nao e um objeto' % pos))
        n = it.get('id')
        if isinstance(n, bool) or not isinstance(n, int) or n < 1:
            raise ErroOdoo(_defeito(nome, 'o item %d nao tem id inteiro positivo' % pos))
        if n in vistos:
            raise ErroOdoo(_defeito(nome, 'o id %d aparece duas vezes' % n))
        vistos.add(n)
        try:
            peca = valida_peca(it)
            peca['quantidade'] = valida_quantidade(it.get('quantidade'))
        except ErroOdoo as e:
            raise ErroOdoo(_defeito(nome, '%s: %s' % (designador_extra(n), e)))
        peca['id'] = n
        itens.append(peca)
    itens.sort(key=lambda x: x['id'])
    minimo = max(vistos) + 1 if vistos else 1
    prox = d.get('proximo', minimo)
    if isinstance(prox, bool) or not isinstance(prox, int) or prox < 1:
        # um `proximo` torto nao se conserta com max(id)+1 calado: o item removido por ultimo
        # tinha o id seguinte, e ele voltaria como outra peca
        raise ErroOdoo(_defeito(nome, '"proximo" tem que ser inteiro positivo'))
    return max(prox, minimo), itens


def le_extras(nome, raiz=RAIZ):
    """Os componentes fora do esquema do projeto, em ordem de id. Sem arquivo = [].

    A leitura tambem passa pela trava, e por causa do Windows: o os.replace falha com
    WinError 32 se outro handle estiver com o arquivo aberto, e a previa de uma aba lendo
    no instante da gravacao de outra fazia o clique de quem gravava voltar como erro 500.
    """
    with _EXTRAS_LOCK:
        return _carrega_extras(os.path.join(raiz, 'Projects', nome, EXTRAS), nome)[1]


def _grava_extras(nome, proximo, itens, raiz):
    """Atomico, no molde de grava_recibo. So os campos do contrato atravessam."""
    full = os.path.join(pasta_projeto(nome, raiz), EXTRAS)
    dados = {'format': EXTRAS_FORMATO, 'atualizado': _agora(), 'proximo': proximo,
             'itens': [{k: it[k] for k in ('id',) + CAMPOS_PECA + ('quantidade',)}
                       for it in sorted(itens, key=lambda x: x['id'])]}
    tmp = full + '.tmp'
    try:
        with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(dados, ensure_ascii=False, indent=1))
        # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
        os.replace(tmp, os.path.realpath(full))
    except (OSError, ValueError):
        # no Windows basta um antivirus segurando o destino; o .tmp que sobrasse seria lido
        # por ninguem, mas ficaria no projeto (e no git status) ate alguem apagar a mao. O
        # ValueError junto: um texto que o UTF-8 nao escreve estoura no f.write, e nao no
        # disco (o _texto ja o recusa antes; isto e para quem chamar sem passar por ele)
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    return full


def altera_extras(nome, op, dados, raiz=RAIZ):
    """add / update / remove, sob a trava. Devolve (itens, id do item tocado).

      add     dados['item'] = {sym, comment, footprint, params, quantidade}
      update  dados['id'] + quantidade e/ou a peca (os quatro campos: ver valida_peca)
      remove  dados['id']

    Tudo e validado ANTES de escrever; qualquer ErroOdoo sai sem tocar no arquivo.
    """
    with _EXTRAS_LOCK:
        caminho = os.path.join(pasta_projeto(nome, raiz), EXTRAS)
        proximo, itens = _carrega_extras(caminho, nome)
        if op == 'add':
            item = dados.get('item')
            if not isinstance(item, dict):
                raise ErroOdoo('faltou o componente (item) a adicionar')
            novo = valida_peca(item)
            novo['quantidade'] = valida_quantidade(item.get('quantidade'))
            novo['id'] = n = proximo
            itens.append(novo)
            proximo += 1
        elif op in ('update', 'remove'):
            n = _inteiro(dados.get('id'))
            if n is None or n < 1:
                raise ErroOdoo('id tem que ser o numero do componente fora do esquema')
            alvo = next((it for it in itens if it['id'] == n), None)
            if alvo is None:
                raise ExtraAusente('%s nao esta mais na lista (outra aba pode te-lo tirado)'
                                   % designador_extra(n))
            if op == 'remove':
                itens.remove(alvo)
            else:
                muda = {}
                if 'quantidade' in dados:
                    muda['quantidade'] = valida_quantidade(dados.get('quantidade'))
                if any(k in dados for k in CAMPOS_PECA):
                    muda.update(valida_peca(dados))
                if not muda:
                    raise ErroOdoo('nada para mudar: mande a quantidade ou a peca')
                alvo.update(muda)
        else:
            raise ErroOdoo('op tem que ser add, update ou remove (recebi %r)' % (op,))
        _grava_extras(nome, proximo, itens, raiz)
        return itens, n


def recibo_para_disco(payload, recibo, enviado_em):
    """O que vale guardar do envio: tudo recuperavel de volta por di_estado_lista."""
    return {
        'uid_externo': payload.get('uid_externo', ''),
        'projeto': payload.get('projeto', ''),
        'revisao': payload.get('revisao', ''),
        'id': recibo.get('id'),
        'referencia': recibo.get('referencia', ''),
        'estado': recibo.get('estado', ''),
        'enviado_em': enviado_em,
        'enviado_por': payload.get('enviado_por', ''),
        'total_linhas': recibo.get('total_linhas', 0),
        'linhas_pendentes': recibo.get('linhas_pendentes', 0),
        'pendencias': recibo.get('pendencias') or [],
        'produto_id': recibo.get('produto_id', False),
        'bom_id': recibo.get('bom_id', False),
        'motivo_recusa': recibo.get('motivo_recusa', ''),
    }


# ───────────────────────────── linha de comando ─────────────────────────────

def _agora():
    import time
    return time.strftime('%Y-%m-%d %H:%M')


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description='Envia a lista de componentes do projeto para o Odoo')
    ap.add_argument('--projeto', required=True, help='nome da pasta em Projects/')
    ap.add_argument('--revisao', default='', help='revisao da placa; entra no nome no Odoo')
    ap.add_argument('--enviado-por', default=os.environ.get('USERNAME') or '')
    ap.add_argument('--observacao', default='')
    ap.add_argument('--aplicar', action='store_true', help='envia de verdade (sem isso e ensaio)')
    ap.add_argument('--estado', action='store_true', help='so consulta em que pe esta o envio')
    args = ap.parse_args(argv)

    try:
        # A revisao e a que foi DIGITADA, e mais nada. O `or parse_revisao(...)` que estava
        # aqui era o proprio default silencioso que a mensagem abaixo dele condenava: medido,
        # `--aplicar` sem `--revisao` num "DMB - DI231765_P2" abria a solicitacao como rev
        # "P2" sem avisar ninguem — e "_P2" naquela pasta e variante, nao revisao. A propria
        # docstring de parse_revisao diz "So SUGERE — nunca decide"; agora e verdade.
        # Vazia e uma escolha legitima desde 2026-09-17: quem quer o palpite passa --revisao.
        rev = norm_rev(args.revisao)
        if args.estado:
            uid = uid_externo(args.projeto, rev)
            print(json.dumps(ClienteLista().estado(uid), ensure_ascii=False, indent=1))
            return 0

        payload = monta_payload(args.projeto, rev, le_schematic(args.projeto),
                                carrega_acervo(), args.enviado_por, args.observacao,
                                extras=le_extras(args.projeto))
        if not payload['linhas']:
            raise ErroOdoo('o esquema de %s nao tem componente nenhum, e nao ha componente '
                           'fora do esquema em %s' % (args.projeto, EXTRAS))
        for ref in payload['_sem_designador']:
            print('  ! fora da lista, sem designador anotado: %s' % ref)
        if payload['_extras']:
            print('  + %d componente(s) fora do esquema, de %s' % (payload['_extras'], EXTRAS))

        cliente = ClienteLista()
        limpo = payload_limpo(payload)
        recibo = cliente.envia(limpo) if args.aplicar else cliente.confere(limpo)
        print('%s  %s  %d linha(s), %d pendente(s)'
              % (recibo.get('referencia') or '(ensaio)', recibo.get('estado', '?'),
                 recibo.get('total_linhas', 0), recibo.get('linhas_pendentes', 0)))
        for p in recibo.get('pendencias') or []:
            print('  %-16s %-44s %s' % (p.get('designadores', ''),
                                        (p.get('nome_altium') or '')[:44], p.get('motivo', '')))
        if recibo.get('motivo_recusa'):
            print('  recusada: %s' % recibo['motivo_recusa'])
        if args.aplicar:
            print('  recibo em %s' % grava_recibo(
                args.projeto, recibo_para_disco(limpo, recibo, _agora())))
        else:
            print('  ensaio: nada foi gravado. Repita com --aplicar para enviar.')
        return 0
    except ErroOdoo as e:
        sys.stderr.write('%s\n' % e)
        return 1


if __name__ == '__main__':
    sys.exit(main())
