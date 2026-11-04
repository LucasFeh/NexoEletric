# -*- coding: utf-8 -*-
"""Componentes criados localmente: a peca que o almoxarifado do Odoo ainda nao tem.

Pedido do dono (2026-11-03): "uma area pra criacao de novos componentes no NexoEletric, diferenciados
dos que vem da lib do Odoo, uma tag dizendo 'criado localmente' ... todos os parametros necessarios
pro envio do Odoo, e MCP completo pra que a IA possa criar, atribuir simbolo e footprint ... quando a
sincronizacao acontecer de novo, o componente que estava com a tag e que foi gerado no Odoo, atraves
do 'enviar para Odoo', perde a tag e e integrado a lib geral". O contrato do lado do Odoo e o
prompt-nexoeletric-componente-novo.md (modulo di_lista_altium 19.0.9.0.0): a linha da peca que o Odoo
nao tem leva o bloco `componente`, com os campos x_* do produto.

ONDE MORA: Libs/almox-locais.js (var almoxLocais), NO MESMO FORMATO dos acervos do almoxarifado
(Libs/almox-basicos.js): cada componente e um simbolo com o desenho (parts) e UM valor. Assim a vista
Esquema, o "Adicionar componentes", o link do Odoo e o envio da lista o tratam como qualquer peca da
biblioteca, e o arquivo viaja com o resto da Libs/ para o NexoBD (a biblioteca da rede). O que e so
daqui fica em `criadoLocal` no simbolo e no valor:
  simbolo.criadoLocal = {id, criado, atualizado, por, simbolo:{nome, de}, datasheet, componente:{x_*},
                         conferencia:{pronto, nome_previsto, faltas, erros, avisos, ignorados, em}?,
                         integrado:{odoo, tmpl, nome, pkg, em}?}
  valor.criadoLocal = true;  valor.params traz LocalId=<id> (o schematic.js grava esse params)

A INTEGRACAO: o almoxarifado cria a peca no Odoo ("Criar os componentes prontos", depois do "Enviar
para o Odoo") e o sincronismo seguinte traz ela nos acervos com o mesmo MPN (+ encapsulamento). O
integra() acha esse produto e grava `integrado`: a tag sai, o "Adicionar componentes" passa a mostrar
so a peca do almoxarifado, e o envio da lista manda o product_id dela para todo componente que ainda
tenha o LocalId (os esquemas antigos nao precisam ser reescritos). O registro fica no arquivo, sem a
tag, so para os esquemas que o usam continuarem desenhando.

AS REGRAS SAO DO ODOO (secao 5 do prompt): familias, listas fechadas, encapsulamentos, subtipos e o
perfil de cada familia vem dele (di_perfil_da_familia, fields_get, di_selection, di.subtipo,
di.footprint), com cache de 10 min. A conferencia de uma ficha e o proprio di_confere_lista (ensaio,
nao grava nada no Odoo) com uma linha so: o recibo diz pronto/faltas/erros/nome_previsto. O daqui so
recusa o que nunca poderia ir (nome com aspas-dois-pontos, chave fora do contrato).

Rotas (registradas pelo hubserver.py, como as da JLC):
  GET  /api/locais                    -> {ok, componentes:[resumo], integrados:[resumo], arquivo}
  GET  /api/locais/<id>               -> {ok, componente:{...registro inteiro}}
  POST /api/locais                    {id?, nome?, simbolo, footprint, datasheet, componente:{x_*}, links}
                                      -> {ok, componente, avisos}
  POST /api/locais/<id>/apagar        -> {ok}
  POST /api/locais/<id>/conferir      -> {ok, conferencia}   (chama o Odoo)
  POST /api/locais/integrar           -> {ok, integrados:[...]} (o integra() a mao)
  GET  /api/locais/regras?familia=X   -> {ok, perfil?, listas, encapsulamentos, subtipos, footprints}
  GET  /api/locais/opcoes             -> {ok, simbolos:[{nome, de, pinos}], footprints:[nome]}
"""
import base64
import datetime
import io
import json
import os
import re
import threading
import time
import unicodedata

ARQ = os.path.join('Libs', 'almox-locais.js')
VAR = 'almoxLocais'
FORMATO = 'almox-locais-v1'
TITULO = 'Componentes criados localmente'
TAG = 'criado localmente'

# as chaves do bloco `componente` (secao 3 do prompt). Fora destas, a chave nao vai (o Odoo a
# devolveria em `ignorados`); name, default_code e x_hub_uid sao proibidos de proposito (3.5).
TEXTO = ('x_familia', 'x_subtipo', 'x_montagem', 'x_encapsulamento', 'x_mpn', 'x_valor_txt', 'x_polaridade',
         'x_tensao', 'x_potencia', 'x_corrente', 'x_tolerancia', 'x_coeficiente', 'x_dieletrico', 'x_carga',
         'x_dimensao', 'x_passo', 'x_genero', 'x_angulo', 'x_fabricante', 'x_pinagem', 'x_designator', 'footprint')
