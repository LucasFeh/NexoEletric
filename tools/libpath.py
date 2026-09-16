# -*- coding: utf-8 -*-
"""Onde está a biblioteca da casa — uma ordem só, para todo mundo.

Antes deste módulo havia QUATRO resolvedores independentes, com três pisos
diferentes: `sch_leitor.LIB_PADRAO` (Y:), `schlib_escritor.LIB_REAL` (a UNC do PC do
Lucas), `guardiao.config_casa` e `symserver._config`. O sintoma disso é medido: o
botão de sincronismo do `hubserver.py` reciclava de uma cópia e o do guardião de
outra — as duas com o mesmo nome, quatro dias e três saves de distância.

E nenhum dos pisos existia no servidor. `Y:` é um mapeamento de máquina e
`\\\\LUCAS-PC\\D` é o disco de um PC; o hub roda num container Linux que, por
desenho, não alcança nada fora dele — só serve. A biblioteca da casa por isso
passou a viajar DENTRO do repositório, em `Libs/BIBLIOTECA DE ESQUEMA.SchLib`
(1,7 MB, `*.SchLib binary` no .gitattributes), publicada a cada sincronismo.

A ordem, valendo para leitura de SchLib e de PcbLib:

    1. o caminho explícito que o chamador passou   (--lib, um teste, uma rota)
    2. a variável de ambiente                      (ALTIUMHUB_SCHLIB / _PCBLIB)
    3. `tools/symbols/config.json` — **só se o arquivo existir**
    4. a cópia publicada dentro do repositório     (o piso, sempre existe)

O passo 3 é o truque que faz a MESMA ordem servir às duas máquinas sem um único
`if platform`. Na bancada, `Y:\\...` existe e ganha: quem edita símbolo continua
editando a biblioteca viva, com o History do Altium e o Backup-hub de lá. No
servidor, `posixpath` não reconhece `Y:\\...` como absoluto, o `isfile` dá False
sem exceção nenhuma, e a ordem cai sozinha na cópia publicada. Consequência
prática grande: o `tools/symbols/config.json` congelado em `shared/` pelo
`deploy.sh` pode continuar apontando para `Y:` para sempre — o valor morto é
ignorado por não existir, e ninguém precisa editar nada à mão no servidor.

O passo 3 também faz `os.path.join(raiz, valor)`, então um caminho RELATIVO à raiz
do repositório funciona no config. Não quebra os absolutos: `ntpath.join('D:\\r',
'Y:\\x')` devolve `'Y:\\x'` intacto.

**Nenhuma constante de módulo deve chamar `schlib()`/`pcblib()`.** O passo 3 faz
`os.path.isfile` num caminho de rede, e um `stat` em share fora do ar custou 1054
ms medidos — pago em tempo de import, isso entraria no boot do hubserver, em cada
subprocesso do sincronismo e em cada teste, e ainda congelaria o valor do momento
do import como default de função. Para constante existe `repo_schlib()`, que é só
um `os.path.join`. A ordem completa se resolve DENTRO das funções.

A cópia publicada é **somente leitura**: quem escreve nela é o `publica()` daqui,
a partir da lib viva. `e_publicada()` existe para as rotas de escrita recusarem — sem
isso, o "Salvar" do editor de símbolos no servidor gravaria dentro da release, que
o deploy seguinte apaga com um `rm -rf`.
"""
import os
import re
import shutil
import time

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)

CONFIG = os.path.join('tools', 'symbols', 'config.json')
SCHLIB_REPO = os.path.join('Libs', 'BIBLIOTECA DE ESQUEMA.SchLib')
# A PcbLib da casa tem 63 MB e NÃO é versionada (52 MiB permanentes no pack, e a
# release do servidor iria de 14 para 77 MB, cinco vezes, dentro do share do ERP).
# Ela já chega ao servidor por outro caminho: `copia_pcblib` a deixa em Libs/Almox,
# que o deploy.sh trata como diretório compartilhado. O piso aponta para lá, e com
# origem == alvo a cópia vira no-op em vez de copiar 63 MB em cima de si mesma.
PCBLIB_REPO = os.path.join('Libs', 'Almox', 'FOOTPRINTS ALMOX.PcbLib')

ENV_SCHLIB = 'ALTIUMHUB_SCHLIB'
ENV_PCBLIB = 'ALTIUMHUB_PCBLIB'

MAGIA_OLE = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'    # cabeçalho do contêiner CFBF

