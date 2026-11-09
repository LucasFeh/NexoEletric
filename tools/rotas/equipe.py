# -*- coding: utf-8 -*-
"""Quem esta mexendo (o login do Nexo Hub), a EQUIPE de cada projeto e o HISTORICO de modificacoes com autor (1.84.0).

Pedido do dono (2026-11-09): "o carimbo do NexoEletric e feito a partir do login, nao precisa mais de carimbo; pelo
login ja pega o nome, se ele e aprovador ou nao, quem decide isso e o admin no Nexo Hub. Pelo login, alguem que e
responsavel por um projeto pode convidar um 'colaborador' pra mexer no projeto junto (perfis admin conseguem mexer em
tudo sem ser convidado). E no historico de modificacao, agora fala exatamente o que foi modificado e quem modificou, a
partir do login da pessoa, com a fotinha dela e o nome tambem."

QUEM E O USUARIO: sempre o servidor pergunta ao Nexo Hub desta maquina (GET <hub>/api/v1/sessao, contrato do Hub §9;
o login e um so por maquina), nunca a pagina. Cache de CACHE s. Os modos:
  'login'     alguem logado: usuario = {id, login, nome, admin, aprovador, iniciais, foto}
  'deslogado' o Hub 2.25+ responde, ninguem logado (a janela fica atras da tela de login; o MCP sem login cai aqui)
  'legado'    Hub antigo, sem login (/api/v1/sessao responde 404): edicao liberada, aprovacao recusada
  'fora'      o Hub nao respondeu: edicao liberada (quem barra sem Hub e o nexohub_gate), aprovacao recusada

A EQUIPE: Projects/<p>/equipe.json (viaja para o NexoBD com o projeto)
  {formato:"nexoeletric-equipe-1", responsavel:{id, login, nome}|null,
   colaboradores:[{id, login, nome, convidado_por:{id, nome}, em}]}
  Pode editar = admin || responsavel || colaborador || projeto sem responsavel. Projeto novo: responsavel = quem criou.
  Projeto antigo sem responsavel: qualquer logado edita e pode "Assumir o projeto"; o admin troca o responsavel.
  Excluir o projeto (e apagar uma revisao dele) = admin || responsavel (1.86.0: a senha mestre saiu de vez). Projeto sem
  responsavel: so o admin (os outros assumem antes). Sem login (Hub antigo, Hub fora, ninguem logado): ninguem.

A FUNCAO DO USUARIO (1.87.0; o admin escolhe no painel do Nexo Hub 2.27.0: Administrador / Usuario / Apenas visualizador).
Pedido do dono (2026-11-09): "o administrador consegue designar funcoes aos usuarios [...] no painel do hub o
administrador consegue designar para 'apenas visualizador'; esse visualizador nao consegue editar nada, mas consegue
baixar, enviar pra jlc, tudo que nao for edicao de pcb nem esquema ela consegue fazer, igual quando os usuarios comuns
nao tem acesso a interface".
  O usuario do Hub traz {visualizador: bool, funcao: 'admin'|'usuario'|'visualizador'} (Hub antigo, sem o campo =
  usuario comum). O VISUALIZADOR fica no somente leitura de quem nao foi convidado, mas em TODOS os projetos, inclusive
  os em que ele e o responsavel ou colaborador: pode = False, sem gerir/assumir/apagar/aprovar. E alem do projeto, as
  rotas que mudam a biblioteca, o catalogo ou criam/importam/renomeiam projetos (ROTAS_EDICAO) respondem 403
  sem_permissao para ele (o before_request de registra_rotas). Baixar, exportar (Gerber, PDF, BOM, STEP), enviar a JLC,
  sincronizar e o chat para consultar continuam livres -- para ele e para o comum nao convidado.

O HISTORICO: Projects/<p>/Historico/<id do usuario>.jsonl, uma linha por modificacao:
  {id, quando, ate, usuario:{id, login, nome}|null, origem:"app"|"ia", arquivo, tipo, mudancas:[texto], gravacoes, ...}
  UM ARQUIVO POR PESSOA (e nao um historico.jsonl so, como pedia a especificacao): o espelho do NexoBD resolve um
  arquivo mudado nas duas maquinas ficando com o local (o outro vai para os conflitos); com o responsavel e o
  colaborador gravando ao mesmo tempo em computadores diferentes, um arquivo so perderia as linhas de um deles.
  Cada gravacao de projeto (/api/save do Python; o do Rust avisa aqui depois de gravar, com o conteudo anterior; as
  escritas do MCP, origem 'ia') vira uma entrada. O autosave grava muito: gravacoes da mesma pessoa no mesmo arquivo
  dentro de JANELA s viram uma entrada so, com o diff do estado do inicio da janela ate o atual.

Rotas:
  GET  /api/sessao[?forcar=1]            -> {ok, modo, usuario|null, hub} (usuario.visualizador/funcao: 1.87.0)
  GET  /api/sessao/usuarios              -> {ok, usuarios:[...]} (a equipe ativa do Hub, para convidar)
  GET  /api/sessao/foto?id=&v=           -> a foto (pelo Hub; 404 sem foto)
  GET  /api/equipe?projeto=              -> {ok, equipe, permissao, usuario, modo}
  GET  /api/equipes                      -> {ok, usuario, modo, projetos:{<nome>: {papel, pode, responsavel, apagar, motivoApagar}}}
  POST /api/equipe/convidar {projeto, id}       o responsavel ou o admin convida (o nome vem do Hub, nao da pagina)
  POST /api/equipe/remover {projeto, id}        o responsavel ou o admin tira (ou a propria pessoa sai)
  POST /api/equipe/responsavel {projeto, id}    so o admin troca o responsavel
  POST /api/equipe/assumir {projeto}            projeto sem responsavel (ou o admin): quem esta logado assume
  GET  /api/historico?projeto=&limite=   -> {ok, entradas:[...] (mais nova primeiro)}
  POST /api/historico/registra {projeto, arquivo, antes, origem?, ferramenta?}   (o Rust e o MCP, depois de gravar)
"""
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request

from flask import Response, request

URL_PADRAO = 'http://127.0.0.1:47800'
CACHE = 2.0
TIMEOUT = 3.0
ARQ = 'equipe.json'
FORMATO = 'nexoeletric-equipe-1'
PASTA_HIST = 'Historico'
JANELA = 300.0                     # s: o autosave da mesma pessoa no mesmo arquivo vira uma entrada so
TIPOS = {'schematic.js': 'esquema', 'changes.js': 'pcb', 'rules.js': 'regras', 'annotations.js': 'anotacoes'}
MSG_LEGADO = 'Atualize o Nexo Hub para 2.26.0+: a aprovação e a equipe do projeto vêm do login dele'
MSG_FORA = 'O Nexo Hub não respondeu: sem ele não dá para saber quem está logado'
MSG_DESLOGADO = 'Entre no Nexo Hub: a aprovação e a equipe do projeto vêm do login'
MSG_VISUALIZADOR = 'Seu usuário é apenas visualizador — peça ao administrador do Nexo Hub'
FUNCOES = ('admin', 'usuario', 'visualizador')

