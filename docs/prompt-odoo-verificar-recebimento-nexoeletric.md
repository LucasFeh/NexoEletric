# Instrução para a IA do Odoo: conferir o que o NexoEletric está mandando

> Cole este arquivo inteiro na sessão de IA que trabalha no **Odoo** (módulo `di_lista_altium`, base de produção
> `odoo_db` em 192.168.15.192:8070, base de teste `teste`).
>
> Ele complementa `prompt-altium-envio-de-lista.md` e `prompt-nexoeletric-componente-novo.md`. Lá estão as regras do
> envio da lista e do bloco `componente`. Aqui está o que o NexoEletric **de fato manda hoje** (versão 1.61.0) e o
> que você deve verificar, e corrigir ou vincular, do lado do Odoo.

## O que você vai fazer

Conferir, com listas reais que já chegaram e com um envio de teste, que **três coisas** são recebidas e ficam ligadas
ao que devem:

1. as **fotos da placa** (montada e virgem) que vêm junto da lista;
2. a **placa virgem**, que vem declarada na lista;
3. as **peças novas**, que vêm com a ficha completa no bloco `componente`, e o caminho delas até virarem produto e
   voltarem para o NexoEletric.

Onde algo não estiver ligado (a foto chegou mas não aparece no produto, a peça criada não volta no sincronismo,
falta permissão), **vincule ou corrija do lado do Odoo**. No fim, escreva um relatório curto do que conferiu, do que
corrigiu e do que depende de mudança no NexoEletric. Se algo aqui não bater com o que o Odoo faz, **vale o Odoo**:
meça e diga.

Não aprove nem recuse listas de produção e não clique em "Criar os componentes prontos" em produção sem o dono pedir.
Para testar esses botões, use a base `teste`.

---

## 1. O que chega: o payload de `di_recebe_lista`

O NexoEletric chama `di.lista.altium.di_recebe_lista(payload)` com a conta de integração (a do
`.hub-odoo.json` do PC que envia). Antes, sempre chama `di_confere_lista(payload)` (ensaio). Depois, chama
`di_estado_lista(uid_externo)` para acompanhar.

```python
{
  'uid_externo': 'altium:<SLUG-DO-PROJETO>:<REV>',   # ex. 'altium:PRJ-UR-DI261924:B' (estável por projeto+revisão)
  'projeto': 'PRJ-UR-DI261924',
  'revisao': 'B',
  'origem': 'AltiumPCBMirror',                       # ATENÇÃO: o envio ainda manda este valor, não 'NexoEletric'
  'enviado_por': 'lucas.ferreira@dieletrons.com',
  'observacao': '...',
  'linhas': [ ... ],                                 # seção 1.2
  # SÓ no di_recebe_lista (o ensaio não leva as fotos):
  'imagem_montada': '<PNG em base64>',               # seção 1.1
  'pcb_virgem': {'quantidade': 1, 'imagem': '<PNG em base64>'},
}
```

### 1.1 As fotos da placa

- **`imagem_montada`:** a foto 3D da placa **montada**, isométrica, com os componentes. É PNG em base64 e vem do
  arquivo `Projects/<p>/Renders/placa-montada.png`. Só vai se a foto existir, tiver até 15 MB e começar com a
  assinatura de PNG.
- **`pcb_virgem`:** vai **sempre que o projeto tem placa**, com `quantidade: 1`. Ela é o item "(Virgem)" que a casa
  põe na lista de toda placa montada. Quando existe a foto da placa **virgem** (de frente, sem componentes), vai
  dentro dela em `imagem` (PNG base64).
- **Quando vão:** as duas fotos ficam **fora** da assinatura da lista e **só vão no `di_recebe_lista`**, nunca no
  `di_confere_lista`.
- **Na ficha do NexoEletric:** a foto da montada já vira a miniatura da placa na biblioteca da rede (NexoBD). No Odoo,
  é ela que deve aparecer como foto da PCB montada.

### 1.2 As linhas

Cada linha tem `designadores` (`'R1, R2, R5'`), `quantidade`, `nome_altium` e às vezes `footprint`. Depois vem **uma**
destas três formas de identificar a peça:

| forma | quando | chaves |
|---|---|---|
| peça do cadastro | o NexoEletric achou o produto | `product_id` (a variante, `product.product`) |
| por MPN | não achou o id, mas sabe o código | `mpn` e, quando sabe, `encapsulamento` |
| **peça nova** | componente **criado localmente** no NexoEletric | **`componente`** (o bloco), **sem `product_id` e sem `mpn`** na linha |

As linhas `EXTRA n` são peças que vão na lista sem estar no esquema. Componentes marcados "não montar" (DNP) não
vão.

### 1.3 O bloco `componente` (peça nova)

As chaves são os campos `x_*` do produto, como no contrato. Detalhes que o NexoEletric aplica:

- **Chaves:** só as do contrato. `name`, `default_code`, `x_hub_uid` e `product_id` nunca vão. Vazio não vai.
  `x_vias` e `x_pinos` vão como inteiro. `x_montagem` vai em minúsculo (`smd`/`pth`) e `x_familia` em maiúsculo.
- **`x_pinagem`:** sai **sozinha dos pinos do símbolo** do componente (`num:nome:tipo;...`). O tipo que não está na
  lista do contrato vira `Passive`.
- **`footprint`:** é o nome do footprint na biblioteca do NexoEletric. Pode ser um da **biblioteca do hub** (criado
  no editor de footprint dele) que ainda **não existe no `di.footprint`**. O contrato diz que isso só gera aviso; é o
  esperado.
- **`links`:** levam a loja que o projetista pôs e, quando há datasheet, um link `{'name': 'Datasheet', 'url': ...}`.
- **`imagem`:** não vai. O Odoo usa a foto do catálogo pelo caso.
- **Regras:** o NexoEletric pergunta tudo ao Odoo pela conta de integração, com `execute_kw`:
  - `product.template.fields_get` de `x_familia`, `x_montagem`, `x_polaridade`, `x_dieletrico`, `x_genero` e
    `x_angulo`;
  - `di.encapsulamento.di_selection('smd')` e `di_selection('pth')`;
  - `di.subtipo.search_read` (`familia` vazia ou `CONECTOR`);
  - `di.footprint.search_read`;
  - `product.template.di_perfil_da_familia(<FAMÍLIA>)`.
- **Conferência de uma ficha sozinha:** quando o projetista ou a IA dele clicam em "Conferir no Odoo", o NexoEletric
  chama `di_confere_lista` com uma lista de **uma linha** e `uid_externo` = `'nexo:componente-local:L<n>'`, com
  `projeto` = `'Conferencia de componente local'`. É **ensaio**: não pode deixar registro nenhum no Odoo.

---

## 2. O que conferir

### 2.1 Permissões da conta de integração

Com a conta que o NexoEletric usa (o login do envio; hoje `lucas.ferreira@dieletrons.com`), chame cada método da
seção 1.3. Todos precisam responder **sem `AccessError`**, porque a tela de criação de componente do NexoEletric
monta os campos com eles. Também precisam responder `di_confere_lista`, `di_recebe_lista` e `di_estado_lista`.
**O que faltar, libere** só para leitura, com a regra de acesso ou o grupo certo do módulo.

### 2.2 As fotos e a placa virgem

Pegue as listas mais recentes de `di.lista.altium` com `origem` igual a `'AltiumPCBMirror'` ou `'NexoEletric'`.
Aceite os dois valores: o envio ainda manda o antigo.

1. **Onde a foto foi gravada:** ache onde o `di_recebe_lista` grava `imagem_montada` e `pcb_virgem.imagem`. Pode ser
   campo binário na lista, `ir.attachment` ou `image_1920` do produto. Diga onde é.
2. **O PNG é válido:** confira, numa lista que veio com foto, que o arquivo é PNG (começa com `\x89PNG`) e abre.
3. **A montada aparece onde deve:** ela tem de aparecer **na foto do produto da PCB montada** que a lista cria ou
   vincula. Se ela fica só na lista e não chega ao produto quando ele é criado ou aprovado, **ligue**.
4. **A virgem existe e tem foto:** o item "(Virgem)", com o mesmo código da placa, tem de existir na BoM com
   quantidade 1, e a foto da virgem tem de ir para o produto **dela**, não para o da montada.
5. **Reenvio:** reenviar com o mesmo `uid_externo` antes da decisão substitui as linhas. Confira que a foto nova
   também substitui a antiga, sem acumular anexos.
6. **Sem foto:** uma lista que chega sem `imagem_montada` não pode quebrar nem apagar foto que o produto já tinha.

### 2.3 As peças novas (bloco `componente`)

1. **Leitura do bloco:** numa lista de teste (seção 3), a linha com `componente` tem de voltar em `pendencias` com
   `componente: {pronto, nome_previsto, faltas, erros, avisos, ignorados}`, e `linhas_prontas` tem de contar as
   prontas.
2. **Peça que já existe:** a linha com `componente` cujo `x_mpn` + `x_encapsulamento` já existem no cadastro tem de
   **resolver sozinha** (sem pendência). O NexoEletric entende "sem pendência" como "a peça já existe" e manda o
   projetista usar a do almoxarifado.
3. **Ensaio não grava:** `di_confere_lista` com `uid_externo` `'nexo:componente-local:...'` não pode criar lista nem
   rascunho. Procure se há algum registro com esse prefixo; se houver, é defeito do ensaio.
