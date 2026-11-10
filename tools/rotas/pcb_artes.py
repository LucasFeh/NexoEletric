# -*- coding: utf-8 -*-
"""As ARTES DE OVERLAY da PCB (1.91.0): a biblioteca da rede.

Pedido do dono (2026-11-10): a logo da casa com o QR do site e o codigo da placa + a revisao viram artes de overlay
padrao, que se puxam na placa; e um Studio (ferramenta da vista PCB) cria artes novas. O desenho e a conta sao do
navegador e do MCP (hub-pcbartes.js); aqui so a biblioteca.

ONDE MORA: Libs/pcb-artes.json, que viaja com o resto da Libs/ para o NexoBD (electron/lib/armazem.js: o item
"Biblioteca do NexoEletric"); toda maquina ligada ao mesmo NexoBD ve as mesmas artes.
  {"formato": "nexoeletric-pcb-artes-1", "artes": [{id, nome, versao, atualizado, autor, elementos:[...]}, ...]}
As duas artes da casa (dieletrons-logo-qr, codigo-revisao) moram no programa (hub-pcbartes.js » PADRAO): o arquivo so
as tem se o administrador as editou (a versao dele ganha) ou as tirou da lista ({id, apagada: true}). O arquivo nasce
na primeira gravacao feita pelo programa; nenhum script semeia o NexoBD.

PERMISSOES (o Nexo Hub decide, tools/rotas/equipe.py): o visualizador nao grava (ROTAS_EDICAO, o before_request);
editar uma arte da casa, apagar qualquer arte e restaurar a da casa e so do administrador (como as exclusoes da
biblioteca da 1.89.0). Duas pessoas editando a mesma arte: a gravacao leva a `base` (a versao que a pessoa abriu) e a
segunda leva 409 com quem gravou antes.

Rotas:
  GET  /api/pcb-artes                       -> {ok, artes:[...do arquivo], padrao:[ids], arquivo, admin, visualizador}
  POST /api/pcb-artes/salvar {arte, base?}  -> {ok, arte}   (409 conflito; 403 arte da casa sem ser admin)
  POST /api/pcb-artes/apagar {id}           -> {ok}         (403 sem ser admin)
  POST /api/pcb-artes/restaurar {id}        -> {ok}         (a da casa volta ao desenho do programa; so admin)
"""
import datetime
import json
import os
import re
import threading

ARQ = os.path.join('Libs', 'pcb-artes.json')
FORMATO = 'nexoeletric-pcb-artes-1'
PADRAO = ('dieletrons-logo-qr', 'codigo-revisao')
TIPOS = ('texto', 'linha', 'retangulo', 'circulo', 'qr', 'regioes')
MAX_BYTES = 2 * 1024 * 1024
MSG_SO_ADMIN = 'Só o administrador do Nexo Hub apaga artes ou muda as artes padrão da casa (duplique para fazer a sua)'
RE_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,59}$')
_trava = threading.Lock()

try:
    import equipe as _equipe        # noqa: E402 -- tools/rotas ja esta no sys.path (hubserver.py)
except Exception:                   # noqa: BLE001
    _equipe = None


class ErroArte(Exception):
    pass


def caminho(root):
    return os.path.join(root, ARQ)


def le(root):
    p = caminho(root)
    try:
        with open(p, encoding='utf-8') as f:
            d = json.load(f)
    except FileNotFoundError:
        return {'formato': FORMATO, 'artes': []}
    except (OSError, ValueError) as e:
        raise ErroArte('a biblioteca de artes (%s) não abre: %s' % (ARQ, e))
    if not isinstance(d, dict) or not isinstance(d.get('artes'), list):
        raise ErroArte('a biblioteca de artes (%s) está fora do formato' % ARQ)
    return d


