# -*- coding: utf-8 -*-
"""Rotas /api/aprovacao* e /api/revisoes*: a aprovacao do projeto e as revisoes (ate a 1.83.0, tools/rotas/carimbos.py).

Pedido do dono (2026-11-05): "se a pessoa [for] aprovador ela pode aprovar o projeto [...] no menu de projeto fica uma
TAG na frente do nome 'CBM-DI251876 [Aprovado]' e no template vai o nome de quem aprovou [...] enquanto nao tiver
aprovado fica 'Sem aprovacao'; toda vez que tiver uma modificacao no projeto a tag de aprovado some [...] quem verifica
tambem aprova, entao ja completa os dois campos no template ao mesmo tempo".

QUEM DESENHA E QUEM APROVA E O LOGIN DO NEXO HUB (1.84.0, pedido do dono em 2026-11-09: "nao precisa mais de carimbo,
pelo login mesmo ja pega o nome, se ele e aprovador ou nao, quem decide isso e o admin no Nexo Hub"). O servidor pergunta
ao Hub desta maquina quem esta logado (tools/rotas/equipe.py » sessao):
  - Aprovar pede usuario.aprovador (marcado pelo administrador no Hub, Configuracoes › Usuarios) e que a pessoa possa
    mexer no projeto (responsavel, colaborador, admin, ou projeto sem responsavel). Verificador/Aprovador = o nome dela.
  - O desenhista e quem criou o projeto (tools/rotas/projeto_novo.py) ou quem o assumiu (POST /api/equipe/assumir, em
    tools/rotas/equipe.py, que chama assume_desenhista daqui): Desenhista_DiEletrons, Desenhista_carimbo e o
    Data_desenho, que so muda nessas duas horas.
  - Apagar revisao e do administrador do Hub ou do responsavel pelo projeto (1.86.0: a mesma regra do Excluir projeto,
    tools/rotas/equipe.py » recusa_apagar). A senha mestre saiu de vez: sem login (Hub antigo, Hub fora) ninguem apaga,
    e aprovar, nele, fica recusado ("Atualize o Nexo Hub").
  - Os campos *_carimbo do cabecalho (Desenhista_carimbo, Aprovacao_carimbo) guardam o LOGIN; o nome dos campos fica por
    causa do template da folha, dos PDFs e das aprovacoes antigas. O sistema de carimbos de antes (nome + senha em
    Libs/carimbos.json, o carimbo em uso em .altiumhub/carimbo-ativo.json, as rotas /api/carimbos*) SAIU: o arquivo
    que ja existe fica quieto no NexoBD, ninguem mais le. As aprovacoes antigas continuam valendo (a assinatura).

ONDE MORA
  schematic.js (cabecalho)      a aprovacao: os campos do template (Verificador_DiEletrons, Aprovador_DiEletrons,
                                Data_verificacao, Data_aprovacao) e a ASSINATURA do que foi aprovado
                                (Aprovacao_assinatura, Aprovacao_carimbo). Viaja junto com o esquema, num arquivo so.

AS REVISOES (2026-11-05: "a revisao e definida no momento em que aprova: o projeto esta na REV.A, o aprovador aprova
1x, o projeto salva como REV.A no historico; vai ter uma aba Revisoes onde voce ve o que foi alterado e pode selecionar
aquela revisao, que volta todo o projeto para o estado dela; algo foi modificado, tem que aprovar a 2x, salva REV.B").
Cada aprovacao grava o campo Revisao do cabecalho e uma COPIA do projeto em Projects/<p>/Revisoes/REV.<x>/ (os arquivos
da pasta do projeto, sem as subpastas e sem o estado local da bancada), com a linha dela em Revisoes/revisoes.json:
quem aprovou (o usuario, para a foto), quando, a assinatura e o resumo do que mudou desde a revisao anterior. A pasta
Revisoes/ viaja com o projeto para o NexoBD e fica fora do vigia do hub (como Gerber/ e PDF/). Voltar para uma revisao
copia os arquivos dela de volta: o projeto fica identico ao aprovado, e com isso aprovado de novo.

A ASSINATURA e o sha256 do projeto como ele estava na aprovacao: a impressao eletrica do schematic.js (componentes e
ligacoes), os parametros do projeto, changes.js e board.js. Projeto aprovado = assinatura igual a de agora. Mudou
qualquer um deles: a tag volta a "Sem aprovacao" na hora, e passada a CARENCIA (o NexoBD pode estar trazendo os arquivos
de outra maquina um de cada vez) os campos da aprovacao saem do cabecalho. Assumir o projeto nao mexe na aprovacao.

Rotas:
  GET  /api/aprovacao?projeto=             -> {ok, aprovado, por, data, carimbo (o login), usuario, temEsquema}
  GET  /api/aprovacoes                     -> {ok, projetos:{<nome>: {aprovado, por, data}}}
  POST /api/aprovacao {projeto, rev?}      -> aprova como quem esta logado (aprovador) e grava a revisao: {ok, texto, params, rev, ...}
                                              rev (1.97.5): a letra escolhida no Aprovar ("B", "REV.B"); sem ela, a seguinte.
                                              Pedido do dono: "quando o aprovador for aprovar, apresentar a opcao criar Rev
                                              nova ou manter a atual — temos eventos de edicao mesmo apos a aprovacao, e a
                                              rev so vem depois da placa produzida; melhor seria nova rev como padrao ou
                                              escolher a rev". A letra que ja existe no historico tem a copia substituida.
  GET  /api/revisoes?projeto=              -> {ok, revisoes:[{rev, data, quando, aprovador, usuario, resumo}], atual:{rev, aprovado, mudancas}}
  POST /api/revisoes/voltar {projeto, rev} -> o projeto volta a ser o da revisao
  POST /api/revisoes/apagar {projeto, rev}  -> tira a revisao do historico (a de agora tira tambem a aprovacao)
"""
import hashlib
import json
import os
import re
import threading
import time