INTEIRO = ('x_vias', 'x_pinos')
PROIBIDAS = ('name', 'default_code', 'x_hub_uid', 'product_id')
TIPOS_PINO = {'input': 'Input', 'io': 'IO', 'output': 'Output', 'opencollector': 'OpenCollector',
              'passive': 'Passive', 'hiz': 'HiZ', 'openemitter': 'OpenEmitter', 'power': 'Power'}
IMAGEM_MAX = 2 * 1024 * 1024
CACHE_ODOO_S = 600

_lock = threading.RLock()
_cache = {}


class ErroLocal(ValueError):
    """Dado que nao pode ser gravado (a frase vai para a tela e para a IA)."""


# ───────────────────────────── o arquivo ─────────────────────────────

def _caminho(root):
    return os.path.join(root, ARQ)


def _le_var(caminho, nome=None):
    with io.open(caminho, encoding='utf-8', errors='replace') as f:
        s = f.read()
    s = re.sub(r'^\s*//[^\n]*\n', '', s, flags=re.M)
    s = s[s.find('=') + 1:].strip().rstrip(';').strip()
    return json.loads(s)


def vazio():
    return {'format': FORMATO, 'lib': 'almox-locais', 'title': TITULO, 'generated': '',
            'source': 'NexoEletric', 'units': 'mil', 'symbols': []}


def le(root):
    try:
        lib = _le_var(_caminho(root))
    except FileNotFoundError:
        return vazio()
    except (OSError, ValueError) as e:
        raise ErroLocal('%s nao e legivel (%s): arrume ou apague o arquivo' % (ARQ, e))
    if not isinstance(lib, dict) or not isinstance(lib.get('symbols'), list):
        raise ErroLocal('%s nao tem a lista de componentes' % ARQ)
    return lib


def grava(root, lib):
    lib['generated'] = agora()
    alvo = os.path.realpath(_caminho(root))
    os.makedirs(os.path.dirname(alvo), exist_ok=True)
    tmp = alvo + '.tmp'
    corpo = json.dumps(lib, ensure_ascii=False, indent=1)
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// NexoEletric: componentes criados localmente (tools/rotas/componentes_locais.py). '
                'Mesmo formato dos acervos do almoxarifado.\nvar %s = %s;\n' % (VAR, corpo))
    for i in range(20):
        try:
            os.replace(tmp, alvo)
            return
        except PermissionError:
            if i == 19:
                raise
            time.sleep(0.05)


def agora():
    return datetime.datetime.now().strftime('%Y-%m-%d %H:%M')


def _sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')


def norm_mpn(s):
    return re.sub(r'[\s\-_/.]+', '', _sem_acento(s)).upper()


def norm_pkg(s):
    return re.sub(r'[\s\-_]+', '', _sem_acento(s)).upper()


def _limpa_txt(v):
    s = re.sub(r'[\x00-\x1f]+', ' ', str(v if v is not None else '')).strip()
    return s


# ───────────────────────────── os outros acervos (desenho, nomes, integracao) ─────────────────────────────

def _cache_arquivo(caminho, nome):
    """O conteudo de um Libs/*.js, guardado pelo mtime (pcblib.js tem 3 MB)."""
    try:
        st = os.stat(caminho)
    except OSError:
        return None
    k = ('arq', caminho)
    c = _cache.get(k)
    if c and c[0] == (st.st_mtime, st.st_size):
        return c[1]
    try:
        v = _le_var(caminho)
    except (OSError, ValueError):
        v = None
    _cache[k] = ((st.st_mtime, st.st_size), v)
    return v


ARQS_LIBS = {'altium': 'schlib.js', 'biblioteca': 'symbols-lib.js', 'basicos': 'almox-basicos.js',
             'especiais': 'almox-especiais.js', 'pcblib': 'pcblib.js', 'pcblibHub': 'pcblib-hub.js'}


class _Libs(dict):
    """As libs da pasta Libs/, lidas so quando pedidas (o pcblib.js tem 3 MB: a integracao nao precisa dele)."""

    def __init__(self, root):
        dict.__init__(self)
        self.root = root

    def get(self, k, padrao=None):
        if k not in self:
            n = ARQS_LIBS.get(k)
            self[k] = _cache_arquivo(os.path.join(self.root, 'Libs', n), None) if n else None
        return dict.get(self, k) if dict.get(self, k) is not None else padrao


def _libs(root):
    return _Libs(root)


def _partes_do_simbolo(s):
    if isinstance(s.get('parts'), list) and s['parts']:
        return s['parts']
    if isinstance(s.get('pins'), list):
        return [{'part': 1, 'pins': s.get('pins') or [], 'graphics': s.get('graphics') or []}]
    return []


