# -*- coding: utf-8 -*-
"""Gera a Database Library do almoxarifado: a tabela e o arquivo .DbLib.

É a peça que responde "quero escolher o valor DENTRO do Altium": no painel *Components*
você navega a tabela, vê Value / Encapsulamento / Estoque / Local / Mouser em colunas,
filtra, e coloca. Cada linha aponta para o símbolo (uma parte) e para o footprint, e os
demais campos viram parâmetros do componente colocado.

Sai em `Libs/Almox/`:
    almox.sqlite      a tabela `Components`, uma linha por valor
    almox.csv         a mesma coisa em texto, para conferir sem abrir o Altium
    ALMOX.DbLib       o arquivo que o Altium abre

O `.DbLib` sai apontando para o SQLite por ODBC. O driver (SQLite3 ODBC, do Christian
Werner) precisa estar instalado no PC do Altium — é a única coisa que não dá para
automatizar daqui.
"""
import csv, io, json, os, sqlite3, sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
LIBS = os.path.join(RAIZ, 'Libs')
DEST = os.path.join(LIBS, 'Almox')

# O caminho como o PC do Altium enxerga. Ele entra DENTRO do ALMOX.DbLib, entao nao pode
# ser o disco de ninguem: o Altium abre esse arquivo a partir do share do servidor, e um
# caminho de bancada ali faz a Database Library nascer apontando para uma maquina que a
# outra nao alcanca.
#
# ALTIUMHUB_DBLIB_DIR troca esse caminho sem mexer no codigo. E o que o app desktop
# (electron/) usa: la o sincronismo roda numa pasta de trabalho LOCAL, e um DbLib gerado ali
# apontando para o share faria o Altium daquela maquina ler o SQLite do servidor em vez do
# que acabou de ser escrito ao lado dele.
UNC = os.environ.get('ALTIUMHUB_DBLIB_DIR') or r'\\192.168.15.192\altiumhub\current\Libs\Almox'

COLUNAS = ['Chave', 'Biblioteca', 'Familia', 'Simbolo', 'Designator', 'Footprint',
           'Comment', 'Value', 'Encapsulamento', 'MPN', 'Mouser', 'OdooId',
           'Estoque', 'EmEstoque', 'Local', 'Custo', 'Descricao', 'ValorId']

# Campos que viram PARAMETRO do componente colocado (o resto e chave ou mapeamento)
PARAMETROS = ['Value', 'Encapsulamento', 'MPN', 'Mouser', 'OdooId',
              'Estoque', 'Local', 'Custo', 'Descricao', 'Familia', 'ValorId']


def le_espelho(caminho):
    txt = io.open(caminho, encoding='utf-8').read()
    return json.loads(txt[txt.index('=') + 1:].strip().rstrip(';'))


def linhas(acervos):
    """[(id_acervo, espelho)] -> uma linha por valor"""
    fora = []
    for aid, esp in acervos:
        for s in esp['symbols']:
            par_do_simbolo = {p['n']: p['v'] for p in (s.get('params') or [])}
            for v in s.get('valores') or []:
                p = {q['n']: q['v'] for q in (v.get('params') or [])}
                fora.append({
                    'Chave': '%s#%d' % (s['name'], v['id']),
                    'Biblioteca': aid,
                    'Familia': s.get('familia', ''),
                    'Simbolo': s['name'],
                    'Designator': s.get('designator', 'U'),
                    'Footprint': v.get('footprint', ''),
                    'Comment': v['label'],
                    'Value': p.get('Value', v.get('value', '')),
                    'Encapsulamento': p.get('Encapsulamento', ''),
                    'MPN': p.get('MPN', ''),
                    'Mouser': p.get('Mouser', ''),
                    'OdooId': p.get('OdooId', ''),
                    'Estoque': v.get('estoque', 0),
                    'EmEstoque': 'TRUE' if (v.get('estoque') or 0) > 0 else 'FALSE',
                    'Local': p.get('Local', ''),
                    'Custo': p.get('Custo', ''),
                    'Descricao': p.get('Descricao', par_do_simbolo.get('Familia', '')),
                    'ValorId': v['id'],
                })
    return fora


