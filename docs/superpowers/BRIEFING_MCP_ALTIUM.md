# Briefing — Adicionar uma camada MCP ao pipeline Altium existente

> **Para o Claude do VSCode.** Este documento é um briefing de arquitetura + plano de execução.
> Leia tudo antes de escrever qualquer código. A Fase 0 é obrigatória e **não** produz código.

---

## 1. Contexto

Existe hoje um sistema em produção, feito sob medida, que trabalha em cima de dados de PCB do Altium Designer.

**Como funciona hoje:**

1. Um script roda **dentro do Altium** (disparado manualmente pelo usuário, via menu/botão) e extrai dados da placa — componentes, posições, rotações, camadas, footprints e afins.
2. Esses dados são convertidos, por código fora do Altium, em **várias saídas diferentes**, entre elas:
   - página **HTML** de visualização/edição do layout;
   - arquivo **SVG** para máquina a laser (estêncil / marcação);
   - arquivo de **posição de componentes para o pick-and-place Neoden**;
   - outras saídas adicionais (o mapeamento completo é tarefa da Fase 0).
3. Existe também um caminho de **volta**: alterações feitas no HTML são transferidas por script para o **PCB List** do Altium, de modo que os componentes ficam exatamente na posição definida no HTML.
4. Hoje, quando se quer usar IA, o fluxo é: pedir para a IA editar o HTML → o HTML alterado volta para o Altium.

A base de código é **mista**: parte é script rodando dentro do Altium (DelphiScript/VBScript), parte é código em outra linguagem fora dele. A Fase 0 precisa determinar exatamente o quê é o quê.

---

## 2. Objetivo

Criar um **servidor MCP** que permita a uma IA ler o estado da placa, propor alterações de layout, aplicá-las no Altium e **verificar o resultado**, fechando o ciclo sem depender de a IA editar HTML como texto.

O problema do fluxo atual não é o copy-paste — é que **a IA trabalha cega**. Ela propõe posições uma vez, sem saber se colidiu, se violou clearance, se saiu da borda. Com MCP ela passa a ter retorno e itera até fechar.

---

## 3. Restrições invioláveis

Estas são condições de aceite. Uma solução que viole qualquer uma delas está errada, por mais elegante que seja.

1. **Nada do que funciona hoje pode quebrar.** A geração de SVG do laser, o arquivo do Neoden, o HTML e todas as demais saídas devem continuar produzindo resultado **byte-idêntico** (ou funcionalmente idêntico e comprovado) após a mudança.
2. **O MCP é um consumidor a mais, não o novo centro do sistema.** Ele se pluga na mesma fonte de dados que as outras saídas já usam. O pipeline existente não passa a depender do MCP para nada.
3. **Se o servidor MCP estiver desligado, ausente ou quebrado, todo o resto continua funcionando normalmente.** Dependência estritamente unidirecional: MCP → núcleo. Nunca núcleo → MCP.
4. **O script do Altium continua funcionando no modo manual atual.** Qualquer modo automático/watcher é uma adição opcional, ligada por configuração, com o modo manual intacto como padrão.
5. **Nenhuma escrita destrutiva sem rede de segurança.** Toda alteração aplicada no Altium precisa de snapshot prévio e de ser desfazível.

---

## 4. Fase 0 — Mapeamento (obrigatória, sem código)

Antes de propor qualquer coisa, levante e escreva em `docs/MAPA_ATUAL.md`:

### 4.1 Inventário de código

- Quais arquivos são script do Altium (DelphiScript/VBScript/`.pas`/`.vbs`) e quais são código externo, e em que linguagem.
- Quem chama quem. Qual é o ponto de entrada de cada fluxo.
- Como o usuário dispara cada operação hoje (qual menu, qual botão, qual comando).

### 4.2 Inventário de saídas

Para **cada** saída (HTML, SVG do laser, Neoden, e as demais que encontrar), documente:

| Campo | O que registrar |
|---|---|
| Nome | Como o usuário chama essa saída |
| Arquivo gerador | Onde no código ela é produzida |
| Formato/extensão | Exato |
| Consumidor | Quem/o quê lê esse arquivo (máquina, software, pessoa) |
| Campos usados | Quais campos dos dados do Altium ela realmente consome |
| Unidade e origem | mm ou mil? Origem no canto da placa, no origin do Altium, ou outro? Eixo Y cresce pra cima ou pra baixo? |
| Convenção de rotação | Graus, sentido, referência (pino 1? centro do body?) |
| Tolerância a mudança | O consumidor aceita variação de formatação (espaços, casas decimais, ordem das linhas)? |

