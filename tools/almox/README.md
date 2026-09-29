# almox — o almoxarifado do Odoo virando biblioteca de esquema

Pega o dump de produtos do Odoo e monta **duas SchLib**: uma de componentes básicos e
uma de componentes especiais. A ideia é poder desenhar escolhendo do que existe no
almoxarifado, e depois cruzar o esquema exportado do Altium com o saldo real.

## O modelo

**O símbolo é o tipo do componente; a part é o valor.**

| No Odoo | Símbolo | Part |
|---|---|---|
| `Resistor Metal Filme 1.21K 1/4W 1% 100ppm SMD 1206` | `RESISTOR [SMD]` | `1.21K 1/4W 1% 100ppm` |
| (a coluna "Part" acima é hoje o **valor**, não uma part do Altium — veja abaixo) | | |
| `Resistor Fio Enrolado 0.1R/100mOhms 5W 1% 90ppm PTH` | `RESISTOR [PTH]` | `0.1R/100mOhms 5W 1% 90ppm` |
| `Conversor Murata DC/DC 24Vcc/5Vcc 2W - NMK2405SAC` | `CONVERSOR DC/DC [PINAGEM A DEFINIR]` | `24/5 2W` |

### O valor é um parâmetro, não uma part

A primeira versão usava **parts** para os valores: um símbolo com 256 partes, uma por
valor. Não serve — no Altium a parte de um componente multi-part se identifica só por
letra (A, B, C…), e o valor fica invisível justamente na hora de escolher.

Agora o símbolo tem **uma parte** (a geometria) e os valores são um **catálogo de
parâmetros** ao lado. Escolher um valor preenche `Comment`, `Value`, `Encapsulamento`,
`MPN`, `Mouser`, `OdooId`, `Estoque`, `Local`, `Custo` e `ValorId`. O Comment é o que
aparece na folha; o resto vai para o BOM.

Onde se escolhe:

- **no hub** — o picker da aba Esquema lista os valores com o saldo do lado;
- **no Altium** — o `ALMOX.DbLib`, no painel *Components*: você navega a tabela, filtra
  por valor, encapsulamento, saldo ou local, e coloca.

De quebra a `.SchLib` encolheu 8× (413 KB em vez de 3,5 MB), porque a geometria deixou
de ser duplicada uma vez por valor.

### Quem entra na biblioteca: a marca do Odoo

Só entra o produto marcado **"É componente eletrônico"** (`x_is_componente`, em
`product.template`; vira a coluna `componente` no dump). Medido em 2026-09-22: dos 4.714
produtos ativos, **2.712 têm a marca e 2.002 não**.

Isso substitui um palpite por uma afirmação. O filtro que existia — e que continua, **depois**
deste — é o `LIXO` do `familias.py`: uma lista de palavras que tenta adivinhar o que não é
componente (`parafuso`, `broca`, `ferramenta`…) e erra dos dois lados. Ela deixava passar a
`Chave Canhão 8mm Gedore` porque o nome começa com "Chave", e barrava o
`Conector DB9 com Borne Parafuso` porque tem "parafuso" no meio. Quem cadastra sabe; o
regex, não.

**Vazio não é "não".** Dump anterior a esta coluna, ou um Odoo sem a customização, não
trazem o campo — e tratar isso como "não é componente" faria a biblioteca nascer **vazia**
no primeiro sincronismo depois da atualização. Sem a marca, vale o que valia antes, e o
gerador avisa na tela que o filtro não está valendo.

**Quem perde a marca não é apagado, é desabilitado.** Vira `fora: true` com saldo zero e
**mantém o número de part** — é o mesmo caminho de quem sai do Odoo. Marcar o produto de
volta e sincronizar o traz com o mesmo número; nada renumera.

O relatório separa os dois descartes, porque só um deles tem conserto do lado de fora:

```
=== fora por nao estarem marcados "e componente eletronico" (65) ===
    marque x_is_componente no produto e sincronize de novo
  [3944] Circuito de Interface RS-485 - SN65HVD75DR
  ...
=== descartadas por nao serem componente de PCB (2117) ===
```