def desenho(root, nome):
    """O desenho (parts) de um simbolo pelo nome: a biblioteca de simbolos do hub, a SchLib da casa,
    uma familia do almoxarifado ou outro componente local. -> (parts, de) ou (None, None)."""
    nome = _limpa_txt(nome)
    if not nome:
        return None, None
    libs = _libs(root)
    for de, chave in (('biblioteca', 'biblioteca'), ('altium', 'altium'), ('almoxarifado', 'basicos'),
                      ('almoxarifado', 'especiais')):
        for s in ((libs.get(chave) or {}).get('symbols') or []):
            if s.get('name') == nome or nome in (s.get('aliases') or []):
                p = _partes_do_simbolo(s)
                if p:
                    return p, de
    for s in le(root).get('symbols') or []:
        if s.get('name') == nome and s.get('parts'):
            return s['parts'], 'local'
    return None, None


def opcoes(root):
    """Os simbolos e footprints que um componente local pode usar (para a tela e para a IA)."""
    libs = _libs(root)
    sims, vistos = [], set()
    for de, chave in (('biblioteca', 'biblioteca'), ('altium', 'altium'), ('almoxarifado', 'basicos'),
                      ('almoxarifado', 'especiais')):
        for s in ((libs.get(chave) or {}).get('symbols') or []):
            n = s.get('name')
            if not n or n in vistos:
                continue
            vistos.add(n)
            partes = _partes_do_simbolo(s)
            sims.append({'nome': n, 'de': de, 'pinos': sum(len(p.get('pins') or []) for p in partes),
                         'partes': len(partes)})
    fps, vf = [], set()
    for chave in ('pcblibHub', 'pcblib'):
        for f in ((libs.get(chave) or {}).get('footprints') or []):
            n = f.get('name')
            if n and n not in vf:
                vf.add(n)
                fps.append(n)
    return {'simbolos': sims, 'footprints': sorted(fps, key=lambda x: x.lower())}


def _footprint_existe(root, nome):
    return nome in set(opcoes(root)['footprints'])


def _designator_da_familia(root, familia):
    libs = _libs(root)
    f = _sem_acento(familia).upper()
    for chave in ('basicos', 'especiais'):
        for s in ((libs.get(chave) or {}).get('symbols') or []):
            if _sem_acento(s.get('familia')).upper() == f and s.get('designator'):
                return str(s['designator']).rstrip('?')
    return 'U'


def _nomes_tomados(root, menos_id=None):
    libs = _libs(root)
    tomados = set()
    for chave in ('altium', 'biblioteca', 'basicos', 'especiais'):
        for s in ((libs.get(chave) or {}).get('symbols') or []):
            tomados.add(s.get('name'))
            for v in s.get('valores') or []:
                tomados.add(v.get('altium'))
    for s in le(root).get('symbols') or []:
        if (s.get('criadoLocal') or {}).get('id') != menos_id:
            tomados.add(s.get('name'))
    tomados.discard(None)
    return tomados


def itens_do_almoxarifado(root):
    """Todo produto dos acervos do Odoo: [{odoo, tmpl, nome, pkg, mpn}]."""
    libs = _libs(root)
    out = []
    for chave in ('basicos', 'especiais'):
        for s in ((libs.get(chave) or {}).get('symbols') or []):
            for v in s.get('valores') or []:
                for it in v.get('itens') or []:
                    if it.get('odoo'):
                        out.append({'odoo': str(it['odoo']), 'tmpl': str(it.get('tmpl') or ''), 'nome': it.get('nome') or v.get('label') or '',
                                    'pkg': it.get('pkg') or '', 'mpn': it.get('mpn') or v.get('mpn') or '',
                                    'altium': v.get('altium') or ''})
    return out


# ───────────────────────────── a ficha (bloco componente) ─────────────────────────────

def pinagem_do_desenho(partes):
    """1:VDD:Power;2:RA0:IO;... a partir dos pinos do simbolo (tipo fora da lista do Odoo vira Passive)."""
    vistos, out = set(), []
    for p in partes or []:
        for pin in p.get('pins') or []:
            num = _limpa_txt(pin.get('num'))
            if not num or num in vistos:
                continue
            vistos.add(num)
            nome = re.sub(r'[;:\\]', '', _limpa_txt(pin.get('name'))) or num
            tipo = TIPOS_PINO.get(re.sub(r'[^a-z]', '', str(pin.get('type') or '').lower()), 'Passive')
            out.append('%s:%s:%s' % (num, nome, tipo))
    try:
        out.sort(key=lambda s: (0, int(s.split(':')[0])) if s.split(':')[0].isdigit() else (1, s))
    except ValueError:
        pass
    return ';'.join(out)


