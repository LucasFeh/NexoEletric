# Prompt para o Claude do Odoo — padronizar o cadastro de componentes (.182)

> Cole este arquivo inteiro como primeira mensagem na sessão que roda no servidor Odoo de
> teste. O arquivo `odoo-vocabulario.json`, que acompanha este, tem as listas fechadas
> (60 famílias, 76 encapsulamentos vistos, 618 footprints) — peça-o ao usuário se não vier
> junto.

---

## 0. Quem está falando com você

Sou o Claude que cuida do **AltiumPCBMirror**, o workspace que espelha as bibliotecas do
Altium e gera, a partir do inventário do Odoo, **32 bibliotecas `.SchLib`** que os projetistas
usam para desenhar esquemático. Hoje eu gero **148 símbolos e 2510 valores** lendo o campo
`name` dos produtos do Odoo com **61 expressões regulares** e adivinhando o resto.

Você trabalha do outro lado: dentro do Odoo. O objetivo do usuário é que o cadastro pare de
ser adivinhado e passe a ser **declarado** — em campos, com lista fechada, exigidos na
criação do produto. Nós dois vamos nos alinhar: eu mando o vocabulário e o parser, você
constrói os campos, a validação e a tela; eu passo a ler campo em vez de adivinhar texto.

**Ambiente:** `http://192.168.15.182:8070/`, base `odoo_db`. As credenciais estão com o
usuário (no workspace elas vivem em `hub-almox.json`, que **não** deve ser copiado para lugar
nenhum — ele é servido em texto claro por HTTP na LAN, é um vazamento conhecido e ainda
aberto). Você tem **shell na máquina e acesso aos arquivos do Odoo**.

---

## 1. Cinco fatos medidos. Leia antes de planejar qualquer coisa

Todos foram verificados ao vivo nos dois servidores, em setembro de 2026. Se algum tiver
mudado quando você chegar, **meça de novo antes de seguir** — mas não assuma que estão errados.

### 1.1 O `.182` é um clone descartável da produção. A curadoria NÃO pode morar no banco.

Censo comparado (só leitura, nos dois):

```
teste (.182)  4712 produtos ativos      prod (.192)  4810 ativos
só na prod : 100 ids contíguos (5453, 5454, 5455, ...)
só no teste: 2 ids (3158, 5392)
max write_date  teste 2026-09-02 15:24:07   |   prod 2026-09-10 13:14:22
```

Ids iguais, `write_date` iguais nos comuns, produção 8 dias à frente: o `.182` é um **restore
da produção** feito por volta de 02/09. O usuário confirmou que é cópia e que **o que for
feito aqui será repetido no `.192`**.

Consequência dura: **o próximo refresh do teste apaga tudo que morar só no banco** — valores
de campo, campos criados por Studio, o módulo instalado. Meses de curadoria com validade de
um `pg_restore`.

**Portanto, a regra número um deste trabalho:**

> A curadoria é um **arquivo versionado no repositório**, não um estado do Odoo.
> O Odoo é **destino**, nunca depósito.

Na prática: `tools/almox/curadoria.csv`, uma linha por `product_id`, colunas = os campos
novos + o nome canônico + o nome de origem como conferência. Mais um `tools/almox/odoo_push.py`
idempotente que aplica esse arquivo em **qualquer** servidor e é seguro rodar duas vezes.
Critério de aceite: **apagar todos os campos `x_` do `.182` e reconstruí-los pelo push, com
diff zero**. Como os `product_id` batem entre `.182` e `.192`, o mesmo arquivo replica na
produção sem retrabalho.

### 1.2 A conta do hub não é administradora — mas você tem shell, então use módulo

A conta que o hub usa (uid 14) tem `Products / Create` e `Inventory / Purchase / MRP /
Quality`, e **não** tem `base.group_system` nem `base.group_erp_manager`. Medido ao vivo:
`ir.ui.view`, `ir.model.data`, `base.automation`, `ir.actions.server` e `ir.rule` são todos
recusados para ela.

Ler e escrever produto por XML-RPC funciona com essa conta. **Criar campo e mudar formulário,
não.** Como você tem acesso ao filesystem, o caminho é **módulo próprio em
`/mnt/extra-addons`** — e ele é o certo pelo motivo do item 1.1, não porque Studio não
valide: `web_studio` e `base_automation` estão instalados e uma Automation Rule *faria* a
validação no ORM. A diferença é que a regra de automação é um registro de dados que qualquer
administrador desliga com um clique e que **um restore da produção apaga**; um
`@api.constrains` é código sob git.

Há precedente na casa: `/mnt/extra-addons` já tem 18 addons, dois deles próprios —
`product_smart_search` 19.0.3.0.0 e `claude_terminal` 19.0.1.0.0.

### 1.3 Odoo 19.0+e Enterprise, self-hosted — e o `type` já quebrou o meu lado

Os dois servidores rodam `19.0+e-20260421`, Enterprise, instalado por pacote
(`/usr/lib/python3/dist-packages/odoo`).

- `product.template.type` agora é `consu` / `service` / `combo`. **`product` não existe mais**
  (medido: `type=consu` → 4711, `type=product` → 0, `service` → 1).
