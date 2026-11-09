---
nome: projeto-novo
titulo: Iniciar um projeto (placa) novo — código no catálogo da casa e carimbo preenchido
descricao: Processo da casa para começar um projeto de placa do zero — perguntar o nome da placa e QUEM INICIOU o projeto, mostrar o código que ela vai ganhar no catálogo CATALOGAÇÃO TODOS OS PRODUTOS, registrar e criar o projeto com o template da DIEletrons preenchido. Use sempre que o usuário pedir para criar, iniciar, começar ou abrir um projeto, placa, PCB ou esquema NOVO.
---

# Projeto novo (placa da casa)

**A regra da casa:** toda placa nova é registrada no catálogo de produtos
(`\\192.168.15.31\Controle de Projetos\CATALOGAÇÃO TODOS OS PRODUTOS .xlsx`). O código dela é:
- **P** (de placa);
- as iniciais do nome, sem "placa" e sem os conectivos (de, do, da, para, e…);
- **-DI**;
- o ano com dois dígitos;
- o número do produto no catálogo.

Exemplos: "Placa adaptadora encoder linear", item 1940 em 2026, é `PAEL-DI261940`; "Dispositivo de comissionamento
para drivers" é `PDCD-DI261939`.

O projeto nasce com uma folha A4 no template da casa (`casa:A4_DiEletrons`) e o carimbo preenchido:
- código da placa;
- `SCH-DI…`;
- nome;
- **quem iniciou** (DESEN.);
- data.

No hub é o botão **Novo projeto** do painel Projetos (ou Arquivo › Novo projeto…); pela IA, o caminho é este.

## Passo a passo

1. **Pergunte ao usuário, antes de criar qualquer coisa:**
   - o **nome da placa** (ex.: "Placa adaptadora encoder linear");
   - **quem iniciou o projeto**, que vai no quadro de título. Com alguém logado no Nexo Hub vale o nome do login (o
     servidor põe sozinho, e essa pessoa vira a responsável pelo projeto); sem login, pergunte. Não invente nem use o
     nome do usuário do Windows;
   - o **cliente** e **para que serve** a placa (uma linha). São opcionais, mas vão para o catálogo: pergunte.
2. **`catalogo_previa {nome}`**: mostre ao usuário o código que vai sair (`codigo`) e o número (`proximo`). Ele pode
   pedir outra sigla: chame de novo com `sigla`.
3. **Confirme com o usuário antes de registrar.** Criar acrescenta uma linha no catálogo da empresa e não se desfaz
   sozinho. Só siga com o "sim".
4. **`projeto_criar {produto: {nome, iniciador, cliente, descricao, sigla}}`**: registra no catálogo e cria
   `Projects/<código>/`. Para outro nome de pasta, passe `nome`. O template do esquema é o da casa por padrão;
   pergunte se o usuário quer outro (`template`, um id de `sch_template`) ou nenhum (`template: ""`). Para outra
   folha, passe `folha`/`retrato`: o template da casa só entra sozinho em A4 deitada.
5. **Diga ao usuário:** o código, o item e a linha do catálogo (`catalogo`), e o nome do projeto. Depois siga com o
   esquema: `sch_buscar_simbolo` → `sch_adicionar`.

## Se der errado

- **"o catálogo está aberto em outro programa":** alguém está com o Excel aberto. Peça para fechar e chame de novo.
  Nada foi gravado.
- **O NAS não responde** (o arquivo ou a pasta não existe): a máquina não está entrando em "Controle de Projetos".
  Diga isso. **Não** crie o projeto sem registrar, a não ser que o usuário peça. Nesse caso, use `projeto_criar
  {nome}` sem `produto` e avise que o código fica para depois.
- **Projeto que já existe com código no nome** (ex.: "PDCD-DI261939 (PTYPE)"): o carimbo da casa já se preenche
  sozinho com o código e o formato da folha (menu da folha › template A4_DiEletrons). O nome e o cliente vêm do
  catálogo (`catalogo_previa {codigo}`).

## Não faça

- Não registre a mesma placa duas vezes: confira com `catalogo_previa {codigo}` se ela já existe.
- Não edite o .xlsx do catálogo à mão nem por outro caminho: só pelo `projeto_criar {produto}`.
- Não invente quem iniciou o projeto.