> **Confira a lista na primeira rodada.** Componente de verdade ainda sem a marca sai da
> biblioteca junto com o parafuso — e se ele tiver desenho protegido ou footprint escolhido
> à mão, esse trabalho fica órfão no ledger até o produto voltar.

### O conector é procurado pelo subtipo, não pelo número de vias

Até 2026-09-22 todo conector era **uma** família, `CONECTOR`, partida por número de vias na
hora de virar símbolo: `CONECTOR 2V`, `CONECTOR 3V`, … `CONECTOR 64V`. Procurar um bloco
terminal Phoenix de 4 vias queria dizer adivinhar as vias primeiro, achar `CONECTOR 4V` no
meio de 25 irmãs ordenadas `10V, 12V, 13V, …, 2V, 20V` e só então ler 25 rótulos quase
iguais. E **metade do acervo nem estava lá**: 148 dos 291 valores caíam num balde único
chamado `CONECTOR [PINAGEM A DEFINIR]`, porque o extrator de vias só conhecia a palavra
"N vias" e o Phoenix escreve a contagem no meio do part number — em `MC 1,5/ 4-G-3,81` o
**4 é a via** e o **1,5 é a bitola do cabo em mm²**.

Agora a família **é o subtipo**, que é como a bancada pede a peça:

| No Odoo | Símbolo (= a linha da busca) | Valor, na tela |
|---|---|---|
| `Conector Bloco Terminal - MC 1.5/ 4-STF-3.81 (1827729)` | `CONECTOR BLOCO TERMINAL` | `4 vias 3.81 femea` · `MC 1.5/ 4-STF-3.81` |
| `Conector Bloco Terminal MSTB 2,5/10-GF-5,08 (1776582)` | `CONECTOR BLOCO TERMINAL` | `10 vias 5.08 macho` · `MSTB 2,5/10-GF-5,08` |
| `Conector Latch 26 vias (2x13) passo 2.54mm 180°` | `CONECTOR LATCH` | `26 vias (2x13) 2.54 180°` |
| `Barra de Pinos Macho 1x40 2.54mm 90° (BPSN-40)` | `CONECTOR BARRA DE PINOS` | `40 vias (1x40) 2.54 90° macho` · `BPSN-40` |

**Um símbolo por subtipo, e o número de vias NÃO entra no nome dele.** A pinagem é atributo
do componente: o bloco terminal de 4 e o de 10 são a mesma peça com contagem diferente, e
fabricar `CONECTOR BLOCO TERMINAL 4V`, `…10V`, `…12V` só recria o labirinto num nível abaixo.
Cada valor carrega o próprio desenho em `valores[].parts`, montado a partir das vias dele —
recurso que o formato já tinha, porque na `.SchLib` cada valor **já é** um componente
próprio, com geometria própria. São **22 símbolos para 325 valores**, contra 36 antes (e 116
na primeira tentativa, que errou exatamente nisto).

Regenerar o desenho a cada sincronismo não apaga trabalho manual: o desenho editado no hub
ou adotado do Altium vive no ledger do guardião (`protegidos[família][componente]`, escrito
pelo `/save-almox`) e volta por cima deste.

São **22 subtipos** e eles cobrem o dump inteiro: BAIONETA, BARRA DE PINOS, BLOCO TERMINAL,
BORNE, CARTAO SD, CIRCULAR MIL, DB, HEADER COM TRAVA, HEADER SEM TRAVA, JACK, JST, KK,
LATCH, PLANO, PLUGUE, REGUA TERMINAL, RJ45, SOQUETE, TERRA, USB, ACESSORIO,
ACESSORIO DE PAINEL — e `CONECTOR` puro como degradê para o que nenhuma regra reconhecer.
`BARRA DE PINOS` deixou de ser família própria e virou subtipo: na bancada ela é conector.

Como a família também decide o **arquivo** (`balde_de` → `nome_arquivo`), isso dá de graça
o que o Altium precisava: **22 `.SchLib`, uma por subtipo** — `CONECTOR KK ALMOX.SchLib`,
`CONECTOR BLOCO TERMINAL ALMOX.SchLib` — em vez de um `CONECTOR ALMOX.SchLib` de 870 KB.

#### O que o extrator lê do nome