from flask import request

try:
    import equipe as _eq           # tools/rotas/equipe.py: quem esta logado no Nexo Hub e a equipe do projeto
except Exception:                  # noqa: BLE001
    _eq = None

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
FORA_DA_REVISAO = {'bom-vistos.json', 'bom-opts.json', 'odoo-lista.json', 'lista-extras.json',
                   # a equipe (1.84.0): voltar uma revisao nao pode trazer de volta quem ja saiu do projeto
                   'equipe.json'}
ARQS_ASSINADOS = ('schematic.js', 'changes.js', 'board.js')

_trava = threading.Lock()
_cache_hash = {}          # pasta -> (marca dos arquivos, assinatura)
_desde = {}               # pasta -> quando a assinatura passou a nao bater


# ─────────────────────────── o nome ───────────────────────────
def _nome(v):
    """o nome vai para o cabecalho da folha (campo K=V;K=V): sem ; nem | nem aspas-dois-pontos"""
    return ' '.join(str(v or '').replace(';', ',').replace('|', '/').replace('":', '" :').split())


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
        print('[aprovacao] impressao eletrica: %s' % e, flush=True)
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


def copia_da_aprovacao(pdir, p, ass):
    """a pasta Revisoes/REV.<x>/ que guarda o projeto como estava na aprovacao `ass` (o schematic.js dela traz a mesma
    Aprovacao_assinatura; a da assinatura velha, pela assinatura legada da copia); None se nao tem"""
    rd = os.path.join(pdir, PASTA_REV, 'REV.' + letra_da_revisao(p.get('Revisao')))
    sch = os.path.join(rd, 'schematic.js')
    if not os.path.isfile(sch):
        return None
    try:
        with open(sch, encoding='utf-8') as f:
            pr = params_do_texto(f.read())
    except OSError:
        return None
    if pr.get('Aprovacao_assinatura') == ass:
        return rd
    if not ass.startswith(PREFIXO) and assinatura_legada(rd) == ass:
        return rd
    return None


