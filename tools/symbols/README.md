# symbols — símbolos de esquema sem abrir o Altium

Ferramentas Python que leem e escrevem símbolos de esquema direto nos arquivos do Altium
(`.SchLib`, `.SchDoc`, `.IntLib`), para a sub-aba **Símbolos** da aba Biblioteca do hub.

| Arquivo | Papel |
|---|---|
| `sch_leitor.py` | registros Altium → símbolos `schlib-v2` (o vocabulário do hub); regera `Libs/schlib.js` |
| `extrair.py` | varre a biblioteca e os projetos, deduplica e mescla na **Biblioteca de símbolos** |
| `schlib_patch.py` | grava a geometria de um símbolo dentro da SchLib real |
| `symserver.py` | os endpoints `/api/symbols/*` do hub |
| `config.json` | onde estão a SchLib real, o backup e as pastas a varrer |

Este README é sobre o `extrair.py` e a biblioteca que ele produz. Nada aqui é pacote: cada
módulo põe `tools/almox` e `tools/symbols` no `sys.path`, como o `schlib_escritor.py`.

## O que a extração faz

```
python tools/symbols/extrair.py                         # tudo do config.json -> Libs/symbols-lib.js
python tools/symbols/extrair.py --so schdoc --limite 5  # só 5 .SchDoc, para experimentar
python tools/symbols/extrair.py --fonte "Y:\EQUIPAMENTOS_REVISADOS\X" --saida /tmp/x.js --relatorio /tmp/x.txt
```

Anda as `fontes` do `config.json`, lê cada `.SchLib`, `.SchDoc` e `.IntLib`, fica **só com a
geometria** — pinos e gráficos; nada de descrição, parâmetro ou footprint — e mescla no
`Libs/symbols-lib.js`. Um arquivo ilegível vai para o log e para o relatório; a varredura segue.

Pasta cujo nome **começa** com uma entrada de `ignorar` não é aberta (`History`, `__Previews`,
`Project Outputs`, `Project Logs`, `Backup-hub` — por prefixo porque o Altium chama a pasta de
saída de `Project Outputs for <Projeto>`). A `backup_dir` do config também fica de fora, seja
qual for o nome: é onde o hub guarda as 30 cópias anteriores da SchLib a cada Salvar, e lê-las
ressuscitaria geometria que o usuário já mudou. O mesmo arquivo alcançado por duas fontes (ou
listado duas vezes) é lido uma vez só.

O log sai em stdout, uma linha por arquivo, com flush — é o que o hub mostra ao vivo por SSE:

```
fontes: Y:\Biblioteca\ALTIUM LIBRARY ------ LUCAS; Y:\EQUIPAMENTOS ATUALIZADOS; ...
biblioteca atual: 431 símbolos
1043 arquivo(s): 12 .SchLib, 991 .SchDoc, 40 .IntLib
  [1/1043] BIBLIOTECA DE ESQUEMA.SchLib — 742 componentes
  [2/1043] CND.SchDoc — 15 componentes
  [3/1043] X.SchDoc — ILEGÍVEL: not an OLE2 structured storage file
  ...
37 novo(s), 8812 repetido(s) em 1043 arquivo(s), 1 ilegível(is)
classificação (nome básico -> quantos):
    135  Conector 1 via
  ...
468 símbolos -> D:\...\Libs\symbols-lib.js (relatório em D:\...\tools\symbols\relatorio.txt)
```

Opções: `--config` (default `tools/symbols/config.json`), `--saida` (default
`Libs/symbols-lib.js`), `--relatorio` (default `tools/symbols/relatorio.txt`), `--so
schlib|schdoc|intlib`, `--limite N` (só os N primeiros arquivos, na ordem da varredura),
`--fonte CAMINHO ...` (arquivos ou pastas no lugar das fontes do config), `--sem-tabela`.

## O arquivo é ESTADO: a extração mescla, nunca reescreve