Medido contra os 618 conectores do Odoo de **produção** em 2026-09-22, no meio da faxina de
nomes — o cadastro tinha os dois padrões convivendo. O formato novo é lido inteiro:

| Campo | Como escrever | Também aceita |
|---|---|---|
| vias | `10 vias` | `10 pinos`, `10 polos`, `2-polos`, `16 Pin`, a matriz `2x5`, o `/10` do Phoenix (`MSTB 2,5/10-GF-5,08`), `-02P`, `DB9`, `DIP 40` |
| matriz | `2x5` (2 linhas × 5 colunas) | `2X5`, `(2x5)` |
| passo | `P2.54mm` | `passo 2.54mm`, `2.54mm`, o sufixo `-5,08`, e o decimal solto (`5.08 linhas`) quando o nome não tem série Phoenix |
| ângulo | `180g` / `90g` | `180°`, `180º`, `180 graus`, a palavra `Vertical` |
| gênero | `Macho` / `Femea` | o `G`/`GF` (base) e `ST`/`STF` (plugue) do Phoenix; o sufixo `P`/`S` dos circulares MIL |
| subtipo | `Header trava`, `Bloco Terminal`, `Latch`, `Kk`… | a série sozinha (`MSTB`, `MC 1,5/`, `AKZ`, `EK508`…) já identifica bloco terminal |

Duas armadilhas que o extrator conhece e que vale conhecer na hora de escrever o nome:

- **decimal antes da barra do Phoenix é bitola de cabo, não passo.** Em `MC 1,5/ 4-G-3,81`
  o `1,5` é mm² e o passo é o `3,81` do fim. Por isso o decimal solto só vale como passo
  quando não há série Phoenix no nome;
- **número entre parênteses com 6+ dígitos é número de pedido** (`(1827761)`), e é ignorado
  em vias, passo e ângulo. Série curta entre parênteses (`(2510)`, `(5051)`) é lida como
  código de tipo, que é o que separa dois alojamentos KK iguais em tudo o mais.

O subtipo é deduzido do nome do Odoo por uma tabela de regex (`conectores.SUBTIPOS`), que é
um remendo com prazo: **quando o Odoo passar a ter o campo "subtipo"**, ele vira a fonte e a
tabela vira só o degradê para o cadastro que ainda não o tiver.

**O rótulo do valor NÃO mudou, e isso é o ponto delicado.** A frase `4 vias 3.81 180°` é
montada **na tela** (`hub-almoxpick.js » linhaConn`) a partir de campos que o gerador emite
soltos em `valores[].conn` (`vias`, `matriz`, `passo`, `angulo`, `genero`, `tipo`). Ela não
pode ser o rótulo porque o rótulo é a chave do livro-razão e metade da identidade do valor
(`agrupar()` chaveia por `(rótulo, encapsulamento)`): medido no dump, essa frase se repete
em 27 dos 327 conectores, e como rótulo ela fundiria **sete** blocos terminais Phoenix
diferentes — macho e fêmea juntos — num componente só, com o estoque somado.

Campo que o Odoo não diz **não aparece**. O ângulo sai em 100 dos 327 nomes; em CIRCULAR
MIL, RÉGUA TERMINAL, SOQUETE e BAIONETA o passo e o ângulo não existem como propriedade da
peça. Deduzir o ângulo da letra `V` das séries Phoenix (`MCV`, `MSTBV`) foi medido e
**recusado**: esse V é a direção de entrada do fio, que não é o mesmo eixo do 180/90 que os
headers escrevem — preencher 70 blocos terminais com esse palpite faria a tela afirmar o
que ninguém mediu.

O extrator vive em `conectores.py`, tem teste próprio (`tests/test_conectores.py`, um caso
por armadilha real do dump) e levou o número de conectores com pinagem legível de **154 para
311 em 327** — o balde `[PINAGEM A DEFINIR]` caiu de 148 valores para 16, espalhados por
subtipo. O balde `[PINAGEM A DEFINIR]` **deixou de existir para conector**: com um símbolo
por subtipo, o valor sem pinagem legível mora no subtipo dele e apenas não ganha desenho
próprio — herda o da família. De quebra sumiu o símbolo fantasma `CONECTOR 45V`, que existia
porque o regex antigo lia o `P/` de `RJ45 P/ PCB` como "45 vias".

