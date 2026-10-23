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
node mcp/eletrichub-mcp.js                         # acha a pasta sozinho (app aberto ou a configurada)
node mcp/eletrichub-mcp.js --root C:\AltiumHub      # uma pasta de trabalho dada
node mcp/eletrichub-mcp.js --http 8765             # HTTP em http://127.0.0.1:8765/mcp
node mcp/eletrichub-mcp.js --listar                # imprime as ferramentas por grupo
```

| opção | o quê |
|---|---|
| `--root <pasta>` | a pasta do hub (tem `hub-core.js` e `Projects/`). Opcional: sem ela, ou se ela não for a pasta do hub (um registro antigo com `C:\NexoEletric`), vale `ELETRICHUB_ROOT`, a do app aberto (`%USERPROFILE%\.nexoeletric\session.json`, que o NexoEletric grava ao subir, como o `~/.nexocad/session.json` do NexoCAD), a pasta de trabalho do app (`%APPDATA%\NexoEletric\settings.json`) e por fim a pasta acima do script. O que foi ignorado sai no log |
| `--projetos <pasta>` | `Projects/` em outro lugar (os testes usam uma cópia temporária) |
| `--hub <url>` | o hub HTTP no ar, para `hub_status`/`vista_*`; sem ela vale o do app aberto (session.json) e depois procura 127.0.0.1 nas portas 8200 (desktop), 8000, 8100 e 8001 |
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

## Ferramentas (96, por grupo)

`list_commands` lista tudo com descrição; cada ferramenta diz na descrição o fluxo de uso.

| grupo | ferramentas |
|---|---|
| app | `app_status` (o app está aberto? qual pasta, qual hub, quais vistas), `app_abrir` (abre o NexoEletric e espera o hub, como o `gui_open` do NexoCAD; com `projeto` já o mostra), `vista_abrir` (mostra um projeto ao usuário na aba pedida), `lote` (vários passos numa chamada, `$id.campo` usa o resultado de um passo anterior, como o `batch` do NexoCAD) |
| projeto | `projeto_listar`, `projeto_resumo`, `projeto_ler_arquivo`, `projeto_abrir_altium` (o .PrjPcb do Altium vira o projeto inteiro, sem o Altium: esquema, `board.js` da .PcbDoc, regras, 3D), `projeto_criar` (pasta + schematic.js; com `placa` cria o board.js mestre pelo `hub-pcbnova.js` e o rules.js da casa), `projeto_desfazer` |
| esquema | `sch_ler`, `sch_componentes` (ponta quente dos pinos + net), `sch_nets`, `sch_adicionar` (ref "R?" = próximo livre, footprint do símbolo), `sch_editar`, `sch_apagar`, `sch_ligar` ("R1.2" → "C1.1"), `sch_validar`, `sch_buscar_simbolo`, `sch_simbolo`, `sch_buscar_footprint`, `sch_template` (`hub-schtemplate.js`) |
| simbolo | `sym_ler` (o desenho inteiro, de qualquer acervo), `sym_gerar` (CI/conector a partir da lista de pinos), `sym_salvar` (destino `projeto` = no `symbols` do schematic.js, vale na hora e para as nets; `biblioteca` = Biblioteca de símbolos do hub, `/api/symbols/lib`; `altium` = redesenha um símbolo da SchLib da casa, `/api/symbols/save`), `sym_renomear`, `sym_apagar` |
| biblioteca | `almox_buscar` (estoque, local, Odoo; devolve o `comp` pronto para `sch_adicionar`) |
| footprint | `fp_buscar`, `fp_ler` (pads, serigrafia, corpos 3D), `fp_salvar` (validado como no editor), `fp_pacote` (o assistente: chip, SOIC, QFP, DIP, SOT-23, barra de pinos; `hub-fppacote.js`), `fp_modelos3d` (os STEP da PcbLib da casa e do hub), `fp_corpo3d` (prende o STEP com a rotação de quem já o usa), `fp_3d_importar` (STEP do disco → `Libs/3d-hub`), `fp_3d_nexo` (o STEP de um item da biblioteca da rede Nexo), `fp_apagar`, `fp_vincular` (footprint → componente do almoxarifado ou símbolo) |
| pcb | `pcb_resumo`, `pcb_consultar` (por tipo/caixa/camada/net/ref), `pcb_componente`, `pcb_net`, `pcb_mudancas`, `pcb_mover`, `pcb_aplicar` (qualquer op, orig_* automáticos), `pcb_colocar` (footprint como componente novo, com as nets dos pads), `pcb_editar`, `pcb_apagar`, `pcb_trilha`, `pcb_rotear` (walkaround, `hub-roteador.js`), `pcb_via`, `pcb_contorno`, `pcb_mudanca_remover`, `pcb_mudanca_editar`, `pcb_validar`, `pcb_render` (PNG da placa, com ratsnest) |
| pcbmod | `regras_ler`, `regras_definir` (`hub-pcbregras.js`), `drc_rodar` (`hub-pcbdrc.js`), `nets_ratsnest` (`hub-pcbnets.js`, com reserva própria), `pour_definir`, `pour_despejar` (`hub-pcbpour.js`), `teardrop_aplicar` (`hub-pcbteardrop.js`), `eco_comparar`, `eco_aplicar` (`hub-pcbeco.js`) |
| nexo | `nexo_estado` (o Nexo Hub e o NexoCAD), `nexo_biblioteca` (lista/busca os itens do Nexo Hub no formato do hub; `id` traz revisões e vínculos), `nexo_sincronizar` (publica a biblioteca 3D e as placas no Nexo Hub: o mesmo `lib/nexohub-sync.js` do app), `nexo_editar_modelo` (o corpo 3D de `{projeto, ref}`, de um footprint, de uma chave de modelo ou de um item, aberto no NexoCAD sempre por um item do Nexo Hub; `novo:true` cria um item vazio vinculado ao footprint), `nexo_enviar_placa` (publica o item placa e pede `pcb_importar {item}`; `so_publicar`, `so_pacote`), `nexo_vincular_footprint` (direto no Nexo Hub: `atributos.footprints` + vínculo; num componente já põe o 3D no footprint), `nexo_componentes` (uma biblioteca só: os componentes do NexoCAD com footprint entram na biblioteca de footprints como o 3D deles; o app faz sozinho a cada minuto). Conexão: `NEXOHUB_URL` > `C:\Users\Public\NexoHub\conexao.json` > `127.0.0.1:47800`. Contrato: `docs/INTEGRACAO-NEXOCAD.md` |
| nexobd | `nexo_projetos` (os projetos guardados no NexoBD, fora do catálogo), `nexo_projeto_historico` (revisões: quando, de qual programa, o que mudou), `nexo_projeto_restaurar` (os arquivos de uma revisão antiga voltam para a pasta; o app sobe como revisão nova) |
| saidas | `gerber_gerar` (grava `Projects/<p>/Gerber/` + `gerber.json`, como a rota `/api/gerber`; redespeja os polígonos antes), `gerber_salvo` (relê com o `hub-gerberview.js`), `pdf_layout` (`hub-pcbpdf.js` → `PDF/LO - <base>.pdf`), `bom_listar` |
| jlc | `jlc_preparar` (gera o Gerber se preciso, monta o .zip, conta as camadas de cobre pelo X2 e diz o que a JLC recebe e as quantidades que ela aceita: a IA pergunta a quantidade ANTES), `jlc_enviar` (abre o orçamento da JLCPCB no IntegrateBrowser, sobe o .zip, confere as camadas, põe a quantidade, SAVE TO CART e devolve a captura para conferir; `etapa:"login"` sem conta aberta), `jlc_login` (entra com o usuário e a senha que o usuário der: a senha só é digitada no campo, não volta nem aparece no indicador do app). O motor é o `lib/jlc.js`, o mesmo do botão "Enviar pra JLC" do Gerber (rota `/api/jlc`, `tools/rotas/jlc.py`); para no carrinho |
| casa | `skills_listar`, `skill_ler` (as skills da casa de `mcp/skills/*.md`), `regras_casa_verificar` (cobre de outra net no pad, trilha por cima de pad, parafuso isolado, plano a 1,0 mm dos pads, serigrafia sem passar por cima de nada) |
| sinal | `sinal_listar`, `sinal_responder` (só status/reply, AI-GUIDE Parte C), `sinal_criar` |
| hub | `list_commands`, `hub_status`, `hub_modulos`, `hub_modulo_chamar` (qualquer função de qualquer módulo, com `$placa`, `$esquema`, `$regras`...), `vista_screenshot`, `vista_comando`, `altium_comandos` (`hub-altiumdna.js`), `hub_recarregar_ferramentas` |

Módulo do hub que faltar não derruba nada: a ferramenta responde "módulo ausente" e volta a
funcionar sozinha quando o arquivo chega (o carregamento confere o mtime a cada chamada).

Recursos (`resources/*`): o AI-GUIDE, o CLAUDE.md, o PCB-MIGRACAO, este README, os campos das ops
do changes.js e a tabela de camadas (gerados do `hub-core`), e os arquivos de cada projeto
(`eletrichub://projeto/{projeto}/{arquivo}`). Prompts: `fluxo_pcb`, `fluxo_esquema`,
`resolver_sinalizadores`.

## A IA no topo do app (o que ela está fazendo)

Como no NexoCAD (os comandos da IA aparecem no app e o "Conectar IA" mostra o histórico): o MCP
conta ao hub o que fez (`lib/relato.js` → `POST /api/mcp/ola` no `initialize` e a cada 20 s, e
`POST /api/mcp/atividade` a cada ferramenta), e o `hub-mcp.js` da página mostra:

- o indicador **IA** no canto de cima (no app, ao lado do chat, na fileira das abas): cinza sem IA,
  verde com o nome do cliente conectado ("IA · Claude Code"), laranja pulsando com o comando que
  acabou de rodar;
- um aviso no canto a cada comando que **muda** algo (ou todos, ou nenhum: escolha no painel);
- o painel do clique: quem está conectado, "Conectar IA (MCP)…" e a **atividade recente** (hora,
  ferramenta, projeto, resumo dos argumentos ou o erro).

Sem o hub no ar o relato não faz nada (as ferramentas seguem). `ELETRICHUB_SEM_RELATO=1` desliga.

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
`placaDespejada(p)` → o mesmo com os planos despejados como a tela (+ `despejo`),
`schematic(p)`, `libs()` (as bibliotecas como a vista Esquema as monta), `modulo(arq)`/
`exige(arq, global)`, `grava(arquivo, texto, ferramenta)` (atômico, com desfazer). Retorne um
objeto; `{_imagem:{base64, mime}}` vira imagem; `ok:false` vira `isError`.

## Skills da casa

Regras de projeto da Dieletrons que toda IA segue ao mexer numa placa. Cada uma é um `.md` em `mcp/skills/` com
cabeçalho `---` (`nome`, `titulo`, `descricao`) e o texto (a regra, o porquê e como fazer com estas ferramentas).
Arquivo novo na pasta entra sozinho (lido pelo mtime) e chega ao cliente por quatro caminhos: o resumo nas
`instructions` do initialize, o recurso `eletrichub://skill/<nome>`, o prompt `skill_<nome>` e as ferramentas
`skills_listar` / `skill_ler`. `regras_casa_verificar {projeto}` confere as regras que dá para medir.

| skill | o que manda | conferida por |
|---|---|---|
| `pcb-cobre-sem-curto` | cobre de outra net nunca em cima/perto de pad ou via (pad passante vale em todas as camadas); trilha no meio do vão; trilha da mesma net termina no pad; faixa não tapa o alívio térmico | `regras_casa_verificar` » `pad_outra_net`, `trilha_sobre_pad`; `drc_rodar` |
| `pcb-boas-praticas` | checklist pesquisado (IPC-2221, DFM): folga por tensão, largura por corrente, anel, furo-cobre, borda, ângulo agudo, alívio, costura, serigrafia, teardrop | regras do `rules.js` + `drc_rodar` |
| `pcb-verificar-antes-de-entregar` | a sequência antes de dizer "pronto" e o que fazer com a foto de um problema | — |
| `pcb-parafusos-isolados` | quadrado sem cobre de furo + 3 mm em volta do parafuso | `parafuso` |
| `pcb-plano-folga-pads` | plano a 1,0 mm dos pads de outra net, alívio térmico | `plano_pad` |
| `pcb-serigrafia-livre` | overlay nunca em cima de pad, via, furo, trilha, fill ou outra serigrafia; o plano de terra pode passar por baixo | `serigrafia` |
| `pcb-enviar-jlc` | processo de pôr a placa no carrinho da JLCPCB: conferir o DRC, `jlc_preparar`, perguntar a quantidade antes, `jlc_enviar`, `jlc_login` com a conta do usuário (sem guardar nem repetir a senha), conferir a captura; nunca passar do carrinho | `jlc_enviar` (camadas lidas × placa, `noCarrinho`) |
| `pcb-producao-backplane` | técnica de produção da CBM-DI251877 para backplane de conectores EDGE: campo sem plano em volta das fileiras, GND no Top fora do campo, +5V no Bottom com retângulos de GND entre os conectores, abas, corrente de +5V, leque em escada só com 45°, sem via | `drc_rodar`, `nets_ratsnest`, `regras_casa_verificar` |

`drc_rodar`, `nets_ratsnest` e `pcb_render` usam a placa como a tela mostra (`ctx.placaDespejada(p)`: os polígonos
do hub redespejados); `despejar:false` volta ao jeito antigo (sem o cobre dos planos).

## Testes

```
node tests/test-mcp.js          # stdio com processo filho, HTTP, e as ferramentas numa CÓPIA de "LM555 astável"
node tests/test-mcp-completo.js # raiz automática, símbolos, 3D do disco, pcb_colocar, lote e o relato ao hub
python tests/test_mcp_rotas.py  # as rotas da vista ao vivo
node tests/test-jlc.js          # o envio à JLC (lib/jlc.js) contra um IntegrateBrowser de mentira; a senha não vaza
python tests/test_jlc_rotas.py  # as rotas /api/jlc do botão "Enviar pra JLC"
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
| `lib/jlc.js` | o envio à JLCPCB pelo IntegrateBrowser (o MCP e o botão do Gerber) |
| `lib/geometria.js` | pad/polígono e a conectividade de reserva |
| `lib/render.js` | PNG da placa sem dependência |
| `lib/nexohub.js` | o cliente do Nexo Hub (conexão, API v1) e o item do Nexo Hub no formato do `hub-nexo.js` |
| `lib/nexohub-sync.js` | o sincronizador da biblioteca 3D e das placas (também a CLI que o app desktop roda) |
| `lib/recursos.js`, `lib/util.js` | recursos/prompts; peças comuns |
| `ferramentas/*.js` | os grupos |
| `rotas_hub.py`, `hub-mcpvista.js` | o canal com a vista aberta (para o integrador ligar) |
