# Editor no browser + Sinalizadores para a IA — design

Data: 2026-08-04 · Branch: code-improve · Status: aprovado pelo usuário

## Problema / Objetivo

Hoje o hub é um **viewer**: a IA escreve `changes.js`/`schematic.js`, o usuário confere
e o Altium aplica. Duas features novas transformam o hub em **editor**:

- **A — Edição interativa** nas vistas PCB e Esquema, estilo Altium: mover componentes,
  desenhar trilhas, adicionar vias, editar texto de designator/comment, adicionar
  componentes no esquema com ref/atributos. Tudo que o editor gera é serializado nos
  **mesmos formatos** que os scripts `.pas` já importam — o que a IA cria o usuário
  altera, e vice-versa.
- **B — Sinalizadores**: o usuário marca problemas direto na placa/folha (ex.: bandeira
  vermelha "trilha muito proxima"); as marcações ficam em `Projects\<nome>\annotations.js`
  e a IA é **obrigada por contrato** (AI-GUIDE.md) a lê-las e corrigi-las via `changes.js`,
  marcando cada uma como resolvida com uma resposta.

## Abordagens consideradas

- **Edição in-place nas vistas existentes (escolhida)**: ferramentas dentro de
  `pcbframe.js`/`schframe.js`, reaproveitando hit-testing, painéis e a linguagem visual
  de diff (added verde, fantasma tracejado, seta amarela) que o pipeline já renderiza —
  uma change empurrada no array e re-aplicada com `HubCore.applyPcbChanges` já aparece
  com o preview certo. Serializadores viram funções puras no `hub-core.js`.
- **Editor como app separado**: rejeitada — duplica renderers, quebra o contrato
  `file://` sem bibliotecas externas e cria uma terceira variante de câmera.
- **Anotações como ops dentro do `changes.js`**: rejeitada — polui o arquivo que o
  Altium consome e exigiria op nova nos dois lados; arquivo separado sobrevive a
  re-exports de graça (padrão create-if-missing do próprio `changes.js`).
- **Persistência**: aprovado o modo duplo (POST no hubserver quando servido por HTTP;
  download em `file://`). Rejeitadas: só download (fluxo manual demais para edição
  iterativa) e só servidor (mataria o duplo clique).

## Decisões aprovadas pelo usuário

1. Escopo: editores de **PCB e Esquema juntos** (implementação em fases).
2. **`comp_add` na PCB fica para fase própria futura** (Replicate de primitivas nunca
   testado no lado PCB do engine; depende da PcbLib acessível da máquina do Altium).
3. Persistência: **servidor + download** (modo duplo).
4. Anotações em **arquivo separado** `annotations.js` (decisão de design, não perguntada:
   alternativa rejeitada acima).

## Arquivos novos e alterados

| Arquivo | Mudança |
|---|---|
| `hub-io.js` (novo) | detecção de modo (`location.protocol`) + `saveFile(relPath, content)`: POST em HTTP, download Blob em `file://` |
| `hubserver.py` | rota `POST /api/save` (whitelist + escrita atômica) e `LIVE_JS` com hook `window.__hubOnChange` (reload escopado) |
| `hub-core.js` | `serializeChanges()`, `serializeSchematic()`, op nova `comp_attr` no switch de `applyPcbChanges` |
| `pcbframe.js` / `pcbframe.html` | loop `reapply()`, ferramentas de edição, propriedades por duplo clique, undo/redo, camada de sinalizadores, botão Salvar, carga de `annotations.js` |
| `schframe.js` / `schframe.html` | mesmo padrão: `reapply()`, picker de componentes das libs, fio/net label/power/junction/texto, mover/apagar/propriedades, sinalizadores, Salvar |
| `ApplyChanges.pas` | handler `DoCompAttr` (designator/comment por texto) no dispatcher, aplicado **por último** |
| `ExportBoard.pas` | cria `annotations.js` vazio se não existir (padrão do `changes.js`); flag `"annotations"` no `RegenerateProjectsIndex` (e nas cópias em `BuildSchematic.pas`/`ApplyChanges.pas`) |
| `tests/test-serialize.js` (novo) | round-trip dos serializadores + formato uma-linha |
| `tests/test-apply.js` | casos de `comp_attr` |
| `AI-GUIDE.md` | nova **Parte C — Sinalizadores** + política de dois escritores |
| `README.md` | seções de edição no browser e sinalizadores |