def bloco(dados):
    """O bloco `componente` limpo (so as chaves do contrato, sem vazio) + os avisos do que saiu."""
    dados = dados or {}
    if not isinstance(dados, dict):
        raise ErroLocal('componente tem que ser um objeto com os campos x_* do Odoo')
    out, avisos = {}, []
    for k, v in dados.items():
        if k in PROIBIDAS:
            avisos.append('%s nao vai no bloco (o Odoo calcula; ver a secao 3.5 do contrato)' % k)
            continue
        if k in INTEIRO:
            if v in (None, ''):
                continue
            try:
                n = int(str(v).strip())
            except ValueError:
                raise ErroLocal('%s tem que ser um numero inteiro (veio %r)' % (k, v))
            out[k] = n
        elif k in TEXTO:
            s = _limpa_txt(v)
            if s:
                if '":' in s or '|' in s:
                    raise ErroLocal('%s nao pode ter aspas seguidas de dois-pontos nem "|" (quebram a biblioteca)' % k)
                out[k] = s[:300]
        elif k == 'links':
            ls = []
            for l in v or []:
                if not isinstance(l, dict):
                    continue
                n, u = _limpa_txt(l.get('name')), _limpa_txt(l.get('url'))
                if n and re.match(r'^https?://', u, re.I):
                    ls.append({'name': n[:60], 'url': u[:500]})
            if ls:
                out['links'] = ls
        elif k == 'imagem':
            s = re.sub(r'\s+', '', str(v or ''))
            if s:
                try:
                    if len(base64.b64decode(s, validate=True)) > IMAGEM_MAX:
                        raise ErroLocal('imagem maior que 2 MB')
                except (ValueError, TypeError):
                    raise ErroLocal('imagem tem que ser base64')
                out['imagem'] = s
        else:
            avisos.append('a chave %s nao faz parte do bloco componente e ficou de fora' % k)
    if 'x_montagem' in out:
        out['x_montagem'] = out['x_montagem'].lower()
        if out['x_montagem'] not in ('smd', 'pth'):
            raise ErroLocal("x_montagem e 'smd' ou 'pth'")
    if 'x_familia' in out:
        out['x_familia'] = out['x_familia'].upper()
    return out, avisos


def nome_local(b):
    """O nome enquanto o Odoo nao disse o dele (o nome_previsto da conferencia ganha quando existe)."""
    fam = (b.get('x_familia') or 'Componente').capitalize()
    partes = [fam, b.get('x_subtipo') or '']
    if b.get('x_vias'):
        partes.append('%s vias' % b['x_vias'])
    partes += [b.get('x_polaridade', '').upper() if b.get('x_polaridade') else '', b.get('x_valor_txt') or '']
    for k in ('x_tensao', 'x_potencia', 'x_corrente', 'x_tolerancia', 'x_dieletrico', 'x_passo'):
        partes.append(b.get(k) or '')
    if b.get('x_mpn'):
        partes.append('[%s]' % b['x_mpn'])
    partes += [b.get('x_encapsulamento') or '', (b.get('x_montagem') or '').upper()]
    return re.sub(r'\s+', ' ', ' '.join(p for p in partes if p)).strip()


def _proximo_id(lib):
    n = 0
    for s in lib.get('symbols') or []:
        m = re.match(r'^L(\d+)$', str((s.get('criadoLocal') or {}).get('id') or ''))
        if m:
            n = max(n, int(m.group(1)))
    return 'L%d' % (n + 1)


def _acha(lib, id_):
    for i, s in enumerate(lib.get('symbols') or []):
        if (s.get('criadoLocal') or {}).get('id') == id_:
            return i, s
    return -1, None


def _params(meta, b, rotulo):
    valor = b.get('x_valor_txt') or ('%s vias' % b['x_vias'] if b.get('x_vias') else '')
    mouser = next((l['url'] for l in b.get('links') or [] if 'mouser' in l['name'].lower()), '')
    ps = [('Comment', rotulo), ('Value', valor), ('Encapsulamento', b.get('x_encapsulamento') or ''),
          ('MPN', b.get('x_mpn') or ''), ('Mouser', mouser), ('Fabricante', b.get('x_fabricante') or ''),
          ('LocalId', meta['id'])]
    integ = meta.get('integrado')
    if integ:
        ps.append(('OdooId', integ['odoo']))
    return [{'n': n, 'v': re.sub(r'[;=|]', ',', str(v))} for n, v in ps]


