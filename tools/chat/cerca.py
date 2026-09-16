# -*- coding: utf-8 -*-
"""A cerca do motor CLI: um hook PreToolUse do Claude Code, em stdlib pura.

    python cerca.py <pasta-do-projeto-aberto> [escrita] [memoria]  ← é assim que o CLI o chama
    decide(nome, entrada, pasta, escrita, memoria) -> (None|'deny', motivo)

POR QUE ISTO EXISTE, e por que não é o `operador.py`. No motor da API as ferramentas eram
minhas: o modelo só alcançava o que o `operador.py` oferecia, e escrita nenhuma virava disco
sem o clique do usuário. No motor CLI as ferramentas são as do Claude Code — Read, Edit,
Bash, Grep — e elas gravam de verdade, na máquina que roda o hubserver. O que sobra de cerca
é isto aqui: um hook que o CLI consulta ANTES de cada ferramenta e que pode dizer "não".

MEDIDO nesta bancada em 2026-09-16, com o CLI 2.1.260 (é o que autoriza o /estado a dizer
"cerca: hook" em vez de "cerca: prompt + modo"):

  o hook roda        `--settings` com um JSON de `hooks.PreToolUse` é lido e o comando é
                     executado. Ele chega pelo stdin com {tool_name, tool_input, cwd,
                     permission_mode, session_id, tool_use_id}.
  o "deny" pega      um Write em Projects/OUTRO/nota.txt, em `--permission-mode acceptEdits`,
                     NÃO criou o arquivo: o modelo recebeu o tool_result com is_error e a
                     frase do `permissionDecisionReason`, e disse ao usuário que o caminho
                     estava fora do projeto aberto.
  o Bash passava     o mesmo turno pedindo `echo oi > Projects/OUTRO/bash.txt` pelo Bash, com
                     a cerca só em Write|Edit, CRIOU o arquivo — em acceptEdits, com
                     `--permission-prompts none`, o Bash nem prompt gera. É por isso que
                     aqui a cerca é uma LISTA DO QUE PODE e não uma lista do que não pode:
                     ferramenta que escreve sem se chamar Write existe, e ferramenta nova
                     numa versão nova do CLI também vai existir.

A EXCEÇÃO DA MEMÓRIA, e por que ela é de UM ARQUIVO SÓ.
O dono do sistema pediu que o chat aprendesse e guardasse o que aprendeu para a próxima
conversa (2026-09-16). O caderno onde isso fica é `.chat/memoria.md`, que está FORA da pasta
do projeto aberto — sem exceção nenhuma, a cerca o recusa e o pedido não acontece. Então a
exceção existe, e é o caminho EXATO daquele arquivo, comparado arquivo com arquivo: nunca a
pasta `.chat/`, que é onde moram as conversas inteiras e os prints de tela do usuário; nunca
um padrão de nome, que casaria com o arquivo de amanhã que ninguém pensou. Um arquivo, um
caminho, vindo de fora (o `chatserver.py` é quem sabe qual é a raiz deste hub).
Ela vale só quando o modo deixa escrever: em "Só planejar" nem a memória é gravada, porque o
seletor do painel promete ao usuário que aquele turno não grava NADA.

A CERCA NUNCA DIZ "allow". Só "deny" ou nada.
Dizer "allow" num hook PreToolUse ATROPELA o modo de permissão — um "allow" num Write faria
o modo "Só planejar" gravar arquivo, que é exatamente a promessa que o seletor do painel faz
ao usuário. Sem decisão nenhuma (saída vazia, código 0) o CLI segue o fluxo normal e o modo
continua mandando. Assim esta cerca só consegue TIRAR permissão, nunca dar.
"""
import json
import os
import sys

# O que passa sem a cerca ter opinião: ferramenta que lê, procura ou organiza a lista de
# tarefas do próprio modelo. Nada aqui toca disco fora da área do próprio CLI.
LEITURA = ('Read', 'NotebookRead', 'Glob', 'Grep', 'TodoWrite', 'ToolSearch')

# O que escreve, e o campo onde o caminho vem. É a única família que a cerca deixa passar
# CONDICIONALMENTE — dentro da pasta do projeto aberto, e só quando o modo permite escrever.
ESCRITA = (('Write', 'file_path'), ('Edit', 'file_path'), ('MultiEdit', 'file_path'),
           ('NotebookEdit', 'notebook_path'))

FRASE_FORA = ('CERCA DO HUB: este chat só pode escrever dentro de %s, que é a pasta do '
              'projeto aberto na tela do usuário. O caminho "%s" está fora dela e a gravação '
              'foi recusada. Se o trabalho é em outro projeto, peça ao usuário para abri-lo '
              'no hub.')
FRASE_SEM_PROJETO = ('CERCA DO HUB: não há projeto aberto na tela do usuário, então não há '
                     'onde gravar. Peça a ele para abrir um projeto no hub antes de qualquer '
                     'edição.')
FRASE_SO_LEITURA = ('CERCA DO HUB: este turno está no modo "Só planejar", que lê e propõe mas '
                    'não grava. Isto vale inclusive para o arquivo de plano do Claude Code, e '
                    'não é problema: quem lê você é uma pessoa num painel, e o plano é a sua '
                    'resposta em texto. Diga o que faria e em que arquivo; quem troca o modo é '
                    'o usuário, no seletor do painel.')
FRASE_FERRAMENTA = ('CERCA DO HUB: a ferramenta "%s" não é usada pelo chat do hub e foi '
                    'recusada. Aqui você tem Read, Glob e Grep para ver o projeto, e '
                    'Write/Edit para gravar dentro da pasta do projeto aberto (e no seu '
                    'caderno, .chat/memoria.md). Comando de sistema (Bash, PowerShell) não '
                    'passa: o hub roda na máquina do servidor, e ninguém está olhando o '
                    'terminal dela.')