> **Atenção especial ao Neoden e ao laser.** Máquinas costumam ser rígidas com formato, ordem de colunas, separador decimal e número de casas. Qualquer refatoração que passe perto desses geradores precisa ser validada por comparação de arquivo, não por leitura de código.

### 4.3 Formato de dados intermediário

- Existe hoje algum formato intermediário entre "script extraiu" e "gerador consumiu"? (JSON, CSV, texto delimitado, objeto em memória?)
- Se existe, ele já é o candidato natural a virar o **modelo canônico**.
- Se não existe — se cada gerador re-parseia a saída bruta do script por conta própria — isso é o achado mais importante da Fase 0 e muda o plano.

### 4.4 Caminho de volta (HTML → PCB List)

- Como exatamente a alteração sai do HTML e entra no Altium hoje.
- O que o script espera receber: formato, quais campos, em que ordem.
- Ele aplica **tudo** ou só o que mudou?
- É atômico? Se falhar no meio, o que acontece com a placa?

### 4.5 Entregável da Fase 0

Um documento com o mapa acima **mais** uma seção final: *"Riscos e pontos frágeis"* — onde uma mudança tem mais chance de quebrar algo silenciosamente.

**Pare aqui e apresente ao usuário antes de seguir.**

---

## 5. Arquitetura alvo

O desenho é em camadas, com uma regra só: **o modelo canônico é o centro, e tudo mais é periferia que depende dele.**

```
                    ┌─────────────────────┐
                    │   ALTIUM DESIGNER   │
                    │  (script interno)   │
                    └──────────┬──────────┘
                               │  ponte (arquivo)
                               ▼
                    ┌─────────────────────┐
                    │   MODELO CANÔNICO   │  ← fonte única de verdade
                    │   (board model)     │     versionado, validado
                    └──────────┬──────────┘
                               │
        ┌──────────┬───────────┼───────────┬──────────────┐
        ▼          ▼           ▼           ▼              ▼
    ┌───────┐  ┌───────┐   ┌────────┐  ┌────────┐   ┌──────────┐
    │ HTML  │  │  SVG  │   │ Neoden │  │ outras │   │ SERVIDOR │
    │       │  │ laser │   │        │  │        │   │   MCP    │  ← NOVO
    └───────┘  └───────┘   └────────┘  └────────┘   └────┬─────┘
                                                          │
                                                          ▼
                                                    ┌──────────┐
                                                    │    IA    │
                                                    └──────────┘
```

**Pontos-chave do desenho:**

- O servidor MCP é **só mais uma caixa na fileira de baixo**. Ele lê do modelo canônico igual ao gerador de SVG lê.
- O MCP escreve de volta usando **a mesma ponte** que o caminho HTML → PCB List já usa. Não se cria um segundo caminho de escrita.
- Se a caixa "SERVIDOR MCP" for deletada, o diagrama continua válido e o sistema continua funcionando.

---

## 6. Plano de implementação por fases

Cada fase termina com um estado funcional e testável. Não avance sem validar a anterior.

### Fase 1 — Consolidar o modelo canônico (refatoração pura)

**Objetivo:** ter uma única representação de dados da placa, em código, que todos os geradores consomem.

- Se já existir um intermediário, formalize-o: defina o schema explicitamente (dataclass/tipo/JSON Schema — o que couber na linguagem do projeto).
- Se não existir, **crie um**, e faça cada gerador passar a ler dele em vez de re-parsear a saída bruta.
- Campos mínimos: designador, footprint, posição X/Y, rotação, camada, lado (top/bottom), part number, e o que mais as saídas atuais precisarem.
- Guarde no modelo também os metadados de convenção: unidade, origem, sentido do eixo Y, referência de rotação. Convenção implícita é a principal fonte de bug nesse tipo de sistema.

**Regra de ouro desta fase:** comportamento externo idêntico. Nenhuma saída muda.

**Validação obrigatória:**