`Libs/symbols-lib.js` (formato `symlib-v1`, versionado, um símbolo por linha):

```js
var symbolsLib = {
"format":"symlib-v1",
"generated":"2026-09-03 12:00",
"units":"mil",
"symbols":[
{"id":"s0001","name":"Resistor","kind":"generico","fp":"3f2a…","aliases":["RES [ SMD ]","RES [ PTH ]"],"fontes":["BIBLIOTECA DE ESQUEMA.SchLib","CND.SchDoc"],"usos":14,"desde":"2026-09-03","pins":[…],"graphics":[…]}
,{"id":"s0002","name":"SN74HC245DWR","kind":"ci",…}
]};
```

- **Um símbolo = uma parte.** Componente multi-part vira uma entrada por parte; quando as
  partes têm a mesma geometria (as 80 do `CONECTOR PADRÃO`, os contatos de um relé) elas se
  fundem numa só, com um alias por parte.
- `id` (`s0001`…) é dado uma vez e nunca reutilizado — os novos entram **ordenados por nome**,
  numerados depois do maior id existente. Rodar a extração duas vezes sobre a mesma fonte não
  adiciona nada (`novos == 0`) e não muda id nem nome de ninguém.
- `name` é do usuário: renomear pelo hub sobrevive a qualquer extração seguinte. Nomes são
  únicos. Duas formas diferentes com o mesmo nome básico: a que veio da SchLib oficial
  (`config.json » schlib`) e, entre as outras, a mais usada fica com o nome limpo; as demais
  levam a origem entre parênteses — `Resistor (RES PTH)` diz de onde veio, ` #2` não diz — e
  só quando nem isso desempata entra ` #2`, ` #3`. Como o nome nunca muda depois, a primeira
  extração deve ser completa (o botão do hub com limite pequeno decide nomes com pouca
  informação).
- `fp` é a chave da deduplicação (abaixo); `aliases` são os `LibReference` de origem que caíram
  nesse fingerprint (multi-part: `Nome · parte N/M`); `fontes` são os arquivos (só o nome) onde
  apareceu; `usos` conta ocorrências — uma fonte já vista numa rodada anterior **não** conta de
  novo, então re-extrair não dobra a conta (arquivo editado desde então fica subcontado, e
  tudo bem; e como `fontes` guarda só o basename, um projeto novo com um `Sheet1.SchDoc` também
  não conta se outro `Sheet1.SchDoc` já passou); `desde` é a data em que entrou.
- Um `symbols-lib.js` editado à mão com id fora do padrão/repetido, nome vazio/repetido ou `fp`
  ausente é consertado no lugar (id novo, nome único, fp recalculado) e o conserto vai para o
  log — nunca descartado, porque descartar apaga o símbolo do usuário. Só entrada sem
  `pins`/`graphics` fica de fora.
- `pins`/`graphics` estão no vocabulário do `Libs/schlib.js` (`schlib-v2`), já normalizados.

A gravação é atômica (`.tmp` + `os.replace`).

## Fingerprint: o que é "o mesmo símbolo"

`normaliza(pins, graphics)` arredonda coordenadas a **1 mil** e ângulos a 0,01°, ordena os
pinos por (x, y) e põe os gráficos em ordem canônica. **Não recentra**: a origem do Altium é a
âncora do símbolo na folha e faz parte da identidade — o mesmo desenho deslocado 10 mil é
outro símbolo.

Cada forma tem uma escrita só, porque o mesmo desenho chega escrito de vários jeitos — da
biblioteca de um jeito, de um componente colocado numa folha (que `sch_leitor.localiza` devolve
girado/espelhado) de outro:

- `line`: os dois extremos em ordem (uma linha não tem sentido);
- `rect`: canto inferior-esquerdo e superior-direito (o componente espelhado devolve os cantos
  trocados). **`w` de rect não entra na identidade**: o leitor nunca o emite e o hub sempre —
  entrasse, o "+ corpo atual" salvo pelo hub nunca casaria com o extraído;
