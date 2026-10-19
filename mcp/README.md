# MCP do NexoEletric

Desde a 1.9.0 o servidor se apresenta como **`nexoeletric`** (antes `eletrichub`). Um registro antigo com o
nome `eletrichub` continua funcionando: o arquivo (`mcp/eletrichub-mcp.js`), os argumentos e as URIs
`eletrichub://` não mudaram; só o nome sugerido para registrar.

Servidor **MCP** (Model Context Protocol) do hub: dá a uma IA (Claude Code, Claude Desktop, o
chat do hub) as ferramentas para criar e editar esquema e placa, gerar as saídas e conferir o que
fez — o mesmo motor da tela (`hub-core.js`) e os mesmos arquivos que o hub e o Altium usam.

- **Sem dependência**: só Node (o app desktop leva o dele). JSON-RPC 2.0, protocolo `2025-06-18`
  com recuo para `2025-03-26` e `2024-11-05`.
- **Transportes**: stdio (o padrão) e HTTP Streamable (`POST /mcp`, resposta JSON).
- **Escrita validada**: toda gravação passa antes pelo `HubCore.applyPcbChanges` /
  `validateSchematic`; com erro, nada vai para o disco e a resposta traz o erro. Gravação atômica
  (`.tmp` → rename), uma op por linha, comentários do arquivo preservados — o vigia do
  `hubserver.py` recarrega a vista aberta sozinho.
- **Os `orig_*` do changes.js saem sozinhos** do `board.js`: a IA diz "mova R5 para 12,8" e a
  ferramenta escreve o `comp_move` com os orig certos. Mexer de novo no mesmo objeto edita a
  linha que já existe (uma linha por objeto, como o AI-GUIDE exige).
- **Bibliotecas só leitura**, menos a de footprints do hub: `Libs/` do Altium, almoxarifado,
  símbolos e Odoo ficam como estão. O grupo `footprint` grava só em `Libs/pcblib-hub.js` (a
  biblioteca do editor de footprint, que passa na frente da do Altium com o mesmo nome) e vincula
  footprint a componente pelo servidor do hub, como a aba Biblioteca faz.

## Rodar

```
node mcp/eletrichub-mcp.js                         # stdio, raiz = a pasta acima de mcp/
node mcp/eletrichub-mcp.js --root C:\NexoEletric    # a pasta de trabalho do app desktop
node mcp/eletrichub-mcp.js --http 8765             # HTTP em http://127.0.0.1:8765/mcp
node mcp/eletrichub-mcp.js --listar                # imprime as ferramentas por grupo
```

| opção | o quê |
|---|---|
| `--root <pasta>` | a pasta do hub (tem `hub-core.js` e `Projects/`). Também `ELETRICHUB_ROOT` |
| `--projetos <pasta>` | `Projects/` em outro lugar (os testes usam uma cópia temporária) |
| `--hub <url>` | o hub HTTP no ar, para `hub_status`/`vista_*`; sem ela procura 127.0.0.1 nas portas 8200 (desktop), 8000, 8100 e 8001 |
| `--http <porta>` `--host` `--token` | HTTP Streamable. Fora do loopback **exige** `--token` (Bearer): as ferramentas gravam nos projetos. No loopback, `Origin` de fora é recusado (DNS rebinding) |

## Registrar no cliente

`node mcp/registrar.js` imprime os trechos com os caminhos desta instalação (`--json` para
máquina). O integrador usa `require('./mcp/registrar.js').configuracoes({root, node, electron})`
num item de menu "Conectar a IA (MCP)" que mostra/copia isto.

**Claude Code**
```
claude mcp add --transport stdio --scope user nexoeletric -- node <repo>\mcp\eletrichub-mcp.js --root <pasta do hub>
```

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{ "mcpServers": { "nexoeletric": { "command": "node",
  "args": ["<repo>\\mcp\\eletrichub-mcp.js", "--root", "C:\\NexoEletric"] } } }
