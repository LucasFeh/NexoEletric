# -*- coding: utf-8 -*-
"""O guardião da sincronização: a lib do hub e a do Altium andam juntas.

    python tools/symbols/guardiao.py [--pull] [--full] [--podar] [--sem-schlib]   # sincroniza (repassa ao almox2lib)
    python tools/symbols/guardiao.py --status [--deep]        # o que está protegido e o que mudou no Altium desde o ledger
    python tools/symbols/guardiao.py --liberar "FAMILIA/COMPONENTE" ...   # volta ao gerador na próxima sincronização
    python tools/symbols/guardiao.py --proteger "FAMILIA/COMPONENTE" ...  # força a proteção (origem 'hub')

A HIERARQUIA MUDOU EM 2026-09-14, a pedido do usuário. Era: Altium > hub > Odoo — o que
fosse mudado direto na `.SchLib` subia para a biblioteca do hub. É: **o desenho é do HTML**.

    hub  ->  Altium    o que se salva no editor de símbolos vai para a `.SchLib` na hora
                       (`/save-almox`) e é reposto depois de cada regeração (`depois`).
    Altium -> hub      NÃO. Divergência vira ALERTA (`antes` -> `divergentes`, e a rota
                       `/api/symbols/altium-changes`), nunca aplicação automática.
    Odoo ->  hub       tudo o que não é desenho: valores, saldo, local, custo, footprint,
                       parâmetros. O gerador só CRIA desenho que não existe
                       (`almox2lib.geometria_congelada`).
    manual             `--proteger` / `--liberar` na CLI, e só eles, ainda movem desenho do
                       Altium para o hub. É a escapatória que o usuário guardou para si:
                       "nada altera a lib do html, apenas ele mesmo, manualmente".

O gerador (`tools/almox/almox2lib.py`, de outro agente) reescreve cada `.SchLib` de
`Libs/Almox` a cada sincronização; este módulo o envolve — ANTES, apura o que está diferente
no Altium e AVISA; DEPOIS, repõe o desenho do hub — e guarda o estado no ledger
`Libs/lib-ledger.json` (versionado: é estado, como o `almox-parts.json`).

Consequência que o alerta existe para contar: componente mexido no Altium e não adotado no
hub volta ao desenho do hub (ou ao do gerador) na próxima sincronização. Antes ele era
adotado sozinho; agora é preciso dizer `--proteger "FAMILIA/COMPONENTE"`.

O ledger:

  arquivos     mtime+size de cada .SchLib que o hub conhece (a da casa e as de Libs/Almox),
               registrados sempre que o HUB escreve (save, mirror, flags, guardião) ou aplica
               o que veio do Altium. Arquivo diferente disso "mudou no Altium". A chave é
               relativa à raiz (`Libs/Almox/X ALMOX.SchLib`, com '/': os worktrees
               compartilham a pasta) ou absoluta fora dela (a SchLib da casa no Y:).
  gerado       a impressão digital da geometria que o gerador escreveu por último, POR SÍMBOLO
               do espelho (`RESISTOR [SMD]`, `CONECTOR 4V [PTH]`…), não por família como o
               brief imaginava: BARRA DE PINOS, CHAVE, CONECTOR, DIP SWITCH e ESPECIAIS têm de
               3 a 57 geometrias no mesmo arquivo, uma por símbolo — e por símbolo ela é única
               (conferido nos 2.469 componentes das 31 libs). O componente sabe o seu símbolo
               pelo `valores[].altium` do espelho.
  protegidos   por família (o arquivo) e componente: a geometria inteira (`parts`) de quem foi
               mudado FORA do gerador — no Altium (`origem: altium`) ou a pedido do usuário
               pelo hub/CLI (`origem: hub`) —, reposta depois de cada regeneração. Componente
               protegido que saiu do Odoo fica com `orfao: true` e é ignorado.

A impressão digital é `extrair.fingerprint(pins, graphics, 'ci')`: arredonda a 1 mil e
ignora cor e visibilidade — o round-trip pelo `schlib_patch` (3 casas) não a altera.

Um arquivo que o hub escreveu por último (mtime igual ao ledger) não é apurado: o que está
nele é nosso. Só o que mudou desde então — ou nunca foi visto — é lido. Componente sem
`gerado` do símbolo não é julgado: assume-se que o arquivo é o que o gerador fez — é assim
que o ledger nasce, sem proteger nada. (Aqui havia a regra inversa: componente cuja
geometria voltasse à do gerador NO ALTIUM perdia a proteção, "o Altium é a verdade". Saiu
com a inversão: quem protege e quem libera é o hub.)

O espelho `Libs/almox-*.js` anda junto com o ledger: o símbolo com protegidos ganha os campos
`origem` (`hub` ou `altium`, de onde veio o desenho) e `protegidos: N`; o símbolo sem
protegidos perde as marcas. A GEOMETRIA do espelho só é escrita no caminho manual
(`atualiza_espelhos(..., geometria=True)`) — na sincronização o espelho é a verdade e
ninguém escreve por cima dele. O arquivo é reescrito com o `escreve_espelho` do próprio
almox2lib, linha a linha — as linhas dos outros símbolos saem byte a byte iguais.

A biblioteca da casa é resolvida pela ordem única do `tools/libpath.py` — a viva do
`config.json » schlib` enquanto o arquivo dela existir, senão a cópia publicada em
`Libs/BIBLIOTECA DE ESQUEMA.SchLib`. O `sincroniza` publica essa cópia no começo de cada
rodada: é assim que a biblioteca da casa viaja no push e chega ao hub do servidor, que
por desenho não alcança nem o `Y:` nem a UNC do PC.

Aqui havia um REMENDO — trocar `gera` e `carrega_lib` do `schlib_escritor` já importado
por versões apontadas para a lib real, porque o gerador reciclava de uma cópia antiga em
D: enquanto o hub editava a do `Y:`. O escritor passou a ler a mesma ordem, e o remendo
saiu.
"""
import argparse
import copy
import io
import json
import os
import re
import sys
import threading
import time
from collections import Counter, OrderedDict
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
sys.path.insert(0, BASE)

import sch_leitor as L                                 # noqa: E402
import schlib_patch as P                               # noqa: E402
import extrair as E                                    # noqa: E402
import libpath as LP                                   # noqa: E402

FORMATO = 'ledger-v1'
LEDGER = os.path.join('Libs', 'lib-ledger.json')
RESUMO_JS = os.path.join('Libs', 'almox-guardiao.js')
ALMOX_DIR = os.path.join('Libs', 'Almox')
ESPELHOS_ALMOX = ('almox-basicos.js', 'almox-especiais.js')
ESPELHO_CASA = os.path.join('Libs', 'schlib.js')
CONFIG = os.path.join('tools', 'symbols', 'config.json')
RENAME_MAP = os.path.join('Libs', 'rename-map.js')
PCBLIB = os.path.join('Libs', 'pcblib.js')
# A .SchLib é alinhada a setor (512 B): duas edições seguidas costumam ter o MESMO tamanho, e
# só o mtime as separa. Por isso a tolerância é de milissegundos, não de segundos — 2 s
# engoliam uma edição feita logo depois de um save (o teste pegou). NTFS e Samba dão 100 ns.
TOL_MTIME = 0.005
RX_FAMILIA = re.compile(r'^(.*?)( \d+)? ALMOX\.SchLib$', re.I)   # "ESPECIAIS 2 ALMOX.SchLib" -> ESPECIAIS
_lock = threading.RLock()     # o ledger é lido-modificado-gravado; o sincroniza segura e chama quem também segura


