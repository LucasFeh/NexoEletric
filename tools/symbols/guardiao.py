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
    Altium -> hub      NÃO EXISTE. Em 2026-09-14 virou alerta; em 2026-09-15 o alerta
                       também saiu, a pedido do usuário: "as modificações nascem e saem do
                       hub para o Altium, mas nunca o contrário, portanto não precisa mais
                       identificar nenhuma modificação vinda do Altium". Saíram a apuração
                       (`antes`), a detecção (`detecta`) e as rotas `/altium-changes` e
                       `/altium-apply`. O que estiver diferente na `.SchLib` é sobrescrito
                       pela regeração, em silêncio e de propósito.
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
                        ('gerado', OrderedDict()), ('protegidos', OrderedDict()),
                        ('footprints', OrderedDict())])


# ─── o footprint escolhido a mao, por COMPONENTE ──────────────────────────────
# Secao propria, e nao um campo dentro de `protegidos`: protegido quer dizer "tem desenho
# guardado", e escolher um footprint nao obriga ninguem a desenhar nada. Sao duas decisoes
# independentes sobre a mesma peca, e juntar as duas faria uma exigir a outra.
#
# POR QUE PRECISA EXISTIR: o footprint de um valor do almoxarifado e CALCULADO pelo gerador
# a cada rodada, a partir dos encapsulamentos que vem do Odoo (almox2lib >> monta_simbolo).
# Sem um lugar duravel, a escolha da tela sobreviveria ate o proximo sincronismo e sumiria
# em silencio -- exatamente o que o desenho ja resolveu com `protegidos`. A chave e a mesma
# dali, (familia, componente), pelo mesmo motivo: e a peca que recebe, nao a categoria.


def _fps_manuais(ledger):
    d = ledger.get('footprints')
    if not isinstance(d, dict):
        d = ledger['footprints'] = OrderedDict()
    return d


def poe_footprint(ledger, fam, comp, footprint):
    """grava (ou apaga, com footprint vazio) a escolha manual de UM componente"""
    d = _fps_manuais(ledger)
    fam_d = d.setdefault(fam, OrderedDict())
    if footprint:
        fam_d[comp] = OrderedDict([('nome', footprint), ('desde', agora())])
    else:
        fam_d.pop(comp, None)
    if not fam_d:
        d.pop(fam, None)
    return bool(footprint)


def footprints_manuais(ledger):
    """{(familia, componente): nome} — o que o gerador consulta para nao sobrescrever"""
    fora = {}
    for fam, comps in (_fps_manuais(ledger) or {}).items():
        for comp, d in (comps or {}).items():
            nome = (d or {}).get('nome') if isinstance(d, dict) else d
            if nome:
                fora[(fam, comp)] = nome
    return fora