def monta_simbolo(root, meta, nome, partes, footprint):
    """O simbolo no formato do almoxarifado (um valor so) a partir do registro."""
    b = meta.get('componente') or {}
    rotulo = nome
    integ = meta.get('integrado')
    valor = {
        'id': 1, 'altium': nome, 'label': rotulo,
        'value': b.get('x_valor_txt') or ('%s vias' % b['x_vias'] if b.get('x_vias') else ''),
        'estoque': 0, 'pkgs': [b['x_encapsulamento']] if b.get('x_encapsulamento') else [],
        'footprint': footprint or '', 'mpn': b.get('x_mpn') or '', 'mouser': '', 'local': '',
        'itens': [{'odoo': integ['odoo'], 'tmpl': integ.get('tmpl') or '', 'nome': integ.get('nome') or rotulo,
                   'pkg': integ.get('pkg') or '', 'mpn': b.get('x_mpn') or ''}] if integ else [],
        'params': _params(meta, b, rotulo), 'desde': meta.get('criado') or agora(),
        'criadoLocal': not integ,
    }
    mont = (b.get('x_montagem') or '').upper()
    return {
        'name': nome,
        'description': ('%s — %s' % (TAG, nome)) if not integ else '%s (integrado ao almoxarifado)' % nome,
        'designator': b.get('x_designator') or _designator_da_familia(root, b.get('x_familia')),
        'familia': b.get('x_familia') or '', 'montagem': mont, 'grupo': 'locais',
        'partcount': max(1, len(partes or [])), 'estoque': 0, 'itens': 1 if integ else 0,
        'categorias': [TAG] if not integ else ['integrado ao almoxarifado'],
        'footprints': [{'name': footprint, 'current': True, 'incurrentlib': True}] if footprint else [],
        'params': [{'n': 'Familia', 'v': b.get('x_familia') or ''}, {'n': 'Montagem', 'v': mont},
                   {'n': 'Fonte', 'v': 'NexoEletric · ' + TAG}],
        'parts': partes or [],
        'desde': meta.get('criado') or agora(),
        'criadoLocal': meta,
        'valores': [valor],
    }


def salva(root, dados, por=''):
    """Cria (sem id) ou edita (com id) um componente local. -> (registro, avisos)."""
    if not isinstance(dados, dict):
        raise ErroLocal('mande um objeto com componente, simbolo e footprint')
    with _lock:
        lib = le(root)
        id_ = _limpa_txt(dados.get('id'))
        i, atual = _acha(lib, id_) if id_ else (-1, None)
        if id_ and atual is None:
            raise ErroLocal('componente local %s nao existe' % id_)
        meta = dict((atual or {}).get('criadoLocal') or {})
        if meta.get('integrado'):
            raise ErroLocal('%s ja foi integrado ao almoxarifado (produto %s do Odoo): edite la' % (id_, meta['integrado']['odoo']))
        b_antes = meta.get('componente') or {}
        b_novo, avisos = bloco(dados.get('componente') if 'componente' in dados else b_antes)
        if 'componente' in dados and dados.get('mesclar'):
            b_novo = dict(b_antes, **b_novo)
        # o desenho: o pedido, senao o que ja estava
        nome_sim = _limpa_txt(dados.get('simbolo')) if 'simbolo' in dados else (meta.get('simbolo') or {}).get('nome', '')
        partes, de = (None, None)
        if nome_sim:
            partes, de = desenho(root, nome_sim)
            if partes is None:
                raise ErroLocal('o simbolo "%s" nao existe na biblioteca de simbolos, na SchLib nem no almoxarifado '
                                '(crie com sym_gerar/sym_salvar destino "biblioteca" e tente de novo)' % nome_sim)
        elif atual:
            partes = atual.get('parts') or []
        footprint = _limpa_txt(dados.get('footprint')) if 'footprint' in dados else (atual or {}).get('footprints', [{}])[0].get('name', '') if (atual or {}).get('footprints') else ''
        if footprint and not _footprint_existe(root, footprint):
            raise ErroLocal('o footprint "%s" nao existe na PcbLib da casa nem na biblioteca do hub (fp_buscar; '
                            'crie com fp_pacote/fp_salvar)' % footprint)
        if footprint:
            b_novo['footprint'] = footprint
        if partes and not b_novo.get('x_pinagem'):
            pin = pinagem_do_desenho(partes)
            if pin:
                b_novo['x_pinagem'] = pin
        if not b_novo.get('x_designator'):
            b_novo.pop('x_designator', None)
        if not b_novo.get('x_mpn'):
            avisos.append('sem x_mpn: o Odoo nao cria peca nova sem o codigo do fabricante')
        # o nome: o pedido; senao o que ja tinha (ele e o `sym` gravado nos esquemas: trocar sozinho
        # quebraria o componente ja colocado); senao, na criacao, o daqui (o nome_previsto do Odoo
        # aparece na conferencia, e quem quiser ele grava com "nome")
        nome = _limpa_txt(dados.get('nome')) or (atual or {}).get('name') or nome_local(b_novo)
        if '":' in nome or '|' in nome:
            raise ErroLocal('o nome nao pode ter aspas seguidas de dois-pontos nem "|"')
        nome = nome[:200]
        if nome in _nomes_tomados(root, menos_id=id_ or None):
            nome = (nome + ' · local')[:200]
            if nome in _nomes_tomados(root, menos_id=id_ or None):
                raise ErroLocal('ja existe um componente chamado "%s": escolha outro nome' % nome)
        agora_ = agora()
        meta.update({'id': id_ or _proximo_id(lib), 'criado': meta.get('criado') or agora_, 'atualizado': agora_,
                     'por': meta.get('por') or _limpa_txt(por), 'componente': b_novo,
                     'simbolo': {'nome': nome_sim, 'de': de} if nome_sim else (meta.get('simbolo') or None),
                     'datasheet': _limpa_txt(dados['datasheet'])[:500] if 'datasheet' in dados else meta.get('datasheet', '')})
        if b_novo != b_antes:
            meta.pop('conferencia', None)       # a ficha mudou: a conferencia de antes nao vale
        sim = monta_simbolo(root, meta, nome, partes or [], footprint)
        if atual is None:
            lib['symbols'].append(sim)
        else:
            lib['symbols'][i] = sim
        grava(root, lib)
        return sim, avisos


