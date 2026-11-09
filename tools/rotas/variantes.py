# -*- coding: utf-8 -*-
"""VARIANTE DE PROJETO (1.88.0): a mesma PCB para projetos diferentes, mudando so o que e montado.

Pedido do dono (2026-11-09): "dentro de cada projeto, vai ter uma area chamada 'variante de projeto' no menu lateral
direito; quando eu criar uma variante de projeto, preciso na hora estabelecer um codigo para essa variante dentro do
catalogo de 'definir projeto'; quando eu troco a variante, a pcb vai ser exatamente a mesma so que para projetos
diferentes; a variante eu posso so SUPRIMIR (montar ou nao montar) componentes, mais nada alem disso; a barra de
ferramenta de edicao tanto pra pcb quanto pra esquema somem, e so fica 'suprimir', que tira o componente tanto da pcb,
quanto do bom, quanto da lista de envio para o odoo".

O ARQUIVO: Projects/<p>/variantes.json (viaja para o NexoBD com o projeto, como os outros; o vigia o ve):
  {"formato": "nexoeletric-variantes-1", "variantes": [
     {"id": "v1a2b3c", "nome": "Sem display", "codigo": "PXSD-DI261950", "nomeCatalogo": "PLACA X SEM DISPLAY",
      "criada": {"por": {id, login, nome}, "em": "AAAA-MM-DDTHH:MM:SS"},
      "suprimidos": [{"ref": "U3", "sym": "...", "footprint": "...", "por": {...}, "em": "..."}]}]}
  O esquema nao tem id estavel por componente (o UniqueId do Altium nao vem no schematic.js): o suprimido e o
  DESIGNADOR, com o simbolo e o footprint de quando foi suprimido para conferir (a tela avisa se o ref sumiu ou virou
  outra peca). A variante nunca escreve no schematic.js, no changes.js nem no board.js: a placa e a mesma.

A VARIANTE ATIVA: Projects/<p>/.variante-ativa.json {"id", "em"} -- POR MAQUINA (o ponto no nome a deixa fora do NexoBD e
do HTTP): trocar de variante aqui nao troca a vista de quem abre o mesmo projeto noutro computador. Com uma ativa:
  - as vistas (esquema e PCB) mostram a variante, sem as barras de edicao, so com Suprimir / Montar;
  - o /api/save (Python e Rust) e as escritas do MCP recusam mudar schematic.js, changes.js, annotations.js ou rules.js
    (409 variante_ativa): a placa e a mesma, so o variantes.json muda;
  - as saidas (BOM, Neoden/pick-and-place, lista do Odoo, PDF) usam a variante: o suprimido sai delas. O Gerber nao muda.

OS CODIGOS (a regra mora em codigos(): mude aqui se a casa decidir outra coisa):
  PCB virgem  = o codigo da PCB (CodigoDaPlaca): a fibra e a mesma em todas as variantes;
  PCB montada = o codigo da PCB na variante padrao; com uma variante ativa (1.89.0, pedido do dono: "sempre que for subir
                lista de variante, precisa gerar uma PCB (montada) gera com o codigo da placa + nome da variante"),
                "<codigo da placa> <NOME DA VARIANTE>" (montada_da_variante; SEPARADOR_MONTADA troca o separador). E,
                na variante, a lista vai ao Odoo SEM a PCB virgem ("precisa enviar sem criar a PCB virgem, quando for uma
                variante"): virgemVai = False (odoolista.anexa_imagens nao a poe; a virgem e a do projeto padrao).
  1.89.0: a variante E um equipamento (escolhido no catalogo, so equipamentos): o codigo dela e o do equipamento, que vai
  ao quadro da folha (EQUIPAMENTO) com ela ativa; o equipamento nao vai ao Odoo. O nome e obrigatorio (a pessoa da;
  a sugestao e o nome do equipamento) e nao repete entre as variantes do projeto.

Rotas:
  GET  /api/variantes?projeto=           -> {ok, formato, variantes, ativa: id|null, placa:{codigo, nome}, codigos, permissao}
  POST /api/variantes/ativar {projeto, id|null}             trocar de variante: LIVRE (o visualizador ve e exporta)
  POST /api/variantes/criar {projeto, nome, codigo, nomeCatalogo?}   -> {ok, variante}   edicao (a equipe)
  POST /api/variantes/editar {projeto, id, nome?, codigo?, nomeCatalogo?}                 edicao
  POST /api/variantes/apagar {projeto, id}                                                edicao
  POST /api/variantes/suprimir {projeto, id, refs:[...], suprimir: bool}  -> {ok, variante, mudou:[refs]}   edicao
  Edicao = quem edita o projeto (tools/rotas/equipe.py » recusa_gravar: responsavel, colaborador, admin); o visualizador
  e o nao convidado levam 403 sem_permissao. Cada mudanca vai para o historico do projeto (quem suprimiu o que).
"""
import json
import os
import re
import secrets
import time

