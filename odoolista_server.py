# -*- coding: utf-8 -*-
"""Blueprint do envio da lista de componentes para o Odoo.

Mora fora do hubserver.py de proposito — o contrato e o mesmo do tools/symbols/symserver.py
(`bp` + `registra(app, root)`), entao o enganche no servidor cabe em duas linhas.

A senha do Odoo NUNCA atravessa a rede de volta: /api/lista/config responde so `temSenha`,
como o /api/almox/config ja faz (hubserver.py:576). O envio exige `confirmado: true` no
corpo — a contraparte de servidor da confirmacao que o modal pede, para que um POST solto
nao abra solicitacao na fila do estoque por acidente.

O POST de /config grava so de dentro do PC do servidor, pela mesma regra do almoxarifado
(hubserver.py:585): quem escolhe a credencial que o servidor usa tem que estar sentado nele.
"""
import os
import re
import socket
import threading
import time

from flask import Blueprint, request

import odoolista as OL

bp = Blueprint('lista', __name__, url_prefix='/api/lista')
ROOT = os.path.dirname(os.path.abspath(__file__))

_envio_lock = threading.Lock()   # so contra o duplo clique; di_recebe_lista ja e idempotente

LOCAL_ADDRS = ('127.0.0.1', '::1', 'localhost')


