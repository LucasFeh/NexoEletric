# -*- coding: utf-8 -*-
"""Rotas /api/carimbos* e /api/aprovacao*: os carimbos da casa (quem desenha, quem aprova) e a aprovacao do projeto.

Pedido do dono (2026-11-05): "no menu [da folha] tem carimbo, quero clicar ali e ter carimbos pre estabelecidos; voce salva
um carimbo, ele fica com o nome que voce der, pra todo mundo, fica salvo no DB; quero dar TAG de aprovador; se a pessoa
estiver com tag de aprovador ela pode aprovar o projeto [...] no menu de projeto fica uma TAG na frente do nome
'CBM-DI251876 [Aprovado]' e no template vai o nome de quem aprovou; pra trocar de carimbo precisa a senha daquele carimbo;
pra apagar o carimbo, a senha mestre do sistema". E logo depois: "enquanto nao tiver aprovado fica 'Sem aprovacao'; toda
vez que tiver uma modificacao no projeto a tag de aprovado some, a data do desenho atualiza [...] quem verifica tambem
aprova, entao ja completa os dois campos no template ao mesmo tempo".

ONDE MORA
  Libs/carimbos.json            os carimbos (nome, tags, senha com sal em PBKDF2). Libs/ e o item "Biblioteca do
                                NexoEletric" no NexoBD (electron/lib/armazem.js): vale para todas as maquinas.
  .altiumhub/carimbo-ativo.json o carimbo em uso NESTA maquina (nao viaja: cada computador tem o seu).
  schematic.js (cabecalho)      a aprovacao: os campos do template (Verificador_DiEletrons, Aprovador_DiEletrons,
                                Data_verificacao, Data_aprovacao) e a ASSINATURA do que foi aprovado
                                (Aprovacao_assinatura, Aprovacao_carimbo). Viaja junto com o esquema, num arquivo so.

A ASSINATURA e o sha256 do projeto como ele estava na aprovacao: schematic.js (sem a linha "generated" e sem os campos
da aprovacao e o Data_desenho no cabecalho), changes.js e board.js. Projeto aprovado = assinatura igual a de agora.
Mudou qualquer um deles (o esquema salvo, a PCB editada, o Altium reexportou, a IA mexeu): a tag volta a "Sem aprovacao"
na hora, e passada a CARENCIA (o NexoBD pode estar trazendo os arquivos de outra maquina um de cada vez) os campos da
aprovacao saem do cabecalho e o Data_desenho vira a data de hoje. A vista Esquema faz o mesmo ao salvar uma edicao
(hub-carimbos.js » antesDeSalvar), sem esperar.

Rotas:
  GET  /api/carimbos                       -> {ok, carimbos:[{id, nome, tags}], ativo:{id, nome, tags}|null}
  POST /api/carimbos {nome, senha, tags?, mestre?}          cria (tag aprovador pede a senha mestre)
  POST /api/carimbos/entrar {id, senha}                     passa a usar o carimbo nesta maquina
  POST /api/carimbos/sair                                   nenhum carimbo nesta maquina
  POST /api/carimbos/tags {id, tags, mestre}                troca as tags (senha mestre)
  POST /api/carimbos/apagar {id, mestre}                    apaga (senha mestre)
  GET  /api/aprovacao?projeto=             -> {ok, aprovado, por, data, carimbo, temEsquema}
  GET  /api/aprovacoes                     -> {ok, projetos:{<nome>: {aprovado, por, data}}}
  POST /api/aprovacao {projeto}            -> aprova com o carimbo ativo (tag aprovador): {ok, texto, params, ...}
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

from flask import request

ARQ = os.path.join('Libs', 'carimbos.json')
ARQ_ATIVO = os.path.join('.altiumhub', 'carimbo-ativo.json')
TAG_APROVADOR = 'aprovador'
ITERACOES = 120000
CARENCIA = 120.0          # s: assinatura diferente por mais que isto = modificacao de verdade, limpa os campos

# os campos que a aprovacao escreve no cabecalho (e que a assinatura nao cobre)
CAMPOS_APROVACAO = ('Verificador_DiEletrons', 'Aprovador_DiEletrons', 'Data_verificacao', 'Data_aprovacao',
                    'Aprovacao_assinatura', 'Aprovacao_carimbo')
FORA_DA_ASSINATURA = set(CAMPOS_APROVACAO) | {'Data_desenho'}
ARQS_ASSINADOS = ('schematic.js', 'changes.js', 'board.js')

_trava = threading.Lock()
_cache_hash = {}          # pasta -> (marca dos arquivos, assinatura)
_desde = {}               # pasta -> quando a assinatura passou a nao bater


# ─────────────────────────── carimbos ───────────────────────────
def _hash_senha(senha, sal):
    return hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), bytes.fromhex(sal), ITERACOES).hex()


def _le(root):
    try:
        with open(os.path.join(root, ARQ), encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d.get('carimbos'), dict):
            return d
    except (OSError, ValueError):
        pass
    return {'format': 'nexoeletric-carimbos-1', 'carimbos': {}}


def _grava(root, d):
    arq = os.path.join(root, ARQ)
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    os.replace(tmp, arq)


def _publico(c):
    return {'id': c['id'], 'nome': c['nome'], 'tags': list(c.get('tags') or [])}


def _tags(v):
    if isinstance(v, str):
        v = v.split(',')
    out = []
    for t in v or []:
        t = ' '.join(str(t).split()).lower()
        if t and t not in out:
            out.append(t)
    return out


def _nome(v):
    """o nome vai para o carimbo da folha (campo K=V;K=V): sem ; nem | nem aspas-dois-pontos"""
    return ' '.join(str(v or '').replace(';', ',').replace('|', '/').replace('":', '" :').split())


def _ativo_id(root):
    try:
        with open(os.path.join(root, ARQ_ATIVO), encoding='utf-8') as f:
            return json.load(f).get('id')
    except (OSError, ValueError, AttributeError):
        return None


def _grava_ativo(root, cid):
    arq = os.path.join(root, ARQ_ATIVO)
    if cid is None:
        try:
            os.remove(arq)
        except OSError:
            pass
        return
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    with open(arq, 'w', encoding='utf-8') as f:
        json.dump({'id': cid, 'desde': time.strftime('%Y-%m-%dT%H:%M:%S')}, f)


def ativo(root):
    """o carimbo em uso nesta maquina (o registro de Libs/carimbos.json), ou None"""
    cid = _ativo_id(root)
    return _le(root)['carimbos'].get(cid) if cid else None


def _mestre_ok(mestre, senha_mestre):
    return isinstance(mestre, str) and hmac.compare_digest(mestre.encode('utf-8'), senha_mestre.encode('utf-8'))


# ─────────────────────────── o cabecalho do schematic.js ───────────────────────────
def parse_params(s):
    o = {}
    for par in str(s or '').split(';'):
        i = par.find('=')
        if i <= 0:
            continue
        k = par[:i].strip()
        if k:
            o[k] = par[i + 1:]
    return o


def serializa_params(o):
    return ';'.join('%s=%s' % (k, v) for k, v in o.items() if k)


def _linhas(texto):
    return texto.replace('\r\n', '\n').split('\n')


def _linha_params(linhas):
    """o indice da linha "params" do CABECALHO (antes de "items") e o indice do "items"; -1 se nao tem"""
    for i, l in enumerate(linhas):
        if l.startswith('"items":'):
            return -1, i
        if l.startswith('"params":'):
            for j in range(i + 1, len(linhas)):
                if linhas[j].startswith('"items":'):
                    return i, j
            return i, -1
    return -1, -1


def params_do_texto(texto):
    ln = _linhas(texto)
    i, _ = _linha_params(ln)
    if i < 0:
        return {}
    try:
        return parse_params(json.loads(ln[i][len('"params":'):].rstrip().rstrip(',')))
    except ValueError:
        return {}


def troca_params(texto, fn):
    """o texto do schematic.js com o cabecalho `params` trocado por fn(dict) -> dict (no formato do serializeSchematic:
    uma chave por linha). None se o arquivo nao tem a linha "items" (nao e um schematic.js que se saiba editar)."""
    ln = _linhas(texto)
    i, j = _linha_params(ln)
    if j < 0:
        return None
    antes = {}
    if i >= 0:
        try:
            antes = parse_params(json.loads(ln[i][len('"params":'):].rstrip().rstrip(',')))
        except ValueError:
            return None
    depois = fn(dict(antes))
    s = serializa_params(depois)
    nova = '"params":' + json.dumps(s, ensure_ascii=False) + ','
    if i >= 0:
        if s:
            ln[i] = nova
        else:
            del ln[i]
    elif s:
        ln.insert(j, nova)
    return '\n'.join(ln)


# ─────────────────────────── a assinatura do projeto ───────────────────────────
def _marca(pdir):
    m = []
    for a in ARQS_ASSINADOS:
        try:
            st = os.stat(os.path.join(pdir, a))
            m.append((a, st.st_mtime_ns, st.st_size))
        except OSError:
            m.append((a, None, None))
    return tuple(m)


def assinatura(pdir):
    marca = _marca(pdir)
    achou = _cache_hash.get(pdir)
    if achou and achou[0] == marca:
        return achou[1]
    h = hashlib.sha256()
    for a in ARQS_ASSINADOS:
        h.update(('\0' + a + '\0').encode('utf-8'))
        try:
            with open(os.path.join(pdir, a), 'rb') as f:
                txt = f.read().decode('utf-8', 'replace')
        except OSError:
            h.update(b'(ausente)')
            continue
        if a != 'schematic.js':
            h.update(txt.replace('\r\n', '\n').encode('utf-8'))
            continue
        cab = True
        for l in _linhas(txt):
            if cab and l.startswith('"items":'):
                cab = False
            if cab and l.startswith('"generated":'):
                continue
            if cab and l.startswith('"params":'):
                try:
                    p = parse_params(json.loads(l[len('"params":'):].rstrip().rstrip(',')))
                except ValueError:
                    p = {}
                resto = ';'.join('%s=%s' % (k, p[k]) for k in sorted(p) if k not in FORA_DA_ASSINATURA)
                if not resto:            # so campos da aprovacao: e como se a linha nao existisse
                    continue
                l = '"params":' + resto
            h.update((l + '\n').encode('utf-8'))
    r = h.hexdigest()[:24]
    _cache_hash[pdir] = (marca, r)
    return r


def _hoje():
    return time.strftime('%d/%m/%y')


def estado_aprovacao(pdir):
    """{aprovado, por, data, carimbo, assinada, temEsquema} do projeto na pasta"""
    sch = os.path.join(pdir, 'schematic.js')
    try:
        with open(sch, encoding='utf-8') as f:
            p = params_do_texto(f.read())
    except OSError:
        return {'aprovado': False, 'temEsquema': False, 'assinada': False}
    ass = p.get('Aprovacao_assinatura') or ''
    ok = bool(ass and (p.get('Aprovador_DiEletrons') or '').strip() and ass == assinatura(pdir))
    return {'aprovado': ok, 'por': p.get('Aprovador_DiEletrons') or '', 'data': p.get('Data_aprovacao') or '',
            'carimbo': p.get('Aprovacao_carimbo') or '', 'assinada': bool(ass), 'temEsquema': True}


def limpa_aprovacao(texto):
    """o schematic.js sem os campos da aprovacao e com o Data_desenho de hoje (a modificacao que derrubou a aprovacao)"""
    def fn(p):
        for k in CAMPOS_APROVACAO:
            p.pop(k, None)
        p['Data_desenho'] = _hoje()
        return p
    return troca_params(texto, fn)


def confere(pdir, agora=None):
    """o estado do projeto; assinatura velha ha mais que a CARENCIA: tira os campos da aprovacao do schematic.js"""
    e = estado_aprovacao(pdir)
    if e['aprovado'] or not e.get('assinada'):
        _desde.pop(pdir, None)
        return e
    agora = agora if agora is not None else time.time()
    t0 = _desde.setdefault(pdir, agora)
    if agora - t0 < CARENCIA:
        return e
    sch = os.path.join(pdir, 'schematic.js')
    try:
        with open(sch, encoding='utf-8', newline='') as f:
            txt = f.read()
        novo = limpa_aprovacao(txt)
        if novo is not None and novo != txt.replace('\r\n', '\n'):
            with open(sch, 'w', encoding='utf-8', newline='') as f:
                f.write(novo)
    except OSError:
        return e
    _desde.pop(pdir, None)
    return estado_aprovacao(pdir)


# ─────────────────────────── rotas ───────────────────────────
def registra(app, root, senha_mestre):
    pdir_raiz = os.path.join(root, 'Projects')

    def pasta(nome):
        nome = str(nome or '')
        if not nome or nome != os.path.basename(nome) or nome in ('.', '..'):
            return None
        d = os.path.join(pdir_raiz, nome)
        return d if os.path.isdir(d) else None

    def corpo():
        return request.get_json(silent=True) or {}

    @app.route('/api/carimbos')
    def carimbos_lista():
        d = _le(root)
        lst = sorted((_publico(c) for c in d['carimbos'].values()), key=lambda c: c['nome'].lower())
        a = ativo(root)
        return {'ok': True, 'carimbos': lst, 'ativo': _publico(a) if a else None, 'tagAprovador': TAG_APROVADOR}

    @app.route('/api/carimbos', methods=['POST'])
    def carimbos_cria():
        b = corpo()
        nome = _nome(b.get('nome'))
        senha = b.get('senha')
        tags = _tags(b.get('tags'))
        if not nome:
            return {'ok': False, 'error': 'dê um nome ao carimbo'}, 400
        if not isinstance(senha, str) or len(senha) < 1:
            return {'ok': False, 'error': 'dê uma senha ao carimbo'}, 400
        if TAG_APROVADOR in tags and not _mestre_ok(b.get('mestre'), senha_mestre):
            return {'ok': False, 'error': 'a tag aprovador pede a senha mestre', 'mestre': True}, 403
        with _trava:
            d = _le(root)
            if any(c['nome'].lower() == nome.lower() for c in d['carimbos'].values()):
                return {'ok': False, 'error': 'já existe um carimbo com esse nome'}, 409
            base = re.sub(r'[^a-z0-9]+', '-', nome.lower()).strip('-') or 'carimbo'
            cid = base
            while cid in d['carimbos']:
                cid = base + '-' + secrets.token_hex(2)
            sal = secrets.token_hex(16)
            d['carimbos'][cid] = {'id': cid, 'nome': nome, 'tags': tags, 'sal': sal, 'senha': _hash_senha(senha, sal),
                                  'criado': time.strftime('%Y-%m-%dT%H:%M:%S')}
            _grava(root, d)
        return {'ok': True, 'carimbo': _publico(d['carimbos'][cid])}

    @app.route('/api/carimbos/entrar', methods=['POST'])
    def carimbos_entrar():
        b = corpo()
        c = _le(root)['carimbos'].get(b.get('id'))
        if not c:
            return {'ok': False, 'error': 'carimbo não encontrado'}, 404
        senha = b.get('senha')
        if not isinstance(senha, str) or not hmac.compare_digest(_hash_senha(senha, c['sal']), c['senha']):
            return {'ok': False, 'error': 'senha do carimbo incorreta'}, 403
        _grava_ativo(root, c['id'])
        return {'ok': True, 'ativo': _publico(c)}

    @app.route('/api/carimbos/sair', methods=['POST'])
    def carimbos_sair():
        _grava_ativo(root, None)
        return {'ok': True, 'ativo': None}

    @app.route('/api/carimbos/tags', methods=['POST'])
    def carimbos_tags():
        b = corpo()
        if not _mestre_ok(b.get('mestre'), senha_mestre):
            return {'ok': False, 'error': 'senha mestre incorreta'}, 403
        with _trava:
            d = _le(root)
            c = d['carimbos'].get(b.get('id'))
            if not c:
                return {'ok': False, 'error': 'carimbo não encontrado'}, 404
            c['tags'] = _tags(b.get('tags'))
            _grava(root, d)
        return {'ok': True, 'carimbo': _publico(c)}

    @app.route('/api/carimbos/apagar', methods=['POST'])
    def carimbos_apagar():
        b = corpo()
        if not _mestre_ok(b.get('mestre'), senha_mestre):
            return {'ok': False, 'error': 'senha mestre incorreta'}, 403
        with _trava:
            d = _le(root)
            c = d['carimbos'].pop(b.get('id'), None)
            if not c:
                return {'ok': False, 'error': 'carimbo não encontrado'}, 404
            _grava(root, d)
        if _ativo_id(root) == c['id']:
            _grava_ativo(root, None)
        return {'ok': True}

    @app.route('/api/aprovacao')
    def aprovacao_estado():
        d = pasta(request.args.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        return dict(ok=True, **confere(d))

    @app.route('/api/aprovacoes')
    def aprovacoes():
        out = {}
        try:
            nomes = sorted(os.listdir(pdir_raiz))
        except OSError:
            nomes = []
        for n in nomes:
            d = os.path.join(pdir_raiz, n)
            if os.path.isdir(d):
                e = confere(d)
                out[n] = {'aprovado': e['aprovado'], 'por': e.get('por', ''), 'data': e.get('data', '')}
        return {'ok': True, 'projetos': out}

    @app.route('/api/aprovacao', methods=['POST'])
    def aprova():
        d = pasta(corpo().get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        c = ativo(root)
        if not c:
            return {'ok': False, 'error': 'nenhum carimbo em uso neste computador'}, 403
        if TAG_APROVADOR not in (c.get('tags') or []):
            return {'ok': False, 'error': 'o carimbo ' + c['nome'] + ' não tem a tag aprovador'}, 403
        sch = os.path.join(d, 'schematic.js')
        with _trava:
            try:
                with open(sch, encoding='utf-8', newline='') as f:
                    txt = f.read()
            except OSError:
                return {'ok': False, 'error': 'o projeto não tem schematic.js'}, 404
            hoje = _hoje()
            ass = assinatura(d)

            def fn(p):
                p['Verificador_DiEletrons'] = c['nome']
                p['Aprovador_DiEletrons'] = c['nome']
                p['Data_verificacao'] = hoje
                p['Data_aprovacao'] = hoje
                p['Aprovacao_carimbo'] = c['id']
                p['Aprovacao_assinatura'] = ass
                return p
            novo = troca_params(txt, fn)
            if novo is None:
                return {'ok': False, 'error': 'o schematic.js não está no formato que o hub grava'}, 409
            with open(sch, 'w', encoding='utf-8', newline='') as f:
                f.write(novo)
        _desde.pop(d, None)
        e = estado_aprovacao(d)
        if not e['aprovado']:            # a assinatura nao pode depender do proprio cabecalho
            return {'ok': False, 'error': 'a aprovação não conferiu depois de gravada'}, 500
        return dict(ok=True, texto=novo, params=serializa_params(params_do_texto(novo)), **e)