> **Renomear símbolo renumera o livro-razão.** `almox-parts.json` é indexado pelo nome do
> símbolo e `numera_valores` cai em `{prox:1, ids:{}}` **em silêncio** quando não acha a
> chave. Por isso a troca veio com `migra_conectores.py`, que casa velho e novo **pelo id do
> produto no Odoo** (e não pelo rótulo, que muda para quem sai dos especiais) e leva junto as
> chaves do `lib-ledger.json` — `gerado`, `protegidos` e `footprints`. Preservou **247 dos
> 326** números; os outros 78 colidiram, e a colisão é estrutural: até 15 espaços de
> numeração viram um (`BARRA DE PINOS 2V`..`10V` → `CONECTOR BARRA DE PINOS`) e todos
> começavam no 1. Quem chegou primeiro fica com o número; o resto tira do `prox`. A **data de
> entrada** não disputa e é herdada sempre, inclusive por quem perdeu o número — senão 78
> conectores que estão na biblioteca desde agosto voltariam a aparecer como recém-chegados.
> Rode-o **uma vez**, antes da primeira geração:
> `python3 tools/almox/migra_conectores.py` mostra o plano, `--aplicar` grava.

### Renomear o produto no Odoo não duplica o componente

O livro-razão chaveia o valor pelo **rótulo**, e o rótulo sai do nome do produto. Trocar o
nome no cadastro, sem mais nada, fazia duas coisas erradas ao mesmo tempo:

- nascia um componente **novo** — número novo, data de hoje, sem o footprint escolhido à mão
  nem o desenho adotado do Altium;
- o antigo ficava na lista como **`fora: true`**, saldo zero, para sempre, porque
  `numera_valores` ressuscita do espelho tudo que está em `ids` e não veio no CSV.

Uma faxina de nomes no Odoo dobrava a biblioteca. Agora o **`product_id`** é quem diz "é a
mesma peça" — ele não muda quando o nome muda:

- `almox2lib » segue_renomeacoes` roda **antes** da numeração: o número e a data de entrada
  mudam de chave, e a chave velha **sai** do livro-razão. É a saída dela que impede o zumbi.
  Vale inclusive quando o item muda de símbolo junto com o nome (um bloco terminal
  recadastrado como KK vai para `CONECTOR KK` levando o número);
- `guardiao » segue_renomeacoes` roda **antes** de julgar órfão: `protegidos` e `footprints`
  são reencontrados pelo id e mudam de chave junto, então o desenho adotado e o footprint
  manual acompanham o nome novo.

De onde vem o id: `Libs/almox-parts.json` guarda um `odoo` por símbolo (`{product_id: chave}`)
e cada entrada do `lib-ledger.json` guarda o seu. **Fica no livro-razão, e não no espelho, de
propósito**: `Libs/almox-*.js` está no `.gitignore` e não existe num clone novo — o
livro-razão é versionado e é a única memória de quem era quem. O campo é preenchido sozinho
na primeira sincronização depois desta mudança, enquanto ainda dá para achar cada entrada
pelo nome; é essa rodada que habilita as seguintes.

**O que NÃO muda:** produto que saiu do Odoo de verdade continua virando `fora: true` com
saldo zero e guardando o número — que é o comportamento pedido. A diferença é que agora
"sumiu" quer dizer sumiu, e não "mudou de nome".

> Uma ressalva de ordem: um símbolo que perde **todos** os valores deixa de ser montado, e aí
> não há de onde ressuscitar os que saíram — eles somem em vez de virar `fora`. Só acontece
> quando a família inteira sai do catálogo.

#### Tudo segue o ID, não só o número (2026-09-29)

Pedido do dono: "a partir de agora tudo é vinculado pelo ID do Odoo". O número e a data já
seguiam; o resto ainda ia pelo nome, e renomear o produto perdia o símbolo aplicado. Agora o
`product_id` leva junto:

| o quê | onde | como acha o componente renomeado |
|---|---|---|
| número e data de entrada | `almox-parts.json` | `almox2lib » segue_renomeacoes` (a chave velha sai **sempre**, levando o número ou não — antes, com o número ocupado no destino, ela ficava e virava zumbi) |
| desenho próprio do valor (o símbolo aplicado) | espelho, `valores[].parts` | `almox2lib » desenhos_por_odoo`, pelo id antes do rótulo |
| desenho protegido **e o vínculo com o símbolo** (`lib`) | `lib-ledger.json » protegidos` | `guardiao » segue_renomeacoes`, inclusive quando a proteção ficou presa num zumbi `fora` |
| footprint escolhido à mão | `lib-ledger.json » footprints` | `guardiao » footprints_manuais_por_odoo`, já na rodada da renomeação |
| o componente na folha | `schematic.js » sym` | `schframe.js » seguePeloOdoo`, pelo `OdooId` do `params` — a folha troca o nome, marca "Salvar *" e avisa |

Toda entrada nova do ledger (`/save-almox`, `/almox-aplicar`, `/almox-footprint`, o padrão da
categoria) já nasce com o id. De quebra, o footprint manual de um **especial** passou a ser
respeitado: o ledger o chaveia por `ESPECIAIS` (a família do arquivo) e o gerador procurava
pela família do símbolo — a escolha sumia em todo sincronismo.

**Duplicado antigo é apontado, nunca resolvido sozinho.** O que a faxina de nomes deixou antes
de o gerador seguir o id — o nome velho `fora`, com os `itens` do produto que hoje mora com o
nome novo (o TMAG5131A1: nº 4 fora, nº 46 vivo) — continua lá até alguém apagar. Resolver no
gerador daria ao vivo o número do zumbi, e isso é renumerar peça em uso (medido: seriam 49).
O log e o `relatorio.txt` listam os duplicados; na Biblioteca, a faixa Geral/Símbolos/Footprints
mostra **⚠ N produtos repetidos**, com a lista e **Apagar os antigos** (só o `fora` cujo produto
vive noutro componente; o que é a última lembrança de um produto que saiu fica). No editor, o
tile sai marcado *antigo* ou *duplicado*.

Medido na biblioteca do servidor em 2026-09-29: **741** produtos repetidos, **728** antigos
apagáveis, e **446** desenhos protegidos presos em nomes antigos — o primeiro sincronismo
depois desta mudança os devolve aos componentes vivos (o log resume: 20 linhas e o total).

### O catálogo acumula, não é recriado

O **id** de um valor, uma vez dado, é daquele valor para sempre — `Libs/almox-parts.json`
guarda o mapa `rótulo → id`, por símbolo. É a chave dele no `.DbLib` e no `schematic.js`:
com ela estável, um esquema já desenhado continua apontando para o mesmo componente
depois de qualquer sincronização.

Duas consequências, ambas de propósito:

- a **ordem de exibição** é crescente por valor, mas o **id** é a ordem de chegada —
  depois de algumas sincronizações os dois não coincidem;
- valor que **sai do Odoo não devolve o id**: fica no catálogo com saldo zero e
  `fora: true`, marcado na lista.

`--podar` recomeça a numeração do zero e descarta os valores que saíram. Use quando
ninguém ainda depende dos ids. Ele **não** reescreve as datas de entrada.

### O que é "novo"

Cada part e cada símbolo guardam `desde` — a data em que **entraram na biblioteca**,
gravada uma vez só. Na aba, "novo" é o que entrou depois da última vez que aquela máquina
clicou em **marcar como visto** (guardado no `localStorage`, por acervo).

Isso é diferente de "mudou na última geração", que foi como começou e estava errado: um
`--podar`, ou o botão *Só regerar do snapshot*, apagava a marcação do que a puxada do Odoo
tinha acabado de trazer. Agora a marcação é uma propriedade do dado e só some quando
alguém diz que viu.

O diff da execução (`Libs/almox-sync.js`) continua existindo — ele responde "o que **esta**
execução fez", que é outra pergunta, e é o que o log e o painel do diálogo mostram.

Dois acervos, pelo motivo que os separa:

- **básicos** — mesmo símbolo, muitos valores: R, C, L, D, Q, LED, fusível, chave,
  cristal, conector, bateria. O encapsulamento se repete, então dá para amarrar um
  footprint por família.
