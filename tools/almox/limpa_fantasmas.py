# -*- coding: utf-8 -*-
"""Apaga da biblioteca os FANTASMAS: valores que o Odoo ja nao manda mais.

    python tools/almox/limpa_fantasmas.py                  # RELATORIO. nao escreve nada
    python tools/almox/limpa_fantasmas.py --apagar         # apaga os seguros
    python tools/almox/limpa_fantasmas.py --familia "DIODO ZENER [PTH]"
    python tools/almox/limpa_fantasmas.py --raiz /srv/altiumhub/current --apagar
    python tools/almox/limpa_fantasmas.py --csv fantasmas.csv

O QUE E UM FANTASMA. A biblioteca foi construida quando o cadastro do Odoo ainda nao tinha
padrao de nome, e por isso alguns itens nasceram DUAS VEZES, com nomes diferentes. Quando o
cadastro foi arrumado, o produto velho saiu do catalogo — mas o valor continuou na
biblioteca, com saldo zero e `fora: true`, porque `almox2lib.py >> numera_valores` repesca
do espelho ANTERIOR todo valor que sumiu do Odoo. E o que sustenta o fantasma: o espelho de
ontem, e so ele.

POR ISSO APAGAR BASTA, e por isso apagar e DEFINITIVO. Tirado do espelho, o fantasma nao
tem de onde voltar: ele nao esta no CSV, entao a geracao seguinte nao o monta, e o repesque
nao o acha. Quem ainda existe no Odoo, ao contrario, e remontado do CSV na proxima
sincronizacao — apagar um item bom por engano se conserta puxando de novo. Essa assimetria e
a mecanica inteira; ver o README, "Apagar um componente da biblioteca".

O QUE ESTA FERRAMENTA NAO FAZ:
  - nao encosta na .SchLib. Elas sao reescritas inteiras a partir do espelho no proximo
    sincronismo, e e la que o componente sai de dentro do Altium;
  - nao mexe em Libs/almox-parts.json. O numero da part do fantasma fica RESERVADO para
    sempre, como ja ficava: ninguem herda o numero de um apagado;
  - nao mexe em Libs/lib-ledger.json. Desenho protegido de um fantasma continua guardado
    (o guardiao o marca orfao); o relatorio diz quais sao, porque protegido de componente
    apagado de vez nunca mais sera reposto e talvez voce queira liberar a mao.

O QUE ELA SEGURA SOZINHA: fantasma EM USO num projeto. O `sym` de um `schematic.js` e
exatamente o `valores[].altium` — apagar deixa aquele componente orfao (quadrado vermelho na
folha). Esses ficam de fora por padrao e saem listados; o certo e trocar o componente no
esquema primeiro (vista Esquema >> trocar, que troca em bloco) e rodar de novo. Para incluir
mesmo assim, `--em-uso-tambem`, que existe para nao ser uma parede quando a decisao for sua.

NAO USE O HUB ENQUANTO ISTO RODA. O espelho e reescrito inteiro, e o hub tem o lock dele
noutro processo: uma gravacao do hub no meio perde-se ou perde a nossa. A escrita segue o
symlink (no servidor `Libs/almox-*.js -> shared/…`) e e atomica, entao o pior caso e uma
atualizacao perdida, nunca um arquivo pela metade.
"""
import argparse
import io
import json
import os
import shutil
import sys
from collections import OrderedDict
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))


def _raiz_do_argv(padrao):
    """`--raiz` lido ANTES dos imports, para o codigo sair do MESMO workspace que o dado.

    Sem isto, uma copia deste arquivo rodando de outro lugar (/tmp, um checkout de teste)
    importaria o almox2lib de perto de si e leria o espelho de longe — versoes diferentes
    do gerador decidindo o que e fantasma. Aqui o `--raiz` manda nos dois.
    """
    for i, a in enumerate(sys.argv[1:], 1):
        v = a[7:] if a.startswith('--raiz=') else (
            sys.argv[i + 1] if a == '--raiz' and i + 1 < len(sys.argv) else None)
        if v and os.path.isfile(os.path.join(v, 'tools', 'almox', 'almox2lib.py')):
            return os.path.abspath(v)
    return padrao