def agora():
    return datetime.now().strftime('%Y-%m-%d %H:%M')


def _norm(caminho):
    return os.path.normpath(os.path.abspath(caminho))


def _canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def _igual(a, b):
    """igualdade de geometria/estruturas sem depender da ordem das chaves (OrderedDict
    compara ordem; o ledger e o espelho gravam em ordens diferentes)"""
    return _canon(a) == _canon(b)


# ─── o ledger ────────────────────────────────────────────────────────────────
def caminho_ledger(raiz):
    return os.path.join(raiz, LEDGER)


def ledger_vazio():
    return OrderedDict([('format', FORMATO), ('atualizado', ''), ('arquivos', OrderedDict()),
                        ('gerado', OrderedDict()), ('protegidos', OrderedDict())])


def carrega_ledger(raiz):
    """Libs/lib-ledger.json -> dict; ausente = vazio (é assim que ele nasce)"""
    p = caminho_ledger(raiz)
    if not os.path.isfile(p):
        return ledger_vazio()
    with open(p, encoding='utf-8') as f:
        d = json.load(f, object_pairs_hook=OrderedDict)
    if not isinstance(d, dict) or d.get('format') != FORMATO:
        raise ValueError('%s não é um ledger %s' % (p, FORMATO))
    for k in ('arquivos', 'gerado', 'protegidos'):
        if not isinstance(d.get(k), dict):
            d[k] = OrderedDict()
    return d


def _j(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def dumps_ledger(d):
    """uma entrada por linha em cada seção (o git diffa bem), chaves em ordem"""
    fora = ['{"format":%s,"atualizado":%s,' % (_j(d.get('format', FORMATO)), _j(d.get('atualizado', '')))]
    for secao in ('arquivos', 'gerado'):
        itens = sorted((d.get(secao) or {}).items())
        fora.append('"%s":{' % secao)
        for i, (k, v) in enumerate(itens):
            fora.append(' %s:%s%s' % (_j(k), _j(v), ',' if i < len(itens) - 1 else ''))
        fora.append('},')
    fams = sorted((d.get('protegidos') or {}).items())
    fora.append('"protegidos":{')
    for i, (fam, comps) in enumerate(fams):
        fora.append(' %s:{' % _j(fam))
        cs = sorted((comps or {}).items())
        for k, (c, v) in enumerate(cs):
            fora.append('  %s:%s%s' % (_j(c), _j(v), ',' if k < len(cs) - 1 else ''))
        fora.append(' }%s' % (',' if i < len(fams) - 1 else ''))
    fora.append('}}')
    return '\n'.join(fora) + '\n'


def grava_ledger(raiz, ledger):
    ledger['atualizado'] = agora()
    p = caminho_ledger(raiz)
    d = os.path.dirname(p)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(dumps_ledger(ledger))
    os.replace(tmp, p)


# ─── arquivos: mtime/size ─────────────────────────────────────────────────────
def chave_arquivo(raiz, caminho):
    """a chave do arquivo no ledger: relativa à raiz (com '/') quando está dentro dela — o
    ledger é versionado e Libs/Almox é uma junction compartilhada entre worktrees —, e
    absoluta fora (a SchLib da casa no Y:)"""
    c = _norm(caminho)
    try:
        rel = os.path.relpath(c, _norm(raiz))
    except ValueError:                      # outro drive no Windows
        return c
    if rel.startswith('..'):
        return c
    return rel.replace('\\', '/')


def estado_arquivo(caminho):
    """{'mtime', 'size'} ou None quando o arquivo não está lá (Y: fora do ar)"""
    try:
        st = os.stat(caminho)
    except OSError:
        return None
    return {'mtime': round(st.st_mtime, 3), 'size': st.st_size}


def registra_arquivo(raiz, caminho, ledger=None, gravar=True):
    """anota no ledger o estado atual do arquivo — o HUB acabou de escrevê-lo (ou de
    absorver o que o Altium fez nele). Devolve o ledger; `gravar=False` deixa a gravação
    para quem chamou."""
    with _lock:
        if ledger is None:
            ledger = carrega_ledger(raiz)
        # A cópia publicada nunca entra no ledger — o gate mora AQUI, e não só no `do_hub`,
        # porque as rotas do symserver (/save, /mirror, /altium-apply) chamam esta função
        # direto, sem passar por ele. Ver `do_hub` para o porquê.
        if LP.e_publicada(raiz, caminho):
            return ledger
        st = estado_arquivo(caminho)
        if st is None:
            return ledger
        ledger['arquivos'][chave_arquivo(raiz, caminho)] = OrderedDict([
            ('mtime', st['mtime']), ('size', st['size']), ('visto', agora())])
        if gravar:
            grava_ledger(raiz, ledger)
        return ledger


def mudou(ledger, raiz, caminho):
    """-> (mudou, conhecido, estado). Desconhecido (nunca visto) não é "mudou": não há com
    o que comparar."""
    st = estado_arquivo(caminho)
    reg = (ledger.get('arquivos') or {}).get(chave_arquivo(raiz, caminho))
    if st is None:
        return False, reg is not None, None
    if not isinstance(reg, dict):
        return False, False, st
    dif = abs(float(st['mtime']) - float(reg.get('mtime') or 0)) > TOL_MTIME or st['size'] != reg.get('size')
    return dif, True, st


def _quando(st):
    return time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(st['mtime'])) if st else ''


# ─── onde estão as coisas ─────────────────────────────────────────────────────
def config_casa(raiz):
    """tools/symbols/config.json do workspace; sem ele, a lib da casa"""
    try:
        cfg = E.le_config(os.path.join(raiz, CONFIG))
    except (OSError, ValueError):
        cfg = {}
    if not isinstance(cfg, dict):
        cfg = {}
    cfg['schlib'] = LP.schlib(raiz)
    return cfg


def schlib_casa(raiz):
    return config_casa(raiz)['schlib']


def do_hub(raiz, caminho):
    """o arquivo é um dos que o hub vigia — a SchLib da casa (config.json) ou uma lib de
    Libs/Almox? Só esses entram no ledger: o schlib_patch e o sch_leitor também servem a
    cópias em tmp (os testes), e uma cópia registrada seria lixo num arquivo versionado.

    A cópia PUBLICADA (`Libs/BIBLIOTECA DE ESQUEMA.SchLib`) fica de fora, e isso é
    deliberado: o ledger identifica edição do Altium por mtime, e o `git archive` do
    deploy carimba nos arquivos extraídos a data do COMMIT. A cópia ganharia mtime novo a
    cada deploy — de qualquer commit, mesmo um só de README — e o hub do servidor abriria
    sozinho, para qualquer um na LAN, o modal de "mudou no Altium, quer aplicar?". Ela é
    publicação: quem a escreve é o `libpath.publica`, e não há o que detectar."""
    if LP.e_publicada(raiz, caminho):
        return False
    # A lib da casa é tanto a que a ordem resolveu quanto a que o config DECLARA: com o
    # share fora do ar as duas divergem, e é a declarada que o `detecta` vigia para mostrar
    # "não alcancei" em vez de fazer a linha sumir.
    alvos = {_norm(schlib_casa(raiz))}
    declarada = LP.viva(raiz)
    if declarada:
        alvos.add(_norm(declarada))
    if _norm(caminho) in alvos:
        return True
    return chave_arquivo(raiz, caminho).startswith('Libs/Almox/')


