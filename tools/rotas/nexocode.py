# -*- coding: utf-8 -*-
"""Rotas /api/nexocode/*: o botao NexoCODE do esquema (hub-nexocode.js) manda o pedido de firmware ao NexoCode,
o editor de firmware da atmosfera Nexo (repositorio LucasFeh/NexoCode).

O pedido ("briefing") leva o esquema ja lido na tela (componentes com pinos e nets), as respostas das perguntas
(ja tem software? onde? o que o sistema faz? referencias) e vira um arquivo JSON em
%LOCALAPPDATA%\\NexoCode\\briefings\\. O NexoCode abre com --briefing <arquivo> (se ja estiver aberto, o pedido vai
para a janela aberta: o NexoCode e de instancia unica), monta o projeto e a IA comeca.

Rotas (so desta maquina):
  GET  /api/nexocode/estado   {ok, instalado, exe, aberto, versao}
  POST /api/nexocode/pasta    {titulo?} -> {ok, pasta}   dialogo de pasta do Windows (o software que ja existe)
  POST /api/nexocode/abrir    {briefing} -> {ok, arquivo, exe}

Para os testes: NEXOCODE_EXE aponta o executavel; NEXOCODE_NAO_ABRIR=1 grava o pedido sem abrir nada;
NEXOCODE_BRIEFINGS troca a pasta dos pedidos.

No hubserver.py:
    import nexocode as _nexocode
    _nexocode.registra(app, ROOT, _is_local)
"""
import json
import os
import re
import subprocess
import time
import urllib.request

from flask import Response, request


def _json(obj, status=200):
    return Response(json.dumps(obj, ensure_ascii=False), status=status, mimetype='application/json')


def _local_padrao(req=None):
    return (req or request).remote_addr in ('127.0.0.1', '::1', 'localhost')


def pasta_briefings():
    p = os.environ.get('NEXOCODE_BRIEFINGS')
    if not p:
        base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
        p = os.path.join(base, 'NexoCode', 'briefings')
    os.makedirs(p, exist_ok=True)
    return p


def _do_registro():
    """InstallLocation do NexoCode no desinstalador do Windows (HKCU e HKLM)."""
    if os.name != 'nt':
        return []
    try:
        import winreg
    except ImportError:
        return []
    achados = []
    for raiz in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for sub in (r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', r'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'):
            try:
                chave = winreg.OpenKey(raiz, sub)
            except OSError:
                continue
            i = 0
            while True:
                try:
                    nome = winreg.EnumKey(chave, i)
                except OSError:
                    break
                i += 1
                try:
                    k = winreg.OpenKey(chave, nome)
                    exibido = winreg.QueryValueEx(k, 'DisplayName')[0]
                    if str(exibido).strip().lower() != 'nexocode':
                        continue
                    for valor in ('InstallLocation', 'DisplayIcon'):
                        try:
                            v = str(winreg.QueryValueEx(k, valor)[0]).strip().strip('"')
                            v = re.sub(r',\d+$', '', v)
                            achados.append(v if v.lower().endswith('.exe') else os.path.join(v, 'NexoCode.exe'))
                        except OSError:
                            pass
                except OSError:
                    continue
    return achados


def acha_exe():
    """NEXOCODE_EXE > registro do desinstalador > %LOCALAPPDATA%\\Programs > Program Files."""
    cands = []
    if os.environ.get('NEXOCODE_EXE'):
        cands.append(os.environ['NEXOCODE_EXE'])
    cands += _do_registro()
    la = os.environ.get('LOCALAPPDATA')
    if la:
        cands += [os.path.join(la, 'Programs', 'NexoCode', 'NexoCode.exe'), os.path.join(la, 'Programs', 'nexocode', 'NexoCode.exe')]
    cands.append(os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), 'NexoCode', 'NexoCode.exe'))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return ''


def aberto():
    """{'aberto', 'versao'}: o NexoCode responde no servidor de controle dele (%APPDATA%\\NexoCode\\controle.json)?"""
    arq = os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'), 'NexoCode', 'controle.json')
    try:
        with open(arq, encoding='utf-8') as f:
            c = json.load(f)
        req = urllib.request.Request('http://127.0.0.1:%d/saude' % int(c['porta']), headers={'Authorization': 'Bearer %s' % c['token']})
        with urllib.request.urlopen(req, timeout=1.5) as r:
            j = json.loads(r.read().decode('utf-8'))
        return {'aberto': bool(j.get('ok')), 'versao': j.get('versao', '')}
    except (OSError, ValueError, KeyError, TypeError):
        return {'aberto': False, 'versao': ''}


