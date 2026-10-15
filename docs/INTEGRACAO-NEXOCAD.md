# Integração NexoCAD ⇄ EletricHUB — contrato

Os dois programas compartilham **uma biblioteca** (o "BD") e conversam por HTTP local. A IA
opera tudo pelos dois MCPs. Este arquivo é o contrato. Uma cópia idêntica fica em
`docs/INTEGRACAO-NEXOCAD.md` do EletricHUB. Mudou aqui? Mude lá também.

## 1. A biblioteca compartilhada

**Pasta raiz:** padrão `C:\Users\Public\Dieletrons\Biblioteca`. A pasta Pública é gravável
por todos os usuários do Windows e fica fora do Acesso Controlado a Pastas.

**Ponteiro:** `C:\Users\Public\Dieletrons\biblioteca.json`, no formato `{"dir":"<pasta raiz>"}`.
- Os dois programas leem o ponteiro. Sem o ponteiro, vale o padrão.
- Só o NexoCAD grava o ponteiro (Configurações › Biblioteca compartilhada). A pasta pode ficar
  numa share de rede, para a empresa inteira usar a mesma biblioteca.
- Variável de ambiente `DIELETRONS_BIBLIOTECA`: passa por cima do ponteiro. Serve para testes.

**Estrutura da pasta:**

```
<raiz>/
  biblioteca.json            índice (abaixo)
  itens/<id>/modelo.nexo     fonte editável (peça NexoCAD)
  itens/<id>/modelo.step     STEP AP214 gerado a cada salvamento; Z para cima, mm
  itens/<id>/thumb.png       miniatura (opcional)
  itens/<id>/origem.step     o STEP original importado (opcional, nunca é sobrescrito)
  .lock                      trava curta de escrita (arquivo com pid+hora; vale 10 s)
```

**Quem grava:** só o NexoCAD, pelo app ou pelo MCP headless. O EletricHUB só LÊ a biblioteca;
para gravar, ele pede ao NexoCAD (seção 3). Toda escrita é atômica: grava `x.tmp` e renomeia.
O índice é relido e alterado dentro da `.lock`.

**Índice `biblioteca.json`:**

```json
{
  "format": "dieletrons-biblioteca", "version": 1,
  "revisao": 42,
  "atualizado": "2026-10-15T13:00:00.000Z",
  "categorias": ["Eletrônicos", "Mecânicos", "Fixadores", "Caixas", "Placas", "Outros"],
  "itens": [
    {
      "id": "el-sot-23-5-k3f9",
      "nome": "SOT-23-5",
      "categoria": "Eletrônicos",
      "subcategoria": "CI",
      "descricao": "",
      "tags": ["smd"],
      "rev": 3,
      "atualizado": "2026-10-15T13:00:00.000Z",
      "arquivos": { "nexo": "itens/el-sot-23-5-k3f9/modelo.nexo", "step": "itens/el-sot-23-5-k3f9/modelo.step", "thumb": "itens/el-sot-23-5-k3f9/thumb.png" },
      "bbox": [[-1.5, -0.8, 0], [1.5, 0.8, 1.2]],
      "eletronico": { "footprints": ["SOT23-5"], "mpn": "", "fabricante": "", "encapsulamento": "SOT-23-5" },
      "substitui": ["3d-hub/1f2e...step"],
      "origem": { "tipo": "eletrichub", "chave": "3d-hub/1f2e...step", "footprint": "SOT23-5", "nome": "SOT23-5.step" }
    }
  ]
}
```

**Campos:**
- `revisao`: sobe a cada mudança em qualquer item. É o que o hub consulta para atualizar.
- `rev`: sobe a cada salvamento daquele item.
- `arquivos`: caminhos relativos à raiz, com `/`.
- `bbox`: em mm, no referencial do `modelo.step`.
- `eletronico`: só existe em itens da categoria `Eletrônicos`. `footprints` é a lista de
  footprints do hub/Altium que usam este corpo 3D.
- `substitui`: as **chaves de modelo do hub** que este item substitui. O hub, ao desenhar um
  corpo STEP cuja chave está aqui, usa o `modelo.step` deste item no lugar.

**Chave de modelo do hub:** o campo `file` do modelo como o hub o tem. Exemplos:
- `3d-hub/<sha1>.step`, da biblioteca do hub;
- `3d/<checksum>.step`, da PcbLib da casa;
- `projeto:<p>/<arquivo>`, de um corpo do `board3d.js` de um projeto.

**Referencial do `modelo.step` de um item `Eletrônicos`:** o mesmo do footprint.
- X e Y são os do footprint, com a origem no ponto de inserção dele.
- Z sobe, a partir da face de cima da placa.
- No NexoCAD (Y para cima, como no SW) a peça é modelada com o plano Superior como a placa.
  O NexoCAD gira na exportação: (x, y, z) do NexoCAD → (x, −z, y) no STEP.