4. **"Criar os componentes prontos"**, na base `teste`: o produto criado tem de sair com:
   - **`x_is_componente = True`** ("É componente eletrônico"). **É isto que decide se o produto entra no
     sincronismo da biblioteca** (`tools/almox/odoo_pull.py` lê `x_is_componente` de `product.template`). Sem a
     marca, a peça nunca volta ao NexoEletric e o componente fica "criado localmente" para sempre. Se a criação não
     marca, **corrija para marcar**;
   - o **nome canônico** com o MPN entre colchetes e o encapsulamento, por exemplo
     `Transistor NPN 40V 200mA [MMBT3904] SOT-23 SMD`. O sincronismo da biblioteca **não lê `x_mpn` nem
     `x_encapsulamento`**: tira os dois do nome (`[MPN] PACOTE MONT`). É por eles que o NexoEletric reconhece a
     peça criada;
   - `x_mpn` e `x_encapsulamento` **exatamente** como vieram no bloco, mais família, montagem, valor, atributos,
     pinagem, links e o footprint, quando ele existe no `di.footprint`;
   - a linha da lista **vinculada** ao produto novo: `di_estado_lista` passa a devolver a linha como resolvida, com o
     `product_id`.
5. **Ficha incompleta:** a peça com ficha incompleta continua em "sem componente", com o formulário de criação **já
   preenchido** com o que veio.

### 2.4 O caminho de volta (sincronismo)

Depois de criar uma peça na base `teste`, confira com uma busca igual à do sincronismo
(`product.template.search_read` com `x_is_componente = True`, pelo `write_date` recente) que ela **aparece**. É
nesse momento que o NexoEletric tira a tag "criado localmente" e passa a mandar o `product_id` dela.

---

## 3. O envio de teste

Na base **`teste`**, chame `di_confere_lista` e depois `di_recebe_lista` com:

```python
payload = {
  'uid_externo': 'altium:TESTE-NEXO-VERIFICA:A', 'projeto': 'TESTE-NEXO-VERIFICA', 'revisao': 'A',
  'origem': 'AltiumPCBMirror', 'enviado_por': 'ia-odoo', 'observacao': 'teste da verificação',
  'linhas': [
    {'designadores': 'R1, R2', 'quantidade': 2, 'product_id': <um product_id real de resistor>,
     'nome_altium': 'Resistor 10K 0805'},
    # peça nova COMPLETA: deve voltar pronto=True
    {'designadores': 'Q1', 'quantidade': 1, 'nome_altium': 'Transistor NPN 40V 200mA [MMBT3904-TESTEIA] SOT-23 SMD',
     'footprint': 'SOT-23',
     'componente': {'x_familia': 'TRANSISTOR', 'x_polaridade': 'npn', 'x_montagem': 'smd', 'x_encapsulamento': 'SOT-23',
                    'x_mpn': 'MMBT3904-TESTEIA', 'x_valor_txt': '40V', 'x_corrente': '200mA', 'x_fabricante': 'onsemi',
                    'x_pinagem': '1:B:Input;2:E:Passive;3:C:Passive', 'footprint': 'SOT-23',
                    'links': [{'name': 'Datasheet', 'url': 'https://www.onsemi.com/pdf/datasheet/mmbt3904lt1-d.pdf'}]}},
    # peça nova SEM o valor: deve voltar pronto=False, com a falta de x_valor_txt
    {'designadores': 'R7', 'quantidade': 1, 'nome_altium': 'Resistor [RC0603-TESTEIA] 0603 SMD',
     'componente': {'x_familia': 'RESISTOR', 'x_montagem': 'smd', 'x_encapsulamento': '0603', 'x_mpn': 'RC0603-TESTEIA'}},
  ],
  'imagem_montada': '<um PNG pequeno em base64>',
  'pcb_virgem': {'quantidade': 1, 'imagem': '<outro PNG pequeno em base64>'},
}
```

Use pacotes que existam na lista do `di_selection('smd')` da base de teste. Se `SOT-23` ou `0603` tiverem outra
grafia lá, use a de lá e anote. Confira os itens da seção 2 com essa lista. No fim, **apague a lista e os produtos
de teste** da base `teste`.

---

## 4. O relatório

Responda em poucas linhas, nesta ordem:

1. **Permissões:** o que respondeu, o que faltava e o que você liberou.
2. **Fotos:** onde ficam, se aparecem no produto da montada e no da virgem, e o que você ligou.
3. **Peças novas:**
   - os resultados de `pronto`, `faltas` e `nome_previsto` do teste;
   - se a criação marca `x_is_componente`;
   - se o nome sai com `[MPN]` e o pacote;
   - se a linha fica vinculada.
4. **Volta pelo sincronismo:** se a peça criada aparece na busca da seção 2.4.
5. **Para o NexoEletric mudar,** se houver. Por exemplo: "mandar `origem='NexoEletric'`", "o pacote X tem outra
   grafia", "o campo Y precisa de outro nome".
