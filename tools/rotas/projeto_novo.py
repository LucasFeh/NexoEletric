# -*- coding: utf-8 -*-
"""Rotas /api/projeto/novo*: o "Novo projeto" do hub, com o codigo de produto da DIEletrons.

Pedido do dono (2026-11-04): "toda placa nova precisa ser registrada em CATALOGACAO TODOS OS PRODUTOS ...
toda PCB nova segue a regra codigo do projeto e acrescenta um P na frente de placa, mais o ano DI(ano)(numero do
produto no excel) ... toda vez que for criar um projeto novo, gere o codigo, adiciona no template, e pergunta o nome
de quem iniciou o projeto pra por no template".

O trabalho do catalogo e do mcp/lib/catalogo.js (o MESMO motor do projeto_criar do MCP), rodado como
`node mcp/lib/catalogo.js --cli`, com o Node que o envio a JLC usa (jlc.acha_node). O projeto nasce com uma folha
A4 no template da casa (casa:A4_DiEletrons) e o quadro de titulo preenchido nos parametros do projeto (cabecalho do
schematic.js): codigo da placa, arquivo SCH-DI.., nome, quem iniciou e a data.

Rotas:
  GET  /api/projeto/novo/previa?nome=&sigla=&tipo=  -> {ok, proximo, ano, sigla, codigo, ultimo, arquivo}
  GET  /api/catalogo                           -> {ok, itens:[{item, tipo, grupo, nome, cliente, modelo, vinculo, fila?}],
       categorias, proximo, ano, fila:{ligada, pendentes, conflitos, travada, copia, gravando}}
       1.89.0 (pedido do dono, 2026-11-09: "sistemas, cabos, acessorios, softwares podem sair, deixa so placa, codigo de
       placa errado e equipamento no definir"): so PLACAS e EQUIPAMENTOS (os outros continuam na planilha, so nao vem).
  POST /api/catalogo/registrar {tipo: PLACA|EQUIPAMENTO, nome, cliente?, vinculo?, sigla?}
       -> {ok, item, codigo, ..., pendente, fila:{id, estado, erro}} (409: codigo ou nome repetido)
  POST /api/catalogo/editar {item, codigo, nome?, tipo?, novoCodigo?, novoNome?, novoGrupo?}
       -> {ok, item, codigo, nome, tipo, grupo, pendente, fila} (409: codigo repetido, placa sem o P, ou outra pessoa
       mudou antes -- conflito; novoGrupo = placa|equipamento, grava na coluna TIPO)
  1.89.0 (pedido do dono: "hoje nao ta deixando editar se o excel tiver sendo usado, isso n pode acontecer, tem que ser
  assincrono, mais de uma pessoa pode editar ao mesmo tempo"): cadastrar e editar passam pela FILA DO CATALOGO no NexoBD
  (mcp/lib/catalogo-fila.js): respondem na hora, a lista ja mostra o valor novo ("aguardando gravar na planilha") e o
  GRAVADOR grava quando a planilha estiver livre -- uma maquina por vez (a trava fica na propria fila): no app, o
  electron/lib/gravador-catalogo.js (a cada 45 s; NEXO_GRAVADOR=0 desliga, NEXO_GRAVADOR_S troca o intervalo); o
  hubserver rodado direto (o servidor da rede) liga o inicia_gravador daqui no __main__.
  GET  /api/catalogo/fila                      -> {ok, ligada, pendentes, conflitos, trava, ops:[...]}
  POST /api/catalogo/fila/resolver {id, como: descartar|tentar|por-cima}  -> {ok, ...}
  POST /api/catalogo/fila/gravar               -> {ok, gravados|travada|nada|ocupado}
  GET  /api/projeto/novo/catalogo?codigo=      -> {ok, achou:{item, nome, cliente, modelo, ...}|null}
  GET  /api/projeto/novo/templates             -> {ok, padrao, templates:[{id, nome, w, h, estilo}]} (os da casa)
  POST /api/projeto/novo {nome, cliente?, vinculo?, sigla?, iniciador?, projeto?, template? ('' = sem template)}
       O desenhista e QUEM ESTA LOGADO no Nexo Hub (tools/rotas/equipe.py; 2026-11-05: "se voce iniciar um projeto, seu
       nome fica como desenhista"), que tambem vira o responsavel pelo projeto (Projects/<p>/equipe.json); o `iniciador`
       so vale com o Hub sem login (antigo). Ate a 1.83.0 era o carimbo em uso, que saiu.
       -> {ok, id, name, codigo, item, linha}: registra no catalogo e cria Projects/<projeto ou codigo>/
"""
import json
import os
import subprocess
import time