def apaga(root, id_):
    with _lock:
        lib = le(root)
        i, s = _acha(lib, id_)
        if s is None:
            raise ErroLocal('componente local %s nao existe' % id_)
        del lib['symbols'][i]
        grava(root, lib)
        return s


def integra(root):
    """Os locais que o almoxarifado ja criou (o MPN + encapsulamento chegou nos acervos do Odoo) perdem
    a tag e passam a apontar para o produto. -> [{id, odoo, nome}] dos integrados agora."""
    with _lock:
        lib = le(root)
        pendentes = [s for s in lib.get('symbols') or [] if not (s.get('criadoLocal') or {}).get('integrado')]
        if not pendentes:
            return []
        por_mpn = {}
        for it in itens_do_almoxarifado(root):
            if it['mpn']:
                por_mpn.setdefault(norm_mpn(it['mpn']), []).append(it)
        feitos = []
        for s in pendentes:
            meta = s.get('criadoLocal') or {}
            b = meta.get('componente') or {}
            cands = por_mpn.get(norm_mpn(b.get('x_mpn'))) if b.get('x_mpn') else None
            if not cands:
                continue
            enc = norm_pkg(b.get('x_encapsulamento'))
            casam = [c for c in cands if enc and enc != 'NA' and norm_pkg(c['pkg']) == enc]
            if not casam and len(cands) == 1 and (not enc or enc == 'NA' or not cands[0]['pkg']
                                                  or b.get('x_familia') == 'CONECTOR'):
                casam = cands
            if len({c['odoo'] for c in casam}) != 1:
                continue
            c = casam[0]
            meta['integrado'] = {'odoo': c['odoo'], 'tmpl': c['tmpl'], 'nome': c['nome'], 'pkg': c['pkg'],
                                 'altium': c['altium'], 'em': agora()}
            i, _ = _acha(lib, meta['id'])
            lib['symbols'][i] = monta_simbolo(root, meta, s['name'], s.get('parts') or [],
                                              (s.get('footprints') or [{}])[0].get('name', '') if s.get('footprints') else '')
            feitos.append({'id': meta['id'], 'odoo': c['odoo'], 'nome': c['nome']})
        if feitos:
            grava(root, lib)
        return feitos


def resumo(s):
    meta = s.get('criadoLocal') or {}
    b = meta.get('componente') or {}
    v = (s.get('valores') or [{}])[0]
    conf = meta.get('conferencia') or None
    sim = meta.get('simbolo') or {}
    fp = (s.get('footprints') or [{}])[0].get('name', '') if s.get('footprints') else ''
    falta_local = []
    if not sim.get('nome'):
        falta_local.append('sem simbolo')
    if not fp:
        falta_local.append('sem footprint')
    if not b.get('x_mpn'):
        falta_local.append('sem MPN')
    return {
        'id': meta.get('id'), 'nome': s.get('name'), 'tag': None if meta.get('integrado') else TAG,
        'familia': b.get('x_familia') or '', 'mpn': b.get('x_mpn') or '', 'encapsulamento': b.get('x_encapsulamento') or '',
        'montagem': b.get('x_montagem') or '', 'valor': v.get('value') or '', 'simbolo': sim.get('nome') or '',
        'simboloDe': sim.get('de') or '', 'footprint': fp, 'designator': s.get('designator'),
        'datasheet': meta.get('datasheet') or '', 'criado': meta.get('criado'), 'atualizado': meta.get('atualizado'),
        'por': meta.get('por') or '', 'conferencia': conf, 'integrado': meta.get('integrado') or None,
        'situacao': ('integrado' if meta.get('integrado') else 'incompleto' if falta_local
                     else 'pronto' if conf and conf.get('pronto') else 'com faltas' if conf else 'nao conferido'),
        'faltaLocal': falta_local,
        # o "comp" pronto para o sch_adicionar do MCP (o mesmo que o "Adicionar componentes" grava)
        'comp': {'t': 'comp', 'sym': s.get('name'), 'comment': v.get('label') or s.get('name'), 'footprint': fp,
                 'params': ';'.join('%s=%s' % (p['n'], p['v']) for p in v.get('params') or [] if p.get('v')),
                 'ref': (s.get('designator') or 'U') + '?'},
    }