def estado_aprovacao(pdir):
    """{aprovado, por, data, carimbo, assinada, temEsquema} do projeto na pasta

    1.97.6 (2026-11-11, o MIRBC): a assinatura gravada foi feita pela conta de UMA maquina — a impressao eletrica depende
    da versao do NexoEletric (hub-core.js) e das bibliotecas dela (SchLib, acervos do almoxarifado). Aprovado na 1.97.5,
    o LUCAS-PC, numa versao anterior a 1.96.0, achou a assinatura diferente e, passada a carencia, apagou a aprovacao
    das duas placas sem ninguem ter mexido. Agora, quando a assinatura gravada nao bate, a duvida se tira pela copia da
    revisao (Revisoes/REV.<x>/, o projeto como foi aprovado), assinada com a conta DESTA maquina: copia e projeto de
    agora na mesma conta = nada eletrico mudou. Sem a copia nao ha como ter certeza: a tag fica "Sem aprovacao", mas
    o carimbo nao e apagado (`limpavel` False)."""
    sch = os.path.join(pdir, 'schematic.js')
    try:
        with open(sch, encoding='utf-8') as f:
            p = params_do_texto(f.read())
    except OSError:
        return {'aprovado': False, 'temEsquema': False, 'assinada': False}
    ass = p.get('Aprovacao_assinatura') or ''
    conferida = True
    limpavel = True
    ok = False
    if ass and (p.get('Aprovador_DiEletrons') or '').strip():
        atual = assinatura(pdir)
        if atual is None:                  # sem o Node nao da para conferir: fica como esta, e nada e limpo
            ok, conferida = True, False
        else:
            # a mesma conta de quem aprovou (a assinatura velha, antes da 1.80.0: o texto inteiro do esquema)
            ok = ass == atual if ass.startswith(PREFIXO) else ass == assinatura_legada(pdir)
            if not ok:
                # a copia da revisao aprovada, pela conta desta maquina (vale para outra versao, outra biblioteca e
                # para a assinatura velha, onde so mudou o que nao e eletrico)
                rd = copia_da_aprovacao(pdir, p, ass)
                if rd is None:
                    limpavel = False
                else:
                    ar = assinatura(rd)
                    if ar is None:
                        ok, conferida = True, False
                    else:
                        ok = ar == atual
    return {'aprovado': ok, 'conferida': conferida, 'limpavel': limpavel,
            'por': p.get('Aprovador_DiEletrons') or '', 'data': p.get('Data_aprovacao') or '',
            'rev': p.get('Revisao') or '',
            'carimbo': p.get('Aprovacao_carimbo') or '', 'assinada': bool(ass), 'temEsquema': True}


def limpa_aprovacao(texto):
    """o schematic.js sem os campos da aprovacao (a modificacao que derrubou a aprovacao)"""
    def fn(p):
        for k in CAMPOS_APROVACAO:
            p.pop(k, None)
        return p
    return troca_params(texto, fn)


def params_desenhista(usuario, data=None):
    """os campos do desenhista no cabecalho da folha: o nome, o login (no campo Desenhista_carimbo, o nome de sempre) e a
    data (hoje)"""
    return {'Desenhista_DiEletrons': _nome(usuario['nome']), 'Desenhista_carimbo': usuario.get('login') or usuario['id'],
            'Data_desenho': data or _hoje()}


def assume_desenhista(pdir, usuario):
    """quem assumiu o projeto vira o desenhista no carimbo da folha (com a data de hoje). -> {texto, params, ...} | {}"""
    sch = os.path.join(pdir, 'schematic.js')
    with _trava:
        try:
            with open(sch, encoding='utf-8', newline='') as f:
                txt = f.read()
        except OSError:
            return {}
        novo = troca_params(txt, lambda p: dict(p, **params_desenhista(usuario)))
        if novo is None:
            return {}
        with open(sch, 'w', encoding='utf-8', newline='') as f:
            f.write(novo)
    return {'texto': novo, 'params': serializa_params(params_do_texto(novo)), 'desenhista': usuario['nome'],
            'dataDesenho': _hoje()}


