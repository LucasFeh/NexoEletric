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

    # o que o espelho manda existir: um componente por valor, agrupado por familia.
    # O balde sai do `almox2lib.balde_de`, o MESMO que o escritor usa — reescrever a regra
    # aqui foi o que fez este teste acusar "52 .SchLib no disco, 49 casaram" no dia em que
    # o conector passou a ter uma biblioteca por subtipo: o disco estava certo e a copia da
    # regra que vivia neste arquivo e que estava velha.
    import almox2lib as A2
    esperado = collections.defaultdict(dict)     # familia -> {nome_altium: (sim, valor)}
    for arq in ('almox-basicos.js', 'almox-especiais.js'):
        esp = ESC.le_espelho(os.path.join(RAIZ, 'Libs', arq))
        for sim in esp['symbols']:
            fam = A2.balde_de(sim)
            for v in sim.get('valores') or []:
                esperado[fam][v['altium']] = (sim, v)

    # a PcbLib mora na mesma pasta, para o conjunto andar junto
    pcb = os.path.join(LIBS, ESC.PCBLIB_NOME)
    assert os.path.exists(pcb), 'falta %s ao lado das SchLib' % ESC.PCBLIB_NOME

    # Uma familia sai em UMA biblioteca, ou em varias numeradas quando o indice nao
    # cabe num registro: "ESPECIAIS 1 ALMOX", "ESPECIAIS 2 ALMOX" (ver
    # ESC.fatias_que_cabem). O que tem que fechar e a UNIAO dos pedacos.
    arquivos = sorted(f for f in os.listdir(LIBS) if f.endswith('.SchLib'))
    de_quem = {}
    for fam in esperado:
        raiz_fam = re.escape(ESC.nome_arquivo(fam)[:-len(' ALMOX')])
        rx = re.compile(r'^%s( \d+)? ALMOX\.SchLib$' % raiz_fam)
        pedacos = [f for f in arquivos if rx.match(f)]
        assert pedacos, 'falta a biblioteca da familia %s' % fam
        for f in pedacos:
            de_quem[os.path.join(LIBS, f)] = fam
    assert len(de_quem) == len(arquivos), (
        '%d .SchLib no disco, %d casaram com alguma familia' % (len(arquivos), len(de_quem)))

    total = com_fp = com_param = 0
    libref_de = collections.defaultdict(set)
    vistos_de = collections.defaultdict(set)
    for caminho in sorted(de_quem):
        fam = de_quem[caminho]
        alvos = esperado[fam]
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
        regs_cab = SB.desmonta(o.openstream('FileHeader').read())
        # O teto do enquadramento: o Altium 21.5.1 descarta o FileHeader inteiro
        # acima disso e abre a biblioteca com a folha em preto. Foi assim que a
        # ESPECIAIS de 919 componentes (81.617 bytes) saiu quebrada.
        assert len(regs_cab[0][1]) <= SB.MAX_REGISTRO, (
            '%s: FileHeader de %d bytes, teto %d'
            % (os.path.basename(caminho), len(regs_cab[0][1]), SB.MAX_REGISTRO))
        cab = SB.le_texto(regs_cab[0][1])
        libref = {v for k, v in cab.items() if re.match(r'^LibRef\d+$', k)}
        libref_de[fam] |= libref

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

            # NENHUM rotulo pode cair em cima do desenho. Vale para o texto que o
            # gerador cria E para o que veio herdado de um simbolo reciclado: a
            # biblioteca da casa escreve o designador por cima do desenho em 148 dos
            # 245 componentes dela, e isso nao pode atravessar a sincronizacao.
            # A ancora de um texto no Altium e o PE da linha - ele ocupa para CIMA -,
            # por isso a faixa vai de y ate y + ESC.ALTURA_TEXTO.
            dx0 = dy0 = 10 ** 9
            dx1 = dy1 = -10 ** 9
            rotulos = []
            for tipo, pl in regs:
                if tipo != SB.TEXTO:
                    p = SB.le_pino(pl)
                    dx0, dx1 = min(dx0, p['x']), max(dx1, p['x'])
                    dy0, dy1 = min(dy0, p['y']), max(dy1, p['y'])
                    continue
                d = SB.le_texto(pl)
                r = d.get('RECORD')
                if r in ESC.SEM_DESENHO or d.get('IsHidden') == 'T':
                    continue
                if r == '34' or (r == '41' and d.get('Name') == 'Comment'):
                    x = int(d.get('Location.X', 0))
                    y = int(d.get('Location.Y', 0))
                    larg = max(1, len(d.get('Text', '') or '')) * 6   # 60 mil/caractere
                    rotulos.append((d.get('Name', r), x, y, x + larg, y + ESC.ALTURA_TEXTO))
                    continue
                for k, v in d.items():
                    try:
                        val = int(float(v))
                    except (ValueError, TypeError):
                        continue
                    if k in ('Location.X', 'Corner.X') or (k[:1] == 'X' and k[1:].isdigit()):
                        dx0, dx1 = min(dx0, val), max(dx1, val)
                    elif k in ('Location.Y', 'Corner.Y') or (k[:1] == 'Y' and k[1:].isdigit()):
                        dy0, dy1 = min(dy0, val), max(dy1, val)
            if dx1 > dx0 or dy1 > dy0:
                for qual, x0, y0, x1, y1 in rotulos:
                    assert not (x1 > dx0 and x0 < dx1 and y1 > dy0 and y0 < dy1), (
                        '%s: %s ocupa x[%d..%d] y[%d..%d] e invade o desenho '
                        'x[%d..%d] y[%d..%d]'
                        % (nome, qual, x0, x1, y0, y1, dx0, dx1, dy0, dy1))
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
            # O DESENHO DO VALOR GANHA DO DESENHO DA FAMILIA, como em
            # `schlib_escritor.monta_componente:379` (`valor.get('parts') or sim['parts']`).
            # Sao 3 valores hoje — SN65HVD75DR, ESP32-DevKitC-32D e ESP32 DEVKIT V1 —, todos
            # salvos pelo /save-almox por cima de um simbolo [PINAGEM A DEFINIR] de 4 pinos.
            # Comparar sempre contra a familia acusava "contagem de pinos" num arquivo certo.
            partes = valor.get('parts') or sim['parts']
            assert len(pinos) == len(partes[0]['pins']), (
                '%s: contagem de pinos (%d no arquivo, %d no espelho)'
                % (nome, len(pinos), len(partes[0]['pins'])))

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
        # Coerencia DENTRO do arquivo. So a uniao por familia nao basta: ela aceitaria
        # um componente indexado numa biblioteca e gravado na irma, que no Altium some
        # do painel das duas. Aqui o indice do FileHeader e os storages tem que ser o
        # mesmo conjunto, arquivo por arquivo.
        assert libref == vistos, (
            '%s: indice e storages divergem (so no indice %r, so no disco %r)'
            % (os.path.basename(caminho), sorted(libref - vistos)[:2],
               sorted(vistos - libref)[:2]))
        assert int(cab.get('CompCount', -1)) == len(vistos), (
            '%s: CompCount=%s para %d componentes'
            % (os.path.basename(caminho), cab.get('CompCount'), len(vistos)))
        vistos_de[fam] |= vistos
        o.close()

    for fam, alvos in esperado.items():
        assert libref_de[fam] == set(alvos), (
            '%s: indice do FileHeader diverge (falta %r, sobra %r)'
            % (fam, sorted(set(alvos) - libref_de[fam])[:2],
               sorted(libref_de[fam] - set(alvos))[:2]))
        assert vistos_de[fam] == set(alvos), (
            '%s: faltaram %r' % (fam, sorted(set(alvos) - vistos_de[fam])[:2]))

    print('test_schlib_gerada OK (%d bibliotecas para %d familias, %d componentes, '
          '%d com footprint atual, %d com parametros preenchidos)'
          % (len(arquivos), len(esperado), total, com_fp, com_param))
    return 0


if __name__ == '__main__':
    sys.exit(main())