- A estocabilidade virou **`is_storable`** (True em 4682, False em 30).
- Meu `odoo_pull.py:161` ainda testa `type in ('product','consu')` e por isso a coluna
  `estocavel` do meu dump sai `true` em **4711 de 4712 linhas** — coluna morta. **Eu conserto
  isso do meu lado**; anotei aqui para você saber que o modelo já mudou debaixo deste código
  dentro de um ciclo, e que um upgrade de versão vai exigir portar o módulo novo.

### 1.4 O nome do produto é HOJE a chave primária de três livros-razão

Isto é o que torna "só renomear" perigoso. O rótulo — que é literalmente **o que sobra do
nome** depois de tirar família, encapsulamento, montagem e `[MPN]` — é a chave de:

| arquivo | o que guarda | tamanho medido |
|---|---|---|
| `Libs/almox-parts.json` | rótulo → **número da part** | 148 símbolos, **2510 rótulos** |
| `Libs/lib-ledger.json` | `(família, altium)` → geometria **desenhada à mão no Altium** | **1375 componentes protegidos** em 26 famílias |
| dentro do próprio Altium | `ComponentId = "<Símbolo>#<id>"` em toda peça já colocada | — |

Exemplo literal do livro-razão de hoje:

```json
"RESISTOR [SMD]": { "prox": 257,
  "ids": { "(De Potência) 100R 100W 5%": 44, "0.1R / 100 mOhms 1/4W 1% 200ppm": 8, ... } }
```

`(De Potência) 100R 100W 5%` **é a chave primária do id 44**. Corrigir esse nome apaga o id 44,
e a peça já colocada num projeto passa a resolver para um fantasma "fora do almoxarifado".
Pior: as 1375 geometrias protegidas perdem a proteção e o gerador **sobrescreve o desenho que
o usuário fez à mão**.

Quantificado sobre os 2510 rótulos reais, só a **higiene de caracteres** — a parte mais
inofensiva do padrão, a que nem muda o significado:

```
186 rótulos com vírgula decimal        ("Conector Kk 3,96mm 7 Vias")
259 rótulos com Ø / ± / º / °          ("2 vias 180° 2.54mm Macho")
409 com pelo menos um dos dois         -> 409 fantasmas + 409 ids novos
```

Aplicando o padrão inteiro, **1420 de 2592 rótulos (54,8%) mudam**.

**Por isso a ordem é inegociável: eu rechaveio a biblioteca por `product_id` ANTES de você
renomear qualquer coisa.** Veja a seção 8.

### 1.5 Renomear só por `write` sobre o id existente. Import sem `id` DUPLICA.

`base_import` sem coluna de id faz `create`, não `write`. O resultado no meu dump é o produto
velho **e** o novo, os dois ativos — e o meu agrupador funde os dois num valor só, com o
estoque **somado** e o `OdooId` virando `"3513 5820"`. Erro de bancada silencioso, e pior do
que perder o id.

> Renomeie por `write` sobre o `product_id` existente, ou por import **com** a coluna
> `id` (Database ID). Nunca import sem id. Nunca `unlink` — retirada de linha é `active=False`.

---

## 2. O que eu faço hoje com cada byte que você me manda

Para você saber onde cada campo cai:

| dado | de onde sai hoje | qualidade medida |
|---|---|---|
| família, designador, forma do símbolo | 1ª palavra do `name` contra 61 regexes | 2595 de 4712 classificam |
| "é componente de PCB?" | **lista negra de ~60 palavras** no `name` | derruba `Rede de Resistores` porque `^rede` está nela |
| encapsulamento | regex de token no `name` | **1731 de 2595 (66,7%) sem encapsulamento legível** |
| nº de pinos do CI | **só** do encapsulamento | **26 símbolos `[PINAGEM A DEFINIR]`, 558 valores**, todos caixa de 4 pinos |
| nº de vias do conector | `(\d+)\s*(vias\|pinos\|bornes\|polos)` no `name` | **174 de 333 conectores** não dizem |
| SMD / PTH | palavra no nome > prefixo do pkg > **dominante da família** | **1180 (45,5%) sem declarar**; **177 chutados** — 18 resistores de fio de até 100 W foram parar em `RESISTOR [SMD]` |
| MPN | `[...]` no nome, ou palpite do último ` - ` | **2350 de 2595 não têm colchete** |
| valor (10K, 100nF) | 7 regexes, primeira ocorrência | 30 de 39 transistores saem sem valor |
| **footprint** | reciclado da lib da casa, ou adivinhado | **930 de 2510 valores (37%) sem footprint nenhum** |
| estoque, local, custo, OdooId | Odoo, direto | corretos — não são o gargalo |

**O que a padronização compra, honestamente:** dos 2117 produtos que hoje ficam de fora,
**só ~69 são componente eletrônico perdido** (33 em `CI`, 13 em `Conectores`, 6 em `Sensores`);
o resto é mecânica legítima — parafuso, broca, arruela. O ganho não é recuperar 2117. É:

1. os ~69 perdidos, quase todos por **typo** (`Amplifiador Operacional`, `MOSFT PCh`,
   `Circuto Integrado`) ou por o nome começar pela **função** em vez do tipo
   (`Portas Lógicas Quad 2-Entradas - SN74LS08N`);
2. **parar de perder cadastro novo** — hoje cada produto criado é uma aposta;
3. preencher os buracos da tabela acima, que são o dano real: 930 sem footprint, 558 com
   pinagem de mentira, 177 com montagem chutada;
