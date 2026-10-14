# -*- coding: utf-8 -*-
"""Os corpos 3D dos footprints de uma .PcbLib, para o componente novo do hub (comp_add).

    python tools/pcb3d/pcblib3d.py <arquivo.PcbLib> <pasta de saida> [-q] [--json]

Grava em <pasta de saida> (o normal e Libs/):
  * pcblib-3d.js -- `var pcblib3d = {format:'pcblib3d-v1', footprints:{<nome>:{bodies:[...]}},
    models:{<modelId>:{file:'3d/<checksum>.step', name, checksum, bytes}}}`; os corpos sao LOCAIS
    ao footprint (a origem dele, rotacao 0, Top), no mesmo contrato do board3d.js -- o
    hub-pcb3d-modelo.js os poe no lugar do componente;
  * 3d/<checksum>.step -- os modelos embutidos, descomprimidos.

ATENCAO ao tamanho: a BIBLIOTECA DE FOOTPRINT da casa (2026-10) tem 330 modelos, ~288 MB de STEP.
Libs/3d/ nao e codigo: ponha no .gitignore antes de gerar dentro do repo.
Mesmas travas do extrai3d.py (nunca grava no acervo).
"""
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), 'pcbdoc'))

import pcbdoc_leitor as L  # noqa: E402
import pcbdoc3d as D  # noqa: E402
from extrai3d import recusa_destino, grava_bytes, grava_texto, mb  # noqa: E402


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='le os corpos 3D de uma .PcbLib e grava pcblib-3d.js + 3d/*.step')
    ap.add_argument('pcblib')
    ap.add_argument('saida', help='pasta de saida (normalmente Libs/)')
    ap.add_argument('-q', action='store_true')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--sem-modelos', action='store_true', help='grava so o pcblib-3d.js (sem os STEP)')
    a = ap.parse_args(argv)
    motivo = recusa_destino(a.saida, a.pcblib)
    if motivo:
        print('RECUSADO: %s -- %s.' % (a.saida, motivo))
        return 2
    try:
        d, arquivos, resumo = D.le_biblioteca3d(a.pcblib)
    except (L.PcbDocErro, OSError, ValueError) as e:
        print('ERRO: %s' % e)
        return 1
    os.makedirs(a.saida, exist_ok=True)
    novos = 0
    if not a.sem_modelos:
        pasta3d = os.path.join(a.saida, '3d')
        os.makedirs(pasta3d, exist_ok=True)
        for nome, dados in arquivos.items():
            novos += grava_bytes(os.path.join(pasta3d, nome), dados)
    grava_texto(os.path.join(a.saida, 'pcblib-3d.js'), D.pcblib3d_js(d))
    resumo['gravados'] = novos
    if a.json:
        print(json.dumps(resumo, ensure_ascii=False))
    elif not a.q:
        print('pcblib-3d.js: %d footprints -- com STEP %d, so extrudado %d, sem corpo %d' % (
            resumo['footprints'], resumo['com_step'], resumo['so_extrudado'], resumo['sem_corpo']))
        print('3d/: %d modelos, %s%s' % (resumo['modelos'], mb(resumo['bytes_modelos']),
                                         ' (nao gravados: --sem-modelos)' if a.sem_modelos else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