def familia_de(nome):
    """'ESPECIAIS 2 ALMOX.SchLib' -> 'ESPECIAIS'; None se não é lib do almoxarifado"""
    m = RX_FAMILIA.match(os.path.basename(nome))
    return m.group(1) if m else None


def arquivos_almox(raiz):
    """[(familia, caminho)] das .SchLib de Libs/Almox, em ordem de nome"""
    d = os.path.join(raiz, ALMOX_DIR)
    if not os.path.isdir(d):
        return []
    fora = []
    for f in sorted(os.listdir(d)):
        fam = familia_de(f)
        if fam:
            fora.append((fam, os.path.join(d, f)))
    return fora


def fp_parts(parts):
    """a impressão digital de um símbolo inteiro: uma por parte, unidas por '+'"""
    return '+'.join(E.fingerprint(p.get('pins') or [], p.get('graphics') or [], 'ci') for p in parts or [])


def le_familia(caminho):
    """{componente: parts} de uma .SchLib do almoxarifado (sem footprints: só a geometria)"""
    d = L.le_schlib(caminho, com_footprints=False)
    return OrderedDict((s['name'], s['parts']) for s in d['symbols'])


# ─── os espelhos do almoxarifado ─────────────────────────────────────────────
_RX_VAR = re.compile(r'^\s*var\s+(\w+)\s*=\s*')


def le_espelho_almox(caminho):
    """'var X = {...};' -> (varname, dict); o dict preserva a ordem das chaves"""
    with open(caminho, encoding='utf-8') as f:
        txt = f.read()
    m = _RX_VAR.match(txt)
    if not m:
        raise ValueError('%s não começa com "var X ="' % caminho)
    corpo = txt[m.end():].strip().rstrip(';').strip()
    return m.group(1), json.loads(corpo, object_pairs_hook=OrderedDict)


def grava_espelho_almox(caminho, varname, esp):
    """com a disciplina do almox2lib.escreve_espelho (cabeçalho + um símbolo por linha),
    atômico: escreve numa pasta temporária AO LADO com o mesmo nome — o `"lib"` do
    cabeçalho sai do basename — e os.replace"""
    import almox2lib as A
    d = os.path.join(os.path.dirname(os.path.abspath(caminho)), '.guardiao.tmp')
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, os.path.basename(caminho))
    A.escreve_espelho(tmp, varname, esp.get('title', ''), esp.get('symbols') or [], esp.get('generated', ''))
    os.replace(tmp, caminho)
    try:
        os.rmdir(d)
    except OSError:
        pass


def carrega_espelhos_almox(raiz):
    """[(caminho, varname, dict)] dos espelhos que existem"""
    fora = []
    for f in ESPELHOS_ALMOX:
        cam = os.path.join(raiz, 'Libs', f)
        if os.path.isfile(cam):
            var, esp = le_espelho_almox(cam)
            fora.append((cam, var, esp))
    return fora


def _familia_arquivo(sim, basename):
    """a família que dá nome ao ARQUIVO: nos especiais é a lib única, e os caracteres
    proibidos viram '-' como no schlib_escritor.nome_arquivo"""
    fam = 'ESPECIAIS' if basename == 'almox-especiais.js' else (sim.get('familia') or '')
    return re.sub(r'[\\/:*?"<>|]', '-', fam)


def indice_almox(espelhos):
    """{(familia, componente): (símbolo, k do espelho, i do símbolo)} — o `valores[].altium`
    é o LibReference do componente na .SchLib da família"""
    idx = OrderedDict()
    for k, (cam, _var, esp) in enumerate(espelhos):
        base = os.path.basename(cam)
        for i, sim in enumerate(esp.get('symbols') or []):
            fam = _familia_arquivo(sim, base)
            for v in sim.get('valores') or []:
                if v.get('altium'):
                    idx[(fam, v['altium'])] = (sim.get('name', ''), k, i)
    return idx


def _bbox(parts):
    try:
        import simbolos as SY
        x1, y1, x2, y2 = SY.bbox(parts[0].get('pins') or [], parts[0].get('graphics') or [])
        return OrderedDict([('x1', x1), ('y1', y1), ('x2', x2), ('y2', y2)])
    except Exception:                                   # noqa: BLE001
        return None


# ─── proteções ───────────────────────────────────────────────────────────────
def _prot(ledger, fam, comp):
    return (ledger.get('protegidos') or {}).get(fam, {}).get(comp)


def _poe_prot(ledger, fam, comp, parts, origem, simbolo):
    fam_d = ledger['protegidos'].setdefault(fam, OrderedDict())
    velho = fam_d.get(comp) or {}
    fam_d[comp] = OrderedDict([('fp', fp_parts(parts)), ('origem', origem),
                               ('desde', velho.get('desde') or agora()), ('simbolo', simbolo),
                               ('parts', copy.deepcopy(parts))])
    return fam_d[comp]


def _tira_prot(ledger, fam, comp):
    fam_d = ledger['protegidos'].get(fam)
    if not fam_d or comp not in fam_d:
        return False
    del fam_d[comp]
    if not fam_d:
        del ledger['protegidos'][fam]
    return True


def lista_protegidos(ledger):
    """o que está protegido, para o resumo e para o --status.

    Havia aqui um `novos=()` que marcava `novo: True` no que o `antes` acabara de proteger
    a partir do Altium. Com a inversão de autoridade (ver `antes`) nada mais nasce protegido
    numa sincronização: proteção só entra pelo hub (`/save-almox`, `--proteger`), e o que o
    Altium tem de diferente sai em `divergentes`, não aqui. O campo ficou, sempre False,
    porque o espelho e a tela já o leem — tirá-lo mudaria o formato do resumo sem ganho."""
    fora = []
    for fam, comps in sorted((ledger.get('protegidos') or {}).items()):
        for comp, p in sorted(comps.items()):
            fora.append(OrderedDict([('familia', fam), ('componente', comp), ('simbolo', p.get('simbolo', '')),
                                     ('origem', p.get('origem', '')), ('desde', p.get('desde', '')),
                                     ('fp', p.get('fp', '')), ('orfao', bool(p.get('orfao'))),
                                     ('novo', False)]))
    return fora


def _acha_componente(raiz, fam, comp, cache):
    """(caminho, parts) do componente numa das libs da família (pode estar fatiada)"""
    for f2, cam in arquivos_almox(raiz):
        if f2 != fam:
            continue
        if cam not in cache:
            cache[cam] = le_familia(cam)
        if comp in cache[cam]:
            return cam, cache[cam][comp]
    return None, None