- Item importado de um STEP (`origem.step`) mantém o referencial original e fica com
  `"orientacao":"z-up"`. Item modelado no NexoCAD fica com `"orientacao":"y-up"`.
- O STEP gravado na biblioteca está **sempre** em Z para cima.

**Vínculo pelo footprint:** quando um item `Eletrônicos` lista um footprint em
`eletronico.footprints`, o hub usa esse item como o corpo 3D do footprint.
- A matriz é a identidade no referencial do footprint, com `x2d=y2d=0`, rotações 0, `dz=0`.
- Esse corpo entra no lugar dos corpos que o footprint tinha.
- Prioridade, da maior para a menor: `substitui` (troca só aquele corpo) > vínculo por
  footprint > as fontes de sempre do hub.

## 2. API do NexoCAD (já existia, ganha comandos)

**Sessão:** `%USERPROFILE%\.nexocad\session.json`, no formato `{port, token, pid}`.
- Só existe com o app aberto.
- Chamada: `POST http://127.0.0.1:<port>/rpc`, com `Authorization: Bearer <token>` e corpo
  `{command, params, source:"eletrichub"}`.
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
| `biblioteca_editar_modelo` | `step_path` (arquivo local) **ou** `step_url` (URL http local), `chave`, `nome`, `footprint?`, `categoria?` (padrão `Eletrônicos`) | acha o item cujo `substitui` contém a `chave`. Se não houver, cria um, importando o STEP: `origem.step`, `orientacao:"z-up"`, `substitui:[chave]`, `eletronico.footprints:[footprint]`. Depois abre para edição. Devolve `{id, criado}` |
| `biblioteca_importar_step` | `path`, `nome?`, `categoria?` | cria um item a partir de um STEP |
| `biblioteca_salvar_ativo` | `id?`, `nome?`, `categoria?`, `footprint?` | grava o documento ativo na biblioteca (novo item, ou por cima do `id`) |
| `biblioteca_editar_item` | `id`, `nome?`, `categoria?`, `descricao?`, `tags?`, `eletronico?`, `substitui?` | metadados |
| `biblioteca_remover` | `id`, `confirm:true` | apaga o item |
| `pcb_importar` | `path` (o `placa.json`, seção 4) | monta a placa no NexoCAD (montagem: placa + componentes) e grava em `Placas` |
| `pcb_caixa` | parâmetros da caixa | caixa em volta da placa, com aberturas para os conectores (só no NexoCAD) |

## 3. Rotas novas do servidor do hub (`tools/rotas/nexocad.py`)

Todas lêem a biblioteca direto do disco. As que mandam algo ao NexoCAD só aceitam pedidos
desta máquina.

| rota | o quê |
|---|---|
| `GET /api/nexo/estado` | `{ok, dir, existe, revisao, nexocad:{aberto, versao, exe}}` |
| `GET /api/nexo/revisao` | `{revisao, mtime}`. Barata: só o `stat` + leitura do índice. As páginas consultam a cada 1,5 s |
| `GET /api/nexo/biblioteca?categoria=Eletrônicos` | o índice filtrado; o padrão são os itens `Eletrônicos` |
| `GET /api/nexo/arquivo/<id>/<modelo.step\|thumb.png>` | o arquivo do item |
| `POST /api/nexo/editar` | `{chave, url, nome, footprint}` ou `{id}`. Abre o NexoCAD se precisar e chama `biblioteca_editar_modelo` / `biblioteca_abrir`. A `url` é a URL do STEP no próprio hub (`/Libs/3d-hub/...`); o servidor baixa de si mesmo para um temporário e passa o `step_path` |
| `POST /api/nexo/placa` | `{pacote}` (seção 4). Grava em `%TEMP%\eletrichub-nexo\<projeto>-<hora>\placa.json` + `modelos/*.step`, abre o NexoCAD e chama `pcb_importar` |

**Cache no navegador:** a chave do cache de malha (IndexedDB) de um corpo da biblioteca é
`nexo:<id>@<rev>`. Assim, salvar no NexoCAD troca a malha na hora.

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
- `modelos[].arquivo`: relativo à pasta do `placa.json`.

**No NexoCAD:**
- A placa vira uma montagem: a peça "Placa" (contorno extrudado, com furos e recortes) mais
  um componente por corpo STEP (cada modelo é uma peça, reaproveitada entre instâncias).
- A placa fica no plano Superior: (x, y, z) da placa → (x, z, −y) do NexoCAD.
- O `pcb_caixa` lê esse mesmo pacote, que fica guardado no item `Placas` como `placa.json`.
