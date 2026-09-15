# -*- coding: utf-8 -*-
"""Puxa o almoxarifado do Odoo por XML-RPC e atualiza componentes_odoo.csv.

    python tools/almox/odoo_pull.py            # incremental: só o que mudou
    python tools/almox/odoo_pull.py --full     # relê o catálogo inteiro

**Incremental por padrão.** O próprio CSV é o estado: cada linha guarda o `write_date`
do produto, então uma sincronização normal:

  1. faz o *censo* — id, template e `write_date` de todo produto ativo (uma chamada, três
     campos por produto). É o que detecta o que é NOVO e o que foi arquivado;
  2. baixa a ficha completa **só** dos produtos novos ou alterados (e dos que tiveram
     mudança no template ou no fornecedor desde a última vez);
  3. relê **saldo e localização de todo mundo** num `read_group` só — isso muda o tempo
     todo e é barato agrupado (antes eram ~10 mil linhas de `stock.quant`, uma a uma);
  4. escreve o CSV com as linhas antigas preservadas, as alteradas trocadas, as novas
     acrescentadas e as arquivadas removidas.

Numa semana calma isso são ~4.500 registros minúsculos do censo e um punhado de fichas,
em vez das cinco varreduras completas que o `--full` faz.

Credenciais: `hub-almox.json` na raiz do workspace (fora do git), no formato
    {"url": "http://<ip-do-odoo>:8070", "db": "odoo_db",
     "login": "voce@empresa.com", "senha": "..."}
A senha também pode vir da variável de ambiente ODOO_SENHA, que ganha do arquivo.

**Não há URL padrão de propósito.** Cada máquina diz com qual Odoo fala: a bancada
aponta para o servidor de teste, o hub do servidor aponta para o de produção. Enquanto
havia um default cravado aqui, uma máquina sem `hub-almox.json` — ou com a url em branco
— sincronizava do ERP errado sem uma linha de aviso. Agora falta de url é erro alto.
"""
import argparse, csv, io, json, os, socket, sys, xmlrpc.client

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
CFG = os.path.join(RAIZ, 'hub-almox.json')
CSV_OUT = os.path.join(BASE, 'componentes_odoo.csv')

# O Odoo da casa e UM so: 192.168.15.192:8070, base odoo_db. Isso deixou de ser "um padrao
# entre varios" e passou a ser o endereco da empresa, por decisao do usuario em 2026-09-15 —
# a unica coisa que muda de maquina para maquina e a CREDENCIAL.
#
# Nao e a volta do defeito 1.8: la o padrao cravado era o servidor de TESTE, e uma maquina
# mal configurada sincronizava do ERP errado em silencio. Apontar para o servidor de verdade
# inverte isso — errar a configuracao agora leva ao lugar certo, nao ao errado. O guarda de
# url vazia (SemUrl) fica de pe para quem chamar a classe direto, e `hub-almox.json`
# continua ganhando do padrao: e assim que a bancada segue falando com o .182 de teste.
PADRAO = {'url': 'http://192.168.15.192:8070', 'db': 'odoo_db',
          'login': 'lucas.ferreira@dieletrons.com', 'senha': ''}
ALMOX = 'DI/Almoxarifado'
TIMEOUT = 60.0                 # Odoo mudo nao pode prender a sincronizacao para sempre

# A ordem do dump SQL original, mais o write_date que faz o CSV ser o proprio estado.
COLUNAS = ['product_id', 'template_id', 'localizacao_codigo', 'nome', 'categoria', 'unidade',
           'qtd_almoxarifado', 'qtd_total_interna', 'locais_estoque', 'barcode', 'custo',
           'preco_venda', 'fornecedor_partnumber', 'menor_preco_compra', 'estocavel', 'tipo',
           'write_date']

CAMPOS_PROD = ['id', 'product_tmpl_id', 'barcode', 'standard_price', 'default_code', 'write_date']
CAMPOS_TMPL = ['id', 'name', 'categ_id', 'uom_id', 'list_price', 'type', 'default_code']


def le_config():
    cfg = dict(PADRAO)
    try:
        with io.open(CFG, encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict):
            for k in PADRAO:
                if isinstance(d.get(k), str) and d[k].strip():
                    cfg[k] = d[k].strip()
    except (OSError, ValueError):
        pass
    if os.environ.get('ODOO_SENHA'):
        cfg['senha'] = os.environ['ODOO_SENHA']
    cfg['url'] = norm_url(cfg['url'])   # '/' gravado pela tela nao e uma url
    return cfg