- **especiais** — pinagem própria: CI, MCU, ADC/DAC, ampop, regulador, conversor,
  optoacoplador, módulo. Aqui o símbolo é agrupado por **família + número de pinos**
  (`AMPLIFICADOR [8P]`), a part é o part number, e o footprint é quase sempre manual.
  Conector sem número de vias no nome cai aqui também: chutar a pinagem seria pior.

Cada part carrega o que o Odoo sabe: `Value`, `Encapsulamento`, `MPN`, **`Mouser`**,
`OdooId`, `Estoque`, `Local` (o endereço na prateleira) e `Custo`.

**O nome do componente** (o `LibReference` na `.SchLib`, o `valores[].altium` do espelho) é
montagem + encapsulamento + característica, e só o que é **fato do item** entra nele:

- **básicos**: a montagem é a do símbolo, porque o símbolo é partido por ela
  (`RESISTOR [SMD]` / `RESISTOR [PTH]`) e o item que não a declara herda a dominante da
  família junto com a lib em que vai morar — `SMD 0805 10K 1/8W 1% 100ppm`.
- **especiais**: o símbolo é por pinagem, não por montagem, então a montagem só entra
  quando o **próprio item** a declara (pelo encapsulamento, `SOIC8`/`DIP8`, ou por palavra no
  nome do Odoo); a presumida pela família **não** entra. `PTH DIP8 CA3140EZ`,
  `SMD SOIC8 Duplo TL082IDRQ1`, e um `SN65HVD75DR` sem encapsulamento no Odoo fica só
  `SN65HVD75DR`. Antes o nome levava a montagem do primeiro item que criou o símbolo, e um
  SOIC8 saía `PTH SOIC8 …`. `tests/test_almox_nomes.py` guarda a regra.

## Rodar

```bash
python tools/almox/almox2lib.py                 # regera do snapshot em disco
python tools/almox/almox2lib.py --pull          # puxa o Odoo (incremental) e regera
python tools/almox/almox2lib.py --pull --full   # ... relendo o catálogo inteiro
```

Lê `tools/almox/componentes_odoo.csv` e escreve:

| Arquivo | Para quê |
|---|---|
| `Libs/almox-basicos.js`, `Libs/almox-especiais.js` | espelho `schlib-v2` — é o que a aba **Biblioteca** do hub desenha |
| `Libs/almox-index.js` | índice dos acervos, para o combobox da aba e da configuração |
| `Libs/almox-sync.js` | o que **esta execução** mudou, para o painel do diálogo |
| `Libs/almox-parts.json` | o id e a data de entrada de cada valor — é o que faz o catálogo acumular |
| `Libs/Almox/*.SchLib` | as bibliotecas do Altium, escritas direto (uma parte por símbolo) |
| `Libs/Almox/ALMOX.DbLib` + `almox.sqlite` | a Database Library: 2.446 linhas, uma por valor |
| `Libs/almox-*.build.js` | formato achatado (um objeto por linha) que o `BuildAlmoxLibs.pas` lê |
| `tools/almox/relatorio.txt` | o que entrou, quantas parts por símbolo e tudo que ficou de fora |

### A puxada é incremental

O próprio CSV é o estado — cada linha guarda o `write_date` do produto. Uma sincronização
normal faz:

1. o **censo**: id, template e `write_date` de todo produto ativo. Três campos por
   produto, numa chamada; é o que descobre o que é **novo** e o que foi arquivado;
2. a **ficha completa só do que mudou** — produtos novos ou alterados, mais os que
   tiveram mexida no template ou no fornecedor desde a última vez;
3. **saldo e localização de todo mundo**, num `read_group` só. Isso muda o tempo todo e
   precisa estar fresco sempre; agrupado, é uma chamada em vez das ~10 mil linhas de
   `stock.quant` que a leitura completa trazia;
4. o CSV sai com as linhas antigas preservadas, as alteradas trocadas, as novas
   acrescentadas e as arquivadas removidas.

Numa semana calma isso são ~4.500 registros minúsculos do censo e um punhado de fichas,
em vez de cinco varreduras completas. `--full` força a leitura do catálogo inteiro; a
primeira puxada (ou um CSV sem a coluna `write_date`) cai nela sozinha.