# 1.87.0: o que o visualizador nao faz fora do /api/save (POST). Fica de fora de proposito o que e saida ou consulta:
# /api/gerber, /api/pdf, /api/render, /api/laser-open, /api/jlc/*, /api/lista/{previa,ensaio,envio,estado,config},
# /api/bom/*, /api/sincronia/*, /api/nexo/placa (manda a placa ao NexoCAD), /api/chat/{enviar,conversa,anexo,estado},
# /api/locais/desenhos (so desenha os simbolos/footprints), /api/mcp/*, /api/historico/registra (o Rust avisa depois de gravar; quem barra a gravacao e o proprio Rust),
# /api/equipe/remover (sair da equipe; tirar os outros pede gerir, que o visualizador nao tem), /api/run e as
# credenciais (/api/almox/config, /api/jlc/config).
ROTAS_EDICAO = re.compile(r'^/api/(?:'
                          r'save|fp3d|altium/abrir|board-novo|projeto/novo|catalogo/(?:registrar|editar)'
                          r'|project/[^/]+/(?:delete|rename|grupo)|grupo/(?:renomear|nova-pcb)'
                          r'|aprovacao|revisoes/(?:apagar|voltar)'
                          r'|equipe/(?:convidar|responsavel|assumir)'
                          r'|variantes/(?:criar|editar|apagar|suprimir)'
                          r'|locais(?:/integrar|/[^/]+/(?:apagar|conferir))?|almox/sync|nexo/editar|lista/extras|chat/aplicar'
                          r'|symbols/(?:save|save-almox|almox-aplicar|almox-excluir(?:/desfazer)?|almox-duplicados'
                          r'|almox-fora|footprint|almox-footprint|lib|extract|mirror|almox-sync)'
                          r')/?$')

_trava = threading.Lock()
_trava_hist = threading.Lock()
_cache = {'quando': 0.0, 'v': None}
_provedor = [None]                 # testes: uma funcao () -> resposta do /api/v1/sessao (ou ('http', 404))
_provedor_usuarios = [None]
_bases = {}                        # (pasta, arquivo, uid, origem) -> {'id': da entrada, 'antes': texto do inicio da janela}


# ─────────────────────────── o Nexo Hub ───────────────────────────
def conexao(env=os.environ):
    """a URL do Hub desta maquina: NEXOHUB_URL > C:\\Users\\Public\\NexoHub\\conexao.json > 127.0.0.1:47800"""
    if env.get('NEXOHUB_URL'):
        return env['NEXOHUB_URL'].rstrip('/')
    pub = env.get('PUBLIC') or r'C:\Users\Public'
    try:
        with open(os.path.join(pub, 'NexoHub', 'conexao.json'), encoding='utf-8-sig') as f:
            j = json.load(f)
        if j.get('url'):
            return str(j['url']).rstrip('/')
    except (OSError, ValueError, AttributeError):
        pass
    return URL_PADRAO


