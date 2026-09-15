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