def _quem_aprova():
    """(usuario, None) ou (None, (corpo, status)): so quem e aprovador no Nexo Hub aprova"""
    if _eq is None:
        return None, ({'ok': False, 'error': 'o módulo da equipe (tools/rotas/equipe.py) não carregou'}, 500)
    s = _eq.sessao(forcar=True)
    if s['modo'] == 'legado':
        return None, ({'ok': False, 'codigo': 'hub_antigo', 'error': _eq.MSG_LEGADO}, 403)
    if s['modo'] == 'fora':
        return None, ({'ok': False, 'codigo': 'sem_hub', 'error': _eq.MSG_FORA}, 503)
    u = s['usuario']
    if not u:
        return None, ({'ok': False, 'codigo': 'sem_login', 'error': _eq.MSG_DESLOGADO}, 401)
    if not u.get('aprovador'):
        return None, ({'ok': False, 'codigo': 'nao_aprovador',
                       'error': 'Só quem é aprovador no Nexo Hub aprova — o administrador marca em Configurações › Usuários'}, 403)
    return u, None


def confere(pdir, agora=None):
    """o estado do projeto; assinatura velha ha mais que a CARENCIA: tira os campos da aprovacao do schematic.js"""
    e = estado_aprovacao(pdir)
    # 1.97.6: sem a copia da revisao para confirmar (limpavel False), a diferenca pode ser so a conta de outra versao
    if e['aprovado'] or not e.get('assinada') or e.get('conferida') is False or e.get('limpavel') is False:
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
            out.append('folha, %s: %s → %s' % (k.replace('_DiEletrons', '').replace('_', ' '), pa.get(k) or '—', pd.get(k) or '—'))
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


