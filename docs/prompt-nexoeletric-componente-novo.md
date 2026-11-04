# Instrução para o NexoEletric: mandar o componente novo pronto para o almoxarifado

> Cole este arquivo inteiro na sessão de IA que trabalha no código do **NexoEletric**
> (o antigo AltiumPCBMirror). Ele complementa `prompt-altium-envio-de-lista.md`: o envio da
> lista continua igual. O que muda é a linha de **peça que o almoxarifado do Odoo ainda não tem**.
> Agora ela leva a ficha inteira do componente.
>
> Lado do Odoo: módulo `di_lista_altium` **19.0.9.0.0**, com 38 testes passando. A tela agora
> se chama **"Lista do NexoEletric"**. Os nomes técnicos não mudaram (`di.lista.altium`, os três
> métodos, as chaves do payload), então nada do que já funciona quebra.

---

## 1. O problema que isto resolve

Hoje, quando o projeto usa uma peça que não está no cadastro do Odoo, a linha chega como
**"sem componente"**. Alguém do almoxarifado precisa abrir um formulário e preencher família,
montagem, encapsulamento, valor, MPN, tensão, potência e o resto. A única base é o rótulo do
esquemático (`nome_altium`), interpretado por um classificador. Isso é lento e dá erro.

A partir de agora, **quem sabe o que é a peça (o NexoEletric, que tem o esquemático, a
biblioteca e o datasheet) manda a ficha completa** num bloco `componente` dentro da linha. O Odoo
confere a ficha com **as mesmas regras do cadastro novo de produto**. Se ela passar, o
almoxarifado clica em **"Criar os componentes prontos"** e a peça entra no cadastro com nome,
foto, atributos, pinagem e links. Ninguém digita nada.

A lista **continua passando pela aprovação humana**. Criar o componente não aprova a lista: a
placa e a lista de materiais (BoM) continuam esperando o clique de quem decide.

---

## 2. Onde o bloco entra no payload

O bloco vai **só na linha da peça que o Odoo não tem**. A peça que você achou no cadastro
continua indo por `product_id`, como sempre.

```python
payload = {
    'uid_externo': 'nexo:MEDIDOR-BANCADA:B',
    'projeto': 'Medidor de Bancada',
    'codigo': 'PURI-DI261924',
    'revisao': 'B',
    'origem': 'NexoEletric',
    'enviado_por': 'lucas',
    'linhas': [
        # peça que JÁ existe no Odoo: igual a hoje
        {'designadores': 'R1, R2', 'quantidade': 2, 'product_id': 1891,
         'nome_altium': 'Resistor 10K 0805 SMD'},

        # peça NOVA: mesma linha de sempre + o bloco 'componente'
        {'designadores': 'R7, R8', 'quantidade': 2,
         'nome_altium': 'Resistor 4K7 0603',
         'footprint': 'R0603',
         'componente': {
             'x_familia': 'RESISTOR',
             'x_subtipo': 'de Filme Espesso',
             'x_montagem': 'smd',
             'x_encapsulamento': '0603',
             'x_mpn': 'RC0603FR-074K7L',
             'x_valor_txt': '4.7K',
             'x_potencia': '1/10W',
             'x_tolerancia': '1%',
             'x_fabricante': 'Yageo',
             'x_pinagem': '1:1:Passive;2:2:Passive',
             'footprint': 'R0603',
             'links': [{'name': 'Mouser',
                        'url': 'https://www.mouser.com/ProductDetail/603-RC0603FR-074K7L'}],
         }},
    ],
}
```

Regras da linha:

* **Não mande `product_id` junto com `componente`.** Se tiver `product_id`, a peça existe, e o
  bloco é ignorado;
* se a linha não tiver `mpn`, o Odoo procura pelo `x_mpn` + `x_encapsulamento` do bloco antes de
  propor a peça nova. Se ela já existir, a linha resolve sozinha e o bloco é ignorado. Mesmo
  assim, **resolva pelo `product_id` sempre que puder**;
* `componente` precisa ser um **dicionário**. Se vier outra coisa (texto, lista), o envio inteiro
  é recusado com fault: `Linha N: componente tem que ser um dicionario`.