# ─── antes do gerador ────────────────────────────────────────────────────────
def antes(raiz, ledger, log=print):
    """apura o que está diferente nas libs do almoxarifado desde o ledger — e SÓ apura.

    A INVERSÃO DE AUTORIDADE, 2026-09-14. Até aqui esta função PROMOVIA o Altium: geometria
    diferente da que o gerador escreveu virava proteção `origem: altium`, e daí subia para o
    espelho do hub; geometria que voltasse à do gerador tirava a proteção. Era a hierarquia
    antiga (Altium > hub > Odoo), e ela deixava o desenho da biblioteca do hub mudar sozinho
    por causa de um save no Altium, sem ninguém pedir.

    A regra agora é a do usuário: **o desenho é do HTML**. O que se edita no hub desce para a
    .SchLib (o `/save-almox` grava lá na hora, e o `depois` repõe depois de cada regeração);
    o que se edita no Altium **não sobe** — vira ALERTA. Esta função é esse alerta: devolve a
    lista de divergências para o resumo do sincronismo e para a aba Biblioteca, e não mexe em
    uma linha do ledger.

    Divergência é geometria diferente da referência daquele componente:
      protegido      a referência é o desenho protegido (o que o hub gravou). Divergir quer
                     dizer que o Altium mexeu e que a próxima regeração vai desfazer — o
                     `depois` repõe o do hub. É a divergência que mais importa avisar.
      não protegido  a referência é `gerado[símbolo]`, a impressão digital do que o gerador
                     escreveu por último. Divergir quer dizer que alguém desenhou no Altium
                     e que ninguém no hub sabe.
    -> [divergências]"""
    idx = indice_almox(carrega_espelhos_almox(raiz))
    divergentes = []
    for fam, cam in arquivos_almox(raiz):
        m, conhecido, st = mudou(ledger, raiz, cam)
        if conhecido and not m:
            continue                        # o hub escreveu por último: o que está lá é nosso
        comps = le_familia(cam)
        log('antes: %s %s — %d componente(s) lido(s)' % (
            os.path.basename(cam), 'mudou desde o ledger' if conhecido else 'nunca visto', len(comps)))
        for comp, parts in comps.items():
            sim = idx.get((fam, comp))
            if not sim:
                continue                    # não está no espelho: o gerador vai apagá-lo
            prot = _prot(ledger, fam, comp)
            fp = fp_parts(parts)
            if prot and not prot.get('orfao'):
                if prot.get('fp') == fp:
                    continue                # o Altium está com o desenho do hub: nada a dizer
                ref = 'protegido'
            else:
                esperado = ledger['gerado'].get(sim[0])
                if esperado is None or fp == esperado:
                    continue                # primeira vez, ou é o que o gerador escreveu
                ref = 'gerado'
            divergentes.append(OrderedDict([
                ('familia', fam), ('componente', comp), ('simbolo', sim[0]),
                ('referencia', ref), ('origem', (prot or {}).get('origem', '')),
                ('reposto', ref == 'protegido')]))
            log('   mudou no Altium (%s): %s / %s%s' % (
                ref, fam, comp, ' — a regeração repõe o desenho do hub' if ref == 'protegido' else ''))
    if divergentes:
        log('   %d divergência(s) do Altium — o hub AVISA e não aplica; '
            'quem manda no desenho é a biblioteca do hub' % len(divergentes))
    return divergentes


# ─── o gerador ───────────────────────────────────────────────────────────────
def origem_reciclagem(raiz):
    """de onde o gerador vai reciclar — a mesma ordem que o escritor usa sozinho"""
    return LP.schlib(raiz)


def gerador_real(argv, log=print, raiz=RAIZ):
    """almox2lib.main EM PROCESSO. O `schlib_escritor` resolve a origem da reciclagem
    pelo `tools/libpath.py`, igual a este módulo — não há mais o que remendar."""
    if _norm(raiz) != _norm(RAIZ):
        raise RuntimeError('o almox2lib só escreve na raiz do repositório (%s); para outra raiz use --sem-gerador' % RAIZ)
    import almox2lib as A
    real, procedencia = LP.resolve_schlib(raiz)
    if procedencia == LP.SEM_VIVA:
        # O único caso que merece alarme: o config aponta para uma lib que não está lá.
        # Na bancada isso é o share fora do ar; a rodada segue com a última publicação,
        # que é boa, mas o que sair dela pode estar atrás do que o Altium já gravou.
        log('ATENCAO: a SchLib da casa está fora de alcance (%s); reciclando da última publicação'
            % LP.viva(raiz))
    log('reciclando da biblioteca real: %s' % real)
    return A.main(list(argv or []))


def gerador_nenhum(argv, log=print):
    log('gerador pulado (--sem-gerador): só antes/depois')
    return 0


# ─── depois do gerador ───────────────────────────────────────────────────────
def depois(raiz, ledger, log=print):
    """para cada lib do almoxarifado: `gerado[símbolo]` = geometria do primeiro componente
    não protegido; protegidos repostos com o schlib_patch (uma carga/gravação por arquivo;
    quem sumiu vira órfão); mtime/size registrados. -> (repostos, orfaos, familias)"""
    espelhos = carrega_espelhos_almox(raiz)
    idx = indice_almox(espelhos)
    simbolos_atuais = {v[0] for v in idx.values()}
    repostos, orfaos, familias, vistos = [], [], [], set()
    gerado_visto = set()
    chaves_atuais = set()
    for fam, cam in arquivos_almox(raiz):
        familias.append(fam)
        chaves_atuais.add(chave_arquivo(raiz, cam))
        comps = le_familia(cam)
        prots = ledger['protegidos'].get(fam) or OrderedDict()
        for comp, parts in comps.items():
            sim = idx.get((fam, comp))
            if not sim or comp in prots or sim[0] in gerado_visto:
                continue
            ledger['gerado'][sim[0]] = fp_parts(parts)
            gerado_visto.add(sim[0])
        a_repor = [c for c in prots if c in comps]
        for c in prots:
            if c not in comps:
                if not prots[c].get('orfao'):
                    log('   órfão (saiu do Odoo, proteção guardada): %s / %s' % (fam, c))
                prots[c]['orfao'] = True
                orfaos.append(OrderedDict([('familia', fam), ('componente', c)]))
            else:
                prots[c].pop('orfao', None)
        if a_repor:
            lib = P.carrega(cam)
            feitos = []
            for c in a_repor:
                try:
                    P.aplica(lib, {'name': c, 'parts': prots[c]['parts']})
                    feitos.append(c)
                except (ValueError, KeyError) as e:
                    log('   ATENCAO: não repus %s / %s: %s' % (fam, c, e))
            if feitos:
                P.grava(lib, cam, backup=False)
                lido = le_familia(cam)
                for c in feitos:
                    difs = P.compara(P.esperado({'name': c, 'parts': prots[c]['parts']}), lido.get(c) or [])
                    if difs:
                        log('   ATENCAO: %s / %s não voltou igual: %s' % (fam, c, difs[0]))
                    repostos.append(OrderedDict([('familia', fam), ('componente', c),
                                                 ('simbolo', prots[c].get('simbolo', '')),
                                                 ('origem', prots[c].get('origem', ''))]))
                log('   %s: %d protegido(s) reposto(s)' % (os.path.basename(cam), len(feitos)))
        registra_arquivo(raiz, cam, ledger, gravar=False)
        vistos.add(cam)
    # o que o gerador apagou (família que sumiu, pedaço a menos) sai do ledger
    for k in [k for k in ledger['arquivos'] if k.startswith('Libs/Almox/') and k not in chaves_atuais]:
        del ledger['arquivos'][k]
    for k in [k for k in ledger['gerado'] if k not in simbolos_atuais]:
        del ledger['gerado'][k]
    return repostos, orfaos, sorted(set(familias))