def le_csv(caminho=CSV_OUT):
    """As linhas da última puxada — o estado contra o qual o censo é comparado."""
    if not os.path.exists(caminho):
        return []
    try:
        with io.open(caminho, encoding='utf-8') as f:
            return [dict(r) for r in csv.DictReader(f)]
    except OSError:
        return []


def norm_url(v):
    """A url como o resto do modulo quer ve-la: sem espaco em volta e sem barra no fim.

    '/' e '   /   ' viram string VAZIA, e nao uma url de um caractere. Sem isso a barra
    solta -- que a tela grava com um toque de teclado -- passava pelo guarda de "esta
    vazia?" e so estourava la na frente, no ServerProxy, com um erro que nao diz nada.
    O odoolista ja normaliza assim (`_norm_campo`); aqui era a metade que faltava.
    """
    return (v or '').strip().rstrip('/').strip()


class LoginRecusado(RuntimeError):
    """O Odoo respondeu, mas recusou usuario/senha/base.

    Era `SystemExit`, e isso derrubava a tela inteira: SystemExit herda de BaseException,
    entao atravessava o `except Exception` do odoobom_server, a thread do Flask morria sem
    escrever resposta nenhuma, e o navegador mostrava "sem resposta do servidor: Failed to
    fetch". O usuario lia ERRO DE REDE onde havia LOGIN ERRADO — e ia procurar defeito em
    firewall, porta e container. Medido com o `SEU_LOGIN` que o INSTALL deixa de exemplo.
    Pendencia 2.2 do tools/deploy/PENDENCIAS.md.
    """


class SemUrl(RuntimeError):
    """Nao ha Odoo configurado nesta maquina.

    RuntimeError, e nao SystemExit: quem chama pelo hub (odoobom_server, almox2lib) tem
    `except Exception` e transforma isso na mensagem da tela. SystemExit herda de
    BaseException e passaria batido por esses guardas, derrubando a requisicao inteira.
    """


class Odoo(object):
    def __init__(self, url, db, login, senha):
        url = norm_url(url)
        if not url:
            raise SemUrl('sem url do Odoo: grave "url" em hub-almox.json na raiz do '
                         'workspace (no servidor, /srv/altiumhub/shared/hub-almox.json). '
                         'Nao existe servidor padrao — a bancada e a producao falam com '
                         'Odoos diferentes, e adivinhar erraria em silencio.')
        self.db, self.senha = db, senha
        socket.setdefaulttimeout(TIMEOUT)
        common = xmlrpc.client.ServerProxy(url.rstrip('/') + '/xmlrpc/2/common', allow_none=True)
        self.uid = common.authenticate(db, login, senha, {})
        if not self.uid:
            raise LoginRecusado('login recusado pelo Odoo — confira usuario e senha em '
                                'hub-almox.json (base "%s", servidor %s)' % (db, url))
        self.models = xmlrpc.client.ServerProxy(url.rstrip('/') + '/xmlrpc/2/object', allow_none=True)

    def call(self, modelo, metodo, args, kw=None):
        return self.models.execute_kw(self.db, self.uid, self.senha, modelo, metodo, args, kw or {})

    def busca(self, modelo, dominio, campos, passo=2000):
        """search_read paginado."""
        fora, off = [], 0
        while True:
            lote = self.call(modelo, 'search_read', [dominio, campos],
                             {'offset': off, 'limit': passo})
            fora.extend(lote)
            if len(lote) < passo:
                return fora
            off += passo

    def ler(self, modelo, ids, campos, passo=500):
        fora = []
        ids = list(ids)
        for i in range(0, len(ids), passo):
            fora.extend(self.call(modelo, 'read', [ids[i:i + passo], campos]))
        return fora

    def ids(self, modelo, dominio):
        return self.call(modelo, 'search', [dominio])


def _m2o(v):
    """campo many2one do XML-RPC: [id, 'nome'] ou False"""
    return (v[0], v[1]) if isinstance(v, (list, tuple)) and len(v) == 2 else (None, '')