RAIZ = _raiz_do_argv(RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import almox2lib as A                                    # noqa: E402
import guardiao as G                                     # noqa: E402


def e_fantasma(v):
    """`fora: true` e a marca que o gerador poe em quem saiu do Odoo (numera_valores)"""
    return bool(v.get('fora'))


def usos_de(raiz, valor, altium):
    """Onde este valor foi colocado: [{'projeto', 'refs'}].

    Reusa o `_usos_do_valor` do symserver — a mesma funcao que a previa do hub usa, com as
    tres marcas (OdooId, ValorId corroborado, sym/comment). Duplicar aqui essa logica era o
    caminho certo para as duas versoes divergirem e esta dizer "nao esta em uso" sobre um
    componente que esta.

    O symserver importa flask. Onde ele nao existir (um python enxuto no host), a varredura
    cai para o `sym`, que para um FANTASMA e a marca que importa: o params do fantasma sai
    com OdooId vazio (numera_valores o reescreve), entao nem o symserver teria mais que isso.
    """
    try:
        import symserver as S
        S.ROOT = raiz
        return S._usos_do_valor(valor, altium)
    except Exception:                                        # noqa: BLE001
        return _usos_por_sym(raiz, altium)


def _usos_por_sym(raiz, altium):
    """o degrade: `sym` igual ao nome do valor, varrendo Projects/*/schematic.js"""
    fora = []
    base = os.path.join(raiz, 'Projects')
    try:
        nomes = sorted(os.listdir(base))
    except OSError:
        return fora
    alvo = '"sym":"%s"' % altium
    for nome in nomes:
        cam = os.path.join(base, nome, 'schematic.js')
        if not os.path.isfile(cam):
            continue
        refs = []
        try:
            for linha in io.open(cam, encoding='utf-8', errors='replace'):
                if alvo not in linha:
                    continue
                i = linha.find('"ref":"')
                if i < 0:
                    continue
                ref = linha[i + 7:linha.find('"', i + 7)]
                if ref and ref not in refs:
                    refs.append(ref)
        except OSError:
            continue
        if refs:
            fora.append({'projeto': nome, 'refs': refs})
    return fora


def protegidos_de(raiz):
    """{(familia, altium): origem} — o que tem desenho guardado no ledger, e de onde veio.

    A `origem` e o que separa esforco humano de reaproveitamento: `hub` e desenho feito a
    mao no editor de simbolos; `altium` e geometria herdada da biblioteca da casa, que se
    refaz sozinha. Medido no servidor em 2026-09-17: 1359 `altium` contra 38 `hub`.

    Apagar um fantasma NAO destroi o desenho — desde 2026-09-17 a exclusao nao encosta no
    ledger, entao a protecao fica la, orfa. O que se perde e a chance de alguem rever esses
    38 antes de eles virarem orfaos para sempre; por isso eles saem nomeados no relatorio.
    """
    try:
        led = G.carrega_ledger(raiz)
    except Exception:                                        # noqa: BLE001
        return {}
    fora = {}
    for fam, comps in (led.get('protegidos') or {}).items():
        for comp, d in (comps or {}).items():
            fora[(fam, comp)] = (d or {}).get('origem') or '(sem origem)'
    return fora


def levanta(raiz, familia=None):
    """[(caminho, varname, esp, simbolo, indice, valor)] de todo fantasma dos espelhos"""
    achados = []
    for cam, var, esp in G.carrega_espelhos_almox(raiz):
        for sim in (esp.get('symbols') or []):
            if familia and sim.get('name') != familia:
                continue
            for j, v in enumerate(sim.get('valores') or []):
                if e_fantasma(v):
                    achados.append((cam, var, esp, sim, j, v))
    return achados


def relatorio(raiz, achados, prot, verbose):
    """imprime o quadro e devolve (seguros, em_uso) — cada um [(sim, valor, usos)]"""
    seguros, em_uso = [], []
    for _cam, _var, _esp, sim, _j, v in achados:
        u = usos_de(raiz, v, v.get('altium') or '')
        (em_uso if u else seguros).append((sim, v, u))

    porsim = {}
    for sim, v, _u in seguros:
        porsim.setdefault(sim['name'], 0)
        porsim[sim['name']] += 1

    print('FANTASMAS (valores com `fora: true` — o Odoo nao os manda mais)')
    print('  total ................. %d' % len(achados))
    print('  seguros para apagar ... %d' % len(seguros))
    print('  EM USO num projeto .... %d  (ficam de fora; --em-uso-tambem inclui)' % len(em_uso))
    com_desenho = [(s, v, prot[(s.get('familia') or s['name'], v.get('altium'))])
                   for s, v, _ in seguros
                   if (s.get('familia') or s['name'], v.get('altium')) in prot]
    amao = [(s, v) for s, v, o in com_desenho if o == 'hub']
    print('  com desenho protegido . %d  (fica no ledger, orfao — apagar NAO o destroi)'
          % len(com_desenho))
    print('    feito a mao no hub .. %d  <- so estes valem uma olhada antes' % len(amao))
    print('    herdado do Altium ... %d  (refaz-se sozinho; nao ha o que rever)'
          % (len(com_desenho) - len(amao)))
    print()

    if porsim:
        print('por simbolo (os 15 maiores):')
        for nome, n in sorted(porsim.items(), key=lambda kv: -kv[1])[:15]:
            print('  %5d  %s' % (n, nome))
        if len(porsim) > 15:
            print('  ... e mais %d simbolo(s)' % (len(porsim) - 15))
        print()

    if em_uso:
        print('EM USO — apagar deixa o componente orfao na folha. Troque no esquema antes:')
        for sim, v, u in em_uso[:30]:
            onde = ', '.join('%s (%s)' % (x['projeto'], ', '.join(x['refs'])) for x in u)
            print('  %-30s %-40s %s' % (sim['name'][:30], (v.get('altium') or '')[:40], onde))
        if len(em_uso) > 30:
            print('  ... e mais %d' % (len(em_uso) - 30))
        print()

    if amao:
        print('DESENHO FEITO A MAO NO HUB — alguem desenhou isto, e o produto saiu do Odoo.')
        print('O desenho continua guardado no ledger depois de apagar; se nao quiser nem o')
        print('registro, `guardiao.py --liberar` depois:')
        for s, v in amao:
            print('  %-28s %-40s  --liberar "%s/%s"'
                  % (s['name'][:28], (v.get('altium') or '')[:40],
                     s.get('familia') or s['name'], v.get('altium')))
        print()

    if verbose:
        print('lista completa dos seguros:')
        for sim, v, _u in seguros:
            print('  %-30s %-44s id=%s' % (sim['name'][:30], (v.get('altium') or '')[:44],
                                           v.get('id')))
        print()
    return seguros, em_uso


def grava_csv(caminho, seguros, em_uso):
    import csv
    with io.open(caminho, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['situacao', 'simbolo', 'familia', 'altium', 'label', 'id', 'usos'])
        for rot, lst in (('seguro', seguros), ('em uso', em_uso)):
            for sim, v, u in lst:
                w.writerow([rot, sim['name'], sim.get('familia') or '', v.get('altium'),
                            v.get('label'), v.get('id'),
                            '; '.join('%s: %s' % (x['projeto'], ', '.join(x['refs'])) for x in u)])
    print('lista gravada em %s' % caminho)


def faz_backup(raiz, caminhos):
    """copia dos espelhos ANTES de mexer — apagar fantasma e definitivo"""
    carimbo = datetime.now().strftime('%Y%m%d-%H%M%S')
    d = os.path.join(raiz, 'Libs', '.backup-fantasmas-%s' % carimbo)
    os.makedirs(d, exist_ok=True)
    for cam in caminhos:
        # copia o CONTEUDO (o do symlink, no servidor), nao o link
        shutil.copyfile(os.path.realpath(cam), os.path.join(d, os.path.basename(cam)))
    print('backup dos espelhos em %s' % d)
    return d


def registra(raiz, apagados):
    """as linhas no registro de apagados, o mesmo arquivo que a rota do hub escreve"""
    try:
        reg = A.carrega_excluidos(raiz)
    except (OSError, ValueError) as e:
        print('AVISO: nao li o registro (%s) — os valores foram apagados mesmo assim' % e)
        return
    quando = datetime.now().strftime('%Y-%m-%d %H:%M')
    tinha = {(it.get('simbolo'), it.get('altium')) for it in reg['itens']}
    for sim, v in apagados:
        ch = (sim['name'], v.get('altium'))
        if ch in tinha:
            continue
        reg['itens'].append(OrderedDict([
            ('simbolo', sim['name']), ('familia', sim.get('familia') or sim['name']),
            ('altium', v.get('altium')), ('label', v.get('label') or ''),
            ('quando', quando), ('motivo', 'fantasma (fora do Odoo), limpeza em lote')]))
    try:
        A.grava_excluidos(raiz, reg)
        print('registro atualizado: %s' % A.EXCLUIDOS)
    except OSError as e:
        print('AVISO: nao gravei o registro (%s) — so o historico se perde' % e)


def apaga(raiz, achados, alvos, limite):
    """tira do espelho os valores escolhidos e regrava. Devolve [(sim, valor)]"""
    quero = {(id(sim), id(v)) for sim, v, _u in alvos}
    if limite:
        quero = set(list(quero)[:limite])
    porarq = {}
    for cam, var, esp, sim, j, v in achados:
        if (id(sim), id(v)) in quero:
            porarq.setdefault(cam, [var, esp, []])[2].append((sim, j, v))
    if not porarq:
        print('nada a apagar.')
        return []
    faz_backup(raiz, list(porarq))
    apagados = []
    for cam, (var, esp, itens) in porarq.items():
        # de tras para frente: remover pelo indice invalida os indices seguintes
        for sim, j, v in sorted(itens, key=lambda t: -t[1]):
            sim['valores'].pop(j)
            apagados.append((sim, v))
        G.grava_espelho_almox(cam, var, esp)
        print('%s: %d valor(es) apagado(s)' % (os.path.basename(cam), len(itens)))
    return apagados


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='apaga da biblioteca os valores que o Odoo ja nao manda (fantasmas)')
    ap.add_argument('--raiz', default=RAIZ, help='workspace (default: a raiz do repositorio)')
    ap.add_argument('--apagar', action='store_true',
                    help='apaga de verdade. SEM isto e so relatorio')
    ap.add_argument('--em-uso-tambem', action='store_true',
                    help='inclui os fantasmas usados em projeto (deixa componente orfao)')
    ap.add_argument('--familia', help='so este simbolo (o nome exato, ex.: "DIODO ZENER [PTH]")')
    ap.add_argument('--limite', type=int, default=0, help='apaga no maximo N (para experimentar)')
    ap.add_argument('--csv', help='grava a lista completa neste arquivo')
    ap.add_argument('-v', '--verbose', action='store_true', help='lista todos os seguros')
    a = ap.parse_args(argv)

    raiz = os.path.abspath(a.raiz)
    if not os.path.isdir(os.path.join(raiz, 'Libs')):
        print('ERRO: %s nao parece um workspace (sem Libs/)' % raiz)
        return 2
    print('workspace: %s' % raiz)

    achados = levanta(raiz, a.familia)
    if not achados:
        print('nenhum fantasma%s — nada a fazer.'
              % (' em "%s"' % a.familia if a.familia else ''))
        return 0

    prot = protegidos_de(raiz)
    seguros, em_uso = relatorio(raiz, achados, prot, a.verbose)
    if a.csv:
        grava_csv(a.csv, seguros, em_uso)

    if not a.apagar:
        print('RELATORIO APENAS — nada foi alterado.')
        print('para apagar os %d seguros: acrescente --apagar' % len(seguros))
        return 0

    alvos = seguros + (em_uso if a.em_uso_tambem else [])
    if not alvos:
        print('nada seguro para apagar.')
        return 0
    print()
    print('apagando %d valor(es)%s...'
          % (min(len(alvos), a.limite) if a.limite else len(alvos),
             ' (inclui os em uso)' if a.em_uso_tambem else ''))
    apagados = apaga(raiz, achados, alvos, a.limite)
    if apagados:
        registra(raiz, apagados)
        print()
        print('%d valor(es) apagado(s) de vez.' % len(apagados))
        print('O numero da part de cada um continua reservado no livro-razao.')
        print('Eles saem das .SchLib de Libs/Almox no proximo sincronismo do almoxarifado.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
