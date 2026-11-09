# -*- coding: utf-8 -*-
"""O projeto aberto e as mudancas que chegam de outra maquina pelo NexoBD (1.85.0).

Pedido do dono (2026-11-09): "quando eu estiver fazendo alguma alteracao no meu projeto, se outro colaborador ou admin
estiver com o projeto aberto, avise pra ele que o projeto dele ta desatualizado, e pergunta se quiser sincronizar o
nexohub dele e atualizar o projeto pra ficar com a ultima versao".

Quem sincroniza e o motor do app (electron/lib/armazem.js + sincronia.js); quem pergunta e a pagina (hub-sincronia.js).
Os dois nao se falam direto (a janela pode ser a Rust ou a Electron): conversam por arquivos em .altiumhub/, e este modulo
e a porta da pagina para eles.
  .altiumhub/nexobd-abertos.json        {janela: {projetos:[nome], quando}}: os projetos abertos nas janelas desta
                                        maquina (a pagina avisa a cada 10 s; vale o que tem menos de ABERTO_VALE s)
  .altiumhub/nexobd-desatualizados.json {ligado, quando, avisos:{nome: aviso}, sincronizados:{nome: {id, quando, rev,
                                        conflitos}}}: o motor escreve (projeto aberto com revisao nova de fora fica
                                        SEGURADO: nao baixa calado; o aviso diz quem, onde, quando e o que mudou)
  .altiumhub/nexobd-sincronizar.json    {pedidos:[{projeto, id, quando}]}: "Sincronizar e atualizar" (o motor le, puxa o
                                        projeto e apaga o pedido)

Rotas:
  POST /api/sincronia/aberto {janela, projetos}   -> {ok}
  GET  /api/sincronia/estado                      -> {ok, ligado, avisos, sincronizados, quando}
  POST /api/sincronia/sincronizar {projeto}       -> {ok, id}
"""
import json
import os
import secrets
import threading
import time

from flask import request

ABERTO_VALE = 45.0
DIR = '.altiumhub'
ARQ_ABERTOS = 'nexobd-abertos.json'
ARQ_DESATUALIZADOS = 'nexobd-desatualizados.json'
ARQ_PEDIDO = 'nexobd-sincronizar.json'

_trava = threading.Lock()


def _le(arq, padrao):
    try:
        with open(arq, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, type(padrao)) else padrao
    except (OSError, ValueError):
        return padrao


def _grava(arq, d):
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(tmp, os.path.realpath(arq))


def abertos(root, agora=None):
    """os projetos abertos em alguma janela desta maquina agora"""
    agora = time.time() if agora is None else agora
    out = set()
    for j in _le(os.path.join(root, DIR, ARQ_ABERTOS), {}).values():
        if isinstance(j, dict) and agora - float(j.get('quando') or 0) <= ABERTO_VALE:
            out.update(str(p) for p in j.get('projetos') or [] if p)
    return out


def registra(app, root):
    d = os.path.join(root, DIR)

    @app.route('/api/sincronia/aberto', methods=['POST'])
    def sincronia_aberto():
        b = request.get_json(silent=True) or {}
        janela = str(b.get('janela') or '')[:60]
        if not janela:
            return {'ok': False, 'error': 'falta a janela'}, 400
        projetos = [str(p) for p in (b.get('projetos') or []) if isinstance(p, str) and p and p == os.path.basename(p)][:20]
        agora = time.time()
        with _trava:
            arq = os.path.join(d, ARQ_ABERTOS)
            t = _le(arq, {})
            t = {k: v for k, v in t.items() if isinstance(v, dict) and agora - float(v.get('quando') or 0) <= ABERTO_VALE * 2}
            antes = sorted(set(p for v in t.values() for p in v.get('projetos') or []))
            if projetos:
                t[janela] = {'projetos': projetos, 'quando': agora}
            else:
                t.pop(janela, None)
            _grava(arq, t)
        depois = sorted(set(p for v in t.values() for p in v.get('projetos') or []))
        return {'ok': True, 'abertos': depois, 'mudou': antes != depois}

    @app.route('/api/sincronia/estado')
    def sincronia_estado():
        e = _le(os.path.join(d, ARQ_DESATUALIZADOS), {})
        ped = _le(os.path.join(d, ARQ_PEDIDO), {})
        return {'ok': True, 'ligado': bool(e.get('ligado')), 'quando': e.get('quando') or 0,
                'avisos': e.get('avisos') or {}, 'sincronizados': e.get('sincronizados') or {},
                'pedidos': [p.get('projeto') for p in ped.get('pedidos') or [] if isinstance(p, dict)]}

    @app.route('/api/sincronia/sincronizar', methods=['POST'])
    def sincronia_sincronizar():
        b = request.get_json(silent=True) or {}
        nome = str(b.get('projeto') or '')
        if not nome or nome != os.path.basename(nome) or nome.startswith('.') or not os.path.isdir(os.path.join(root, 'Projects', nome)):
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        pid = secrets.token_hex(6)
        with _trava:
            arq = os.path.join(d, ARQ_PEDIDO)
            t = _le(arq, {})
            ped = [p for p in t.get('pedidos') or [] if isinstance(p, dict) and p.get('projeto') != nome]
            ped.append({'projeto': nome, 'id': pid, 'quando': time.time()})
            _grava(arq, {'pedidos': ped})
        return {'ok': True, 'id': pid}