---

## 3. O bloco `componente`: todas as chaves

As chaves **são os próprios nomes dos campos do produto no Odoo** (`x_...`), os mesmos que você
já lê quando gera a biblioteca. Não existe outra grafia.

### 3.1 Obrigatórias em toda peça nova

| chave | tipo | o que é | exemplo |
|---|---|---|---|
| `x_familia` | texto, da lista | o que a peça é. Lista fechada de 60 (seção 4) | `'RESISTOR'` |
| `x_montagem` | `'smd'` ou `'pth'` | colado por cima ou atravessando a placa | `'smd'` |
| `x_encapsulamento` | texto, da biblioteca | o pacote. **`'NA'`** quando a peça não tem pacote nomeável. Vazio não é resposta | `'0603'`, `'DIP8'`, `'NA'` |
| `x_mpn` | texto | código do fabricante (part number). Nunca o `default_code` | `'RC0603FR-074K7L'` |

### 3.2 Obrigatórias conforme a família

| chave | quando é obrigatória | regra |
|---|---|---|
| `x_valor_txt` | família **com unidade** (seção 4, coluna "valor") | número com o sufixo colado: `10K`, `4.7K`, `100nF`, `16MHz`, `40V`, `2A`. Ponto decimal, nunca vírgula. **Proibido** em família sem unidade (CI, microcontrolador, LED, chave...) |
| `x_vias` | CONECTOR, BARRA DE PINOS, DIP SWITCH, RESISTOR REDE, CHAVE | inteiro de 1 a 80. Nessas famílias ele **substitui o valor**. Proibido nas outras |
| `x_polaridade` | TRANSISTOR (`npn`/`pnp`), MOSFET e IGBT (`n`/`p`), DIODO TVS e TIRISTOR (`uni`/`bi`) | o código, não o rótulo. Proibido nas outras famílias |
| `x_subtipo` | **CONECTOR**: obrigatório e **tem que existir no cadastro de subtipos** (seção 5.3) | nas outras famílias é opcional e livre: a função da peça (`'de Filme Espesso'`, `'Operacional'`, `'Radial'`) |

Nos semicondutores e diodos (unidade V), o **valor é a tensão principal** (Vce, Vds, Vz, Vrrm),
e corrente e potência vão nos atributos. Não repita a tensão em `x_tensao`. É assim que o acervo
inteiro está: `Diodo Zener 43V 5W [1N5367B] DO-201 PTH`.

### 3.3 Atributos (opcionais, mas só os que a família pede)

Mande todo atributo que o datasheet ou a biblioteca souber. Eles entram no nome da peça e
separam peças parecidas. **Atributo que a família não pede é erro**: ele não apareceria no nome
e viraria dado invisível. A tabela da seção 4 diz quais atributos cada família aceita.

| chave | tipo | formato recomendado |
|---|---|---|
| `x_tensao` | texto | `50V`, `6.3V`, `250VAC` |
| `x_potencia` | texto | `1/4W`, `500mW`, `100W` |
| `x_corrente` | texto | `1A`, `200mA`, `1200mAh` |
| `x_tolerancia` | texto | `1%`, `20%`, `-20/+80%` |
| `x_coeficiente` | texto | `100ppm`, `25ppm` |
| `x_dieletrico` | **lista** | `C0G`, `NP0`, `X5R`, `X6S`, `X7R`, `X7S`, `Y5V`, `Z5U` |
| `x_carga` | texto | cristal: `18pF`, `20pF` |
| `x_dimensao` | texto | `D10x20mm` (diâmetro x altura), `D8mm`, `5x20mm`. Use **D**, nunca `Ø` |
| `x_passo` | texto | `P2.54mm`, `P3.96mm`, `P5.08mm` |
| `x_genero` | **lista** | `macho`, `femea`, `misto` |
| `x_angulo` | **lista** | `180g` (reto) ou `90g` (angular). O nome sai com `180°` |

O texto livre aceita qualquer caractere, mas use a forma recomendada: é ela que vai para o nome,
e o nome é a chave da biblioteca. Evite `|` (corta o .SchLib), `Ø`, `±` e `º`.