## Persistência

**Rota `POST /api/save`** (JSON `{"path": "Projects/<nome>/changes.js", "content": "..."}`):

- **Whitelist dura**: o path precisa resolver (via `safe_join`, como `_serve`) para
  `Projects\<nome>\` e o basename precisa ser `changes.js`, `schematic.js` ou
  `annotations.js`. Qualquer outro alvo → 403. Nome de projeto com acento/espaço chega
  URL-decodado em UTF-8.
- **Escrita atômica**: grava em arquivo temporário na mesma pasta + `os.replace`.
- Resposta 200 `{"ok":true}`; erros com status e mensagem. O servidor continua servindo
  a LAN (`0.0.0.0`) sem autenticação — mesma premissa de confiança do design do
  hubserver; a whitelist é a contenção (nenhum outro arquivo é gravável).

**Reload escopado**: `LIVE_JS` passa a fazer
`if (window.__hubOnChange) window.__hubOnChange(); else location.reload();`.
As vistas de edição definem o hook: com edição não salva, mostram aviso "workspace
mudou — recarregue quando quiser" (nunca recarregam sozinhas); sem edição pendente,
recarregam como hoje. `beforeunload` avisa quando houver trabalho não salvo.

**Formato emitido pelos serializadores** (restrição dura dos parsers DelphiScript):
cabeçalho de comentário + `var changes = [` / `var schematic = {...items:[` + **um objeto
JSON plano por linha** (só `pts` aninhado, numa linha) + fechamento. O serializador
**valida completude antes de gravar** — o parser Pascal converte campo ausente/inválido
em `0` silenciosamente (ex.: `comp_move` sem `x`/`y` mandaria o componente para a
origem), então changes incompletos são recusados no browser com mensagem. Strings não
podem conter a sequência `":` (contrato v1 existente).

## Op nova `comp_attr` (dois lados)

| Campo | Obrigatório | Significado |
|---|---|---|
| `op` | sim | `"comp_attr"` |
| `ref` | sim | designator atual do componente (chave de busca) |
| `orig_designator` | sim | texto atual do designator (trava, igualdade de string) |
| `orig_comment` | sim | texto atual do comment (trava) |
| `designator` | opcional | novo texto do designator |
| `comment` | opcional | novo texto do comment |
| `note` | opcional | anotação livre |

- `hub-core.js`: valida `orig_*` contra `board.js` (ausente = err, divergente = warn,
  padrão das demais ops), aplica em `eff` e destaca na PCB List.
- `ApplyChanges.pas`: `DoCompAttr` com `FindComponent(ref)` + trava por string; escreve
  `Comp.Name.Text` / `Comp.Comment.Text` entre `PCBM_BeginModify`/`EndModify` (mesmo
  padrão do `DoDesignatorMove`). **Aplicado por último no dispatcher** (uma passada
  extra após o loop principal): `FindComponent` casa por `Name.Text`, então um rename
  aplicado cedo quebraria ops seguintes que usem o ref antigo.
- Aviso documentado (relatório e AI-GUIDE): renomear designator na PCB dessincroniza do
  esquema — o ECO do Altium vai acusar; o fluxo canônico para rename é o esquema.

## Editor PCB — ferramentas

| Ferramenta | Ação | Ops geradas |
|---|---|---|
| Selecionar (padrão) | clique seleciona; **arrastar objeto move** (componente/trilha/via/arco); arrastar vazio = pan; `Espaço` rotaciona componente durante arrasto; duplo clique abre propriedades | `comp_move`, `track_edit`, `via_edit`, `arc_edit` |
| Trilha (`T`) | cliques encadeados, cada segmento uma change; largura/camada ativas na barra; snap à grade e a centros de pads; `Esc`/clique direito encerra | `track_add` |
| Via | clique + dialog size/drill (lembra últimos valores), net opcional da lista do `board.js` | `via_add` |
| Sinalizador (`N`) | clique posiciona bandeira + popup texto/severidade | escreve em `annotations.js` |
| Apagar | `Delete` no objeto selecionado | `track_del`, `via_del`, `arc_del` |
| Propriedades (duplo clique) | campos exatos: x/y/rot/camada/largura/net; designator/comment (texto); texto livre | `comp_move`, `comp_attr`, `text_edit`, `designator_move`, `*_edit` |

- **Editar objeto já alterado edita a change existente** (não empilha outra): a
  semântica `orig_*` compara sempre contra o `board.js`, então uma segunda change do
  mesmo objeto duplicaria a intenção. A UI localiza a change pelo alvo e a atualiza.
- **`Delete` em objeto adicionado pelo editor** (um `*_add` ainda não aplicado) remove
  a própria linha `*_add` do array — não gera `*_del` (que exigiria `orig_*` de um
  objeto que nem existe na placa).
- `reapply()` reconstrói painéis (corrigindo os builders append-only de
  `buildChangePanel`/`buildLayerPanel`) e re-resolve a seleção por id/ref — as
  referências de objeto morrem a cada `applyPcbChanges`.
- Undo/redo: pilha de snapshots do array `changes` (JSON), `Ctrl+Z`/`Ctrl+Y`, só em
  memória.
- Objetos sem op de edição (regiões, silk, freepads, textos de componente além de
  designator/comment) continuam somente leitura — o vocabulário é o do motor.

## Editor Esquema — ferramentas

| Ferramenta | Ação | Resultado em `schematic.items` |
|---|---|---|
| Adicionar componente | picker com busca em `schlib.js` (símbolo + footprint lado a lado, como a vista Libs); footprint default = `current` da lib; ref sugerido pelo prefixo (R1→R2); clique posiciona com snap 100 mil; `Espaço` rotaciona, `X` espelha | item `comp` |
| Fio | cliques ortogonais; **snap automático à ponta quente** dos pinos (raio de captura; exigência do Altium para conectar); `Esc`/duplo clique encerra | item `wire` |
| Net label / Power / Junction / Texto | clique + dialog | itens `netlabel`/`power`/`junction`/`text` |
| Mover | arrasto com snap 100 mil | atualiza `x`/`y` do item |
| Apagar | `Delete` | remove o item |
| Propriedades (duplo clique) | ref, comment, footprint (validado contra `pcblib.js` com crosscheck pino↔pad) | atualiza o item |

- Validação viva: após cada `reapply()` (`buildSchModel` + `extractNets` +
  `validateSchematic`), o painel existente acusa erros na hora (footprint obrigatório,
  grade, refs duplicados).
- **Limitação documentada**: para o Altium refletir edições numa folha já construída, o
  `BuildSchematic` deve rodar com **limpeza da folha** (confirmação "SIM" atual) — no
  ramo "já existia" ele não atualiza comment/footprint nem remove componentes apagados.
  Rebuild incremental fica para a fase futura do `comp_add`.

## Sinalizadores — `Projects\<nome>\annotations.js`

Formato (um objeto por linha, como os demais arquivos):

```js
var annotations = [
{"id":"n1","view":"pcb","x":12.5,"y":8.3,"layer":"Top","severity":"err","msg":"trilha muito proxima","ref":"","status":"open","created":"2026-08-04 10:00","reply":""},
{"id":"n2","view":"sch","sheet":"main","x":2400,"y":3400,"severity":"warn","msg":"conferir pull-up","ref":"R3","status":"resolved","created":"2026-08-04 10:05","reply":"trocado para 10k, change n2 no changes.js"},
];
```

| Campo | Significado |
|---|---|
| `id` | estável, gerado pelo browser (`n1`, `n2`… máx+1); **nunca** usa ids `t1`/`v2` do `board.js` (regenerados a cada export) |
| `view` | `pcb` (x/y em mm, `layer`) ou `sch` (x/y em mil, `sheet`) |
| `severity` | `err` (vermelho), `warn` (amarelo), `info` (azul) |
| `msg` | texto do usuário (sem a sequência `":`) |
| `ref` | opcional: ancora num componente (sobrevive a re-exports) |
| `status` | `open` → `resolved` |
| `created` / `reply` | data de criação / resposta da IA ao resolver |

- **UI**: bandeiras desenhadas por cima da placa/folha na cor da severidade; painel
  lateral lista todas (clique = zoom até o marcador); resolvidas esmaecidas com o
  `reply` visível; o usuário pode apagar ou reabrir. Carga tolerante à ausência do
  arquivo (guard `typeof annotations !== 'undefined'`, padrão do `changes`).
- **Lado Altium**: `ExportBoard` cria o arquivo vazio se não existir e **nunca**
  sobrescreve; flag `"annotations"` no `projects.js`.

### Contrato da IA (nova Parte C do AI-GUIDE.md)

1. Antes de qualquer trabalho de PCB/esquema num projeto, **ler
   `Projects\<nome>\annotations.js`**.
2. Para cada anotação `status:"open"`: corrigir via `changes.js` (cada change com
   `note` referenciando o id, ex.: `"note":"n1: trilha afastada 0.4mm"`), depois marcar
   `status:"resolved"` e preencher `reply` explicando o que foi feito.
3. **Nunca apagar nem reescrever** anotações do usuário; só mudar `status`/`reply`.
4. Dois escritores: `changes.js`, `schematic.js` e `annotations.js` agora são editados
   pelo usuário **e** pela IA. A IA deve **sempre re-ler o arquivo antes de editar** e
   preservar as linhas existentes (append/edição pontual, nunca regeneração do zero sem
   pedido explícito).

## Tratamento de erros

- Save por HTTP falhou (servidor caiu, 403, rede): toast com o erro + oferta de
  download como fallback; a edição continua em memória.
- Serializador recusa change incompleto/inválido com mensagem apontando o campo (nunca
  grava arquivo que o `.pas` interpretaria com zeros silenciosos).
- `reapply()` mantém o comportamento atual do motor: change com `orig_*` ausente = err
  (ignorada no preview), divergente = warn — o editor nunca gera err porque copia
  `orig_*` de `m.src`.
- Anotação em projeto sem `annotations.js`: o primeiro save cria o arquivo.
- `__hubOnChange` com edição pendente nunca recarrega sozinho (aviso não modal).

## Testes

- `tests/test-serialize.js` (novo): fixture `_DemoKit` → `serializeChanges`/
  `serializeSchematic` → reload via `tests/load.js` → deep-equal; asserções de formato
  (um objeto por linha, `pts` numa linha, header presente); recusa de change incompleto.
- `tests/test-apply.js`: `comp_attr` ok / orig divergente (warn) / ref inexistente
  (err) / rename refletido na PCB List.
- Cadeia completa: `node tests/test-geom.js && node tests/test-apply.js && node
  tests/test-netextract.js && node tests/test-validate.js && node tests/test-serialize.js`.
- Browser-only (`pcbframe.js`, `schframe.js`, `hub-io.js`): `node --check`.
- `python -m py_compile hubserver.py`; rota POST verificada com curl (save válido,
  path fora da whitelist → 403, escrita atômica).
- Verificação manual do usuário: editar no browser, salvar, rodar `ApplyChanges`/
  `BuildSchematic` no Altium e conferir; criar sinalizador, pedir correção à IA,
  conferir `status:"resolved"` + `reply`.

## Fases de implementação

1. **Infra**: `hub-io.js`, rota POST, reload escopado, serializadores + testes.
2. **Sinalizadores** (PCB e esquema) + Parte C do AI-GUIDE — entrega o fluxo
   usuário-marca → IA-corrige o quanto antes.
3. **Editor PCB** + `comp_attr` nos dois lados.
4. **Editor Esquema**.

Cada fase sai funcional, testada e commitada.

## Fora de escopo

- `comp_add`/`comp_del` na PCB e rebuild incremental do `BuildSchematic` (fase própria
  futura, decisão do usuário); `text_add` (texto/silk novo) em qualquer lado; placas
  4+ camadas (whitelist atual Top/Bottom); DRC no browser (continua sendo do Altium);
  criação de projeto novo pelo browser (`projects.js` é do indexador `.pas`); unificação
  das câmeras (`pcbframe` própria vs `HubDraw.mkCamera`); autenticação no hubserver;
  edição de regiões/polígonos/keepouts/silk.