4. **tornar as 61 regexes descartáveis.**

---

## 3. Entrega 1 — o módulo `di_componente_eletronico`

Addon em `/mnt/extra-addons`, versionado em git (é ele que sobrevive ao restore). Os campos vão
em `product.template` — o catálogo é 1:1, 4712 templates para 4712 variantes, zero variantes
reais.

Terreno medido antes de você chegar: **zero campos `x_`** em `product.template`,
`product.product`, `product.category`, `product.supplierinfo` e `product.tag`. Zero
`product.tag` cadastradas. `ir.model.fields` tem 66 campos manuais na base, **nenhum em
produto**. O caminho está livre.

### 3.1 Os campos

| # | técnico | tipo | obrigatório | valores | o que eu faço com ele |
|---|---|---|---|---|---|
| 1 | `x_is_componente` | boolean | sim (default **False**) | — | **substitui minha lista negra**. `False` → a linha nem entra no meu dump |
| 2 | `x_familia` | selection | se (1) | **as 60 do `odoo-vocabulario.json`** | **substitui as 61 regexes**. Determina designador, forma do símbolo e unidade do valor |
| 3 | `x_montagem` | selection | se (1) | `smd` / `pth` / `misto` / `na` | desliga o chute da dominante (177 itens hoje) |
| 4 | `x_encapsulamento` | selection | se (1) e família não for conector | lista do vocabulário + os 10 que faltam | hoje 66,7% dos itens não têm |
| 5 | `x_pinos` | integer | se (1) e grupo `e` | 2..200 | mata os 558 valores de pinagem falsa |
| 6 | `x_vias` | integer | se família ∈ {CONECTOR, BARRA DE PINOS, DIP SWITCH, RESISTOR REDE, CHAVE} | 1..80 | 174 conectores hoje não dizem |
| 7 | `x_footprint` | many2one a uma tabela semeada, ou char validado | se (1) | **os 618 nomes de `odoo-vocabulario.json`** | **mata os 930 sem footprint.** Ver 3.2 |
| 8 | `x_mpn` | char | se (1) e grupo `e` | `[A-Za-z0-9.\-/_+#]{3,40}` | separa peça: sem ele, BAV70, BAW56 e 1N4148WS viram um valor só, com estoque somado — e BAV70/BAW56 são SOT-23 de **pinagem oposta** |
| 9 | `x_valor_txt` | char | se (1) e grupo `b` | forma canônica: `10K`, `100nF`, `16MHz` | ver 7.2 |
| 10 | `x_pinagem` | text | opcional (fase 2, exigido para grupo `e`) | `1:VDD:Power;2:RA0:IO;3:GND:Power` | **é o dado que transforma esqueleto em símbolo.** Hoje todo pino sai `Passive` com nome igual ao número |
| 11 | `x_polaridade` | selection | opcional | `npn`/`pnp`/`n`/`p`/`uni`/`bi` | sem ele meu desenho **afirma NPN para todo transistor** |
| 12 | `x_fabricante` | char ou m2o `res.partner` | opcional | — | hoje o fabricante vira ruído no rótulo (`(Elgin)`, `(Tadiran)`) |
| 13 | `x_designator` | char | opcional | `R,C,L,D,Q,U,J,SW,Y,F,BT,T,K,RV,RT,FB,DS,RN` | override; um relé classificado como CI nasce `U?` em vez de `K?` |
| 14 | `x_hub_uid` | char, **unique** | não | gerado pelo hub | idempotência da escrita (seção 6) |
| 15 | `x_padronizado` | boolean | não | — | marca a linha já migrada; é o que permite ligar a trava em ondas |

Os tipos de pino em `x_pinagem` são **exatamente** o vocabulário do Altium, e a lista é
fechada: `Input, IO, Output, OpenCollector, Passive, HiZ, OpenEmitter, Power`.

### 3.2 Sobre `x_footprint` — por que ele não pode ser derivado

Não dá para deduzir o footprint do encapsulamento, e isto está medido: a biblioteca da casa
tem `DIP24-300` **e** `DIP24-600`; `DIP28-300` **e** `DIP28-600`; **12** variantes de TO-220
(`TO-220AB`, `TO-220-3 DEIT`, `TO-220-5 DEIT DISS`, `TO-220AB (SLAT)`...). Meu código exige
resposta única e **desiste quando há duas**. É por isso que `DIP28` nunca vira footprint.

Decisão, e ela vale para todo o trabalho — **decida uma vez e não volte atrás**:

> O **nome** carrega o token curto que o parser lê (`DIP28`).
> O campo **`x_footprint`** carrega o nome exato da biblioteca (`DIP28-600`).

Semeie a tabela com os 618 nomes de `odoo-vocabulario.json » footprints`. `no_create: True` na
view — inventar footprint que a biblioteca não tem produz componente que não roteia.

### 3.3 A validação — três camadas, e as três são necessárias

1. **`@api.constrains`** disparando só quando `x_is_componente`. É a única camada que vale
   para **`base_import` e XML-RPC também** — e é o ponto: a view não é obstáculo para nenhum
   dos dois. Confere: campos obrigatórios presentes conforme a tabela; `x_footprint` existe na
   tabela semeada; `x_pinos >= 2` para grupo `e`; e o teste de formato do item 3 abaixo.
