# -*- coding: utf-8 -*-
"""Linha de comando do leitor de .PcbDoc: grava o board.js de uma placa sem abrir o Altium.

    python3 tools/pcbdoc/pcbdoc2board.py <arquivo.PcbDoc | .PcbDoc.Zip> <saida.js> [opcoes]

Le o binario do Altium (o `pcbdoc_leitor.py` ao lado) e escreve o board.js no formato do
`ExportBoard.pas` (pcbmirror-v1), com os campos novos do contrato de 2026-10. Serve para
importar placa sem o Altium (a migracao) e para o teste de ouro do Gerber.

Travas, de proposito:
  * o PcbDoc so e LIDO (o History .PcbDoc.Zip tambem: abre o zip na memoria);
  * nunca grava em disco de rede (X:, Y:, o share do servidor, caminho \\\\maquina\\...): o
    acervo e so leitura, e a saida e sempre local;
  * nunca sobrescreve um Projects/<projeto>/board.js sem --forcar -- e, com --forcar, copia o
    anterior para board.js.bak antes (board.js.bak-<data> se o .bak ja existir).

Opcoes:
  --prjpcb ARQ     tira os parametros (.Revisao, ...) deste .PrjPcb em vez de procurar. Sem
                   nenhum .PrjPcb a string especial fica crua no board.js, e o resumo avisa
                   (o Gerber do hub a escreveria assim na serigrafia)
  --sem-parametros nao converte as strings especiais de projeto
  --sem-contornos  nao grava texts[].polys. Por padrao, todo texto TrueType de uma linha cuja
                   fonte o Windows tem sai com o contorno exato (fontTools; calibrado contra o
                   Gerber X2 do DMB, IoU 0,98) -- o Gerber e a tela usam o contorno quando existe
  --regras ARQ     grava tambem as regras de projeto inteiras (Rules6 + Classes6 crus) no rules.js
                   que o hub le (Projects/<p>/rules.js); o hub-pcbregras.js traduz. Mesmas travas
                   do board.js: nunca em disco de rede, e Projects/*/rules.js so com --forcar (.bak)
  --forcar         permite sobrescrever Projects/*/board.js (com copia .bak antes)
  --gerado TXT     o campo "generated" (padrao: agora, dd/mm/aaaa hh:mm:ss)
  -q               sem o resumo
Saida 0 = gravou; 1 = nao deu para ler o PcbDoc; 2 = recusou gravar.
"""
import os
import shutil
import struct
import sys
import zipfile
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

import pcbdoc_leitor as L  # noqa: E402


def disco_de_rede(caminho):
    """True se o caminho cai num share (UNC ou letra mapeada para rede)"""
    p = os.path.abspath(caminho)
    if p.startswith('\\\\') or p.startswith('//'):
        return True
    if os.name == 'nt' and len(p) >= 2 and p[1] == ':':
        try:
            import ctypes
            tipo = ctypes.windll.kernel32.GetDriveTypeW(p[:2] + '\\')
            return tipo == 4                        # DRIVE_REMOTE
        except Exception:
            return False
    return False


def eh_board_de_projeto(caminho):
    """Projects/<qualquer>/board.js"""
    p = os.path.abspath(caminho).replace('\\', '/').split('/')
    return len(p) >= 3 and p[-1].lower() == 'board.js' and p[-3].lower() == 'projects'


def eh_de_projeto(caminho, nome):
    """Projects/<qualquer>/<nome>"""
    p = os.path.abspath(caminho).replace(os.sep, '/').split('/')
    return len(p) >= 3 and p[-1].lower() == nome and p[-3].lower() == 'projects'


def grava(caminho, texto, q):
    """grava com .bak do anterior quando e arquivo de projeto, e troca atomica (segue symlink)"""
    pasta = os.path.dirname(os.path.abspath(caminho))
    os.makedirs(pasta, exist_ok=True)
    if os.path.exists(caminho) and (eh_board_de_projeto(caminho) or eh_de_projeto(caminho, 'rules.js')):
        bak = caminho + '.bak'
        if os.path.exists(bak):
            bak = caminho + '.bak-' + datetime.now().strftime('%Y%m%d-%H%M%S')
        shutil.copy2(caminho, bak)
        if not q:
            print('copia do anterior: %s' % bak)
    tmp = caminho + '.tmp'
    with open(tmp, 'w', encoding='ascii', newline='\n') as f:
        f.write(texto)
    os.replace(tmp, os.path.realpath(caminho))


