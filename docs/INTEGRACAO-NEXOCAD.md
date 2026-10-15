# Integração NexoCAD ⇄ NexoEletric — contrato

Os dois programas compartilham **uma biblioteca**, o **Nexo Hub** (o banco da rede "Nexo Hub"), e
conversam por HTTP local. A IA opera tudo pelos dois MCPs. Este arquivo é o lado do NexoEletric (antes
EletricHUB) do contrato. O banco e a API são do contrato do Nexo Hub (`..\nexohub\docs\CONTRATO.md`, a
autoridade); a §4 de lá resume o que cada programa faz. Até a 1.8.x a biblioteca era uma pasta
(`C:\Users\Public\Dieletrons\Biblioteca`); a migração (`tools/importar-biblioteca.mjs` do Nexo Hub) a leva
para o banco.

## 1. A biblioteca compartilhada (o Nexo Hub)

**Onde:** a API HTTP v1 do Nexo Hub. Ninguém abre o banco direto.
- Conexão: `NEXOHUB_URL` (e `NEXOHUB_TOKEN`) > `C:\Users\Public\NexoHub\conexao.json` (`{url, token}`) >
  `http://127.0.0.1:47800`. O app Nexo Hub grava o arquivo; para usar um servidor, basta trocar a URL.
- Clientes: `mcp/lib/nexohub.js` (Node: o sincronizador e o MCP) e `tools/rotas/nexocad.py` (o hubserver). O
  cliente oficial (`nexohub-cliente.mjs`) vai copiado em `electron/lib/` (conexão e presença do app).

**Quem grava o quê:**
- O NexoEletric publica (o sincronizador, `mcp/lib/nexohub-sync.js`; o app o roda num processo à parte ao abrir
  e quando `Libs/` ou `Projects/<p>/board.js|changes.js` mudam, e o MCP o roda no `nexo_sincronizar`):
  - **a biblioteca 3D:** cada modelo de `Libs/pcblib-hub.js` (STEP em `Libs/3d-hub/`) e da PcbLib da casa
    (`Libs/pcblib-3d.js` + `Libs/3d/`, que o hubserver tira da PcbLib sob demanda) vira um item `modelo3d` em
    `eletronicos/modelos-3d`: chave `nexoeletric-modelo` = o `file` do modelo, `atributos {footprints, origem:
    'pcblib-hub'|'pcblib-3d', arquivo}`, vínculos `footprint` (`para_ref` = o footprint) e a **revisão 1** com os
    papéis `step` e `origem` (o mesmo blob). Um modelo que já tem revisão **nunca** ganha outra do NexoEletric: as
    revisões 2 em diante são do NexoCAD. Footprint novo de um modelo que já existe só muda `atributos.footprints`
    e os vínculos. Idempotente (chaves resolvidas em lote, só sobe o que falta), 4 envios por vez, e retoma
    sozinho: item criado sem revisão ganha a revisão 1 na vez seguinte;
  - **as placas:** cada projeto com `board.js` vira um item `placa` (chave `nexoeletric-placa` = o projeto,
    categoria `placas`), com o papel `placa` = o pacote da §4. Revisão nova só quando o pacote muda
    (`atributos.pacote_sha`), com vínculos `usa` para cada item de modelo.
- O NexoCAD grava as revisões dos modelos (Ctrl+S) e os itens que ele cria.

**Do item do Nexo Hub ao que o hub desenha** (`/api/nexo/biblioteca`, no formato que o `hub-nexo.js` lê):

```json
{ "id":"el-sot-23-5-k3f9", "nome":"SOT-23-5", "tipo":"modelo3d", "categoria":"Eletrônicos",
  "categoria_id":"eletronicos/modelos-3d", "subcategoria":"Modelos 3D da PcbLib", "rev":3,
  "arquivos":{"step":"step","nexo":"nexo","thumb":"thumb"}, "bbox":[[-1.5,-0.8,0],[1.5,0.8,1.2]],
  "chaves":["3d-hub/1f2e...step"], "substitui":["3d-hub/1f2e...step"],
  "modelo":{"footprints":["SOT23-5"], "origem":"pcblib-hub"} }
```

- `substitui` = as chaves `nexoeletric-modelo` do item **só quando `rev > 1`** (foi editado no NexoCAD). A
  revisão 1 é a cópia do próprio STEP do hub e não troca nada.
- `eletronico.footprints` (com `mpn`, `fabricante`, `encapsulamento`) = os `atributos` de um item
  **`componente`**: o corpo que veste o footprint inteiro. Um `modelo3d` traz os footprints que o usam em
  `modelo.footprints`, só para a busca.