def grava_sqlite(rows, caminho):
    tmp = caminho + '.tmp'
    if os.path.exists(tmp):
        os.remove(tmp)
    con = sqlite3.connect(tmp)
    con.execute('CREATE TABLE Components (%s)'
                % ', '.join('"%s" TEXT' % c for c in COLUNAS))
    con.executemany('INSERT INTO Components VALUES (%s)' % ','.join('?' * len(COLUNAS)),
                    [[str(r[c]) for c in COLUNAS] for r in rows])
    con.execute('CREATE UNIQUE INDEX idx_chave ON Components(Chave)')
    con.execute('CREATE INDEX idx_simbolo ON Components(Simbolo)')
    con.commit()
    con.close()
    if os.path.exists(caminho):
        os.remove(caminho)
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(caminho))


def grava_csv(rows, caminho):
    with io.open(caminho, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUNAS)
        w.writeheader()
        w.writerows(rows)


def grava_dblib(caminho, sqlite_unc):
    """O .DbLib e um INI. As chaves abaixo sao as que o Altium le para saber a conexao,
       a tabela, e como mapear coluna -> simbolo / footprint / parametro."""
    L = []
    L.append('[OutputJob]')
    L.append('')
    L.append('[DatabaseLinks]')
    L.append('ConnectionString=Driver={SQLite3 ODBC Driver};Database=%s;' % sqlite_unc)
    L.append('AddMode=3')
    L.append('RemoveMode=1')
    L.append('UpdateMode=2')
    L.append('ViewMode=0')
    L.append('LeftQuote=[')
    L.append('RightQuote=]')
    L.append('QuoteTableNames=1')
    L.append('UseTableSchemaName=0')
    L.append('DefaultColumnType=VARCHAR(255)')
    L.append('LibraryDatabaseType=')
    L.append('LibraryDatabaseName=')
    L.append('LibraryDatabaseSchemaName=')
    L.append('LibraryDatabaseTableName=')
    L.append('LibraryDatabaseTableNameFields=')
    L.append('TopPanelCollapsed=0')
    L.append('LibrarySearchPath=')
    L.append('OrcadMultiValueDelimiter=')
    L.append('SearchSubDirectories=0')
    L.append('SchemaName=')
    L.append('LastFocusedTable=Components')
    L.append('')
    L.append('[Table1]')
    L.append('SchemaName=')
    L.append('TableName=Components')
    L.append('Enabled=True')
    L.append('UserWhere=0')
    L.append('UserWhereText=')
    L.append('Key=Chave')
    L.append('BrowserOrder_Sorting=Simbolo')
    L.append('ComponentIdKey=Chave')
    L.append('LibraryPathKey=')
    L.append('LibraryRefKey=Simbolo')
    L.append('FootprintKey=Footprint')
    L.append('DesignatorKey=Designator')
    L.append('CommentKey=Comment')
    L.append('DescriptionKey=Descricao')
    # mapeamento coluna -> parametro do componente
    for i, campo in enumerate(PARAMETROS, 1):
        L.append('')
        L.append('[Table1Field%d]' % i)
        L.append('FieldName=%s' % campo)
        L.append('AliasName=%s' % campo)
        L.append('UpdateComponent=1')
        L.append('AddToComponent=1')
        L.append('VisibleOnAdd=%d' % (1 if campo in ('Value', 'Estoque', 'Local') else 0))
        L.append('DefaultUpdateAction=2')
    io.open(caminho, 'w', encoding='utf-8', newline='\r\n').write('\n'.join(L) + '\n')


def gera(log=print):
    if not os.path.isdir(DEST):
        os.makedirs(DEST)
    acervos = [('basicos', le_espelho(os.path.join(LIBS, 'almox-basicos.js'))),
               ('especiais', le_espelho(os.path.join(LIBS, 'almox-especiais.js')))]
    rows = linhas(acervos)
    sq = os.path.join(DEST, 'almox.sqlite')
    grava_sqlite(rows, sq)
    grava_csv(rows, os.path.join(DEST, 'almox.csv'))
    grava_dblib(os.path.join(DEST, 'ALMOX.DbLib'), UNC + r'\almox.sqlite')
    com = sum(1 for r in rows if r['EmEstoque'] == 'TRUE')
    log('ALMOX.DbLib            %d linhas (%d com saldo), tabela em almox.sqlite'
        % (len(rows), com))
    return rows


if __name__ == '__main__':
    sys.exit(0 if gera() else 1)
