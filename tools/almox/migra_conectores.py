# -*- coding: utf-8 -*-
"""Leva o livro-razao e o ledger do guardiao para os nomes novos do conector. RODA UMA VEZ.

    python3 tools/almox/migra_conectores.py            # so mostra o plano
    python3 tools/almox/migra_conectores.py --aplicar   # grava

POR QUE PRECISA. Em 2026-09-22 a familia do conector passou a levar o subtipo, e com ela o
NOME DO SIMBOLO: 'CONECTOR 4V' virou 'CONECTOR BLOCO TERMINAL 4V', 'CONECTOR HEADER COM
TRAVA 26V' e outros 114. Tres arquivos sao indexados por esse nome e nenhum deles reclama
quando ele muda:

  Libs/almox-parts.json   o livro-razao (rotulo -> numero de part). `numera_valores` faz
                          `mapa.get(nome)`; nome novo cai em `{prox:1, ids:{}}` EM SILENCIO
                          e os 326 numeros de conector recomecam do 1. O CLAUDE.md chama
                          isso de "perder o livro-razao", e e o unico estado versionado
                          de proposito dentro de Libs/.
  Libs/lib-ledger.json    `gerado` (impressao digital da geometria, por nome de simbolo) e
                          `protegidos`/`footprints` (por familia). Sem `gerado` o guardiao
                          "nao julga" e a rodada seguinte SOBRESCREVE o desenho adotado do
                          Altium — calado, que e o pior jeito de perder trabalho manual.

E POR QUE E SEGURO AGORA. Medido em 2026-09-22: dos 1428 componentes de
Projects/*/schematic.js, 10 apontam para valor do almoxarifado e NENHUM e conector. O que
viaja para o schematic.js e o nome do VALOR (`valores[].altium`), nunca o do simbolo
(schframe.js » cartAdd). Entao o que esta em jogo aqui e o numero de part e o desenho
protegido — nao ha esquema para orfanar. Depois do primeiro conector desenhado a mao, o
custo desta migracao cresce.

COMO O CASAMENTO E FEITO: pelo ID DO PRODUTO NO ODOO, nao pelo rotulo. O rotulo muda para
quem sai dos ESPECIAIS e vai para os BASICOS -- `classifica()` escolhe o rotulo por ramo
(mpn primeiro nos especiais, rotulo primeiro nos basicos) -- e sao justamente os 143 itens
que ganharam pinagem com o extrator novo de vias. Casar por rotulo perderia todos eles.
"""
import argparse
import collections
import io
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
LIBS = os.path.join(RAIZ, 'Libs')
sys.path.insert(0, BASE)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import almox2lib as A                                    # noqa: E402
import conectores as CN                                  # noqa: E402
import familias as F                                     # noqa: E402
from classificar import CSV_ODOO                         # noqa: E402

PARTS = os.path.join(LIBS, 'almox-parts.json')
LEDGER = os.path.join(LIBS, 'lib-ledger.json')


def e_conector(fam):
    return fam in CN.FAMILIAS_CONECTOR or (fam or '').startswith('CONECTOR ')


def le_espelho(caminho):
    if not os.path.exists(caminho):
        return {}
    t = io.open(caminho, encoding='utf-8', errors='replace').read()
    d = json.loads(t[t.index('{'):].rstrip().rstrip(';'))
    return {s['name']: s for s in d.get('symbols') or []}


def chave_do_valor(v):
    """a mesma chave que `numera_valores` usa: a `chave` quando existe, senao o label"""
    return v.get('chave') or v.get('label') or ''


def mapa_antigo(espelhos):
    """{odoo_id: (simbolo, chave)} — de onde cada produto do Odoo vinha."""
    fora = {}
    for esp in espelhos:
        for nome, s in esp.items():
            if not e_conector(s.get('familia', '')):
                continue
            for v in s.get('valores') or []:
                for it in v.get('itens') or []:
                    oid = str(it.get('odoo') or '').strip()
                    if oid:
                        fora[oid] = (nome, chave_do_valor(v))
    return fora


def mapa_novo():
    """{odoo_id: (simbolo, chave)} — para onde cada produto vai agora.

    Refaz o caminho do gerador (analisar -> agrupar -> classifica) em vez de ler o espelho
    novo: assim a migracao pode rodar ANTES da primeira geracao, que e a ordem certa.
    """
    itens = []
    for r in __import__('csv').DictReader(io.open(CSV_ODOO, encoding='utf-8')):
        a = F.analisar(r)
        if a:
            itens.append(a)
    simbolos = A.agrupar(itens)
    fora = {}
    for nome, s in simbolos.items():
        if not e_conector(s.get('familia', '')):
            continue
        for (rot, enc), p in s['parts'].items():
            ch = p.get('chave') or rot
            for it in p['itens']:
                oid = str(it.get('odoo_id') or '').strip()
                if oid:
                    fora[oid] = (nome, ch)
    return fora