- `arc`: `sa` em [0, 360) e `ea = sa + vão` — `270→90` e `270→450` são o mesmo arco (a lib
  escreve o que cruza 0° com `sa > ea`; o `localiza` com `ea > 360`); vão 0 é círculo, `0→360`;
- `polyline`: a menor entre a sequência e a invertida; `poly`: idem, entre todas as rotações
  (um polígono não tem começo), sem o fecho explícito (último = primeiro).

`fingerprint(pins, graphics, kind)` é o sha1 (16 hex) do JSON canônico disso:

- `generico`: gráficos + pinos por (x, y, len, orient). Número e nome do pino **não** entram —
  `RES [ SMD ]` e `RES [ PTH ]` são a mesma coisa, e um resistor com pinos "1/2" ou "A/B" também.
- `ci`: gráficos + pinos por (x, y, len, orient, **num, name**) — num CI a pinagem é o símbolo.

## `kind`: genérico até 4 pinos, CI acima

A regra é a mais simples que separa o que se **troca de corpo** (resistor, diodo, transistor,
cristal…) do que se **nomeia pelo CI**: `generico` quando a parte tem até 4 pinos, `ci` quando
tem mais. Os poucos blocos retangulares de 4 pinos (conversores DC/DC, pontes) ficam genéricos
com o nome de origem em `aliases` — o usuário renomeia se quiser. Um CI multi-part cuja parte
tem 3 pinos (um amp-op do LM324) também cai em genérico, com o nome `LM324 · parte 2/4`.

## Classificação por forma (heurística)

`classifica(pins, graphics, nome_origem)` dá o nome básico **pela forma**, não pelo nome de
origem — o nome de origem só serve de reserva. Cada regra vive numa função de `extrair.py`
(`_diodo_2`, `_caixa_2`, `_placas`, …) e o desenho é analisado num quadro em que o eixo dos
pinos é horizontal ("placa" = segmento perpendicular ao eixo; "caixa" = `rect` OU 4 linhas
fechando um retângulo).

| Nome básico | Regra (pinos; forma) |
|---|---|
| Resistor | 2; uma caixa deitada no eixo e só as pernas |
| Resistor zigue-zague | 2; uma polilinha de 6+ pontos alternando acima/abaixo do eixo |
| Fusível | 2; caixa deitada atravessada por uma linha no eixo |
| Termistor / Varistor | 2; caixa cortada por uma diagonal com um pé (NTC/PTC) / dois pés (varistor) |
| Bobina de relé | 2; caixa com diagonal de canto a canto |
| Capacitor | 2; duas placas iguais, 15–100 mil de distância |
| Capacitor polarizado | 2; uma placa reta e um arco grande do lado (eletrolítico), ou duas placas com um "+" |
| Capacitor variável | 2; duas placas atravessadas por uma seta diagonal (trimmer) |
| Cristal | 2 (ou 3 → "Cristal com terra"); duas placas com uma caixa entre elas |
| Bateria | 2; placas de tamanhos diferentes |
| Diodo | 2; triângulo apontando no eixo com uma barra no ápice |
| Diodo Schottky | idem, com ganchos paralelos ao eixo nas pontas da barra (o "S") |
| Diodo zener / Diodo TVS | idem, ganchos diagonais rasos (zener) ou a 45° (TVS) |
| Diodo TVS bidirecional | 2; dois triângulos contra a mesma barra |
| LED / Fotodiodo | diodo com duas diagonais fora do corpo; a cabeça da seta na ponta de fora = LED, de dentro = fotodiodo |
| Indutor | 2; 3+ arcos do mesmo raio enfileirados |
| Transformador | 4; duas fileiras desses arcos |
| Chave / Chave momentânea | 2; dois círculos pequenos e uma lâmina diagonal que nasce na borda de um (fora do círculo — a fenda do parafuso de borne fica dentro); sem lâmina, barra por cima + haste = botão |
| Chave 2 polos | 4; quatro círculos e duas lâminas |
| Transistor NPN / PNP | 3; barra + duas diagonais + um triângulo; ponta da seta longe da barra = NPN, perto = PNP |
| MOSFET N / P | 3; barra longa (gate), 2+ tocos paralelos (canal) e uma seta: ponta virada para a barra = N |
| Tiristor | 3; diodo com uma diagonal saindo do ápice/barra (gate) |
| Diodo duplo | 3; dois diodos |
| Potenciômetro / Trimpot | 3; caixa deitada com seta; diagonal cruzando a caixa = trimpot |
| Ponte retificadora | 4; quatro diodos, ou uma caixa só com pino "~" |
| Optoacoplador | 4; um diodo, mais um triângulo (a seta do fototransistor) e duas diagonais (a luz) |
| Terra | 1; três ou mais traços paralelos minguando |
| Conector N vias | um círculo/elipse pequeno por pino e nada "elétrico" em volta (cone, ponto de teste redondo, jumper) |

