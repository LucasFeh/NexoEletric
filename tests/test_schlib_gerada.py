# -*- coding: utf-8 -*-
"""As bibliotecas que a sincronização escreve para o Altium, conferidas depois de gravadas.

    python tests/test_schlib_gerada.py

O modelo: **uma biblioteca por família** (`ALMOX RESISTOR.SchLib` com todos os
resistores) e **um componente por valor**, com o nome sendo encapsulamento +
característica (`SMD 0805 10K 1/8W 1% 100ppm`), o footprint daquele encapsulamento como
modelo atual e os parâmetros já preenchidos. O espelho do hub continua por família — a
tradução acontece só aqui.

Relê os arquivos com o `olefile` e exige esse contrato.
"""
import collections, io, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))

import schlib_bin as SB  # noqa: E402

LIBS = os.path.join(RAIZ, 'Libs', 'Almox')
CAMPOS = ('Comment', 'Value', 'Estoque', 'Local', 'ValorId')


def main():
    try:
        import olefile
    except ImportError:
        print('test_schlib_gerada PULADO (olefile nao instalado)')
        return 0
    import schlib_escritor as ESC

    if not os.path.isdir(LIBS):
        print('test_schlib_gerada PULADO (Libs/Almox ainda nao foi gerada)')
        return 0

    # o que o espelho manda existir: um componente por valor, agrupado por familia
    esperado = collections.defaultdict(dict)     # familia -> {nome_altium: (sim, valor)}
    for arq, unica in (('almox-basicos.js', None), ('almox-especiais.js', 'ESPECIAIS')):
        esp = ESC.le_espelho(os.path.join(RAIZ, 'Libs', arq))
        for sim in esp['symbols']:
            fam = unica or sim['familia']
            for v in sim.get('valores') or []:
                esperado[fam][v['altium']] = (sim, v)

    # a PcbLib mora na mesma pasta, para o conjunto andar junto
    pcb = os.path.join(LIBS, ESC.PCBLIB_NOME)
    assert os.path.exists(pcb), 'falta %s ao lado das SchLib' % ESC.PCBLIB_NOME

    arquivos = [f for f in os.listdir(LIBS) if f.endswith('.SchLib')]
    assert len(arquivos) == len(esperado), (
        '%d .SchLib para %d familias' % (len(arquivos), len(esperado)))

    total = com_fp = com_param = 0
    for fam, alvos in esperado.items():
        caminho = os.path.join(LIBS, ESC.nome_arquivo(fam) + '.SchLib')
        assert os.path.exists(caminho), 'falta a biblioteca da familia %s' % fam
        # o .LibPkg e o que o Altium compila em .IntLib
        pkg = caminho[:-7] + '.LibPkg'
        assert os.path.exists(pkg), '%s: sem .LibPkg' % fam
        # o pacote tem que apontar para a SchLib E para a PcbLib ao lado, por nome
        # relativo — senao a .IntLib compilada sai sem footprint
        docs = [l.split('=', 1)[1] for l in io.open(pkg, encoding='utf-8').read().splitlines()
                if l.startswith('DocumentPath=')]
        assert docs == [os.path.basename(caminho), ESC.PCBLIB_NOME], (
            '%s: documentos do .LibPkg = %r' % (fam, docs))

        o = olefile.OleFileIO(caminho)
        cab = SB.le_texto(SB.desmonta(o.openstream('FileHeader').read())[0][1])
        libref = {v for k, v in cab.items() if re.match(r'^LibRef\d+$', k)}
        assert libref == set(alvos), (
            '%s: indice do FileHeader diverge (falta %r, sobra %r)'
            % (fam, sorted(set(alvos) - libref)[:2], sorted(libref - set(alvos))[:2]))

        vistos = set()
        for st in [s[0] for s in o.listdir() if len(s) == 2 and s[1] == 'Data'
                   and s[0] != 'FileHeader']:
            cru = o.openstream('%s/Data' % st).read()
            regs = SB.desmonta(cru)
            assert SB.monta(regs) == cru, '%s/%s: enquadramento' % (fam, st)
            h = SB.le_texto(regs[0][1])
            assert h.get('RECORD') == '1', '%s/%s: primeiro registro' % (fam, st)
            nome = h['LibReference']
            assert nome in alvos, '%s: componente inesperado %r' % (fam, nome)
            # O Altium NAO varre o arquivo atras do LibReference: ele deriva o nome do
            # storage e abre direto ("Cannot find item [...] within the current storage"
            # e o que aparece quando a derivacao nao bate). A regra, lida da biblioteca
            # da casa: proibido vira '_', corta em 31, nao termina em '.' nem espaco, e
            # na colisao o ultimo caractere vira digito.
            assert len(st) <= 31, '%s: storage com %d caracteres' % (nome, len(st))
            assert not st.endswith(('.', ' ')), '%s: storage termina em %r' % (nome, st[-1])
            direto = ESC.PROIBIDOS.sub('_', nome)[:31].rstrip(' .')
            assert st == direto or (st[-1].isdigit() and st[:-1] == direto[:len(st) - 1]), (
                '%s: storage %r nao segue a regra (esperado %r ou variante com digito)'
                % (nome, st, direto))
            assert nome not in vistos, '%s: componente repetido %r' % (fam, nome)
            vistos.add(nome)
            sim, valor = alvos[nome]

            # o DesignItemId e o mesmo nome: encapsulamento + caracteristica
            assert h.get('DesignItemId') == nome, (
                '%s: DesignItemId %r' % (nome, h.get('DesignItemId')))
            assert int(h['PartCount']) == 2, '%s: PartCount %s (uma parte)' % (nome, h['PartCount'])

            pinos, params, contagem = [], {}, collections.Counter()
            for tipo, pl in regs:
                if tipo == SB.BINARIO:
                    p = SB.le_pino(pl)
                    assert p['ownerpartid'] == 1, '%s: pino fora da parte 1' % nome
                    pinos.append(p)
                else:
                    d = SB.le_texto(pl)
                    if d.get('RECORD') == '41' and d.get('Name'):
                        params[d['Name']] = d.get('Text', '')
                        contagem[d['Name']] += 1
            rep = sorted(k for k, c in contagem.items() if c > 1)
            assert not rep, '%s: parametro repetido %r' % (nome, rep)
            assert len(pinos) == len(sim['parts'][0]['pins']), '%s: contagem de pinos' % nome

            # os parametros saem PREENCHIDOS, nao como placeholder. Campo que o Odoo nao
            # tem (Local de um item sem prateleira, MPN de um generico) simplesmente nao
            # e emitido — parametro vazio so polui o Parameter Manager.
            # '|' separa campos no formato .SchLib e vira '/' na gravacao; a comparacao
            # tem que aplicar a mesma regra, senao acusa diferenca que nao existe
            limpo = lambda t: str(t or '').replace('|', '/')
            doValor = {q['n']: q['v'] for q in (valor.get('params') or [])}
            for c in CAMPOS:
                tem = doValor.get(c) or (c == 'ValorId') or (c == 'Comment')
                if not tem:
                    continue
                assert c in params, '%s: falta o parametro %s' % (nome, c)
                assert params[c] != '*', '%s: parametro %s ainda e placeholder' % (nome, c)
            for c, v in doValor.items():
                # a descricao do Odoo vira o ComponentDescription do componente, nao um
                # parametro homonimo
                if c == 'Descricao':
                    assert h.get('ComponentDescription') == limpo(v), (
                        '%s: ComponentDescription %r, esperado %r'
                        % (nome, h.get('ComponentDescription'), limpo(v)))
                    continue
                if v:
                    assert params.get(c) == limpo(v), (
                        '%s: parametro %s = %r, esperado %r' % (nome, c, params.get(c), limpo(v)))
            assert params['Comment'] == limpo(valor['label']), (
                '%s: Comment %r, esperado %r' % (nome, params['Comment'], valor['label']))
            assert params['ValorId'] == str(valor['id']), '%s: ValorId' % nome
            com_param += 1

            fps = [(SB.le_texto(pl).get('ModelName'), SB.le_texto(pl).get('IsCurrent'))
                   for t, pl in regs
                   if t == SB.TEXTO and SB.le_texto(pl).get('RECORD') == '45']
            if valor.get('footprint'):
                atual = [n for n, c in fps if c == 'T']
                assert atual == [valor['footprint']], (
                    '%s: footprint atual %r, esperado %r' % (nome, atual, valor['footprint']))
                com_fp += 1
            total += 1
        assert vistos == set(alvos), '%s: faltaram %r' % (fam, sorted(set(alvos) - vistos)[:2])
        o.close()

    print('test_schlib_gerada OK (%d bibliotecas por familia, %d componentes, '
          '%d com footprint atual, %d com parametros preenchidos)'
          % (len(esperado), total, com_fp, com_param))
    return 0


if __name__ == '__main__':
    sys.exit(main())