- Pegue 2–3 projetos reais de PCB (peça ao usuário) e gere todas as saídas **antes** da refatoração. Guarde como *golden files*.
- Refatore.
- Gere de novo e faça **diff byte a byte** contra os golden files. Zero diferença.
- Automatize isso como teste de regressão — ele vai proteger todas as fases seguintes.

### Fase 2 — Ponte bidirecional com o Altium

**Objetivo:** poder ler e escrever no Altium por programa, sem o usuário disparar script na mão a cada passo.

O Altium é um app desktop fechado; não dá pra chamar função dentro dele de fora. O caminho estável é uma **ponte por arquivo**:

1. O lado externo escreve um arquivo de comando (JSON) numa pasta acordada.
2. Um script dentro do Altium observa essa pasta e executa o comando.
3. O script escreve um arquivo de resposta (JSON) com resultado, erros e estado atualizado.
4. O lado externo lê a resposta.

**Como implementar sem quebrar o modo manual:**

- O script atual continua existindo e sendo disparável pelo menu, exatamente como hoje.
- Extraia a *lógica* dele para procedimentos reutilizáveis.
- Adicione um **segundo** ponto de entrada: um script com form + timer que fica observando a pasta, e que o usuário abre só quando quer o modo automático.
- Os dois pontos de entrada chamam os mesmos procedimentos. Zero duplicação de lógica, zero mudança no comportamento manual.

**Cuidados na ponte:**

- Escreva o arquivo com nome temporário e só então renomeie, para o observador nunca ler um arquivo pela metade.
- Todo comando carrega um `id` único; a resposta ecoa o mesmo `id`.
- Timeout do lado externo, com mensagem clara se o Altium não responder (provavelmente o script observador não está aberto).
- Log de tudo que passa pela ponte, em arquivo, com timestamp. Vai ser essencial pra depurar.

### Fase 3 — Servidor MCP

**Objetivo:** expor o modelo canônico e a ponte como ferramentas MCP.

Estrutura sugerida: pasta separada (`mcp_server/` ou similar), que **importa** o núcleo mas nunca é importada por ele. Verifique essa direção de dependência explicitamente — é a garantia da restrição nº 3.

**Ferramentas de leitura** (implemente primeiro, e só elas na primeira entrega):

| Ferramenta | Devolve |
|---|---|
| `ler_placa` | Lista de componentes: designador, footprint, X, Y, rotação, camada, lado |
| `ler_contorno` | Board outline / área útil, keep-outs |
| `ler_netlist` | Conexões entre pinos/componentes |
| `ler_regras` | Clearances, larguras, restrições relevantes |
| `estado_do_projeto` | Qual projeto está aberto, se há alterações não salvas |

**Ferramentas de escrita** (só depois que a leitura estiver sólida):

| Ferramenta | Faz |
|---|---|
| `propor_layout` | Recebe uma lista de posições, **valida**, e devolve o resultado da validação **sem aplicar** |
| `aplicar_layout` | Aplica de fato. Exige que o usuário/config tenha liberado escrita |
| `rodar_drc` | Dispara o DRC e devolve as violações em formato estruturado |
| `desfazer` | Reverte para o snapshot anterior |

**Convenções para as ferramentas:**

- Nomes e descrições em linguagem clara — é isso que a IA lê pra decidir o que chamar.
- Toda ferramenta de escrita tem parâmetro `dry_run`, default `true`.
- Erros voltam como texto explicativo do que houve e do que fazer, não como stack trace.
- Nada de uma ferramenta "faz tudo" com um parâmetro `modo`. Ferramentas específicas e nomeadas.

### Fase 4 — Camada de validação determinística

**Este é o ponto mais importante do projeto todo.**

A IA é boa em decidir *"esses quatro capacitores de desacoplamento devem ficar agrupados perto do pino de alimentação do regulador"*. Ela é ruim em garantir que 2,54 mm não invade 2,50 mm.

Portanto: **a IA propõe, o código verifica.**

Implemente em código comum (sem IA envolvida) verificações que rodam **antes** de qualquer escrita chegar ao Altium:

