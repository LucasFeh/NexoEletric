"""Descompacta um documento do Draftsman (.PCBDwf / .DwfDot) para o XML dele.

O arquivo do Draftsman do AD21 nao e zip nem OLE: e o XML do DataContract
(Altium.Designer.PcbDrawing.DataSerialization.V1) num LZ4Stream legado do lz4net, medido no
A4_DiEletronsDraftsman.DwfDot da casa: uma sequencia de blocos, cada um com tres varints
(flags, tamanho original, tamanho comprimido - este so quando flags & 1) seguidos do bloco LZ4
cru. Sem flag de compressao o bloco vem cru.

Uso: python dwf_xml.py <entrada> <saida.xml>
"""
import sys


def varint(b, i):
    v = s = 0
    while True:
        c = b[i]; i += 1
        v |= (c & 0x7F) << s; s += 7
        if c < 0x80:
            return v, i


def lz4_bloco(src, n_saida):
    out = bytearray(); i = 0; n = len(src)
    while i < n:
        tok = src[i]; i += 1
        lit = tok >> 4
        if lit == 15:
            while True:
                c = src[i]; i += 1; lit += c
                if c != 255: break
        out += src[i:i + lit]; i += lit
        if i >= n: break
        off = src[i] | (src[i + 1] << 8); i += 2
        m = tok & 15
        if m == 15:
            while True:
                c = src[i]; i += 1; m += c
                if c != 255: break
        m += 4
        ini = len(out) - off
        for k in range(m):
            out.append(out[ini + k])
    return bytes(out)


def descompacta(b):
    i = 0; out = bytearray()
    while i < len(b):
        flags, i = varint(b, i)
        orig, i = varint(b, i)
        if flags & 1:
            comp, i = varint(b, i)
            out += lz4_bloco(b[i:i + comp], orig); i += comp
        else:
            out += b[i:i + orig]; i += orig
    return bytes(out)


if __name__ == '__main__':
    dados = open(sys.argv[1], 'rb').read()
    open(sys.argv[2], 'wb').write(descompacta(dados))