Sem forma reconhecida: nome de origem sem `[ SMD ]`, `[PTH]`, `SMD`, `PTH` e espaços duplos
(`CAP EL [  PTH  ]` → `CAP EL`); multi-part ganha ` · parte N/M`. Reconhecido **não** ganha
sufixo de parte (as partes iguais se fundem pelo fingerprint). Um pino com qualquer outro
desenho (borne, parafuso, ponto de teste quadrado, `Cone apont…`) fica com o nome de origem —
diz mais que um "Conector 1 via #37".

Na biblioteca local (403 componentes, 742 partes com pinos) isso dá 431 símbolos; os básicos
óbvios saem certos (RES → Resistor, CAP → Capacitor, CAP EL → Capacitor polarizado, DIODO →
Diodo, LED, ZENER → Diodo zener, Indutor magnético → Indutor, 2N3904 → Transistor NPN, BC807 →
Transistor PNP, MOSFET → MOSFET N, IRF9Z34N → MOSFET P, Cristal, FUSIVEL → Fusível). O
`tests/test_extrair.py` imprime a tabela inteira.

Limites conhecidos, de propósito: módulos AC/DC de 4 pinos com pino `~` viram "Ponte
retificadora" (é a mesma caixa); um par de contatos abertos sem lâmina (dip switch) vira
"Conector 2 vias"; triac desenhado só a linhas não é reconhecido e fica com o nome de origem.
Em todos os casos o nome de origem está em `aliases` e o usuário renomeia pelo hub.

## O save do hub e a grade de 10 mil

`symserver.py » POST /api/symbols/save` valida o pedido inteiro (forma conhecida, coordenadas
numéricas, `pts` como pares, `label` com texto) **antes** de encostar no espelho, e grava os
pinos no `Libs/schlib.js` já arredondados a 10 mil (`x`, `y`, `len`) — é o que o registro
binário de pino da SchLib comporta, então espelho e Altium dizem o mesmo número. Cada pino que
mudou vira um item de `avisos` na resposta. O patch da SchLib roda sob um lock próprio: dois
saves ao mesmo tempo reescreveriam o arquivo inteiro e o último apagaria o do primeiro.

## O que NÃO entra

- Componente sem pino (logotipo, moldura) — nada a trocar de corpo.
- Modos de exibição alternativos (`OwnerPartDisplayMode ≠ 0`) — o leitor só extrai o modo 0.
- A PcbLib embutida nos `.IntLib` (só os `SchLib/*.schlib` são inflados).

## Testes

```
python tests/test_extrair.py
```

Fixtures pequenas (fingerprint, classificação, mescla incremental, gravar/ler), depois uma
cópia da lib local `D:\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib` duas vezes
(nada novo na segunda, ids estáveis, renomear sobrevive, RES SMD/PTH = uma entrada), a CLI de
ponta a ponta no tmp, e um `.SchDoc` + um `.IntLib` reais do Y:. O que depende de arquivo que
não está lá **PULA**, não falha.
