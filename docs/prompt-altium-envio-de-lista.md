# Spec para o AltiumPCBMirror — enviar a lista de componentes do projeto para o Odoo

> Cole este arquivo inteiro na sessão que trabalha no workspace **AltiumPCBMirror**.
> Ele descreve o contrato completo do lado do Odoo, que já está **implementado, testado e
> no ar** no servidor de teste (`192.168.15.182:8070`, base `odoo_db`) desde 2026-09-11.
> Nada aqui é proposta: os três métodos existem e respondem por XML-RPC hoje.

---

## 0. O que mudou do lado do Odoo

Você já manda o vocabulário e lê o cadastro; agora existe **o caminho de volta**. O
projetista desenha o esquemático no Altium usando a biblioteca que sai do Odoo, e você manda
a lista de componentes do projeto para cá.

A regra que define o desenho todo: **a lista não entra no inventário quando chega.** Ela cai
numa fila de aprovação (`di.lista.altium`), alguém do estoque confere e decide. Só na
aprovação nascem:

* um `product.template` **"PCB (montada)"** com o nome do projeto (`Projeto rev B`), estocável,
  na categoria `PCB Montada`;
* uma **`mrp.bom`** (lista de materiais) com uma linha por componente e a quantidade.

Antes da aprovação não existe produto novo, não existe movimento de estoque, não muda nada no
inventário. Isso é deliberado: o que você manda é o desenho de um projetista, não um fato do
almoxarifado — entre os dois tem uma pessoa que sabe se o projeto virou placa, se a revisão é
a que foi para a fábrica e se os componentes são os que a casa compra.

Módulo: `di_lista_altium` 19.0.1.0.0, que depende de `di_componente_eletronico` (o dos campos
declarados) e de `mrp`. Tela: menu **Listas do Altium → Pendentes**.

---

## 1. Os três métodos que você chama

Modelo: **`di.lista.altium`**. Tudo por `execute_kw`, com a conta de integração de sempre.

| método | para quê | grava? |
|---|---|---|
| `di_confere_lista(payload)` | **ensaio**: resolve as linhas e diz o que resolveria | não |
| `di_recebe_lista(payload)` | envia de verdade; idempotente por `uid_externo` | sim |
| `di_estado_lista(uid_externo)` | consulta em que pé está o envio | não |

Os três devolvem o **mesmo recibo** (seção 4). Chame sempre `di_confere_lista` primeiro:
mandar lista que você já sabe que está incompleta só enche a fila de trabalho de quem confere.

---

## 2. O payload

```python
payload = {
    'uid_externo': 'altium:MEDIDOR-BANCADA:B',   # chave de idempotência — leia a seção 3
    'projeto':     'Medidor de Bancada',         # OBRIGATÓRIO: vira o nome da PCB no Odoo
    'revisao':     'B',                          # entra no nome: "Medidor de Bancada rev B"
    'origem':      'AltiumPCBMirror',            # opcional, é o default
    'enviado_por': 'lucas',                      # quem apertou o botão do seu lado
    'observacao':  'Protótipo 2, sem o conector J3.',
    'linhas': [                                  # OBRIGATÓRIO, não pode vir vazio
        {'designadores': 'R1, R2, R5',           # como a peça aparece no esquemático
         'quantidade':   3,                      # OBRIGATÓRIO, > 0
         'product_id':   1891,                   # id da VARIANTE (product.product)
         'nome_altium':  'Resistor 10K 0805 SMD',
         'footprint':    '0603'},
        {'designadores': 'U1', 'quantidade': 1,
         'hub_uid': '4ccc670cafec1bb8',          # alternativa ao product_id
         'nome_altium': 'Amplificador Operacional LF398N DIP8'},
        {'designadores': 'U2', 'quantidade': 1,
         'mpn': 'INA219BIDR', 'encapsulamento': 'SOIC8',   # última alternativa
         'nome_altium': 'Amplificador de Corrente INA219'},
    ],
}
```

**Uma linha por componente, com os designadores agrupados.** `R1, R2, R5` é **uma** linha com
`quantidade: 3`, e não três linhas de 1. É assim que a BoM do Odoo quer o dado, e é assim que
quem confere lê a placa.