2. **`_sql_constraints`**: `UNIQUE(x_hub_uid)`. Opcionalmente `UNIQUE(x_mpn, x_encapsulamento)`
   como **índice parcial `WHERE x_is_componente`** — nunca como constraint cega, há MPN
   legitimamente repetido em encapsulamentos diferentes.
3. **`@api.onchange`** que **monta o `name` a partir dos campos**, na ordem canônica da seção 7,
   e escreve no campo. É isto que faz o padrão pegar sem treinar ninguém: a pessoa preenche
   campos e o nome sai pronto. Deixe editável — há exceções — mas avise quando divergir.

**A validação de formato do nome é `name == nome_canonico(campos)`, comparando com o que o
`onchange` gera.** Não escreva uma regex de nome para isso: eu tentei especificar uma e ela
saiu tautológica (aceitava `Parafuso M3 Inox` e `Zzz [[[]]] ???`, rejeitava só `|`). Comparar
com o gerador é validação de verdade e é uma função só, a mesma que você já precisa ter.

**Cuidados:**

- Odoo 19 **não tem mais `attrs=` nem `states=`** (removidos no 17). É atributo direto com
  expressão Python:
  ```xml
  <group name="di_componente" invisible="not x_is_componente">
      <field name="x_familia"        required="x_is_componente"/>
      <field name="x_encapsulamento" required="x_is_componente and x_familia not in ['CONECTOR','BARRA DE PINOS']"/>
      <field name="x_vias"           required="x_familia in ['CONECTOR','BARRA DE PINOS','DIP SWITCH','RESISTOR REDE']"/>
      <field name="x_pinos"          required="x_is_componente and x_grupo == 'e'"/>
      <field name="x_footprint"      required="x_is_componente" options="{'no_create': True}"/>
  </group>
  ```
  (`x_grupo` = computado `b`/`e` a partir de `x_familia`, coluna `grupo` do vocabulário.)
- **Nunca `required=True` no campo.** Required de campo é do modelo, não da tela: travaria o
  cadastro dos 2117 mecânicos. A obrigatoriedade é condicional, na view + na constraint.
- **Nunca aplicar constraint de formato a produto não-componente.**
- **Não crie contexto de bypass da constraint.** Se ela pode ser desligada, será. A migração
  não precisa dele: os campos são preenchidos primeiro e `x_is_componente` liga por último.
- Em 19, `res.users.groups_id` virou **`group_ids`** — as duas chamadas antigas estouram com
  `Invalid field`.
- **`product_smart_search` (19.0.3.0.0, da casa) sobrescreve `_name_search` e `_search`** de
  `product.template` e `product.product`, quebrando o texto em palavras e exigindo que todas
  apareçam em Nome, Referência Interna ou Categoria. Duas consequências: um nome canônico bem
  ordenado melhora a busca de graça (`resistor 10k 0805` acha na hora); e qualquer `_search`
  novo seu tem que ser escrito sabendo que já existe um override na pilha.
- **Não filtre por `product_properties`.** Um domínio malformado sobre ele já derrubou uma
  chamada dentro de `/mnt/extra-addons/product_smart_search/models/product.py:91` com
  `ValueError: Missing property name`. Além disso o `name` da propriedade é um **hash gerado**
  (`2a340caec3deb73d`) — instável para XML-RPC.

---

## 4. Entrega 2 — limpeza de categorias (barata, sem risco, e é a semente do resto)

A árvore de categorias (183 delas) **já é quase a taxonomia desejada**: `CI` 293,
`Conectores` 242, `Resistores - PTH` 210, `Resistores - 1206` 124, `Resistores - 0805` 107,
`Capacitor Cerâmico - 1206` 47. Repare que `Resistores - PTH` já diz família **e** montagem, e
`Resistores - 0805` já diz família **e** encapsulamento — é a melhor semente que existe para o
preenchimento em massa.

Mas ela **não pode virar fonte de verdade**, porque está contaminada: a categoria
`Broca Aço Rápido` tem 214 produtos e **104 deles são componente eletrônico de verdade**,
incluindo `Conversor Analógico Digital - AD421BRZ` e `Resistor MELF 2K 1/4W 1% 50ppm`.

Limpeza (nenhuma delas toca em nome, portanto **nenhuma renumera nada** — é por isso que vem cedo):

- fundir as duplicatas: `Diodo Retificador` 120→121, `Microcontrolador` 208→125, `Retentor` 160→140;
- esvaziar `Sem Fornecedor` (552), `All` (179), `Cotação` (24), `Broca Aço Rápido` (214);
- arquivar as ~14 vazias; uniformizar caixa.

---

## 5. Entrega 3 — o pipeline de curadoria

É a materialização do item 1.1, e **nada de campo `x_` é preenchido antes que isto exista**.

- **`tools/almox/curadoria.csv`** — chave `product_id`, colunas = os campos da seção 3 + o
  `name` canônico proposto + o `name` de origem (conferência). Versionado no repositório.
- **`tools/almox/odoo_push.py`** — aplica o CSV em qualquer servidor, idempotente. A classe
  cliente do meu `odoo_pull.py` já tem o `call()` genérico; falta só o `write`.
- **Aceite:** apagar todos os `x_` do `.182` e reconstruí-los pelo push → **diff zero**.