## Sincronizar pelo hub

Na aba **Biblioteca**, com um acervo do almoxarifado selecionado, o botão
**Sincronizar almoxarifado** faz o mesmo sem sair do navegador: puxa o Odoo, regera as
duas libs, recarrega a aba e mostra **o que mudou** — símbolos novos, valores novos,
valores que saíram e saldos que mexeram. O que chegou fica marcado na lista (pílula
*novo* no símbolo, etiqueta *novo* no valor) até você clicar em **marcar como visto** —
não até a próxima geração.

O botão não aparece no acervo "Espelho do Altium": aquele quem regera é o `ExportLibs`,
de dentro do Altium.

Duas formas de rodar, no mesmo diálogo:

- **Puxar do Odoo e sincronizar** — incremental (veja acima); precisa das credenciais
  gravadas. O log diz quantos produtos eram novos, quantos mudaram e quantas fichas
  foram realmente baixadas.
- **Só regerar do snapshot** — não toca na rede; serve para reprocessar depois de mexer
  nas regras de classificação.

O trabalho roda no **PC do servidor** (`hubserver.py` chama este script) e o log chega
por SSE. Sincronizar **não** mexe nas `.SchLib` do Altium — para isso, rode o
`BuildAlmoxLibs` depois.

### Credenciais do Odoo

Ficam em `hub-almox.json`, na raiz do workspace, **fora do git**:

```json
{"login": "voce@dieletrons.com", "senha": "..."}
```

**Na prática só a credencial precisa estar aqui.** `url` e `db` já vêm certos do padrão do
código (`http://192.168.15.192:8070`, base `odoo_db`) — o Odoo da casa é um só, e o
formulário do hub mostra os dois em somente-leitura. Gravar `url` aqui continua valendo e
ganha do padrão: é assim que uma bancada aponta para outro servidor para testar.

Este exemplo já trouxe o IP do servidor de **teste** pronto para copiar, com o mesmo IP
cravado como default no código; juntos, faziam uma máquina mal configurada sincronizar do
ERP errado em silêncio (pendência 1.8).

Dá para gravá-las pelo próprio diálogo (só de quem está no PC do servidor — de outra
máquina da rede o backend recusa) ou à mão. A senha também pode vir da variável de
ambiente `ODOO_SENHA`, que ganha do arquivo. **O `GET /api/almox/config` nunca devolve a
senha** — só diz se existe uma gravada.

Depois, dentro do Altium: **DXP » Run Script » BuildAlmoxLibs**, que grava
`ALMOX BASICOS.SchLib` e `ALMOX ESPECIAIS.SchLib` em `Libs\Almox\`. São ~2.400 parts e
dezenas de milhares de primitivas — conte alguns minutos.

No hub: **Biblioteca » Sch Lib**, e o combobox *acervo* no alto da aba (ou
**Configuração » Projeto » biblioteca da aba Biblioteca**) escolhe qual acervo aparece.

## Atualizar o dump do Odoo

`componentes_odoo.csv` tem as colunas `product_id, template_id, localizacao_codigo, nome,
categoria, unidade, qtd_almoxarifado, qtd_total_interna, locais_estoque, barcode, custo,
preco_venda, fornecedor_partnumber, menor_preco_compra, estocavel, tipo`. O código Mouser
sai de `fornecedor_partnumber`, no formato `MOUSER ELETRONICS:595-XXXX`.

Três formas de regerá-lo, todas produzindo o mesmo arquivo:

1. `python tools/almox/odoo_pull.py` — XML-RPC, do PC que alcança o Odoo. É o que o
   `--pull` e o botão do hub usam.
2. `python tools/almox/almox2lib.py --pull` — puxa e já regera as libs.
3. O dump SQL original, na VM do Odoo (`192.168.15.182`, base `odoo_db`, container
   `db19`), quando se quer conferir a fonte.

## Quando a lib gerada abre com a folha PRETA no Altium

Já aconteceu, e o sintoma engana: o hub mostra os símbolos certos, mas o Altium abre a
biblioteca com a folha preta. O hub desenha a partir dos **registros**; a cor da folha mora
no **`FileHeader`**, junto da moldura, da grade, da unidade e da tabela de fontes.

Esses campos vinham de carona do cabeçalho **modelo** — a `BIBLIOTECA DE ESQUEMA.SchLib` da
casa, lida por rede. No dia em que a rede falhou, `carrega_lib()` devolveu `{}` e as 32 libs
saíram com **3 campos de documento em vez de ~74**. Sem `AreaColor`, o Altium não tem cor
para pintar e usa preto.

Diagnóstico, comparando o cabeçalho real com o gerado:

```python
import sys, re; sys.path.insert(0, 'tools/almox')
import olefile, schlib_bin as SB
def doc(p):
    o = olefile.OleFileIO(p)
    d = SB.le_texto(SB.desmonta(o.openstream('FileHeader').read())[0][1]); o.close()
    lixo = re.compile(r'^(Comp|AliasCount|CompDescr|LibRef|PartCount)\d*', re.I)
    return {k: v for k, v in d.items() if not lixo.match(k)}   # tira o que é por componente