### 3.4 Opcionais que deixam a peça completa

| chave | tipo | o que é |
|---|---|---|
| `x_fabricante` | texto | `'Yageo'`, `'Texas Instruments'` |
| `x_pinos` | inteiro | número de pinos. Só nas famílias do grupo "e" (CI, microcontrolador, regulador...) |
| `x_pinagem` | texto | `1:VDD:Power;2:RA0:IO;3:GND:Power`. Tipos aceitos: `Input`, `IO`, `Output`, `OpenCollector`, `Passive`, `HiZ`, `OpenEmitter`, `Power` |
| `x_designator` | texto, até 4 letras | só se for diferente do padrão da família (`R`, `C`, `U`...). Se vier vazio, o Odoo usa o padrão |
| `footprint` | texto | **nome exato** do footprint na PcbLib da casa (cadastro `di.footprint`). Nome desconhecido não bloqueia: a peça nasce sem footprint e o recibo avisa |
| `links` | lista | `[{'name': 'Mouser', 'url': 'https://...'}]`: loja + página **do produto**, os dois preenchidos |
| `imagem` | texto base64 | **Só mande se a peça não se parecer com as outras do mesmo pacote.** Sem ela, o Odoo põe a foto do catálogo da casa pelo caso (família, montagem, encapsulamento) |

### 3.5 O que NÃO mandar no bloco

* **`name`**: o nome não se digita. Ele sai dos campos, pelo gerador da casa. Chame
  `product.template.di_nome_canonico(bloco)` se quiser mostrar ao projetista como vai ficar;
* **`default_code`**: neste acervo é o endereço da gaveta no almoxarifado, não part number;
* **`x_hub_uid`**: é calculado pelo Odoo a partir dos campos;
* qualquer outra chave: é ignorada e volta listada em `ignorados` no recibo.

---

## 4. As 60 famílias: o que cada uma pede

`valor` = unidade do `x_valor_txt` (vazio = família sem valor). `vias` = usa `x_vias` no lugar
do valor. `pol` = polaridades aceitas.

| família (`x_familia`) | valor | outros obrigatórios | atributos aceitos |
|---|---|---|---|
| RESISTOR | R (`10K`, `4.7K`, `100R`, `1M`) | | tensao, potencia, tolerancia, coeficiente |
| RESISTOR REDE | — | **vias** | potencia, tolerancia, coeficiente |
| POTENCIOMETRO | R | | tensao, potencia, tolerancia, coeficiente |
| VARISTOR | V | | tensao, corrente, dimensao |
| TERMISTOR | R | | potencia, tolerancia, corrente, dimensao |
| CAPACITOR CERAMICO | F (`100nF`, `22pF`) | | tensao, tolerancia, dieletrico, passo |
| CAPACITOR ELETROLITICO, TANTALO, POLIESTER, SEGURANCA, VARIAVEL, CAPACITOR, SUPERCAPACITOR | F | | tensao, tolerancia, dimensao, passo |
| INDUTOR | H (`10uH`) | | corrente, tolerancia, dimensao |
| FERRITE | R | | corrente, tolerancia, dimensao |
| CRISTAL | Hz (`16MHz`) | | carga, coeficiente, dimensao |
| DIODO ZENER | V | | potencia, tolerancia, dimensao |
| DIODO SCHOTTKY, DIODO RETIFICADOR, PONTE RETIFICADORA, DIAC | V | | tensao, corrente, potencia |
| DIODO TVS | V | **pol** `uni`/`bi` | tensao, corrente, potencia |
| TRANSISTOR | V | **pol** `npn`/`pnp` | tensao, corrente, potencia |
| MOSFET, IGBT | V | **pol** `n`/`p` | tensao, corrente, potencia |
| TIRISTOR | V | **pol** `uni`/`bi` | tensao, corrente, potencia |
| LED | — | | tensao, corrente, dimensao |
| FUSIVEL, FUSIVEL PTC | A | | tensao, corrente, dimensao |
| DIP SWITCH | — | **vias** | tensao, corrente, passo |
| CHAVE | — | **vias** | tensao, corrente, passo, genero, angulo |
| BARRA DE PINOS | — | **vias** | passo, genero, angulo |
| CONECTOR | — | **vias** + **subtipo do cadastro** | passo, genero, angulo |
| BATERIA | V | | tensao, corrente, dimensao |
| RELE | V | | tensao, corrente |
| TRANSFORMADOR | — | | tensao, corrente, potencia |
| AMPLIFICADOR | — | | tensao, potencia |
| CONVERSOR DC/DC, AC/DC, DC/AC, A/D, D/A, V/F, CONVERSOR, MICROCONTROLADOR, REGULADOR, OPTOACOPLADOR, TRANSCEPTOR, MEMORIA, RTC, SENSOR, GESTAO DE BATERIA, MODULO, CONTROLADOR, DRIVER, COMPARADOR, REFERENCIA DE TENSAO, CONTADOR, CIRCUITO INTEGRADO, TIMER | — | | nenhum: a identidade é o MPN (pode mandar `x_pinos` e `x_pinagem`) |

