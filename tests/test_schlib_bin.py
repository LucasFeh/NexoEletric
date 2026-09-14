# -*- coding: utf-8 -*-
"""O leitor/escritor de registros de .SchLib, provado contra a biblioteca REAL.

    python tests/test_schlib_bin.py [caminho.SchLib]

A prova é round-trip byte a byte: ler a biblioteca do usuário, desmontar cada stream em
registros, remontar, e exigir os MESMOS bytes. Se fecha em centenas de componentes e
milhares de pinos reais, o formato está entendido — sem precisar abrir o Altium.
"""
import os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import schlib_bin as SB  # noqa: E402

# A biblioteca da casa publicada dentro do repositorio (tools/libpath.py). Era um
# caminho de maquina (D:/ ou a UNC do PC do Lucas), entao este teste PULAVA em
# silencio em qualquer clone que nao fosse o da bancada -- inclusive no servidor.
PADRAO = os.path.join(RAIZ, 'Libs', 'BIBLIOTECA DE ESQUEMA.SchLib')


def testa_construtor():
    """o construtor de pino novo, que nao depende da lib real: roda SEMPRE, antes do
    round-trip — sem a rede o resto e pulado, e o mapeamento dos bits nao pode passar em
    silencio"""
    # e o construtor de pino novo tem que sair no mesmo formato que o Altium escreve
    novo = SB.pino('1', 'C', 180, 120, 100, 90)
    bruto = SB.escreve_pino(novo)
    assert SB.escreve_pino(SB.le_pino(bruto)) == bruto, 'pino construido nao fecha'
    assert bruto.hex() == '020000000001000000000000000104310a0012000c000000000001430131000000', \
        'pino construido saiu diferente do 2N3904 real:\n  %s' % bruto.hex()
    # o olho do pino: por padrao so o designador a vista (0x30|rot, como o 2N3904 que esconde
    # o C/B/E); mostra_nome acende o 0x08, mostra_desig=False apaga o 0x10; o 0x20 fica sempre
    assert novo['conglomerado'] == 0x31, hex(novo['conglomerado'])
    assert SB.pino('1', 'C', 180, 120, 100, 90, mostra_nome=True)['conglomerado'] == 0x39
    assert SB.pino('1', 'C', 180, 120, 100, 90, mostra_desig=False)['conglomerado'] == 0x21
    assert SB.pino('1', 'C', 0, 0, 100, 0, mostra_nome=True, mostra_desig=False)['conglomerado'] == 0x28


def main(caminho=None):
    caminho = caminho or PADRAO
    testa_construtor()
    try:
        import olefile
    except ImportError:
        print('test_schlib_bin PULADO (olefile nao instalado)')
        return 0
    if not os.path.exists(caminho):
        print('test_schlib_bin PULADO (nao alcancei %s)' % caminho)
        return 0

    o = olefile.OleFileIO(caminho)
    streams = ['/'.join(s) for s in o.listdir()]
    comps = pinos = textos = opacos = 0

    for nome in streams:
        cru = o.openstream(nome).read()
        regs = SB.desmonta(cru)
        assert SB.monta(regs) == cru, '%s: enquadramento nao fecha' % nome

        for tipo, pl in regs:
            if tipo == SB.TEXTO:
                d = SB.le_texto(pl)
                assert SB.escreve_texto(d) == pl, '%s: texto nao fecha\n%r' % (nome, pl[:120])
                if d.get('RECORD') == '1':
                    comps += 1
                textos += 1
            elif pl[:1] == b'\x02':
                p = SB.le_pino(pl)
                assert SB.escreve_pino(p) == pl, '%s: pino nao fecha\n%r' % (nome, pl.hex())
                pinos += 1
            else:
                # PinTextData e afins: binario comprimido (zlib), fora do escopo daqui.
                # O enquadramento ja foi conferido acima, entao o arquivo sai igual.
                opacos += 1

    assert comps > 100, 'poucos componentes lidos: %d' % comps
    assert pinos > 500, 'poucos pinos lidos: %d' % pinos

    print('test_schlib_bin OK (%d streams, %d componentes, %d pinos, %d registros de texto, '
          '%d binarios opacos — round-trip byte a byte)'
          % (len(streams), comps, pinos, textos, opacos))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
