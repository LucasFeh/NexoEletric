# -*- coding: utf-8 -*-
"""Rotas /api/carimbos* e /api/aprovacao*: os carimbos da casa (quem desenha, quem aprova) e a aprovacao do projeto.

Pedido do dono (2026-11-05): "no menu [da folha] tem carimbo, quero clicar ali e ter carimbos pre estabelecidos; voce salva
um carimbo, ele fica com o nome que voce der, pra todo mundo, fica salvo no DB; quero dar TAG de aprovador; se a pessoa
estiver com tag de aprovador ela pode aprovar o projeto [...] no menu de projeto fica uma TAG na frente do nome
'CBM-DI251876 [Aprovado]' e no template vai o nome de quem aprovou; pra trocar de carimbo precisa a senha daquele carimbo;
pra apagar o carimbo, a senha mestre do sistema". E logo depois: "enquanto nao tiver aprovado fica 'Sem aprovacao'; toda
vez que tiver uma modificacao no projeto a tag de aprovado some [...] quem verifica tambem aprova, entao ja completa
os dois campos no template ao mesmo tempo". E depois (o mesmo dia): "o carimbo carrega o nome de quem desenhou e quem
aprova; se voce iniciar um projeto, seu nome fica como desenhista; o carimbo do projeto so pode ser trocado com a senha
mestre: 'assumir projeto' troca o desenhista atual pelo seu, e a data do desenho e definida quando o projeto e criado
ou assumido".

ONDE MORA
  Libs/carimbos.json            os carimbos (nome, tags, senha com sal em PBKDF2). Libs/ e o item "Biblioteca do
                                NexoEletric" no NexoBD (electron/lib/armazem.js): vale para todas as maquinas.
  .altiumhub/carimbo-ativo.json o carimbo em uso NESTA maquina (nao viaja: cada computador tem o seu).
  schematic.js (cabecalho)      a aprovacao: os campos do template (Verificador_DiEletrons, Aprovador_DiEletrons,
                                Data_verificacao, Data_aprovacao) e a ASSINATURA do que foi aprovado
                                (Aprovacao_assinatura, Aprovacao_carimbo). Viaja junto com o esquema, num arquivo so.

O DESENHISTA e quem criou o projeto (tools/rotas/projeto_novo.py usa o carimbo em uso) ou quem o ASSUMIU (POST
/api/carimbos/assumir, com a senha mestre): Desenhista_DiEletrons, Desenhista_carimbo e o Data_desenho, que so muda
nessas duas horas.

AS REVISOES (2026-11-05: "a revisao e definida no momento em que aprova: o projeto esta na REV.A, o aprovador aprova
1x, o projeto salva como REV.A no historico; vai ter uma aba Revisoes onde voce ve o que foi alterado e pode selecionar
aquela revisao, que volta todo o projeto para o estado dela; algo foi modificado, tem que aprovar a 2x, salva REV.B").
Cada aprovacao grava o campo Revisao do carimbo e uma COPIA do projeto em Projects/<p>/Revisoes/REV.<x>/ (os arquivos
da pasta do projeto, sem as subpastas e sem o estado local da bancada), com a linha dela em Revisoes/revisoes.json:
quem aprovou, quando, a assinatura e o resumo do que mudou desde a revisao anterior. A pasta Revisoes/ viaja com o
projeto para o NexoBD e fica fora do vigia do hub (como Gerber/ e PDF/). Voltar para uma revisao copia os arquivos
dela de volta: o projeto fica identico ao aprovado, e com isso aprovado de novo.

A ASSINATURA e o sha256 do projeto como ele estava na aprovacao: schematic.js (sem a linha "generated" e sem os campos
das pessoas e das datas no cabecalho), changes.js e board.js. Projeto aprovado = assinatura igual a de agora.
Mudou qualquer um deles (o esquema salvo, a PCB editada, a IA mexeu): a tag volta a "Sem aprovacao" na hora, e passada
a CARENCIA (o NexoBD pode estar trazendo os arquivos de outra maquina um de cada vez) os campos da aprovacao saem do
cabecalho. A vista Esquema faz o mesmo ao salvar uma edicao (hub-carimbos.js » antesDeSalvar), sem esperar. Assumir o
projeto nao mexe na aprovacao (nao muda o desenho).

Rotas:
  GET  /api/carimbos                       -> {ok, carimbos:[{id, nome, tags}], ativo:{id, nome, tags}|null}
  POST /api/carimbos {nome, senha, tags?, mestre?}          cria (tag aprovador pede a senha mestre)
  POST /api/carimbos/entrar {id, senha}                     passa a usar o carimbo nesta maquina
  POST /api/carimbos/sair                                   nenhum carimbo nesta maquina
  POST /api/carimbos/tags {id, tags, mestre}                troca as tags (senha mestre)
  POST /api/carimbos/editar {id, senha|mestre, nome?, novaSenha?}  troca o nome e/ou a senha (senha atual ou mestre)
  POST /api/carimbos/apagar {id, mestre}                    apaga (senha mestre)
  POST /api/carimbos/assumir {projeto, mestre}              o carimbo em uso vira o desenhista do projeto (senha mestre)
  GET  /api/aprovacao?projeto=             -> {ok, aprovado, por, data, carimbo, temEsquema}
  GET  /api/aprovacoes                     -> {ok, projetos:{<nome>: {aprovado, por, data}}}
  POST /api/aprovacao {projeto}            -> aprova com o carimbo ativo (tag aprovador) e grava a revisao: {ok, texto, params, rev, ...}
  GET  /api/revisoes?projeto=              -> {ok, revisoes:[{rev, data, quando, aprovador, resumo}], atual:{rev, aprovado, mudancas}}
  POST /api/revisoes/voltar {projeto, rev} -> o projeto volta a ser o da revisao
  POST /api/revisoes/apagar {projeto, rev, mestre} -> tira a revisao do historico (a de agora tira tambem a aprovacao)
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
CAMPOS_DESENHISTA = ('Desenhista_DiEletrons', 'Desenhista_carimbo', 'Data_desenho')
# a Revisao e do Aprovar (a letra da revisao que esta aprovacao grava): nao e desenho
FORA_DA_ASSINATURA = set(CAMPOS_APROVACAO) | set(CAMPOS_DESENHISTA) | {'Revisao'}
PASTA_REV = 'Revisoes'
ARQ_REV = 'revisoes.json'
# o estado local da bancada e o que nao e projeto (hubserver.py » ESTADO_LOCAL): nao entra na copia da revisao
FORA_DA_REVISAO = {'bom-vistos.json', 'bom-opts.json', 'odoo-lista.json', 'lista-extras.json'}
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


# A ASSINATURA ELETRICA (2026-11-05: "so muda revisao no esquema se troca realmente componente ou altera algo relevante
# na ligacao; ja na PCB gera revisao de qualquer forma"). Do schematic.js entra a impressao eletrica (componentes e
# netlist, mcp/lib/impressao-eletrica.js, no Node: o mesmo extractNets da tela) e os parametros do projeto no
# cabecalho; o changes.js e o board.js (a PCB) entram inteiros. Mover, arrastar, texto, folha: nao mudam a assinatura.
# Prefixo 'e1-'. A assinatura velha (sem prefixo, o texto inteiro do esquema) continua valendo: confere com a pasta da
# revisao (estado_aprovacao).
PREFIXO = 'e1-'
RAIZ = [os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))]   # registra() troca pela do hub
_cache_eletrica = {}      # caminho do schematic.js -> ((mtime, tamanho), hash)


def impressoes_eletricas(arquivos):
    """{caminho do schematic.js: hash 24 hex | None} pelo Node; None em tudo se o Node nao respondeu"""
    falta = []
    out = {}
    for a in arquivos:
        try:
            st = os.stat(a)
            m = (st.st_mtime_ns, st.st_size)
        except OSError:
            out[a] = None
            continue
        achou = _cache_eletrica.get(a)
        if achou and achou[0] == m:
            out[a] = achou[1]
        else:
            falta.append((a, m))
    if not falta:
        return out
    import subprocess
    try:
        import jlc
        node, extra = jlc.acha_node()
        if node is None:
            raise RuntimeError(extra)
        env = dict(os.environ)
        env.update(extra)
        root = RAIZ[0]
        p = subprocess.run(node + [os.path.join(root, 'mcp', 'lib', 'impressao-eletrica.js'), '--cli'],
                           input=json.dumps({'root': root, 'arquivos': [a for a, _ in falta]}).encode('utf-8'),
                           capture_output=True, env=env, cwd=root, timeout=120,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        linhas = [l for l in p.stdout.decode('utf-8', 'replace').splitlines() if l.strip()]
        r = json.loads(linhas[-1]) if linhas else {}
        if not r.get('ok'):
            raise RuntimeError(r.get('erro') or p.stderr.decode('utf-8', 'replace')[-300:])
        hs = r.get('hashes') or {}
    except Exception as e:                 # noqa: BLE001
        print('[carimbos] impressao eletrica: %s' % e, flush=True)
        for a, _ in falta:
            out[a] = None
        return out
    for a, m in falta:
        out[a] = hs.get(a)
        if out[a]:
            _cache_eletrica[a] = (m, out[a])
    return out


def assinatura(pdir):
    """'e1-' + 24 hex: a impressao eletrica do esquema + os parametros do projeto + a PCB inteira; None se o Node
    nao respondeu (ninguem tira aprovacao por isso)"""
    marca = _marca(pdir)
    achou = _cache_hash.get(('e1', pdir))
    if achou and achou[0] == marca:
        return achou[1]
    sch = os.path.join(pdir, 'schematic.js')
    if os.path.isfile(sch):
        el = impressoes_eletricas([sch]).get(sch)
        if not el:
            return None
    else:
        el = '(ausente)'
    h = hashlib.sha256()
    h.update(('\0eletrica\0' + el).encode('utf-8'))
    try:
        with open(sch, encoding='utf-8') as f:
            p = params_do_texto(f.read())
    except OSError:
        p = {}
    h.update(('\0params\0' + ';'.join('%s=%s' % (k, p[k]) for k in sorted(p) if k not in FORA_DA_ASSINATURA)).encode('utf-8'))
    for a in ARQS_ASSINADOS:
        if a == 'schematic.js':
            continue
        h.update(('\0' + a + '\0').encode('utf-8'))
        try:
            with open(os.path.join(pdir, a), 'rb') as f:
                h.update(f.read().decode('utf-8', 'replace').replace('\r\n', '\n').encode('utf-8'))
        except OSError:
            h.update(b'(ausente)')
    r = PREFIXO + h.hexdigest()[:24]
    _cache_hash[('e1', pdir)] = (marca, r)
    return r


def assinatura_legada(pdir):
    """a assinatura de antes da 1.80.0: o texto inteiro do esquema (menos os campos da aprovacao), changes.js e board.js"""
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
    conferida = True
    ok = False
    if ass and (p.get('Aprovador_DiEletrons') or '').strip():
        atual = assinatura(pdir)
        if atual is None:                  # sem o Node nao da para conferir: fica como esta, e nada e limpo
            ok, conferida = True, False
        elif ass.startswith(PREFIXO):
            ok = ass == atual
        else:
            # aprovada pela assinatura velha: vale se nada mudou, ou se so mudou o que nao e eletrico desde a revisao
            # aprovada (a copia em Revisoes/REV.<x>/ e o estado da aprovacao)
            ok = ass == assinatura_legada(pdir)
            if not ok:
                rd = os.path.join(pdir, PASTA_REV, 'REV.' + letra_da_revisao(p.get('Revisao')))
                if os.path.isfile(os.path.join(rd, 'schematic.js')) and assinatura_legada(rd) == ass:
                    ar = assinatura(rd)
                    if ar is None:
                        ok, conferida = True, False
                    else:
                        ok = ar == atual
    return {'aprovado': ok, 'conferida': conferida, 'por': p.get('Aprovador_DiEletrons') or '', 'data': p.get('Data_aprovacao') or '',
            'rev': p.get('Revisao') or '',
            'carimbo': p.get('Aprovacao_carimbo') or '', 'assinada': bool(ass), 'temEsquema': True}


def limpa_aprovacao(texto):
    """o schematic.js sem os campos da aprovacao (a modificacao que derrubou a aprovacao)"""
    def fn(p):
        for k in CAMPOS_APROVACAO:
            p.pop(k, None)
        return p
    return troca_params(texto, fn)


def params_desenhista(carimbo, data=None):
    """os campos do desenhista no carimbo da folha: o nome do carimbo, o id dele e a data (hoje)"""
    return {'Desenhista_DiEletrons': carimbo['nome'], 'Desenhista_carimbo': carimbo['id'],
            'Data_desenho': data or _hoje()}


def confere(pdir, agora=None):
    """o estado do projeto; assinatura velha ha mais que a CARENCIA: tira os campos da aprovacao do schematic.js"""
    e = estado_aprovacao(pdir)
    if e['aprovado'] or not e.get('assinada') or e.get('conferida') is False:
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


# ─────────────────────────── as revisoes ───────────────────────────
def revisoes(pdir):
    try:
        with open(os.path.join(pdir, PASTA_REV, ARQ_REV), encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d.get('revisoes'), list):
            return d['revisoes']
    except (OSError, ValueError, AttributeError):
        pass
    return []


def _grava_revisoes(pdir, lista):
    arq = os.path.join(pdir, PASTA_REV, ARQ_REV)
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    tmp = arq + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'format': 'nexoeletric-revisoes-1', 'revisoes': lista}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, arq)


def _letra_seguinte(s):
    """A -> B ... Z -> AA (como coluna de planilha)"""
    s = (s or '').upper()
    if not s or not s.isalpha():
        return 'A'
    n = 0
    for ch in s:
        n = n * 26 + (ord(ch) - 64)
    n += 1
    out = ''
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def letra_da_revisao(texto):
    """'REV.A' / 'REV. B' / 'Rev C' -> 'A' / 'B' / 'C'; '' se nao tem"""
    m = re.search(r'([A-Za-z]{1,3})\s*$', str(texto or '').replace('REV', ' ').replace('Rev', ' ').replace('rev', ' ').strip())
    return m.group(1).upper() if m else ''


def proxima_revisao(pdir, params):
    """a letra que a aprovacao vai gravar: a seguinte da ultima revisao; sem revisao ainda, a do carimbo (REV.A)"""
    lst = revisoes(pdir)
    if lst:
        return _letra_seguinte(lst[-1].get('rev'))
    return letra_da_revisao(params.get('Revisao')) or 'A'


def _arquivos_do_projeto(pdir):
    out = []
    try:
        nomes = sorted(os.listdir(pdir))
    except OSError:
        return out
    for n in nomes:
        if n in FORA_DA_REVISAO or n.endswith('.tmp') or not os.path.isfile(os.path.join(pdir, n)):
            continue
        out.append(n)
    return out


def _le_arquivos(pasta_, nomes=('schematic.js', 'changes.js', 'board.js')):
    out = {}
    for n in nomes:
        try:
            with open(os.path.join(pasta_, n), encoding='utf-8') as f:
                out[n] = f.read().replace('\r\n', '\n')
        except OSError:
            out[n] = None
    return out


def _linhas_json(txt, depois_de=None):
    """os objetos de um arquivo do hub, um por linha (schematic.js depois de "items", changes.js)"""
    out, dentro = [], depois_de is None
    for l in (txt or '').split('\n'):
        if not dentro:
            dentro = l.startswith(depois_de)
            continue
        l = l.strip().rstrip(',')
        if l.startswith('{'):
            try:
                out.append(json.loads(l))
            except ValueError:
                pass
    return out


def _comps(itens):
    por = {}
    for it in itens:
        if it.get('t') != 'comp' or not it.get('ref'):
            continue
        c = por.setdefault(it['ref'], {'sym': it.get('sym'), 'footprint': it.get('footprint'),
                                       'comment': it.get('comment'), 'pos': set()})
        c['pos'].add((it.get('sheet'), it.get('part') or 1, round(it.get('x') or 0), round(it.get('y') or 0),
                      it.get('rot') or 0, bool(it.get('mirror'))))
    return por


def resumo(antes, depois):
    """o que mudou de `antes` para `depois` ({arquivo: texto|None}), em frases curtas"""
    if antes is None:
        return ['primeira revisão']
    out = []
    sa, sd = antes.get('schematic.js') or '', depois.get('schematic.js') or ''
    if sa != sd:
        ia, idd = _linhas_json(sa, '"items":'), _linhas_json(sd, '"items":')
        ca, cd = _comps(ia), _comps(idd)
        novos = sorted(set(cd) - set(ca), key=_nat)
        foram = sorted(set(ca) - set(cd), key=_nat)
        if novos:
            out.append('componentes novos: ' + _lista(novos))
        if foram:
            out.append('componentes removidos: ' + _lista(foram))
        movidos = []
        for r in sorted(set(ca) & set(cd), key=_nat):
            a, b = ca[r], cd[r]
            for k, rot in (('sym', 'símbolo'), ('footprint', 'footprint'), ('comment', 'valor')):
                if (a[k] or '') != (b[k] or ''):
                    out.append('%s: %s %s → %s' % (r, rot, a[k] or '—', b[k] or '—'))
            if a['pos'] != b['pos']:
                movidos.append(r)
        if movidos:
            out.append('componentes movidos: ' + _lista(movidos))
        for t, rot in (('wire', 'fios'), ('netlabel', 'rótulos de net'), ('power', 'símbolos de alimentação'),
                       ('port', 'portas'), ('junction', 'junções'), ('text', 'textos')):
            na = sum(1 for x in ia if x.get('t') == t)
            nd = sum(1 for x in idd if x.get('t') == t)
            la = sorted(json.dumps(x, sort_keys=True) for x in ia if x.get('t') == t)
            ld = sorted(json.dumps(x, sort_keys=True) for x in idd if x.get('t') == t)
            if la != ld:
                out.append('%s: %d → %d' % (rot, na, nd) if na != nd else '%s alterados' % rot)
        fa = [x.get('name') for x in ia if x.get('t') == 'sheet']
        fd = [x.get('name') for x in idd if x.get('t') == 'sheet']
        if fa != fd:
            out.append('folhas: ' + ', '.join(fd or ['—']))
        pa, pd = params_do_texto(sa), params_do_texto(sd)
        for k in sorted(set(pa) | set(pd)):
            if k in FORA_DA_ASSINATURA or pa.get(k) == pd.get(k):
                continue
            out.append('carimbo, %s: %s → %s' % (k.replace('_DiEletrons', '').replace('_', ' '), pa.get(k) or '—', pd.get(k) or '—'))
    ga, gd = antes.get('changes.js'), depois.get('changes.js')
    if (ga or '') != (gd or ''):
        oa, od = _linhas_json(ga or ''), _linhas_json(gd or '')
        out.append('PCB: %d → %d mudanças no changes.js' % (len(oa), len(od)) if len(oa) != len(od)
                   else 'PCB: mudanças do changes.js alteradas')
    if (antes.get('board.js') or '') != (depois.get('board.js') or ''):
        out.append('placa (board.js) diferente')
    return out or ['nada no esquema nem na PCB (só arquivos de apoio)']


def _nat(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', str(s))]


def _lista(xs, n=25):
    return ', '.join(xs[:n]) + (' e mais %d' % (len(xs) - n) if len(xs) > n else '')


def grava_revisao(pdir, rev, carimbo, ass):
    """copia o projeto para Revisoes/REV.<rev>/ e acrescenta a linha no revisoes.json"""
    import shutil
    lst = revisoes(pdir)
    destino = os.path.join(pdir, PASTA_REV, 'REV.' + rev)
    if os.path.isdir(destino):
        shutil.rmtree(destino, ignore_errors=True)
    os.makedirs(destino, exist_ok=True)
    arqs = _arquivos_do_projeto(pdir)
    for n in arqs:
        shutil.copy2(os.path.join(pdir, n), os.path.join(destino, n))
    anterior = lst[-1] if lst else None
    antes = _le_arquivos(os.path.join(pdir, PASTA_REV, 'REV.' + anterior['rev'])) if anterior else None
    linha = {'rev': rev, 'quando': time.strftime('%Y-%m-%dT%H:%M:%S'), 'data': _hoje(), 'aprovador': carimbo['nome'],
             'carimbo': carimbo['id'], 'assinatura': ass, 'arquivos': arqs,
             'resumo': resumo(antes, _le_arquivos(destino))}
    lst = [x for x in lst if x.get('rev') != rev] + [linha]
    _grava_revisoes(pdir, lst)
    return linha


def volta_revisao(pdir, rev):
    """o projeto volta a ser o da revisao: os arquivos dela por cima dos de agora"""
    import shutil
    linha = next((x for x in revisoes(pdir) if x.get('rev') == rev), None)
    origem = os.path.join(pdir, PASTA_REV, 'REV.' + str(rev))
    if not linha or not os.path.isdir(origem):
        return None
    feitos = []
    for n in linha.get('arquivos') or os.listdir(origem):
        src = os.path.join(origem, n)
        if os.path.basename(n) != n or not os.path.isfile(src):
            continue
        tmp = os.path.join(pdir, n + '.tmp')
        shutil.copy2(src, tmp)
        os.replace(tmp, os.path.join(pdir, n))
        feitos.append(n)
    return feitos


def apaga_revisao(pdir, rev):
    """tira a revisao do historico (a linha do revisoes.json e a pasta Revisoes/REV.<rev>/); None se nao existe"""
    import shutil
    lst = revisoes(pdir)
    if not rev or not any(x.get('rev') == rev for x in lst):
        return None
    _grava_revisoes(pdir, [x for x in lst if x.get('rev') != rev])
    pasta_rev = os.path.join(pdir, PASTA_REV, 'REV.' + rev)
    if os.path.isdir(pasta_rev):
        shutil.rmtree(pasta_rev, ignore_errors=True)
    return True


# ─────────────────────────── rotas ───────────────────────────
def registra(app, root, senha_mestre):
    if os.path.isfile(os.path.join(root, 'mcp', 'lib', 'impressao-eletrica.js')):
        RAIZ[0] = root
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

    @app.route('/api/carimbos/editar', methods=['POST'])
    def carimbos_editar():
        """2026-11-06: o Editar do carimbo troca o nome e/ou a senha; pede a senha atual do carimbo (ou a mestre).
        Os projetos que ja levam o nome antigo no carimbo da folha continuam como estao."""
        b = corpo()
        nome = _nome(b.get('nome')) if b.get('nome') is not None else None
        nova = b.get('novaSenha')
        if nome is not None and not nome:
            return {'ok': False, 'error': 'dê um nome ao carimbo'}, 400
        if nova is not None and (not isinstance(nova, str) or not nova):
            return {'ok': False, 'error': 'a senha nova não pode ficar vazia'}, 400
        with _trava:
            d = _le(root)
            c = d['carimbos'].get(b.get('id'))
            if not c:
                return {'ok': False, 'error': 'carimbo não encontrado'}, 404
            senha = b.get('senha')
            pela_senha = isinstance(senha, str) and senha and hmac.compare_digest(_hash_senha(senha, c['sal']), c['senha'])
            if not pela_senha and not _mestre_ok(b.get('mestre'), senha_mestre):
                return {'ok': False, 'error': 'senha atual do carimbo incorreta'}, 403
            if nome and nome.lower() != c['nome'].lower() and any(
                    o['nome'].lower() == nome.lower() for o in d['carimbos'].values() if o['id'] != c['id']):
                return {'ok': False, 'error': 'já existe um carimbo com esse nome'}, 409
            if nome:
                c['nome'] = nome
            if nova:
                c['sal'] = secrets.token_hex(16)
                c['senha'] = _hash_senha(nova, c['sal'])
            c['editado'] = time.strftime('%Y-%m-%dT%H:%M:%S')
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

    @app.route('/api/carimbos/assumir', methods=['POST'])
    def carimbos_assumir():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        c = ativo(root)
        if not c:
            return {'ok': False, 'error': 'nenhum carimbo em uso neste computador'}, 403
        if not _mestre_ok(b.get('mestre'), senha_mestre):
            return {'ok': False, 'error': 'senha mestre incorreta'}, 403
        sch = os.path.join(d, 'schematic.js')
        with _trava:
            try:
                with open(sch, encoding='utf-8', newline='') as f:
                    txt = f.read()
            except OSError:
                return {'ok': False, 'error': 'o projeto não tem schematic.js'}, 404
            novo = troca_params(txt, lambda p: dict(p, **params_desenhista(c)))
            if novo is None:
                return {'ok': False, 'error': 'o schematic.js não está no formato que o hub grava'}, 409
            with open(sch, 'w', encoding='utf-8', newline='') as f:
                f.write(novo)
        return dict(ok=True, texto=novo, params=serializa_params(params_do_texto(novo)), desenhista=c['nome'],
                    dataDesenho=_hoje(), **estado_aprovacao(d))

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
                out[n] = {'aprovado': e['aprovado'], 'por': e.get('por', ''), 'data': e.get('data', ''), 'rev': e.get('rev', '')}
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
            e0 = estado_aprovacao(d)
            if e0.get('aprovado'):
                return {'ok': False, 'error': 'o projeto já está aprovado (%s): modifique e aprove de novo para uma revisão nova'
                                              % (params_do_texto(txt).get('Revisao') or '')}, 409
            hoje = _hoje()
            ass = assinatura(d)
            if ass is None:
                return {'ok': False, 'error': 'não consegui conferir o esquema (o Node do NexoEletric não respondeu): tente de novo'}, 503
            rev = proxima_revisao(d, params_do_texto(txt))

            def fn(p):
                p['Revisao'] = 'REV.' + rev
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
            e = estado_aprovacao(d)
            if not e['aprovado']:            # a assinatura nao pode depender do proprio cabecalho
                with open(sch, 'w', encoding='utf-8', newline='') as f:
                    f.write(txt)
                return {'ok': False, 'error': 'a aprovação não conferiu depois de gravada'}, 500
            linha = grava_revisao(d, rev, c, ass)
        _desde.pop(d, None)
        return dict(e, ok=True, texto=novo, params=serializa_params(params_do_texto(novo)), rev='REV.' + rev,
                    resumo=linha['resumo'])

    @app.route('/api/revisoes')
    def revisoes_lista():
        d = pasta(request.args.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        lst = revisoes(d)
        e = confere(d)
        atual = {'rev': params_do_texto(_le_arquivos(d, ('schematic.js',))['schematic.js'] or '').get('Revisao') or '',
                 'aprovado': e['aprovado']}
        if lst and not e['aprovado']:
            ult = os.path.join(d, PASTA_REV, 'REV.' + lst[-1]['rev'])
            atual['desde'] = 'REV.' + lst[-1]['rev']
            atual['mudancas'] = resumo(_le_arquivos(ult), _le_arquivos(d))
        out = [dict((k, v) for k, v in x.items() if k != 'assinatura') for x in reversed(lst)]
        for x in out:
            x['rev'] = 'REV.' + x['rev']
        return {'ok': True, 'revisoes': out, 'atual': atual}

    @app.route('/api/revisoes/apagar', methods=['POST'])
    def revisoes_apagar():
        """2026-11-06: "no historico de revisoes, quero poder apagar uma revisao" (senha mestre). Apagar a revisao em
        que o projeto esta aprovado tira a aprovacao (o carimbo da folha nao pode apontar para uma revisao que sumiu)."""
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        if not _mestre_ok(b.get('mestre'), senha_mestre):
            return {'ok': False, 'error': 'senha mestre incorreta'}, 403
        rev = letra_da_revisao(b.get('rev'))
        tirou = False
        with _trava:
            e = estado_aprovacao(d)
            atual = e.get('assinada') and letra_da_revisao(e.get('rev')) == rev
            if apaga_revisao(d, rev) is None:
                return {'ok': False, 'error': 'a revisão %s não existe neste projeto' % b.get('rev')}, 404
            if atual:
                sch = os.path.join(d, 'schematic.js')
                try:
                    with open(sch, encoding='utf-8', newline='') as f:
                        txt = f.read()
                    novo = limpa_aprovacao(txt)
                    if novo is not None and novo != txt.replace('\r\n', '\n'):
                        with open(sch, 'w', encoding='utf-8', newline='') as f:
                            f.write(novo)
                        tirou = True
                except OSError:
                    pass
        _desde.pop(d, None)
        return dict(estado_aprovacao(d), ok=True, rev='REV.' + rev, aprovacaoTirada=tirou)

    @app.route('/api/revisoes/voltar', methods=['POST'])
    def revisoes_voltar():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        rev = letra_da_revisao(b.get('rev'))
        with _trava:
            feitos = volta_revisao(d, rev)
        if feitos is None:
            return {'ok': False, 'error': 'a revisão %s não existe neste projeto' % b.get('rev')}, 404
        _desde.pop(d, None)
        return dict(estado_aprovacao(d), ok=True, rev='REV.' + rev, arquivos=feitos)