**Não fixe esta tabela no código.** Ela é a regra de hoje, e o Odoo responde a regra atual
(seção 5). Use a tabela para entender o formato; use a consulta para validar.

---

## 5. Pergunte as regras ao Odoo, não adivinhe

Tudo por `execute_kw`, com a conta de integração de sempre. Nenhum destes grava nada.

### 5.1 O que uma família pede

```python
odoo.execute_kw(DB, uid, SENHA, 'product.template', 'di_perfil_da_familia', ['CONECTOR'])
# {'atributos': ['passo', 'genero', 'angulo'], 'polaridades': [], 'valor': False,
#  'pinos': False, 'vias': True, 'subtipo_de_cadastro': True,
#  'obrigatorios': ['x_familia', 'x_montagem', 'x_mpn']}
```

`obrigatorios` traz só os três fixos. Por cima deles: encapsulamento (sempre, na peça nova),
valor se `valor: True`, vias se `vias: True`, polaridade se `polaridades` não vier vazio e
subtipo se `subtipo_de_cadastro: True`.

### 5.2 As listas fechadas

```python
# famílias, montagem, polaridade, dielétrico, gênero, ângulo: valor e rótulo
odoo.execute_kw(DB, uid, SENHA, 'product.template', 'fields_get',
                [['x_familia', 'x_montagem', 'x_polaridade',
                  'x_dieletrico', 'x_genero', 'x_angulo']],
                {'attributes': ['selection']})

# encapsulamentos da biblioteca (hoje 191; a equipe cadastra pacote novo pela tela)
odoo.execute_kw(DB, uid, SENHA, 'di.encapsulamento', 'di_selection', [])        # todos
odoo.execute_kw(DB, uid, SENHA, 'di.encapsulamento', 'di_selection', ['smd'])   # só os de SMD (+ NA)
```

**Encapsulamento fora da biblioteca é erro**, exceto no **CONECTOR**: lá ele é texto livre, a
série mecânica da peça (`'KK 2.54mm'`, `'Painel 5.5x2.5mm'`). O pacote também tem que bater com a
montagem: `0805` em `pth` é erro. Se o projeto usa um pacote que a casa ainda não tem, **avise o
projetista para pedir o cadastro do pacote no Odoo**. Não troque por um parecido.

### 5.3 Subtipos de conector

```python
odoo.execute_kw(DB, uid, SENHA, 'di.subtipo', 'search_read',
                [['|', ('familia', '=', False), ('familia', '=', 'CONECTOR')]],
                {'fields': ['name', 'familia']})
# KK, LATCH, Header com trava, Header sem trava, Baioneta, Bloco Terminal, SOQUETE, DB9, ...
```

A comparação ignora maiúscula e acento (`'kk'` casa com `KK`), e a peça é gravada com a grafia
do cadastro. Subtipo que não existe deixa a ficha **não pronta**, com a falta escrita.

### 5.4 Footprints da PcbLib

```python
odoo.execute_kw(DB, uid, SENHA, 'di.footprint', 'search_read', [[]], {'fields': ['name']})
```