def _pede(caminho, cru=False):
    """GET no Hub sem Origin (servidor local). -> (status, corpo json|bytes, tipo); status 0 = nao respondeu"""
    req = urllib.request.Request(conexao() + caminho, headers={'X-App': 'nexoeletric'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            b = r.read()
            return r.status, (b if cru else json.loads(b.decode('utf-8') or '{}')), r.headers.get('Content-Type', '')
    except urllib.error.HTTPError as e:
        try:
            corpo = json.loads(e.read().decode('utf-8') or '{}')
        except Exception:                                     # noqa: BLE001
            corpo = {}
        return e.code, corpo, ''
    except Exception:                                         # noqa: BLE001
        return 0, None, ''


def funcao_de(u):
    """'admin' | 'usuario' | 'visualizador' (1.87.0). O Hub 2.27.0 manda {funcao, visualizador}; o antigo, nenhum dos dois
    (= usuario comum). Administrador nunca e visualizador."""
    if not isinstance(u, dict):
        return 'usuario'
    if u.get('admin') or u.get('funcao') == 'admin':
        return 'admin'
    if u.get('visualizador') is True or u.get('funcao') == 'visualizador':
        return 'visualizador'
    return 'usuario'


def eh_visualizador(u):
    return funcao_de(u) == 'visualizador' if isinstance(u, dict) and u.get('id') else False


def publico(u):
    """o usuario como os programas usam (sem e-mail nem nada que nao precise)"""
    if not isinstance(u, dict) or not u.get('id'):
        return None
    foto = u.get('foto') if isinstance(u.get('foto'), dict) else None
    nome = ' '.join(str(u.get('nome') or u.get('login') or '').split())
    f = funcao_de(u)
    return {'id': str(u['id']), 'login': str(u.get('login') or ''), 'nome': nome,
            'admin': f == 'admin', 'aprovador': bool(u.get('aprovador')) and f != 'visualizador',
            'visualizador': f == 'visualizador', 'funcao': f,
            'iniciais': u.get('iniciais') or ''.join(p[0] for p in nome.split()[:2]).upper(),
            'foto': (foto.get('sha256') or '')[:12] if foto else None}


def quem(u):
    """o que fica gravado no projeto: {id, login, nome}"""
    return {'id': u['id'], 'login': u.get('login', ''), 'nome': u.get('nome', '')} if u else None


def _le_sessao():
    if _provedor[0] is not None:
        r = _provedor[0]()
        if isinstance(r, tuple):
            return r[1], {}
        return 200, r
    st, j, _ = _pede('/api/v1/sessao')
    return st, j


def sessao(forcar=False):
    """{modo, usuario} (ver o cabecalho). Cache de CACHE s: o autosave grava a cada segundo."""
    agora = time.time()
    if _provedor[0] is None and not forcar and _cache['v'] is not None and agora - _cache['quando'] < CACHE:
        return _cache['v']
    st, j = _le_sessao()
    if st == 404:
        v = {'modo': 'legado', 'usuario': None}
    elif st != 200 or not isinstance(j, dict):
        v = {'modo': 'fora', 'usuario': None}
    elif j.get('logado') and publico(j.get('usuario')):
        v = {'modo': 'login', 'usuario': publico(j['usuario'])}
    else:
        v = {'modo': 'deslogado', 'usuario': None}
    _cache.update(quando=agora, v=v)
    return v


def esquece_sessao():
    _cache.update(quando=0.0, v=None)


def usuarios():
    """a equipe ativa do Hub -> (lista, erro)"""
    if _provedor_usuarios[0] is not None:
        return [publico(u) for u in _provedor_usuarios[0]() if publico(u)], ''
    st, j, _ = _pede('/api/v1/sessao/usuarios')
    if st == 200 and isinstance(j, dict):
        return [p for p in (publico(u) for u in j.get('usuarios') or []) if p], ''
    if st == 404:
        return [], MSG_LEGADO
    if st == 401:
        return [], MSG_DESLOGADO
    return [], MSG_FORA


# ─────────────────────────── a equipe do projeto ───────────────────────────
def _vazia():
    return {'formato': FORMATO, 'responsavel': None, 'colaboradores': []}


def le(pdir):
    try:
        with open(os.path.join(pdir, ARQ), encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, ValueError):
        return _vazia()
    if not isinstance(d, dict):
        return _vazia()
    r = d.get('responsavel')
    out = _vazia()
    out['responsavel'] = {'id': str(r['id']), 'login': r.get('login', ''), 'nome': r.get('nome', '')} \
        if isinstance(r, dict) and r.get('id') else None
    for c in d.get('colaboradores') or []:
        if isinstance(c, dict) and c.get('id') and not any(x['id'] == str(c['id']) for x in out['colaboradores']):
            out['colaboradores'].append(dict(c, id=str(c['id'])))
    return out


def grava(pdir, d):
    d = dict(d, formato=FORMATO)
    arq = os.path.join(pdir, ARQ)
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, os.path.realpath(arq))


def nova(pdir, usuario):
    """o projeto que acabou de nascer: quem criou e o responsavel"""
    if usuario:
        grava(pdir, dict(_vazia(), responsavel=quem(usuario)))


def permissao(pdir, s=None, eq=None):
    """{pode, papel, motivo, gerir, trocarResponsavel, assumir, apagar, responsavel} para quem esta logado"""
    s = s or sessao()
    e = eq or le(pdir)
    resp = e['responsavel']
    u = s.get('usuario')
    modo = s['modo']
    eu = u['id'] if u else None
    if modo in ('legado', 'fora'):
        papel = 'legado'
    elif u and resp and resp['id'] == eu:
        papel = 'responsavel'
    elif u and u.get('admin'):
        papel = 'admin'
    elif u and any(c['id'] == eu for c in e['colaboradores']):
        papel = 'colaborador'
    elif not resp:
        papel = 'livre'
    else:
        papel = 'leitura'
    admin = bool(u and u.get('admin'))
    out = {'pode': papel != 'leitura', 'papel': papel, 'modo': modo, 'responsavel': resp,
           'gerir': bool(u) and (admin or papel == 'responsavel'),
           'trocarResponsavel': admin,
           'assumir': bool(u) and (not resp or (admin and resp['id'] != eu)),
           'apagar': admin or papel == 'responsavel',
           'sair': papel == 'colaborador', 'visualizador': False}
    if papel == 'leitura':
        out['motivo'] = mensagem(resp)
    # 1.87.0: o visualizador fica no somente leitura em todo projeto, mesmo no seu (o papel fica, para a tela mostrar)
    if modo == 'login' and eh_visualizador(u):
        out.update(pode=False, gerir=False, trocarResponsavel=False, assumir=False, apagar=False, visualizador=True,
                   motivo=MSG_VISUALIZADOR)
    if not out['apagar']:
        out['motivoApagar'] = mensagem_apagar(modo, u, resp)
        out['motivoApagarRevisao'] = mensagem_apagar(modo, u, resp, revisao=True)
    return out


def mensagem_apagar(modo, u, resp, revisao=False):
    """por que quem esta logado nao exclui o projeto (ou, revisao=True, nao apaga revisoes dele). 1.86.0: a senha mestre
    saiu; so o administrador do Nexo Hub ou o responsavel pelo projeto"""
    faz, fazer = ('apaga revisões', 'apagar revisões') if revisao else ('exclui', 'excluir')
    if modo == 'legado':
        return ('Atualize o Nexo Hub para 2.26.0+: %s vem do login dele (só o administrador ou o responsável)'
                % ('apagar revisão' if revisao else 'excluir projeto'))
    if modo == 'fora':
        return MSG_FORA + ': só o administrador ou o responsável pelo projeto ' + faz
    if not u:
        return 'Entre no Nexo Hub: só o administrador ou o responsável pelo projeto ' + faz
    if eh_visualizador(u):
        return MSG_VISUALIZADOR
    if not resp:
        return ('Este projeto não tem responsável: só o administrador %s. '
                'Assuma o projeto (Arquivo › Assumir projeto…) para poder %s' % (faz, fazer))
    return 'Só o administrador ou o responsável (%s) %s' % (resp.get('nome') or '—',
                                                          'apaga revisões deste projeto' if revisao else 'exclui este projeto')


def mensagem(resp):
    return 'Só o responsável (%s) e os colaboradores convidados mexem neste projeto' % ((resp or {}).get('nome') or '—')


def recusa_apagar(pdir, s=None, revisao=False):
    """None = pode excluir o projeto (revisao=True: apagar uma revisao dele); senao o corpo da resposta 403. 1.86.0: so o
    administrador do Nexo Hub ou o responsavel pelo projeto -- sem a senha mestre, e sem login nao ha excecao (Hub antigo,
    Hub fora, ninguem logado)"""
    s = s or sessao()
    p = permissao(pdir, s)
    if p['apagar']:
        return None
    return {'ok': False, 'codigo': 'sem_permissao', 'error': mensagem_apagar(s['modo'], s.get('usuario'), p['responsavel'], revisao),
            'responsavel': p['responsavel'], 'modo': p['modo'], 'assumir': p['assumir']}


def recusa_gravar(pdir):
    """None = pode gravar; senao o corpo da resposta 403 (o /api/save e as escritas do MCP)"""
    p = permissao(pdir)
    if p['pode']:
        return None
    return {'ok': False, 'codigo': 'sem_permissao', 'error': p['motivo'], 'responsavel': p['responsavel'],
            'visualizador': p['visualizador']}


def recusa_visualizador(s=None):
    """None = quem esta logado nao e visualizador; senao o corpo da resposta 403 (1.87.0)"""
    s = s or sessao()
    if s.get('modo') == 'login' and eh_visualizador(s.get('usuario')):
        return {'ok': False, 'codigo': 'sem_permissao', 'error': MSG_VISUALIZADOR, 'visualizador': True}
    return None


def recusa_rota(metodo, caminho, s=None):
    """o before_request: None = segue; senao o corpo 403 (so POST de ROTAS_EDICAO, so para o visualizador)"""
    if metodo != 'POST' or not ROTAS_EDICAO.match(caminho or ''):
        return None
    return recusa_visualizador(s)


# ─────────────────────────── o que mudou: esquema ───────────────────────────
def _aprovacao():
    import aprovacao
    return aprovacao


def _lista(xs, n=12):
    return ', '.join(xs[:n]) + (' e mais %d' % (len(xs) - n) if len(xs) > n else '')


def _plural(n, um, varios):
    return um if n == 1 else '%d %s' % (n, varios)


def _multiset(itens):
    m = {}
    for x in itens:
        k = json.dumps(x, sort_keys=True, ensure_ascii=False)
        m[k] = m.get(k, 0) + 1
    return m


def _conta_diff(a, b):
    """(quantos sairam, quantos entraram) entre duas listas de objetos"""
    ma, mb = _multiset(a), _multiset(b)
    saiu = sum(max(0, n - mb.get(k, 0)) for k, n in ma.items())
    entrou = sum(max(0, n - ma.get(k, 0)) for k, n in mb.items())
    return saiu, entrou


def _nomes_diff(a, b):
    """(nomes que entraram, nomes que sairam), contando repeticao"""
    ca, cb = {}, {}
    for n in a:
        ca[n] = ca.get(n, 0) + 1
    for n in b:
        cb[n] = cb.get(n, 0) + 1
    novos = sorted({n for n in cb if cb[n] > ca.get(n, 0)}, key=_nat)
    foram = sorted({n for n in ca if ca[n] > cb.get(n, 0)}, key=_nat)
    return novos, foram


def _nat(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', str(s))]


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return ('%.3f' % f).rstrip('0').rstrip('.').replace('.', ',')


# os logins guardados no cabecalho (os nomes *_carimbo sao os de sempre, por causa da folha e dos PDFs) e a assinatura
CAMPOS_ESCONDIDOS = {'Aprovacao_assinatura', 'Aprovacao_carimbo', 'Desenhista_carimbo'}


def muda_esquema(antes, depois):
    C = _aprovacao()
    ia = C._linhas_json(antes or '', '"items":')
    idd = C._linhas_json(depois or '', '"items":')
    out = []
    if antes is None:
        out.append('esquema criado')
    ca, cd = C._comps(ia), C._comps(idd)
    novos = sorted(set(cd) - set(ca), key=_nat)
    foram = sorted(set(ca) - set(cd), key=_nat)

    def desc(c):
        v = [x for x in (c.get('comment'), c.get('footprint')) if x]
        return ' (%s)' % ', '.join(v) if v else ''
    if len(novos) <= 6:
        out += ['%s adicionado%s' % (r, desc(cd[r])) for r in novos]
    else:
        out.append('%d componentes adicionados: %s' % (len(novos), _lista(novos)))
    if len(foram) <= 6:
        out += ['%s removido' % r for r in foram]
    else:
        out.append('%d componentes removidos: %s' % (len(foram), _lista(foram)))
    movidos = []
    for r in sorted(set(ca) & set(cd), key=_nat):
        a, b = ca[r], cd[r]
        for k, rot in (('comment', 'valor'), ('footprint', 'footprint'), ('sym', 'símbolo')):
            if (a[k] or '') != (b[k] or ''):
                out.append('%s: %s %s → %s' % (r, rot, a[k] or '—', b[k] or '—'))
        if a['pos'] != b['pos']:
            movidos.append(r)
    if movidos:
        out.append(('%s movido' % movidos[0]) if len(movidos) == 1 else 'componentes movidos: ' + _lista(movidos))
    # as ligacoes: rotulos de net e alimentacao pelo nome, portas pelo nome; fios e juncoes pela contagem
    for t, um, varios in (('netlabel', 'rótulo de net', 'rótulos de net'), ('power', 'símbolo de alimentação', 'símbolos de alimentação'),
                          ('port', 'porta', 'portas')):
        la = [x for x in ia if x.get('t') == t]
        ld = [x for x in idd if x.get('t') == t]
        en, sa = _nomes_diff([str(x.get('net') or '?') for x in la], [str(x.get('net') or '?') for x in ld])
        for n in en:
            out.append('%s %s adicionad%s' % (um, n, 'a' if t == 'port' else 'o'))
        for n in sa:
            out.append('%s %s removid%s' % (um, n, 'a' if t == 'port' else 'o'))
        if not en and not sa and _conta_diff(la, ld) != (0, 0):
            out.append('%s movid%s' % (varios, 'as' if t == 'port' else 'os'))
    for t, um, varios, fem in (('wire', 'fio', 'fios', False), ('junction', 'junção', 'junções', True), ('noerc', 'marca de "sem ERC"', 'marcas de "sem ERC"', True)):
        saiu, entrou = _conta_diff([x for x in ia if x.get('t') == t], [x for x in idd if x.get('t') == t])
        a_ = 'a' if fem else 'o'
        if saiu and entrou and saiu == entrou:
            out.append('%s alterad%s' % (_plural(saiu, um, varios), a_ + ('' if saiu == 1 else 's')))
        else:
            if entrou:
                out.append('%s adicionad%s' % (_plural(entrou, um, varios), a_ + ('' if entrou == 1 else 's')))
            if saiu:
                out.append('%s removid%s' % (_plural(saiu, um, varios), a_ + ('' if saiu == 1 else 's')))
    ta = [str(x.get('s') or '') for x in ia if x.get('t') == 'text']
    td = [str(x.get('s') or '') for x in idd if x.get('t') == 'text']
    en, sa = _nomes_diff(ta, td)
    for n in en[:6]:
        out.append('texto "%s" adicionado' % n[:40])
    for n in sa[:6]:
        out.append('texto "%s" removido' % n[:40])
    if not en and not sa and _conta_diff([x for x in ia if x.get('t') == 'text'], [x for x in idd if x.get('t') == 'text']) != (0, 0):
        out.append('textos movidos')
    fa = [str(x.get('name') or '') for x in ia if x.get('t') == 'sheet']
    fd = [str(x.get('name') or '') for x in idd if x.get('t') == 'sheet']
    en, sa = _nomes_diff(fa, fd)
    out += ['folha %s adicionada' % n for n in en] + ['folha %s removida' % n for n in sa]
    if not en and not sa and _conta_diff([x for x in ia if x.get('t') == 'sheet'], [x for x in idd if x.get('t') == 'sheet']) != (0, 0):
        out.append('folha alterada (template, tamanho ou campos)')
    conhecidos = {'comp', 'netlabel', 'power', 'port', 'wire', 'junction', 'noerc', 'text', 'sheet'}
    outros = sorted({x.get('t') for x in ia + idd if x.get('t') not in conhecidos and x.get('t')})
    for t in outros:
        saiu, entrou = _conta_diff([x for x in ia if x.get('t') == t], [x for x in idd if x.get('t') == t])
        rot = {'shape': 'forma', 'forma': 'forma', 'image': 'imagem', 'bus': 'barramento'}.get(t, t)
        if saiu and entrou and saiu == entrou:
            out.append('%s alterado%s (%d)' % (rot, 's' if saiu > 1 else '', saiu))
        else:
            if entrou:
                out.append('%s adicionado%s (%d)' % (rot, 's' if entrou > 1 else '', entrou))
            if saiu:
                out.append('%s removido%s (%d)' % (rot, 's' if saiu > 1 else '', saiu))
    pa, pd = C.params_do_texto(antes or ''), C.params_do_texto(depois or '')
    for k in sorted(set(pa) | set(pd)):
        if k in CAMPOS_ESCONDIDOS or pa.get(k) == pd.get(k):
            continue
        rot = k.replace('_DiEletrons', '').replace('_', ' ')
        out.append('folha, %s: %s → %s' % (rot, pa.get(k) or '—', pd.get(k) or '—'))
    return out


# ─────────────────────────── o que mudou: PCB (changes.js) ───────────────────────────
ROT_OP = {
    'track': ('trilha', 'trilhas', True), 'arc': ('arco', 'arcos', False), 'via': ('via', 'vias', True),
    'fill': ('fill', 'fills', False), 'region': ('região', 'regiões', True), 'poly': ('polígono', 'polígonos', False),
    'text': ('texto', 'textos', False), 'pad': ('pad', 'pads', False), 'net': ('net', 'nets', True),
    'comp': ('componente', 'componentes', False),
}


def _ops(txt):
    out = []
    for o in _aprovacao()._linhas_json(txt or ''):
        if isinstance(o, dict) and o.get('op'):
            o = dict(o)
            o.pop('note', None)
            out.append(o)
    return out


def _chave_op(o):
    """a identidade de uma op (as de mexer/apagar sao de um objeto; as de criar, nao tem: cada uma e ela mesma)"""
    op = o['op']
    if op.endswith('_add'):
        return None
    if op in ('outline_set', 'stack_set'):
        return (op,)
    return (op, str(o.get('ref') or o.get('id') or o.get('net') or o.get('name') or ''))


def _onde(o):
    x, y = o.get('x', o.get('cx', o.get('x1'))), o.get('y', o.get('cy', o.get('y1')))
    return ' em (%s; %s)' % (_num(x), _num(y)) if x is not None and y is not None else ''


def _frase_op(o, desfeito=False):
    """-> (chave para juntar iguais, singular, plural) de uma op que entrou (ou, desfeito=True, que saiu)"""
    op = o['op']
    tipo, _, acao = op.partition('_')
    um, varios, fem = ROT_OP.get(tipo, (tipo, tipo + 's', False))
    a = 'a' if fem else 'o'
    net = o.get('net')
    camada = o.get('layer') or o.get('orig_layer')
    ref = o.get('ref') or o.get('id') or ''
    if op == 'comp_move':
        partes = []
        if o.get('x') is not None and o.get('y') is not None and (o.get('x'), o.get('y')) != (o.get('orig_x'), o.get('orig_y')):
            partes.append('movido para (%s; %s) mm' % (_num(o['x']), _num(o['y'])))
        if o.get('rot') is not None and o.get('rot') != o.get('orig_rot'):
            partes.append('girado para %s°' % _num(o['rot']))
        if o.get('layer') and o.get('layer') != o.get('orig_layer'):
            partes.append('virado para %s' % o['layer'])
        s = '%s %s' % (ref, ', '.join(partes) or 'movido')
        if desfeito:
            s = 'movimento de %s desfeito' % ref
        return s, s, s
    if op in ('designator_move', 'comment_move'):
        rot = 'designador' if op == 'designator_move' else 'comentário'
        s = ('%s de %s movido' if not desfeito else 'movimento do %s de %s desfeito') % (rot, ref)
        return s, s, s
    if op == 'outline_set':
        s = 'contorno da placa ' + ('voltou ao do Altium' if desfeito else 'alterado')
        return s, s, s
    if op == 'stack_set':
        s = 'pilha de camadas ' + ('voltou à do Altium' if desfeito else 'alterada')
        return s, s, s
    if op == 'comp_attr':
        s = '%s: atributos %s' % (ref, 'voltaram ao do Altium' if desfeito else 'alterados')
        return s, s, s
    if op == 'net_rename':
        s = 'net %s renomeada para %s' % (o.get('orig_name') or o.get('from') or ref, o.get('name') or o.get('to') or '?')
        if desfeito:
            s = 'renomeação da net %s desfeita' % (o.get('orig_name') or o.get('from') or ref)
        return s, s, s
    if op == 'pad_net':
        s = 'pad %s ligado à net %s' % (ref, o.get('net') or '—') if not desfeito else 'ligação do pad %s desfeita' % ref
        return s, s, s
    if acao == 'add':
        desc = (' na net %s' % net) if net else ''
        if tipo == 'text' and o.get('text'):
            desc = ' "%s"' % str(o['text'])[:30]
        if tipo == 'comp':
            desc = ' ' + str(o.get('ref') or o.get('footprint') or '')
        cam = (' (%s)' % camada) if camada and tipo not in ('via', 'comp') else ''
        verbo = 'removid' if desfeito else 'adicionad'
        if tipo == 'via' and not desfeito:
            return ('via+' + str(net), 'via%s adicionada%s' % (desc, _onde(o)), '%%d vias%s adicionadas' % desc)
        s1 = '%s%s %s%s%s' % (um, desc, verbo, a, cam)
        sn = '%%d %s%s %s%ss%s' % (varios, desc, verbo, a, cam)
        return (tipo + verbo + desc + cam, s1, sn)
    if acao == 'del':
        cam = (' (%s)' % camada) if camada and tipo not in ('via',) else ''
        if desfeito:
            s = '%s %s voltou' % (um, ref)
            return s, s, s
        return (tipo + 'del' + cam, '%s %s removid%s%s' % (um, ref, a, cam), '%%d %s removid%ss%s' % (varios, a, cam))
    if acao == 'edit':
        if desfeito:
            s = '%s %s voltou ao do Altium' % (um, ref)
            return s, s, s
        det = []
        if tipo == 'text' and o.get('text') is not None and o.get('text') != o.get('orig_text'):
            det.append('"%s" → "%s"' % (o.get('orig_text') or '', o['text']))
        if o.get('w') is not None and o.get('orig_w') is not None and o['w'] != o['orig_w']:
            det.append('largura %s → %s mm' % (_num(o['orig_w']), _num(o['w'])))
        if o.get('net') is not None and o.get('orig_net') is not None and o['net'] != o['orig_net']:
            det.append('net %s → %s' % (o['orig_net'] or '—', o['net'] or '—'))
        if o.get('x') is not None and o.get('orig_x') is not None and (o.get('x'), o.get('y')) != (o.get('orig_x'), o.get('orig_y')):
            det.append('movid%s para (%s; %s)' % (a, _num(o['x']), _num(o.get('y'))))
        if o.get('layer') and o.get('orig_layer') and o['layer'] != o['orig_layer']:
            det.append('camada %s → %s' % (o['orig_layer'], o['layer']))
        s = '%s %s alterad%s%s' % (um, ref, a, (': ' + ', '.join(det)) if det else '')
        return s, s, s
    s = op + (' desfeita' if desfeito else '') + (' (%s)' % ref if ref else '')
    return s, s, s


def muda_pcb(antes, depois):
    oa, od = _ops(antes), _ops(depois)
    ma, md = _multiset(oa), _multiset(od)
    saiu, entrou = [], []
    for k, n in ma.items():
        saiu += [json.loads(k)] * max(0, n - md.get(k, 0))
    for k, n in md.items():
        entrou += [json.loads(k)] * max(0, n - ma.get(k, 0))
    # a mesma op de mexer/apagar num objeto que saiu e entrou de novo = mudou (fica so a nova)
    chaves_novas = {_chave_op(o) for o in entrou if _chave_op(o)}
    saiu = [o for o in saiu if not (_chave_op(o) and _chave_op(o) in chaves_novas)]
    grupos, ordem = {}, []
    for o, desfeito in [(o, False) for o in entrou] + [(o, True) for o in saiu]:
        k, s1, sn = _frase_op(o, desfeito)
        if k not in grupos:
            grupos[k] = [0, s1, sn]
            ordem.append(k)
        grupos[k][0] += 1
    out = []
    for k in ordem:
        n, s1, sn = grupos[k]
        out.append(s1 if n == 1 or '%d' not in sn else sn % n)
    if antes is None and not out:
        out.append('PCB criada (sem mudanças ainda)')
    return out[:60] + (['e mais %d mudanças' % (len(out) - 60)] if len(out) > 60 else [])


# ─────────────────────────── o que mudou: regras e sinalizadores ───────────────────────────
def _regras(txt):
    rs, cab = [], {}
    dentro = False
    for l in (txt or '').replace('\r\n', '\n').split('\n'):
        t = l.strip().rstrip(',')
        if t.startswith('"rules":['):
            dentro = True
            continue
        if dentro and t.startswith('{'):
            try:
                rs.append(json.loads(t))
            except ValueError:
                pass
        elif not dentro and t.startswith('"') and ':' in t:
            k, _, v = t.partition(':')
            cab[k.strip('"')] = v
    return rs, cab


def muda_regras(antes, depois):
    ra, ca = _regras(antes)
    rd, cd = _regras(depois)
    out = ['regras de projeto criadas'] if antes is None else []
    por_a = {r.get('name'): r for r in ra}
    por_d = {r.get('name'): r for r in rd}
    for n in sorted(set(por_d) - set(por_a), key=_nat):
        out.append('regra %s adicionada (%s)' % (n, por_d[n].get('kind') or '?'))
    for n in sorted(set(por_a) - set(por_d), key=_nat):
        out.append('regra %s removida' % n)
    for n in sorted(set(por_a) & set(por_d), key=_nat):
        a, b = por_a[n], por_d[n]
        if a == b:
            continue
        det = []
        for k in sorted(set(a) | set(b)):
            if a.get(k) != b.get(k) and not isinstance(a.get(k), (dict, list)) and not isinstance(b.get(k), (dict, list)):
                va, vb = a.get(k), b.get(k)
                det.append('%s %s → %s' % (k, _num(va) if isinstance(va, (int, float)) and not isinstance(va, bool) else va,
                                           _num(vb) if isinstance(vb, (int, float)) and not isinstance(vb, bool) else vb))
        out.append('regra %s alterada%s' % (n, (': ' + ', '.join(det[:4])) if det else ''))
    if ca.get('classes') != cd.get('classes') and antes is not None:
        out.append('classes de net/componente alteradas')
    if ca.get('verificar') != cd.get('verificar') and antes is not None:
        out.append('o que o DRC verifica foi alterado')
    return out


def muda_anotacoes(antes, depois):
    C = _aprovacao()
    aa = {a.get('id'): a for a in C._linhas_json(antes or '') if isinstance(a, dict)}
    ad = {a.get('id'): a for a in C._linhas_json(depois or '') if isinstance(a, dict)}
    out = []
    for i in sorted(set(ad) - set(aa), key=_nat):
        out.append('sinalizador adicionado: "%s"' % str(ad[i].get('msg') or '')[:60])
    for i in sorted(set(aa) - set(ad), key=_nat):
        out.append('sinalizador removido: "%s"' % str(aa[i].get('msg') or '')[:60])
    for i in sorted(set(aa) & set(ad), key=_nat):
        a, b = aa[i], ad[i]
        if a == b:
            continue
        if a.get('status') != b.get('status'):
            out.append('sinalizador "%s": %s' % (str(b.get('msg') or '')[:50], 'resolvido' if b.get('status') == 'resolved' else 'reaberto'))
        else:
            out.append('sinalizador "%s" alterado' % str(b.get('msg') or '')[:50])
    return out


def mudancas(arquivo, antes, depois):
    tipo = TIPOS.get(arquivo)
    try:
        if tipo == 'esquema':
            return muda_esquema(antes, depois)
        if tipo == 'pcb':
            return muda_pcb(antes, depois)
        if tipo == 'regras':
            return muda_regras(antes, depois)
        if tipo == 'anotacoes':
            return muda_anotacoes(antes, depois)
    except Exception as e:                                    # noqa: BLE001
        print('[equipe] diff de %s: %s' % (arquivo, e), flush=True)
        return ['%s alterado' % arquivo]
    return ['%s alterado' % arquivo]


# ─────────────────────────── o historico ───────────────────────────
def _agora_iso(t=None):
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(t if t is not None else time.time()))


def _ts(iso):
    try:
        return time.mktime(time.strptime(str(iso)[:19], '%Y-%m-%dT%H:%M:%S'))
    except (ValueError, OverflowError):
        return 0.0


def _slug(s):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', str(s or '')).strip('._') or 'sem-login'


def arquivo_do_historico(pdir, usuario):
    return os.path.join(pdir, PASTA_HIST, _slug(usuario['id'] if usuario else 'sem-login') + '.jsonl')


def _le_linhas(arq):
    out = []
    try:
        with open(arq, encoding='utf-8') as f:
            for l in f:
                l = l.strip()
                if l:
                    try:
                        out.append(json.loads(l))
                    except ValueError:
                        pass
    except OSError:
        pass
    return out


def _grava_linhas(arq, linhas):
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        for e in linhas:
            f.write(json.dumps(e, ensure_ascii=False) + '\n')
    os.replace(tmp, os.path.realpath(arq))


def registra(pdir, arquivo, antes, depois, origem='app', usuario=None, ferramenta=None, agora=None, lista_mudancas=None, tipo=None):
    """acrescenta (ou junta na da janela) a entrada do historico. -> a entrada, ou None se nada mudou"""
    if antes == depois and lista_mudancas is None:
        return None
    agora = time.time() if agora is None else agora
    tipo = tipo or TIPOS.get(arquivo, 'outro')
    arq = arquivo_do_historico(pdir, usuario)
    chave = (os.path.normcase(os.path.abspath(pdir)), arquivo, usuario['id'] if usuario else '', origem)
    with _trava_hist:
        linhas = _le_linhas(arq)
        b = _bases.get(chave) if lista_mudancas is None else None
        idx = -1
        if b:
            for i in range(len(linhas) - 1, -1, -1):
                if linhas[i].get('id') == b['id']:
                    idx = i
                    break
        junta = idx >= 0 and agora - _ts(linhas[idx].get('ate')) <= JANELA
        base = b['antes'] if junta else antes
        mud = lista_mudancas if lista_mudancas is not None else mudancas(arquivo, base, depois)
        if junta:
            e = linhas[idx]
            if not mud:                    # voltou ao que era no inicio da janela: a entrada sai
                del linhas[idx]
                _bases.pop(chave, None)
                _grava_linhas(arq, linhas)
                return None
            e.update(ate=_agora_iso(agora), mudancas=mud, gravacoes=int(e.get('gravacoes') or 1) + 1)
            if ferramenta and ferramenta not in (e.get('ferramentas') or []):
                e['ferramentas'] = (e.get('ferramentas') or []) + [ferramenta]
        else:
            if not mud:
                return None
            e = {'id': secrets.token_hex(6), 'quando': _agora_iso(agora), 'ate': _agora_iso(agora), 'usuario': quem(usuario),
                 'origem': origem, 'arquivo': arquivo, 'tipo': tipo, 'mudancas': mud, 'gravacoes': 1}
            if ferramenta:
                e['ferramentas'] = [ferramenta]
            linhas.append(e)
        if lista_mudancas is None:
            _bases[chave] = {'id': e['id'], 'antes': base}
        _grava_linhas(arq, linhas)
        return e


def evento(pdir, tipo, mudancas_, usuario=None, origem='app'):
    """uma entrada que nao e gravacao de arquivo (aprovacao, revisao, equipe)"""
    try:
        return registra(pdir, '', None, None, origem=origem, usuario=usuario, lista_mudancas=list(mudancas_), tipo=tipo)
    except OSError:
        return None


def lista(pdir, limite=300):
    out = []
    d = os.path.join(pdir, PASTA_HIST)
    try:
        nomes = [n for n in os.listdir(d) if n.endswith('.jsonl')]
    except OSError:
        nomes = []
    for n in nomes:
        out += _le_linhas(os.path.join(d, n))
    out.sort(key=lambda e: (str(e.get('ate') or e.get('quando') or ''), str(e.get('quando') or '')), reverse=True)
    return out[:limite]


# ─────────────────────────── rotas ───────────────────────────
def registra_rotas(app, root, h=None):
    h = h or {}
    pdir_raiz = os.path.join(root, 'Projects')

    # 1.87.0: o visualizador nao muda nada (projeto, biblioteca, catalogo), venha o pedido da tela, do Rust (que repassa
    # o que nao e dele) ou de quem for
    @app.before_request
    def _barra_visualizador():
        nao = recusa_rota(request.method, request.path)
        if nao:
            return nao, 403

    def pasta(nome):
        nome = str(nome or '')
        if not nome or nome != os.path.basename(nome) or nome in ('.', '..') or nome.startswith('.'):
            return None
        d = os.path.join(pdir_raiz, nome)
        return d if os.path.isdir(d) else None

    def corpo():
        return request.get_json(silent=True) or {}

    def resposta(d, s=None):
        s = s or sessao()
        eq = le(d)
        return {'ok': True, 'equipe': eq, 'permissao': permissao(d, s, eq), 'usuario': s['usuario'], 'modo': s['modo']}

    def exige_login():
        s = sessao(forcar=True)
        if s['modo'] == 'legado':
            return s, ({'ok': False, 'codigo': 'hub_antigo', 'error': MSG_LEGADO}, 409)
        if s['modo'] == 'fora':
            return s, ({'ok': False, 'codigo': 'sem_hub', 'error': MSG_FORA}, 503)
        if not s['usuario']:
            return s, ({'ok': False, 'codigo': 'sem_login', 'error': MSG_DESLOGADO}, 401)
        return s, None

    @app.route('/api/sessao')
    def api_sessao():
        # ?forcar=1: a pagina ouviu do Hub que o login (ou a funcao) mudou e quer o de agora, sem o cache de CACHE s
        s = sessao(forcar=request.args.get('forcar') == '1')
        return {'ok': True, 'modo': s['modo'], 'usuario': s['usuario'], 'hub': conexao()}

    @app.route('/api/sessao/usuarios')
    def api_sessao_usuarios():
        lst, erro = usuarios()
        if erro:
            return {'ok': False, 'error': erro, 'usuarios': []}, 503
        return {'ok': True, 'usuarios': sorted(lst, key=lambda u: u['nome'].lower())}

    @app.route('/api/sessao/foto')
    def api_sessao_foto():
        uid = str(request.args.get('id') or '')
        if not re.match(r'^[A-Za-z0-9._-]{1,80}$', uid):
            return {'ok': False, 'error': 'id inválido'}, 400
        st, b, tipo = _pede('/api/v1/sessao/foto?id=' + uid, cru=True)
        if st != 200 or not b:
            return Response(b'', status=404)
        r = Response(b, mimetype=(tipo or 'image/png').split(';')[0])
        r.headers['Cache-Control'] = 'private, max-age=86400' if request.args.get('v') else 'no-cache'
        return r

    @app.route('/api/equipe')
    def api_equipe():
        d = pasta(request.args.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        return resposta(d)

    @app.route('/api/equipes')
    def api_equipes():
        s = sessao()
        out = {}
        try:
            nomes = sorted(os.listdir(pdir_raiz))
        except OSError:
            nomes = []
        for n in nomes:
            d = os.path.join(pdir_raiz, n)
            if os.path.isdir(d) and not n.startswith('.'):
                p = permissao(d, s)
                out[n] = {'papel': p['papel'], 'pode': p['pode'], 'responsavel': p['responsavel'],
                          'apagar': p['apagar'], 'motivoApagar': p.get('motivoApagar', ''), 'visualizador': p['visualizador']}
        return {'ok': True, 'usuario': s['usuario'], 'modo': s['modo'], 'projetos': out}

    @app.route('/api/equipe/convidar', methods=['POST'])
    def api_equipe_convidar():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        s, erro = exige_login()
        if erro:
            return erro
        uid = str(b.get('id') or '')
        with _trava:
            eq = le(d)
            p = permissao(d, s, eq)
            if not p['gerir']:
                return {'ok': False, 'codigo': 'sem_permissao',
                        'error': 'Só o responsável pelo projeto e o administrador convidam colaboradores'}, 403
            lst, e2 = usuarios()
            alvo = next((u for u in lst if u['id'] == uid), None)
            if not alvo:
                return {'ok': False, 'error': e2 or 'esse usuário não existe (ou está inativo) no Nexo Hub'}, 404
            if alvo.get('visualizador'):
                return {'ok': False, 'codigo': 'visualizador',
                        'error': '%s é apenas visualizador no Nexo Hub: não entra na equipe (o administrador muda a função dele no Hub)' % alvo['nome']}, 409
            if eq['responsavel'] and eq['responsavel']['id'] == uid:
                return {'ok': False, 'error': '%s já é o responsável pelo projeto' % alvo['nome']}, 409
            if any(c['id'] == uid for c in eq['colaboradores']):
                return {'ok': False, 'error': '%s já é colaborador' % alvo['nome']}, 409
            eu = s['usuario']
            eq['colaboradores'].append(dict(quem(alvo), convidado_por={'id': eu['id'], 'nome': eu['nome']}, em=_agora_iso()))
            grava(d, eq)
        evento(d, 'equipe', ['%s convidou %s como colaborador' % (eu['nome'], alvo['nome'])], eu)
        return resposta(d, s)

    @app.route('/api/equipe/remover', methods=['POST'])
    def api_equipe_remover():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        s, erro = exige_login()
        if erro:
            return erro
        uid = str(b.get('id') or '')
        eu = s['usuario']
        with _trava:
            eq = le(d)
            p = permissao(d, s, eq)
            if not (p['gerir'] or uid == eu['id']):
                return {'ok': False, 'codigo': 'sem_permissao',
                        'error': 'Só o responsável pelo projeto e o administrador tiram colaboradores'}, 403
            c = next((x for x in eq['colaboradores'] if x['id'] == uid), None)
            if not c:
                return {'ok': False, 'error': 'não é colaborador deste projeto'}, 404
            eq['colaboradores'] = [x for x in eq['colaboradores'] if x['id'] != uid]
            grava(d, eq)
        evento(d, 'equipe', ['%s saiu da equipe' % c['nome'] if uid == eu['id'] else
                             '%s tirou %s da equipe' % (eu['nome'], c['nome'])], eu)
        return resposta(d, s)

    def _vira_responsavel(d, s, alvo, eq):
        antigo = eq['responsavel']
        eq['responsavel'] = quem(alvo)
        eq['colaboradores'] = [x for x in eq['colaboradores'] if x['id'] != alvo['id']]
        grava(d, eq)
        return antigo

    @app.route('/api/equipe/responsavel', methods=['POST'])
    def api_equipe_responsavel():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        s, erro = exige_login()
        if erro:
            return erro
        if not s['usuario']['admin']:
            return {'ok': False, 'codigo': 'sem_permissao', 'error': 'Só o administrador troca o responsável pelo projeto'}, 403
        uid = str(b.get('id') or '')
        lst, e2 = usuarios()
        alvo = next((u for u in lst if u['id'] == uid), None)
        if not alvo:
            return {'ok': False, 'error': e2 or 'esse usuário não existe (ou está inativo) no Nexo Hub'}, 404
        if alvo.get('visualizador'):
            return {'ok': False, 'codigo': 'visualizador',
                    'error': '%s é apenas visualizador no Nexo Hub: não pode ser o responsável' % alvo['nome']}, 409
        with _trava:
            eq = le(d)
            antigo = _vira_responsavel(d, s, alvo, eq)
        evento(d, 'equipe', ['responsável: %s → %s' % ((antigo or {}).get('nome') or 'ninguém', alvo['nome'])], s['usuario'])
        return resposta(d, s)

    @app.route('/api/equipe/assumir', methods=['POST'])
    def api_equipe_assumir():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        s, erro = exige_login()
        if erro:
            return erro
        eu = s['usuario']
        with _trava:
            eq = le(d)
            if not permissao(d, s, eq)['assumir']:
                resp = eq['responsavel']
                if resp and resp['id'] == eu['id']:
                    return {'ok': False, 'error': 'você já é o responsável por este projeto'}, 409
                return {'ok': False, 'codigo': 'sem_permissao',
                        'error': 'O projeto já tem responsável (%s): só o administrador troca' % (resp or {}).get('nome')}, 403
            antigo = _vira_responsavel(d, s, eu, eq)
        out = resposta(d, s)
        # o desenhista no quadro de titulo da folha passa a ser quem assumiu
        if h.get('desenhista'):
            try:
                out.update(h['desenhista'](d, eu) or {})
            except Exception as e:                            # noqa: BLE001
                print('[equipe] desenhista ao assumir: %s' % e, flush=True)
        evento(d, 'equipe', ['%s assumiu o projeto%s' % (eu['nome'], (' (era de %s)' % antigo['nome']) if antigo else '')], eu)
        return out

    @app.route('/api/historico')
    def api_historico():
        d = pasta(request.args.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        try:
            n = max(1, min(2000, int(request.args.get('limite') or 300)))
        except ValueError:
            n = 300
        return {'ok': True, 'entradas': lista(d, n)}

    @app.route('/api/historico/registra', methods=['POST'])
    def api_historico_registra():
        b = corpo()
        d = pasta(b.get('projeto'))
        arq = str(b.get('arquivo') or '')
        if not d or arq not in TIPOS:
            return {'ok': False, 'error': 'projeto ou arquivo desconhecido'}, 404
        try:
            with open(os.path.join(d, arq), encoding='utf-8', newline='') as f:
                depois = f.read().replace('\r\n', '\n')
        except OSError:
            depois = None
        antes = b.get('antes')
        antes = antes.replace('\r\n', '\n') if isinstance(antes, str) else None
        origem = 'ia' if b.get('origem') == 'ia' else 'app'
        s = sessao()
        e = registra(d, arq, antes, depois, origem=origem, usuario=s['usuario'], ferramenta=str(b.get('ferramenta') or '')[:60] or None)
        return {'ok': True, 'entrada': e}