def _nome_arquivo(projeto):
    base = re.sub(r'[^\w.-]+', '_', str(projeto or 'firmware'))[:60].strip('_') or 'firmware'
    return '%s-%s.json' % (time.strftime('%Y%m%d-%H%M%S'), base)


def gravar_briefing(b):
    if not isinstance(b, dict):
        raise ValueError('briefing inválido')
    b = dict(b)
    b.setdefault('versao', 1)
    b.setdefault('origemApp', 'nexoeletric')
    b['criadoEm'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    arq = os.path.join(pasta_briefings(), _nome_arquivo(b.get('projeto')))
    with open(arq, 'w', encoding='utf-8') as f:
        json.dump(b, f, ensure_ascii=False, indent=1)
    return arq


def abrir_nexocode(arquivo):
    """Abre o NexoCode com o pedido. Ja aberto: o segundo processo entrega o pedido a janela aberta e sai."""
    if os.environ.get('NEXOCODE_NAO_ABRIR') == '1':
        return ''
    exe = acha_exe()
    if not exe:
        return ''
    flags = 0
    if os.name == 'nt':
        flags = getattr(subprocess, 'DETACHED_PROCESS', 0x8) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x200)
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)   # o motor do NexoEletric roda com ela; o NexoCode precisa abrir a janela
    subprocess.Popen([exe, '--briefing', arquivo], cwd=os.path.dirname(exe), creationflags=flags, close_fds=True, env=env,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return exe


_PS_PASTA = r'''
Add-Type -AssemblyName System.Windows.Forms
$dono = New-Object System.Windows.Forms.Form
$dono.TopMost = $true; $dono.ShowInTaskbar = $false; $dono.WindowState = 'Minimized'
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:NC_TITULO
$d.ShowNewFolderButton = $true
if ($d.ShowDialog($dono) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }
'''


def escolher_pasta(titulo):
    if os.name != 'nt':
        return ''
    env = dict(os.environ)
    env['NC_TITULO'] = titulo or 'Pasta do software'
    r = subprocess.run(['powershell', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', _PS_PASTA], env=env,
                       capture_output=True, timeout=600, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return r.stdout.decode('utf-8', 'replace').strip().splitlines()[-1].strip() if r.stdout.strip() else ''


def registra(app, root, eh_local=None):
    eh_local = eh_local or _local_padrao

    @app.route('/api/nexocode/estado')
    def nexocode_estado():
        exe = acha_exe()
        a = aberto()
        return _json({'ok': True, 'instalado': bool(exe), 'exe': exe, 'aberto': a['aberto'], 'versao': a['versao']})

    @app.route('/api/nexocode/pasta', methods=['POST'])
    def nexocode_pasta():
        if not eh_local(request):
            return _json({'ok': False, 'erro': 'só desta máquina'}, 403)
        corpo = request.get_json(silent=True) or {}
        try:
            return _json({'ok': True, 'pasta': escolher_pasta(corpo.get('titulo'))})
        except (OSError, subprocess.SubprocessError) as e:
            return _json({'ok': False, 'erro': str(e)}, 500)

    @app.route('/api/nexocode/abrir', methods=['POST'])
    def nexocode_abrir():
        if not eh_local(request):
            return _json({'ok': False, 'erro': 'só desta máquina'}, 403)
        corpo = request.get_json(silent=True) or {}
        try:
            arq = gravar_briefing(corpo.get('briefing'))
        except (OSError, ValueError) as e:
            return _json({'ok': False, 'erro': str(e)}, 400)
        try:
            exe = abrir_nexocode(arq)
        except OSError as e:
            return _json({'ok': False, 'arquivo': arq, 'erro': 'não consegui abrir o NexoCode (%s)' % e}, 503)
        if not exe and os.environ.get('NEXOCODE_NAO_ABRIR') != '1':
            return _json({'ok': False, 'arquivo': arq, 'semNexoCode': True,
                          'erro': 'o NexoCode não está instalado nesta máquina — instale pelo Nexo Hub › Instaladores'}, 404)
        return _json({'ok': True, 'arquivo': arq, 'exe': exe})