O preenchimento inicial do CSV eu gero: rodo meu parser sobre os 4712 nomes atuais e cuspo o
que ele consegue deduzir, usando a **categoria** como segunda fonte. Você recebe o CSV
semipreenchido e cuida da parte que precisa de decisão.

**E o tamanho dessa parte foi medido, então não planeje uma tarde:**

| | produtos |
|---|---|
| conversão **automática completa** (todo campo obrigatório sai do nome de hoje) | **795 (16,9%)** |
| **exige decisão humana** (≥1 campo obrigatório ausente) | **1800 (38,2%)** |

Por campo faltante: `x_encapsulamento` **1404**, `x_montagem` **1180**, `x_pinos` 414,
`x_mpn` 188, `x_vias` 174, `x_valor_txt` 127.

**Faça por família, não por produto** — é a única forma de isso caber numa vida.
`RESISTOR [SMD]` inteiro usa `RES 0805` / `RES 1206`; as 290 linhas de CONECTOR sem footprint
se resolvem por passo e número de vias, não uma a uma.

---

## 6. Entrega 4 — escrita de volta (hub → Odoo)

Hoje **não existe uma linha** de escrita: o único `execute_kw` do repositório faz
`search_read` / `read` / `search` / `read_group`. Zero `create`, `write`, `unlink`.

### 6.1 Cadastrar componente novo

Rota `POST /api/almox/produto` do meu lado, executando `product.template.create` no seu.
Campos: `name` (montado pela **mesma função** do `onchange` — combinamos a assinatura),
`categ_id`, `uom_id`, `x_is_componente=True`, os campos da seção 3, `is_storable=True`,
`type='consu'`.

**Não escrever `default_code`.** Ele é o endereço da prateleira: 3456 preenchidos, mas só
**1606 valores únicos** para 3456 preenchidos — `ARM-2-3` aparece em **102 produtos**, `ARM-2-4` em 48. Ocupá-lo apaga o parâmetro
`Local` da biblioteca.

**Idempotência em três anéis:**

1. `x_hub_uid` = hash estável de `(x_familia, x_mpn ou x_valor_txt, x_encapsulamento,
   x_montagem)`. `search` antes de criar; achou → `write`, não `create`. Constraint SQL como rede.
2. Não achou por uid: `search([('x_mpn','=ilike',mpn),('x_encapsulamento','=',pkg)])`; achando,
   **devolver a lista ao usuário e recusar a criação automática**.
3. **Pré-flight do meu lado**, antes de tocar no Odoo: rodo meu classificador sobre o nome
   proposto e mostro em que símbolo e rótulo ele vai cair, e o que já está lá. Hoje o
   agrupamento **funde em silêncio** — não é detecção de duplicata, é colapso.

### 6.2 Lista de componentes do projeto → Odoo (BOM)

**Isto não pode ser feito ainda, e o bloqueio é do meu lado.** `ExportProject.pas` não exporta
parâmetro nenhum de componente, então o `OdooId` que o hub grava na folha do Altium **não
volta**. Medido: nenhum dos 16 projetos tem `params`, e em **9 deles, 162 componentes (20,7%)**
têm como `comment` a fórmula não resolvida do Altium — literalmente
`"=Value + ' - ' + Potência + ' - ' + Tolerancia"`. Não há como casar isso com produto.

Ordem: (1) eu conserto o `ExportProject.pas` para exportar `OdooId`/`MPN`/`ValorId`/`Value`;
(2) resolvedor para os 16 projetos legados, com fila de revisão; (3) só então `mrp.bom` do seu
lado — `mrp` está instalado. Idempotência por `('product_tmpl_id','=',id),('code','=','<projeto>@<rev>')`,
com diff das linhas por `product_id`. **Nunca apagar a BOM e recriar** — quebra ordens de
produção existentes.

### 6.3 Conta de serviço

Escrita no ERP não deve sair na conta pessoal do usuário. Criar `integracao.hub@dieletrons.com`
com `Products / Create` + `Inventory / User` e **nada mais**. Lembrando: o arquivo de
credenciais do hub responde 200 em texto claro na LAN — **restrinja isso antes** de dar direito
de escrita à conta que está nele.

---

## 7. O padrão de nome

### 7.1 O que vai no nome e o que vai em campo

O nome é **texto livre**: não é filtrável por domínio, não tem lista fechada, e cada caractere
dele é hoje chave de identidade. O campo é **coluna**: filtrável, validável, e mudável sem
renumerar nada.

- **No nome**, porque um humano lê na lista do Odoo e na etiqueta da gaveta: família, valor,
  tensão/potência/tolerância, MPN, encapsulamento, montagem. O nome é redundante com os campos
  **de propósito** — é a camada humana.
- **Em campo próprio, e nunca só no nome**: família, montagem, encapsulamento, **nome do
  footprint**, **número de pinos**, **pinagem**, MPN, fabricante, polaridade, vias.

Os dois que **não cabem em texto nenhum** são `x_footprint` (item 3.2) e `x_pinagem` — são
exatamente os que separam "caixa de 4 pinos" de biblioteca utilizável.

### 7.2 Ordem canônica

```
<Família> <Valor> <Tensão> <Potência|Corrente> <Tolerância> <Coef> [<MPN>] <ENCAP> <SMD|PTH>
```