# Procedências devolvidas por `resolve`. Só duas interessam a quem chama:
#   VIVA       o config apontou para um arquivo que existe — a bancada
#   SEM_VIVA   o config apontou para algo que NÃO existe — a lib da casa está fora
#              do ar e estamos usando a última publicação. É a única que merece
#              ATENÇÃO no log; antes deste módulo ela sumia num fallback silencioso
#              e o gerador entregava .SchLib de folha preta reportando ok:true.
EXPLICITO, ENV, VIVA, PUBLICADA, SEM_VIVA = 'explicito', 'env', 'viva', 'publicada', 'sem-viva'

# `isfile` que deu False num caminho de rede fica no bolso por um tempo: é o caso
# caro (1054 ms), é o que se repete (toda entrada na aba Biblioteca) e 30 s é curto
# o bastante para o share voltar sem ninguém reiniciar nada. O True não é guardado —
# `stat` em share de pé é barato, e guardar diria "a lib existe" depois de ela sair.
_TTL_AUSENTE = 30.0
_ausentes = {}


def _existe(caminho):
    agora = time.time()
    quando = _ausentes.get(caminho)
    if quando is not None and agora - quando < _TTL_AUSENTE:
        return False
    ok = os.path.isfile(caminho)
    if ok:
        _ausentes.pop(caminho, None)
    else:
        _ausentes[caminho] = agora
    return ok


def esquece_ausentes():
    """zera o cache do `isfile` — para os testes e para quem acabou de montar o share"""
    _ausentes.clear()


def _cfg(raiz):
    """o config.json da raiz, ou {}. Leitura local e barata; sem cache de propósito,
    porque trocar o caminho no arquivo tem que valer na próxima chamada."""
    import json
    try:
        with open(os.path.join(raiz, CONFIG), encoding='utf-8') as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        return {}
    return cfg if isinstance(cfg, dict) else {}


def repo_schlib(raiz=RAIZ):
    """a cópia publicada, sem tocar no disco — para constante de módulo"""
    return os.path.join(raiz, SCHLIB_REPO)


def repo_pcblib(raiz=RAIZ):
    return os.path.join(raiz, PCBLIB_REPO)


_RX_WIN_ABS = re.compile(r'^(?:[A-Za-z]:[\\/]|\\\\)')


def _de_outra_maquina(v):
    """o valor é absoluto num sistema que não é este?

    `Y:\\Biblioteca\\...` visto do Linux é isso: a declaração da BANCADA, não uma
    biblioteca que sumiu. A diferença importa porque só uma das duas merece alarme. Sem
    ela, o servidor — cujo `config.json` congelado em `shared/` declara o `Y:` para
    sempre, de propósito — gritaria "a SchLib da casa está fora de alcance" em todo
    sincronismo, e um alarme que toca sempre deixa de servir para o caso que importa: o
    share caindo na bancada."""
    if os.path.isabs(v):
        return False
    return bool(_RX_WIN_ABS.match(v)) or v.startswith('/')


def viva(raiz=RAIZ, chave='schlib'):
    """o caminho da biblioteca VIVA como o config o declara, exista ou não ('' se o config
    não declara). Relativo é resolvido contra a raiz; caminho de outra máquina volta CRU —
    juntá-lo com a raiz produziria `/srv/altiumhub/current/Y:\\Biblioteca\\...`, um caminho
    que não existe em lugar nenhum e que ia parar no log e na tela."""
    v = (_cfg(raiz).get(chave) or '').strip()
    if not v:
        return ''
    if _de_outra_maquina(v) or os.path.isabs(v):
        return v
    return os.path.join(raiz, v)


def _resolve(raiz, chave, env, piso, explicito=None):
    if explicito:
        return explicito, EXPLICITO          # nem precisa existir: os testes contam com isso
    v = (os.environ.get(env) or '').strip()
    if v and _existe(v):
        return v, ENV
    cru = (_cfg(raiz).get(chave) or '').strip()
    if not cru:
        return piso, PUBLICADA
    if _de_outra_maquina(cru):
        return piso, PUBLICADA               # config da bancada lido de outro sistema: silêncio
    alvo = viva(raiz, chave)
    if _existe(alvo):
        return alvo, VIVA
    return piso, SEM_VIVA                    # aqui sim: declarada para ESTA máquina, e não está lá


def resolve_schlib(raiz=RAIZ, explicito=None):
    """-> (caminho, procedência)"""
    return _resolve(raiz, 'schlib', ENV_SCHLIB, repo_schlib(raiz), explicito)


def resolve_pcblib(raiz=RAIZ, explicito=None):
    return _resolve(raiz, 'pcblib', ENV_PCBLIB, repo_pcblib(raiz), explicito)


def schlib(raiz=RAIZ, explicito=None):
    return resolve_schlib(raiz, explicito)[0]


def pcblib(raiz=RAIZ, explicito=None):
    return resolve_pcblib(raiz, explicito)[0]