def lista(root):
    try:
        integra(root)
    except Exception:            # noqa: BLE001  -- integrar e bonus: a lista sai mesmo se falhar
        pass
    lib = le(root)
    tudo = [resumo(s) for s in lib.get('symbols') or []]
    return [r for r in tudo if not r['integrado']], [r for r in tudo if r['integrado']]


def por_id(root):
    """{LocalId: registro} para o envio da lista (odoolista.resolve)."""
    try:
        lib = le(root)
    except ErroLocal:
        return {}
    return {(s.get('criadoLocal') or {}).get('id'): s for s in lib.get('symbols') or [] if s.get('criadoLocal')}


def bloco_do_envio(s):
    """O bloco `componente` da linha (secao 2 do contrato): o da ficha, com o footprint e os links."""
    meta = s.get('criadoLocal') or {}
    b = dict(meta.get('componente') or {})
    fp = (s.get('footprints') or [{}])[0].get('name', '') if s.get('footprints') else ''
    if fp:
        b['footprint'] = fp
    if meta.get('datasheet') and not any((l.get('name') or '').lower() == 'datasheet' for l in b.get('links') or []):
        if re.match(r'^https?://', meta['datasheet'], re.I):
            b['links'] = list(b.get('links') or []) + [{'name': 'Datasheet', 'url': meta['datasheet']}]
    return b


# ───────────────────────────── o Odoo (regras e conferencia) ─────────────────────────────

def _cliente(root):
    import odoolista as OL
    cli = OL.ClienteLista(raiz=root)
    return OL, cli


def _executa(cli, modelo, metodo, args, kw=None):
    import xmlrpc.client
    import odoolista as OL
    try:
        return cli.models.execute_kw(cli.db, cli.uid, cli.senha, modelo, metodo, list(args), kw or {})
    except xmlrpc.client.Fault as f:
        msg = (f.faultString or '').strip().splitlines()
        raise OL.ErroOdoo(msg[-1] if msg else 'o Odoo recusou a chamada')
    except (xmlrpc.client.Error, OSError) as e:
        raise OL.ErroOdoo('o Odoo nao respondeu: %s' % e)


def regras(root, familia=''):
    """As regras de hoje, perguntadas ao Odoo (secao 5 do contrato). Cache de 10 min."""
    k = ('regras', root)
    c = _cache.get(k)
    if not c or time.time() - c[0] > CACHE_ODOO_S:
        OL, cli = _cliente(root)
        campos = _executa(cli, 'product.template', 'fields_get',
                          [['x_familia', 'x_montagem', 'x_polaridade', 'x_dieletrico', 'x_genero', 'x_angulo']],
                          {'attributes': ['selection', 'string']})
        listas = {n: (d or {}).get('selection') or [] for n, d in (campos or {}).items()}
        enc = {}
        for mont in ('smd', 'pth'):
            try:
                enc[mont] = _executa(cli, 'di.encapsulamento', 'di_selection', [mont])
            except OL.ErroOdoo:
                enc[mont] = []
        try:
            subt = _executa(cli, 'di.subtipo', 'search_read',
                            [['|', ('familia', '=', False), ('familia', '=', 'CONECTOR')]], {'fields': ['name', 'familia']})
        except OL.ErroOdoo:
            subt = []
        try:
            fps = [f.get('name') for f in _executa(cli, 'di.footprint', 'search_read', [[]], {'fields': ['name']}) if f.get('name')]
        except OL.ErroOdoo:
            fps = []
        c = (time.time(), {'listas': listas, 'encapsulamentos': enc,
                           'subtipos': [{'nome': s.get('name'), 'familia': s.get('familia') or ''} for s in subt or []],
                           'footprints': fps, 'url': cli.url})
        _cache[k] = c
        _cache[('cli', root)] = cli
    out = dict(c[1])
    fam = _limpa_txt(familia).upper()
    if fam:
        kp = ('perfil', root, fam)
        p = _cache.get(kp)
        if not p or time.time() - p[0] > CACHE_ODOO_S:
            OL, cli = _cliente(root)
            p = (time.time(), _executa(cli, 'product.template', 'di_perfil_da_familia', [fam]))
            _cache[kp] = p
        out['perfil'] = p[1]
        out['familia'] = fam
    return out


