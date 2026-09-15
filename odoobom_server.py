# -*- coding: utf-8 -*-
"""Blueprint da lista de materiais do Odoo sobre o esquema — SO LEITURA.

Mora fora do hubserver.py pelo mesmo contrato do `odoolista_server.py` e do
`tools/symbols/symserver.py` (`bp` + `registra(app, root)`), entao o enganche cabe em duas
linhas.

    GET /api/bom-odoo/pcbs?projeto=X        as PCBs do Odoo que casam com o nome do projeto
    GET /api/bom-odoo/lista?projeto=X&bom=N a BoM casada com os componentes do esquema

NENHUMA ROTA GRAVA. Este lado so le: o Odoo (mrp.bom), o espelho do almoxarifado e o
schematic.js do projeto. Quem escreve no esquema e a vista, pelo caminho normal do commit —
e por isso nao ha POST aqui. A credencial e a do sincronismo do almoxarifado
(`hub-almox.json`, via `odoo_pull.le_config`), escolha do usuario; a senha NUNCA volta pela
rede, nem em erro: `/config` responde so `temSenha`, como o /api/almox/config ja faz.

O Odoo pode estar fora do ar, lento ou sem a base — e ai a resposta e `{ok:false, error}`
com o motivo legivel, nunca um 500 cru: a tela escreve esse texto na lista e a pessoa le.
"""
import os
import sys
import threading

from flask import Blueprint, request

bp = Blueprint('bomodoo', __name__, url_prefix='/api/bom-odoo')
ROOT = os.path.dirname(os.path.abspath(__file__))

# Uma conversa com o Odoo por vez. Duas telas abertas (ou dois cliques seguidos) abririam
# duas sessoes XML-RPC e o autenticar do Odoo e a parte cara; a fila aqui custa a espera e
# evita a conexao dobrada.
_lock = threading.Lock()


def _erro(msg, code=400):
    return {'ok': False, 'error': msg}, code


def _mod():
    """importa o odoobom da raiz do workspace, ja apontado para a raiz certa"""
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    import odoobom
    odoobom.RAIZ = ROOT
    return odoobom


def _projeto_valido(nome):
    """o nome vem da URL e vira caminho: recusa o que subir de pasta ou escapar do Projects"""
    if not nome or not nome.strip():
        return 'informe o projeto'
    if '..' in nome or '/' in nome or '\\' in nome:
        return 'nome de projeto invalido'
    if not os.path.isdir(os.path.join(ROOT, 'Projects', nome)):
        return 'o projeto "%s" nao esta em Projects\\' % nome
    return None


@bp.route('/config', methods=['GET'])
def api_config():
    """de qual Odoo a tela vai ler, e se ha senha — a senha em si NUNCA sai daqui."""
    try:
        B = _mod()
        sys.path.insert(0, os.path.join(ROOT, 'tools', 'almox'))
        import odoo_pull as OP
        cfg = OP.le_config()
        return {'ok': True, 'url': cfg.get('url', ''), 'db': cfg.get('db', ''),
                'login': cfg.get('login', ''), 'temSenha': bool(cfg.get('senha')),
                'espelho': bool(B.carrega_espelho(ROOT)[0])}
    except Exception as e:                                # noqa: BLE001
        return _erro('nao consegui ler a configuracao do Odoo: %s' % e, 500)


@bp.route('/pcbs', methods=['GET'])
def api_pcbs():
    """as PCBs do Odoo que casam com o nome do projeto, a "(Montada)" com BoM na frente.

    Devolve TODAS as candidatas em vez de escolher sozinho: no projeto medido o nome casa
    com quatro produtos — a Montada, a Virgem e uma variante `_32S` — e ler a BoM da placa
    errada e o erro mais caro desta tela."""
    projeto = (request.args.get('projeto') or '').strip()
    ruim = _projeto_valido(projeto)
    if ruim:
        return _erro(ruim)
    B = _mod()
    try:
        with _lock:
            o, cfg = B.conecta()
            pcbs = B.pcbs_do_projeto(o, projeto)
    except Exception as e:                                # noqa: BLE001
        return _erro('nao consegui falar com o Odoo (%s): %s' % (type(e).__name__, e), 502)
    return {'ok': True, 'projeto': projeto, 'url': cfg.get('url', ''), 'pcbs': pcbs}


@bp.route('/lista', methods=['GET'])
def api_lista():
    """a BoM escolhida, casada com os grupos do esquema.

    O corpo e o que a tela desenha: `sugestoes` (com a confianca e a razao de cada uma),
    `descartes` (o que nao e componente de folha) e `semLinha` — os grupos do esquema que a
    BoM nao menciona. Sem essa terceira lista, quem aplica ve sete componentes migrados de
    vinte e um e conclui que a ferramenta falhou."""
    projeto = (request.args.get('projeto') or '').strip()
    ruim = _projeto_valido(projeto)
    if ruim:
        return _erro(ruim)
    try:
        bom_id = int(request.args.get('bom') or 0)
    except ValueError:
        bom_id = 0
    if bom_id <= 0:
        return _erro('informe qual BoM (bom=<id>)')
    B = _mod()
    try:
        with _lock:
            o, cfg = B.conecta()
            linhas = B.linhas_da_bom(o, bom_id)
    except Exception as e:                                # noqa: BLE001
        return _erro('nao consegui ler a lista de materiais (%s): %s' % (type(e).__name__, e), 502)
    if not linhas:
        return _erro('a BoM %d nao tem linha nenhuma' % bom_id)
    try:
        r = B.monta(ROOT, projeto, linhas)
    except OSError as e:
        return _erro('nao consegui ler o projeto: %s' % e, 500)
    r['ok'] = True
    r['bom'] = bom_id
    r['url'] = cfg.get('url', '')
    r['linhas'] = linhas
    return r


def registra(app, root):
    global ROOT
    ROOT = root
    app.register_blueprint(bp)
