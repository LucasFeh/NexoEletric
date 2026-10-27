# -*- coding: utf-8 -*-
"""O sincronismo com o Odoo roda no NexoBD, nao aqui (app desktop, ALTIUMHUB_NEXOBD=1; 1.29.0).

Odoo -> NexoBD -> Nexo Hub -> NexoEletric: quem puxa o Odoo e regera a biblioteca (o guardiao +
almox2lib) e o NexoBD, com as credenciais guardadas nele; a revisao nova da "Biblioteca do
NexoEletric" chega a esta pasta pelo armazem (electron/lib/armazem.js), como qualquer mudanca do
NexoBD. O hub continua chamando as mesmas rotas de sempre e este modulo as atende pelo Nexo Hub:

  POST /api/symbols/almox-sync           -> POST <hub>/api/v1/odoo/sincronizar   {runId}
  GET  /api/symbols/almox-sync/<id>/stream  SSE: as linhas do GET <hub>/api/v1/odoo/estado
  GET/POST /api/almox/config             -> GET/PUT <hub>/api/v1/odoo/config

O que fala DIRETO com o Odoo (o envio da lista de material, /api/lista/*) nao passa por aqui.
"""
import json
import time
import urllib.error
import urllib.request

import nexohub_gate

ESPERA_MAX = 900.0     # segundos: o NexoBD tem o teto dele (600 s); este so evita um stream eterno
CICLO = 1.0


def _pede(metodo, caminho, corpo=None, timeout=15):
    url, token = nexohub_gate.conexao()
    dados = json.dumps(corpo).encode('utf-8') if corpo is not None else None
    req = urllib.request.Request(url + caminho, data=dados, method=metodo,
                                 headers={'X-App': 'nexoeletric', 'Content-Type': 'application/json'})
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode('utf-8') or '{}')
        except ValueError:
            j = {}
        return e.code, j
    except Exception as e:                                   # noqa: BLE001
        return 0, {'erro': 'sem conexão com o Nexo Hub (%s)' % getattr(e, 'reason', e)}


def _erro(j, padrao):
    return (j or {}).get('erro') or (j or {}).get('error') or padrao


def _sse(evento, dados):
    txt = dados if isinstance(dados, str) else json.dumps(dados, ensure_ascii=False)
    return ('event: %s\n' % evento if evento else '') + 'data: %s\n\n' % txt.replace('\r', '').replace('\n', ' ')


def registra(app, Response, request):
    if not nexohub_gate.ligado():
        return

    @app.before_request
    def _odoo_pelo_hub():
        p = request.path
        if p == '/api/symbols/almox-sync' and request.method == 'POST':
            pull = bool((request.get_json(silent=True) or {}).get('pull'))
            st, j = _pede('POST', '/api/v1/odoo/sincronizar', {'pull': pull})
            if st == 202 and j.get('id'):
                return {'runId': j['id']}, 202
            return {'ok': False, 'error': _erro(j, 'o Nexo Hub recusou o sincronismo (HTTP %s)' % st)}, (st or 503)
        if p.startswith('/api/symbols/almox-sync/') and p.endswith('/stream'):
            run_id = p[len('/api/symbols/almox-sync/'):-len('/stream')]
            return Response(_stream(run_id), mimetype='text/event-stream')
        if p == '/api/almox/config':
            return _config()
        return None

    def _config():
        if request.method == 'POST':
            d = request.get_json(silent=True) or {}
            corpo = {k: d[k].strip() for k in ('url', 'db', 'login', 'senha')
                     if isinstance(d.get(k), str) and d[k].strip()}
            st, j = _pede('PUT', '/api/v1/odoo/config', corpo)
        else:
            st, j = _pede('GET', '/api/v1/odoo/config')
        if st != 200:
            return {'ok': False, 'error': _erro(j, 'o Nexo Hub não respondeu a configuração do Odoo (HTTP %s)' % st)}, (st or 503)
        c = j.get('config', j)
        return {'ok': True, 'config': {'url': c.get('url', ''), 'db': c.get('db', ''), 'login': c.get('login', ''),
                                       'temSenha': bool(c.get('temSenha'))},
                'local': True, 'script': True, 'noNexoHub': True}

    def _stream(run_id):
        visto = 0
        limite = time.time() + ESPERA_MAX
        yield _sse(None, 'sincronizando com o Odoo pelo Nexo Hub…')
        while time.time() < limite:
            st, e = _pede('GET', '/api/v1/odoo/estado')
            if st != 200:
                yield _sse('error', _erro(e, 'o Nexo Hub não respondeu o andamento (HTTP %s)' % st))
                return
            atual = e.get('atual') or {}
            ultimo = e.get('ultimo') or {}
            if e.get('rodando') and atual.get('id') == run_id:
                linhas = atual.get('linhas') or []
            elif ultimo.get('id') == run_id:
                linhas = ultimo.get('linhas') or []
            else:
                linhas = []
            for l in linhas[visto:]:
                yield _sse(None, str(l))
            visto = max(visto, len(linhas))
            if not e.get('rodando') or atual.get('id') != run_id:
                if ultimo.get('id') == run_id:
                    if ultimo.get('ok'):
                        yield _sse('done', {'ok': True, 'resumo': ultimo.get('resumo'), 'revisao': ultimo.get('revisao')})
                    else:
                        yield _sse('error', ultimo.get('erro') or 'o sincronismo falhou no Nexo Hub')
                    return
            time.sleep(CICLO)
        yield _sse('error', 'o sincronismo passou de %d s sem terminar' % int(ESPERA_MAX))
