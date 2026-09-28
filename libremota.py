# -*- coding: utf-8 -*-
"""AltiumPCBMirror - libremota.py
Modo "biblioteca remota" do hub: o servidor e a UNICA biblioteca.

Ligado por ALTIUMHUB_LIB_REMOTA=<url do hub central> (o app desktop passa a url do
servidor). Sem a variavel nada aqui age: o before_request devolve None e o status responde
{"modo":"local"}. O servidor de producao nunca a define -- o codigo e um so para web e
desktop, e um hub que se chamasse a si mesmo entraria em laco (ver CAB_REPASSE).

O que o modo faz:

- REPASSA ao servidor tudo o que grava ou le a biblioteca: /api/symbols/* (qualquer
  metodo, streams SSE inclusive, evento a evento), /api/almox/config (as credenciais do
  Odoo que valem sao as do servidor) e o POST /api/save de Libs/lib-subs.js. O /api/save de
  projeto continua local: projeto e desta maquina. O GET /Libs/lib-subs.js traz o arquivo do
  servidor para o espelho antes de servi-lo, e o POST so segue se a pagina leu a versao do
  servidor: a troca de substituicao e ler-alterar-gravar do arquivo inteiro.
- NAO REPASSA pedido com Host fora do TRUSTED_HOSTS (o anti DNS rebinding do hubserver).
- RECUSA a rota legada /api/almox/sync (409): ela roda o almox2lib cru, sem guardiao, e
  aqui numeraria o almoxarifado numa segunda autoridade -- o que o modo existe para acabar.
- ESPELHA em Libs/ os arquivos do topo que o hub, as vistas e os leitores Python (odoolista,
  chat, indice, BuildSchematic via home.txt) leem do disco. GET condicional por ETag; .js
  so entra se for dado puro (porte do recusaDeDado do electron/lib/import-server.js); o que
  era local e o servidor nao tem vai para um backup antes de ser sobrescrito. A recarga das
  paginas continua sendo o _watcher do hubserver: gravar o espelho muda o mtime.
- SEM SERVIDOR: GET cai no handler local (le o espelho, a ultima copia); POST recebe 503 e
  nada e gravado. A biblioteca abre so para leitura, nunca diverge.

Libs/Almox/* fica FORA do espelho: sao as .SchLib que o Altium le (63 MB so a PcbLib) e
continuam vindo pelo "Importar do servidor" > almoxLibs do app.
"""
import hashlib
import http.client
import json
import os
import re
import shutil
import threading
import time
import urllib.parse

from flask import Response, request
from werkzeug.exceptions import SecurityError

# Os arquivos do topo de Libs/ que alguem nesta maquina le do disco. A ordem e a de
# importancia para a tela: se o servidor cair no meio, o que a pagina desenha ja chegou.
ARQUIVOS = (
    'schlib.js', 'symbols-lib.js', 'lib-subs.js', 'rename-map.js', 'pcblib.js',
    'almox-basicos.js', 'almox-especiais.js', 'almox-index.js', 'almox-sync.js',
    'almox-guardiao.js', 'almox-parts.json', 'lib-ledger.json', 'almox-excluidos.json',
    'libs-report.txt', 'BIBLIOTECA DE ESQUEMA.SchLib',
)

# Mesma lista do electron/lib/import-server.js (VARS_DE_DADOS). Os .js do espelho rodam com
# <script src> na origem do hub LOCAL, que le o hub-almox.json desta maquina e fala com o
# chat; e o /api/save do servidor grava Libs/lib-subs.js sem senha. O nome e fixo de
# proposito: `var location = "javascript:..."` e JSON valido depois do "=".
VARS_DE_DADOS = frozenset((
    'pcbmirror', 'schematic', 'changes', 'annotations', 'schlib', 'pcblib', 'symbolsLib',
    'renameMap', 'libSubs', 'projects', 'almoxIndex', 'almoxSync', 'almoxBasicos',
    'almoxEspeciais', 'almoxGuardiao'))

CFBF = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'   # assinatura de todo .SchLib (OLE/CFBF)

T_CONEXAO = 3.0      # s: servidor fora tem de aparecer logo, nao depois de um minuto
T_GET = 60.0         # s por leitura de socket no refresh (nao e o total do arquivo)
T_POST = 300.0       # s: o /almox-aplicar reescreve varias .SchLib no servidor
T_STREAM = 3700.0    # s: o extract tem teto de 3600 s (symserver.EXTRACT_TIMEOUT)
T_EVENTOS = 45.0     # s sem nada no /__events (o keep-alive vem a cada 15 s) = conexao morta
T_RETESTE = 10.0     # s: com o servidor fora e sem as threads, GET vai direto ao local neste intervalo
PERIODO = 60.0       # s: rede de seguranca se o /__events perder um aviso
DEBOUNCE = 1.0       # s: um sincronismo muda varios arquivos em rajada
BACKOFF_MAX = 10.0   # s: e o /__events que percebe o servidor voltando; mais que isso a tela demora
MAX_BACKUPS = 50