- `arquivos.step` presente = o item tem STEP para desenhar.
- `revisao` (do índice) é o `seq` do último evento do Nexo Hub.

**Chave de modelo do hub:** o campo `file` do modelo como o hub o tem. Exemplos:
- `3d-hub/<sha1>.step`, da biblioteca do hub;
- `3d/<checksum>.step`, da PcbLib da casa;
- `projeto:<p>/<arquivo>`, de um corpo do `board3d.js` de um projeto (publicado quando uma placa o usa).

**Referencial do STEP (papel `step`) de um item eletrônico:** o mesmo do footprint.
- X e Y são os do footprint, com a origem no ponto de inserção dele.
- Z sobe, a partir da face de cima da placa.
- No NexoCAD (Y para cima, como no SW) a peça é modelada com o plano Superior como a placa.
  O NexoCAD gira na exportação: (x, y, z) do NexoCAD → (x, −z, y) no STEP.
- Item importado de um STEP (`origem.step`, guardado sem mudança): o recurso Corpo STEP do NexoCAD gira o
  arquivo (x, y, z) → (x, z, −y) ao abrir, e a exportação desfaz o giro. O referencial do STEP original se mantém
  exatamente (ida e volta medida com a mesma caixa envolvente). Todo item fica com `"orientacao":"y-up"` (o .nexo).
- Até o 1º salvamento no NexoCAD, o `step` de um item importado é o próprio arquivo original (com as cores).
- Cores: o NexoCAD guarda as cores do STEP original como sondas e pinta cada face pela mais próxima (inclusive as
  faces novas de cortes e furos). O STEP salvo leva cor por face (XCAF).
- O STEP gravado no Nexo Hub está **sempre** em Z para cima.

**Vínculo pelo footprint:** quando um item `componente` lista um footprint em `atributos.footprints` (no
índice, `eletronico.footprints`), o hub usa esse item como o corpo 3D do footprint.
- A matriz é a identidade no referencial do footprint, com `x2d=y2d=0`, rotações 0, `dz=0`.
- Esse corpo entra no lugar dos corpos que o footprint tinha.
- Prioridade, da maior para a menor: `substitui` (troca só aquele corpo) > vínculo por
  footprint > as fontes de sempre do hub.


## 2. API do NexoCAD (já existia, ganha comandos)

**Sessão:** `%USERPROFILE%\.nexocad\session.json`, no formato `{port, token, pid}`.
- Só existe com o app aberto.
- Chamada: `POST http://127.0.0.1:<port>/rpc`, com `Authorization: Bearer <token>` e corpo
  `{command, params, source:"eletrichub"}` (o `source` é um identificador e não mudou com o nome).
- Resposta: `{ok, result|error}`.

**Executável:** `C:\Program Files\NexoCAD\NexoCAD.exe`. Alternativas, nesta ordem:
`%LOCALAPPDATA%\Programs\NexoCAD\NexoCAD.exe`, depois a variável `NEXOCAD_EXE`.
- Com o app fechado, o hub abre o exe e espera o `session.json` e o `GET /health`
  (com o token) responderem, até 60 s.

**Comandos novos** (também são ferramentas do MCP do NexoCAD):

| comando | parâmetros | faz |
|---|---|---|
| `biblioteca_info` | — | `{dir, existe, revisao, itens, categorias}` |
| `biblioteca_listar` | `categoria?, texto?, limite?` | itens do índice |
| `biblioteca_item` | `id` | o item, com caminhos absolutos |
| `biblioteca_abrir` | `id` | abre o `modelo.nexo` numa aba. Salvar a aba (Ctrl+S) grava de volta na biblioteca: `.nexo` + `.step` + miniatura + `rev++` |
| `biblioteca_editar_modelo` | `id?`, `chave?`, `step_path?` (arquivo local), `step_url?` (URL http local), `nome?`, `footprint?`, `categoria?` (padrão `Eletrônicos`), `novo?`, `geometria?` | com `id` (o hub sempre manda quando a chave já é um item do Nexo Hub, o que vale para todo modelo sincronizado): abre esse item, com a `geometria` para o esboço dos pads. Sem `id`: acha o item da `chave` ou cria um importando o STEP (`origem`, chave `nexoeletric-modelo`, `footprints:[footprint]`). Sem STEP e com `novo:true`: cria um item **vazio** vinculado ao footprint. Depois abre para edição. Devolve `{id, nome, criado, aberto}` |
| `biblioteca_importar_step` | `path`, `nome?`, `categoria?` | cria um item a partir de um STEP |
| `biblioteca_salvar_ativo` | `id?`, `nome?`, `categoria?`, `footprint?` | grava o documento ativo na biblioteca (novo item, ou por cima do `id`) |
| `biblioteca_editar_item` | `id`, `nome?`, `categoria?`, `descricao?`, `tags?`, `eletronico?`, `substitui?` | metadados |
| `biblioteca_remover` | `id`, `confirm:true` | apaga o item |
| `pcb_importar` | `item` (o item `placa` do Nexo Hub, desde a 1.9.0) ou `path` (um `placa.json` no disco, o formato antigo) | monta a placa no NexoCAD (montagem: placa + componentes); os modelos vêm dos itens que o pacote aponta (§4) |
| `pcb_caixa` | parâmetros da caixa | caixa em volta da placa, com aberturas para os conectores (só no NexoCAD) |

