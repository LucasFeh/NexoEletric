# -*- coding: utf-8 -*-
"""O escritor CFBF, conferido por uma implementação independente.

    python tests/test_cfbf.py

Escreve o arquivo e relê com o `olefile` — que não é meu código. Se ele acha a mesma
árvore de streams com o mesmo conteúdo, o contêiner está bem formado.

A prova mais forte vem no fim: pega a .SchLib REAL do usuário, reescreve todos os
streams dela com este escritor, e exige que o `olefile` leia de volta a biblioteca
inteira, idêntica.
"""
import io, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import cfbf  # noqa: E402

REAL = '//LUCAS-PC/D/ALTIUM LIBRARY ------ LUCAS/BIBLIOTECA DE ESQUEMA.SchLib'


def achata(arvore, prefixo=''):
    fora = {}
    for nome, v in arvore.items():
        caminho = prefixo + nome
        if isinstance(v, dict):
            fora.update(achata(v, caminho + '/'))
        else:
            fora[caminho] = v
    return fora


def confere(olefile, arvore, rotulo):
    bruto = cfbf.escreve(arvore)
    assert bruto[:8] == cfbf.ASSINATURA, '%s: assinatura' % rotulo
    assert len(bruto) % cfbf.SETOR == 0, '%s: tamanho nao e multiplo do setor' % rotulo
    assert olefile.isOleFile(io.BytesIO(bruto)), '%s: olefile nao reconheceu' % rotulo

    o = olefile.OleFileIO(io.BytesIO(bruto))
    lidos = {'/'.join(p): o.openstream('/'.join(p)).read() for p in o.listdir()}
    esperado = achata(arvore)
    assert set(lidos) == set(esperado), ('%s: streams diferentes\n  falta %r\n  sobra %r'
                                        % (rotulo, sorted(set(esperado) - set(lidos)),
                                           sorted(set(lidos) - set(esperado))))
    for k in esperado:
        assert lidos[k] == esperado[k], ('%s: conteudo de %s (%d vs %d bytes)'
                                         % (rotulo, k, len(lidos[k]), len(esperado[k])))
    o.close()
    return len(bruto)


def main():
    try:
        import olefile
    except ImportError:
        print('test_cfbf PULADO (olefile nao instalado)')
        return 0

    # 1. o mínimo
    confere(olefile, {'Um': b'abc'}, 'um stream curto')
    # 2. vazio, mini e grande no mesmo arquivo (exercita mini-FAT e FAT)
    confere(olefile, {
        'Vazio': b'',
        'Curto': b'x' * 10,
        'NoLimite': b'y' * (cfbf.CORTE_MINI - 1),
        'Grande': bytes(range(256)) * 40,          # 10 KB, vai para a FAT
    }, 'mistura de tamanhos')
    # 3. storages aninhados, como o Altium usa (um por componente)
    confere(olefile, {
        'FileHeader': b'|HEADER=teste|\x00',
        'RES': {'Data': b'|RECORD=1|LibReference=RES|\x00'},
        'CAP': {'Data': b'|RECORD=1|LibReference=CAP|\x00', 'PinTextData': b'\x01\x02'},
    }, 'storages aninhados')
    # 4. muitos irmãos: a árvore do diretório precisa aguentar
    confere(olefile, {('C%03d' % i): {'Data': b'x' * (i + 1)} for i in range(300)},
            '300 componentes')
    # 5. nomes com acento (UTF-16 no diretório)
    confere(olefile, {'Cerâmico': b'a', 'Poliéster': {'Data': b'b'}}, 'acentos')

    # 6. a prova de fogo: reescrever a biblioteca real e reler
    if os.path.exists(REAL):
        o = olefile.OleFileIO(REAL)
        arvore = {}
        for p in o.listdir():
            dados = o.openstream('/'.join(p)).read()
            no = arvore
            for seg in p[:-1]:
                no = no.setdefault(seg, {})
            no[p[-1]] = dados
        o.close()
        n = confere(olefile, arvore, 'BIBLIOTECA DE ESQUEMA.SchLib reescrita')
        print('test_cfbf OK (5 casos + a lib real de %d streams reescrita em %.1f MB)'
              % (len(achata(arvore)), n / 1024.0 / 1024.0))
    else:
        print('test_cfbf OK (5 casos; a lib real nao esta alcancavel daqui)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
