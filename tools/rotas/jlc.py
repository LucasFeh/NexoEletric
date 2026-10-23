# -*- coding: utf-8 -*-
"""Rotas /api/jlc/*: o botao "Enviar pra JLC" do visualizador de Gerber (vista PCB).

O trabalho e do mcp/lib/jlc.js -- o MESMO motor das ferramentas jlc_* do MCP: monta o .zip do
Gerber gravado em Projects/<p>/Gerber/, abre o orcamento da JLCPCB no IntegrateBrowser (o navegador
do Nexo Hub), sobe o .zip, confere as camadas, poe a quantidade e salva no carrinho. Aqui ele roda
como `node mcp/lib/jlc.js --cli`, um processo por envio, e a vista acompanha pelo /api/jlc/estado.

O node: NEXOELETRIC_NODE > o exe do app aberto (~/.nexoeletric/session.json, com
ELECTRON_RUN_AS_NODE=1 -- o NexoEletric.exe e um Node) > o `node` do PATH.

Sem login na JLC o motor mostra a janela do navegador e espera a pessoa entrar (ate ESPERA_LOGIN);
a senha nunca passa por aqui. So desta maquina: o IntegrateBrowser e o da maquina que roda o hub.

Rotas:
  POST /api/jlc/enviar  {proj, quantidade}   -> {ok, job}
  GET  /api/jlc/estado?job=<id>              -> {ok, fim, passos:[...], preparado?, resultado?, erro?}
  POST /api/jlc/cancelar {job}               -> {ok}: mata o envio (a vista chama ao ser fechada no meio,
                                                pelo sendBeacon; o motor tambem sai sozinho se o hub morrer)

No hubserver.py:

    sys.path.insert(0, os.path.join(ROOT, 'tools', 'rotas'))
    import jlc
    jlc.registra(app, ROOT, _is_local)
"""
import json
import os
import shutil
import subprocess
import threading
import time
import uuid

from flask import request

ESPERA_LOGIN = 5 * 60 * 1000          # ms: o tempo da pessoa entrar na conta pela janela
JOBS = {}
_lock = threading.Lock()


def _json(obj, status=200):
    return obj, status


def acha_node():
    """[comando, env extra] do Node que roda o motor, ou (None, motivo)."""
    exe = os.environ.get('NEXOELETRIC_NODE')
    if exe and os.path.isfile(exe):
        return [exe], {'ELECTRON_RUN_AS_NODE': '1'}
    try:
        with open(os.path.join(os.path.expanduser('~'), '.nexoeletric', 'session.json'), encoding='utf-8') as f:
            s = json.load(f)
        if s.get('exe') and os.path.isfile(s['exe']):
            return [s['exe']], {'ELECTRON_RUN_AS_NODE': '1'}
    except (OSError, ValueError):
        pass
    n = shutil.which('node')
    if n:
        return [n], {}
    return None, 'nao achei o Node (abra pelo app NexoEletric ou instale o Node)'


def _projeto(root, proj):
    """A pasta do projeto, comparada com o listdir (nunca montada com o que veio do cliente)."""
    pdir = os.path.join(root, 'Projects')
    try:
        achou = isinstance(proj, str) and not proj.startswith('.') and proj in os.listdir(pdir)
    except OSError:
        achou = False
    return os.path.join(pdir, proj) if achou else None


def _roda(job, cmd, env, entrada, cwd):
    try:
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=env, cwd=cwd, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        with _lock:
            job['proc'] = p
        p.stdin.write(json.dumps(entrada).encode('utf-8'))
        p.stdin.close()
        for linha in p.stdout:
            try:
                m = json.loads(linha.decode('utf-8', 'replace'))
            except ValueError:
                continue
            with _lock:
                if 'progresso' in m:
                    job['passos'].append(m['progresso'])
                elif 'preparado' in m:
                    job['preparado'] = m['preparado']
                elif 'fim' in m:
                    job['resultado'] = m['fim']
                elif 'erro' in m:
                    job['erro'] = m['erro']
        p.wait()
        if job.get('cancelado'):
            job['erro'] = 'envio cancelado'
        elif p.returncode and not job.get('erro') and not job.get('resultado'):
            err = p.stderr.read().decode('utf-8', 'replace')[-600:]
            job['erro'] = 'o envio parou (%s)' % (err.strip() or 'codigo %d' % p.returncode)
        p.stdout.close()
        p.stderr.close()
    except Exception as e:          # noqa: BLE001
        job['erro'] = 'nao consegui rodar o envio: %s' % e
    finally:
        job['fim'] = True


def registra(app, root, eh_local=None):
    eh_local = eh_local or (lambda req: req.remote_addr in ('127.0.0.1', '::1'))
    motor = os.path.join(root, 'mcp', 'lib', 'jlc.js')

    @app.route('/api/jlc/enviar', methods=['POST'])
    def jlc_enviar():
        if not eh_local(request):
            return _json({'ok': False, 'error': 'o envio a JLC usa o navegador desta maquina: abra a vista no PC do hub'}, 403)
        data = request.get_json(silent=True) or {}
        d = _projeto(root, data.get('proj'))
        if not d:
            return _json({'ok': False, 'error': 'projeto nao encontrado'}, 404)
        if not os.path.isfile(os.path.join(d, 'Gerber', 'gerber.json')):
            return _json({'ok': False, 'error': 'o projeto ainda nao tem Gerber salvo'}, 409)
        try:
            qtd = int(data.get('quantidade'))
        except (TypeError, ValueError):
            return _json({'ok': False, 'error': 'quantidade invalida'}, 400)
        node, extra = acha_node()
        if node is None:
            return _json({'ok': False, 'error': extra}, 500)
        env = dict(os.environ)
        env.update(extra)
        jid = uuid.uuid4().hex[:12]
        job = {'id': jid, 'proj': data.get('proj'), 'quantidade': qtd, 'inicio': time.time(),
               'passos': [], 'fim': False}
        with _lock:
            for k in [k for k, j in JOBS.items() if j.get('fim') and time.time() - j['inicio'] > 3600]:
                del JOBS[k]
            JOBS[jid] = job
        entrada = {'gdir': os.path.join(d, 'Gerber'), 'quantidade': qtd, 'nome': data.get('proj'),
                   'mostrar': True, 'esperaLogin': ESPERA_LOGIN}
        threading.Thread(target=_roda, args=(job, node + [motor, '--cli'], env, entrada, root), daemon=True).start()
        return _json({'ok': True, 'job': jid})

    @app.route('/api/jlc/cancelar', methods=['POST'])
    def jlc_cancelar():
        if not eh_local(request):
            return _json({'ok': False, 'error': 'so desta maquina'}, 403)
        data = request.get_json(silent=True, force=True) or {}
        with _lock:
            job = JOBS.get(str(data.get('job', '')))
            if not job:
                return _json({'ok': False, 'error': 'envio nao encontrado'}, 404)
            if job['fim']:
                return _json({'ok': True, 'fim': True})
            job['cancelado'] = True
            p = job.get('proc')
        if p is not None:
            try:
                p.kill()
            except OSError:
                pass
        return _json({'ok': True})

    @app.route('/api/jlc/estado')
    def jlc_estado():
        with _lock:
            job = JOBS.get(request.args.get('job', ''))
            if not job:
                return _json({'ok': False, 'error': 'envio nao encontrado'}, 404)
            return _json({'ok': True, 'fim': job['fim'], 'passos': list(job['passos']),
                          'preparado': job.get('preparado'), 'resultado': job.get('resultado'),
                          'erro': job.get('erro')})