# Posto no pedido repassado. Um hub que recebe um pedido com isto atende LOCAL: se a
# variavel apontar por engano para o proprio hub (ou para outro desktop em modo remoto), o
# repasse para no primeiro salto em vez de prender uma thread por salto ate o hub travar.
CAB_REPASSE = 'X-EletricHUB-Repasse'

FORA = ('O servidor da biblioteca (%s) nao respondeu. Sem ele a biblioteca fica so para '
        'leitura: nada foi gravado.')
VERSAO = ('o hub do servidor ainda nao tem %s: ele roda uma versao mais antiga que a deste '
          'app. Atualize o hub do servidor e tente de novo.')
LEGADO = ('no desktop a biblioteca e a do servidor; sincronize pelo botao Sincronizar '
          'almoxarifado')
CORTOU = ('O servidor da biblioteca (%s) nao terminou de responder (%s). Confira no hub do '
          'servidor se a gravacao aconteceu antes de repetir.')
MUDOU = ('As substituicoes (Libs/lib-subs.js) mudaram no servidor depois que esta pagina as '
         'leu: outro PC gravou. Nada foi gravado; a biblioteca recarrega com a versao do '
         'servidor, refaca a escolha.')

LIB_SUBS_NOME = 'lib-subs.js'
LIB_SUBS = 'Libs/' + LIB_SUBS_NOME     # o unico arquivo de Libs/ que a pagina le e grava inteiro


class Fora(Exception):
    """O servidor nao atendeu: conexao recusada, nome que nao resolve, timeout de conexao."""


def _log(msg):
    # No Windows o stdout do hub e um pipe em cp1252 (o app desktop o le). A mensagem do
    # sistema vem acentuada e o nome de arquivo pode trazer qualquer coisa: um caractere fora
    # da pagina de codigo derrubaria a thread que imprime, entao ele vira '?'.
    linha = 'lib-remota: ' + msg
    try:
        print(linha, flush=True)
    except UnicodeEncodeError:
        print(linha.encode('ascii', 'replace').decode('ascii'), flush=True)


def _agora():
    return time.strftime('%Y-%m-%d %H:%M:%S')


def _sha1(dados):
    return hashlib.sha1(dados).hexdigest()


def _motivo(e):
    return str(e) or type(e).__name__          # socket.timeout() sai com texto vazio


def _le(caminho):
    try:
        with open(caminho, 'rb') as f:
            return f.read()
    except OSError:
        return None


def normaliza_url(bruto):
    """A url do hub central sem barra no fim, ou None (e o hub fica local).

    Recusa o que nao for http(s)://host: um valor torto na variavel nao pode virar um modo
    remoto que falha em cada pedido -- o hub sobe local e o log diz por que.
    """
    s = (bruto or '').strip().rstrip('/')
    if not s:
        return None
    try:
        p = urllib.parse.urlsplit(s)
        p.port                                  # porta nao numerica levanta aqui
    except ValueError:
        p = None
    if p is None or p.scheme not in ('http', 'https') or not p.hostname or p.query or p.fragment:
        _log('ALTIUMHUB_LIB_REMOTA=%r nao e uma url http(s)://; a biblioteca fica LOCAL.' % bruto)
        return None
    return s


def recusa(nome, dados):
    """'' se o arquivo pode entrar no espelho; senao, o motivo. Porte do recusaDeDado."""
    if nome.endswith('.js'):
        s = dados.decode('utf-8', 'replace')
        s = re.sub(r'^\ufeff', '', s)
        # O comentario // do JS acaba em \n, \r, U+2028 ou U+2029, e nao so no \n: com
        # "// nota\rwindow.x=1" o navegador executa o que vem depois do \r. Por isso a linha so
        # sai inteira quando o comentario vai ate um \n de verdade (\r\n inclusive); com outro
        # terminador no meio ela fica, e o resto cai no JSON invalido.
        s = re.sub(r'^[ \t]*//[^\n\r\u2028\u2029]*(\r?\n|$)', '', s, flags=re.M)
        m = re.match(r'\s*var\s+([A-Za-z_$][\w$]*)\s*=', s, re.ASCII)
        if not m or m.group(1) not in VARS_DE_DADOS:
            return 'nao e um arquivo de dados do hub (var <nome> = ...)'
        corpo = re.sub(r';[\s;]*$', '', s[m.end():].strip()).strip()
        corpo = re.sub(r',\s*([\]}])', r'\1', corpo)
        try:
            # NaN/Infinity o Python aceita e o JSON.parse nao: a regra e a do navegador
            json.loads(corpo, parse_constant=_sem_constante)
        except ValueError:
            return 'o conteudo nao e JSON puro (tem codigo)'
        return ''
    if nome.endswith('.json'):
        try:
            json.loads(dados.decode('utf-8-sig'), parse_constant=_sem_constante)
        except ValueError:                      # UnicodeDecodeError e ValueError tambem
            return 'nao e JSON valido'
        return ''
    if nome.lower().endswith('.schlib'):
        return '' if dados.startswith(CFBF) else 'nao e uma .SchLib (falta a assinatura CFBF)'
    return ''                                   # .txt: texto livre, ninguem o executa