def _normal(caminho):
    """um caminho comparável: absoluto, sem `..`, com as barras e a caixa do sistema.

    `normcase` não é enfeite no Windows: `d:\\projects\\x` e `D:\\Projects\\X` são o MESMO
    arquivo, e uma cerca que compara texto cru é uma cerca que se abre trocando uma letra
    de maiúscula.
    """
    return os.path.normcase(os.path.abspath(os.path.normpath(caminho or '')))


def mesmo_arquivo(a, b):
    """é o MESMO arquivo? (comparação de caminho, não de pasta — é a exceção da memória)

    Compara também os dois `realpath`: no servidor `.chat/` é symlink para `shared/.chat/`, e
    o mesmo arquivo tem dois nomes. Resolver os dois lados continua sendo UM arquivo — o que
    não pode acontecer é isto virar comparação de prefixo, que abriria a pasta inteira.
    """
    if not a or not b:
        return False
    if _normal(a) == _normal(b):
        return True
    try:
        return _normal(os.path.realpath(a)) == _normal(os.path.realpath(b))
    except (OSError, ValueError):
        return False


def dentro(caminho, pasta):
    """o caminho está DENTRO da pasta? (a própria pasta conta)

    A comparação é por componente (`commonpath`) e não por prefixo de texto: `Projects/PRJ`
    é prefixo de texto de `Projects/PRJ-OUTRO`, e um `startswith` deixaria o vizinho entrar.
    """
    if not pasta:
        return False
    a, b = _normal(caminho), _normal(pasta)
    if a == b:
        return True
    try:
        return os.path.commonpath([a, b]) == b
    except ValueError:
        return False            # unidades diferentes no Windows: não há caminho comum


def decide(nome, entrada, pasta, escrita=True, memoria=''):
    """(None, '') deixa o CLI seguir; ('deny', motivo) recusa.

    `pasta` é a pasta do projeto aberto (vazia = nenhum projeto aberto).
    `escrita` é False no modo "Só planejar": aí nem dentro da pasta se grava.
    `memoria` é o caminho do caderno do chat — o único arquivo de fora que pode ser gravado.
    """
    entrada = entrada if isinstance(entrada, dict) else {}
    if nome in LEITURA:
        return None, ''
    for alvo, campo in ESCRITA:
        if nome != alvo:
            continue
        if not escrita:
            return 'deny', FRASE_SO_LEITURA
        caminho = entrada.get(campo) or ''
        if not isinstance(caminho, str):
            caminho = ''
        # A EXCEÇÃO, e ela é a PRIMEIRA porque a memória não é de projeto nenhum: vale
        # inclusive quando não há projeto aberto na tela (o caderno é do chat, não da placa).
        # Um arquivo, comparado por caminho — ver o cabeçalho.
        if mesmo_arquivo(caminho, memoria):
            return None, ''
        if not pasta:
            return 'deny', FRASE_SEM_PROJETO
        if not caminho.strip():
            return 'deny', FRASE_FORA % (pasta, '(sem caminho)')
        if not dentro(caminho, pasta):
            return 'deny', FRASE_FORA % (pasta, caminho)
        return None, ''
    # NADA MAIS PASSA. Bash e PowerShell escrevem em qualquer lugar sem se chamar Write
    # (medido: escreveram), e ferramenta que ainda não existe também vai escrever. Uma cerca
    # que enumera o que é proibido perde para a próxima versão do CLI; uma que enumera o que
    # é permitido, não.
    return 'deny', FRASE_FERRAMENTA % (nome or '(sem nome)')


def resposta(veredito, motivo):
    """o JSON que o CLI lê no stdout do hook — ou '' quando a cerca não tem opinião"""
    if veredito != 'deny':
        return ''
    return json.dumps({'hookSpecificOutput': {
        'hookEventName': 'PreToolUse',
        'permissionDecision': 'deny',
        'permissionDecisionReason': motivo}}, ensure_ascii=False)


def main(argv, entrada_bruta):
    """argv: [pasta_do_projeto, '1'|'0' para escrita, caminho_da_memoria]. Nunca levanta.

    Hook que estoura é hook que não decide nada, e o CLI segue em frente: uma cerca que cai
    é uma cerca aberta. Por isso o `except` largo — e por isso ele FECHA (deny) em vez de
    abrir, quando o defeito é aqui dentro.
    """
    pasta = argv[0] if argv else ''
    escrita = (argv[1] if len(argv) > 1 else '1') not in ('0', 'false', 'nao', 'não')
    # sem o terceiro argumento não há exceção nenhuma: cerca velha, ou chamada à mão, fecha
    memoria = argv[2] if len(argv) > 2 else ''
    try:
        d = json.loads(entrada_bruta or '{}')
        if not isinstance(d, dict):
            d = {}
        veredito, motivo = decide(d.get('tool_name') or '', d.get('tool_input'),
                                  pasta, escrita, memoria)
    except Exception as e:                                       # noqa: BLE001
        return resposta('deny', 'CERCA DO HUB: a cerca do chat falhou por dentro (%s) e por '
                                'isso recusou esta ferramenta. Avise o usuário.'
                                % type(e).__name__)
    return resposta(veredito, motivo)


if __name__ == '__main__':                                       # pragma: no cover
    fora = main(sys.argv[1:], sys.stdin.read())
    if fora:
        sys.stdout.write(fora)
    sys.exit(0)