print(len(doc('Libs/Almox/BATERIA ALMOX.SchLib')))             # saudável: ~74, e com AreaColor
```

`AreaColor = 16317695` é rgb(255,252,248), a folha creme (o inteiro é BGR:
`n & 255, (n>>8)&255, (n>>16)&255`).

Hoje o `CABECALHO_PADRAO` do `schlib_escritor.py` é o **piso** — cor da folha, moldura,
grade, unidade e a fonte 1, que é a única que os registros gerados referenciam — e o modelo,
quando alcançável, escreve por cima. A geração não depende mais da rede para produzir um
arquivo que abre certo, e o `almox2lib` avisa alto quando não consegue ler a lib da casa,
em vez de degradar mudo.

Regerar é `python tools/almox/almox2lib.py` — **sem** `--sem-schlib`, que pula justamente a
escrita das `.SchLib`.

## Cobertura

De 4.496 produtos ativos, 2.526 viram componente de PCB (70 símbolos básicos com 1.514
valores, 62 especiais com 905). O resto é parafuso, broca, cabo, caixa, ferramenta — o
`relatorio.txt` lista item por item o que foi descartado, para conferir se o filtro comeu
algo que não devia.

## Arquivos

- `classificar.py` — primitivas: tira acento, acha encapsulamento e montagem, lê valores
  (ohm/farad/henry/volt/ampère/hertz) e os põe em forma canônica.
- `familias.py` — a tabela de famílias (regex → símbolo, designador, forma, unidade) e a
  análise de uma linha do dump.
- `conectores.py` — o conector lido em campos: subtipo, vias, matriz, passo, ângulo, gênero
  e código do fabricante. É ele que troca a família `CONECTOR` por `CONECTOR <SUBTIPO>` e
  que enche o `valores[].conn` do espelho. Testado em `tests/test_conectores.py`.
- `migra_conectores.py` — a migração de uma vez só do livro-razão e do ledger do guardião
  para os nomes com subtipo. Sem `--aplicar` ele só mostra o plano.
- `simbolos.py` — a geometria de cada forma, no mesmo vocabulário do `Libs/schlib.js`.
  Todo pino gerado nasce com **`hideName: true`**: só o número à vista; o nome (A/K, B/C/E,
  ou o próprio número) fica guardado no pino e o olho da ficha Símbolos o mostra. É o padrão
  de todos os componentes — à vista, o nome repetia a mesma informação ao lado de cada pino.
  No arquivo é o conglomerado `0x30|rot` que o `schlib_bin.pino` emite (bit `0x08` = nome,
  `0x10` = número; o `0x20` é legado e vai junto).
- `odoo_pull.py` — a puxada por XML-RPC; reproduz as colunas do dump SQL.
- `almox2lib.py` — agrupa, ordena, compara com a geração anterior e escreve os arquivos.

O teste `tests/test-almoxlib.js` guarda as promessas: schlib-v2 válido, parts com pinos
idênticos, valor desenhado no símbolo, ordem crescente, contagens batendo com o índice e
o diff da sincronização apontando só para símbolos e valores que existem mesmo.