### Como o Odoo resolve cada linha — a ordem importa

1. **`product_id`** — o id da **variante** (`product.product`), que você leu do próprio Odoo
   quando gerou a biblioteca. É o único que não depende de texto. **Use este sempre que tiver.**
   Cuidado: `x_` mora no `product.template`, mas a lista quer o id do `product.product`
   (`pp 1891 = pt 1889`, não são o mesmo número);
2. **`hub_uid`** — o hash dos quatro campos de identidade (`x_hub_uid`), que você já conhece;
3. **`mpn`**, opcionalmente com **`encapsulamento`** junto. Sem o encapsulamento, `1N4007` casa
   com DO-41 **e** com M7 e a linha volta como ambígua — o Odoo não escolhe por você.

> **Nunca mande `default_code`.** Neste acervo o `default_code` é o **endereço físico da peça
> no almoxarifado**, não part number. Casar por ele colocaria na placa o componente que mora
> na mesma gaveta.

Linha que não resolve **não é erro**: ela é gravada assim mesmo, marcada, com o motivo escrito
(`"MPN X não existe no acervo"`, `"hub_uid Y casa com mais de um produto"`). Quem confere
aponta o componente na mão — ou recusa a lista. O que ela impede é a **aprovação**: a lista só
fecha quando toda linha aponta para um produto.

---

## 3. `uid_externo` — a chave de idempotência

**Componha um valor estável por projeto + revisão** e mande sempre o mesmo. Sugestão:
`altium:<PROJETO>:<REVISAO>`.

O que o Odoo faz com ele:

| situação | o que acontece |
|---|---|
| UID novo | cria a solicitação, estado `recebida` |
| UID que existe e ainda está pendente | **substitui as linhas** e recomeça a conferência (`gravou: true`) |
| UID que existe e já foi **aprovada** ou **recusada** | **não mexe em nada** e devolve o estado atual (`gravou: false`) |

Ou seja: reenviar é seguro e é a forma certa de corrigir a lista antes da decisão. Depois da
decisão, para mandar outra versão **mude a revisão** (e com ela o UID) — placa de revisão
diferente é outra placa no estoque, e o Odoo trata como outra.

Mandar sem `uid_externo` funciona, mas aí **todo envio cria uma solicitação nova**. Não faça.

---

## 4. O recibo

```python
{'id': 11, 'referencia': 'LISTA/2026/0011', 'estado': 'recebida',
 'projeto': 'Medidor de Bancada', 'revisao': 'B',
 'uid_externo': 'altium:MEDIDOR-BANCADA:B',
 'total_linhas': 4, 'linhas_pendentes': 1,
 'pendencias': [{'designadores': 'R1, R2, R3',
                 'nome_altium': 'Resistor 4K7 0603',
                 'motivo': 'MPN NAO-EXISTE-NO-ODOO nao existe no acervo'}],
 'produto_id': False, 'bom_id': False, 'motivo_recusa': '',
 'ja_existia': False, 'gravou': True}
```

`estado` é um de: **`recebida`** (na fila), **`analise`** (alguém assumiu a conferência),
**`aprovada`** (virou placa: `produto_id` e `bom_id` preenchidos), **`recusada`**
(`motivo_recusa` diz por quê). O ensaio devolve `estado: 'ensaio'` e `id: False`.

**O que fazer com cada um, do seu lado:**

* `linhas_pendentes > 0` → mostre as pendências para o projetista **antes** de enviar. Ele
  provavelmente usou peça que ainda não está no cadastro do Odoo — e essa peça precisa ser
  cadastrada lá, não inventada aqui;
* `recusada` → leia `motivo_recusa` e mostre. Não reenvie o mesmo UID esperando resultado
  diferente: corrija o que o motivo diz e mande com a revisão nova;
* `aprovada` → acabou. Guarde `produto_id` e `bom_id` se quiser linkar o projeto à placa.

---

## 5. Erros: o que vem como fault do XML-RPC

O Odoo recusa payload torto **na porta**, com `ValidationError` (vira fault no seu lado). Erro
de integração tem que doer em quem envia, e não virar solicitação meia-boca na fila de quem
confere:

| mensagem | o que consertar |
|---|---|
| `projeto e obrigatorio` | faltou o nome do projeto |
| `linhas e obrigatorio e nao pode vir vazio` | lista sem componente não é lista |
| `Linha N: quantidade tem que ser maior que zero` | quantidade 0 ou negativa |
| `Linha N: quantidade %r nao e numero` | mandou string que não converte |
| `Linha N nao e um dicionario` | formato da linha |

Falha de rede ou de autenticação: **repita o envio com o mesmo `uid_externo`**. É idempotente
exatamente para isso.

---

## 6. O código, inteiro

```python
import os, xmlrpc.client

URL, DB = 'http://192.168.15.182:8070', 'odoo_db'
USER, SENHA = 'integracao.hub@dieletrons.com', os.environ['ODOO_SENHA']

comum = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common')
uid = comum.authenticate(DB, USER, SENHA, {})
odoo = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object')

def chama(metodo, *args):
    return odoo.execute_kw(DB, uid, SENHA, 'di.lista.altium', metodo, list(args))

ensaio = chama('di_confere_lista', payload)          # 1. ensaio, não grava
if ensaio['linhas_pendentes']:
    for p in ensaio['pendencias']:
        print(f"  {p['designadores']:<14} {p['nome_altium']:<40} {p['motivo']}")
    # decida com o projetista se envia assim mesmo (a fila aceita) ou corrige antes

recibo = chama('di_recebe_lista', payload)           # 2. envia
print(recibo['referencia'], recibo['estado'])

estado = chama('di_estado_lista', payload['uid_externo'])   # 3. mais tarde
```

A senha vem de variável de ambiente ou do prompt. **Nunca de `hub-almox.json`** — aquele
arquivo responde 200 em texto claro na LAN, é o vazamento conhecido e ainda aberto.

---

## 7. O que você NÃO deve fazer

1. **Não chame `action_aprovar` nem `action_recusar`.** A conta de integração por acaso está
   no grupo de administrador de inventário e o servidor deixaria — mas aprovar é o ato humano
   que justifica a fila existir. Aprovar por robô é o mesmo que não ter aprovação;
2. **não crie `product.template` nem `mrp.bom`** direto. A placa e a BoM nascem da aprovação;
3. **não escreva em `di.lista.altium` por `create`/`write`.** Use `di_recebe_lista`: é ela que
   resolve as linhas, valida o payload e mantém a idempotência;
4. **não mande `default_code`** (seção 2);
5. **não renomeie produto** — continua valendo o combinado: renomear só depois que você
   rechavear a biblioteca por `product_id`.

---

## 8. O que eu preciso de você

1. um comando no seu lado (`push-lista` ou equivalente) que monte o payload a partir do
   esquemático, rode o **ensaio por padrão** e só envie com um `--aplicar` explícito;
2. **o `product_id` da variante em toda linha que puder** — é o único casamento que não
   depende de texto. Você já tem esse id: foi dele que a biblioteca nasceu;
3. **`uid_externo` estável** por projeto+revisão, guardado do seu lado junto com o `id` e a
   `referencia` que o recibo devolve;
4. o retorno para o projetista quando a lista for **recusada** — o `motivo_recusa` escrito
   pela pessoa do estoque é o que fecha o ciclo;
5. e o de sempre: se algum número desta spec não bater quando você chegar, **meça de novo
   antes de seguir**.

---

## 9. Para ver funcionando agora

Existe uma solicitação de exemplo na fila do teste: **`LISTA/2026/0011` — "Exemplo Medidor de
Bancada"**, 4 linhas, 3 resolvidas e 1 propositalmente sem componente (`MPN
NAO-EXISTE-NO-ODOO`), para a tela ser vista nos dois estados. Ela pode ser recusada ou apagada
sem dó.

Estado do módulo em 2026-09-11: **15 testes passam** (`--test-tags /di_lista_altium`), 0
falhas. Os testes cobrem exatamente as regras desta spec — resolução por id/hub_uid/MPN,
reenvio que não duplica, aprovação que cria placa + BoM, aprovação barrada com linha pendente,
recusa sem motivo barrada, e lista aprovada que ignora reenvio.