from flask import request

ARQ = 'variantes.json'
FORMATO = 'nexoeletric-variantes-1'
ATIVA = '.variante-ativa.json'
# o que a variante nao deixa mudar (o /api/save do Python e do Rust, e o MCP)
TRAVADOS = ('schematic.js', 'changes.js', 'annotations.js', 'rules.js')
NOME_MAX = 120                 # so para nao virar um paragrafo na tela (vai no codigo da montada no Odoo)
# 1.89.0: a PCB montada de uma variante, no Odoo: "<codigo da placa><SEPARADOR><NOME DA VARIANTE>" (o mesmo do
# hub-variantes.js >> codigos: mude os dois juntos)
SEPARADOR_MONTADA = ' '
_ID = re.compile(r'^v[0-9a-f]{6,16}$')


def _agora():
    return time.strftime('%Y-%m-%dT%H:%M:%S')


def norm_cod(c):
    return re.sub(r'\s+', '', str(c or '')).upper()


def _vazio():
    return {'formato': FORMATO, 'variantes': []}


def le(pdir):
    """o variantes.json do projeto, normalizado (arquivo torto ou ausente = sem variantes)"""
    try:
        with open(os.path.join(pdir, ARQ), encoding='utf-8-sig') as f:
            d = json.load(f)
    except (OSError, ValueError):
        return _vazio()
    out = _vazio()
    for v in (d.get('variantes') if isinstance(d, dict) else None) or []:
        if not isinstance(v, dict) or not _ID.match(str(v.get('id') or '')) or not norm_cod(v.get('codigo')):
            continue
        sup, vistos = [], set()
        for s in v.get('suprimidos') or []:
            ref = str((s.get('ref') if isinstance(s, dict) else s) or '').strip()
            if ref and ref not in vistos:
                vistos.add(ref)
                sup.append(dict(s, ref=ref) if isinstance(s, dict) else {'ref': ref})
        out['variantes'].append(dict(v, id=str(v['id']), nome=' '.join(str(v.get('nome') or '').split()),
                                     codigo=norm_cod(v.get('codigo')), suprimidos=sup))
    return out


def grava(pdir, d):
    d = {'formato': FORMATO, 'variantes': d.get('variantes') or []}
    arq = os.path.join(pdir, ARQ)
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, os.path.realpath(arq) if os.path.exists(arq) else arq)


def acha(d, vid):
    return next((v for v in d['variantes'] if v['id'] == str(vid or '')), None)


def id_ativa(pdir):
    try:
        with open(os.path.join(pdir, ATIVA), encoding='utf-8-sig') as f:
            return str(json.load(f).get('id') or '') or None
    except (OSError, ValueError, AttributeError):
        return None


def ativa(pdir, d=None):
    """a variante ativa NESTA maquina (o dicionario), ou None = a padrao (todos montados)"""
    vid = id_ativa(pdir)
    if not vid:
        return None
    return acha(d or le(pdir), vid)


def define_ativa(pdir, vid):
    arq = os.path.join(pdir, ATIVA)
    if not vid:
        try:
            os.remove(arq)
        except OSError:
            pass
        return
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'id': vid, 'em': _agora()}, f)
    os.replace(tmp, arq)


# ─────────────────────────── o efeito no esquema ───────────────────────────
def comps(schematic):
    return [it for it in ((schematic or {}).get('items') or [])
            if isinstance(it, dict) and it.get('t') == 'comp' and str(it.get('ref') or '').strip()]


def refs(schematic, v):
    """os designadores suprimidos pela variante v que existem no esquema"""
    if not v:
        return set()
    quer = {s['ref'] for s in v.get('suprimidos') or []}
    return {str(it['ref']).strip() for it in comps(schematic) if str(it['ref']).strip() in quer}


