# -*- coding: utf-8 -*-
"""Abre o esquema do Altium (.SchDoc / .PrjPcb) no hub, sem o Altium: grava o schematic.js
(schmirror-v2) que o ExportProject.pas grava, lido direto do arquivo.

    python tools/schdoc/schdoc2sch.py <projeto.PrjPcb | folha.SchDoc ...> <saida/schematic.js> [opcoes]

O mesmo item, campo a campo, do ExportProject.pas (ExportSheet), que e a referencia: o teste de
ouro (tests/test_schdoc2sch.py) compara a saida com os schematic.js que o Altium gravou nos
projetos de Projects/. O que foi medido nos arquivos reais (registros de texto |CHAVE=valor|,
lidos pelo tools/symbols/sch_leitor.py):

  registro  1 componente   LibReference, CurrentPartId, Location, Orientation (0..3), IsMirrored
           34 designador   filho do componente; Text e a Location ABSOLUTA do texto
           41 parametro    filho do componente (Name/Text); Name=Comment e o comment
           44 lista de implementacoes (filho do componente); 45 = cada modelo, filho do 44:
              ModelType=PCBLIB, ModelName, IsCurrent -- o footprint
           27 fio          LocationCount, X1/Y1...Xn/Yn
           25 rotulo de net  Text, Orientation       17 power  Text, Style, Orientation
           18 port         Name, IOType, Style, Width, AreaColor/TextColor/Color
           29 juncao       22 No ERC        4 texto (Label)
           39 template     os textos (4) filhos dele sao o carimbo: ficam fora, como no
                           ExportProject (StampByTemplateObject)
           31 a folha      UseCustomSheet + CustomX/CustomY, ou SheetStyle
  OwnerIndex  conta a partir do registro seguinte ao cabecalho (o indice na lista MENOS 1)
  chave ausente = zero/falso (o Altium nao grava o valor padrao)

A mais do ExportProject, e opcional (--sem-simbolos tira): `symbols`, o desenho de cada simbolo
COMO ESTA NA FOLHA (o .SchDoc guarda a copia do simbolo dentro de cada componente). A vista
Esquema usa o da biblioteca quando existe e este quando a biblioteca nao tem o nome -- o
componente aparece desenhado em vez do quadrado vermelho.

Travas: o .SchDoc so e LIDO; nunca grava em disco de rede nem no acervo; nao sobrescreve um
schematic.js sem --forcar (e entao guarda o anterior em schematic.js.bak-<data>).
Saida 0 = gravou; 1 = nao leu; 2 = recusou gravar.
"""
import json
import os
import re
import shutil
import sys
from collections import OrderedDict
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
for p in (os.path.join(RAIZ, 'tools', 'symbols'), os.path.join(RAIZ, 'tools', 'almox'), os.path.join(RAIZ, 'tools', 'schtemplate')):
    if p not in sys.path:
        sys.path.insert(0, p)

import sch_leitor as S  # noqa: E402

ORIENT = (0, 90, 180, 270)
# ExportProject.pas » PowerStyleName (as constantes ePower* do DelphiScript, na ordem do enum)
POWER = {0: 'Circle', 1: 'Arrow', 2: 'Bar', 3: 'Wave', 4: 'GndPower', 5: 'GndSignal', 6: 'GndEarth'}
# SheetStyle -> (nome, w, h) em mil: hub-schtemplate.js » ESTILOS (medido na Altium.Sch.Base.dll)
ESTILOS = [('A4', 11500, 7600), ('A3', 15500, 11100), ('A2', 22300, 15700), ('A1', 31500, 22300),
           ('A0', 44600, 31500), ('A', 9500, 7500), ('B', 15000, 9500), ('C', 20000, 15000),
           ('D', 32000, 20000), ('E', 42000, 32000), ('Letter', 11000, 8500), ('Legal', 14000, 8500),
           ('Tabloid', 17000, 11000), ('OrCAD A', 9900, 7900), ('OrCAD B', 15400, 9900),
           ('OrCAD C', 20600, 15600), ('OrCAD D', 32600, 20600), ('OrCAD E', 42800, 32800)]
PARAMS_IDENTIDADE = ('ODOOID', 'VALORID', 'MPN', 'ENCAPSULAMENTO', 'VALUE', 'MOUSER')