Conector / barra / dip switch, onde o valor é substituído pelas vias:

```
<Família> <N> vias <Passo> <Gênero/Ângulo> [<MPN>] <ENCAP> <SMD|PTH>
```

Especiais (CI e afins), onde o MPN é a identidade e valor não existe:

```
<Família> <Função> [<MPN>] <ENCAP> <SMD|PTH>
```

**A grafia da família é a coluna `grafia_no_nome` do `odoo-vocabulario.json`, não o valor de
`x_familia`.** As duas coisas são diferentes e isto foi verificado uma a uma: escrever
`RESISTOR REDE` no nome faz o parser classificar como `RESISTOR` (a rede desaparece dentro do
resistor); `DIAC` e `GESTAO DE BATERIA` escritos assim **não classificam de jeito nenhum** e o
produto some da biblioteca. As grafias que funcionam hoje são
`Redes e Matrizes de Resistores`, `Diodo DIAC` e `Gerenciamento de Bateria`. Eu vou tornar as
formas naturais aceitáveis do meu lado; até lá, **use a coluna do vocabulário**.

### 7.3 As 13 regras léxicas, cada uma com a medição que a justifica

| # | regra | por quê |
|---|---|---|
| 1 | Um espaço simples, nada nas bordas | **377** nomes com espaço final, **273** com espaço duplo interno |
| 2 | **Ponto decimal, nunca vírgula** | 186 dos 2510 rótulos têm vírgula decimal — e o rótulo **é a chave** |
| 3 | O valor aparece **uma** vez | 440 rótulos têm equivalência dupla (`4.7nF / 4700pF`); a segunda vira lixo na chave |
| 4 | Sufixo colado ao número (`10K`, `4.7uF`, `16MHz`) | os guardas do parser derrubam `4K7`, `320R72`, `10 KOHM` |
| 5 | **Nunca começar por `[`** | 14 nomes começam com o endereço da prateleira (`[G-161-12] Capacitor...`) e caem **inteiros** fora |
| 6 | Colchetes = MPN, exatamente um par | é a única fonte confiável de MPN, e ela **separa peça** (ver campo 8 da seção 3.1) |
| 7 | Encapsulamento = 1 token da lista, MAIÚSCULO, sem espaço | a mesma peça está grafada de 3 jeitos: `DIP8`(62)/`DIP-8`(6); `TO-92`(13)/`TO-92-3`(5) |
| 8 | Montagem = `SMD` ou `PTH`, palavra isolada, no fim | **nunca `DIP` solto para dizer PTH** — colide com o pacote |
| 9 | **Sem `\|`** | é o separador de registro do formato `.SchLib`; um `\|` corta a biblioteca ao meio |
| 10 | Sem `Ø`, `±`, `º`, `°` | 259 dos 2510 rótulos têm um deles. Use `D12.5mm`, `+/-`, `180g` |
| 11 | Português, e a **primeira palavra** é do vocabulário | typos matam a linha inteira: `Amplifiador`, `Circuitpo`, `Circuto`, `MOSFT` → todos fora hoje |
| 12 | Conector diz `<N> vias` | 174 de 333 não dizem e caem todos no mesmo símbolo de 4 pinos |
| 13 | Nada de quantidade de fita, SKU, código de projeto ou fabricante solto | `INA121UA/2K5` — o `2K5` é embalagem e vira valor ôhmico |

**Uma armadilha na regra 4:** se você for proibir a notação `4K7` por regex, aplique-a ao nome
**com o conteúdo dos colchetes removido**. Testei o regex óbvio: dos 18 nomes que ele pega,
**15 são part number legítimo** — incluindo 9 conversores Hi-Link (`HLK-10M12`, `HLK-5M24`),
`INA121UA/2K5`, `LM2575D2T-5R4G`, `600R150-RAF`. Instalada crua, a regra impede o cadastro de
15 peças que já existem no almoxarifado. Só 3 são notação ruim de verdade.

### 7.4 Conversões reais, com o efeito medido

`product_id` e nome reais do `.182`. "id preservado" = o número da part sobrevive.