```
No app desktop, sem Node no PATH: `"command": "<NexoEletric.exe>"` com
`"env": {"ELECTRON_RUN_AS_NODE": "1"}` (o `configuracoes({electron:true, node:process.execPath})`
já gera assim).

**HTTP** (outro cliente, ou o servidor da rede):
```
node mcp/eletrichub-mcp.js --root <pasta> --http 8765
claude mcp add --transport http nexoeletric http://127.0.0.1:8765/mcp
```

## Ferramentas (74, por grupo)

`list_commands` lista tudo com descrição; cada ferramenta diz na descrição o fluxo de uso.

| grupo | ferramentas |
|---|---|
| projeto | `projeto_listar`, `projeto_resumo`, `projeto_ler_arquivo`, `projeto_abrir_altium` (o .PrjPcb/.SchDoc do Altium vira o schematic.js, sem o Altium: `tools/schdoc/schdoc2sch.py`), `projeto_criar` (pasta + schematic.js; com `placa` cria o board.js mestre pelo `hub-pcbnova.js` e o rules.js da casa), `projeto_desfazer` |
| esquema | `sch_ler`, `sch_componentes` (ponta quente dos pinos + net), `sch_nets`, `sch_adicionar` (ref "R?" = próximo livre, footprint do símbolo), `sch_editar`, `sch_apagar`, `sch_ligar` ("R1.2" → "C1.1"), `sch_validar`, `sch_buscar_simbolo`, `sch_simbolo`, `sch_buscar_footprint`, `sch_template` (`hub-schtemplate.js`) |
| biblioteca | `almox_buscar` (estoque, local, Odoo; devolve o `comp` pronto para `sch_adicionar`) |
| footprint | `fp_buscar`, `fp_ler` (pads, serigrafia, corpos 3D), `fp_salvar` (validado como no editor), `fp_pacote` (o assistente: chip, SOIC, QFP, DIP, SOT-23, barra de pinos; `hub-fppacote.js`), `fp_modelos3d` (os STEP da PcbLib da casa e do hub), `fp_corpo3d` (prende o STEP com a rotação de quem já o usa), `fp_apagar`, `fp_vincular` (footprint → componente do almoxarifado ou símbolo) |
| pcb | `pcb_resumo`, `pcb_consultar` (por tipo/caixa/camada/net/ref), `pcb_componente`, `pcb_net`, `pcb_mudancas`, `pcb_mover`, `pcb_aplicar` (qualquer op, orig_* automáticos), `pcb_editar`, `pcb_apagar`, `pcb_trilha`, `pcb_rotear` (walkaround, `hub-roteador.js`), `pcb_via`, `pcb_contorno`, `pcb_mudanca_remover`, `pcb_mudanca_editar`, `pcb_validar`, `pcb_render` (PNG da placa, com ratsnest) |
| pcbmod | `regras_ler`, `regras_definir` (`hub-pcbregras.js`), `drc_rodar` (`hub-pcbdrc.js`), `nets_ratsnest` (`hub-pcbnets.js`, com reserva própria), `pour_definir`, `pour_despejar` (`hub-pcbpour.js`), `teardrop_aplicar` (`hub-pcbteardrop.js`), `eco_comparar`, `eco_aplicar` (`hub-pcbeco.js`) |
| nexo | `nexo_estado` (o Nexo Hub e o NexoCAD), `nexo_biblioteca` (lista/busca os itens do Nexo Hub no formato do hub; `id` traz revisões e vínculos), `nexo_sincronizar` (publica a biblioteca 3D e as placas no Nexo Hub: o mesmo `lib/nexohub-sync.js` do app), `nexo_editar_modelo` (o corpo 3D de `{projeto, ref}`, de um footprint, de uma chave de modelo ou de um item, aberto no NexoCAD sempre por um item do Nexo Hub; `novo:true` cria um item vazio vinculado ao footprint), `nexo_enviar_placa` (publica o item placa e pede `pcb_importar {item}`; `so_publicar`, `so_pacote`), `nexo_vincular_footprint` (direto no Nexo Hub: `atributos.footprints` + vínculo; num componente já põe o 3D no footprint), `nexo_componentes` (uma biblioteca só: os componentes do NexoCAD com footprint entram na biblioteca de footprints como o 3D deles; o app faz sozinho a cada minuto). Conexão: `NEXOHUB_URL` > `C:UsersPublicNexoHubconexao.json` > `127.0.0.1:47800`. Contrato: `docs/INTEGRACAO-NEXOCAD.md` |
| saidas | `gerber_gerar` (grava `Projects/<p>/Gerber/` + `gerber.json`, como a rota `/api/gerber`; redespeja os polígonos antes), `gerber_salvo` (relê com o `hub-gerberview.js`), `pdf_layout` (`hub-pcbpdf.js` → `PDF/LO - <base>.pdf`), `bom_listar` |
| sinal | `sinal_listar`, `sinal_responder` (só status/reply, AI-GUIDE Parte C), `sinal_criar` |
| hub | `list_commands`, `hub_status`, `hub_modulos`, `hub_modulo_chamar` (qualquer função de qualquer módulo, com `$placa`, `$esquema`, `$regras`...), `vista_screenshot`, `vista_comando`, `altium_comandos` (`hub-altiumdna.js`), `hub_recarregar_ferramentas` |

Módulo do hub que faltar não derruba nada: a ferramenta responde "módulo ausente" e volta a
funcionar sozinha quando o arquivo chega (o carregamento confere o mtime a cada chamada).

Recursos (`resources/*`): o AI-GUIDE, o CLAUDE.md, o PCB-MIGRACAO, este README, os campos das ops
do changes.js e a tabela de camadas (gerados do `hub-core`), e os arquivos de cada projeto
(`eletrichub://projeto/{projeto}/{arquivo}`). Prompts: `fluxo_pcb`, `fluxo_esquema`,
`resolver_sinalizadores`.

## A vista ao vivo (screenshot e comandos)

O MCP grava no disco e o vigia do hub recarrega a página aberta — isso já funciona sem nada. Para
a IA **ver a tela** e **mandar algo para a vista** há duas peças para o integrador ligar:

1. `mcp/rotas_hub.py` no `hubserver.py`, no molde dos outros registráveis:
   ```python
   try:
       sys.path.insert(0, os.path.join(ROOT, 'mcp'))
       import rotas_hub as _mcp_rotas
       _mcp_rotas.registra(app, ROOT)
   except Exception as _e:
       print('AVISO: rotas do MCP desligadas (%s) — falta mcp/rotas_hub.py.' % _e)
   ```
   Rotas `/api/mcp/{status,pedido,pedidos,resposta/<id>}`: uma fila de pedidos em memória (pedido
   só desta máquina; nada grava em disco). Teste: `python tests/test_mcp_rotas.py`.
2. `<script src="mcp/hub-mcpvista.js"></script>` no `pcbframe.html` e no `schframe.html`. A
   página pergunta se há pedido para ela e responde (screenshot do canvas, recarregar). A vista
   pode oferecer ganchos melhores: `window.HubMcpVista = {focar(x,y,zoom), selecionar({ids,refs}),
   comando(nome,args), captura()}`.

Sem as duas, `vista_screenshot` desenha a placa no próprio MCP (`pcb_render`) e avisa.

## Acrescentar ferramentas de um módulo novo

Um arquivo em `mcp/ferramentas/` é um grupo; o registro (`lib/registro.js`) lê a pasta na partida
(e em `hub_recarregar_ferramentas`). Nada do núcleo muda:

```js
'use strict';
const { PROJETO } = require('../lib/util.js');
const ops = require('../lib/pcb-ops.js');
module.exports = {
  grupo: 'meu', ordem: 45, titulo: 'O que o grupo faz',
  ferramentas: [{
    nome: 'meu_fazer', titulo: 'Fazer X', leitura: false, modulo: 'hub-meu.js',
    descricao: 'pt-BR: o que faz, quando usar, o que devolve',
    entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
    executa: async (a, ctx) => {
      const M = ctx.exige('hub-meu.js', 'HubMeu');          // "módulo ausente" se faltar
      const p = ctx.projeto(a.projeto);
      const { eb } = ctx.placa(p);                          // placa efetiva (como a tela)
      const linhas = M.calcula(eb);                         // ops do changes.js
      return ops.transacao(ctx, p, (arq, board) =>          // valida + grava + estado
        linhas.map(o => ops.mescla(arq, ops.origDe(o, board)).obj), { ferramenta: 'meu_fazer' });
    },
  }],
};
```

`ctx` dá: `root`, `projeto(nome)`, `board(p)`, `placa(p)` → `{board, changes, model, eb}`,
`schematic(p)`, `libs()` (as bibliotecas como a vista Esquema as monta), `modulo(arq)`/
`exige(arq, global)`, `grava(arquivo, texto, ferramenta)` (atômico, com desfazer). Retorne um
objeto; `{_imagem:{base64, mime}}` vira imagem; `ok:false` vira `isError`.

## Testes

```
node tests/test-mcp.js          # stdio com processo filho, HTTP, e as ferramentas numa CÓPIA de "LM555 astável"
python tests/test_mcp_rotas.py  # as rotas da vista ao vivo
node tests/test-mcp-nexo.js     # o grupo nexo, com um Nexo Hub (tests/nexohub-falso.js) e um NexoCAD de mentira
node tests/test-nexohub-sync.js # o sincronizador (lib/nexohub-sync.js) contra o Nexo Hub de mentira
node tests/test-nexohub-real.js # o mesmo contra o servidor de verdade (..
exohub), se existir
```

Os testes nunca gravam nos `Projects/` reais (conferem isso no fim).

## Arquivos

| arquivo | o quê |
|---|---|
| `eletrichub-mcp.js` | entrada: argumentos, stdio, HTTP |
| `registrar.js` | os trechos de configuração dos clientes |
| `lib/protocolo.js` | JSON-RPC/MCP (initialize, tools, resources, prompts) |
| `lib/registro.js` | o registro de ferramentas por grupo |
| `lib/contexto.js` | raiz, módulos do hub, bibliotecas, projetos, gravação com desfazer |
| `lib/arquivo-linhas.js` | edição cirúrgica dos arquivos de uma op por linha |
| `lib/pcb-ops.js` | orig_* automáticos, uma linha por objeto, transação validada |
| `lib/geometria.js` | pad/polígono e a conectividade de reserva |
| `lib/render.js` | PNG da placa sem dependência |
| `lib/nexohub.js` | o cliente do Nexo Hub (conexão, API v1) e o item do Nexo Hub no formato do `hub-nexo.js` |
| `lib/nexohub-sync.js` | o sincronizador da biblioteca 3D e das placas (também a CLI que o app desktop roda) |
| `lib/recursos.js`, `lib/util.js` | recursos/prompts; peças comuns |
| `ferramentas/*.js` | os grupos |
| `rotas_hub.py`, `hub-mcpvista.js` | o canal com a vista aberta (para o integrador ligar) |