def migra_parts(mapa, velho, novo):
    """Move os ids de conector para as chaves novas. Devolve (mapa novo, relatorio)."""
    # (simbolo velho, chave velha) -> id / desde, so do que e conector
    id_de, desde_de = {}, {}
    simbolos_velhos = set()
    for oid, (sv, cv) in velho.items():
        simbolos_velhos.add(sv)
    for sv in simbolos_velhos:
        reg = mapa.get(sv)
        if not isinstance(reg, dict):
            continue
        for ch, vid in (reg.get('ids') or {}).items():
            id_de[(sv, ch)] = vid
        for ch, dt in (reg.get('desde') or {}).items():
            desde_de[(sv, ch)] = dt

    # (simbolo novo, chave nova) -> os ids velhos candidatos, e quantos produtos votaram
    votos = collections.defaultdict(collections.Counter)
    for oid, (sn, cn) in novo.items():
        par = velho.get(oid)
        if not par:
            continue
        vid = id_de.get(par)
        if vid is not None:
            votos[(sn, cn)][vid] += 1

    fora = dict(mapa)
    for sv in simbolos_velhos:
        fora.pop(sv, None)                              # o registro velho sai inteiro

    # Um id so pode viver num simbolo, e um simbolo por SUBTIPO junta o que eram ate 15
    # espacos de numeracao ("BARRA DE PINOS 2V".."10V" viram "CONECTOR BARRA DE PINOS"),
    # todos comecando no 1. A colisao e estrutural, nao um erro: quando dois valores velhos
    # trazem o mesmo numero, o de MENOR id fica (e o mais antigo, e o que mais provavelmente
    # foi referenciado) e o outro tira numero novo do `prox`.
    #
    # A DATA DE ENTRADA NAO DISPUTA. Ela nao e chave de nada — e so o que sustenta a marca
    # de "novo" na aba Biblioteca — entao ela e herdada SEMPRE, inclusive por quem perdeu o
    # numero. Sem isto, 78 conectores que estao na biblioteca desde agosto voltariam a
    # aparecer como recem-chegados so por causa de uma renumeracao interna.
    usados = collections.defaultdict(set)
    conflitos = []
    novos_reg = collections.defaultdict(lambda: {'prox': 1, 'ids': {}, 'desde': {}})
    # {(simbolo novo, chave nova): a data de entrada mais antiga entre os velhos}
    desde_novo = {}
    for oid, (sn, cn) in novo.items():
        par = velho.get(oid)
        if par and par in desde_de:
            atual = desde_novo.get((sn, cn))
            if atual is None or desde_de[par] < atual:
                desde_novo[(sn, cn)] = desde_de[par]

    for (sn, cn), c in sorted(votos.items(), key=lambda x: min(x[1])):
        if (sn, cn) in desde_novo:
            novos_reg[sn]['desde'][cn] = desde_novo[(sn, cn)]
        vid = min(c)                                    # o id mais antigo entre os candidatos
        if vid in usados[sn]:
            conflitos.append((sn, cn, vid))
            continue
        usados[sn].add(vid)
        novos_reg[sn]['ids'][cn] = vid

    # A DATA DE NASCIMENTO DO SIMBOLO tambem e herdada: o simbolo novo carrega o `desdeSym`
    # mais antigo entre os velhos que o alimentam. Deixar o gerador carimbar hoje faria a
    # aba Biblioteca anunciar 116 simbolos "recem-chegados" que na verdade sao os mesmos
    # conectores de sempre com nome novo.
    desde_sym = collections.defaultdict(list)
    for oid, (sn, cn) in novo.items():
        par = velho.get(oid)
        reg_v = mapa.get(par[0]) if par else None
        if isinstance(reg_v, dict) and reg_v.get('desdeSym'):
            desde_sym[sn].append(reg_v['desdeSym'])

    # as chaves novas que ninguem herdou tiram numero do prox, como valor recem-chegado
    for sn, reg in novos_reg.items():
        reg['prox'] = (max(reg['ids'].values()) + 1) if reg['ids'] else 1
        if desde_sym.get(sn):
            reg['desdeSym'] = min(desde_sym[sn])

    for sn, reg in novos_reg.items():
        antigo = fora.get(sn)
        if isinstance(antigo, dict):                    # ja existia (regeracao): funde
            antigo.setdefault('ids', {}).update(reg['ids'])
            antigo.setdefault('desde', {}).update(reg['desde'])
            antigo['prox'] = max(antigo.get('prox', 1),
                                 max(antigo['ids'].values()) + 1 if antigo['ids'] else 1)
        else:
            fora[sn] = reg
    return fora, {'simbolosVelhos': sorted(simbolos_velhos),
                  'simbolosNovos': sorted(novos_reg),
                  'idsMigrados': sum(len(r['ids']) for r in novos_reg.values()),
                  'idsDisponiveis': len(id_de),
                  'conflitos': conflitos}