def _mesmo(a, b):
    """mesmo arquivo? Compara por `abspath` E por `realpath`, porque no servidor a raiz é
    `/srv/altiumhub/current`, um symlink para `releases/<hash>`: se um lado for resolvido e
    o outro não, a comparação falha e a trava de escrita desarma calada."""
    for f in (os.path.abspath, os.path.realpath):
        if os.path.normcase(os.path.normpath(f(a))) == os.path.normcase(os.path.normpath(f(b))):
            return True
    return False


def e_publicada(raiz, caminho):
    """é exatamente a cópia publicada? É esta a pergunta da trava de escrita e da vigia
    do ledger — não "está dentro do repositório", que daria falso positivo em todo
    workspace temporário de teste (os testes montam a raiz num tmp e a lib dentro dele)."""
    return bool(caminho) and _mesmo(caminho, repo_schlib(raiz))


# ─── publicação ──────────────────────────────────────────────────────────────
def _e_cfbf(caminho):
    try:
        with open(caminho, 'rb') as f:
            return f.read(8) == MAGIA_OLE
    except OSError:
        return False


def _mesmos_bytes(a, b):
    try:
        if os.path.getsize(a) != os.path.getsize(b):
            return False
    except OSError:
        return False
    with open(a, 'rb') as fa, open(b, 'rb') as fb:
        while True:
            pa, pb = fa.read(1 << 20), fb.read(1 << 20)
            if pa != pb:
                return False
            if not pa:
                return True


def publica(raiz=RAIZ, log=print):
    """Traz a biblioteca viva para dentro do repositório, se ela mudou.

    Roda no começo de cada sincronismo. Sem um passo de publicação a cópia
    versionada viraria a próxima `\\\\LUCAS-PC\\D` — que divergiu da lib viva em
    quatro dias e três saves sem ninguém notar, porque nada no repositório copiava
    entre as duas.

    Devolve {'publicou', 'motivo', 'origem', 'alvo', 'bytes'}. Nunca levanta: um
    sincronismo não pode morrer porque o share caiu — quem cuida disso é o aviso.
    """
    alvo = repo_schlib(raiz)
    origem = viva(raiz)
    if not origem:
        return {'publicou': False, 'motivo': 'config nao declara a lib viva', 'origem': '', 'alvo': alvo}
    # `e_publicada`, e não "está dentro do repositório": no Linux o `Y:\...` do config não
    # tem barra nenhuma e um teste de contenção o daria como sendo a própria cópia,
    # mascarando "lib viva fora de alcance" com um motivo falso.
    if e_publicada(raiz, origem):
        return {'publicou': False, 'motivo': 'a lib viva ja e a do repositorio', 'origem': origem, 'alvo': alvo}
    if not _existe(origem):
        return {'publicou': False, 'motivo': 'lib viva fora de alcance', 'origem': origem, 'alvo': alvo}
    tmp = '%s.%d.tmp' % (alvo, os.getpid())   # o sincronismo da CLI e o do hub são processos diferentes
    try:
        if os.path.isfile(alvo) and _mesmos_bytes(origem, alvo):
            return {'publicou': False, 'motivo': 'ja publicada', 'origem': origem, 'alvo': alvo}
        d = os.path.dirname(alvo)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        shutil.copy2(origem, tmp)
        # Conferir o QUE FOI COPIADO, não a origem: a magia do CFBF já está no lugar desde o
        # primeiro byte, então checá-la antes da cópia não diz nada sobre um save do Altium
        # em andamento — e o que viaja no push é o resultado, não a origem.
        if not _e_cfbf(tmp) or os.path.getsize(tmp) != os.path.getsize(origem):
            os.remove(tmp)
            log('   ATENCAO: a copia da biblioteca da casa saiu inconsistente '
                '(a lib viva estava sendo gravada?); publicacao cancelada')
            return {'publicou': False, 'motivo': 'copia inconsistente', 'origem': origem, 'alvo': alvo}
        # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
        os.replace(tmp, os.path.realpath(alvo))
    except OSError as e:
        # O contrato é não levantar: quem chama (guardiao.sincroniza) conta com isso para o
        # share caindo não derrubar a rodada inteira antes do gerador.
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        log('   ATENCAO: nao consegui publicar a biblioteca da casa (%s)' % e)
        return {'publicou': False, 'motivo': str(e), 'origem': origem, 'alvo': alvo}
    n = os.path.getsize(alvo)
    log('publicando a biblioteca da casa: %s -> %s (%d bytes)'
        % (origem, os.path.relpath(alvo, raiz), n))
    return {'publicou': True, 'motivo': '', 'origem': origem, 'alvo': alvo, 'bytes': n}
