# -*- coding: utf-8 -*-
"""POST /api/board-novo: grava o board.js MESTRE de uma placa que nasce no hub.

Corpo: {proj, conteudo}. `proj` e o nome da pasta em Projects/ (criada se nao existe);
`conteudo` e o texto do board.js ("var pcbmirror = {...};", o HubPcbNova.serializa).

Regras (o board.js do Altium e espelho e NUNCA e sobrescrito por aqui):
  - o conteudo tem de ser placa mestra: exporter "EletricHUB" e master:true;
  - Projects/<proj>/board.js nao existe -> cria (e a pasta, e um changes.js vazio se faltar);
  - existe e e mestre (master:true) -> sobrescreve, guardando o anterior em board.js.bak
    (e o "consolidar" da placa mestra: o changes.js assado no board.js);
  - existe e NAO e mestre (espelho do ExportBoard / pcbdoc2board) -> 409, nada gravado.
O nome da pasta vem do navegador e vira caminho no disco: um nome so, sem separador, sem o que o
Windows le como outra coisa (CON, NUL, COM1..., ponto ou espaco no fim) e sem colidir, por caixa,
com uma pasta que ja existe com outra grafia.

Para o hubserver.py (o integrador faz isto; este arquivo nao importa o hubserver):

    sys.path.insert(0, os.path.join(ROOT, 'tools', 'rotas'))
    import board_novo
    board_novo.registra(app, lambda: ROOT)

A gravacao cai dentro de Projects/, que o vigia do hubserver acompanha: as paginas abertas
recarregam com a placa nova -- e o que se quer (a vista PCB passa a mostrar o board.js mestre).
"""
import json
import os
import re

BOARD = 'board.js'
CHANGES = 'changes.js'
MAX_BYTES = 20 * 1024 * 1024
EXPORTER = 'EletricHUB'
CHANGES_VAZIO = ('// AltiumPCBMirror - arquivo de mudancas.\n'
                 '// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.\n'
                 'var changes = [\n];\n')

_PROIBIDO = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVADO = re.compile(r'^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$', re.I)


def nome_ruim(proj):
    """Por que `proj` nao pode ser nome de pasta de projeto, ou '' se pode."""
    if not isinstance(proj, str) or not proj.strip():
        return 'falta o nome do projeto'
    if len(proj) > 120:
        return 'nome comprido demais (120 caracteres)'
    if proj.startswith('.') or proj != proj.strip() or proj.endswith('.'):
        return 'nome nao pode comecar com ponto nem terminar com ponto ou espaco'
    if _PROIBIDO.search(proj):
        return 'nome com caractere proibido (< > : " / \\ | ? * ou controle)'
    if _RESERVADO.match(proj):
        return 'nome reservado do Windows'
    return ''


def le_var(texto):
    """O valor de um arquivo "var X = {...};" (o mesmo jeito do load_var_file do hubserver)."""
    s = re.sub(r'^\s*//[^\n]*\n', '', texto, flags=re.M)
    i = s.find('=')
    if i < 0:
        raise ValueError('sem "var X ="')
    s = s[i + 1:].strip().rstrip(';').strip()
    s = re.sub(r',\s*([\]}])', r'\1', s)
    return json.loads(s)


def eh_mestre(b):
    return isinstance(b, dict) and b.get('master') is True


def _grava(caminho, texto):
    tmp = caminho + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)
    os.replace(tmp, os.path.realpath(caminho))     # segue o symlink do deploy (test_symlink_sobrevive)