def atualiza_espelhos(raiz, ledger, log=print, espelhos=None, substitutos=None, geometria=False):
    """o espelho anda junto com o ledger: símbolo com protegidos ganha as marcas
    `origem`/`protegidos`; sem protegidos, perde as marcas. -> nomes dos símbolos tocados

    `geometria` decide se a GEOMETRIA protegida também entra no espelho, e é o coração da
    inversão de autoridade (2026-09-14):

      False (a sincronização)  só as marcas. O desenho do espelho é a verdade e ninguém
            escreve por cima dele — nem o gerador, que agora só cria o que não existe
            (`almox2lib.geometria_congelada`), nem este módulo. Era por aqui que a geometria
            vinda do Altium subia para a biblioteca do hub; não sobe mais.
      True  (comando manual)   `aplica`, `protege` e `libera` — alguém digitou, ou apertou um
            botão que diz o que vai fazer. É a escapatória que o usuário guardou para si
            ("apenas ele mesmo, manualmente"), e o único caminho que ainda muda o desenho da
            biblioteca do hub a partir do Altium.

    Com `geometria`: o símbolo recebe a geometria protegida mais frequente (empate = a mais
    antiga); `substitutos` {símbolo: parts} é a geometria a pôr num símbolo que acabou de
    perder a proteção; e o componente protegido cuja geometria NÃO é a que o símbolo recebeu
    ganha a sua em `valores[].parts` — o hub desenha o valor sem `parts` com o desenho da
    família, então só a minoria precisa de `parts` próprio."""
    espelhos = espelhos if espelhos is not None else carrega_espelhos_almox(raiz)
    substitutos = (substitutos or {}) if geometria else {}
    por_sim = {}
    for fam, comps in (ledger.get('protegidos') or {}).items():
        for comp, p in comps.items():
            if p.get('orfao'):
                continue
            por_sim.setdefault(p.get('simbolo'), []).append(dict(p, componente=comp))
    tocados = []
    for cam, var, esp in espelhos:
        mudou_arq = False
        for sim in esp.get('symbols') or []:
            ps = por_sim.get(sim.get('name'))
            if not ps:
                sub = substitutos.get(sim.get('name'))
                if 'origem' in sim or 'protegidos' in sim or sub is not None:
                    sim.pop('origem', None)
                    sim.pop('protegidos', None)
                    if sub is not None:
                        sim['parts'] = copy.deepcopy(sub)
                        sim['partcount'] = len(sub)
                        bb = _bbox(sub)
                        if bb:
                            sim['bbox'] = bb
                    mudou_arq = True
                    tocados.append(sim['name'])
                continue
            cont = Counter(p['fp'] for p in ps)
            melhor = sorted(cont, key=lambda f: (-cont[f], min(p.get('desde', '') for p in ps if p['fp'] == f)))[0]
            escolhido = next(p for p in ps if p['fp'] == melhor)
            if geometria:
                # a minoria: componente protegido com geometria diferente da do símbolo leva
                # a sua para o próprio valor
                por_comp = {p['componente']: p for p in ps}
                for v in sim.get('valores') or []:
                    p = por_comp.get(v.get('altium'))
                    if not p or p['fp'] == melhor or _igual(v.get('parts'), p['parts']):
                        continue
                    v['parts'] = copy.deepcopy(p['parts'])
                    mudou_arq = True
                    if sim['name'] not in tocados:
                        tocados.append(sim['name'])
                    log('   espelho: %s / %s com o desenho protegido próprio' % (sim['name'], v.get('altium')))
            # A MARCA diz DE ONDE veio o desenho protegido, e era 'altium' fixo — mentira
            # desde que o hub passou a proteger o que se salva no editor de símbolos, e
            # mentira grande depois da inversão, em que o caminho normal é justamente o hub.
            # Havendo os dois no mesmo símbolo, 'hub' ganha: é o que manda no desenho.
            marca = 'hub' if any(x.get('origem') == 'hub' for x in ps) else 'altium'
            # as MARCAS valem sempre; a geometria, só no caminho manual
            iguais = _igual(sim.get('parts'), escolhido['parts']) if geometria else True
            if iguais and sim.get('origem') == marca and sim.get('protegidos') == len(ps):
                continue
            if geometria:
                sim['parts'] = copy.deepcopy(escolhido['parts'])
                sim['partcount'] = len(escolhido['parts'])
                bb = _bbox(escolhido['parts'])
                if bb:
                    sim['bbox'] = bb
            sim['origem'] = marca
            sim['protegidos'] = len(ps)
            mudou_arq = True
            if sim['name'] not in tocados:
                tocados.append(sim['name'])
            log('   espelho: %s %s (%d componente(s))' % (
                sim['name'], 'com a geometria protegida' if geometria else 'marcado como protegido',
                len(ps)))
        if mudou_arq:
            grava_espelho_almox(cam, var, esp)
    return tocados


def escreve_resumo(raiz, resumo):
    """Libs/almox-guardiao.js — o diálogo de sincronização do hub lê por loadVarScript"""
    cam = os.path.join(raiz, RESUMO_JS)
    tmp = cam + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write('var almoxGuardiao = %s;\n' % json.dumps(resumo, ensure_ascii=False, indent=1))
    os.replace(tmp, cam)


def le_resumo(raiz):
    cam = os.path.join(raiz, RESUMO_JS)
    if not os.path.isfile(cam):
        return None
    try:
        return le_espelho_almox(cam)[1]
    except (OSError, ValueError):
        return None


# ─── a sincronização inteira ─────────────────────────────────────────────────
def sincroniza(argv=(), log=print, raiz=RAIZ, gerador=None):
    """antes -> gerador -> depois -> espelhos -> ledger. `gerador(argv, log) -> código` é
    injetável (o teste); None = almox2lib em processo. Falha do gerador não pula o
    "depois": as libs que ele tenha escrito ganham as proteções de volta do mesmo jeito."""
    t0 = time.time()
    with _lock:
        ledger = carrega_ledger(raiz)
        log('guardião: ledger %s (%d arquivo(s), %d símbolo(s) gerado(s), %d protegido(s))' % (
            LEDGER.replace('\\', '/'), len(ledger['arquivos']), len(ledger['gerado']),
            sum(len(c) for c in ledger['protegidos'].values())))
        divergentes = antes(raiz, ledger, log)
        grava_ledger(raiz, ledger)          # o "antes" não mexe no ledger, mas o `carrega` normaliza
        # A publicação vem antes do gerador de propósito: se a rodada morrer no meio, a
        # cópia que viaja no push já está atualizada. Não levanta nunca — share fora do ar
        # é aviso, não motivo para o sincronismo inteiro cair.
        pub = LP.publica(raiz, log)
        recicl = origem_reciclagem(raiz)
        erro = None
        gerador = gerador or (lambda a, l: gerador_real(a, l, raiz))
        log('gerando: almox2lib %s' % (' '.join(argv) if argv else '(snapshot em disco)'))
        try:
            code = gerador(list(argv or []), log)
            if code not in (0, None):
                erro = 'o gerador terminou com código %s' % code
        except Exception as e:                              # noqa: BLE001
            erro = '%s: %s' % (type(e).__name__, e)
        if erro:
            log('ATENCAO: %s — as proteções são repostas no que existe' % erro)
        repostos, orfaos, familias = depois(raiz, ledger, log)
        tocados = atualiza_espelhos(raiz, ledger, log)
        grava_ledger(raiz, ledger)
        resumo = OrderedDict([
            ('ok', erro is None), ('erro', erro), ('quando', agora()),
            ('gerados', len(familias)), ('arquivos', len([k for k in ledger['arquivos'] if k.startswith('Libs/Almox/')])),
            ('protegidos', lista_protegidos(ledger)),
            ('divergentes', divergentes), ('repostos', repostos), ('orfaos', orfaos),
            ('espelhos', tocados), ('recicladoDe', recicl),
            ('publicada', os.path.relpath(pub['alvo'], raiz).replace('\\', '/')),
            ('publicou', pub['publicou']), ('publicacao', pub['motivo'] or 'publicada agora'),
            ('segundos', round(time.time() - t0, 1))])
        escreve_resumo(raiz, resumo)
        log('guardião: %d família(s), %d protegido(s) (%d divergência(s) do Altium, %d reposto(s), %d órfão(s)), %d símbolo(s) do espelho%s — %.1f s' % (
            len(familias), len(resumo['protegidos']), len(divergentes), len(repostos), len(orfaos), len(tocados),
            '' if not erro else '; ERRO: ' + erro, resumo['segundos']))
        return resumo