def grava_revisao(pdir, rev, usuario, ass):
    """copia o projeto para Revisoes/REV.<rev>/ e acrescenta a linha no revisoes.json; `usuario` = quem aprovou
    {id, login, nome} (vai inteiro na linha, para a foto)"""
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
    linha = {'rev': rev, 'quando': time.strftime('%Y-%m-%dT%H:%M:%S'), 'data': _hoje(), 'aprovador': usuario['nome'],
             'carimbo': usuario.get('login') or usuario['id'], 'assinatura': ass, 'arquivos': arqs,
             'resumo': resumo(antes, _le_arquivos(destino)),
             'usuario': {'id': usuario['id'], 'login': usuario.get('login', ''), 'nome': usuario['nome']}}
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
        if os.path.basename(n) != n or not os.path.isfile(src) or n in FORA_DA_REVISAO:
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
def registra(app, root, *_antigo):
    # *_antigo: ate a 1.85.0 o hubserver passava a senha mestre aqui; ela saiu (1.86.0) e o que vier e ignorado
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

    def quem_aprovou(d, e):
        """o usuario da ultima revisao, quando e a de agora (para a foto de quem aprovou)"""
        if not e.get('aprovado'):
            return None
        rv = letra_da_revisao(e.get('rev'))
        linha = next((x for x in reversed(revisoes(d)) if x.get('rev') == rv), None)
        return (linha or {}).get('usuario')

    @app.route('/api/aprovacao')
    def aprovacao_estado():
        d = pasta(request.args.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        e = confere(d)
        # 1.97.5: a revisao que o Aprovar oferece como nova, e as que ja existem (para escolher)
        txt = _le_arquivos(d, ('schematic.js',))['schematic.js'] or ''
        extra = {'proxima': 'REV.' + proxima_revisao(d, params_do_texto(txt)),
                 'revisoes': ['REV.' + x.get('rev') for x in revisoes(d) if x.get('rev')]}
        return dict(ok=True, usuario=quem_aprovou(d, e), **dict(e, **extra))

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
        # 1.84.0: quem aprova e quem esta logado no Nexo Hub, com a marca de aprovador (nao mais o carimbo)
        c, erro = _quem_aprova()
        if erro:
            return erro
        recusa = _eq.recusa_gravar(d)
        if recusa:
            return recusa, 403
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
            # 1.97.5: a letra escolhida no Aprovar (nova e o padrao; "manter a atual" ou outra)
            pedida = corpo().get('rev')
            if pedida not in (None, '', 'nova'):
                letra = letra_da_revisao(pedida)
                if not re.match(r'^[A-Z]{1,3}$', letra or ''):
                    return {'ok': False, 'error': 'revisão inválida: %s (use a letra, ex.: B ou REV.B)' % pedida}, 400
                rev = letra
            substituiu = any(x.get('rev') == rev for x in revisoes(d))

            def fn(p):
                p['Revisao'] = 'REV.' + rev
                p['Verificador_DiEletrons'] = c['nome']
                p['Aprovador_DiEletrons'] = c['nome']
                p['Data_verificacao'] = hoje
                p['Data_aprovacao'] = hoje
                p['Aprovacao_carimbo'] = c.get('login') or c['id']
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
            linha = grava_revisao(d, rev, _eq.quem(c), ass)
        _desde.pop(d, None)
        _eq.evento(d, 'aprovacao', ['%s aprovou o projeto: REV.%s' % (c['nome'], rev)], c)
        return dict(e, ok=True, texto=novo, params=serializa_params(params_do_texto(novo)), rev='REV.' + rev,
                    resumo=linha['resumo'], usuario=_eq.quem(c), substituiu=substituiu)

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
        """2026-11-06: "no historico de revisoes, quero poder apagar uma revisao". Apagar a revisao em que o projeto esta
        aprovado tira a aprovacao (o carimbo da folha nao pode apontar para uma revisao que sumiu). 1.86.0: quem apaga e
        o administrador do Nexo Hub ou o responsavel pelo projeto, pelo login; sem senha mestre."""
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        # 1.86.0: o administrador do Nexo Hub ou o responsavel pelo projeto, pelo login (a regra do Excluir projeto)
        if _eq is None:
            return {'ok': False, 'codigo': 'sem_permissao', 'error': 'apagar revisão pede o login do Nexo Hub'}, 403
        s = _eq.sessao(forcar=True)
        u = s['usuario']
        recusa = _eq.recusa_apagar(d, s, revisao=True)
        if recusa:
            return recusa, 403
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
        if _eq is not None:
            _eq.evento(d, 'revisao', ['REV.%s apagada do histórico%s' % (rev, ' (o projeto ficou sem aprovação)' if tirou else '')], u)
        return dict(estado_aprovacao(d), ok=True, rev='REV.' + rev, aprovacaoTirada=tirou)

    @app.route('/api/revisoes/voltar', methods=['POST'])
    def revisoes_voltar():
        b = corpo()
        d = pasta(b.get('projeto'))
        if not d:
            return {'ok': False, 'error': 'projeto desconhecido'}, 404
        rev = letra_da_revisao(b.get('rev'))
        if _eq is not None:
            recusa = _eq.recusa_gravar(d)
            if recusa:
                return recusa, 403
        with _trava:
            feitos = volta_revisao(d, rev)
        if feitos is None:
            return {'ok': False, 'error': 'a revisão %s não existe neste projeto' % b.get('rev')}, 404
        _desde.pop(d, None)
        if _eq is not None:
            _eq.evento(d, 'revisao', ['projeto voltou para a REV.%s' % rev], _eq.sessao()['usuario'])
        return dict(estado_aprovacao(d), ok=True, rev='REV.' + rev, arquivos=feitos)