def _saldos(o, log):
    """Saldo e localização de TODO produto, em duas chamadas.

    `read_group` por (produto, local) resolve de uma vez o saldo no almoxarifado, o total
    interno e em que prateleiras o item está — é a parte que precisa estar fresca sempre,
    porque estoque muda sem ninguém tocar no cadastro do produto."""
    locais = o.busca('stock.location', [('usage', '=', 'internal')], ['id', 'complete_name'])
    nome = {l['id']: l['complete_name'] for l in locais}
    grupos = o.call('stock.quant', 'read_group',
                    [[('location_id', 'in', list(nome.keys()))], ['quantity:sum'],
                     ['product_id', 'location_id']], {'lazy': False})
    log('  %d locais internos, %d pares produto/local' % (len(locais), len(grupos)))

    almox, interno, onde = {}, {}, {}
    for g in grupos:
        pid = _m2o(g.get('product_id'))[0]
        lid = _m2o(g.get('location_id'))[0]
        if pid is None or lid is None:
            continue
        qtd = g.get('quantity') or 0.0
        interno[pid] = interno.get(pid, 0.0) + qtd
        if nome.get(lid) == ALMOX:
            almox[pid] = almox.get(pid, 0.0) + qtd
        if qtd:
            onde.setdefault(pid, set()).add(nome.get(lid, ''))
    return almox, interno, onde


def _linha(p, t, forn, menor):
    """Uma linha do CSV a partir da ficha do produto + do seu template."""
    pid, tid = p['id'], _m2o(p.get('product_tmpl_id'))[0]
    return {
        'product_id': pid,
        'template_id': tid,
        # o codigo interno do Odoo guarda, na pratica, o endereco na prateleira
        'localizacao_codigo': t.get('default_code') or p.get('default_code') or '',
        'nome': t.get('name') or '',
        'categoria': _m2o(t.get('categ_id'))[1],
        'unidade': _m2o(t.get('uom_id'))[1],
        'qtd_almoxarifado': 0.0, 'qtd_total_interna': 0.0, 'locais_estoque': '',
        'barcode': p.get('barcode') or '',
        'custo': p.get('standard_price') or '',
        'preco_venda': t.get('list_price') or '',
        'fornecedor_partnumber': ' | '.join(sorted(forn.get(tid, ()))),
        'menor_preco_compra': menor.get(tid, ''),
        'estocavel': 'true' if t.get('type') in ('product', 'consu') else 'false',
        'tipo': t.get('type') or '',
        'write_date': p.get('write_date') or '',
    }


def _fichas(o, pids, log):
    """Ficha completa dos produtos pedidos: variante + template + fornecedores."""
    if not pids:
        return {}
    prods = o.ler('product.product', pids, CAMPOS_PROD)
    tids = sorted({_m2o(p.get('product_tmpl_id'))[0] for p in prods} - {None})
    tmpls = {t['id']: t for t in o.ler('product.template', tids, CAMPOS_TMPL)}
    forn, menor = {}, {}
    for f in o.busca('product.supplierinfo',
                     [('product_tmpl_id', 'in', tids), ('product_code', '!=', False)],
                     ['product_tmpl_id', 'partner_id', 'product_code', 'price']):
        tid = _m2o(f.get('product_tmpl_id'))[0]
        cod = (f.get('product_code') or '').strip()
        if tid is None or not cod:
            continue
        forn.setdefault(tid, set()).add('%s:%s' % (_m2o(f.get('partner_id'))[1], cod))
        pr = f.get('price')
        if isinstance(pr, (int, float)) and (tid not in menor or pr < menor[tid]):
            menor[tid] = pr
    log('  %d fichas, %d modelos, %d fornecedores' % (len(prods), len(tmpls), len(forn)))
    return {p['id']: _linha(p, tmpls.get(_m2o(p.get('product_tmpl_id'))[0], {}), forn, menor)
            for p in prods if _m2o(p.get('product_tmpl_id'))[0] in tmpls}