def _sem_constante(nome):
    raise ValueError(nome)


def _grava_atomico(alvo, dados):
    """tmp + os.replace no caminho RESOLVIDO: nao troca um symlink pelo arquivo (o mesmo
    cuidado do grava_ledger). Tenta de novo quando o Windows segura o destino por um
    instante (antivirus, indexador)."""
    real = os.path.realpath(alvo)
    os.makedirs(os.path.dirname(real), exist_ok=True)
    # nome com ponto: o hubserver nao o serve; e proprio deste escritor, nao colide com o
    # <arquivo>.tmp dos outros
    tmp = os.path.join(os.path.dirname(real), '.' + os.path.basename(real) + '.lib-remota.tmp')
    with open(tmp, 'wb') as f:
        f.write(dados)
    for n in range(4):
        try:
            os.replace(tmp, os.path.realpath(alvo))     # a forma que tests/test_symlink_sobrevive varre
            return
        except PermissionError:
            if n == 3:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
            time.sleep(0.15 * (n + 1))


def _json(corpo, status):
    return Response(json.dumps(corpo, ensure_ascii=False), status=status,
                    content_type='application/json')


def _e_done(evento):
    return any(linha.strip() in (b'event: done', b'event:done') for linha in evento.split(b'\n'))


def _e_lib_subs():
    """O POST /api/save e o da substituicao de nomes (Libs/lib-subs.js)? Mesma leitura do
    caminho que o api_save faz; get_json guarda o corpo, e o repasse o reusa cru."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return False
    partes = [seg for seg in str(data.get('path', '')).replace('\\', '/').split('/') if seg]
    return partes == ['Libs', 'lib-subs.js']


class Remota:
    """O modo remoto de um workspace: repasse, espelho e o estado online/offline."""

    def __init__(self, root, url):
        self.root = root
        self.url = url
        p = urllib.parse.urlsplit(url)
        self._https = p.scheme == 'https'
        self._host = p.hostname
        self._porta = p.port
        self._prefixo = p.path.rstrip('/')
        self._trava = threading.Lock()          # um refresh por vez
        self._trava_estado = threading.Lock()   # o que o status le enquanto o refresh escreve
        self._pedido = threading.Event()        # alguem pediu refresh (o /__events do servidor)
        self._parar = threading.Event()
        self._threads = []
        self.online = None                      # None = ainda nao tentou
        self._fora_em = 0.0
        self.erro = ''
        self.ausentes = []
        # .altiumhub/ e a pasta do app (import-state, backups do import); fora do app, uma
        # pasta propria. As duas tem ponto no nome: o hubserver nao serve nada la dentro.
        marca = os.path.join(root, '.altiumhub')
        if os.path.isdir(marca):
            self.arq_estado = os.path.join(marca, 'lib-remota.json')
            self.pasta_backup = os.path.join(marca, 'backup')
        else:
            self.arq_estado = os.path.join(root, '.lib-remota', 'estado.json')
            self.pasta_backup = os.path.join(root, '.lib-remota', 'backup')
        self.estado = self._le_estado()

    # ─── estado persistido ────────────────────────────────────────────────────
    def _le_estado(self):
        try:
            with open(self.arq_estado, encoding='utf-8') as f:
                e = json.load(f)
        except (OSError, ValueError):
            e = {}
        if not isinstance(e, dict):
            e = {}
        arqs = e.get('arquivos') if isinstance(e.get('arquivos'), dict) else {}
        if e.get('servidor') != self.url:
            # ETag de outro servidor nao diz nada deste; o sha1 do que o espelho gravou
            # continua valendo (e ele que decide se o local foi mexido a mao)
            arqs = {k: {'sha1': v.get('sha1')} for k, v in arqs.items() if isinstance(v, dict)}
        return {'servidor': self.url, 'arquivos': arqs,
                'ultimaSincronia': e.get('ultimaSincronia'),
                'backups': [b for b in (e.get('backups') or []) if isinstance(b, dict)][-MAX_BACKUPS:]}

    def _grava_estado(self):
        with self._trava_estado:
            dados = json.dumps(self.estado, ensure_ascii=False, indent=1, sort_keys=True)
        try:
            _grava_atomico(self.arq_estado, dados.encode('utf-8'))
        except OSError as e:
            _log('nao gravei o estado em %s: %s' % (self.arq_estado, e))

    # ─── online / offline ─────────────────────────────────────────────────────
    def _marca_online(self, pede=True):
        voltou = self.online is False
        if self.online is not True:
            _log('servidor %s respondendo' % self.url)
        self.online = True
        if self.erro == FORA % self.url:
            self.erro = ''                      # o resto (recusas) so o proximo refresh limpa
        if voltou and pede:
            # O status ja diz "online" e a pagina ja avisa "gravacao liberada", mas o espelho
            # ainda e a copia de antes da queda. Quem percebeu a volta foi um repasse: a thread
            # do /__events esta no backoff e, reconectada, so manda os cabecalhos no primeiro
            # keep-alive (15 s). Sem isto o espelho ficava velho esse tempo todo. (O refresh
            # que marca online passa pede=False: ele mesmo e a atualizacao.)
            self.pede_refresh()

    def _marca_fora(self, motivo):
        if self.online is not False:
            _log('servidor %s fora (%s): biblioteca so leitura' % (self.url, motivo))
        self.online = False
        self._fora_em = time.time()
        self.erro = FORA % self.url

    def _sonda(self):
        """Uma pergunta curta, para o status nunca responder 'nao sei': qualquer resposta
        HTTP (ate 404) prova que o servidor esta la."""
        try:
            c, r = self._pede('HEAD', '/__live.js', None, None, T_CONEXAO)
            r.read()
            c.close()
            self._marca_online()
        except Fora as e:
            self._marca_fora(e)
        except (OSError, http.client.HTTPException) as e:
            self._marca_fora(e)

    def _fora_confirmado(self):
        """Uma leitura pode ir direto ao espelho, sem tentar o servidor? Com as threads no ar,
        quem decide a volta e o _laco_eventos (sonda a cada BACKOFF_MAX, no maximo): a leitura
        nunca espera os 2-3 s de uma conexao que vai falhar. Sem elas (teste, ou antes do
        __main__), so logo depois de uma falha."""
        if self.online is not False:
            return False
        if any(t.is_alive() for t in self._threads):
            return True
        return time.time() - self._fora_em < T_RETESTE

    def status(self):
        if self.online is None:
            self._sonda()
        with self._trava_estado:
            return {'ok': True, 'modo': 'remota', 'servidor': self.url,
                    'online': bool(self.online),
                    'ultimaSincronia': self.estado.get('ultimaSincronia'),
                    'erro': self.erro or '',
                    'ausentes': list(self.ausentes),
                    'backups': list(self.estado.get('backups') or [])}

    # ─── HTTP ─────────────────────────────────────────────────────────────────
    def _pede(self, metodo, caminho, corpo, cabecalhos, t_leitura):
        """(conexao, resposta). http.client e nao urllib: o urllib tem UM timeout para
        conectar e para ler, e aqui sao dois -- 3 s para saber que o servidor caiu, minutos
        para um sincronismo que esta trabalhando."""
        cls = http.client.HTTPSConnection if self._https else http.client.HTTPConnection
        c = cls(self._host, self._porta, timeout=T_CONEXAO)
        try:
            c.connect()
        except OSError as e:                    # recusa, DNS, timeout de conexao, TLS
            c.close()
            raise Fora(_motivo(e))
        c.sock.settimeout(t_leitura)
        cab = dict(cabecalhos or {})
        cab[CAB_REPASSE] = '1'
        try:
            c.request(metodo, self._prefixo + caminho, body=corpo, headers=cab)
            return c, c.getresponse()
        except BaseException:
            c.close()
            raise

    # ─── repasse ──────────────────────────────────────────────────────────────
    def repassa(self):
        """Chamado pelo before_request. Uma Response, ou None para o handler local atender."""
        if isinstance(request.routing_exception, SecurityError):
            # Host fora do TRUSTED_HOSTS (hubserver.configura_escuta, o anti DNS rebinding). O
            # Flask guarda o erro e so o levanta no dispatch, DEPOIS do before_request: sem esta
            # linha uma pagina qualquer, com um dominio que resolve para 127.0.0.1, usaria este
            # hub como ponte para ler e gravar a biblioteca do servidor. None = o 400 de sempre.
            return None
        caminho, metodo = request.path, request.method
        if request.headers.get(CAB_REPASSE):
            return None                         # ja e um repasse: nao salta de novo
        if caminho == '/api/almox/sync' or caminho.startswith('/api/almox/sync/'):
            return _json({'ok': False, 'error': LEGADO}, 409)
        if caminho.startswith('/api/symbols/') or caminho == '/api/almox/config':
            pass
        elif caminho == '/api/save' and metodo == 'POST' and _e_lib_subs():
            recusado = self._confere_lib_subs()
            if recusado is not None:
                return recusado
        elif caminho.lower() == '/' + LIB_SUBS.lower() and metodo in ('GET', 'HEAD'):
            self._le_lib_subs()
            return None                         # o handler local serve o espelho, agora em dia
        else:
            return None
        return self._repassa(caminho, metodo)

    # ─── lib-subs.js: ler e gravar no mesmo lugar ─────────────────────────────
    # A troca de substituicao (hub.html » libSetSub, schframe.js » desfazerEscolha) e
    # ler-alterar-gravar do arquivo INTEIRO: le GET /Libs/lib-subs.js, junta a escolha e grava
    # tudo pelo /api/save. A gravacao vai para o servidor; a leitura, servida pelo handler
    # local, viria do espelho, que chega segundos atrasado (o watcher do servidor, o
    # /__events, o debounce) -- e a gravacao apagaria do servidor, calada, a escolha que outro
    # PC fez nesse intervalo. Os dois metodos abaixo fazem ler e gravar se encontrarem no
    # servidor, como na web.

    def _le_lib_subs(self):
        """GET: traz o arquivo do servidor para o espelho ANTES de o handler local servi-lo.
        Pelo espelho, e nao direto do servidor: a validacao (recusa) e o backup valem igual, e
        o que roda com <script src>/new Function nunca e byte que nao passou por ela. Servidor
        fora (ou a trava presa por um refresh demorado): serve a ultima copia, so leitura."""
        if self._fora_confirmado():
            return                              # servidor fora: nao faz a tela esperar 3 s
        try:
            self._sincroniza(LIB_SUBS_NOME, espera=T_CONEXAO)
        except Fora:
            pass                                # _sincroniza ja marcou fora
        except (OSError, http.client.HTTPException) as e:
            _log('%s: nao conferi com o servidor (%s); fica o espelho' % (LIB_SUBS, _motivo(e)))

    def _confere_lib_subs(self):
        """POST: a gravacao so segue se a pagina leu a versao que o servidor tem. O espelho e
        a versao que ela leu (o GET acima o poe em dia); se, trazido agora do servidor, ele
        MUDA, alguem gravou no meio -- ou a leitura caiu na copia velha porque o servidor
        acabara de voltar -- e gravar por cima apagaria essa escolha. None = pode repassar."""
        antes = _le(os.path.join(self.root, *LIB_SUBS.split('/')))
        try:
            self._sincroniza(LIB_SUBS_NOME, espera=None)
        except Fora:
            return _json({'ok': False, 'offline': True, 'error': FORA % self.url}, 503)
        except (OSError, http.client.HTTPException) as e:
            # nao deu para conferir, mas o servidor atendeu a conexao: o repasse abaixo tenta
            # e responde o que acontecer (504 se cair de novo)
            _log('%s: nao conferi com o servidor antes de gravar (%s)' % (LIB_SUBS, _motivo(e)))
            return None
        if _le(os.path.join(self.root, *LIB_SUBS.split('/'))) != antes:
            return _json({'ok': False, 'error': MUDOU}, 409)
        return None

    def _sincroniza(self, nome, espera):
        """Traz UM arquivo do servidor agora, sem ETag: o do Werkzeug e mtime-tamanho, e um
        lib-subs.js regravado com o mesmo tamanho no mesmo segundo daria 304 com o conteudo
        novo. O arquivo tem 1-2 KB. espera = quanto aguardar a trava (None = o que precisar).
        Levanta Fora (servidor fora, ja marcado) e OSError/HTTPException (caiu no meio)."""
        if not self._trava.acquire(timeout=-1 if espera is None else espera):
            raise OSError('o espelho esta ocupado com outra rodada')
        try:
            erros = []
            def foto():
                with self._trava_estado:
                    return (self.estado['arquivos'].get(nome), self.estado['backups'][-1:])
            antes = foto()
            try:
                self._um(nome, erros, [], [], condicional=False)
            except Fora as e:
                self._marca_fora(e)
                raise
            if foto() != antes:                 # roda a cada pagina aberta: o igual nao regrava
                self._grava_estado()
            self._marca_online()
            for e in erros:                     # recusado: fica o espelho, e o log diz por que
                _log(e)
        finally:
            self._trava.release()

    def _repassa(self, caminho, metodo):
        le = metodo in ('GET', 'HEAD')
        if le and self._fora_confirmado():
            return None                         # servidor fora: nao faz a tela esperar 3 s
        stream = caminho.endswith('/stream')
        cab = {k: request.headers[k] for k in ('Content-Type', 'Accept', 'Last-Event-ID')
               if request.headers.get(k)}
        alvo = urllib.parse.quote(caminho, safe="/-._~!$&'()*+,;=:@")
        if request.query_string:
            alvo += '?' + request.query_string.decode('latin-1')
        corpo = None if le else request.get_data(cache=True)
        try:
            c, r = self._pede(metodo, alvo, corpo, cab, T_STREAM if stream else T_POST)
        except Fora as e:
            self._marca_fora(e)
            if le:
                return None                     # o handler local le o espelho
            return _json({'ok': False, 'offline': True, 'error': FORA % self.url}, 503)
        except (OSError, http.client.HTTPException) as e:
            # conectou e caiu antes da resposta: para um POST nao da para saber se gravou
            if le:
                return None
            return _json({'ok': False, 'error': CORTOU % (self.url, _motivo(e))}, 504)
        self._marca_online()
        tipo = r.getheader('Content-Type') or ''
        if tipo.lower().startswith('text/event-stream'):
            return Response(self._flui(c, r), status=r.status, content_type=tipo)
        try:
            dados = r.read()
        except (OSError, http.client.HTTPException) as e:
            c.close()
            if le:
                return None
            return _json({'ok': False, 'error': CORTOU % (self.url, _motivo(e))}, 504)
        c.close()
        if (r.status in (404, 405) and caminho.startswith('/api/symbols/') and not stream
                and 'json' not in tipo.lower()):
            # 404 em HTML e o do Flask para rota que nao existe: o servidor e mais velho que o
            # app. Um POST numa rota que ele nao tem da 405, nao 404: a rota curinga GET
            # /<path:path> do hubserver casa a url e so o metodo e recusado. (O /stream fica de
            # fora: la o 404 e "corrida desconhecida", rota que toda versao tem, e o
            # EventSource nem le o corpo.)
            return _json({'ok': False, 'error': VERSAO % caminho}, 404)
        if not le:
            # Sincrono: a pagina recarrega a biblioteca logo depois da resposta e tem de ler o
            # que acabou de gravar. Depois de QUALQUER resposta, e nao so 2xx: o 409 soLeitura,
            # o 423 e o 500 do /api/symbols/save vem com o espelho ja gravado no servidor.
            self._refresh_calado()
        return Response(dados, status=r.status, content_type=tipo or None)

    def _flui(self, c, r):
        """Repassa o SSE do servidor evento a evento. No 'done' o espelho e atualizado ANTES
        de o evento seguir: e ao recebe-lo que a pagina recarrega a biblioteca."""
        buf = b''
        try:
            while True:
                try:
                    pedaco = r.read1(65536)     # o que chegou, sem esperar encher o buffer
                except (OSError, http.client.HTTPException) as e:
                    msg = 'a conexao com o servidor da biblioteca caiu no meio: %s' % _motivo(e)
                    yield ('event: error\ndata: %s\n\n' % json.dumps(msg)).encode('utf-8')
                    return
                if not pedaco:
                    break
                buf = (buf + pedaco).replace(b'\r\n', b'\n')
                while b'\n\n' in buf:
                    evento, buf = buf.split(b'\n\n', 1)
                    if _e_done(evento):
                        self._refresh_calado()
                    yield evento + b'\n\n'
            if buf.strip():
                if _e_done(buf):
                    self._refresh_calado()
                yield buf
        finally:
            c.close()

    # ─── espelho ──────────────────────────────────────────────────────────────
    def _refresh_calado(self):
        try:
            self.refresh()
        except Exception as e:                  # noqa: BLE001 (o repasse ja respondeu)
            _log('refresh falhou: %s' % e)

    def refresh(self):
        """Traz para Libs/ o que mudou no servidor. True se conferiu todos os arquivos."""
        with self._trava:
            erros, ausentes = [], []
            carimbo = []                        # uma pasta de backup por rodada, se precisar
            for nome in ARQUIVOS:
                try:
                    self._um(nome, erros, ausentes, carimbo)
                except Fora as e:
                    self._marca_fora(e)
                    self._grava_estado()
                    return False
                except (OSError, http.client.HTTPException) as e:
                    erros.append('%s: %s' % (nome, _motivo(e)))
            with self._trava_estado:
                self.estado['ultimaSincronia'] = _agora()
            self._grava_estado()
            novo = '; '.join(erros)
            if novo and novo != self.erro:      # o mesmo erro a cada minuto nao enche o log
                for e in erros:
                    _log(e)
            if ausentes and ausentes != self.ausentes:
                _log('o servidor nao tem: %s (fica o local)' % ', '.join(ausentes))
            self._marca_online(pede=False)
            self.erro = novo
            self.ausentes = ausentes
            return True

    def _um(self, nome, erros, ausentes, carimbo, condicional=True):
        alvo = os.path.join(self.root, 'Libs', nome)
        local = _le(alvo)
        sha_local = _sha1(local) if local is not None else None
        with self._trava_estado:
            reg = dict(self.estado['arquivos'].get(nome) or {})
        cab = {}
        # O ETag so vale enquanto o arquivo no disco e o que o espelho gravou: mexido por
        # fora, o 304 esconderia a diferenca e ela nunca seria resolvida
        if (condicional and reg.get('etag') and sha_local is not None
                and sha_local == reg.get('sha1')):
            cab['If-None-Match'] = reg['etag']
        c, r = self._pede('GET', '/Libs/' + urllib.parse.quote(nome), None, cab, T_GET)
        try:
            if r.status == 304:
                r.read()
                return
            if r.status == 404:
                r.read()
                ausentes.append(nome)
                return
            if r.status != 200:
                r.read()
                erros.append('%s: o servidor respondeu HTTP %d' % (nome, r.status))
                return
            dados = r.read()
            etag = r.getheader('ETag')
        finally:
            c.close()
        motivo = recusa(nome, dados)
        if motivo:
            erros.append('Libs/%s recusado: %s' % (nome, motivo))
            return
        dados = self._ajusta(nome, dados)
        sha_novo = _sha1(dados)
        if sha_local != sha_novo:
            if (local is not None and sha_local != reg.get('sha1')
                    and sha_local not in self._do_app(nome)):
                # o local mudou depois da ultima gravacao do espelho (ou nunca foi dele) e o
                # servidor tem outra coisa: nada some calado
                if not self._backup(nome, alvo, carimbo, erros):
                    return                      # sem a copia, o local nao e sobrescrito
            try:
                _grava_atomico(alvo, dados)
            except OSError as e:
                erros.append('Libs/%s: nao gravei (%s)' % (nome, e))
                return
        with self._trava_estado:
            self.estado['arquivos'][nome] = {'etag': etag, 'sha1': sha_novo}

    def _do_app(self, nome):
        """sha1 de bytes que o PROPRIO app desktop pos em Libs/<nome>: a semente do instalador
        (.altiumhub/seed.json, {rel: [sha1]}) e o que o "Importar do servidor" trouxe
        (.altiumhub/import-state.json, files[rel].localSha1). Esses bytes sao do git ou do
        servidor, nao trabalho de ninguem: sem isto, a primeira subida de uma instalacao nova
        guardaria em backup -- e avisaria como "mudancas locais" -- a semente inteira.
        Formato que nao se reconhece so faz o backup acontecer, que e o lado seguro."""
        rel = 'Libs/' + nome
        marca = os.path.join(self.root, '.altiumhub')
        out = set()
        for arq in ('seed.json', 'import-state.json'):
            try:
                with open(os.path.join(marca, arq), encoding='utf-8') as f:
                    d = json.load(f)
            except (OSError, ValueError):
                continue
            if not isinstance(d, dict):
                continue
            if arq == 'seed.json':
                v = d.get(rel)
                out.update(x for x in (v if isinstance(v, list) else [v]) if isinstance(x, str))
            else:
                v = (d.get('files') or {}).get(rel) if isinstance(d.get('files'), dict) else None
                if isinstance(v, dict):
                    out.update(x for x in (v.get('localSha1'), v.get('sha1')) if isinstance(x, str))
        return out

    def _ajusta(self, nome, dados):
        """O almox-index.js guarda o odooUrl como o servidor o ve; se la ele e loopback (o
        compose roda em rede do host), aqui o loopback seria ESTE PC. Porte do ajustar."""
        if nome != 'almox-index.js':
            return dados
        host = self._host if ':' not in self._host else '[' + self._host + ']'
        return re.sub(rb'http://(127\.0\.0\.1|localhost)(:\d+)',
                      lambda m: b'http://' + host.encode('ascii') + m.group(2), dados)

    def _backup(self, nome, alvo, carimbo, erros):
        if not carimbo:
            carimbo.append(time.strftime('%Y%m%d-%H%M%S'))
        pasta = os.path.join(self.pasta_backup, 'lib-remota-' + carimbo[0], 'Libs')
        destino = os.path.join(pasta, nome)
        n = 1
        while os.path.exists(destino):         # duas rodadas no mesmo segundo
            n += 1
            destino = os.path.join(pasta, '%s.%d' % (nome, n))
        try:
            os.makedirs(pasta, exist_ok=True)
            shutil.copy2(alvo, destino)
        except OSError as e:
            erros.append('Libs/%s: nao consegui guardar a copia local (%s); ficou o local' % (nome, e))
            return False
        para = os.path.relpath(destino, self.root).replace('\\', '/')
        _log('Libs/%s local tinha mudancas que o servidor nao tem; copia em %s' % (nome, para))
        with self._trava_estado:
            b = self.estado['backups']
            b.append({'arquivo': 'Libs/' + nome, 'para': para, 'em': _agora()})
            del b[:-MAX_BACKUPS]
        return True

    # ─── threads (so no __main__ do hubserver) ────────────────────────────────
    def pede_refresh(self):
        self._pedido.set()

    def inicia(self):
        for alvo in (self._laco_refresh, self._laco_eventos):
            t = threading.Thread(target=alvo, daemon=True)
            t.start()
            self._threads.append(t)

    def para(self):
        self._parar.set()
        self._pedido.set()

    def _laco_refresh(self):
        primeira = True                         # (a) ao subir, sem esperar ninguem pedir
        while not self._parar.is_set():
            if not primeira:
                pedido = self._pedido.wait(PERIODO)     # (c) a cada PERIODO, de qualquer jeito
                if self._parar.is_set():
                    return
                if pedido:
                    self._parar.wait(DEBOUNCE)          # (b) junta a rajada de avisos
            primeira = False
            self._pedido.clear()
            self._refresh_calado()

    def _laco_eventos(self):
        """Assina o /__events do servidor: cada 'change' la pede um refresh aqui. E tambem o
        que percebe o servidor voltando antes do refresh periodico."""
        espera = 1.0
        while not self._parar.is_set():
            # Sonda antes de assinar: o /__events do hubserver so manda os cabecalhos no
            # primeiro keep-alive (15 s), e esperar por eles deixava a tela dizendo "servidor
            # fora" com o servidor ja de pe. A sonda responde na hora, e a virada pede o refresh.
            self._sonda()
            if self.online is False:
                self._parar.wait(espera)
                espera = min(espera * 2, BACKOFF_MAX)
                continue
            try:
                c, r = self._pede('GET', '/__events', None, {'Accept': 'text/event-stream'}, T_EVENTOS)
            except Fora as e:
                self._marca_fora(e)
                self._parar.wait(espera)
                espera = min(espera * 2, BACKOFF_MAX)
                continue
            except (OSError, http.client.HTTPException):
                self._parar.wait(espera)
                espera = min(espera * 2, BACKOFF_MAX)
                continue
            try:
                if r.status != 200:
                    raise OSError('HTTP %d no /__events' % r.status)
                self._marca_online()
                espera = 1.0
                self.pede_refresh()             # o que mudou enquanto estava desconectado
                buf = b''
                while not self._parar.is_set():
                    pedaco = r.read1(4096)
                    if not pedaco:
                        break
                    # o servidor esta falando: desfaz um "fora" que um repasse marcou por uma
                    # falha passageira (com as threads no ar a leitura confia nesse estado)
                    self._marca_online()
                    buf = (buf + pedaco).replace(b'\r\n', b'\n')
                    while b'\n\n' in buf:
                        evento, buf = buf.split(b'\n\n', 1)
                        if any(l.strip() in (b'event: change', b'event:change')
                               for l in evento.split(b'\n')):
                            self.pede_refresh()
            except (OSError, http.client.HTTPException):
                pass                            # caiu ou ficou mudo: reconecta
            finally:
                c.close()
            self._parar.wait(espera)
            espera = min(espera * 2, BACKOFF_MAX)


# ─── ligacao com o hubserver ──────────────────────────────────────────────────
_atual = None       # a Remota em uso, ou None (modo local)


def configura(root, bruto):
    """Liga (url valida) ou desliga (None/'') o modo remoto. O teste troca por aqui; o
    hubserver chama uma vez, pelo registra."""
    global _atual
    if _atual is not None:
        _atual.para()
    url = normaliza_url(bruto)
    _atual = Remota(root, url) if url else None
    return _atual


def atual():
    return _atual


def _antes():
    r = _atual
    return r.repassa() if r is not None else None


def _status():
    r = _atual
    if r is None:
        return {'ok': True, 'modo': 'local'}
    return r.status()


def registra(app, root, bruto=None):
    """Chamado uma vez pelo hubserver, na importacao. O before_request e a rota de status
    entram SEMPRE (o Flask recusa before_request depois do primeiro pedido); sem modo remoto
    os dois so dizem 'local'."""
    app.before_request(_antes)
    app.add_url_rule('/api/lib-remota/status', 'lib_remota_status', _status)
    r = configura(root, bruto)
    if r is not None:
        _log('biblioteca do servidor %s; espelho em Libs/, estado em %s'
             % (r.url, os.path.relpath(r.arq_estado, root)))
    return r


def inicia():
    """As threads do espelho (refresh ao subir, /__events, periodico). So o __main__ do
    hubserver as liga, como o _watcher: importado por teste, nada roda sozinho."""
    if _atual is not None:
        _atual.inicia()