def migra_ledger(led, velho, novo):
    """Renomeia as chaves do guardiao: `gerado` por simbolo, `protegidos`/`footprints` por
       familia. Sem isso o desenho adotado do Altium e o footprint escolhido a mao viram
       orfaos e a rodada seguinte os desfaz sem dizer nada."""
    sym_ren, fam_ren = {}, {}
    for oid, (sv, cv) in velho.items():
        par = novo.get(oid)
        if par and par[0] != sv:
            sym_ren[sv] = par[0]
    # a familia nova de um simbolo velho sai do proprio nome novo: 'CONECTOR BLOCO
    # TERMINAL 4V' -> 'CONECTOR BLOCO TERMINAL'
    import re as _re
    for sv, sn in sym_ren.items():
        fam_v = _re.sub(r' \d+V(?: \[[^\]]+\])?$|\s*\[PINAGEM A DEFINIR\]$', '', sv)
        fam_n = _re.sub(r' \d+V(?: \[[^\]]+\])?$|\s*\[PINAGEM A DEFINIR\]$', '', sn)
        if fam_v != fam_n:
            fam_ren[fam_v] = fam_n

    mexeu = []
    g = led.get('gerado') or {}
    for sv, sn in sym_ren.items():
        if sv in g and sn not in g:
            g[sn] = g.pop(sv)
            mexeu.append('gerado: %s -> %s' % (sv, sn))
    for bloco in ('protegidos', 'footprints'):
        b = led.get(bloco) or {}
        for fv, fn in fam_ren.items():
            if fv in b and fn not in b:
                b[fn] = b.pop(fv)
                mexeu.append('%s: %s -> %s' % (bloco, fv, fn))
        # o `simbolo` guardado DENTRO de cada protegido tambem e nome de simbolo
        for fam, itens in (b or {}).items():
            for rot, d in (itens or {}).items():
                if isinstance(d, dict) and d.get('simbolo') in sym_ren:
                    d['simbolo'] = sym_ren[d['simbolo']]
                    mexeu.append('%s/%s: simbolo -> %s' % (bloco, fam, d['simbolo']))
    return led, mexeu, sym_ren, fam_ren


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--aplicar', action='store_true', help='grava (sem isto so mostra)')
    ap.add_argument('--espelho-antigo', default=LIBS,
                    help='pasta com os almox-*.js da geracao ANTERIOR (padrao: Libs/)')
    args = ap.parse_args(argv)

    velhos = [le_espelho(os.path.join(args.espelho_antigo, f))
              for f in ('almox-basicos.js', 'almox-especiais.js')]
    velho = mapa_antigo(velhos)
    if not velho:
        print('ERRO: o espelho antigo nao tem conector nenhum em %s' % args.espelho_antigo)
        print('      esta migracao precisa da geracao ANTERIOR (a de nomes sem subtipo).')
        return 2
    novo = mapa_novo()
    print('produtos de conector: %d no espelho antigo, %d no dump de hoje'
          % (len(velho), len(novo)))

    mapa = json.load(io.open(PARTS, encoding='utf-8')) if os.path.exists(PARTS) else {}
    mapa2, rel = migra_parts(mapa, velho, novo)
    print()
    print('livro-razao (Libs/almox-parts.json)')
    print('  simbolos que saem : %d  (%s...)' % (len(rel['simbolosVelhos']),
                                                 ', '.join(rel['simbolosVelhos'][:3])))
    print('  simbolos que entram: %d  (%s...)' % (len(rel['simbolosNovos']),
                                                  ', '.join(rel['simbolosNovos'][:3])))
    print('  ids preservados   : %d de %d' % (rel['idsMigrados'], rel['idsDisponiveis']))
    if rel['conflitos']:
        print('  ids em conflito   : %d (tiram numero novo)' % len(rel['conflitos']))
        for sn, cn, vid in rel['conflitos'][:8]:
            print('      %s / %s (id %d ja usado no simbolo)' % (sn, cn, vid))

    led = json.load(io.open(LEDGER, encoding='utf-8')) if os.path.exists(LEDGER) else {}
    led2, mexeu, sym_ren, fam_ren = migra_ledger(led, velho, novo)
    print()
    print('ledger do guardiao (Libs/lib-ledger.json)')
    print('  renomeacoes de simbolo: %d | de familia: %d' % (len(sym_ren), len(fam_ren)))
    print('  entradas mexidas      : %d' % len(mexeu))
    for m in mexeu[:10]:
        print('      %s' % m)

    if not args.aplicar:
        print()
        print('NADA FOI GRAVADO. Rode de novo com --aplicar quando o plano acima estiver bom.')
        return 0

    with io.open(PARTS, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(mapa2, f, ensure_ascii=False, indent=0, sort_keys=True)
    with io.open(LEDGER, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(led2, f, ensure_ascii=False, indent=1, sort_keys=True)
    print()
    print('gravado. Agora rode o gerador: python3 tools/almox/almox2lib.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