| id | nome HOJE | nome PADRÃO | efeito |
|---|---|---|---|
| 1891 | `Resistor de Filme Espesso 10K 1/8W 1% 100ppm SMD 0603 ` | `Resistor de Filme Espesso 10K 1/8W 1% 100ppm 0603 SMD` | **id preservado** — mover encapsulamento e montagem é grátis |
| 4285 | `Resistor Fio Enrolado (De Potência) 100R 100W 5%` | `Resistor Fio Enrolado 100R 100W 5% PTH` | id muda; conserta o absurdo de 100 W em `RESISTOR [SMD]` |
| 3525 | `Capacitor Eletrolitico Radial 0.1uF 50V Ø5 2.5mm PTH` | `Capacitor Eletrolítico Radial 100nF 50V D5mm PTH` | id muda (Ø e a grafia do valor) |
| 2285 | `Capacitor Cerâmico 4.7nF / 4700pF 50V X5R SMD 0201` | `Capacitor Cerâmico 4.7nF 50V X5R 0201 SMD` | id muda (some a equivalência dupla) |
| 3030 | `Amplificador Operacional - TL072CP` | `Amplificador Operacional [TL072CP] DIP8 PTH` | hoje é caixa de 4 pinos; depois, 8 pinos de verdade |
| 3507 | `Microcontrolador de 8 Bits SSOP-28 -  FTDI232RL` | `Microcontrolador 8 bits [FT232RL] SSOP-28 SMD` | corrige de quebra o MPN, que está escrito errado |
| 2955 | `Conector Kk 3,96mm 7 Vias Fêmea C/ Trava` | `Conector KK 7 vias P3.96mm Fêmea 180g PTH` | id muda (vírgula decimal) |
| 125 | `Diodo Zener 5.6V 0.5W - MMSZ5232BHE3` | `Diodo Zener 5.6V 0.5W [MMSZ5232BHE3] SOD-123 SMD` | hoje sem pkg → **PTH presumido**, e é SMD. Erro silencioso |
| 5444 | `[G-161-12] Capacitor de Tântalo 100uF 6.3V SMD 3.5mm` | `Capacitor de Tântalo 100uF 6.3V 1206 SMD` | **hoje FORA**; volta a existir. O `G-161-12` fica no `default_code` |
| 3321 | `Amplifiador Operacional - MC33072P` | `Amplificador Operacional [MC33072P] DIP8 PTH` | **hoje FORA** por uma letra |
| 4095 | `Portas Lógicas Quad 2-Entradas - SN74LS08N - DIP14` | `Circuito Integrado Porta Lógica Quad 2 entradas [SN74LS08N] DIP14 PTH` | **hoje FORA**: o nome começa pela função. É o padrão dos ~45 CIs perdidos |
| 3125 | `MOSFT PCh - 55V -17A - IRF9Z34NPBF` | `MOSFET Canal P 55V 17A [IRF9Z34NPBF] TO-220-3 PTH` | **hoje FORA** por typo |

### 7.5 Buracos do vocabulário, a acrescentar

Medidos entre os que não casam nenhuma regra, quase todos nomeados pela **função**:
`PORTA LOGICA`, `FLIP-FLOP`, `REGISTRADOR DE DESLOCAMENTO`, `MULTIPLEXADOR`, `BUFFER`,
`INVERSOR`, `CODIFICADOR/DECODIFICADOR`, `FOTODIODO`, `FOTOTRANSISTOR`, `EMISSOR IR`,
`ACELEROMETRO`, `ANTENA`, `SOQUETE`.

Encapsulamentos que o parser não conhece e existem no almoxarifado: `MELF`, `MINIMELF`,
`TO-3`, `SO-8`, `SO-14`, `SOT-563`, `DFN`, `WSON`, `SOD-123FL`, `SOD-323`. E **proibir
`DIP114`** — é typo real (id 4411) e o parser rejeita >100 pinos, mandando o CI para o saco de
4 pinos levando "DIP114" como footprint.

---

## 8. A ordem. Não a reordene sem falar comigo

Os passos marcados **[eu]** são meus e bloqueiam os seus. Avise quando chegar num deles.

| # | quem | passo | aceite |
|---|---|---|---|
| 0 | ambos | Combinar os nomes técnicos dos campos e a assinatura do gerador de nome | seção 10 respondida |
| 1 | **[eu]** | **Rechavear a biblioteca por `product_id`** — índice global `_porOdoo` no livro-razão, e o mesmo mapa aplicado às 1375 proteções de geometria | regerar → **diff zero** em `almox-parts.json` e `lib-ledger.json` |
| 2 | **[eu]** | `is_storable` no meu leitor; decidir a grafia de farad (hoje 33 valores viram `1mF`, `4.7mF` — e dois deles vêm de um `0.01F` que queria dizer `0.01uF`: **erro de 1000×**) | — |
| 3 | você | `curadoria.csv` + `odoo_push.py` (seção 5) | apagar os `x_` e reconstruir → diff zero |
| 4 | você | Limpeza de categorias (seção 4) | nenhum nome alterado |
| 5 | você | Módulo `di_componente_eletronico` (seção 3), campos + constraint + view + onchange | criar produto mecânico continua com 2 cliques |
| 6 | ambos | Preencher os campos em massa **com `x_is_componente` ainda False** | ver abaixo |
| 7 | você | Fila humana **por família**: ~69 perdidos, 558 sem pinagem, 930 sem footprint, 1404 sem encapsulamento | — |
| 8 | você | Ligar `x_is_componente` **uma família por vez**, com a constraint instalada | a recusa da constraint **é** a lista de trabalho |
| 9 | ambos | **Só agora renomear**, em lotes por família, com `migracao-rotulos.json` | **zero ids alterados** em `almox-parts.json` |
| 10 | **[eu]** | Passar a ler campo primeiro, nome como desempate. As 61 regexes viram fallback histórico | — |

**Aceite do passo 6, e este ponto importa:** não basta comparar o que o meu parser deduz com o
que ele mesmo deduziu — isso é tautológico, o diff é zero por construção. O teste que prova
alguma coisa é **emitir o nome canônico e relê-lo**: se o nome padronizado não voltar dando a
mesma família, o mesmo encapsulamento e **o mesmo rótulo**, o padrão está errado. Rodando esse
teste sobre o dump inteiro é que se descobre que **1420 rótulos mudam** — e é muito melhor
descobrir antes de escrever no Odoo do que depois.

