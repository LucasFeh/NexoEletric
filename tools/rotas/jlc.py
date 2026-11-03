# -*- coding: utf-8 -*-
"""Rotas /api/jlc/*: o botao "Enviar pra JLC" do visualizador de Gerber (vista PCB).

O trabalho e do mcp/lib/jlc.js -- o MESMO motor das ferramentas jlc_* do MCP: monta o .zip do
Gerber gravado em Projects/<p>/Gerber/, abre o orcamento da JLCPCB no IntegrateBrowser (o navegador
do Nexo Hub), sobe o .zip, confere as camadas, poe a quantidade e salva no carrinho. Aqui ele roda
como `node mcp/lib/jlc.js --cli`, um processo por envio, e a vista acompanha pelo /api/jlc/estado.

O node: NEXOELETRIC_NODE > o exe do app aberto (~/.nexoeletric/session.json, com
ELECTRON_RUN_AS_NODE=1 -- o NexoEletric.exe e um Node) > o `node` do PATH.

A CONTA DA JLC (pedido do dono, 2026-11-03: "na configuracao do hub, junto com a credencial do odoo,
tambem tenha a credencial da jlc ... pra serem usados no login, quando clicar em enviar pra jlc"):
e-mail e senha ficam em .hub-jlc.json, na raiz do workspace -- o ponto no nome tira o arquivo do HTTP
(hubserver.py » _serve e o statics.rs da janela Rust). A senha vai CIFRADA com a DPAPI do Windows
(CryptProtectData, escopo do usuario): so o mesmo usuario do Windows, nesta maquina, a abre; copiar o
arquivo para outro PC nao leva a senha. Sem DPAPI (fora do Windows) ela fica em texto, como a do Odoo
no .hub-odoo.json, e a configuracao diz isso. A senha nunca volta pela rota de configuracao
(so `temSenha`) e vai para o motor pela entrada padrao (nunca argumento nem variavel de ambiente).
Com ela, quando a JLC pede o login no meio do envio, o motor preenche e entra sozinho; captcha ou
senha recusada: mostra a janela do navegador e espera a pessoa entrar (ate ESPERA_LOGIN), como antes.
So desta maquina: o IntegrateBrowser e o da maquina que roda o hub.

Rotas:
  GET  /api/jlc/config                        -> {ok, local, config:{email, temSenha, protegida}}
  POST /api/jlc/config {email, senha?, apagarSenha?} (so do PC do hub) -> o mesmo; senha vazia = nao mexe
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


# ============================== a conta da JLC (.hub-jlc.json) ==============================

CFG_FILE = '.hub-jlc.json'


def _dpapi(dados, cifrar):
    """CryptProtectData / CryptUnprotectData (escopo do usuario do Windows). None fora do Windows ou se falhar."""
    if os.name != 'nt':
        return None
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]

    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    buf = ctypes.create_string_buffer(dados, len(dados))
    ent, sai = BLOB(len(dados), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), BLOB()
    CRYPTPROTECT_UI_FORBIDDEN = 0x01
    fn = crypt32.CryptProtectData if cifrar else crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(ent), None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(sai))
    if not ok:
        return None
    try:
        return ctypes.string_at(sai.pbData, sai.cbData)
    finally:
        kernel32.LocalFree(sai.pbData)


def _cfg_path(root):
    return os.path.join(root, CFG_FILE)


def le_cfg(root):
    """O .hub-jlc.json cru ({} se nao existe; {'ilegivel': True} se nao e JSON)."""
    try:
        with open(_cfg_path(root), encoding='utf-8') as f:
            c = json.load(f)
        return c if isinstance(c, dict) else {'ilegivel': True}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {'ilegivel': True}


def credencial(root):
    """(email, senha) para o login, ou (email, None) sem senha (ou se a DPAPI nao abre: outro usuario/PC)."""
    import base64
    c = le_cfg(root)
    email = str(c.get('email') or '').strip()
    if c.get('senhaDpapi'):
        try:
            claro = _dpapi(base64.b64decode(c['senhaDpapi']), False)
        except (ValueError, TypeError):
            claro = None
        return email, (claro.decode('utf-8') if claro else None)
    s = c.get('senha')
    return email, (str(s) if s else None)


def _grava_cfg(root, cfg):
    alvo = os.path.realpath(_cfg_path(root))
    tmp = alvo + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, alvo)


def _resumo(root):
    c = le_cfg(root)
    email, senha = credencial(root)
    tem = bool(c.get('senhaDpapi') or c.get('senha'))
    return {'email': email, 'temSenha': tem, 'protegida': bool(c.get('senhaDpapi')),
            'senhaAbre': bool(senha), 'arquivoIlegivel': bool(c.get('ilegivel')), 'arquivo': CFG_FILE}


def eh_electron(exe):
    """O exe e um Electron (roda como Node com ELECTRON_RUN_AS_NODE)? O Electron tem o icudtl.dat do lado; a janela
    Rust (resources\\rust\\NexoEletric.exe, 1.54.0+) nao tem, nao e um Node e ignora os argumentos: chamada para
    rodar o jlc.js, ela nao rodava nada e o "Enviar pra JLC" parava sem abrir o site (1.56.2)."""
    d = os.path.dirname(exe)
    return os.path.isfile(exe) and (os.path.isfile(os.path.join(d, 'icudtl.dat')) or os.path.isfile(os.path.join(d, 'v8_context_snapshot.bin')))


def _electrons_do_app(exe):
    """Os Electron candidatos a partir de um exe do app: ele mesmo, e o da instalacao quando ele e a janela Rust
    (<instalacao>\\resources\\rust\\NexoEletric.exe -> <instalacao>\\NexoEletric.exe)."""
    if not exe:
        return []
    d = os.path.dirname(os.path.abspath(exe))
    return [exe, os.path.join(os.path.dirname(os.path.dirname(d)), 'NexoEletric.exe')]


def acha_node():
    """[comando, env extra] do Node que roda o motor, ou (None, motivo). Ordem: NEXOELETRIC_NODE > o Electron do app
    aberto (~/.nexoeletric/session.json; se ele for a janela Rust, o Electron da mesma instalacao) > o Electron
    instalado > o `node` do PATH."""
    cands = []
    exe = os.environ.get('NEXOELETRIC_NODE')
    if exe and os.path.basename(exe).lower() in ('node', 'node.exe') and os.path.isfile(exe):
        return [exe], {}
    if exe:
        cands += _electrons_do_app(exe)
    try:
        with open(os.path.join(os.path.expanduser('~'), '.nexoeletric', 'session.json'), encoding='utf-8') as f:
            s = json.load(f)
        cands += _electrons_do_app(s.get('exe'))
    except (OSError, ValueError, AttributeError):
        pass
    cands.append(r'C:\Program Files\NexoEletric\NexoEletric.exe')
    if os.environ.get('LOCALAPPDATA'):
        cands.append(os.path.join(os.environ['LOCALAPPDATA'], 'Programs', 'NexoEletric', 'NexoEletric.exe'))
    for c in cands:
        if c and eh_electron(c):
            return [c], {'ELECTRON_RUN_AS_NODE': '1'}
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
                   'mostrar': True, 'esperaLogin': ESPERA_LOGIN,
                   # no carrinho, a guia do envio fecha sozinha (e o IntegrateBrowser, se era a unica guia)
                   'fecharNoFim': True}
        # a conta gravada na configuracao do hub: vai so pela entrada padrao do motor, nunca no job
        email, senha = credencial(root)
        if email and senha:
            entrada['usuario'], entrada['senha'] = email, senha
        threading.Thread(target=_roda, args=(job, node + [motor, '--cli'], env, entrada, root), daemon=True).start()
        return _json({'ok': True, 'job': jid})

    @app.route('/api/jlc/config', methods=['GET'])
    def jlc_config_ler():
        return _json({'ok': True, 'local': bool(eh_local(request)), 'config': _resumo(root)})

    @app.route('/api/jlc/config', methods=['POST'])
    def jlc_config_gravar():
        if not eh_local(request):
            return _json({'ok': False, 'error': 'a conta da JLC so muda no PC do hub'}, 403)
        data = request.get_json(silent=True) or {}
        atual = le_cfg(root)
        if atual.get('ilegivel'):
            return _json({'ok': False, 'error': CFG_FILE + ' nao e um JSON valido: arrume ou apague o arquivo antes'}, 409)
        cfg = {k: v for k, v in atual.items() if k in ('email', 'senha', 'senhaDpapi')}
        if 'email' in data:
            email = str(data.get('email') or '').strip()
            if len(email) > 200 or any(c in email for c in '\r\n\t'):
                return _json({'ok': False, 'error': 'e-mail invalido'}, 400)
            cfg['email'] = email
        if data.get('apagarSenha'):
            cfg.pop('senha', None)
            cfg.pop('senhaDpapi', None)
        elif data.get('senha'):
            import base64
            s = str(data['senha'])
            if len(s) > 500:
                return _json({'ok': False, 'error': 'senha comprida demais'}, 400)
            cif = _dpapi(s.encode('utf-8'), True)
            cfg.pop('senha', None)
            cfg.pop('senhaDpapi', None)
            if cif:
                cfg['senhaDpapi'] = base64.b64encode(cif).decode('ascii')
            else:
                cfg['senha'] = s          # sem DPAPI (fora do Windows): como a do Odoo, no arquivo com ponto
        _grava_cfg(root, cfg)
        return _json({'ok': True, 'local': True, 'config': _resumo(root)})

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