from flask import request

TEMPLATE = 'casa:A4_DiEletrons'
A4 = (11692.913, 8267.717)           # a folha do template da casa (o A4 ISO de verdade)


def _motor(root, entrada):
    import jlc
    node, extra = jlc.acha_node()
    if node is None:
        raise RuntimeError(extra)
    env = dict(os.environ)
    env.update(extra)
    p = subprocess.run(node + [os.path.join(root, 'mcp', 'lib', 'catalogo.js'), '--cli'],
                       input=json.dumps(entrada).encode('utf-8'), capture_output=True, env=env, cwd=root,
                       timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    linhas = [l for l in p.stdout.decode('utf-8', 'replace').splitlines() if l.strip()]
    if not linhas:
        raise RuntimeError('o motor do catalogo nao respondeu (%s)' % p.stderr.decode('utf-8', 'replace')[-400:].strip())
    r = json.loads(linhas[-1])
    if not r.get('ok'):
        e = RuntimeError(r.get('erro') or 'o catalogo recusou')
        e.conflito = bool(r.get('conflito'))
        raise e
    return r


# 1.89.0: o Definir projeto so mostra e so cadastra placas e equipamentos
GRUPOS_DEFINIR = ('placa', 'equipamento')
TIPOS_DEFINIR = ('PLACA', 'EQUIPAMENTO')


def _por():
    """quem esta logado no Nexo Hub (vai na fila do catalogo: a tela mostra quem cadastrou)"""
    try:
        import equipe as _eq
        u = _eq.sessao()['usuario']
        return {'nome': u.get('nome', ''), 'login': u.get('login', '')} if u else {}
    except Exception:                      # noqa: BLE001
        return {}


def so_definir(r):
    """a lista do motor so com placas e equipamentos (o Definir projeto e as variantes)"""
    r['itens'] = [i for i in r.get('itens') or [] if i.get('grupo') in GRUPOS_DEFINIR]
    r['categorias'] = [c for c in r.get('categorias') or [] if c.get('id') in GRUPOS_DEFINIR]
    return r


_gravador = {'thread': None}


def gravador_ligado():
    if os.environ.get('NEXO_GRAVADOR') == '0' or os.environ.get('NEXO_FILA') == '0':
        return False
    # catalogo de teste sem NexoBD de teste: a fila fica desligada (catalogo-fila.js >> desligada)
    return not (os.environ.get('NEXO_CATALOGO') and not os.environ.get('NEXOHUB_URL'))


def inicia_gravador(root):
    """o gravador da fila do catalogo: a cada NEXO_GRAVADOR_S (45) s grava o que esta na fila (de qualquer maquina), se a
    planilha estiver livre. Uma linha de execucao por processo; quem grava de fato decide o motor (a trava na fila)."""
    import threading
    if _gravador['thread'] is not None or not gravador_ligado():
        return
    try:
        periodo = max(3.0, float(os.environ.get('NEXO_GRAVADOR_S') or 45))
    except ValueError:
        periodo = 45.0

    def roda():
        time.sleep(min(periodo, 15.0))
        while True:
            try:
                r = _motor(root, {'acao': 'fila-gravar'})
                if r.get('gravados') or r.get('conflitos'):
                    print('[catalogo] fila gravada na planilha: %s gravado(s), %s conflito(s)'
                          % (r.get('gravados') or 0, r.get('conflitos') or 0), flush=True)
            except Exception as e:         # noqa: BLE001 -- tenta de novo na proxima
                print('[catalogo] gravador: %s' % e, flush=True)
            time.sleep(periodo)

    t = threading.Thread(target=roda, name='catalogo-gravador', daemon=True)
    _gravador['thread'] = t
    t.start()


def _status_erro(msg, conflito=False):
    """409 = e do pedido (repetido, placa sem P, outra pessoa mudou antes); 503 = o catalogo/o motor"""
    if conflito:
        return 409
    for t in ('já está no catálogo', 'começar com "P"', 'sigla', 'já é do item', 'inválido', 'vazio', 'categoria',
              'nada para mudar', 'já é dessa'):
        if t in msg:
            return 409
    return 503


def _limpa_param(v):
    """o campo plano K=V;K=V do schematic.js: sem ; nem | no valor, e sem a sequencia aspas-dois-pontos"""
    return str(v).replace(';', ',').replace('|', '/').replace('":', '" :').strip()


def nome_da_folha(codigo):
    """a folha do projeto novo: SCH-DI261944 (o Arquivo do carimbo e o nome da folha)"""
    return 'SCH-' + (codigo.split('-', 1)[1].replace(' ', '') if '-' in codigo else codigo)


def params_template(codigo, nome, iniciador, cliente='', data=None):
    """os campos do carimbo A4_DiEletrons para o projeto novo (o mesmo do catalogo.js » paramsTemplate): o codigo da
    placa, o desenhista e a data; o equipamento vem do Definir projeto (2026-11-05)"""
    t = data or time.localtime()
    p = {'CodigoDaPlaca': codigo,
         # 1.88.0: o nome da PCB (o do catalogo, sem limite) da o nome do projeto na arvore; nao vai ao quadro
         'NomeDaPlaca': ' '.join(str(nome or '').split()).upper(),
         'Desenhista_DiEletrons': ' '.join(str(iniciador).split()),
         'Data_desenho': time.strftime('%d/%m/%y', t), 'Revisao': 'REV.A'}
    if cliente:
        p['Cliente'] = ' '.join(str(cliente).split()).upper()
    return p


def templates_casa(root):
    """{id: {nome, w, h, estilo}} dos templates da casa (Libs/sch-templates-casa.js, o que o menu da folha edita)"""
    try:
        with open(os.path.join(root, 'Libs', 'sch-templates-casa.js'), encoding='utf-8') as f:
            txt = f.read()
        d = json.loads(txt[txt.index('{'):txt.rindex(';')])
    except (OSError, ValueError):
        return {}
    out = {}
    for tid, t in (d.get('templates') or {}).items():
        f = t.get('folha') or {}
        out[tid] = {'nome': t.get('nome') or tid, 'w': f.get('w'), 'h': f.get('h'), 'estilo': f.get('estilo') or ''}
    return out


def texto_esquema(projeto, codigo, params, template=TEMPLATE, tpl=None):
    """a folha do projeto novo: no template escolhido (com a medida dele) ou uma A4 sem template (template '')"""
    quando = time.strftime('%d/%m/%Y %H:%M:%S') + ' (NexoEletric, projeto novo)'
    folha = {'t': 'sheet', 'name': nome_da_folha(codigo) if codigo else 'ESQUEMA_1', 'size': 'A4', 'w': A4[0], 'h': A4[1]}
    if template:
        folha['template'] = template
        if tpl and tpl.get('w') and tpl.get('h'):
            folha['w'], folha['h'] = tpl['w'], tpl['h']
            if tpl.get('estilo') and tpl['estilo'] != 'Custom':
                folha['size'] = tpl['estilo']
    cab = ';'.join('%s=%s' % (k, _limpa_param(v)) for k, v in params.items() if str(v).strip())
    return ('var schematic = {\n"format":"schmirror-v2",\n"project":%s,\n"generated":%s,\n"units":"mil",\n"params":%s,\n'
            '"items":[\n%s,\n]};\n' % (json.dumps(projeto), json.dumps(quando), json.dumps(cab, ensure_ascii=False),
                                       json.dumps(folha, ensure_ascii=False)))


def registra(app, root, h):
    """h = {'nome_ok': fn(nome), 'proj_id': fn(nome), 'build_index': fn(), 'vazios': fn(nome) -> {arquivo: texto}}
    (o gravador da fila, inicia_gravador, o hubserver liga no __main__: importado por teste ele nao roda)"""

    def livre(nome):
        pdir = os.path.join(root, 'Projects')
        if not h['nome_ok'](nome):
            return 'nome do projeto invalido: sem \\ / : * ? " < > |, sem ponto no comeco ou no fim'
        novo_id = h['proj_id'](nome)
        try:
            outros = os.listdir(pdir)
        except OSError:
            outros = []
        for o in outros:
            if o.lower() == nome.lower():
                return 'ja existe um projeto com esse nome'
            if os.path.isdir(os.path.join(pdir, o)) and h['proj_id'](o) == novo_id:
                return 'o nome fica igual ao do projeto "%s" no link (%s)' % (o, novo_id)
        return None

    @app.route('/api/catalogo')
    def catalogo_lista():
        """o catalogo inteiro para o Definir projeto (hub-catalogo.js)"""
        try:
            r = _motor(root, {'acao': 'lista'})
        except Exception as e:             # noqa: BLE001
            return {'ok': False, 'error': str(e)}, 503
        r.pop('ok', None)
        return dict(ok=True, **so_definir(r))

    @app.route('/api/catalogo/fila')
    def catalogo_fila():
        """a fila do catalogo (o que ainda vai para a planilha, de todas as maquinas)"""
        try:
            r = _motor(root, {'acao': 'fila'})
        except Exception as e:             # noqa: BLE001
            return {'ok': False, 'error': str(e)}, 503
        r.pop('ok', None)
        return dict(ok=True, **r)

    @app.route('/api/catalogo/fila/resolver', methods=['POST'])
    def catalogo_fila_resolver():
        """o que fazer com uma mudanca em conflito: descartar, tentar de novo ou gravar por cima (edicao)"""
        data = request.get_json(silent=True) or {}
        try:
            r = _motor(root, {'acao': 'fila-resolver', 'id': data.get('id') or '', 'como': data.get('como') or '',
                              'por': _por()})
        except Exception as e:             # noqa: BLE001
            return {'ok': False, 'error': str(e)}, 409
        r.pop('ok', None)
        return dict(ok=True, **r)

    @app.route('/api/catalogo/fila/gravar', methods=['POST'])
    def catalogo_fila_gravar():
        """grava agora o que esta na fila (o gravador faz sozinho a cada 45 s)"""
        try:
            r = _motor(root, {'acao': 'fila-gravar'})
        except Exception as e:             # noqa: BLE001
            return {'ok': False, 'error': str(e)}, 503
        r.pop('ok', None)
        return dict(ok=True, **r)

    @app.route('/api/catalogo/registrar', methods=['POST'])
    def catalogo_registrar():
        """um item novo no catalogo (placa ou equipamento), com o codigo no padrao da casa -- pela fila (1.89.0)"""
        data = request.get_json(silent=True) or {}
        nome = ' '.join(str(data.get('nome') or '').split())
        tipo = ' '.join(str(data.get('tipo') or '').split()).upper()
        if not nome:
            return {'ok': False, 'error': 'falta o nome'}, 400
        if not tipo:
            return {'ok': False, 'error': 'falta o tipo (placa ou equipamento)'}, 400
        if tipo not in TIPOS_DEFINIR:
            return {'ok': False, 'error': 'o Definir projeto cadastra só placa ou equipamento (não %s)' % tipo}, 400
        try:
            r = _motor(root, {'acao': 'registra', 'nome': nome, 'tipo': tipo, 'cliente': data.get('cliente') or '',
                              'vinculo': data.get('vinculo') or '', 'sigla': data.get('sigla') or '', 'por': _por()})
        except Exception as e:             # noqa: BLE001
            msg = str(e)
            return {'ok': False, 'error': msg}, _status_erro(msg, getattr(e, 'conflito', False))
        r.pop('ok', None)
        return dict(ok=True, **r)

    @app.route('/api/catalogo/editar', methods=['POST'])
    def catalogo_editar():
        """muda o codigo, o nome ou a categoria de um item do catalogo (o botao direito do Definir projeto) -- pela fila"""
        data = request.get_json(silent=True) or {}
        ent = {'acao': 'edita', 'item': data.get('item'), 'codigo': data.get('codigo') or '', 'por': _por()}
        # o que a pessoa viu: se outra pessoa mudou antes, recusa na hora (conflito)
        for k in ('nome', 'tipo'):
            if data.get(k) is not None:
                ent[k] = data.get(k)
        if data.get('novoGrupo') is not None and str(data.get('novoGrupo')) not in GRUPOS_DEFINIR:
            return {'ok': False, 'error': 'no Definir projeto a categoria é Placa ou Equipamento'}, 400
        if data.get('novoCodigo') is not None:
            ent['novoCodigo'] = data.get('novoCodigo')
        if data.get('novoNome') is not None:
            ent['novoNome'] = data.get('novoNome')
        if data.get('novoGrupo') is not None:
            ent['novoGrupo'] = data.get('novoGrupo')
        try:
            r = _motor(root, ent)
        except Exception as e:             # noqa: BLE001
            msg = str(e)
            return {'ok': False, 'error': msg}, _status_erro(msg, getattr(e, 'conflito', False))
        r.pop('ok', None)
        return dict(ok=True, **r)

    @app.route('/api/projeto/novo/previa')
    def projeto_novo_previa():
        try:
            r = _motor(root, {'acao': 'previa', 'nome': request.args.get('nome', ''), 'sigla': request.args.get('sigla', ''),
                              'tipo': request.args.get('tipo', '')})
        except Exception as e:             # noqa: BLE001
            return {'ok': False, 'error': str(e)}, 503
        r.pop('ok', None)
        return dict(ok=True, **r)

    @app.route('/api/projeto/novo/templates')
    def projeto_novo_templates():
        """os templates de esquema que o projeto novo pode usar (os da casa)"""
        t = templates_casa(root)
        return {'ok': True, 'padrao': TEMPLATE if TEMPLATE in t else '',
                'templates': [dict(id=k, **v) for k, v in sorted(t.items(), key=lambda kv: kv[1]['nome'].lower())]}

    @app.route('/api/projeto/novo/catalogo')
    def projeto_novo_catalogo():
        """o produto de um codigo (o carimbo da casa se completa com o nome e o cliente do catalogo)"""
        try:
            r = _motor(root, {'acao': 'busca', 'codigo': request.args.get('codigo', '')})
        except Exception as e:             # noqa: BLE001
            return {'ok': False, 'error': str(e)}, 503
        return {'ok': True, 'achou': r.get('achou')}

    @app.route('/api/projeto/novo', methods=['POST'])
    def projeto_novo():
        data = request.get_json(silent=True) or {}
        nome = ' '.join(str(data.get('nome') or '').split())
        iniciador = ' '.join(str(data.get('iniciador') or '').split())
        usuario = None
        try:
            import equipe as _eq
            usuario = _eq.sessao(forcar=True)['usuario']
        except Exception:                  # noqa: BLE001
            _eq = None
        if usuario:
            iniciador = usuario['nome']
        if not nome:
            return {'ok': False, 'error': 'falta o nome da placa'}, 400
        if not iniciador:
            return {'ok': False, 'error': 'entre no Nexo Hub: o seu nome (o do login) entra como desenhista'}, 400
        projeto = ' '.join(str(data.get('projeto') or '').split())
        # o template do esquema: o da casa por padrao; '' = folha A4 sem template
        tpls = templates_casa(root)
        if data.get('template') is None:
            template = TEMPLATE if TEMPLATE in tpls else ''      # o da casa, se ainda existir
        else:
            template = str(data.get('template') or '')
        if template and template not in tpls:
            return {'ok': False, 'error': 'o template "%s" nao existe nos templates da casa' % template}, 400
        if projeto:
            ruim = livre(projeto)
            if ruim:
                return {'ok': False, 'error': ruim}, 409
        try:
            r = _motor(root, {'acao': 'registra', 'nome': nome, 'tipo': 'PLACA', 'cliente': data.get('cliente') or '',
                              'vinculo': data.get('vinculo') or '', 'sigla': data.get('sigla') or '',
                              'por': {'nome': iniciador, 'login': (usuario or {}).get('login', '')}})
        except Exception as e:             # noqa: BLE001
            msg = str(e)                   # ja esta no catalogo, ou placa sem o P: e do pedido
            return {'ok': False, 'error': msg}, _status_erro(msg, getattr(e, 'conflito', False))
        codigo = r['codigo']
        if not projeto:
            projeto = codigo
            n = 2
            while livre(projeto):
                projeto = '%s (%d)' % (codigo, n)
                n += 1
        params = params_template(codigo, nome, iniciador, data.get('cliente') or '')
        if usuario:
            params['Desenhista_carimbo'] = usuario['login'] or usuario['id']     # o login, no campo de sempre
        d = os.path.join(root, 'Projects', projeto)
        try:
            os.makedirs(os.path.join(root, 'Projects'), exist_ok=True)
            os.mkdir(d)
            arqs = h['vazios'](projeto)
            arqs['schematic.js'] = texto_esquema(projeto, codigo, params, template, tpls.get(template))
            for a, txt in arqs.items():
                with open(os.path.join(d, a), 'w', encoding='utf-8') as f:
                    f.write(txt)
            if usuario and _eq is not None:
                _eq.nova(d, usuario)           # quem criou e o responsavel pelo projeto
        except OSError as e:
            return {'ok': False, 'error': 'o codigo %s foi registrado no catalogo (item %s), mas a pasta do projeto nao '
                                          'foi criada: %s' % (codigo, r['item'], e), 'codigo': codigo}, 500
        h['build_index']()
        if usuario and _eq is not None:
            _eq.evento(d, 'equipe', ['%s criou o projeto (%s) e é o responsável' % (usuario['nome'], codigo)], usuario)
        return {'ok': True, 'id': h['proj_id'](projeto), 'name': projeto, 'codigo': codigo, 'item': r['item'],
                'linha': r.get('linha'), 'params': params, 'pendente': bool(r.get('pendente'))}