def aplica(schematic, v):
    """o esquema COMO A VARIANTE O MONTA (copia rasa): o suprimido ganha dnp + suprimido, e a regra de nao montar de todo
    lugar (lista do Odoo, BOM, Neoden) o tira. O arquivo nao muda."""
    fora = refs(schematic, v)
    if not fora:
        return schematic
    itens = []
    for it in schematic.get('items') or []:
        if isinstance(it, dict) and it.get('t') == 'comp' and str(it.get('ref') or '').strip() in fora:
            it = dict(it, dnp=True, suprimido=True)
        itens.append(it)
    return dict(schematic, items=itens)


def params_de(schematic):
    out = {}
    p = (schematic or {}).get('params')
    for par in (p if isinstance(p, str) else '').split(';'):
        if '=' in par:
            k, val = par.split('=', 1)
            out[k.strip()] = ' '.join(val.split())
    return out


def montada_da_variante(placa, nome):
    """o codigo da PCB montada de uma variante no Odoo: o codigo da placa + o nome da variante (em maiusculas)"""
    nome = ' '.join(str(nome or '').split()).upper()
    return (str(placa or '') + SEPARADOR_MONTADA + nome).strip() if placa else nome


def codigos(schematic, v):
    """{placa, virgem, virgemVai, montada, equipamento, equipamentoProjeto, variante} -- a regra do cabecalho"""
    p = params_de(schematic)
    placa = p.get('CodigoDaPlaca', '')
    if placa.upper() == 'PROJETO NÃO DEFINIDO':
        placa = ''
    eq = p.get('CodigoDoEquipamento', '')
    return {'placa': placa, 'nomePlaca': p.get('NomeDaPlaca', ''), 'virgem': placa, 'virgemVai': not v,
            'montada': montada_da_variante(placa, v.get('nome') or v.get('codigo')) if v else placa,
            'equipamento': (v or {}).get('codigo') or eq, 'equipamentoProjeto': eq,
            'variante': {'id': v['id'], 'nome': v.get('nome', ''), 'codigo': v.get('codigo', '')} if v else None}


def sufixo(v):
    """o pedaco do nome dos arquivos exportados com a variante ('' na padrao)"""
    if not v:
        return ''
    return ' - variante ' + re.sub(r'[\\/:*?"<>|]+', '_', v.get('codigo') or v.get('nome') or v['id'])


def recusa_salvar(pdir, arquivo, novo):
    """None = pode gravar; senao o corpo 409: com uma variante ativa, schematic/changes/annotations/rules nao mudam"""
    if arquivo not in TRAVADOS:
        return None
    v = ativa(pdir)
    if not v:
        return None
    try:
        with open(os.path.join(pdir, arquivo), encoding='utf-8', newline='') as f:
            atual = f.read().replace('\r\n', '\n')
    except OSError:
        atual = None
    if atual is not None and atual == str(novo).replace('\r\n', '\n'):
        return None
    return {'ok': False, 'codigo': 'variante_ativa', 'variante': {'id': v['id'], 'nome': v['nome'], 'codigo': v['codigo']},
            'error': 'A variante "%s" (%s) está ativa: a PCB é a mesma, nela só se suprime ou monta componente. Volte '
                     'para "Padrão" (Configurações › Variante de projeto) para editar o esquema ou a PCB.'
                     % (v['nome'], v['codigo'])}