def grava(root, d):
    p = caminho(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    d['formato'] = FORMATO
    d['artes'] = sorted(d['artes'], key=lambda a: (a.get('id') not in PADRAO, str(a.get('nome', '')).lower(), a.get('id')))
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(d, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    os.replace(tmp, os.path.realpath(p))


def confere(arte):
    """recusa o que nunca poderia ir; o desenho em si (QR, campos, minimos) e conferido no navegador"""
    if not isinstance(arte, dict):
        raise ErroArte('arte deve ser um objeto')
    id_ = arte.get('id')
    if not isinstance(id_, str) or not RE_ID.match(id_):
        raise ErroArte('id da arte inválido (letras minúsculas, números e "-")')
    nome = arte.get('nome')
    if not isinstance(nome, str) or not nome.strip():
        raise ErroArte('a arte precisa de um nome')
    els = arte.get('elementos')
    if not isinstance(els, list) or not els:
        raise ErroArte('a arte "%s" está vazia' % nome)
    for el in els:
        if not isinstance(el, dict) or el.get('tipo') not in TIPOS:
            raise ErroArte('elemento de tipo desconhecido: %r' % (el.get('tipo') if isinstance(el, dict) else el))
    if len(json.dumps(arte)) > MAX_BYTES:
        raise ErroArte('a arte passa de 2 MB: simplifique a imagem')
    limpa = {k: arte[k] for k in ('id', 'nome', 'descricao', 'elementos') if k in arte}
    limpa['nome'] = nome.strip()[:120]
    return limpa


def _usuario():
    if _equipe is None:
        return None, False, False
    try:
        s = _equipe.sessao(forcar=True)
    except Exception:               # noqa: BLE001
        return None, False, False
    u = s.get('usuario') if s.get('modo') == 'login' else None
    return u, _equipe.eh_admin(u), bool(u and _equipe.eh_visualizador(u))


def _so_admin():
    if _equipe is None:
        return None
    u, admin, _ = _usuario()
    if admin:
        return None
    return {'ok': False, 'codigo': 'sem_permissao', 'error': MSG_SO_ADMIN, 'soAdmin': True}


def salva(root, arte, base=None, autor=''):
    a = confere(arte)
    with _trava:
        d = le(root)
        atual = next((x for x in d['artes'] if x.get('id') == a['id']), None)
        v_atual = int(atual.get('versao') or 0) if atual and not atual.get('apagada') else 0
        if base is not None and atual and not atual.get('apagada') and int(base) != v_atual:
            raise ErroArte('conflito: %s gravou a arte "%s" (versão %d) depois que você a abriu (versão %s) — reabra e refaça'
                           % (atual.get('autor') or 'outra pessoa', atual.get('nome'), v_atual, base))
        a['versao'] = v_atual + 1
        a['atualizado'] = datetime.datetime.now().isoformat(timespec='seconds')
        a['autor'] = autor or ''
        d['artes'] = [x for x in d['artes'] if x.get('id') != a['id']] + [a]
        grava(root, d)
        return a


def apaga(root, id_):
    with _trava:
        d = le(root)
        resto = [x for x in d['artes'] if x.get('id') != id_]
        if id_ in PADRAO:
            resto.append({'id': id_, 'apagada': True, 'atualizado': datetime.datetime.now().isoformat(timespec='seconds')})
        elif len(resto) == len(d['artes']):
            raise ErroArte('a arte %s não existe' % id_)
        d['artes'] = resto
        grava(root, d)


def restaura(root, id_):
    if id_ not in PADRAO:
        raise ErroArte('só as artes da casa voltam ao desenho do programa')
    with _trava:
        d = le(root)
        d['artes'] = [x for x in d['artes'] if x.get('id') != id_]
        grava(root, d)


def registra(app, root):
    from flask import request

    def erro(e, status=400):
        return {'ok': False, 'error': str(e)}, status

    @app.route('/api/pcb-artes', methods=['GET'])
    def pcb_artes_lista():
        try:
            d = le(root)
        except ErroArte as e:
            return erro(e, 500)
        u, admin, vis = _usuario()
        return {'ok': True, 'artes': d['artes'], 'padrao': list(PADRAO), 'arquivo': ARQ.replace(os.sep, '/'),
                'admin': admin, 'visualizador': vis, 'usuario': (u or {}).get('nome') or (u or {}).get('login') or ''}

    @app.route('/api/pcb-artes/salvar', methods=['POST'])
    def pcb_artes_salvar():
        data = request.get_json(silent=True) or {}
        arte = data.get('arte')
        if isinstance(arte, dict) and arte.get('id') in PADRAO:
            nao = _so_admin()
            if nao:
                return nao, 403
        u, _, _ = _usuario()
        try:
            a = salva(root, arte, data.get('base'), (u or {}).get('nome') or (u or {}).get('login') or '')
        except ErroArte as e:
            return erro(e, 409 if str(e).startswith('conflito') else 400)
        except OSError as e:
            return erro('não gravou a biblioteca de artes: %s' % e, 500)
        return {'ok': True, 'arte': a}

    @app.route('/api/pcb-artes/apagar', methods=['POST'])
    def pcb_artes_apagar():
        nao = _so_admin()
        if nao:
            return nao, 403
        id_ = (request.get_json(silent=True) or {}).get('id')
        try:
            apaga(root, str(id_ or ''))
        except ErroArte as e:
            return erro(e, 404)
        return {'ok': True}

    @app.route('/api/pcb-artes/restaurar', methods=['POST'])
    def pcb_artes_restaurar():
        nao = _so_admin()
        if nao:
            return nao, 403
        id_ = (request.get_json(silent=True) or {}).get('id')
        try:
            restaura(root, str(id_ or ''))
        except ErroArte as e:
            return erro(e, 400)
        return {'ok': True}