def puxa(cfg, anteriores=None, log=print):
    """Devolve (linhas, stats). Com `anteriores`, só busca o que mudou."""
    o = Odoo(cfg['url'], cfg['db'], cfg['login'], cfg['senha'])

    # o que já temos, indexado pelo id da variante
    antes = {}
    for r in (anteriores or []):
        try:
            antes[int(r['product_id'])] = r
        except (KeyError, TypeError, ValueError):
            pass
    # CSV sem write_date (veio do dump SQL) nao sustenta comparacao: cai no completo
    incremental = bool(antes) and any((r.get('write_date') or '') for r in antes.values())

    log('censo de produtos ativos...')
    censo = o.busca('product.product', [('active', '=', True)],
                    ['id', 'product_tmpl_id', 'write_date'])
    vistos = {p['id'] for p in censo}
    log('  %d produtos ativos no Odoo' % len(censo))

    if incremental:
        novos = [p['id'] for p in censo if p['id'] not in antes]
        mudados = [p['id'] for p in censo
                   if p['id'] in antes and (p.get('write_date') or '') != (antes[p['id']].get('write_date') or '')]
        sumiram = [pid for pid in antes if pid not in vistos]

        # template e fornecedor mudam sem tocar no write_date da variante
        ultima = max((r.get('write_date') or '') for r in antes.values())
        extras = set()
        if ultima:
            tocados = set(o.ids('product.template', [('write_date', '>', ultima)]))
            for f in o.busca('product.supplierinfo', [('write_date', '>', ultima)],
                             ['product_tmpl_id']):
                tid = _m2o(f.get('product_tmpl_id'))[0]
                if tid is not None:
                    tocados.add(tid)
            if tocados:
                extras = {p['id'] for p in censo
                          if _m2o(p.get('product_tmpl_id'))[0] in tocados and p['id'] in antes}
        alvo = sorted(set(novos) | set(mudados) | extras)
        log('novidades: %d novo(s), %d alterado(s), %d arquivado(s)'
            % (len(novos), len(mudados + list(extras)), len(sumiram)))
    else:
        novos, mudados, sumiram, alvo = list(vistos), [], [], sorted(vistos)
        log('primeira puxada (ou CSV sem write_date): lendo o catalogo inteiro')

    log('lendo fichas dos produtos %s...' % ('novos e alterados' if incremental else 'ativos'))
    fichas = _fichas(o, alvo, log)

    log('lendo saldos e localizacoes...')
    almox, interno, onde = _saldos(o, log)

    # monta o CSV: preserva o que nao mudou, troca o que mudou, tira o que foi arquivado
    linhas = []
    for p in censo:
        pid = p['id']
        r = fichas.get(pid) or antes.get(pid)
        if r is None:
            continue                        # alterado mas sem template legivel
        r = dict(r)
        # saldo e prateleira sao reescritos SEMPRE: mudam sem passar pelo cadastro
        r['qtd_almoxarifado'] = almox.get(pid, 0.0)
        r['qtd_total_interna'] = interno.get(pid, 0.0)
        r['locais_estoque'] = ' | '.join(sorted(x for x in onde.get(pid, ()) if x))
        r['write_date'] = p.get('write_date') or r.get('write_date') or ''
        linhas.append(r)

    linhas.sort(key=lambda r: (str(r.get('categoria') or ''), str(r.get('nome') or '')))
    stats = {'incremental': incremental, 'ativos': len(censo), 'total': len(linhas),
             'novos': len(novos), 'alterados': len(mudados) + (len(alvo) - len(novos) - len(mudados)),
             'sumiram': len(sumiram), 'fichas': len(fichas),
             'comSaldo': sum(1 for r in linhas if float(r['qtd_almoxarifado'] or 0) > 0)}
    return linhas, stats


def grava(linhas, destino=CSV_OUT):
    tmp = destino + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUNAS, extrasaction='ignore')
        w.writeheader()
        for r in linhas:
            w.writerow({k: r.get(k, '') for k in COLUNAS})
    os.replace(tmp, destino)
    return destino


def main(argv=None):
    ap = argparse.ArgumentParser(description='Puxa o almoxarifado do Odoo por XML-RPC')
    ap.add_argument('--url'); ap.add_argument('--db')
    ap.add_argument('--login'); ap.add_argument('--senha')
    ap.add_argument('--out', default=CSV_OUT)
    ap.add_argument('--full', action='store_true', help='rele o catalogo inteiro')
    a = ap.parse_args(argv)

    cfg = le_config()
    for k in ('url', 'db', 'login', 'senha'):
        if getattr(a, k):
            cfg[k] = getattr(a, k)
    if not cfg['url']:
        raise SystemExit('sem url do Odoo: use --url ou grave "url" em hub-almox.json na '
                         'raiz do workspace')
    if not cfg['senha']:
        raise SystemExit('sem senha do Odoo: use --senha, a variavel ODOO_SENHA, '
                         'ou grave hub-almox.json na raiz do workspace')

    # A CLI mostra uma linha, nao uma pilha: SemUrl e LoginRecusado sao RuntimeError para
    # quem chama pelo hub poder captura-las com `except Exception` (ver as classes la em
    # cima), e e aqui que elas voltam a ser saida de programa.
    try:
        linhas, st = puxa(cfg, None if a.full else le_csv(a.out))
    except (SemUrl, LoginRecusado) as e:
        raise SystemExit(str(e))
    grava(linhas, a.out)
    print('%d produtos em %s (%d novo(s), %d alterado(s), %d arquivado(s))'
          % (st['total'], a.out, st['novos'], st['alterados'], st['sumiram']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