## 3. Rotas do servidor do hub (`tools/rotas/nexocad.py`)

Lêem o Nexo Hub pela API. As que mandam algo ao NexoCAD só aceitam pedidos desta máquina. O `libremota.py`
nunca as repassa ao servidor central.

| rota | o quê |
|---|---|
| `GET /api/nexo/estado` | `{ok, nexohub:{url, online, versao, modo, erro}, revisao, itens, nexocad:{aberto, versao, exe}}` (`dir`, `existe` e `indice` ficam por compatibilidade: a URL e se ela respondeu) |
| `GET /api/nexo/revisao` | `{revisao, online}`. Barata: o `seq` do último evento, que uma thread acompanha pelo SSE `/api/v1/eventos` (sem SSE, polling a cada 2 s). As páginas consultam a cada 1,5 s |
| `GET /api/nexo/biblioteca?categoria=Eletrônicos&texto=` | `{ok, online, revisao, categorias, itens}`: os itens no formato da §1, relidos quando a revisão muda. O padrão é `Eletrônicos` (com as subcategorias), `categoria=*` traz todos; `texto` busca em id, nome, descrição, tags, footprints, chaves, MPN e fabricante. Fora do ar: a última cópia, com `online:false` |
| `GET /api/nexo/arquivo/<id>/<papel>[?rev=N]` | o arquivo do item (`step`, `thumb`, `nexo`, `origem`, `placa`; `modelo.step` e `thumb.png` também valem), repassado do Nexo Hub e guardado por sha em `%TEMP%\nexoeletric-nexohub\` (`NEXOHUB_CACHE`) |
| `POST /api/nexo/editar` | `{chave, url, nome, footprint, geometria?}`, `{novo:true, footprint, nome, chave?, geometria?}` ou `{id}`. A `chave` vira item do Nexo Hub (publicado antes, se faltar, baixando a `url` do próprio hub) e o NexoCAD recebe `biblioteca_editar_modelo {id, chave, nome, footprint, geometria}`; `{id}` é `biblioteca_abrir`. Com o Nexo Hub fora do ar vale o caminho antigo (`step_path` num temporário). Devolve `{ok, result, id, rev?, criado?}` |
| `POST /api/nexo/placa` | `{pacote}` (§4, com a `url` de cada modelo). Publica o item `placa` (os modelos que faltam viram itens; revisão nova só se o pacote mudou) e chama `pcb_importar {item}`. Resposta: `{ok, result, item, rev, mudou, avisos}`; o modelo que não pôde ser publicado sai do pacote com os corpos e vai em `avisos` |

**`geometria`** (opcional, quando o footprint é conhecido): `{"pads":[{"nome":"1","x":0,"y":0,"w":1.2,"h":0.6,"rot":0,"forma":"rect|circle|oval|roundrect","furo":0}], "contorno":[[x,y],...]}`
em mm, no referencial LOCAL do footprint (origem dele, Y para cima, vista de cima). `contorno` (opcional) é o
polígono da caixa dos pads/serigrafia.
- `corpo`: matriz 4x4 coluna-principal modelo → footprint (16 números). Leva o ponto do STEP (o referencial
  do arquivo) ao referencial LOCAL do footprint (Z para cima, Z = 0 na face de cima da placa, vista de cima).
  É a matriz que o hub usa para aquele corpo: T(x2d, y2d, dz) · Rz(rotz) · Ry(roty) · Rx(rotx), antes da
  pose do componente (posição, giro, lado). Só vem ao editar um corpo STEP; falta em `novo:true` e no item
  vinculado pelo footprint (vale a identidade). O NexoCAD desenha o esboço dos pads no referencial do modelo
  com a inversa dela.


**Chave `nexo:<id>`:** o editor de footprint do hub pode prender um item do Nexo Hub direto ao footprint. O
corpo STEP fica com `model:"nexo:<id>"` e o modelo `{file:"nexo:<id>", name, nexo:"<id>"}`; o hub desenha o
`step` do item, com a matriz do corpo.

**Cache no navegador:** a chave do cache de malha (IndexedDB) de um corpo da biblioteca é
`nexo:<id>@<rev>`, e a url do STEP leva `?rev=<rev>`. Assim, salvar no NexoCAD troca a malha na hora.


## 4. Pacote da placa (`placa.json`, `eletrichub-placa-v1`)

Unidade mm. O referencial é o da placa do Altium: X para a direita, Y para cima, Z = 0 na face
de BAIXO da placa, face de cima em Z = `espessura`.

```json
{
  "format": "eletrichub-placa-v1",
  "projeto": "DMB - DI231765_P2",
  "gerado": "2026-10-15T13:00:00Z",
  "espessura": 1.6,
  "contorno": [[[0,0],[80,0],[80,60,0.414],[0,60]]],
  "recortes": [[[10,10],[12,10],[12,12],[10,12]]],
  "furos": [{"x":3.5,"y":3.5,"d":3.2,"tipo":"npth"}],
  "componentes": [
    {
      "ref": "J1", "footprint": "USB-C", "comment": "USB-C", "lado": "Top",
      "x": 40, "y": 0, "rot": 90, "bbox": [36, -2, 44, 6],
      "conector": true,
      "corpos": [
        {"tipo":"step", "modelo":"3d-hub/ab12.step", "matriz":[16 números, coluna principal], "cor":"#c0c0c0"},
        {"tipo":"extrudado", "pts":[[x,y],...], "z0":1.6, "z1":4.0, "cor":"#333333"}
      ]
    }
  ],
  "modelos": { "3d-hub/ab12.step": {"arquivo":"modelos/ab12.step", "nome":"USB-C.step"} }
}
```

**Campos:**
- `contorno`: laços fechados, o primeiro é o externo. O vértice é `[x,y]` ou `[x,y,bulge]`
  (bulge = tan(varredura/4), anti-horário positivo; o mesmo do `outline_set`).
- `recortes`: Board Cutouts.
- `furos`: o furo de fixação (NPTH ou pad passante grande) e os furos passantes.
  `tipo` é `pth`, `npth` ou `via`. As vias podem ser omitidas.
- `corpos[].matriz`: a transformação final do corpo no referencial da placa, com o lado de
  baixo já espelhado.
- `pts`: em coordenadas da placa.
- `conector`: o designador começa com J, CN, X, P, USB ou CON, ou o componente tem pad
  passante e passa da borda da placa.
- `modelos[].arquivo`: relativo à pasta do `placa.json` (o pacote antigo, em disco).

**No Nexo Hub (desde a 1.9.0)** o pacote é o papel `placa` de um item `placa`, e os modelos apontam itens, sem
arquivo:

```json
"modelos": { "3d-hub/ab12.step": {"item":"el-usb-c-k3f9", "rev":2, "nome":"USB-C.step"},
             "nexo:el-sot-23-a1": {"item":"el-sot-23-a1", "rev":1, "nome":"SOT-23"} }
```

- A chave continua a que os `corpos[].modelo` citam: a `nexoeletric-modelo` do modelo, ou `nexo:<id>`.
- `rev` é a revisão no momento da publicação; o NexoCAD pode usar a atual do item.
- O modelo que ainda não estava no Nexo Hub é publicado antes (revisão 1); o que não pôde ser publicado sai do
  pacote junto com os corpos que o usavam.
- `atributos.pacote_sha` do item `placa` = sha256 do JSON canônico do pacote sem `gerado` (chaves em ordem, sem
  espaços, números como o `JSON.stringify`). O Node (`nexohub-sync.js » shaPacote`) e o Python
  (`nexocad.py » sha_pacote`) dão o mesmo. Pacote igual = sem revisão nova.

**No NexoCAD:**
- A placa vira uma montagem: a peça "Placa" (contorno extrudado, com furos e recortes) mais
  um componente por corpo STEP (cada modelo é uma peça, reaproveitada entre instâncias).
- A placa fica no plano Superior: (x, y, z) da placa → (x, z, −y) do NexoCAD.
- O `pcb_caixa` lê esse mesmo pacote, o papel `placa` do item.