def confere(root, id_):
    """Manda a ficha ao di_confere_lista (ensaio: o Odoo nao grava nada) numa linha so e guarda o recibo."""
    with _lock:
        lib = le(root)
        i, s = _acha(lib, id_)
        if s is None:
            raise ErroLocal('componente local %s nao existe' % id_)
    meta = s.get('criadoLocal') or {}
    if meta.get('integrado'):
        raise ErroLocal('%s ja esta integrado ao almoxarifado' % id_)
    OL, cli = _cliente(root)
    linha = {'designadores': (s.get('designator') or 'U') + '1', 'quantidade': 1,
             'nome_altium': s.get('name'), 'componente': bloco_do_envio(s)}
    fp = linha['componente'].get('footprint')
    if fp:
        linha['footprint'] = fp
    payload = OL.payload_limpo({'uid_externo': 'nexo:componente-local:%s' % id_, 'projeto': 'Conferencia de componente local',
                                'revisao': 'A', 'origem': 'NexoEletric', 'enviado_por': meta.get('por') or '',
                                'observacao': 'ensaio do componente criado localmente %s' % id_, 'linhas': [linha]})
    rec = cli.confere(payload) or {}
    pend = [p for p in (rec.get('pendencias') or []) if isinstance(p, dict)]
    if not pend:
        # sem pendencia: o Odoo resolveu a linha sozinho pelo x_mpn + x_encapsulamento (secao 2)
        conf = {'pronto': False, 'jaExiste': True, 'nome_previsto': '', 'faltas': [],
                'erros': ['o Odoo ja tem esta peca (o MPN + encapsulamento casam com um produto do cadastro): '
                          'use a peca do almoxarifado em vez de criar outra'],
                'avisos': [], 'ignorados': [], 'motivo': ''}
    else:
        comp = pend[0].get('componente') or {}
        conf = {'pronto': bool(comp.get('pronto')), 'nome_previsto': comp.get('nome_previsto') or '',
                'faltas': comp.get('faltas') or [], 'erros': comp.get('erros') or [],
                'avisos': comp.get('avisos') or [], 'ignorados': comp.get('ignorados') or [],
                'motivo': pend[0].get('motivo') or ''}
        if not comp:
            conf['erros'] = ['o Odoo nao devolveu a conferencia da ficha (o modulo di_lista_altium e o 19.0.9.0.0 ou mais novo?)']
    conf['em'] = agora()
    with _lock:
        lib = le(root)
        i, s = _acha(lib, id_)
        if s is not None:
            s['criadoLocal']['conferencia'] = conf
            lib['symbols'][i] = s
            grava(root, lib)
    return conf


# ───────────────────────────── as rotas ─────────────────────────────

def registra(app, root):
    from flask import request

    def erro(e, status=400):
        return {'ok': False, 'error': str(e)}, status

    def com_erros(fn):
        def f(*a, **kw):
            import odoolista as OL
            try:
                return fn(*a, **kw)
            except ErroLocal as e:
                return erro(e, 400)
            except OL.ErroOdoo as e:
                return erro(e, 502)
        f.__name__ = fn.__name__
        return f

    @app.route('/api/locais', methods=['GET'])
    @com_erros
    def locais_lista():
        ativos, integrados = lista(root)
        return {'ok': True, 'componentes': ativos, 'integrados': integrados, 'arquivo': ARQ.replace(os.sep, '/'), 'tag': TAG}

    @app.route('/api/locais/<id_>', methods=['GET'])
    @com_erros
    def locais_um(id_):
        _, s = _acha(le(root), id_)
        if s is None:
            return erro('componente local %s nao existe' % id_, 404)
        return {'ok': True, 'componente': s, 'resumo': resumo(s)}

    @app.route('/api/locais', methods=['POST'])
    @com_erros
    def locais_salva():
        data = request.get_json(silent=True) or {}
        s, avisos = salva(root, data, por=data.get('por') or '')
        return {'ok': True, 'componente': resumo(s), 'avisos': avisos}

    @app.route('/api/locais/<id_>/apagar', methods=['POST'])
    @com_erros
    def locais_apaga(id_):
        apaga(root, id_)
        return {'ok': True}

    @app.route('/api/locais/<id_>/conferir', methods=['POST'])
    @com_erros
    def locais_confere(id_):
        conf = confere(root, id_)
        _, s = _acha(le(root), id_)
        return {'ok': True, 'conferencia': conf, 'componente': resumo(s) if s else None}

    @app.route('/api/locais/integrar', methods=['POST'])
    @com_erros
    def locais_integra():
        return {'ok': True, 'integrados': integra(root)}

    @app.route('/api/locais/regras', methods=['GET'])
    @com_erros
    def locais_regras():
        return dict({'ok': True}, **regras(root, request.args.get('familia') or ''))

    @app.route('/api/locais/opcoes', methods=['GET'])
    @com_erros
    def locais_opcoes():
        return dict({'ok': True}, **opcoes(root))