def _is_local(req):
    """A chamada partiu do PROPRIO PC do servidor? Copia de hubserver.py:230.

    Duplicada pelo mesmo motivo que le_var_js em odoolista.py:54: importar o hubserver
    daqui e circular — e ele que importa este Blueprint. Sao dez linhas e a regra e a
    mesma: comparar so com 127.0.0.1 derrubaria a aba aberta no proprio PC pela URL de
    LAN, que e a que fica favoritada.
    """
    addr = req.remote_addr
    if addr in LOCAL_ADDRS:
        return True
    try:
        return addr in set(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        return False


def registra(app, root):
    """Chamado uma vez pelo hubserver, no molde de symserver.registra (symserver.py:105)."""
    global ROOT
    ROOT = root
    app.register_blueprint(bp)


def _pasta(nome):
    """Valida o nome do projeto e devolve a pasta. Nunca aceita caminho vindo do cliente.

    O nome tem que ser IGUAL a uma entrada de Projects/, e nao apenas parecer inofensivo.
    Filtrar barra e ponto nao basta no Windows: os.path.join(ROOT, 'Projects', 'D:..') e
    relativo ao DRIVE, escapa da arvore e foi medido lendo arquivo fora de Projects/.
    """
    nome = str(nome or '').strip()
    if not nome or nome.startswith('.') or re.search(r'[\\/:]', nome):
        return None
    base = os.path.join(ROOT, 'Projects')
    try:
        if nome not in os.listdir(base):
            return None
    except OSError:
        return None
    d = os.path.join(base, nome)
    return d if os.path.isdir(d) else None


def _confere_ensaio(payload, data):
    """O que vai ser enviado e o mesmo que a pessoa viu no ensaio?

    O servidor releem o schematic.js do disco nos DOIS passos, e entre um e outro tanto a
    revisao digitada quanto o arquivo podem ter mudado (a IA tambem escreve nele). Sem esta
    conferencia o modal confirma uma lista e o Odoo recebe outra, sob outra chave de
    idempotencia -- medido: ensaio de 54 linhas, envio de 39, sem aviso nenhum.
    """
    uid = str(data.get('uid_externo') or '').strip()
    if not uid:
        return 'envio sem o ensaio: confira a lista antes de enviar'
    if uid != payload['uid_externo']:
        return ('a revisao mudou depois da conferencia (%s -> %s). Confira de novo antes de '
                'enviar: revisao diferente e outra placa no estoque.'
                % (uid.rsplit(':', 1)[-1] or '?', payload['revisao']))
    try:
        n = int(data.get('total_linhas'))
    except (TypeError, ValueError):
        return 'envio sem o ensaio: confira a lista antes de enviar'
    if n != len(payload['linhas']):
        return ('o esquema mudou depois da conferencia (%d linha(s) viraram %d). Confira de '
                'novo antes de enviar.' % (n, len(payload['linhas'])))
    return None


def _prepara(data):
    """Do corpo do POST ao payload pronto. Devolve (payload, erro, status)."""
    if not isinstance(data, dict):
        return None, 'JSON obrigatorio', 400
    nome = str(data.get('projeto') or '').strip()
    if not _pasta(nome):
        return None, 'projeto nao encontrado', 404
    rev = OL.norm_rev(data.get('revisao'))
    if not rev:
        return None, ('revisao obrigatoria — ela entra no nome da placa no Odoo e na chave '
                      'que impede o envio duplicado'), 400
    try:
        schematic = OL.le_schematic(nome, ROOT)
    except OL.ErroOdoo as e:
        return None, str(e), 404
    payload = OL.monta_payload(nome, rev, schematic, OL.carrega_acervo(ROOT),
                               str(data.get('enviado_por') or '').strip()[:60],
                               str(data.get('observacao') or '').strip()[:500])
    if not payload['linhas']:
        return None, 'o esquema nao tem componente nenhum — lista sem componente nao e lista', 400
    return payload, None, 200


def _cliente():
    """Devolve (cliente, erro). O erro ja vem na frase que a tela mostra."""
    try:
        return OL.ClienteLista(raiz=ROOT), None
    except OL.ErroOdoo as e:
        return None, str(e)


CFG_CAMPOS = ('url', 'db', 'login', 'modelo')     # o que a tela edita; a senha vai a parte

# A frase que o usuario le quando falta senha nasce em odoolista.py (ClienteLista.__init__)
# e sobe crua por /ensaio, /envio e /estado. Ela aponta para a aba de configuracao ANTES das
# outras duas saidas: editar .hub-odoo.json a mao e o unico conselho que o projetista da
# bancada nao consegue seguir -- e era tambem como se perdia a senha (odoolista.py
# » _le_json_estrito). Nao ha texto equivalente aqui: duplica-lo seria duas verdades.


def _config_resposta():
    """O corpo do GET, reaproveitado pelo POST para a tela nao ter que recarregar.

    `temSenha` sozinho MENTE, e a mentira ja esta medida do lado do almoxarifado
    (hubserver.py:579): la ele e verdadeiro quando ha ODOO_SENHA no ambiente mesmo com o
    arquivo vazio, e a tela anuncia "ha senha gravada" sobre arquivo nenhum. Quem desfaz a
    ambiguidade e `fonteSenha`: ele diz QUAL das tres fontes ganhou, e so o valor
    CFG_LISTA significa que ha senha no arquivo desta maquina.
    """
    cfg = OL.destino(ROOT)
    return {'ok': True, 'local': _is_local(request), 'arquivo': OL.CFG_LISTA, 'config': {
        'url': cfg['url'], 'db': cfg['db'], 'login': cfg['login'], 'modelo': cfg['modelo'],
        'temSenha': bool(cfg['senha']), 'fonteSenha': cfg['fonteSenha'],
        # os dois contam a MESMA historia: senha que o destino() nao usaria (nao e texto)
        # tambem nao conta como gravada -- senao a tela anuncia 'Senha gravada' enquanto o
        # envio, na mesma tela, recusa por falta de senha
        'senhaNoArquivo': OL.senha_no_arquivo(ROOT),
        # o arquivo ilegivel some da tela como se estivesse vazio; sem dizer isso, o unico
        # sinal seria o 400 depois do clique em Gravar
        'arquivoIlegivel': OL.config_ilegivel(ROOT),
    }}


@bp.route('/config', methods=['GET'])
def config():
    """Para onde o botao manda e se ha senha. A senha em si nunca sai daqui."""
    return _config_resposta()


@bp.route('/config', methods=['POST'])
def config_set():
    """Grava o destino do envio. A senha vai para .hub-odoo.json e so para la.

    Nao pode cair em /api/almox/config: aquele arquivo nao comeca por ponto e o GET dele
    responde 200 em texto claro para a LAN inteira (_serve, hubserver.py:122-123).
    """
    if not _is_local(request):
        return {'ok': False, 'error': 'as credenciais do Odoo so mudam no PC do servidor — '
                                      'esta aba esta aberta de outra maquina'}, 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON obrigatorio'}, 400
    for k in CFG_CAMPOS + ('senha',):
        if k in data and not isinstance(data[k], str):
            return {'ok': False, 'error': '%s tem que ser texto' % k}, 400
    try:
        OL.grava_destino(data, ROOT)
    except OL.ErroOdoo as e:
        # arquivo ilegivel ou apagarSenha que nao e booleano: NADA foi escrito, e a frase ja
        # vem pronta para o toast. 400 e nao 500 de proposito -- quem arruma e o usuario,
        # e a resposta tem que dizer o que arrumar
        return {'ok': False, 'error': str(e)}, 400
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar %s: %s' % (OL.CFG_LISTA, e)}, 500
    return _config_resposta()


@bp.route('/recibo', methods=['GET'])
def recibo():
    """O ultimo envio deste projeto, so do disco. Sem tocar no Odoo — pinta o botao ao abrir."""
    nome = request.args.get('projeto') or ''
    if not _pasta(nome):
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    r = OL.le_recibo(nome, ROOT)
    return {'ok': True, 'recibo': r or None,
            'revisaoSugerida': (r or {}).get('revisao') or OL.parse_revisao(nome)}


@bp.route('/previa', methods=['POST'])
def previa():
    """A lista como o HUB a monta, sem falar com o Odoo.

    O `/ensaio` faz duas coisas e so a segunda precisa de rede, de credencial e de espera:
    montar a lista e perguntar ao Odoo o que ele acha dela. Separadas, a tela abre ja com a
    lista na mao — o projetista ve o que vai mandar antes de qualquer round-trip — e o
    Conferir passa a responder uma pergunta so, que e quando a espera se justifica.

    A revisao aqui e opcional: ela nao muda nenhuma linha, so o `uid_externo`, e nada e
    enviado. Sem ela, vale o palpite do nome da pasta (`parse_revisao`), devolvido a parte
    para a tela poder preencher o campo — SUGERIR, nunca decidir: quem digita a revisao e o
    projetista, e o `/envio` continua exigindo uma de verdade.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON obrigatorio'}, 400
    nome = str(data.get('projeto') or '').strip()
    if not _pasta(nome):
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    sugerida = OL.norm_rev(OL.parse_revisao(nome))
    rev = OL.norm_rev(data.get('revisao')) or sugerida
    payload, erro, status = _prepara(dict(data, revisao=rev or 'X'))
    if erro:
        return {'ok': False, 'error': erro}, status
    return {'ok': True, 'payload': payload, 'uid_externo': payload['uid_externo'],
            'revisaoSugerida': sugerida, 'revisaoUsada': rev}


@bp.route('/ensaio', methods=['POST'])
def ensaio():
    """di_confere_lista: resolve as linhas e diz o que resolveria. NAO grava em lugar nenhum.

    Devolve tambem o payload que ELE montou — e esse, e nao o que a tela imagina, que sera
    enviado. Ler do disco e deliberado: a lista tem que sair do arquivo salvo.
    """
    payload, erro, status = _prepara(request.get_json(silent=True))
    if erro:
        return {'ok': False, 'error': erro}, status
    cliente, erro = _cliente()
    if erro:
        return {'ok': False, 'error': erro, 'semSenha': True}, 400
    try:
        recibo_odoo = cliente.confere(OL.payload_limpo(payload))
    except OL.ErroOdoo as e:
        return {'ok': False, 'error': str(e)}, 502
    return {'ok': True, 'payload': payload, 'recibo': recibo_odoo,
            'uid_externo': payload['uid_externo']}


@bp.route('/envio', methods=['POST'])
def envio():
    """di_recebe_lista: manda de verdade. Idempotente por uid_externo (spec, secao 3)."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('confirmado') is not True:
        return {'ok': False, 'error': 'envio precisa de confirmacao explicita'}, 400
    payload, erro, status = _prepara(data)
    if erro:
        return {'ok': False, 'error': erro}, status
    erro = _confere_ensaio(payload, data)
    if erro:
        return {'ok': False, 'error': erro, 'confiraDeNovo': True}, 409
    cliente, erro = _cliente()
    if erro:
        return {'ok': False, 'error': erro, 'semSenha': True}, 400
    if not _envio_lock.acquire(blocking=False):
        return {'ok': False, 'error': 'ja tem um envio rodando'}, 409
    try:
        limpo = OL.payload_limpo(payload)
        try:
            recibo_odoo = cliente.envia(limpo)
        except OL.ErroOdoo as e:
            return {'ok': False, 'error': str(e)}, 502
        gravado = ''
        try:
            gravado = OL.grava_recibo(payload['projeto'],
                                      OL.recibo_para_disco(limpo, recibo_odoo,
                                                           time.strftime('%Y-%m-%d %H:%M')),
                                      ROOT)
        except (OSError, OL.ErroOdoo):
            pass          # o envio valeu; nao guardar o recibo e chateacao, nao falha
        return {'ok': True, 'recibo': recibo_odoo, 'payload': payload,
                'uid_externo': payload['uid_externo'],
                'gravadoEm': os.path.relpath(gravado, ROOT) if gravado else ''}
    finally:
        _envio_lock.release()


@bp.route('/estado', methods=['POST'])
def estado():
    """di_estado_lista: em que pe esta o envio. Atualiza o recibo em disco se mudou."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON obrigatorio'}, 400
    nome = str(data.get('projeto') or '').strip()
    if not _pasta(nome):
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    local = OL.le_recibo(nome, ROOT)
    uid = local.get('uid_externo') or OL.uid_externo(nome, data.get('revisao'))
    if not OL.norm_rev(uid.rsplit(':', 1)[-1]):
        return {'ok': False, 'error': 'revisao obrigatoria'}, 400
    cliente, erro = _cliente()
    if erro:
        return {'ok': False, 'error': erro, 'semSenha': True}, 400
    try:
        vivo = cliente.estado(uid)
    except OL.ErroOdoo as e:
        return {'ok': False, 'error': str(e)}, 502
    if local and vivo and vivo.get('estado') and vivo['estado'] != local.get('estado'):
        local.update({k: vivo.get(k, local.get(k)) for k in
                      ('estado', 'referencia', 'linhas_pendentes', 'pendencias',
                       'produto_id', 'bom_id', 'motivo_recusa')})
        try:
            OL.grava_recibo(nome, local, ROOT)
        except (OSError, OL.ErroOdoo):
            pass
    return {'ok': True, 'recibo': vivo, 'local': local or None, 'uid_externo': uid}