def board_novo(raiz, dados):
    """(resposta, status http). Toda a regra mora aqui, sem Flask, para o teste chamar direto."""
    if not isinstance(dados, dict):
        return {'ok': False, 'error': 'JSON {proj, conteudo} obrigatorio'}, 400
    proj, conteudo = dados.get('proj'), dados.get('conteudo')
    motivo = nome_ruim(proj)
    if motivo:
        return {'ok': False, 'error': motivo}, 400
    if not isinstance(conteudo, str) or not conteudo.strip():
        return {'ok': False, 'error': 'falta o conteudo do board.js'}, 400
    if len(conteudo.encode('utf-8')) > MAX_BYTES:
        return {'ok': False, 'error': 'board.js grande demais (o limite e %d MB)' % (MAX_BYTES // 2 ** 20)}, 413
    if not conteudo.lstrip().startswith('var pcbmirror'):
        return {'ok': False, 'error': 'conteudo nao e um board.js ("var pcbmirror = {...};")'}, 400
    try:
        novo = le_var(conteudo)
    except (ValueError, json.JSONDecodeError) as e:
        return {'ok': False, 'error': 'board.js invalido: %s' % e}, 400
    if not eh_mestre(novo) or novo.get('exporter') != EXPORTER:
        return {'ok': False, 'error': 'so placa mestra do hub (exporter "EletricHUB" e master:true)'}, 400
    bd = novo.get('board')
    if not isinstance(bd, dict) or not isinstance(bd.get('outline'), list) or not bd['outline']:
        return {'ok': False, 'error': 'placa sem contorno (board.outline)'}, 400

    pdir = os.path.join(raiz, 'Projects')
    try:
        existentes = os.listdir(pdir)
    except OSError:
        return {'ok': False, 'error': 'pasta Projects/ nao encontrada'}, 500
    # a pasta e a que o listdir da, nunca o que veio do cliente montado a mao
    if proj not in existentes and any(n.lower() == proj.lower() for n in existentes):
        return {'ok': False, 'error': 'ja existe um projeto com esse nome em outra grafia'}, 409
    d = os.path.join(pdir, proj)
    criou_pasta = False
    if proj in existentes:
        if not os.path.isdir(d):
            return {'ok': False, 'error': 'existe um arquivo com esse nome em Projects/'}, 409
    else:
        try:
            os.mkdir(d)
        except OSError as e:
            return {'ok': False, 'error': 'nao consegui criar a pasta: %s' % e}, 500
        criou_pasta = True

    alvo = os.path.join(d, BOARD)
    sobrescreveu = False
    if os.path.exists(alvo):
        try:
            with open(alvo, encoding='utf-8', errors='replace') as f:
                atual_txt = f.read()
            atual = le_var(atual_txt)
        except (OSError, ValueError, json.JSONDecodeError):
            return {'ok': False, 'error': 'o board.js que esta la nao e legivel -- nao sobrescrevo'}, 409
        if not eh_mestre(atual):
            return {'ok': False, 'error': 'o board.js do projeto e espelho do Altium (sem master:true): '
                                          'nao sobrescrevo -- edite pelo changes.js'}, 409
        try:
            _grava(alvo + '.bak', atual_txt)
        except OSError as e:
            return {'ok': False, 'error': 'falha ao guardar o board.js.bak: %s' % e}, 500
        sobrescreveu = True
    try:
        _grava(alvo, conteudo)
        ch = os.path.join(d, CHANGES)
        if not os.path.exists(ch):
            _grava(ch, CHANGES_VAZIO)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    return {'ok': True, 'proj': proj, 'criouPasta': criou_pasta, 'sobrescreveu': sobrescreveu,
            'caminho': 'Projects/%s/%s' % (proj, BOARD)}, 200


def registra(app, raiz_fn):
    """Liga a rota no Flask do hubserver. raiz_fn() devolve a raiz do workspace (o ROOT)."""
    from flask import request

    def api_board_novo():
        request.max_content_length = MAX_BYTES + 1024 * 1024
        try:
            dados = request.get_json(silent=True)
        except Exception:  # RequestEntityTooLarge
            return {'ok': False, 'error': 'board.js grande demais'}, 413
        return board_novo(raiz_fn(), dados)

    app.add_url_rule('/api/board-novo', 'api_board_novo', api_board_novo, methods=['POST'])
    return api_board_novo