### 5.5 O nome que a peça vai ter

```python
odoo.execute_kw(DB, uid, SENHA, 'product.template', 'di_nome_canonico', [bloco])
# 'Resistor de Filme Espesso 4.7K 1/10W 1% [RC0603FR-074K7L] 0603 SMD'
```

---

## 6. O recibo agora diz se a ficha está pronta

`di_confere_lista` (ensaio), `di_recebe_lista` e `di_estado_lista` devolvem o mesmo recibo de
antes, com duas novidades:

```python
{
  ...,
  'linhas_pendentes': 2,
  'linhas_prontas': 1,               # NOVO: quantas pendentes vieram com ficha completa
  'pendencias': [
    {'designadores': 'R7, R8',
     'nome_altium': 'Resistor 4K7 0603',
     'motivo': 'MPN RC0603FR-074K7L nao existe no acervo',
     'componente': {                 # NOVO
        'pronto': True,
        'nome_previsto': 'Resistor de Filme Espesso 4.7K 1/10W 1% [RC0603FR-074K7L] 0603 SMD',
        'faltas': [], 'erros': [], 'avisos': [], 'ignorados': []}},
    {'designadores': 'J3',
     'nome_altium': 'Conector 4 vias',
     'motivo': 'MPN XYZ-4 nao existe no acervo',
     'componente': {
        'pronto': False,
        'nome_previsto': 'Conector 4 vias [XYZ-4] PTH',
        'faltas': ["x_subtipo e obrigatorio em CONECTOR: escolha um da lista (KK, LATCH, "
                   "BLOCO TERMINAL...) ou cadastre o que faltar.",
                   "x_encapsulamento e obrigatorio na peca nova: o pacote da biblioteca, "
                   "ou NA quando nao ha pacote nomeavel."],
        'erros': ["x_tensao esta preenchido ('50V') mas CONECTOR nao pede esse atributo: "
                  "ele nao entraria no nome."],
        'avisos': [],
        'ignorados': ['cor']}},
  ],
}
```

| chave | significado | o que fazer |
|---|---|---|
| `pronto` | `True` = passa em todas as regras do cadastro novo | nada. O almoxarifado cria com um clique |
| `faltas` | campo obrigatório que não veio | completar a ficha |
| `erros` | campo que veio errado: fora da lista, pacote fora da biblioteca, atributo que a família não pede, pacote × montagem, MPN+encapsulamento que já existe (o erro traz o id: **mande o `product_id`**) | corrigir a ficha |
| `avisos` | não bloqueia (hoje: footprint desconhecido) | mostrar ao projetista |
| `ignorados` | chaves que ninguém leu | tirar do bloco ou corrigir o nome da chave |

Uma ficha que não está pronta **não impede o envio**. A linha entra na fila, e o formulário de
criação abre **já preenchido com tudo o que veio**. A pessoa só completa o que faltou. Mesmo
assim, o objetivo é `linhas_prontas == linhas_pendentes`.

---

## 7. O fluxo do seu lado

1. Para cada componente do esquemático, tente resolver no cadastro do Odoo (o dump que você já
   lê). Achou: `product_id`;
2. não achou: monte o bloco `componente` com o que a biblioteca/parâmetros do Altium e o
   datasheet sabem. Use a seção 5 para validar as listas **antes** de montar;
3. rode **`di_confere_lista`** (ensaio, não grava);
4. para cada pendência com `componente.pronto == False`, mostre ao projetista `faltas` + `erros`
   e o `nome_previsto`. Ele corrige o parâmetro no Altium (ou você completa do datasheet) e você
   repete o ensaio;
5. quando estiver bom (ou o projetista decidir mandar assim), envie com **`di_recebe_lista`**.
   Reenviar com o mesmo `uid_externo` enquanto a lista não foi decidida **substitui** as linhas,
   e esse é o jeito certo de corrigir;
6. depois que o almoxarifado criar os componentes, eles aparecem no próximo dump do cadastro com
   `product_id`. Daí em diante a peça resolve direto.