def caminho_windows(caminho):
    p = os.path.abspath(caminho)
    return p.replace('/', '\\') if os.name == 'nt' else p


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='le um .PcbDoc do Altium e grava o board.js (sem o Altium)')
    ap.add_argument('pcbdoc')
    ap.add_argument('saida')
    ap.add_argument('--prjpcb')
    ap.add_argument('--sem-parametros', action='store_true')
    ap.add_argument('--sem-contornos', action='store_true')
    ap.add_argument('--forcar', action='store_true')
    ap.add_argument('--regras')
    ap.add_argument('--gerado')
    ap.add_argument('-q', action='store_true')
    a = ap.parse_args(argv)

    if disco_de_rede(a.saida):
        print('RECUSADO: %s fica num disco de rede -- a saida e sempre local (o acervo e so leitura).' % a.saida)
        return 2
    if a.regras and disco_de_rede(a.regras):
        print('RECUSADO: %s fica num disco de rede -- a saida e sempre local (o acervo e so leitura).' % a.regras)
        return 2
    if a.regras and os.path.exists(a.regras) and eh_de_projeto(a.regras, 'rules.js') and not a.forcar:
        print('RECUSADO: %s ja existe e e o rules.js de um projeto (o usuario edita pelo hub). '
              'Use --forcar para sobrescrever (o anterior vai para rules.js.bak antes).' % a.regras)
        return 2
    if os.path.exists(a.saida) and eh_board_de_projeto(a.saida) and not a.forcar:
        print('RECUSADO: %s ja existe e e o espelho de um projeto.\n'
              'Use --forcar para sobrescrever (o anterior vai para board.js.bak antes).' % a.saida)
        return 2

    if a.sem_parametros:
        par, prj = {}, None
    elif a.prjpcb:
        if not os.path.isfile(a.prjpcb):
            print('ERRO: o .PrjPcb %s nao existe' % a.prjpcb)
            return 1
        par, prj = L.parametros_do_prjpcb(a.prjpcb), a.prjpcb
    else:
        par, prj = L.parametros_do_projeto(a.pcbdoc)
    contornos = None
    if not a.sem_contornos:
        try:
            import fontTools  # noqa: F401
            contornos = L.contornos_truetype
        except ImportError:
            print('aviso: sem o fontTools neste Python, os textos TrueType saem sem contorno '
                  '("%s" -m pip install fonttools)' % sys.executable)
    try:
        P = L.Placa(a.pcbdoc)
    except (L.PcbDocErro, OSError, ValueError, IndexError, struct.error, zipfile.BadZipFile) as e:
        print('ERRO lendo %s: %s' % (a.pcbdoc, e))
        return 1
    try:
        P.parametros = par
        B = L.monta(P, gerado=a.gerado, fonte=caminho_windows(a.pcbdoc), contornos=contornos)
        texto = L.board_js(B)
    except (L.PcbDocErro, ValueError, IndexError, KeyError, struct.error) as e:
        # registro fora do que o leitor conhece: diz qual, em vez de um traceback cru
        print('ERRO montando o board.js de %s: %s: %s' % (a.pcbdoc, type(e).__name__, e))
        return 1
    finally:
        P.fecha()

    pasta = os.path.dirname(os.path.abspath(a.saida))
    os.makedirs(pasta, exist_ok=True)
    if os.path.exists(a.saida) and eh_board_de_projeto(a.saida):
        bak = a.saida + '.bak'
        if os.path.exists(bak):
            bak = a.saida + '.bak-' + datetime.now().strftime('%Y%m%d-%H%M%S')
        shutil.copy2(a.saida, bak)
        if not a.q:
            print('copia do anterior: %s' % bak)
    tmp = a.saida + '.tmp'
    with open(tmp, 'w', encoding='ascii', newline='\n') as f:
        f.write(texto)
    # segue o symlink antes de trocar: no servidor Projects/ e estado compartilhado por link, e o
    # os.replace sobre o link trocaria O LINK (tests/test_symlink_sobrevive.py)
    os.replace(tmp, os.path.realpath(a.saida))

    if a.regras:
        grava(a.regras, L.regras_js(P, caminho_windows(a.pcbdoc)), a.q)
        if not a.q:
            print('regras: %d (+%d classes) -> %s' % (len(P.regras), len(P.classes), a.regras))

    if not a.q:
        s = B['stats']
        print('%s -> %s' % (a.pcbdoc, a.saida))
        print('  componentes %d, pads %d (+%d soltos), trilhas %d, arcos %d, vias %d' % (
            s['components'], sum(len(c['pads']) for c in B['components']), s['freepads'], s['tracks'],
            s['arcs'], s['vias']))
        print('  textos %d, silk %d, regioes %d, recortes %d, fills %d, linhas %d, nets %d, camadas %d' % (
            s['texts'], s['silk'], s['regions'], s['cutouts'], s['fills'], s['lines'], len(B['nets']),
            len(B['layers'])))
        print('  parametros do projeto: %s' % (prj or ('(--sem-parametros)' if a.sem_parametros else '(nenhum .PrjPcb achado)')))
        for av in P.avisos:
            print('  aviso:', av)
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main(sys.argv[1:]))