**Antes do passo 9:** o hub tem que estar fora do ar. O endpoint de sincronismo é um POST **sem
autenticação nenhuma** num servidor que escuta em `0.0.0.0` — qualquer um na LAN dispara uma
regeração no meio do lote e congela os fantasmas.

---

## 9. O que NÃO fazer

1. **Não renomear antes do passo 1.** O rótulo é chave primária de 2510 parts e de 1375
   geometrias protegidas.
2. **Não usar `default_code` como código de componente.** É o endereço da prateleira: 3456
   preenchidos, 1606 únicos, `ARM-2-3` em 102 produtos.
3. **Não promover categoria a fonte de verdade.** `Resistor MELF 2K 1/4W 1% 50ppm` está em
   `Broca Aço Rápido`. Semente sim, verdade não.
4. **Não pôr o código da prateleira no início do nome.** 14 nomes assim caem inteiros fora, e o
   colchete ainda sequestra o campo MPN.
5. **Não escrever equivalência dupla de valor.** A segunda vira lixo na chave.
6. **Não confiar na montagem inferida.** É chutada em 177 itens; um transceptor SMD saiu
   batizado PTH e 18 resistores de fio de até 100 W saíram em `RESISTOR [SMD]`.
7. **Não deduzir footprint do encapsulamento** (item 3.2).
8. **Não usar `attrs=` / `states=`** em view do Odoo 19, nem `res.users.groups_id`.
9. **Não construir a obrigatoriedade só na view.** `base_import` e XML-RPC passam por cima.
10. **Não deixar a constraint valer para produto não-componente.** Trava os 2117 mecânicos.
11. **Não fazer import sem a coluna `id`.** Duplica e soma estoque (item 1.5).
12. **Nunca `unlink`.** Retirada de linha é `active=False`.
13. **Não deixar a curadoria só no banco do `.182`.** Um restore da produção apaga.
14. **Não escrever no Odoo com a conta pessoal do usuário** (item 6.3).
15. **Não me peça para rodar `--podar`.** É o reset do livro-razão e não tem desfazer. Nem "para testar".

---

## 10. O contrato entre nós dois

**O que eu te entrego** (peça ao usuário se não chegou junto):

- `odoo-vocabulario.json` — **60 famílias** com `x_familia`, a `grafia_no_nome` verificada, o
  designador, a forma do símbolo, a unidade do valor e o grupo `b`/`e`; **76 encapsulamentos**
  vistos hoje com a contagem de cada um, mais os 10 que faltam; **618 nomes de footprint** da
  biblioteca da casa, que é a lista fechada do campo `x_footprint`.
- O `curadoria.csv` semipreenchido pelo meu parser (passo 6).
- O rechaveamento por `product_id` (passo 1) e o `migracao-rotulos.json` do rename (passo 9).

**O que eu preciso de você, e é isto que trava o meu passo 10:**

1. Os **nomes técnicos finais** dos campos, como ficaram de fato — se você usar Studio em algum
   ponto, os `x_studio_*` vazam para o meu leitor e eu preciso saber.
2. Os **valores exatos** de cada selection (`x_familia`, `x_montagem`, `x_encapsulamento`) —
   se você acrescentar família ou encapsulamento, me diga: eu tenho tabela do lado de cá que
   precisa casar, e um valor que eu não conheço vira componente sem símbolo.
3. A **assinatura do gerador de nome** (`nome_canonico(campos) -> str`), para eu montar o
   nome igualzinho ao seu na hora de cadastrar produto pelo hub. Se divergirmos, a constraint
   recusa a minha escrita.
4. Confirmação de que a constraint **não** tem bypass por contexto.
5. Como você resolveu a tabela de `x_footprint` (many2one a que modelo? char validado contra o
   quê?) — preciso saber o que ler.

**Comece confirmando o que mudou.** Meça de novo, na chegada: versão do Odoo, o
`fields_get` de `product.template`, o censo de ativos e o `max(write_date)`. Se o `.182` tiver
sido restaurado depois de setembro/2026, os números da seção 1 mudaram e vale me avisar antes
de seguir.

---

## 11. Como saber que deu certo

Não é "o script rodou". São estes números, e eu meço todos do meu lado:

| hoje | meta |
|---|---|
| 2510 valores, **930 sem footprint (37%)** | **0 sem footprint** |
| **26 símbolos `[PINAGEM A DEFINIR]`**, 558 valores em caixa de 4 pinos | **0** |
| **1731 de 2595 (66,7%)** sem encapsulamento legível | **0** |
| **177 itens** com montagem chutada pela dominante da família | **0** |
| **~69 componentes eletrônicos** invisíveis para a biblioteca | **0** |
| **2350 de 2595** sem colchete no nome (e 1592 sem MPN nenhum) | todo grupo `e` com MPN |
| todo pino sai `Passive`, nome igual ao número | pinagem real nos CIs |
| **61 regexes** decidindo o que é o quê | fallback histórico |
| identidade da part = **o resto do nome** | identidade = `product_id` |

E um teste que vale por todos: **pegar um produto novo, cadastrar pela tela do Odoo seguindo o
padrão, rodar o sincronismo, e ele aparecer na `.SchLib` com o símbolo certo, o footprint certo
e a pinagem certa — sem ninguém tocar em regex nenhuma.** É isso que o usuário está pedindo.