# ─── detecção de mudanças vindas do Altium ───────────────────────────────────
def _fps_modelos(sym):
    return [(f.get('name', ''), bool(f.get('current'))) for f in sym.get('footprints') or []]


def _flags(sym):
    return [[(bool(q.get('hideNum')), bool(q.get('hideName'))) for q in p.get('pins') or []]
            for p in sym.get('parts') or []]


def _cores(sym):
    return [[(g.get('color'), g.get('fill')) for g in p.get('graphics') or []] for p in sym.get('parts') or []]


def _le_espelho_casa(caminho):
    """-> (texto latin-1, {name: símbolo}); o schlib.js é ASCII"""
    with open(caminho, 'rb') as f:
        texto = f.read().decode('latin-1')
    s = re.sub(r'^\s*//[^\n]*\n', '', texto, flags=re.M)
    s = s[s.find('=') + 1:].strip().rstrip(';').strip()
    obj = json.loads(re.sub(r',\s*([\]}])', r'\1', s))
    return texto, OrderedDict((x.get('name', ''), x) for x in obj.get('symbols') or [])


def _le_casa(raiz, caminho, extras=True, bruto=None):
    """a SchLib da casa lida como o espelho: footprints cruzados com a pcblib e o rename-map
    aplicado (nomes do espelho). -> (dados, reverso {novo: antigo})"""
    if bruto is None:
        with open(caminho, 'rb') as f:
            bruto = f.read()
    nomes = L.nomes_pcblib(os.path.join(raiz, PCBLIB))
    mapa = L.le_rename_map(os.path.join(raiz, RENAME_MAP))
    dados = L.le_schlib(bruto, pcblib_names=nomes, extras=extras)
    L.aplica_rename(dados, mapa)
    reverso = {novo: antigo for antigo, novo in (mapa.get('sym') or {}).items() if novo != antigo}
    return dados, reverso


def compara_casa(raiz, caminho):
    """símbolos da SchLib da casa que diferem do Libs/schlib.js. A geometria compara pela
    impressão digital contra as DUAS leituras (com e sem as conversões que o ExportLibs
    não fazia — RECORD 5/10/11), senão um espelho do ExportLibs acusaria 63 símbolos que
    ninguém editou. Flags e cores só se julgam POR SÍMBOLO cuja linha do espelho já carrega
    alguma cor: o leitor a escreve em quase todo gráfico e o ExportLibs em nenhum, então
    linha sem cor é da era ExportLibs e não sabe nada disso (regenerar com /mirror é que
    traz). Decidir isso pelo arquivo inteiro foi o erro da primeira versão: um único
    apply numa linha pintava o arquivo de "sabe cor" e as outras 400 viravam acusação.
    Símbolo que não está no espelho é 'novo'."""
    with open(caminho, 'rb') as f:
        bruto = f.read()
    dx, reverso = _le_casa(raiz, caminho, True, bruto)
    ds, _r = _le_casa(raiz, caminho, False, bruto)
    esp_cam = os.path.join(raiz, ESPELHO_CASA)
    if not os.path.isfile(esp_cam):
        return [], 'Libs/schlib.js não existe'
    _texto, esp = _le_espelho_casa(esp_cam)
    fp_sem = {s['name']: fp_parts(s['parts']) for s in ds['symbols']}
    itens = []
    for s in dx['symbols']:
        nome = s['name']
        e = esp.get(nome)
        item = OrderedDict([('acervo', 'altium'), ('name', nome)])
        if reverso.get(nome):
            item['nomeAltium'] = reverso[nome]
        if e is None:
            item['mudou'] = ['novo']
            itens.append(item)
            continue
        mud = []
        fpe = fp_parts(e.get('parts') or [])
        if fpe != fp_parts(s['parts']) and fpe != fp_sem.get(nome):
            mud.append('geometria')
        if (e.get('description') or '') != (s.get('description') or ''):
            mud.append('descricao')
        if _fps_modelos(e) != _fps_modelos(s):
            mud.append('footprints')
        sabe_cor = any(('color' in g or 'fill' in g) for p in e.get('parts') or [] for g in p.get('graphics') or [])
        if 'geometria' not in mud and sabe_cor:
            fe, fs = _flags(e), _flags(s)
            if [len(x) for x in fe] == [len(x) for x in fs] and fe != fs:
                mud.append('flags')
            ce, cs = _cores(e), _cores(s)
            if [len(x) for x in ce] == [len(x) for x in cs] and ce != cs:
                mud.append('cores')
        if mud:
            item['mudou'] = mud
            itens.append(item)
    return itens, None


def compara_almox(raiz, ledger, fam, caminho, idx):
    """componentes de uma lib do almoxarifado cuja geometria não é a do gerador nem a de
    um protegido igual"""
    itens = []
    chave = chave_arquivo(raiz, caminho)
    for comp, parts in le_familia(caminho).items():
        sim = idx.get((fam, comp))
        if not sim:
            continue
        fp = fp_parts(parts)
        esperado = ledger['gerado'].get(sim[0])
        prot = _prot(ledger, fam, comp)
        if prot and not prot.get('orfao'):
            if fp == prot.get('fp'):
                continue
            estado = 'gerador' if fp == esperado else 'editado'
        else:
            if esperado is None or fp == esperado:
                continue
            estado = 'editado'
        itens.append(OrderedDict([('acervo', 'almox'), ('familia', fam), ('componente', comp),
                                  ('simbolo', sim[0]), ('arquivo', chave), ('mudou', ['geometria']),
                                  ('estado', estado), ('protegido', bool(prot and not prot.get('orfao')))]))
    return itens


def _adota_gerado(raiz, ledger, fam, caminho, idx):
    """arquivo nunca visto: o que está nele é o que o gerador fez — `gerado` dos símbolos
    que ainda não têm entrada nasce daqui, sem proteger nada"""
    for comp, parts in le_familia(caminho).items():
        sim = idx.get((fam, comp))
        if sim and sim[0] not in ledger['gerado'] and not _prot(ledger, fam, comp):
            ledger['gerado'][sim[0]] = fp_parts(parts)