Sugestão de interface: no comando de envio, uma tabela por linha pendente com
`designadores | nome_previsto | PRONTO / falta: ...`, e o envio real só com `--aplicar`.

---

## 8. Exemplos de bloco completo (nomes conferidos no gerador do Odoo)

```python
# Capacitor cerâmico
{'x_familia': 'CAPACITOR CERAMICO', 'x_montagem': 'smd', 'x_encapsulamento': '0603',
 'x_mpn': 'CL10B104KB8NNNC', 'x_valor_txt': '100nF', 'x_tensao': '50V', 'x_dieletrico': 'X7R',
 'x_fabricante': 'Samsung'}
# -> Capacitor Ceramico 100nF 50V X7R [CL10B104KB8NNNC] 0603 SMD

# Transistor (valor = tensão principal; polaridade obrigatória)
{'x_familia': 'TRANSISTOR', 'x_polaridade': 'npn', 'x_montagem': 'smd',
 'x_encapsulamento': 'SOT-23', 'x_mpn': 'MMBT3904', 'x_valor_txt': '40V', 'x_corrente': '200mA',
 'x_pinagem': '1:B:Input;2:E:Passive;3:C:Passive'}
# -> Transistor NPN 40V 200mA [MMBT3904] SOT-23 SMD

# Conector (vias no lugar do valor; subtipo do cadastro; encapsulamento livre)
{'x_familia': 'CONECTOR', 'x_subtipo': 'KK', 'x_vias': 4, 'x_montagem': 'pth',
 'x_encapsulamento': 'KK 2.54mm', 'x_mpn': '22-23-2041', 'x_passo': 'P2.54mm',
 'x_genero': 'macho', 'x_angulo': '180g', 'x_fabricante': 'Molex'}
# -> Conector KK 4 vias P2.54mm Macho 180° [22-23-2041] KK 2.54MM PTH

# Microcontrolador (sem valor; identidade é o MPN)
{'x_familia': 'MICROCONTROLADOR', 'x_montagem': 'smd', 'x_encapsulamento': 'LQFP48',
 'x_mpn': 'STM32F103C8T6', 'x_pinos': 48, 'x_fabricante': 'STMicroelectronics',
 'x_pinagem': '1:VBAT:Power;2:PC13:IO;...'}
# -> Microcontrolador [STM32F103C8T6] LQFP48 SMD

# Amplificador
{'x_familia': 'AMPLIFICADOR', 'x_subtipo': 'Operacional', 'x_montagem': 'pth',
 'x_encapsulamento': 'DIP8', 'x_mpn': 'TL072CP', 'x_tensao': '36V'}
# -> Amplificador Operacional 36V [TL072CP] DIP8 PTH
```

---

## 9. O que você NÃO deve fazer

1. **Não chame `action_criar_prontos`, `action_aprovar` nem `action_recusar`.** Criar o
   componente e aprovar a lista são cliques de gente do almoxarifado: é isso que dá sentido à fila;
2. **não crie `product.template` direto.** O caminho da peça nova é o bloco `componente` na lista;
3. não mande `name`, `default_code` nem `x_hub_uid` (seção 3.5);
4. não invente encapsulamento, subtipo ou família que não estão nas listas: o recibo vai voltar
   com erro. Peça o cadastro no Odoo;
5. não fixe as listas do seu lado: consulte (seção 5).

---

## 10. Para testar

* Base de teste: **`teste`**, no mesmo servidor da produção (`odoo_db`). Teste lá primeiro;
* mande uma lista com: 1 linha por `product_id`, 1 peça nova **completa** (deve voltar
  `pronto: True`) e 1 peça nova **faltando o valor** (deve voltar `pronto: False` com a falta de
  `x_valor_txt`);
* no Odoo, menu **Lista do NexoEletric → Pendentes**: a lista mostra o aviso "N delas vieram com
  a ficha completa" e o botão **Criar os componentes prontos**. Depois do clique, a peça completa
  fica vinculada e a incompleta continua em "sem componente", com o formulário já preenchido;
* se algum número desta instrução não bater com o que o Odoo responder, **vale o Odoo**: meça de
  novo antes de seguir.