# ─────────────────────────── rotas ───────────────────────────
def registra(app, root, equipe=None, ler_esquema=None):
    """equipe = o modulo tools/rotas/equipe.py (ou None); ler_esquema(pasta) -> dict do schematic.js (ou None)"""
    pdir_raiz = os.path.join(root, 'Projects')

    def pasta(nome):
        nome = str(nome or '')
        if not nome or nome != os.path.basename(nome) or nome in ('.', '..') or nome.startswith('.'):
            return None
        d = os.path.join(pdir_raiz, nome)
        return d if os.path.isdir(d) else None

    def corpo():
        return request.get_json(silent=True) or {}

    def esquema(d):
        if ler_esquema is None:
            return None
        try:
            return ler_esquema(d)
        except Exception:                                     # noqa: BLE001
            return None

    def usuario():
        try:
            return equipe.sessao()['usuario'] if equipe else None
        except Exception:                                     # noqa: BLE001
            return None

    def quem():
        u = usuario()
        return {'id': u['id'], 'login': u.get('login', ''), 'nome': u.get('nome', '')} if u else None

    def recusa(d):
        if equipe is None:
            return None
        return equipe.recusa_gravar(d)

    def historico(d, mudancas):
        if equipe is None:
            return
        try:
            equipe.evento(d, 'variante', mudancas, usuario())
        except Exception as e:                                # noqa: BLE001 -- o historico nunca impede
            print('[variantes] historico: %s' % e, flush=True)

    def estado(d):
        dv = le(d)
        v = ativa(d, dv)
        sch = esquema(d)
        presentes = {str(it['ref']).strip(): it for it in comps(sch)} if sch else None
        lst = []
        for x in dv['variantes']:
            x = dict(x)
            if presentes is not None:
                x['faltando'] = [s['ref'] for s in x['suprimidos'] if s['ref'] not in presentes]
                x['trocados'] = [s['ref'] for s in x['suprimidos'] if s['ref'] in presentes and s.get('sym')
                                 and presentes[s['ref']].get('sym') and presentes[s['ref']].get('sym') != s.get('sym')]
            lst.append(x)
        perm = None
        if equipe is not None:
            try:
                p = equipe.permissao(d)
                perm = {'pode': p['pode'], 'motivo': p.get('motivo', ''), 'visualizador': p.get('visualizador', False)}
            except Exception:                                 # noqa: BLE001
                perm = None
        cod = codigos(sch or {}, v)
        return {'ok': True, 'formato': FORMATO, 'variantes': lst, 'ativa': v['id'] if v else None,
                'placa': {'codigo': cod['placa'], 'nome': cod['nomePlaca']}, 'codigos': cod,
                'permissao': perm or {'pode': True, 'motivo': '', 'visualizador': False}}

    def valida_codigo(d, dv, codigo, menos=None):
        c = norm_cod(codigo)
        if not c:
            return None, 'escolha o código da variante no catálogo (Definir projeto): sem código não há variante'
        if not re.match(r'^[A-Z0-9][A-Z0-9._/-]*$', c):
            return None, 'código inválido: %s' % c
        cod = codigos(esquema(d) or {}, None)
        if cod['placa'] and norm_cod(cod['placa']) == c:
            return None, ('%s é o código da PCB (a placa virgem, igual em todas as variantes): a variante precisa de um '
                          'código próprio' % c)
        # 1.89.0: a variante e outro equipamento com a mesma PCB: o do projeto padrao nao
        if cod['equipamentoProjeto'] and norm_cod(cod['equipamentoProjeto']) == c:
            return None, ('%s é o equipamento do projeto padrão: a variante é outro equipamento (com a mesma PCB)' % c)
        outra = next((x for x in dv['variantes'] if x['codigo'] == c and x['id'] != menos), None)
        if outra:
            return None, 'o equipamento %s já é da variante "%s"' % (c, outra['nome'])
        return c, None

    @app.route('/api/variantes')
    def api_variantes():
        d = pasta(request.args.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto nao encontrado'}, 404
        return estado(d)

    @app.route('/api/variantes/ativar', methods=['POST'])
    def api_variantes_ativar():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto nao encontrado'}, 404
        vid = str(b.get('id') or '') or None
        if vid and not acha(le(d), vid):
            return {'ok': False, 'error': 'a variante não existe mais (outra máquina apagou?)'}, 404
        define_ativa(d, vid)
        return estado(d)

    @app.route('/api/variantes/criar', methods=['POST'])
    def api_variantes_criar():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto nao encontrado'}, 404
        nao = recusa(d)
        if nao:
            return nao, 403
        nome = ' '.join(str(b.get('nome') or '').split())[:NOME_MAX]
        if not nome:
            return {'ok': False, 'error': 'dê um nome à variante'}, 400
        dv = le(d)
        if any(x['nome'].lower() == nome.lower() for x in dv['variantes']):
            return {'ok': False, 'error': 'já existe uma variante "%s"' % nome}, 409
        c, erro = valida_codigo(d, dv, b.get('codigo'))
        if erro:
            return {'ok': False, 'error': erro}, 409 if norm_cod(b.get('codigo')) else 400
        v = {'id': 'v' + secrets.token_hex(4), 'nome': nome, 'codigo': c,
             'nomeCatalogo': ' '.join(str(b.get('nomeCatalogo') or '').split()),
             'criada': {'por': quem(), 'em': _agora()}, 'suprimidos': []}
        dv['variantes'].append(v)
        grava(d, dv)
        historico(d, ['criou a variante "%s" (%s)' % (nome, c)])
        r = estado(d)
        r['variante'] = v
        return r

    @app.route('/api/variantes/editar', methods=['POST'])
    def api_variantes_editar():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto nao encontrado'}, 404
        nao = recusa(d)
        if nao:
            return nao, 403
        dv = le(d)
        v = acha(dv, b.get('id'))
        if not v:
            return {'ok': False, 'error': 'a variante não existe mais'}, 404
        msgs = []
        if b.get('nome') is not None:
            nome = ' '.join(str(b.get('nome') or '').split())[:NOME_MAX]
            if not nome:
                return {'ok': False, 'error': 'o nome não pode ficar vazio'}, 400
            if any(x['nome'].lower() == nome.lower() and x['id'] != v['id'] for x in dv['variantes']):
                return {'ok': False, 'error': 'já existe uma variante "%s"' % nome}, 409
            if nome != v['nome']:
                msgs.append('renomeou a variante "%s" para "%s"' % (v['nome'], nome))
                v['nome'] = nome
        if b.get('codigo') is not None:
            c, erro = valida_codigo(d, dv, b.get('codigo'), menos=v['id'])
            if erro:
                return {'ok': False, 'error': erro}, 409
            if c != v['codigo']:
                msgs.append('trocou o código da variante "%s": %s → %s' % (v['nome'], v['codigo'], c))
                v['codigo'] = c
                if b.get('nomeCatalogo') is not None:
                    v['nomeCatalogo'] = ' '.join(str(b.get('nomeCatalogo') or '').split())
        if not msgs:
            return {'ok': False, 'error': 'nada para mudar'}, 400
        grava(d, dv)
        historico(d, msgs)
        r = estado(d)
        r['variante'] = v
        return r

    @app.route('/api/variantes/apagar', methods=['POST'])
    def api_variantes_apagar():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto nao encontrado'}, 404
        nao = recusa(d)
        if nao:
            return nao, 403
        dv = le(d)
        v = acha(dv, b.get('id'))
        if not v:
            return {'ok': False, 'error': 'a variante não existe mais'}, 404
        dv['variantes'] = [x for x in dv['variantes'] if x['id'] != v['id']]
        grava(d, dv)
        if id_ativa(d) == v['id']:
            define_ativa(d, None)
        historico(d, ['apagou a variante "%s" (%s)' % (v['nome'], v['codigo'])])
        return estado(d)

    @app.route('/api/variantes/suprimir', methods=['POST'])
    def api_variantes_suprimir():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto nao encontrado'}, 404
        nao = recusa(d)
        if nao:
            return nao, 403
        dv = le(d)
        v = acha(dv, b.get('id'))
        if not v:
            return {'ok': False, 'error': 'escolha uma variante: na "Padrão" todos são montados'}, 404
        pedidos = [str(r or '').strip() for r in (b.get('refs') or []) if str(r or '').strip()]
        if not pedidos:
            return {'ok': False, 'error': 'diga quais componentes (refs)'}, 400
        sch = esquema(d)
        por_ref = {}
        for it in comps(sch):
            por_ref.setdefault(str(it['ref']).strip(), it)
        if sch is not None:
            fora = [r for r in pedidos if r not in por_ref]
            if fora:
                return {'ok': False, 'error': 'não estão no esquema: %s' % ', '.join(fora)}, 400
        on = b.get('suprimir', True) is not False
        tem = {s['ref'] for s in v['suprimidos']}
        mudou = []
        if on:
            for r in pedidos:
                if r in tem:
                    continue
                it = por_ref.get(r) or {}
                v['suprimidos'].append({'ref': r, 'sym': it.get('sym', ''), 'footprint': it.get('footprint', ''),
                                        'por': quem(), 'em': _agora()})
                tem.add(r)
                mudou.append(r)
        else:
            mudou = [r for r in pedidos if r in tem]
            v['suprimidos'] = [s for s in v['suprimidos'] if s['ref'] not in set(mudou)]
        if mudou:
            grava(d, dv)
            historico(d, ['%s %s na variante "%s" (%s)' % ('suprimiu' if on else 'voltou a montar', ', '.join(mudou),
                                                           v['nome'], v['codigo'])])
        r = estado(d)
        r['variante'] = v
        r['mudou'] = mudou
        return r