def detecta(raiz, deep=False, adotar=True, log=None):
    """o que mudou nos arquivos do Altium desde o ledger. Sem `deep`, só mtime/size (barato);
    com `deep`, lê os arquivos que mudaram e lista os itens — e um arquivo que mudou sem
    diferença nenhuma é absorvido (mtime registrado) para o aviso sumir. Arquivo nunca
    visto é adotado (mtime e `gerado` registrados) e não conta como mudança."""
    log = log or (lambda *a: None)
    with _lock:
        ledger = carrega_ledger(raiz)
        existia = os.path.isfile(caminho_ledger(raiz))
        casa, procedencia = LP.resolve_schlib(raiz)
        # A cópia publicada não é vigiada — ver `do_hub`: o `git archive` do deploy carimba
        # nela a data do commit, e ela "mudaria no Altium" a cada deploy, abrindo o modal
        # de aplicar sozinho no hub do servidor.
        #
        # Mas quando o share da bancada cai (SEM_VIVA), vigiar o caminho CRU da lib viva:
        # ele aparece com `existe:false`, que é o sinal de "não alcancei a lib da casa" —
        # e é justamente quando ele faz falta. Omitir a linha faria a lib sumir da aba
        # Biblioteca em silêncio, no momento em que se quer saber dela.
        if procedencia == LP.SEM_VIVA:
            casa = LP.viva(raiz)
        lista = ([('altium', None, casa)] if casa and do_hub(raiz, casa) else []) \
            + [('almox', fam, cam) for fam, cam in arquivos_almox(raiz)]
        arquivos, itens, absorvidos = [], [], []
        ledger_mudou = False
        idx = None
        for acervo, fam, cam in lista:
            m, conhecido, st = mudou(ledger, raiz, cam)
            reg = OrderedDict([('arquivo', chave_arquivo(raiz, cam)), ('caminho', cam), ('acervo', acervo),
                               ('familia', fam), ('existe', st is not None), ('conhecido', conhecido),
                               ('mudou', m), ('mtime', st['mtime'] if st else 0), ('size', st['size'] if st else 0),
                               ('quando', _quando(st))])
            if st is not None and not conhecido and adotar:
                if acervo == 'almox':
                    if idx is None:
                        idx = indice_almox(carrega_espelhos_almox(raiz))
                    _adota_gerado(raiz, ledger, fam, cam, idx)
                registra_arquivo(raiz, cam, ledger, gravar=False)
                reg['adotado'] = True
                ledger_mudou = True
                log('adotado: %s' % reg['arquivo'])
            arquivos.append(reg)
        if deep:
            for reg in arquivos:
                if not reg['mudou']:
                    continue
                if reg['acervo'] == 'altium':
                    its, erro = compara_casa(raiz, reg['caminho'])
                    if erro:
                        reg['erro'] = erro
                        continue
                else:
                    if idx is None:
                        idx = indice_almox(carrega_espelhos_almox(raiz))
                    its = compara_almox(raiz, ledger, reg['familia'], reg['caminho'], idx)
                if its:
                    itens.extend(its)
                    reg['itens'] = len(its)
                else:
                    registra_arquivo(raiz, reg['caminho'], ledger, gravar=False)
                    reg['mudou'] = False
                    reg['absorvido'] = True
                    absorvidos.append(reg['arquivo'])
                    ledger_mudou = True
        if ledger_mudou or not existia:
            grava_ledger(raiz, ledger)
        return OrderedDict([
            ('pendente', any(r['mudou'] for r in arquivos)), ('deep', deep),
            ('arquivos', arquivos), ('itens', itens), ('absorvidos', absorvidos),
            ('ledger', OrderedDict([('existe', True), ('atualizado', ledger.get('atualizado', '')),
                                    ('arquivos', len(ledger['arquivos'])), ('gerado', len(ledger['gerado'])),
                                    ('protegidos', sum(len(c) for c in ledger['protegidos'].values()))]))])


# ─── aplicar no hub o que veio do Altium ─────────────────────────────────────
def troca_linha_casa(caminho, sym):
    """a linha do símbolo no Libs/schlib.js passa a ser `sym` (como o leitor o leu); símbolo
    que não está lá entra no fim; `generated` e `stats.symbols` acompanham; nenhum outro
    byte muda. -> 'trocado' | 'novo'"""
    with open(caminho, 'rb') as f:
        linhas = f.read().decode('latin-1').splitlines(True)
    prefixo = '{"name":' + L._js(sym.get('name', '')) + ','
    novo = L.simbolo_json(sym)
    alvo = ultimo = None
    for i, ln in enumerate(linhas):
        corpo = ln[1:] if ln.startswith(',') else ln
        if corpo.startswith('{"name":'):
            ultimo = i
            if alvo is None and corpo.startswith(prefixo):
                alvo = i
    fim = '\r\n' if any(ln.endswith('\r\n') for ln in linhas[:8]) else '\n'
    if alvo is not None:
        ln = linhas[alvo]
        virgula = ln.startswith(',')
        linhas[alvo] = (',' if virgula else '') + novo + ln[len(ln.rstrip('\r\n')):]
        acao = 'trocado'
    else:
        if ultimo is not None:
            linhas.insert(ultimo + 1, ',' + novo + fim)
        else:
            k = next((i for i, ln in enumerate(linhas) if ln.startswith('"symbols":[')), None)
            if k is None:
                raise ValueError('%s: não achei "symbols":[' % caminho)
            linhas.insert(k + 1, novo + fim)
        acao = 'novo'
        n = sum(1 for ln in linhas if (ln[1:] if ln.startswith(',') else ln).startswith('{"name":'))
        for i, ln in enumerate(linhas):
            if ln.startswith('"stats":{"symbols":'):
                linhas[i] = re.sub(r'^"stats":\{"symbols":\d+', '"stats":{"symbols":%d' % n, ln)
    for i in range(min(len(linhas), 8)):
        if linhas[i].startswith('"generated":'):
            linhas[i] = '"generated":' + L._js(L.agora()) + ',' + linhas[i][len(linhas[i].rstrip('\r\n')):]
            break
    tmp = caminho + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(''.join(linhas).encode('latin-1'))
    os.replace(tmp, caminho)
    return acao


def aplica(raiz, itens, log=print):
    """aplica no hub o que veio do Altium. Casa: a linha do símbolo no Libs/schlib.js vira o
    que o leitor lê da SchLib (nome do espelho pelo rename-map; 'novo' entra no fim).
    Almoxarifado: o componente vira protegido `origem: altium` — ou, se a geometria dele
    voltou à do gerador, perde a proteção — e o espelho da família anda junto. Depois, o
    ledger `arquivos` dos arquivos envolvidos. -> {'aplicados', 'itens'}"""
    with _lock:
        ledger = carrega_ledger(raiz)
        resultados, n = [], 0
        casa = [i for i in itens if isinstance(i, dict) and i.get('acervo') == 'altium']
        almox = [i for i in itens if isinstance(i, dict) and i.get('acervo') == 'almox']
        if casa:
            cam = schlib_casa(raiz)
            esp_cam = os.path.join(raiz, ESPELHO_CASA)
            try:
                if not os.path.isfile(esp_cam):
                    raise FileNotFoundError('Libs/schlib.js não existe neste workspace')
                dados, reverso = _le_casa(raiz, cam)
            except Exception as e:                          # noqa: BLE001
                for i in casa:
                    resultados.append(OrderedDict(i, ok=False, erro='%s' % e))
            else:
                por_nome = OrderedDict((s['name'], s) for s in dados['symbols'])
                direto = {antigo: novo for novo, antigo in reverso.items()}
                for i in casa:
                    nome = i.get('name') or ''
                    s = por_nome.get(nome) or por_nome.get(direto.get(nome, ''))
                    if s is None:
                        resultados.append(OrderedDict(i, ok=False, erro='"%s" não está na SchLib da casa' % nome))
                        continue
                    try:
                        acao = troca_linha_casa(esp_cam, s)
                    except (OSError, ValueError) as e:
                        resultados.append(OrderedDict(i, ok=False, erro='%s' % e))
                        continue
                    resultados.append(OrderedDict(i, ok=True, acao=acao, name=s['name']))
                    n += 1
                    log('casa: %s %s no espelho' % (s['name'], acao))
                if n:
                    registra_arquivo(raiz, cam, ledger, gravar=False)
        if almox:
            espelhos = carrega_espelhos_almox(raiz)
            idx = indice_almox(espelhos)
            cache, subst, tocados = {}, {}, set()
            for i in almox:
                fam, comp = i.get('familia') or '', i.get('componente') or ''
                cam, parts = _acha_componente(raiz, fam, comp, cache)
                if parts is None:
                    resultados.append(OrderedDict(i, ok=False, erro='"%s / %s" não está em Libs/Almox' % (fam, comp)))
                    continue
                sim = idx.get((fam, comp))
                if not sim:
                    resultados.append(OrderedDict(i, ok=False, erro='"%s / %s" não está no espelho do almoxarifado' % (fam, comp)))
                    continue
                fp = fp_parts(parts)
                esperado = ledger['gerado'].get(sim[0])
                if esperado is not None and fp == esperado:
                    _tira_prot(ledger, fam, comp)
                    subst[sim[0]] = parts
                    acao = 'liberado'
                else:
                    _poe_prot(ledger, fam, comp, parts, i.get('origem') if i.get('origem') in ('altium', 'hub') else 'altium', sim[0])
                    acao = 'protegido'
                tocados.add(cam)
                resultados.append(OrderedDict(i, ok=True, acao=acao, simbolo=sim[0]))
                n += 1
                log('almoxarifado: %s / %s %s' % (fam, comp, acao))
            if tocados:
                atualiza_espelhos(raiz, ledger, log, espelhos, subst, geometria=True)
                for cam in tocados:
                    registra_arquivo(raiz, cam, ledger, gravar=False)
        grava_ledger(raiz, ledger)
        return OrderedDict([('aplicados', n), ('itens', resultados)])