def carrega_ledger(raiz):
    """Libs/lib-ledger.json -> dict; ausente = vazio (é assim que ele nasce)"""
    p = caminho_ledger(raiz)
    if not os.path.isfile(p):
        return ledger_vazio()
    with open(p, encoding='utf-8') as f:
        d = json.load(f, object_pairs_hook=OrderedDict)
    if not isinstance(d, dict) or d.get('format') != FORMATO:
        raise ValueError('%s não é um ledger %s' % (p, FORMATO))
    for k in ('arquivos', 'gerado', 'protegidos', 'footprints'):
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
    fora.append('},')
    # `footprints`: a escolha manual de footprint por componente. ESTA FUNCAO E A LISTA
    # FECHADA do que vai a disco -- uma secao que o dict tenha e ela nao escreva some em
    # SILENCIO, que foi o que aconteceu na primeira versao desta secao: a rota gravava, o
    # arquivo saia sem ela e ninguem reclamava. Secao nova aqui, sempre.
    fps = sorted((d.get('footprints') or {}).items())
    fora.append('"footprints":{')
    for i, (fam, comps) in enumerate(fps):
        fora.append(' %s:{' % _j(fam))
        cs = sorted((comps or {}).items())
        for k, (c, v) in enumerate(cs):
            fora.append('  %s:%s%s' % (_j(c), _j(v), ',' if k < len(cs) - 1 else ''))
        fora.append(' }%s' % (',' if i < len(fps) - 1 else ''))
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
    # SEGUIR O LINK ANTES DE TROCAR. No servidor o deploy monta cada release com
    # `Libs/<arquivo> -> shared/<arquivo>` para o estado sobreviver ao push (ver
    # tools/deploy/deploy.sh >> COMPARTILHADOS_ARQ). Mas `os.replace` sobre um symlink
    # substitui O LINK, nao o arquivo apontado: a release passava a ter copia propria, o
    # shared/ congelava, e o deploy seguinte devolvia o estado do dia em que o link
    # quebrou. Foi assim que o ledger do servidor ficou parado em 08/09 enquanto o
    # trabalho continuava numa copia dentro da release — e cada push "voltava tudo".
    # realpath resolve o link quando ha um e nao faz nada quando nao ha (a bancada).
    os.replace(tmp, os.path.realpath(p))


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
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(caminho))
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

    Havia aqui um `novos=()` que marcava `novo: True` no que a apuração acabara de proteger
    a partir do Altium. Nada mais nasce protegido numa sincronização: proteção só entra pelo
    hub (`/save-almox`, `--proteger`). O campo ficou, sempre False, porque o espelho e a tela
    já o leem — tirá-lo mudaria o formato do resumo sem ganho."""
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
                # UMA BIBLIOTECA RUIM NAO PODE DERRUBAR A SINCRONIZACAO INTEIRA.
                # Em 2026-09-16 o indice de uma familia passou do teto de 65.535 bytes do
                # Altium e o ValueError do schlib_bin subiu ate o topo: o guardiao terminou
                # com codigo 1, e as outras 31 bibliotecas, o espelho e o resumo ficaram por
                # fazer. A causa daquele caso foi consertada, mas o formato tem um teto de
                # verdade e um dia outra familia vai encostar nele. Aqui a falha fica do
                # tamanho dela: esta familia nao recebe os desenhos protegidos, o log diz
                # qual e o que fazer, e o resto da rodada segue.
                try:
                    P.grava(lib, cam, backup=False)
                except ValueError as e:
                    log('   ATENCAO: nao gravei %s: %s' % (os.path.basename(cam), e))
                    log('            os desenhos protegidos desta familia NAO foram repostos.')
                    log('            o teto e do formato do Altium; a saida e quebrar a familia'
                        ' em mais pedacos (schlib_escritor >> RESERVA_CAB).')
                    registra_arquivo(raiz, cam, ledger, gravar=False)
                    vistos.add(cam)
                    continue
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
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(cam))


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
        grava_ledger(raiz, ledger)          # o `carrega` normaliza; grava o formato de hoje
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
            ('repostos', repostos), ('orfaos', orfaos),
            ('espelhos', tocados), ('recicladoDe', recicl),
            ('publicada', os.path.relpath(pub['alvo'], raiz).replace('\\', '/')),
            ('publicou', pub['publicou']), ('publicacao', pub['motivo'] or 'publicada agora'),
            ('segundos', round(time.time() - t0, 1))])
        escreve_resumo(raiz, resumo)
        log('guardião: %d família(s), %d protegido(s) (%d reposto(s), %d órfão(s)), %d símbolo(s) do espelho%s — %.1f s' % (
            len(familias), len(resumo['protegidos']), len(repostos), len(orfaos), len(tocados),
            '' if not erro else '; ERRO: ' + erro, resumo['segundos']))
        return resumo


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


# ─── CLI ─────────────────────────────────────────────────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser(description='guardião da sincronização das bibliotecas do almoxarifado')
    ap.add_argument('--pull', action='store_true', help='puxa o Odoo antes de gerar (repassado ao almox2lib)')
    ap.add_argument('--full', action='store_true', help='com --pull, o catálogo inteiro (repassado)')
    ap.add_argument('--podar', action='store_true', help='renumera as parts do zero (repassado)')
    ap.add_argument('--sem-schlib', action='store_true', help='só o espelho do hub (repassado)')
    ap.add_argument('--liberar', metavar='FAMILIA/COMPONENTE', action='append', default=[])
    ap.add_argument('--proteger', metavar='FAMILIA/COMPONENTE', action='append', default=[])
    ap.add_argument('--sem-gerador', action='store_true', help='não roda o almox2lib: só antes/depois (testes; repor protegidos)')
    ap.add_argument('--raiz', default=RAIZ, help='workspace (default: a raiz do repositório)')
    a = ap.parse_args(argv)
    raiz = a.raiz
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')     # o SSE lê UTF-8

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
