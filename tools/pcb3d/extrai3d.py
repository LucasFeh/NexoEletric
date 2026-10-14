# -*- coding: utf-8 -*-
"""Os corpos 3D de uma placa do Altium para a vista 3D do hub, sem o Altium.

    python tools/pcb3d/extrai3d.py <arquivo.PcbDoc | .PcbDoc.Zip> <pasta do projeto> [-q] [--json]

Grava, na pasta do projeto (Projects/<p>/):
  * 3d/<checksum>.step  -- os modelos embutidos no .PcbDoc, descomprimidos (um por modelo, mesmo
    que dez componentes o usem; o nome e o MODEL.CHECKSUM do Altium, entao reextrair nao duplica);
  * board3d.js          -- `var pcbmirror3d = {format:'pcb3d-v1', ...}`: os corpos ja posicionados
    na placa (matriz completa do STEP, contorno e alturas do extrudado), a espessura e a posicao de
    origem de cada componente (o hub-pcb3d-modelo.js move os corpos quando o changes.js move o
    componente). O formato esta no topo do tools/pcbdoc/pcbdoc3d.py e do hub-pcb3d-modelo.js.

Travas, como as do pcbdoc2board: o PcbDoc so e LIDO; nunca grava no acervo (X:, Y:, Z:, o share do
servidor nem no disco de rede de onde o PcbDoc veio); nunca toca no board.js nem em outro arquivo do
projeto alem do board3d.js e da pasta 3d/.
Saida 0 = gravou; 1 = nao deu para ler o PcbDoc; 2 = recusou gravar.
"""
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), 'pcbdoc'))

import pcbdoc_leitor as L  # noqa: E402
import pcbdoc3d as D  # noqa: E402

ACERVO = ('X:', 'Y:', 'Z:')


def disco_de_rede(caminho):
    p = os.path.abspath(caminho)
    if p.startswith('\\\\') or p.startswith('//'):
        return True
    if os.name == 'nt' and len(p) >= 2 and p[1] == ':':
        try:
            import ctypes
            return ctypes.windll.kernel32.GetDriveTypeW(p[:2] + '\\') == 4
        except Exception:
            return False
    return False


def recusa_destino(destino, fonte=None):
    """motivo para nao gravar em `destino` (None = pode). O repo pode morar num disco de rede (o
    L: da casa e um); o acervo e a pasta de onde o arquivo veio, nunca."""
    p = os.path.abspath(destino)
    if p.startswith('\\\\') or p.startswith('//'):
        return 'caminho UNC (share do servidor): a saida e sempre local ao repo'
    letra = p[:2].upper() if len(p) >= 2 and p[1] == ':' else ''
    if letra in ACERVO:
        return '%s e o acervo (so leitura)' % letra
    if fonte and not isinstance(fonte, (bytes, bytearray)):
        f = os.path.abspath(fonte)
        if f[:2].upper() == letra and disco_de_rede(f):
            return 'mesmo disco de rede do arquivo de origem (%s)' % letra
        if os.path.normcase(p).startswith(os.path.normcase(os.path.dirname(f))):
            return 'dentro da pasta do arquivo de origem'
    return None


def grava_bytes(caminho, dados):
    if os.path.exists(caminho) and os.path.getsize(caminho) == len(dados):
        with open(caminho, 'rb') as f:
            if f.read() == dados:
                return False
    tmp = caminho + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(dados)
    os.replace(tmp, caminho)
    return True


def grava_texto(caminho, texto):
    tmp = caminho + '.tmp'
    with open(tmp, 'w', encoding='ascii', newline='\n') as f:
        f.write(texto)
    os.replace(tmp, caminho)


def mb(n):
    return '%.1f MB' % (n / 1048576.0) if n >= 1048576 else '%.0f kB' % (n / 1024.0)


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='le os corpos 3D de um .PcbDoc e grava board3d.js + 3d/*.step')
    ap.add_argument('pcbdoc')
    ap.add_argument('projeto', help='pasta do projeto (Projects/<p>)')
    ap.add_argument('-q', action='store_true', help='sem o resumo')
    ap.add_argument('--json', action='store_true', help='o resumo em JSON')
    a = ap.parse_args(argv)

    motivo = recusa_destino(a.projeto, a.pcbdoc)
    if motivo:
        print('RECUSADO: %s -- %s.' % (a.projeto, motivo))
        return 2
    try:
        d, arquivos, resumo = D.le_placa3d(a.pcbdoc)
    except (L.PcbDocErro, OSError, ValueError) as e:
        print('ERRO: %s' % e)
        return 1
    pasta3d = os.path.join(a.projeto, '3d')
    os.makedirs(pasta3d, exist_ok=True)
    novos = 0
    for nome, dados in arquivos.items():
        novos += grava_bytes(os.path.join(pasta3d, nome), dados)
    grava_texto(os.path.join(a.projeto, 'board3d.js'), D.board3d_js(d))
    resumo['gravados'] = novos
    if a.json:
        print(json.dumps(resumo, ensure_ascii=False))
    elif not a.q:
        tam = sorted(len(v) for v in arquivos.values())
        print('board3d.js: %d corpos (%s), espessura %.3f mm (%s)' % (
            resumo['corpos'], ', '.join('%s %d' % kv for kv in resumo['por_tipo'].items() if kv[1]),
            resumo['espessura'], resumo['espessura_fonte']))
        print('componentes: %d -- com STEP %d, so extrudado %d, sem corpo %d' % (
            resumo['componentes'], resumo['com_step'], resumo['so_extrudado'], resumo['sem_corpo']))
        if tam:
            print('3d/: %d modelos, %s (menor %s, maior %s), %d novos ou trocados' % (
                len(tam), mb(sum(tam)), mb(tam[0]), mb(tam[-1]), novos))
        if resumo['sem_modelo']:
            print('ATENCAO: %d modelo(s) que os corpos citam nao estao embutidos: %s' % (
                len(resumo['sem_modelo']), ', '.join(resumo['sem_modelo'])))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