- sobreposição de courtyard entre componentes;
- componente fora do contorno da placa ou dentro de keep-out;
- violação de clearance mínimo;
- rotação fora dos valores permitidos para o footprint;
- componente movido para camada/lado inválido;
- designador inexistente ou duplicado na proposta;
- coordenadas fora de faixa plausível (pega erro de unidade — mm vs mil — na hora).

Se qualquer verificação falhar, **rejeite a proposta inteira** e devolva à IA uma mensagem descrevendo o que falhou e por quê. A IA corrige e tenta de novo. Esse é o loop que faz o sistema funcionar.

Nunca confie na IA como validador do próprio trabalho.

### Fase 5 — Segurança da escrita

Antes de qualquer `aplicar_layout` tocar na placa:

1. **Snapshot** do estado atual (cópia do arquivo do projeto ou export do estado, o que for viável).
2. Aplicar como **uma transação única** no Altium, para que um único Ctrl+Z reverta tudo.
3. Registrar em log: o que mudou, de onde pra onde, quando, disparado por quê.
4. Escrita **desligada por padrão**, ligada por configuração explícita.
5. Nunca aplicar em projeto com alterações não salvas sem avisar.

### Fase 6 — HTML como interface de revisão (opcional, faça por último)

O HTML deixa de ser canal de dados e vira canal de **revisão humana**:

- Renderiza a proposta da IA para o usuário conferir visualmente.
- O usuário arrasta o que não gostou.
- O que o usuário moveu na mão volta para o modelo com uma marca de *"ajustado pelo humano"*, e essa marca vira contexto para a IA na próxima rodada (*"o usuário reposicionou o C12 — respeite essa posição"*).

Isso põe engenheiro e IA trabalhando no mesmo desenho, com o humano tendo a palavra final.

---

## 7. Testes exigidos

- **Regressão de saídas** (da Fase 1): golden files de 2–3 projetos reais, diff byte a byte, rodando a cada mudança. Este é o teste que protege o sistema em produção — nunca o desative.
- **Round-trip:** ler a placa → escrever de volta sem alterar nada → conferir que nada mudou. Pega erro de conversão de unidade, arredondamento e convenção de rotação.
- **Validador:** casos sintéticos com colisão conhecida, fora da borda, unidade trocada. O validador tem que rejeitar todos.
- **Ponte:** comando com Altium fechado (deve dar timeout com mensagem clara), arquivo de resposta corrompido, comando desconhecido.
- **Isolamento:** apagar/desabilitar a pasta do servidor MCP e confirmar que HTML, SVG e Neoden continuam gerando normalmente.

---

## 8. O que NÃO fazer

- ❌ Não reescreva os geradores de SVG e Neoden "de passagem" enquanto refatora. Eles alimentam máquina física; mudança neles é projeto à parte, com validação própria.
- ❌ Não faça o pipeline existente depender do servidor MCP para nada.
- ❌ Não deixe a IA gerar arquivo de saída final (SVG, arquivo do Neoden) diretamente. Ela mexe no modelo canônico; os geradores determinísticos continuam produzindo os arquivos.
- ❌ Não implemente escrita antes da leitura estar estável e testada.
- ❌ Não substitua o modo manual do script do Altium pelo modo automático. Adicione, não troque.
- ❌ Não invente convenção de unidade/origem/rotação. Descubra a real na Fase 0 e documente.
- ❌ Não crie um segundo caminho de escrita para o Altium em paralelo ao que já existe.

---

## 9. Ordem de trabalho resumida

1. Fase 0 — mapear e documentar. **Parar e apresentar.**
2. Fase 1 — modelo canônico + golden files. **Parar e validar diff zero.**
3. Fase 2 — ponte bidirecional, modo manual preservado.
4. Fase 3 — servidor MCP, só leitura.
5. Fase 4 — validador determinístico.
6. Fase 3b — ferramentas de escrita, com `dry_run` por padrão.
7. Fase 5 — snapshot, transação, log.
8. Fase 6 — HTML como revisão humana.

---

## 10. Primeira mensagem esperada de você

Não comece a codar. Comece assim:

1. Liste os arquivos do projeto e classifique cada um (script Altium / núcleo / gerador / outro).
2. Aponte onde está cada gerador de saída.
3. Diga se existe ou não um formato intermediário hoje.
4. Liste as dúvidas que precisa tirar com o usuário antes de propor o desenho.

E então espere resposta.
