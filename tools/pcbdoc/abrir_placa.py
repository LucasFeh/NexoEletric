# -*- coding: utf-8 -*-
"""A PCB do Altium aberta direto no hub (Arquivo > Abrir documento do Altium, ou o .PrjPcb arrastado
para a janela): o .PcbDoc vira o Projects/<p>/board.js (pcbdoc2board), o rules.js (as regras da placa)
e o 3D da placa (extrai3d: board3d.js + 3d/*.step). O que o ExportBoard cria quando falta -- o
changes.js e o annotations.js vazios -- nasce aqui tambem, para o projeto ficar igual ao exportado.

So le o .PcbDoc (pode estar no W:, no share). Quem chama (hubserver.py » /api/altium/abrir) decide se
pode substituir um projeto que ja existe.
"""
import io
import os
import re
import sys
from contextlib import redirect_stdout

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), 'pcb3d'))

import pcbdoc2board as B  # noqa: E402

CHANGES_VAZIO = ('// AltiumPCBMirror - arquivo de mudancas.\n'
                 '// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.\n'
                 'var changes = [\n];\n')
ANNOTATIONS_VAZIO = ('// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.\n'
                     '// A IA le, corrige via changes.js e marca status resolved + reply. Consulte AI-GUIDE.md Parte C.\n'
                     'var annotations = [\n];\n')


class ErroPlaca(Exception):
    pass


def _texto_prjpcb(prj):
    with open(prj, 'rb') as f:
        bruto = f.read()
    try:                                  # UTF-8 nas versoes novas do Altium, cp1252 nas velhas
        return bruto.decode('utf-8-sig')
    except UnicodeDecodeError:
        return bruto.decode('cp1252', 'replace')


def placas_do_prjpcb(prj):
    """os .PcbDoc do .PrjPcb que existem no disco, na ordem de [DocumentN]. Se o .PcbDoc veio solto
    ao lado do .PrjPcb (sem a subpasta), vale o solto."""
    base = os.path.dirname(os.path.abspath(prj))
    docs = []
    for m in re.finditer(r'^\[Document(\d+)\][^\[]*?^DocumentPath=(.*?)\s*$', _texto_prjpcb(prj), re.M | re.S):
        caminho = m.group(2).strip()
        if not caminho.lower().endswith('.pcbdoc'):
            continue
        partes = re.split(r'[\\/]', caminho)
        alvo = caminho if os.path.isabs(caminho) else os.path.normpath(os.path.join(base, *partes))
        solto = os.path.join(base, partes[-1])
        if not os.path.isfile(alvo) and os.path.isfile(solto):
            alvo = solto
        if os.path.isfile(alvo):
            docs.append((int(m.group(1)), alvo))
    docs.sort()
    return [c for _, c in docs]


def _roda(main, argv):
    out = io.StringIO()
    with redirect_stdout(out):
        rc = main(argv)
    return rc, out.getvalue().strip()


def abre_placa(pcbdoc, pasta, prjpcb=None, avisos=None):
    """Grava board.js, rules.js, o 3D e os vazios que faltarem em `pasta`. -> resumo (dict)"""
    avisos = avisos if avisos is not None else []
    os.makedirs(pasta, exist_ok=True)
    saida = os.path.join(pasta, 'board.js')
    argv = [pcbdoc, saida, '--forcar', '-q', '--regras', os.path.join(pasta, 'rules.js')]
    if prjpcb:
        argv += ['--prjpcb', prjpcb]
    rc, msg = _roda(B.main, argv)
    if rc != 0:
        raise ErroPlaca(msg or 'nao deu para ler o %s' % os.path.basename(pcbdoc))
    resumo = {'pcbdoc': os.path.basename(pcbdoc)}
    try:
        txt = open(saida, encoding='ascii').read()
        import json
        b = json.loads(txt[txt.index('=') + 1:].strip().rstrip(';'))
        s = b.get('stats') or {}
        resumo.update({'componentes': s.get('components', 0), 'trilhas': s.get('tracks', 0), 'vias': s.get('vias', 0),
                       'nets': len(b.get('nets') or []), 'camadas': len(b.get('layers') or [])})
    except (OSError, ValueError):
        pass
    # o 3D da placa: so acrescimo; sem ele a PCB abre igual (a vista 3D mostra so o footprint)
    try:
        import extrai3d as X
        rc3, msg3 = _roda(X.main, [pcbdoc, pasta, '-q'])
        if rc3 == 0:
            resumo['3d'] = True
        else:
            avisos.append('3D da placa: %s' % (msg3 or 'nao extraido'))
    except Exception as e:                      # noqa: BLE001 -- o 3D nunca derruba a abertura
        avisos.append('3D da placa: %s' % e)
    for nome, conteudo in (('changes.js', CHANGES_VAZIO), ('annotations.js', ANNOTATIONS_VAZIO)):
        alvo = os.path.join(pasta, nome)
        if not os.path.exists(alvo):
            with open(alvo, 'w', encoding='utf-8', newline='\n') as f:
                f.write(conteudo)
    return resumo