# ─── liberar / proteger ──────────────────────────────────────────────────────
def _fam_comp(spec):
    if '/' not in spec:
        raise ValueError('use "FAMILIA/COMPONENTE": %r' % spec)
    fam, comp = spec.split('/', 1)
    return fam.strip(), comp.strip()


def libera(raiz, fam, comp, log=print):
    """tira a proteção: o gerador vence na próxima sincronização"""
    with _lock:
        ledger = carrega_ledger(raiz)
        ok = _tira_prot(ledger, fam, comp)
        if ok:
            atualiza_espelhos(raiz, ledger, log, geometria=True)
            grava_ledger(raiz, ledger)
            log('liberado: %s / %s (o gerador vence na próxima sincronização)' % (fam, comp))
        else:
            log('não estava protegido: %s / %s' % (fam, comp))
        return ok


def protege(raiz, fam, comp, origem='hub', log=print):
    """força a proteção com a geometria que o componente tem hoje na .SchLib"""
    with _lock:
        ledger = carrega_ledger(raiz)
        cam, parts = _acha_componente(raiz, fam, comp, {})
        if parts is None:
            log('não achei "%s / %s" em Libs/Almox' % (fam, comp))
            return False
        espelhos = carrega_espelhos_almox(raiz)
        sim = indice_almox(espelhos).get((fam, comp))
        if not sim:
            log('"%s / %s" não está no espelho do almoxarifado' % (fam, comp))
            return False
        _poe_prot(ledger, fam, comp, parts, origem, sim[0])
        atualiza_espelhos(raiz, ledger, log, espelhos, geometria=True)
        grava_ledger(raiz, ledger)
        log('protegido (%s): %s / %s' % (origem, fam, comp))
        return True


# ─── status ──────────────────────────────────────────────────────────────────
def status(raiz, deep=False, log=print):
    r = detecta(raiz, deep=deep, log=log)
    ledger = carrega_ledger(raiz)
    log('ledger: %s (atualizado %s) — %d arquivo(s), %d símbolo(s) gerado(s), %d protegido(s)' % (
        LEDGER.replace('\\', '/'), ledger.get('atualizado') or '—', len(ledger['arquivos']),
        len(ledger['gerado']), r['ledger']['protegidos']))
    mud = [a for a in r['arquivos'] if a['mudou']]
    fora = [a for a in r['arquivos'] if not a['existe']]
    if mud:
        log('mudou no Altium desde o ledger (%d):' % len(mud))
        for a in mud:
            log('  [%s] %s  (%s, %d bytes%s)' % (a['acervo'], a['arquivo'], a['quando'], a['size'],
                                                 ', %d item(ns)' % a['itens'] if a.get('itens') else ''))
    else:
        log('nada mudou no Altium desde o ledger%s' % (' (deep: nenhum item)' if deep else ''))
    if r['absorvidos']:
        log('absorvido(s) sem diferença: %s' % ', '.join(r['absorvidos']))
    for a in fora:
        log('  fora de alcance: %s' % a['arquivo'])
    if r['itens']:
        log('itens (%d):' % len(r['itens']))
        for i in r['itens']:
            if i['acervo'] == 'altium':
                log('  [altium] %s: %s' % (i['name'], ', '.join(i['mudou'])))
            else:
                log('  [almox]  %s / %s (%s): %s' % (i['familia'], i['componente'], i['estado'], ', '.join(i['mudou'])))
    prots = lista_protegidos(ledger)
    if prots:
        log('protegidos (%d):' % len(prots))
        for p in prots:
            log('  %s / %s  %s  desde %s  fp %s%s' % (p['familia'], p['componente'], p['origem'], p['desde'],
                                                       p['fp'][:8], '  (órfão)' if p['orfao'] else ''))
    else:
        log('protegidos: nenhum')
    return r


# ─── CLI ─────────────────────────────────────────────────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser(description='guardião da sincronização das bibliotecas do almoxarifado')
    ap.add_argument('--pull', action='store_true', help='puxa o Odoo antes de gerar (repassado ao almox2lib)')
    ap.add_argument('--full', action='store_true', help='com --pull, o catálogo inteiro (repassado)')
    ap.add_argument('--podar', action='store_true', help='renumera as parts do zero (repassado)')
    ap.add_argument('--sem-schlib', action='store_true', help='só o espelho do hub (repassado)')
    ap.add_argument('--status', action='store_true', help='o que está protegido e o que mudou no Altium desde o ledger')
    ap.add_argument('--deep', action='store_true', help='com --status, lê os arquivos que mudaram e lista os itens')
    ap.add_argument('--liberar', metavar='FAMILIA/COMPONENTE', action='append', default=[])
    ap.add_argument('--proteger', metavar='FAMILIA/COMPONENTE', action='append', default=[])
    ap.add_argument('--sem-gerador', action='store_true', help='não roda o almox2lib: só antes/depois (testes; repor protegidos)')
    ap.add_argument('--raiz', default=RAIZ, help='workspace (default: a raiz do repositório)')
    a = ap.parse_args(argv)
    raiz = a.raiz
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')     # o SSE lê UTF-8

    if a.status:
        r = status(raiz, deep=a.deep)
        return 0 if not r['pendente'] else 3
    if a.liberar or a.proteger:
        ok = True
        for spec in a.liberar:
            fam, comp = _fam_comp(spec)
            ok = libera(raiz, fam, comp) and ok
        for spec in a.proteger:
            fam, comp = _fam_comp(spec)
            ok = protege(raiz, fam, comp) and ok
        return 0 if ok else 1
    repasse = [f for f, on in (('--pull', a.pull), ('--full', a.full), ('--podar', a.podar),
                               ('--sem-schlib', a.sem_schlib)) if on]
    if _norm(raiz) != _norm(RAIZ) and not a.sem_gerador:
        print('ERRO: --raiz fora do repositório só com --sem-gerador (o almox2lib escreve na raiz dele)')
        return 1
    resumo = sincroniza(repasse, print, raiz, gerador_nenhum if a.sem_gerador else None)
    return 0 if resumo['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