class SchDocErro(Exception):
    pass


# ─── formatacao: o JF/JS do ExportProject ────────────────────────────────────
def jf(v):
    """FloatToStr: o numero mais curto, sem ".0" no inteiro"""
    v = round(float(v), 6)
    if v == int(v):
        return str(int(v))
    s = ('%.6f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def js(s):
    """JS() do ExportProject: \\uXXXX para controle e para tudo acima de 125"""
    out = ['"']
    for ch in s or '':
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == '\\':
            out.append('\\\\')
        elif ch in '\b\t\n\f\r':
            out.append({'\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r'}[ch])
        elif o < 32 or o > 125:
            if o > 0xFFFF:
                o -= 0x10000
                out.append('\\u%04X\\u%04X' % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
            else:
                out.append('\\u%04X' % o)
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


def jv(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return jf(v)
    if isinstance(v, str):
        return js(v)
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(jv(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(js(k) + ':' + jv(x) for k, x in v.items()) + '}'
    if v is None:
        return 'null'
    raise TypeError(type(v))


def hex_cor(c):
    """HexDeCor: TColor (BGR) -> '#RRGGBB' em maiuscula"""
    c = int(c) & 0xFFFFFF
    return '#%02X%02X%02X' % (c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF)


def _i(d, k, padrao=0):
    return S._int(d.get(k), padrao)


def _xy(d, k='Location'):
    return S.coord(d, k + '.X'), S.coord(d, k + '.Y')


def param_safe(v):
    return v.replace(';', ',').replace('=', ',').replace('|', ',').replace('"', "'")


# ─── folha ────────────────────────────────────────────────────────────────────
def _casa(w, h, nw, nh):
    return abs(w - nw) <= 5.0 and abs(h - nh) <= 5.0


def nome_do_tamanho(w, h):
    """SheetNameFromMils do ExportProject"""
    if w <= 0 or h <= 0:
        return ''
    a, b = max(w, h), min(w, h)
    for nome, nw, nh in (('A4', 11692.913, 8267.717), ('A3', 16535.433, 11692.913), ('A2', 23385.827, 16535.433),
                         ('A1', 33110.236, 23385.827), ('A0', 46811.024, 33110.236), ('A4', 11500, 7600),
                         ('A3', 15500, 11000), ('A2', 22000, 15500), ('A1', 31000, 22000), ('A0', 44000, 31000),
                         ('A', 9500, 7500), ('B', 15000, 9500), ('C', 20000, 15000), ('D', 32000, 20000),
                         ('E', 42000, 32000)):
        if _casa(a, b, nw, nh):
            return nome
    return ''


def tamanho_folha(f):
    """(w, h) em mil do registro 31"""
    if f.get('UseCustomSheet') == 'T':
        return S.coord(f, 'CustomX'), S.coord(f, 'CustomY')
    st = _i(f, 'SheetStyle')
    if 0 <= st < len(ESTILOS):
        return float(ESTILOS[st][1]), float(ESTILOS[st][2])
    return 0.0, 0.0


# ─── template e parametros (o carimbo) ────────────────────────────────────────
def ids_de_template(raiz=RAIZ):
    """os ids que o hub conhece (Libs/sch-templates.js e Libs/sch-templates-casa.js)"""
    ids = set()
    for arq in ('sch-templates.js', 'sch-templates-casa.js'):
        try:
            with open(os.path.join(raiz, 'Libs', arq), encoding='utf-8', errors='replace') as f:
                ids.update(re.findall(r'^"((?:casa|altium|altium-legado):[^"]+)":', f.read(), re.M))
        except OSError:
            pass
    return ids


def template_da_folha(regs, folha, ids):
    """o .SchDot que a folha usa (RECORD=39 FileName, ou TemplateFileName do 31) -> o id do hub
    (casa:, altium:, altium-legado:, nessa ordem), ou ('', nome) se o hub nao o conhece"""
    arq = next((d.get('FileName', '') for d in regs if d is not None and d.get('RECORD') == '39'), '') or folha.get('TemplateFileName', '')
    if not arq:
        return '', ''
    nome = os.path.splitext(re.split(r'[\\/]', arq)[-1])[0]
    for pre in ('casa:', 'altium:', 'altium-legado:'):
        if pre + nome in ids:
            return pre + nome, nome
    return '', nome


def params_texto(pares):
    return ';'.join(param_safe(k) + '=' + param_safe(v) for k, v in pares.items() if k and v)


def params_do_documento(regs):
    """os parametros do DOCUMENTO (Document Options » Parameters): RECORD=41 sem dono; os 25 que o
    Altium semeia com Text=* e os que so apontam para outro (=X) ficam de fora"""
    out = OrderedDict()
    for d in regs[1:]:
        if d is None or d.get('RECORD') != '41' or 'OwnerIndex' in d:
            continue
        v = d.get('Text', '')
        if d.get('Name') and v != '*' and not v.strip().startswith('='):
            out[d['Name']] = v
    return out


# ─── uma folha ────────────────────────────────────────────────────────────────
def le_folha(caminho, nome_folha=None, avisos=None, ids=None):
    """-> (itens, simbolos_da_folha, resumo). Itens no formato do ExportSheet, na ordem dos
    registros (a ordem do SchIterator)."""
    avisos = avisos if avisos is not None else []
    try:
        regs = S._registros_schdoc(caminho)
    except (OSError, ValueError) as e:
        raise SchDocErro('%s: %s' % (os.path.basename(caminho), e))
    nome_folha = nome_folha or os.path.splitext(os.path.basename(caminho))[0]
    filhos = {}
    for j, d in enumerate(regs):
        if d is not None and 'OwnerIndex' in d:
            filhos.setdefault(_i(d, 'OwnerIndex', -2) + 1, []).append(j)

    def desc(i):
        for j in filhos.get(i, []):
            yield j
            for k in desc(j):
                yield k

    folha = next((d for d in regs if d is not None and d.get('RECORD') == '31'), {})
    w, h = tamanho_folha(folha)
    tam = nome_do_tamanho(w, h) or 'Custom'
    if not (w > 0 and h > 0):
        avisos.append('%s: a folha nao diz o tamanho' % nome_folha)
    itens = [OrderedDict([('t', 'sheet'), ('name', nome_folha), ('size', tam), ('w', round(w, 3)), ('h', round(h, 3))])]
    # o carimbo: o template que a folha usa (se o hub o conhece) e os parametros do documento
    tid, tnome = template_da_folha(regs, folha, ids if ids is not None else ids_de_template())
    if tid:
        itens[0]['template'] = tid
    elif tnome:
        avisos.append('%s: o template "%s" nao esta nos templates do hub (a folha abre sem carimbo)' % (nome_folha, tnome))
    pd = params_texto(params_do_documento(regs))
    if pd:
        itens[0]['params'] = pd
    # textos do carimbo: filhos do template (registro 39)
    carimbo = set()
    for i, d in enumerate(regs):
        if d is not None and d.get('RECORD') == '39':
            for j in desc(i):
                carimbo.add(j)
    n = OrderedDict((k, 0) for k in ('comp', 'wire', 'netlabel', 'power', 'port', 'junction', 'noerc', 'text', 'carimbo', 'vazio'))
    for i, d in enumerate(regs):
        if i == 0 or d is None:
            continue
        r = d.get('RECORD')
        if r == '1':
            n['comp'] += 1
            x, y = _xy(d)
            ref = com = None
            ref_xy = com_xy = None
            fp_atual = fp_primeiro = ''
            pares = []
            for j in desc(i):
                f = regs[j]
                if f is None:
                    continue
                fr = f.get('RECORD')
                if fr == '34':
                    ref = f.get('Text', '')
                    ref_xy = _xy(f)
                elif fr == '41':
                    nm = (f.get('Name') or '').strip()
                    if nm == 'Comment':
                        com = f.get('Text', '')
                        com_xy = _xy(f)
                        continue
                    if _i(f, 'OwnerIndex', -2) + 1 != i:
                        continue                       # parametro de outro dono (de um pino)
                    val = (f.get('Text') or '').strip()
                    if nm and val and not val.startswith('=') and nm.upper() in PARAMS_IDENTIDADE:
                        pares.append(param_safe(nm) + '=' + param_safe(val))
                elif fr == '45' and (f.get('ModelType') or '').upper() == 'PCBLIB':
                    mn = f.get('ModelName', '')
                    if not fp_primeiro:
                        fp_primeiro = mn
                    if f.get('IsCurrent') == 'T' and not fp_atual:
                        fp_atual = mn
            it = OrderedDict([('t', 'comp'), ('sheet', nome_folha), ('ref', ref or ''), ('sym', d.get('LibReference', '')),
                              ('part', _i(d, 'CurrentPartId', 1)), ('x', x), ('y', y),
                              ('rot', ORIENT[_i(d, 'Orientation') & 3]), ('mirror', d.get('IsMirrored') == 'T'),
                              ('footprint', fp_atual or fp_primeiro), ('comment', com or '')])
            if pares:
                it['params'] = ';'.join(pares)
            if ref_xy is not None:
                it['refdx'], it['refdy'] = ref_xy[0] - x, ref_xy[1] - y
            if com_xy is not None:
                it['comdx'], it['comdy'] = com_xy[0] - x, com_xy[1] - y
            itens.append(it)
        elif r == '27':
            n['wire'] += 1
            pts = [[S.coord(d, 'X%d' % k), S.coord(d, 'Y%d' % k)] for k in range(1, _i(d, 'LocationCount') + 1)]
            itens.append(OrderedDict([('t', 'wire'), ('sheet', nome_folha), ('pts', pts)]))
        elif r == '25':
            n['netlabel'] += 1
            x, y = _xy(d)
            itens.append(OrderedDict([('t', 'netlabel'), ('sheet', nome_folha), ('net', d.get('Text', '')),
                                      ('x', x), ('y', y), ('rot', ORIENT[_i(d, 'Orientation') & 3])]))
        elif r == '17':
            n['power'] += 1
            x, y = _xy(d)
            itens.append(OrderedDict([('t', 'power'), ('sheet', nome_folha), ('net', d.get('Text', '')),
                                      ('style', POWER.get(_i(d, 'Style'), 'Bar')), ('x', x), ('y', y),
                                      ('rot', ORIENT[_i(d, 'Orientation') & 3])]))
        elif r == '18':
            n['port'] += 1
            x, y = _xy(d)
            itens.append(OrderedDict([('t', 'port'), ('sheet', nome_folha), ('net', d.get('Name', '')),
                                      ('io', _i(d, 'IOType')), ('style', _i(d, 'Style')), ('x', x), ('y', y),
                                      ('w', S.coord(d, 'Width')), ('fill', hex_cor(_i(d, 'AreaColor'))),
                                      ('textColor', hex_cor(_i(d, 'TextColor'))), ('color', hex_cor(_i(d, 'Color')))]))
        elif r == '29':
            n['junction'] += 1
            x, y = _xy(d)
            itens.append(OrderedDict([('t', 'junction'), ('sheet', nome_folha), ('x', x), ('y', y)]))
        elif r == '22':
            n['noerc'] += 1
            x, y = _xy(d)
            itens.append(OrderedDict([('t', 'noerc'), ('sheet', nome_folha), ('x', x), ('y', y)]))
        elif r == '4':
            if i in carimbo:
                n['carimbo'] += 1
                continue
            s = d.get('Text', '')
            if not s.strip():
                n['vazio'] += 1
                continue
            n['text'] += 1
            x, y = _xy(d)
            itens.append(OrderedDict([('t', 'text'), ('sheet', nome_folha), ('s', s), ('x', x), ('y', y), ('h', 10)]))
    simbolos = simbolos_da_folha(caminho, avisos)
    return itens, simbolos, n


def simbolos_da_folha(caminho, avisos):
    """o desenho de cada simbolo como a folha o guarda (sch_leitor.le_schdoc: ja em coordenadas
    locais), juntando as partes que aparecem em componentes diferentes"""
    try:
        colocados = S.le_schdoc(caminho)
    except Exception as e:   # o desenho e acrescimo: sem ele a folha abre igual
        avisos.append('%s: simbolos da folha ilegiveis (%s)' % (os.path.basename(caminho), e))
        return OrderedDict()
    out = OrderedDict()
    for c in colocados:
        nome = c.get('ref') or ''
        if not nome:
            continue
        s = out.get(nome)
        if s is None:
            s = out[nome] = OrderedDict([('name', nome), ('description', c.get('description', '')),
                                         ('partcount', c.get('partcount', 1)), ('_partes', OrderedDict())])
        s['partcount'] = max(s['partcount'], c.get('partcount', 1), c.get('part', 1))
        if c['part'] not in s['_partes']:
            s['_partes'][c['part']] = (c['pins'], c['graphics'])
    for s in out.values():
        partes = s.pop('_partes')
        s['parts'] = [OrderedDict([('part', k), ('pins', partes.get(k, ([], []))[0]), ('graphics', partes.get(k, ([], []))[1])])
                      for k in range(1, s['partcount'] + 1)]
        s['origem'] = 'schdoc'
    return out


# ─── projeto ─────────────────────────────────────────────────────────────────
def folhas_do_prjpcb(prj):
    """os .SchDoc do .PrjPcb, na ordem de [DocumentN] (a ordem do DM_LogicalDocuments)"""
    base = os.path.dirname(os.path.abspath(prj))
    with open(prj, 'rb') as f:
        bruto = f.read()
    # o Altium grava o .PrjPcb em UTF-8 (com ou sem BOM) nas versoes novas e em cp1252 nas velhas
    try:
        txt = bruto.decode('utf-8-sig')
    except UnicodeDecodeError:
        txt = bruto.decode('cp1252', 'replace')
    docs = []
    for m in re.finditer(r'^\[Document(\d+)\][^\[]*?^DocumentPath=(.*?)\s*$', txt, re.M | re.S):
        caminho = m.group(2).strip()
        if caminho.lower().endswith('.schdoc'):
            alvo = os.path.normpath(os.path.join(base, *re.split(r'[\\/]', caminho)))
            # a folha que veio junto, sem a pasta (o hub recebe o .PrjPcb e os .SchDoc soltos)
            solto = os.path.join(base, re.split(r'[\\/]', caminho)[-1])
            if not os.path.isfile(alvo) and os.path.isfile(solto):
                alvo = solto
            docs.append((int(m.group(1)), alvo))
    docs.sort()
    return [c for _, c in docs]


def renomeador(mapa):
    """o Libs/rename-map.js (RenameLibs) sobre os nomes da folha: o .SchDoc antigo ainda diz
    "CAP [  SMD  ]" e a biblioteca do hub ja diz "CAP [SMD]" -- sem isso o componente nao acha
    o simbolo nem o footprint. Fundido vai para o que ficou."""
    ren, fund, fp = mapa.get('sym') or {}, mapa.get('fundidos') or {}, mapa.get('fp') or {}

    def sym(n):
        if n in fund:
            n = fund[n]
        return ren.get(n) or n

    return sym, (lambda n: fp.get(n) or n)


def converte(entradas, projeto=None, com_simbolos=True, avisos=None, renomeia=False):
    """entradas: um .PrjPcb, ou .SchDoc(s) na ordem das folhas. -> (texto do schematic.js, resumo)"""
    avisos = avisos if avisos is not None else []
    folhas = []
    for e in entradas:
        if e.lower().endswith('.prjpcb'):
            fs = folhas_do_prjpcb(e)
            if not fs:
                raise SchDocErro('%s nao tem folha de esquema (.SchDoc)' % os.path.basename(e))
            projeto = projeto or os.path.splitext(os.path.basename(e))[0]
            folhas.extend(fs)
        else:
            folhas.append(e)
    if not folhas:
        raise SchDocErro('nenhuma folha de esquema')
    projeto = projeto or os.path.splitext(os.path.basename(folhas[0]))[0]
    itens, simbolos, resumo, faltam = [], OrderedDict(), OrderedDict(), []
    ids = ids_de_template()
    params_prj = ''
    for e in entradas:
        if e.lower().endswith('.prjpcb'):
            try:
                import schtemplate as ST
                params_prj = params_texto(ST.le_prjpcb(e))
            except Exception as ex:
                avisos.append('parametros do projeto ilegiveis (%s)' % ex)
    for f in folhas:
        if not os.path.isfile(f):
            faltam.append(f)
            avisos.append('folha nao encontrada: %s' % f)
            continue
        it, sy, n = le_folha(f, avisos=avisos, ids=ids)
        itens.extend(it)
        for k, v in sy.items():
            simbolos.setdefault(k, v)
        for k, v in n.items():
            resumo[k] = resumo.get(k, 0) + v
    if not itens:
        raise SchDocErro('nenhuma folha legivel')
    resumo['renomeados'] = 0
    if renomeia:
        rs, rf = renomeador(S.le_rename_map())
        for it in itens:
            if it['t'] != 'comp':
                continue
            a, b = rs(it['sym']), rf(it['footprint'])
            if a != it['sym'] or b != it['footprint']:
                resumo['renomeados'] += 1
            it['sym'], it['footprint'] = a, b
        novos = OrderedDict()
        for k, v in simbolos.items():
            v['name'] = rs(k)
            novos.setdefault(v['name'], v)
        simbolos = novos
    L = ['var schematic = {', '"format":"schmirror-v2",', '"project":' + js(projeto) + ',',
         '"generated":' + js(datetime.now().strftime('%d/%m/%Y %H:%M:%S')) + ',',
         '"source":' + js(entradas[0] if len(entradas) == 1 else ';'.join(entradas)) + ',',
         '"importer":"schdoc2sch",', '"units":"mil",']
    if params_prj:
        L.append('"params":' + js(params_prj) + ',')
    if com_simbolos and simbolos:
        L.append('"symbols":[')
        for s in simbolos.values():
            L.append(jv(s) + ',')
        L.append('],')
    L.append('"items":[')
    for it in itens:
        L.append(jv(it) + ',')
    L.append(']};')
    resumo['folhas'] = len(folhas) - len(faltam)
    resumo['simbolos'] = len(simbolos)
    resumo['faltam'] = faltam
    return '\n'.join(L) + '\n', resumo


# ─── gravar ──────────────────────────────────────────────────────────────────
def disco_de_rede(caminho):
    p = os.path.abspath(caminho)
    if p.startswith('\\\\') or p.startswith('//'):
        return True
    if os.name == 'nt' and len(p) >= 2 and p[1] == ':':
        if p[0].upper() in 'XYZ':
            return True
        try:
            import ctypes
            return ctypes.windll.kernel32.GetDriveTypeW(p[:2] + '\\') == 4
        except Exception:
            return False
    return False


def grava(saida, texto, forcar=False, permite_rede=False):
    if disco_de_rede(saida) and not permite_rede:
        raise PermissionError('nao grava em disco de rede (%s)' % saida)
    if os.path.exists(saida):
        if not forcar:
            raise FileExistsError('%s ja existe (use --forcar: o anterior vai para .bak)' % saida)
        bak = saida + '.bak-' + datetime.now().strftime('%Y%m%d-%H%M%S')
        shutil.copy2(saida, bak)
    os.makedirs(os.path.dirname(os.path.abspath(saida)), exist_ok=True)
    tmp = saida + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)
    os.replace(tmp, saida)


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='.SchDoc/.PrjPcb do Altium -> schematic.js do hub')
    ap.add_argument('entradas', nargs='+', help='.PrjPcb ou .SchDoc(s), e por ultimo a saida (schematic.js)')
    ap.add_argument('--projeto', help='nome do projeto (padrao: o do .PrjPcb ou da primeira folha)')
    ap.add_argument('--sem-simbolos', action='store_true')
    ap.add_argument('--rename', action='store_true',
                    help='aplica o Libs/rename-map.js nos nomes (o ExportProject NAO aplica: o hub resolve na tela)')
    ap.add_argument('--forcar', action='store_true')
    ap.add_argument('--json', action='store_true', help='resumo em JSON')
    a = ap.parse_args(argv)
    if len(a.entradas) < 2:
        ap.error('faltou a saida')
    entradas, saida = a.entradas[:-1], a.entradas[-1]
    avisos = []
    try:
        texto, resumo = converte(entradas, a.projeto, not a.sem_simbolos, avisos, a.rename)
    except SchDocErro as e:
        print('ERRO: %s' % e)
        return 1
    try:
        grava(saida, texto, a.forcar)
    except (PermissionError, FileExistsError, OSError) as e:
        print('RECUSADO: %s' % e)
        return 2
    resumo['avisos'] = avisos
    if a.json:
        print(json.dumps(resumo, ensure_ascii=False))
    else:
        print('schematic.js: ' + ', '.join('%s %s' % (v, k) for k, v in resumo.items() if isinstance(v, int)))
        for x in avisos:
            print('  aviso: ' + x)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
